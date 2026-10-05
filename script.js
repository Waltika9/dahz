// ===== Анимация входа на главную страницу =====
// Стоит в самом начале файла: даже если ниже что-то сломается,
// шторка всё равно уберётся и сайт не останется чёрным.
(function () {
    const curtain = document.getElementById('introCurtain');
    if (!curtain) return;

    // Кто отключил анимации в системе — сразу показываем сайт
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        curtain.remove();
        return;
    }

    // Блокируем прокрутку на время анимации
    document.body.classList.add('intro-locked');

    // Искра в центре успевает загореться, затем расходится волна и «подлетает» сайт
    setTimeout(() => {
        curtain.classList.add('active');
        document.body.classList.add('intro-playing');
    }, 650);

    // Волна дошла до краёв — убираем шторку
    setTimeout(() => {
        curtain.remove();
        document.body.classList.remove('intro-locked');
    }, 1650);

    // Анимация блоков закончилась
    setTimeout(() => {
        document.body.classList.remove('intro-playing');
    }, 1900);
})();

// ===== Радужные пиксели в приветствии =====
// С самого входа (ещё под затемнением) в рамке приветствия переливается пиксельная радуга
// (цвета бегут по диагонали ступеньками), затем плавно гаснет. Клик по надписи — коротко ещё раз.
(function () {
    const box = document.getElementById('welcomeText');
    const canvas = document.getElementById('welcomeRainbow');
    if (!box || !canvas) return;
    const ctx = canvas.getContext('2d');

    const CELL = 14;          // размер «пикселя» в CSS-пикселях
    const CLICK_MS = 1500;    // сколько играет радуга по клику
    const HUE_SPEED = 90;     // на сколько градусов цвета сдвигаются за секунду
    const HUE_STEP = 14;      // разница цвета между соседними клетками
    let raf = 0, stopTimer = 0, cols = 0, rows = 0, jitter = [];

    // Холст в «клетках», а не в пикселях экрана: CSS растягивает его без сглаживания
    function resize() {
        cols = Math.max(1, Math.ceil(box.clientWidth / CELL));
        rows = Math.max(1, Math.ceil(box.clientHeight / CELL));
        canvas.width = cols;
        canvas.height = rows;
        // у каждой клетки чуть свой оттенок — как в пиксель-арте
        jitter = Array.from({ length: cols * rows }, () => (Math.random() - 0.5) * 10);
    }

    function draw(time) {
        const shift = time / 1000 * HUE_SPEED;
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                // диагональные «ступеньки»: две клетки по горизонтали на одну по вертикали
                const step = Math.floor(x / 2) * 2 + y * 2;
                const hue = (step * HUE_STEP / 2 - shift + jitter[y * cols + x]) % 360;
                ctx.fillStyle = `hsl(${hue < 0 ? hue + 360 : hue}, 78%, 52%)`;
                ctx.fillRect(x, y, 1, 1);
            }
        }
    }

    function frame(time) {
        draw(time);
        raf = requestAnimationFrame(frame);
    }

    // ms — сколько радуга играет, потом плавно гаснет (CSS) и перестаёт рисоваться
    function play(ms) {
        cancelAnimationFrame(raf);
        clearTimeout(stopTimer);
        resize();
        raf = requestAnimationFrame(frame);
        box.classList.add('rainbow');
        stopTimer = setTimeout(() => {
            box.classList.remove('rainbow');
            stopTimer = setTimeout(() => cancelAnimationFrame(raf), 900);
        }, ms);
    }

    box.addEventListener('click', () => play(CLICK_MS));
    box.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            play(CLICK_MS);
        }
    });

    // Первый раз — сразу, ещё под затемнением: радуга видна, пока расходится волна,
    // и гаснет через 1 секунду после того, как шторка исчезла (шторка уходит на 1,65 с)
    const intro = document.getElementById('introCurtain');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) play(intro ? 1650 + 1000 : 1000);
})();

const toast = document.getElementById('toast');
const compilerModal = document.getElementById('compilerModal');
const openCompilerBtn = document.getElementById('openCompilerBtn');
const closeModalBtn = document.getElementById('closeModalBtn');
const soonCard = document.getElementById('soonCard');

let toastTimeout;

// type: '' (красный), 'success', 'info', 'warning' — цвета в style.css
function showToast(message, type = '') {
    clearTimeout(toastTimeout);
    toast.textContent = message;
    toast.className = 'toast show' + (type ? ' ' + type : '');
    toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Авторизация — в firebase.js

// Модалка выбора компилятора (?. — не падаем, если элемента нет на странице)
openCompilerBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    compilerModal.classList.add('active');
});

// Закрытие по крестику
closeModalBtn?.addEventListener('click', () => {
    compilerModal.classList.remove('active');
});

// Закрытие по фону
compilerModal?.addEventListener('click', (e) => {
    if (e.target === compilerModal) {
        compilerModal.classList.remove('active');
    }
});

// Клик по карточке "soon"
soonCard?.addEventListener('click', () => {
    showToast("Скоро появятся новые проекты");
});

// ===== Поиск проектов =====
// Поле всегда открыто. Ищет по названию, автору и подписи справа. Карточки рисует
// firebase.js, поэтому после каждой перерисовки фильтр применяется заново.
const searchInput = document.getElementById('searchInput');
const searchEmpty = document.getElementById('searchEmpty');
const projectCardsBox = document.getElementById('projectCards');

