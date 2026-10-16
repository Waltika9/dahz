// ===== Линии транспорта: виды, хранение, проверка, стоимость =====
import { dist, lerp, roundCorners, measure, project } from './geo.js?v=1';
import { cellAt } from './city.js?v=1';
import { METRO, LRT, SKY } from './model.js?v=4';
import { storeKey } from './store.js?v=2';

// Свойства видов. Цены — в миллиардах тенге (примерно как в реальных проектах),
// срок — месяцев стройки на километр. Скорость — средняя с остановками.
export const TYPES = {
    metro: { name: 'Метро', bit: METRO, color: '#e5484d', costKm: 25, costStation: 10, monthsKm: 2.5, speed: 40, minGap: 700, trainLen: 60 },
    lrt:   { name: 'ЛРТ', bit: LRT, color: '#2fb67c', costKm: 6, costStation: 2, monthsKm: 1, speed: 25, minGap: 400, trainLen: 34 },
    sky:   { name: 'SkyTrain', bit: SKY, color: '#8b5cf6', costKm: 12, costStation: 4, monthsKm: 1.5, speed: 35, minGap: 500, trainLen: 48 }
};

// Цвета новых линий по очереди (как в Mini Metro: у каждой линии свой)
const PALETTE = ['#2f80ed', '#f2994a', '#27ae60', '#9b51e0', '#e84393', '#00a8c6', '#e2b100', '#8d6e63', '#3d5afe', '#d35400'];

// ---------- Состояние ----------
// Линия: { id, type, name, color, locked, nodes: [{ c: [lon, lat], s: 'Имя станции' | null }] }
export function createLines(metroData) {
    const lines = [];

    // Существующая линия 1: путь из данных, станции вставляем в путь как узлы
    const m = metroData.lines[0];
    const path = measure(m.path);
    const stops = m.stations.map(st => ({ ...project(path, st.c), st })).sort((a, b) => a.at - b.at);
    const nodes = [];
    let k = 0;
    for (let i = 0; i < m.path.length; i++) {
        while (k < stops.length && stops[k].at <= path.cum[i]) {
            nodes.push({ c: stops[k].st.c, s: stops[k].st.n }); k++;
        }
        nodes.push({ c: m.path[i], s: null });
    }
    while (k < stops.length) { nodes.push({ c: stops[k].st.c, s: stops[k].st.n }); k++; }
    lines.push({ id: 'm1', type: 'metro', name: 'Линия 1', color: TYPES.metro.color, locked: true, nodes: trimEnds(nodes) });

    // Линии игрока из браузера (свободная игра и креатив хранятся отдельно)
    try {
        const saved = JSON.parse(localStorage.getItem(storeKey('lines')) || '[]');
        for (const l of saved) if (TYPES[l.type] && l.nodes?.length >= 2) lines.push(l);
    } catch (e) { /* испорченное сохранение — начинаем заново */ }
    return lines;
}

// Линия начинается и кончается станцией
function trimEnds(nodes) {
    let a = 0, b = nodes.length - 1;
    while (a < b && !nodes[a].s) a++;
    while (b > a && !nodes[b].s) b--;
    return nodes.slice(a, b + 1);
}

export function clearLines() {
    try { localStorage.removeItem(storeKey('lines')); } catch (e) { /* не страшно */ }
}

// Только то, что нужно для восстановления (без линии 1 и посчитанной геометрии _d)
export function serializeLines(lines) {
    return lines.filter(l => !l.locked).map(({ id, type, name, color, nodes, start, ready, cost, ext }) =>
        ({ id, type, name, color, nodes, start, ready, cost, ...(ext ? { ext } : {}) }));
}

// ---------- Продление и укорачивание ----------
// Продление открытой линии строится отдельно, а старая часть продолжает возить людей:
// line.ext = { end: 'head' | 'tail', nodes: [новые узлы от конечной наружу], start, ready, cost }

// Конечная станция с нужного конца
export const endNode = (line, end) => (end === 'head' ? line.nodes[0] : line.nodes[line.nodes.length - 1]);

// Участок продления как отдельная «линия» — для рисования и подсчёта
export function extLine(line, end = line.ext.end, nodes = line.ext.nodes) {
    return { id: `${line.id}:ext`, ext: true, type: line.type, color: line.color, name: line.name,
             nodes: [endNode(line, end), ...nodes], start: line.ext?.start, ready: line.ext?.ready };
}

// Цена и срок продления: конечная станция уже оплачена
export function describeExt(line, end, nodes) {
    const d = describe(extLine(line, end, nodes));
    const t = TYPES[line.type];
    return { km: d.km, stations: d.stations.length - 1, cost: Math.max(1, d.cost - t.costStation),
             months: Math.max(2, Math.round(d.km * t.monthsKm)) };
}

