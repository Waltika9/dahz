// ===== Готовые здания: от жилого комплекса до Эйфелевой башни =====
// Каждая модель — набор «выдавленных» фигур (fill-extrusion): многоугольник,
// низ (base) и верх (top) в метрах. Наклонных стен MapLibre не умеет, поэтому:
// - купола, пирамиды и шары собраны из ступенек-дисков;
// - наклонные балки и тросы — из цепочек маленьких кубиков;
// - окна и этажи — чередование полос двух цветов, карнизы — тонкие выступы.
// Размеры — примерно как у настоящих зданий.
// Координаты в метрах вокруг центра: x — восток, y — север.

const TAU = Math.PI * 2;
const CORNERS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

// ---------- Фигуры ----------
export const part = (rings, base, top, color) => ({ rings, base, top, color });

// Прямоугольник w×h с центром (cx, cy), повёрнутый на r радиан
export function rect(cx, cy, w, h, r = 0) {
    const c = Math.cos(r), s = Math.sin(r);
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
        .map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

// Эллипс (круг, если rx = ry) из n точек; turn — поворот первой точки
export function oval(cx, cy, rx, ry = rx, n = 28, turn = 0) {
    return Array.from({ length: n }, (_, k) => {
        const t = turn + k / n * TAU;
        return [cx + Math.cos(t) * rx, cy + Math.sin(t) * ry];
    });
}

// Звезда: n лучей, внутренние точки на радиусе r * inner
function star(cx, cy, r, n = 8, inner = 0.82) {
    return Array.from({ length: n * 2 }, (_, k) => {
        const t = k * Math.PI / n, rr = k % 2 ? r * inner : r;
        return [cx + Math.cos(t) * rr, cy + Math.sin(t) * rr];
    });
}

// Дуга эллипса от угла a0 до a1
function arc(cx, cy, rx, ry, a0, a1, n) {
    return Array.from({ length: n + 1 }, (_, k) => {
        const t = a0 + (a1 - a0) * k / n;
        return [cx + Math.cos(t) * rx, cy + Math.sin(t) * ry];
    });
}

// Кольцо с дыркой (внутренний контур идёт в обратную сторону)
const ringOf = (outer, inner) => [outer, inner.slice().reverse()];

// Кусок круглого кольца между углами a0 и a1
const arcRing = (cx, cy, rOut, rIn, a0, a1, n) =>
    arc(cx, cy, rOut, rOut, a0, a1, n).concat(arc(cx, cy, rIn, rIn, a1, a0, n));

// Эллиптическая «стена» толщиной depth: целое кольцо или кусок от a0 до a1
function ellRing(cx, cy, rx, ry, depth, a0 = 0, a1 = TAU, n = 48) {
    const h = depth / 2;
    if (Math.abs(a1 - a0 - TAU) < 1e-6) return ringOf(oval(cx, cy, rx + h, ry + h, n), oval(cx, cy, rx - h, ry - h, n));
    return [arc(cx, cy, rx + h, ry + h, a0, a1, n).concat(arc(cx, cy, rx - h, ry - h, a1, a0, n))];
}

// Многоугольник крупнее в k раз вокруг (cx, cy) — для карнизов
const grow = (ring, k, cx = 0, cy = 0) => ring.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);

// Стопка дисков от base до base + h: радиус по профилю radius(t), t = 0..1
function stack(out, cx, cy, base, h, n, radius, color, sides = 24, color2 = color) {
    for (let k = 0; k < n; k++) {
        const r = radius((k + 0.5) / n);
        if (r > 0.2) out.push(part([oval(cx, cy, r, r, sides)], base + h * k / n, base + h * (k + 1) / n, k % 2 ? color2 : color));
    }
}

// Шар радиуса r с центром на высоте zc
const ball = (out, cx, cy, zc, r, color, n = 10, sides = 24) =>
    stack(out, cx, cy, zc - r, 2 * r, n, t => r * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)), color, sides);

// Купол-полусфера высотой h
const dome = (out, cx, cy, base, r, h, color, n = 8, sides = 28) =>
    stack(out, cx, cy, base, h, n, t => r * Math.sqrt(Math.max(0, 1 - t * t)), color, sides);

// Конус (шпиль, крыша башенки)
const cone = (out, cx, cy, base, r, h, color, n = 6, sides = 16, color2 = color) =>
    stack(out, cx, cy, base, h, n, t => r * (1 - t), color, sides, color2);

// Пирамида-ступени с квадратным основанием
function pyramid(out, cx, cy, side, h, n, color) {
    for (let k = 0; k < n; k++) {
        const s = side * (1 - (k + 0.5) / n);
        out.push(part([rect(cx, cy, s, s)], h * k / n, h * (k + 1) / n, color));
    }
}

// Ступенчатая «башня»: tiers = [[ширина, глубина, низ, верх, цвет?], ...]
const boxes = (out, cx, cy, tiers, color) =>
    tiers.forEach(([w, d, a, b, c]) => out.push(part([rect(cx, cy, w, d)], a, b, c || color)));

// Этажи с окнами: блок режется на полосы — стена/стекло (colorA) и перекрытие (colorB)
function striped(out, ring, z0, z1, step, colorA, colorB, ratio = 0.72) {
    for (let z = z0; z < z1 - 0.01; z += step) {
        const zm = Math.min(z1, z + step * ratio), ze = Math.min(z1, z + step);
        out.push(part([ring], z, zm, colorA));
        if (ze > zm + 0.01) out.push(part([ring], zm, ze, colorB));
    }
}

// Колонны по эллипсу (весь круг или дуга от a0 до a1)
function colonnade(out, cx, cy, rx, ry, n, z0, z1, r, color, a0 = 0, a1 = TAU) {
    const full = Math.abs(a1 - a0 - TAU) < 1e-6;
    for (let k = 0; k < n; k++) {
        const t = a0 + (a1 - a0) * (full ? k / n : k / Math.max(1, n - 1));
        out.push(part([oval(cx + Math.cos(t) * rx, cy + Math.sin(t) * ry, r, r, 8)], z0, z1, color));
    }
}

// Колонны в ряд от (x0, y0) до (x1, y1)
function colRow(out, x0, y0, x1, y1, n, z0, z1, r, color) {
    for (let k = 0; k < n; k++) {
        const t = n === 1 ? 0.5 : k / (n - 1);
        out.push(part([oval(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, r, 8)], z0, z1, color));
    }
}

// Наклонная балка или трос между точками [x, y, z]: цепочка кубиков
function beam(out, p, q, size, color) {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    const n = Math.max(1, Math.ceil(len / (size * 1.1)));
    for (let i = 0; i <= n; i++) {
        const t = i / n, z = p[2] + (q[2] - p[2]) * t;
        out.push(part([rect(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, size, size)], Math.max(0, z - size / 2), z + size / 2, color));
    }
}

// Аркада по эллипсу: опоры с проёмами-арками и карниз сверху
function arcade(out, cx, cy, rx, ry, n, z0, h, color, lintel, a0 = 0, a1 = TAU, depth = 3) {
    const full = Math.abs(a1 - a0 - TAU) < 1e-6;
    const perim = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry))) * (a1 - a0) / TAU;
    const w = perim / n * 0.42;
    for (let k = 0; k < n; k++) {
        const t = a0 + (a1 - a0) * (full ? k / n : (k + 0.5) / n);
        const ang = Math.atan2(ry * Math.cos(t), -rx * Math.sin(t));
        out.push(part([rect(cx + Math.cos(t) * rx, cy + Math.sin(t) * ry, w, depth, ang)], z0, z0 + h * 0.78, color));
    }
    out.push(part(ellRing(cx, cy, rx, ry, depth + 0.4, a0, a1), z0 + h * 0.78, z0 + h, lintel));
}

// Деревья: лиственное (ствол и крона) и кипарис
function tree(out, x, y, h = 8, r = 3, color = '#86c27f', base = 0) {
    out.push(part([rect(x, y, 0.6, 0.6)], base, base + h * 0.4, '#8a6f55'));
    stack(out, x, y, base + h * 0.3, h * 0.7, 3, t => r * (1 - t * 0.55), color, 10);
}
const cypress = (out, x, y, h = 9, r = 1.4) => stack(out, x, y, 0, h, 4, t => r * (1 - t * 0.7), '#5f9e64', 8);

// Смешать два цвета #rrggbb
function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = sh => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t).toString(16).padStart(2, '0');
    return `#${ch(16)}${ch(8)}${ch(0)}`;
}

const WHITE = '#f4f6f9', SPIRE = '#eef1f5', GOLD = '#e8b84a', GLASS = '#b9cde3', GRASS = '#c4e2b8', WATER = '#9fd0ee', PATH = '#ece6d8';

// ======================= Город =======================
// Жилой комплекс: шесть домов с окнами, козырьками подъездов, двор с площадкой и деревьями
function housing() {
    const out = [part([rect(0, 0, 100, 26)], 0, 0.4, '#cfe7c8')];
    out.push(part([rect(0, 0, 100, 3)], 0.4, 0.5, PATH), part([rect(-20, 0, 14, 10)], 0.4, 0.6, '#f2c48a'));
    out.push(part([rect(-22, 2, 3, 3)], 0.6, 2.4, '#e5484d'), part([rect(-17, -2, 4, 2)], 0.6, 1.6, '#4f8cff'), part([rect(-24, -3, 2, 2)], 0.6, 1.2, '#2fb67c'));
    for (const [x, y] of [[-45, 8], [-32, -8], [10, 8], [22, -8], [34, 8], [46, -8]]) tree(out, x, y, 7, 2.6);
    const heights = [54, 60, 48, 57, 51, 60];
    let k = 0;
    for (const y of [-26, 26]) for (const x of [-40, 0, 40]) {
        const h = heights[k++], body = rect(x, y, 26, 18);
        out.push(part([body], 0, 4, '#e3d3bd'));
        striped(out, body, 4, h, 6.6, '#f0e2cf', '#d9c3a4', 0.78);
        out.push(part([rect(x, y, 26.6, 18.6)], h, h + 0.8, '#d6c2a6'), part([rect(x - 6, y, 6, 5)], h + 0.8, h + 3.6, '#cdb796'));
        out.push(part([rect(x, y + (y > 0 ? -9.8 : 9.8), 6, 1.6)], 3.2, 3.6, '#cdb796'));
    }
    return out;
}

// Бизнес-центр: подиум со стеклянным входом и три башни с вертолётной площадкой
function business() {
    const out = [];
    striped(out, rect(0, 0, 96, 66), 0, 14, 4.6, '#e2e7ee', '#c3cfdc', 0.7);
    out.push(part([rect(0, -33.6, 24, 3)], 0, 6, '#9fc3e6'), part([rect(0, -34.5, 30, 6)], 6, 6.5, '#e2e7ee'));
    for (const [x, y, s, h, c] of [[-26, 8, 32, 132, '#bccee3'], [18, -12, 26, 102, '#c8d7e9'], [28, 18, 22, 80, '#d2dfee']]) {
        striped(out, rect(x, y, s, s), 14, h, 8, c, '#97adc8', 0.8);
        out.push(part([rect(x, y, s + 0.8, s + 0.8)], h, h + 1, '#e2e7ee'));
    }
    out.push(part([rect(-26, 8, 26, 26)], 133, 140, '#8fc2ff'), part(ringOf(oval(-26, 8, 9, 9, 20), oval(-26, 8, 7.5, 7.5, 20)), 140, 140.4, '#f2b15a'));
    out.push(part([rect(18, -12, 8, 6)], 103, 106, '#c9d3df'), part([rect(28, 18, 6, 6)], 81, 84, '#c9d3df'));
    return out;
}

// Небоскрёб: восьмигранная стеклянная башня, вестибюль, светящаяся корона
function tower() {
    const out = [part([oval(0, 0, 25.6, 25.6, 8)], 0, 6, '#dfe5ec')];
    striped(out, oval(0, 0, 25, 25, 8), 6, 172, 8, GLASS, '#8fa8c4', 0.78);
    striped(out, oval(0, 0, 20, 20, 8), 172, 196, 6, '#c9d9eb', '#a9bfd8', 0.7);
    [[14, 196, 199], [13, 199, 202], [11.5, 202, 206]].forEach(([r, a, b], i) => out.push(part([oval(0, 0, r, r, 8)], a, b, i % 2 ? '#bfe0ff' : '#8fc2ff')));
    out.push(part([rect(0, 0, 2.4, 2.4)], 206, 232, SPIRE));
    return out;
}

// Торговый центр: рёбра фасада, стеклянная крыша-атриум, вывеска, парковка с деревьями
function mall() {
    const out = [part([rect(0, -82, 170, 46)], 0, 0.2, '#dde1e6')];
    for (let x = -75; x <= 75; x += 10) out.push(part([rect(x, -82, 0.4, 14)], 0.2, 0.3, '#ffffff'));
    out.push(part([rect(0, 0, 170, 110)], 0, 20, '#eee5e9'));
    for (let x = -80; x <= 80; x += 10) {
        out.push(part([rect(x, -55.6, 1.2, 1.2)], 0, 20, '#d9ccd2'), part([rect(x, 55.6, 1.2, 1.2)], 0, 20, '#d9ccd2'));
    }
    out.push(part([rect(0, 0, 36, 112)], 0, 25, '#cfe0f2'));
    for (let y = -50; y <= 50; y += 10) out.push(part([rect(0, y, 37, 0.8)], 25, 25.6, '#a9c3dd'));
    out.push(part([rect(0, -56.5, 60, 3)], 13, 17, '#e84393'), part([rect(0, -57.5, 30, 6)], 5, 5.6, '#d9ccd2'));
    for (const [x, y] of [[-55, 25], [-45, -20], [50, 30], [60, -25], [-60, -5]]) out.push(part([rect(x, y, 8, 5)], 20, 22.5, '#d6dbe1'));
    for (let x = -80; x <= 80; x += 20) tree(out, x, -108, 6, 2.4);
    return out;
}

// Стадион: поле в полоску, беговая дорожка, два яруса трибун, колонны фасада, козырёк, прожекторы
function stadium() {
    const out = [part(ringOf(oval(0, 0, 70, 50, 40), oval(0, 0, 62, 42, 40)), 0, 0.5, '#d9785a')];
    for (let i = 0; i < 9; i++) out.push(part([rect(-40 + i * 10, 0, 10, 50)], 0, 0.55, i % 2 ? '#77c08a' : '#69b27d'));
    out.push(part(ringOf(oval(0, 0, 84, 62, 48), oval(0, 0, 72, 50, 48)), 0, 12, '#e6eaf0'));
    out.push(part(ringOf(oval(0, 0, 96, 74, 48), oval(0, 0, 84, 62, 48)), 0, 6, '#d4dae2'));
    out.push(part(ringOf(oval(0, 0, 112, 90, 48), oval(0, 0, 90, 68, 48)), 10, 26, '#e6eaf0'));
    colonnade(out, 0, 0, 116, 94, 40, 0, 31, 1.4, '#ffffff');
    out.push(part(ringOf(oval(0, 0, 121, 97, 48), oval(0, 0, 92, 70, 48)), 31, 33, '#ffffff'));
    for (const [sx, sy] of CORNERS) {
        out.push(part([rect(sx * 81, sy * 65, 1.6, 1.6)], 33, 46, '#c9d0d8'), part([rect(sx * 81, sy * 65, 6, 2, Math.atan2(sy, sx))], 46, 49, '#fff6c9'));
    }
    return out;
}

// ======================= Небоскрёбы и башни =======================
// Бурдж-Халифа: три крыла буквой Y, этажи полосами, уступы по спирали, шпиль с кольцами
function burj() {
    const out = [], glass = '#c9d6e5', band = '#a7bbd1';
    for (let j = 0; j < 3; j++) {
        const ang = Math.PI / 2 + j * TAU / 3;
        out.push(part([rect(Math.cos(ang) * 45, Math.sin(ang) * 45, 30, 26, ang)], 0, 8, '#dfe5ec'));
    }
    const len = [58, 58, 58];
    let base = 0;
    [150, 120, 100, 80, 60, 45, 35].forEach((h, k) => {
        for (let j = 0; j < 3; j++) {
            const ang = Math.PI / 2 + j * TAU / 3, L = len[j];
            striped(out, rect(Math.cos(ang) * L / 2, Math.sin(ang) * L / 2, L, 24 - k * 1.6, ang), base, base + h, 20, glass, band, 0.82);
        }
        len[k % 3] -= 13;
        base += h;
    });
    out.push(part([oval(0, 0, 12)], 0, 600, SPIRE));
    [[8, 600, 670], [5.5, 670, 740], [3.5, 740, 800], [1.8, 800, 828]].forEach(([r, b, t]) => {
        out.push(part([oval(0, 0, r, r, 16)], b, t, SPIRE), part([oval(0, 0, r + 0.9, r + 0.9, 16)], b, b + 1.5, '#d6dee8'));
    });
    return out;
}

// Эйфелева башня: ноги из решётчатых стоек с обвязкой, арки, площадки с перилами, сужающийся ствол
function eiffel() {
    const out = [], iron = '#a3927c', dark = '#8a7c66';
    // Первый ярус: четыре ноги по четыре стойки, сходятся к центру
    for (let k = 0; k < 6; k++) {
        const z0 = k * 9.5, z1 = z0 + 9.5, d = 47 - k * 4.4, s = 20 - k * 1.5, post = 3.2 - k * 0.15;
        for (const [sx, sy] of CORNERS) {
            for (const [ax, ay] of CORNERS) out.push(part([rect(sx * d + ax * (s / 2 - post / 2), sy * d + ay * (s / 2 - post / 2), post, post)], z0, z1, iron));
            out.push(part(ringOf(rect(sx * d, sy * d, s, s), rect(sx * d, sy * d, s - 1.6, s - 1.6)), z1 - 0.8, z1, dark));
        }
    }
    // Арки между ногами: полоса, изогнутая дугой
    for (let side = 0; side < 4; side++) {
        const ang = side * Math.PI / 2;
        for (let i = 0; i < 12; i++) {
            const u = -33 + (i + 0.5) * 5.5, zu = 22 + 24 * (1 - (u / 36) ** 2) ** 0.5;
            const x = Math.cos(ang) * 40 - Math.sin(ang) * u, y = Math.sin(ang) * 40 + Math.cos(ang) * u;
            out.push(part([rect(x, y, 1.6, 5.6, ang)], zu, Math.min(57, zu + 3.2), dark));
        }
    }
    out.push(part(ringOf(rect(0, 0, 74, 74), rect(0, 0, 40, 40)), 57, 63, dark));
    out.push(part(ringOf(rect(0, 0, 75, 75), rect(0, 0, 73.4, 73.4)), 63, 64.4, iron));
    // Второй ярус
    for (let k = 0; k < 4; k++) {
        const z = 63 + k * 13, d = 22 - k * 2.4, s = 12 - k * 1.1, post = 2.2;
        for (const [sx, sy] of CORNERS) {
            for (const [ax, ay] of CORNERS) out.push(part([rect(sx * d + ax * (s / 2 - post / 2), sy * d + ay * (s / 2 - post / 2), post, post)], z, z + 13, iron));
            out.push(part(ringOf(rect(sx * d, sy * d, s, s), rect(sx * d, sy * d, s - 1.2, s - 1.2)), z + 12.3, z + 13, dark));
        }
    }
    out.push(part(ringOf(rect(0, 0, 40, 40), rect(0, 0, 18, 18)), 115, 119, dark));
    out.push(part(ringOf(rect(0, 0, 41, 41), rect(0, 0, 39.6, 39.6)), 119, 120.2, iron));
    // Верх: четыре стойки сходятся, обвязка каждые 15 м
    for (let k = 0; k < 10; k++) {
        const z = 119 + k * 15.7, d = 8 - k * 0.55, post = 2.6 - k * 0.12;
        for (const [sx, sy] of CORNERS) out.push(part([rect(sx * d, sy * d, post, post)], z, z + 15.7, iron));
        out.push(part(ringOf(rect(0, 0, 2 * d + post, 2 * d + post), rect(0, 0, 2 * d - post, 2 * d - post)), z + 14.9, z + 15.7, dark));
    }
    out.push(part([rect(0, 0, 12, 12)], 276, 282, dark), part(ringOf(rect(0, 0, 12.6, 12.6), rect(0, 0, 11.6, 11.6)), 282, 283.2, iron));
    out.push(part([rect(0, 0, 5, 5)], 282, 292, iron), part([oval(0, 0, 2.2, 2.2, 10)], 292, 300, dark), part([rect(0, 0, 1.4, 1.4)], 300, 330, iron));
    return out;
}

// Эмпайр-стейт-билдинг: уступы ар-деко, окна полосами, вертикальные рёбра, корона и мачта
function empire() {
    const out = [], stone = '#ddd6c6', win = '#b5ad9c', crown = '#cfc6b2';
    for (const [w, d, a, b] of [[120, 60, 0, 25], [92, 52, 25, 85], [72, 44, 85, 250], [60, 36, 250, 318], [46, 30, 318, 348], [32, 24, 348, 362]]) {
        striped(out, rect(0, 0, w, d), a, b, 8, stone, win, 0.6);
        out.push(part([rect(0, 0, w + 1.2, d + 1.2)], b - 1, b, crown));
    }
    for (let i = -3; i <= 3; i++) {
        out.push(part([rect(i * 10, 22.4, 1.4, 1)], 85, 250, crown), part([rect(i * 10, -22.4, 1.4, 1)], 85, 250, crown));
    }
    for (let i = -2; i <= 2; i++) out.push(part([rect(36.4, i * 8, 1, 1.4)], 85, 250, crown), part([rect(-36.4, i * 8, 1, 1.4)], 85, 250, crown));
    boxes(out, 0, 0, [[18, 18, 362, 370], [15, 15, 370, 376], [12, 12, 376, 381]], crown);
    out.push(part([oval(0, 0, 5, 5, 12)], 381, 410, crown));
    for (const z of [388, 396, 404]) out.push(part([oval(0, 0, 6.2, 6.2, 12)], z, z + 1.2, '#bdb39c'));
    out.push(part([oval(0, 0, 2, 2, 8)], 410, 443, SPIRE));
    return out;
}

// Всемирный торговый центр 1: подиум с «плавниками», квадрат поворачивается на 45°, антенна с кольцами
function wtc() {
    const out = [part([rect(0, 0, 64, 64)], 0, 57, '#dfe5ec')];
    for (let i = 0; i < 9; i++) {
        const p = -28 + i * 7;
        for (const s of [-1, 1]) out.push(part([rect(p, s * 32.4, 0.6, 1.2)], 0, 57, '#c7d0db'), part([rect(s * 32.4, p, 1.2, 0.6)], 0, 57, '#c7d0db'));
    }
    const n = 28;
    for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        out.push(part([rect(0, 0, 61 - 18 * t, 61 - 18 * t, t * Math.PI / 4)], 57 + 360 * k / n, 57 + 360 * (k + 1) / n, k % 2 ? '#a9c3dd' : '#b9cfe5'));
    }
    out.push(part([rect(0, 0, 44, 44, Math.PI / 4)], 417, 421, '#dfe5ec'), part([oval(0, 0, 4, 4, 12)], 421, 428, '#cfd6df'));
    for (let z = 432; z < 530; z += 20) out.push(part([oval(0, 0, 3.2, 3.2, 10)], z, z + 1.2, '#cfd6df'));
    out.push(part([oval(0, 0, 2.2, 2.2, 8)], 421, 541, SPIRE));
    return out;
}

// Тайбэй 101: «монеты» у основания, восемь расширяющихся «чашек» пагоды с узорами на углах
function taipei() {
    const green = '#86b9a8', dark = '#6fa190', light = '#a6d0c3';
    const out = [];
    striped(out, rect(0, 0, 70, 70), 0, 26, 6.5, '#d6dee0', '#bccbcf', 0.75);
    striped(out, rect(0, 0, 48, 48), 26, 92, 8, green, dark, 0.8);
    for (const [x, y] of [[0, 24.4], [0, -24.4], [24.4, 0], [-24.4, 0]]) out.push(part([oval(x, y, 4, 4, 16)], 60, 68, GOLD));
    for (let i = 0; i < 8; i++) {
        const z = 92 + i * 36;
        for (let j = 0; j < 3; j++) {
            const s = 40 + j * 4;
            striped(out, rect(0, 0, s, s), z + j * 12, z + (j + 1) * 12, 4, j === 2 ? dark : green, light, 0.75);
        }
        for (const [sx, sy] of CORNERS) out.push(part([rect(sx * 24, sy * 24, 3, 3)], z + 33, z + 36, GOLD));
    }
    boxes(out, 0, 0, [[34, 34, 380, 410], [24, 24, 410, 438, dark], [12, 12, 438, 448]], green);
    for (const z of [455, 470, 485]) out.push(part([oval(0, 0, 3.2, 3.2, 10)], z, z + 1.5, '#d6dee0'));
    out.push(part([oval(0, 0, 2, 2, 8)], 448, 508, SPIRE));
    return out;
}

