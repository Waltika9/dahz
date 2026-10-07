// ===== Волна от кнопки =====
// Нажали на кнопку — от её рамки расходятся пиксельные прямоугольники и тают узором.
// Рисуется на одном прозрачном холсте поверх всей страницы (pointer-events: none).
// Цвет линий берётся из CSS-переменной --ink: днём чёрный, в домашнем режиме белый.
// waveAround(элемент, true) — большая волна (её пускает блок «Сейчас», когда меняется состояние).

import { PixBuf, color } from './pixbuf.js?v=1';

const S = 2;               // 1 пиксель холста = 2 CSS-пикселя
const PRESSABLE = 'button, a[href], .day-chip, [role="switch"]';

let canvas = null, buf = null, raf = 0;
let waves = [];

function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'press-fx';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.append(canvas);
    buf = new PixBuf(canvas);
    resize();
    window.addEventListener('resize', resize);
}

function resize() {
    buf.resize(Math.ceil(innerWidth / S), Math.ceil(innerHeight / S));
}

function inkColor() {
    const v = getComputedStyle(document.body).getPropertyValue('--ink').trim();
    return color(/^#[0-9a-f]{6}$/i.test(v) ? v : '#000000');
}

// Запустить волну вокруг элемента
export function waveAround(el, big = false) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    ensureCanvas();
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const t0 = performance.now() / 1000;
    const base = {
        x0: Math.floor(r.left / S), y0: Math.floor(r.top / S),
        x1: Math.ceil(r.right / S) - 1, y1: Math.ceil(r.bottom / S) - 1,
        c: inkColor()
    };
    // несколько рамок одна за другой: первая уходит дальше всех
    const rings = big ? [[0, 18, 0.6], [0.09, 12, 0.55], [0.18, 7, 0.5]] : [[0, 11, 0.45], [0.07, 6, 0.4]];
    for (const [delay, reach, dur] of rings) waves.push({ ...base, t0: t0 + delay, reach, dur });
    if (!raf) raf = requestAnimationFrame(loop);
}

function loop() {
    const t = performance.now() / 1000;
    waves = waves.filter(w => t - w.t0 < w.dur);
    buf.clear();
    for (const w of waves) {
        const k = (t - w.t0) / w.dur;
        if (k < 0) continue;
        // быстро отскакивает от рамки и замедляется; шаг — целый пиксель
        const d = 1 + Math.round(w.reach * (1 - Math.pow(1 - k, 3)));
        buf.fade = k > 0.35 ? (k - 0.35) / 0.65 : 0;
        const x0 = w.x0 - d, y0 = w.y0 - d, x1 = w.x1 + d, y1 = w.y1 + d;
        buf.line(x0, y0, x1, y0, w.c);
        buf.line(x1, y0, x1, y1, w.c);
        buf.line(x1, y1, x0, y1, w.c);
        buf.line(x0, y1, x0, y0, w.c);
    }
    buf.fade = 0;
    buf.flush();
    raf = waves.length ? requestAnimationFrame(loop) : 0;
}

// Все кнопки сайта: волна при нажатии (пальцем, мышью или с клавиатуры)
export function initPress() {
    document.addEventListener('pointerdown', (e) => {
        const el = e.target.closest(PRESSABLE);
        if (el && !el.disabled) waveAround(el);
    }, { capture: true, passive: true });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const el = document.activeElement?.closest?.(PRESSABLE);
        if (el && !el.disabled) waveAround(el);
    });
}
