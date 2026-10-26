// Эффекты на битах: вспышки с краёв и на весь экран, волны из центра и с краёв, залпы волн,
// звёздочки, линии, конфетти, многоугольники, тряска. Всё белое, как и вся игра.
// Время везде — секунды песни, поэтому на паузе эффекты замирают вместе с музыкой

import { mulberry32, pick } from './util.js?v=1';

const TAU = Math.PI * 2;
// Темы для дропов (меняются каждую фразу) и спокойные — для остальной песни
const THEMES = ['salvo', 'sides', 'stars', 'edges', 'lines', 'confetti', 'poly', 'squares'];
const CALM = ['ring', 'sides', 'poly', 'squares'];
const MAX_PARTS = 600;

export const FX_TYPES = [
    ['flash', 'Вспышка'], ['ring', 'Волна'], ['poly', 'Многоугольник'],
    ['square', 'Квадрат'], ['stars', 'Звёзды'], ['lines', 'Линии'],
    ['confetti', 'Конфетти'], ['shake', 'Тряска'], ['salvo', 'Залп']
];

export class Fx {
    constructor(options, seed) {
        this.flashes = !options.noflash;     // вспышки и тряска
        this.extra = !options.nofx;          // волны, звёзды, линии, конфетти…
        this.items = [];                     // вспышки, волны, многоугольники
        this.parts = [];                     // частицы
        this.rng = mulberry32(seed);
        this.phrase = -1;
        this.theme = 'ring';
        this.side = 0;
        this.shakeAt = -99;
        this.shakePower = 0;
    }

    // ===== Что происходит на бите =====

    beat(i, t, drop, first, geo) {
        const pos = i % 4;
        const phrase = Math.floor(i / 16);
        if (phrase !== this.phrase || first) {
            this.phrase = phrase;
            this.theme = pick(this.rng, drop ? THEMES : CALM);
        }
        const { rc, far } = geo;

        // Начало дропа — всё сразу: залп конфетти из нижних углов, порыв ветра, волны
        if (first) {
            this.flash('all', t, 0.45, 0.45);
            for (let k = 0; k < 3; k++) this.ring(t + k * 0.08, rc, far, 7 - k * 2, 0.8, 0.9);
            this.cannons(t, geo, 36);
            this.wind(t, geo, 16);
            this.confetti(t, geo, 40);
            this.stars(t, geo, 14, false);
            this.shake(t, 12);
            return;
        }

        if (!drop) {
            if (i % 2) return;
            switch (this.theme) {
                case 'ring': this.ring(t, rc, rc * 5, 3, 0.35, 0.8); break;
                case 'sides': this.flash(this.side++ % 2 ? 'r' : 'l', t, 0.16, 0.5); break;
                case 'poly': this.poly(t, 4 + (i / 2) % 3, far * 0.8, rc * 1.2, 0.3, 0.9); break;
                default: this.square(t, rc * 1.3, rc * 4, 0.3, 0.8);
            }
            return;
        }

        switch (this.theme) {
            case 'salvo':
                for (let k = 0; k < (pos === 0 ? 3 : 1); k++) this.ring(t + k * 0.07, rc, far * 0.9, 5 - k, 0.6, 0.8);
                break;
            case 'sides':
                this.flash(['l', 't', 'r', 'b'][this.side++ % 4], t, 0.35, 0.4);
                this.ring(t, rc, rc * 4, 3, 0.4, 0.6);
                break;
            case 'stars':
                this.stars(t, geo, pos === 0 ? 14 : 8, false);
                break;
            case 'edges':
                this.ring(t, far, rc, 4, 0.5, 0.45);
                this.stars(t, geo, 6, true);
                break;
            case 'lines':
                this.lines(t, geo, pos === 0 ? 20 : 12);
                break;
            case 'confetti':
                if (pos % 2 === 0) this.confetti(t, geo, 30);
                else this.ring(t, rc, rc * 4, 3, 0.4, 0.6);
                break;
            case 'poly':
                this.poly(t, 3 + (i % 4), far * 0.9, rc * 1.1, 0.6, 0.43);
                break;
            default:
                this.square(t, rc * 1.2, far * 0.7, 0.55, 0.6);
                this.square(t + 0.06, rc * 1.2, far * 0.5, 0.3, 0.6);
        }
        if (pos === 0) {
            this.flash('all', t, 0.12, 0.3);
            this.shake(t, 4);
        }
    }

