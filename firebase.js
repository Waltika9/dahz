// ===== Firebase: аккаунты и проекты на главной =====
// Подключается в index.html как <script type="module"> ПОСЛЕ script.js,
// поэтому здесь доступна функция showToast из script.js.
//
// Все проекты хранятся в Firestore, в коллекции projects:
//   title, link, tag, image, author, ownerUid, approved, eternal, visible, status, order, rank
// rank — место в рейтинге владельца (1 — лучший), для сортировки «лучшие / худшие».
// Что кому можно — решают правила Firestore (Firestore → Rules в консоли Firebase).

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
    getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
    deleteUser, signOut, onAuthStateChanged, sendPasswordResetEmail,
    EmailAuthProvider, reauthenticateWithCredential, updatePassword, verifyBeforeUpdateEmail
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
    getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc, getDoc, getDocs, updateDoc,
    writeBatch, query, where, orderBy, limit, startAfter, arrayUnion, serverTimestamp, Timestamp, increment
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import * as gh from './github.js?v=5';

// Этот конфиг не секретный — он и должен быть виден в коде сайта.
// Защиту дают правила Firestore.
const firebaseConfig = {
    apiKey: "AIzaSyAYnkmN8mjNnx5XmaopQlBEInQm7eddDhI",
    authDomain: "dahz-91fc8.firebaseapp.com",
    projectId: "dahz-91fc8",
    storageBucket: "dahz-91fc8.firebasestorage.app",
    messagingSenderId: "515161045588",
    appId: "1:515161045588:web:c5694b02a4f547f6a2cbc1"
};

// UID владельца сайта (Authentication → Users)
const ADMIN_UID = '0VPhJelZUegmMS9O0vgfO3k0sj03';
const ADMIN_NAME = 'Waltika';
const MAX_REQUESTS = 3;   // сколько заявок может ждать одобрения у одного пользователя

// Возможные статусы проекта
const STATUSES = {
    ok:          { icon: '✅', label: 'Доступен',            message: '' },
    dev:         { icon: '🛠', label: 'В разработке',        message: 'Проект находится в разработке' },
    unavailable: { icon: '⛔', label: 'Временно недоступен', message: 'Проект временно недоступен' },
    updating:    { icon: '🔄', label: 'Обновляется',         message: 'Проект обновляется, скоро он снова станет доступным' }
};

// Права, которые владелец может выдать пользователям (окно «👥 Пользователи»).
// Хранятся в members/{uid}.perms, менять их может только владелец — это проверяют правила Firestore.
const PERMS = {
    status:     '🔄 Менять статус',
    visibility: '👁 Скрывать и показывать',
    create:     '➕ Создавать проекты',
    activity:   '📊 Смотреть активность',
    rank:       '🏆 Менять рейтинг'
};

// Тестовый пользователь — «пустышка» в окне «Пользователи». Настоящего аккаунта у него нет:
// права хранятся только в браузере владельца, а в его режиме ничего не сохраняется в базу
const TEST_NAME = 'Тестовый пользователь';
const TEST_KEY = 'dahz_test_user';

// Коды приглашения: invites/{код} = { limit, used, note, createdAt }.
// limit — сколько аккаунтов можно зарегистрировать по коду (0 — без ограничений)
const INVITE_LIMIT_MAX = 1000;
const INVITE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // без похожих 0/O и 1/I

// Доступ к аккаунтам других пользователей (members/{uid}.perms.accounts):
// view — видеть ники и email; edit — ещё менять ники и отправлять письмо для сброса пароля.
// Сами пароли не видит никто: Firebase хранит их только в зашифрованном виде.
const ACCOUNT_LEVELS = {
    none: 'нет доступа',
    view: 'смотреть логины',
    edit: 'смотреть и менять'
};

// Виды сортировки (меню между поиском и темой). first — по умолчанию и после обновления страницы
const SORTS = {
    first: { label: 'Сначала первые', icon: 'images/sort-time.png' },
    new:   { label: 'Сначала новые',  icon: 'images/sort-time.png', mirror: true },
    best:  { label: 'Сначала лучшие', icon: 'images/sort-star.png' },
    worst: { label: 'Сначала худшие', icon: 'images/sort-star.png', dim: true }
};

// Статистика посещений (коллекция visits): одна запись = один заход в браузере.
// Бесплатный тариф Spark в день: 50 000 чтений, 20 000 записей, 20 000 удалений.
// Заход = 1 запись + по 1 за каждый открытый проект; окно активности = до VISITS_PAGE чтений.
const VISITS_PAGE = 200;        // сколько последних заходов загружать за раз
const VISITS_KEEP_DAYS = 30;    // старше — владелец удаляет автоматически (раз в день)
const VISIT_PAGES_MAX = 30;     // сколько проектов запоминать за один заход

const PROJECT_DEFAULTS = {
    title: '', link: '', tag: '', image: '', author: ADMIN_NAME,
    approved: true, eternal: false, visible: true, status: 'ok', order: 0
};

