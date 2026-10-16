// ===== Строительство: свои здания, готовые модели, дороги и мосты =====
// Здания строят инвесторы — бесплатно. Но город меняется: новые жители
// и рабочие места — это новые поездки (и пробки).
// Дороги и мосты строит город — за деньги из бюджета. Они дают машинам место,
// но лишь отчасти: на новую дорогу быстро приезжают новые машины
// (так бывает и в жизни, поэтому метро выгоднее).
// Существующие дома и дороги сносить нельзя — только свои постройки.
import { move, measure, slice, band, square, pointAt, angleAt } from './geo.js?v=1';
import { cellAt } from './city.js?v=1';
import { storeKey } from './store.js?v=2';
import { MODELS, MODEL_GROUPS, part } from './models.js?v=6';

const EMPTY = { type: 'FeatureCollection', features: [] };
export const FLOOR_M = 3.3;        // высота этажа, м
const ROAD_GAIN = 0.35;            // какая часть новой дороги реально разгружает улицы
const CONCRETE = '#c6cdd6';        // цвет здания на стройке
const CRANE = '#f2b15a';
const SELECTED = '#a9d5f6';       // выбранное здание — голубее
const PICKED = '#4f8cff';         // кайма выбранной дороги и моста

// Назначение своего здания; per — м² площади на одного человека
export const USES = {
    home:   { name: 'Жильё', label: 'Жилой дом', color: '#f1e4d2', roof: '#dcc9ae', per: 30 },
    office: { name: 'Офисы', label: 'Офисное здание', color: '#d3e1f2', roof: '#b4c7de', per: 20 },
    shop:   { name: 'Магазины', label: 'Магазин', color: '#f2d9df', roof: '#ddb9c2', per: 45 }
};

// Дороги: ширина в метрах, «полосность» (как в данных города: км × вес),
// цена — млрд ₸ за км по земле
export const ROADS = {
    street:  { name: 'Улица', label: 'Новая улица', lanes: 2, width: 12, weight: 1.5, costKm: 2, monthsKm: 1.5 },
    avenue:  { name: 'Проспект', label: 'Новый проспект', lanes: 4, width: 20, weight: 4, costKm: 4, monthsKm: 2.5 },
    highway: { name: 'Магистраль', label: 'Новая магистраль', lanes: 6, width: 28, weight: 6, costKm: 7, monthsKm: 3.5 }
};

// Мосты: над рекой — низкий, над железной дорогой и эстакада — высокий (м)
export const BRIDGE = { water: { h: 4, ramp: 25 }, rail: { h: 7.5, ramp: 60 } };
const RAISED_PRICE = 3;            // эстакада дороже дороги по земле во столько раз
const BRIDGE_COST = 3;             // млрд ₸ за мост

// ---------- Готовые модели — в models.js ----------
export { MODELS, MODEL_GROUPS };

// Метры вокруг точки p (поворот a) → координаты карты; кольцо замкнуто
function place(p, a, pts) {
    const c = Math.cos(a), s = Math.sin(a);
    const ring = pts.map(([x, y]) => move(p, x * c - y * s, x * s + y * c));
    ring.push(ring[0]);
    return ring;
}

// ---------- Площадь и центр ----------
// Площадь многоугольника [lon, lat] в м²
export function areaM2(ring) {
    const ref = ring[0], kx = 111320 * Math.cos(ref[1] * Math.PI / 180);
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        s += (a[0] - ref[0]) * kx * (b[1] - ref[1]) * 110540 - (b[0] - ref[0]) * kx * (a[1] - ref[1]) * 110540;
    }
    return Math.abs(s / 2);
}

function centroid(ring) {
    let x = 0, y = 0;
    for (const p of ring) { x += p[0]; y += p[1]; }
    return [x / ring.length, y / ring.length];
}