    // Попадание: искры там, где нота коснулась круга (их не убирает даже «Без эффектов»)
    hit(t, angle, geo, power) {
        const x = geo.cx + Math.cos(angle) * geo.rc;
        const y = geo.cy + Math.sin(angle) * geo.rc;
        const n = 6 + power * 4;
        for (let k = 0; k < n; k++) {
            const a = angle + (this.rng() - 0.5) * 1.6;
            const v = 180 + this.rng() * 320;
            this.part({ kind: 'spark', t0: t, life: 0.35 + this.rng() * 0.25, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: 3 + this.rng() * 4, rot: this.rng() * TAU, vr: 8 });
        }
        this.items.push({ kind: 'dot', t0: t, dur: 0.3, x, y, r0: geo.rc * 0.2, r1: geo.rc * 0.9, a: 0.7 });
    }

    // ===== Создание эффектов =====

    flash(side, t, a, dur) {
        if (this.flashes) this.items.push({ kind: 'flash', side, t0: t, dur, a });
    }

    ring(t, r0, r1, w, a, dur) {
        if (this.extra) this.items.push({ kind: 'ring', t0: t, dur, r0, r1, w, a });
    }

    poly(t, sides, r0, r1, a, dur) {
        if (this.extra) this.items.push({ kind: 'poly', t0: t, dur, sides, r0, r1, a, rot: this.rng() * TAU });
    }

    square(t, r0, r1, a, dur) {
        if (this.extra) this.items.push({ kind: 'poly', t0: t, dur, sides: 4, r0, r1, a, rot: this.rng() * TAU, spin: 1.2 });
    }

    shake(t, power) {
        if (!this.flashes) return;
        this.shakeAt = t;
        this.shakePower = power;
    }

    // Эффекты, которые автор уровня поставил вручную
    playEvent(event, geo) {
        const t = event.t;
        const power = Math.max(0.1, Math.min(2, event.power || 1));
        const dur = Math.max(0.05, Math.min(3, event.duration || 0.5));
        const side = ['all', 'l', 'r', 't', 'b'].includes(event.side) ? event.side : 'all';
        switch (event.type) {
            case 'flash': this.flash(side, t, Math.min(1, 0.65 * power), dur); break;
            case 'ring': this.ring(t, geo.rc, geo.far * power, 6 * power, 0.85, dur); break;
            case 'poly': this.poly(t, 6, geo.rc, geo.far * power, 0.8, dur); break;
            case 'square': this.square(t, geo.rc, geo.far * power, 0.8, dur); break;
            case 'stars': this.stars(t, geo, Math.round(18 * power), false, dur); break;
            case 'lines': this.lines(t, geo, Math.round(22 * power), dur); break;
            case 'confetti': this.confetti(t, geo, Math.round(34 * power), dur); break;
            case 'shake': this.shake(t, 8 * power); break;
            case 'salvo':
                this.flash(side, t, Math.min(1, 0.4 * power), dur);
                for (let i = 0; i < 3; i++) this.ring(t + i * 0.08, geo.rc, geo.far * power, 7 - i, 0.85, dur);
                this.confetti(t, geo, Math.round(24 * power), dur);
                this.shake(t, 8 * power);
                break;
        }
    }

    // Звёздочки из центра или с краёв к центру
    stars(t, geo, n, fromEdges, duration) {
        if (!this.extra) return;
        for (let k = 0; k < n; k++) {
            const a = this.rng() * TAU;
            const v = (fromEdges ? -1 : 1) * (geo.far * (0.6 + this.rng() * 0.5));
            const r = fromEdges ? geo.far : geo.rc;
            this.part({
                kind: 'star', t0: t, life: duration ? duration * (0.8 + this.rng() * 0.4) : 0.9 + this.rng() * 0.4,
                x: geo.cx + Math.cos(a) * r, y: geo.cy + Math.sin(a) * r,
                vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 1.6,
                size: 6 + this.rng() * 9, rot: this.rng() * TAU, vr: (this.rng() - 0.5) * 8
            });
        }
    }