// Основные проекты. Показываются, даже если база недоступна.
// При первом входе владельца они записываются в базу уже увековеченными.
const BUILTIN_PROJECTS = {
    aviasales: {
        title: 'Продажа авиабилетов ✈️', link: 'projects/aviasales.html',
        tag: 'aviasales.html', image: '', order: 1, eternal: true
    },
    calc: {
        title: 'КалькУлятор', link: 'projects/calc.html',
        tag: 'calc.html', image: 'images/gumball-calculator.jpg', order: 2, eternal: true
    },
    glubokiy_bolnoy: {
        title: 'Глубокий Больной ✨', link: 'projects/glubokiy_bolnoy/index.html',
        tag: 'glubokiy_bolnoy.js', image: '', order: 3, eternal: true
    },
    wh_p: {
        title: 'Презентация "Древняя Греция"', link: 'projects/wh_p/index.html',
        tag: 'wh_p.css', image: 'images/wh_p_images/древняя_греция_превью.jpg', order: 4, eternal: true
    },
    vision: {
        title: 'Vision👁️', link: 'projects/vision/index.html',
        tag: 'vision.js', image: '', order: 5, eternal: true
    },
    s_sim: {
        title: 'Space Simulator 🌏', link: 'projects/s_sim/index.html',
        tag: 's_sim.js', image: 'images/space_prev.png', order: 6, eternal: true
    },
    sdesk: {
        title: 'Short Desk', link: 'projects/sdesk/index.html',
        tag: 'sdesk.html', image: 'images/sdesk_prev.png', order: 7, eternal: true
    },
    schedule: {
        title: 'IRL расписание', link: 'projects/schedule/index.html',
        tag: 'schedule.json', image: '', order: 8, eternal: true
    },
    pechatalka: {
        title: 'Печаталка ⌨️', link: 'projects/pechatalka/index.html',
        tag: 'pechatalka.js', image: '', order: 9, eternal: true
    },
    a_metro: {
        title: 'AlmaMetro', link: 'projects/a-metro/index.html',
        tag: 'a-metro.js', image: 'images/a-metro_prev.png', order: 10, eternal: true
    }
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const projectsCol = collection(db, 'projects');
const visitsCol = collection(db, 'visits');
const invitesCol = collection(db, 'invites');

const $ = (id) => document.getElementById(id);

const projectCards = $('projectCards');
const createProjectBtn = $('createProjectBtn');
const tokenBtn = $('tokenBtn');
const usersBtn = $('usersBtn');
const usersModal = $('usersModal');
const usersList = $('usersList');
const usersHint = $('usersHint');

const accountModal = $('accountModal');
const accountWho = $('accountWho');
const viewEditBtn = $('viewEditBtn');
const viewGuestBtn = $('viewGuestBtn');
const viewTestBtn = $('viewTestBtn');
const viewHint = $('viewHint');
const invitesBtn = $('invitesBtn');
const invitesModal = $('invitesModal');
const invitesList = $('invitesList');
const inviteForm = $('inviteForm');
const inviteCode = $('inviteCode');
const inviteLimit = $('inviteLimit');
const inviteNote = $('inviteNote');
const rankBtn = $('rankBtn');
const rankModal = $('rankModal');
const rankList = $('rankList');
const rankSaveBtn = $('rankSaveBtn');
const securityModal = $('securityModal');
const passwordForm = $('passwordForm');
const emailForm = $('emailForm');

const sortBtn = $('sortBtn');
const sortIcon = $('sortIcon');
const sortMenu = $('sortMenu');
const sortOptions = $('sortOptions');
const activityBtn = $('activityBtn');
const activityModal = $('activityModal');
const activityList = $('activityList');
const activityStats = $('activityStats');
const activitySearch = $('activitySearch');
const activityMoreBtn = $('activityMoreBtn');

const loginBtn = $('loginBtn');
const loginModal = $('loginModal');
const loginForm = $('loginForm');
const loginEmail = $('loginEmail');
const loginPassword = $('loginPassword');
const loginSubmit = $('loginSubmit');

const authTitle = $('authTitle');
const registerForm = $('registerForm');
const regCode = $('regCode');
const regNickname = $('regNickname');
const regEmail = $('regEmail');
const regPassword = $('regPassword');
const regPassword2 = $('regPassword2');
const registerSubmit = $('registerSubmit');
const inviteInfoBtn = $('inviteInfoBtn');
const inviteInfoTip = $('inviteInfoTip');

const projectModal = $('projectModal');
const projectForm = $('projectForm');
const projectModalTitle = $('projectModalTitle');
const projTitle = $('projTitle');
const projLink = $('projLink');
const projCreateFile = $('projCreateFile');
const projCreateFileRow = $('projCreateFileRow');
const projAuthor = $('projAuthor');
const projImage = $('projImage');
const projectSubmit = $('projectSubmit');

const tokenModal = $('tokenModal');
const tokenForm = $('tokenForm');
const tokenInput = $('tokenInput');
const tokenSubmit = $('tokenSubmit');

const confirmModal = $('confirmModal');

const LOGIN_BTN_TEXT = 'Войти/Зарегистрироваться';
const REGISTRATION_CLOSED = 'К сожалению, регистрация недоступна. Для дополнительной информации, пожалуйста, обратитесь к Waltika.';

// ===== СОСТОЯНИЕ =====
let approvedDocs = {};   // одобренные проекты (видят все)
let extraDocs = {};      // владелец — все проекты; пользователь — свои заявки
let currentUser = null;
let isAdmin = false;
let member = null;       // данные из members/{uid}: { nickname, perms, ... }
let unsubExtra = null;
let unsubMember = null;
let seeding = false;
let sortMode = 'first';  // не запоминается: после обновления страницы снова «Сначала первые»

// Вид страницы для вошедшего (запоминается в этом браузере):
//   edit  — обычный, с кнопками управления;
//   guest — как у посетителя без аккаунта;
//   test  — глазами тестового пользователя (только владелец).
let viewMode = storageGet(localStorage, 'dahz_view_mode')
    || (storageGet(localStorage, 'dahz_guest_view') === '1' ? 'guest' : 'edit');
if (!['edit', 'guest', 'test'].includes(viewMode)) viewMode = 'edit';

// Права тестового пользователя
let testPerms = loadTestPerms();

// ===== ПОМОЩНИКИ =====

// Разрешаем только свои файлы и https-ссылки (защита от javascript: и т.п.)
function safeLink(link) {
    if (/^projects\/[\w./-]+$/.test(link) && !link.includes('..')) return link;
    if (/^https:\/\/[^\s"'<>]+$/.test(link)) return link;
    return '';
}

// Картинки, которые переехали в другую папку (в базе мог остаться старый путь)
const MOVED_IMAGES = {
    'images/древняя_греция_превью.jpg': 'images/wh_p_images/древняя_греция_превью.jpg'
};

// Разрешаем картинки из images/ и из одной вложенной папки (images/папка/файл)
function safeImage(path) {
    path = MOVED_IMAGES[path] || path;
    return /^images\/([\p{L}\p{N}_.-]+\/)?[\p{L}\p{N}_.-]+$/u.test(path) && !path.includes('..') ? path : '';
}

// Подпись справа от названия: имя файла или адрес сайта
function linkTag(link) {
    if (link.startsWith('https://')) {
        try { return new URL(link).hostname; } catch { return ''; }
    }
    return link.split('/').pop();
}

function isOwner(p) {
    return !!currentUser && p.ownerUid === currentUser.uid;
}

// Есть ли у текущего пользователя право (у владельца есть все)
function can(perm) {
    return isAdmin || member?.perms?.[perm] === true;
}

// Доступ к чужим аккаунтам: 'none' | 'view' | 'edit' (у владельца — всё)
function accountsAccess() {
    if (isAdmin) return 'edit';
    return levelOf(member?.perms?.accounts);
}

function levelOf(value) {
    return Object.hasOwn(ACCOUNT_LEVELS, value || '') ? value : 'none';
}

// ----- Тестовый пользователь -----
function loadTestPerms() {
    let saved = {};
    try { saved = JSON.parse(storageGet(localStorage, TEST_KEY) || '{}') || {}; } catch { /* испорчено — с нуля */ }
    const perms = {};
    for (const k of Object.keys(PERMS)) perms[k] = saved[k] === true;
    perms.accounts = levelOf(saved.accounts);
    return perms;
}

function saveTestPerms(changes) {
    testPerms = { ...testPerms, ...changes };
    storageSet(localStorage, TEST_KEY, JSON.stringify(testPerms));
    render();
    showToast(`${TEST_NAME}: права обновлены`, 'success');
}

// ----- Режимы просмотра -----
// asGuest / asTest — какой вид страницы сейчас включён
const asGuest = () => !!currentUser && viewMode === 'guest';
const asTest = () => isAdmin && viewMode === 'test';

// Что видно на странице (карточки проектов)
const viewAdmin = () => isAdmin && viewMode === 'edit';
const viewCan = (perm) => !asGuest() && (asTest() ? testPerms[perm] === true : can(perm));
const viewOwner = (p) => !asGuest() && !asTest() && isOwner(p);

// Что доступно в меню «Управление аккаунтом» (в режиме гостя — свои настоящие права)
const menuAdmin = () => isAdmin && !asTest();
const menuCan = (perm) => (asTest() ? testPerms[perm] === true : can(perm));
const menuAccounts = () => (asTest() ? testPerms.accounts : accountsAccess());

// Все проекты: встроенные + из базы, в порядке выбранной сортировки
function allProjects() {
    const map = {};
    for (const [id, data] of Object.entries(BUILTIN_PROJECTS)) {
        map[id] = { ...PROJECT_DEFAULTS, ...data };
    }
    for (const [id, data] of Object.entries({ ...approvedDocs, ...extraDocs })) {
        map[id] = { ...PROJECT_DEFAULTS, ...map[id], ...data };
    }
    return sortProjects(Object.entries(map).map(([id, p]) => ({ id, ...p })));
}

// order — когда проект появился (у встроенных 1, 2, 3..., у новых — время создания)
function sortProjects(list) {
    const byOrder = (a, b) => (a.order || 0) - (b.order || 0);
    if (sortMode === 'new') return list.sort((a, b) => byOrder(b, a));
    if (sortMode === 'best' || sortMode === 'worst') {
        // проекты без места в рейтинге — в конце, по порядку появления
        const dir = sortMode === 'best' ? 1 : -1;
        return list.sort((a, b) => {
            const ra = Number(a.rank) > 0, rb = Number(b.rank) > 0;
            if (ra && rb) return (a.rank - b.rank) * dir;
            if (ra !== rb) return ra ? -1 : 1;
            return byOrder(a, b);
        });
    }
    return list.sort(byOrder);
}

function pendingRequests() {
    return Object.entries(extraDocs).filter(([, p]) => p.approved === false && isOwner(p));
}

function button(text, className, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
}

// Глазами тестового пользователя кнопки только показывают, что ему доступно
function testBlocked() {
    if (!asTest()) return false;
    showToast('Это режим тестового пользователя: изменения не сохраняются', 'info');
    return true;
}

async function run(action, successText) {
    if (testBlocked()) return;
    try {
        await action();
        if (successText) showToast(successText, 'success');
    } catch (err) {
        console.error(err);
        showToast(err.code === 'permission-denied' ? 'Нет прав на это действие' : (err.message || 'Что-то пошло не так'));
    }
}

// ===== ОТРИСОВКА =====
function render() {
    document.body.classList.toggle('is-admin', viewAdmin());
    projectCards.innerHTML = '';

    allProjects().forEach(p => {
        const canSeePending = viewAdmin() || viewOwner(p);
        if (!p.approved && !canSeePending) return;      // заявка — только автору и владельцу
        if (p.approved && !p.visible && !viewCan('visibility')) return; // скрытый — владельцу и тем, кто может показать
        projectCards.appendChild(buildCard(p));
    });

    renderAccountMenu();
}

function buildCard(p) {
    const link = safeLink(p.link);
    const card = document.createElement(link ? 'a' : 'div');
    card.className = 'project-card';
    card.dataset.projectId = p.id;
    if (link) {
        card.href = link;
        if (link.startsWith('https://')) {
            card.target = '_blank';
            card.rel = 'noopener';
        }
    }
    if (p.approved && !p.visible) card.classList.add('is-hidden-admin');
    if (p.status !== 'ok') card.classList.add('is-blocked');

    // Заголовок: название + автор, справа — файл
    const header = document.createElement('div');
    header.className = 'project-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'project-title-wrap';
    const title = document.createElement('span');
    title.className = 'project-title';
    title.textContent = p.title;
    const author = document.createElement('span');
    author.className = 'project-author';
    author.textContent = `(Создан: ${p.author})`;
    titleWrap.append(title, author);
    header.appendChild(titleWrap);

    const tagText = p.tag || linkTag(link);
    if (tagText) {
        const tag = document.createElement('span');
        tag.className = 'project-tag';
        tag.textContent = tagText;
        header.appendChild(tag);
    }
    card.appendChild(header);

    // Плашка статуса
    if (!p.approved) {
        card.appendChild(makeBadge('status-pending', '⏳ Заявка на проверке'));
    } else if (p.status !== 'ok') {
        const info = STATUSES[p.status] || STATUSES.dev;
        card.appendChild(makeBadge(`status-${p.status}`, `${info.icon} ${info.label}`));
    }

    // Картинка-превью
    const image = safeImage(p.image);
    if (image) {
        const img = document.createElement('img');
        img.src = image;
        img.alt = `Превью: ${p.title}`;
        img.className = 'project-preview';
        img.onerror = () => { img.style.display = 'none'; };
        card.appendChild(img);
    }

    // Панель управления (в режиме «как гость» её нет)
    let panel = null;
    if (viewAdmin()) panel = adminPanel(p);
    else if (!p.approved) panel = viewOwner(p) ? ownerPanel(p) : null;
    else if (viewCan('status') || viewCan('visibility')) panel = helperPanel(p);
    if (panel) {
        // Карточка — это ссылка, поэтому клик по панели не должен открывать проект
        panel.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        card.appendChild(panel);
    }

    card.addEventListener('click', (e) => {
        // Посетитель кликает по проекту со статусом — вместо перехода показываем плашку
        if (!viewAdmin() && p.status !== 'ok') {
            e.preventDefault();
            showToast((STATUSES[p.status] || STATUSES.dev).message, 'warning');
            return;
        }
        if (!link) return;

        // Запоминаем, какой проект открыли. Если он открывается в этой же вкладке —
        // ждём запись (максимум 0,8 с), иначе браузер уйдёт со страницы раньше
        const newTab = card.target === '_blank' || e.ctrlKey || e.metaKey || e.shiftKey;
        if (newTab) {
            logProjectView(p);
            return;
        }
        e.preventDefault();
        logProjectView(p).then(() => { window.location.href = link; });
    });

    return card;
}

function makeBadge(extraClass, text) {
    const badge = document.createElement('span');
    badge.className = `project-tag status-tag ${extraClass}`;
    badge.textContent = text;
    return badge;
}

function adminPanel(p) {
    const panel = document.createElement('div');
    panel.className = 'admin-panel';

    if (!p.approved) {
        // Заявка пользователя
        panel.append(
            button('✏️ Изменить', 'admin-btn', () => openProjectModal('edit', p)),
            button('✅ Одобрить', 'admin-btn', () => approveRequest(p)),
            button('🗑 Отклонить', 'admin-btn danger', () => openConfirm({
                title: 'Отклонить заявку?',
                text: `Заявка «${p.title}» будет удалена.`,
                yesText: 'Да, отклонить',
                onYes: () => run(() => deleteDoc(doc(db, 'projects', p.id)), 'Заявка отклонена')
            }))
        );
        return panel;
    }

    // Видимость и статус
    panel.appendChild(button(p.visible ? '👁 Скрыть' : '🙈 Показать', 'admin-btn',
        () => saveFields(p.id, { visible: !p.visible })));

    Object.entries(STATUSES).forEach(([key, s]) => {
        const btn = button(`${s.icon} ${s.label}`, 'admin-btn', () => saveFields(p.id, { status: key }));
        btn.classList.toggle('active', key === p.status);
        panel.appendChild(btn);
    });

    // Изменение и удаление — только пока проект не увековечен
    const row = document.createElement('div');
    row.className = 'admin-row';
    if (p.eternal) {
        const mark = document.createElement('span');
        mark.className = 'eternal-mark';
        mark.textContent = '🔒 Увековечен';
        row.appendChild(mark);
    } else {
        row.append(
            button('✏️ Изменить', 'admin-btn', () => openProjectModal('edit', p)),
            button('🔒 Увековечить', 'admin-btn', () => openConfirm({
                title: 'Увековечить проект?',
                text: 'После этого проект нельзя будет удалить или переименовать — только скрыть или изменить его статус. Отменить это действие будет нельзя.',
                yesText: 'Да, увековечить',
                onYes: () => saveFields(p.id, { eternal: true }, 'Проект увековечен')
            })),
            button('🗑 Удалить', 'admin-btn danger', () => openConfirm({
                title: 'Удалить проект?',
                text: `Проект «${p.title}» исчезнет с сайта. Файл и картинка в репозитории останутся — при желании их можно удалить на GitHub.`,
                yesText: 'Да, удалить',
                onYes: () => run(() => deleteDoc(doc(db, 'projects', p.id)), 'Проект удалён')
            }))
        );
    }
    panel.appendChild(row);
    return panel;
}

// Панель помощника: только те кнопки, на которые есть права
function helperPanel(p) {
    const panel = document.createElement('div');
    panel.className = 'admin-panel';

    if (viewCan('visibility')) {
        panel.appendChild(button(p.visible ? '👁 Скрыть' : '🙈 Показать', 'admin-btn',
            () => saveFields(p.id, { visible: !p.visible })));
    }
    if (viewCan('status')) {
        Object.entries(STATUSES).forEach(([key, s]) => {
            const btn = button(`${s.icon} ${s.label}`, 'admin-btn', () => saveFields(p.id, { status: key }));
            btn.classList.toggle('active', key === p.status);
            panel.appendChild(btn);
        });
    }
    return panel;
}

function ownerPanel(p) {
    const panel = document.createElement('div');
    panel.className = 'admin-panel';
    panel.appendChild(button('🗑 Отменить заявку', 'admin-btn danger', () => openConfirm({
        title: 'Отменить заявку?',
        text: `Заявка «${p.title}» будет удалена.`,
        yesText: 'Да, отменить',
        onYes: () => run(() => deleteDoc(doc(db, 'projects', p.id)), 'Заявка отменена')
    })));
    return panel;
}

// ===== МЕНЮ «УПРАВЛЕНИЕ АККАУНТОМ» =====
// Кнопка в шапке: гость — «Войти», вошедший — «Управление аккаунтом» (в любом режиме просмотра)
const VIEW_HINTS = {
    edit: 'Видны кнопки управления на карточках: статусы, скрытие, изменение.',
    guest: 'Страница выглядит так, как её видят посетители без аккаунта: без кнопок управления, скрытых проектов и заявок.',
    test: `Страница и это меню — глазами тестового пользователя. Его права настраиваются в «Пользователях». ` +
          'Кнопки только показывают, что ему доступно: изменения не сохраняются.'
};

function renderAccountMenu() {
    loginBtn.textContent = currentUser ? 'Управление аккаунтом' : LOGIN_BTN_TEXT;
    // режим тестового — только у владельца, у остальных он работает как обычный
    const shown = viewMode === 'test' && !isAdmin ? 'edit' : viewMode;

    createProjectBtn.hidden = !menuAdmin() && !member && !asTest();
    rankBtn.hidden = !menuCan('rank');
    tokenBtn.hidden = !menuAdmin();
    invitesBtn.hidden = !menuAdmin();
    usersBtn.hidden = menuAccounts() === 'none';
    activityBtn.hidden = !menuCan('activity');
    $('securityBtn').hidden = asTest();   // свой пароль владелец меняет в обычном режиме

    if (menuAdmin()) {
        createProjectBtn.textContent = '➕ Создать проект';
        tokenBtn.textContent = gh.getToken() ? '🔑 Токен GitHub ✓' : '🔑 Токен GitHub';
    } else if (menuCan('create')) {
        createProjectBtn.textContent = '➕ Создать проект';
    } else {
        const used = asTest() ? 0 : pendingRequests().length;
        createProjectBtn.textContent = `➕ Предложить проект (${used}/${MAX_REQUESTS})`;
    }

    // Кто вошёл и какой сейчас вид страницы
    const name = isAdmin ? ADMIN_NAME : (member?.nickname || 'без никнейма');
    accountWho.textContent = !currentUser ? ''
        : asTest() ? `Вы смотрите как 🧪 ${TEST_NAME} (на самом деле вошёл ${name})`
        : `Вы вошли как ${name} (${currentUser.email || 'без email'})`;
    viewTestBtn.hidden = !isAdmin;
    for (const [btn, mode] of [[viewEditBtn, 'edit'], [viewGuestBtn, 'guest'], [viewTestBtn, 'test']]) {
        btn.classList.toggle('active', shown === mode);
        btn.setAttribute('aria-checked', String(shown === mode));
    }
    viewHint.textContent = VIEW_HINTS[shown];
}

function openAccountMenu() {
    renderAccountMenu();
    accountModal.classList.add('active');
}

function closeAccountMenu() {
    accountModal.classList.remove('active');
}

const VIEW_TOASTS = {
    edit: 'Режим редактирования включён',
    guest: 'Теперь страница выглядит как для гостя',
    test: `Теперь вы смотрите как ${TEST_NAME}`
};

function setViewMode(mode) {
    if (mode === 'test' && !isAdmin) return;
    if (mode === viewMode) return;
    viewMode = mode;
    storageSet(localStorage, 'dahz_view_mode', mode);
    // окна, которые в новом режиме могут быть недоступны, закрываем
    closeUsers();
    closeActivity();
    closeInvites();
    rankModal.classList.remove('active');
    render();
    showToast(VIEW_TOASTS[mode], 'info');
}

viewEditBtn.addEventListener('click', () => setViewMode('edit'));
viewGuestBtn.addEventListener('click', () => setViewMode('guest'));
viewTestBtn.addEventListener('click', () => setViewMode('test'));

// Кнопки меню открывают свои окна, а само меню закрывается
for (const btn of [createProjectBtn, rankBtn, usersBtn, activityBtn, tokenBtn, invitesBtn, $('securityBtn')]) {
    btn.addEventListener('click', closeAccountMenu);
}

$('logoutBtn').addEventListener('click', async () => {
    closeAccountMenu();
    await signOut(auth);
    showToast('Вы вышли из аккаунта', 'info');
});

$('closeAccountBtn').addEventListener('click', closeAccountMenu);
accountModal.addEventListener('click', (e) => {
    if (e.target === accountModal) closeAccountMenu();
});

// ===== ДЕЙСТВИЯ С ПРОЕКТАМИ =====

function saveFields(id, fields, successText = 'Сохранено') {
    return run(() => setDoc(doc(db, 'projects', id), { ...fields, updatedAt: serverTimestamp() }, { merge: true }), successText);
}

// Одобрение: копируем заявку в новый документ, а «слот» заявки освобождаем
function approveRequest(p) {
    const { id, ...data } = p;
    return run(async () => {
        const batch = writeBatch(db);
        batch.set(doc(projectsCol), { ...data, approved: true, visible: true, updatedAt: serverTimestamp() });
        batch.delete(doc(db, 'projects', id));
        await batch.commit();
    }, 'Проект одобрен и виден всем');
}

// Встроенные проекты записываем в базу (один раз, при входе владельца)
async function seedBuiltins() {
    if (seeding) return;
    const missing = Object.keys(BUILTIN_PROJECTS).filter(id => !extraDocs[id]?.title);
    if (missing.length === 0) return;
    seeding = true;
    for (const id of missing) {
        const old = extraDocs[id] || {};
        await setDoc(doc(db, 'projects', id), {
            ...PROJECT_DEFAULTS,
            ...BUILTIN_PROJECTS[id],
            ownerUid: ADMIN_UID,
            visible: old.visible ?? true,
            status: old.status ?? 'ok',
            createdAt: serverTimestamp()
        }, { merge: true }).catch(err => console.error('Не удалось записать', id, err));
    }
    seeding = false;
}

// ===== ОКНО ПРОЕКТА (создание / изменение / заявка) =====
let projectMode = null;   // { mode: 'create' | 'edit' | 'request', project }

function openProjectModal(mode, project = null) {
    projectMode = { mode, project };
    projectModal.classList.toggle('member-form', !menuAdmin());

    projectModalTitle.textContent =
        mode === 'edit' ? 'Изменить проект' : (mode === 'create' ? 'Новый проект' : 'Заявка на проект');
    projectSubmit.textContent = mode === 'edit' ? 'Сохранить' : (mode === 'create' ? 'Создать' : 'Отправить заявку');

    projTitle.value = project?.title || '';
    projLink.value = project?.link || (menuAdmin() && mode === 'create' ? 'projects/' : '');
    projAuthor.value = project?.author || ADMIN_NAME;
    projImage.value = '';
    projCreateFile.checked = true;
    updateCreateFileRow();

    projectModal.classList.add('active');
    setTimeout(() => projTitle.focus(), 100);
}

function closeProjectModal() {
    projectModal.classList.remove('active');
    projectMode = null;
}

function updateCreateFileRow() {
    projCreateFileRow.hidden = !(menuAdmin() && projLink.value.trim().startsWith('projects/'));
}
projLink.addEventListener('input', updateCreateFileRow);

createProjectBtn.addEventListener('click', () => {
    if (asTest()) return openProjectModal(menuCan('create') ? 'create' : 'request');   // только посмотреть форму
    if (isAdmin) return openProjectModal('create');
    if (!member?.nickname) {
        showToast('У аккаунта нет никнейма — обратитесь к Waltika');
        return;
    }
    if (can('create')) return openProjectModal('create');   // право «Создавать» — без заявки
    if (pendingRequests().length >= MAX_REQUESTS) {
        showToast(`Уже ${MAX_REQUESTS} заявки ждут одобрения. Дождитесь проверки`, 'warning');
        return;
    }
    openProjectModal('request');
});

// Загрузка картинки на GitHub → путь вида images/game-1700000000000.png
async function uploadImage(file, link) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) throw new Error('Картинка должна быть png, jpg, gif или webp');
    if (file.size > 5 * 1024 * 1024) throw new Error('Картинка больше 5 МБ');
    const base = (linkTag(link).replace(/\.html$/, '') || 'project').replace(/[^\w-]/g, '') || 'project';
    const path = `images/${base}-${Date.now()}.${ext}`;
    await gh.createFile(path, await gh.fileToBase64(file), `Картинка для проекта ${base}`);
    return path;
}

projectForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!projectMode || testBlocked()) return;
    const { mode, project } = projectMode;

    const title = projTitle.value.trim();
    let link = projLink.value.trim();
    if (link === 'projects/') link = '';
    if (link && !safeLink(link)) {
        showToast('Ссылка должна начинаться с projects/ или https://');
        return;
    }

    projectSubmit.disabled = true;
    const submitText = projectSubmit.textContent;
    projectSubmit.textContent = 'Сохраняем...';
    try {
        // Пользователь с правом «Создавать проекты»: сразу виден всем, без картинки и файлов на GitHub
        if (!isAdmin && mode === 'create') {
            await setDoc(doc(projectsCol), {
                title, link, tag: '', image: '',
                author: member.nickname,
                ownerUid: currentUser.uid,
                approved: true, eternal: false, visible: true, status: 'ok',
                order: Date.now(),
                createdAt: serverTimestamp()
            });
            closeProjectModal();
            showToast('Проект создан и уже виден всем!', 'success');
            return;
        }

        // Заявка пользователя: только название и ссылка, в свободный «слот»
        if (!isAdmin) {
            const used = new Set(pendingRequests().map(([id]) => id));
            const slot = [1, 2, 3].map(n => `${currentUser.uid}_${n}`).find(id => !used.has(id));
            if (!slot) throw new Error('Свободных заявок нет');
            await setDoc(doc(db, 'projects', slot), {
                title, link, tag: '', image: '',
                author: member.nickname,
                ownerUid: currentUser.uid,
                approved: false, eternal: false, visible: true, status: 'ok',
                order: Date.now(),
                createdAt: serverTimestamp()
            });
            closeProjectModal();
            showToast('Заявка отправлена! Её увидит Waltika', 'success');
            return;
        }

        // Владелец: при необходимости создаём файл и загружаем картинку на GitHub
        if (link.startsWith('projects/') && projCreateFile.checked) {
            if (!link.endsWith('.html')) throw new Error('Для заготовки укажите файл .html, например projects/game.html');
            projectSubmit.textContent = 'Создаём файл на GitHub...';
            if (!(await gh.fileExists(link))) {
                await gh.createFile(link, gh.textToBase64(gh.projectTemplate(title, link)), `Новый проект: ${title}`);
            }
        }

        let image = project?.image || '';
        if (projImage.files[0]) {
            projectSubmit.textContent = 'Загружаем картинку...';
            image = await uploadImage(projImage.files[0], link);
        }

        const fields = { title, link, image, author: projAuthor.value.trim() || ADMIN_NAME };

        if (mode === 'edit') {
            await setDoc(doc(db, 'projects', project.id), { ...fields, updatedAt: serverTimestamp() }, { merge: true });
            showToast('Проект сохранён', 'success');
        } else {
            // Новый проект сразу скрыт — покажете, когда допишете код
            await setDoc(doc(projectsCol), {
                ...fields, tag: '',
                ownerUid: ADMIN_UID,
                approved: true, eternal: false, visible: false, status: 'ok',
                order: Date.now(),
                createdAt: serverTimestamp()
            });
            showToast('Проект создан и пока скрыт. GitHub обновит сайт примерно через минуту', 'success');
        }
        closeProjectModal();
    } catch (err) {
        console.error(err);
        showToast(err.code === 'permission-denied' ? 'Нет прав на это действие' : (err.message || 'Не удалось сохранить'));
    } finally {
        projectSubmit.disabled = false;
        projectSubmit.textContent = submitText;
    }
});

