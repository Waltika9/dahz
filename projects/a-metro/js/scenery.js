// ===== Детали карты: деревья и пешеходные «зебры» =====
// В бесплатных данных карты (OpenStreetMap) нет отдельных деревьев и переходов,
// поэтому достраиваем их сами — только рядом с камерой и на близком масштабе:
// - деревья сажаем в парки, скверы, леса, во дворы и вдоль улиц (Алматы — зелёный город);
// - «зебры» рисуем там, где пересекаются улицы.
// Каждое место всегда получает одни и те же деревья: случайность «по координатам».
import { meters } from './map.js?v=4';

const KX = 111320 * Math.cos(43.25 * Math.PI / 180), KY = 110540;   // метров в градусе на широте Алматы
const MIN_ZOOM = 14;
const PHONE = matchMedia('(hover: none)').matches || innerWidth < 760;
const MAX_TREES = PHONE ? 1400 : 3200;   // больше — тормозит
const MAX_ZEBRAS = 500;
const EMPTY = { type: 'FeatureCollection', features: [] };

// Ширина улиц в метрах (как в map.js); у односторонних — примерно половина
const ROAD_W = { motorway: 30, trunk: 30, primary: 26, secondary: 20, tertiary: 15, minor: 9, service: 5.5, track: 4, path: 2.5, rail: 6, transit: 6 };
const CAR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor']);
const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
const STREET_TREES = new Set(['primary', 'secondary', 'tertiary', 'minor']);
const WATERWAY_W = { river: 18, canal: 8, stream: 4 };

// Где и как густо сажать: шаг сетки (м), доля занятых клеток, доля ёлок
const GREEN = {
    wood: [7, 0.85, 0.35], park: [9, 0.7, 0.22], garden: [10, 0.55, 0.15], grass: [12, 0.42, 0.15], cemetery: [9, 0.6, 0.5],
    school: [14, 0.3, 0.1], kindergarten: [12, 0.35, 0.1], university: [13, 0.3, 0.1], college: [14, 0.3, 0.1],
    hospital: [12, 0.4, 0.12], residential: [16, 0.22, 0.1]
};
// Здесь деревьев не бывает
const BARE = new Set(['pitch', 'playground', 'stadium', 'track', 'garages', 'parking', 'railway', 'quarry']);

const LEAF = ['#7cbf5b', '#88c864', '#72b457', '#95cf6c', '#69ad54', '#80c05a'];
const PINE = ['#4f9a5e', '#58a666', '#47905a'];
const TRUNK = '#8d6e52';

// ---------- Мелочи ----------
// Случайное число 0..1, всегда одинаковое для одной клетки
function rnd(i, j, s = 0) {
    let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function darker(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const ch = sh => Math.round(((n >> sh) & 255) * (1 - k)).toString(16).padStart(2, '0');
    return `#${ch(16)}${ch(8)}${ch(0)}`;
}

// Сетка-«корзинки» для быстрого поиска соседей
class Grid {
    constructor(size) { this.s = size; this.m = new Map(); }
    add(x0, y0, x1, y1, item) {
        const s = this.s;
        for (let i = Math.floor(x0 / s); i <= Math.floor(x1 / s); i++) for (let j = Math.floor(y0 / s); j <= Math.floor(y1 / s); j++) {
            const k = i * 1e6 + j;
            const list = this.m.get(k);
            if (list) list.push(item); else this.m.set(k, [item]);
        }
    }
    near(x, y) { return this.m.get(Math.floor(x / this.s) * 1e6 + Math.floor(y / this.s)) || []; }
}

const toM = p => [p[0] * KX, p[1] * KY];
const toLL = (x, y) => [x / KX, y / KY];

function bboxOf(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    return [x0, y0, x1, y1];
}
const meet = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

function inRing(x, y, ring) {
    let yes = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) yes = !yes;
    }
    return yes;
}
// Внутри многоугольника: в контуре, но не в дырке
const inPoly = (x, y, rings) => inRing(x, y, rings[0]) && !rings.slice(1).some(r => inRing(x, y, r));

