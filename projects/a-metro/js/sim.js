// ===== Симуляция: кто едет на машине, а кто на метро, ЛРТ и SkyTrain =====
// Утренний час пик. Город поделён на зоны 2×2 км. Из каждой зоны люди едут
// в другие зоны «по притяжению» (чем ближе и больше работы — тем больше едут).
// Каждый сравнивает время в пути:
//   машина = расстояние / скорость в пробках + парковка;
//   транспорт = дойти (или доехать автобусом) до станции + ожидание + поездка
//               с пересадками + дойти от станции.
// Чем выгоднее транспорт, тем больше людей пересаживается из машин — и тем
// меньше машин на дорогах. Автобусы — только «подвоз» к станциям: в пробках
// они стоят так же, как машины, поэтому отдельно не считаются.
import { TYPES } from './lines.js?v=6';

const ZONE = 4;            // клеток 500 м в зоне по стороне (2 км)
const DECAY_KM = 6;        // как быстро падает желание ехать далеко
const WALK_KM = 0.9;       // пешком до станции, дальше — автобус-подвоз
const NEAR_KM = 2.2;       // дальше этого станцией не пользуются
const WAIT = 3;            // минут ждать поезд
const TRANSFER = 5;        // минут на пересадку
const MAX_SHARE = 0.9;     // кто-то всё равно поедет на машине
const DAILY = 0.45;        // пассажиров в день на одну «поездку» модели (подогнано под реальную линию 1)
const LOCAL = 0.1;         // мелкое местное движение (доставка, такси), его транспорт не убирает
const CAR_KMH = 30;        // скорость машины на пустой дороге (по городу, со светофорами)
const PARKING = 6;         // минут на парковку и поиск места

export function prepareSim(city) {
    const { cols, rows, size } = city;
    const zc = Math.ceil(cols / ZONE), zr = Math.ceil(rows / ZONE), zn = zc * zr;
    const zoneOf = new Int32Array(size);
    for (let i = 0; i < size; i++) zoneOf[i] = Math.floor(Math.floor(i / cols) / ZONE) * zc + Math.floor((i % cols) / ZONE);
    const kmX = city.dLon * 111.32 * Math.cos((city.lat0 + rows * city.dLat / 2) * Math.PI / 180);
    const kmY = city.dLat * 111.32;

    const m = { city, zc, zn, zoneOf, kmX, kmY };
    roadsByZone(m);
    buildTrips(m);
    // Нормировка по городу без транспорта: 1 — «красная» загрузка у верхних 8 % обжитых клеток.
    // Считается один раз, чтобы было видно, насколько транспорт улучшил ситуацию.
    const raw = cellRaw(m, m.trips.map(() => 0));
    const lived = [];
    for (let i = 0; i < size; i++) if (city.pop[i] + city.jobs[i] > 300) lived.push(raw[i]);
    lived.sort((x, y) => x - y);
    m.ref = lived[Math.floor(lived.length * 0.92)] || 1;
    m.baseJam = toJam(m, raw);
    m.baseZoneJam = zoneJam(m, m.baseJam);
    m.baseAverage = average(city, m.baseJam);
    return m;
}

// Сколько дорог в каждой зоне
function roadsByZone(m) {
    const { city, zn, zoneOf } = m;
    m.cap = new Float64Array(zn);
    m.weight = new Float64Array(zn);
    for (let i = 0; i < city.size; i++) { m.cap[zoneOf[i]] += city.road[i]; m.weight[zoneOf[i]] += city.road[i] + 0.5; }
}

// Город изменился (режим строительства): заново дороги по зонам и поездки.
// Нормировка ref остаётся прежней — так видно, стало лучше или хуже
export function refreshSim(m) {
    roadsByZone(m);
    buildTrips(m);
    m.baseJam = toJam(m, cellRaw(m, m.trips.map(() => 0)));
    m.baseZoneJam = zoneJam(m, m.baseJam);
    m.baseAverage = average(m.city, m.baseJam);
}