$('closeProjectBtn').addEventListener('click', closeProjectModal);
projectModal.addEventListener('click', (e) => {
    if (e.target === projectModal) closeProjectModal();
});

// ===== ТОКЕН GITHUB =====
tokenBtn.addEventListener('click', () => {
    tokenInput.value = '';
    tokenModal.classList.add('active');
    setTimeout(() => tokenInput.focus(), 100);
});

tokenForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = tokenInput.value.trim();
    if (!token) return;
    tokenSubmit.disabled = true;
    tokenSubmit.textContent = 'Проверяем...';
    try {
        if (!(await gh.checkToken(token))) {
            showToast('Токен не подошёл: нет доступа на запись к репозиторию dahz');
            return;
        }
        gh.setToken(token);
        tokenModal.classList.remove('active');
        showToast('Токен сохранён в этом браузере', 'success');
        renderAccountMenu();
    } catch {
        showToast('Не удалось проверить токен — нет интернета?');
    } finally {
        tokenSubmit.disabled = false;
        tokenSubmit.textContent = 'Сохранить';
        tokenInput.value = '';
    }
});

$('tokenRemoveBtn').addEventListener('click', () => {
    gh.setToken('');
    tokenModal.classList.remove('active');
    showToast('Токен удалён из этого браузера', 'info');
    renderAccountMenu();
});