// Пристроить новые узлы к линии
export function joinNodes(line, end, nodes) {
    return end === 'tail' ? line.nodes.concat(nodes) : nodes.slice().reverse().concat(line.nodes);
}

// Линия без конечной станции с конца end (и поворотов до соседней станции); null — короче нельзя
export function cutEnd(line, end) {
    if (line.nodes.filter(n => n.s).length < 3) return null;
    const nodes = end === 'head' ? line.nodes.slice() : line.nodes.slice().reverse();
    nodes.shift();
    while (nodes.length && !nodes[0].s) nodes.shift();
    return end === 'head' ? nodes : nodes.reverse();
}

export function saveLines(lines) {
    try { localStorage.setItem(storeKey('lines'), JSON.stringify(serializeLines(lines))); } catch (e) { /* нет места — не страшно */ }
}

export function nextColor(lines) {
    const used = new Set(lines.map(l => l.color));
    return PALETTE.find(c => !used.has(c)) || PALETTE[lines.length % PALETTE.length];
}

export function nextName(lines) {
    let n = lines.length + 1;
    while (lines.some(l => l.name === `Линия ${n}`)) n++;
    return `Линия ${n}`;
}

// ---------- Геометрия и цифры линии ----------
export function describe(line) {
    const raw = line.nodes.map(n => n.c);
    const stationIdx = new Set(line.nodes.map((n, i) => (n.s ? i : -1)).filter(i => i >= 0));
    const smooth = line.locked ? raw : roundCorners(raw, 140, stationIdx);
    const path = measure(smooth);
    const stations = line.nodes.filter(n => n.s).map(n => ({ c: n.c, name: n.s, at: project(path, n.c).at }));
    const t = TYPES[line.type];
    const km = path.length / 1000;
    return {
        path,
        stations,
        km,
        cost: Math.round(km * t.costKm + stations.length * t.costStation),
        months: Math.max(4, Math.round(km * t.monthsKm))
    };
}

// ---------- Проверка участка ----------
// Идём по прямой с шагом 80 м: каждая клетка должна разрешать этот вид транспорта
export function checkSegment(city, terrain, type, a, b) {
    const bit = TYPES[type].bit;
    const d = dist(a, b);
    const steps = Math.max(1, Math.ceil(d / 80));
    for (let k = 0; k <= steps; k++) {
        const p = lerp(a, b, k / steps);
        const i = cellAt(city, p[0], p[1]);
        if (i < 0) return { ok: false, reason: 'За краем карты', at: p };
        if (!(terrain.allow[i] & bit)) {
            // Причина именно для этого вида (регистр не важен: «ЛРТ», «SkyTrain»)
            const why = terrain.why[i].find(r => r.toLowerCase().startsWith(TYPES[type].name.toLowerCase())) || terrain.why[i][0];
            return { ok: false, reason: why ? `Здесь нельзя: ${why}` : 'Здесь нельзя', at: p };
        }
    }
    return { ok: true };
}

// ---------- Название станции ----------
const PREFIX = /^(улица|проспект|переулок|бульвар|шоссе|микрорайон|мкр\.?|площадь|тракт)\s+/i;
const SUFFIX = /\s+(көшесі|даңғылы|улица|проспект|шағынауданы)$/i;

export function nameStation(map, city, lngLat, usedNames) {
    const c = [lngLat.lng, lngLat.lat];
    const free = n => n && !usedNames.has(n);

    // 1) рядом что-то известное: ТЦ, вуз, вокзал, рынок
    let best = null, bestD = 350;
    for (const p of city.pois) {
        const d = dist(p.c, c);
        if (d < bestD && free(p.n) && p.n.length <= 28) { best = p.n; bestD = d; }
    }
    if (best) return best;

    // 2) ближайшая крупная улица (подписи на карте)
    const pt = map.project(lngLat);
    const layers = ['highway-name-major', 'highway-name-minor'].filter(id => map.getLayer(id));
    const feats = layers.length ? map.queryRenderedFeatures([[pt.x - 45, pt.y - 45], [pt.x + 45, pt.y + 45]], { layers }) : [];
    for (const f of feats) {
        const raw = f.properties['name:ru'] || f.properties.name;
        if (!raw) continue;
        const n = raw.replace(PREFIX, '').replace(SUFFIX, '').trim();
        if (free(n) && n.length <= 28) return n;
    }

    // 3) район и номер
    const i = cellAt(city, c[0], c[1]);
    const d = i >= 0 ? city.district[i] : -1;
    const base = d >= 0 ? city.districtNames[d].replace(' район', '') : 'Станция';
    let k = 1;
    while (usedNames.has(`${base}-${k}`)) k++;
    return `${base}-${k}`;
}