// Поездки между зонами (пересчитываются, если город меняется — режим строительства)
export function buildTrips(m) {
    const { city, zn, zoneOf, kmX, kmY, zc } = m;
    const P = new Float64Array(zn), J = new Float64Array(zn);
    const zx = new Float64Array(zn), zy = new Float64Array(zn), w = new Float64Array(zn);
    for (let i = 0; i < city.size; i++) {
        const z = zoneOf[i];
        P[z] += city.pop[i];
        J[z] += city.jobs[i] + city.attr[i] * 0.5;
        // центр зоны — по людям, а не геометрический
        const k = city.pop[i] + city.jobs[i] + 1;
        zx[z] += (i % city.cols) * kmX * k; zy[z] += Math.floor(i / city.cols) * kmY * k; w[z] += k;
    }
    for (let z = 0; z < zn; z++) { zx[z] /= w[z]; zy[z] /= w[z]; }
    const active = [];
    for (let z = 0; z < zn; z++) if (P[z] + J[z] > 200) active.push(z);

    const from = [], to = [], trips = [], dkm = [], pathStart = [0], pathZones = [];
    const zoneKm = ZONE * Math.min(kmX, kmY);
    for (const a of active) {
        if (P[a] < 50) continue;
        let norm = 0;
        for (const b of active) norm += J[b] * Math.exp(-Math.hypot(zx[a] - zx[b], zy[a] - zy[b]) / DECAY_KM);
        if (!norm) continue;
        for (const b of active) {
            if (J[b] < 50) continue;
            const d = Math.hypot(zx[a] - zx[b], zy[a] - zy[b]);
            const t = P[a] * J[b] * Math.exp(-d / DECAY_KM) / norm;
            if (t < 1) continue;
            from.push(a); to.push(b); trips.push(t); dkm.push(d);
            // зоны по прямой, с шагом в ползоны
            const steps = Math.max(1, Math.ceil(d / (zoneKm / 2)));
            let prev = -1;
            for (let s = 0; s <= steps; s++) {
                const x = zx[a] + (zx[b] - zx[a]) * s / steps, y = zy[a] + (zy[b] - zy[a]) * s / steps;
                const z = Math.floor(Math.floor(y / kmY) / ZONE) * zc + Math.floor(Math.floor(x / kmX) / ZONE);
                if (z !== prev && z >= 0 && z < zn) { pathZones.push(z); prev = z; }
            }
            pathStart.push(pathZones.length);
        }
    }
    Object.assign(m, { P, J, zx, zy, active, from, to, trips, dkm, pathStart, pathZones: Int32Array.from(pathZones) });
    m.totalTrips = trips.reduce((s, v) => s + v, 0);
}

// Нагрузка на клетки, если доля поездок share[p] ушла с дорог на транспорт
function cellRaw(m, share) {
    const { city, zn, zoneOf, pathStart, pathZones, trips, cap } = m;
    const load = new Float64Array(zn);
    for (let p = 0; p < trips.length; p++) {
        const cars = trips[p] * (1 - share[p]);
        for (let k = pathStart[p]; k < pathStart[p + 1]; k++) load[pathZones[k]] += cars;
    }
    const raw = new Float64Array(city.size);
    for (let i = 0; i < city.size; i++) {
        const z = zoneOf[i];
        const roadShare = cap[z] > 0 ? city.road[i] / cap[z] : 0;
        const local = (city.pop[i] + city.jobs[i] + city.attr[i]) * LOCAL;
        raw[i] = (load[z] * roadShare + local) / (city.road[i] + 1.5);
    }
    return raw;
}

function toJam(m, raw) {
    const { city } = m;
    const jam = new Float32Array(city.size);
    for (let i = 0; i < city.size; i++) jam[i] = city.pop[i] + city.jobs[i] + city.attr[i] > 30 ? raw[i] / m.ref : 0;
    return jam;
}

function zoneJam(m, jam) {
    const zj = new Float64Array(m.zn);
    for (let i = 0; i < jam.length; i++) zj[m.zoneOf[i]] += jam[i] * (m.city.road[i] + 0.5);
    for (let z = 0; z < m.zn; z++) zj[z] = m.weight[z] ? zj[z] / m.weight[z] : 0;
    return zj;
}