$('closeTokenBtn').addEventListener('click', () => tokenModal.classList.remove('active'));
tokenModal.addEventListener('click', (e) => {
    if (e.target === tokenModal) tokenModal.classList.remove('active');
});

// ===== ПОЛЬЗОВАТЕЛИ И ПРАВА =====
// Владелец — всё. Доступ «смотреть логины» — ники и email.
// «Смотреть и менять» — ещё смена ника и письмо для сброса пароля.
let unsubMembers = null;

const accountLevelOf = (u) => levelOf(u.perms?.accounts);

// Всегда записываем все права целиком — так проще проверять в правилах
function savePerms(u, changes) {
    const next = {};
    for (const k of Object.keys(PERMS)) next[k] = u.perms?.[k] === true;
    next.accounts = accountLevelOf(u);
    Object.assign(next, changes);
    return run(() => setDoc(doc(db, 'members', u.id), { perms: next }, { merge: true }),
        `${u.nickname}: права обновлены`);
}

// Галочки прав и выбор доступа к аккаунтам. onChange({ ключ: значение }) сохраняет изменение
function permsEditor(perms, onChange) {
    const box = document.createElement('div');
    box.className = 'user-perms';
    Object.entries(PERMS).forEach(([key, label]) => {
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = perms?.[key] === true;
        check.addEventListener('change', () => onChange({ [key]: check.checked }));
        const lbl = document.createElement('label');
        lbl.className = 'check-row';
        lbl.append(check, label);
        box.appendChild(lbl);
    });

    // Доступ к аккаунтам других пользователей
    const select = document.createElement('select');
    select.className = 'perm-select';
    for (const [key, label] of Object.entries(ACCOUNT_LEVELS)) {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = label;
        select.appendChild(opt);
    }
    select.value = levelOf(perms?.accounts);
    select.addEventListener('change', () => onChange({ accounts: select.value }));
    const lbl = document.createElement('label');
    lbl.className = 'check-row';
    lbl.append('👤 Аккаунты:', select);
    box.appendChild(lbl);
    return box;
}

// Строка «Тестовый пользователь»: всегда первая, видит только владелец
function testUserRow() {
    const row = document.createElement('div');
    row.className = 'user-row is-test';

    const head = document.createElement('div');
    head.className = 'user-head';
    const name = document.createElement('div');
    name.className = 'user-name';
    name.textContent = `🧪 ${TEST_NAME}`;
    head.append(name, button('🔀 Переключиться', 'admin-btn', () => {
        closeUsers();
        setViewMode('test');
    }));

    const meta = document.createElement('div');
    meta.className = 'user-meta';
    meta.textContent = 'Пустышка, а не настоящий аккаунт. Отметь права и переключись на него, ' +
        'чтобы увидеть сайт его глазами. Права хранятся только в этом браузере.';

    row.append(head, meta, permsEditor(testPerms, saveTestPerms));
    return row;
}

// Ник меняется прямо в строке пользователя
function editNickname(u, nameEl) {
    const wrap = document.createElement('div');
    wrap.className = 'nick-edit';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'login-input';
    input.maxLength = 30;
    input.value = u.nickname || '';
    const save = () => {
        const nickname = input.value.trim();
        if (nickname.length < 2) {
            showToast('Никнейм — минимум 2 символа');
            return;
        }
        run(() => updateDoc(doc(db, 'members', u.id), { nickname }), 'Никнейм изменён');
    };
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') {
            e.stopPropagation();
            wrap.replaceWith(nameEl);
        }
    });
    wrap.append(input, button('💾', 'admin-btn', save), button('✖', 'admin-btn', () => wrap.replaceWith(nameEl)));
    nameEl.replaceWith(wrap);
    input.focus();
}

function resetPassword(u) {
    if (!u.email) {
        showToast('У этого пользователя не записан email');
        return;
    }
    openConfirm({
        title: 'Сбросить пароль?',
        text: `На ${u.email} придёт письмо со ссылкой, по которой ${u.nickname || 'пользователь'} сам задаст новый пароль. ` +
              'Пока он этого не сделает, старый пароль работает.',
        yesText: 'Отправить письмо',
        onYes: () => run(() => sendPasswordResetEmail(auth, u.email), 'Письмо для сброса пароля отправлено')
    });
}

function renderUsers(snap) {
    usersList.innerHTML = '';
    const level = menuAccounts();
    const admin = menuAdmin();
    const users = [];
    snap.forEach(d => users.push({ id: d.id, ...d.data() }));
    users.sort((a, b) => (a.nickname || '').localeCompare(b.nickname || '', 'ru'));

    if (admin) usersList.appendChild(testUserRow());

    if (users.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'form-hint';
        empty.textContent = 'Пока никто не зарегистрировался.';
        usersList.appendChild(empty);
        return;
    }

    users.forEach(u => {
        const row = document.createElement('div');
        row.className = 'user-row';

        const name = document.createElement('div');
        name.className = 'user-name';
        name.textContent = u.nickname || '(без никнейма)';

        const head = document.createElement('div');
        head.className = 'user-head';
        head.appendChild(name);

        // Удаление (только владелец): аккаунт больше не сможет войти, проекты пользователя остаются на сайте
        if (admin) {
            head.appendChild(button('🗑 Удалить', 'admin-btn danger', () => openConfirm({
                title: 'Удалить пользователя?',
                text: `Аккаунт «${u.nickname || u.email || u.id}» будет удалён: войти в него больше не получится. ` +
                      'Проекты, которые он уже создал, останутся на сайте. Отменить это действие нельзя.',
                yesText: 'Да, удалить',
                onYes: () => run(async () => {
                    const batch = writeBatch(db);
                    batch.set(doc(db, 'bans', u.id), {
                        email: u.email || '', nickname: u.nickname || '', deletedAt: serverTimestamp()
                    });
                    batch.delete(doc(db, 'members', u.id));
                    await batch.commit();
                }, `${u.nickname || 'Пользователь'} удалён`)
            })));
        }

        // Логин (email); код приглашения видит только владелец
        const meta = document.createElement('div');
        meta.className = 'user-meta';
        meta.textContent = admin ? `${u.email || ''} · код: ${u.code || '—'}` : (u.email || 'email не записан');
        row.append(head, meta);

        if (level === 'edit') {
            const actions = document.createElement('div');
            actions.className = 'user-actions';
            actions.append(
                button('✏️ Изменить ник', 'admin-btn', () => editNickname(u, name)),
                button('📧 Сбросить пароль', 'admin-btn', () => resetPassword(u))
            );
            row.appendChild(actions);
        }

        if (admin) row.appendChild(permsEditor(u.perms, (changes) => savePerms(u, changes)));

        usersList.appendChild(row);
    });
}

