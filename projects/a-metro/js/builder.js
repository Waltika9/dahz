// ===== Инструмент стройки =====
// Своё здание — ставишь углы на карте, выбираешь этажи и назначение.
// Готовое здание — выбираешь в списке, и включается режим расстановки: большое меню
// прячется, остаётся маленькая панель — двигать стрелками (или мышкой, пальцем),
// крутить, «Построить» или «Отмена».
// Дорога — точки по очереди; над рекой и железной дорогой мост строится сам.
// Существующие дома, улицы и воду занимать нельзя — проверяем по самой карте.
import { USES, ROADS, MODELS, MODEL_GROUPS, BRIDGE, FLOOR_M, areaM2, describeBuild, customInfo, modelInfo, roadInfo,
         partFeatures, renderBuildPreview } from './builds.js?v=9';
import { cellAt } from './city.js?v=1';
import { dist, move, measure, pointAt, band, square } from './geo.js?v=1';

const MIN_ZOOM = 14;           // ближе — на карте видны все дома и улицы, проверка точная
const MAX_ELEV = 1250;         // выше — горы
const MAX_FLOORS = 100;
const MAX_AREA = 40000;        // своё здание — до 4 гектаров
const MAX_ROAD_M = 20000;
// Какие улицы на карте мешают зданию (дворовые проезды и тропинки — нет)
const BLOCK_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor']);
const RAILS = new Set(['rail', 'transit']);
// Реки и каналы мешают и требуют моста; арыки (drain, ditch) — нет, их в Алматы на каждой улице
const RIVERS = new Set(['river', 'canal', 'stream']);
const isSmallWater = f => f.sourceLayer === 'waterway' && !RIVERS.has(f.properties.class);

const TOOLS = {
    custom: { title: 'Своё здание', color: '#8fc2ff' },
    model: { title: 'Готовое здание', color: '#f2b15a' },
    road: { title: 'Новая дорога', color: '#c3cad4' }
};
const PREVIEW = '#4f8cff';     // цвет черновика

// Выбор игрока запоминается между стройками
const pick = { use: 'home', floors: 9, model: 'housing', angle: 0, road: 'avenue', raised: false };

const fmt = n => Math.round(n).toLocaleString('ru-RU');

// ---------- Геометрия в метрах: пересечения ----------
function toXY(ref, pts) {
    const kx = 111320 * Math.cos(ref[1] * Math.PI / 180);
    return pts.map(p => [(p[0] - ref[0]) * kx, (p[1] - ref[1]) * 110540]);
}

// Отрезки ab и cd пересекаются
function cross(a, b, c, d) {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return (o(c, d, a) > 0) !== (o(c, d, b) > 0) && (o(a, b, c) > 0) !== (o(a, b, d) > 0);
}

// Точка внутри замкнутого кольца
function inside(p, ring) {
    let yes = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) yes = !yes;
    }
    return yes;
}

// Многоугольник A задевает многоугольник B или линию
function polysHit(A, B) {
    for (let i = 0; i < A.length - 1; i++) for (let j = 0; j < B.length - 1; j++) {
        if (cross(A[i], A[i + 1], B[j], B[j + 1])) return true;
    }
    return inside(A[0], B) || inside(B[0], A);
}

function lineHits(line, A) {
    for (let i = 0; i < line.length - 1; i++) for (let j = 0; j < A.length - 1; j++) {
        if (cross(line[i], line[i + 1], A[j], A[j + 1])) return true;
    }
    return inside(line[0], A);
}

// Стены своего здания пересекаются (углы pts, кольцо не замкнуто)
function selfCross(pts) {
    const n = pts.length, P = toXY(pts[0], pts);
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;   // соседние стены
        if (cross(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n])) return true;
    }
    return false;
}

function bbox(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    return [x0, y0, x1, y1];
}
const meet = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const closed = r => r.concat([r[0]]);

// Формы объекта карты: многоугольники (внешние кольца) и линии
function shapes(g) {
    if (g.type === 'Polygon') return { polys: [g.coordinates[0]], lines: [] };
    if (g.type === 'MultiPolygon') return { polys: g.coordinates.map(p => p[0]), lines: [] };
    if (g.type === 'LineString') return { polys: [], lines: [g.coordinates] };
    if (g.type === 'MultiLineString') return { polys: [], lines: g.coordinates };
    return { polys: [], lines: [] };
}

const round6 = p => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6];

// Плавная прокрутка колёсиком: список не «прыгает», а доезжает с замедлением
function smoothWheel(box) {
    let target = 0, raf = 0;
    const step = () => {
        const d = target - box.scrollTop;
        if (Math.abs(d) < 0.5) { box.scrollTop = target; raf = 0; return; }
        box.scrollTop += d * 0.2;
        raf = requestAnimationFrame(step);
    };
    box.addEventListener('wheel', e => {
        if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
        e.preventDefault();
        const max = box.scrollHeight - box.clientHeight;
        const delta = e.deltaY * (e.deltaMode === 1 ? 36 : e.deltaMode === 2 ? box.clientHeight : 1);
        target = Math.max(0, Math.min(max, (raf ? target : box.scrollTop) + delta));
        if (!raf) raf = requestAnimationFrame(step);
    }, { passive: false });
}