// Средняя загрузка по городу — взвешенная по жителям
export function average(city, jam) {
    let sum = 0, people = 0;
    for (let i = 0; i < city.size; i++) { sum += Math.min(jam[i], 1.6) * city.pop[i]; people += city.pop[i]; }
    return people ? sum / people : 0;
}

// ---------- Сеть: станции и время между ними ----------
// Узел — место станции (общая точка разных линий = пересадка).
// Поиск кратчайшего времени — по состояниям «станция на линии», пересадка стоит TRANSFER минут.
function buildNetwork(m, lines) {
    const nodes = [], nodeOf = new Map();
    const states = [];   // { node, line, idx }
    const edges = [];    // edges[state] = [[to, minutes]]
    for (const line of lines) {
        const d = line._d;
        const speed = TYPES[line.type].speed;
        let prevState = -1, prevAt = 0;
        for (const st of d.stations) {
            const key = st.c[0].toFixed(5) + ',' + st.c[1].toFixed(5);
            if (!nodeOf.has(key)) {
                nodeOf.set(key, nodes.length);
                nodes.push({ key, c: st.c, x: (st.c[0] - m.city.lon0) / m.city.dLon * m.kmX, y: (st.c[1] - m.city.lat0) / m.city.dLat * m.kmY, states: [] });
            }
            const node = nodeOf.get(key);
            const s = states.length;
            states.push({ node, line: line.id });
            edges.push([]);
            nodes[node].states.push(s);
            if (prevState >= 0) {
                const minutes = (st.at - prevAt) / 1000 / speed * 60 + 0.5;
                edges[prevState].push([s, minutes]);
                edges[s].push([prevState, minutes]);
            }
            prevState = s; prevAt = st.at;
        }
    }
    // пересадки между линиями в одном узле
    for (const n of nodes) {
        for (const a of n.states) for (const b of n.states) if (a !== b) edges[a].push([b, TRANSFER]);
    }

    const N = nodes.length, S = states.length;
    const time = new Float32Array(N * N).fill(Infinity);
    const via = new Array(N * N);   // какими линиями ехали
    for (let src = 0; src < N; src++) {
        const { dist, prev } = shortest(nodes[src].states, edges, S);
        for (let t = 0; t < N; t++) {
            let bs = -1;
            for (const s of nodes[t].states) if (bs < 0 || dist[s] < dist[bs]) bs = s;
            if (bs < 0 || !isFinite(dist[bs])) continue;
            time[src * N + t] = dist[bs];
            const used = new Set();
            for (let s = bs; s >= 0; s = prev[s]) used.add(states[s].line);
            via[src * N + t] = [...used];
        }
    }
    return { nodes, time, via };
}

// Кратчайшее время от стартовых состояний до всех остальных (алгоритм Дейкстры с «кучей»:
// следующее ближайшее состояние берём сразу, а не перебором — быстро даже для большой сети)
function shortest(starts, edges, S) {
    const dist = new Float64Array(S).fill(Infinity), prev = new Int32Array(S).fill(-1);
    const hs = [], hd = [];   // куча: состояния и их время
    const push = (s, d) => {
        let i = hs.length;
        hs.push(s); hd.push(d);
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (hd[p] <= d) break;
            hs[i] = hs[p]; hd[i] = hd[p];
            i = p;
        }
        hs[i] = s; hd[i] = d;
    };
    const pop = () => {
        const top = hs[0], ls = hs.pop(), ld = hd.pop(), n = hs.length;
        if (n) {
            let i = 0;
            for (;;) {
                let c = 2 * i + 1;
                if (c >= n) break;
                if (c + 1 < n && hd[c + 1] < hd[c]) c++;
                if (hd[c] >= ld) break;
                hs[i] = hs[c]; hd[i] = hd[c];
                i = c;
            }
            hs[i] = ls; hd[i] = ld;
        }
        return top;
    };
    for (const s of starts) { dist[s] = 0; push(s, 0); }
    while (hs.length) {
        const d = hd[0], u = pop();
        if (d > dist[u]) continue;   // устаревшая запись
        for (const [v, w] of edges[u]) {
            if (d + w < dist[v]) { dist[v] = d + w; prev[v] = u; push(v, d + w); }
        }
    }
    return { dist, prev };
}