// Лахта Центр: закрученная пятигранная игла и низкий изогнутый корпус вокруг
function lakhta() {
    const out = [part([arcRing(0, 0, 66, 52, 3.4, 5.9, 24)], 0, 18, '#c9d8e8'), part([arcRing(0, 0, 66.6, 51.4, 3.4, 5.9, 24)], 18, 19, '#dfe8f2')];
    const n = 40;
    for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n, r = 36 * (1 - t) + 4;
        out.push(part([oval(0, 0, r, r, 5, t * Math.PI / 2)], 400 * k / n, 400 * (k + 1) / n, k % 2 ? '#8fb6d9' : '#a6c7e4'));
    }
    out.push(part([oval(0, 0, 3, 3, 5)], 400, 440, '#cfe0f2'), part([oval(0, 0, 1.2, 1.2, 6)], 440, 462, SPIRE));
    return out;
}

// Башни Петронас: «звёзды» с уступами и карнизами, шпили, мост с опорами, торговый центр у подножия
function petronas() {
    const out = [part([rect(0, -30, 110, 40)], 0, 20, '#dfe3e8'), part([rect(0, -30, 111, 41)], 20, 21, '#c9ced6')];
    for (const x of [-29, 29]) {
        for (const [r, a, b] of [[23, 0, 170], [23, 170, 250], [20.5, 250, 300], [19, 300, 330], [17, 330, 360], [14, 360, 380], [11, 380, 392]]) {
            striped(out, star(x, 0, r), a, b, 10, '#c9ced6', '#a7b0bc', 0.75);
            out.push(part([star(x, 0, r + 0.8)], b - 0.8, b, '#e3e7ec'));
        }
        ball(out, x, 0, 398, 4, '#d6dbe1', 6, 16);
        for (const z of [410, 425, 440]) out.push(part([oval(x, 0, 2.6, 2.6, 10)], z, z + 1.5, '#d6dbe1'));
        out.push(part([oval(x, 0, 1.4, 1.4, 8)], 402, 452, SPIRE));
    }
    out.push(part([rect(0, 0, 22, 5)], 170, 176, '#8fc2ff'), part([rect(0, 0, 22, 5.6)], 176, 177, '#c9ced6'));
    beam(out, [-12, 0, 150], [-4, 0, 170], 1.4, '#c9ced6');
    beam(out, [12, 0, 150], [4, 0, 170], 1.4, '#c9ced6');
    return out;
}

// Си-Эн Тауэр: три опоры, стеклянный лифт, «тарелка» с окнами, скайпод и антенна
function cntower() {
    const out = [], concrete = '#d9dce1', pod = '#8f9aa9', glass = '#5e6b7d';
    for (const [L, W, a, b] of [[32, 9, 0, 60], [26, 8, 60, 120], [20, 7.5, 120, 190], [15, 7, 190, 260], [11, 7, 260, 335]]) {
        for (let j = 0; j < 3; j++) {
            const ang = Math.PI / 2 + j * TAU / 3;
            out.push(part([rect(Math.cos(ang) * L / 2, Math.sin(ang) * L / 2, L, W, ang)], a, b, concrete));
        }
    }
    out.push(part([oval(0, 0, 8, 8, 16)], 0, 335, concrete), part([rect(4, 7.4, 2.4, 1.2)], 0, 340, '#9fc3e6'));
    [[19, 335, 340, concrete], [22, 340, 344, pod], [23.5, 344, 350, glass], [22, 350, 354, pod], [21, 354, 358, glass], [17, 358, 362, pod], [12, 362, 366, concrete]]
        .forEach(([r, a, b, c]) => out.push(part([oval(0, 0, r, r, 32)], a, b, c)));
    out.push(part([oval(0, 0, 6, 6, 16)], 366, 446, concrete));
    [[9, 446, 449, pod], [9.6, 449, 453, glass], [8, 453, 457, pod]].forEach(([r, a, b, c]) => out.push(part([oval(0, 0, r, r, 20)], a, b, c)));
    [[3, 457, 500], [2.2, 500, 530], [1.4, 530, 553]].forEach(([r, a, b]) => out.push(part([oval(0, 0, r, r, 10)], a, b, '#c9d0d8'), part([oval(0, 0, r + 0.7, r + 0.7, 10)], a, a + 1.2, '#b7c0cb')));
    return out;
}

// Бурдж-эль-Араб: «парус» на острове, сходящиеся опоры-«мачты», балки, вертолётная площадка
function burjalarab() {
    const out = [part([oval(0, 0, 50, 42, 32)], 0, 1, '#e8d8b0')];
    const n = 24;
    for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n, w = 30 * Math.sqrt(1 - t * 0.85), d = 26 * (1 - t * 0.75);
        const sail = arc(-10, 0, d, w, -Math.PI / 2, Math.PI / 2, 14).concat([[-16, w], [-16, -w]]);
        out.push(part([sail], 290 * k / n, 290 * (k + 1) / n, k % 2 ? WHITE : '#e6ecf3'));
    }
    for (const s of [1, -1]) {
        beam(out, [-20, s * 28, 0], [-20, s * 4, 300], 3.2, '#e3e8ee');
        beam(out, [-20, s * 25, 40], [-20, -s * 18, 150], 1.6, '#dfe5ec');
        beam(out, [-20, s * 17, 160], [-20, -s * 9, 260], 1.6, '#dfe5ec');
    }
    out.push(part([oval(-20, 0, 2, 2, 8)], 290, 321, '#e3e8ee'));
    out.push(part([oval(22, 0, 12, 12, 24)], 210, 212, '#f2b15a'), part(ringOf(oval(22, 0, 9, 9, 24), oval(22, 0, 8, 8, 24)), 212, 212.2, '#ffffff'));
    out.push(part([rect(10, 0, 14, 4)], 206, 210, '#e3e8ee'));
    return out;
}

// Байтерек (Астана): ствол из прутьев, сужается к середине, крона-«ветви» и золотой шар
function baiterek() {
    const white = '#f2f4f7';
    const out = [part([oval(0, 0, 17, 17, 28)], 0, 1, '#e3e7ec'), part(ringOf(oval(0, 0, 16, 16, 28), oval(0, 0, 12, 12, 28)), 1, 1.4, WATER)];
    out.push(part([oval(0, 0, 9, 9, 20)], 1, 6, '#dfe5ec'));
    const prof = z => (z < 50 ? 7 - 3 * z / 50 : 4 + 6 * (z - 50) / 30);
    for (let k = 0; k < 12; k++) {
        const a = k / 12 * TAU;
        for (let z = 6; z < 78; z += 7.2) {
            const r = prof(z + 3.6);
            out.push(part([rect(Math.cos(a) * r, Math.sin(a) * r, 0.9, 0.9)], z, z + 7.2, white));
        }
        beam(out, [Math.cos(a) * 10, Math.sin(a) * 10, 78], [Math.cos(a) * 13.5, Math.sin(a) * 13.5, 90], 0.9, white);
    }
    out.push(part(ringOf(oval(0, 0, 10.6, 10.6, 20), oval(0, 0, 9.4, 9.4, 20)), 77, 78, white));
    ball(out, 0, 0, 86, 11, GOLD, 12, 28);
    out.push(part([oval(0, 0, 3, 3, 12)], 97, 100, white), part([oval(0, 0, 1.4, 1.4, 8)], 100, 105, white));
    return out;
}

// Пизанская башня: галереи с колоннами на каждом ярусе, карнизы, колокольня — и всё с наклоном
function pisa() {
    const out = [part([oval(0, 0, 11, 11, 24)], 0, 0.4, '#e9e3d4')];
    const off = z => z * 0.07;
    out.push(part([oval(off(3), 0, 8.6, 8.6, 24)], 0, 6, '#f3eee4'));
    colonnade(out, off(3), 0, 8.8, 8.8, 16, 0, 5.6, 0.45, '#ece6d8');
    for (let k = 0; k < 6; k++) {
        const z = 6 + k * 6.5, x = off(z + 3.25);
        out.push(part([oval(x, 0, 7, 7, 20)], z, z + 6.5, '#e6dfcf'));
        colonnade(out, x, 0, 8.1, 8.1, 20, z, z + 5.7, 0.38, '#f6f2e9');
        out.push(part([oval(x, 0, 8.7, 8.7, 24)], z + 5.7, z + 6.5, '#e2dccd'));
    }
    const zb = 45, xb = off(zb + 4);
    out.push(part([oval(xb, 0, 5.2, 5.2, 20)], zb, zb + 7, '#e6dfcf'));
    colonnade(out, xb, 0, 6, 6, 12, zb, zb + 6.5, 0.35, '#f6f2e9');
    out.push(part([oval(xb, 0, 6.5, 6.5, 20)], zb + 7, zb + 8, '#e2dccd'), part([oval(xb, 0, 4, 4, 16)], zb + 8, zb + 11, '#f3eee4'));
    return out;
}

// ======================= Чудеса света и памятники =======================
// Пирамиды Гизы: большая с золотой верхушкой, малая, три пирамиды цариц и Сфинкс в выемке
function pyramids() {
    const out = [part([rect(35, -40, 440, 360)], 0, 0.3, '#ecdcb4')];
    pyramid(out, 0, 0, 230, 136, 46, '#e2c58e');
    out.push(part([rect(0, 0, 5, 5)], 136, 139, GOLD));
    pyramid(out, 190, -150, 105, 65, 24, '#dcbd85');
    for (const y of [45, 0, -45]) pyramid(out, 150, y, 40, 26, 10, '#d8b97f');
    out.push(part([rect(-140, -130, 80, 34)], 0, 0.6, '#d6be8c'));
    out.push(part([rect(-142, -130, 52, 18)], 0.6, 13, '#d4b47a'));
    out.push(part([rect(-112, -125.5, 16, 4)], 0.6, 4, '#d4b47a'), part([rect(-112, -134.5, 16, 4)], 0.6, 4, '#d4b47a'));
    out.push(part([rect(-117, -130, 8, 12)], 0.6, 16, '#d4b47a'), part([rect(-116.5, -130, 8, 11)], 16, 20.5, '#c9a76c'), part([rect(-113, -130, 3, 5)], 13, 19, '#d8ba80'));
    return out;
}

// Колизей: три яруса арок снаружи (верхний и аттик уцелели только с севера), трибуны, арена с подземельями
function colosseum() {
    const stone = '#e0cfae', light = '#eadcc0', dark = '#c9b691';
    const out = [part([arc(0, 0, 48, 32, Math.PI / 2, Math.PI * 1.5, 20)], 0, 0.6, '#d9c49b')];
    out.push(part([arc(0, 0, 48, 32, -Math.PI / 2, Math.PI / 2, 20)], 0, 0.2, '#b59c74'));
    for (let x = 6; x < 44; x += 6) out.push(part([rect(x, 0, 1, 2 * 32 * Math.sqrt(1 - (x / 48) ** 2) * 0.9)], 0.2, 2.2, '#c8b28a'));
    for (const [ro, rio, ri, rii, h] of [[82, 66, 72, 56, 30], [72, 56, 62, 46, 23], [62, 46, 54, 38, 16], [54, 38, 48, 32, 9]]) {
        out.push(part(ringOf(oval(0, 0, ro, rio, 48), oval(0, 0, ri, rii, 48)), 0, h, light));
    }
    out.push(part(ringOf(oval(0, 0, 90, 74, 56), oval(0, 0, 82, 66, 56)), 0, 34, dark));
    arcade(out, 0, 0, 92.5, 76.5, 64, 0, 12, stone, light);
    arcade(out, 0, 0, 92.5, 76.5, 64, 12, 12, stone, light);
    arcade(out, 0, 0, 92.5, 76.5, 32, 24, 12, stone, light, 0, Math.PI);
    out.push(part(ellRing(0, 0, 92.5, 76.5, 3, 0, Math.PI, 32), 36, 47, light), part(ellRing(0, 0, 92.5, 76.5, 4.2, 0, Math.PI, 32), 47, 48, dark));
    return out;
}

// Тадж-Махал: сад с каналами и кипарисами, мечеть и гостевой дом, ниши-айваны, луковичный купол,
// беседки-чатри с колоннами и минареты с балконами
function tajmahal() {
    const marble = '#f6f3ec', white = '#fbfaf6', shade = '#e4ddcf', red = '#c0715a';
    const out = [part([rect(0, -125, 100, 150)], 0, 0.3, GRASS)];
    out.push(part([rect(0, -125, 12, 150)], 0.3, 0.4, PATH), part([rect(0, -125, 100, 10)], 0.3, 0.4, PATH));
    out.push(part([rect(0, -125, 5, 148)], 0.4, 0.6, WATER), part([rect(0, -125, 98, 4)], 0.4, 0.6, WATER), part([rect(0, -125, 10, 10)], 0.4, 1.2, '#f1ede4'));
    for (let y = -195; y <= -60; y += 15) {
        if (Math.abs(y + 125) < 8) continue;
        cypress(out, -8.5, y, 9, 1.4);
        cypress(out, 8.5, y, 9, 1.4);
    }
    for (const x of [-75, 75]) {
        out.push(part([rect(x, 0, 24, 56)], 0, 14, red), part([rect(x, 0, 25, 57)], 14, 15, '#b06450'));
        for (const y of [-16, 0, 16]) dome(out, x, y, 15, y ? 5 : 7, y ? 5 : 7, white, 4, 16);
    }
    out.push(part([rect(0, 0, 95, 95)], 0, 6, marble), part([rect(0, 0, 96, 96)], 6, 7, shade));
    out.push(part([oval(0, 0, 33, 33, 8, Math.PI / 8)], 7, 38, marble), part([oval(0, 0, 33.8, 33.8, 8, Math.PI / 8)], 38, 40, shade));
    const face = 33 * Math.cos(Math.PI / 8) + 0.2;
    for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4, big = i % 2 === 0, w = big ? 16 : 8;
        const x = Math.cos(a) * face, y = Math.sin(a) * face;
        out.push(part([rect(x, y, 0.8, w, a)], 9, big ? 34 : 30, shade));
        out.push(part([rect(x, y, 1, w * 0.68, a)], 9, big ? 28 : 24, '#d6ccb8'));
    }
    out.push(part([oval(0, 0, 17.5, 17.5, 32)], 40, 47, white), part([oval(0, 0, 18.2, 18.2, 32)], 47, 48, shade));
    [18, 20, 21.6, 22.4, 22.6, 22.2, 21.2, 19.8, 18, 15.8, 13.2, 10.4, 7.6, 5, 3, 1.6]
        .forEach((r, k) => out.push(part([oval(0, 0, r, r, 32)], 48 + k * 1.75, 48 + (k + 1) * 1.75, white)));
    out.push(part([oval(0, 0, 2.4, 2.4, 12)], 76, 77.5, shade), part([oval(0, 0, 0.8, 0.8, 8)], 77.5, 86, GOLD), part([oval(0, 0, 1.4, 1.4, 8)], 80, 81, GOLD));
    for (const [x, y] of [[21, 21], [21, -21], [-21, 21], [-21, -21]]) {
        out.push(part([oval(x, y, 6.2, 6.2, 8, Math.PI / 8)], 40, 41, shade));
        colonnade(out, x, y, 5, 5, 8, 41, 46, 0.5, marble);
        out.push(part([oval(x, y, 6.4, 6.4, 8, Math.PI / 8)], 46, 47, shade));
        dome(out, x, y, 47, 5.6, 6, white, 4, 16);
        out.push(part([oval(x, y, 0.4, 0.4, 6)], 53, 56, GOLD));
    }
    for (const [x, y] of [[43, 43], [43, -43], [-43, 43], [-43, -43]]) {
        out.push(part([oval(x, y, 3.6, 3.6, 12)], 6, 44, marble));
        for (const z of [17, 29, 41]) out.push(part([oval(x, y, 4.8, 4.8, 12)], z, z + 1, shade));
        colonnade(out, x, y, 3.2, 3.2, 6, 44, 48, 0.3, marble);
        out.push(part([oval(x, y, 4.2, 4.2, 12)], 48, 49, shade));
        dome(out, x, y, 49, 3.6, 4, white, 3, 12);
        out.push(part([oval(x, y, 0.3, 0.3, 6)], 53, 55, GOLD));
    }
    return out;
}

// Статуя Свободы: звёздный форт, постамент с лоджиями, складки одежды, корона, скрижаль и факел
function liberty() {
    const copper = '#7fbca8', copperD = '#6aa995', stone = '#d3c6aa';
    const out = [part([star(0, 0, 50, 11, 0.64)], 0, 7, '#cbbf9f'), part([star(0, 0, 50.8, 11, 0.64)], 7, 8, '#bdb08f')];
    boxes(out, 0, 0, [[28, 28, 8, 12], [24, 24, 12, 20], [19, 19, 20, 38], [21, 21, 38, 40], [17, 17, 40, 46], [18.5, 18.5, 46, 47]], stone);
    for (const [x, y, w, d] of [[9.6, 0, 0.6, 7], [-9.6, 0, 0.6, 7], [0, 9.6, 7, 0.6], [0, -9.6, 7, 0.6]]) out.push(part([rect(x, y, w, d)], 26, 34, '#b3a689'));
    [[6.8, 5.4, 47, 52], [6.2, 5, 52, 58], [5.8, 4.6, 58, 64], [5.2, 4.2, 64, 70], [4.6, 3.8, 70, 75], [3.8, 3.2, 75, 79], [3, 2.6, 79, 81.5]]
        .forEach(([rx, ry, a, b], i) => out.push(part([oval(i % 2 ? 0.3 : -0.3, 0, rx, ry, 16)], a, b, i % 2 ? copperD : copper)));
    out.push(part([oval(0, 0, 1.6, 1.6, 10)], 81.5, 82.5, copper), part([oval(0, 0, 2.4, 2.6, 12)], 82.5, 86.5, copper));
    for (let k = 0; k < 7; k++) {
        const a = -Math.PI / 2 + (k - 3) * 0.32;
        out.push(part([rect(Math.cos(a) * 3.4, Math.sin(a) * 3.4, 3.4, 0.5, a)], 86, 86.8, copperD));
    }
    out.push(part([rect(-4.4, 1, 1.4, 2.6)], 64, 72, copperD));
    out.push(part([rect(3.6, 0, 2.2, 2.2)], 70, 80, copper), part([rect(3.8, 0, 1.6, 1.6)], 80, 91, copper));
    out.push(part([oval(3.8, 0, 1, 1, 8)], 91, 93, copperD), part([oval(3.8, 0, 1.9, 1.9, 10)], 93, 94.5, GOLD));
    out.push(part([oval(3.8, 0, 1.3, 1.3, 8)], 94.5, 96.5, '#f2b15a'), part([oval(3.8, 0, 0.6, 0.6, 6)], 96.5, 97.5, '#f7d27a'));
    return out;
}

// Биг-Бен: башня с окнами и лопатками, четыре циферблата со стрелками, звонница с арками,
// шатёр со шпилями и кусок Вестминстерского дворца с башенками
function bigben() {
    const stone = '#d8c79f', lightS = '#e5d6b0', roof = '#6f7a86', gold = '#d9b25a', dark = '#3d434b';
    const out = [];
    striped(out, rect(0, -32, 22, 40), 0, 22, 5.5, '#d2c08f', '#bfaa77', 0.7);
    out.push(part([rect(0, -32, 18, 36)], 22, 26, roof));
    for (let y = -50; y <= -14; y += 6) for (const x of [-10.5, 10.5]) out.push(part([rect(x, y, 1.2, 1.2)], 22, 28, lightS));
    striped(out, rect(0, 0, 12, 12), 0, 55, 5, stone, '#c1ad83', 0.72);
    for (const [sx, sy] of CORNERS) out.push(part([rect(sx * 6, sy * 6, 1.4, 1.4)], 0, 68, lightS));
    out.push(part([rect(0, 0, 13.5, 13.5)], 55, 68, lightS));
    for (const [nx, ny] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const w = nx ? 0.4 : 8, d = ny ? 0.4 : 8;
        out.push(part([rect(nx * 6.95, ny * 6.95, w, d)], 57.5, 65.5, '#fbf8ef'));
        out.push(part([rect(nx * 7.2, ny * 7.2, nx ? 0.3 : 0.4, ny ? 0.3 : 0.4)], 61.2, 64.6, dark));
        out.push(part([rect(nx * 7.2, ny * 7.2, nx ? 0.3 : 2.6, ny ? 0.3 : 2.6)], 61.2, 61.6, dark));
    }
    out.push(part([rect(0, 0, 12.4, 12.4)], 68, 69, '#c3b086'), part([rect(0, 0, 9, 9)], 69, 75, '#a99573'));
    for (const [sx, sy] of CORNERS) out.push(part([rect(sx * 5.3, sy * 5.3, 1.8, 1.8)], 69, 75, stone));
    out.push(part([rect(0, 0, 12.4, 12.4)], 75, 76, '#c3b086'));
    boxes(out, 0, 0, [[10, 10, 76, 80], [8, 8, 80, 84], [6, 6, 84, 88], [4, 4, 88, 91], [2.4, 2.4, 91, 94]], roof);
    out.push(part([rect(0, 0, 0.8, 0.8)], 94, 96, gold));
    for (const [sx, sy] of CORNERS) out.push(part([rect(sx * 5, sy * 5, 1.2, 1.2)], 76, 82, roof), part([rect(sx * 5, sy * 5, 0.5, 0.5)], 82, 84, gold));
    return out;
}

// Стоунхендж: вал и ров, кольцо сарсенов с перемычками, подкова трилитов, голубые камни, камень-пятка
function stonehenge() {
    const stone = '#a9a59a', blue = '#8f97a0';
    const out = [part(ringOf(oval(0, 0, 50, 50, 40), oval(0, 0, 44, 44, 40)), 0, 1, GRASS), part(ringOf(oval(0, 0, 53, 53, 40), oval(0, 0, 50, 50, 40)), 0, 0.3, '#b8cfa8')];
    for (let k = 0; k < 30; k++) {
        if (k === 7 || k === 18 || k === 24) continue;
        const a = k / 30 * TAU;
        out.push(part([rect(Math.cos(a) * 16.5, Math.sin(a) * 16.5, 2.1, 1.1, a + Math.PI / 2)], 0, 4.1, stone));
    }
    out.push(part([arcRing(0, 0, 17.2, 15.8, 0, Math.PI * 1.3, 30)], 4.1, 4.9, stone));
    for (let k = 0; k < 22; k++) {
        if (k % 5 === 3) continue;
        const a = k / 22 * TAU;
        out.push(part([rect(Math.cos(a) * 11.5, Math.sin(a) * 11.5, 1, 0.6, a)], 0, 2, blue));
    }
    for (const a of [-0.9, -0.45, 0, 0.45, 0.9]) {
        const ang = a + Math.PI / 2, x = Math.cos(ang) * 9, y = Math.sin(ang) * 9;
        out.push(part([rect(x, y, 3.5, 1.4, ang + Math.PI / 2)], 0, 6.5, stone), part([rect(x, y, 4.2, 1.2, ang + Math.PI / 2)], 6.5, 7.3, stone));
    }
    for (let k = 0; k < 10; k++) {
        const a = Math.PI / 2 + (k - 4.5) * 0.3;
        out.push(part([rect(Math.cos(a) * 6, Math.sin(a) * 6, 0.8, 0.5, a)], 0, 1.8, blue));
    }
    out.push(part([rect(0, 2, 4.8, 1)], 0, 0.5, '#8d8a80'), part([rect(0, 38, 2.4, 2)], 0, 5, stone));
    return out;
}

// Христос-Искупитель: смотровая площадка, постамент с часовней, складки одежды, руки и голова
function christ() {
    const stone = '#ece9e2', shade = '#dcd8cf';
    const out = [part([oval(0, 0, 18, 12, 24)], 0, 1, '#cfc9bc')];
    out.push(part([rect(0, 0, 14, 14)], 1, 7, '#d5d0c4'), part([rect(0, -7.1, 3, 0.4)], 1, 4, '#8a7f6e'));
    out.push(part([rect(0, 0, 9.5, 9.5)], 7, 8, shade), part([rect(0, 0, 8, 8)], 8, 11, '#ded9ce'));
    [[4.2, 3.2, 11, 16], [3.9, 3, 16, 21], [3.6, 2.8, 21, 26], [3.4, 2.6, 26, 30], [3.1, 2.4, 30, 34]]
        .forEach(([rx, ry, a, b], i) => out.push(part([oval(0, i % 2 ? 0.2 : -0.2, rx, ry, 14)], a, b, i % 2 ? shade : stone)));
    out.push(part([rect(0, 0, 28, 2.4)], 31.2, 33.8, stone), part([rect(0, 0, 9, 2.8)], 30.6, 34.2, shade));
    for (const s of [-1, 1]) out.push(part([rect(s * 14.6, 0, 1.4, 1.6)], 31.4, 33.4, stone));
    out.push(part([oval(0, 0, 1.3, 1.3, 10)], 34, 35.5, stone), part([oval(0, 0, 1.7, 1.9, 12)], 35.5, 38.6, stone), part([oval(0, -0.4, 1.8, 1.4, 12)], 38.6, 39.6, shade));
    return out;
}