// ---------- Что за постройка: фигуры, люди, срок ----------
// Своё здание: углы ring (без повтора первого), этажи, назначение
export function customInfo({ ring, floors, use }) {
    const u = USES[use];
    const closed = ring.concat([ring[0]]);
    const area = areaM2(ring);
    const height = floors * FLOOR_M;
    const gfa = area * floors;                 // площадь всех этажей
    const pop = use === 'home' ? Math.round(gfa / u.per) : 0;
    const jobs = Math.round(use === 'home' ? gfa / 400 : gfa / u.per);
    const attr = use === 'shop' ? Math.round(gfa / 9) : 0;
    const center = centroid(ring);
    return {
        parts: [part([closed], 0, height, u.color), part([closed], height, height + 0.6, u.roof)],
        footprint: closed, center, height, area, pop, jobs, attr,
        cells: [{ c: center, pop, jobs, attr, built: area }],
        months: Math.max(3, Math.round(2 + floors * 0.4))
    };
}

// Готовая модель в точке c, повёрнутая на угол a
export function modelInfo({ model, c, a = 0 }) {
    const m = MODELS[model];
    // Фигуры модели в метрах считаем один раз — при каждом сдвиге только переносим их на место
    if (!m._local) m._local = m.parts();
    const parts = m._local.map(p => part(p.rings.map(r => place(c, a, r)), p.base, p.top, p.color));
    const footprint = place(c, a, m.fp);
    const area = areaM2(footprint.slice(0, -1));
    const pop = m.pop || 0, jobs = m.jobs || 0, attr = m.attr || 0;
    return { parts, footprint, center: c, height: m.height, area, pop, jobs, attr,
             cells: [{ c, pop, jobs, attr, built: area }], months: m.months };
}

// Дорога: точки nodes, пролёты мостов spans [{ s0, s1, h, ramp }] (метры вдоль дороги)
export function roadInfo({ road, raised, nodes, spans = [] }) {
    const r = ROADS[road];
    const path = measure(nodes);
    const L = path.length;
    const sp = raised ? [{ s0: 0, s1: L, ...BRIDGE.rail }] : spans;
    // Куски по земле — между мостами
    const ground = [];
    let s = 0;
    for (const x of sp) {
        if (x.s0 - s > 1) ground.push(slice(path, s, x.s0));
        s = Math.max(s, x.s1);
    }
    if (L - s > 1) ground.push(slice(path, s, L));
    // Вклад в «полосность» клеток: каждые 25 м
    const cells = [];
    const STEP = 25;
    for (let t = STEP / 2; t < L; t += STEP) cells.push({ c: pointAt(path, t), road: STEP / 1000 * r.weight * ROAD_GAIN });
    const km = L / 1000;
    const bridges = raised ? 0 : sp.length;
    return {
        path, spans: sp, ground, km, bridges, width: r.width, cells,
        cost: Math.max(1, Math.round(km * r.costKm * (raised ? RAISED_PRICE : 1) + bridges * BRIDGE_COST)),
        months: Math.max(2, Math.round(km * r.monthsKm * (raised ? 1.6 : 1) + bridges * 2))
    };
}

// Посчитанное запоминаем в b._d (постройки не меняются)
export function describeBuild(b) {
    if (!b._d) b._d = b.kind === 'custom' ? customInfo(b) : b.kind === 'model' ? modelInfo(b) : roadInfo(b);
    return b._d;
}

// ---------- Хранение ----------
const valid = b => !!b && (
    b.kind === 'custom' ? !!USES[b.use] && b.ring?.length >= 3 && b.floors > 0
    : b.kind === 'model' ? !!MODELS[b.model] && Array.isArray(b.c)
    : b.kind === 'road' ? !!ROADS[b.road] && b.nodes?.length >= 2
    : false);

// Свободная игра и креатив хранятся отдельно (store.js)
export function loadBuilds() {
    try {
        const saved = JSON.parse(localStorage.getItem(storeKey('builds')) || '[]');
        return Array.isArray(saved) ? saved.filter(valid) : [];
    } catch (e) {
        return []; // испорченное сохранение — начинаем заново
    }
}