function distSeg(x, y, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L));
    return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}
function distRing(x, y, ring) {
    let d = Infinity;
    for (let i = 1; i < ring.length; i++) d = Math.min(d, distSeg(x, y, ring[i - 1][0], ring[i - 1][1], ring[i][0], ring[i][1]));
    return d;
}

// Многоугольники и линии объекта карты (в метрах)
function polysOf(g) {
    if (g.type === 'Polygon') return [g.coordinates.map(r => r.map(toM))];
    if (g.type === 'MultiPolygon') return g.coordinates.map(p => p.map(r => r.map(toM)));
    return [];
}
function linesOf(g) {
    if (g.type === 'LineString') return [g.coordinates.map(toM)];
    if (g.type === 'MultiLineString') return g.coordinates.map(l => l.map(toM));
    return [];
}

// Правильный многоугольник в метрах → кольцо [lon, lat]
function ngon(x, y, r, n, rot) {
    const ring = [];
    for (let k = 0; k <= n; k++) {
        const t = rot + (k % n) / n * Math.PI * 2;
        ring.push(toLL(x + Math.cos(t) * r, y + Math.sin(t) * r));
    }
    return [ring];
}
const solid = (coordinates, b, t, c) => ({ type: 'Feature', properties: { b, t, c }, geometry: { type: 'Polygon', coordinates } });

// Дерево: ствол и крона ярусами (низкополигонально, как в 2ГИС, только зелёное)
function addTree(out, x, y, conifer, r1, r2, r3) {
    const rot = r3 * 7;
    if (conifer) {
        const h = 8 + r1 * 6, r = 2 + r2 * 1.2, c = PINE[Math.floor(r3 * PINE.length)];
        out.push(solid(ngon(x, y, 0.35, 4, rot), 0, h * 0.25, TRUNK));
        [[1, 0.15, 0.42], [0.76, 0.38, 0.62], [0.52, 0.58, 0.8], [0.28, 0.78, 1]]
            .forEach(([k, a, b], i) => out.push(solid(ngon(x, y, r * k, 7, rot + i), h * a, h * b, i % 2 ? c : darker(c, 0.1))));
    } else {
        const h = 7 + r1 * 5, r = 2.2 + r2 * 1.4, c = LEAF[Math.floor(r3 * LEAF.length)];
        out.push(solid(ngon(x, y, 0.3, 4, rot), 0, h * 0.42, TRUNK));
        [[0.78, 0.3, 0.52], [1, 0.52, 0.8], [0.62, 0.8, 1]]
            .forEach(([k, a, b], i) => out.push(solid(ngon(x, y, r * k, 7, rot + i * 0.5), h * a, h * b, i === 0 ? darker(c, 0.12) : i === 2 ? darker(c, -0.06) : c)));
    }
}

