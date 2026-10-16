// ===== Достопримечательности Алматы — на своих настоящих местах =====
// Цветные модели из models.js стоят там же, где настоящие здания (координаты — из OpenStreetMap).
// Серые дома карты на этих местах прячем, чтобы они не торчали сквозь модель.
// Достопримечательности — часть города: сносить их нельзя, на людей и пробки они уже «посчитаны».
import { MODELS, modelInfo, partFeatures } from './builds.js?v=9';
import { move } from './geo.js?v=1';

// at — точка на карте, off — сдвиг центра модели в метрах (восток, север), a — поворот в радианах
const SPOTS = [
    { model: 'kazakhstan',  at: [76.957697, 43.24491],  off: [0, 0],     a: 0 },
    { model: 'koktobe',     at: [76.976307, 43.228706], off: [1, 0],     a: 0.1 },
    { model: 'nurlytau',    at: [76.946288, 43.230241], off: [0, 0],     a: 0 },
    { model: 'rixos',       at: [76.934604, 43.249468], off: [3, 1],     a: 0.14 },
    { model: 'esentai',     at: [76.929346, 43.219234], off: [-14, -15], a: 2.339 },
    { model: 'esentaimall', at: [76.929346, 43.219234], off: [-79, -68], a: 2.304 },
    { model: 'cathedral',   at: [76.953172, 43.258785], off: [0, 0],     a: 0.08 },
    { model: 'kbtu',        at: [76.943135, 43.255762], off: [-2, -10],  a: 0.1 },
    { model: 'circus',      at: [76.917284, 43.239184], off: [2, 0],     a: 0 },
    { model: 'abai',        at: [76.94577, 43.248771],  off: [0, 0],     a: 0.1 },
    { model: 'almaty2',     at: [76.939183, 43.27373],  off: [-11, 0],   a: 0.07 },
    { model: 'almaty1',     at: [76.94888, 43.341036],  off: [2, 17],    a: -0.384 },
    { model: 'airport',     at: [77.00885, 43.3512],    off: [15, -14],  a: -1.152 },
    { model: 'medeu',       at: [77.058873, 43.157911], off: [8, -18],   a: 2.164 },
    { model: 'shymbulak',   at: [77.051534, 43.162795], off: [0, 0],     a: -1.018 },
    { model: 'bazaar',      at: [76.954989, 43.263542], off: [0, 0],     a: 0.08 },
    { model: 'mega',        at: [76.89192, 43.202114],  off: [0, 0],     a: 0 },
    { model: 'dostykplaza', at: [76.956769, 43.233677], off: [-7, -5],   a: 0.244 },
    // дома на Аль-Фараби у Сейфуллина: контуры уже повёрнуты как надо
    { model: 'farabiS',     at: [76.943133, 43.226497], off: [0, 0],     a: 0 },
    { model: 'farabiN',     at: [76.941599, 43.22797],  off: [0, 0],     a: 0 }
];

function bbox(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return [x0, y0, x1, y1];
}

function inside(p, ring) {
    let yes = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) yes = !yes;
    }
    return yes;
}

const centroid = ring => ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length], [0, 0]);

// Контур модели в метрах → кольцо [lon, lat] на карте (как place в builds.js)
function onMap(c, a, ring) {
    const cs = Math.cos(a), sn = Math.sin(a);
    const out = ring.map(([x, y]) => move(c, x * cs - y * sn, x * sn + y * cs));
    out.push(out[0]);
    return out;
}

export function setupLandmarks(map) {
    // rings — контуры на земле: у одиночной модели один, у квартала (fps) — по контуру на каждый дом
    const items = SPOTS.map(s => {
        const c = move(s.at, s.off[0], s.off[1]), m = MODELS[s.model];
        const info = modelInfo({ model: s.model, c, a: s.a });
        const rings = m.fps ? m.fps.map(r => onMap(c, s.a, r)) : [info.footprint];
        return { model: s.model, info, rings: rings.map(r => ({ r, box: bbox(r) })), box: bbox(info.footprint) };
    });

    const symbol = map.getStyle().layers.find(l => l.type === 'symbol')?.id;
    // На рельефе каждый кусок здания поднимается на высоту земли под своим центром. Поэтому тайлы крупные
    // (maxzoom 14 — модель почти никогда не режется краем тайла), без запаса у краёв (buffer 0 — не двоится)
    // и без упрощения формы (tolerance 0 — тонкие рёбра и колонны не пропадают)
    map.addSource('lm', { type: 'geojson', buffer: 0, maxzoom: 14, tolerance: 0, data:{ type: 'FeatureCollection', features: items.flatMap(it => partFeatures(it.info.parts, null, it.model)) } });
    map.addLayer({
        id: 'lm-solid', type: 'fill-extrusion', source: 'lm', minzoom: 11,
        paint: {
            'fill-extrusion-color': ['get', 'color'],
            'fill-extrusion-base': ['get', 'base'],
            'fill-extrusion-height': ['get', 'top'],
            'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, 12, 1],
            'fill-extrusion-vertical-gradient': true
        }
    }, symbol);

    // Дом карты прячем, если все его куски стоят внутри контура достопримечательности.
    // Номера домов накапливаем: фильтр меняем, только когда нашлись новые
    const hidden = new Set();
    function scan() {
        if (map.getZoom() < 12.5 || !map.getLayer('buildings-3d')) return;
        const b = map.getBounds();
        const near = items.filter(it => it.box[0] < b.getEast() && it.box[2] > b.getWest() && it.box[1] < b.getNorth() && it.box[3] > b.getSouth());
        if (!near.length) return;
        const at = p => near.some(it => it.rings.some(({ r, box }) => p[0] > box[0] && p[0] < box[2] && p[1] > box[1] && p[1] < box[3] && inside(p, r)));
        let added = false;
        for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' })) {
            if (f.id == null || hidden.has(f.id)) continue;
            const g = f.geometry;
            const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map(p => p[0]) : [];
            if (rings.length && rings.every(r => at(centroid(r)))) {
                hidden.add(f.id);
                added = true;
            }
        }
        if (added) map.setFilter('buildings-3d', ['!', ['match', ['id'], [...hidden], true, false]]);
    }
    // Проверяем, когда догрузились тайлы карты (не на «idle»: во время игры его почти не бывает)
    let timer = 0;
    map.on('sourcedata', e => {
        if (e.sourceId !== 'openmaptiles' || !e.isSourceLoaded) return;
        clearTimeout(timer);
        timer = setTimeout(scan, 300);
    });
    scan();

    return {
        // контуры на земле: здесь не строят и не растут деревья
        footprints: () => items.flatMap(it => it.rings.map(x => x.r))
    };
}
