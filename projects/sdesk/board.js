/* Short Desk — доска: панорама и масштаб, плитки, линии, выделение, таргеты и магниты.

   Почему так устроено:
   • Плитки — обычные DOM-элементы. Только так у них работает backdrop-filter
     (стекло), поля ввода, выпадающие списки и чёткий текст.
   • Линии — один SVG-слой ПОД плитками. SVG сам отвечает за попадание мышью
     по линии и по точкам изгиба, а перерисовывается только та линия, которая
     изменилась (кадр собирается через requestAnimationFrame).
   • Плитки, таргеты, магниты и SVG лежат внутри одного «мира» (#world). Панорама
     и масштаб — это одна CSS-трансформация мира, поэтому при движении доски ничего
     не перерисовывается заново, даже если на ней 100+ элементов.

   Таргет — метка-прицел: просто точка на доске с именем и цветом.
   Магнит — «гнездо» в точке доски с радиусом. Линии от плиток к магниту делают их
   партнёрами магнита. Ближайшая к центру плитка в круге (кроме самих партнёров)
   автоматически соединяется со всеми партнёрами: партнёр → магнит превращается в
   партнёр → плитка, магнит → партнёр превращается в плитка → партнёр. Ушла из
   круга — автосвязи исчезают. Автосвязи пунктирные и не сохраняются: при загрузке
   они строятся заново по положениям. */
