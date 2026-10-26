// Поле с нотами: как ноты летят от краёв к кругу, отскакивают и исчезают.
// Рисуют им и сам уровень (game.js), и предпросмотр в редакторе — поэтому выглядит одинаково.
// v — «вид»: { ctx, geo, approach, hidden }; geo — размеры экрана и круга

import { polygon, starPath } from './fx.js?v=3';
import { clamp } from './util.js?v=1';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const SUCK = 0.32;               // за сколько секунд круг «засасывает» пропущенную ноту
export const BOUNCE = 0.45;             // сколько летит отбитая нота, пока не исчезнет

// Размеры поля и круга в центре
export function fitGeo(geo, W, H, minR = 30) {
    geo.W = W;
    geo.H = H;
    geo.cx = W / 2;
    geo.cy = H / 2;
    geo.rc = clamp(Math.min(W, H) * 0.075, minR, 64);
    geo.far = Math.hypot(W, H) / 2 + 40;
}

// Расстояние от центра до ноты, которой до круга осталось dt секунд
export const dist = (v, dt) => v.geo.rc + dt / v.approach * (v.geo.far - v.geo.rc);

// «Скрытые ноты»: исчезают, пролетев примерно две трети пути
function hiddenFade(v, d) {
    const u = (d - v.geo.rc) / (v.geo.far - v.geo.rc);
    return clamp((u - 0.3) / 0.2, 0, 1);
}

// Угол точки длинной ноты в момент tau: прямая, спираль или волна
export function holdAngle(n, tau) {
    const u = clamp((tau - n.t) / (n.end - n.t), 0, 1);
    return n.angle * DEG + (n.twist || 0) * TAU * u + (n.wiggle || 0) * Math.sin(u * TAU * (n.waves || 1));
}

// Ноты с номера s: сначала линии длинных, поверх — обычные
export function drawNotes(v, notes, s, t) {
    const horizon = t + v.approach;
    for (let k = s; k < notes.length && notes[k].t <= horizon; k++) {
        if (notes[k].type === 'hold') drawHold(v, notes[k], t);
    }
    for (let k = s; k < notes.length && notes[k].t <= horizon; k++) {
        if (notes[k].type === 'tap') drawTap(v, notes[k], t);
    }
    v.ctx.globalAlpha = 1;
}

// Где сейчас нота, которую ещё не отбили: { r — расстояние от центра, a — угол, s — размер, alpha }
export function placeNote(v, n, t) {
    const { geo } = v;
    const dt = n.t - t;
    const a = n.angle * DEG;
    if (dt >= 0) {
        const d = dist(v, dt);
        if (d > geo.far) return null;
        let alpha = clamp((geo.far - d) / 90, 0, 1); // мягко появляется у края
        if (v.hidden) alpha *= hiddenFade(v, d);
        return { r: d, a, s: 1, alpha };
    }
    // Пропущенная нота летит прямо в центр и исчезает
    const p = -dt / SUCK;
    if (p >= 1) return null;
    const e = p * p;
    const alpha = v.hidden ? 0 : (1 - e) * (n.state === 2 ? 0.7 : 1);
    return { r: geo.rc * (1 - e), a, s: 1 - p * 0.9, alpha };
}

export function drawTap(v, n, t) {
    const { ctx, geo } = v;
    const size = geo.rc * 0.42 * n.size;
    if (n.result === 'hit') {
        // Нажали — нота отскакивает от круга, крутится и тает, уменьшаясь
        const q = (t - n.hitAt) / BOUNCE;
        if (q < 0 || q >= 1) return;
        const e = 1 - (1 - q) ** 3;
        const r = n.hitR + (geo.rc * 1.5 + 90) * e;
        const a = n.hitA + n.kick * e;
        const s = size * n.hitS * (1 - q) ** 1.3;
        ctx.globalAlpha = 1 - q * q;
        drawShape(ctx, n, geo.cx + Math.cos(a) * r, geo.cy + Math.sin(a) * r, s, a + t * 1.6 + e * 6);
        if (n.twin) drawShape(ctx, n, geo.cx - Math.cos(a) * r, geo.cy - Math.sin(a) * r, s, -a - t * 1.6 - e * 6);
        return;
    }
    const p = placeNote(v, n, t);
    if (!p || p.alpha < 0.01) return;
    ctx.globalAlpha = p.alpha;
    const c = Math.cos(p.a), sn = Math.sin(p.a);
    const rotation = n.t > t ? p.a + t * 1.6 : p.a;
    drawShape(ctx, n, geo.cx + c * p.r, geo.cy + sn * p.r, size * p.s, rotation);
    if (n.twin) drawShape(ctx, n, geo.cx - c * p.r, geo.cy - sn * p.r, size * p.s, -rotation);
}