// Без посчитанной геометрии _d
export const serializeBuilds = builds => builds.map(({ _d, ...b }) => b);

export function saveBuilds(builds) {
    try { localStorage.setItem(storeKey('builds'), JSON.stringify(serializeBuilds(builds))); } catch (e) { /* нет места — не страшно */ }
}

export function clearBuilds() {
    try { localStorage.removeItem(storeKey('builds')); } catch (e) { /* не страшно */ }
}

// Имя: «Жилой комплекс», второй такой — «Жилой комплекс 2»
export function buildName(builds, b) {
    const base = b.kind === 'custom' ? USES[b.use].label : b.kind === 'model' ? MODELS[b.model].name : ROADS[b.road].label;
    const taken = new Set(builds.map(x => x.name));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
}

// ---------- Влияние на город ----------
const KEYS = ['pop', 'jobs', 'attr', 'road', 'built'];

// Копия исходных данных города (до построек игрока)
export function snapshotCity(city) {
    const base = {};
    for (const k of KEYS) base[k] = city[k].slice();
    return base;
}

// Город = исходные данные + готовые постройки. isReady(b) — стройка закончена
export function applyBuilds(city, base, builds, isReady) {
    for (const k of KEYS) city[k] = base[k].slice();
    const cellArea = city.cell * city.cell;
    for (const b of builds) {
        if (!isReady(b)) continue;
        for (const c of describeBuild(b).cells) {
            const i = cellAt(city, c.c[0], c.c[1]);
            if (i < 0) continue;
            if (c.pop) city.pop[i] += c.pop;
            if (c.jobs) city.jobs[i] += c.jobs;
            if (c.attr) city.attr[i] += c.attr;
            if (c.road) city.road[i] += c.road;
            if (c.built) city.built[i] = Math.min(100, city.built[i] + c.built / cellArea * 100);
        }
    }
}

// ---------- 3D на карте ----------
// Ширина в метрах → пиксели на этом масштабе (широта Алматы); extra — добавка для каймы (число или выражение)
const metersWide = (extra = 0) => ['interpolate', ['exponential', 2], ['zoom'],
    10, ['+', ['*', ['get', 'w'], 0.018], ['/', extra, 2]],
    20, ['+', ['*', ['get', 'w'], 18.4], extra]];

