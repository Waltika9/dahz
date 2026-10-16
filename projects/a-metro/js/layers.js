// ===== Слои карты: загруженность, местность, метро =====
import { cellCenter, cellPolygon } from './city.js?v=1';
import { METRO, LRT, SKY } from './model.js?v=4';

// Цвета загрузки: зелёный → жёлтый → красный → бордовый
export const JAM_COLORS = ['#3fbf6f', '#f5c542', '#e5484d', '#8b1a2b'];

// Цвета местности по сочетанию видов (биты: 1 метро, 2 ЛРТ, 4 SkyTrain)
export const TERRAIN_COLORS = {
    [METRO]: '#e5484d',
    [LRT]: '#2fb67c',
    [SKY]: '#8b5cf6',
    [METRO | SKY]: '#d14c9a',
    [METRO | LRT]: '#f2994a',
    [LRT | SKY]: '#2aa7b0',
    [METRO | LRT | SKY]: '#4f8cff'
};

const NONE_COLOR = '#9aa5b8';

export function addDataLayers(map, { city, roads, metro }, terrain, traffic) {
    const before = map.getLayer('buildings-3d') ? 'buildings-3d' : undefined;

    // ----- Загруженность: мягкое «облако» по клеткам + раскрашенные дороги -----
    map.addSource('jam-cells', { type: 'geojson', data: jamCells(city, traffic.jam) });
    map.addLayer({
        id: 'jam-heat',
        type: 'heatmap',
        source: 'jam-cells',
        layout: { visibility: 'none' },
        paint: {
            'heatmap-weight': ['/', ['get', 'j'], 1.6],
            'heatmap-intensity': 0.9,
            'heatmap-radius': ['interpolate', ['exponential', 2], ['zoom'], 10, 9, 12, 32, 14, 120, 16, 480],
            'heatmap-opacity': 0.55,
            'heatmap-color': [
                'interpolate', ['linear'], ['heatmap-density'],
                0, 'rgba(63,191,111,0)',
                0.12, 'rgba(63,191,111,0.55)',
                0.4, JAM_COLORS[1],
                0.7, JAM_COLORS[2],
                1, JAM_COLORS[3]
            ]
        }
    }, before);

    map.addSource('jam-roads', { type: 'geojson', data: jamRoads(city, roads, traffic.jam) });
    map.addLayer({
        id: 'jam-roads',
        type: 'line',
        source: 'jam-roads',
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
            'line-color': ['step', ['get', 'j'], JAM_COLORS[0], 0.55, JAM_COLORS[1], 0.95, JAM_COLORS[2], 1.3, JAM_COLORS[3]],
            // k: 0 — магистраль, 1 — главная, 2 — второстепенная, 3 — третья, 4 — съезды
            'line-width': ['interpolate', ['linear'], ['zoom'],
                10, ['match', ['get', 'k'], 0, 2.5, 1, 2, 2, 1.2, 0.6],
                15, ['match', ['get', 'k'], 0, 9, 1, 7, 2, 5, 3, 3.5, 2.5]],
            'line-opacity': 0.9
        }
    }, before);

    // ----- Местность: квадраты клеток, цвет — какие виды можно -----
    map.addSource('terrain-cells', { type: 'geojson', data: terrainCells(city, terrain) });
    map.addLayer({
        id: 'terrain-fill',
        type: 'fill',
        source: 'terrain-cells',
        layout: { visibility: 'none' },
        paint: { 'fill-color': terrainColor('all'), 'fill-opacity': 0.42, 'fill-antialias': false }
    }, before);

    // ----- Метро: тайловые слои больше не нужны — линия 1 рисуется как линия игры (js/render3d.js).
    // Здесь остаются только строящиеся станции (например, «Калкаман»)
    for (const id of ['metro-existing', 'metro-stations', 'metro-labels']) {
        if (map.getLayer(id)) map.removeLayer(id);
    }
    const planned = metro.construction.map(s => ({ type: 'Feature', properties: { n: s.n }, geometry: { type: 'Point', coordinates: s.c } }));
    map.addSource('metro-planned', { type: 'geojson', data: { type: 'FeatureCollection', features: planned } });
    map.addLayer({
        id: 'metro-planned',
        type: 'circle',
        source: 'metro-planned',
        paint: {
            'circle-color': '#fbe3e4',
            'circle-stroke-color': '#e5484d',
            'circle-stroke-width': 2,
            'circle-stroke-opacity': 0.6,
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 7],
            'circle-pitch-alignment': 'map'
        }
    });
    map.addLayer({
        id: 'metro-planned-labels',
        type: 'symbol',
        source: 'metro-planned',
        minzoom: 11.5,
        layout: {
            'text-field': ['concat', ['get', 'n'], '\n(строится)'],
            'text-font': labelFont(map),
            'text-size': 12,
            'text-offset': [0, 1.2],
            'text-anchor': 'top'
        },
        paint: { 'text-color': '#b4232a', 'text-halo-color': '#ffffff', 'text-halo-width': 2 }
    });
}

