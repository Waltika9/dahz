// ===== 3D-карта Алматы =====
// MapLibre GL + бесплатные данные без ключей:
// - улицы, дома и подписи — OpenStreetMap через OpenFreeMap (стиль Positron);
// - рельеф гор — открытые тайлы высот Terrain Tiles (AWS).
// Дома «выдавливаются» в 3D по высоте из OSM.

const STYLE = 'https://tiles.openfreemap.org/styles/positron';
const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

// Стартовый вид: с севера города на юг — линия метро, центр и горы на горизонте
export const HOME = { center: [76.935, 43.262], zoom: 14.3, pitch: 72, bearing: 168 };
// Алматы и пригороды: Каскелен, Талгар, Отеген-Батыр, Медеу
const BOUNDS = [[76.45, 42.95], [77.45, 43.55]];

// Цвета — как в 2ГИС: светлая земля, сочная трава, серый асфальт с белой разметкой
const COLORS = {
    background: '#f3f2ec',
    water: '#a8d6f3',
    park: '#dcefcf',
    grass: '#cbe8ad',
    garden: '#c2e4a1',
    wood: '#b3db95',
    pitch: '#b5df9a',
    pale: '#f1ede2',          // дворы школ, больниц, университетов
    asphalt: '#c9cbd0',
    asphaltMinor: '#d7d8dc',
    sidewalk: '#e6e5df',
    path: '#fbfaf5',
    rail: '#b9bdc4',
    building: ['#f2f0eb', '#e9e9ea', '#d8dfe8'],
    metro: '#e5484d'
};

// Ширина в метрах → пиксели (широта Алматы). Близко — точно в метрах, издалека — не тоньше minPx.
// m — число или выражение (например, ширина из свойств объекта)
const PX_M = 2 ** 22 / 57000;    // пикселей в метре на масштабе 22 (тайлы MapLibre — 512 px)
export const meters = (m, minPx = 0.5) => ['interpolate', ['exponential', 2], ['zoom'],
    10, minPx * 0.6,
    14, ['max', minPx, ['*', m, PX_M / 256]],
    22, ['*', m, PX_M]];

// Ширина улиц в метрах по классу; у односторонних (половина проспекта) — чуть больше половины
const ROAD_M = ['match', ['get', 'class'], ['motorway', 'trunk'], 30, 'primary', 26, 'secondary', 20, 'tertiary', 15,
    'minor', 9, 'service', 5.5, 'track', 4, 4];
const ONEWAY = ['==', ['coalesce', ['get', 'oneway'], 0], 1];
const roadM = (extra = 0) => ['+', ['*', ROAD_M, ['case', ONEWAY, 0.55, 1]], extra];

// Разметка: картинка «поперёк дороги» — MapLibre растягивает её на всю ширину полосы,
// поэтому линии всегда ложатся между рядами. lanes — рядов, two — встречное движение
function laneImage(lanes, two, W) {
    const H = 128, c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d'), line = 2.4;
    g.fillStyle = 'rgba(255,255,255,0.92)';
    for (let k = 1; k < lanes; k++) {
        const y = H * k / lanes;
        if (two && k === lanes / 2) {          // двойная сплошная
            g.fillRect(0, y - line * 1.6, W, line);
            g.fillRect(0, y + line * 0.6, W, line);
        } else g.fillRect(0, y - line / 2, W * 0.32, line);   // прерывистая
    }
    g.fillRect(0, H * 0.035, W, line);          // края проезжей части
    g.fillRect(0, H * 0.965 - line, W, line);
    return g.getImageData(0, 0, W, H);
}

// «Зебра»: белые полосы вдоль улицы, через всю ширину
function zebraImage() {
    const W = 8, H = 96, c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,0.95)';
    for (let y = 2; y < H - 2; y += 8) g.fillRect(0, y, W, 4.5);
    return g.getImageData(0, 0, W, H);
}