const Board = (() => {
    const GRID = 24;            // шаг сетки (px мира)
    const MIN_K = 0.15, MAX_K = 2.5;
    const CLICK_SLOP = 4;       // сдвиг (px экрана), после которого нажатие — уже перетаскивание
    const SNAP_RADIUS = 24;     // радиус «прилипания» линии к контакту (px экрана)
    const GAP = 24;             // зазор между объектами при поиске свободного места
    const MAGNET_R = 90;        // радиус магнита по умолчанию
    const MAGNET_PORT = 30;     // контакты магнита — слева и справа от центра
    // габариты таргета и магнита вокруг их центра (для свободного места и рамки доски)
    const ITEM_BOX = { target: { l: 24, t: 24, w: 48, h: 64 }, magnet: { l: 42, t: 28, w: 84, h: 72 } };

    const tiles = new Map();    // id → плитка
    const targets = new Map();  // id → таргет
    const magnets = new Map();  // id → магнит
    const links = new Map();    // id → линия
    const byNode = new Map();   // id плитки или магнита → Set(id линий)
    const sel = { tiles: new Set(), items: new Set(), points: new Set() };   // точки: 'idЛинии/idТочки'
    const view = { x: 0, y: 0, k: 1 };
    const insets = { bottom: 0 };
    const listeners = {};
    const settings = Object.assign({ grid: true, snap: false, speed: 'fast', stepLimit: 1000 }, readJSON('sdesk_settings'));

    let boardEl, worldEl, svgEl, linkLayer, tempPath, tilesEl, itemsEl, rectEl, ro;
    let seq = 1, zTop = 1, dirty = false;
    let selLink = null;
    let gesture = null;         // текущее нажатие мыши
    let wire = null;            // линия, которую тянут от контакта
    let linking = false;        // режим «клик по контакту → клик по другому контакту»
    let picking = null;         // режим «выбрать объект на доске» для полей плиток
    let tween = 0, moveTimer = 0, magTimer = 0;
    // сенсорный экран: пальцы на доске, щипок для масштаба и таймер долгого нажатия
    const touches = new Map();
    let pinch = null, pressTimer = 0;
    const LONG_PRESS = 480, TOUCH_SLOP = 10;
    const dirtyLinks = new Set();
    let frameQueued = false, geometryChanged = false, selectionQueued = false, refsQueued = false;

    /* ---------- Мелкие помощники ---------- */
    function readJSON(key) {
        try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
    }
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const uid = p => p + (seq++).toString(36);
    const r1 = n => Math.round(n * 10) / 10;
    const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const nodeOf = id => tiles.get(id) || magnets.get(id) || null;
    const itemOf = id => targets.get(id) || magnets.get(id) || null;

    function svgNode(tag, attrs = {}) {
        const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const k in attrs) n.setAttribute(k, attrs[k]);
        return n;
    }

    function div(cls) {
        const d = document.createElement('div');
        d.className = cls;
        return d;
    }

    function on(name, fn) { (listeners[name] ||= []).push(fn); }
    function emit(name, data) { (listeners[name] || []).forEach(fn => fn(data)); }

    /* ---------- Запуск ---------- */
    function init() {
        boardEl = document.getElementById('board');
        worldEl = document.getElementById('world');
        svgEl = document.getElementById('links');
        tilesEl = document.getElementById('tiles');
        itemsEl = document.getElementById('items');
        rectEl = document.getElementById('selRect');

        linkLayer = svgNode('g', { class: 'link-layer' });
        tempPath = svgNode('path', { class: 'link-temp' });
        svgEl.append(linkLayer, tempPath);

        ro = new ResizeObserver(onTileResize);

        boardEl.addEventListener('pointerdown', onDown);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        boardEl.addEventListener('wheel', onWheel, { passive: false });
        // клик мимо доски отменяет протягивание линии и выбор объекта
        window.addEventListener('pointerdown', e => {
            if (boardEl.contains(e.target)) return;
            if (linking) stopWire();
            if (picking) cancelPick();
        }, true);
        window.addEventListener('resize', () => applyView());

        boardEl.classList.toggle('no-grid', !settings.grid);
        applyView();
    }

    /* ---------- Вид: панорама и масштаб ---------- */
    function applyView() {
        worldEl.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
        let g = GRID * view.k;
        while (g < 12) g *= 4;
        boardEl.style.backgroundSize = `${g}px ${g}px`;
        boardEl.style.backgroundPosition = `${view.x}px ${view.y}px`;
        // на время движения мир становится отдельным слоем — так панорама дешевле
        worldEl.classList.add('moving');
        clearTimeout(moveTimer);
        moveTimer = setTimeout(() => worldEl.classList.remove('moving'), 160);
        emit('view');
    }

    const screenToWorld = (cx, cy) => ({ x: (cx - view.x) / view.k, y: (cy - view.y) / view.k });
    const worldToScreen = (wx, wy) => ({ x: wx * view.k + view.x, y: wy * view.k + view.y });
    const viewportCenter = () => ({ x: innerWidth / 2, y: (innerHeight - insets.bottom) / 2 });

    function visibleRect() {
        const a = screenToWorld(0, 0), b = screenToWorld(innerWidth, innerHeight - insets.bottom);
        return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    }
    function visibleCenter() {
        const c = viewportCenter();
        return screenToWorld(c.x, c.y);
    }

    function zoomAt(cx, cy, k) {
        k = clamp(k, MIN_K, MAX_K);
        const w = screenToWorld(cx, cy);
        view.k = k;
        view.x = cx - w.x * k;
        view.y = cy - w.y * k;
        applyView();
    }

    function stopTween() {
        cancelAnimationFrame(tween);
        tween = 0;
    }

    // Мгновенно поставить точку мира в центр экрана
    function centerOn(wx, wy, k = view.k) {
        stopTween();
        const c = viewportCenter();
        view.k = clamp(k, MIN_K, MAX_K);
        view.x = c.x - wx * view.k;
        view.y = c.y - wy * view.k;
        applyView();
    }

    // Плавный перелёт камеры: центр и масштаб меняются одновременно
    function flyTo(wx, wy, k = view.k, ms = 520) {
        stopTween();
        k = clamp(k, MIN_K, MAX_K);
        const c = viewportCenter();
        const from = screenToWorld(c.x, c.y), lk0 = Math.log(view.k), lk1 = Math.log(k);
        const t0 = performance.now();
        const step = now => {
            const t = Math.min(1, (now - t0) / ms);
            const e = ease(t);
            const kk = Math.exp(lk0 + (lk1 - lk0) * e);
            const x = from.x + (wx - from.x) * e, y = from.y + (wy - from.y) * e;
            view.k = kk;
            view.x = c.x - x * kk;
            view.y = c.y - y * kk;
            applyView();
            tween = t < 1 ? requestAnimationFrame(step) : 0;
        };
        tween = requestAnimationFrame(step);
    }

    function home() { centerOn(0, 0, 1); }

    function itemBox(it) {
        const b = ITEM_BOX[it.kind];
        return { x: it.x - b.l, y: it.y - b.t, w: b.w, h: b.h };
    }

    // Прямоугольники всех объектов доски (плитки, таргеты, магниты).
    // noGroups — без рамок-групп: в них можно ставить новые плитки.
    function* boxes(noGroups) {
        for (const t of tiles.values()) {
            if (!noGroups || t.def.body !== 'group') yield { x: t.x, y: t.y, w: t.w, h: t.h };
        }
        for (const it of targets.values()) yield itemBox(it);
        for (const it of magnets.values()) yield itemBox(it);
    }

    function contentBounds() {
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        for (const b of boxes()) {
            x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
            x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
        }
        for (const l of links.values()) for (const p of l.points) {
            x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y);
            x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y);
        }
        return x1 === Infinity ? null : { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }

    function fitAll() {
        const b = contentBounds();
        if (!b) { flyTo(0, 0, 1); return; }
        const W = innerWidth - 120, H = innerHeight - insets.bottom - 120;
        const k = clamp(Math.min(W / Math.max(b.w, 1), H / Math.max(b.h, 1), 1.25), MIN_K, MAX_K);
        flyTo(b.x + b.w / 2, b.y + b.h / 2, k);
    }

    function zoomTo(k) {
        const c = visibleCenter();
        flyTo(c.x, c.y, k, 360);
    }

    // Масштаб вокруг центра экрана (колесо над миникартой)
    function zoomBy(factor) {
        stopTween();
        const c = viewportCenter();
        zoomAt(c.x, c.y, view.k * factor);
    }

    function setInsets(o) {
        Object.assign(insets, o);
        emit('view');
    }

    /* ---------- Плитки ---------- */
    function hooks() {
        return {
            onField: fieldChanged,
            onRun: tile => emit('run', tile.id),
            onPick: tile => emit('pick', tile.id),
            onPickRef: async (tile, key, accept) => {
                const ref = await pickRef(accept, tile.id);
                if (ref && tiles.has(tile.id)) {
                    Nodes.setField(tile, key, ref);
                    fieldChanged();
                }
            }
        };
    }

    function addTile(type, o = {}) {
        const def = Nodes.get(type);
        if (!def) return null;
        const fields = Nodes.defaults(def, o.fields);
        const group = def.body === 'group';
        const t = {
            id: o.id || uid('t'), type, def,
            x: 0, y: 0, w: fields.gw || def.width, h: group ? fields.gh : Nodes.estimateHeight(def),
            name: o.name || '', color: o.color || null, fields, portPos: {},
            // встроенный файл медиаплитки: id в Storage, исходное имя и сведения из сохранённой доски
            asset: def.media ? o.asset || null : null, fileName: o.fileName || '', assetMeta: o.assetMeta || null
        };
        if (o.x != null && o.y != null) {
            t.x = o.x;
            t.y = o.y;
        } else {
            const near = o.at || visibleCenter();
            const p = freeSpot(t.w, t.h, near.x, near.y);
            t.x = p.x;
            t.y = p.y;
            if (settings.snap) {
                t.x = Math.round(t.x / GRID) * GRID;
                t.y = Math.round(t.y / GRID) * GRID;
            }
        }
        buildTile(t);
        tiles.set(t.id, t);
        byNode.set(t.id, new Set());
        if (o.log && t.logEl) Nodes.logRestore(t, o.log);
        measureTile(t);
        if (o.animate) {
            t.el.classList.add('entering');
            setTimeout(() => t.el.classList.remove('entering'), 460);
        }
        if (o.select) selectTiles([t.id]);
        emit('tiles');
        objectsChanged();
        changed();
        requestMagnets();
        return t;
    }

    function buildTile(t) {
        const el = document.createElement('div');
        el.className = 'tile';
        el.dataset.id = t.id;
        el.dataset.node = t.id;
        const { card, ports } = Nodes.build(t, hooks());
        el.append(card);
        t.el = el;
        t.card = card;
        t.portEls = ports;
        // рамка-группа всегда лежит под остальными плитками
        if (t.def.body === 'group') el.classList.add('group');
        el.style.zIndex = t.def.body === 'group' ? 0 : ++zTop;
        paintTile(t);
        placeTile(t);
        tilesEl.append(el);
        ro.observe(card);
        if (t.def.refs) Nodes.refreshRefs(t);
    }

    // Пересобрать содержимое плитки (например, после замены настроек)
    function rebuildCard(t) {
        ro.unobserve(t.card);
        const { card, ports } = Nodes.build(t, hooks());
        t.card.replaceWith(card);
        t.card = card;
        t.portEls = ports;
        if (t.def.refs) Nodes.refreshRefs(t);
        portStates(t);
        measureTile(t);
        touchNodeLinks(t.id);
        ro.observe(card);
    }

    function setTileFields(id, fields) {
        const t = tiles.get(id);
        if (!t) return;
        t.fields = Nodes.defaults(t.def, JSON.parse(JSON.stringify(fields)));
        rebuildCard(t);
        changed();
    }

    function paintTile(t) {
        t.el.classList.toggle('tinted', !!t.color);
        if (t.color) t.el.style.setProperty('--tint', t.color);
        else t.el.style.removeProperty('--tint');
        Nodes.setTitle(t);
    }

    function placeTile(t) {
        t.el.style.transform = `translate(${t.x}px, ${t.y}px)`;
    }

    // Положение контактов внутри плитки. offsetLeft/Top не зависят от
    // CSS-трансформаций, поэтому замер верен даже во время анимации появления.
    function measureTile(t) {
        t.w = t.card.offsetWidth;
        t.h = t.card.offsetHeight;
        for (const id in t.portEls) {
            const p = t.portEls[id];
            let x = p.offsetWidth / 2, y = p.offsetHeight / 2;
            for (let n = p; n && n !== t.el; n = n.offsetParent) {
                x += n.offsetLeft;
                y += n.offsetTop;
            }
            t.portPos[id] = { x, y };
        }
    }

    function onTileResize(entries) {
        for (const en of entries) {
            const t = tiles.get(en.target.parentElement && en.target.parentElement.dataset.id);
            if (!t) continue;
            measureTile(t);
            touchNodeLinks(t.id);
        }
        geometryChanged = true;
        queueFrame();
    }

    function fieldChanged() {
        dirty = true;
        emit('fields');
        emit('change');
    }

    // Что-то поменялось не через доску (например, журнал «Вывода») — пусть сохранится
    function noteChange() {
        emit('change');
    }

    function raise(id) {
        const t = tiles.get(id);
        if (t && t.def.body !== 'group') t.el.style.zIndex = ++zTop;
    }

    // Новый порядок плиток — в нём они идут в нижней панели и сохраняются в файл.
    // Плитки, которых нет в списке, остаются в конце. false — порядок не изменился.
    function reorderTiles(ids) {
        const next = new Map();
        for (const id of ids) if (tiles.has(id)) next.set(id, tiles.get(id));
        for (const [id, t] of tiles) if (!next.has(id)) next.set(id, t);
        const old = [...tiles.keys()];
        if ([...next.keys()].every((id, i) => id === old[i])) return false;
        tiles.clear();
        for (const [id, t] of next) tiles.set(id, t);
        emit('tiles');
        changed();
        return true;
    }

    // Рамка «Группа» (или «Блок» — type = 'block') вокруг выделенного
    function groupSelection(type = 'group') {
        const list = [...sel.tiles].map(id => tiles.get(id)).filter(t => t && t.def.body !== 'group')
            .map(t => ({ x: t.x, y: t.y, w: t.w, h: t.h }));
        for (const id of sel.items) list.push(itemBox(itemOf(id)));
        if (!list.length) return null;
        const b = boundsOf(list);
        const g = addTile(type, {
            x: b.x - 28, y: b.y - 64, animate: true,
            fields: { gw: Math.round(b.w + 56), gh: Math.round(b.h + 92) }
        });
        selectTiles([g.id]);
        return g;
    }

    function resizeGroup(t, w, h) {
        if (t.def.body === 'web') { Web.resize(t, w, h); return; }
        if (t.def.body === 'heading') {
            // у заголовка меняется только ширина
            t.fields.gw = Math.min(2400, Math.max(160, Math.round(w)));
            t.card.style.width = t.fields.gw + 'px';
            return;
        }
        t.fields.gw = Math.max(200, Math.round(w));
        t.fields.gh = Math.max(120, Math.round(h));
        t.card.style.width = t.fields.gw + 'px';
        t.card.style.height = t.fields.gh + 'px';
    }

    function removeTiles(ids) {
        let n = 0;
        for (const id of ids) {
            const t = tiles.get(id);
            if (!t) continue;
            for (const lid of [...byNode.get(id)]) removeLink(lid, { silent: true });
            tiles.delete(id);
            byNode.delete(id);
            sel.tiles.delete(id);
            ro.unobserve(t.card);
            t.el.classList.remove('entering', 'flash', 'selected');
            t.el.classList.add('leaving');
            setTimeout(() => t.el.remove(), 240);
            n++;
        }
        if (n) {
            emit('tiles');
            emit('selection');
            objectsChanged();
            changed();
            requestMagnets();
        }
        return n;
    }

    function clear() {
        removeTiles([...tiles.keys()]);
        removeItems([...targets.keys(), ...magnets.keys()]);
        dirty = false;
    }

    function renameTile(id, name) {
        const t = tiles.get(id);
        if (!t) return;
        name = String(name || '').trim();
        t.name = name === t.def.title ? '' : name;
        Nodes.setTitle(t);
        emit('tiles');
        objectsChanged();
        changed();
    }

    function setTileColor(ids, hex) {
        for (const id of ids) {
            const t = tiles.get(id);
            if (t) {
                t.color = hex || null;
                paintTile(t);
            }
            const it = itemOf(id);
            if (it) {
                it.color = hex || null;
                paintItem(it);
            }
        }
        emit('tiles');
        emit('items');
        changed();
    }

    // Положить в медиаплитку другой файл
    function setTileAsset(id, assetId, fileName) {
        const t = tiles.get(id);
        if (!t || !t.def.media) return;
        t.asset = assetId;
        t.fileName = fileName || '';
        t.assetMeta = null;
        Nodes.renderMedia(t);
        emit('tiles');
        changed();
    }

    function linksOf(id) {
        return [...(byNode.get(id) || [])].map(lid => links.get(lid));
    }

    function disconnect(id) {
        for (const lid of [...(byNode.get(id) || [])]) removeLink(lid, { silent: true });
        changed();
        requestMagnets();
    }

    function flash(id) {
        const t = tiles.get(id);
        if (!t) return;
        t.el.classList.remove('flash', 'entering');
        void t.el.offsetWidth;
        t.el.classList.add('flash');
        clearTimeout(t.flashTimer);
        t.flashTimer = setTimeout(() => t.el.classList.remove('flash'), 1400);
    }

    function focusTile(id) {
        const t = tiles.get(id);
        if (!t) return;
        raise(id);
        flyTo(t.x + t.w / 2, t.y + t.h / 2, view.k < 0.6 ? 1 : view.k);
        setTimeout(() => flash(id), 420);
    }

    // Копия плиток, таргетов и магнитов в ближайшем свободном месте — вместе с линиями между ними
    function duplicate(ids, itemIds = []) {
        const src = ids.map(id => tiles.get(id)).filter(Boolean);
        const srcItems = itemIds.map(itemOf).filter(Boolean);
        if (!src.length && !srcItems.length) return [];
        const all = [...src.map(t => ({ x: t.x, y: t.y, w: t.w, h: t.h })), ...srcItems.map(itemBox)];
        const b = boundsOf(all);
        const spot = freeSpot(b.w, b.h, b.x + b.w / 2, b.y + b.h / 2);
        const dx = spot.x - b.x, dy = spot.y - b.y;
        const map = new Map(), refMap = new Map();
        for (const t of src) {
            const c = addTile(t.type, {
                x: t.x + dx, y: t.y + dy, name: t.name, color: t.color,
                fields: JSON.parse(JSON.stringify(t.fields)), animate: true,
                asset: t.asset, fileName: t.fileName, assetMeta: t.assetMeta
            });
            map.set(t.id, c.id);
            refMap.set('t:' + t.id, 't:' + c.id);
        }
        const freshItems = [];
        for (const it of srcItems) {
            const o = { x: it.x + dx, y: it.y + dy, color: it.color, animate: true };
            const c = it.kind === 'target' ? addTarget(o) : addMagnet({ ...o, r: it.r });
            map.set(it.id, c.id);
            refMap.set((it.kind === 'target' ? 'g:' : 'm:') + it.id, (it.kind === 'target' ? 'g:' : 'm:') + c.id);
            freshItems.push(c.id);
        }
        for (const l of [...links.values()]) {
            if (l.auto || !map.has(l.from.tile) || !map.has(l.to.tile)) continue;
            const c = addLink(
                { tile: map.get(l.from.tile), port: l.from.port },
                { tile: map.get(l.to.tile), port: l.to.port },
                { points: l.points.map(p => ({ x: p.x + dx, y: p.y + dy })), bend: l.bend, color: l.color, animate: true }
            );
            if (c) l.points.forEach((p, i) => refMap.set(`p:${l.id}/${p.id}`, `p:${c.id}/${c.points[i].id}`));
        }
        // ссылки внутри копии ведут на копии, остальные — на те же объекты
        remapRefs([...map.values()].filter(id => tiles.has(id)), refMap, false);
        const fresh = [...map.values()].filter(id => tiles.has(id));
        selectObjects({ tiles: fresh, items: freshItems });
        return fresh;
    }

    function boundsOf(list) {
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        for (const t of list) {
            x1 = Math.min(x1, t.x); y1 = Math.min(y1, t.y);
            x2 = Math.max(x2, t.x + t.w); y2 = Math.max(y2, t.y + t.h);
        }
        return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }

    // Свободное место для прямоугольника w×h как можно ближе к точке (cx, cy):
    // перебираем кольца вокруг точки, пока не найдём место без пересечений.
    function freeSpot(w, h, cx, cy) {
        const step = 32;
        const x0 = cx - w / 2, y0 = cy - h / 2;
        const list = [...boxes(true)];
        const overlaps = (x, y) => list.some(b => x < b.x + b.w + GAP && x + w + GAP > b.x && y < b.y + b.h + GAP && y + h + GAP > b.y);
        for (let r = 0; r <= 80; r++) {
            const cands = [];
            if (r === 0) cands.push([0, 0]);
            else {
                for (let i = -r; i <= r; i++) {
                    cands.push([i, -r], [i, r]);
                    if (i > -r && i < r) cands.push([-r, i], [r, i]);
                }
                // ближе — лучше; при равенстве — правее, потом ниже (программа читается слева направо)
                cands.sort((p, q) => (p[0] * p[0] + p[1] * p[1]) - (q[0] * q[0] + q[1] * q[1]) || q[0] - p[0] || q[1] - p[1]);
            }
            for (const [i, j] of cands) {
                const x = x0 + i * step, y = y0 + j * step;
                if (!overlaps(x, y)) return { x, y };
            }
        }
        return { x: x0, y: y0 };
    }

    /* ---------- Таргеты и магниты ---------- */
    // Следующее свободное имя: «Таргет 1», «Таргет 2»…
    function nextName(map, base) {
        let max = 0;
        for (const it of map.values()) {
            const m = new RegExp('^' + base + ' (\\d+)$').exec(it.name);
            if (m) max = Math.max(max, Number(m[1]));
        }
        return `${base} ${max + 1}`;
    }

    function itemSpot(kind, at) {
        const b = ITEM_BOX[kind];
        const near = at || visibleCenter();
        const p = freeSpot(b.w, b.h, near.x, near.y);
        return { x: p.x + b.l, y: p.y + b.t };
    }

    function addTarget(o = {}) {
        const p = o.x != null ? { x: o.x, y: o.y } : itemSpot('target', o.at);
        const g = {
            id: o.id || uid('g'), kind: 'target', x: p.x, y: p.y,
            name: o.name || nextName(targets, 'Таргет'), color: o.color || null
        };
        buildItem(g);
        targets.set(g.id, g);
        finishItem(g, o);
        return g;
    }

    function addMagnet(o = {}) {
        const p = o.x != null ? { x: o.x, y: o.y } : itemSpot('magnet', o.at);
        const m = {
            id: o.id || uid('m'), kind: 'magnet', x: p.x, y: p.y, r: clamp(Number(o.r) || MAGNET_R, 20, 3000),
            name: o.name || nextName(magnets, 'Магнит'), color: o.color || null, captured: null,
            portPos: { in: { x: -MAGNET_PORT, y: 0 }, out: { x: MAGNET_PORT, y: 0 } }
        };
        buildItem(m);
        magnets.set(m.id, m);
        byNode.set(m.id, new Set());
        finishItem(m, o);
        requestMagnets();
        return m;
    }

    function finishItem(it, o) {
        if (o.animate) {
            it.el.classList.add('entering');
            setTimeout(() => it.el.classList.remove('entering'), 460);
        }
        if (o.select) selectObjects({ items: [it.id] });
        emit('items');
        objectsChanged();
        changed();
    }

    function buildItem(it) {
        const el = div('item ' + it.kind);
        el.dataset.item = it.id;
        if (it.kind === 'target') {
            const mark = div('tg-mark');
            mark.innerHTML = UI.svg('target');
            el.append(mark);
        } else {
            el.dataset.node = it.id;
            const radius = div('mg-radius');
            const body = div('mg-body');
            body.innerHTML = UI.svg('magnet');
            const port = (dir, title) => {
                const p = document.createElement('span');
                p.className = 'port ' + dir;
                p.dataset.port = dir;
                p.dataset.dir = dir;
                p.title = title;
                return p;
            };
            it.portEls = {
                in: port('in', 'Партнёры, которые передают данные плитке в гнезде'),
                out: port('out', 'Партнёры, которым плитка в гнезде передаёт данные')
            };
            const handle = div('mg-handle');
            handle.title = 'Потяните, чтобы изменить радиус';
            it.radiusEl = radius;
            it.handleEl = handle;
            el.append(radius, body, it.portEls.in, it.portEls.out, handle);
        }
        const label = div('item-label');
        el.append(label);
        it.labelEl = label;
        it.el = el;
        paintItem(it);
        placeItem(it);
        itemsEl.append(el);
    }

    function paintItem(it) {
        it.labelEl.textContent = it.name;
        it.el.classList.toggle('tinted', !!it.color);
        if (it.color) it.el.style.setProperty('--ic', it.color);
        else it.el.style.removeProperty('--ic');
        if (it.kind === 'magnet') {
            it.el.style.setProperty('--r', it.r + 'px');
        }
    }

    function placeItem(it) {
        it.el.style.transform = `translate(${it.x}px, ${it.y}px)`;
    }

    function removeItems(ids) {
        let n = 0;
        for (const id of ids) {
            const it = itemOf(id);
            if (!it) continue;
            if (it.kind === 'magnet') {
                for (const lid of [...byNode.get(id)]) removeLink(lid, { silent: true });
                for (const l of [...links.values()]) if (l.auto === id) removeLink(l.id, { silent: true });
                magnets.delete(id);
                byNode.delete(id);
            } else {
                targets.delete(id);
            }
            sel.items.delete(id);
            it.el.classList.add('leaving');
            setTimeout(() => it.el.remove(), 240);
            n++;
        }
        if (n) {
            emit('items');
            emit('selection');
            objectsChanged();
            changed();
        }
        return n;
    }

    function renameItem(id, name) {
        const it = itemOf(id);
        if (!it) return;
        it.name = String(name || '').trim() || nextName(it.kind === 'target' ? targets : magnets, it.kind === 'target' ? 'Таргет' : 'Магнит');
        paintItem(it);
        emit('items');
        objectsChanged();
        changed();
    }

    function setMagnetRadius(id, r) {
        const m = magnets.get(id);
        if (!m) return;
        m.r = clamp(Math.round(r), 20, 3000);
        paintItem(m);
        changed();
        requestMagnets();
    }

    // Магнит ставится на место плитки и сразу действует на неё
    function magnetOnTile(id) {
        const t = tiles.get(id);
        if (!t) return null;
        return addMagnet({
            x: t.x + t.w / 2, y: t.y + t.h / 2, r: Math.max(t.w, t.h) / 2 + 16, animate: true, select: true
        });
    }

    function pulseItem(it) {
        it.el.classList.remove('pulse');
        void it.el.offsetWidth;
        it.el.classList.add('pulse');
        clearTimeout(it.pulseTimer);
        it.pulseTimer = setTimeout(() => it.el.classList.remove('pulse'), 900);
    }

    /* ---------- Работа магнитов ---------- */
    // Пересчёт откладывается: цепочка перемещений успеет закончиться,
    // и магниты сработают по итоговым положениям
    function requestMagnets(delay = 0) {
        clearTimeout(magTimer);
        magTimer = setTimeout(updateMagnets, delay);
    }

    const firstPort = (t, dir) => Nodes.ports(t.def)[dir][0] || null;
    const linkKey = (f, t) => `${f.tile}.${f.port}>${t.tile}.${t.port}`;

    function updateMagnets() {
        clearTimeout(magTimer);
        if (gesture && gesture.type === 'move') { requestMagnets(150); return; }
        for (const m of magnets.values()) {
            const partnersIn = [], partnersOut = [], partnerIds = new Set();
            for (const lid of byNode.get(m.id) || []) {
                const l = links.get(lid);
                if (l.to.tile === m.id) { partnersIn.push(l.from); partnerIds.add(l.from.tile); }
                else if (l.from.tile === m.id) { partnersOut.push(l.to); partnerIds.add(l.to.tile); }
            }
            // ближайшая к центру плитка в круге (при равенстве — та, что сверху)
            let best = null, bestD = Infinity, bestZ = -1;
            for (const t of tiles.values()) {
                // партнёры, а также плитки без контактов (комментарии, группы) в гнездо не попадают
                if (partnerIds.has(t.id) || !Object.keys(t.portEls).length) continue;
                const d = Math.hypot(t.x + t.w / 2 - m.x, t.y + t.h / 2 - m.y);
                if (d > m.r) continue;
                const z = Number(t.el.style.zIndex) || 0;
                if (d < bestD - 0.5 || (Math.abs(d - bestD) <= 0.5 && z > bestZ)) { best = t; bestD = d; bestZ = z; }
            }
            const want = [];
            if (best) {
                const inP = firstPort(best, 'in'), outP = firstPort(best, 'out');
                if (inP) for (const p of partnersIn) want.push({ from: p, to: { tile: best.id, port: inP } });
                if (outP) for (const q of partnersOut) want.push({ from: { tile: best.id, port: outP }, to: q });
            }
            const wantKeys = new Set(want.map(w => linkKey(w.from, w.to)));
            const have = [...links.values()].filter(l => l.auto === m.id);
            for (const l of have) if (!wantKeys.has(linkKey(l.from, l.to))) removeLink(l.id, { silent: true });
            const haveKeys = new Set(have.map(l => linkKey(l.from, l.to)));
            let added = 0;
            for (const w of want) {
                if (!haveKeys.has(linkKey(w.from, w.to)) && addLink(w.from, w.to, { auto: m.id, animate: true })) added++;
            }
            const captured = best ? best.id : null;
            const moved = captured !== m.captured;
            m.captured = captured;
            m.el.classList.toggle('busy', !!captured);
            if (captured && (moved || added)) {
                pulseItem(m);
                flash(captured);
            }
        }
        geometryChanged = true;
        queueFrame();
    }

    /* ---------- Ссылки на объекты (поля «Что», «Куда», «Где» у плиток) ----------
       Значение поля — строка: 't:id' плитка, 'g:id' таргет, 'p:idЛинии/idТочки' точка линии,
       '@xy' — координаты из полей X и Y. */
    function resolveRef(ref) {
        if (typeof ref !== 'string' || ref.length < 3) return null;
        const id = ref.slice(2);
        if (ref[0] === 't') { const t = tiles.get(id); return t ? { kind: 'tile', obj: t } : null; }
        if (ref[0] === 'g') { const g = targets.get(id); return g ? { kind: 'target', obj: g } : null; }
        if (ref[0] === 'm') { const m = magnets.get(id); return m ? { kind: 'magnet', obj: m } : null; }
        if (ref[0] === 'p') {
            const [lid, pid] = id.split('/');
            const l = links.get(lid);
            const p = l && l.points.find(q => q.id === pid);
            return p ? { kind: 'point', obj: p, link: l } : null;
        }
        return null;
    }

    function refCenter(ref) {
        const r = resolveRef(ref);
        if (!r) return null;
        if (r.kind === 'tile') return { x: r.obj.x + r.obj.w / 2, y: r.obj.y + r.obj.h / 2 };
        return { x: r.obj.x, y: r.obj.y };
    }

    // Подписи плиток: одинаковые имена получают номер — «Сложить (2)»
    function tileLabels() {
        const count = new Map(), seen = new Map(), labels = new Map();
        for (const t of tiles.values()) {
            const n = Nodes.titleOf(t);
            count.set(n, (count.get(n) || 0) + 1);
        }
        for (const t of tiles.values()) {
            const n = Nodes.titleOf(t);
            const i = (seen.get(n) || 0) + 1;
            seen.set(n, i);
            labels.set(t.id, count.get(n) > 1 ? `${n} (${i})` : n);
        }
        return labels;
    }

    function refLabel(ref) {
        const r = resolveRef(ref);
        if (!r) return ref === '@xy' ? 'координаты' : '';
        if (r.kind === 'tile') return tileLabels().get(r.obj.id);
        if (r.kind === 'point') {
            const labels = tileLabels();
            const a = r.link.from.tile, b = r.link.to.tile;
            const name = id => labels.get(id) || (magnets.get(id) || {}).name || '?';
            return `${name(a)} → ${name(b)} · точка ${r.link.points.indexOf(r.obj) + 1}`;
        }
        return r.obj.name;
    }

    // Варианты для выпадающего списка: [{ group, items: [[значение, подпись]] }]
    function refOptions(accept, selfId) {
        const groups = [];
        if (accept.includes('xy')) groups.push({ group: '', items: [['@xy', 'координаты X, Y']] });
        if (accept.includes('target') && targets.size) {
            groups.push({ group: 'Таргеты', items: [...targets.values()].map(g => ['g:' + g.id, g.name]) });
        }
        if (accept.includes('tile')) {
            const labels = tileLabels();
            const items = [...tiles.values()].filter(t => t.id !== selfId).map(t => ['t:' + t.id, labels.get(t.id)]);
            if (items.length) groups.push({ group: 'Плитки', items });
        }
        if (accept.includes('point')) {
            const items = [];
            for (const l of links.values()) for (const p of l.points) {
                const ref = `p:${l.id}/${p.id}`;
                items.push([ref, refLabel(ref)]);
            }
            if (items.length) groups.push({ group: 'Точки линий', items });
        }
        return groups;
    }

    function setRefCenter(r, x, y) {
        if (r.kind === 'tile') {
            r.obj.x = x - r.obj.w / 2;
            r.obj.y = y - r.obj.h / 2;
            placeTile(r.obj);
            touchNodeLinks(r.obj.id);
        } else if (r.kind === 'point') {
            r.obj.x = x;
            r.obj.y = y;
            touch(r.link);
        } else {
            r.obj.x = x;
            r.obj.y = y;
            placeItem(r.obj);
            if (r.kind === 'magnet') touchNodeLinks(r.obj.id);
        }
        geometryChanged = true;
        queueFrame();
    }

    // Плавно перенести объект центром в точку (x, y). Promise выполнится в конце движения.
    function moveRef(ref, x, y, ms = 0) {
        const r = resolveRef(ref);
        if (!r) return Promise.resolve(false);
        if (r.kind === 'tile') raise(r.obj.id);
        const from = refCenter(ref);
        return new Promise(resolve => {
            let finished = false;
            const done = () => {
                if (finished) return;
                finished = true;
                setRefCenter(r, x, y);
                changed();
                resolve(true);
            };
            if (!(ms > 0)) { done(); return; }
            const t0 = performance.now();
            const step = now => {
                if (finished) return;
                const t = Math.min(1, (now - t0) / ms), e = ease(t);
                setRefCenter(r, from.x + (x - from.x) * e, from.y + (y - from.y) * e);
                if (t < 1) requestAnimationFrame(step); else done();
            };
            requestAnimationFrame(step);
            setTimeout(done, ms + 150);    // если вкладка свёрнута и кадры не рисуются
        });
    }

    // Ссылки в полях скопированных плиток: map 'старая ссылка' → 'новая'.
    // dropMissing — ссылки на объекты не из копии очищаются (так при загрузке чужой доски).
    function remapRefs(ids, map, dropMissing) {
        for (const id of ids) {
            const t = tiles.get(id);
            if (!t || !t.def.refs) continue;
            for (const key of t.def.refs) {
                const v = t.fields[key];
                if (!v || v === '@xy') continue;
                if (map.has(v)) t.fields[key] = map.get(v);
                else if (dropMissing) t.fields[key] = '';
            }
            Nodes.refreshRefs(t);
        }
    }

    // Режим «выберите объект на доске»: следующий клик ЛКМ возвращает ссылку
    function pickRef(accept, selfId) {
        cancelPick();
        return new Promise(resolve => {
            picking = { accept, selfId, resolve };
            boardEl.classList.add('picking');
            const what = accept.filter(a => a !== 'xy').map(a => ({ tile: 'плитку', target: 'таргет', point: 'точку линии' })[a]).join(', ');
            UI.toast(`Кликните на доске: ${what} · ПКМ — отмена`);
        });
    }

    function cancelPick(value = null) {
        if (!picking) return;
        const p = picking;
        picking = null;
        boardEl.classList.remove('picking');
        p.resolve(value);
    }

    function pickClick(e) {
        if (e.button !== 0) { cancelPick(); return; }
        const h = hitTest(e.target);
        let ref = null;
        if ((h.kind === 'tile' || h.kind === 'port') && tiles.has(h.tile)) ref = 't:' + h.tile;
        else if (h.kind === 'target') ref = 'g:' + h.item;
        else if (h.kind === 'point') ref = `p:${h.link}/${h.point}`;
        if (!ref) { cancelPick(); return; }
        const kind = { t: 'tile', g: 'target', p: 'point' }[ref[0]];
        if (!picking.accept.includes(kind) || ref === 't:' + picking.selfId) {
            UI.toast('Этот объект сюда не подходит — выберите другой');
            return;
        }
        cancelPick(ref);
    }

    function objectsChanged() {
        refsQueued = true;
        queueFrame();
    }

    /* ---------- Линии ---------- */
    function findLink(from, to) {
        for (const lid of byNode.get(from.tile) || []) {
            const l = links.get(lid);
            if (l.from.tile === from.tile && l.from.port === from.port && l.to.tile === to.tile && l.to.port === to.port) return l;
        }
        return null;
    }

    function addLink(from, to, o = {}) {
        const A = nodeOf(from.tile), B = nodeOf(to.tile);
        if (!A || !B || A === B) return null;
        if (A.kind === 'magnet' && B.kind === 'magnet') return null;     // гнездо к гнезду не подключается
        if (!A.portEls[from.port] || A.portEls[from.port].dataset.dir !== 'out') return null;
        if (!B.portEls[to.port] || B.portEls[to.port].dataset.dir !== 'in') return null;
        if (findLink(from, to)) return null;
        const l = {
            id: o.id || uid('l'),
            from: { tile: from.tile, port: from.port },
            to: { tile: to.tile, port: to.port },
            points: o.auto ? [] : (o.points || []).map(p => ({ id: uid('p'), x: p.x, y: p.y })),
            bend: o.bend === 'angle' ? 'angle' : 'curve',
            color: o.color || null,
            auto: o.auto || null        // id магнита, если это автосвязь
        };
        buildLink(l);
        links.set(l.id, l);
        byNode.get(A.id).add(l.id);
        byNode.get(B.id).add(l.id);
        portStates(A);
        portStates(B);
        drawLink(l);
        if (o.animate) drawIn(l);
        if (l.points.length) objectsChanged();
        changed();
        if (A.kind === 'magnet' || B.kind === 'magnet') requestMagnets();
        return l;
    }

    function buildLink(l) {
        l.g = svgNode('g', { class: 'link' + (l.auto ? ' auto' : ''), 'data-link': l.id });
        l.hit = svgNode('path', { class: 'link-hit' });
        l.line = svgNode('path', { class: 'link-line' });
        l.flow = svgNode('path', { class: 'link-flow' });
        l.arrow = svgNode('path', { class: 'link-arrow', d: 'M-3.5,-4.5 L2,0 L-3.5,4.5' });
        l.dots = svgNode('g', { class: 'link-dots' });
        l.g.append(l.hit, l.line, l.flow, l.arrow, l.dots);
        paintLink(l);
        linkLayer.append(l.g);
    }

    function paintLink(l) {
        l.g.classList.toggle('tinted', !!l.color);
        if (l.color) l.g.style.setProperty('--c', l.color);
        else l.g.style.removeProperty('--c');
        l.g.classList.toggle('selected', selLink === l.id);
    }

    function portWorld(end) {
        const n = nodeOf(end.tile);
        const p = (n && n.portPos[end.port]) || { x: 0, y: 0 };
        return n ? { x: n.x + p.x, y: n.y + p.y } : p;
    }

    function drawLink(l) {
        const a = portWorld(l.from), b = portWorld(l.to);
        const d = l.bend === 'angle' ? anglePath(a, l.points, b) : curvePath([a, ...l.points, b]);
        l.hit.setAttribute('d', d);
        l.line.setAttribute('d', d);
        l.flow.setAttribute('d', d);

        // стрелка направления — посередине линии
        const len = l.line.getTotalLength();
        l.len = len;
        if (len > 56) {
            const m = l.line.getPointAtLength(len / 2), n = l.line.getPointAtLength(len / 2 + 2);
            const ang = Math.atan2(n.y - m.y, n.x - m.x) * 180 / Math.PI;
            l.arrow.setAttribute('transform', `translate(${r1(m.x)} ${r1(m.y)}) rotate(${r1(ang)})`);
            l.arrow.style.display = '';
        } else {
            l.arrow.style.display = 'none';
        }

        // точки изгиба
        while (l.dots.childElementCount > l.points.length) l.dots.lastChild.remove();
        while (l.dots.childElementCount < l.points.length) l.dots.append(svgNode('circle', { class: 'lp' }));
        l.points.forEach((p, i) => {
            const c = l.dots.children[i];
            c.setAttribute('cx', r1(p.x));
            c.setAttribute('cy', r1(p.y));
            c.dataset.point = p.id;
            c.classList.toggle('selected', sel.points.has(l.id + '/' + p.id));
        });
    }

    // Скруглённые изгибы: плавная кривая через все точки (Catmull-Rom → Безье).
    // У контактов линия всегда выходит и входит горизонтально.
    function curvePath(S) {
        if (S.length === 2) {
            const [a, b] = S;
            const dx = b.x - a.x, dy = Math.abs(b.y - a.y);
            const c = dx >= 0 ? Math.max(30, dx * 0.5) : Math.min(240, 60 + -dx * 0.4 + dy * 0.2);
            return `M${r1(a.x)},${r1(a.y)} C${r1(a.x + c)},${r1(a.y)} ${r1(b.x - c)},${r1(b.y)} ${r1(b.x)},${r1(b.y)}`;
        }
        const last = S.length - 1;
        const dist = (p, q) => Math.hypot(q.x - p.x, q.y - p.y);
        const T = S.map((p, i) => {
            if (i === 0) return { x: Math.max(40, dist(p, S[1])), y: 0 };
            if (i === last) return { x: Math.max(40, dist(S[i - 1], p)), y: 0 };
            // направление — как у Catmull-Rom, длина — средняя длина соседних участков:
            // так изгиб у точки остаётся плавным, даже если соседи близко друг к другу
            const dx = S[i + 1].x - S[i - 1].x, dy = S[i + 1].y - S[i - 1].y;
            const len = Math.hypot(dx, dy) || 1;
            const m = (dist(S[i - 1], p) + dist(p, S[i + 1])) / 2;
            return { x: dx / len * m, y: dy / len * m };
        });
        let d = `M${r1(S[0].x)},${r1(S[0].y)}`;
        for (let i = 0; i < last; i++) {
            const p = S[i], q = S[i + 1];
            d += ` C${r1(p.x + T[i].x / 3)},${r1(p.y + T[i].y / 3)} ${r1(q.x - T[i + 1].x / 3)},${r1(q.y - T[i + 1].y / 3)} ${r1(q.x)},${r1(q.y)}`;
        }
        return d;
    }

    // Прямые углы: горизонталь → вертикаль → горизонталь между соседними точками
    function anglePath(a, pts, b) {
        const STUB = 18;
        const a2 = { x: a.x + STUB, y: a.y }, b2 = { x: b.x - STUB, y: b.y };
        const P = [a, a2];
        if (!pts.length && b2.x < a2.x) {
            // линия идёт «назад» — обходим через середину по высоте
            const my = (a.y + b.y) / 2;
            P.push({ x: a2.x, y: my }, { x: b2.x, y: my }, b2);
        } else {
            const S = [a2, ...pts, b2];
            for (let i = 0; i < S.length - 1; i++) {
                const p = S[i], q = S[i + 1], mx = (p.x + q.x) / 2;
                P.push({ x: mx, y: p.y }, { x: mx, y: q.y }, q);
            }
        }
        P.push(b);
        return polyline(P, 6);
    }

    function polyline(P, radius) {
        // убираем повторы и точки, лежащие на одной прямой с соседями
        const Q = [P[0]];
        for (const p of P.slice(1)) {
            const l = Q[Q.length - 1];
            if (Math.abs(p.x - l.x) < 0.01 && Math.abs(p.y - l.y) < 0.01) continue;
            const k = Q[Q.length - 2];
            if (k) {
                const ux = l.x - k.x, uy = l.y - k.y, vx = p.x - l.x, vy = p.y - l.y;
                if (Math.abs(ux * vy - uy * vx) < 0.01 && ux * vx + uy * vy > 0) Q.pop();
            }
            Q.push(p);
        }
        let d = `M${r1(Q[0].x)},${r1(Q[0].y)}`;
        for (let i = 1; i < Q.length - 1; i++) {
            const p = Q[i - 1], c = Q[i], n = Q[i + 1];
            const l1 = Math.hypot(c.x - p.x, c.y - p.y), l2 = Math.hypot(n.x - c.x, n.y - c.y);
            const r = Math.min(radius, l1 / 2, l2 / 2);
            const s = { x: c.x + (p.x - c.x) / l1 * r, y: c.y + (p.y - c.y) / l1 * r };
            const e = { x: c.x + (n.x - c.x) / l2 * r, y: c.y + (n.y - c.y) / l2 * r };
            d += ` L${r1(s.x)},${r1(s.y)} Q${r1(c.x)},${r1(c.y)} ${r1(e.x)},${r1(e.y)}`;
        }
        const z = Q[Q.length - 1];
        return d + ` L${r1(z.x)},${r1(z.y)}`;
    }

    // Анимация «прорисовки» новой линии
    function drawIn(l) {
        l.g.style.setProperty('--len', l.line.getTotalLength() + 'px');
        l.g.classList.add('drawing');
        setTimeout(() => l.g.classList.remove('drawing'), 480);
    }

    // Светящийся импульс бежит по линии — так видно, куда идут данные
    function pulseLink(id, ms) {
        const l = links.get(id);
        if (!l) return;
        const len = l.len || l.line.getTotalLength();
        l.g.style.setProperty('--flow-len', len + 'px');
        l.g.style.setProperty('--flow-end', -len + 'px');
        l.g.style.setProperty('--flow-ms', ms + 'ms');
        l.g.classList.remove('flowing');
        void l.g.getBoundingClientRect();
        l.g.classList.add('flowing');
        clearTimeout(l.flowTimer);
        l.flowTimer = setTimeout(() => l.g.classList.remove('flowing'), ms + 60);
    }

    // Подключённые входы плитки и линии, уходящие из её выхода
    function inputsOf(id) {
        const s = new Set();
        for (const lid of byNode.get(id) || []) {
            const l = links.get(lid);
            if (l.to.tile === id) s.add(l.to.port);
        }
        return s;
    }

    function outLinks(id, port) {
        const res = [];
        for (const lid of byNode.get(id) || []) {
            const l = links.get(lid);
            if (l.from.tile === id && l.from.port === port) res.push(l);
        }
        return res;
    }

    function removeLink(id, o = {}) {
        const l = links.get(id);
        if (!l) return;
        links.delete(id);
        dirtyLinks.delete(id);
        if (byNode.has(l.from.tile)) byNode.get(l.from.tile).delete(id);
        if (byNode.has(l.to.tile)) byNode.get(l.to.tile).delete(id);
        for (const p of l.points) sel.points.delete(id + '/' + p.id);
        if (selLink === id) selLink = null;
        const A = nodeOf(l.from.tile), B = nodeOf(l.to.tile);
        if (A) portStates(A);
        if (B) portStates(B);
        l.g.classList.add('leaving');
        setTimeout(() => l.g.remove(), 220);
        if (l.points.length) objectsChanged();
        if (!o.silent) changed();
        if (!l.auto && ((A && A.kind === 'magnet') || (B && B.kind === 'magnet'))) requestMagnets();
    }

    // Подсветка подключённых контактов и скрытие полей у подключённых входов
    function portStates(n) {
        const used = new Set();
        for (const lid of byNode.get(n.id) || []) {
            const l = links.get(lid);
            if (l.from.tile === n.id) used.add(l.from.port);
            if (l.to.tile === n.id) used.add(l.to.port);
        }
        for (const id in n.portEls) {
            const on = used.has(id);
            n.portEls[id].classList.toggle('connected', on);
            if (n.kind !== 'magnet' && n.portEls[id].dataset.dir === 'in') Nodes.setLinked(n, id, on);
        }
    }

    // Подбор контакта при развороте линии: стараемся взять контакт с тем же номером
    function pickPort(n, dir, otherId) {
        if (n.kind === 'magnet') return dir;
        const p = Nodes.ports(n.def);
        const list = p[dir];
        if (!list.length) return null;
        const other = p[dir === 'in' ? 'out' : 'in'];
        const idx = other.indexOf(otherId);
        return list[idx >= 0 && idx < list.length ? idx : 0];
    }

    const nodeTitle = n => (n.kind === 'magnet' ? n.name : Nodes.titleOf(n));

    function reverseLink(id) {
        const l = links.get(id);
        if (!l || l.auto) return false;
        const A = nodeOf(l.from.tile), B = nodeOf(l.to.tile);
        const out = pickPort(B, 'out', l.to.port), inp = pickPort(A, 'in', l.from.port);
        if (!out) { UI.toast(`У плитки «${nodeTitle(B)}» нет выхода — развернуть нельзя`); return false; }
        if (!inp) { UI.toast(`У плитки «${nodeTitle(A)}» нет входа — развернуть нельзя`); return false; }
        if (findLink({ tile: B.id, port: out }, { tile: A.id, port: inp })) { UI.toast('Такая линия уже есть'); return false; }
        l.from = { tile: B.id, port: out };
        l.to = { tile: A.id, port: inp };
        l.points.reverse();
        portStates(A);
        portStates(B);
        drawLink(l);
        drawIn(l);
        changed();
        if (A.kind === 'magnet' || B.kind === 'magnet') requestMagnets();
        return true;
    }

    function setLinkColor(id, hex) {
        const l = links.get(id);
        if (!l) return;
        l.color = hex || null;
        paintLink(l);
        changed();
    }

    function setLinkBend(id, bend) {
        const l = links.get(id);
        if (!l) return;
        l.bend = bend === 'angle' ? 'angle' : 'curve';
        touch(l);
        changed();
    }

    // Новая точка изгиба на ближайшем к курсору участке линии
    function addPoint(linkId, wx, wy) {
        const l = links.get(linkId);
        if (!l || l.auto) return null;
        const chain = [portWorld(l.from), ...l.points, portWorld(l.to)];
        let best = 0, bestD = Infinity;
        for (let i = 0; i < chain.length - 1; i++) {
            const d = segDist(wx, wy, chain[i], chain[i + 1]);
            if (d < bestD) { bestD = d; best = i; }
        }
        const p = { id: uid('p'), x: wx, y: wy };
        l.points.splice(best, 0, p);
        touch(l);
        objectsChanged();
        changed();
        return p;
    }

    function segDist(x, y, a, b) {
        const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
        const t = len2 ? clamp(((x - a.x) * dx + (y - a.y) * dy) / len2, 0, 1) : 0;
        return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
    }

    function removePoint(linkId, pointId) {
        const l = links.get(linkId);
        if (!l) return;
        l.points = l.points.filter(p => p.id !== pointId);
        sel.points.delete(linkId + '/' + pointId);
        touch(l);
        objectsChanged();
        changed();
    }

    function clearPoints(linkId) {
        const l = links.get(linkId);
        if (!l) return;
        for (const p of l.points) sel.points.delete(linkId + '/' + p.id);
        l.points = [];
        touch(l);
        objectsChanged();
        changed();
    }

    /* ---------- Пакетная перерисовка ---------- */
    function touch(l) {
        dirtyLinks.add(l.id);
        queueFrame();
    }
    function touchNodeLinks(id) {
        for (const lid of byNode.get(id) || []) dirtyLinks.add(lid);
        queueFrame();
    }
    function queueFrame() {
        if (frameQueued) return;
        frameQueued = true;
        requestAnimationFrame(flush);
    }
    function flush() {
        frameQueued = false;
        for (const id of dirtyLinks) {
            const l = links.get(id);
            if (l) drawLink(l);
        }
        dirtyLinks.clear();
        if (geometryChanged) {
            geometryChanged = false;
            emit('geometry');
        }
        if (selectionQueued) {
            selectionQueued = false;
            emit('selection');
        }
        if (refsQueued) {
            refsQueued = false;
            for (const t of tiles.values()) if (t.def.refs) Nodes.refreshRefs(t);
        }
    }
    function changed() {
        dirty = true;
        geometryChanged = true;
        queueFrame();
        emit('change');
    }

    /* ---------- Выделение ---------- */
    function setTileSel(id, on) {
        const t = tiles.get(id);
        if (!t) return;
        if (on) sel.tiles.add(id); else sel.tiles.delete(id);
        t.el.classList.toggle('selected', on);
    }

    function setItemSel(id, on) {
        const it = itemOf(id);
        if (!it) return;
        if (on) sel.items.add(id); else sel.items.delete(id);
        it.el.classList.toggle('selected', on);
    }

    function setPointSel(key, on) {
        if (on) sel.points.add(key); else sel.points.delete(key);
        const [lid, pid] = key.split('/');
        const l = links.get(lid);
        const c = l && l.dots.querySelector(`[data-point="${pid}"]`);
        if (c) c.classList.toggle('selected', on);
    }

    function setSelLink(id) {
        const prev = selLink;
        selLink = id;
        for (const x of [prev, id]) {
            const l = links.get(x);
            if (l) paintLink(l);
        }
    }

    function clearSelection(silent) {
        for (const id of [...sel.tiles]) setTileSel(id, false);
        for (const id of [...sel.items]) setItemSel(id, false);
        for (const k of [...sel.points]) setPointSel(k, false);
        setSelLink(null);
        if (!silent) emit('selection');
    }

    function selectObjects({ tiles: ts = [], items = [], points = [] }, add = false) {
        if (!add) clearSelection(true);
        for (const id of ts) setTileSel(id, true);
        for (const id of items) setItemSel(id, true);
        for (const k of points) setPointSel(k, true);
        emit('selection');
    }

    const selectTiles = (ids, add = false) => selectObjects({ tiles: ids }, add);

    function toggleTile(id) {
        setTileSel(id, !sel.tiles.has(id));
        setSelLink(null);
        emit('selection');
    }

    function selectAll() {
        clearSelection(true);
        for (const id of tiles.keys()) setTileSel(id, true);
        for (const id of [...targets.keys(), ...magnets.keys()]) setItemSel(id, true);
        for (const l of links.values()) for (const p of l.points) setPointSel(l.id + '/' + p.id, true);
        emit('selection');
    }

    const selectionSize = () => sel.tiles.size + sel.items.size + sel.points.size;
    const selectedTiles = () => [...sel.tiles];
    const selectedItems = () => [...sel.items];

    function deleteSelection() {
        const pts = [...sel.points];
        removeTiles([...sel.tiles]);
        removeItems([...sel.items]);
        for (const key of pts) {
            const [lid, pid] = key.split('/');
            removePoint(lid, pid);
        }
        clearSelection();
    }

    /* ---------- Мышь ---------- */
    function hitTest(target) {
        if (target.closest('input, select, textarea, button, video, audio')) return { kind: 'control' };
        const port = target.closest('.port');
        if (port) {
            const id = port.closest('[data-node]').dataset.node;
            if (nodeOf(id)) return { kind: 'port', tile: id, port: port.dataset.port, dir: port.dataset.dir };
        }
        const handle = target.closest('.mg-handle');
        if (handle) {
            const id = handle.closest('.item').dataset.item;
            if (magnets.has(id)) return { kind: 'radius', item: id };
        }
        const grip = target.closest('.group-resize');
        if (grip) {
            const id = grip.closest('.tile').dataset.id;
            if (tiles.has(id)) return { kind: 'gresize', tile: id };
        }
        const itemEl = target.closest('.item');
        if (itemEl && itemOf(itemEl.dataset.item)) return { kind: itemOf(itemEl.dataset.item).kind, item: itemEl.dataset.item };
        const tileEl = target.closest('.tile');
        // web — нажали на «спящий» сайт в плитке «Ссылка»
        if (tileEl && tiles.has(tileEl.dataset.id)) return { kind: 'tile', tile: tileEl.dataset.id, web: !!target.closest('.web-shield') };
        const pt = target.closest('[data-point]');
        if (pt) {
            const lid = pt.closest('[data-link]').dataset.link;
            if (links.has(lid)) return { kind: 'point', link: lid, point: pt.dataset.point };
        }
        const ln = target.closest('[data-link]');
        if (ln && links.has(ln.dataset.link) && !links.get(ln.dataset.link).auto) return { kind: 'link', link: ln.dataset.link };
        return { kind: 'empty' };
    }

    const isItem = k => k === 'target' || k === 'magnet';

    /* ---------- Сенсорный экран ----------
       Один палец — как левая кнопка мыши. Долгое нажатие — как правая: отпустить —
       меню, повести — выделение рамкой. Два пальца — масштаб и движение доски. */
    function trackTouch(e) {
        if (e.pointerType !== 'touch') return false;
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size < 2) return false;
        if (!pinch) startPinch();
        return true;
    }

    function startPinch() {
        clearTimeout(pressTimer);
        // начатое одним пальцем действие прерываем: дальше работают два пальца
        if (gesture) {
            if (gesture.type === 'wire') stopWire();
            if (gesture.type === 'rect') rectEl.style.display = 'none';
            if (gesture.type === 'move') {
                for (const it of gesture.items.tiles) it.t.el.classList.remove('dragging');
                changed();
                requestMagnets();
            }
            boardEl.classList.remove('panning', 'dragging', 'resizing');
            gesture = null;
        }
        if (linking) stopWire();
        UI.menu.close();
        stopTween();
        const [a, b] = [...touches.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), k0: view.k, w: screenToWorld(mid.x, mid.y) };
    }

    function movePinch() {
        const [a, b] = [...touches.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const k = clamp(pinch.k0 * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0, MIN_K, MAX_K);
        view.k = k;
        view.x = mid.x - pinch.w.x * k;
        view.y = mid.y - pinch.w.y * k;
        applyView();
    }

    function longPress(g) {
        if (gesture !== g || g.moved) return;
        if (g.type === 'wire') stopWire();
        g.button = 2;
        g.type = 'rpress';
        UI.pressRing(g.sx, g.sy);
    }

    function onDown(e) {
        if (trackTouch(e)) { e.preventDefault(); return; }
        if (gesture) return;
        stopTween();
        if (picking) {
            e.preventDefault();
            pickClick(e);
            return;
        }
        if (linking) {
            e.preventDefault();
            finishWire(e.button === 0 ? e : null);
            return;
        }
        const hit = hitTest(e.target);
        if (hit.kind === 'control') return;
        const act = document.activeElement;
        if (act && act !== document.body && boardEl.contains(act)) act.blur();
        e.preventDefault();
        try { boardEl.setPointerCapture(e.pointerId); } catch { /* синтетические события */ }

        gesture = {
            id: e.pointerId, button: e.button, hit, sx: e.clientX, sy: e.clientY, moved: false, type: null,
            touch: e.pointerType === 'touch'
        };
        if (e.button === 0) {
            if (hit.kind === 'empty') gesture.type = 'pan';
            else if (hit.kind === 'port') { gesture.type = 'wire'; startWire(hit, e.clientX, e.clientY); }
            else if (hit.kind === 'radius') gesture.type = 'radius';
            else if (hit.kind === 'gresize') {
                gesture.type = 'gresize';
                const t = tiles.get(hit.tile);
                gesture.size = { w: t.fields.gw, h: t.fields.gh };
            } else gesture.type = 'press';
        } else if (e.button === 1) {
            gesture.type = 'pan';
        } else if (e.button === 2) {
            gesture.type = 'rpress';
        } else {
            gesture = null;
            return;
        }
        gesture.vx = view.x;
        gesture.vy = view.y;
        if (gesture.touch && e.button === 0) {
            const g = gesture;
            clearTimeout(pressTimer);
            pressTimer = setTimeout(() => longPress(g), LONG_PRESS);
        }
    }

    function onMove(e) {
        if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
            touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pinch) { movePinch(); return; }
        }
        if (linking && !gesture) { updateWire(e.clientX, e.clientY); return; }
        const g = gesture;
        if (!g || e.pointerId !== g.id) return;
        const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
        if (!g.moved) {
            if (Math.hypot(dx, dy) < (g.touch ? TOUCH_SLOP : CLICK_SLOP)) return;
            clearTimeout(pressTimer);
            g.moved = true;
            beginDrag(g);
        }
        if (g.type === 'gresize') {
            const t = tiles.get(g.hit.tile);
            if (t) resizeGroup(t, g.size.w + dx / view.k, g.size.h + dy / view.k);
            return;
        }
        if (g.type === 'pan') {
            view.x = g.vx + dx;
            view.y = g.vy + dy;
            applyView();
        } else if (g.type === 'move') dragMove(g, dx / view.k, dy / view.k);
        else if (g.type === 'rect') rectMove(g, e.clientX, e.clientY);
        else if (g.type === 'wire') updateWire(e.clientX, e.clientY);
        else if (g.type === 'radius') {
            const m = magnets.get(g.hit.item), w = screenToWorld(e.clientX, e.clientY);
            if (m) {
                m.r = clamp(Math.round(Math.hypot(w.x - m.x, w.y - m.y)), 20, 3000);
                paintItem(m);
                geometryChanged = true;
                queueFrame();
            }
        }
    }

    function beginDrag(g) {
        if (g.type === 'pan') { boardEl.classList.add('panning'); return; }
        if (g.type === 'rpress') {
            g.type = 'rect';
            rectEl.style.display = 'block';
            UI.menu.close();
            return;
        }
        if (g.type === 'radius') { boardEl.classList.add('resizing'); return; }
        if (g.type !== 'press') return;

        const h = g.hit;
        if (h.kind === 'link') {
            // тянем линию за середину — появляется новая точка изгиба
            const w = screenToWorld(g.sx, g.sy);
            const p = addPoint(h.link, w.x, w.y);
            clearSelection(true);
            setSelLink(h.link);
            emit('selection');
            g.items = { tiles: [], items: [], points: [{ link: links.get(h.link), p, x0: p.x, y0: p.y }] };
        } else if (h.kind === 'tile') {
            if (!sel.tiles.has(h.tile)) selectTiles([h.tile]);
            g.items = collectMoving();
        } else if (isItem(h.kind)) {
            if (!sel.items.has(h.item)) selectObjects({ items: [h.item] });
            g.items = collectMoving();
        } else if (h.kind === 'point') {
            const key = h.link + '/' + h.point;
            if (!sel.points.has(key)) selectObjects({ points: [key] });
            g.items = collectMoving();
        }
        g.type = 'move';
        g.anchor = g.items.tiles[0] || g.items.items[0] || g.items.points[0] || null;
        for (const it of g.items.tiles) {
            raise(it.t.id);
            it.t.el.classList.add('dragging');
        }
        boardEl.classList.add('dragging');
    }

    // Что едет вместе: выделенные плитки, таргеты, магниты, выделенные точки и точки линий,
    // у которых оба конца выделены (иначе форма линии «порвётся»)
    function collectMoving() {
        const tileSet = new Set(sel.tiles), itemSet = new Set(sel.items), keys = new Set(sel.points);
        // рамка-группа везёт с собой всё, что лежит внутри неё
        for (const id of sel.tiles) {
            const g = tiles.get(id);
            if (!g || g.def.body !== 'group') continue;
            const inside = (x, y) => x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h;
            for (const t of tiles.values()) if (t !== g && inside(t.x + t.w / 2, t.y + t.h / 2)) tileSet.add(t.id);
            for (const it of [...targets.values(), ...magnets.values()]) if (inside(it.x, it.y)) itemSet.add(it.id);
            for (const l of links.values()) for (const p of l.points) if (inside(p.x, p.y)) keys.add(l.id + '/' + p.id);
        }
        const tl = [...tileSet].map(id => tiles.get(id)).filter(Boolean).map(t => ({ t, x0: t.x, y0: t.y }));
        const its = [...itemSet].map(itemOf).filter(Boolean).map(it => ({ it, x0: it.x, y0: it.y }));
        const moving = id => tileSet.has(id) || itemSet.has(id);
        for (const l of links.values()) {
            if (moving(l.from.tile) && moving(l.to.tile)) {
                for (const p of l.points) keys.add(l.id + '/' + p.id);
            }
        }
        const pts = [];
        for (const key of keys) {
            const [lid, pid] = key.split('/');
            const l = links.get(lid);
            const p = l && l.points.find(q => q.id === pid);
            if (p) pts.push({ link: l, p, x0: p.x, y0: p.y });
        }
        return { tiles: tl, items: its, points: pts };
    }

    function dragMove(g, dx, dy) {
        if (settings.snap && g.anchor) {
            const a = g.anchor;
            dx = Math.round((a.x0 + dx) / GRID) * GRID - a.x0;
            dy = Math.round((a.y0 + dy) / GRID) * GRID - a.y0;
        }
        for (const it of g.items.tiles) {
            it.t.x = it.x0 + dx;
            it.t.y = it.y0 + dy;
            placeTile(it.t);
            touchNodeLinks(it.t.id);
        }
        for (const it of g.items.items) {
            it.it.x = it.x0 + dx;
            it.it.y = it.y0 + dy;
            placeItem(it.it);
            if (it.it.kind === 'magnet') touchNodeLinks(it.it.id);
        }
        for (const it of g.items.points) {
            it.p.x = it.x0 + dx;
            it.p.y = it.y0 + dy;
            touch(it.link);
        }
        geometryChanged = true;
        queueFrame();
    }

    function rectMove(g, cx, cy) {
        const x = Math.min(g.sx, cx), y = Math.min(g.sy, cy);
        const w = Math.abs(cx - g.sx), h = Math.abs(cy - g.sy);
        rectEl.style.left = x + 'px';
        rectEl.style.top = y + 'px';
        rectEl.style.width = w + 'px';
        rectEl.style.height = h + 'px';

        const a = screenToWorld(x, y), b = screenToWorld(x + w, y + h);
        const inside = (px, py) => px >= a.x && px <= b.x && py >= a.y && py <= b.y;
        const wantT = new Set(), wantI = new Set(), wantP = new Set();
        for (const t of tiles.values()) {
            if (t.x < b.x && t.x + t.w > a.x && t.y < b.y && t.y + t.h > a.y) wantT.add(t.id);
        }
        for (const it of [...targets.values(), ...magnets.values()]) if (inside(it.x, it.y)) wantI.add(it.id);
        for (const l of links.values()) for (const p of l.points) if (inside(p.x, p.y)) wantP.add(l.id + '/' + p.id);
        for (const id of [...sel.tiles]) if (!wantT.has(id)) setTileSel(id, false);
        for (const id of wantT) if (!sel.tiles.has(id)) setTileSel(id, true);
        for (const id of [...sel.items]) if (!wantI.has(id)) setItemSel(id, false);
        for (const id of wantI) if (!sel.items.has(id)) setItemSel(id, true);
        for (const k of [...sel.points]) if (!wantP.has(k)) setPointSel(k, false);
        for (const k of wantP) if (!sel.points.has(k)) setPointSel(k, true);
        if (selLink) setSelLink(null);
        selectionQueued = true;
        queueFrame();
    }

    function onUp(e) {
        if (e.pointerType === 'touch') {
            touches.delete(e.pointerId);
            if (pinch) {
                if (touches.size < 2) pinch = null;
                return;
            }
        }
        const g = gesture;
        if (!g || e.pointerId !== g.id) return;
        clearTimeout(pressTimer);
        gesture = null;
        boardEl.classList.remove('panning', 'dragging', 'resizing');
        if (!g.moved) { click(g, e); return; }
        if (g.type === 'move') {
            for (const it of g.items.tiles) it.t.el.classList.remove('dragging');
            changed();
            requestMagnets();
        } else if (g.type === 'gresize') {
            changed();
        } else if (g.type === 'radius') {
            changed();
            requestMagnets();
        } else if (g.type === 'rect') {
            rectEl.style.display = 'none';
            emit('selection');
        } else if (g.type === 'wire') {
            finishWire(e);
        }
    }

    function click(g, e) {
        const h = g.hit;
        if (g.button === 2) { openContext(h, e.clientX, e.clientY); return; }
        if (g.button !== 0) return;
        if (h.kind === 'port') {
            // простой клик по контакту: линия тянется за курсором до следующего клика
            linking = true;
            return;
        }
        if (h.kind === 'tile' || h.kind === 'gresize') {
            selectTiles([h.tile]);
            raise(h.tile);
            // клик по сайту (без перетаскивания) — им можно пользоваться
            if (h.web) Web.activate(tiles.get(h.tile));
        } else if (isItem(h.kind) || h.kind === 'radius') {
            selectObjects({ items: [h.item] });
        } else if (h.kind === 'point') {
            selectObjects({ points: [h.link + '/' + h.point] });
        } else if (h.kind === 'link') {
            clearSelection(true);
            setSelLink(h.link);
            emit('selection');
        } else {
            clearSelection();
        }
    }

    function openContext(h, x, y) {
        const w = screenToWorld(x, y);
        const c = { kind: h.kind, x, y, wx: w.x, wy: w.y };
        const many = selectionSize() > 1;
        if (h.kind === 'tile' || h.kind === 'gresize' || (h.kind === 'port' && tiles.has(h.tile))) {
            if (sel.tiles.has(h.tile) && many) c.kind = 'selection';
            else {
                c.kind = 'tile';
                c.tile = h.tile;
                selectTiles([h.tile]);
            }
        } else if (isItem(h.kind) || h.kind === 'radius' || h.kind === 'port') {
            const id = h.item || h.tile;
            if (sel.items.has(id) && many) c.kind = 'selection';
            else {
                c.kind = itemOf(id).kind;
                c.item = id;
                selectObjects({ items: [id] });
            }
        } else if (h.kind === 'point') {
            const key = h.link + '/' + h.point;
            if (sel.points.has(key) && many) c.kind = 'selection';
            else {
                c.link = h.link;
                c.point = h.point;
                selectObjects({ points: [key] });
            }
        } else if (h.kind === 'link') {
            c.link = h.link;
            clearSelection(true);
            setSelLink(h.link);
            emit('selection');
        }
        emit('context', c);
    }

    function onWheel(e) {
        e.preventDefault();
        UI.menu.close();
        const dy = UI.wheelDelta(e).y;

        // над длинным журналом «Вывода» или текстом файла колесо листает его, а не масштабирует доску
        const area = e.target.closest('.scroll');
        if (area && !e.ctrlKey && area.scrollHeight > area.clientHeight + 1) {
            const room = dy > 0 ? area.scrollHeight - area.clientHeight - area.scrollTop : area.scrollTop;
            if (room > 0.5) {
                area.scrollTop += dy;
                return;
            }
        }

        stopTween();
        zoomAt(e.clientX, e.clientY, view.k * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)));
        if (wire) updateWire(e.clientX, e.clientY);
    }

    /* ---------- Протягивание линии от контакта ---------- */
    function startWire(hit, cx, cy) {
        wire = { tile: hit.tile, port: hit.port, dir: hit.dir, target: null };
        boardEl.classList.add('wiring', hit.dir === 'out' ? 'wiring-out' : 'wiring-in');
        nodeOf(hit.tile).portEls[hit.port].classList.add('hot');
        updateWire(cx, cy);
    }

    function setHot(cand, on) {
        if (!cand) return;
        const n = nodeOf(cand.tile);
        if (n && n.portEls[cand.port]) n.portEls[cand.port].classList.toggle('hot', on);
    }

    function updateWire(cx, cy) {
        if (!wire || !nodeOf(wire.tile)) { stopWire(); return; }
        const cand = nearestPort(cx, cy, wire.dir === 'out' ? 'in' : 'out', wire.tile);
        const same = cand && wire.target && cand.tile === wire.target.tile && cand.port === wire.target.port;
        if (!same) {
            setHot(wire.target, false);
            wire.target = cand;
            setHot(cand, true);
        }
        const fixed = portWorld({ tile: wire.tile, port: wire.port });
        const free = cand ? portWorld(cand) : screenToWorld(cx, cy);
        const [a, b] = wire.dir === 'out' ? [fixed, free] : [free, fixed];
        tempPath.setAttribute('d', curvePath([a, b]));
        tempPath.style.display = 'block';
    }

    function finishWire(e) {
        if (wire && e) {
            const cand = nearestPort(e.clientX, e.clientY, wire.dir === 'out' ? 'in' : 'out', wire.tile);
            if (cand) {
                const src = { tile: wire.tile, port: wire.port };
                const [from, to] = wire.dir === 'out' ? [src, cand] : [cand, src];
                const old = findLink(from, to);
                // повторная линия между теми же контактами убирает уже существующую
                if (old && old.auto) UI.toast('Это автосвязь магнита — уберите плитку из его круга');
                else if (old) removeLink(old.id);
                else if (!addLink(from, to, { animate: true })) UI.toast('Так соединить нельзя');
            }
        }
        stopWire();
    }

    function stopWire() {
        if (wire) {
            setHot(wire.target, false);
            const n = nodeOf(wire.tile);
            if (n && n.portEls[wire.port]) n.portEls[wire.port].classList.remove('hot');
        }
        wire = null;
        linking = false;
        tempPath.style.display = 'none';
        boardEl.classList.remove('wiring', 'wiring-out', 'wiring-in');
    }

    // Ближайший подходящий контакт (у плиток и магнитов). Если курсор над плиткой,
    // но не у контакта, берётся ближайший подходящий контакт этой плитки.
    function nearestPort(cx, cy, dir, exclude) {
        let best = null, bestD = SNAP_RADIUS, over = null;
        const pad = SNAP_RADIUS + 4;
        const nodes = [...tiles.values(), ...magnets.values()];
        for (const n of nodes) {
            if (n.id === exclude) continue;
            const box = n.kind === 'magnet' ? itemBox(n) : n;
            const s = worldToScreen(box.x, box.y), w = box.w * view.k, h = box.h * view.k;
            if (cx < s.x - pad || cy < s.y - pad || cx > s.x + w + pad || cy > s.y + h + pad) continue;
            if (cx >= s.x && cx <= s.x + w && cy >= s.y && cy <= s.y + h) over = n;
            for (const id in n.portEls) {
                if (n.portEls[id].dataset.dir !== dir) continue;
                const p = worldToScreen(n.x + n.portPos[id].x, n.y + n.portPos[id].y);
                const d = Math.hypot(p.x - cx, p.y - cy);
                if (d < bestD) { bestD = d; best = { tile: n.id, port: id }; }
            }
        }
        if (best || !over) return best;
        let d0 = Infinity;
        for (const id in over.portEls) {
            if (over.portEls[id].dataset.dir !== dir) continue;
            const p = worldToScreen(over.x + over.portPos[id].x, over.y + over.portPos[id].y);
            const d = Math.hypot(p.x - cx, p.y - cy);
            if (d < d0) { d0 = d; best = { tile: over.id, port: id }; }
        }
        return best;
    }

    /* ---------- Настройки доски ---------- */
    function setSetting(key, val) {
        settings[key] = val;
        try { localStorage.setItem('sdesk_settings', JSON.stringify(settings)); } catch { /* приватный режим */ }
        if (key === 'grid') boardEl.classList.toggle('no-grid', !val);
    }

    return {
        init, on, tiles, targets, magnets, links, view, settings,
        // вид
        applyView, zoomAt, zoomTo, zoomBy, centerOn, flyTo, fitAll, home, setInsets,
        screenToWorld, worldToScreen, visibleRect, visibleCenter, contentBounds,
        // плитки
        addTile, removeTiles, clear, renameTile, setTileColor, setTileAsset, setTileFields, duplicate, disconnect,
        linksOf, focusTile, flash, raise, reorderTiles, getTile: id => tiles.get(id), freeSpot, groupSelection, noteChange,
        // таргеты и магниты
        addTarget, addMagnet, removeItems, renameItem, setMagnetRadius, magnetOnTile, getItem: itemOf,
        requestMagnets, updateMagnets,
        // ссылки на объекты
        resolveRef, refCenter, refLabel, refOptions, moveRef, remapRefs, pickRef,
        // линии
        addLink, removeLink, reverseLink, setLinkColor, setLinkBend,
        addPoint, removePoint, clearPoints, portWorld, getLink: id => links.get(id),
        pulseLink, inputsOf, outLinks,
        // выделение
        selectTiles, selectObjects, toggleTile, selectAll, clearSelection, deleteSelection,
        selectedTiles, selectedItems, selectionSize, isSelected: id => sel.tiles.has(id) || sel.items.has(id),
        // прочее
        setSetting,
        isDirty: () => dirty && tiles.size + targets.size + magnets.size > 0,
        markSaved: () => { dirty = false; }
    };
})();
