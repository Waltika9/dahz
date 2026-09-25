// ===== Firebase: аккаунты и проекты на главной =====
// Подключается в index.html как <script type="module"> ПОСЛЕ script.js,
// поэтому здесь доступна функция showToast из script.js.
//
// Все проекты хранятся в Firestore, в коллекции projects:
//   title, link, tag, image, author, ownerUid, approved, eternal, visible, status, order
// Что кому можно — решают правила Firestore (Firestore → Rules в консоли Firebase).

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
    getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
    deleteUser, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
    getFirestore, collection, doc, onSnapshot, setDoc, getDoc, deleteDoc,
    writeBatch, query, where, serverTimestamp
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
    }
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const projectsCol = collection(db, 'projects');

const $ = (id) => document.getElementById(id);

const projectCards = $('projectCards');
const accountBar = $('accountBar');
const createProjectBtn = $('createProjectBtn');
const tokenBtn = $('tokenBtn');

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
let member = null;       // данные из members/{uid}: { nickname, ... }
let unsubExtra = null;
let seeding = false;

// ===== ПОМОЩНИКИ =====

// Разрешаем только свои файлы и https-ссылки (защита от javascript: и т.п.)
function safeLink(link) {
    if (/^projects\/[\w./-]+$/.test(link) && !link.includes('..')) return link;
    if (/^https:\/\/[^\s"'<>]+$/.test(link)) return link;
    return '';
}

function safeImage(path) {
    return /^images\/[\w.-]+$/.test(path) ? path : '';
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

// Все проекты: встроенные + из базы, отсортированные по order
function allProjects() {
    const map = {};
    for (const [id, data] of Object.entries(BUILTIN_PROJECTS)) {
        map[id] = { ...PROJECT_DEFAULTS, ...data };
    }
    for (const [id, data] of Object.entries({ ...approvedDocs, ...extraDocs })) {
        map[id] = { ...PROJECT_DEFAULTS, ...map[id], ...data };
    }
    return Object.entries(map)
        .map(([id, p]) => ({ id, ...p }))
        .sort((a, b) => (a.order || 0) - (b.order || 0));
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

async function run(action, successText) {
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
    document.body.classList.toggle('is-admin', isAdmin);
    projectCards.innerHTML = '';

    allProjects().forEach(p => {
        const canSeePending = isAdmin || isOwner(p);
        if (!p.approved && !canSeePending) return;      // заявка — только автору и владельцу
        if (p.approved && !p.visible && !isAdmin) return; // скрытый — только владельцу
        projectCards.appendChild(buildCard(p));
    });

    renderAccountBar();
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

    // Панель управления
    let panel = null;
    if (isAdmin) panel = adminPanel(p);
    else if (isOwner(p) && !p.approved) panel = ownerPanel(p);
    if (panel) {
        // Карточка — это ссылка, поэтому клик по панели не должен открывать проект
        panel.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        card.appendChild(panel);
    }

    // Посетитель кликает по проекту со статусом — вместо перехода показываем плашку
    card.addEventListener('click', (e) => {
        if (isAdmin || p.status === 'ok') return;
        e.preventDefault();
        showToast((STATUSES[p.status] || STATUSES.dev).message, 'warning');
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

function renderAccountBar() {
    const show = isAdmin || !!member;
    accountBar.hidden = !show;
    tokenBtn.hidden = !isAdmin;
    if (!show) return;

    if (isAdmin) {
        createProjectBtn.textContent = '➕ Создать проект';
        tokenBtn.textContent = gh.getToken() ? '🔑 Токен GitHub ✓' : '🔑 Токен GitHub';
    } else {
        createProjectBtn.textContent = `➕ Предложить проект (${pendingRequests().length}/${MAX_REQUESTS})`;
    }
}

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
    projectModal.classList.toggle('member-form', !isAdmin);

    projectModalTitle.textContent =
        mode === 'edit' ? 'Изменить проект' : (isAdmin ? 'Новый проект' : 'Заявка на проект');
    projectSubmit.textContent = mode === 'edit' ? 'Сохранить' : (isAdmin ? 'Создать' : 'Отправить заявку');

    projTitle.value = project?.title || '';
    projLink.value = project?.link || (isAdmin && mode === 'create' ? 'projects/' : '');
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
    projCreateFileRow.hidden = !(isAdmin && projLink.value.trim().startsWith('projects/'));
}
projLink.addEventListener('input', updateCreateFileRow);

createProjectBtn.addEventListener('click', () => {
    if (isAdmin) return openProjectModal('create');
    if (!member?.nickname) {
        showToast('У аккаунта нет никнейма — обратитесь к Waltika');
        return;
    }
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
    if (!projectMode) return;
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
        renderAccountBar();
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
    renderAccountBar();
});

$('closeTokenBtn').addEventListener('click', () => tokenModal.classList.remove('active'));
tokenModal.addEventListener('click', (e) => {
    if (e.target === tokenModal) tokenModal.classList.remove('active');
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
async function loadMember() {
    member = null;
    if (!currentUser || isAdmin) return;
    try {
        const snap = await getDoc(doc(db, 'members', currentUser.uid));
        member = snap.exists() ? snap.data() : null;
    } catch {
        member = null;
    }
}

onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    isAdmin = !!user && user.uid === ADMIN_UID;
    loginBtn.textContent = user ? 'Выйти' : LOGIN_BTN_TEXT;

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

    await loadMember();
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
    inviteInfoTip.classList.add('show');
    tipTimeout = setTimeout(hideInfoTip, 5000);
});

// Клик в любом другом месте прячет подсказку
document.addEventListener('click', (e) => {
    if (!inviteInfoTip.contains(e.target)) hideInfoTip();
});

loginBtn.addEventListener('click', async () => {
    if (auth.currentUser) {
        await signOut(auth);
        showToast('Вы вышли из аккаунта', 'info');
    } else {
        openLogin();
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
    tokenModal.classList.remove('active');
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
// 1) создаём аккаунт; 2) записываем members/{uid} с кодом и никнеймом.
// Правила Firestore пропустят запись, только если есть документ invites/{код}.
// Код неверный → запись отклонена → сразу удаляем только что созданный аккаунт.
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

    registerSubmit.disabled = true;
    registerSubmit.textContent = 'Создаём аккаунт...';
    let cred = null;
    try {
        cred = await createUserWithEmailAndPassword(auth, regEmail.value.trim(), regPassword.value);
        await setDoc(doc(db, 'members', cred.user.uid), {
            email: cred.user.email,
            nickname,
            code,
            createdAt: serverTimestamp()
        });
        await loadMember();   // onAuthStateChanged сработал раньше, чем появилась запись
        render();
        closeLogin();
        showToast('Аккаунт создан!', 'success');
    } catch (err) {
        if (cred) {
            // Аккаунт создался, а код не подошёл — убираем аккаунт
            await deleteUser(cred.user).catch(() => signOut(auth));
            showToast(err.code === 'permission-denied' ? 'Неверный код приглашения' : 'Не удалось завершить регистрацию');
        } else {
            showToast(authErrorText(err.code));
        }
    } finally {
        registerSubmit.disabled = false;
        registerSubmit.textContent = 'Зарегистрироваться';
    }
});
