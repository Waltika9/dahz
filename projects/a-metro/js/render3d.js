// ===== 3D-линии на карте =====
// Всё строится объёмными «выдавленными» фигурами MapLibre (fill-extrusion):
// - SkyTrain — как LRT в Астане: белая бетонная эстакада с двумя путями, белые перила
//   с жёлтой полосой, расширяющиеся кверху опоры, станции из зелёного стекла под белой аркой;
// - ЛРТ — трамвай по улице: два пути, столбы с контактной сетью, платформы с навесами;
// - метро: линия под землёй (пунктир), над станциями — павильоны входа.
// Поезда рисует отдельный слой (trainlayer.js). Фигуры сами стоят на рельефе гор.
import { band, square, pointAt, angleAt, slice, move } from './geo.js?v=1';
import { describe } from './lines.js?v=6';

const EMPTY = { type: 'FeatureCollection', features: [] };
export const DECK = { base: 8.6, top: 10.4, rail: 10.75 };   // эстакада SkyTrain, метры: низ, полотно, головка рельса
export const TRACK = 2.1;                                      // пути — на 2,1 м влево и вправо от оси

export function setupLineLayers(map) {
    const before = map.getLayer('buildings-3d') ? 'buildings-3d' : undefined;
    for (const id of ['tr-path', 'tr-solid', 'tr-stations', 'tr-preview']) {
        // объёмное — крупными тайлами без запаса у краёв: на рельефе не двоится (как в landmarks.js)
        map.addSource(id, id === 'tr-solid' ? { type: 'geojson', data: EMPTY, buffer: 0, maxzoom: 14, tolerance: 0 } : { type: 'geojson', data: EMPTY });
    }

    // Пути: метро — пунктир (под землёй), ЛРТ — сплошной с белыми «шпалами», SkyTrain — с белой каймой
    map.addLayer({
        id: 'tr-path-casing', type: 'line', source: 'tr-path',
        filter: ['!=', ['get', 'type'], 'metro'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 15, 10], 'line-opacity': 0.9 }
    }, before);
    map.addLayer({
        id: 'tr-path-line', type: 'line', source: 'tr-path',
        filter: ['!', ['get', 'building']],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
            'line-color': ['get', 'color'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.6, 15, 6],
            'line-opacity': ['case', ['get', 'selected'], 1, 0.9]
        }
    }, before);
    // Линия на стройке — бледный пунктир своим цветом
    map.addLayer({
        id: 'tr-path-building', type: 'line', source: 'tr-path',
        filter: ['get', 'building'],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
            'line-color': ['get', 'color'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.6, 15, 6],
            'line-opacity': 0.55,
            'line-dasharray': ['literal', [1.2, 1]]
        }
    }, before);
    // Метро под землёй — поверх рисуем пунктир цветом фона
    map.addLayer({
        id: 'tr-path-tunnel', type: 'line', source: 'tr-path',
        filter: ['all', ['==', ['get', 'type'], 'metro'], ['!', ['get', 'building']]],
        layout: { 'line-cap': 'butt' },
        paint: {
            'line-color': '#ffffff',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 2],
            'line-opacity': 0.75,
            'line-dasharray': ['literal', [2, 3]]
        }
    }, before);

    // Объёмные части: эстакады, опоры, платформы, павильоны, столбы контактной сети
    map.addLayer({
        id: 'tr-solid', type: 'fill-extrusion', source: 'tr-solid',
        paint: {
            'fill-extrusion-color': ['get', 'color'],
            'fill-extrusion-base': ['get', 'base'],
            'fill-extrusion-height': ['get', 'top'],
            'fill-extrusion-opacity': 1,
            'fill-extrusion-vertical-gradient': true
        }
    });

    // Станции: кружки и подписи
    map.addLayer({
        id: 'tr-stations', type: 'circle', source: 'tr-stations',
        paint: {
            'circle-color': '#ffffff',
            'circle-stroke-color': ['get', 'color'],
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 4],
            // Чем больше пассажиров, тем крупнее кружок (как в Mini Metro)
            'circle-radius': ['interpolate', ['linear'], ['zoom'],
                10, ['+', ['case', ['get', 'transfer'], 5, 3.5], ['*', ['get', 'load'], 4]],
                16, ['+', ['case', ['get', 'transfer'], 11, 8], ['*', ['get', 'load'], 8]]],
            'circle-opacity': ['case', ['get', 'building'], 0.6, 1],
            'circle-stroke-opacity': ['case', ['get', 'building'], 0.6, 1],
            'circle-pitch-alignment': 'map'
        }
    });
    map.addLayer({
        id: 'tr-labels', type: 'symbol', source: 'tr-stations',
        minzoom: 11.5,
        layout: {
            'text-field': ['get', 'name'],
            'text-font': labelFont(map),
            'text-size': 13,
            'text-offset': [0, 1.25],
            'text-anchor': 'top',
            'text-max-width': 9
        },
        paint: { 'text-color': ['get', 'dark'], 'text-halo-color': '#ffffff', 'text-halo-width': 2 }
    });

    // Черновик новой линии: уже поставленные участки, «резинка» к курсору, точка под курсором
    map.addLayer({
        id: 'tr-preview-line', type: 'line', source: 'tr-preview',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
            'line-color': ['case', ['get', 'ok'], ['get', 'color'], '#e5484d'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 7],
            'line-opacity': ['case', ['get', 'ghost'], 0.55, 0.95],
            'line-dasharray': ['literal', [1.5, 1]]
        }
    });
    map.addLayer({
        id: 'tr-preview-points', type: 'circle', source: 'tr-preview',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
            'circle-color': ['case', ['get', 'bend'], ['get', 'color'], '#ffffff'],
            'circle-stroke-color': ['case', ['get', 'ok'], ['get', 'color'], '#e5484d'],
            'circle-stroke-width': 3,
            'circle-radius': ['case', ['get', 'bend'], 4, 7],
            'circle-opacity': ['case', ['get', 'ghost'], 0.7, 1],
            'circle-pitch-alignment': 'map'
        }
    });
}

