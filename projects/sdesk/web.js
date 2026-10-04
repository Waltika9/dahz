/* Short Desk — плитка «Ссылка»: сайт прямо на доске.
   Страница показывается во встроенном окне (iframe). Пока окно «спит», его закрывает
   прозрачный щит: плитку можно таскать, а колесо масштабирует доску. Клик по сайту
   «будит» его — им можно пользоваться, пока не нажмёте мимо или на «Готово».

   Многие большие сайты запрещают показывать себя внутри чужих страниц — для них плитка
   сразу предлагает новую вкладку. Видео YouTube, Vimeo и Rutube, музыка Spotify, проекты
   Scratch и CodePen, поиск Google и Google Карты переводятся в их «встраиваемый» вид. */
const Web = (() => {
    // Сайты, которые запрещают встраивание (проверено по их ответам в октябре 2026).
    // Поддомены тоже: «github.com» закрывает и «gist.github.com».
    const BLOCKED = [
        'youtube.com', 'github.com', 'vk.com', 'vk.ru', 'x.com', 'twitter.com', 'instagram.com', 'facebook.com',
        'tiktok.com', 'reddit.com', 'pinterest.com', 'linkedin.com', 'ok.ru', 'twitch.tv', 'telegram.org', 't.me',
        'discord.com', 'whatsapp.com', 'chatgpt.com', 'openai.com', 'claude.ai', 'gemini.google.com', 'deepl.com',
        'notion.so', 'figma.com', 'canva.com', 'stackoverflow.com', 'developer.mozilla.org', 'w3schools.com',
        'habr.com', 'pikabu.ru', 'dzen.ru', 'kinopoisk.ru', 'music.yandex.ru', 'rutube.ru', 'vimeo.com', 'spotify.com',
        'scratch.mit.edu', 'openstreetmap.org', 'duckduckgo.com', 'bing.com', 'apple.com', 'netflix.com', 'bbc.com',
        'chess.com', 'lichess.org', 'steamcommunity.com', 'steampowered.com', 'roblox.com', 'minecraft.net',
        'duolingo.com', 'wolframalpha.com', 'monkeytype.com', 'speedtest.net', 'tradingview.com', 'windy.com',
        'yr.no', 'kaspi.kz', 'krisha.kz', 'olx.kz', 'hh.kz', 'hh.ru', 'nur.kz', '2gis.kz', '2gis.ru'
    ];
    // а у этих закрыта только сама главная — поддомены (например, translate.yandex.ru) открываются
    const BLOCKED_EXACT = ['ya.ru', 'yandex.ru', 'yandex.kz', 'yandex.by', 'yandex.com'];
    const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|[\w.-]+\.localhost|[\w.-]+\.test)$/i;

    let live = null;            // плитка, сайтом в которой сейчас пользуются

    const decode = s => { try { return decodeURIComponent(s); } catch { return s; } };
    // Адрес, который удобно читать: «%D0%BA%D0%BE…» → «ко…»
    const readable = s => { try { return decodeURI(s); } catch { return s; } };

    /* ---------- Адрес ---------- */
    // Что ввёл человек → адрес страницы. '' — пусто, null — адрес записан с ошибкой.
    // Текст, не похожий на адрес, ищется в Google.
    function address(raw) {
        const s = String(raw == null ? '' : raw).trim();
        if (!s) return '';
        let url;
        if (/^https?:\/\//i.test(s)) url = s;
        else if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?([/?#]|$)/i.test(s)) url = 'http://' + s;
        else if (!/\s/.test(s) && /^([\wЀ-ӿ-]+\.)+[a-zЀ-ӿ]{2,}(:\d+)?([/?#]|$)/i.test(s)) url = 'https://' + s;
        else return 'https://www.google.com/search?q=' + encodeURIComponent(s);
        try {
            const u = new URL(url);
            return /[%\s]/.test(u.hostname) ? null : u.href;     // «https://foo bar» — не адрес
        } catch {
            return null;
        }
    }

    // «1h2m3s», «90s» или «90» → секунды (метка времени в ссылке на видео)
    function seconds(t) {
        if (!t) return 0;
        if (/^\d+$/.test(t)) return Number(t);
        const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
        return m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : 0;
    }

    // Обычная ссылка → адрес для встраивания (или null, если это не про этот сайт)
    const EMBEDS = [
        // YouTube: видео, Shorts, трансляции, плейлисты
        (u, h) => {
            let id = null;
            if (h === 'youtu.be') id = u.pathname.split('/')[1];
            else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
                const m = /^\/(?:shorts|live|embed|v)\/([\w-]+)/.exec(u.pathname);
                id = m ? m[1] : u.pathname === '/watch' ? u.searchParams.get('v') : null;
                const list = u.searchParams.get('list');
                if (!id && list && (u.pathname === '/playlist' || u.pathname === '/watch')) {
                    return 'https://www.youtube.com/embed/videoseries?list=' + encodeURIComponent(list);
                }
                if (id === 'videoseries') return u.href;
            }
            if (!id || !/^[\w-]{6,}$/.test(id)) return null;
            const t = seconds(u.searchParams.get('t') || u.searchParams.get('start'));
            return `https://www.youtube.com/embed/${id}` + (t ? '?start=' + t : '');
        },
        // Vimeo
        (u, h) => {
            if (h === 'player.vimeo.com') return u.href;
            const m = h === 'vimeo.com' && /^\/(\d+)/.exec(u.pathname);
            return m ? 'https://player.vimeo.com/video/' + m[1] : null;
        },
        // Rutube
        (u, h) => {
            if (h !== 'rutube.ru') return null;
            if (u.pathname.startsWith('/play/embed/')) return u.href;
            const m = /^\/video\/(\w+)/.exec(u.pathname);
            return m ? 'https://rutube.ru/play/embed/' + m[1] : null;
        },
        // Spotify: треки, альбомы, плейлисты, подкасты
        (u, h) => {
            const m = h === 'open.spotify.com' &&
                /^(?:\/intl-[\w-]+)?(?:\/embed)?\/(track|album|playlist|episode|show|artist)\/(\w+)/.exec(u.pathname);
            return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}` : null;
        },
        // Scratch
        (u, h) => {
            const m = h === 'scratch.mit.edu' && /^\/projects\/(\d+)/.exec(u.pathname);
            return m ? `https://scratch.mit.edu/projects/${m[1]}/embed` : null;
        },
        // CodePen
        (u, h) => {
            const m = h === 'codepen.io' && /^\/([\w-]+)\/(?:pen|full|details|embed)\/(\w+)/.exec(u.pathname);
            return m ? `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result` : null;
        },
        // Поиск Google и Google Карты
        (u, h) => {
            if (!/^(maps\.)?google\.[a-z.]+$/.test(h)) return null;
            const p = u.pathname, q = u.searchParams.get('q');
            if (!h.startsWith('maps.') && !p.startsWith('/maps')) {
                if (p !== '/' && p !== '/search' && p !== '/webhp') return null;
                return 'https://www.google.com/search?igu=1' + (q ? '&q=' + encodeURIComponent(q) : '');
            }
            let place = q;
            const named = /\/maps\/(?:place|search)\/([^/]+)/.exec(p);
            if (!place && named) place = decode(named[1]).replace(/\+/g, ' ');
            const at = /@(-?[\d.]+),(-?[\d.]+),([\d.]+)z/.exec(p);
            if (!place && at) place = at[1] + ',' + at[2];
            if (!place) return null;
            return 'https://maps.google.com/maps?q=' + encodeURIComponent(place) + (at ? '&z=' + Math.round(at[3]) : '') + '&output=embed';
        }
    ];

    // Как показать страницу: адрес для встроенного окна и запрещает ли сайт встраивание
    function frameOf(page) {
        let u;
        try { u = new URL(page); } catch { return null; }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        // доска открыта по https — страницу по http браузер внутри не покажет
        if (u.protocol === 'http:' && location.protocol === 'https:' && !LOCAL.test(u.hostname)) u.protocol = 'https:';
        const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
        for (const embed of EMBEDS) {
            const src = embed(u, host);
            if (src) return { src, host };
        }
        return { src: u.href, host, blocked: isBlocked(host) };
    }

    function isBlocked(host) {
        if (BLOCKED_EXACT.includes(host)) return true;
        if (/(^|\.)google\.[a-z.]+$/.test(host)) return true;      // у Google открываются только поиск и карты
        return BLOCKED.some(d => host === d || host.endsWith('.' + d));
    }

    // Адрес для строки над сайтом: без https:// и www, поиск — словами
    function pretty(page) {
        try {
            const u = new URL(page);
            const h = u.hostname.replace(/^www\./, '');
            const q = u.searchParams.get('q');
            if (/^google\.[a-z.]+$/.test(h) && u.pathname === '/search' && q) return 'Поиск: ' + q;
            const rest = decode(u.pathname + u.search + u.hash);
            return h + (rest === '/' ? '' : rest);
        } catch {
            return page;
        }
    }

    /* ---------- Плитка ---------- */
    function iconButton(icon, title, action) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'web-btn';
        b.title = title;
        b.setAttribute('aria-label', title);
        b.innerHTML = UI.svg(icon);
        b.addEventListener('click', action);
        return b;
    }

    function pill(icon, label, action) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'media-pick';
        b.innerHTML = UI.svg(icon) + '<span></span>';
        b.lastChild.textContent = label;
        b.addEventListener('click', action);
        return b;
    }

    function big(icon) {
        const el = UI.div('web-big');
        el.innerHTML = UI.svg(icon);
        return el;
    }

    // Содержимое плитки: строка адреса с кнопками и окно сайта
    function build(tile) {
        const root = UI.div('tile-web');
        const bar = UI.div('web-bar');
        const fav = document.createElement('span');
        fav.className = 'web-fav';
        const addr = UI.div('web-addr');
        const done = document.createElement('button');
        done.type = 'button';
        done.className = 'web-done';
        done.textContent = 'Готово';
        done.title = 'Вернуться к доске';
        done.addEventListener('click', () => deactivate());
        const reload = iconButton('reload', 'Обновить страницу', () => reloadPage(tile));
        const ext = iconButton('external', 'Открыть в новой вкладке', () => openTab(tile));
        bar.append(fav, addr, done, reload, ext);

        const view = UI.div('web-view');
        view.style.height = tile.fields.gh + 'px';
        const shield = UI.div('web-shield');
        shield.append(UI.div('web-hint', UI.isTouch() ? 'Коснитесь, чтобы пользоваться сайтом' : 'Нажмите, чтобы пользоваться сайтом'));
        root.append(bar, view);
        tile.web = { root, bar, fav, addr, reload, ext, view, shield, frame: null };
        render(tile);
        return root;
    }

    // Показать страницу из tile.fields.page. eager — грузить сразу, даже если плитка за краем экрана.
    function render(tile, eager = false) {
        const w = tile.web;
        if (!w) return;
        if (live === tile) deactivate();
        w.view.textContent = '';
        w.frame = null;
        w.root.classList.remove('loading');
        const page = tile.fields.page || '';
        const info = page ? frameOf(page) : null;
        w.addr.textContent = page ? pretty(page) : 'Страница не открыта';
        w.addr.title = page;
        w.addr.classList.toggle('empty', !page);
        setFav(w, info);
        w.reload.disabled = true;
        w.ext.disabled = !info;

        if (!info) {
            w.view.append(startScreen(tile, !!page));
            return;
        }
        if (info.blocked && tile.webForce !== page) {
            w.view.append(refusedScreen(tile, info.host));
            return;
        }
        const f = document.createElement('iframe');
        f.className = 'web-frame';
        f.loading = eager ? 'eager' : 'lazy';
        f.referrerPolicy = 'strict-origin-when-cross-origin';
        f.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
        // чужой сайт без allow-top-navigation не сможет увести всю вкладку с доски
        // (свои страницы с этого же сайта открываются как есть)
        if (new URL(info.src).origin !== location.origin) {
            f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups ' +
                'allow-popups-to-escape-sandbox allow-modals allow-presentation allow-downloads');
        }
        f.title = info.host;
        f.addEventListener('load', () => {
            w.root.classList.remove('loading');
            // на всякий случай «толкаем» слой: только что загруженный чужой сайт внутри
            // увеличенной доски иногда не показывается до следующей перерисовки
            requestAnimationFrame(() => { f.style.transform = f.style.transform ? '' : 'translateZ(0)'; });
        });
        f.src = info.src;
        w.root.classList.add('loading');
        w.view.append(f, w.shield);
        w.frame = f;
        w.reload.disabled = false;
    }

    // Значок сайта; если его нет — глобус
    function setFav(w, info) {
        w.fav.innerHTML = UI.svg('globe');
        if (!info) return;
        const img = new Image();
        img.alt = '';
        img.draggable = false;
        img.referrerPolicy = 'no-referrer';
        const token = w.favToken = {};
        img.onload = () => {
            if (w.favToken === token && img.naturalWidth > 1) w.fav.replaceChildren(img);
        };
        img.src = new URL('/favicon.ico', info.src).href;
    }

    function startScreen(tile, bad) {
        const el = UI.div('web-start');
        el.append(
            big('globe'),
            UI.div('web-title', bad ? 'Адрес записан с ошибкой' : 'Сайт прямо на доске'),
            UI.div('web-note', 'Введите адрес сайта или запрос для поиска в поле «Адрес» и нажмите Enter. Адрес может прийти и по линии от другой плитки.'),
            pill('link', 'Открыть', () => openTyped(tile))
        );
        return el;
    }

    function refusedScreen(tile, host) {
        const el = UI.div('web-start refused');
        const acts = UI.div('web-actions');
        const anyway = document.createElement('button');
        anyway.type = 'button';
        anyway.className = 'web-anyway';
        anyway.textContent = 'Всё равно попробовать';
        anyway.addEventListener('click', () => {
            tile.webForce = tile.fields.page;
            render(tile, true);
        });
        acts.append(pill('external', 'Открыть в новой вкладке', () => openTab(tile)), anyway);
        el.append(
            big('lock'),
            UI.div('web-title', `${host} не открывается внутри доски`),
            UI.div('web-note', 'Этот сайт запретил показывать себя внутри других страниц — откройте его в новой вкладке.'),
            acts
        );
        return el;
    }

    /* ---------- Действия ---------- */
    // Открыть страницу. Промис завершится, когда она загрузится (или по сигналу отмены).
    function open(tile, page, signal) {
        tile.fields.page = page;
        tile.webForce = null;
        render(tile, true);
        Board.noteChange();
        const f = tile.web.frame;
        if (!f) return Promise.resolve();
        return new Promise(done => {
            const end = () => {
                f.removeEventListener('load', end);
                if (signal) signal.removeEventListener('abort', end);
                done();
            };
            f.addEventListener('load', end);
            if (signal) signal.addEventListener('abort', end);
        });
    }

    // Открыть то, что написано в поле «Адрес»
    function openTyped(tile) {
        const page = address(tile.fields.url);
        if (page === null) { UI.toast('Адрес записан с ошибкой'); return; }
        if (page === '') {
            UI.toast('Введите адрес сайта в поле «Адрес»');
            const row = tile.rowEls.find(r => r.spec.field && r.spec.field.key === 'url');
            const inp = row && !row.el.classList.contains('linked') && row.el.querySelector('input');
            if (inp) inp.focus();
            return;
        }
        open(tile, page);
    }

    function openTab(tile) {
        if (tile.fields.page) window.open(tile.fields.page, '_blank', 'noopener');
    }

    function reloadPage(tile) {
        if (tile.fields.page) render(tile, true);
    }

    function closePage(tile) {
        tile.fields.page = '';
        tile.webForce = null;
        render(tile);
        Board.noteChange();
    }

    // Размер окна сайта (тянут за уголок плитки)
    function resize(tile, w, h) {
        tile.fields.gw = Math.min(2400, Math.max(300, Math.round(w)));
        tile.fields.gh = Math.min(1800, Math.max(150, Math.round(h)));
        tile.card.style.width = tile.fields.gw + 'px';
        tile.web.view.style.height = tile.fields.gh + 'px';
    }

    /* ---------- Пользоваться сайтом ---------- */
    function activate(tile) {
        if (!tile || !tile.web || !tile.web.frame || live === tile) return;
        deactivate();
        live = tile;
        tile.web.root.classList.add('live');
        try { tile.web.frame.focus(); } catch { /* не страшно */ }
    }

    function deactivate() {
        if (!live) return;
        const t = live;
        live = null;
        if (t.web) t.web.root.classList.remove('live');
        const act = document.activeElement;
        if (act && act.tagName === 'IFRAME') act.blur();
    }

    // Нажатие мимо сайта (по доске, другой плитке, панели) возвращает к доске
    document.addEventListener('pointerdown', e => {
        if (live && !live.web.bar.contains(e.target)) deactivate();
    }, true);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') deactivate();
    });

    return {
        address, readable, frameOf, pretty, build, render, open, openTyped, openTab,
        reload: reloadPage, close: closePage, resize, activate, deactivate
    };
})();
