// ===== Service worker: работа без интернета и уведомления =====
// Лежит рядом с index.html, поэтому управляет только этой папкой (projects/schedule/).
//
// Как кэшируется:
//   • страница, schedule.json и manifest — «сначала сеть»: свежее, если интернет есть,
//     и из кэша, если его нет (или сеть думает дольше 3 секунд);
//   • скрипты, стили, картинки, шрифт — «сначала кэш»: у них в адресе ?v=N,
//     поэтому новая версия — это новый адрес, и она скачается сама;
//   • музыку (audio/) не трогаем: плееры запрашивают её кусками, это ломает кэш.
// После первой загрузки страница присылает сюда список всего, что она загрузила
// (сообщение cache-urls), — так в кэш попадают и файлы самого первого открытия.
//
// При изменении этого файла увеличьте номер в CACHE — старый кэш удалится.

const CACHE = 'irl-v1';
const CORE = ['./', 'index.html', 'data/schedule.json', 'manifest.webmanifest', 'assets/icon-192.png'];
const NETWORK_TIMEOUT = 3000;

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE)
            .then(c => c.addAll(CORE))
            .catch(() => { /* без сети тоже установимся — докэшируем позже */ })
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k.startsWith('irl-') && k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// Страница прислала список своих файлов — положим в кэш то, чего там ещё нет
self.addEventListener('message', (e) => {
    if (e.data?.type === 'cache-urls') e.waitUntil(cacheUrls(e.data.urls || []));
});

async function cacheUrls(urls) {
    const c = await caches.open(CACHE);
    await Promise.all(urls.map(async (u) => {
        try {
            const url = new URL(u, self.location.href);
            if (!isCacheable(url) || await c.match(url.href)) return;
            const same = url.origin === self.location.origin;
            const res = await fetch(url.href, { mode: same ? 'same-origin' : 'no-cors', credentials: 'omit' });
            if (res.ok || res.type === 'opaque') await c.put(url.href, res);
        } catch (err) { /* не получилось — не страшно */ }
    }));
}

function isFont(url) {
    return url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com';
}

function isCacheable(url) {
    if (url.pathname.includes('/audio/')) return false;
    if (url.origin === self.location.origin) return url.pathname.startsWith(new URL('./', self.location.href).pathname);
    return isFont(url);
}

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (!isCacheable(url)) return;          // музыка и чужие сайты — напрямую

    const fresh = req.mode === 'navigate' || /\.(json|webmanifest)$/.test(url.pathname);
    e.respondWith(fresh ? networkFirst(req) : cacheFirst(req));
});

// Сначала сеть (с таймаутом), иначе кэш
async function networkFirst(req) {
    const c = await caches.open(CACHE);
    const fromCache = async () =>
        (await c.match(req, { ignoreSearch: true })) ||
        (req.mode === 'navigate' ? (await c.match('./')) || (await c.match('index.html')) : undefined);

    const network = fetch(req).then((res) => {
        if (res.ok) c.put(req, res.clone());
        return res;
    });
    network.catch(() => { /* ошибку сети обработаем ниже */ });

    try {
        const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT));
        const first = await Promise.race([network, timeout]);
        if (first) return first;
        // сеть думает слишком долго — отдаём кэш, если он есть
        return (await fromCache()) || (await network);
    } catch (err) {
        return (await fromCache()) || Response.error();
    }
}

// Сначала кэш, иначе сеть (и сохранить)
async function cacheFirst(req) {
    const c = await caches.open(CACHE);
    const hit = await c.match(req);
    if (hit) return hit;
    try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') c.put(req, res.clone());
        return res;
    } catch (err) {
        return Response.error();
    }
}

// ----- Уведомления -----

// Нажали на уведомление — открыть (или показать) приложение
self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    e.waitUntil((async () => {
        const scope = new URL('./', self.location.href).href;
        const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const win = list.find(w => w.url.startsWith(scope));
        if (win) return win.focus();
        return self.clients.openWindow(scope);
    })());
});

// Настоящий Web Push (на будущее). Сейчас сервера нет, и это событие не приходит.
// Когда появится сервер, он будет присылать JSON вида { "title": "...", "body": "...", "tag": "..." }
// на подписку, созданную в js/notify.js (subscribePush), — и уведомление покажется
// даже при закрытом приложении.
self.addEventListener('push', (e) => {
    let d = {};
    try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data?.text() || '' }; }
    e.waitUntil(self.registration.showNotification(d.title || 'IRL расписание', {
        body: d.body || '',
        tag: d.tag || 'irl-push',
        icon: 'assets/icon-192.png',
        badge: 'assets/icon-192.png'
    }));
});