// Белый дом: этажи с окнами, балюстрада и трубы, полукруглый портик с колоннами,
// северный портик с фронтоном, колоннады к крыльям, фонтан, деревья, флаг
function whitehouse() {
    const white = '#f8f8f5', shade = '#e2e4e7', roof = '#d9dde3';
    const out = [part([rect(0, 0, 190, 130)], 0, 0.3, GRASS)];
    out.push(part([oval(0, -48, 9, 9, 24)], 0.3, 0.8, WATER), part(ringOf(oval(0, -48, 10, 10, 24), oval(0, -48, 9, 9, 24)), 0.3, 1.2, white));
    out.push(part([rect(0, 40, 8, 50)], 0.3, 0.4, PATH), part([oval(0, 46, 24, 10, 24)], 0.3, 0.4, PATH));
    striped(out, rect(0, 0, 52, 26), 0, 21, 6.5, white, shade, 0.74);
    out.push(part([rect(0, 0, 53, 27)], 20, 21, shade), part([rect(0, 0, 50, 24)], 21, 22.5, roof));
    out.push(part(ringOf(rect(0, 0, 52.6, 26.6), rect(0, 0, 51.4, 25.4)), 21, 22.4, white));
    for (const [x, y] of [[-20, 6], [-20, -6], [20, 6], [20, -6]]) out.push(part([rect(x, y, 2, 1.4)], 22.5, 25.5, white));
    out.push(part([arc(0, -13, 9.5, 7.5, Math.PI, TAU, 16)], 0, 1.2, shade));
    colonnade(out, 0, -13, 9, 7, 6, 1.2, 19, 0.55, white, Math.PI * 1.08, Math.PI * 1.92);
    out.push(part([arc(0, -13, 10, 8, Math.PI, TAU, 16)], 19, 21, white));
    colRow(out, -8, 18.5, 8, 18.5, 6, 1, 18, 0.6, white);
    out.push(part([rect(0, 17, 20, 6)], 18, 19.5, white), part([rect(0, 17, 14, 6)], 19.5, 21, white), part([rect(0, 17, 7, 6)], 21, 22, white));
    for (const s of [-1, 1]) {
        out.push(part([rect(s * 52, 2, 54, 6)], 0, 7, white), part([rect(s * 52, 0, 54, 10)], 7, 8, shade));
        colRow(out, s * 27, -3.5, s * 77, -3.5, 10, 0, 7, 0.4, white);
        striped(out, rect(s * 83, 0, 14, 24), 0, 12, 4, white, shade, 0.74);
        out.push(part([rect(s * 83, 0, 14.6, 24.6)], 12, 12.8, roof));
    }
    out.push(part([rect(0, 0, 0.3, 0.3)], 22.5, 30, '#9aa3ad'), part([rect(1.2, 0, 2, 0.1)], 28, 29.4, '#e5484d'));
    for (const [x, y] of [[-70, -45], [-50, -52], [60, -48], [75, -38], [-80, 40], [80, 42], [-60, 50], [55, 52]]) tree(out, x, y, 9, 4);
    return out;
}

// Капитолий: крылья с портиками, ступени, центральный портик с фронтоном, купол с колоннадой,
// окнами барабана, фонарём и статуей
function capitol() {
    const white = '#f5f4ef', shade = '#e0dfd8';
    const out = [];
    for (let i = 0; i < 5; i++) out.push(part([rect(0, -43 - i * 2.4, 40, 2.4)], 0, 4 - i * 0.8, shade));
    for (const x of [-80, 80]) {
        striped(out, rect(x, 0, 60, 75), 0, 22, 5.5, white, shade, 0.74);
        out.push(part([rect(x, 0, 61, 76)], 21, 22.5, shade));
        colRow(out, x - 14, -38.6, x + 14, -38.6, 8, 3, 20, 0.6, white);
        out.push(part([rect(x, -38.5, 32, 3)], 20, 22.5, white));
    }
    striped(out, rect(0, 0, 100, 70), 0, 25, 6, white, shade, 0.74);
    out.push(part([rect(0, 0, 101, 71)], 24, 25.5, shade), part([rect(0, -38, 40, 6)], 0, 4, shade));
    colRow(out, -16, -39.5, 16, -39.5, 8, 4, 21, 0.75, white);
    out.push(part([rect(0, -38, 40, 8)], 21, 23, white), part([rect(0, -38, 28, 8)], 23, 25, white), part([rect(0, -38, 14, 8)], 25, 26.5, white));
    out.push(part([oval(0, 0, 32, 32, 40)], 25.5, 27, shade), part([oval(0, 0, 28.5, 28.5, 36)], 27, 36, '#d8d7d0'));
    colonnade(out, 0, 0, 30.5, 30.5, 36, 27, 36, 0.7, white);
    out.push(part([oval(0, 0, 31.5, 31.5, 40)], 36, 38, white), part([oval(0, 0, 27, 27, 36)], 38, 46, white));
    for (let k = 0; k < 18; k++) {
        const a = k / 18 * TAU;
        out.push(part([rect(Math.cos(a) * 27, Math.sin(a) * 27, 1.6, 0.8, a + Math.PI / 2)], 40, 44, '#c4c3bc'));
    }
    dome(out, 0, 0, 46, 26.5, 30, white, 14, 36);
    out.push(part([oval(0, 0, 5.5, 5.5, 16)], 75, 76, shade));
    colonnade(out, 0, 0, 4.5, 4.5, 12, 76, 82, 0.35, white);
    out.push(part([oval(0, 0, 5.5, 5.5, 16)], 82, 83, shade), part([oval(0, 0, 3.5, 3.5, 16)], 83, 85, white), part([oval(0, 0, 1.2, 1.2, 8)], 85, 89, '#9a8e72'));
    return out;
}

// ======================= Современная архитектура =======================
// «Парус» оперы: ступени сужаются и сдвигаются — изогнутая раковина из плиток двух оттенков
function shell(out, cx, cy, h, w, d, base, dir, color, color2 = color) {
    const n = 16;
    for (let k = 0; k < n; k++) {
        const t = k / n;
        out.push(part([rect(cx + dir * t * d * 0.6, cy, d * (1 - t * 0.85), w * Math.sqrt(1 - t * t))], base + h * k / n, base + h * (k + 1) / n, k % 2 ? color2 : color));
    }
}

// Сиднейский оперный театр: подиум с лестницей, два зала-«паруса», стеклянные стены, ресторан
function opera() {
    const white = '#fbfbf8', tile = '#ece9e1', glass = '#a9b6c4';
    const out = [part([rect(11, 0, 163, 115)], 0, 8, '#d8cbb3'), part(ringOf(rect(11, 0, 166, 118), rect(11, 0, 163, 115)), 0, 9, '#cbbd9f')];
    for (let i = 0; i < 6; i++) out.push(part([rect(-72 - i * 3.4, 0, 3.4, 80)], 0, 8 - i * 1.3, '#e3d7c1'));
    [[-55, 59], [-25, 50], [2, 38], [26, 24]].forEach(([x, h]) => shell(out, x, -22, h, 34, 26, 8, -1, white, tile));
    [[-50, 48], [-22, 40], [3, 30], [24, 18]].forEach(([x, h]) => shell(out, x, 26, h, 28, 22, 8, -1, white, tile));
    out.push(part([rect(-69.5, -22, 2, 30)], 8, 30, glass), part([rect(-62.5, 26, 2, 24)], 8, 24, glass));
    shell(out, 70, 0, 16, 16, 14, 8, 1, white, tile);
    return out;
}

// Марина Бэй Сэндс: подиум с волнистой крышей, три башни на двух «ногах», парк-«корабль» с бассейном и деревьями
function mbs() {
    const out = [part([rect(0, -60, 300, 60)], 0, 12, '#e4e7eb')];
    for (let i = 0; i < 6; i++) out.push(part([rect(-125 + i * 50, -60, 46, 56)], 12, 15 + (i % 2) * 3, '#d9dee4'));
    for (const x of [-110, 0, 110]) {
        for (let k = 0; k < 10; k++) {
            const z0 = k * 19.4, spread = (1 - k / 10) * 2;
            out.push(part([rect(x, 4 + spread, 36, 12)], z0, z0 + 19.4, k % 2 ? '#cdd6e0' : '#c0cbd8'));
            out.push(part([rect(x, -8 - spread, 36, 12)], z0, z0 + 19.4, k % 2 ? '#c0cbd8' : '#b4c0ce'));
        }
    }
    out.push(part([rect(20, -2, 340, 38)], 194, 199, '#eef1f5'), part([rect(20, -2, 342, 39)], 199, 200, '#dfe5ec'));
    out.push(part([rect(-40, -10, 150, 9)], 200, 200.8, '#7cc4ee'));
    for (let x = 50; x <= 170; x += 14) tree(out, x, 8, 5, 2, '#7fbf7a', 200);
    return out;
}

// Атомиум: девять шаров с окнами-поясами, трубы между ними, опоры и павильоны внизу
function atomium() {
    const out = [], ballColor = '#d6dce3', tube = '#b9c2cc';
    const L = 46, D = L * Math.sqrt(3), zc = 58, R = L * Math.sqrt(2 / 3);
    const top = [0, 0, zc + D / 2], bottom = [0, 0, zc - D / 2], center = [0, 0, zc];
    const upper = [], lower = [];
    for (let j = 0; j < 3; j++) {
        const a = Math.PI / 3 + j * TAU / 3, b = j * TAU / 3;
        upper.push([Math.cos(a) * R, Math.sin(a) * R, zc + D / 6]);
        lower.push([Math.cos(b) * R, Math.sin(b) * R, zc - D / 6]);
    }
    const edges = [];
    for (let j = 0; j < 3; j++) edges.push([top, upper[j]], [bottom, lower[j]], [upper[j], lower[j]], [upper[j], lower[(j + 1) % 3]]);
    for (const p of [top, bottom, ...upper, ...lower]) edges.push([center, p]);
    for (const [p, q] of edges) {
        const len = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]), n = Math.ceil(len / 2.4);
        for (let i = 0; i < n; i++) {
            const t = (i + 0.5) / n;
            if (t * len < 8.5 || (1 - t) * len < 8.5) continue;
            const x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t, z = p[2] + (q[2] - p[2]) * t;
            out.push(part([rect(x, y, 2.2, 2.2)], z - 1.1, z + 1.1, tube));
        }
    }
    for (const p of [top, bottom, center, ...upper, ...lower]) {
        ball(out, p[0], p[1], p[2], 9, ballColor, 10, 24);
        out.push(part(ringOf(oval(p[0], p[1], 9.15, 9.15, 24), oval(p[0], p[1], 8.4, 8.4, 24)), p[2] - 0.7, p[2] + 0.7, '#7f8b99'));
    }
    out.push(part([oval(0, 0, 2.5, 2.5, 12)], 0, bottom[2] - 8, tube));
    for (const p of lower) out.push(part([rect(p[0], p[1], 2, 2)], 0, p[2] - 8.5, tube));
    for (let j = 0; j < 3; j++) {
        const a = Math.PI / 3 + j * TAU / 3;
        out.push(part([rect(Math.cos(a) * 34, Math.sin(a) * 34, 12, 7, a)], 0, 4, '#eef1f4'));
    }
    return out;
}

// Сфера в Лас-Вегасе: огромный шар-экран с плавным переливом цветов и вход внизу
function sphereLV() {
    const out = [], R = 78.5, zc = 112 - R, n = 30;
    const stops = ['#4f8cff', '#8b6cf0', '#c552c8', '#e84393', '#f2795f', '#f2b15a'];
    for (let k = 0; k < n; k++) {
        const z0 = 112 * k / n, z1 = 112 * (k + 1) / n, zm = (z0 + z1) / 2;
        const r = Math.sqrt(Math.max(0, R * R - (zm - zc) ** 2));
        const t = k / (n - 1) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(t));
        out.push(part([oval(0, 0, r, r, 48)], z0, z1, mix(stops[i], stops[i + 1], t - i)));
    }
    out.push(part([rect(0, -74, 40, 10)], 0, 8, '#cfe0f2'), part([rect(0, -75, 44, 12)], 8, 9, '#e4e8ee'));
    return out;
}

// Лувр Абу-Даби: залы-кубики у воды, опоры и многослойный купол-«кружево»
function louvre() {
    const out = [part([oval(0, 0, 100, 100, 40)], 0, 0.3, WATER), part(ringOf(oval(0, 0, 70, 70, 40), oval(0, 0, 64, 64, 40)), 0.3, 0.8, PATH)];
    [[-30, -20, 30, 24, 12], [10, -30, 26, 20, 15], [30, 10, 22, 30, 11], [-20, 25, 34, 18, 14], [0, 0, 16, 16, 18], [-45, 5, 14, 22, 10],
     [45, -15, 16, 16, 9], [15, 35, 18, 12, 10], [-8, -48, 20, 12, 8], [48, 30, 12, 14, 12], [-48, -32, 14, 12, 9], [25, -50, 12, 10, 7]]
        .forEach(([x, y, w, h, z]) => out.push(part([rect(x, y, w, h)], 0.3, z, '#f7f6f1'), part([rect(x, y, w + 0.6, h + 0.6)], z, z + 0.6, '#e6e4dc')));
    for (const [x, y] of [[45, 45], [-45, 45], [45, -45], [-45, -45]]) out.push(part([rect(x, y, 4, 4)], 0, 30, '#d6dbe0'));
    [[92, 70, 30, 31.2], [86, 52, 31.6, 32.8], [78, 34, 33.2, 34.4], [68, 0, 34.8, 36], [55, 20, 36.4, 37.6], [40, 0, 38, 38.8]]
        .forEach(([ro, ri, a, b], i) => out.push(part(ri ? ringOf(oval(0, 0, ro, ro, 48), oval(0, 0, ri, ri, 48)) : [oval(0, 0, ro, ro, 48)], a, b, i % 2 ? '#c7ced6' : '#d6dce3')));
    for (let k = 0; k < 16; k++) out.push(part([arcRing(0, 0, 76, 62, k / 16 * TAU, (k + 0.6) / 16 * TAU, 3)], 37.6, 38.4, '#bcc4cd'));
    return out;
}

// Музей будущего (Дубай): серебряное кольцо с узором окон на зелёном холме с деревьями
function future() {
    const out = [part([oval(0, 0, 46, 28, 32)], 0, 6, '#b9d8a6')];
    for (const [x, y] of [[-40, 8], [-36, -12], [38, 10], [40, -8], [-20, 22], [22, -22]]) tree(out, x, y, 6, 2.4, '#7fbf7a', 6);
    const Ro = 38, Ho = 38, Ri = 22, Hi = 20, zc = 44, n = 26;
    for (let k = 0; k < n; k++) {
        const z0 = zc - Ho + 2 * Ho * k / n, z1 = z0 + 2 * Ho / n, dz = (z0 + z1) / 2 - zc;
        const xo = Ro * Math.sqrt(Math.max(0, 1 - (dz / Ho) ** 2));
        const xi = Math.abs(dz) < Hi ? Ri * Math.sqrt(1 - (dz / Hi) ** 2) : 0;
        const color = k % 2 ? '#dfe3e8' : '#ced5dd';
        const slab = (cx, w) => {
            out.push(part([rect(cx, 0, w, 24)], z0, z1, color));
            if (k % 3 === 1) out.push(part([rect(cx, 0, w * 0.6, 24.4)], z0 + 0.4, z1 - 0.4, '#7d8794'));   // окна-«надписи»
        };
        if (xi > 1) { slab(-(xo + xi) / 2, xo - xi); slab((xo + xi) / 2, xo - xi); }
        else if (xo > 1) slab(0, 2 * xo);
    }
    return out;
}

// The Vessel (Нью-Йорк): медная «сота» из лестниц — сегменты ярусов сдвинуты в шахматном порядке
function vessel() {
    const out = [part([oval(0, 0, 40, 40, 32)], 0, 0.3, '#d9dde3')];
    for (const [x, y] of [[-32, 10], [-25, -25], [30, -18], [28, 22], [0, 34], [-10, -34]]) tree(out, x, y, 7, 2.6, '#86c27f', 0.3);
    const levels = 16, seg = 12;
    for (let k = 0; k < levels; k++) {
        const r = 8 + 15 * (k + 0.5) / levels, z0 = 46 * k / levels, dz = 46 / levels;
        for (let s = 0; s < seg; s++) {
            const a0 = (s + (k % 2) * 0.5) / seg * TAU, a1 = a0 + TAU / seg * 0.82;
            out.push(part([arcRing(0, 0, r, r - 2.4, a0, a1, 3)], z0, z0 + dz * 1.15, s % 2 ? '#c98552' : '#b9733f'));
        }
    }
    out.push(part(ringOf(oval(0, 0, 23.4, 23.4, 36), oval(0, 0, 21.6, 21.6, 36)), 45, 46.6, '#a86538'));
    return out;
}

// ======================= Торговля и развлечения =======================
// Дубай Молл: фасад с рёбрами, атриум, аквариум, парковки и озеро с поющими фонтанами
function dubaimall() {
    const out = [part([oval(0, -175, 110, 45, 32)], 0, 0.4, WATER)];
    for (let k = 0; k < 31; k++) {
        const t = k / 30, a = Math.PI * (1.15 + 0.7 * t);
        const h = 6 + 14 * Math.abs(Math.sin(t * Math.PI * 3));
        out.push(part([rect(Math.cos(a) * 80, -175 + Math.sin(a) * 30 + 30, 0.6, 0.6)], 0.4, h, '#ffffff'));
    }
    out.push(part([rect(0, 0, 350, 220)], 0, 26, '#ece3d5'), part([rect(0, 0, 351, 221)], 26, 27, '#d9cdb9'));
    for (let x = -168; x <= 168; x += 12) out.push(part([rect(x, -110.6, 1.2, 1.2)], 0, 26, '#ddd0bc'));
    out.push(part([rect(0, 0, 130, 90)], 27, 36, '#cfe0f2'));
    for (let x = -60; x <= 60; x += 12) out.push(part([rect(x, 0, 0.8, 91)], 36, 36.6, '#a9c3dd'));
    out.push(part([rect(-140, 0, 40, 160)], 27, 31, '#e3d8c6'), part([rect(110, 60, 30, 40)], 27, 35, '#7cc4ee'));
    out.push(part([rect(0, -112, 40, 6)], 0, 10, '#b9d2ea'), part([rect(0, -114, 48, 10)], 10, 11, '#d9cdb9'));
    for (const x of [-120, 120]) striped(out, rect(x, 140, 90, 60), 0, 18, 3.6, '#d9dde3', '#b8bfc8', 0.7);
    for (let x = -160; x <= 160; x += 32) tree(out, x, -128, 7, 2.8);
    return out;
}

// Хан Шатыр (Астана): огромный шатёр с тросами-«меридианами», мачта и входы
function khanshatyr() {
    const out = [], n = 36;
    const r = t => 98 * Math.pow(1 - t, 1.7) + 1.5;
    for (let k = 0; k < n; k++) {
        const s = r((k + 0.5) / n);
        out.push(part([oval(0, 0, s, s * 0.96, 40)], 150 * k / n, 150 * (k + 1) / n, k % 2 ? '#e8e2d5' : '#efeadf'));
    }
    for (let j = 0; j < 8; j++) {
        const a = j / 8 * TAU;
        for (let k = 0; k < 18; k++) {
            const t = (k + 0.5) / 18, s = r(t) + 0.4, z = 150 * t;
            out.push(part([rect(Math.cos(a) * s, Math.sin(a) * s * 0.96, 1.2, 1.2)], z - 0.6, z + 0.6, '#c9c2b2'));
        }
    }
    for (let j = 0; j < 4; j++) {
        const a = j / 4 * TAU + Math.PI / 4;
        out.push(part([rect(Math.cos(a) * 100, Math.sin(a) * 96, 14, 8, a)], 0, 7, '#cfe0f2'));
    }
    out.push(part([oval(0, 0, 1, 1, 8)], 150, 158, '#c9d0d8'), part([oval(0, 0, 2, 2, 10)], 152, 153, '#c9d0d8'));
    return out;
}

// Диснейленд: замок с башнями, шпилями и зубцами, ров с мостом, колесо обозрения,
// американские горки, карусель, павильоны и деревья
function disney() {
    const wall = '#f6eef5', roof = '#5b8def', roof2 = '#7aa3f2', pink = '#f3c7de';
    const out = [part([oval(0, 0, 130, 130, 48)], 0, 0.3, '#c8e6bd'), part(ringOf(oval(0, 0, 112, 112, 48), oval(0, 0, 106, 106, 48)), 0.3, 0.4, PATH)];
    out.push(part(ringOf(oval(0, 0, 40, 40, 32), oval(0, 0, 34, 34, 32)), 0.3, 0.6, WATER), part([rect(0, -37, 8, 8)], 0.6, 1.4, '#d9cdb9'));
    out.push(part([rect(0, 0, 46, 34)], 0, 16, wall), part([rect(0, -17.2, 6, 0.6)], 0, 7, '#6a5a6a'));
    for (let x = -22; x <= 22; x += 3) out.push(part([rect(x, -17, 1.4, 1.4)], 16, 17.4, wall), part([rect(x, 17, 1.4, 1.4)], 16, 17.4, wall));
    for (let y = -14; y <= 14; y += 3) out.push(part([rect(-23, y, 1.4, 1.4)], 16, 17.4, wall), part([rect(23, y, 1.4, 1.4)], 16, 17.4, wall));
    out.push(part([rect(0, 0, 22, 18)], 16, 30, pink), part([rect(0, 0, 24, 20)], 30, 31, wall));
    for (const [x, y, r, h] of [[-20, -14, 4, 26], [20, -14, 4, 26], [-20, 14, 4, 30], [20, 14, 4, 30], [0, 0, 6, 40], [-8, 6, 3, 36], [9, -5, 3, 34], [-12, -9, 2, 22], [12, 9, 2, 24], [5, 10, 2.2, 32]]) {
        out.push(part([oval(x, y, r, r, 14)], 0, h, wall), part([oval(x, y, r + 0.4, r + 0.4, 14)], h - 1, h, pink));
        cone(out, x, y, h, r * 1.15, r * 3, roof, 6, 14, roof2);
        out.push(part([oval(x, y, 0.3, 0.3, 6)], h + r * 3, h + r * 3 + 2, GOLD));
    }
    // колесо обозрения: обод из кубиков в вертикальной плоскости, спицы, кабинки, опоры
    const wx = 75, wy = -55, wz = 28, WR = 22;
    for (let k = 0; k < 40; k++) {
        const t = k / 40 * TAU, z = wz + Math.sin(t) * WR;
        out.push(part([rect(wx + Math.cos(t) * WR, wy, 1.2, 1.2)], z - 0.6, z + 0.6, '#e5484d'));
        if (k % 4 === 0) out.push(part([rect(wx + Math.cos(t) * (WR + 1.6), wy, 2.2, 2.2)], z - 2.6, z - 0.4, ['#f2b15a', '#4f8cff', '#2fb67c', '#e84393'][k / 4 % 4]));
    }
    for (let k = 0; k < 8; k++) {
        const t = k / 8 * TAU;
        beam(out, [wx, wy, wz], [wx + Math.cos(t) * WR, wy, wz + Math.sin(t) * WR], 0.6, '#d9dde3');
    }
    for (const s of [-1, 1]) beam(out, [wx + s * 9, wy, 0], [wx, wy, wz], 1, '#c9d0d8');
    // американские горки: трасса волной вокруг парка, опоры
    for (let k = 0; k < 120; k++) {
        const t = k / 120 * TAU, rr = 92 + 6 * Math.sin(3 * t), z = 4 + 14 * (0.5 + 0.5 * Math.sin(2 * t + 1));
        const x = Math.cos(t) * rr, y = Math.sin(t) * rr;
        if (x > 55 && y < -30) continue;   // здесь колесо обозрения
        out.push(part([rect(x, y, 1.8, 1.8, t)], z - 0.5, z + 0.5, '#e5484d'));
        if (k % 6 === 0) out.push(part([rect(x, y, 0.5, 0.5)], 0, z - 0.5, '#c9d0d8'));
    }
    // карусель
    out.push(part([oval(-70, 50, 7, 7, 20)], 0, 4, '#ffffff'));
    cone(out, -70, 50, 4, 8, 5, '#e5484d', 5, 20, '#ffffff');
    ['#e5484d', '#f2b15a', '#2fb67c', '#8b5cf6', '#00a8c6', '#e84393'].forEach((c, i) => {
        const a = i / 6 * TAU + 0.4;
        out.push(part([rect(Math.cos(a) * 70, Math.sin(a) * 70, 22, 14, a)], 0.3, 8 + (i % 3) * 4, c), part([rect(Math.cos(a) * 70, Math.sin(a) * 70, 23, 15, a)], 8 + (i % 3) * 4, 9 + (i % 3) * 4, '#ffffff'));
    });
    for (let k = 0; k < 12; k++) {
        const a = k / 12 * TAU + 0.15;
        tree(out, Math.cos(a) * 52, Math.sin(a) * 52, 8, 3);
    }
    return out;
}

