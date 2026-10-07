// ===== Анимации блока «Сейчас» =====
// Один цикл requestAnimationFrame рисует пиксельные часы и эффекты блока.
// Всё бьёт в единый бит (beat.js) — 1 удар в секунду, вместе с часами.
//
// Спокойно: на уроке блок белый, на перемене зелёный; двигаются только часы.
// Сигнал — одинаковая динамичная анимация, отличается только цвет:
//   зелёный — «Скоро конец» (5 минут до конца урока или перемены),
//   красный — «Пора на урок!» (2 минуты до урока).
// Что происходит (по мотивам Beatblock):
//   • пиксельный градиент бежит волнами слева направо, на удар — вспышка;
//   • большой многоугольник сжимается к часам и попадает в них ровно на удар;
//     в момент удара вокруг часов вспыхивает рваная звезда и двойное кольцо, тают узором;
//   • квадратики-«цели» летят снаружи к часам и тоже прилетают точно на удар;
//   • белые линии скорости мчатся по блоку, частицы вылетают из блока во все стороны;
//   • часы вспыхивают, блок вздрагивает.
// Чем ближе конец, тем всё быстрее и гуще. Эффекты выходят за блок, но недалеко.

import { now } from './clock.js?v=1';
import { getState, SOON_MIN, ENDING_MIN } from './state.js?v=1';
import { beatAt, pulse } from './beat.js?v=1';
import { PixBuf, color, bayer } from './pixbuf.js?v=1';
import { Dial } from './dial.js?v=2';

const S = 2;               // 1 пиксель холста = 2×2 CSS-пикселя
const BW = 3;              // толщина рамки блока (как в CSS)
const MAX_SIDE = 48;       // насколько эффекты выходят за блок по бокам (CSS px)
const MAX_VERT = 64;       // и сверху/снизу
const EDGE_GAP = 4;        // отступ от края экрана — чтобы страница не прокручивалась вбок
const MAX_PARTICLES = 260;
const TAU = Math.PI * 2;

const INK = color('#000000');
const WHITE = color('#ffffff');

// Палитры: от светлого к насыщенному. Соседние цвета смешиваются узором Байера
const LOOKS = {
    ending: {
        palette: ['#dcfce7', '#bbf7d0', '#86efac', '#4ade80', '#22c55e'].map(color),
        bits: ['#000000', '#16a34a', '#15803d', '#4ade80'].map(color)
    },
    soon: {
        palette: ['#fee2e2', '#fecaca', '#fca5a5', '#f87171', '#ef4444'].map(color),
        bits: ['#000000', '#dc2626', '#b91c1c', '#f87171'].map(color)
    }
};

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeIn = (k) => k * k;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

let card, dialCanvas, fxCanvas, buf, dial, getData;
let geo = null;            // размеры холста и положение блока/часов на нём
let mode = '';             // '' | 'ending' | 'soon'
let visible = false;
let raf = 0, lastT = 0, lastBeat = -1, emitDebt = 0;
let particles = [], targets = [], streaks = [];
let hitAt = -10;           // когда был последний удар (для звезды и колец)
let shake = '';
let night = false;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

export function initFx(opts) {
    card = opts.card;
    dialCanvas = opts.dialCanvas;
    getData = opts.getData;
    dial = new Dial(dialCanvas);

    fxCanvas = document.createElement('canvas');
    fxCanvas.className = 'now-fx';
    fxCanvas.setAttribute('aria-hidden', 'true');
    card.prepend(fxCanvas);
    buf = new PixBuf(fxCanvas);

    // Блок поменял размер (другой текст, поворот телефона) — пересчитаем холст
    new ResizeObserver(() => { geo = null; }).observe(card);
    window.addEventListener('resize', () => { geo = null; });
}

// Анимации идут, только когда вкладка IRL на экране — бережём батарею
export function setFxVisible(on) {
    if (on === visible) return;
    visible = on;
    cancelAnimationFrame(raf);
    if (on) {
        lastT = 0;
        raf = requestAnimationFrame(loop);
    }
}

// Домашний режим: часы рисуются белыми линиями на тёмном
export function setFxNight(on) {
    night = on;
}

function loop(t) {
    fxFrame(t);
    raf = requestAnimationFrame(loop);
}

