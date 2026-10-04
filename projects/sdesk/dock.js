/* Short Desk — нижняя панель (dock):
   кнопка «На главную», миникарта, кнопка «+» и ряд созданных плиток. */
const Dock = (() => {
    const THUMB_MIN = 56, THUMB_MAX = 280, THUMB_GAP = 8;
    const PLUS_GAP = { max: 26, min: 8 };   // отступ «+» от миникарты: до прокрутки и после
    const DRAG_SLOP = 5;                    // на сколько пикселей сдвинуть мышь, чтобы началось перетаскивание
    const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

    let dock, strip, plusSlot, emptyEl, canvas, ctx, scroller;
    let thumbW = readWidth();
    let rightHeld = false, resized = false;     // ПКМ зажата над рядом и колесо уже меняло ширину
    // нажатие мышью на ряд: ПКМ + тянуть — рамка выделения, ЛКМ + тянуть — перестановка
    let press = null, rectEl = null, edgeRaf = 0, noClick = false;
    let mapQueued = false, mapFrozen = null, mapXf = null, mapDrag = false;
    const thumbs = new Map();
    const stripTouches = new Map(), mapTouches = new Map();
    let stripPinch = null, mapPinch = null;

    function readWidth() {
        try { return Number(localStorage.getItem('sdesk_thumb_w')) || 132; } catch { return 132; }
    }

    function init() {
        dock = document.getElementById('dock');
        strip = document.getElementById('strip');
        plusSlot = document.getElementById('plusSlot');
        emptyEl = document.getElementById('stripEmpty');
        canvas = document.getElementById('minimap');
        ctx = canvas.getContext('2d');

        document.getElementById('homeBtn').addEventListener('click', goHome);

        const plus = document.getElementById('plusBtn');
        plus.addEventListener('click', () => Palette.open());
        plus.addEventListener('contextmenu', e => {
            e.preventDefault();
            if (e.pointerType !== 'touch') Menus.plusMenu(e.clientX, e.clientY);
        });
        // пальцем: долгое нажатие на «+» — меню быстрых действий
        UI.longPress(plus, (el, x, y) => Menus.plusMenu(x, y));

        // ряд плиток: колесо листает, ПКМ + колесо меняет ширину миниатюр,
        // ПКМ + тянуть — выделение рамкой, ЛКМ + тянуть — перестановка,
        // короткий ПКМ-клик (без колеса и рамки) открывает меню миниатюры
        scroller = UI.hscroll(strip);
        strip.addEventListener('pointerdown', onStripDown);
        window.addEventListener('pointermove', onStripMove);
        window.addEventListener('pointerup', onStripUp);
        window.addEventListener('pointercancel', e => { if (press && e.pointerId === press.pointer) endPress(false); });
        window.addEventListener('keydown', e => { if (e.key === 'Escape' && press) endPress(false); });
        window.addEventListener('blur', () => {
            rightHeld = false;
            if (press) endPress(false);
        });
        strip.addEventListener('wheel', onStripWheel, { passive: false });
        strip.addEventListener('scroll', onScroll, { passive: true });
        strip.addEventListener('click', e => {
            if (noClick) { noClick = false; return; }       // это было перетаскивание, а не клик
            const th = e.target.closest('.thumb');
            if (th) Board.focusTile(th.dataset.id);
        });
        // пальцем: долгое нажатие на миниатюру — её меню, щипок двумя пальцами — ширина миниатюр
        UI.longPress(strip, (th, x, y) => Menus.thumbMenu(th.dataset.id, x, y), { selector: '.thumb' });
        strip.addEventListener('pointerdown', e => pinchDown(e, stripTouches, () => { stripPinch = { d: touchDist(stripTouches), w: thumbW }; }));
        strip.addEventListener('pointermove', e => pinchMove(e, stripTouches, stripPinch, d => {
            setThumbWidth(stripPinch.w * d / stripPinch.d, null);
        }));
        for (const type of ['pointerup', 'pointercancel']) {
            strip.addEventListener(type, e => { stripTouches.delete(e.pointerId); if (stripTouches.size < 2) stripPinch = null; });
        }

        // миникарта: клик и перетаскивание — переход, колесо (или два пальца) — масштаб самой доски
        canvas.addEventListener('pointerdown', onMapDown);
        canvas.addEventListener('pointermove', onMapMove);
        canvas.addEventListener('pointerup', onMapUp);
        canvas.addEventListener('pointercancel', onMapUp);
        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            Board.zoomBy(Math.exp(-UI.wheelDelta(e).y * (e.ctrlKey ? 0.01 : 0.0015)));
        }, { passive: false });
        dock.addEventListener('wheel', e => { if (!strip.contains(e.target)) e.preventDefault(); }, { passive: false });

        Board.on('tiles', () => { syncStrip(); queueMap(); });
        Board.on('items', queueMap);
        Board.on('selection', () => { syncSelection(); queueMap(); });
        Board.on('view', queueMap);
        Board.on('geometry', queueMap);

        window.addEventListener('resize', layout);
        applyThumbWidth();
        layout();
        syncStrip();
    }

    // Доска знает, сколько места снизу занимает панель
    function layout() {
        const r = dock.getBoundingClientRect();
        Board.setInsets({ bottom: Math.max(0, innerHeight - r.top) });
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(canvas.clientWidth * dpr);
        canvas.height = Math.round(canvas.clientHeight * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        onScroll();
        queueMap();
    }

    async function goHome() {
        const ok = await UI.confirm({
            title: 'Вернуться на главную?',
            text: 'Доска сохранится в этом браузере и откроется снова, когда вы вернётесь.',
            ok: 'Перейти'
        });
        if (!ok) return;
        await Storage.autosave();
        App.allowLeave();
        location.href = '../../index.html';
    }

    /* ---------- Щипок двумя пальцами ---------- */
    const touchDist = map => {
        const [a, b] = [...map.values()];
        return Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
    };

    function pinchDown(e, map, start) {
        if (e.pointerType !== 'touch') return;
        map.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (map.size === 2) start();
    }

    function pinchMove(e, map, state, apply) {
        if (e.pointerType !== 'touch' || !map.has(e.pointerId)) return false;
        map.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (!state || map.size < 2) return false;
        apply(touchDist(map));
        return true;
    }

    /* ---------- Ряд созданных плиток ---------- */
    function syncStrip() {
        for (const [id, el] of thumbs) {
            if (Board.tiles.has(id)) continue;
            thumbs.delete(id);
            el.classList.add('leaving');
            setTimeout(() => el.remove(), 200);
        }
        for (const t of Board.tiles.values()) {
            let el = thumbs.get(t.id);
            if (!el) {
                el = makeThumb(t);
                thumbs.set(t.id, el);
                strip.append(el);
            }
            updateThumb(el, t);
        }
        // миниатюры идут в том же порядке, что и плитки доски (его меняют перетаскиванием)
        if (!(press && press.mode === 'move')) {
            let prev = emptyEl;
            for (const t of Board.tiles.values()) {
                const el = thumbs.get(t.id);
                if (prevThumb(el) !== prev) prev.after(el);
                prev = el;
            }
        }
        emptyEl.hidden = thumbs.size > 0;
        syncSelection();
        onScroll();
    }

    // Соседняя миниатюра слева (исчезающие не считаются)
    function prevThumb(el) {
        let p = el.previousElementSibling;
        while (p && p.classList.contains('leaving')) p = p.previousElementSibling;
        return p;
    }

    function makeThumb(t) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'thumb';
        b.dataset.id = t.id;
        b.dataset.asset = String(t.asset);
        // после появления анимация выключается — иначе она повторялась бы при каждой перестановке
        b.addEventListener('animationend', () => b.classList.add('ready'), { once: true });
        const name = document.createElement('span');
        name.className = 'thumb-name';
        b.append(Nodes.tileIcon(t), name);
        return b;
    }

    function updateThumb(el, t) {
        const title = Nodes.titleOf(t);
        // у картинки значок — сама картинка; он меняется вместе с файлом
        if (t.def.media === 'image' && el.dataset.asset !== String(t.asset)) {
            el.dataset.asset = String(t.asset);
            el.querySelector('.ico').replaceWith(Nodes.tileIcon(t));
        }
        el.querySelector('.thumb-name').textContent = title;
        el.title = title;
        el.classList.toggle('tinted', !!t.color);
        if (t.color) el.style.setProperty('--tint', t.color);
        else el.style.removeProperty('--tint');
    }

    function syncSelection() {
        for (const [id, el] of thumbs) el.classList.toggle('selected', Board.isSelected(id));
    }

    function applyThumbWidth() {
        strip.style.setProperty('--thumb-w', thumbW + 'px');
        strip.classList.toggle('compact', thumbW < 96);
    }

    // Новая ширина миниатюр; место под точкой px (от левого края ряда) остаётся на месте
    function setThumbWidth(w, px) {
        const r = strip.getBoundingClientRect();
        if (px == null) px = r.width / 2;
        const anchor = strip.scrollLeft + px, old = thumbW;
        thumbW = Math.max(THUMB_MIN, Math.min(THUMB_MAX, w));
        applyThumbWidth();
        strip.scrollLeft = anchor * (thumbW + THUMB_GAP) / (old + THUMB_GAP) - px;
        try { localStorage.setItem('sdesk_thumb_w', String(Math.round(thumbW))); } catch { /* приватный режим */ }
    }

    function onStripWheel(e) {
        e.preventDefault();
        const delta = UI.wheelDelta(e, strip.clientWidth).main;
        if (rightHeld || (e.buttons & 2)) {
            // ПКМ зажата + колесо: миниатюры сжимаются или растягиваются (как в FL Studio)
            resized = true;
            scroller.stop();
            setThumbWidth(thumbW * Math.exp(-delta * 0.002), e.clientX - strip.getBoundingClientRect().left);
            return;
        }
        scroller.by(delta);
    }

    /* ---------- Выделение рамкой (ПКМ) и перестановка (ЛКМ) ----------
       Работают мышью. Пальцем ряд, как раньше, листается, а долгое нажатие открывает меню. */
    function onStripDown(e) {
        noClick = false;
        if (e.button === 2) { rightHeld = true; resized = false; }
        if (press || e.pointerType === 'touch' || (e.button !== 0 && e.button !== 2)) return;
        const th = e.target.closest('.thumb');
        if (e.button === 0 && (!th || th.classList.contains('leaving'))) return;
        press = { pointer: e.pointerId, button: e.button, x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY, th, mode: null };
    }

    function onStripMove(e) {
        if (!press || e.pointerId !== press.pointer) return;
        // кнопку отпустили где-то за окном — заканчиваем
        if (press.mode && !(e.buttons & (press.button === 2 ? 2 : 1))) { endPress(true); return; }
        press.cx = e.clientX;
        press.cy = e.clientY;
        if (!press.mode) {
            if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_SLOP) return;
            if (press.button === 2 && resized) return;      // ПКМ + колесо — это смена ширины, а не рамка
            if (press.button === 2) startRect(); else startMove();
            edgeLoop();
        }
        if (press.mode === 'rect') updateRect(); else updateMove();
    }

    function onStripUp(e) {
        let dragged = false;
        if (press && e.pointerId === press.pointer && e.button === press.button) {
            dragged = !!press.mode;
            endPress(true);
            if (dragged) noClick = true;
        }
        if (e.button !== 2 || !rightHeld) return;
        rightHeld = false;
        const th = !resized && !dragged && e.target.closest && e.target.closest('.thumb');
        if (th && strip.contains(th)) Menus.thumbMenu(th.dataset.id, e.clientX, e.clientY);
    }

    // commit = false — отмена (Esc): всё возвращается как было
    function endPress(commit) {
        const p = press;
        press = null;
        cancelAnimationFrame(edgeRaf);
        edgeRaf = 0;
        if (p.mode === 'rect') endRect(p, commit);
        else if (p.mode === 'move') endMove(p, commit);
    }

    // id миниатюр слева направо
    const currentOrder = () => [...strip.querySelectorAll('.thumb:not(.leaving)')].map(el => el.dataset.id);

    // Пока курсор у края ряда, ряд сам прокручивается
    function edgeLoop() {
        cancelAnimationFrame(edgeRaf);
        const step = () => {
            if (!press || !press.mode) { edgeRaf = 0; return; }
            const r = strip.getBoundingClientRect(), x = press.cx, zone = 44;
            const v = x < r.left + zone ? x - (r.left + zone) : x > r.right - zone ? x - (r.right - zone) : 0;
            if (v) {
                const before = strip.scrollLeft;
                strip.scrollLeft += Math.max(-22, Math.min(22, v * 0.3));
                if (strip.scrollLeft !== before) {
                    if (press.mode === 'rect') updateRect(); else updateMove();
                }
            }
            edgeRaf = requestAnimationFrame(step);
        };
        edgeRaf = requestAnimationFrame(step);
    }

    /* Рамка: выделяет все миниатюры между её краями (и плитки на доске вместе с ними) */
    function startRect() {
        const p = press;
        p.mode = 'rect';
        p.before = Board.selectedTiles();
        p.picked = null;
        p.start = p.x - strip.getBoundingClientRect().left + strip.scrollLeft;   // край рамки в координатах ряда
        if (!rectEl) {
            rectEl = UI.div('sel-rect strip-rect');
            document.body.append(rectEl);
        }
        rectEl.style.display = 'block';
        scroller.stop();
        UI.menu.close();
    }

    function updateRect() {
        const p = press, r = strip.getBoundingClientRect();
        const sx = r.left + p.start - strip.scrollLeft;
        const x1 = Math.min(sx, p.cx), x2 = Math.max(sx, p.cx);
        // рамка всегда на всю высоту ряда, а по ширине — от места нажатия до курсора
        const left = Math.max(x1, r.left), right = Math.min(x2, r.right);
        rectEl.style.left = left + 'px';
        rectEl.style.top = r.top + 8 + 'px';
        rectEl.style.width = Math.max(0, right - left) + 'px';
        rectEl.style.height = r.height - 16 + 'px';
        const ids = [];
        for (const [id, el] of thumbs) {
            if (el.classList.contains('leaving')) continue;
            const b = el.getBoundingClientRect();
            if (b.right > x1 && b.left < x2) ids.push(id);
        }
        const key = ids.join();
        if (key !== p.picked) {
            p.picked = key;
            Board.selectTiles(ids);
        }
    }

    function endRect(p, commit) {
        rectEl.style.display = 'none';
        if (!commit) Board.selectTiles(p.before);
    }

    /* Перестановка: тянем миниатюру (или все выделенные сразу), остальные расступаются */
    function startMove() {
        const p = press, id = p.th.dataset.id;
        p.mode = 'move';
        const order = currentOrder();
        const moving = Board.isSelected(id) ? order.filter(x => Board.isSelected(x)) : [id];
        if (!Board.isSelected(id)) Board.selectTiles([id]);
        p.orig = order;
        p.moving = moving.map(x => thumbs.get(x));
        p.others = order.filter(x => !moving.includes(x)).map(x => thumbs.get(x));
        p.lead = moving.indexOf(id);                    // какая по счёту в блоке та, за которую тянем
        p.slot = thumbW + THUMB_GAP;
        p.base = thumbs.get(order[0]).offsetLeft;       // левый край первой миниатюры внутри ряда
        const tr = p.th.getBoundingClientRect();
        p.grab = p.x - tr.left;
        p.top = tr.top;
        p.idx = -1;

        // «призрак» миниатюры едет за курсором
        const g = p.th.cloneNode(true);
        g.classList.remove('selected', 'ready');
        g.classList.add('thumb-ghost');
        g.classList.toggle('compact', thumbW < 96);
        g.removeAttribute('title');
        g.style.width = thumbW + 'px';
        g.style.left = tr.left + 'px';
        g.style.top = tr.top + 'px';
        if (moving.length > 1) g.append(UI.div('thumb-count', String(moving.length)));
        document.body.append(g);
        p.ghost = g;

        for (const el of p.moving) el.classList.add('drag-src');
        document.documentElement.classList.add('thumb-dragging');
        scroller.stop();
        UI.menu.close();
    }

    function updateMove() {
        const p = press, r = strip.getBoundingClientRect();
        const left = p.cx - p.grab;
        p.ghost.style.left = left + 'px';
        p.ghost.style.top = p.top + (p.cy - p.y) + 'px';
        // куда встанет блок — считаем по ровной сетке ряда, а не по сдвигающимся миниатюрам
        const at = left - r.left + strip.scrollLeft - p.lead * p.slot;
        const idx = Math.max(0, Math.min(p.others.length, Math.round((at - p.base) / p.slot)));
        if (idx === p.idx) return;
        p.idx = idx;
        arrange([...p.others.slice(0, idx), ...p.moving, ...p.others.slice(idx)]);
    }

    // Переставить миниатюры; те, что сдвинулись, плавно доезжают до нового места
    function arrange(list) {
        const before = new Map(list.map(el => [el, el.getBoundingClientRect().left]));
        let prev = emptyEl;
        for (const el of list) {
            if (prevThumb(el) !== prev) prev.after(el);
            prev = el;
        }
        for (const el of list) {
            if (el.flip) el.flip.cancel();
            const dx = before.get(el) - el.getBoundingClientRect().left;
            el.flip = Math.abs(dx) > 0.5
                ? el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 240, easing: EASE })
                : null;
        }
    }

    function endMove(p, commit) {
        document.documentElement.classList.remove('thumb-dragging');
        if (!commit) arrange(p.orig.map(id => thumbs.get(id)).filter(Boolean));
        // «призрак» влетает на место своей миниатюры
        const r = strip.getBoundingClientRect(), g = p.ghost;
        const fly = g.animate([
            { left: g.style.left, top: g.style.top, transform: 'scale(1.06)' },
            { left: r.left + p.th.offsetLeft - strip.scrollLeft + 'px', top: r.top + p.th.offsetTop + 'px', transform: 'scale(1)' }
        ], { duration: 220, easing: EASE, fill: 'forwards' });
        const done = () => {
            g.remove();
            // если уже тянут снова — не трогаем миниатюры нового перетаскивания
            for (const el of p.moving) if (!(press && press.moving && press.moving.includes(el))) el.classList.remove('drag-src');
        };
        fly.finished.then(done, done);
        if (commit) Board.reorderTiles(currentOrder());
    }

    // При прокрутке «+» подъезжает к миникарте и остаётся на месте,
    // а миниатюры уходят под мягкое затухание у края
    function onScroll() {
        const s = strip.scrollLeft, max = strip.scrollWidth - strip.clientWidth;
        const p = Math.min(1, s / 48);
        plusSlot.style.marginLeft = (PLUS_GAP.max - (PLUS_GAP.max - PLUS_GAP.min) * p) + 'px';
        strip.classList.toggle('fade-l', s > 2);
        strip.classList.toggle('fade-r', s < max - 2);
    }

    /* ---------- Миникарта ---------- */
    function queueMap() {
        if (mapQueued) return;
        mapQueued = true;
        requestAnimationFrame(drawMap);
    }

    // Вся доска вместе с текущим видом
    function mapBounds() {
        const v = Board.visibleRect(), c = Board.contentBounds();
        let x1 = v.x, y1 = v.y, x2 = v.x + v.w, y2 = v.y + v.h;
        if (c) {
            x1 = Math.min(x1, c.x); y1 = Math.min(y1, c.y);
            x2 = Math.max(x2, c.x + c.w); y2 = Math.max(y2, c.y + c.h);
        }
        const px = (x2 - x1) * 0.06, py = (y2 - y1) * 0.06;
        return { x: x1 - px, y: y1 - py, w: x2 - x1 + px * 2, h: y2 - y1 + py * 2 };
    }

    function rr(x, y, w, h, r) {
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
        else ctx.rect(x, y, w, h);
    }

    function drawMap() {
        mapQueued = false;
        const W = canvas.clientWidth, H = canvas.clientHeight;
        if (!W || !H) return;
        ctx.clearRect(0, 0, W, H);
        const b = mapFrozen || mapBounds();
        const s = Math.min(W / b.w, H / b.h);
        const ox = (W - b.w * s) / 2 - b.x * s, oy = (H - b.h * s) / 2 - b.y * s;
        mapXf = { s, ox, oy };
        const X = x => x * s + ox, Y = y => y * s + oy;

        // линии
        ctx.lineWidth = 1;
        for (const l of Board.links.values()) {
            const a = Board.portWorld(l.from), z = Board.portWorld(l.to);
            ctx.strokeStyle = l.color || 'rgba(255,255,255,.28)';
            ctx.beginPath();
            ctx.moveTo(X(a.x), Y(a.y));
            for (const p of l.points) ctx.lineTo(X(p.x), Y(p.y));
            ctx.lineTo(X(z.x), Y(z.y));
            ctx.stroke();
        }

        // плитки (рамки-группы — полупрозрачные, под остальными)
        const list = [...Board.tiles.values()].sort((a, c) => (a.def.body === 'group' ? -1 : 0) - (c.def.body === 'group' ? -1 : 0));
        for (const t of list) {
            const w = Math.max(2, t.w * s), h = Math.max(1.5, t.h * s);
            const group = t.def.body === 'group';
            ctx.globalAlpha = group ? 0.18 : Board.isSelected(t.id) ? 1 : 0.72;
            ctx.fillStyle = t.color || Nodes.colorOf(t.def);
            rr(X(t.x), Y(t.y), w, h, Math.min(3, w / 4));
            ctx.fill();
            if (Board.isSelected(t.id)) {
                ctx.globalAlpha = 1;
                ctx.strokeStyle = '#fff';
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 1;

        // магниты (круг действия) и таргеты (крестик)
        for (const m of Board.magnets.values()) {
            ctx.beginPath();
            ctx.arc(X(m.x), Y(m.y), Math.max(2, m.r * s), 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,69,58,.12)';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(X(m.x), Y(m.y), Math.max(1.5, 10 * s), 0, Math.PI * 2);
            ctx.fillStyle = m.color || '#FF453A';
            ctx.fill();
        }
        ctx.lineWidth = 1.2;
        for (const g of Board.targets.values()) {
            const r = Math.max(2.5, 14 * s);
            ctx.strokeStyle = g.color || '#F5F5F7';
            ctx.beginPath();
            ctx.moveTo(X(g.x) - r, Y(g.y));
            ctx.lineTo(X(g.x) + r, Y(g.y));
            ctx.moveTo(X(g.x), Y(g.y) - r);
            ctx.lineTo(X(g.x), Y(g.y) + r);
            ctx.stroke();
        }

        // рамка текущего вида
        const v = Board.visibleRect();
        rr(X(v.x), Y(v.y), v.w * s, v.h * s, 4);
        ctx.fillStyle = 'rgba(255,255,255,.07)';
        ctx.fill();
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = 'rgba(255,255,255,.85)';
        ctx.stroke();
    }

    function mapToWorld(e) {
        const r = canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left - mapXf.ox) / mapXf.s, y: (e.clientY - r.top - mapXf.oy) / mapXf.s };
    }

    function onMapDown(e) {
        if (e.button !== 0 || !mapXf) return;
        e.preventDefault();
        // второй палец — щипок: масштаб самой доски
        if (e.pointerType === 'touch') {
            mapTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (mapTouches.size === 2) {
                mapDrag = false;
                mapPinch = { d: touchDist(mapTouches) };
                return;
            }
        }
        try { canvas.setPointerCapture(e.pointerId); } catch { /* синтетические события */ }
        mapFrozen = mapBounds();     // пока тянем, масштаб миникарты не прыгает
        mapDrag = true;
        const w = mapToWorld(e);
        Board.flyTo(w.x, w.y, Board.view.k, 260);
    }

    function onMapMove(e) {
        if (pinchMove(e, mapTouches, mapPinch, d => {
            Board.zoomBy(d / mapPinch.d);
            mapPinch.d = d;
        })) return;
        if (!mapDrag) return;
        const w = mapToWorld(e);
        Board.centerOn(w.x, w.y);
    }

    function onMapUp(e) {
        mapTouches.delete(e.pointerId);
        if (mapTouches.size < 2) mapPinch = null;
        if (!mapDrag) return;
        mapDrag = false;
        mapFrozen = null;
        queueMap();
    }

    return { init, layout };
})();