const USERS_HINTS = {
    admin: 'Отметь, что может делать каждый пользователь. Изменения сохраняются сразу. ' +
           'Пароли не видит никто, даже владелец: Firebase хранит их только в зашифрованном виде. ' +
           'Забыл пароль — отправь письмо для сброса.',
    view: 'Здесь видны ники и email (логины) пользователей. Пароли не видит никто — они хранятся в зашифрованном виде.',
    edit: 'Можно поменять ник и отправить письмо для сброса пароля. Пароли не видит никто — они хранятся в зашифрованном виде.'
};

usersBtn.addEventListener('click', () => {
    if (menuAccounts() === 'none') return;
    usersHint.textContent = USERS_HINTS[menuAdmin() ? 'admin' : menuAccounts()];
    usersModal.classList.add('active');
    unsubMembers?.();
    unsubMembers = onSnapshot(collection(db, 'members'), renderUsers, (err) => {
        console.error(err);
        usersList.textContent = 'Не удалось загрузить пользователей — проверь правила Firestore.';
    });
});

function closeUsers() {
    usersModal.classList.remove('active');
    unsubMembers?.();
    unsubMembers = null;
}

$('closeUsersBtn').addEventListener('click', closeUsers);
usersModal.addEventListener('click', (e) => {
    if (e.target === usersModal) closeUsers();
});

// ===== РЕЙТИНГ ПРОЕКТОВ (владелец и те, у кого право «Менять рейтинг») =====
// Порядок «от лучшего к худшему» сохраняется полем rank у каждого проекта
let rankIds = [];

function rankProjects() {
    return allProjects().filter(p => p.approved);
}

function renderRank() {
    const byId = Object.fromEntries(rankProjects().map(p => [p.id, p]));
    rankList.innerHTML = '';
    rankIds.forEach((id, i) => {
        const p = byId[id];
        if (!p) return;
        const row = document.createElement('div');
        row.className = 'rank-row';
        const place = document.createElement('span');
        place.className = 'rank-place';
        place.textContent = i + 1;
        const title = document.createElement('span');
        title.className = 'rank-title';
        title.textContent = p.title + (p.visible ? '' : ' (скрыт)');
        const up = button('↑', 'admin-btn', () => moveRank(i, -1));
        const down = button('↓', 'admin-btn', () => moveRank(i, 1));
        up.disabled = i === 0;
        down.disabled = i === rankIds.length - 1;
        up.setAttribute('aria-label', `Поднять «${p.title}»`);
        down.setAttribute('aria-label', `Опустить «${p.title}»`);
        row.append(place, title, up, down);
        rankList.appendChild(row);
    });
}

function moveRank(i, step) {
    const j = i + step;
    if (j < 0 || j >= rankIds.length) return;
    [rankIds[i], rankIds[j]] = [rankIds[j], rankIds[i]];
    renderRank();
    // кнопка, которой двигали, остаётся под пальцем — фокус на ней же в новой строке
    rankList.children[j]?.querySelectorAll('.admin-btn')[step < 0 ? 0 : 1]?.focus();
}

rankBtn.addEventListener('click', () => {
    if (!menuCan('rank')) return;
    // начальный порядок — как в сортировке «Сначала лучшие»
    const keep = sortMode;
    sortMode = 'best';
    rankIds = rankProjects().map(p => p.id);
    sortMode = keep;
    renderRank();
    rankModal.classList.add('active');
});

rankSaveBtn.addEventListener('click', async () => {
    rankSaveBtn.disabled = true;
    await run(async () => {
        const batch = writeBatch(db);
        rankIds.forEach((id, i) => batch.set(doc(db, 'projects', id), { rank: i + 1 }, { merge: true }));
        await batch.commit();
        rankModal.classList.remove('active');
    }, 'Рейтинг сохранён');
    rankSaveBtn.disabled = false;
});

$('closeRankBtn').addEventListener('click', () => rankModal.classList.remove('active'));
rankModal.addEventListener('click', (e) => {
    if (e.target === rankModal) rankModal.classList.remove('active');
});

// ===== КОДЫ ПРИГЛАШЕНИЯ (только владелец) =====
// Список кодов и кто по какому зарегистрировался (у пользователя в members записан его код)
let unsubInvites = null;
let unsubInviteMembers = null;
let invites = null;          // [{ id, limit, used, note, createdAt }]
let inviteMembers = null;    // [{ nickname, code }]
let invitesFixed = false;    // старые коды (из консоли) дополнены счётчиком один раз

const INVITE_RE = /^[A-Za-z0-9_-]{3,40}$/;

function randomCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return [...bytes].map(b => INVITE_CHARS[b % INVITE_CHARS.length]).join('');
}

// У кода из консоли может не быть limit — тогда он одноразовый (так же считают правила)
const inviteLimitOf = (inv) => (Number.isInteger(inv.limit) ? inv.limit : 1);
const inviteUsedOf = (inv) => (Number.isInteger(inv.used) ? inv.used : 0);

function inviteUsage(inv) {
    const used = inviteUsedOf(inv), lim = inviteLimitOf(inv);
    if (lim === 0) return `Использован: ${used} · без ограничений`;
    return `Использован: ${used} из ${lim}`;
}

// Старые коды без счётчика: used = сколько пользователей уже с этим кодом, limit — не меньше 1
function fixOldInvites() {
    if (invitesFixed || !invites || !inviteMembers) return;
    invitesFixed = true;
    const old = invites.filter(inv => !Number.isInteger(inv.used) || !Number.isInteger(inv.limit));
    if (!old.length) return;
    const batch = writeBatch(db);
    for (const inv of old) {
        const count = inviteMembers.filter(m => m.code === inv.id).length;
        batch.update(doc(db, 'invites', inv.id), {
            used: Number.isInteger(inv.used) ? inv.used : count,
            limit: Number.isInteger(inv.limit) ? inv.limit : Math.max(1, count)
        });
    }
    batch.commit().catch(err => console.warn('Старые коды не дополнены:', err.code || err.message));
}

function renderInvites() {
    if (!invites || !inviteMembers) return;
    fixOldInvites();
    invitesList.innerHTML = '';
    if (!invites.length) {
        const empty = document.createElement('p');
        empty.className = 'form-hint';
        empty.textContent = 'Кодов пока нет. Создай первый выше.';
        invitesList.appendChild(empty);
        return;
    }

    const time = (inv) => inv.createdAt?.toMillis?.() || 0;
    [...invites].sort((a, b) => time(b) - time(a)).forEach(inv => {
        const lim = inviteLimitOf(inv);
        const full = lim > 0 && inviteUsedOf(inv) >= lim;
        const row = document.createElement('div');
        row.className = 'invite-row' + (full ? ' is-full' : '');

        // Код, «копировать» и состояние
        const head = document.createElement('div');
        head.className = 'invite-head';
        const code = document.createElement('code');
        code.className = 'invite-code';
        code.textContent = inv.id;
        const badge = document.createElement('span');
        badge.className = 'invite-badge';
        badge.textContent = full ? 'закончился' : 'действует';
        head.append(code, button('📋', 'admin-btn', () => copyInvite(inv.id)), badge);

        const meta = document.createElement('div');
        meta.className = 'user-meta';
        meta.textContent = inviteUsage(inv) + (inv.note ? ` · ${inv.note}` : '');

        // Кто зарегистрировался по этому коду (удалённые пользователи сюда не попадают, но в счётчике остаются)
        const who = inviteMembers.filter(m => m.code === inv.id);
        const users = document.createElement('div');
        users.className = 'visit-pages';
        for (const m of who) {
            const chip = document.createElement('span');
            chip.className = 'visit-page';
            chip.textContent = '👤 ' + (m.nickname || 'без ника');
            users.appendChild(chip);
        }

        // Лимит и удаление
        const tools = document.createElement('div');
        tools.className = 'invite-tools';
        const limitInput = document.createElement('input');
        limitInput.type = 'number';
        limitInput.min = 0;
        limitInput.max = INVITE_LIMIT_MAX;
        limitInput.value = lim;
        limitInput.className = 'login-input invite-limit';
        limitInput.setAttribute('aria-label', `Лимит кода ${inv.id}`);
        const saveLimit = () => {
            const value = clampLimit(limitInput.value);
            if (value === lim) return;
            run(() => updateDoc(doc(db, 'invites', inv.id), { limit: value }), `Лимит кода ${inv.id}: ${value || 'без ограничений'}`);
        };
        limitInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveLimit(); });
        const limitLabel = document.createElement('label');
        limitLabel.className = 'check-row';
        limitLabel.append('Лимит:', limitInput);
        tools.append(
            limitLabel,
            button('💾', 'admin-btn', saveLimit),
            button('🗑 Удалить', 'admin-btn danger', () => openConfirm({
                title: 'Удалить код?',
                text: `По коду «${inv.id}» больше нельзя будет зарегистрироваться. Аккаунты, которые уже созданы по нему, останутся.`,
                yesText: 'Да, удалить',
                onYes: () => run(() => deleteDoc(doc(db, 'invites', inv.id)), 'Код удалён')
            }))
        );

        row.append(head, meta);
        if (who.length) row.appendChild(users);
        row.appendChild(tools);
        invitesList.appendChild(row);
    });
}

// 0 — без ограничений; пустое или неверное — 1
function clampLimit(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || value === '') return 1;
    return Math.min(INVITE_LIMIT_MAX, Math.max(0, n));
}

async function copyInvite(code) {
    try {
        await navigator.clipboard.writeText(code);
        showToast(`Код ${code} скопирован`, 'success');
    } catch {
        showToast(`Не удалось скопировать. Код: ${code}`, 'warning');
    }
}