// Один кадр. t — время кадра в мс (из requestAnimationFrame)
export function fxFrame(t = performance.now()) {
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0;
    lastT = t;
    const tSec = t / 1000;

    const date = now();
    const data = getData();
    const s = data ? getState(data, date) : null;
    const beat = beatAt(date.getTime());
    const calm = reduced.matches;

    dial.draw(dialView(s, beat.phase, calm));

    const want = !s || calm ? '' : s.phase === 'soon' ? 'soon' : s.ending ? 'ending' : '';
    if (want !== mode) setMode(want);
    if (!mode) return;
    if (!geo) layout();

    const u = urgency(s);

    // Удар — новая порция эффектов
    if (beat.index !== lastBeat) {
        lastBeat = beat.index;
        hitAt = tSec - beat.phase;     // точный момент удара
        onBeat(tSec, beat.phase, u);
    }

    emit(dt, u);
    step(dt);
    draw(tSec, beat, u);
    shakeCard(beat, u);
}

// Насколько срочно: 0 — сигнал только начался, 1 — вот-вот
function urgency(s) {
    if (mode === 'soon') return clamp01(1 - s.left / SOON_MIN);
    return clamp01(1 - s.left / ENDING_MIN);
}

function dialView(s, phase, calm) {
    if (!s) return { mode: 'empty', night };
    const progress = (it) => clamp01(1 - s.left / it.duration);
    const beatOn = !calm && phase < 0.5;
    const flash = !calm && (s.phase === 'soon' || s.ending) && phase < 0.12;
    const centerPulse = !calm && phase < 0.2;

    if (s.kind === 'lesson') {
        return { mode: 'hand', progress: progress(s.item), accent: s.ending && beatOn, pulse: centerPulse, flash };
    }
    if (s.kind === 'break') {
        return { mode: 'pie', progress: progress(s.item), accent: s.ending && beatOn, flash };
    }
    if (s.phase === 'soon') {
        // перед первым уроком: стрелка ждёт на 12 часах
        return { mode: 'hand', progress: 0, flash, pulse: centerPulse };
    }
    return { mode: 'moon', twinkle: beatOn, night };
}

function setMode(next) {
    mode = next;
    particles = []; targets = []; streaks = [];
    lastBeat = -1;
    geo = null;
    if (next) {
        card.dataset.fx = next;
    } else {
        delete card.dataset.fx;
        buf.clear();
        buf.flush();
    }
    if (shake) {
        shake = '';
        card.style.transform = '';
    }
}

// Размер холста: блок + поля вокруг. Поля кратны S, чтобы пиксели совпадали с сеткой
function layout() {
    const keep = card.style.transform;
    card.style.transform = '';
    const r = card.getBoundingClientRect();
    const d = dialCanvas.getBoundingClientRect();
    card.style.transform = keep;

    const vw = document.documentElement.clientWidth;
    const snap = (v) => Math.max(0, Math.floor(v / S) * S);
    const mL = snap(Math.min(MAX_SIDE, r.left - EDGE_GAP));
    const mR = snap(Math.min(MAX_SIDE, vw - r.right - EDGE_GAP));
    const mT = MAX_VERT, mB = MAX_VERT;

    const W = Math.floor((r.width + mL + mR) / S);
    const H = Math.floor((r.height + mT + mB) / S);
    fxCanvas.style.left = `${-(mL + BW)}px`;
    fxCanvas.style.top = `${-(mT + BW)}px`;
    fxCanvas.style.width = `${W * S}px`;
    fxCanvas.style.height = `${H * S}px`;
    buf.resize(W, H);

    geo = {
        W, H,
        // внутренняя часть блока (без рамки) в пикселях холста
        x0: Math.ceil((mL + BW) / S), y0: Math.ceil((mT + BW) / S),
        x1: Math.floor((mL + r.width - BW) / S), y1: Math.floor((mT + r.height - BW) / S),
        // центр и радиус часов
        dx: (d.left + d.width / 2 - r.left + mL) / S,
        dy: (d.top + d.height / 2 - r.top + mT) / S,
        dr: d.width / 2 / S
    };
}

// ----- Частицы -----