function applySearch() {
    const query = searchInput.value.trim().toLowerCase();
    let found = 0;
    projectCardsBox.querySelectorAll('.project-card').forEach(card => {
        const text = [...card.querySelectorAll('.project-title, .project-author, .project-tag')]
            .map(el => el.textContent).join(' ').toLowerCase();
        const match = !query || text.includes(query);
        card.classList.toggle('search-hidden', !match);
        if (match) found++;
    });
    document.body.classList.toggle('searching', !!query);
    searchEmpty.hidden = !query || found > 0;
}

searchInput?.addEventListener('input', applySearch);
searchInput?.addEventListener('keydown', (e) => {
    // Esc очищает поиск
    if (e.key === 'Escape') {
        searchInput.value = '';
        applySearch();
    }
});

// ===== Темы сайта =====
// Выбор сохраняется в этом браузере (localStorage) и ставится ещё до загрузки
// стилей — скриптом в <head>. Сами цвета тем — в style.css (html[data-theme=…]).
// p — цвета мини-копии страницы в окне выбора.
const THEMES = [
    { id: 'classic', name: 'Классика', desc: 'Чёрные рамки и жёсткие тени — как было',
      p: { bg: '#f8fafc', card: '#ffffff', border: '#000000', text: '#0f172a', radius: '0px', bw: '2px', shadow: '2px 2px 0 #000' } },
    { id: 'dark', name: 'Тёмная', desc: 'Минимализм, мягкие тени и скругления',
      p: { bg: '#0d0e11', card: '#16171b', border: '#2a2c33', text: '#ececf0', radius: '6px', bw: '1px', shadow: 'none' } },
    { id: 'light', name: 'Светлая', desc: 'Чистая и воздушная, в духе Apple',
      p: { bg: '#f2f2f7', card: '#ffffff', border: 'rgba(0,0,0,0.08)', text: '#1c1c1e', radius: '7px', bw: '1px', shadow: '0 1px 3px rgba(0,0,0,0.08)' } },
    { id: 'terminal', name: 'Терминал', desc: 'Зелёный код на чёрном экране',
      p: { bg: '#030603', card: '#061006', border: '#1c5e2e', text: '#3cff73', radius: '0px', bw: '1px', shadow: '0 0 6px rgba(60,255,115,0.25)' } },
    { id: 'sunset', name: 'Закат', desc: 'Тёплый градиент и матовое стекло',
      p: { bg: 'linear-gradient(160deg, #ffe3cc, #ffc6c6 45%, #e5c8ff)', card: 'rgba(255,255,255,0.7)', border: 'rgba(255,255,255,0.85)', text: '#3d1f33', radius: '8px', bw: '1px', shadow: '0 2px 6px rgba(160,70,90,0.15)' } },
    { id: 'ocean', name: 'Океан', desc: 'Глубокий синий и стеклянные карточки',
      p: { bg: 'linear-gradient(180deg, #06182b, #0b2a4a 55%, #0f3d63)', card: 'rgba(255,255,255,0.08)', border: 'rgba(125,211,252,0.3)', text: '#e3f2ff', radius: '7px', bw: '1px', shadow: 'none' } }
];

const themeBtn = document.getElementById('themeBtn');
const themeModal = document.getElementById('themeModal');
const themeGrid = document.getElementById('themeGrid');
const closeThemeBtn = document.getElementById('closeThemeBtn');

function currentTheme() {
    return document.documentElement.dataset.theme || 'classic';
}

function setTheme(id) {
    const html = document.documentElement;
    // на долю секунды включаем плавный переход цветов
    html.classList.add('theme-switching');
    if (id === 'classic') delete html.dataset.theme;
    else html.dataset.theme = id;
    setTimeout(() => html.classList.remove('theme-switching'), 400);
    try { localStorage.setItem('dahz_theme', id); } catch (e) { /* приватный режим */ }
    themeGrid?.querySelectorAll('.theme-option').forEach(b => {
        const on = b.dataset.themeId === id;
        b.classList.toggle('active', on);
        b.querySelector('.theme-check').textContent = on ? '✓' : '';
    });
}

function renderThemes() {
    themeGrid.innerHTML = '';
    for (const t of THEMES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'theme-option';
        b.dataset.themeId = t.id;
        const prev = document.createElement('span');
        prev.className = 'theme-preview';
        for (const [k, v] of Object.entries(t.p)) prev.style.setProperty('--p-' + k, v);
        prev.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
        const name = document.createElement('span');
        name.className = 'theme-name';
        name.textContent = t.name;
        const check = document.createElement('span');
        check.className = 'theme-check';
        name.append(check);
        const desc = document.createElement('span');
        desc.className = 'theme-desc';
        desc.textContent = t.desc;
        b.append(prev, name, desc);
        b.addEventListener('click', () => setTheme(t.id));
        themeGrid.append(b);
    }
    setTheme(currentTheme());
}

themeBtn?.addEventListener('click', () => {
    if (!themeGrid.children.length) renderThemes();
    themeModal.classList.add('active');
});
closeThemeBtn?.addEventListener('click', () => themeModal.classList.remove('active'));
themeModal?.addEventListener('click', (e) => {
    if (e.target === themeModal) themeModal.classList.remove('active');
});

if (projectCardsBox) {
    new MutationObserver(applySearch).observe(projectCardsBox, { childList: true });
}

// Все карточки с классом "not-ready" показывают toast вместо перехода
document.querySelectorAll('.not-ready').forEach(card => {
    card.addEventListener('click', (e) => {
        e.preventDefault();
        showToast("Проект на стадии разработки...");
    });
});
