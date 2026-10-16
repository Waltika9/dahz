// ===== Поезда: ездят по линиям туда и обратно, стоят на станциях =====
// Время ускорено, чтобы движение было видно на карте. Поезд разгоняется от станции
// и тормозит перед следующей (скорость зависит от пути до станций), двигается каждый кадр.
// Рисует их свой слой на видеокарте (trainlayer.js) — так вагоны не дёргаются.
import { TYPES, describe } from './lines.js?v=6';
import { DECK, TRACK } from './render3d.js?v=7';
import { pointAt, angleAt } from './geo.js?v=1';
import { createTrainLayer } from './trainlayer.js?v=1';

const TIME_SCALE = 18;   // во сколько раз быстрее реального
const DWELL = 1.4;       // секунд стоянки на станции (уже ускоренных)
const ACCEL = 1.1;       // разгон и торможение, м/с² (как у настоящих поездов)

// Вагоны. Каждая деталь: [вдоль от центра вагона (+ — вперёд), длина, ширина, низ, верх, цвет];
// цвет 'line' — цвет линии. nose — детали «морды» на переднем конце головного вагона
const CARS = {
    // SkyTrain — как LRT в Астане: синий кузов с казахским орнаментом, тёмная полоса окон,
    // тёмные двери, обтекаемая чёрная «морда» с фарами
    sky: {
        n: 4, len: 11.6, gap: 0.4, z: DECK.rail, track: TRACK,
        parts: [
            [0, 10.6, 2.2, 0, 0.5, '#2a2f36'],
            [0, 11.6, 2.7, 0.5, 3.25, '#2b8fd0'],
            [0, 11.4, 2.72, 2.0, 2.95, '#1b2733'],
            [-2.7, 1.3, 2.74, 0.55, 2.9, '#24323f'], [2.7, 1.3, 2.74, 0.55, 2.9, '#24323f'],
            [-4.6, 0.8, 2.76, 0.95, 1.65, '#e8b84a'], [0, 0.8, 2.76, 0.95, 1.65, '#8fd6f5'], [4.6, 0.8, 2.76, 0.95, 1.65, '#e8b84a'],
            [-1.3, 0.5, 2.76, 0.6, 1.05, '#8fd6f5'], [1.3, 0.5, 2.76, 0.6, 1.05, '#e8b84a'],
            [0, 11, 2.3, 3.25, 3.55, '#4a5560'], [0, 9, 0.5, 3.55, 3.62, 'line']
        ],
        nose: [
            [6.6, 1.8, 2.55, 0.5, 2.9, '#2b8fd0'],
            [6.7, 1.7, 2.3, 1.55, 3.0, '#121a22'],
            [7.7, 0.8, 2.0, 0.6, 2.2, '#16202a'],
            [8.15, 0.25, 1.8, 0.9, 1.3, '#f4f8fb']
        ]
    },
    // ЛРТ — современный трамвай: белый кузов, синяя полоса под окнами, синий «нос»,
    // жёлтое табло, на крыше блоки оборудования и токоприёмник
    lrt: {
        n: 5, len: 6.4, gap: 0.25, z: 0.32, track: 1.9,
        parts: [
            [0, 6.0, 2.3, 0, 0.35, '#3a3f45'],
            [0, 6.4, 2.65, 0.35, 3.3, '#f4f6f8'],
            [0, 6.2, 2.68, 1.2, 2.6, '#22303d'],
            [0, 6.4, 2.7, 0.75, 1.05, '#2f6fd0'],
            [0, 3.0, 1.5, 3.3, 3.7, '#e3e7eb'], [0, 5.2, 0.5, 3.3, 3.36, 'line']
        ],
        nose: [
            [3.7, 1.0, 2.5, 0.35, 3.2, '#2f6fd0'],
            [3.75, 1.05, 2.3, 1.35, 3.0, '#1a2430'],
            [3.8, 1.0, 1.3, 3.0, 3.2, '#ffb020']
        ]
    },
    // Метро — под землёй: тёмная «капсула» на поверхности, по оси — цвет линии
    metro: {
        n: 1, len: 58, gap: 0, z: 0, track: 0,
        parts: [[0, 58, 3.0, 0.1, 0.45, '#2b3138'], [0, 56, 1.0, 0.45, 0.5, 'line']],
        nose: []
    }
};

const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