// ======================= Алматы =======================
// Главные здания города — в цвете. Цвета взяты с фотографий и из OpenStreetMap
// (там у многих домов Алматы записан цвет фасада), размеры — по карте.
// Эти здания уже стоят на своих местах (landmarks.js), а в креативе
// их можно поставить ещё раз где угодно.

// Повернуть точку (dx, dy) вокруг (x, y) на угол r
const turn = (x, y, dx, dy, r) => [x + dx * Math.cos(r) - dy * Math.sin(r), y + dx * Math.sin(r) + dy * Math.cos(r)];

// Как striped, но для фигуры с дыркой (rings — внешний контур и двор)
function bands(out, rings, z0, z1, step, colorA, colorB, ratio = 0.72) {
    for (let z = z0; z < z1 - 0.01; z += step) {
        const zm = Math.min(z1, z + step * ratio), ze = Math.min(z1, z + step);
        out.push(part(rings, z, zm, colorA));
        if (ze > zm + 0.01) out.push(part(rings, zm, ze, colorB));
    }
}

// Луковичная главка: расширяется, потом сужается к острию
const onion = (out, cx, cy, base, r, h, color, color2 = color, sides = 16) =>
    stack(out, cx, cy, base, h, 9, t => r * (t < 0.4 ? 1 + 0.3 * Math.sin(t / 0.4 * Math.PI / 2) : 1.3 * Math.pow(1 - (t - 0.4) / 0.6, 1.2)), color, sides, color2);

// Крест над главкой
function cross(out, x, y, z, s = 1, color = GOLD) {
    out.push(part([rect(x, y, 0.35 * s, 0.35 * s)], z, z + 3.2 * s, color), part([rect(x, y, 1.6 * s, 0.3 * s)], z + 2 * s, z + 2.35 * s, color));
}

// Трос, провод, длинная пологая балка: плоские кусочки по 6 м (кубиков было бы слишком много)
function wire(out, p, q, w, color) {
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.ceil(L / 6)), ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
    for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, z = p[2] + (q[2] - p[2]) * t, dz = Math.max(w, Math.abs(q[2] - p[2]) / n);
        out.push(part([rect(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, L / n + 0.2, w, ang)], Math.max(0, z - dz / 2), z + dz / 2, color));
    }
}

// Пассажирский поезд вдоль x: вагоны с полосой окон
function train(out, x0, y, cars, body = '#2f6fb0', stripe = '#f4f6f8') {
    for (let k = 0; k < cars; k++) {
        const x = x0 + k * 25.5;
        out.push(part([rect(x, y, 24.6, 3.2)], 0.7, 4.3, body), part([rect(x, y, 24.8, 3.3)], 2.5, 3.3, stripe), part([rect(x, y, 23.6, 2.6)], 4.3, 4.7, '#c9d0d8'));
    }
}

// Перрон с навесом и пути с рельсами вдоль x
function platforms(out, y0, n, len, roof) {
    for (let k = 0; k < n; k++) {
        const y = y0 + k * 15;
        out.push(part([rect(0, y, len, 6)], 0.3, 1.2, '#d9d5cc'), part([rect(0, y, len - 20, 7.5)], 5.2, 5.8, roof));
        for (let x = -len / 2 + 18; x < len / 2 - 10; x += 16) out.push(part([rect(x, y, 0.5, 0.5)], 1.2, 5.2, '#aab3bd'));
        for (const s of [-1, 1]) out.push(part([rect(0, y + 7.5 + s * 0.75, len + 20, 0.15)], 0.3, 0.55, '#8d8a85'));
    }
}

// Самолёт с ливреей Air Astana: белый корпус, бордовый киль, золотая полоска
function plane(out, x, y, ang) {
    const at = (u, v) => turn(x, y, u, v, ang), burg = '#7b2236';
    out.push(part([rect(...at(0, 0), 34, 4, ang)], 2.2, 6.2, '#f7f8fa'), part([rect(...at(0, 0), 30, 4.1, ang)], 4.6, 5.0, '#5c6c7e'));
    out.push(part([rect(...at(0, 0), 34, 4.1, ang)], 3.2, 3.5, '#d6b25e'));
    out.push(part([rect(...at(18.5, 0), 3, 3, ang)], 2.8, 5.6, '#f7f8fa'), part([rect(...at(20.4, 0), 1.2, 1.8, ang)], 3.4, 4.8, '#f7f8fa'));
    out.push(part([rect(...at(-18.5, 0), 3, 2.6, ang)], 3.8, 6.2, '#f7f8fa'));
    out.push(part([rect(...at(1, 0), 5, 34, ang)], 3.6, 4.2, '#e8ebef'));
    for (const v of [-7, 7]) out.push(part([oval(...at(3.5, v), 1.3, 1.3, 10)], 2.0, 3.8, '#c9d0d8'));
    out.push(part([rect(...at(-16, 0), 5, 0.5, ang)], 6.2, 12, burg), part([rect(...at(-17, 0), 3, 12, ang)], 6.4, 6.9, '#f7f8fa'));
}

// Центр контура (среднее точек)
const mid = ring => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];

// Выпуклая оболочка точек — плавный контур вокруг зубчатого
function hull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (const q of p.reverse()) { while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
}

// n точек через равные расстояния по замкнутому контуру: [x, y, направление касательной]
function along(ring, n) {
    const seg = ring.map((p, i) => { const q = ring[(i + 1) % ring.length]; return [p, q, Math.hypot(q[0] - p[0], q[1] - p[1])]; });
    const L = seg.reduce((s, x) => s + x[2], 0), out = [];
    let i = 0, acc = 0;
    for (let k = 0; k < n; k++) {
        const d = (k + 0.5) * L / n;
        while (i < seg.length - 1 && acc + seg[i][2] < d) acc += seg[i++][2];
        const [p, q, l] = seg[i], t = (d - acc) / (l || 1);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, Math.atan2(q[1] - p[1], q[0] - p[0])]);
    }
    return out;
}

// Гостиница «Казахстан» (1977) — по настоящему плану из OpenStreetMap (78 частей).
// Башня — сплюснутый овал: длинные стены «пилой» из золотых рёбер и стеклянных эркеров,
// на торцах бежевые стены со стеклянной щелью, наверху золотые пояса и корона из зубцов —
// та, что на купюре 5000 ₸. Подиум с золотым карнизом, круглыми барабанами и ротондой-«зонтиком».
// Части: [низ, верх, цвет, контур в метрах]; цвет: g — золото, w — окна, b — бежевый камень,
// d — тёмный пояс, k — тёмно-серый, n — тёмно-зелёный, c — ядро башни
const KAZ = [
    [0, 2, 'b', [[-44, 4], [-45, 4], [-46, 4.5], [-46.5, 5], [-47.5, 5.5], [-48, 6], [-49, 7], [-49.5, 8], [-50.5, 7], [-50, 6.5], [-49.5, 5.5], [-49, 5], [-49, 4], [-49, 3], [-49, 2.5], [-49.5, 1.5], [-50, 0.5], [-50.5, -0.5], [-49.5, -1.5], [-49, -0.5], [-48, 0.5], [-47, 1], [-46, 2], [-45, 2], [-44, 2.5], [-43, 3], [-41.5, 3], [-41.5, 4], [-43, 4]]],
    [0, 3, 'n', [[-34.5, 13.5], [-35, 15.5], [-35, 17.5], [-35, 18.5], [-34, 20.5], [-32, 24.5], [-30.5, 25.5], [-29, 26], [-27, 26], [-25.5, 25.5], [-24.5, 25], [-24, 23.5], [-23.5, 22], [-23, 15.5], [-33, 14.5], [-33.5, 14.5], [-34, 14]]],
    [0, 3, 'b', [[23, 34], [22, 45.5], [29, 46], [29, 47.5], [43.5, 48.5], [43.5, 45.5], [44, 41], [44, 37.5], [44, 35], [43, 33], [41.5, 31], [39.5, 29.5], [39, 35]]],
    [0, 4, 'k', [[-46, -61], [-36.5, -60], [-34.5, -80], [-39, -80.5], [-44, -81]]],
    [0, 4, 'k', [[-22.5, -97], [-27.5, -53.5], [-25.5, -53.5], [-23.5, -53.5], [0.5, -51.5], [1, -53.5], [1, -55], [1, -58], [-19.5, -60], [-16, -94], [-16, -96.5]]],
    [0, 4, 'b', [[-30, -18.5], [-32, -18.5], [-32.5, -19], [-33, -19], [-33, -19.5], [-33, -20], [-31, -39.5], [-38.5, -40.5], [-38, -45], [-36.5, -60], [-34.5, -80], [-32.5, -98], [-27.5, -97.5], [-22.5, -97], [-27.5, -53.5], [-30, -25.5], [-27, -25.5], [-28, -23.5]]],
    [0, 4, 'b', [[44, -28], [45.5, -28], [46, -36], [46.5, -39], [47, -47], [51, -89], [46, -89.5], [41.5, -90], [38, -52.5], [37.5, -48.5], [37.5, -44.5], [36, -28.5], [40, -28]]],
    [0, 4, 'k', [[41.5, 8.5], [43, -10.5], [49, -10.5], [47, 9]]],
    [0, 4, 'k', [[46, -36], [45.5, -28], [44, -28], [43.5, -19], [49.5, -18.5], [51, -35.5]]],
    [0, 8, 'b', [[-27.5, -53.5], [-30, -25.5], [-27, -25.5], [-6, -23], [-4.5, -26], [-1.5, -24], [0, -23.5], [0, -23], [0, -22.5], [1.5, -22.5], [1.5, -24], [2, -24.5], [2.5, -24.5], [3, -24.5], [3.5, -24], [3.5, -22], [4.5, -22], [5, -22.5], [5.5, -23], [6.5, -23.5], [10.5, -25], [11.5, -21.5], [12, -18.5], [14.5, -16.5], [13.5, -14.5], [15.5, -12.5], [14, -10.5], [16, -9], [14.5, -7.5], [16.5, -5.5], [14.5, -3.5], [16, -1.5], [14, 0], [16, 2], [14, 4], [15, 6], [13, 8], [14, 9.5], [12, 11.5], [13, 13], [10.5, 15], [11.5, 16.5], [23.5, 17.5], [22.5, 26.5], [26.5, 35.5], [31, 35.5], [31.5, 27], [32, 22], [30, 21.5], [30.5, 14], [33.5, -28.5], [36, -28.5], [37.5, -44.5], [37.5, -48.5], [34, -49], [4.5, -47.5], [-23.5, -53.5], [-25.5, -53.5]]],
    [0, 8, 'w', [[-23.5, -53.5], [0.5, -51.5], [5.5, -51], [34, -49], [4.5, -47.5]]],
    [0, 8, 'w', [[-27, -25.5], [-28, -23.5], [-30, -18.5], [-32, -13.5], [-33, -9], [-34, -5.5], [-34.5, -1.5], [-34.5, 2], [-34.5, 5.5], [-34.5, 8.5], [-34, 12], [-29.5, 12]]],
    [0, 8, 'b', [[-34, 12], [-34.5, 12.5], [-34.5, 13], [-34.5, 13.5], [-34, 14], [-33.5, 14.5], [-33, 14.5], [-23, 15.5], [-19.5, 15.5], [-11.5, 16], [-13, 14.5], [-12, 13], [-14, 11.5], [-12.5, 9.5], [-14, 7.5], [-12.5, 6], [-14.5, 4], [-12.5, 2], [-14.5, 0], [-12.5, -2], [-14.5, -3.5], [-12.5, -5.5], [-13.5, -7.5], [-11, -9.5], [-12.5, -11], [-10.5, -13], [-11.5, -15], [-9.5, -16], [-10.5, -18], [-7.5, -19.5], [-6, -23], [-27, -25.5], [-29.5, 12]]],
    [0, 9, 'k', [[36, -28.5], [40, -28], [44, -28], [43.5, -19], [43, -14.5], [43, -12.5], [43, -10.5], [41.5, 8.5], [41, 10.5], [41, 15], [30.5, 14], [33.5, -28.5]]],
    [0, 13, 'g', [[25.5, -25], [26, -24.5], [26.5, -24], [26.5, -23], [26.5, -22], [26, -21.5], [25.5, -21], [24.5, -20.5], [23.5, -20.5], [23, -20.5], [22, -21], [21.5, -22], [21, -22.5], [21, -23.5], [21.5, -24.5], [22, -25], [23, -25.5], [24, -26], [24.5, -25.5]]],
    [0, 13, 'g', [[34.5, -39.5], [35.5, -38.5], [35.5, -38], [36, -37], [35.5, -36], [35, -35.5], [34.5, -35], [34, -34.5], [33, -34.5], [32, -34.5], [31.5, -35], [30.5, -36], [30.5, -36.5], [30.5, -37.5], [30.5, -38.5], [31.5, -39], [32, -39.5], [33, -40], [34, -39.5]]],
    [0, 13, 'g', [[-23, -45], [-22.5, -44.5], [-22, -43.5], [-22, -43], [-22, -42], [-22.5, -41], [-23.5, -40.5], [-24, -40], [-25, -40], [-26, -40.5], [-26.5, -41], [-27, -41.5], [-27.5, -42.5], [-27.5, -43.5], [-27, -44], [-26.5, -45], [-25.5, -45.5], [-25, -45.5], [-24, -45.5]]],
    [0, 13, 'g', [[-18, -30.5], [-17.5, -30], [-17, -29.5], [-17, -28.5], [-17, -27.5], [-17.5, -27], [-18, -26.5], [-19, -26], [-19.5, -26], [-20.5, -26], [-21.5, -26.5], [-22, -27.5], [-22, -28], [-22, -29], [-22, -30], [-21, -30.5], [-20.5, -31], [-19.5, -31.5], [-18.5, -31]]],
    [0, 13, 'g', [[9, -42], [10.5, -40], [11.5, -38], [11.5, -35.5], [11, -33], [10, -30.5], [8, -29], [5.5, -28], [3, -28], [0, -28.5], [-2, -30], [-3.5, -32.5], [-4.5, -35], [-4, -38], [-3, -40.5], [-1, -42.5], [1.5, -43.5], [4, -44], [6.5, -43.5]]],
    [0, 13, 'g', [[26, 3], [26.5, 3.5], [27, 4.5], [27, 5], [27, 6], [26.5, 7], [26, 7.5], [25, 7.5], [24, 8], [23, 7.5], [22.5, 7], [22, 6.5], [21.5, 5.5], [21.5, 4.5], [22, 3.5], [22.5, 3], [23.5, 2.5], [24.5, 2.5], [25, 2.5]]],
    [0, 13, 'g', [[-28.5, 8], [-28, 9], [-27.5, 9.5], [-27.5, 10.5], [-28, 11], [-28, 12], [-29, 12.5], [-29.5, 13], [-30.5, 13], [-31.5, 13], [-32, 12.5], [-32.5, 11.5], [-33, 10.5], [-33, 10], [-32.5, 9], [-32, 8], [-31, 8], [-30.5, 7.5], [-29.5, 8]]],
    [0, 13, 'g', [[32, -8.5], [32.5, -8], [33, -7], [33, -6.5], [33, -5.5], [32.5, -4.5], [32, -4], [31, -3.5], [30.5, -3.5], [29.5, -4], [28.5, -4.5], [28, -5], [27.5, -6], [27.5, -7], [28, -7.5], [28.5, -8.5], [29.5, -9], [30.5, -9], [31.5, -9]]],
    [0, 84, 'g', [[-12, 13], [-14, 11.5], [-12.5, 11.5], [-10.5, 11.5], [-10.5, 13]]],
    [0, 84, 'g', [[-12.5, 9.5], [-14, 7.5], [-13, 7.5], [-10, 8], [-10.5, 9.5], [-11, 9.5]]],
    [0, 84, 'g', [[-12.5, 6], [-14.5, 4], [-13, 4], [-10, 4.5], [-10, 6], [-11.5, 6]]],
    [0, 84, 'g', [[-12.5, 2], [-14.5, 0], [-13, 0], [-9.5, 0.5], [-9.5, 2], [-11, 2]]],
    [0, 84, 'g', [[-12.5, -2], [-14.5, -3.5], [-13, -3.5], [-9, -3.5], [-9.5, -1.5], [-11, -2]]],
    [0, 84, 'g', [[-12.5, -5.5], [-13.5, -7.5], [-12.5, -7.5], [-9, -7], [-9, -5.5], [-11, -5.5]]],
    [0, 84, 'g', [[-11, -9.5], [-12.5, -11], [-11, -11], [-8.5, -11], [-8.5, -9], [-10, -9]]],
    [0, 84, 'g', [[-10.5, -13], [-11.5, -15], [-8, -14.5], [-8.5, -12.5]]],
    [0, 84, 'g', [[-9.5, -16], [-10.5, -18], [-8, -18], [-8, -16]]],
    [0, 84, 'g', [[13.5, -14.5], [14.5, -16.5], [11.5, -16.5], [11.5, -14.5]]],
    [0, 84, 'g', [[14, -10.5], [15.5, -12.5], [11.5, -13], [11, -11]]],
    [0, 84, 'g', [[14.5, -7.5], [16, -9], [11, -9.5], [11, -8]]],
    [0, 84, 'g', [[14.5, -3.5], [16.5, -5.5], [10.5, -6], [10.5, -4]]],
    [0, 84, 'g', [[16, 2], [14.5, 2], [10, 1.5], [9.5, 3.5], [12.5, 4], [14, 4]]],
    [0, 84, 'g', [[14, 0], [16, -1.5], [14.5, -2], [10, -2], [10, -0.5], [12.5, 0]]],
    [0, 84, 'g', [[13, 8], [15, 6], [14, 6], [9.5, 5.5], [9, 7.5], [11.5, 7.5]]],
    [0, 84, 'g', [[12, 11.5], [14, 9.5], [13, 9.5], [9, 9], [9, 11], [10.5, 11.5]]],
    [0, 84, 'g', [[10.5, 15], [13, 13], [11.5, 13], [8.5, 12.5], [8.5, 14.5]]],
    [0, 84, 'w', [[-10.5, -18], [-7.5, -19.5], [-8, -18]]],
    [0, 84, 'w', [[-11.5, -15], [-9.5, -16], [-8, -16], [-8, -14.5]]],
    [0, 84, 'w', [[-12.5, -11], [-10.5, -13], [-8.5, -12.5], [-8.5, -11]]],
    [0, 84, 'w', [[-13.5, -7.5], [-11, -9.5], [-8.5, -9], [-9, -7]]],
    [0, 84, 'w', [[-14.5, -3.5], [-12.5, -5.5], [-9, -5.5], [-9, -3.5]]],
    [0, 84, 'w', [[-14.5, 0], [-12.5, -2], [-9.5, -1.5], [-9.5, 0.5]]],
    [0, 84, 'w', [[-14.5, 4], [-12.5, 2], [-9.5, 2], [-10, 4.5]]],
    [0, 84, 'w', [[-14, 7.5], [-12.5, 6], [-10, 6], [-10, 8]]],
    [0, 84, 'w', [[-14, 11.5], [-12.5, 9.5], [-10.5, 9.5], [-10.5, 11.5]]],
    [0, 84, 'w', [[-13, 14.5], [-12, 13], [-10.5, 13], [-11, 15]]],
    [0, 84, 'w', [[8.5, 16], [8.5, 14.5], [10.5, 15], [11.5, 16.5]]],
    [0, 84, 'w', [[8.5, 12.5], [9, 11], [12, 11.5], [13, 13]]],
    [0, 84, 'w', [[9, 9], [9, 7.5], [13, 8], [14, 9.5]]],
    [0, 84, 'w', [[9.5, 5.5], [9.5, 3.5], [14, 4], [15, 6]]],
    [0, 84, 'w', [[10, 1.5], [10, -0.5], [14, 0], [16, 2]]],
    [0, 84, 'w', [[10, -2], [10.5, -4], [14.5, -3.5], [16, -1.5]]],
    [0, 84, 'w', [[10.5, -6], [11, -8], [14.5, -7.5], [16.5, -5.5]]],
    [0, 84, 'w', [[11, -9.5], [11, -11], [14, -10.5], [16, -9]]],
    [0, 84, 'w', [[11.5, -13], [11.5, -14.5], [13.5, -14.5], [15.5, -12.5]]],
    [0, 84, 'w', [[11.5, -16.5], [12, -18.5], [14.5, -16.5]]],
    [0, 84, 'g', [[-11.5, 16], [-13, 14.5], [-12, 14.5], [-11, 15], [-11, 16.5]]],
    [0, 84, 'g', [[11.5, 16.5], [8.5, 16], [8, 18]]],
    [0, 86, 'b', [[-11, 16.5], [-10.5, 18], [-10, 20], [-9, 23], [-5.5, 22], [-4.5, 21], [-4, 21], [-4, 20.5], [0, -22.5], [0, -23], [0, -23.5], [-1.5, -24], [-4.5, -26], [-6, -23], [-7.5, -19.5], [-8, -18], [-8, -16], [-8, -14.5], [-8.5, -12.5], [-8.5, -11], [-8.5, -9], [-9, -7], [-9, -5.5], [-9, -3.5], [-9.5, -1.5], [-9.5, 0.5], [-9.5, 2], [-10, 4.5], [-10, 6], [-10, 8], [-10.5, 9.5], [-10.5, 11.5], [-10.5, 13], [-11, 15]]],
    [0, 86, 'b', [[4.5, -22], [5, -22.5], [5.5, -23], [6.5, -23.5], [10.5, -25], [11.5, -21.5], [12, -18.5], [11.5, -16.5], [11.5, -14.5], [11.5, -13], [11, -11], [11, -9.5], [11, -8], [10.5, -6], [10.5, -4], [10, -2], [10, -0.5], [10, 1.5], [9.5, 3.5], [9.5, 5.5], [9, 7.5], [9, 9], [9, 11], [8.5, 12.5], [8.5, 14.5], [8.5, 16], [8, 18], [8, 19], [6.5, 21], [5, 24.5], [1.5, 22.5], [0.5, 22], [0.5, 21]]],
    [0, 86, 'w', [[-4, 20.5], [-3.5, 20.5], [-3, 20.5], [-0.5, 20.5], [0.5, 21], [4.5, -22], [3.5, -22], [1.5, -22.5], [0, -22.5]]],
    [0, 95, 'b', [[1.5, -22.5], [1.5, -24], [2, -24.5], [2.5, -24.5], [3, -24.5], [3.5, -24], [3.5, -22]]],
    [0, 95, 'b', [[-3, 20.5], [-3, 22], [-3, 22.5], [-3, 23], [-2.5, 23], [-2, 23], [-1.5, 23], [-1, 23], [-1, 22.5], [-0.5, 20.5]]],
    [0, 95, 'b', [[1.5, -22.5], [1, -21.5], [1, -19.5], [2, -20], [3.5, -19.5], [3.5, -21.5], [3.5, -22]]],
    [0, 95, 'b', [[-2.5, 18], [-2.5, 19.5], [-3, 20.5], [-0.5, 20.5], [-0.5, 20], [-0.5, 18], [-1.5, 18]]],
    [0, 99, 'c', [[2, -20], [3.5, -19.5], [5, -19.5], [6, -19], [7, -18.5], [8.5, -17], [9.5, -15.5], [10.5, -14], [11, -12], [11, -11], [11.5, -7], [11.5, -4.5], [11.5, 0], [11, 7.5], [9.5, 11.5], [7.5, 14.5], [5, 16.5], [2.5, 18], [0, 18], [-0.5, 18], [-1.5, 18], [-2.5, 18], [-5, 17], [-7.5, 15], [-9.5, 12.5], [-10, 8], [-10, 2], [-10, -4.5], [-9.5, -8], [-9, -10], [-8, -12], [-7, -14], [-6, -16.5], [-4.5, -18], [-3.5, -18.5], [-2, -19.5], [-0.5, -19.5], [1, -19.5]]],
    [3, 4, 'b', [[32, 22], [30, 21.5], [30.5, 14], [41, 15], [40, 27.5], [39.5, 29.5], [39, 35], [23, 34], [-23.5, 29.5], [-26, 29], [-27.5, 28.5], [-30, 27.5], [-32, 25], [-33.5, 23], [-35, 19.5], [-35, 18.5], [-35.5, 17.5], [-35.5, 16], [-35.5, 15], [-35, 13.5], [-34.5, 12.5], [-34, 12], [-34.5, 12.5], [-34.5, 13], [-34.5, 13.5], [-34, 14], [-33.5, 14.5], [-33, 14.5], [-23, 15.5], [-19.5, 15.5], [-11.5, 16], [-11, 16.5], [-10.5, 18], [-14.5, 17.5], [-15, 21], [-14.5, 22], [-14.5, 23], [-14, 23.5], [-13, 24], [-12, 24.5], [-11, 25], [12, 26.5], [13, 26.5], [14, 26.5], [14.5, 26], [15, 25.5], [15, 24.5], [15.5, 21.5], [15, 21], [15, 20.5], [14.5, 20], [14, 20], [13.5, 19.5], [13, 19.5], [8, 19], [8, 18], [11.5, 16.5], [23.5, 17.5], [22.5, 26.5], [31.5, 27]]],
    [8, 10, 'g', [[-4.5, -54], [-28.5, -59], [-31, -39.5], [-33, -20], [-38.5, -22], [-38.5, -21], [-37.5, -20.5], [-37, -20], [-37, -19.5], [-38, -16.5], [-38, -16], [-38.5, -16], [-39, -16], [-40.5, -16], [-40.5, -15.5], [-39.5, -15], [-39, -15], [-38.5, -14.5], [-38.5, -14], [-38.5, -13.5], [-39, -11], [-39.5, -10.5], [-40, -10.5], [-40.5, -10.5], [-41.5, -10.5], [-42, -10], [-40.5, -9.5], [-40, -9.5], [-40, -9], [-40, -8.5], [-40, -5.5], [-40.5, -5], [-41, -4.5], [-41.5, -4.5], [-43, -4.5], [-43, -4], [-41.5, -4], [-41, -3.5], [-40.5, -3.5], [-40.5, -3], [-40.5, -2.5], [-40.5, 0], [-40.5, 0.5], [-41, 0.5], [-41.5, 1], [-42, 1], [-43.5, 1], [-43, 2], [-42, 2], [-41.5, 2], [-41, 2], [-40.5, 2.5], [-40.5, 3], [-40.5, 5.5], [-40.5, 6], [-41, 6], [-41.5, 6.5], [-42, 6.5], [-43, 6.5], [-43, 7.5], [-41.5, 7], [-41, 7.5], [-40.5, 7.5], [-40.5, 8], [-40.5, 8.5], [-40, 11], [-40, 11.5], [-40.5, 12], [-40.5, 12.5], [-41, 12.5], [-42.5, 12.5], [-42, 13], [-37, 12.5], [-36.5, 15], [-35.5, 15], [-11, 16.5], [-11.5, 16], [-13, 14.5], [-12, 13], [-14, 11.5], [-12.5, 9.5], [-14, 7.5], [-12.5, 6], [-14.5, 4], [-12.5, 2], [-14.5, 0], [-12.5, -2], [-14.5, -3.5], [-12.5, -5.5], [-13.5, -7.5], [-11, -9.5], [-12.5, -11], [-10.5, -13], [-11.5, -15], [-9.5, -16], [-10.5, -18], [-7.5, -19.5], [-6, -23], [-4.5, -26], [-1.5, -24], [0, -23.5], [0, -23], [0, -22.5], [1.5, -22.5], [1.5, -24], [2, -24.5], [2.5, -24.5], [3, -24.5], [3.5, -24], [3.5, -22], [4.5, -22], [5, -22.5], [5.5, -23], [6.5, -23.5], [10.5, -25], [11.5, -21.5], [12, -18.5], [14.5, -16.5], [13.5, -14.5], [15.5, -12.5], [14, -10.5], [16, -9], [14.5, -7.5], [16.5, -5.5], [14.5, -3.5], [16, -1.5], [14, 0], [16, 2], [14, 4], [15, 6], [13, 8], [14, 9.5], [12, 11.5], [13, 13], [10.5, 15], [11.5, 16.5], [8, 18], [19, 19], [23.5, 29.5], [26.5, 36], [31.5, 36.5], [32, 30], [39, -53], [38, -52.5], [12.5, -52.5], [1, -53.5]]],
    [10, 11, 'w', [[26.5, 36], [23.5, 29.5], [32, 30], [31.5, 36.5]]],
    [11, 12, 'g', [[23.5, 29.5], [26.5, 36], [31.5, 36.5], [32, 30]]],
    [84, 86, 'g', [[8, 18], [8.5, 16], [8.5, 14.5], [8.5, 12.5], [9, 11], [9, 9], [9, 7.5], [9.5, 5.5], [9.5, 3.5], [10, 1.5], [10, -0.5], [10, -2], [10.5, -4], [10.5, -6], [11, -8], [11, -9.5], [11, -11], [11.5, -13], [11.5, -14.5], [11.5, -16.5], [12, -18.5], [14.5, -16.5], [13.5, -14.5], [15.5, -12.5], [14, -10.5], [16, -9], [14.5, -7.5], [16.5, -5.5], [14.5, -3.5], [16, -1.5], [14, 0], [16, 2], [14, 4], [15, 6], [13, 8], [14, 9.5], [12, 11.5], [13, 13], [10.5, 15], [11.5, 16.5]]],
    [84, 86, 'g', [[-11, 16.5], [-11.5, 16], [-13, 14.5], [-12, 13], [-14, 11.5], [-12.5, 9.5], [-14, 7.5], [-12.5, 6], [-14.5, 4], [-12.5, 2], [-14.5, 0], [-12.5, -2], [-14.5, -3.5], [-12.5, -5.5], [-13.5, -7.5], [-11, -9.5], [-12.5, -11], [-10.5, -13], [-11.5, -15], [-9.5, -16], [-10.5, -18], [-7.5, -19.5], [-8, -18], [-8, -16], [-8, -14.5], [-8.5, -12.5], [-8.5, -11], [-8.5, -9], [-9, -7], [-9, -5.5], [-9, -3.5], [-9.5, -1.5], [-9.5, 0.5], [-9.5, 2], [-10, 4.5], [-10, 6], [-10, 8], [-10.5, 9.5], [-10.5, 11.5], [-10.5, 13], [-11, 15]]],
    [86, 88, 'd', [[-4.5, 19.5], [-5, 20], [-5, 20.5], [-5.5, 21], [-8.5, 22], [-9, 19], [-10, 16.5], [-12, 14.5], [-10.5, 13], [-12.5, 11.5], [-11, 9.5], [-13, 7.5], [-11.5, 6], [-13, 4], [-11, 2], [-13, 0], [-11, -2], [-13, -3.5], [-11, -5.5], [-12.5, -7.5], [-10, -9], [-11, -11], [-9, -12.5], [-10, -14.5], [-8, -16], [-9, -17.5], [-7, -19], [-5.5, -22.5], [-4, -24.5], [-1, -23], [-1, -22.5], [-0.5, -22], [-0.5, -21.5], [1, -21.5], [3.5, -21.5], [5, -21], [5.5, -22], [6, -22], [6.5, -22.5], [10, -23.5], [10.5, -21], [11, -18], [13.5, -16], [12, -14], [14.5, -12.5], [12.5, -10.5], [14.5, -9], [13, -7.5], [15, -5.5], [13, -3.5], [14.5, -2], [12.5, 0], [14.5, 2], [12.5, 4], [14, 6], [11.5, 7.5], [13, 9.5], [10.5, 11.5], [11.5, 13], [9, 14.5], [10.5, 16], [7.5, 17.5], [6, 20], [4.5, 23], [1.5, 21.5], [1.5, 21], [1, 20.5], [1, 20], [-0.5, 20], [-2.5, 19.5]]],
    [88, 91, 'g', [[-9, 23], [-10, 20], [-10.5, 18], [-11, 16.5], [-11.5, 16], [-13, 14.5], [-12, 13], [-14, 11.5], [-12.5, 9.5], [-14, 7.5], [-12.5, 6], [-14.5, 4], [-12.5, 2], [-14.5, 0], [-12.5, -2], [-14.5, -3.5], [-12.5, -5.5], [-13.5, -7.5], [-11, -9.5], [-12.5, -11], [-10.5, -13], [-11.5, -15], [-9.5, -16], [-10.5, -18], [-7.5, -19.5], [-6, -23], [-4.5, -26], [-1.5, -24], [0, -23.5], [0, -23], [0, -22.5], [1.5, -22.5], [3.5, -22], [4.5, -22], [5, -22.5], [5.5, -23], [6.5, -23.5], [10.5, -25], [11.5, -21.5], [12, -18.5], [14.5, -16.5], [13.5, -14.5], [15.5, -12.5], [14, -10.5], [16, -9], [14.5, -7.5], [16.5, -5.5], [14.5, -3.5], [16, -1.5], [14, 0], [16, 2], [14, 4], [15, 6], [13, 8], [14, 9.5], [12, 11.5], [13, 13], [10.5, 15], [11.5, 16.5], [8, 18], [8, 19], [6.5, 21], [5, 24.5], [1.5, 22.5], [0.5, 22], [0.5, 21], [-0.5, 20.5], [-3, 20.5], [-3.5, 20.5], [-4, 20.5], [-4, 21], [-4.5, 21], [-5.5, 22]]]
];