export function addMarkImages(map) {
    const add = (id, img) => { if (!map.hasImage(id)) map.addImage(id, img); };
    add('mk-2w6', laneImage(6, true, 64));
    add('mk-2w4', laneImage(4, true, 64));
    add('mk-2w2', laneImage(2, true, 128));
    add('mk-1w3', laneImage(3, false, 128));
    add('mk-1w2', laneImage(2, false, 128));
    add('mk-zebra', zebraImage());
}

export function createMap(container, onProgress = () => {}) {
    const map = new maplibregl.Map({
        container,
        style: STYLE,
        ...HOME,
        minZoom: 9.5,
        maxZoom: 18,
        maxPitch: 75,
        maxBounds: BOUNDS,
        attributionControl: { compact: true },
        fadeDuration: 150,
        // На телефонах экран бывает «×3»: рисуем не больше чем «×2» — глазом не видно, а работает быстрее и меньше греется
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2)
    });

    map.on('style.load', () => {
        onProgress(0.45);
        decorate(map);
    });

    // Пока грузятся тайлы — потихоньку двигаем полоску
    let p = 0.45;
    map.on('data', () => {
        p += (0.92 - p) * 0.04;
        onProgress(p);
    });

    return map;
}

// Перекраска стиля в светлые тона, 3D-дома, рельеф, метро
function decorate(map) {
    const has = id => !!map.getLayer(id);
    const firstSymbol = map.getStyle().layers.find(l => l.type === 'symbol')?.id;

    const paint = (id, prop, value) => { if (has(id)) map.setPaintProperty(id, prop, value); };
    paint('background', 'background-color', COLORS.background);
    paint('water', 'fill-color', COLORS.water);
    paint('waterway', 'line-color', COLORS.water);
    paint('waterway', 'line-width', meters(['match', ['get', 'class'], 'river', 18, 'canal', 8, 'stream', 4, 1.5], 0.6));
    paint('park', 'fill-color', COLORS.park);
    paint('landuse_residential', 'fill-color', '#efede6');
    paint('landcover_wood', 'fill-color', COLORS.wood);
    paint('landcover_wood', 'fill-opacity', ['interpolate', ['linear'], ['zoom'], 8, 0.4, 12, 1]);

    // Трава, газоны, скверы и дворы (в стиле карты их не было)
    const greenBefore = has('landcover_wood') ? 'landcover_wood' : 'waterway';
    map.addLayer({
        id: 'landcover-grass', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
        filter: ['==', ['get', 'class'], 'grass'],
        paint: {
            'fill-color': ['match', ['get', 'subclass'], ['park', 'garden', 'recreation_ground', 'village_green'], COLORS.garden, COLORS.grass],
            'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 13, 1]
        }
    }, greenBefore);
    map.addLayer({
        id: 'landuse-extra', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse',
        filter: ['match', ['get', 'class'], ['pitch', 'cemetery', 'playground', 'school', 'kindergarten', 'university', 'college', 'hospital', 'stadium'], true, false],
        paint: {
            'fill-color': ['match', ['get', 'class'], 'pitch', COLORS.pitch, 'cemetery', '#cfe6c0', 'playground', '#e3f1cf', 'stadium', '#e8ebe3', COLORS.pale],
            'fill-outline-color': ['match', ['get', 'class'], 'pitch', '#ffffff', 'rgba(0,0,0,0)']
        }
    }, greenBefore);

    // Улицы: серый асфальт настоящей ширины, светлые тротуары, белые дорожки в парках
    paint('highway_major_inner', 'line-color', COLORS.asphalt);
    paint('highway_major_inner', 'line-width', meters(roadM(), 1));
    paint('highway_major_casing', 'line-color', COLORS.sidewalk);
    paint('highway_major_casing', 'line-width', meters(roadM(7), 1.6));
    paint('highway_motorway_inner', 'line-color', COLORS.asphalt);
    paint('highway_motorway_inner', 'line-width', meters(roadM(), 1.2));
    paint('highway_motorway_casing', 'line-color', COLORS.sidewalk);
    paint('highway_motorway_casing', 'line-width', meters(roadM(6), 1.8));
    paint('highway_minor', 'line-color', ['match', ['get', 'class'], 'minor', COLORS.asphaltMinor, '#dfe0e3']);
    paint('highway_minor', 'line-width', meters(roadM(), 0.6));
    paint('highway_path', 'line-color', COLORS.path);
    paint('highway_path', 'line-width', meters(['match', ['get', 'subclass'], 'pedestrian', 6, 2.5], 0.5));
    paint('railway', 'line-color', COLORS.rail);
    paint('railway_transit', 'line-color', COLORS.rail);
    paint('railway_service', 'line-color', COLORS.rail);

    // Разметка полос на больших улицах — картинкой поперёк дороги (на одностороннюю половину проспекта — без двойной сплошной)
    addMarkImages(map);
    const one = (a, b) => ['case', ONEWAY, a, b];
    map.addLayer({
        id: 'road-marks', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 14,
        filter: ['all', ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false],
                 ['!=', ['get', 'brunnel'], 'tunnel'], ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false]],
        layout: { 'line-join': 'round' },
        paint: {
            'line-pattern': ['match', ['get', 'class'],
                ['motorway', 'trunk', 'primary'], one('mk-1w3', 'mk-2w6'),
                'secondary', one('mk-1w3', 'mk-2w4'),
                one('mk-1w2', 'mk-2w4')],
            'line-width': meters(roadM(), 1),
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 1]
        }
    }, has('railway_transit') ? 'railway_transit' : firstSymbol);

    // Подписи по-русски (если в OSM есть русское название)
    for (const layer of map.getStyle().layers) {
        if (layer.type !== 'symbol' || layer.id.includes('shield')) continue;
        if (!map.getLayoutProperty(layer.id, 'text-field')) continue;
        map.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name:ru'], ['get', 'name']]);
    }

    // Рельеф: один источник для 3D-гор, второй для мягких теней на склонах
    // Для 3D-рельефа — помельче (maxzoom 12): в точных данных высот большие дома видны как «бугры»,
    // и модели на них приподнимались над землёй. Горы при этом выглядят так же
    map.addSource('dem', { type: 'raster-dem', tiles: [DEM], encoding: 'terrarium', tileSize: 256, maxzoom: 12 });
    map.addSource('dem-shade', { type: 'raster-dem', tiles: [DEM], encoding: 'terrarium', tileSize: 256, maxzoom: 14 });
    map.addLayer({
        id: 'hillshade',
        type: 'hillshade',
        source: 'dem-shade',
        paint: {
            'hillshade-exaggeration': 0.35,
            'hillshade-shadow-color': '#8a99b3',
            'hillshade-highlight-color': '#ffffff',
            'hillshade-accent-color': '#a7b5cc'
        }
    }, has('waterway') ? 'waterway' : firstSymbol);   // поверх травы и леса — иначе зелёные горы стали бы плоскими
    map.setTerrain({ source: 'dem', exaggeration: 1.15 });

    // Небо и дымка у горизонта
    if (typeof map.setSky === 'function') {
        map.setSky({
            'sky-color': '#d6e6fb',
            'horizon-color': '#f3f7fd',
            'fog-color': '#f3f7fd',
            'sky-horizon-blend': 0.7,
            'horizon-fog-blend': 0.6,
            'fog-ground-blend': 0.35
        });
    }

    // Мягкий свет сбоку: стены домов чуть темнее крыш, дома не сливаются с фоном
    map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: 0.4, position: [1.4, 210, 35] });

    // Плоские дома заменяем объёмными. У многих домов Алматы в OpenStreetMap записан цвет фасада —
    // берём его, но чуть осветляем (смешиваем с белым), чтобы город остался светлым.
    // У остальных цвет зависит от высоты: низкие — тёплые, высотки — голубоватые
    if (has('building')) map.setLayoutProperty('building', 'visibility', 'none');
    const byHeight = ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6],
        0, COLORS.building[0], 30, COLORS.building[1], 120, COLORS.building[2]];
    map.addLayer({
        id: 'buildings-3d',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 12.5,
        paint: {
            'fill-extrusion-color': ['case', ['has', 'colour'],
                ['interpolate', ['linear'], 0.45, 0, ['to-color', ['get', 'colour'], COLORS.building[1]], 1, '#ffffff'],
                byHeight],
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 13.5, 0.92],
            'fill-extrusion-vertical-gradient': true
        }
    }, firstSymbol);

    // Существующее метро (линия 1) — красным поверх улиц.
    // В тайлах линия есть только при близком приближении; на всех масштабах — с этапа 2 (свои данные)
    map.addLayer({
        id: 'metro-existing',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['all', ['==', ['get', 'class'], 'transit'], ['==', ['get', 'subclass'], 'subway']],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
            'line-color': COLORS.metro,
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 4, 17, 8],
            'line-opacity': 0.85
        }
    }, 'buildings-3d');

    // Станции метро: белые кружки с красной обводкой и подписью
    const stationFilter = ['all', ['==', ['get', 'class'], 'railway'], ['==', ['get', 'subclass'], 'subway']];
    const font = map.getLayoutProperty(map.getStyle().layers.find(l => l.type === 'symbol' && map.getLayoutProperty(l.id, 'text-font'))?.id, 'text-font') || ['Noto Sans Regular'];
    map.addLayer({
        id: 'metro-stations',
        type: 'circle',
        source: 'openmaptiles',
        'source-layer': 'poi',
        filter: stationFilter,
        paint: {
            'circle-color': '#ffffff',
            'circle-stroke-color': COLORS.metro,
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 16, 4],
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4, 16, 8],
            'circle-pitch-alignment': 'map'
        }
    });
    map.addLayer({
        id: 'metro-labels',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'poi',
        filter: stationFilter,
        layout: {
            'text-field': ['coalesce', ['get', 'name:ru'], ['get', 'name']],
            'text-font': font,
            'text-size': 13,
            'text-offset': [0, 1.3],
            'text-anchor': 'top',
            'text-max-width': 9
        },
        paint: {
            'text-color': '#b4232a',
            'text-halo-color': '#ffffff',
            'text-halo-width': 2
        }
    });
}