function spawn(x, y, vx, vy, life) {
    if (particles.length >= MAX_PARTICLES) return;
    particles.push({ x, y, vx, vy, life, max: life, size: pick([2, 2, 3]), c: pick(LOOKS[mode].bits) });
}

// Частица вылетает с любой стороны блока наружу
function burstParticle(u) {
    const g = geo;
    const side = Math.floor(Math.random() * 4);
    const sp = rand(50, 120) * (1 + u * 0.5);
    const life = rand(0.55, 1);
    if (side === 0) spawn(rand(g.x0, g.x1), g.y0 - 1, rand(-30, 30), -sp, life);
    else if (side === 1) spawn(rand(g.x0, g.x1), g.y1, rand(-30, 30), sp, life);
    else if (side === 2) spawn(g.x0 - 2, rand(g.y0, g.y1), -sp, rand(-30, 30), life);
    else spawn(g.x1 + 1, rand(g.y0, g.y1), sp, rand(-30, 30), life);
}

// Ровный поток частиц между ударами
function emit(dt, u) {
    emitDebt += dt * (12 + 22 * u);
    while (emitDebt >= 1) {
        emitDebt--;
        burstParticle(u);
    }
}

// ----- Что появляется на каждый удар -----

function onBeat(tSec, phase, u) {
    const g = geo;

    // залп частиц
    const n = Math.round(10 + 14 * u);
    for (let i = 0; i < n; i++) burstParticle(u);

    // квадратики-цели: стартуют снаружи и прилетают к часам ровно на следующий удар
    const nt = 2 + Math.round(2 * u);
    for (let i = 0; i < nt; i++) {
        targets.push({
            t0: tSec - phase, dur: 1,
            a: rand(0, TAU),
            d0: g.dr + rand(45, 70) + 15 * u,
            diamond: Math.random() < 0.4
        });
    }

    // белые линии скорости по блоку
    const ns = 3 + Math.round(4 * u);
    for (let i = 0; i < ns; i++) {
        streaks.push({
            x: g.x0 - rand(2, 30), y: Math.round(rand(g.y0 + 2, g.y1 - 3)),
            vx: rand(170, 280) * (1 + u * 0.4), len: Math.round(rand(8, 18))
        });
    }
}

function step(dt) {
    for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
    }
    particles = particles.filter(p => p.life > 0);
    for (const s of streaks) s.x += s.vx * dt;
    streaks = streaks.filter(s => s.x - s.len < geo.x1);
}

// ----- Рисование -----