function kazakhstan() {
    const C = { g: '#dcc77a', w: '#7690ad', b: '#e7dcb6', d: '#4d4b58', k: '#6b6e74', n: '#5b7a6a', c: '#ddd6c2' };
    const out = [part([rect(0, -25, 103, 148)], 0, 0.2, '#e7e2d6')];
    for (const [z0, z1, k, ring] of KAZ) {
        if (k === 'g' && z1 === 13) {               // круглые барабаны на крыше подиума — с серой крышкой
            out.push(part([ring], z0, z1 - 0.4, '#e8dcb0'), part([ring], z1 - 0.4, z1, '#8c8c8c'));
        } else if (z0 === 8) {                      // золотой карниз подиума, сверху серая крыша
            const [cx, cy] = mid(ring);
            out.push(part([ring], 8, 9.6, C.g), part([grow(ring, 0.985, cx, cy)], 9.6, 10, '#a9a39a'));
        } else if (k === 'b' && z1 === 86) {        // две половины башни: окна этажами с бежевыми перекрытиями
            striped(out, ring, 0, 86, 3.3, C.w, C.b, 0.62);
        } else out.push(part([ring], z0, z1, C[k]));
    }
    // ротонда-«зонтик» на подиуме: пологий купол с радиальными рёбрами
    cone(out, 4, -36, 13, 8.6, 2.6, '#ece0bc', 3, 24);
    for (let k = 0; k < 12; k++) {
        const a = k / 12 * TAU;
        beam(out, [4 + Math.cos(a) * 8.4, -36 + Math.sin(a) * 8.4, 13.2], [4, -36, 15.6], 0.4, '#c9ad62');
    }
    // светлые полоски этажей вокруг всей башни
    const tower = KAZ.find(p => p[0] === 86)[3], [tx, ty] = mid(tower);
    for (let z = 11.5; z < 84; z += 3.3) out.push(part([grow(tower, 1.015, tx, ty)], z, z + 0.35, '#efe3b8'));
    // корона: золотой обод и зубцы по плавному контуру — высокие и пониже по очереди
    const crown = hull(KAZ.find(p => p[0] === 88)[3]), [hx, hy] = mid(crown);
    out.push(part(ringOf(crown, grow(crown, 0.9, hx, hy)), 91, 92.4, '#c8ad5c'));
    along(crown, 34).forEach(([x, y, a], k) => {
        const H = k % 2 ? 7 : 11;
        for (let i = 0; i < 4; i++) {
            const w = 3.2 * (1 - i / 4) + 0.3;
            out.push(part([rect(x, y, w, 0.8, a)], 91 + H * i / 4, 91 + H * (i + 1) / 4, i % 2 ? '#e8d486' : C.g));
        }
    });
    // на крыше ядра — машинные помещения лифтов
    for (const [x, y] of [[0, -8], [1, 0], [1, 8]]) out.push(part([rect(x, y, 5, 4, 0.1)], 99, 101, '#c9c4b8'));
    return out;
}

// Телебашня на Кок-Тобе (372 м), как в 2ГИС: белый круглый ствол, внизу шире, с коричневыми
// кольцами, две большие «тарелки»-площадки с полосой окон, выше — тонкий ствол и антенна
// в коричнево-белую полоску. Внизу — светлое здание с коричневой крышей и крыло со входом
function koktobe() {
    const white = '#f2f0ea', brown = '#9b5a3c', brownL = '#b4785a', win = '#5b6b7c', wall = '#e9e4da';
    const out = [part([rect(-6, -3, 64, 46)], 0, 0.3, '#e7e2d6')];
    out.push(part([rect(0, -2, 34, 30)], 0.3, 9, wall), part([rect(0, -2, 35.5, 31.5)], 9, 10.6, brown));
    out.push(part([rect(-22, -9, 22, 14)], 0.3, 6, wall), part([rect(-22, -9, 23.5, 15.5)], 6, 7.4, brown));
    out.push(part([rect(-35, -11, 6, 9)], 3.2, 3.7, brownL), part([rect(0, -17.6, 12, 0.6)], 0.3, 7, win));
    // ствол: расширение у земли, дальше ровная труба
    const ring = (r, a, b, c = brown) => out.push(part([oval(0, 0, r, r, 28)], a, b, c));
    stack(out, 0, 0, 0, 44, 6, t => 11 - 3.4 * t, white, 28);
    ring(7.4, 44, 169, white);
    for (const z of [12, 44, 70, 96, 122, 148]) ring(z < 44 ? 10.5 : 8.1, z, z + 2.2);
    // нижняя площадка: коричневый низ и верх, белый пояс с окнами
    [[9.8, 166, 169], [15, 169, 171.5], [15, 178.5, 181]].forEach(([r, a, b]) => ring(r, a, b));
    ring(15.3, 171.5, 178.5, white);
    ring(15.6, 173.5, 176.5, win);
    ring(6.2, 181, 236, white);
    for (const z of [204, 222]) ring(6.9, z, z + 1.8);
    // верхняя площадка
    [[8, 233, 236], [12.6, 236, 238.5], [12.6, 245.5, 248], [7, 248, 251]].forEach(([r, a, b]) => ring(r, a, b));
    ring(12.9, 238.5, 245.5, white);
    ring(13.2, 240.5, 243.5, win);
    // тонкий ствол и антенна в полоску
    ring(3.2, 251, 290, white);
    for (const z of [264, 278]) ring(3.7, z, z + 1.4);
    for (let z = 290, k = 0; z < 372; z += 8.2, k++) {
        const r = z < 335 ? 1.3 : 0.7;
        out.push(part([oval(0, 0, r, r, 12)], z, Math.min(372, z + 8.2), k % 2 ? '#ffffff' : brown));
    }
    return out;
}

// Бизнес-центр «Нурлы Тау» на Аль-Фараби — по настоящему плану из OpenStreetMap (46 частей).
// Два зеркальных квартала по сторонам площади, в каждом две башни: в середине башни — ядро
// с острой стеклянной пирамидой, вокруг — «плечи» уступами с двускатными крышами,
// к проспекту спускаются корпуса пониже с каменным низом и стеклянными скатными крышами.
// Части: [высота с крышей, крыша, контур в метрах от центра]; крыша: p — пирамида, h — вальмовая, g — двускатная
const NURLY = [
    [125, 'p', [[-121, 72.5], [-113.5, 90], [-107.5, 90.5], [-97, 75.5], [-99.5, 70.5], [-118, 68]]],
    [119, 'p', [[41.5, 90], [48.5, 107.5], [54, 108], [65.5, 93], [64.5, 91], [63, 88], [45, 86]]],
    [110, 'p', [[-115, -0.5], [-112.5, 4.5], [-94.5, 5.5], [-91, 1.5], [-98.5, -15.5], [-101.5, -16], [-104, -16]]],
    [110, 'p', [[50, 15.5], [52, 20], [70.5, 22.5], [72.5, 19.5], [73.5, 18], [66, 0.5], [60.5, 0]]],
    [110, 'g', [[-99.5, 96.5], [-107.5, 90.5], [-97, 75.5], [-89, 81]]],
    [110, 'g', [[-113.5, 90], [-123.5, 94.5], [-131, 76.5], [-121, 72.5]]],
    [110, 'g', [[-98.5, 59.5], [-99.5, 70.5], [-118, 68], [-116.5, 57.5]]],
    [104, 'g', [[48.5, 107.5], [39, 111.5], [32, 94], [41.5, 90]]],
    [104, 'g', [[64.5, 77.5], [63, 88], [45, 86], [46, 75.5]]],
    [104, 'g', [[74, 99], [62.5, 114.5], [54, 108], [65.5, 93]]],
    [99, 'g', [[-91, 102.5], [-99.5, 96.5], [-89, 81], [-80.5, 87], [-81.5, 88.5], [-90.5, 101]]],
    [99, 'g', [[-123.5, 94.5], [-133.5, 98.5], [-140.5, 81], [-131, 76.5]]],
    [99, 'g', [[-116.5, 57.5], [-115.5, 47], [-97, 49], [-98.5, 59.5]]],
    [95, 'g', [[-115, -0.5], [-124, -6.5], [-113, -22.5], [-104, -16]]],
    [95, 'g', [[-81.5, -2.5], [-91, 1.5], [-98.5, -15.5], [-89, -19.5]]],
    [95, 'g', [[-95, 16.5], [-113.5, 15], [-112.5, 4.5], [-94.5, 5.5]]],
    [95, 'g', [[83.5, 14], [73.5, 18], [66, 0.5], [76, -3.5]]],
    [95, 'g', [[60.5, 0], [50, 15.5], [41.5, 9.5], [52, -6]]],
    [95, 'g', [[70.5, 22.5], [69.5, 33], [51, 31], [52, 20]]],
    [93, 'g', [[64.5, 77.5], [46, 75.5], [47.5, 64.5], [65.5, 66.5]]],
    [93, 'g', [[29.5, 115], [29, 114], [23, 99.5], [22.5, 98], [32, 94], [39, 111.5]]],
    [93, 'g', [[82.5, 105.5], [71.5, 121], [62.5, 114.5], [74, 99]]],
    [84, 'g', [[-81.5, -2.5], [-89, -19.5], [-79.5, -24], [-79, -22.5], [-73, -8.5], [-72, -7]]],
    [84, 'g', [[-132.5, -13], [-121.5, -28.5], [-113, -22.5], [-124, -6.5]]],
    [84, 'g', [[-96, 27.5], [-114.5, 26], [-113.5, 15], [-95, 16.5]]],
    [84, 'g', [[34, 2], [42.5, -10], [44, -11.5], [50.5, -7], [52, -6], [41.5, 9.5], [33, 3.5]]],
    [84, 'g', [[83.5, 14], [76, -3.5], [86, -8], [93.5, 9.5]]],
    [84, 'g', [[68, 44], [49.5, 41.5], [51, 31], [69.5, 33]]],
    [80, 'h', [[-81.5, 88.5], [-90.5, 101], [-84, 106], [-80.5, 114], [-77, 122], [-77.5, 129.5], [-61.5, 131], [-61, 124], [-51.5, 109.5], [-43, 106], [-50, 91], [-58, 94.5], [-75, 93]]],
    [74, 'h', [[-5, 95.5], [-18, 108], [-11, 113], [-5, 129.5], [-6, 136.5], [10, 139], [11.5, 131], [19.5, 120.5], [22, 117], [29, 114], [23, 99.5], [15.5, 102.5], [-1, 100.5]]],
    [70, 'h', [[-61, -48], [-62, -40], [-72, -26], [-79, -22.5], [-73, -8.5], [-65.5, -11.5], [-48.5, -10], [-41.5, -4.5], [-32, -17.5], [-39, -23], [-45.5, -39], [-45, -46.5]]],
    [70, 'h', [[14, -40.5], [13.5, -33.5], [4, -19], [-4, -15], [2.5, -0.5], [10.5, -4], [27.5, -2.5], [34, 2], [42.5, -10], [43, -10.5], [37, -15], [29.5, -31], [30.5, -39]]],
    [50, 'g', [[-61.5, -62], [-62.5, -54], [-63, -48], [-61, -48], [-45, -46.5], [-43, -46], [-41.5, -60]]],
    [50, 'g', [[13.5, -54.5], [12, -41], [14, -40.5], [30.5, -39], [32.5, -39], [33.5, -50], [33.5, -52.5]]],
    [50, 'g', [[-79.5, 129.5], [-80, 133], [-81, 143.5], [-61, 145.5], [-60, 136], [-59.5, 131.5], [-61.5, 131], [-77.5, 129.5]]],
    [47, 'g', [[-60, -74.5], [-61.5, -62], [-41.5, -60], [-40, -73]]],
    [47, 'g', [[15, -67.5], [13.5, -54.5], [33.5, -52.5], [35, -65.5]]],
    [47, 'g', [[-81, 143.5], [-82.5, 156], [-62, 158.5], [-61, 145.5]]],
    [44, 'g', [[-59, -88], [-60, -74.5], [-40, -73], [-38.5, -85.5]]],
    [44, 'g', [[16, -80.5], [16, -78], [15, -67.5], [35, -65.5], [36, -76], [36, -78.5]]],
    [44, 'g', [[-82.5, 159], [-83.5, 169], [-63.5, 171], [-62.5, 160], [-62, 158.5], [-82.5, 156]]],
    [40, 'h', [[-64.5, -102], [-59, -88], [-38.5, -85.5], [-29, -98], [-37.5, -117], [-52.5, -118.5]]],
    [40, 'h', [[9, -94.5], [16, -80.5], [36, -78.5], [40.5, -85], [44.5, -91.5], [36.5, -110], [21, -111.5]]],
    [30, 'h', [[-64.5, -102], [-52.5, -118.5], [-60, -123], [-65.5, -137], [-64.5, -145.5], [-85.5, -147.5], [-86.5, -138.5], [-90.5, -132.5], [-95, -126.5], [-103, -123], [-94.5, -105], [-86, -108.5], [-79, -108], [-72, -107]]],
    [30, 'h', [[74.5, -88.5], [86.5, -104.5], [79.5, -109.5], [73.5, -122.5], [74.5, -132], [53.5, -134], [52.5, -125.5], [44, -113], [36.5, -110], [44.5, -91.5], [53, -95], [67, -93.5]]],
    [10, 'g', [[-31.5, -34], [-26, -90], [-5, -88.5], [1, -88], [-3, -32]]]
];

// Направление самой длинной стены контура — вдоль неё идёт конёк крыши
function ridge(ring) {
    let ux = 1, uy = 0, best = 0;
    ring.forEach((p, i) => {
        const q = ring[(i + 1) % ring.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (L > best) { best = L; ux = (q[0] - p[0]) / L; uy = (q[1] - p[1]) / L; }
    });
    return [ux, uy];
}

// Ширина контура поперёк конька — от неё зависит высота крыши
function narrow(ring) {
    const [ux, uy] = ridge(ring), b = ring.map(([x, y]) => -x * uy + y * ux);
    return Math.max(...b) - Math.min(...b);
}

// Крыша по контуру ring: высота rh от z0. Пирамида сходится в точку, вальмовая — почти,
// двускатная сжимается поперёк конька
function roofOf(out, ring, z0, rh, kind, c1, c2) {
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const [ux, uy] = ridge(ring), n = kind === 'p' ? 12 : 6;
    for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n, s = kind === 'h' ? 1 - t * 0.55 : 1 - t * 0.95;
        const r = kind === 'g'
            ? ring.map(([x, y]) => {
                const dx = x - cx, dy = y - cy, a = dx * ux + dy * uy, b = (-dx * uy + dy * ux) * s;
                return [cx + a * ux - b * uy, cy + a * uy + b * ux];
            })
            : grow(ring, s, cx, cy);
        out.push(part([r], z0 + rh * k / n, z0 + rh * (k + 1) / n, k % 2 ? c2 : c1));
    }
}

function nurlytau() {
    // стекло отражает небо по-разному — у каждой части свой оттенок
    const tints = ['#8cb6de', '#7fa9d3', '#9ac2e6', '#86b0da', '#a3c8e8', '#7aa3cc'];
    const band = '#4e6a86', edge = '#e3ebf2', stone = '#7a5a52';
    const out = [];
    // площадь между кварталами и перед ними: плитка, сухие фонтаны, тополя вдоль проспекта
    out.push(part([rect(-16, -20, 48, 220)], 0, 0.3, '#e9e4d8'), part([rect(-22, -138, 150, 22)], 0, 0.3, '#e9e4d8'));
    for (let k = 0; k < 9; k++) out.push(part([oval(-58 + k * 9, -138, 0.5, 0.5, 8)], 0.3, 2.6 + (k % 3) * 0.7, '#eaf6fd'));
    for (let x = -140; x <= 90; x += 12) {
        if (x > -48 && x < 16) continue;
        out.push(part([rect(x, -150, 0.5, 0.5)], 0, 3, '#8d6e52'));
        stack(out, x, -150, 2.4, 14, 4, t => 2.4 * (1 - t * 0.6), '#5fa651', 8, '#6fb35e');
    }
    // маленький стеклянный купол в глубине площади
    out.push(part([oval(-18, 74, 7, 7, 20)], 0, 4, '#e3ebf2'));
    dome(out, -18, 74, 4, 6.6, 5.5, '#4f86c6', 5, 20);
    NURLY.forEach(([h, roof, ring], i) => {
        const glass = tints[i % tints.length];
        // у башен стены до OSM-высоты без крыши, а пирамиду делаем выше (24 м) — на фото она главная
        const rh = roof === 'p' ? 15 : Math.min(roof === 'g' ? 9 : 6, Math.max(3, narrow(ring) * (roof === 'g' ? 0.4 : 0.2)));
        const top = h - rh, cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
        // низкие корпуса стоят на тёмном камне, башни — стекло до земли
        const z0 = h <= 80 ? 4.5 : 0;
        if (z0) out.push(part([ring], 0, z0, stone));
        striped(out, ring, z0, top, 4.2, glass, band, 0.8);
        out.push(part([grow(ring, 1.012, cx, cy)], top - 0.6, top, edge));
        // светлые рёбра на углах высоких частей — «кристалл»
        if (h >= 84) for (const [x, y] of ring) out.push(part([rect(x, y, 0.7, 0.7)], z0, top, '#d6e2ec'));
        if (roof === 'p') {
            roofOf(out, ring, top, 24, 'p', '#c4daee', '#a6c8e8');
            out.push(part([oval(cx, cy, 0.45, 0.45, 6)], top + 24, top + 31, '#eef2f6'));
        } else roofOf(out, ring, top, rh, roof, '#a9cae6', '#bcd7ee');
    });
    return out;
}