// ===== Камера =====

export function toggleTilt(map) {
    const flat = map.getPitch() < 10;
    map.easeTo({ pitch: flat ? HOME.pitch : 0, duration: 700 });
    return flat; // true — включили 3D
}

export function goHome(map) {
    map.flyTo({ ...HOME, duration: 1800, essential: true });
}

// Облёт города: камера медленно поворачивается, пока пользователь не тронет карту
export function createOrbit(map) {
    let raf = 0, last = 0, on = false;
    const step = t => {
        if (!on) return;
        const dt = last ? Math.min(t - last, 50) : 16;
        last = t;
        map.setBearing(map.getBearing() + dt * 0.004);
        raf = requestAnimationFrame(step);
    };
    const stop = () => {
        on = false;
        cancelAnimationFrame(raf);
    };
    // Любое касание карты пользователем останавливает облёт
    for (const ev of ['mousedown', 'touchstart', 'wheel']) map.on(ev, () => { if (on) stop(); });

    return {
        start() {
            if (on) return;
            on = true;
            last = 0;
            // Поворот каждый кадр прервал бы плавный наклон, поэтому сначала наклоняем, потом крутим
            const go = () => { if (on) raf = requestAnimationFrame(step); };
            if (map.getPitch() < 40) {
                map.easeTo({ pitch: 65, duration: 900 });
                map.once('moveend', go);
            } else go();
        },
        stop,
        get running() { return on; }
    };
}
