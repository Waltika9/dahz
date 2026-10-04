/* ============================================================
   Space Simulator 🌏 — physics.js
   Физика N тел: закон всемирного тяготения F = G·m₁·m₂ / r²,
   столкновения и слияния, обломки, чёрные дыры, двигатели.
   ============================================================ */
'use strict';

const Physics = (() => {

    /* ---------- Единицы измерения симуляции ----------
       Длина — пиксель мира: 1 а.е. (расстояние Земля — Солнце) = 220 пикс.
       Масса — масса Земли M⊕: Солнце = 333 000 M⊕, как в реальности.
       Время — секунда симуляции. G подобрана так, что земной год ≈ 20 секунд. */
    const G = 3;
    const AU = 220;
    const M_SUN = 333000;
    const M_JUPITER = 317.8;
    const YEAR = 2 * Math.PI * Math.sqrt(AU ** 3 / (G * (M_SUN + 1)));   // ≈ 20.5 с
    const KM_S = (1.495978707e8 / AU) / (3.15576e7 / YEAR);              // км/с в 1 пикс/с

    const SOFT2 = 1.5 * 1.5;        // сглаживание: сила не уходит в бесконечность при r → 0
    const BASE_DT = 1 / 240;        // обычный шаг интегрирования
    const MIN_DT = BASE_DT / 40;    // самый мелкий шаг (при тесных сближениях)
    const MAX_BODIES = 400;

    // Пороги превращений
    const STAR_IGNITION = 80 * M_JUPITER;  // ≈ 25 400 M⊕ — в недрах зажигается термоядерная реакция
    const NEUTRON_LIMIT = 2.5 * M_SUN;     // предел Толмена — Оппенгеймера — Волкова
    const STAR_COLLAPSE = 40 * M_SUN;      // упрощённо: слишком тяжёлая звезда схлопывается

    // Двигатели (ускорение, пикс/с²)
    const SHIP_MANUAL_THRUST = 14;
    const SHIP_AUTO_THRUST = 1.2;
    const SAT_MAX_THRUST = 5;

    /* ---------- Виды объектов ----------
       kind:  star | neutron | bh | planet | small | craft
       group: вкладка в меню «Создать» (null — только появляются сами)
       realR: настоящий радиус, км (на экране размеры сильно увеличены) */
    const TYPES = {
        yellow_dwarf: { kind: 'star',    group: 'stars',   name: 'Жёлтый карлик',         short: 'Звезда',          mass: M_SUN,       radius: 26, temp: 5800,   realR: 696000,   spin: 0.08 },
        red_giant:    { kind: 'star',    group: 'stars',   name: 'Красный гигант',        short: 'Красный гигант',  mass: 3 * M_SUN,   radius: 66, temp: 3500,   realR: 7.0e7,    spin: 0.02 },
        blue_giant:   { kind: 'star',    group: 'stars',   name: 'Голубой гигант',        short: 'Голубой гигант',  mass: 12 * M_SUN,  radius: 40, temp: 28000,  realR: 5.6e6,    spin: 0.15 },
        neutron:      { kind: 'neutron', group: 'stars',   name: 'Нейтронная звезда',     short: 'Пульсар',         mass: 1.4 * M_SUN, radius: 5,  temp: 600000, realR: 11,       spin: 6 },
        black_hole:   { kind: 'bh',      group: 'stars',   name: 'Чёрная дыра',           short: 'Чёрная дыра',     mass: 8 * M_SUN,   radius: 16, temp: 0,      realR: 23.6,     spin: 1 },
        earth:        { kind: 'planet',  group: 'planets', name: 'Землеподобная планета', short: 'Земля',           mass: 1,           radius: 8,  temp: 288,    realR: 6371,     spin: 0.6 },
        gas_giant:    { kind: 'planet',  group: 'planets', name: 'Газовый гигант',        short: 'Газовый гигант',  mass: 95,          radius: 19, temp: 134,    realR: 58232,    spin: 1.2, rings: true },
        ice_giant:    { kind: 'planet',  group: 'planets', name: 'Ледяной гигант',        short: 'Ледяной гигант',  mass: 15,          radius: 14, temp: 72,     realR: 25362,    spin: 0.9 },
        volcanic:     { kind: 'planet',  group: 'planets', name: 'Вулканическая планета', short: 'Вулкан',          mass: 0.8,         radius: 8,  temp: 950,    realR: 6000,     spin: 0.5 },
        moon:         { kind: 'planet',  group: 'planets', name: 'Спутник (луна)',        short: 'Луна',            mass: 0.0123,      radius: 4,  temp: 250,    realR: 1737,     spin: 0.3 },
        asteroid:     { kind: 'small',   group: 'small',   name: 'Каменистый астероид',   short: 'Астероид',        mass: 1e-5,        radius: 2.5, temp: 200,   realR: 120,      spin: 2 },
        comet:        { kind: 'small',   group: 'small',   name: 'Ледяная комета',        short: 'Комета',          mass: 2e-9,        radius: 2,  temp: 60,     realR: 6,        spin: 1.5 },
        ship:         { kind: 'craft',   group: 'small',   name: 'Космический корабль',   short: 'Корабль',         mass: 1e-15,       radius: 3,  temp: 290,    realR: 0.06,     spin: 0 },
        satellite:    { kind: 'craft',   group: 'small',   name: 'Искусственный спутник', short: 'Спутник',         mass: 1e-15,       radius: 3,  temp: 290,    realR: 0.01,     spin: 0 },
        red_dwarf:    { kind: 'star',    group: null,      name: 'Красный карлик',        short: 'Красный карлик',  mass: 0.3 * M_SUN, radius: 14, temp: 3200,   realR: 250000,   spin: 0.1 },
        debris:       { kind: 'small',   group: null,      name: 'Обломок',               short: 'Обломок',         mass: 1e-6,        radius: 1.5, temp: 300,   realR: 30,       spin: 3 }
    };

    // ---------- Мир ----------
    function createWorld() {
        return { bodies: [], time: 0, nextId: 1, counters: {} };
    }

    // Радиус горизонта растёт пропорционально массе (как у настоящих чёрных дыр)
    function bhRadius(m) {
        return Math.min(150, Math.max(4, 2 * m / M_SUN));
    }

    function createBody(world, type, x, y, vx = 0, vy = 0, o = {}) {
        const t = TYPES[type] || TYPES.asteroid;
        // имя по умолчанию: «Земля», «Земля-2», «Земля-3»… без повторов
        let name = o.name;
        if (!name) {
            let n = (world.counters[type] || 0) + 1;
            do { name = n === 1 ? t.short : `${t.short}-${n}`; n++; }
            while (world.bodies.some(b => b.name === name));
            world.counters[type] = n - 1;
        }
        const r = o.radius ?? t.radius;
        const temp = o.temp ?? t.temp;
        const b = {
            id: world.nextId++,
            type, kind: t.kind, look: o.look || type,
            name,
            x, y, vx, vy, ax: 0, ay: 0,
            m: o.mass ?? t.mass,
            r,
            realR: o.realR ?? t.realR * (r / t.radius),
            temp, baseTemp: temp,
            seed: o.seed ?? ((Math.random() * 1e9) | 0),
            rot: Math.random() * Math.PI * 2,
            spin: o.spin ?? t.spin * (0.7 + Math.random() * 0.6),
            rings: o.rings ?? !!t.rings,
            ringAngle: o.ringAngle ?? (-0.45 + Math.random() * 0.6),
            heading: (vx || vy) ? Math.atan2(vy, vx) : -Math.PI / 2,
            engine: t.kind === 'craft',
            input: { thrust: 0, turn: 0 },
            thrusting: 0,
            debris: !!o.debris,
            tint: o.tint || null,
            age: 0, alive: true, trail: [],
            nearBH: 0, stripped: 0, feed: 0
        };
        if (b.kind === 'bh') makeBH(b);
        world.bodies.push(b);
        return b;
    }

    function makeBH(b) {
        b.type = 'black_hole'; b.kind = 'bh'; b.look = 'black_hole';
        b.r = bhRadius(b.m);
        b.temp = b.baseTemp = 0;
        b.rings = false; b.engine = false; b.spin = 1;
    }

    /* ---------- Силы ----------
       Каждое тело притягивает каждое: a = G·m / r² (ускорение от тела массы m).
       Перебираем пары один раз (i < j) — третий закон Ньютона: силы равны и противоположны. */
    function computeForces(world, pairs) {
        const B = world.bodies, n = B.length;
        for (let i = 0; i < n; i++) { B[i].ax = 0; B[i].ay = 0; }
        for (let i = 0; i < n; i++) {
            const a = B[i];
            const x0 = a.x, y0 = a.y, am = a.m, ar = a.r;
            let accX = 0, accY = 0;
            for (let j = i + 1; j < n; j++) {
                const b = B[j];
                const dx = b.x - x0, dy = b.y - y0;
                const d2 = dx * dx + dy * dy;
                if (pairs) {
                    const reach = ar + b.r;
                    // свежие обломки не слипаются друг с другом сразу после взрыва
                    if (d2 < reach * reach && !(a.debris && b.debris && (a.age < 2 || b.age < 2))) pairs.push(a, b);
                }
                const s2 = d2 + SOFT2;
                const f = G / (s2 * Math.sqrt(s2));
                const fa = f * b.m, fb = f * am;
                accX += dx * fa; accY += dy * fa;
                b.ax -= dx * fb; b.ay -= dy * fb;
            }
            a.ax += accX; a.ay += accY;
        }
        applyEngines(world);
        applyAccretion(world);
    }

    // Двигатели кораблей и спутников
    function applyEngines(world) {
        for (const b of world.bodies) {
            if (b.kind !== 'craft') continue;
            b.thrusting = 0;
            if (b.type === 'ship') {
                let thrust = 0;
                if (b.input.thrust) {
                    thrust = b.input.thrust * SHIP_MANUAL_THRUST;
                } else if (b.engine && !b.input.manual) {
                    // автопилот: слабая тяга по направлению движения (как ионный двигатель).
                    // Пока игрок управляет кораблём (manual), автопилот нос не трогает.
                    const att = attractorAt(world, b.x, b.y, b);
                    const rvx = b.vx - (att ? att.vx : 0), rvy = b.vy - (att ? att.vy : 0);
                    if (rvx || rvy) b.heading = Math.atan2(rvy, rvx);
                    thrust = SHIP_AUTO_THRUST;
                }
                if (thrust) {
                    b.ax += Math.cos(b.heading) * thrust;
                    b.ay += Math.sin(b.heading) * thrust;
                    b.thrusting = Math.sign(thrust) * (b.input.thrust ? 1 : 0.4);
                }
            } else if (b.type === 'satellite') {
                const att = attractorAt(world, b.x, b.y, b);
                if (!att) continue;
                const rx = b.x - att.x, ry = b.y - att.y;
                const r = Math.hypot(rx, ry) || 1;
                b.heading = Math.atan2(ry, rx) + Math.PI / 2;   // панели вдоль орбиты
                if (!b.engine) continue;
                // стабилизация: подруливаем к скорости круговой орбиты
                const rvx = b.vx - att.vx, rvy = b.vy - att.vy;
                const dir = (rx * rvy - ry * rvx) >= 0 ? 1 : -1;
                const vc = Math.sqrt(G * att.m / r);
                const dvx = att.vx + dir * (-ry / r) * vc - b.vx;
                const dvy = att.vy + dir * (rx / r) * vc - b.vy;
                const dv = Math.hypot(dvx, dvy);
                if (dv > 0.25) {
                    const acc = Math.min(SAT_MAX_THRUST, dv * 2);
                    b.ax += dvx / dv * acc;
                    b.ay += dvy / dv * acc;
                    b.thrusting = 1;
                    b.thrustDir = Math.atan2(dvy, dvx);
                }
            }
        }
    }

    // Возле чёрной дыры вещество тормозит о горячий аккреционный диск и закручивается внутрь
    function applyAccretion(world) {
        const B = world.bodies;
        for (const h of B) {
            if (h.kind !== 'bh') continue;
            const R = h.r * 5;
            for (const b of B) {
                if (b === h || b.kind === 'bh') continue;
                const dx = b.x - h.x, dy = b.y - h.y;
                const d2 = dx * dx + dy * dy;
                if (d2 > R * R) continue;
                const near = 1 - Math.sqrt(d2) / R;
                const k = 1.5 * near;
                const rvx = b.vx - h.vx, rvy = b.vy - h.vy;
                b.ax -= rvx * k; b.ay -= rvy * k;
                const share = b.m / h.m;                 // импульс уходит в чёрную дыру
                h.ax += rvx * k * share; h.ay += rvy * k * share;
                if (near > b.nearBH) b.nearBH = near;
            }
        }
    }

    /* ---------- Главное тело рядом с точкой ----------
       Тот, кто сильнее всех тянет (и хотя бы в 10 раз тяжелее). Если две звезды тянут
       почти одинаково (двойная система) — возвращаем их общий центр масс. */
    function attractorAt(world, x, y, self = null) {
        const minM = self ? self.m * 10 : 0;
        let best = null, bestA = 0, second = null, secondA = 0;
        for (const b of world.bodies) {
            if (b === self || !b.alive || b.m <= minM) continue;
            const dx = b.x - x, dy = b.y - y;
            const acc = b.m / (dx * dx + dy * dy + SOFT2);
            if (acc > bestA) { second = best; secondA = bestA; best = b; bestA = acc; }
            else if (acc > secondA) { second = b; secondA = acc; }
        }
        if (!best) return null;
        if (second && secondA > bestA * 0.25 && second.m > best.m * 0.1) {
            const M = best.m + second.m;
            return {
                x: (best.x * best.m + second.x * second.m) / M,
                y: (best.y * best.m + second.y * second.m) / M,
                vx: (best.vx * best.m + second.vx * second.m) / M,
                vy: (best.vy * best.m + second.vy * second.m) / M,
                m: M, body: null, pair: [best, second]
            };
        }
        return { x: best.x, y: best.y, vx: best.vx, vy: best.vy, m: best.m, body: best, pair: null };
    }

    // В какую сторону вращается большинство тел вокруг центра (+1 / −1).
    // На экране ось Y смотрит вниз, поэтому «против часовой» — это −1.
    function orbitSense(world, att) {
        let L = 0;
        for (const b of world.bodies) {
            if (b === att.body || (att.pair && att.pair.includes(b)) || b.m >= att.m) continue;
            L += Math.min(b.m, 1e3) * ((b.x - att.x) * (b.vy - att.vy) - (b.y - att.y) * (b.vx - att.vx));
        }
        return L > 0 ? 1 : -1;
    }

    // Скорость для круговой орбиты в точке (x, y)
    function circularVelocity(world, x, y, self = null) {
        const att = attractorAt(world, x, y, self);
        if (!att) return null;
        const rx = x - att.x, ry = y - att.y;
        const r = Math.hypot(rx, ry);
        if (r < 1e-6) return null;
        const v = Math.sqrt(G * att.m / r);
        const dir = orbitSense(world, att);
        return { vx: att.vx + dir * (-ry / r) * v, vy: att.vy + dir * (rx / r) * v, att, v };
    }

    /* ---------- Параметры орбиты (законы Кеплера) ----------
       По положению и скорости находим эллипс: большую полуось a,
       эксцентриситет e, наклон и центр. Если энергия ≥ 0 — орбита не замкнута. */
    function orbitOf(b, att) {
        if (!att) return null;
        const rx = b.x - att.x, ry = b.y - att.y;
        const vx = b.vx - att.vx, vy = b.vy - att.vy;
        const mu = G * (att.m + b.m);
        const r = Math.hypot(rx, ry);
        if (r < 1e-6) return null;
        const v2 = vx * vx + vy * vy;
        const energy = v2 / 2 - mu / r;
        if (energy >= 0) return null;
        const a = -mu / (2 * energy);
        const rv = rx * vx + ry * vy;
        const ex = ((v2 - mu / r) * rx - rv * vx) / mu;
        const ey = ((v2 - mu / r) * ry - rv * vy) / mu;
        const e = Math.hypot(ex, ey);
        if (e >= 0.985 || a > 60000) return null;
        return {
            a, e,
            b: a * Math.sqrt(1 - e * e),
            angle: Math.atan2(ey, ex),
            cx: att.x - a * ex,
            cy: att.y - a * ey,
            period: 2 * Math.PI * Math.sqrt(a * a * a / mu),
            dist: r
        };
    }

    // ---------- Шаг времени ----------
    function safeDt(world) {
        let dt = BASE_DT;
        for (const b of world.bodies) {
            const r = Math.max(b.r, 1);
            const a2 = b.ax * b.ax + b.ay * b.ay;
            if (a2 > 0) dt = Math.min(dt, 0.1 * Math.sqrt(r / Math.sqrt(a2)));
            const v2 = b.vx * b.vx + b.vy * b.vy;
            if (v2 > 0) dt = Math.min(dt, 0.5 * r / Math.sqrt(v2));
        }
        return Math.max(dt, MIN_DT);
    }

    // Один шаг: метод «скоростной Верле» (толчок — сдвиг — толчок). Он хорошо держит орбиты.
    function step(world, dt, events) {
        let B = world.bodies;
        const h = dt * 0.5;
        for (const b of B) {
            b.vx += b.ax * h; b.vy += b.ay * h;
            b.x += b.vx * dt; b.y += b.vy * dt;
        }
        const pairs = [];
        computeForces(world, pairs);
        const relax = Math.min(1, dt / 15);
        for (const b of B) {
            b.vx += b.ax * h; b.vy += b.ay * h;
            b.rot += b.spin * dt;
            b.age += dt;
            if (b.temp !== b.baseTemp) b.temp += (b.baseTemp - b.temp) * relax;   // остывание после ударов
        }

        let changed = false;
        for (let i = 0; i < pairs.length; i += 2) {
            const a = pairs[i], b = pairs[i + 1];
            if (a.alive && b.alive) { collide(world, a, b, events); changed = true; }
        }
        if (tidal(world, dt, events)) changed = true;

        if (changed) {
            world.bodies = world.bodies.filter(b => b.alive);
            computeForces(world, null);
        }
        world.time += dt;
    }

    // Продвинуть симуляцию на simTime секунд. Мелкие шаги — когда тела близко и быстро.
    function advance(world, simTime, maxSteps = 600) {
        const events = [];
        computeForces(world, null);
        let left = simTime, steps = 0;
        while (left > 1e-12 && steps < maxSteps) {
            const dt = Math.min(left, safeDt(world));
            step(world, dt, events);
            left -= dt;
            steps++;
        }
        return { events, steps, dropped: left };
    }

    // ---------- Столкновения ----------
    function collide(world, a, b, events) {
        if (a.kind === 'bh' && b.kind === 'bh') return mergeBH(world, a, b, events);
        if (a.kind === 'bh') return absorb(world, a, b, events);
        if (b.kind === 'bh') return absorb(world, b, a, events);
        if (a.kind === 'craft' || b.kind === 'craft') return crash(a, b, events);

        const big = a.m >= b.m ? a : b;
        const small = big === a ? b : a;
        const bigStar = big.kind === 'star' || big.kind === 'neutron';
        const smallStar = small.kind === 'star' || small.kind === 'neutron';

        if (bigStar) {
            let kind = 'burn';
            if (smallStar) kind = (big.kind === 'neutron' && small.kind === 'neutron') ? 'kilonova' : 'starmerge';
            return merge(world, big, small, events, kind);
        }
        // огромная разница масс → меньшее тело разлетается на обломки
        const ratio = big.m / Math.max(small.m, 1e-30);
        if (ratio >= 30 && small.r >= 2.4 && !small.debris && world.bodies.length < MAX_BODIES - 12) {
            return shatter(world, big, small, events);
        }
        merge(world, big, small, events, 'merge');
    }

    // Слияние с сохранением импульса: p = m₁v₁ + m₂v₂
    function merge(world, big, small, events, kind) {
        const M = big.m + small.m;
        const vrel = Math.hypot(big.vx - small.vx, big.vy - small.vy);
        const x = (big.x * big.m + small.x * small.m) / M;
        const y = (big.y * big.m + small.y * small.m) / M;
        const hitX = small.x, hitY = small.y;

        big.vx = (big.m * big.vx + small.m * small.vx) / M;
        big.vy = (big.m * big.vy + small.m * small.vy) / M;
        big.x = x; big.y = y;
        // объём складывается: r³ = r₁³ + r₂³
        big.r = Math.cbrt(big.r ** 3 + small.r ** 3);
        big.realR = Math.cbrt(big.realR ** 3 + small.realR ** 3);

        if (kind === 'starmerge' || kind === 'kilonova') {
            // общая звезда тяжелее — значит горячее
            const t = (big.baseTemp * big.m + small.baseTemp * small.m) / M;
            big.baseTemp = Math.min(60000, t * Math.pow(M / big.m, 0.35));
            big.temp = big.baseTemp * 1.4;
        } else if (big.kind !== 'star' && big.kind !== 'neutron') {
            // энергия удара превращается в тепло
            const heat = Math.min(2600, (small.m / M) * vrel * vrel * 3);
            big.temp += heat;
        }
        big.m = M;
        small.alive = false;
        events.push({ type: kind, a: big, b: small, x: hitX, y: hitY, vrel, share: small.m / M });
        checkThresholds(world, big, events);
    }

    // Меньшее тело разбивается: часть массы падает на большое, остальное — обломки
    function shatter(world, big, small, events) {
        const M = big.m + small.m;
        const px = big.m * big.vx + small.m * small.vx;
        const py = big.m * big.vy + small.m * small.vy;
        const cvx = px / M, cvy = py / M;
        const vrel = Math.hypot(big.vx - small.vx, big.vy - small.vy);
        const baseAng = Math.atan2(small.y - big.y, small.x - big.x);
        const room = MAX_BODIES - world.bodies.length - 4;
        const count = Math.max(2, Math.min(room, Math.min(9, Math.max(3, Math.round(small.r * 1.2)))));
        const fragTotal = small.m * 0.35;
        const fm = fragTotal / count;
        const fr = Math.max(1.2, small.r * 0.42);
        const vesc = Math.sqrt(2 * G * big.m / big.r);
        const tint = small.tint || small.look;
        let fpx = 0, fpy = 0;

        for (let k = 0; k < count; k++) {
            const ang = baseAng + (Math.random() - 0.5) * 2.4;
            const dist = big.r + fr * 1.5 + 1 + Math.random() * small.r;
            const speed = vesc * (0.55 + Math.random() * 0.8) + vrel * 0.15 * Math.random();
            const kick = ang + (Math.random() - 0.5) * 1.0;
            const vx = cvx + Math.cos(kick) * speed;
            const vy = cvy + Math.sin(kick) * speed;
            createBody(world, 'debris', big.x + Math.cos(ang) * dist, big.y + Math.sin(ang) * dist, vx, vy, {
                mass: fm, radius: fr * (0.75 + Math.random() * 0.5), debris: true, tint,
                temp: Math.max(small.temp, 700), name: `Обломок (${small.name})`
            }).baseTemp = small.baseTemp;
            fpx += fm * vx; fpy += fm * vy;
        }

        const mBig = M - fragTotal;
        const absorbed = small.m - fragTotal;
        big.x = (big.x * big.m + small.x * absorbed) / (big.m + absorbed);
        big.y = (big.y * big.m + small.y * absorbed) / (big.m + absorbed);
        big.vx = (px - fpx) / mBig;
        big.vy = (py - fpy) / mBig;
        big.r = Math.cbrt(big.r ** 3 + 0.65 * small.r ** 3);
        big.realR = Math.cbrt(big.realR ** 3 + 0.65 * small.realR ** 3);
        big.temp += Math.min(900, vrel * vrel * 0.5 * (small.m / M) * 40);
        big.m = mBig;
        small.alive = false;
        events.push({ type: 'shatter', a: big, b: small, x: small.x, y: small.y, count, vrel });
        checkThresholds(world, big, events);
    }

    // Чёрная дыра поглощает тело
    function absorb(world, bh, victim, events) {
        const M = bh.m + victim.m;
        bh.vx = (bh.m * bh.vx + victim.m * victim.vx) / M;
        bh.vy = (bh.m * bh.vy + victim.m * victim.vy) / M;
        bh.x = (bh.x * bh.m + victim.x * victim.m) / M;
        bh.y = (bh.y * bh.m + victim.y * victim.m) / M;
        bh.m = M;
        bh.r = bhRadius(M);
        bh.feed = 1;
        victim.alive = false;
        events.push({ type: 'absorb', a: bh, b: victim, x: victim.x, y: victim.y });
    }

    // Две чёрные дыры сливаются. ~5% массы уносят гравитационные волны.
    function mergeBH(world, a, b, events) {
        const big = a.m >= b.m ? a : b;
        const small = big === a ? b : a;
        const M = a.m + b.m;
        big.vx = (a.m * a.vx + b.m * b.vx) / M;
        big.vy = (a.m * a.vy + b.m * b.vy) / M;
        big.x = (a.x * a.m + b.x * b.m) / M;
        big.y = (a.y * a.m + b.y * b.m) / M;
        big.m = M * 0.95;
        big.r = bhRadius(big.m);
        big.feed = 1;
        small.alive = false;
        events.push({ type: 'bhmerge', a: big, b: small, x: big.x, y: big.y, lost: M * 0.05 });
    }

    // Корабль во что-то врезался
    function crash(a, b, events) {
        const craft = a.kind === 'craft' ? a : b;
        const other = craft === a ? b : a;
        craft.alive = false;
        if (other.kind === 'craft') other.alive = false;
        events.push({ type: 'crash', a: craft, b: other, x: craft.x, y: craft.y });
    }

    // Приливные силы: у самой чёрной дыры тело вытягивается («спагеттификация») и теряет вещество
    function tidal(world, dt, events) {
        let changed = false;
        for (const h of world.bodies) {
            if (h.kind !== 'bh' || !h.alive) continue;
            for (const b of world.bodies) {
                if (!b.alive || b === h || b.kind === 'bh' || b.kind === 'craft') continue;
                const d = Math.hypot(b.x - h.x, b.y - h.y);
                const zone = h.r * 2.6 + b.r;
                if (d > zone) continue;
                const rate = 0.1 + 0.9 * (1 - d / zone);       // доля массы в секунду
                const old = b.m;
                const dm = Math.min(old, old * rate * dt);
                const nm = h.m + dm;
                h.vx = (h.vx * h.m + b.vx * dm) / nm;
                h.vy = (h.vy * h.m + b.vy * dm) / nm;
                h.m = nm;
                h.r = bhRadius(nm);
                h.feed = 1;
                b.m = old - dm;
                b.r *= Math.cbrt(Math.max(1e-9, b.m / old));
                b.realR *= Math.cbrt(Math.max(1e-9, b.m / old));
                b.stripped = 1;
                if (b.r < 0.8 || b.m <= old * 1e-6) { absorb(world, h, b, events); changed = true; }
            }
        }
        return changed;
    }

    // ---------- Превращения ----------
    function checkThresholds(world, b, events) {
        if (!b.alive || b.kind === 'bh' || b.kind === 'craft') return;
        if (b.kind === 'neutron' && b.m > NEUTRON_LIMIT) toBlackHole(world, b, events, 'neutron');
        else if (b.kind === 'star' && b.m > STAR_COLLAPSE) toBlackHole(world, b, events, 'supernova');
        else if ((b.kind === 'planet' || b.kind === 'small') && b.m >= STAR_IGNITION) ignite(b, events);
    }

    function toBlackHole(world, b, events, reason = 'manual') {
        const from = b.type;
        makeBH(b);
        if (events) events.push({ type: 'tobh', a: b, reason, from, x: b.x, y: b.y });
    }

    function ignite(b, events) {
        b.type = 'red_dwarf'; b.kind = 'star'; b.look = 'red_dwarf';
        b.baseTemp = 3200; b.temp = 4500;
        b.r = Math.max(b.r, 12);
        b.realR = Math.max(b.realR, 150000);
        b.rings = false;
        b.spin = 0.1;
        events.push({ type: 'ignite', a: b, x: b.x, y: b.y });
    }

    // Изменение массы из инспектора
    function setMass(world, b, m, events) {
        b.m = m;
        if (b.kind === 'bh') b.r = bhRadius(m);
        checkThresholds(world, b, events);
    }

    function setRadius(b, r) {
        if (b.kind === 'bh') return;
        b.realR *= r / b.r;
        b.r = r;
    }

    function removeBody(world, b) {
        b.alive = false;
        world.bodies = world.bodies.filter(x => x.alive);
    }

    /* ---------- Прогноз траектории ----------
       Копируем самые тяжёлые тела и «прокручиваем время вперёд» для пробного тела. */
    function predict(world, x, y, vx, vy, o = {}) {
        const exclude = o.exclude || null;
        const src = world.bodies
            .filter(b => b.alive && b !== exclude && b.m > 1e-6)
            .sort((p, q) => q.m - p.m)
            .slice(0, 24)
            .map(b => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, m: b.m, r: b.r, ax: 0, ay: 0, ref: b }));
        const n = src.length;
        const steps = o.steps || 480;
        const dt = o.dt || YEAR / 640;
        const every = o.every || 2;
        const rTest = o.radius || 1;
        const pts = [];
        let hit = null;
        const p = { x, y, vx, vy, ax: 0, ay: 0 };

        const forces = () => {
            for (const s of src) { s.ax = 0; s.ay = 0; }
            for (let i = 0; i < n; i++) {
                const a = src[i];
                for (let j = i + 1; j < n; j++) {
                    const b = src[j];
                    const dx = b.x - a.x, dy = b.y - a.y;
                    const s2 = dx * dx + dy * dy + SOFT2;
                    const f = G / (s2 * Math.sqrt(s2));
                    a.ax += dx * f * b.m; a.ay += dy * f * b.m;
                    b.ax -= dx * f * a.m; b.ay -= dy * f * a.m;
                }
            }
            p.ax = 0; p.ay = 0;
            for (const s of src) {
                const dx = s.x - p.x, dy = s.y - p.y;
                const s2 = dx * dx + dy * dy + SOFT2;
                const f = G * s.m / (s2 * Math.sqrt(s2));
                p.ax += dx * f; p.ay += dy * f;
            }
        };

        forces();
        pts.push(x, y);
        outer:
        for (let s = 0; s < steps; s++) {
            const a = Math.hypot(p.ax, p.ay) || 1e-9;
            const sub = Math.min(12, Math.max(1, Math.ceil(dt / (0.12 * Math.sqrt(2 / a)))));
            const h = dt / sub;
            for (let k = 0; k < sub; k++) {
                for (const q of src) { q.vx += q.ax * h / 2; q.vy += q.ay * h / 2; q.x += q.vx * h; q.y += q.vy * h; }
                p.vx += p.ax * h / 2; p.vy += p.ay * h / 2; p.x += p.vx * h; p.y += p.vy * h;
                forces();
                for (const q of src) { q.vx += q.ax * h / 2; q.vy += q.ay * h / 2; }
                p.vx += p.ax * h / 2; p.vy += p.ay * h / 2;
                for (const q of src) {
                    const dx = q.x - p.x, dy = q.y - p.y;
                    const rr = q.r + rTest;
                    if (dx * dx + dy * dy < rr * rr) { hit = q.ref; pts.push(p.x, p.y); break outer; }
                }
            }
            if (s % every === 0) pts.push(p.x, p.y);
        }
        return { pts, hit };
    }

    // Тела, которые улетели далеко и уже не вернутся (скорость больше второй космической)
    function findEscaped(world, limit = 9000) {
        let M = 0, cx = 0, cy = 0, cvx = 0, cvy = 0;
        for (const b of world.bodies) {
            M += b.m; cx += b.x * b.m; cy += b.y * b.m; cvx += b.vx * b.m; cvy += b.vy * b.m;
        }
        if (M <= 0) return [];
        cx /= M; cy /= M; cvx /= M; cvy /= M;
        const out = [];
        for (const b of world.bodies) {
            const dx = b.x - cx, dy = b.y - cy;
            const d = Math.hypot(dx, dy);
            if (d > 60000) { out.push(b); continue; }
            if (d < limit) continue;
            const rvx = b.vx - cvx, rvy = b.vy - cvy;
            if (dx * rvx + dy * rvy <= 0) continue;
            if (0.5 * (rvx * rvx + rvy * rvy) - G * Math.max(M - b.m, 0) / d > 0) out.push(b);
        }
        return out;
    }

    return {
        G, AU, M_SUN, M_JUPITER, YEAR, KM_S, MAX_BODIES,
        STAR_IGNITION, NEUTRON_LIMIT, STAR_COLLAPSE,
        TYPES,
        createWorld, createBody, advance, computeForces,
        attractorAt, circularVelocity, orbitOf, predict, findEscaped,
        setMass, setRadius, removeBody, toBlackHole, bhRadius
    };
})();