invitesBtn.addEventListener('click', () => {
    if (!menuAdmin()) return;
    inviteCode.value = randomCode();
    inviteLimit.value = 1;
    inviteNote.value = '';
    invites = null;
    inviteMembers = null;
    invitesList.innerHTML = '<p class="form-hint">Загрузка...</p>';
    invitesModal.classList.add('active');

    const fail = (err) => {
        console.error(err);
        invitesList.innerHTML = '<p class="form-hint">Не удалось загрузить коды — проверь правила Firestore.</p>';
    };
    unsubInvites?.();
    unsubInviteMembers?.();
    unsubInvites = onSnapshot(invitesCol, (snap) => {
        invites = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderInvites();
    }, fail);
    unsubInviteMembers = onSnapshot(collection(db, 'members'), (snap) => {
        inviteMembers = snap.docs.map(d => ({ nickname: d.data().nickname, code: d.data().code }));
        renderInvites();
    }, fail);
});

$('inviteRandomBtn').addEventListener('click', () => {
    inviteCode.value = randomCode();
    inviteCode.focus();
});

inviteForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = inviteCode.value.trim();
    if (!INVITE_RE.test(code)) {
        showToast('Код — от 3 до 40 символов: латинские буквы, цифры, «-» и «_»');
        return;
    }
    const lim = clampLimit(inviteLimit.value);
    run(async () => {
        const ref = doc(db, 'invites', code);
        if ((await getDoc(ref)).exists()) throw new Error(`Код ${code} уже есть`);
        await setDoc(ref, { limit: lim, used: 0, note: inviteNote.value.trim().slice(0, 60), createdAt: serverTimestamp() });
        inviteCode.value = randomCode();
        inviteNote.value = '';
        copyInvite(code);
    });
});

function closeInvites() {
    invitesModal.classList.remove('active');
    unsubInvites?.();
    unsubInviteMembers?.();
    unsubInvites = unsubInviteMembers = null;
}

$('closeInvitesBtn').addEventListener('click', closeInvites);
invitesModal.addEventListener('click', (e) => {
    if (e.target === invitesModal) closeInvites();
});

// ===== СВОЙ ПАРОЛЬ И EMAIL =====
// Firebase просит заново ввести текущий пароль — так никто не сменит пароль на чужом открытом компьютере
function showSecurityMode(mode) {
    const isEmail = mode === 'email';
    passwordForm.hidden = isEmail;
    emailForm.hidden = !isEmail;
    $('secPasswordTab').classList.toggle('active', !isEmail);
    $('secEmailTab').classList.toggle('active', isEmail);
    $('securityTitle').textContent = isEmail ? 'Сменить email' : 'Сменить пароль';
    setTimeout(() => (isEmail ? $('emCurrent') : $('pwCurrent')).focus(), 100);
}

function closeSecurity() {
    securityModal.classList.remove('active');
    passwordForm.reset();
    emailForm.reset();
}

$('securityBtn').addEventListener('click', () => {
    if (!currentUser) return;
    showSecurityMode('password');
    securityModal.classList.add('active');
});
$('secPasswordTab').addEventListener('click', () => showSecurityMode('password'));
$('secEmailTab').addEventListener('click', () => showSecurityMode('email'));

function reauth(password) {
    return reauthenticateWithCredential(currentUser, EmailAuthProvider.credential(currentUser.email, password));
}

// Общая обёртка для двух форм: блокирует кнопку и переводит ошибки
async function securitySubmit(submitBtn, busyText, action) {
    const text = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = busyText;
    try {
        await action();
    } catch (err) {
        console.error(err);
        const wrong = ['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'];
        showToast(wrong.includes(err.code) ? 'Неверный текущий пароль' : authErrorText(err.code));
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = text;
    }
}

passwordForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if ($('pwNew').value !== $('pwNew2').value) {
        showToast('Новые пароли не совпадают');
        return;
    }
    securitySubmit($('passwordSubmit'), 'Меняем...', async () => {
        await reauth($('pwCurrent').value);
        await updatePassword(currentUser, $('pwNew').value);
        closeSecurity();
        showToast('Пароль изменён', 'success');
    });
});

emailForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('emNew').value.trim();
    securitySubmit($('emailSubmit'), 'Отправляем...', async () => {
        await reauth($('emCurrent').value);
        await verifyBeforeUpdateEmail(currentUser, email);
        closeSecurity();
        showToast('Письмо отправлено на новый email. Откройте ссылку из него', 'success');
    });
});

$('closeSecurityBtn').addEventListener('click', closeSecurity);
securityModal.addEventListener('click', (e) => {
    if (e.target === securityModal) closeSecurity();
});

// ===== СОРТИРОВКА =====
function renderSortMenu() {
    sortOptions.innerHTML = '';
    for (const [key, s] of Object.entries(SORTS)) {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'sort-option' + (key === sortMode ? ' active' : '');
        opt.setAttribute('role', 'menuitemradio');
        opt.setAttribute('aria-checked', String(key === sortMode));
        const img = document.createElement('img');
        img.src = s.icon;
        img.alt = '';
        img.className = 'sort-icon' + (s.mirror ? ' is-mirror' : '') + (s.dim ? ' is-dim' : '');
        const label = document.createElement('span');
        label.textContent = s.label;
        const check = document.createElement('span');
        check.className = 'sort-check';
        check.textContent = key === sortMode ? '✓' : '';
        opt.append(img, label, check);
        opt.addEventListener('click', () => setSort(key));
        sortOptions.appendChild(opt);
    }
}

function setSort(key) {
    sortMode = key;
    const s = SORTS[key];
    sortIcon.className = 'sort-icon' + (s.mirror ? ' is-mirror' : '') + (s.dim ? ' is-dim' : '');
    sortIcon.src = s.icon;
    sortBtn.title = s.label;
    closeSortMenu();
    render();
}

function openSortMenu() {
    renderSortMenu();
    sortMenu.hidden = false;
    // меню — под кнопкой, но не вылезает за левый край строки
    const left = sortBtn.offsetLeft + sortBtn.offsetWidth - sortMenu.offsetWidth;
    sortMenu.style.left = `${Math.max(0, left)}px`;
    sortBtn.setAttribute('aria-expanded', 'true');
    sortOptions.querySelector('.active')?.focus();
}

function closeSortMenu() {
    if (sortMenu.hidden) return;
    sortMenu.hidden = true;
    sortBtn.setAttribute('aria-expanded', 'false');
}

sortBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (sortMenu.hidden) openSortMenu();
    else closeSortMenu();
});

// Клик мимо меню закрывает его
document.addEventListener('click', (e) => {
    if (!sortMenu.hidden && !sortMenu.contains(e.target)) closeSortMenu();
});

// Стрелки вверх/вниз ходят по пунктам
sortMenu.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...sortOptions.children];
    const i = items.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next].focus();
});

sortBtn.title = SORTS[sortMode].label;

// ===== СТАТИСТИКА ПОСЕЩЕНИЙ: ЗАПИСЬ =====
// Один заход = одна запись в visits. ID устройства хранится в localStorage,
// ID захода — в sessionStorage (живёт, пока открыта вкладка).

function storageGet(store, key) {
    try { return store.getItem(key); } catch { return null; }
}

function storageSet(store, key, value) {
    try { store.setItem(key, value); } catch { /* приватный режим — ничего страшного */ }
}

const randomId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function deviceId() {
    let id = storageGet(localStorage, 'dahz_device');
    if (!id) {
        id = 'd_' + randomId();
        storageSet(localStorage, 'dahz_device', id);
    }
    return id;
}