function labelFont(map) {
    const l = map.getStyle().layers.find(x => x.type === 'symbol' && map.getLayoutProperty(x.id, 'text-font'));
    return (l && map.getLayoutProperty(l.id, 'text-font')) || ['Noto Sans Regular'];
}

// Темнее цвет — для подписи станции
function darker(hex) {
    const n = parseInt(hex.slice(1), 16);
    const f = v => Math.round(v * 0.72).toString(16).padStart(2, '0');
    return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

const feat = (geometry, properties) => ({ type: 'Feature', properties, geometry });

// Линия, сдвинутая вбок на d метров (влево по ходу, вправо — при d < 0)
export function offset(pts, d) {
    return pts.map((p, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const kx = 111320 * Math.cos(p[1] * Math.PI / 180);
        const vx = (b[0] - a[0]) * kx, vy = (b[1] - a[1]) * 110540, L = Math.hypot(vx, vy) || 1;
        return move(p, -vy / L * d, vx / L * d);
    });
}

// Эстакада SkyTrain: коробчатая балка, плита, два пути, белые перила с жёлтой полосой
// и полоской цвета линии на торце; опоры каждые 32 м — белый столб, кверху шире
function skyDeck(add, d, color, building) {
    const P = d.path.pts;
    const concrete = building ? '#cfd5dd' : '#eef1f4', under = building ? '#c3cad3' : '#dfe4ea';
    add(band(P, 5.2), under, DECK.base, DECK.base + 0.9);
    add(band(P, 9.4), concrete, DECK.base + 0.9, DECK.top);
    if (!building) {
        add(band(P, 8.2), '#a3abb5', DECK.top, DECK.top + 0.15);
        for (const t of [-TRACK, TRACK]) for (const r of [-0.72, 0.72]) add(band(offset(P, t + r), 0.16), '#59616b', DECK.top + 0.15, DECK.rail);
        for (const s of [-1, 1]) {
            add(band(offset(P, s * 4.55), 0.3), '#fbfcfd', DECK.top, DECK.top + 1.2);
            add(band(offset(P, s * 4.72), 0.08), '#f2c230', DECK.top + 0.25, DECK.top + 0.45);
            add(band(offset(P, s * 4.72), 0.08), color, DECK.base + 1.1, DECK.base + 1.5);
        }
    }
    for (let s = 15; s < d.path.length; s += 32) {
        const p = pointAt(d.path, s), a = angleAt(d.path, s) + Math.PI / 2;   // поперёк пути
        add(square(p, 2, 2, a), concrete, 0, 6.4);
        add(square(p, 3.6, 2.2, a), concrete, 6.4, 7.4);
        add(square(p, 6.2, 2.4, a), concrete, 7.4, DECK.base);
    }
}

// Станция SkyTrain как в Астане: коробка из зелёного стекла над улицей,
// белая скруглённая крыша-«арка», белые торцы и опоры, полоса цвета линии под крышей
function skyStation(add, d, st, color, building) {
    const seg = slice(d.path, st.at - 42, st.at + 42);
    const glass = building ? '#d5dbe2' : '#8fcfc0', white = building ? '#dde2e8' : '#f7f8fa', top = DECK.top + 7;
    add(band(seg, 22), glass, DECK.base - 1.5, top);
    for (let z = DECK.base + 0.6; z < top - 0.8; z += 3) add(band(seg, 22.3), white, z, z + 0.3);
    add(band(seg, 22.4), building ? white : color, top - 0.8, top);
    [[24.5, 0, 1.2], [23, 1.2, 2.1], [20, 2.1, 2.8], [15, 2.8, 3.3]].forEach(([w, a, b]) => add(band(seg, w), white, top + a, top + b));
    for (const at of [st.at - 43, st.at + 43]) add(square(pointAt(d.path, at), 2.4, 24.5, angleAt(d.path, at)), white, DECK.base - 1.5, top + 2.1);
    for (const at of [st.at - 22, st.at + 22]) add(square(pointAt(d.path, at), 3.4, 3.4), white, 0, DECK.base - 1.5);
}

// ЛРТ по улице: путь, два пути рельсов, полоса цвета линии; центральные столбы
// с консолями и провода контактной сети
function lrtTrack(add, d, color, building) {
    const P = d.path.pts;
    add(band(P, 8), building ? '#cfd5dd' : '#bfc4ca', 0, 0.22);
    if (!building) {
        for (const t of [-1.9, 1.9]) for (const r of [-0.72, 0.72]) add(band(offset(P, t + r), 0.14), '#646b73', 0.22, 0.32);
        add(band(P, 0.5), color, 0.22, 0.27);
        for (const t of [-1.9, 1.9]) add(band(offset(P, t), 0.06), '#3d434a', 6.1, 6.2);
    }
    for (let s = 12; s < d.path.length; s += 34) {
        const p = pointAt(d.path, s), a = angleAt(d.path, s) + Math.PI / 2;
        add(square(p, 0.35, 0.35), '#9aa3ad', 0.22, 7.2);
        add(square(p, 5.2, 0.18, a), '#9aa3ad', 6.8, 7.0);
    }
}

// Остановка ЛРТ: две боковые платформы со стеклянной стенкой, навесом и краем цвета линии
function lrtStation(add, d, st, color, building) {
    const seg = slice(d.path, st.at - 22, st.at + 22);
    const roof = building ? '#c3cad3' : '#5d6a78';
    for (const sd of [-1, 1]) {
        add(band(offset(seg, sd * 5.5), 3), '#dfe3e8', 0, 0.38);
        add(band(offset(seg, sd * 6.75), 0.22), building ? '#d5dbe2' : '#a9c7e2', 0.38, 2.9);
        add(band(offset(seg, sd * 5.9), 2.6), roof, 2.9, 3.15);
        add(band(offset(seg, sd * 4.1), 0.18), building ? '#c3cad3' : color, 0.38, 0.46);
    }
}

// Перерисовать все линии (после постройки, сноса, открытия).
// isOpen(line) — линия уже возит людей; stationRiders — пассажиров в день по станциям.
// Участок продления (line.ext) рисуется как стройка и не делает конечную станцию пересадкой
export function renderLines(map, lines, selectedId = null, { isOpen = () => true, stationRiders = new Map() } = {}) {
    const paths = [], solids = [], stations = [];
    const seen = new Map(); // одна точка — несколько линий = пересадка
    const maxRiders = Math.max(1, ...stationRiders.values());
    const add = (coordinates, color, base, top) => solids.push(feat({ type: 'Polygon', coordinates }, { color, base, top }));

    for (const line of lines) {
        const d = line._d || (line._d = describe(line));
        const building = !isOpen(line);
        // На стройке всё серое: видно, что идут работы
        const color = line.color;
        const solidColor = building ? '#b9c1cc' : color;
        const selected = line.id === selectedId || line.id === `${selectedId}:ext`;
        paths.push(feat({ type: 'LineString', coordinates: d.path.pts }, { id: line.id, type: line.type, color, selected, building }));

        if (line.type === 'sky') skyDeck(add, d, color, building);
        else if (line.type === 'lrt') lrtTrack(add, d, color, building);

        for (const st of d.stations) {
            const a = angleAt(d.path, st.at);
            const key = st.c[0].toFixed(5) + ',' + st.c[1].toFixed(5);
            const junction = line.ext === true && st === d.stations[0];   // конечная, от которой идёт продление (у «линии»-продления ext === true)
            if (junction) continue;
            if (line.type === 'sky') skyStation(add, d, st, color, building);
            else if (line.type === 'lrt') lrtStation(add, d, st, color, building);
            else {
                // Павильон входа в метро рядом с линией
                const side = [Math.cos(a + Math.PI / 2), Math.sin(a + Math.PI / 2)];
                const p = [st.c[0] + side[0] * 18 / (111320 * Math.cos(st.c[1] * Math.PI / 180)), st.c[1] + side[1] * 18 / 110540];
                add(square(p, 9, 5, a), '#f2f4f7', 0, 3.4);
                add(square(p, 10, 6, a), solidColor, 3.4, 4.1);
            }

            if (seen.has(key)) {
                const f = seen.get(key);
                f.properties.transfer = true;
                if (!building) f.properties.building = false;
                continue;
            }
            const riders = stationRiders.get(key) || 0;
            const f = feat({ type: 'Point', coordinates: st.c }, {
                name: riders > 500 ? `${st.name}\n${Math.round(riders / 1000)} тыс./день` : st.name,
                color, dark: darker(color), transfer: false, building, load: Math.sqrt(riders / maxRiders)
            });
            seen.set(key, f);
            stations.push(f);
        }
    }

    map.getSource('tr-path').setData({ type: 'FeatureCollection', features: paths });
    map.getSource('tr-stations').setData({ type: 'FeatureCollection', features: stations });
    map.getSource('tr-solid').setData({ type: 'FeatureCollection', features: solids });
}

export function renderPreview(map, features) {
    map.getSource('tr-preview').setData({ type: 'FeatureCollection', features });
}
