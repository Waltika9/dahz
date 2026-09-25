// ===== GitHub API: создание файлов в репозитории прямо с сайта =====
// Токен хранится ТОЛЬКО в браузере владельца (localStorage), в коде его нет.
// Без токена сайт работает как обычно, просто не может создавать файлы.

const REPO = 'Waltika9/dahz';
const BRANCH = 'main';
const TOKEN_KEY = 'dahz_github_token';

export function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

export function setToken(token) {
    try {
        if (token) localStorage.setItem(TOKEN_KEY, token);
        else localStorage.removeItem(TOKEN_KEY);
    } catch { /* приватный режим — просто не сохраняем */ }
}

function apiUrl(path) {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return `https://api.github.com/repos/${REPO}/contents/${encoded}`;
}

async function request(path, options = {}) {
    const token = getToken();
    if (!token) throw new Error('Сначала добавьте токен GitHub (кнопка «🔑 Токен GitHub»)');
    return fetch(apiUrl(path), {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            ...(options.headers || {})
        }
    });
}

// Есть ли уже такой файл в репозитории
export async function fileExists(path) {
    const res = await request(`${path}?ref=${BRANCH}`);
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    throw new Error(githubError(res.status));
}

// Создаёт файл. content — уже в base64
export async function createFile(path, base64, message) {
    const res = await request(path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, content: base64, branch: BRANCH })
    });
    if (!res.ok) throw new Error(githubError(res.status));
}

// Проверка токена: видит ли он репозиторий и может ли писать
export async function checkToken(token) {
    const res = await fetch(`https://api.github.com/repos/${REPO}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
    });
    if (!res.ok) return false;
    const repo = await res.json();
    return !!repo.permissions?.push;
}

function githubError(status) {
    if (status === 401) return 'Токен GitHub неверный или истёк';
    if (status === 403) return 'У токена нет прав на запись в репозиторий';
    if (status === 409 || status === 422) return 'Такой файл уже существует на GitHub';
    return `GitHub ответил ошибкой ${status}`;
}

// ===== Помощники =====

// Текст (с русскими буквами) → base64
export function textToBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

// Картинка из <input type="file"> → base64
export function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Не удалось прочитать картинку'));
        reader.readAsDataURL(file);
    });
}

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Заготовка новой страницы проекта в стиле сайта.
// link — путь вида projects/game.html или projects/game/index.html
export function projectTemplate(title, link) {
    const up = '../'.repeat(link.split('/').length - 1);   // путь до корня сайта
    const t = escapeHtml(title);
    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${t} | Waltika Projects</title>
    <link rel="icon" type="image/png" href="${up}images/favicon.png">
    <link rel="stylesheet" href="${up}style.css">
</head>
<body>

    <header>
        <div class="welcome-text">${t}</div>
        <a href="${up}index.html" class="btn">← На главную</a>
    </header>

    <main class="projects-list">
        <div class="project-card">
            <p>Здесь скоро будет проект ✨</p>
        </div>
    </main>

</body>
</html>
`;
}