export function drawShape(ctx, n, x, y, s, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    shapePath(ctx, n.shape, s);
    ctx.lineJoin = 'round';
    if (n.hollow) {
        ctx.lineWidth = Math.max(3, s * 0.34);
        ctx.strokeStyle = '#fff';
        ctx.stroke();
    } else {
        ctx.lineWidth = 4;                           // тонкая чёрная обводка — ноты видно даже на вспышках
        ctx.strokeStyle = '#000';
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.fill();
    }
    ctx.restore();
}

// Контур фигуры вокруг точки (0, 0)
export function shapePath(ctx, shape, s) {
    switch (shape) {
        case 'circle':
            ctx.beginPath();
            ctx.arc(0, 0, s, 0, TAU);
            break;
        case 'square': polygon(ctx, 0, 0, 4, s * 1.25, Math.PI / 4); break;
        case 'triangle': polygon(ctx, 0, 0, 3, s * 1.35, -Math.PI / 2); break;
        case 'diamond':
            ctx.save();
            ctx.scale(0.72, 1);
            polygon(ctx, 0, 0, 4, s * 1.4, 0);
            ctx.restore();
            break;
        case 'hex': polygon(ctx, 0, 0, 6, s * 1.15, 0); break;
        default: starPath(ctx, 0, 0, s * 1.4, s * 0.62);
    }
}

// Точка длинной ноты для момента tau: опоздавшая часть летит прямо в центр
function holdPoint(v, n, tau, t) {
    const dt = tau - t;
    if (dt >= 0) return [dist(v, dt), holdAngle(n, tau)];
    const p = -dt / SUCK;
    if (p >= 1) return null;
    return [v.geo.rc * (1 - p * p), holdAngle(n, tau)];
}

// Длинная нота — линия: прямая, спираль или волна. Пока держишь, она «втягивается» в круг
export function drawHold(v, n, t) {
    const { ctx, geo } = v;
    const w = geo.rc * 0.34;
    if (n.result === 'hit') {
        // досидели до конца — кончик линии отскакивает и тает
        const q = (t - n.hitAt) / BOUNCE;
        if (q < 0 || q >= 1) return;
        const r = geo.rc + (geo.rc * 1.5 + 90) * (1 - (1 - q) ** 3);
        ctx.globalAlpha = 1 - q * q;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(geo.cx + Math.cos(n.hitA) * r, geo.cy + Math.sin(n.hitA) * r, w * 0.7 * (1 - q) ** 1.3, 0, TAU);
        ctx.fill();
        return;
    }
    const dead = n.state === 2;                      // промах или отпустили раньше
    const from = n.state === 1 ? t : Math.max(n.t, t - SUCK);
    if (from >= n.end) return;
    const pts = [];
    let headS = 1;
    for (let tau = from; ; tau += 0.012) {
        const tt = Math.min(tau, n.end);
        const p = holdPoint(v, n, tt, t);
        if (p) {
            if (p[0] > geo.far + 30) break;
            if (!pts.length) headS = tt < t ? 1 - (t - tt) / SUCK * 0.9 : 1;
            pts.push(geo.cx + Math.cos(p[1]) * p[0], geo.cy + Math.sin(p[1]) * p[0]);
        }
        if (tt >= n.end) break;
    }
    if (pts.length < 2) return;
    let alpha = dead ? 0.3 : 1;
    if (!dead && n.state !== 1 && v.hidden) alpha *= hiddenFade(v, dist(v, n.t - t));
    if (alpha < 0.01) return;
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]);
    ctx.lineWidth = w + 5;
    ctx.strokeStyle = '#000';
    ctx.stroke();
    ctx.lineWidth = w;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    // голова: пока летит — фигура, пока держишь — светится у круга
    if (n.state === 1) {
        ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t * 20);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(pts[0], pts[1], w * 0.95, 0, TAU);
        ctx.fill();
    } else if (!dead) {
        drawShape(ctx, n, pts[0], pts[1], geo.rc * 0.42 * n.size * headS, holdAngle(n, from) + t * 1.6);
    }
}