    // Линии, разлетающиеся от круга
    lines(t, geo, n, duration) {
        if (!this.extra) return;
        for (let k = 0; k < n; k++) {
            this.part({
                kind: 'line', t0: t, life: duration ? duration * (0.8 + this.rng() * 0.4) : 0.45 + this.rng() * 0.2, angle: this.rng() * TAU,
                r0: geo.rc * (1.3 + this.rng()), speed: geo.far * (1.6 + this.rng()), len: 40 + this.rng() * 90, size: 2 + this.rng() * 2
            });
        }
    }

    // Конфетти сверху: падают, кружатся и «переворачиваются»
    confetti(t, geo, n, duration) {
        if (!this.extra) return;
        for (let k = 0; k < n; k++) {
            this.part({
                kind: 'confetti', t0: t, life: duration ? duration * (0.8 + this.rng() * 0.4) : 1.6 + this.rng() * 0.8,
                x: this.rng() * geo.W, y: -20 - this.rng() * geo.H * 0.3,
                vx: (this.rng() - 0.5) * 160, vy: 80 + this.rng() * 200, g: 420, drag: 0.4,
                size: 6 + this.rng() * 7, rot: this.rng() * TAU, vr: (this.rng() - 0.5) * 10, flip: 4 + this.rng() * 8,
                gray: this.rng() < 0.4
            });
        }
    }

    // Хлопушки: конфетти вылетает вверх из нижних углов и падает обратно
    cannons(t, geo, n) {
        if (!this.extra) return;
        for (const side of [-1, 1]) {
            for (let k = 0; k < n; k++) {
                const spread = 0.2 + this.rng() * 0.45;      // наклон от вертикали — внутрь экрана
                const v = geo.H * (2 + this.rng() * 1.2);
                this.part({
                    kind: 'confetti', t0: t + this.rng() * 0.08, life: 1.8 + this.rng() * 0.6,
                    x: side < 0 ? 0 : geo.W, y: geo.H + 10,
                    vx: -side * Math.sin(spread) * v, vy: -Math.cos(spread) * v, g: geo.H * 1.6, drag: 1.4,
                    size: 6 + this.rng() * 7, rot: this.rng() * TAU, vr: (this.rng() - 0.5) * 14, flip: 5 + this.rng() * 9,
                    gray: this.rng() < 0.35
                });
            }
        }
    }

    // Порыв ветра: длинные полосы проносятся через весь экран в одну сторону
    wind(t, geo, n) {
        if (!this.extra) return;
        const dir = this.rng() < 0.5 ? 1 : -1;
        for (let k = 0; k < n; k++) {
            this.part({
                kind: 'gust', t0: t + this.rng() * 0.25, life: 0.55 + this.rng() * 0.3, dir,
                y: this.rng() * geo.H, len: geo.W * (0.15 + this.rng() * 0.25), speed: geo.W * (2.2 + this.rng() * 1.2),
                size: 1.5 + this.rng() * 2.5, W: geo.W, wave: this.rng() * TAU
            });
        }
    }

    part(p) {
        if (this.parts.length < MAX_PARTS) this.parts.push(p);
    }

    // ===== Рисование =====

    shakeOffset(t) {
        const k = this.shakePower * Math.exp(-(t - this.shakeAt) * 10);
        if (k < 0.3) return [0, 0];
        return [Math.sin(t * 93) * k, Math.cos(t * 71) * k];
    }