function labelFont(map) {
    const l = map.getStyle().layers.find(x => x.type === 'symbol' && map.getLayoutProperty(x.id, 'text-font'));
    return (l && map.getLayoutProperty(l.id, 'text-font')) || ['Noto Sans Regular'];
}

// Цвет клетки местности: «all» — по сочетанию, иначе только выбранный вид
export function terrainColor(kind) {
    if (kind === 'all') {
        const m = ['match', ['get', 'a']];
        for (const [bits, color] of Object.entries(TERRAIN_COLORS)) m.push(Number(bits), color);
        m.push(NONE_COLOR);
        return m;
    }
    const bit = { metro: METRO, lrt: LRT, sky: SKY }[kind];
    const color = TERRAIN_COLORS[bit];
    return ['case', ['>', ['%', ['floor', ['/', ['get', 'a'], bit]], 2], 0], color, NONE_COLOR];
}

// Какой слой показан: map | traffic | terrain
export function showLayer(map, name) {
    const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    vis('jam-heat', name === 'traffic');
    vis('jam-roads', name === 'traffic');
    vis('terrain-fill', name === 'terrain');
}

export function setTerrainKind(map, kind) {
    if (map.getLayer('terrain-fill')) map.setPaintProperty('terrain-fill', 'fill-color', terrainColor(kind));
}

// Точки клеток для «облака» загруженности
function jamCells(city, jam) {
    const features = [];
    for (let i = 0; i < city.size; i++) {
        if (jam[i] > 0.02) {
            features.push({ type: 'Feature', properties: { j: Math.min(jam[i], 1.6) },
                            geometry: { type: 'Point', coordinates: cellCenter(city, i) } });
        }
    }
    return { type: 'FeatureCollection', features };
}

// Дорога окрашивается по загрузке клетки в её середине
function jamRoads(city, roads, jam) {
    return {
        type: 'FeatureCollection',
        features: roads.features.map(f => {
            const pts = f.geometry.coordinates;
            const mid = pts[Math.floor(pts.length / 2)];
            const c = Math.floor((mid[0] - city.lon0) / city.dLon), r = Math.floor((mid[1] - city.lat0) / city.dLat);
            const j = c >= 0 && c < city.cols && r >= 0 && r < city.rows ? jam[r * city.cols + c] : 0;
            return { ...f, properties: { ...f.properties, j: Math.round(j * 100) / 100 } };
        })
    };
}

// Новые пробки после пересчёта (открылась линия, люди пересели)
export function updateTraffic(map, { city, roads }, jam) {
    map.getSource('jam-cells')?.setData(jamCells(city, jam));
    map.getSource('jam-roads')?.setData(jamRoads(city, roads, jam));
}

// Квадраты клеток местности
function terrainCells(city, terrain) {
    const features = [];
    for (let i = 0; i < city.size; i++) {
        features.push({ type: 'Feature', id: i, properties: { a: terrain.allow[i] },
                        geometry: { type: 'Polygon', coordinates: cellPolygon(city, i) } });
    }
    return { type: 'FeatureCollection', features };
}

// Местность после стройки: плотная застройка мешает ЛРТ и SkyTrain
export function updateTerrain(map, city, terrain) {
    map.getSource('terrain-cells')?.setData(terrainCells(city, terrain));
}