// getBudget — сколько денег есть: дороги и мосты строятся из бюджета, здания — бесплатно
export function createBuilder({ map, builds, getCity, getLines, onBuild, onChange, getBudget = () => Infinity }) {
    const el = {
        panel: document.getElementById('bpanel'),
        dot: document.getElementById('bDot'),
        title: document.getElementById('bTitle'),
        seg: document.getElementById('bSeg'),
        opts: document.getElementById('bOpts'),
        stats: document.getElementById('bStats'),
        msg: document.getElementById('bMsg'),
        undo: document.getElementById('bUndo'),
        rotate: document.getElementById('bRotate'),
        cancel: document.getElementById('bCancel'),
        done: document.getElementById('bDone')
    };

    // Слои карты, по которым проверяем место: дома (и достопримечательности), улицы и ж/д, вода
    const style = map.getStyle().layers;
    const L = {
        houses: ['buildings-3d', 'lm-solid'].filter(id => map.getLayer(id)),
        roads: style.filter(l => l.type === 'line' && l['source-layer'] === 'transportation').map(l => l.id),
        water: style.filter(l => (l.type === 'fill' || l.type === 'line') && (l['source-layer'] === 'water' || l['source-layer'] === 'waterway')).map(l => l.id)
    };
    const isHouse = new Set(L.houses), isRoad = new Set(L.roads), isWater = new Set(L.water);

    // Маленькая панель режима расстановки готового здания
    const ed = {
        panel: document.getElementById('bedit'),
        ico: document.getElementById('beIco'),
        name: document.getElementById('beName'),
        sub: document.getElementById('beSub'),
        stats: document.getElementById('beStats'),
        msg: document.getElementById('beMsg'),
        list: document.getElementById('beList'),
        cancel: document.getElementById('beCancel'),
        done: document.getElementById('beDone')
    };

    let tool = null;      // custom | model | road
    let draft = null;     // custom: { ring }, road: { nodes, flags }
    let ghost = null;     // что под курсором: { c, ok, reason, ... }
    let cursor = null;    // последняя точка курсора (чтобы пересчитать после смены этажей или поворота)
    let frame = 0;
    let edit = null;      // режим расстановки: { c } — где стоит здание
    let drag = null;      // тащим здание мышкой или пальцем: { dx, dy } — сдвиг от точки касания
    let dragged = false;  // после перетаскивания карта присылает «click» — его пропускаем
    const touchScreen = matchMedia('(hover: none)').matches;

    // Точка экрана пришлась на показанное здание (по его контуру, с запасом)
    function onGhost(point) {
        if (!ghost || !ghost.info) return false;
        const pts = ghost.info.footprint.map(p => map.project(p));
        const xs = pts.map(p => p.x), ys = pts.map(p => p.y), pad = 24;
        return point.x > Math.min(...xs) - pad && point.x < Math.max(...xs) + pad
            && point.y > Math.min(...ys) - pad && point.y < Math.max(...ys) + pad;
    }

    // ---------- Свободно ли место ----------
    // ring — замкнутое кольцо [lon, lat]; road — для дороги (улицы и воду пересекать можно)
    function blocked(ring, { road = false } = {}) {
        if (map.getZoom() < MIN_ZOOM) return 'Приблизь карту, чтобы строить: так видно дома и улицы';
        const city = getCity();
        for (const p of ring) {
            const i = cellAt(city, p[0], p[1]);
            if (i < 0) return 'За краем карты';
            if (city.elev[i] > MAX_ELEV) return 'Высоко в горах — здесь не строят';
            if (city.airport[i]) return 'Аэропорт — здесь строить нельзя';
        }
        const ref = ring[0];
        const A = toXY(ref, ring);
        const box = bbox(ring);

        // 1) что нарисовано на карте
        const scr = ring.map(p => map.project(p));
        const xs = scr.map(q => q.x), ys = scr.map(q => q.y);
        const layers = road ? L.houses : [...L.houses, ...L.roads, ...L.water];
        const feats = map.queryRenderedFeatures([[Math.min(...xs) - 2, Math.min(...ys) - 2], [Math.max(...xs) + 2, Math.max(...ys) + 2]], { layers });
        for (const f of feats) {
            const id = f.layer.id;
            if (f.properties.brunnel === 'tunnel' || isSmallWater(f)) continue;   // под землёй и арыки не мешают
            const { polys, lines } = shapes(f.geometry);
            if (isRoad.has(id)) {
                const cls = f.properties.class;
                if (!BLOCK_ROADS.has(cls) && !RAILS.has(cls)) continue;
                if (lines.some(l => lineHits(toXY(ref, l), A))) {
                    return RAILS.has(cls) ? 'Здесь железная дорога' : 'Здесь улица — её занимать нельзя';
                }
                continue;
            }
            const hit = polys.some(p => polysHit(A, toXY(ref, p))) || lines.some(l => lineHits(toXY(ref, l), A));
            if (hit && id === 'lm-solid') return `Здесь уже стоит ${MODELS[f.properties.id]?.name || 'достопримечательность'}: сносить нельзя`;
            if (hit) return isHouse.has(id) ? 'Здесь стоит дом — существующие здания сносить нельзя' : 'Здесь вода';
        }

        // 2) свои постройки (свои дороги могут пересекаться)
        for (const b of builds) {
            const d = describeBuild(b);
            if (b.kind === 'road') {
                if (road || !meet(box, bbox(d.path.pts))) continue;
                if (polysHit(A, toXY(ref, band(d.path.pts, d.width)[0]))) return `Мешает твоя дорога «${b.name}»`;
            } else if (meet(box, bbox(d.footprint)) && polysHit(A, toXY(ref, d.footprint))) {
                return `Мешает твоя постройка «${b.name}»`;
            }
        }

        // 3) наземные линии ЛРТ и эстакады SkyTrain (метро под землёй не мешает;
        //    дорога пересекает их мостом)
        if (!road) {
            for (const line of getLines()) {
                if (line.type === 'metro' || !line._d) continue;
                const pts = line._d.path.pts;
                if (!meet(box, bbox(pts))) continue;
                if (polysHit(A, toXY(ref, band(pts, 16)[0]))) return `Мешает линия «${line.name}»`;
            }
        }
        return null;
    }

    // Где отрезок дороги пересекает реку, железную дорогу или ЛРТ: [{ s, kind }].
    // Смотрим то, что сейчас нарисовано на карте, — поэтому участок должен быть на экране
    function crossings(a, b) {
        const path = measure([a, b]);
        const layers = [...L.water, ...L.roads, ...['tr-path-line', 'tr-path-building'].filter(id => map.getLayer(id))];
        const out = [];
        for (let s = 0; s <= path.length; s += 8) {
            const q = map.project(pointAt(path, s));
            let kind = null;
            for (const f of map.queryRenderedFeatures([[q.x - 2, q.y - 2], [q.x + 2, q.y + 2]], { layers })) {
                const id = f.layer.id, pr = f.properties;
                if (pr.brunnel === 'tunnel' || isSmallWater(f)) continue;
                if (isWater.has(id)) kind = kind || 'water';
                else if (isRoad.has(id) ? RAILS.has(pr.class) : pr.type === 'lrt') { kind = 'rail'; break; }
            }
            if (kind) out.push({ s, kind });
        }
        return out;
    }

    // Отметки пересечений → пролёты мостов с пандусами
    function spansOf(flags, length) {
        const spans = [];
        for (const f of flags.slice().sort((x, y) => x.s - y.s)) {
            const k = BRIDGE[f.kind];
            const s0 = f.s - 12 - k.ramp, s1 = f.s + 12 + k.ramp;
            const last = spans[spans.length - 1];
            if (last && s0 <= last.s1) {
                last.s1 = Math.max(last.s1, s1);
                if (k.h > last.h) { last.h = k.h; last.ramp = k.ramp; }
            } else spans.push({ s0, s1, h: k.h, ramp: k.ramp });
        }
        for (const sp of spans) { sp.s0 = Math.max(0, Math.round(sp.s0)); sp.s1 = Math.min(Math.round(length), Math.round(sp.s1)); }
        return spans.filter(sp => sp.s1 - sp.s0 > 10);
    }

    // Все отметки дороги вдоль всего пути (у каждого отрезка они свои)
    function roadFlags() {
        const out = [];
        let at = 0;
        draft.flags.forEach((list, k) => {
            for (const f of list) out.push({ s: at + f.s, kind: f.kind });
            at += dist(draft.nodes[k], draft.nodes[k + 1]);
        });
        return out;
    }

    function roadLength(extra = null) {
        let s = 0;
        const n = extra ? draft.nodes.concat([extra]) : draft.nodes;
        for (let i = 1; i < n.length; i++) s += dist(n[i - 1], n[i]);
        return s;
    }

    // ---------- Оценка точки под курсором ----------
    function evaluate(lngLat) {
        const c = [lngLat.lng, lngLat.lat];
        if (tool === 'model') {
            const info = modelInfo({ model: pick.model, c, a: pick.angle });
            const why = blocked(info.footprint);
            return { c, info, ok: !why, reason: why };
        }
        if (tool === 'custom') {
            const ring = draft.ring;
            // Рядом с первым углом — замкнуть здание
            if (ring.length >= 3) {
                const p0 = map.project(ring[0]), q = map.project(c);
                if (Math.hypot(p0.x - q.x, p0.y - q.y) < 14) return { c: ring[0], close: true, ok: true };
            }
            if (ring.length && dist(ring[ring.length - 1], c) < 4) return { c, ok: false, reason: 'Слишком близко к прошлому углу' };
            const pts = ring.concat([c]);
            if (pts.length >= 3) {
                if (selfCross(pts)) return { c, ok: false, reason: 'Стены здания пересекаются' };
                if (areaM2(pts) > MAX_AREA) return { c, ok: false, reason: 'Слишком большое здание: можно до 4 гектаров' };
            }
            const shape = pts.length >= 3 ? closed(pts) : pts.length === 2 ? band(pts, 2)[0] : square(c, 3)[0];
            const why = blocked(shape);
            return { c, ok: !why, reason: why };
        }
        // Дорога
        const nodes = draft.nodes;
        const w = ROADS[pick.road].width * 0.7;   // по краям чуть свободнее — дороги идут вплотную к домам
        if (!nodes.length) {
            const why = blocked(square(c, w)[0], { road: true });
            return { c, ok: !why, reason: why };
        }
        const prev = nodes[nodes.length - 1];
        if (dist(prev, c) < 15) return { c, ok: false, reason: 'Слишком близко к прошлой точке' };
        if (roadLength(c) > MAX_ROAD_M) return { c, ok: false, reason: 'Слишком длинная дорога: можно до 20 км' };
        const why = blocked(band([prev, c], w)[0], { road: true });
        return { c, ok: !why, reason: why };
    }

    // ---------- Черновик на карте ----------
    function preview() {
        const solids = [], flat = [];
        const line = (coords, props) => flat.push({ type: 'Feature', properties: { w: 0, ghost: false, ok: true, color: PREVIEW, ...props },
                                                    geometry: { type: 'LineString', coordinates: coords } });
        const point = (c, ok = true) => flat.push({ type: 'Feature', properties: { ok, color: PREVIEW }, geometry: { type: 'Point', coordinates: c } });

        if (tool === 'model' && ghost) {
            solids.push(...partFeatures(ghost.info.parts, ghost.ok ? null : '#e5484d'));
            line(ghost.info.footprint, { ok: ghost.ok });
        } else if (tool === 'custom') {
            const pts = ghost && !ghost.close ? draft.ring.concat([ghost.c]) : draft.ring.slice();
            const ok = !ghost || ghost.ok;
            if (pts.length >= 3) {
                solids.push(...partFeatures(customInfo({ ring: pts, floors: pick.floors, use: pick.use }).parts, ok ? null : '#e5484d'));
                line(closed(pts), { ok });
            } else if (pts.length === 2) line(pts, { ok });
            draft.ring.forEach(c => point(c));
            if (ghost && !ghost.close) point(ghost.c, ghost.ok);
        } else if (tool === 'road') {
            const w = ROADS[pick.road].width;
            if (draft.nodes.length > 1) line(draft.nodes, { w });
            if (ghost && draft.nodes.length) line([draft.nodes[draft.nodes.length - 1], ghost.c], { w, ghost: true, ok: ghost.ok });
            draft.nodes.forEach(c => point(c));
            if (ghost) point(ghost.c, ghost.ok);
        }
        renderBuildPreview(map, { solids, flat });
    }

    // ---------- Панель ----------
    function stat(label, value) { return `<div><small>${label}</small><b>${value}</b></div>`; }

    function setupPanel() {
        const t = TOOLS[tool];
        el.panel.hidden = false;
        // Анимация появления — и при переключении с одного инструмента на другой
        el.panel.style.animation = 'none';
        void el.panel.offsetWidth;
        el.panel.style.animation = '';
        el.dot.style.background = t.color;
        el.title.textContent = t.title;

        // Переключатель вверху: назначение здания или вид дороги
        const items = tool === 'custom' ? Object.entries(USES).map(([k, u]) => [k, u.name])
            : tool === 'road' ? Object.entries(ROADS).map(([k, r]) => [k, r.name]) : [];
        el.seg.hidden = !items.length;
        el.seg.innerHTML = items.map(([k, n]) => `<button type="button" data-v="${k}">${n}</button>`).join('');
        el.seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
            if (tool === 'custom') pick.use = b.dataset.v; else pick.road = b.dataset.v;
            syncChoices();
            refresh();
        }));

        // Под ним: этажи / список моделей / по земле или эстакадой
        if (tool === 'custom') {
            el.opts.innerHTML = `<label class="b-range"><span>Этажей</span>
                <input type="range" min="1" max="${MAX_FLOORS}" value="${pick.floors}" aria-label="Этажей"><b>${pick.floors}</b></label>`;
            const input = el.opts.querySelector('input');
            input.addEventListener('input', () => {
                pick.floors = Number(input.value);
                syncChoices();
                refresh();
            });
        } else if (tool === 'model') {
            // Список по группам: иконка, название, высота и город
            el.opts.innerHTML = `<div class="b-picks">${MODEL_GROUPS.map(([g, title]) => `
                <div class="b-group">${title}</div>
                <div class="b-grid">${Object.entries(MODELS).filter(([, m]) => m.group === g).map(([k, m]) => `
                    <button class="b-pick" type="button" data-model="${k}">
                        <span class="b-ico"><svg viewBox="0 0 24 24"><path d="${m.icon}"/></svg></span>
                        <span class="b-txt"><b>${m.name}</b><small>${m.height} м${m.where ? ` · ${m.where}` : ''}</small></span>
                    </button>`).join('')}
                </div>`).join('')}</div>`;
            const box = el.opts.querySelector('.b-picks');
            smoothWheel(box);
            // Выбрали здание — меню прячется, включается режим расстановки
            el.opts.querySelectorAll('[data-model]').forEach(b => b.addEventListener('click', () => enterEdit(b.dataset.model)));
            // Сразу видно выбранное в прошлый раз
            const chosen = box.querySelector(`[data-model="${pick.model}"]`);
            if (chosen) box.scrollTop = Math.max(0, chosen.offsetTop - box.offsetTop - 36);
        } else {
            el.opts.innerHTML = `<div class="b-row"><div class="seg">
                <button type="button" data-raised="0">По земле</button><button type="button" data-raised="1">Эстакада</button></div>
                <span>Над рекой и железной дорогой мост появится сам</span></div>`;
            el.opts.querySelectorAll('[data-raised]').forEach(b => b.addEventListener('click', () => {
                pick.raised = b.dataset.raised === '1';
                syncChoices();
                refresh();
            }));
        }

        el.undo.hidden = tool === 'model';
        el.done.hidden = tool === 'model';
        el.rotate.hidden = true;
        el.stats.hidden = tool === 'model';
        syncChoices();
    }

    // Подсветка выбранного в панели
    function syncChoices() {
        const v = tool === 'custom' ? pick.use : pick.road;
        el.seg.querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.v === v));
        const range = el.opts.querySelector('input[type=range]');
        if (range) {
            range.style.setProperty('--p', `${(pick.floors - 1) / (MAX_FLOORS - 1) * 100}%`);
            range.nextElementSibling.textContent = pick.floors;
        }
        el.opts.querySelectorAll('[data-model]').forEach(b => b.classList.toggle('is-active', b.dataset.model === pick.model));
        el.opts.querySelectorAll('[data-raised]').forEach(b => b.classList.toggle('is-active', (b.dataset.raised === '1') === pick.raised));
    }

    function hint() {
        if (tool === 'model') return 'Выбери здание — оно появится на карте, и его можно будет подвинуть и повернуть';
        if (tool === 'custom') {
            const n = draft.ring.length;
            if (!n) return 'Нажми на карту — поставь первый угол здания';
            if (n < 3) return 'Ставь углы по очереди, нужно хотя бы три';
            return 'Нажми на первый угол или «Построить» (Enter)';
        }
        const n = draft.nodes.length;
        if (!n) return 'Нажми на карту — начало дороги';
        if (n < 2) return 'Поставь следующую точку дороги';
        return 'Продолжай дорогу или нажми «Построить» (Enter)';
    }

    function updatePanel(message, bad = false) {
        let html = '';
        if (tool === 'model') {
            html = '';
        } else if (tool === 'custom') {
            const pts = ghost && !ghost.close && ghost.ok ? draft.ring.concat([ghost.c]) : draft.ring;
            const info = pts.length >= 3 ? customInfo({ ring: pts, floors: pick.floors, use: pick.use }) : null;
            const who = pick.use === 'home' ? ['Жителей', info ? info.pop : 0] : ['Рабочих мест', info ? info.jobs : 0];
            html = stat('Площадь', info ? `${fmt(info.area)} м²` : '—')
                + stat('Высота', `${Math.round(pick.floors * FLOOR_M)} м`)
                + stat(who[0], fmt(who[1]))
                + stat('Стройка', info ? `${info.months} мес.` : '—');
            el.done.disabled = draft.ring.length < 3;
        } else {
            const nodes = ghost && ghost.ok && draft.nodes.length ? draft.nodes.concat([ghost.c]) : draft.nodes;
            const info = nodes.length >= 2 ? roadInfo({ road: pick.road, raised: pick.raised, nodes, spans: spansOf(roadFlags(), roadLength()) }) : null;
            // Цена — за уже поставленные точки: столько и спишут при «Построить»
            const placed = draft.nodes.length >= 2 ? roadInfo(roadDraft()) : null;
            const budget = getBudget();
            const tooExpensive = !!placed && placed.cost > budget;
            html = stat('Длина', info ? `${info.km.toFixed(1).replace('.', ',')} км` : '0 км')
                + stat(pick.raised ? 'Эстакада' : 'Мостов', pick.raised ? 'вся' : info ? info.bridges : 0)
                + `<div><small>Стоимость</small><b${tooExpensive ? ' class="is-bad"' : ''}>${info ? info.cost : 0} млрд ₸</b></div>`
                + stat('Стройка', info ? `${info.months} мес.` : '—');
            el.done.disabled = draft.nodes.length < 2 || tooExpensive;
            if (tooExpensive) { message = `Не хватает денег: нужно ${placed.cost} млрд ₸, есть ${Math.floor(budget)}`; bad = true; }
        }
        el.stats.innerHTML = html;
        el.undo.disabled = tool === 'custom' ? !draft.ring.length : tool === 'road' ? !draft.nodes.length : true;
        if (message !== undefined) el.msg.textContent = message;
        el.msg.classList.toggle('is-bad', bad);
    }

    // Пересчитать под курсором (сменили этажи, модель, вид дороги)
    function refresh() {
        if (cursor) ghost = evaluate(cursor);
        preview();
        updatePanel(ghost && !ghost.ok ? ghost.reason : hint(), !!(ghost && !ghost.ok));
    }

    // ---------- Режим расстановки готового здания ----------
    // Видимая часть карты — над маленькой панелью (здание не должно прятаться за ней)
    function viewTop() {
        const r = ed.panel.getBoundingClientRect();
        return ed.panel.hidden || !r.height ? map.getCanvas().clientHeight - 160 : r.top;
    }

    // Камера: здание — посередине видимой части (над панелью)
    function centerOn(c, opts = {}) {
        const H = map.getCanvas().clientHeight;
        map.easeTo({ center: c, offset: [0, -(H - viewTop()) / 2 + 20], duration: 500, ...opts });
        map.once('moveend', () => { if (edit) updateEdit(); });
    }

    // Свободное место рядом с точкой c0 (по спирали, только на видимой части экрана)
    function findSpot(c0) {
        const fp = MODELS[pick.model].fp;
        const size = Math.max(...fp.map(p => Math.hypot(p[0], p[1])));
        const step = Math.max(40, size * 0.8);
        const free = c => !blocked(modelInfo({ model: pick.model, c, a: pick.angle }).footprint);
        if (free(c0)) return c0;
        const W = map.getCanvas().clientWidth, bottom = viewTop() - 30;
        for (let r = 1; r <= 8; r++) {
            for (let k = 0; k < 8 * r; k++) {
                const a = k / (8 * r) * Math.PI * 2;
                const c = move(c0, Math.cos(a) * r * step, Math.sin(a) * r * step);
                const p = map.project(c);
                if (p.x < 40 || p.y < 60 || p.x > W - 40 || p.y > bottom) continue;
                if (free(c)) return c;
            }
        }
        return c0;
    }

    function enterEdit(model) {
        pick.model = model;
        const m = MODELS[model];
        el.panel.hidden = true;
        ed.panel.hidden = false;
        ed.panel.style.animation = 'none';
        void ed.panel.offsetWidth;
        ed.panel.style.animation = '';
        // Ищем место посередине видимой части карты, над панелью
        const start = map.unproject([map.getCanvas().clientWidth / 2, viewTop() * 0.55]);
        edit = { c: findSpot([start.lng, start.lat]) };
        ed.ico.innerHTML = `<svg viewBox="0 0 24 24"><path d="${m.icon}"/></svg>`;
        ed.name.textContent = m.name;
        ed.sub.textContent = `${m.height} м${m.where ? ` · ${m.where}` : ''}`;
        ed.stats.innerHTML = [m.pop ? `${fmt(m.pop)} жит.` : '', m.jobs ? `${fmt(m.jobs)} раб. мест` : '', `стройка ${m.months} мес.`]
            .filter(Boolean).map(t => `<span>${t}</span>`).join('');
        map.keyboard.disable();   // стрелки двигают здание, а не карту
        updateEdit();
        // Высокое здание показываем издалека, чтобы оно влезло целиком;
        // место у края экрана (под часами или панелью) — подвозим камеру
        const z = Math.max(MIN_ZOOM, Math.min(17, 17.2 - Math.log2(Math.max(1, m.height / 30)) * 0.9));
        const p = map.project(edit.c), W = map.getCanvas().clientWidth;
        const needZoom = map.getZoom() > z + 0.3;
        if (needZoom || p.y < 140 || p.y > viewTop() - 40 || p.x < 60 || p.x > W - 60) {
            centerOn(edit.c, needZoom ? { zoom: z, duration: 700 } : {});
        }
    }

    // Пересчитать: свободно ли место, черновик на карте, панель
    function updateEdit(follow = false) {
        if (!edit) return;
        ghost = evaluate({ lng: edit.c[0], lat: edit.c[1] });
        preview();
        ed.msg.textContent = ghost.ok ? 'Место свободно — можно строить' : ghost.reason;
        ed.msg.classList.toggle('is-bad', !ghost.ok);
        ed.msg.classList.toggle('is-ok', ghost.ok);
        ed.done.disabled = !ghost.ok;
        // Ушло за край видимой части — камера едет следом
        if (follow) {
            const p = map.project(edit.c);
            if (p.x < 60 || p.y < 80 || p.x > map.getCanvas().clientWidth - 60 || p.y > viewTop() - 20) centerOn(edit.c, { duration: 400 });
        }
    }

    // Сдвиг по экрану: dx — вправо, dy — вверх (на ~16 пикселей экрана)
    function nudge(dx, dy) {
        if (!edit) return;
        const step = 16 * 57000 / 2 ** map.getZoom();
        const b = map.getBearing() * Math.PI / 180;
        edit.c = move(edit.c, (dy * Math.sin(b) + dx * Math.cos(b)) * step, (dy * Math.cos(b) - dx * Math.sin(b)) * step);
        updateEdit(true);
    }

    function rotate(dir = 1) {
        pick.angle = (pick.angle + dir * Math.PI / 12 + Math.PI * 2) % (Math.PI * 2);
        if (edit) updateEdit(); else refresh();
    }

    // Назад к списку зданий
    function backToList() {
        if (!edit) return;
        edit = null;
        drag = null;
        ghost = null;
        ed.panel.hidden = true;
        map.keyboard.enable();
        map.dragPan.enable();
        renderBuildPreview(map, {});
        setupPanel();
        updatePanel(hint());
    }

    function confirmEdit() {
        if (!edit || !ghost || !ghost.ok) return;
        onBuild({ kind: 'model', model: pick.model, c: round6(edit.c), a: Math.round(pick.angle * 1000) / 1000 });
        stop();
    }

    // Перетаскивание здания мышкой или пальцем
    function dragStart(e) {
        if (!edit || !onGhost(e.point)) return;
        e.preventDefault();   // карта не двигается
        drag = { dx: edit.c[0] - e.lngLat.lng, dy: edit.c[1] - e.lngLat.lat };
        map.dragPan.disable();
        map.getCanvas().style.cursor = 'grabbing';
    }

    function dragMove(e) {
        if (!drag) return;
        edit.c = [e.lngLat.lng + drag.dx, e.lngLat.lat + drag.dy];
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => updateEdit());
    }

    function dragEnd() {
        if (!drag) return;
        drag = null;
        dragged = true;
        setTimeout(() => { dragged = false; }, 50);
        map.dragPan.enable();
        map.getCanvas().style.cursor = 'grab';
        updateEdit();
    }

    // Кнопка, которую можно зажать: действие повторяется, пока держишь
    function holdButton(btn, action) {
        let wait = 0, repeat = 0;
        const end = () => { clearTimeout(wait); clearInterval(repeat); };
        btn.addEventListener('pointerdown', e => {
            e.preventDefault();
            action();
            wait = setTimeout(() => { repeat = setInterval(action, 70); }, 350);
        });
        for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, end);
        btn.addEventListener('click', e => { if (e.detail === 0) action(); });   // с клавиатуры (Enter на кнопке)
    }

    // ---------- События карты ----------
    function onMove(e) {
        if (tool === 'model') {
            // В режиме расстановки здание не бегает за мышкой — его тянут
            if (drag) dragMove(e);
            else if (edit) map.getCanvas().style.cursor = onGhost(e.point) ? 'grab' : 'crosshair';
            return;
        }
        if (e.type === 'touchmove') return;   // пальцем двигают карту, «резинка» за ним не бегает
        cursor = e.lngLat;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => { if (tool) refresh(); });
    }

    function onClick(e) {
        if (!tool) return;
        if (tool === 'model') {
            // Нажали на карту — здание переезжает в эту точку
            if (edit && !dragged) {
                edit.c = [e.lngLat.lng, e.lngLat.lat];
                updateEdit();
            }
            return;
        }
        cursor = e.lngLat;
        const r = evaluate(e.lngLat);
        if (!r.ok) { ghost = r; preview(); updatePanel(r.reason, true); return; }
        if (tool === 'custom') {
            if (r.close) return finish();
            draft.ring.push(r.c);
        } else {
            const prev = draft.nodes[draft.nodes.length - 1];
            if (prev) draft.flags.push(crossings(prev, r.c));
            draft.nodes.push(r.c);
        }
        ghost = null;
        preview();
        updatePanel(hint());
    }

    // ---------- Управление ----------
    function start(t) {
        if (tool) stop();
        tool = t;
        draft = t === 'custom' ? { ring: [] } : t === 'road' ? { nodes: [], flags: [] } : {};
        ghost = null;
        cursor = null;
        setupPanel();
        updatePanel(hint());
        map.doubleClickZoom.disable();
        map.getCanvas().style.cursor = 'crosshair';
        map.on('mousemove', onMove);
        map.on('touchmove', onMove);
        map.on('click', onClick);
        map.on('mousedown', dragStart);
        map.on('touchstart', dragStart);
        map.on('mouseup', dragEnd);
        map.on('touchend', dragEnd);
        // Издалека дома не видно — подлетаем ближе
        if (map.getZoom() < MIN_ZOOM) map.easeTo({ zoom: 15, duration: 900 });
        onChange();
    }

    function stop() {
        tool = null;
        draft = null;
        ghost = null;
        edit = null;
        drag = null;
        cancelAnimationFrame(frame);
        el.panel.hidden = true;
        ed.panel.hidden = true;
        renderBuildPreview(map, {});
        map.doubleClickZoom.enable();
        map.keyboard.enable();
        map.dragPan.enable();
        map.getCanvas().style.cursor = '';
        map.off('mousemove', onMove);
        map.off('touchmove', onMove);
        map.off('click', onClick);
        map.off('mousedown', dragStart);
        map.off('touchstart', dragStart);
        map.off('mouseup', dragEnd);
        map.off('touchend', dragEnd);
        onChange();
    }

    function undo() {
        if (!tool) return;
        if (tool === 'model') return edit ? backToList() : stop();
        const list = tool === 'custom' ? draft.ring : draft.nodes;
        if (!list.length) return stop();
        list.pop();
        if (tool === 'road') draft.flags.length = Math.max(0, draft.nodes.length - 1);
        refresh();
    }

    function finish() {
        if (!tool || tool === 'model') return;
        if (tool === 'custom') {
            const ring = draft.ring;
            if (ring.length < 3) return;
            let why = selfCross(ring) ? 'Стены здания пересекаются' : blocked(closed(ring));
            if (!why && areaM2(ring) < 40) why = 'Слишком маленькое здание';
            if (why) { ghost = null; preview(); return updatePanel(why, true); }
            onBuild({ kind: 'custom', use: pick.use, floors: pick.floors, ring: ring.map(round6) });
        } else {
            if (draft.nodes.length < 2) return;
            const road = roadDraft();
            if (roadInfo(road).cost > getBudget()) return;
            onBuild(road);
        }
        stop();
    }

    // Дорога из поставленных точек — в том виде, в каком её построим
    function roadDraft() {
        const spans = pick.raised ? [] : spansOf(roadFlags(), roadLength());
        return { kind: 'road', road: pick.road, raised: pick.raised, nodes: draft.nodes.map(round6), spans };
    }

    el.undo.addEventListener('click', undo);
    el.rotate.addEventListener('click', () => rotate(1));
    el.cancel.addEventListener('click', stop);
    el.done.addEventListener('click', finish);

    // Панель расстановки: стрелки и повороты можно зажимать
    ed.panel.querySelectorAll('[data-move]').forEach(b => {
        const [dx, dy] = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] }[b.dataset.move];
        holdButton(b, () => nudge(dx, dy));
    });
    ed.panel.querySelectorAll('[data-rot]').forEach(b => holdButton(b, () => rotate(Number(b.dataset.rot))));
    ed.list.addEventListener('click', backToList);
    ed.cancel.addEventListener('click', stop);
    ed.done.addEventListener('click', confirmEdit);
    if (touchScreen) ed.panel.classList.add('is-touch');

    const ARROWS = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

    return {
        start,
        cancel: stop,
        get active() { return !!tool; },
        get tool() { return tool; },
        // Клавиши: Enter — построить, Esc/Backspace — шаг назад.
        // Расстановка: стрелки — двигать (с Shift — быстрее), Q/E или R — повернуть
        handleKey(e) {
            if (!tool) return false;
            if (e.target instanceof HTMLInputElement && e.key !== 'Enter' && e.key !== 'Escape') return false;
            const k = e.key.toLowerCase();
            if (edit && ARROWS[e.key]) {
                const [dx, dy] = ARROWS[e.key], n = e.shiftKey ? 4 : 1;
                nudge(dx * n, dy * n);
            } else if (edit && (k === 'q' || k === 'й')) rotate(-1);
            else if (edit && (k === 'e' || k === 'у' || k === 'r' || k === 'к')) rotate(e.shiftKey ? -1 : 1);
            else if (e.key === 'Enter') { if (edit) confirmEdit(); else finish(); }
            else if (e.key === 'Escape' || e.key === 'Backspace') undo();
            else return false;
            e.preventDefault();
            return true;
        }
    };
}