function draw(tSec, beat, u) {
    const g = geo, look = LOOKS[mode];
    buf.clear();
    gradient(tSec, beat.phase, u);

    // Белые линии скорости — только внутри блока
    for (const s of streaks) {
        const a = Math.max(g.x0, Math.round(s.x - s.len)), b = Math.min(g.x1, Math.round(s.x));
        for (let x = a; x < b; x++) buf.dot(x, s.y, WHITE);
    }

    // Многоугольник сжимается к часам и касается их ровно на удар.
    // Движение ступеньками: 10 рывков за удар. Каждый удар — другое число сторон и поворот.
    const near = g.dr + 2;
    const far = g.dr + 58 + 12 * u;
    const k = Math.floor(beat.phase * 10) / 10;
    const sides = [8, 12, 6, 10][beat.index % 4];
    const turn = (beat.index % 7) * 0.4;
    buf.poly(g.dx, g.dy, far + (near - far) * easeIn(k), sides, turn, INK);
    // ближе к концу — второй многоугольник на полудар позади
    if (u > 0.4) {
        const k2 = Math.floor(((beat.phase + 0.5) % 1) * 10) / 10;
        buf.fade = 0.5;
        buf.poly(g.dx, g.dy, far + (near - far) * easeIn(k2), sides === 12 ? 8 : 12, -turn, INK);
        buf.fade = 0;
    }

    // Удар: рваная звезда и двойное кольцо вокруг часов, тают узором
    const since = tSec - hitAt;
    if (since >= 0 && since < 0.45) {
        const kk = since / 0.45;
        buf.fade = kk > 0.3 ? (kk - 0.3) / 0.7 : 0;
        star(g.dx, g.dy, g.dr + 3 + kk * 6, 16, beat.index * 0.3);
        buf.ring(g.dx, g.dy, g.dr + 4 + kk * 16, INK);
        buf.ring(g.dx, g.dy, g.dr + 7 + kk * 22, INK);
        buf.fade = 0;
    }

    // Квадратики-цели летят к часам ступеньками (8 рывков) и исчезают при касании
    targets = targets.filter(t => tSec - t.t0 < t.dur);
    for (const t of targets) {
        const kk = clamp01((tSec - t.t0) / t.dur);
        const stepK = Math.floor(kk * 8) / 8;
        const dist = t.d0 + (near + 3 - t.d0) * easeIn(stepK);
        const x = Math.round(g.dx + Math.cos(t.a) * dist), y = Math.round(g.dy + Math.sin(t.a) * dist);
        buf.fade = kk < 0.15 ? 1 - kk / 0.15 : 0;      // появляются из узора
        if (t.diamond) {
            buf.line(x, y - 4, x + 4, y, INK); buf.line(x + 4, y, x, y + 4, INK);
            buf.line(x, y + 4, x - 4, y, INK); buf.line(x - 4, y, x, y - 4, INK);
        } else {
            buf.line(x - 3, y - 3, x + 3, y - 3, INK); buf.line(x + 3, y - 3, x + 3, y + 3, INK);
            buf.line(x + 3, y + 3, x - 3, y + 3, INK); buf.line(x - 3, y + 3, x - 3, y - 3, INK);
        }
        buf.dot(x, y, INK);
    }
    buf.fade = 0;

    // Частицы: под конец жизни тают шахматным узором
    for (const p of particles) {
        const f = 1 - p.life / p.max;
        buf.fade = f > 0.55 ? (f - 0.55) / 0.45 : 0;
        buf.rect(Math.round(p.x), Math.round(p.y), p.size, p.size, p.c);
    }
    buf.fade = 0;

    buf.flush();
}

// Рваная звезда: вершины по очереди дальше и ближе
function star(cx, cy, r, points, angle) {
    let px = 0, py = 0;
    for (let i = 0; i <= points * 2; i++) {
        const a = angle + (i / (points * 2)) * TAU;
        const rr = i % 2 ? r + 4 : r;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        if (i) buf.line(px, py, x, y, INK);
        px = x; py = y;
    }
}

// Пиксельный градиент внутри блока: волны цвета бегут вправо + вспышка на удар.
// Клетки 2×2 пикселя, между цветами палитры — узор Байера (без размытия).
function gradient(tSec, phase, u) {
    const g = geo, pal = LOOKS[mode].palette, n = pal.length, px = buf.px, W = g.W;
    const flashUp = pulse(phase, 0.45, 4) * 0.6;
    const speed = 1.1 + 1.3 * u;                 // волн в секунду
    const w = tSec * speed * TAU;
    const lift = 0.1 + 0.25 * u;
    const wobble = Math.sin(tSec * 2.5);

    for (let y = g.y0; y < g.y1; y += 2) {
        const cy = (y - g.y0) >> 1;
        const bend = Math.sin(cy * 0.45 + wobble) * 0.9;
        for (let x = g.x0; x < g.x1; x += 2) {
            const cx = (x - g.x0) >> 1;
            const v = 0.5 + 0.5 * Math.sin(cx * 0.2 - w + bend);
            let level = Math.floor((v * 0.65 + lift + flashUp) * (n - 1) + bayer(cx, cy));
            if (level < 0) level = 0;
            else if (level >= n) level = n - 1;
            const c = pal[level];
            const i = y * W + x;
            px[i] = c;
            if (x + 1 < g.x1) px[i + 1] = c;
            if (y + 1 < g.y1) {
                px[i + W] = c;
                if (x + 1 < g.x1) px[i + W + 1] = c;
            }
        }
    }
}

// Блок вздрагивает на удар (влево-вправо, ступеньками)
function shakeCard(beat, u) {
    let tf = '';
    const seq = [3, -3, 2, -2, 1];
    const i = Math.floor(beat.phase / 0.05);
    if (i < seq.length) tf = `translate(${Math.round(seq[i] * (0.6 + 0.4 * u))}px, 0)`;
    if (tf !== shake) {
        shake = tf;
        card.style.transform = tf;
    }
}