// getLines — только открытые линии; getPace — во сколько раз ускорить (0 — пауза)
export function createTrains(map, getLines, getPace = () => 1) {
    let trains = [], last = 0, raf = 0;

    // Поезда на линии: примерно один на 2,5 км, от 2 до 8; расставлены равномерно по кругу «туда-обратно»
    function rebuild() {
        trains = [];
        for (const line of getLines()) {
            const d = line._d || (line._d = describe(line));
            const L = d.path.length;
            if (L < 200) continue;
            const t = TYPES[line.type], car = CARS[line.type];
            const n = Math.max(2, Math.min(8, Math.round(L / 2500)));
            // Остановки на «круге» длиной 2L: туда — at, обратно — 2L − at
            const marks = [...new Set(d.stations.flatMap(s => [s.at, 2 * L - s.at]).map(m => Math.round(((m % (2 * L)) + 2 * L) % (2 * L))))]
                .sort((a, b) => a - b);
            const color = rgb(line.color);
            const parts = p => p.map(([x, l, w, z0, z1, c]) => ({ x, l, w, z0, z1, c: c === 'line' ? color : rgb(c) }));
            for (let k = 0; k < n; k++) {
                trains.push({
                    path: d.path, L, marks, car, parts: parts(car.parts), nose: parts(car.nose),
                    vmax: t.speed * 1.35 / 3.6 * TIME_SCALE,          // м/с (ускоренные)
                    acc: ACCEL * TIME_SCALE * TIME_SCALE,
                    crawl: t.speed * 0.06 / 3.6 * TIME_SCALE,          // минимальная скорость у самой станции
                    loop: (2 * L * k) / n, wait: 0
                });
            }
        }
        map.triggerRepaint();
    }

    // Ближайшие остановки впереди и позади на «круге»
    function around(tr) {
        const round = 2 * tr.L, m = tr.marks;
        let next = m.find(x => x > tr.loop + 0.01);
        if (next === undefined) next = m[0] + round;
        let prev = -Infinity;
        for (const x of m) if (x <= tr.loop + 0.01) prev = x;
        if (prev === -Infinity) prev = m[m.length - 1] - round;
        return [prev, next];
    }

    function step(dt) {
        for (const tr of trains) {
            if (tr.wait > 0) { tr.wait -= dt; continue; }
            let left = dt;
            while (left > 1e-4) {
                const h = Math.min(left, 0.04);
                const [prev, next] = around(tr);
                const toNext = Math.max(0, next - tr.loop), fromPrev = Math.max(0, tr.loop - prev);
                // разгон от прошлой станции, торможение к следующей, не быстрее максимума
                const v = Math.max(tr.crawl, Math.min(tr.vmax, Math.sqrt(2 * tr.acc * fromPrev) + tr.crawl, Math.sqrt(2 * tr.acc * toNext)));
                if (v * h >= toNext) {
                    tr.loop = next % (2 * tr.L);
                    tr.wait = DWELL;
                    break;
                }
                tr.loop += v * h;
                left -= h;
            }
            tr.loop %= 2 * tr.L;
        }
    }

    // Коробочки вагонов для слоя: только те, что рядом с экраном
    function boxes() {
        const out = [];
        const b = map.getBounds(), padX = (b.getEast() - b.getWest()) * 0.15, padY = (b.getNorth() - b.getSouth()) * 0.15;
        const W = b.getWest() - padX, E = b.getEast() + padX, S = b.getSouth() - padY, N = b.getNorth() + padY;
        const terrain = !!map.getTerrain();
        for (const tr of trains) {
            const { car, L } = tr;
            const forward = tr.loop <= L;
            const dir = forward ? 1 : -1;
            const pitch = car.len + car.gap, half = (car.n * pitch) / 2;
            // на конечной весь состав стоит у платформы, а не наполовину за краем
            const s = Math.max(Math.min(half, L / 2), Math.min(L - Math.min(half, L / 2), forward ? tr.loop : 2 * L - tr.loop));
            for (let i = 0; i < car.n; i++) {
                const si = s + dir * ((car.n - 1) / 2 - i) * pitch;
                const c = pointAt(tr.path, si);
                if (c[0] < W || c[0] > E || c[1] < S || c[1] > N) continue;
                // направление движения; на обратном пути — развернуть
                const h = angleAt(tr.path, si) + (forward ? 0 : Math.PI);
                const ux = Math.cos(h), uy = -Math.sin(h);
                const lat = c[1] * Math.PI / 180;
                const k = 1 / (40075016.686 * Math.cos(lat));                    // метров → Меркатор
                const x = (c[0] + 180) / 360, y = (180 - 180 / Math.PI * Math.log(Math.tan(Math.PI / 4 + lat / 2))) / 360;
                const elev = (terrain && map.queryTerrainElevation(c)) || 0;
                const z = elev + car.z;
                // туда — по правому пути, обратно — тоже по правому (по ходу движения)
                const side = -car.track, ox = uy * side * k, oy = -ux * side * k;
                const put = p => out.push({
                    x: x + ox + ux * p.x * k, y: y + oy + uy * p.x * k, ux, uy,
                    l: p.l * k, w: p.w * k, z0: (z + p.z0) * k, z1: (z + p.z1) * k, c: p.c
                });
                tr.parts.forEach(put);
                if (i === 0) tr.nose.forEach(put);
                if (i === car.n - 1) tr.nose.forEach(p => put({ ...p, x: -p.x }));
            }
        }
        return out;
    }

    const layer = createTrainLayer(map, boxes);
    // поверх линий и зданий, под подписями
    const symbol = map.getStyle().layers.find(l => l.type === 'symbol')?.id;
    map.addLayer(layer, symbol);

    function frame(now) {
        const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
        last = now;
        const pace = getPace();
        if (pace > 0 && trains.length) {
            step(dt * pace);
            map.triggerRepaint();
        }
        raf = requestAnimationFrame(frame);
    }

    rebuild();
    raf = requestAnimationFrame(frame);

    return {
        rebuild,
        stop() { cancelAnimationFrame(raf); },
        get count() { return trains.length; }
    };
}