// Rixos Almaty: корпус буквой «П» из бежевого камня, вход с колоннами и золотой купол
function rixos() {
    const stone = '#eedcb3', win = '#b3a88f', trim = '#fbf4e2', gold = '#dcb95c';
    const out = [part([rect(0, 0, 96, 62)], 0, 0.3, '#e7e2d6')];
    for (const [x, y, w, d] of [[0, -17, 90, 22], [-35, 10, 20, 34], [35, 10, 20, 34]]) {
        out.push(part([rect(x, y, w, d)], 0.3, 4, '#d9c9a5'));
        striped(out, rect(x, y, w, d), 4, 27, 3.3, stone, win, 0.62);
        out.push(part([rect(x, y, w + 1, d + 1)], 27, 28, trim), part([rect(x, y, w - 2, d - 2)], 28, 30.5, '#b8c1ca'));
    }
    // центральный выступ: колонны, балкон, ротонда с куполом
    out.push(part([rect(0, -29.5, 26, 3)], 0.3, 27, stone));
    colRow(out, -10, -31.8, 10, -31.8, 6, 0.3, 12, 0.6, trim);
    out.push(part([rect(0, -31.8, 24, 3)], 12, 13.6, trim), part([rect(0, -31.2, 20, 1.6)], 13.6, 14.6, gold));
    out.push(part([oval(0, -17, 7.5, 7.5, 20)], 30.5, 34, trim));
    colonnade(out, 0, -17, 7.2, 7.2, 12, 30.5, 34, 0.35, stone);
    dome(out, 0, -17, 34, 7, 6.5, gold, 6, 20);
    out.push(part([oval(0, -17, 0.4, 0.4, 6)], 40.5, 44, gold));
    for (const x of [-40, 40]) tree(out, x, -27, 8, 3, '#74b558', 0.3);
    return out;
}

// Esentai Tower (162 м, внутри — отель The Ritz-Carlton): два стеклянных корпуса
// с белыми вертикальными рёбрами, белый пояс технического этажа и крыши, срезанные наискосок
function esentai() {
    const glass = '#4f809d', band = '#3f6a86', dark = '#355a74', fin = '#e9eff3';
    const out = [part([rect(0, -10, 72, 76)], 0, 0.3, '#e3e1da')];
    // корпус: y, глубина, высота ровной части, высота крыши у края
    for (const [y, d, h, hi] of [[8.5, 16, 150, 162], [-9.5, 19, 100, 112]]) {
        striped(out, rect(0, y, 54, d), 0.3, h, 4, glass, band, 0.8);
        const n = 9;
        for (let k = 0; k < n; k++) {
            const x = -27 + 54 * (k + 0.5) / n, top = hi - (hi - h) * k / (n - 1);
            out.push(part([rect(x, y, 54 / n + 0.05, d)], h, top, dark));
        }
        for (let x = -25.5; x < 26; x += 3) {
            const top = hi - (hi - h) * (x + 25.5) / 51;
            for (const s of [-1, 1]) out.push(part([rect(x, y + s * (d / 2 + 0.25), 0.4, 0.5)], 0.3, top, fin));
        }
    }
    // белый пояс и вывеска отеля наверху
    out.push(part([rect(0, 8.5, 54.8, 16.8)], 96, 100, '#f3f5f7'), part([rect(-8, 17, 22, 0.6)], 146, 148.4, '#f3e2b0'));
    // стеклянный вестибюль и навес у входа
    out.push(part([rect(4, -34, 30, 30)], 0.3, 12, '#6f9ab8'), part([rect(4, -34, 31, 31)], 12, 12.8, '#e9eff3'));
    out.push(part([rect(4, -51, 14, 4)], 4.4, 5, '#f3d68a'));
    for (const x of [-28, -18, 26, 34]) tree(out, x, -42, 8, 3, '#74b558', 0.3);
    return out;
}

// Esentai Mall: тёмное стекло со светодиодными линиями, тёплый вход,
// высокая колонна-вывеска и красная вывеска KINOPARK с IMAX
function esentaimall() {
    const glass = '#3f5b78', led = '#f6f3e8', warm = '#f3d68a';
    const out = [part([rect(0, -6, 132, 76)], 0, 0.3, '#dcdad3')];
    out.push(part([rect(0, 0, 124, 60)], 0.3, 19, glass), part([rect(0, 0, 125, 61)], 19, 20, '#2f465e'));
    for (const z of [6.2, 12.6, 18.4]) out.push(part(ringOf(rect(0, 0, 124.6, 60.6), rect(0, 0, 123.6, 59.6)), z, z + 0.4, led));
    // «ёлочка» огоньков на фасаде
    for (let k = 0; k < 9; k++) {
        const x = -48 + k * 11;
        beam(out, [x, -30.5, 6.8], [x + 5, -30.5, 12.2], 0.4, led);
        beam(out, [x + 10, -30.5, 6.8], [x + 5, -30.5, 12.2], 0.4, led);
    }
    // колонна-вывеска: белая рамка, тёмные таблички, вверху — розовая надпись
    out.push(part([rect(-66, -36, 6, 4)], 0.3, 32, '#f7f7f5'));
    ['#252b35', '#3a3f4a', '#252b35', '#3a3f4a', '#252b35'].forEach((c, k) => out.push(part([rect(-66, -38.1, 4.4, 0.4)], 4 + k * 5, 8.4 + k * 5, c)));
    out.push(part([rect(-66, -38.1, 4.4, 0.4)], 29, 31, '#e86a8f'));
    out.push(part([rect(38, -30.7, 22, 0.6)], 14, 17, '#e5484d'), part([rect(38, -30.7, 9, 0.6)], 10.5, 13, '#4f8cff'));
    // тёплый вход с навесом и стеклянный атриум на крыше
    out.push(part([rect(-22, -34, 26, 8)], 5.6, 6.4, warm), part([rect(-22, -30.4, 18, 0.4)], 0.3, 5.6, warm));
    out.push(part([rect(0, 0, 70, 14)], 20, 23, '#8fb6da'));
    for (let x = -30; x <= 30; x += 10) out.push(part([rect(x, 0, 0.6, 14.4)], 23, 23.5, '#e9eff3'));
    return out;
}

// Вознесенский собор в парке 28 панфиловцев (1907, дерево, без единого гвоздя):
// пастельно-жёлтые стены, белые наличники, розовые лопатки, зелёные крыши, золотые главки
function cathedral() {
    const wall = '#f3d78f', trim = '#fffaf0', pink = '#eba59a', roof = '#62a487', blue = '#86bfe2';
    const out = [part([rect(0, 0, 76, 50)], 0, 0.3, '#ece6d8')];
    // цоколь, неф с запада на восток, поперёк — трансепт
    for (const [x, y, w, d] of [[-1, 0, 42, 20], [2, 0, 18, 30]]) {
        out.push(part([rect(x, y, w + 1, d + 1)], 0.3, 1.6, '#d9cfbd'), part([rect(x, y, w, d)], 1.6, 11, wall));
        out.push(part([rect(x, y, w + 0.8, d + 0.8)], 11, 12, trim));
        for (let k = 0; k < 3; k++) out.push(part([rect(x, y, w + 0.4, d * (1 - k * 0.32))], 12 + k * 1.5, 13.5 + k * 1.5, roof));
    }
    // лопатки и высокие окна
    for (let x = -20; x <= 18; x += 4.75) for (const s of [-1, 1]) {
        out.push(part([rect(x, s * 10.2, 0.8, 0.5)], 1.6, 11, pink));
        if (Math.abs(x - 2) > 9) out.push(part([rect(x + 2.4, s * 10.15, 1.4, 0.3)], 4, 8.6, trim));
    }
    // апсида на востоке
    out.push(part([oval(21, 0, 7, 7, 16)], 1.6, 10, wall), part([oval(21, 0, 7.4, 7.4, 16)], 10, 11, trim));
    dome(out, 21, 0, 11, 7, 3.4, roof, 3, 16);
    onion(out, 21, 0, 14.4, 1.4, 4, GOLD);
    cross(out, 21, 0, 18.4, 0.7);
    // центральный барабан с окнами и большая золотая главка
    out.push(part([oval(2, 0, 7, 7, 8)], 16, 24, wall));
    for (let k = 0; k < 8; k++) {
        const a = (k + 0.5) / 8 * TAU;
        out.push(part([rect(2 + Math.cos(a) * 6.6, Math.sin(a) * 6.6, 1.3, 0.3, a + Math.PI / 2)], 18, 22.4, trim));
    }
    out.push(part([oval(2, 0, 7.5, 7.5, 8)], 24, 25, trim));
    onion(out, 2, 0, 25, 5.4, 9, GOLD, '#e9c763', 20);
    cross(out, 2, 0, 34, 1.2);
    // четыре малые главки вокруг — голубые
    for (const [sx, sy] of CORNERS) {
        const x = 2 + sx * 8.5, y = sy * 7.5;
        out.push(part([oval(x, y, 2.4, 2.4, 8)], 13, 18, wall), part([oval(x, y, 2.7, 2.7, 8)], 18, 18.6, trim));
        onion(out, x, y, 18.6, 1.9, 4.2, blue, '#a6d1ec', 12);
        cross(out, x, y, 22.8, 0.6);
    }
    // колокольня над входом: четверик, восьмерик со звонами, главка
    out.push(part([rect(-18, 0, 10, 10)], 1.6, 21, wall), part([rect(-18, 0, 10.8, 10.8)], 21, 22, trim));
    for (const [sx, sy] of CORNERS) out.push(part([rect(-18 + sx * 4.8, sy * 4.8, 0.8, 0.8)], 1.6, 21, pink));
    out.push(part([oval(-18, 0, 4.8, 4.8, 8, Math.PI / 8)], 22, 23, wall));
    colonnade(out, -18, 0, 4.4, 4.4, 8, 23, 29, 0.5, pink);
    out.push(part([oval(-18, 0, 3.6, 3.6, 8)], 23, 29, '#6b5a4a'), part([oval(-18, 0, 5, 5, 8, Math.PI / 8)], 29, 30.2, trim));
    out.push(part([oval(-18, 0, 3.4, 3.4, 8)], 30.2, 34, wall));
    onion(out, -18, 0, 34, 3, 7, GOLD, '#e9c763', 16);
    out.push(part([oval(-18, 0, 0.5, 0.5, 6)], 41, 44, GOLD));
    cross(out, -18, 0, 44, 1);
    // крыльцо с двускатным навесом
    out.push(part([rect(-26, 0, 5, 7)], 0.3, 6, wall), part([rect(-26, 0, 6, 8)], 6, 7, roof), part([rect(-26, 0, 6, 4)], 7, 8, roof));
    for (const [x, y] of [[-32, 18], [-12, 21], [10, 21], [30, 16], [-32, -18], [-12, -21], [10, -21], [30, -16]]) tree(out, x, y, 10, 3.6, '#6fb352', 0.3);
    return out;
}

// КБТУ — бывший Дом Правительства на Старой площади (1957): квадрат с внутренним двором,
// парадный портик с колоннами и башенка с красным куполом
function kbtu() {
    const wall = '#ddc8a3', trim = '#f5efe3', win = '#93a2b0', roof = '#a4abb3', red = '#c94b3f';
    const out = [part([rect(0, -14, 114, 136)], 0, 0.3, '#e6e1d5')];
    const sq = ringOf(rect(0, 0, 107, 107), rect(0, 0, 63, 63));
    out.push(part(sq, 0.3, 1.6, '#b7a78b'));
    bands(out, sq, 1.6, 19, 3.6, wall, win, 0.62);
    out.push(part(ringOf(rect(0, 0, 108, 108), rect(0, 0, 62, 62)), 19, 20, trim), part(ringOf(rect(0, 0, 106, 106), rect(0, 0, 64, 64)), 20, 22.5, roof));
    // портик на юг: колонны во всю высоту, антаблемент, аттик
    out.push(part([rect(0, -48, 70, 14)], 0.3, 21, wall));
    colRow(out, -30, -55.6, 30, -55.6, 12, 3, 19, 0.85, trim);
    out.push(part([rect(0, -56, 68, 2.4)], 0.3, 3, '#cfc2a8'), part([rect(0, -55.6, 70, 2.6)], 19, 21.5, trim), part([rect(0, -50, 52, 10)], 21.5, 25, wall));
    for (let k = 0; k < 4; k++) out.push(part([rect(0, -58.4 - k * 1.2, 50, 1.2)], 0, 2.6 - k * 0.6, '#d3c7ae'));
    // башенка с колоннадой и красным куполом, шпиль с флагом
    out.push(part([rect(0, -40, 16, 16)], 22.5, 30, wall), part([rect(0, -40, 17, 17)], 30, 31, trim));
    out.push(part([oval(0, -40, 6, 6, 16)], 31, 36, trim));
    colonnade(out, 0, -40, 6.4, 6.4, 12, 31, 36, 0.4, '#ffffff');
    out.push(part([oval(0, -40, 7, 7, 16)], 36, 37, trim));
    dome(out, 0, -40, 37, 6.5, 6, red, 6, 20);
    out.push(part([oval(0, -40, 0.3, 0.3, 6)], 43, 50, '#c9d0d8'), part([rect(1, -40, 2, 0.1)], 47.6, 49, '#00a8c6'));
    for (const [x, y] of [[-18, 18], [18, 18], [-18, -16], [18, -16], [0, 2]]) tree(out, x, y, 10, 3.6, '#6fb352', 0.3);
    return out;
}

// Казахский государственный цирк (1972): круглый, как юрта — стеклянная стена между
// белыми пилонами, пояс орнамента, пологий купол с рёбрами-уыками и шаңырақ наверху
function circus() {
    const white = '#f6f4ef', glass = '#8fb8d8', roof = '#ebe5d6', rib = '#c9a65a', red = '#c94b3f', blue = '#3f7fbf';
    const out = [part([oval(0, 0, 48, 48, 40)], 0, 0.3, '#e7e3d8')];
    out.push(part([oval(0, 0, 33, 33, 40)], 0.3, 10, glass));
    for (let k = 0; k < 36; k++) {
        const a = k / 36 * TAU;
        out.push(part([rect(Math.cos(a) * 33.6, Math.sin(a) * 33.6, 1.6, 1, a)], 0.3, 10.5, white));
    }
    for (let k = 0; k < 24; k++) out.push(part([arcRing(0, 0, 34.4, 32.6, k / 24 * TAU, (k + 1) / 24 * TAU, 3)], 10.5, 12.5, k % 2 ? red : blue));
    out.push(part([oval(0, 0, 34.8, 34.8, 40)], 12.5, 13.3, white), part([oval(0, 0, 29.5, 29.5, 40)], 13.3, 16, white));
    // купол — пологий конус, как крыша юрты, полосами двух оттенков
    const R = t => 29 * (1 - 0.8 * Math.pow(t, 0.9));
    stack(out, 0, 0, 16, 14, 12, R, roof, 40, '#ddd3bd');
    for (let k = 0; k < 16; k++) {
        const a = k / 16 * TAU, c = Math.cos(a), s = Math.sin(a);
        for (let i = 0; i < 4; i++) {
            const t0 = i / 4, t1 = (i + 1) / 4;
            beam(out, [c * (R(t0) + 0.3), s * (R(t0) + 0.3), 16.4 + 14 * t0], [c * (R(t1) + 0.3), s * (R(t1) + 0.3), 16.4 + 14 * t1], 0.9, rib);
        }
    }
    // шаңырақ: золотой обруч с перекрестьем и маленький купол
    out.push(part(ringOf(oval(0, 0, 6.8, 6.8, 24), oval(0, 0, 5.4, 5.4, 24)), 29.6, 31, GOLD));
    for (const r of [0, Math.PI / 2]) for (const o of [-1.6, 1.6]) out.push(part([rect(...turn(0, 0, 0, o, r), 12, 0.5, r)], 30.4, 31, GOLD));
    dome(out, 0, 0, 31, 3.6, 2.4, '#f2d27a', 3, 16);
    // вход с навесом на юге и площадь
    out.push(part([rect(0, -38, 22, 8)], 0.3, 7, glass), part([rect(0, -39, 26, 10)], 7, 8, white));
    for (let k = 0; k < 6; k++) out.push(part([oval(-15 + k * 6, -46, 1.6, 1.6, 10)], 0.3, 0.9, k % 2 ? '#e86a8f' : '#f2b15a'));
    return out;
}

// Театр оперы и балета им. Абая (1941): песочные стены, лоджия с колоннами,
// аттик с орнаментом, высокая сценическая коробка и фонтан перед входом
function abai() {
    const wall = '#ebd49d', trim = '#fbf6ea', roof = '#9fb1ae', orn = '#d3a64a';
    const out = [part([rect(0, -4, 64, 140)], 0, 0.3, '#e6e1d5')];
    // главный объём: этажи с карнизами и лопатки
    striped(out, rect(0, 20.5, 54, 89), 0.3, 20, 6.5, wall, trim, 0.86);
    for (let y = -20; y <= 62; y += 6) for (const s of [-1, 1]) out.push(part([rect(s * 27.2, y, 0.5, 1)], 0.3, 20, trim));
    out.push(part([rect(0, 20.5, 55, 90)], 20, 21, trim), part([rect(0, 25, 50, 70)], 21, 23, roof));
    // сценическая коробка
    out.push(part([rect(0, -6, 36, 27)], 21, 32, wall), part([rect(0, -6, 37, 28)], 32, 33, trim), part([rect(0, -6, 34, 25)], 33, 34, roof));
    // парадный фасад: лоджия с колоннами, аттик с орнаментом
    out.push(part([rect(0, -33, 36, 18)], 0.3, 21, wall));
    colRow(out, -13, -43, 13, -43, 8, 2.4, 18, 0.7, trim);
    out.push(part([rect(0, -43, 34, 2.4)], 0.3, 2.4, '#d9ccad'), part([rect(0, -43, 36, 3)], 18, 20.5, trim));
    out.push(part([rect(0, -38, 36, 10)], 20.5, 25.5, wall), part([rect(0, -43.2, 30, 0.4)], 21.5, 24, orn), part([rect(0, -38, 37, 11)], 25.5, 26.3, trim));
    for (let k = 0; k < 4; k++) out.push(part([rect(0, -45 - k * 1.2, 30, 1.2)], 0, 2.2 - k * 0.5, '#d3c7ae'));
    // фонтан на площади
    out.push(part([oval(0, -60, 9, 9, 28)], 0.3, 0.8, trim), part([oval(0, -60, 8, 8, 28)], 0.8, 0.95, WATER));
    out.push(part([oval(0, -60, 0.6, 0.6, 8)], 0.95, 4.2, '#eaf6fd'));
    for (const x of [-26, -18, 18, 26]) tree(out, x, -60, 9, 3.2, '#6fb352', 0.3);
    return out;
}

// Вокзал Алматы-2 (конец проспекта Абылай хана): зал с высокими арочными окнами и часами,
// крылья, перроны с навесами и поезд «Тальго»
function almaty2() {
    const wall = '#e1e2ec', trim = '#ffffff', glass = '#8fb3d3', roof = '#9aa6b5';
    const out = [part([rect(0, 22, 190, 96)], 0, 0.3, '#e2e1dc')];
    out.push(part([rect(0, 0, 40, 30)], 0.3, 16, wall), part([rect(0, 0, 41, 31)], 16, 17, trim));
    for (let k = 0; k < 5; k++) {
        const x = -14 + k * 7;
        out.push(part([rect(x, -15.1, 4.4, 0.5)], 2, 11.5, glass));
        [[0.85, 11.5, 12.4], [0.6, 12.4, 13], [0.3, 13, 13.4]].forEach(([f, a, b]) => out.push(part([rect(x, -15.1, 4.4 * f, 0.5)], a, b, glass)));
    }
    // часы и ступенчатый фронтон
    out.push(part([rect(0, -8, 24, 16)], 17, 19.5, wall), part([rect(0, -8, 14, 16)], 19.5, 21, wall), part([rect(0, -8, 6, 16)], 21, 22, trim));
    out.push(part([rect(0, -15.3, 3.2, 0.4)], 14, 16.4, trim), part([rect(0, -15.4, 0.4, 0.4)], 14.8, 15.6, '#3a3f4a'));
    for (const s of [-1, 1]) {
        striped(out, rect(s * 42, 2, 44, 24), 0.3, 10, 3.3, wall, glass, 0.62);
        out.push(part([rect(s * 42, 2, 45, 25)], 10, 11, trim), part([rect(s * 42, 2, 42, 22)], 11, 12, roof));
    }
    platforms(out, 28, 3, 170, roof);
    train(out, -85, 35.5, 7, '#2f6fb0');
    return out;
}

// Вокзал Алматы-1: длинное здание с парадным залом, башенка с часами и шпилем,
// перроны и поезд
function almaty1() {
    const wall = '#efe2c4', trim = '#fffaf0', glass = '#8fb3d3', roof = '#8f9daf';
    const out = [part([rect(0, 18, 170, 84)], 0, 0.3, '#e2e1dc')];
    striped(out, rect(0, 0, 150, 18), 0.3, 11, 3.6, wall, glass, 0.6);
    out.push(part([rect(0, 0, 151, 19)], 11, 12, trim), part([rect(0, 0, 148, 16)], 12, 13.4, roof));
    out.push(part([rect(0, -2, 36, 26)], 0.3, 18, wall), part([rect(0, -2, 37, 27)], 18, 19, trim));
    for (let k = 0; k < 4; k++) {
        const x = -10.5 + k * 7;
        out.push(part([rect(x, -15.1, 4.4, 0.5)], 2, 13.5, glass), part([rect(x, -15.1, 2.8, 0.5)], 13.5, 14.6, glass));
    }
    out.push(part([rect(0, 0, 9, 9)], 19, 27, trim), part([rect(0, -4.6, 3, 0.3)], 22.5, 25.5, '#ffffff'), part([rect(0, -4.7, 0.4, 0.3)], 23.4, 24.6, '#3a3f4a'));
    out.push(part([rect(0, 0, 10, 10)], 27, 28, wall));
    cone(out, 0, 0, 28, 4, 7, GOLD, 5, 4);
    out.push(part([oval(0, 0, 0.3, 0.3, 6)], 35, 39, GOLD), part([star(0, 0, 1.2, 5, 0.45)], 39, 39.4, '#e5484d'));
    platforms(out, 22, 3, 160, roof);
    train(out, -75, 29.5, 6, '#4f8f5f');
    return out;
}

// Международный аэропорт Алматы: стеклянный терминал под волнистой крышей,
// телетрапы, самолёты Air Astana, диспетчерская вышка
function airport() {
    const glass = '#9cc3e0', white = '#f5f7f9';
    const out = [part([rect(10, 45, 310, 150)], 0, 0.2, '#d4d7dc'), part([rect(10, -58, 310, 26)], 0, 0.25, '#c6c9ce')];
    for (let x = -130; x <= 150; x += 14) out.push(part([rect(x, -58, 6, 0.3)], 0.25, 0.3, '#ffffff'));
    const n = 24;
    for (let k = 0; k < n; k++) {
        const x = -115 + (k + 0.5) * 230 / n, z = 17.5 + 3 * Math.sin((x + 115) / 230 * TAU * 1.5);
        out.push(part([rect(x, 0, 230 / n + 0.05, 82)], 0.2, z, glass), part([rect(x, 0, 230 / n + 0.05, 94)], z, z + 1.6, white));
    }
    for (let x = -112; x <= 112; x += 8) for (const s of [-1, 1]) out.push(part([rect(x, s * 41.3, 0.6, 0.6)], 0.2, 14.5, white));
    out.push(part([rect(0, -49, 140, 10)], 6, 6.8, white));
    for (let x = -66; x <= 66; x += 12) out.push(part([rect(x, -53, 0.6, 0.6)], 0.25, 6, '#c9d0d8'));
    // телетрапы и самолёты носом к терминалу
    for (const x of [-90, -30, 30, 90]) {
        out.push(part([rect(x, 53, 3, 24)], 4, 7, '#c7ced6'), part([oval(x, 66, 2.6, 2.6, 10)], 0.2, 7, '#aab3bd'));
        plane(out, x + 6, 89, -Math.PI / 2);
    }
    for (let x = -130; x <= 130; x += 26) out.push(part([rect(x, 112, 14, 0.3)], 0.2, 0.25, '#f2c94c'));
    // диспетчерская вышка
    out.push(part([oval(150, -10, 3.6, 3.6, 16)], 0.2, 46, white), part([oval(150, -10, 6.6, 6.6, 16)], 46, 47, white));
    out.push(part([oval(150, -10, 7, 7, 16)], 47, 51, '#3f5f80'), part([oval(150, -10, 7.4, 7.4, 16)], 51, 52.5, white), part([oval(150, -10, 0.3, 0.3, 6)], 52.5, 60, '#c9d0d8'));
    return out;
}