// ---------- Что есть на карте вокруг ----------
function gather(map, box) {
    const ll = [box[0] / KX, box[1] / KY, box[2] / KX, box[3] / KY];
    const src = sl => map.querySourceFeatures('openmaptiles', { sourceLayer: sl });
    // Объект хотя бы краем в нашем квадрате (проверяем по первой линии — быстро)
    const near = g => {
        const c = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates.flatMap(p => p[0])
            : g.type === 'LineString' ? g.coordinates : g.type === 'MultiLineString' ? g.coordinates.flat() : null;
        return c && c.length && meet(bboxOf(c), ll);
    };

    const segs = new Grid(40), blds = new Grid(40), bans = new Grid(80);
    const green = [], roads = [];
    const addSegs = (pts, hw, info) => {
        for (let i = 1; i < pts.length; i++) {
            const [ax, ay] = pts[i - 1], [bx, by] = pts[i], m = hw + 2;
            segs.add(Math.min(ax, bx) - m, Math.min(ay, by) - m, Math.max(ax, bx) + m, Math.max(ay, by) + m, { ax, ay, bx, by, hw, ...info });
        }
    };

    for (const f of src('transportation')) {
        const g = f.geometry, p = f.properties;
        if (p.brunnel === 'tunnel' || !near(g)) continue;
        const w = ROAD_W[p.class];
        if (!w) continue;
        const hw = w * (p.oneway && CAR.has(p.class) ? 0.55 : 1) / 2;
        for (const pts of linesOf(g)) {
            addSegs(pts, hw, { cls: p.class });
            if (CAR.has(p.class) && p.brunnel !== 'bridge') roads.push({ pts, cls: p.class, hw });
        }
        for (const rings of polysOf(g)) bans.add(...bboxOf(rings[0]), { rings, bb: bboxOf(rings[0]) });   // площади улиц
    }
    for (const f of src('waterway')) {
        const w = WATERWAY_W[f.properties.class] || 1.5;
        if (f.properties.brunnel === 'tunnel' || !near(f.geometry)) continue;
        for (const pts of linesOf(f.geometry)) addSegs(pts, w / 2, { cls: 'water' });
    }
    for (const sl of ['water', 'aeroway']) for (const f of src(sl)) {
        if (!near(f.geometry)) continue;
        for (const rings of polysOf(f.geometry)) bans.add(...bboxOf(rings[0]), { rings, bb: bboxOf(rings[0]) });
    }
    for (const f of src('building')) {
        if (!near(f.geometry)) continue;
        for (const rings of polysOf(f.geometry)) {
            const bb = bboxOf(rings[0]);
            blds.add(bb[0] - 2, bb[1] - 2, bb[2] + 2, bb[3] + 2, { ring: rings[0], bb });
        }
    }
    for (const f of src('landcover')) {
        const p = f.properties;
        const kind = p.class === 'wood' ? 'wood' : p.class === 'grass' ? (GREEN[p.subclass] ? p.subclass : p.subclass === 'flowerbed' ? null : 'grass') : null;
        if (!near(f.geometry)) continue;
        for (const rings of polysOf(f.geometry)) {
            if (kind) green.push({ rings, bb: bboxOf(rings[0]), kind });
            else if (p.class === 'sand') bans.add(...bboxOf(rings[0]), { rings, bb: bboxOf(rings[0]) });
        }
    }
    for (const f of src('landuse')) {
        const cls = f.properties.class;
        if ((!GREEN[cls] && !BARE.has(cls)) || !near(f.geometry)) continue;
        for (const rings of polysOf(f.geometry)) {
            if (BARE.has(cls)) bans.add(...bboxOf(rings[0]), { rings, bb: bboxOf(rings[0]) });
            else green.push({ rings, bb: bboxOf(rings[0]), kind: cls });
        }
    }
    return { segs, blds, bans, green, roads };
}