// Сколько минут от центра зоны до станции: пешком или автобусом-подвозом
const access = d => (d <= WALK_KM ? d / 5 * 60 : WALK_KM / 5 * 60 + (d - WALK_KM) / 14 * 60 + 3);
const sigmoid = x => 1 / (1 + Math.exp(-x));

// ---------- Главный расчёт ----------
// lines — только открытые линии (с посчитанной геометрией line._d)
export function runSim(m, lines) {
    const net = buildNetwork(m, lines);
    const N = net.nodes.length;

    // Станции рядом с каждой зоной
    const near = new Map();
    for (const z of m.active) {
        const list = [];
        for (let n = 0; n < N; n++) {
            const d = Math.hypot(m.zx[z] - net.nodes[n].x, m.zy[z] - net.nodes[n].y);
            if (d <= NEAR_KM) list.push([n, access(d)]);
        }
        if (list.length) near.set(z, list);
    }

    const P = m.trips.length;
    const share = new Float32Array(P);
    const best = new Int32Array(P * 2).fill(-1);
    let zj = m.baseZoneJam, jam = m.baseJam;

    // Время на транспорте от пробок не зависит — считаем один раз для каждой поездки
    const transitTime = new Float32Array(P).fill(Infinity);
    for (let p = 0; p < P; p++) {
        const na = near.get(m.from[p]), nb = near.get(m.to[p]);
        if (!na || !nb) continue;
        let t = Infinity, bs = -1, bt = -1;
        for (const [s, as] of na) for (const [e, ae] of nb) {
            if (s === e) continue;
            const v = as + net.time[s * N + e] + ae;
            if (v < t) { t = v; bs = s; bt = e; }
        }
        if (!isFinite(t)) continue;
        transitTime[p] = t + WAIT;
        best[p * 2] = bs; best[p * 2 + 1] = bt;
    }

    // Два прохода: скорость машин зависит от пробок, а пробки — от того, кто пересел
    for (let iter = 0; iter < 2; iter++) {
        for (let p = 0; p < P; p++) {
            const t = transitTime[p];
            if (!isFinite(t)) { share[p] = 0; continue; }
            // средняя пробка по пути машины
            let jsum = 0, k0 = m.pathStart[p], k1 = m.pathStart[p + 1];
            for (let k = k0; k < k1; k++) jsum += zj[m.pathZones[k]];
            const jamAvg = k1 > k0 ? jsum / (k1 - k0) : 0;
            // по прямой путь короче, чем по улицам — машине добавляем 30 %
            const car = m.dkm[p] * 1.3 / (CAR_KMH / (1 + 2 * Math.min(jamAvg, 1.6))) * 60 + PARKING;
            // в метро не бывает пробок — при равном времени чуть больше людей выбирают его
            let s = MAX_SHARE * sigmoid((car - t + 4) / 5);
            if (m.dkm[p] < 1.2) s *= 0.3;   // совсем рядом — проще пешком или на машине
            share[p] = s;
        }
        jam = toJam(m, cellRaw(m, share));
        zj = zoneJam(m, jam);
    }

    // Пассажиры по линиям и станциям (в день)
    const riders = new Map(), stationRiders = new Map();
    let transit = 0;
    for (let p = 0; p < P; p++) {
        if (share[p] <= 0) continue;
        const n = m.trips[p] * share[p];
        transit += n;
        const s = best[p * 2], e = best[p * 2 + 1];
        for (const id of net.via[s * N + e] || []) riders.set(id, (riders.get(id) || 0) + n * DAILY);
        for (const k of [net.nodes[s].key, net.nodes[e].key]) stationRiders.set(k, (stationRiders.get(k) || 0) + n * DAILY);
    }

    return {
        jam,
        average: average(m.city, jam),
        riders,
        stationRiders,
        totalRiders: transit * DAILY,
        transitShare: m.totalTrips ? transit / m.totalTrips : 0
    };
}