export function setupBuildLayers(map) {
    const symbol = map.getStyle().layers.find(l => l.type === 'symbol')?.id;
    const below = map.getLayer('buildings-3d') ? 'buildings-3d' : symbol;
    // Объёмные — крупными тайлами без запаса у краёв: на рельефе здание у края тайла не двоится (см. landmarks.js)
    for (const id of ['bd-roads', 'bd-solid', 'bd-grow', 'bd-preview-3d', 'bd-preview']) {
        const solid = id === 'bd-solid' || id === 'bd-grow' || id === 'bd-preview-3d';
        map.addSource(id, solid ? { type: 'geojson', data: EMPTY, buffer: 0, maxzoom: 14, tolerance: 0 } : { type: 'geojson', data: EMPTY });
    }

    // Свои дороги — как улицы на карте: светлые тротуары, серый асфальт, белая разметка по полосам.
    // Выбранная — с синей каймой (голубое полотно сливалось бы с рекой)
    const round = { 'line-cap': 'round', 'line-join': 'round' };
    map.addLayer({ id: 'bd-roads-casing', type: 'line', source: 'bd-roads', layout: round,
                   paint: { 'line-color': ['case', ['get', 'selected'], PICKED, '#e6e5df'],
                            'line-width': metersWide(['case', ['get', 'selected'], 8, 6]) } }, below);
    map.addLayer({ id: 'bd-roads-line', type: 'line', source: 'bd-roads', layout: round,
                   paint: { 'line-color': ['case', ['get', 'building'], '#e3e5e8', '#c9cbd0'],
                            'line-width': metersWide() } }, below);
    // На стройке — жёлтый пунктир
    map.addLayer({ id: 'bd-roads-works', type: 'line', source: 'bd-roads', filter: ['get', 'building'],
                   paint: { 'line-color': CRANE, 'line-width': 2, 'line-dasharray': ['literal', [2, 2]] } }, below);
    // Разметка — те же картинки, что у улиц карты (map.js): 2, 4 или 6 полос
    if (map.hasImage('mk-2w4')) {
        map.addLayer({ id: 'bd-roads-mark', type: 'line', source: 'bd-roads', minzoom: 14,
                       filter: ['!', ['get', 'building']],
                       paint: { 'line-pattern': ['step', ['get', 'w'], 'mk-2w2', 16, 'mk-2w4', 24, 'mk-2w6'],
                                'line-width': metersWide(),
                                'line-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 1] } }, below);
    }

    // Готовые здания, модели и мосты (bd-solid) и стройки с кранами (bd-grow).
    // Стройки перерисовываются часто, поэтому отдельно — большие готовые модели не трогаем
    for (const id of ['bd-solid', 'bd-grow']) {
        map.addLayer({
            id, type: 'fill-extrusion', source: id,
            paint: {
                'fill-extrusion-color': ['get', 'color'],
                'fill-extrusion-base': ['get', 'base'],
                'fill-extrusion-height': ['get', 'top'],
                'fill-extrusion-opacity': 0.97,
                'fill-extrusion-vertical-gradient': true
            }
        }, symbol);
    }

    // Черновик: полупрозрачное здание под курсором, контур и точки
    map.addLayer({
        id: 'bd-preview-3d', type: 'fill-extrusion', source: 'bd-preview-3d',
        paint: {
            'fill-extrusion-color': ['get', 'color'],
            'fill-extrusion-base': ['get', 'base'],
            'fill-extrusion-height': ['get', 'top'],
            'fill-extrusion-opacity': 0.55
        }
    });
    map.addLayer({
        id: 'bd-preview-line', type: 'line', source: 'bd-preview',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: round,
        paint: {
            'line-color': ['case', ['get', 'ok'], ['get', 'color'], '#e5484d'],
            'line-width': ['interpolate', ['exponential', 2], ['zoom'],
                10, ['max', 2.5, ['*', ['get', 'w'], 0.018]], 20, ['max', 2.5, ['*', ['get', 'w'], 18.4]]],
            'line-opacity': ['case', ['get', 'ghost'], 0.6, 0.95]
        }
    });
    map.addLayer({
        id: 'bd-preview-points', type: 'circle', source: 'bd-preview',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
            'circle-color': '#ffffff',
            'circle-stroke-color': ['case', ['get', 'ok'], ['get', 'color'], '#e5484d'],
            'circle-stroke-width': 3,
            'circle-radius': 5,
            'circle-pitch-alignment': 'map'
        }
    });
}

const feat = (geometry, properties) => ({ type: 'Feature', properties, geometry });

// Светлее и «голубее» — выбранная постройка
function tint(hex) {
    const a = parseInt(hex.slice(1), 16), b = parseInt(SELECTED.slice(1), 16);
    const mix = sh => Math.round(((a >> sh) & 255) * 0.45 + ((b >> sh) & 255) * 0.55).toString(16).padStart(2, '0');
    return `#${mix(16)}${mix(8)}${mix(0)}`;
}

// Фигуры постройки → объекты карты (color — перекрасить все, например в красный)
export function partFeatures(parts, color = null, id = '') {
    return parts.map(p => feat({ type: 'Polygon', coordinates: p.rings }, { id, color: color || p.color, base: p.base, top: p.top }));
}

// Башенный кран: мачта выше стройки и стрела, которая поворачивается со временем
function crane(out, id, center, h, t) {
    const top = h + 14;
    let seed = 0;   // у каждого крана свой начальный поворот
    for (const ch of id) seed += ch.charCodeAt(0);
    const a = t * 0.15 + seed;
    const dir = [Math.cos(a), Math.sin(a)];
    out.push(feat({ type: 'Polygon', coordinates: square(center, 2.6) }, { id, color: CRANE, base: 0, top }));
    const jib = [move(center, -dir[0] * 10, -dir[1] * 10), move(center, dir[0] * 32, dir[1] * 32)];
    out.push(feat({ type: 'Polygon', coordinates: band(jib, 2.2) }, { id, color: CRANE, base: top - 2, top }));
    out.push(feat({ type: 'Polygon', coordinates: square(move(center, -dir[0] * 8, -dir[1] * 8), 4) }, { id, color: '#8a939e', base: top - 4, top: top - 2 }));
}

// Мост: полотно поднимается пандусом, держится на опорах
function deck(out, id, d, sp, done, selected) {
    const color = !done ? CONCRETE : selected ? PICKED : '#d3d5da';
    const rise = s => sp.h * Math.max(0, Math.min(1, (s - sp.s0) / sp.ramp, (sp.s1 - s) / sp.ramp));
    const STEP = 8;
    for (let s = sp.s0; s < sp.s1 - 0.5; s += STEP) {
        const e = Math.min(sp.s1, s + STEP);
        const top = Math.max(0.35, rise((s + e) / 2));
        out.push(feat({ type: 'Polygon', coordinates: band(slice(d.path, s, e), d.width) }, { id, color, base: Math.max(0, top - 1.2), top }));
    }
    for (let s = sp.s0 + 15; s < sp.s1; s += 30) {
        const h = rise(s);
        if (h < 2.5) continue;
        out.push(feat({ type: 'Polygon', coordinates: square(pointAt(d.path, s), 2.2, d.width * 0.6, angleAt(d.path, s)) },
                      { id, color: '#cfd6df', base: 0, top: h - 1.2 }));
    }
}

/**
 * Перерисовать постройки.
 * progressOf(b) — готовность 0..1: недостроенное здание серое, растёт этажами, рядом кран;
 * t — день игры (крутит стрелы кранов); onlyGrowing — только стройки (их рост каждый день).
 */
export function renderBuilds(map, builds, { selectedId = null, progressOf = () => 1, t = 0, onlyGrowing = false } = {}) {
    if (!map.getSource('bd-solid')) return;
    const roads = [], solids = [], growing = [];
    for (const b of builds) {
        const p = progressOf(b), done = p >= 1, selected = b.id === selectedId;
        if (onlyGrowing && (done || b.kind === 'road')) continue;
        const d = describeBuild(b);
        if (b.kind === 'road') {
            for (const g of d.ground) roads.push(feat({ type: 'LineString', coordinates: g }, { id: b.id, w: d.width, building: !done, selected }));
            for (const sp of d.spans) deck(solids, b.id, d, sp, done, selected);
            continue;
        }
        const out = done ? solids : growing;
        // Сколько уже построено в высоту
        const h = done ? Infinity : Math.max(3, d.height * p);
        for (const part of d.parts) {
            if (part.base >= h) continue;
            const color = !done ? CONCRETE : selected ? tint(part.color) : part.color;
            out.push(feat({ type: 'Polygon', coordinates: part.rings }, { id: b.id, color, base: part.base, top: Math.min(part.top, h) }));
        }
        if (!done) crane(out, b.id, d.center, h, t);
    }
    map.getSource('bd-grow').setData({ type: 'FeatureCollection', features: growing });
    if (onlyGrowing) return;
    map.getSource('bd-roads').setData({ type: 'FeatureCollection', features: roads });
    map.getSource('bd-solid').setData({ type: 'FeatureCollection', features: solids });
}

// Черновик стройки: solids — объёмные фигуры, flat — линии и точки
export function renderBuildPreview(map, { solids = [], flat = [] } = {}) {
    map.getSource('bd-preview-3d')?.setData({ type: 'FeatureCollection', features: solids });
    map.getSource('bd-preview')?.setData({ type: 'FeatureCollection', features: flat });
}