// ---------- Деревья ----------
function plantTrees(data, box, focus, obstacles) {
    const { segs, blds, bans, green, roads } = data;
    for (const ring of obstacles) {
        const rings = [ring.map(toM)], bb = bboxOf(rings[0]);
        bans.add(bb[0] - 3, bb[1] - 3, bb[2] + 3, bb[3] + 3, { rings, bb, pad: 3 });
    }
    const cand = [], seen = new Set();
    // в зелёных зонах — по сетке со случайным сдвигом
    for (const g of green) {
        const [s, p, pine] = GREEN[g.kind];
        const i0 = Math.floor(Math.max(g.bb[0], box[0]) / s), i1 = Math.floor(Math.min(g.bb[2], box[2]) / s);
        const j0 = Math.floor(Math.max(g.bb[1], box[1]) / s), j1 = Math.floor(Math.min(g.bb[3], box[3]) / s);
        if (i1 < i0 || j1 < j0 || (i1 - i0 + 1) * (j1 - j0 + 1) > 120000) continue;
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
            if (rnd(i, j, s) > p) continue;
            const key = (s * 4e6 + i % 4e6) * 4e6 + j % 4e6;
            if (seen.has(key)) continue;   // один и тот же парк попадает в соседние тайлы
            const x = (i + 0.5 + (rnd(i, j, s + 1) - 0.5) * 0.8) * s, y = (j + 0.5 + (rnd(i, j, s + 2) - 0.5) * 0.8) * s;
            if (!inPoly(x, y, g.rings)) continue;
            seen.add(key);
            cand.push({ x, y, pine: rnd(i, j, s + 3) < pine, i, j });
        }
    }
    // вдоль улиц — с обеих сторон, за тротуаром
    for (const r of roads) {
        if (!STREET_TREES.has(r.cls)) continue;
        const off = r.hw + 2.8;
        let left = 5;
        for (let k = 1; k < r.pts.length; k++) {
            const [ax, ay] = r.pts[k - 1], [bx, by] = r.pts[k], L = Math.hypot(bx - ax, by - ay);
            if (L < 0.5) continue;
            const ux = (bx - ax) / L, uy = (by - ay) / L;
            for (; left < L; left += 11) {
                const x = ax + ux * left, y = ay + uy * left;
                if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) continue;
                for (const side of [-1, 1]) {
                    const tx = x - uy * off * side, ty = y + ux * off * side, i = Math.round(tx / 3), j = Math.round(ty / 3);
                    if (rnd(i, j, 7) < 0.78) cand.push({ x: tx, y: ty, pine: rnd(i, j, 8) < 0.04, i, j });
                }
            }
            left -= L;
        }
    }
    // ближние к камере — первыми
    for (const c of cand) c.d = (c.x - focus[0]) ** 2 + (c.y - focus[1]) ** 2;
    cand.sort((a, b) => a.d - b.d);

    const placed = new Grid(5), out = [];
    let count = 0;
    outer: for (const c of cand) {
        if (count >= MAX_TREES) break;
        const { x, y } = c;
        if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) continue;
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
            for (const q of placed.near(x + di * 5, y + dj * 5)) if ((q[0] - x) ** 2 + (q[1] - y) ** 2 < 4.5 * 4.5) continue outer;
        }
        for (const s of segs.near(x, y)) if (distSeg(x, y, s.ax, s.ay, s.bx, s.by) < s.hw + 1.2) continue outer;
        for (const b of blds.near(x, y)) {
            if (x < b.bb[0] - 1.6 || x > b.bb[2] + 1.6 || y < b.bb[1] - 1.6 || y > b.bb[3] + 1.6) continue;
            if (inRing(x, y, b.ring) || distRing(x, y, b.ring) < 1.6) continue outer;
        }
        for (const b of bans.near(x, y)) {
            const pad = b.pad || 0;
            if (x < b.bb[0] - pad || x > b.bb[2] + pad || y < b.bb[1] - pad || y > b.bb[3] + pad) continue;
            if (inPoly(x, y, b.rings) || (pad && distRing(x, y, b.rings[0]) < pad)) continue outer;
        }
        placed.add(x, y, x, y, [x, y]);
        addTree(out, x, y, c.pine, rnd(c.i, c.j, 11), rnd(c.i, c.j, 12), rnd(c.i, c.j, 13));
        count++;
    }
    return out;
}