// Ледовый каток «Медеу» (1691 м над морем): ледяная беговая дорожка 400 м,
// хоккейная коробка в центре, трибуны уступами, корпус и мачты с прожекторами
function medeu() {
    const ice = '#e0f2fb', track = '#b9def3', white = '#f6f7f9';
    const oval400 = (L, r, n = 14) => arc(L / 2, 0, r, r, -Math.PI / 2, Math.PI / 2, n).concat(arc(-L / 2, 0, r, r, Math.PI / 2, Math.PI * 1.5, n));
    const out = [part([rect(0, 0, 244, 156)], 0, 0.3, '#dfe3e6')];
    out.push(part([oval400(112, 38)], 0.3, 0.6, track), part(ringOf(oval400(112, 39.2), oval400(112, 38)), 0.3, 1.4, white));
    for (const r of [32, 26]) out.push(part(ringOf(oval400(112, r + 0.3), oval400(112, r - 0.3)), 0.6, 0.66, '#4f9bd0'));
    out.push(part([oval400(112, 26)], 0.6, 0.62, ice), part([rect(0, 0, 60, 26)], 0.62, 0.66, '#ffffff'));
    out.push(part([rect(0, 0, 0.4, 26)], 0.66, 0.7, '#e5484d'), part([rect(-10, 0, 0.6, 26)], 0.66, 0.7, '#4f8cff'), part([rect(10, 0, 0.6, 26)], 0.66, 0.7, '#4f8cff'));
    out.push(part(ringOf(rect(0, 0, 60.6, 26.6), rect(0, 0, 60, 26)), 0.6, 1.6, white));
    // трибуны: ряды уступами, синие, белые и красные
    const seats = ['#3f7fbf', '#3f7fbf', '#f6f7f9', '#3f7fbf', '#e5484d', '#3f7fbf', '#f6f7f9', '#3f7fbf', '#e5484d', '#3f7fbf'];
    seats.forEach((c, k) => out.push(part([rect(0, 46 + k * 2.6, 170 - k * 4, 2.6)], 0.3, 1.3 + k * 1.25, c)));
    seats.slice(0, 5).forEach((c, k) => out.push(part([rect(0, -46 - k * 2.6, 150 - k * 6, 2.6)], 0.3, 1.3 + k * 1.1, c)));
    out.push(part([rect(0, 73, 140, 4)], 0.3, 15, white), part([rect(0, 73, 142, 6)], 15, 16, '#c9d0d8'));
    // корпус с востока
    striped(out, rect(108, 0, 22, 64), 0.3, 14, 3.6, white, '#8fb3d3', 0.6);
    out.push(part([rect(108, 0, 23, 65)], 14, 15, '#7f8b99'));
    for (const [sx, sy] of CORNERS) out.push(part([rect(sx * 92, sy * 62, 1.4, 1.4)], 0.3, 36, '#c9d0d8'), part([rect(sx * 92, sy * 62, 7, 2)], 36, 39, '#fff6c9'));
    return out;
}

// Канатная дорога Медеу — Шымбулак: нижняя станция, опоры, тросы и кабинки
function shymbulak() {
    const out = [part([rect(0, 0, 50, 32)], 0, 0.3, '#e1ddd3')];
    out.push(part([rect(0, 0, 40, 22)], 0.3, 7.5, '#9fc3e0'));
    for (let k = 0; k < 4; k++) out.push(part([rect(-1.5 + k * 1.5, 0, 43 - k * 3, 24)], 7.5 + k * 1.1, 8.6 + k * 1.1, k % 2 ? '#8a6a52' : '#7a5a43'));
    out.push(part([rect(16, 0, 10, 14)], 7.5, 12, '#e5484d'), part([oval(19, 0, 5, 5, 16)], 12, 12.6, '#c9d0d8'));
    const towers = [[75, 22], [150, 26], [225, 30]];
    for (const [x, h] of towers) {
        out.push(part([rect(x, 0, 2.4, 2.4)], 0, h, '#c3cad3'), part([rect(x, 0, 2, 13)], h, h + 1.2, '#9aa3ad'));
        for (const s of [-1, 1]) out.push(part([rect(x, s * 5.6, 1.4, 1.6)], h + 1.2, h + 1.8, '#5c636b'));
    }
    // два троса; кабинки висят на тросе
    const pts = [[22, 10.5], ...towers.map(([x, h]) => [x, h + 1.4])];
    for (const s of [-5.6, 5.6]) for (let i = 0; i < pts.length - 1; i++) wire(out, [pts[i][0], s, pts[i][1]], [pts[i + 1][0], s, pts[i + 1][1]], 0.35, '#5c636b');
    const colors = ['#f6f7f9', '#e5484d', '#3f7fbf'];
    for (let k = 0; k < 9; k++) {
        const x = 40 + k * 21, s = k % 2 ? 5.6 : -5.6;
        const i = Math.min(pts.length - 2, pts.findIndex(p => p[0] > x) - 1);
        const z = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * (x - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
        out.push(part([rect(x, s, 0.3, 0.3)], z - 1.6, z, '#5c636b'), part([rect(x, s, 2.6, 2.4)], z - 4.4, z - 1.6, colors[k % 3]), part([rect(x, s, 2.7, 2.5)], z - 3.2, z - 2.4, '#7fb6dd'));
    }
    return out;
}

// Зелёный базар: ряды под зелёной кромкой, большой павильон с зелёными сводами,
// вход с вывеской и пёстрые навесы уличной торговли
function bazaar() {
    const wall = '#ece8dd', green = '#5fa784', greenD = '#4b8f6f', glass = '#a9c9e2';
    const out = [part([rect(0, 0, 150, 150)], 0, 0.3, '#e3dfd4')];
    out.push(part(ringOf(rect(0, 0, 130, 124), rect(0, 0, 90, 90)), 0.3, 5.5, wall), part(ringOf(rect(0, 0, 131, 125), rect(0, 0, 89, 89)), 5.5, 6.4, green));
    for (let x = -60; x <= 60; x += 6) for (const s of [-1, 1]) out.push(part([rect(x, s * 62.2, 3.6, 0.3)], 1, 4.6, glass));
    // павильон: стены и четыре зелёных свода
    out.push(part([rect(0, 0, 86, 86)], 0.3, 8, '#f2efe6'), part([rect(0, 0, 87, 87)], 8, 8.8, green));
    for (let i = 0; i < 4; i++) {
        const x = -32.25 + i * 21.5;
        for (let k = 0; k < 5; k++) {
            const t = (k + 0.5) / 5;
            out.push(part([rect(x, 0, 21.5 * Math.sqrt(1 - t * t), 86)], 8.8 + 6 * k / 5, 8.8 + 6 * (k + 1) / 5, k % 2 ? greenD : green));
        }
    }
    // вход с юга: портал, зелёная вывеска с белыми «буквами»
    out.push(part([rect(0, -63, 26, 6)], 0.3, 15, wall), part([rect(0, -66.2, 14, 0.5)], 0.3, 8, glass));
    out.push(part([rect(0, -66.3, 24, 0.6)], 10, 13.6, '#3d8f63'));
    for (let k = 0; k < 9; k++) out.push(part([rect(-10 + k * 2.5, -66.7, 1.6, 0.3)], 10.9, 12.7, '#ffffff'));
    // навесы уличной торговли
    const tints = ['#e5484d', '#f2b15a', '#3f7fbf', '#5fa784', '#f6f7f9'];
    for (let k = 0; k < 10; k++) {
        const x = -64 + k * 7 + (k > 4 ? 30 : 0);
        out.push(part([rect(x, -70, 5.6, 4)], 2.4, 2.8, tints[k % 5]), part([rect(x, -69, 4.6, 2)], 0.3, 1.1, '#c8a46e'));
    }
    for (const [x, y] of [[-70, 30], [-70, -20], [70, 30], [70, -20], [40, -70], [-40, 70], [40, 70]]) tree(out, x, y, 9, 3.2, '#6fb352', 0.3);
    return out;
}

// Точка внутри многоугольника (для машин на парковке)
function inPoly(x, y, ring) {
    let yes = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) yes = !yes;
    }
    return yes;
}

// Парковка по контуру: серый асфальт и машины рядами (часть мест свободна)
function parking(out, ring, seed) {
    out.push(part([ring], 0, 0.15, '#c9cdd3'));
    const pal = ['#f4f6f8', '#2b2f36', '#c0c6cd', '#e5484d', '#3d6fa8', '#8e9aa6', '#f4f6f8', '#5a5f66'];
    const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
    let k = seed;
    for (let x = Math.min(...xs) + 4; x < Math.max(...xs) - 2; x += 6.2) {
        for (let y = Math.min(...ys) + 2; y < Math.max(...ys) - 1; y += 2.7) {
            k = (Math.imul(k, 1103515245) + 12345) & 0x7fffffff;
            if (k % 10 < 6 || !inPoly(x, y, ring)) continue;
            out.push(part([rect(x, y, 4.4, 1.9)], 0.15, 1.5, pal[k % pal.length]));
        }
    }
}

// MEGA Alma-Ata — по настоящему контуру из OpenStreetMap: южный корпус и северный с полукруглым
// стеклянным фасадом, красные буквы MEGA, кинотеатр на крыше; парковки с машинами и колесо
// обозрения Happy Eye — там, где они на самом деле (жилые «Мега Тауэр» рядом остаются свои)
const MEGA = {
    outline: [[-76.5, 8], [-75.5, -44], [-73.5, -44.5], [-73.5, -50.5], [-34.5, -50.5], [-3.5, -50.5], [-3.5, -59.5], [-34.5, -60], [-34, -68], [-30, -250], [93.5, -248.5], [91.5, -200.5], [90.5, -178.5], [89, -94.5], [89.5, -65], [89.5, -59], [25.5, -60], [25.5, -53], [68, -52], [67.5, -25.5], [84.5, -11.5], [94, 0.5], [99.5, 13], [103, 23], [105.5, 34], [104, 46], [100, 67.5], [91.5, 84], [81.5, 96.5], [71.5, 103.5], [69, 105.5], [68.5, 147.5], [70, 148.5], [-36.5, 147.5], [-37, 90.5], [-77.5, 89.5], [-76, 69.5], [-84.5, 66], [-92, 59.5], [-93.5, 57], [-98, 49], [-99.5, 41.5], [-99.5, 36.5], [-98.5, 31], [-95.5, 23], [-92.5, 18.5], [-88.5, 14.5], [-83, 11], [-79.5, 9]],
    parks: [[[177.5, -160], [122.5, -159.5], [115.5, -182.5], [93.5, -200], [95, -250], [109.5, -250], [115, -250], [142, -250], [176, -250.5]],
            [[106.5, -22], [173.5, -18.5], [173, 26.5], [105.5, 25], [101.5, 11.5], [87.5, -13], [73.5, -24.5], [74, -45.5], [81, -53.5], [102.5, -52.5], [104, -44.5]],
            [[73.5, 144], [160.5, 147], [162.5, 86.5], [99.5, 84], [92, 92], [79, 104], [73, 106.5]],
            [[69, 179], [70, 148.5], [113, 151], [168.5, 153.5], [168, 183.5], [168, 184.5]],
            [[-123, -153.5], [-123, -164.5], [-65.5, -164], [-65.5, -167], [-50, -167.5], [-51, -153.5]],
            [[-132, -67.5], [-131, -114.5], [-118, -114], [-118.5, -67.5]]]
};

function mega() {
    const wall = '#efe8db', band = '#d7cfbf', glass = '#9fc3e0', red = '#e5484d';
    const out = [];
    MEGA.parks.forEach((ring, i) => parking(out, ring, 7 + i * 13));
    // корпус: светлые стены, пояс между этажами, серо-голубая крыша
    out.push(part([MEGA.outline], 0, 16, wall), part([MEGA.outline], 16, 16.6, '#c7d3dc'));
    out.push(part([grow(MEGA.outline, 1.004, ...mid(MEGA.outline))], 7.6, 8.4, band));
    // полукруглый стеклянный фасад к парковке, навес над входом, красные буквы MEGA
    out.push(part([arcRing(38, 42, 70.5, 67.5, -0.86, 1.07, 24)], 0.3, 16, glass));
    out.push(part([arcRing(38, 42, 75, 70.5, -0.35, 0.6, 10)], 5, 5.6, '#ffffff'));
    for (let k = 0; k < 4; k++) {
        const a = -0.12 + k * 0.11;
        out.push(part([rect(38 + Math.cos(a) * 71, 42 + Math.sin(a) * 71, 6, 0.9, a + Math.PI / 2)], 16.6, 21.5, red));
    }
    // кинотеатр и стеклянные фонари на крыше, техника
    out.push(part([rect(15, 118, 60, 40)], 16.6, 25, '#6b5ca5'), part([rect(15, 118, 61, 41)], 25, 25.8, '#ffffff'));
    for (let y = -230; y <= -90; y += 35) out.push(part([rect(30, y, 50, 8)], 16.6, 18.6, glass));
    for (const [x, y] of [[-20, 20], [-60, 40], [0, -170], [60, -120], [40, 60]]) out.push(part([rect(x, y, 10, 6)], 16.6, 18.8, '#c9ced6'));
    // колесо обозрения Happy Eye: обод из кубиков, спицы, кабинки, две опоры
    const wx = 149, wy = -130, wz = 23, WR = 20;
    for (let k = 0; k < 40; k++) {
        const t = k / 40 * TAU, z = wz + Math.sin(t) * WR;
        out.push(part([rect(wx + Math.cos(t) * WR, wy, 1.1, 1.1)], z - 0.55, z + 0.55, '#f4f6f8'));
        if (k % 4 === 0) out.push(part([rect(wx + Math.cos(t) * (WR + 1.5), wy, 2.2, 2.2)], z - 2.6, z - 0.4, ['#e5484d', '#3f7fbf', '#f2b15a', '#2fb67c'][k / 4 % 4]));
    }
    for (let k = 0; k < 8; k++) {
        const t = k / 8 * TAU;
        beam(out, [wx, wy, wz], [wx + Math.cos(t) * WR, wy, wz + Math.sin(t) * WR], 0.5, '#d9dde3');
    }
    for (const s of [-1, 1]) beam(out, [wx + s * 8, wy, 0], [wx, wy, wz], 1, '#c9d0d8');
    return out;
}

// Dostyk Plaza: бежевый камень с лентами окон, стеклянный атриум-свод у входа
function dostykplaza() {
    const stone = '#e8dcbc', glass = '#a5c7e4', band = '#c9b98f';
    const out = [part([rect(0, -5, 150, 132)], 0, 0.3, '#e4e0d6')];
    striped(out, rect(0, 12, 140, 96), 0.3, 24, 4.8, stone, glass, 0.68);
    out.push(part([rect(0, 12, 141, 97)], 24, 25, band), part([rect(0, 12, 136, 92)], 25, 26.5, '#b9c0c8'));
    // атриум: стеклянный объём со сводом и рёбрами
    out.push(part([rect(0, -46, 50, 22)], 0.3, 24, glass));
    for (let x = -24; x <= 24; x += 4) out.push(part([rect(x, -57.2, 0.5, 0.5)], 0.3, 24, '#eef2f6'));
    for (let k = 0; k < 6; k++) {
        const t = (k + 0.5) / 6;
        out.push(part([rect(0, -46, 50 * Math.sqrt(1 - t * t), 22)], 24 + 7 * k / 6, 24 + 7 * (k + 1) / 6, k % 2 ? '#c4dbee' : '#a5c7e4'));
    }
    out.push(part([rect(0, -57.4, 30, 0.5)], 20, 22.4, '#d6b25e'), part([rect(0, -60, 34, 6)], 5.5, 6.2, '#f6f7f9'));
    for (const x of [-60, -45, 45, 60]) tree(out, x, -58, 8, 3, '#6fb352', 0.3);
    return out;
}

// Жилой квартал с белыми каскадными башнями, как новые ЖК у Аль-Фараби:
// белые рамы, тёмные окна, бирюзовое стекло, двор с площадкой
function cascadeHomes() {
    const white = '#f7f7f4', win = '#4f5d6b', teal = '#2fa39a';
    const out = [part([rect(0, 0, 110, 92)], 0, 0.3, '#cfe7c8')];
    for (const [x, y, h] of [[-30, 20, 96], [30, 20, 104], [0, -24, 88]]) {
        striped(out, rect(x, y, 24, 24), 0.3, h - 12, 3.2, win, white, 0.45);
        for (const [sx, sy] of CORNERS) out.push(part([rect(x + sx * 11.4, y + sy * 11.4, 1.4, 1.4)], 0.3, h - 12, white));
        for (let k = 0; k < 3; k++) {
            const w = 20 - k * 4.5, z = h - 12 + k * 4;
            striped(out, rect(x, y, w, w), z, z + 4, 3.2, win, white, 0.45);
            out.push(part(ringOf(rect(x, y, w + 1.2, w + 1.2), rect(x, y, w - 0.2, w - 0.2)), z + 3.2, z + 4.4, white));
        }
    }
    striped(out, rect(42, -28, 22, 30), 0.3, 18, 3.6, teal, '#e6f3f2', 0.7);
    out.push(part([rect(-10, 0, 16, 10)], 0.3, 0.5, '#f2c48a'), part([rect(-12, 2, 3, 3)], 0.5, 2.4, '#e5484d'));
    for (const [x, y] of [[-45, -10], [-48, -35], [20, -40], [5, 45], [-5, 40], [50, 0]]) tree(out, x, y, 8, 3, '#74b558', 0.3);
    return out;
}

// ======================= Аль-Фараби у Сейфуллина =======================
// Настоящие дома вдоль проспекта (контуры — из OpenStreetMap), раскрашенные как на фото.
// В список стройки не попадают (группа scene): это просто «декорации» на своих местах.
// fps — контуры домов: по ним прячем серые дома карты и не сажаем деревья.

// Фасад жилой башни: окна полосами, светлые углы, парапет и будка на крыше.
// tan — низ белый, середина бежево-коричневая, верх снова белый (как у новых ЖК)
function homeTower(out, ring, z0, h, style) {
    const win = '#56626e', white = '#f4f2ec', [cx, cy] = mid(ring);
    if (style === 'tan') {
        const z1 = z0 + (h - z0) * 0.3;
        striped(out, ring, z0, z1, 3.2, win, white, 0.45);
        striped(out, ring, z1, h - 6.4, 3.2, win, '#b8946a', 0.45);
        striped(out, ring, h - 6.4, h, 3.2, win, white, 0.45);
    } else if (style === 'teal') striped(out, ring, z0, h, 3.2, '#6c9799', '#e7eef0', 0.7);
    else striped(out, ring, z0, h, 3.2, '#5b6977', white, 0.45);
    for (const [x, y] of ring) out.push(part([rect(x, y, 1.2, 1.2)], z0, h, style === 'teal' ? '#e7eef0' : white));
    out.push(part([grow(ring, 1.02, cx, cy)], h, h + 1.2, '#eceae4'), part([grow(ring, 0.45, cx, cy)], h + 1.2, h + 4.5, '#d9d6cf'));
}

// Южная сторона: стеклянные офисы (дома 40, 38, 36, 34) и стеклянный навес между 38 и 36
const FARABI_S = {
    o40: [[-112, -50], [-112, -48], [-92, -33], [-78.5, -51.5], [-67, -66], [-61.5, -73.5], [-56, -80], [-37, -98.5], [-47, -109], [-59.5, -118.5], [-61, -117], [-70.5, -124.5], [-73.5, -120.5], [-95, -91.5], [-121, -62], [-118.5, -55]],
    o38: [[-74, -18], [-49.5, 2], [-4.5, -55], [-22.5, -78], [-31, -70], [-52, -50]],
    o36: [[-10, 39.5], [-18, 31.5], [28, -25], [34, -18.5], [46, -11], [42, -3], [36.5, 8.5], [33.5, 15], [31, 18.5], [25, 26], [4.5, 52.5], [3, 54.5]],
    o34: [[27, 75.5], [65, 21.5], [68.5, 15.5], [71.5, 9.5], [73, 5.5], [87.5, 10], [98, 15.5], [114.5, 25.5], [88.5, 61], [86, 65], [83.5, 70.5], [82.5, 76.5], [82, 84], [81, 100.5], [68, 100], [63.5, 99.5], [57, 98], [51.5, 96], [46, 92.5], [41, 89.5], [35, 83.5], [30, 79.5]],
    roof: [[-49.5, 2], [-18, 31.5], [28, -25], [-4.5, -55]]
};

function farabiSouth() {
    const S = FARABI_S, out = [];
    // синее стекло с тёмными перекрытиями (дом 40 — изогнутый, внизу вывеска Halyk) и
    // стекло в каменной раме (38, 36 — Jusan); 34 — стекло с отступом верхнего этажа
    striped(out, S.o40, 0, 28, 4, '#7ea8d2', '#4a6a8c', 0.8);
    out.push(part([rect(-102.3, -40.1, 12, 0.5, 0.644)], 3.2, 5.4, '#1f9a57'), part([rect(-102.5, -39.9, 7, 0.3, 0.644)], 4, 4.6, '#ffffff'));
    for (const [ring, h] of [[S.o38, 34], [S.o36, 28]]) {
        striped(out, ring, 0, h, 4, '#86aed6', '#ddd3c2', 0.7);
        for (const [x, y] of ring) out.push(part([rect(x, y, 1.6, 1.6)], 0, h + 0.6, '#e2d9c8'));
    }
    striped(out, S.o34, 0, 28, 4, '#7ea8d2', '#4a6a8c', 0.8);
    const [x34, y34] = mid(S.o34);
    striped(out, grow(S.o34, 0.9, x34, y34), 28, 32, 4, '#9cc0e2', '#4a6a8c', 0.8);
    for (const [ring, h] of [[S.o40, 28], [S.o38, 34], [S.o36, 28], [S.o34, 28]]) out.push(part([grow(ring, 1.006, ...mid(ring))], h, h + 0.8, '#d6dde5'));
    // оранжевая вертикальная вывеска JUSAN на фасаде к проспекту
    out.push(part([rect(-3.9, 47.3, 2.6, 0.5, 0.857)], 6, 26, '#ef7d22'));
    for (let z = 8; z < 25; z += 4.5) out.push(part([rect(-4.1, 47.5, 1.4, 0.4, 0.857)], z, z + 0.5, '#ffffff'));
    // навес: наклонная решётка из стекла и стали — от дома 38 (18 м) вверх к дому 36 (30 м)
    const [A, B, C, D] = S.roof, lerp2 = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const n = 10;
    for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n, z = 18 + 12 * (k + 0.5) / n;
        out.push(part([[lerp2(A, B, t0), lerp2(A, B, t1), lerp2(D, C, t1), lerp2(D, C, t0)]], z - 0.4, z + 0.2, k % 2 ? '#d6e2ec' : '#c3d3e2'));
    }
    for (let s = 0; s <= 1.001; s += 1 / 6) {
        const p = lerp2(A, D, s), q = lerp2(B, C, s);
        wire(out, [p[0], p[1], 18.4], [q[0], q[1], 30.4], 0.35, '#eef2f6');
    }
    return out;
}