// Браузер, система и тип устройства — по строке, которую браузер сообщает о себе
function describeDevice() {
    const ua = navigator.userAgent;
    const ver = (re) => (ua.match(re) || [])[1] || '';

    let browser = 'Другой браузер';
    if (/YaBrowser\//.test(ua)) browser = 'Яндекс Браузер ' + ver(/YaBrowser\/(\d+)/);
    else if (/OPR\/|Opera/.test(ua)) browser = 'Opera ' + ver(/OPR\/(\d+)/);
    else if (/Edg\//.test(ua)) browser = 'Edge ' + ver(/Edg\/(\d+)/);
    else if (/Firefox\//.test(ua)) browser = 'Firefox ' + ver(/Firefox\/(\d+)/);
    else if (/SamsungBrowser\//.test(ua)) browser = 'Samsung Internet ' + ver(/SamsungBrowser\/(\d+)/);
    else if (/Chrome\//.test(ua)) browser = 'Chrome ' + ver(/Chrome\/(\d+)/);
    else if (/Safari\//.test(ua)) browser = 'Safari ' + ver(/Version\/(\d+)/);

    const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    let os = 'Другая система';
    if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
    else if (/Windows/.test(ua)) os = 'Windows';
    else if (/Android/.test(ua)) os = 'Android ' + ver(/Android (\d+)/);
    else if (/iPhone/.test(ua)) os = 'iOS ' + ver(/OS (\d+)_/);
    else if (/iPad/.test(ua) || iPadOS) os = 'iPadOS';
    else if (/Mac OS X/.test(ua)) os = 'macOS';
    else if (/CrOS/.test(ua)) os = 'ChromeOS';
    else if (/Linux/.test(ua)) os = 'Linux';

    let type = 'Компьютер';
    if (/iPad|Tablet/.test(ua) || iPadOS || (/Android/.test(ua) && !/Mobile/.test(ua))) type = 'Планшет';
    else if (/Mobi|iPhone|Android/.test(ua)) type = 'Телефон';

    return {
        browser: browser.trim(),
        os: os.trim(),
        type,
        screen: `${screen.width}×${screen.height}`,
        lang: navigator.language || ''
    };
}

let visitId = storageGet(sessionStorage, 'dahz_visit');
let visitReady = null;            // промис: запись о заходе создана
let visitStarted = false;
let trackingOff = false;          // свои заходы владелец не записывает
let visitPages = Number(storageGet(sessionStorage, 'dahz_visit_pages') || 0);
let visitUserKey = '';            // кого уже записали в заход (uid|ник)

function createVisit(user) {
    visitId = 'v_' + randomId();
    storageSet(sessionStorage, 'dahz_visit', visitId);
    visitPages = 0;
    storageSet(sessionStorage, 'dahz_visit_pages', '0');
    return setDoc(doc(db, 'visits', visitId), {
        ...describeDevice(),
        device: deviceId(),
        uid: user ? user.uid : null,
        nick: null,
        startedAt: serverTimestamp(),
        lastAt: serverTimestamp(),
        pages: []
    });
}

// Вызывается при первом определении аккаунта (вошёл / гость)
function startVisit(user) {
    if (visitStarted) return;
    visitStarted = true;
    if (isAdmin) {
        trackingOff = true;
        // в этой вкладке владелец сначала был гостем — убираем ту запись
        if (visitId) deleteDoc(doc(db, 'visits', visitId)).catch(() => {});
        return;
    }
    visitReady = (visitId
        ? updateDoc(doc(db, 'visits', visitId), { lastAt: serverTimestamp() })
        : Promise.reject(new Error('new'))
    ).catch(() => createVisit(user)).catch((err) => {
        trackingOff = true;   // нет прав / нет интернета — просто не пишем статистику
        console.warn('Статистика не записана:', err.code || err.message);
    });
}

// Вошёл в аккаунт посреди захода — дописываем, кто это
function updateVisitUser() {
    if (trackingOff || !visitReady || !currentUser) return;
    const nick = member?.nickname || null;
    const key = currentUser.uid + '|' + nick;
    if (key === visitUserKey) return;
    visitUserKey = key;
    visitReady.then(() => updateDoc(doc(db, 'visits', visitId), {
        uid: currentUser.uid, nick, lastAt: serverTimestamp()
    })).catch(() => {});
}

// Владелец вошёл посреди захода — убираем этот заход из статистики
function dropOwnVisit() {
    trackingOff = true;
    if (visitId && visitReady) {
        visitReady.then(() => deleteDoc(doc(db, 'visits', visitId))).catch(() => {});
    }
}

function logProjectView(p) {
    if (trackingOff || !visitReady || visitPages >= VISIT_PAGES_MAX) return Promise.resolve();
    visitPages++;
    storageSet(sessionStorage, 'dahz_visit_pages', String(visitPages));
    const write = visitReady
        .then(() => updateDoc(doc(db, 'visits', visitId), {
            pages: arrayUnion({ id: p.id, title: String(p.title || p.id).slice(0, 80), at: Date.now() }),
            lastAt: serverTimestamp()
        }))
        .catch((err) => console.warn('Не удалось записать просмотр:', err.code || err.message));
    return Promise.race([write, new Promise((r) => setTimeout(r, 800))]);
}

// ===== СТАТИСТИКА ПОСЕЩЕНИЙ: ОКНО «ПОСЛЕДНЯЯ АКТИВНОСТЬ» =====
let visits = [];             // загруженные заходы
let lastVisitSnap = null;    // для «Показать ещё»

const TYPE_ICONS = { 'Компьютер': '💻', 'Телефон': '📱', 'Планшет': '📟' };

function tsToDate(ts) {
    return ts?.toDate ? ts.toDate() : (typeof ts === 'number' ? new Date(ts) : null);
}

function fmtTime(date, withDate = true) {
    if (!date) return '—';
    const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (!withDate) return time;
    const today = new Date();
    const yesterday = new Date(Date.now() - 864e5);
    if (date.toDateString() === today.toDateString()) return `сегодня, ${time}`;
    if (date.toDateString() === yesterday.toDateString()) return `вчера, ${time}`;
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + `, ${time}`;
}

function visitName(v) {
    if (v.nick) return v.nick;
    if (v.uid) return 'Пользователь без ника';
    return 'Гость #' + String(v.device || '').slice(-4);
}

function visitText(v) {
    return [visitName(v), v.browser, v.os, v.type, v.screen, v.lang, ...(v.pages || []).map((p) => p.title)]
        .join(' ').toLowerCase();
}

function renderActivity() {
    const filter = activitySearch.value.trim().toLowerCase();
    const shown = filter ? visits.filter((v) => visitText(v).includes(filter)) : visits;

    // Сводка по загруженным заходам
    const devices = new Set(visits.map((v) => v.device));
    const members = new Set(visits.filter((v) => v.uid).map((v) => v.uid));
    const views = {};
    visits.forEach((v) => (v.pages || []).forEach((p) => { views[p.title] = (views[p.title] || 0) + 1; }));
    const top = Object.entries(views).sort((a, b) => b[1] - a[1])[0];
    activityStats.innerHTML = '';
    [
        `👣 Заходов: ${visits.length}`,
        `🖥 Устройств: ${devices.size}`,
        `👤 С аккаунтом: ${members.size}`,
        top ? `🏆 Популярное: ${top[0]} (${top[1]})` : '🏆 Проекты ещё не открывали'
    ].forEach((text) => {
        const s = document.createElement('span');
        s.className = 'activity-stat';
        s.textContent = text;
        activityStats.appendChild(s);
    });

    activityList.innerHTML = '';
    if (!shown.length) {
        const empty = document.createElement('p');
        empty.className = 'form-hint';
        empty.textContent = visits.length ? 'Ничего не найдено по фильтру.' : 'Пока никто не заходил.';
        activityList.appendChild(empty);
        return;
    }

    shown.forEach((v) => {
        const row = document.createElement('div');
        row.className = 'visit-row' + (v.uid ? ' is-member' : '');

        const head = document.createElement('div');
        head.className = 'visit-head';
        const who = document.createElement('span');
        who.textContent = (v.uid ? '👤 ' : '👻 ') + visitName(v);
        const time = document.createElement('span');
        time.className = 'visit-time';
        const start = tsToDate(v.startedAt);
        const last = tsToDate(v.lastAt);
        time.textContent = start && last && last - start > 60000
            ? `${fmtTime(start)} → ${fmtTime(last, false)}`
            : fmtTime(start || last);
        head.append(who, time);

        const device = document.createElement('div');
        device.className = 'visit-device';
        device.textContent = [
            `${TYPE_ICONS[v.type] || '🖥'} ${v.type || '?'}`, v.browser, v.os, v.screen, v.lang
        ].filter(Boolean).join(' · ');

        row.append(head, device);

        if ((v.pages || []).length) {
            const pages = document.createElement('div');
            pages.className = 'visit-pages';
            v.pages.forEach((p) => {
                const chip = document.createElement('span');
                chip.className = 'visit-page';
                chip.textContent = p.title + ' ';
                const at = document.createElement('small');
                at.textContent = fmtTime(tsToDate(p.at), false);
                chip.appendChild(at);
                pages.appendChild(chip);
            });
            row.appendChild(pages);
        } else {
            const none = document.createElement('div');
            none.className = 'visit-device';
            none.textContent = 'Проекты не открывал';
            row.appendChild(none);
        }

        activityList.appendChild(row);
    });
}

async function loadVisits(more = false) {
    const parts = [orderBy('lastAt', 'desc')];
    if (more && lastVisitSnap) parts.push(startAfter(lastVisitSnap));
    parts.push(limit(VISITS_PAGE));
    try {
        const snap = await getDocs(query(visitsCol, ...parts));
        const loaded = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        visits = more ? visits.concat(loaded) : loaded;
        lastVisitSnap = snap.docs[snap.docs.length - 1] || lastVisitSnap;
        activityMoreBtn.hidden = snap.docs.length < VISITS_PAGE;
        renderActivity();
    } catch (err) {
        console.error(err);
        activityList.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'form-hint';
        p.textContent = 'Не удалось загрузить активность — проверь правила Firestore.';
        activityList.appendChild(p);
    }
}

// Раз в день владелец удаляет заходы старше VISITS_KEEP_DAYS дней
async function cleanupOldVisits() {
    if (!isAdmin || asTest()) return;
    const today = new Date().toDateString();
    if (storageGet(localStorage, 'dahz_visits_cleanup') === today) return;
    try {
        const cutoff = Timestamp.fromMillis(Date.now() - VISITS_KEEP_DAYS * 864e5);
        const snap = await getDocs(query(visitsCol, where('lastAt', '<', cutoff), limit(300)));
        if (!snap.empty) {
            const batch = writeBatch(db);
            snap.forEach((d) => batch.delete(d.ref));
            await batch.commit();
        }
        storageSet(localStorage, 'dahz_visits_cleanup', today);
    } catch (err) {
        console.warn('Не удалось почистить старую статистику:', err.code || err.message);
    }
}

// Экспорт в CSV (открывается в Excel): разделитель «;», в начале BOM — чтобы русские буквы читались
function exportVisits() {
    if (!visits.length) {
        showToast('Нечего экспортировать', 'warning');
        return;
    }
    const cell = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const dt = (d) => d ? d.toLocaleString('ru-RU') : '';
    const header = ['Начало', 'Последняя активность', 'Кто', 'Аккаунт (uid)', 'Тип', 'Браузер', 'Система',
        'Экран', 'Язык', 'ID устройства', 'Проекты'];
    const rows = visits.map((v) => [
        dt(tsToDate(v.startedAt)), dt(tsToDate(v.lastAt)), visitName(v), v.uid || '', v.type, v.browser, v.os,
        v.screen, v.lang, v.device,
        (v.pages || []).map((p) => `${p.title} (${fmtTime(tsToDate(p.at), false)})`).join(', ')
    ]);
    const csv = '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `dahz-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    showToast(`Сохранено заходов: ${visits.length}`, 'success');
}

activityBtn.addEventListener('click', async () => {
    if (!menuCan('activity')) return;
    activityModal.classList.add('active');
    activitySearch.value = '';
    activityList.innerHTML = '<p class="form-hint">Загрузка...</p>';
    await cleanupOldVisits();
    loadVisits();
});

$('activityRefreshBtn').addEventListener('click', () => loadVisits());
$('activityExportBtn').addEventListener('click', exportVisits);
activityMoreBtn.addEventListener('click', () => loadVisits(true));
activitySearch.addEventListener('input', renderActivity);

function closeActivity() {
    activityModal.classList.remove('active');
}

$('closeActivityBtn').addEventListener('click', closeActivity);
activityModal.addEventListener('click', (e) => {
    if (e.target === activityModal) closeActivity();
});

// ===== ОКНО ПОДТВЕРЖДЕНИЯ =====
let confirmAction = null;

function openConfirm({ title, text, yesText, onYes }) {
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('confirmYesBtn').textContent = yesText;
    confirmAction = onYes;
    confirmModal.classList.add('active');
}

function closeConfirm() {
    confirmAction = null;
    confirmModal.classList.remove('active');
}

$('confirmYesBtn').addEventListener('click', () => {
    const action = confirmAction;
    closeConfirm();
    if (action) action();
});
$('confirmNoBtn').addEventListener('click', closeConfirm);
$('closeConfirmBtn').addEventListener('click', closeConfirm);
confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) closeConfirm();
});

// ===== ЗАГРУЗКА ПРОЕКТОВ (обновляется сразу у всех посетителей) =====
// Пока проекты не загрузились, карточки спрятаны (класс на body),
// чтобы скрытый проект не мелькал на экране
function reveal() {
    document.body.classList.remove('projects-loading');
}

function snapToMap(snap) {
    const map = {};
    snap.forEach(d => { map[d.id] = d.data(); });
    return map;
}

onSnapshot(query(projectsCol, where('approved', '==', true)), (snap) => {
    approvedDocs = snapToMap(snap);
    render();
    reveal();
}, (err) => {
    console.warn('Не удалось загрузить проекты:', err);
    reveal();
});

render();
setTimeout(reveal, 3000);  // на случай медленного интернета

// ===== ВХОД / ВЫХОД =====
// Данные пользователя (ник и права) слушаем постоянно:
// выдал владелец право — кнопки появляются сразу, без перезахода
function watchMember() {
    unsubMember?.();
    unsubMember = null;
    member = null;
    if (!currentUser || isAdmin) return;
    unsubMember = onSnapshot(doc(db, 'members', currentUser.uid), (snap) => {
        member = snap.exists() ? snap.data() : null;
        if (!can('activity')) closeActivity();   // право забрали — окно закрывается
        if (accountsAccess() === 'none') closeUsers();
        if (!can('rank')) rankModal.classList.remove('active');
        syncMemberEmail();
        updateVisitUser();
        render();
    }, () => {
        member = null;
        render();
    });
}

// Пользователь сменил email через письмо — обновляем его и в members, чтобы владелец видел новый логин
function syncMemberEmail() {
    if (!member || !currentUser?.email || member.email === currentUser.email) return;
    updateDoc(doc(db, 'members', currentUser.uid), { email: currentUser.email })
        .catch((err) => console.warn('Email в members не обновлён:', err.code || err.message));
}

// Владелец удалил аккаунт (bans/{uid}) — при входе аккаунт удаляет сам себя
async function removeIfBanned(user) {
    let banned = false;
    try {
        banned = (await getDoc(doc(db, 'bans', user.uid))).exists();
    } catch { /* нет доступа — считаем, что не удалён */ }
    if (!banned) return false;
    try {
        await deleteUser(user);
    } catch {
        await signOut(auth);   // давно входил — Firebase просит свежий вход; удалим при следующем
    }
    showToast('Этот аккаунт был удалён владельцем сайта');
    return true;
}

onAuthStateChanged(auth, async (user) => {
    if (user && user.uid !== ADMIN_UID && await removeIfBanned(user)) return;

    currentUser = user;
    isAdmin = !!user && user.uid === ADMIN_UID;
    if (!user) closeAccountMenu();

    // Статистика посещений
    if (!visitStarted) startVisit(user);
    else if (isAdmin) dropOwnVisit();
    else updateVisitUser();
    if (!user) visitUserKey = '';

    // Дополнительные проекты: владельцу — все, пользователю — его заявки
    unsubExtra?.();
    unsubExtra = null;
    extraDocs = {};
    if (isAdmin) {
        unsubExtra = onSnapshot(projectsCol, (snap) => {
            extraDocs = snapToMap(snap);
            render();
            seedBuiltins();
        }, (err) => console.warn(err));
    } else if (user) {
        unsubExtra = onSnapshot(query(projectsCol, where('ownerUid', '==', user.uid)), (snap) => {
            extraDocs = snapToMap(snap);
            render();
        }, (err) => console.warn(err));
    }

    if (accountsAccess() === 'none') closeUsers();
    if (!can('activity')) closeActivity();
    if (!can('rank')) rankModal.classList.remove('active');
    if (!isAdmin) closeInvites();
    if (!user) closeSecurity();
    watchMember();
    render();
});

// Переключение между «Вход» и «Регистрация» в одном окне
function showAuthMode(mode) {
    const isRegister = mode === 'register';
    loginForm.hidden = isRegister;
    registerForm.hidden = !isRegister;
    authTitle.textContent = isRegister ? 'Регистрация' : 'Вход';
    hideInfoTip();
    setTimeout(() => (isRegister ? regCode : loginEmail).focus(), 100);
}

function openLogin() {
    showAuthMode('login');
    loginModal.classList.add('active');
}

function closeLogin() {
    loginModal.classList.remove('active');
    hideInfoTip();
    // Пароли не оставляем в полях
    loginPassword.value = '';
    regPassword.value = '';
    regPassword2.value = '';
}

$('toRegisterBtn').addEventListener('click', () => showAuthMode('register'));
$('toLoginBtn').addEventListener('click', () => showAuthMode('login'));

// ===== ПОДСКАЗКА У КОДА ПРИГЛАШЕНИЯ (значок i) =====
let tipTimeout;

function hideInfoTip() {
    clearTimeout(tipTimeout);
    inviteInfoTip.classList.remove('show');
}

inviteInfoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (inviteInfoTip.classList.contains('show')) {
        hideInfoTip();
        return;
    }
    // Стрелка подсказки — под серединой значка i
    const arrowX = inviteInfoBtn.offsetLeft + inviteInfoBtn.offsetWidth / 2 - 7;
    inviteInfoTip.style.setProperty('--arrow-x', `${arrowX}px`);
    inviteInfoTip.classList.add('show');
    tipTimeout = setTimeout(hideInfoTip, 5000);
});

// Клик в любом другом месте прячет подсказку
document.addEventListener('click', (e) => {
    if (!inviteInfoTip.contains(e.target)) hideInfoTip();
});

// Вошёл — меню «Управление аккаунтом» (выход теперь там), не вошёл — окно входа
loginBtn.addEventListener('click', () => {
    if (auth.currentUser) openAccountMenu();
    else openLogin();
});

// Забыли пароль: Firebase присылает письмо со ссылкой, по которой задаётся новый пароль
auth.languageCode = 'ru';
$('forgotBtn').addEventListener('click', async () => {
    const email = loginEmail.value.trim();
    if (!email) {
        showToast('Сначала впишите свой email в поле выше', 'warning');
        loginEmail.focus();
        return;
    }
    try {
        await sendPasswordResetEmail(auth, email);
        showToast('Если такой аккаунт есть, на почту придёт письмо для нового пароля', 'success');
    } catch (err) {
        showToast(authErrorText(err.code));
    }
});

$('closeLoginBtn').addEventListener('click', closeLogin);
loginModal.addEventListener('click', (e) => {
    if (e.target === loginModal) closeLogin();
});

// Esc закрывает любое открытое окно
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (loginModal.classList.contains('active')) closeLogin();
    if (projectModal.classList.contains('active')) closeProjectModal();
    if (confirmModal.classList.contains('active')) closeConfirm();
    if (usersModal.classList.contains('active')) closeUsers();
    closeActivity();
    tokenModal.classList.remove('active');
    closeAccountMenu();
    rankModal.classList.remove('active');
    if (invitesModal.classList.contains('active')) closeInvites();
    if (securityModal.classList.contains('active')) closeSecurity();
    if (!sortMenu.hidden) {
        closeSortMenu();
        sortBtn.focus();
    }
});