// ---------- «Зебры» на перекрёстках ----------
function placeZebras(data, box, focus) {
    const g = new Grid(50), list = [];
    data.roads.forEach((r, li) => {
        for (let k = 1; k < r.pts.length; k++) {
            const [ax, ay] = r.pts[k - 1], [bx, by] = r.pts[k], L = Math.hypot(bx - ax, by - ay);
            if (L < 0.5) continue;
            const s = { ax, ay, bx, by, ux: (bx - ax) / L, uy: (by - ay) / L, L, li, cls: r.cls, hw: r.hw };
            list.push(s);
            g.add(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by), s);
        }
    });
    // где пересекаются две разные улицы (хотя бы одна большая) под заметным углом
    const hits = [], hitGrid = new Grid(10);
    for (const s of list) {
        if (!MAJOR.has(s.cls)) continue;
        const cand = new Set();
        const x0 = Math.min(s.ax, s.bx), x1 = Math.max(s.ax, s.bx), y0 = Math.min(s.ay, s.by), y1 = Math.max(s.ay, s.by);
        for (let i = Math.floor(x0 / 50); i <= Math.floor(x1 / 50); i++) for (let j = Math.floor(y0 / 50); j <= Math.floor(y1 / 50); j++) {
            for (const t of g.near(i * 50 + 1, j * 50 + 1)) cand.add(t);
        }
        for (const t of cand) {
            if (t.li === s.li || (MAJOR.has(t.cls) && t.li < s.li)) continue;   // каждую пару — один раз
            const den = s.ux * t.uy - s.uy * t.ux;
            if (Math.abs(den) < 0.57) continue;                                   // почти параллельно (куски одной улицы)
            const dx = t.ax - s.ax, dy = t.ay - s.ay;
            const u = (dx * t.uy - dy * t.ux) / den, v = (dx * s.uy - dy * s.ux) / den;
            if (u < 0 || u > s.L || v < 0 || v > t.L) continue;
            const x = s.ax + s.ux * u, y = s.ay + s.uy * u;
            if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) continue;
            if (hitGrid.near(x, y).some(h => Math.hypot(h.x - x, h.y - y) < 6)) continue;
            const h = { x, y, a: s, b: t };
            hits.push(h);
            hitGrid.add(x - 6, y - 6, x + 6, y + 6, h);
        }
    }
    hits.sort((p, q) => ((p.x - focus[0]) ** 2 + (p.y - focus[1]) ** 2) - ((q.x - focus[0]) ** 2 + (q.y - focus[1]) ** 2));

    const out = [];
    for (const h of hits) {
        if (out.length >= MAX_ZEBRAS) break;
        for (const [R, O] of [[h.a, h.b], [h.b, h.a]]) {
            const d = O.hw + 4.5;
            for (const dir of [-1, 1]) {
                const ux = R.ux * dir, uy = R.uy * dir, qx = h.x + ux * d, qy = h.y + uy * d;
                // за перекрёстком улица продолжается?
                if (!g.near(qx, qy).some(s => s.cls === R.cls && distSeg(qx, qy, s.ax, s.ay, s.bx, s.by) < 1.5)) continue;
                // а не начинается ли там сразу другой перекрёсток (дорога с разделительной полосой)?
                const busy = hits.some(o => o !== h && Math.abs(o.x - h.x) < d + 8 && Math.abs(o.y - h.y) < d + 8 &&
                    (o.x - h.x) * ux + (o.y - h.y) * uy > 0 &&
                    (o.x - h.x) * ux + (o.y - h.y) * uy < d + 6 &&
                    Math.abs((o.x - h.x) * uy - (o.y - h.y) * ux) < R.hw + 3);
                if (busy) continue;
                out.push({ type: 'Feature', properties: { w: R.hw * 2 - 1 },
                           geometry: { type: 'LineString', coordinates: [toLL(qx - ux * 2, qy - uy * 2), toLL(qx + ux * 2, qy + uy * 2)] } });
            }
        }
    }
    return out;
}

