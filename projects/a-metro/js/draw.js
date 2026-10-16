// ===== Рисование новой линии и продление старой =====
// Нажимаешь на карту — ставится станция (или точка поворота), участок от прошлой
// точки проверяется по слою местности. «Резинка» к курсору показывает, можно ли
// провести путь сюда: цветная — можно, красная — нельзя (и почему).
// Продление: сначала нажимаешь на конечную станцию линии, дальше — как обычно.
import { TYPES, describe, describeExt, endNode, checkSegment, nameStation, nextColor } from './lines.js?v=6';
import { renderPreview } from './render3d.js?v=7';
import { dist } from './geo.js?v=1';

const SNAP_M = 140;   // ближе этого к чужой станции — пересадка на неё

export function createDrawer({ map, getCity, getTerrain, lines, onBuild, onExtend, onChange, getBudget = () => Infinity }) {
    const el = {
        panel: document.getElementById('draw'),
        dot: document.getElementById('drawDot'),
        title: document.getElementById('drawTitle'),
        st: document.getElementById('drawSt'),
        km: document.getElementById('drawKm'),
        cost: document.getElementById('drawCost'),
        months: document.getElementById('drawMonths'),
        msg: document.getElementById('drawMsg'),
        undo: document.getElementById('drawUndo'),
        cancel: document.getElementById('drawCancel'),
        done: document.getElementById('drawDone'),
        kinds: [...document.querySelectorAll('[data-node]')]
    };

    let draft = null;          // { type, color, nodes: [{ c, s }], extend?: линия, end?: 'head' | 'tail' }
    let nodeKind = 'station';  // что ставим кликом: станцию или поворот
    let ghost = null;          // курсор: { c, check }

    const usedNames = () => new Set(lines.flatMap(l => l.nodes.filter(n => n.s).map(n => n.s))
        .concat(draft ? draft.nodes.filter(n => n.s).map(n => n.s) : []));

    // Чужая станция рядом — пересадка (на свою же продлеваемую линию — нельзя)
    function snap(c) {
        let best = null, bestD = SNAP_M;
        for (const l of lines) for (const n of l.nodes) {
            if (!n.s || l === draft.extend) continue;
            const d = dist(n.c, c);
            if (d < bestD) { best = n; bestD = d; }
        }
        return best;
    }

    function lastStation() {
        for (let i = draft.nodes.length - 1; i >= 0; i--) if (draft.nodes[i].s) return draft.nodes[i];
        return null;
    }

    // Продление: первая точка — ближайшая конечная станция линии
    function pickEnd(c) {
        const line = draft.extend;
        let best = null, bestD = Infinity;
        for (const end of ['head', 'tail']) {
            const d = dist(endNode(line, end).c, c);
            if (d < bestD) { best = end; bestD = d; }
        }
        if (bestD > Math.max(SNAP_M, 260)) return { ok: false, reason: 'Нажми на первую или последнюю станцию линии', c };
        const n = endNode(line, best);
        return { ok: true, c: n.c, kind: 'station', name: n.s, end: best };
    }

    // Можно ли поставить точку сюда; возвращает { ok, reason, c, name }
    function evaluate(lngLat) {
        const type = TYPES[draft.type];
        let c = [lngLat.lng, lngLat.lat];
        if (draft.extend && draft.nodes.length === 0) return pickEnd(c);
        const kind = draft.nodes.length === 0 ? 'station' : nodeKind;
        let name = null;
        if (kind === 'station') {
            const s = snap(c);
            if (s) { c = s.c; name = s.s; }
        }
        const prev = draft.nodes[draft.nodes.length - 1];
        if (prev) {
            if (dist(prev.c, c) < 30) return { ok: false, reason: 'Слишком близко к прошлой точке', c };
            const chk = checkSegment(getCity(), getTerrain(), draft.type, prev.c, c);
            if (!chk.ok) return { ok: false, reason: chk.reason, c };
            const ls = lastStation();
            if (kind === 'station' && ls && dist(ls.c, c) < type.minGap) {
                return { ok: false, reason: `Станции слишком близко: нужно от ${type.minGap} м`, c };
            }
        } else {
            // первая станция: сама точка должна подходить
            const chk = checkSegment(getCity(), getTerrain(), draft.type, c, c);
            if (!chk.ok) return { ok: false, reason: chk.reason, c };
        }
        return { ok: true, c, kind, name };
    }

    function preview() {
        if (!draft) { renderPreview(map, []); return; }
        const color = draft.color;
        const f = [];
        if (draft.nodes.length > 1) {
            f.push({ type: 'Feature', properties: { ok: true, color, ghost: false },
                     geometry: { type: 'LineString', coordinates: draft.nodes.map(n => n.c) } });
        }
        for (const n of draft.nodes) {
            f.push({ type: 'Feature', properties: { ok: true, color, ghost: false, bend: !n.s },
                     geometry: { type: 'Point', coordinates: n.c } });
        }
        if (ghost) {
            const last = draft.nodes[draft.nodes.length - 1];
            if (last) f.push({ type: 'Feature', properties: { ok: ghost.ok, color, ghost: true },
                               geometry: { type: 'LineString', coordinates: [last.c, ghost.c] } });
            f.push({ type: 'Feature', properties: { ok: ghost.ok, color, ghost: true, bend: ghost.kind === 'bend' },
                     geometry: { type: 'Point', coordinates: ghost.c } });
        }
        renderPreview(map, f);
    }

    // Цифры черновика: у продления — только новая часть
    function measureDraft() {
        const nodes = trimmed();
        if (nodes.length < 2) return null;
        return draft.extend ? describeExt(draft.extend, draft.end, nodes.slice(1)) : describe({ type: draft.type, nodes });
    }

    function updatePanel(message) {
        const stations = draft.nodes.filter(n => n.s).length - (draft.extend && draft.nodes.length ? 1 : 0);
        const d = measureDraft();
        el.st.textContent = stations;
        el.km.textContent = d ? `${d.km.toFixed(1).replace('.', ',')} км` : '0 км';
        el.cost.textContent = d ? `${d.cost} млрд ₸` : `${stations * TYPES[draft.type].costStation} млрд ₸`;
        el.months.textContent = d ? `${d.months} мес.` : '—';
        // Денег не хватает — строить нельзя
        const budget = getBudget();
        const tooExpensive = d && d.cost > budget;
        el.cost.classList.toggle('is-bad', !!tooExpensive);
        el.done.disabled = stations < (draft.extend ? 1 : 2) || tooExpensive;
        el.undo.disabled = draft.nodes.length === 0;
        if (tooExpensive) message = `Не хватает денег: нужно ${d.cost} млрд ₸, есть ${Math.floor(budget)}`;
        if (message !== undefined) el.msg.textContent = message;
        el.msg.classList.toggle('is-bad', !!tooExpensive || !!(ghost && !ghost.ok && message === ghost.reason));
    }

    // Без висящих поворотов на конце
    function trimmed() {
        const n = draft.nodes.slice();
        while (n.length && !n[n.length - 1].s) n.pop();
        return n;
    }

    function hint() {
        if (draft.extend) {
            if (draft.nodes.length === 0) return 'Нажми на первую или последнюю станцию линии — от неё пойдёт продление';
            if (draft.nodes.filter(n => n.s).length < 2) return 'Поставь новую станцию. «Поворот» — изгиб пути без станции';
            return 'Продолжай или нажми «Построить» (Enter)';
        }
        if (draft.nodes.length === 0) return 'Нажми на карту, чтобы поставить первую станцию';
        if (draft.nodes.filter(n => n.s).length < 2) return 'Поставь ещё станцию. «Поворот» — изгиб пути без станции';
        return 'Продолжай линию или нажми «Построить» (Enter)';
    }

    // ---------- События карты ----------
    function onMove(e) {
        if (!draft) return;
        ghost = evaluate(e.lngLat);
        preview();
        updatePanel(ghost.ok ? hint() : ghost.reason);
    }

    function onClick(e) {
        if (!draft) return;
        const r = evaluate(e.lngLat);
        if (!r.ok) { updatePanel(r.reason); el.msg.classList.add('is-bad'); return; }
        const name = r.kind === 'station' ? (r.name || nameStation(map, getCity(), e.lngLat, usedNames())) : null;
        if (r.end) draft.end = r.end;
        draft.nodes.push({ c: r.c, s: name });
        ghost = null;
        preview();
        updatePanel(hint());
        onChange();
    }

    function setKind(kind) {
        nodeKind = kind;
        el.kinds.forEach(b => b.classList.toggle('is-active', b.dataset.node === kind));
    }

    // ---------- Управление ----------
    function start(type, extend = null) {
        if (draft) cancel();
        draft = extend ? { type: extend.type, color: extend.color, nodes: [], extend } : { type, color: nextColor(lines), nodes: [] };
        setKind('station');
        el.panel.hidden = false;
        el.dot.style.background = draft.color;
        el.title.textContent = extend ? `Продление · ${extend.name}` : `Новая линия · ${TYPES[type].name}`;
        updatePanel(hint());
        map.doubleClickZoom.disable();
        map.getCanvas().style.cursor = 'crosshair';
        map.on('mousemove', onMove);
        map.on('click', onClick);
        onChange();
    }

    function stop() {
        draft = null;
        ghost = null;
        el.panel.hidden = true;
        renderPreview(map, []);
        map.doubleClickZoom.enable();
        map.getCanvas().style.cursor = '';
        map.off('mousemove', onMove);
        map.off('click', onClick);
        onChange();
    }

    function cancel() { stop(); }

    function undo() {
        if (!draft) return;
        if (!draft.nodes.length) return cancel();
        draft.nodes.pop();
        preview();
        updatePanel(hint());
    }

    function finish() {
        if (!draft) return;
        const nodes = trimmed();
        if (nodes.filter(n => n.s).length < 2) return;
        if (measureDraft().cost > getBudget()) return;
        if (draft.extend) {
            const { extend, end } = draft;
            stop();
            onExtend(extend, end, nodes.slice(1));
            return;
        }
        const line = { id: `l${Date.now().toString(36)}`, type: draft.type, color: draft.color, nodes };
        stop();
        onBuild(line);
    }

    el.undo.addEventListener('click', undo);
    el.cancel.addEventListener('click', cancel);
    el.done.addEventListener('click', finish);
    el.kinds.forEach(b => b.addEventListener('click', () => setKind(b.dataset.node)));

    return {
        start, cancel, undo, finish,
        extend: line => start(line.type, line),
        get active() { return !!draft; },
        get type() { return draft && !draft.extend && draft.type; },
        // Клавиши: Enter — построить, Esc/Backspace — шаг назад, B — поворот/станция
        handleKey(e) {
            if (!draft) return false;
            if (e.key === 'Enter') finish();
            else if (e.key === 'Escape' || e.key === 'Backspace') undo();
            else if (e.key.toLowerCase() === 'b' || e.key.toLowerCase() === 'и') setKind(nodeKind === 'station' ? 'bend' : 'station');
            else return false;
            e.preventDefault();
            return true;
        }
    };
}