    // Под нотами: вспышки, волны, многоугольники
    drawBack(ctx, t, geo) {
        const { cx, cy, W, H } = geo;
        this.items = this.items.filter(it => t < it.t0 + it.dur + 0.05 && t > it.t0 - 2);
        for (const it of this.items) {
            const p = (t - it.t0) / it.dur;
            if (p < 0 || p > 1) continue;
            ctx.globalAlpha = it.a * (1 - p) * (1 - p);
            if (it.kind === 'flash') {
                drawFlash(ctx, it.side, W, H);
            } else if (it.kind === 'ring') {
                const r = it.r0 + (it.r1 - it.r0) * easeOut(p);
                ctx.lineWidth = it.w;
                ctx.strokeStyle = '#fff';
                ctx.beginPath();
                ctx.arc(cx, cy, Math.max(1, r), 0, TAU);
                ctx.stroke();
            } else if (it.kind === 'poly') {
                const inward = it.r1 < it.r0;
                const e = inward ? p * p : easeOut(p);
                const r = it.r0 + (it.r1 - it.r0) * e;
                if (inward) ctx.globalAlpha = it.a * Math.min(1, p * 3) * (1 - p * p);
                ctx.lineWidth = 3;
                ctx.strokeStyle = '#fff';
                ctx.lineJoin = 'round';
                polygon(ctx, cx, cy, it.sides, r, it.rot + p * (it.spin || 0.6));
                ctx.stroke();
            } else if (it.kind === 'dot') {
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(it.x, it.y, it.r0 + (it.r1 - it.r0) * easeOut(p), 0, TAU);
                ctx.lineWidth = 3;
                ctx.strokeStyle = '#fff';
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 1;
    }

    // Над нотами: частицы
    drawFront(ctx, t) {
        this.parts = this.parts.filter(p => t < p.t0 + p.life && t > p.t0 - 2);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#fff';
        for (const p of this.parts) {
            const dt = t - p.t0;
            if (dt < 0) continue;
            const k = dt / p.life;
            ctx.globalAlpha = (1 - k) * (p.gray ? 0.55 : 1);
            if (p.kind === 'gust') {
                const x = (p.dir > 0 ? -p.len : p.W + p.len) + p.dir * p.speed * dt;
                const y = p.y + Math.sin(p.wave + dt * 6) * 14;
                ctx.globalAlpha = Math.sin(Math.PI * k) * 0.7;
                ctx.lineWidth = p.size;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(x - p.dir * p.len, y + 6);
                ctx.stroke();
                continue;
            }
            if (p.kind === 'line') {
                const r = p.r0 + p.speed * dt * (1 - k * 0.4);
                const c = Math.cos(p.angle), s = Math.sin(p.angle);
                ctx.lineWidth = p.size;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(this.cx + c * r, this.cy + s * r);
                ctx.lineTo(this.cx + c * (r + p.len), this.cy + s * (r + p.len));
                ctx.stroke();
                continue;
            }
            // путь с торможением (drag) и падением (g) — считается сразу по времени, без шагов
            const d = p.drag ? (1 - Math.exp(-p.drag * dt)) / p.drag : dt;
            const x = p.x + p.vx * d;
            const y = p.y + p.vy * d + 0.5 * (p.g || 0) * dt * dt;
            const rot = p.rot + p.vr * dt;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rot);
            if (p.kind === 'star') {
                starPath(ctx, 0, 0, p.size, p.size * 0.45);
                ctx.fill();
            } else if (p.kind === 'confetti') {
                ctx.scale(1, Math.cos(dt * p.flip));
                ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
            } else {
                const s = p.size * (1 - k * 0.6);
                ctx.fillRect(-s / 2, -s / 2, s, s);
            }
            ctx.restore();
        }
        ctx.globalAlpha = 1;
    }

    // Центр нужен линиям; задаётся игрой при изменении размера окна
    setCenter(cx, cy) {
        this.cx = cx;
        this.cy = cy;
    }
}

function drawFlash(ctx, side, W, H) {
    if (side === 'all') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, W, H);
        return;
    }
    const size = (side === 'l' || side === 'r' ? W : H) * 0.35;
    let grad;
    if (side === 'l') grad = ctx.createLinearGradient(0, 0, size, 0);
    else if (side === 'r') grad = ctx.createLinearGradient(W, 0, W - size, 0);
    else if (side === 't') grad = ctx.createLinearGradient(0, 0, 0, size);
    else grad = ctx.createLinearGradient(0, H, 0, H - size);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
}

export function polygon(ctx, x, y, n, r, rot) {
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
        const a = rot + k * TAU / n;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (k) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
    }
    ctx.closePath();
}

export function starPath(ctx, x, y, r, inner) {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + k * Math.PI / 5;
        const rr = k % 2 ? inner : r;
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        if (k) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
    }
    ctx.closePath();
}

const easeOut = p => 1 - (1 - p) * (1 - p) * (1 - p);