// ---------- Слои и пересчёт ----------
// getObstacles() — кольца [lon, lat], где деревьям не место (постройки игрока, линии, достопримечательности)
export function createScenery(map, { getObstacles = () => [] } = {}) {
    const symbol = map.getStyle().layers.find(l => l.type === 'symbol')?.id;
    const roadsTop = map.getLayer('railway_transit') ? 'railway_transit' : symbol;
    map.addSource('scn-zebra', { type: 'geojson', data: EMPTY });
    map.addSource('scn-trees', { type: 'geojson', buffer: 0, maxzoom: 14, tolerance: 0, data: EMPTY });   // как у зданий в landmarks.js: на рельефе не двоится
    map.addLayer({
        id: 'scn-zebra', type: 'line', source: 'scn-zebra', minzoom: 14.5,
        layout: { 'line-cap': 'butt' },
        paint: { 'line-pattern': 'mk-zebra', 'line-width': meters(['get', 'w']), 'line-opacity': 0.95 }
    }, roadsTop);
    map.addLayer({
        id: 'scn-trees', type: 'fill-extrusion', source: 'scn-trees', minzoom: MIN_ZOOM,
        paint: {
            'fill-extrusion-color': ['get', 'c'],
            'fill-extrusion-base': ['get', 'b'],
            'fill-extrusion-height': ['get', 't'],
            'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], MIN_ZOOM, 0, MIN_ZOOM + 0.4, 1],
            'fill-extrusion-vertical-gradient': true
        }
    }, symbol);

    let last = null, timer = 0, dirty = false;
    const clear = () => {
        map.getSource('scn-trees').setData(EMPTY);
        map.getSource('scn-zebra').setData(EMPTY);
    };

    // Область вокруг точки ближе к низу экрана — там, где камера видит крупно
    function view() {
        const cv = map.getCanvas(), z = map.getZoom();
        const p = map.unproject([cv.clientWidth / 2, cv.clientHeight * 0.68]);
        const R = Math.min(1600, Math.max(320, 700 * 2 ** (15.5 - z)));
        return { z, f: [p.lng * KX, p.lat * KY], R };
    }

    function run() {
        const v = view();
        if (v.z < MIN_ZOOM) return;
        if (!map.isSourceLoaded('openmaptiles')) { dirty = true; return; }   // досчитаем, когда тайлы догрузятся
        last = v;
        dirty = false;
        const box = [v.f[0] - v.R, v.f[1] - v.R, v.f[0] + v.R, v.f[1] + v.R];
        let data;
        try { data = gather(map, box); } catch (e) { console.warn(e); return; }
        map.getSource('scn-trees').setData({ type: 'FeatureCollection', features: plantTrees(data, box, v.f, getObstacles()) });
        map.getSource('scn-zebra').setData({ type: 'FeatureCollection', features: v.z >= 14.5 ? placeZebras(data, box, v.f) : [] });
    }
    // Пауза: сразу после прыжка камеры карта ещё не успела попросить новые тайлы
    const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 350); };

    // Камера остановилась и тайлы карты догрузились — пересчитать, если ушли далеко.
    // Ждём именно тайлы карты: «idle» во время игры почти не бывает — поезда всё время едут
    function check() {
        if (map.isMoving() || !map.isSourceLoaded('openmaptiles')) return;
        const v = view();
        if (v.z < MIN_ZOOM) {
            if (last) { last = null; clear(); }
            return;
        }
        const moved = !last || Math.abs(v.z - last.z) > 0.45 || Math.hypot(v.f[0] - last.f[0], v.f[1] - last.f[1]) > last.R * 0.3;
        if (moved || dirty) schedule();
    }
    map.on('moveend', check);
    map.on('sourcedata', e => { if (e.sourceId === 'openmaptiles' && e.isSourceLoaded) check(); });
    check();

    let sig = '';
    return {
        // постройки или линии изменились — деревья пересадить (если и правда изменились)
        refresh() {
            const obs = getObstacles();
            const s = obs.length + ':' + obs.reduce((a, r) => a + r.length + r[0][0] + r[0][1], 0).toFixed(6);
            if (s === sig) return;
            sig = s;
            dirty = true;
            if (map.getZoom() >= MIN_ZOOM) schedule();
        }
    };
}