function authErrorText(code) {
    switch (code) {
        case 'auth/invalid-email':          return 'Неправильный формат email';
        case 'auth/invalid-credential':
        case 'auth/wrong-password':
        case 'auth/user-not-found':         return 'Неверный email или пароль';
        case 'auth/too-many-requests':      return 'Слишком много попыток, попробуйте позже';
        case 'auth/network-request-failed': return 'Нет подключения к интернету';
        case 'auth/email-already-in-use':   return 'Этот email уже зарегистрирован';
        case 'auth/weak-password':          return 'Слишком простой пароль (минимум 6 символов)';
        case 'auth/operation-not-allowed':
        case 'auth/admin-restricted-operation': return REGISTRATION_CLOSED;
        default:                            return 'Не удалось войти';
    }
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginSubmit.disabled = true;
    loginSubmit.textContent = 'Входим...';
    try {
        await signInWithEmailAndPassword(auth, loginEmail.value.trim(), loginPassword.value);
        closeLogin();
        showToast('С возвращением!', 'success');
    } catch (err) {
        showToast(authErrorText(err.code));
    } finally {
        loginSubmit.disabled = false;
        loginSubmit.textContent = 'Войти';
    }
});

// ===== РЕГИСТРАЦИЯ ПО КОДУ ПРИГЛАШЕНИЯ =====
// 1) создаём аккаунт; 2) смотрим код: есть ли он и не закончился ли;
// 3) одной пачкой записываем members/{uid} и прибавляем 1 к счётчику кода.
// Правила Firestore пропустят пачку, только если код есть и лимит не исчерпан.
// Код не подошёл → сразу удаляем только что созданный аккаунт.
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = regCode.value.trim();
    const nickname = regNickname.value.trim();

    if (nickname.length < 2) {
        showToast('Никнейм — минимум 2 символа');
        return;
    }
    if (regPassword.value !== regPassword2.value) {
        showToast('Пароли не совпадают');
        return;
    }
    if (!INVITE_RE.test(code)) {
        showToast('Неверный код приглашения');
        return;
    }

    registerSubmit.disabled = true;
    registerSubmit.textContent = 'Создаём аккаунт...';
    let cred = null;
    let codeProblem = '';   // понятная причина, если код не подошёл
    try {
        cred = await createUserWithEmailAndPassword(auth, regEmail.value.trim(), regPassword.value);

        const inviteRef = doc(db, 'invites', code);
        const invite = await getDoc(inviteRef).catch(() => null);
        if (!invite?.exists()) {
            codeProblem = 'Неверный код приглашения';
            throw new Error(codeProblem);
        }
        const lim = inviteLimitOf(invite.data()), used = inviteUsedOf(invite.data());
        if (lim > 0 && used >= lim) {
            codeProblem = lim === 1
                ? 'Этот код приглашения уже был использован'
                : `По этому коду уже зарегистрировано ${used} из ${lim} аккаунтов`;
            throw new Error(codeProblem);
        }

        const batch = writeBatch(db);
        batch.set(doc(db, 'members', cred.user.uid), {
            email: cred.user.email,
            nickname,
            code,
            createdAt: serverTimestamp()
        });
        batch.update(inviteRef, { used: increment(1) });
        await batch.commit();
        // Ник подтянется сам: watchMember следит за members/{uid}
        closeLogin();
        showToast('Аккаунт создан!', 'success');
    } catch (err) {
        if (cred) {
            // Аккаунт создался, а код не подошёл — убираем аккаунт
            await deleteUser(cred.user).catch(() => signOut(auth));
            // отказ правил: скорее всего, кто-то только что занял последнее место по коду
            showToast(codeProblem || (err.code === 'permission-denied'
                ? 'Этот код приглашения уже был использован'
                : 'Не удалось завершить регистрацию'));
        } else {
            showToast(authErrorText(err.code));
        }
    } finally {
        registerSubmit.disabled = false;
        registerSubmit.textContent = 'Зарегистрироваться';
    }
});
