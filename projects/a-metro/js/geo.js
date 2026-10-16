// ===== Геометрия на карте: расстояния в метрах, сглаживание, «ширина» линий =====

const R = 6371000;
const toRad = d => d * Math.PI / 180;

// Расстояние между точками [lon, lat] в метрах
export function dist(a, b) {
    const dLat = toRad(b[1] - a[1]), dLon = toRad(b[0] - a[0]);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
}

// Сдвиг точки на dx, dy метров (восток, север)
export function move(p, dx, dy) {
    return [p[0] + dx / (111320 * Math.cos(toRad(p[1]))), p[1] + dy / 110540];
}

// Вектор от a к b в метрах
function vec(a, b) {
    return [(b[0] - a[0]) * 111320 * Math.cos(toRad((a[1] + b[1]) / 2)), (b[1] - a[1]) * 110540];
}

export function lerp(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// Скругление углов: в каждом изломе — дуга (кривая Безье) радиусом до r метров
export function roundCorners(pts, r = 120, keep = new Set()) {
    if (pts.length < 3) return pts.slice();
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i - 1], p = pts[i], b = pts[i + 1];
        const rr = keep.has(i) ? r * 0.25 : r;           // у станций скругляем меньше
        const da = dist(a, p), db = dist(p, b);
        const d = Math.min(rr, da / 2.2, db / 2.2);
        const p1 = lerp(p, a, d / da), p2 = lerp(p, b, d / db);
        for (let k = 0; k <= 6; k++) {
            const t = k / 6, u = 1 - t;
            out.push([u * u * p1[0] + 2 * u * t * p[0] + t * t * p2[0], u * u * p1[1] + 2 * u * t * p[1] + t * t * p2[1]]);
        }
    }
    out.push(pts[pts.length - 1]);
    return out;
}

// Путь с накопленными расстояниями — чтобы быстро находить точку на нужном метре
export function measure(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    return { pts, cum, length: cum[cum.length - 1] };
}

// Точка на расстоянии s метров от начала пути
export function pointAt(path, s) {
    const { pts, cum, length } = path;
    s = Math.max(0, Math.min(length, s));
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    const seg = cum[hi] - cum[lo] || 1;
    return lerp(pts[lo], pts[hi], (s - cum[lo]) / seg);
}

// Кусок пути от s0 до s1 метров (для поезда, который изгибается по кривой)
export function slice(path, s0, s1) {
    const out = [pointAt(path, s0)];
    for (let i = 0; i < path.cum.length; i++) {
        if (path.cum[i] > s0 && path.cum[i] < s1) out.push(path.pts[i]);
    }
    out.push(pointAt(path, s1));
    return out;
}

// Где на пути ближе всего к точке: расстояние вдоль пути
export function project(path, p) {
    let best = Infinity, at = 0;
    for (let i = 1; i < path.pts.length; i++) {
        const a = path.pts[i - 1], b = path.pts[i];
        const ab = vec(a, b), ap = vec(a, p);
        const L = ab[0] ** 2 + ab[1] ** 2 || 1;
        const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1]) / L));
        const q = lerp(a, b, t);
        const d = dist(q, p);
        if (d < best) { best = d; at = path.cum[i - 1] + t * (path.cum[i] - path.cum[i - 1]); }
    }
    return { at, dist: best };
}

// Полоса шириной w метров вдоль линии — многоугольник для 3D (эстакада, поезд, платформа)
export function band(pts, w) {
    if (pts.length < 2) return null;
    const left = [], right = [];
    for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const v = vec(a, b);
        const L = Math.hypot(v[0], v[1]) || 1;
        const nx = -v[1] / L * w / 2, ny = v[0] / L * w / 2;
        left.push(move(pts[i], nx, ny));
        right.push(move(pts[i], -nx, -ny));
    }
    const ring = left.concat(right.reverse());
    ring.push(ring[0]);
    return [ring];
}

// Квадрат со стороной w метров вокруг точки (опора эстакады, вход в метро)
export function square(p, w, h = w, angle = 0) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const corners = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
        .map(([x, y]) => move(p, x * c - y * s, x * s + y * c));
    corners.push(corners[0]);
    return [corners];
}

// Направление пути в точке s (радианы, 0 — на восток)
export function angleAt(path, s) {
    const a = pointAt(path, s - 5), b = pointAt(path, s + 5);
    const v = vec(a, b);
    return Math.atan2(v[1], v[0]);
}