// Северная сторона: ЖК Al'Farabi 27/4 (белые башни по 21 этажу), A27 (бирюзовое стекло),
// тёмный стеклянный подиум и комплекс «21» — длинный подиум с навесом и десять
// бежево-коричневых башен по 77 м (низ и верх белые — как на фото)
const FARABI_N = {
    teal: [[[-103, -120], [-120, -101], [-99.5, -83], [-91.5, -92.5], [-83, -101.5]],
           [[-57.5, -129.5], [-74.5, -110.5], [-64, -101.5], [-54, -92.5], [-37, -111.5]]],
    white: [[[-156.5, -63], [-173, -44.5], [-152, -26], [-144, -35.5], [-135.5, -45]],
            [[-103, -50], [-119.5, -31], [-98.5, -13], [-90, -22.5], [-82, -31.5]],
            [[-141, 15.5], [-140, 40.5], [-112, 39.5], [-113, 14.5], [-127, 15]],
            [[-25.5, 15], [-42, 34], [-31.5, 43], [-21, 52], [-9.5, 38.5], [-4.5, 33]],
            [[-93, 66.5], [-92, 91.5], [-64.5, 90], [-65.5, 65], [-74, 65.5]]],
    // тёмное стекло: [высота, контур]
    dark: [[7, [[-83, -101.5], [-103, -120], [-78, -147.5], [-57.5, -129.5], [-74.5, -110.5]]],
           [4, [[-156.5, -63], [-135.5, -45], [-112, -70], [-133, -89], [-142.5, -78.5]]],
           [19, [[-46, -49.5], [-8.5, -90.5], [2.5, -80.5], [4, -79], [4, -77], [4, -75], [3.5, -73], [-16.5, -51], [-30.5, -35.5]]],
           [6.5, [[-16.5, -51], [-30.5, -35.5], [-1, -8], [10.5, -20.5], [13.5, -24]]],
           [13, [[3.5, -73], [26, -52], [38.5, -40], [37, -41], [35, -42], [32.5, -41.5], [30, -40.5], [13.5, -24], [-16.5, -51]]],
           [19, [[10.5, -20.5], [13.5, -24], [30, -40.5], [32.5, -41.5], [35, -42], [37, -41], [38.5, -40], [48.5, -32], [25, -6.5]]],
           [10, [[26, -52], [38.5, -40], [39.5, -42], [40, -44], [39.5, -46], [38.5, -48], [37.5, -49], [35.5, -50]]]],
    tan: [[[5.5, 94.5], [10, 88.5], [5.5, 84.5], [15, 73], [25, 61], [29, 64], [34.5, 57], [47.5, 67.5], [47, 82], [39.5, 91], [30.5, 101.5], [23.5, 96], [17, 104]],
          [[141, 49.5], [141, 77.5], [169, 77.5], [169, 50]],
          [[16.5, 138], [17, 165], [44.5, 164.5], [44, 137.5]],
          [[103.5, 23.5], [103.5, 50.5], [131, 50], [131, 23]],
          [[141, 101], [141.5, 127.5], [169, 127], [168.5, 100.5]],
          [[-20.5, 109.5], [-20, 136.5], [7.5, 136.5], [7, 109.5]],
          [[141.5, 149.5], [141.5, 176.5], [169, 176.5], [169, 149]],
          [[45, 30.5], [45, 56.5], [70.5, 56], [70.5, 30]],
          [[56, 164], [56, 190.5], [83.5, 190.5], [83.5, 163.5]],
          [[140.5, 209.5], [140.5, 182], [113, 182.5], [113.5, 209.5]]],
    podium: [[42.5, 30.5], [81.5, -15], [114.5, -14.5], [189, 35], [202, 75], [192, 199], [197, 201], [191.5, 216], [169.5, 207], [140.5, 207], [140.5, 182], [141.5, 176.5], [169, 176.5], [169, 149.5], [141.5, 149.5], [141.5, 127.5], [169, 127.5], [168.5, 100.5], [141.5, 100.5], [141, 77.5], [169, 77.5], [169, 49.5], [141.5, 49.5], [131, 50], [131, 23], [103.5, 23.5], [104, 50], [70.5, 50.5], [70.5, 30], [44.5, 30.5]]
};

function farabiNorth() {
    const N = FARABI_N, out = [];
    for (const ring of N.teal) homeTower(out, ring, 0, 67, 'teal');
    for (const ring of N.white) homeTower(out, ring, 0, 67, 'white');
    for (const [h, ring] of N.dark) {
        striped(out, ring, 0, h, 4, '#5d6f84', '#3e4a59', 0.78);
        out.push(part([ring], h, h + 0.6, '#8e98a3'));
    }
    // комплекс «21»: стеклянный низ, бежевый верх, широкий навес-карниз вдоль проспекта
    const [px, py] = mid(N.podium);
    out.push(part([N.podium], 0, 5, '#6f8296'), part([N.podium], 5, 7.6, '#dccba6'), part([grow(N.podium, 1.02, px, py)], 7.6, 8.4, '#d4bd92'));
    for (const ring of N.tan) homeTower(out, ring, 0, 77, 'tan');
    return out;
}

// ---------- Каталог ----------
export const MODEL_GROUPS = [
    ['almaty', 'Алматы'],
    ['city', 'Город'],
    ['towers', 'Небоскрёбы и башни'],
    ['wonders', 'Чудеса света и памятники'],
    ['modern', 'Современная архитектура'],
    ['fun', 'Торговля и развлечения']
];

// where — где стоит настоящее; icon — маленькая иконка (SVG 24×24) для списка;
// fp — контур на земле (по нему проверяем, свободно ли место);
// pop / jobs / attr — жители, рабочие места, «притяжение» туристов и покупателей
export const MODELS = {
    kazakhstan:{ group: 'almaty', name: 'Гостиница «Казахстан»', where: 'Алматы', height: 102, jobs: 900, attr: 3000, months: 30, fp: rect(0, -25, 103, 148), parts: kazakhstan,
                 icon: 'M8 21V8h8v13M7 8h10M8 8l1-3 1.5 1.5L12 4l1.5 2.5L15 5l1 3M12 4V2M10.5 11v7M13.5 11v7M5 21h14' },
    koktobe:   { group: 'almaty', name: 'Телебашня Кок-Тобе', where: 'Алматы', height: 372, jobs: 150, attr: 6000, months: 30, fp: rect(-6, -3, 64, 46), parts: koktobe,
                 icon: 'M12 1v6M10 7h4v2h-4zM11 9L8 21M13 9l3 12M9.4 15h5.2M10.4 12h3.2M6 21h12' },
    nurlytau:  { group: 'almaty', name: 'Бизнес-центр «Нурлы Тау»', where: 'Алматы', height: 141, jobs: 15000, attr: 3000, months: 36, fp: rect(-24, 10, 240, 324), parts: nurlytau,
                 icon: 'M4 21V9l2.5-4L9 9v12M14 21V7l2.5-4L19 7v14M9 21v-6h5M2 21h20' },
    rixos:     { group: 'almaty', name: 'Rixos Almaty', where: 'Алматы', height: 44, jobs: 600, attr: 2500, months: 20, fp: rect(0, 0, 96, 62), parts: rixos,
                 icon: 'M3 21V10h18v11M3 10h18M9 10a3 3 0 0 1 6 0M12 7V5M7 21v-6M17 21v-6M10 21v-4h4v4' },
    esentai:   { group: 'almaty', name: 'Esentai Tower · The Ritz-Carlton', where: 'Алматы', height: 162, jobs: 5000, attr: 4000, months: 34, fp: rect(0, -10, 72, 76), parts: esentai,
                 icon: 'M7 21V3l5 2v16M12 5l5 2v14M7 13h10M4 21h16' },
    esentaimall:{ group: 'almaty', name: 'Esentai Mall', where: 'Алматы', height: 32, jobs: 2500, attr: 14000, months: 20, fp: rect(0, -6, 132, 76), parts: esentaimall,
                 icon: 'M3 21V10h13v11M18 21V4h3v17M5 13l2 2 2-2 2 2 2-2M2 21h20' },
    cathedral: { group: 'almaty', name: 'Вознесенский собор', where: 'Алматы', height: 47, jobs: 50, attr: 3000, months: 24, fp: rect(0, 0, 76, 50), parts: cathedral,
                 icon: 'M12 1v3M10.5 7a1.5 2 0 0 1 3 0M10 7h4v4h-4zM5 21v-8h14v8M7 13l1-2h8l1 2M11 21v-3h2v3M3 21h18' },
    kbtu:      { group: 'almaty', name: 'КБТУ (Дом Правительства)', where: 'Алматы', height: 50, jobs: 1500, attr: 6000, months: 26, fp: rect(0, -14, 114, 136), parts: kbtu,
                 icon: 'M12 2v3M9.5 8a2.5 2.5 0 0 1 5 0M3 21V11h18v10M3 11h18M6 11v10M9 11v10M15 11v10M18 11v10M9 8h6v3H9z' },
    circus:    { group: 'almaty', name: 'Казахский цирк', where: 'Алматы', height: 34, jobs: 300, attr: 5000, months: 22, fp: oval(0, 0, 48, 48, 16), parts: circus,
                 icon: 'M3 21v-6a9 6 0 0 1 18 0v6M12 9V6M10 6h4M3 15h18M7 21v-4M12 21v-4M17 21v-4' },
    abai:      { group: 'almaty', name: 'Театр оперы и балета им. Абая', where: 'Алматы', height: 34, jobs: 600, attr: 4000, months: 24, fp: rect(0, -4, 64, 140), parts: abai,
                 icon: 'M3 21V10h18v11M3 10l9-5 9 5M6 10v11M9 10v11M12 10v11M15 10v11M18 10v11M2 21h20' },
    almaty2:   { group: 'almaty', name: 'Вокзал Алматы-2', where: 'Алматы', height: 22, jobs: 1000, attr: 16000, months: 20, fp: rect(0, 22, 190, 96), parts: almaty2,
                 icon: 'M2 20v-8h20v8M7 12V8h10v4M9.5 12a2.5 2.5 0 0 1 5 0M2 22h20' },
    almaty1:   { group: 'almaty', name: 'Вокзал Алматы-1', where: 'Алматы', height: 39, jobs: 800, attr: 12000, months: 20, fp: rect(0, 18, 170, 84), parts: almaty1,
                 icon: 'M2 21v-7h20v7M8 14V9h8v5M12 9V5M11 3l1 2 1-2M10 21v-3h4v3' },
    airport:   { group: 'almaty', name: 'Аэропорт Алматы', where: 'Алматы', height: 60, jobs: 6000, attr: 20000, months: 36, fp: rect(10, 25, 320, 196), parts: airport,
                 icon: 'M2 16l9-3V6a1 1 0 0 1 2 0v7l9 3v2l-9-2v4l2 1.5V23l-3-1-3 1v-1.5l2-1.5v-4l-9 2z' },
    medeu:     { group: 'almaty', name: 'Каток «Медеу»', where: 'Алматы', height: 39, jobs: 300, attr: 5000, months: 24, fp: rect(0, 0, 244, 156), parts: medeu,
                 icon: 'M2 17a10 4 0 1 0 20 0a10 4 0 1 0 -20 0M6 17a6 2 0 1 0 12 0a6 2 0 1 0 -12 0M3 9l5-5 4 4 3-3 6 6' },
    shymbulak: { group: 'almaty', name: 'Канатка Медеу — Шымбулак', where: 'Алматы', height: 32, jobs: 200, attr: 4000, months: 18, fp: rect(110, 0, 262, 32), parts: shymbulak,
                 icon: 'M2 17L22 5M5 15v6M19 7v14M10 12v3M8.5 15h3v3h-3zM2 21h20' },
    bazaar:    { group: 'almaty', name: 'Зелёный базар', where: 'Алматы', height: 15, jobs: 3000, attr: 20000, months: 16, fp: rect(0, 0, 150, 150), parts: bazaar,
                 icon: 'M3 21V11l9-6 9 6v10M3 11h18M7 21v-6h10v6M10 15v6M14 15v6' },
    mega:      { group: 'almaty', name: 'MEGA Alma-Ata', where: 'Алматы', height: 26, jobs: 4000, attr: 25000, months: 24, fp: rect(23, -33, 312, 437), parts: mega,
                 fps: [MEGA.outline, ...MEGA.parks, rect(149, -130, 44, 10)],
                 icon: 'M2 21V8h20v13M2 12h20M5 8V5h14v3M5 16h3M10.5 16h3M16 16h3' },
    dostykplaza:{ group: 'almaty', name: 'Dostyk Plaza', where: 'Алматы', height: 31, jobs: 2500, attr: 15000, months: 20, fp: rect(0, -5, 150, 132), parts: dostykplaza,
                 icon: 'M3 21V10h18v11M8 10a4 4 0 0 1 8 0M8 21v-6h8v6M3 14h18' },
    cascadehomes:{ group: 'almaty', name: 'Каскадные башни (ЖК)', where: 'Алматы', height: 104, pop: 3200, jobs: 200, months: 22, fp: rect(0, 0, 110, 92), parts: cascadeHomes,
                 icon: 'M4 21V9l2-2 2 2v12M10 21V6l2-2 2 2v15M16 21V9l2-2 2 2v12M2 21h20' },

    // Декорации на своих местах (в список стройки не попадают)
    farabiS:   { group: 'scene', name: 'Офисы на Аль-Фараби', where: 'Алматы', height: 34, jobs: 6000, months: 24, fp: rect(-3.5, -12, 236, 225), parts: farabiSouth,
                 fps: [FARABI_S.o40, FARABI_S.o38, FARABI_S.o36, FARABI_S.o34, FARABI_S.roof], icon: '' },
    farabiN:   { group: 'scene', name: 'Жилые комплексы на Аль-Фараби', where: 'Алматы', height: 82, pop: 9000, jobs: 800, months: 30, fp: rect(14.5, 34, 376, 364), parts: farabiNorth,
                 fps: [...FARABI_N.teal, ...FARABI_N.white, ...FARABI_N.dark.map(d => d[1]), ...FARABI_N.tan, FARABI_N.podium], icon: '' },

    housing:  { group: 'city', name: 'Жилой комплекс', height: 64, pop: 2600, jobs: 150, months: 14, fp: rect(0, 0, 112, 78), parts: housing,
                 icon: 'M4 20V9h6v11M10 20V5h8v15M3 20h18M13 8h2M13 11h2M13 14h2' },
    business:  { group: 'city', name: 'Бизнес-центр', height: 140, jobs: 6000, months: 20, fp: rect(0, 0, 98, 70), parts: business,
                 icon: 'M5 20V6h5v14M10 20V3h5v17M15 20V9h4v11M3 20h18' },
    tower:     { group: 'city', name: 'Небоскрёб', height: 232, jobs: 3500, months: 18, fp: oval(0, 0, 26, 26, 8), parts: tower,
                 icon: 'M9 21V6l3-3 3 3v15M7 21h10M12 3V1M9 10h6M9 15h6' },
    mall:      { group: 'city', name: 'Торговый центр', height: 26, jobs: 1800, attr: 9000, months: 12, fp: rect(0, -27, 172, 168), parts: mall,
                 icon: 'M3 9l2-4h14l2 4M4 9v11h16V9M3 9h18M10 20v-5h4v5' },
    stadium:   { group: 'city', name: 'Стадион', height: 49, jobs: 300, attr: 4000, months: 18, fp: oval(0, 0, 122, 98, 24), parts: stadium,
                 icon: 'M3 12a9 5 0 1 0 18 0a9 5 0 1 0 -18 0M7 12a5 2.5 0 1 0 10 0a5 2.5 0 1 0 -10 0' },

    burj:      { group: 'towers', name: 'Бурдж-Халифа', where: 'Дубай', height: 828, pop: 3000, jobs: 12000, attr: 9000, months: 36,
                 fp: oval(0, 0, 66, 66, 6, Math.PI / 6), parts: burj, icon: 'M12 1v4M11 5h2l1 6h-4zM10 11h4l1 10H9zM7 21h10' },
    eiffel:    { group: 'towers', name: 'Эйфелева башня', where: 'Париж', height: 330, jobs: 500, attr: 12000, months: 24, fp: rect(0, 0, 126, 126), parts: eiffel,
                 icon: 'M12 2v3M9.5 9h5M8 14h8M12 5L7 21M12 5l5 16M9.5 21q2.5-4 5 0' },
    empire:    { group: 'towers', name: 'Эмпайр-стейт-билдинг', where: 'Нью-Йорк', height: 443, jobs: 15000, attr: 4000, months: 30, fp: rect(0, 0, 122, 62), parts: empire,
                 icon: 'M12 1v4M10.5 5h3v3h-3zM9 8h6v4H9zM8 12h8v9H8zM6 21h12' },
    wtc:       { group: 'towers', name: 'Всемирный торговый центр 1', where: 'Нью-Йорк', height: 541, jobs: 14000, attr: 3000, months: 36, fp: rect(0, 0, 68, 68), parts: wtc,
                 icon: 'M12 1v5M9 6h6l2 15H7zM9 6l3 15M15 6l-3 15' },
    taipei:    { group: 'towers', name: 'Тайбэй 101', where: 'Тайбэй', height: 508, jobs: 12000, attr: 6000, months: 32, fp: rect(0, 0, 72, 72), parts: taipei,
                 icon: 'M12 1v3M10 4h4M9 7h6l-1 3h-4zM9 10h6l-1 3h-4zM9 13h6l-1 3h-4zM8 16h8v5H8zM6 21h12' },
    lakhta:    { group: 'towers', name: 'Лахта Центр', where: 'Санкт-Петербург', height: 462, jobs: 10000, attr: 3000, months: 30, fp: oval(0, 0, 68, 68, 12), parts: lakhta,
                 icon: 'M12 1l3 20H9zM10.5 11h3M11 6h2' },
    petronas:  { group: 'towers', name: 'Башни Петронас', where: 'Куала-Лумпур', height: 452, jobs: 16000, attr: 4000, months: 36, fp: rect(0, -14, 112, 76), parts: petronas,
                 icon: 'M8 2v3M16 2v3M6.5 21V8L8 5l1.5 3v13M14.5 21V8L16 5l1.5 3v13M9.5 12h5M4 21h16' },
    cntower:   { group: 'towers', name: 'Си-Эн Тауэр', where: 'Торонто', height: 553, jobs: 600, attr: 8000, months: 30, fp: oval(0, 0, 34, 34, 8), parts: cntower,
                 icon: 'M12 1v8M9 9h6v2H9zM12 11v10M8 21l4-10 4 10M7 21h10' },
    burjalarab:{ group: 'towers', name: 'Бурдж-эль-Араб', where: 'Дубай', height: 321, jobs: 2500, attr: 5000, months: 30, fp: oval(0, 0, 51, 43, 24), parts: burjalarab,
                 icon: 'M7 21V3q10 6 10 18M5 21h14M17 10h3' },
    baiterek:  { group: 'towers', name: 'Байтерек', where: 'Астана', height: 105, jobs: 200, attr: 5000, months: 16, fp: oval(0, 0, 17, 17, 12), parts: baiterek,
                 icon: 'M9 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M12 9v12M9 11l3 2 3-2M8 21h8' },
    pisa:      { group: 'towers', name: 'Пизанская башня', where: 'Пиза', height: 56, jobs: 50, attr: 3000, months: 14, fp: oval(2, 0, 11, 11, 12), parts: pisa,
                 icon: 'M9 21l2-18h4l-2 18zM9.8 15h4.4M10.5 9h4.4M6 21h12' },

    pyramids:  { group: 'wonders', name: 'Пирамиды Гизы и Сфинкс', where: 'Египет', height: 139, jobs: 300, attr: 9000, months: 40, fp: rect(35, -40, 440, 360), parts: pyramids,
                 icon: 'M2 20l7-12 7 12zM13 20l4.5-7 4.5 7M1 20h22' },
    colosseum: { group: 'wonders', name: 'Колизей', where: 'Рим', height: 48, jobs: 200, attr: 7000, months: 30, fp: oval(0, 0, 95, 79, 24), parts: colosseum,
                 icon: 'M3 8a9 3 0 0 1 18 0v10a9 3 0 0 1-18 0zM3 8a9 3 0 0 0 18 0M7 12v6M12 12.5v6M17 12v6' },
    tajmahal:  { group: 'wonders', name: 'Тадж-Махал', where: 'Агра', height: 86, jobs: 200, attr: 8000, months: 28, fp: rect(0, -76, 200, 250), parts: tajmahal,
                 icon: 'M12 3c-4 4-5 6-5 8h10c0-2-1-4-5-8M12 1v2M5 21V11M19 21V11M7 21v-4h10v4M3 21h18' },
    liberty:   { group: 'wonders', name: 'Статуя Свободы', where: 'Нью-Йорк', height: 98, jobs: 100, attr: 6000, months: 18, fp: oval(0, 0, 51, 51, 16), parts: liberty,
                 icon: 'M12 7v6M9 13h6l1 4H8zM7 17h10v4H7zM15 3v6M14 3h2l-1-2zM10.5 7a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0' },
    bigben:    { group: 'wonders', name: 'Биг-Бен', where: 'Лондон', height: 96, jobs: 300, attr: 4000, months: 20, fp: rect(0, -19, 24, 64), parts: bigben,
                 icon: 'M12 1l3 5H9zM9 6h6v15H9zM10.5 10a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0M7 21h10' },
    stonehenge:{ group: 'wonders', name: 'Стоунхендж', where: 'Англия', height: 7, jobs: 20, attr: 2000, months: 6, fp: oval(0, 0, 54, 54, 16), parts: stonehenge,
                 icon: 'M3 20v-9h4v9M3 11h18M10 20v-9M14 20v-9M17 20v-9h4v9M2 20h20' },
    christ:    { group: 'wonders', name: 'Христос-Искупитель', where: 'Рио-де-Жанейро', height: 40, jobs: 50, attr: 4000, months: 12, fp: oval(0, 0, 19, 13, 16), parts: christ,
                 icon: 'M10.5 4.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0M3 8h18M12 6v13M9 19h6l1 2H8z' },
    whitehouse:{ group: 'wonders', name: 'Белый дом', where: 'Вашингтон', height: 30, jobs: 2000, attr: 2000, months: 20, fp: rect(0, 0, 190, 130), parts: whitehouse,
                 icon: 'M3 11h18M4 11v9h16v-9M8 11v9M12 11v9M16 11v9M8 11l4-4 4 4M2 20h20' },
    capitol:   { group: 'wonders', name: 'Капитолий', where: 'Вашингтон', height: 89, jobs: 4000, attr: 3000, months: 30, fp: rect(0, -8, 232, 96), parts: capitol,
                 icon: 'M12 2v2M8 9a4 4 0 0 1 8 0M7 9h10v3H7zM2 21v-7h20v7M2 14h20M9 21v-4h6v4' },

    opera:     { group: 'modern', name: 'Сиднейский оперный театр', where: 'Сидней', height: 67, jobs: 800, attr: 6000, months: 26, fp: rect(0, 0, 187, 120), parts: opera,
                 icon: 'M2 19h20M4 19c2-6 5-10 9-12-1 4-1 8 1 12M10 19c2-5 5-8 9-9-1 3-1 6 0 9' },
    mbs:       { group: 'modern', name: 'Марина Бэй Сэндс', where: 'Сингапур', height: 205, jobs: 9000, attr: 8000, months: 34, fp: rect(20, -36, 362, 112), parts: mbs,
                 icon: 'M2 6h20M5 6v15M12 6v15M19 6v15M3 21h18' },
    atomium:   { group: 'modern', name: 'Атомиум', where: 'Брюссель', height: 107, jobs: 100, attr: 5000, months: 20, fp: oval(0, 0, 48, 48, 12), parts: atomium,
                 icon: 'M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M4 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M16 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M4 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M16 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M7.5 7.5l3 3M16.5 7.5l-3 3M7.5 16.5l3-3M16.5 16.5l-3-3' },
    sphere:    { group: 'modern', name: 'Сфера', where: 'Лас-Вегас', height: 112, jobs: 600, attr: 9000, months: 24, fp: oval(0, 0, 82, 82, 24), parts: sphereLV,
                 icon: 'M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0M4 9h16M4 15h16M2 21h20' },
    louvre:    { group: 'modern', name: 'Лувр Абу-Даби', where: 'Абу-Даби', height: 39, jobs: 500, attr: 6000, months: 26, fp: oval(0, 0, 101, 101, 24), parts: louvre,
                 icon: 'M2 10q10-6 20 0M2 10h20M6 10v9M18 10v9M9 19v-5h6v5M1 19h22' },
    future:    { group: 'modern', name: 'Музей будущего', where: 'Дубай', height: 82, jobs: 300, attr: 5000, months: 22, fp: oval(0, 0, 47, 29, 16), parts: future,
                 icon: 'M4 13a8 7 0 1 0 16 0a8 7 0 1 0 -16 0M9 13a3 2.5 0 1 0 6 0a3 2.5 0 1 0 -6 0M3 21h18' },
    vessel:    { group: 'modern', name: 'The Vessel', where: 'Нью-Йорк', height: 47, jobs: 20, attr: 3000, months: 12, fp: oval(0, 0, 41, 41, 16), parts: vessel,
                 icon: 'M4 4h16l-5 16H9zM6 8h12M8 12h8M9 16h6' },

    dubaimall: { group: 'fun', name: 'Дубай Молл', where: 'Дубай', height: 37, jobs: 9000, attr: 15000, months: 30, fp: rect(0, -25, 362, 396), parts: dubaimall,
                 icon: 'M2 20V10l5-3 5 3 5-3 5 3v10M2 20h20M9 20v-5h6v5M7 7V4M17 7V4' },
    khanshatyr:{ group: 'fun', name: 'Хан Шатыр', where: 'Астана', height: 158, jobs: 3000, attr: 9000, months: 30, fp: oval(0, 0, 108, 104, 24), parts: khanshatyr,
                 icon: 'M12 2L4 20h16zM12 2v18M8 12h8M2 20h20' },
    disney:    { group: 'fun', name: 'Диснейленд', where: 'Калифорния', height: 60, jobs: 3000, attr: 14000, months: 30, fp: oval(0, 0, 131, 131, 24), parts: disney,
                 icon: 'M5 21v-9l1.5-3L8 12v9M16 21v-9l1.5-3 1.5 3v9M9 21V9l3-6 3 6v12M8 15h8M3 21h18' }
};
