// Окно результата. Всё рисуется на canvas, поэтому «Сохранить» просто скачивает эту картинку.
// Слева сверху — карточка уровня, под ней — счёт, слева снизу — оценка,
// справа сверху — логотип, справа посередине — график, справа снизу — кнопки.
// Сначала с нуля набегает счёт и строится график, потом с «бумом» появляется оценка,
// а всё вместе подпрыгивает в такт песне, которая приглушённо играет дальше

import * as music from './music.js?v=6';
import * as sfx from './sfx.js?v=3';
import { drawLogo } from './logo.js?v=6';
import { drawDiffIcon } from './menu.js?v=7';
import { roundRect, download, safeName, toast, clamp } from './util.js?v=1';

const $ = id => document.getElementById(id);
const UI = 'Rubik, system-ui, sans-serif';
const BIG = 'Anton, Impact, sans-serif';
const screenEl = $('results');
const canvas = $('resultsCanvas');
const modal = $('exitModal');

// Когда что происходит (секунды после появления окна)
const COUNT = [0.4, 2.2];       // счёт и цифры набегают
const GRAPH = [0.5, 2.3];       // график рисуется слева направо
const GRADE = 2.6;              // появляется оценка
const BUTTONS = 3.1;            // появляются кнопки

let data = null;
let onMenu = null;
let song = null;
let shownAt = 0;
let raf = 0;
let boomed = false;
let dpr = 1, W = 0, H = 0;
const FINAL = { appear: 1, count: 1, graph: 1, grade: 1, jump: 0 };

// d — данные из game.js, menu — что делать после выхода, s — разбор песни (для подпрыгиваний)
export async function showResults(d, menu, s) {
    data = d;
    onMenu = menu;
    song = s;
    boomed = false;
    try {
        await Promise.all(['400', '500', '700'].map(w => document.fonts.load(`${w} 20px Rubik`)));
    } catch (e) { /* нарисуется запасным шрифтом */ }
    resize();
    screenEl.classList.remove('is-ready');
    screenEl.classList.add('is-on');
    shownAt = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
}

function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth;
    H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
}

addEventListener('resize', () => {
    if (data) resize();
});

function loop(now) {
    if (!data) return;
    raf = requestAnimationFrame(loop);
    const T = (now - shownAt) / 1000;
    if (T >= GRADE && !boomed) {
        boomed = true;
        if (!data.quiet) sfx.boom();
    }
    if (T >= BUTTONS) screenEl.classList.add('is-ready');
    const span = ([a, b]) => clamp((T - a) / (b - a), 0, 1);
    const view = {
        appear: clamp(T / 0.6, 0, 1),
        count: 1 - (1 - span(COUNT)) ** 3,
        graph: span(GRAPH),
        grade: clamp((T - GRADE) / 0.5, 0, 1),
        jump: beatJump()
    };
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pad = draw(ctx, W, H, false, view);
    screenEl.style.setProperty('--pad', `${Math.round(pad)}px`);
}

// Подпрыгивание в такт, как у логотипа в меню: резко на бите, плавно обратно
function beatJump() {
    const t = music.isLooping() ? music.time() : null;
    if (t == null || !song || !song.beats || !song.beats.length) return 0;
    const b = song.beats;
    let lo = 0, hi = b.length - 1, i = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (b[mid] <= t) {
            i = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    if (i < 0) return 0;
    const len = i + 1 < b.length ? b[i + 1] - b[i] : 0.5;
    const dt = t - b[i];
    const drop = song.drops.some(([a, z]) => b[i] >= a && b[i] < z);
    return (drop ? 0.05 : 0.025) * (1 - Math.exp(-dt / 0.02)) * Math.exp(-dt / (len * 0.35));
}

// ===== Кнопки =====

$('saveBtn').addEventListener('click', () => save());
$('menuBtn').addEventListener('click', () => modal.classList.add('is-open'));
$('exitSave').addEventListener('click', async () => {
    await save();
    leave();
});
$('exitJust').addEventListener('click', leave);
$('exitCancel').addEventListener('click', () => modal.classList.remove('is-open'));
modal.addEventListener('click', e => {
    if (e.target === modal) modal.classList.remove('is-open');
});

// Картинка 1920×1080 — такая же раскладка, как на большом экране, но уже в конечном виде
// и вместо кнопок — подпись сайта
async function save() {
    if (!data) return;
    const c = document.createElement('canvas');
    c.width = 1920;
    c.height = 1080;
    draw(c.getContext('2d'), 1920, 1080, true, FINAL);
    const blob = await new Promise(ok => c.toBlob(ok, 'image/png'));
    if (!blob) {
        toast('Не получилось сохранить картинку');
        return;
    }
    download(blob, `${safeName(`BEAT IT — ${data.title} (${data.diff.name}) — ${data.grade}`)}.png`);
    toast('Картинка сохранена');
}

function leave() {
    modal.classList.remove('is-open');
    screenEl.classList.remove('is-on', 'is-ready');
    cancelAnimationFrame(raf);
    data = null;
    if (onMenu) onMenu();
}

// ===== Рисование =====

// Нарисовать что-то, увеличив его вокруг точки (cx, cy) в s раз
function around(ctx, cx, cy, s, fn) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.translate(-cx, -cy);
    fn();
    ctx.restore();
}

function draw(ctx, W, H, image, v) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    return W >= H * 1.1 ? wide(ctx, W, H, image, v) : tall(ctx, W, H, image, v);
}

// Компьютер и картинка: две колонки
function wide(ctx, W, H, image, v) {
    const u = Math.min(W / 1920, H / 1080);
    const pad = 64 * u;
    const leftW = W * 0.47 - pad;
    const cardH = 250 * u;
    card(ctx, pad, pad, leftW, cardH, u, v);
    stats(ctx, pad, pad + cardH + 50 * u, leftW, u, v);
    grade(ctx, pad, H - pad, 330 * u, u, v);

    const rx = W * 0.53, rw = W - pad - rx;
    const lw = Math.min(rw * 0.62, 470 * u);
    logo(ctx, W - pad - lw / 2, pad + lw * 0.36, lw, v);
    const gy = Math.max(pad + lw * 0.72 + 44 * u, H * 0.33);
    graph(ctx, rx, gy, rw, H * 0.76 - gy, u, v);
    if (image) footer(ctx, W - pad, H - pad, u);
    return pad;
}

// Телефон: всё друг под другом, кнопки внизу
function tall(ctx, W, H, image, v) {
    const u = Math.min(W / 430, H / 860) * 0.62;
    const pad = 16;
    const lw = Math.min(W * 0.38, 200);
    logo(ctx, W / 2, pad + lw * 0.36, lw, v);
    let y = pad + lw * 0.72 + 16;
    const cardH = 250 * u;
    card(ctx, pad, y, W - 2 * pad, cardH, u, v);
    y += cardH + 22;

    // сверху строка «ОЦЕНКА», под ней буква слева и счёт справа от неё
    const size = 250 * u;
    ctx.font = `${size}px ${BIG}`;
    const m = ctx.measureText(data.grade);
    const gw = m.width + size * 0.25;
    const base = y + 44 * u + m.actualBoundingBoxAscent;
    grade(ctx, pad, base, size, u, v);
    const sh = stats(ctx, pad + gw + 12, y + 50 * u, W - 2 * pad - gw - 12, u * 0.85, v);
    y = Math.max(y + 50 * u + sh, base) + 22;

    const bottom = image ? H - pad - 40 : H - 152;          // снизу место под две кнопки
    graph(ctx, pad, y, W - 2 * pad, Math.max(90, bottom - y), u, v);
    return pad;
}

function logo(ctx, cx, cy, w, v) {
    ctx.globalAlpha = v.appear;
    around(ctx, cx, cy, (1 + v.jump) * (0.85 + 0.15 * v.appear), () => drawLogo(ctx, cx, cy, w));
    ctx.globalAlpha = 1;
}

// Карточка уровня: название, исполнитель, сложность, откуда уровень, опции
function card(ctx, x, y, w, h, u, v) {
    const d = data;
    ctx.globalAlpha = v.appear;
    around(ctx, x + w / 2, y + h / 2, 1 + v.jump * 0.3, () => {
        ctx.translate(-(1 - v.appear) * 60 * u, 0);          // выезжает слева
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(2, 5 * u);
        roundRect(ctx, x, y, w, h, 24 * u);
        ctx.stroke();

        const ix = x + 30 * u, iw = w - 60 * u;
        ctx.fillStyle = '#fff';
        ctx.font = `700 ${50 * u}px ${UI}`;
        fitText(ctx, d.title, ix, y + 72 * u, iw);
        ctx.font = `400 ${28 * u}px ${UI}`;
        ctx.globalAlpha = 0.7 * v.appear;
        fitText(ctx, d.artist, ix, y + 112 * u, iw);
        ctx.globalAlpha = v.appear;

        // сложность и плашка «откуда уровень»
        const rowY = y + 176 * u;
        drawDiffIcon(ctx, d.diff.icon, ix, rowY - 34 * u, 44 * u);
        ctx.font = `700 ${30 * u}px ${UI}`;
        ctx.fillStyle = '#fff';
        ctx.fillText(d.diff.name, ix + 58 * u, rowY);
        const after = ix + 58 * u + ctx.measureText(d.diff.name).width + 22 * u;
        let optX = ix;
        if (d.sourceLabel) {
            const pw = pillWidth(ctx, d.sourceLabel, u);
            if (after + pw <= ix + iw) pill(ctx, d.sourceLabel, after, rowY - 30 * u, u);
            else optX = pill(ctx, d.sourceLabel, ix, rowY + 20 * u, u) + 14 * u;   // не влезло — в нижнюю строку
        }

        // опции (если включены — это видно и на картинке)
        ctx.font = `500 ${22 * u}px ${UI}`;
        ctx.globalAlpha = 0.7 * v.appear;
        ctx.fillStyle = '#fff';
        const opts = d.options.length ? `Опции: ${d.options.join(', ')}` : 'Без опций';
        fitText(ctx, opts, optX, y + 226 * u, ix + iw - optX);
    });
    ctx.globalAlpha = 1;
}

function pillWidth(ctx, text, u) {
    ctx.font = `700 ${18 * u}px ${UI}`;
    return ctx.measureText(text.toUpperCase()).width + 28 * u;
}

// Белая плашка с чёрным текстом (или только контур); возвращает правый край
function pill(ctx, text, x, y, u, filled = true) {
    const w = pillWidth(ctx, text, u);
    const h = 34 * u;
    roundRect(ctx, x, y, w, h, h / 2);
    if (filled) {
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.fillStyle = '#000';
    } else {
        ctx.lineWidth = Math.max(1.5, 3 * u);
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.fillStyle = '#fff';
    }
    ctx.fillText(text.toUpperCase(), x + 14 * u, y + h * 0.7);
    ctx.fillStyle = '#fff';
    return x + w;
}

// Счёт, точность, комбо и попадания — числа набегают от нуля; возвращает высоту
function stats(ctx, x, y, w, u, v) {
    const d = data;
    const k = v.count;
    const num = n => Math.round(n * k);
    ctx.globalAlpha = v.appear;
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = 0.6 * v.appear;
    ctx.font = `700 ${20 * u}px ${UI}`;
    ctx.fillText('СЧЁТ', x, y + 20 * u);
    ctx.globalAlpha = v.appear;
    ctx.font = `700 ${84 * u}px ${UI}`;
    const score = String(num(d.score)).padStart(6, '0');
    const sw = Math.min(w, ctx.measureText(score).width);
    around(ctx, x + sw / 2, y + 70 * u, 1 + v.jump * 0.6, () => fitText(ctx, score, x, y + 100 * u, w));

    const rows = [
        ['Точность', `${(d.acc * k * 100).toFixed(2).replace('.', ',')} %`],
        ['Макс. комбо', `${num(d.maxCombo)}x`],
        ['Идеально', num(d.counts[0])], ['Отлично', num(d.counts[1])],
        ['Хорошо', num(d.counts[2])], ['Мимо', num(d.counts[3])],
        ['Лишние нажатия', num(d.extra || 0)]
    ];
    ctx.font = `500 ${26 * u}px ${UI}`;
    const two = w >= 520 * u;                  // узко — в один столбик
    rows.forEach(([key, val], i) => {
        const cx = x + (two ? (i % 2) * w / 2 : 0);
        const cy = y + 150 * u + (two ? Math.floor(i / 2) : i) * 40 * u;
        ctx.globalAlpha = 0.6 * v.appear;
        ctx.fillText(key, cx, cy);
        const kw = ctx.measureText(key).width;
        ctx.globalAlpha = v.appear;
        ctx.fillText(String(val), cx + kw + 12 * u, cy);
    });
    ctx.globalAlpha = 1;
    return 150 * u + (two ? Math.ceil(rows.length / 2) : rows.length) * 40 * u;
}

// Огромная буква оценки (с наклоном, как у логотипа): влетает с «бумом» и волной
function grade(ctx, x, base, size, u, v) {
    if (v.grade <= 0) return;
    const d = data;
    const g = d.grade;
    const p = v.grade;
    ctx.font = `${size}px ${BIG}`;
    const m = ctx.measureText(g);
    const top = base - m.actualBoundingBoxAscent;
    const cx = x + size * 0.12 + m.width / 2;
    const cy = (top + base) / 2;

    // волна от буквы в момент появления
    if (p < 1) {
        ctx.globalAlpha = (1 - p) * 0.8;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(2, 6 * u * (1 - p));
        ctx.beginPath();
        ctx.arc(cx, cy, size * (0.3 + p * 0.9), 0, Math.PI * 2);
        ctx.stroke();
    }

    const back = 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;   // с перелётом, как пружина
    const s = (2.4 - 1.4 * back) * (1 + v.jump * 1.2);
    ctx.globalAlpha = Math.min(1, p * 3);
    around(ctx, cx, cy, s, () => {
        ctx.save();
        ctx.translate(x + size * 0.12, base);
        ctx.transform(1, 0, Math.tan(-11 * Math.PI / 180), 1, 0, 0);
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(3, size * 0.04);
        ctx.strokeStyle = '#fff';
        ctx.fillStyle = g === 'F' || g === 'D' ? '#000' : '#fff';   // плохие оценки — только контур
        ctx.fillText(g, 0, 0);
        ctx.strokeText(g, 0, 0);
        ctx.restore();
    });

    // «ОЦЕНКА» и состояние: пройден / провал / авто
    const ly = top - 22 * u;
    ctx.font = `700 ${20 * u}px ${UI}`;
    ctx.globalAlpha = 0.6 * Math.min(1, p * 2);
    ctx.fillStyle = '#fff';
    ctx.fillText('ОЦЕНКА', x, ly);
    ctx.globalAlpha = Math.min(1, p * 2);
    const state = d.failed ? 'Провал' : d.auto ? 'Авто' : 'Пройден';
    pill(ctx, state, x + ctx.measureText('ОЦЕНКА').width + 16 * u, ly - 25 * u, u, d.failed || d.auto);
    ctx.globalAlpha = 1;
}

// График: белая линия — точность, серая заливка — здоровье, чёрточки снизу — промахи.
// Строится слева направо, а «перо» бежит по концу линии
function graph(ctx, x, y, w, h, u, v) {
    const d = data;
    ctx.globalAlpha = v.appear;
    around(ctx, x + w / 2, y + h / 2, 1 + v.jump * 0.2, () => {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(2, 4 * u);
        roundRect(ctx, x, y, w, h, 22 * u);
        ctx.stroke();

        const ix = x + 26 * u, iw = w - 52 * u;
        const top = y + 70 * u, bot = y + h - 26 * u, ih = bot - top;
        ctx.font = `700 ${19 * u}px ${UI}`;
        ctx.fillStyle = '#fff';
        ctx.globalAlpha = 0.6 * v.appear;
        ctx.fillText('ТОЧНОСТЬ И ЗДОРОВЬЕ', ix, y + 42 * u);
        ctx.globalAlpha = v.appear;

        // легенда справа
        ctx.font = `500 ${18 * u}px ${UI}`;
        ctx.textAlign = 'right';
        const lx = ix + iw;
        ctx.fillText('здоровье', lx, y + 42 * u);
        const hw = ctx.measureText('здоровье').width;
        ctx.globalAlpha = 0.35 * v.appear;
        ctx.fillRect(lx - hw - 34 * u, y + 28 * u, 24 * u, 16 * u);
        ctx.globalAlpha = v.appear;
        const ax = lx - hw - 54 * u;
        ctx.fillText('точность', ax, y + 42 * u);
        const aw = ctx.measureText('точность').width;
        ctx.fillRect(ax - aw - 34 * u, y + 34 * u, 24 * u, 4 * u);
        ctx.textAlign = 'left';

        if (ih < 20) return;
        // линии сетки: 0, 50 и 100 %
        ctx.globalAlpha = 0.15 * v.appear;
        ctx.lineWidth = 1;
        for (const val of [0, 0.5, 1]) {
            ctx.beginPath();
            ctx.moveTo(ix, bot - val * ih);
            ctx.lineTo(ix + iw, bot - val * ih);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        if (v.graph <= 0) return;

        // всё, что дальше, видно только до «пера»
        ctx.save();
        ctx.beginPath();
        ctx.rect(ix - 4, top - 10, iw * v.graph + 4, ih + 20);
        ctx.clip();
        const s = d.samples;
        const len = Math.max(1, d.length);
        const X = t => ix + Math.min(1, Math.max(0, t / len)) * iw;
        const Y = val => bot - val * ih;
        if (s.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(X(s[0].t), bot);
            for (const p of s) ctx.lineTo(X(p.t), Y(p.hp));
            ctx.lineTo(X(s[s.length - 1].t), bot);
            ctx.closePath();
            ctx.globalAlpha = 0.25;
            ctx.fillStyle = '#fff';
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.beginPath();
            s.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p.acc)) : ctx.moveTo(X(p.t), Y(p.acc))));
            ctx.lineWidth = Math.max(2, 4 * u);
            ctx.lineJoin = 'round';
            ctx.strokeStyle = '#fff';
            ctx.stroke();
        }
        ctx.lineWidth = Math.max(1.5, 3 * u);
        ctx.globalAlpha = 0.8;
        for (const t of d.misses) {
            ctx.beginPath();
            ctx.moveTo(X(t), bot);
            ctx.lineTo(X(t), bot - 12 * u);
            ctx.stroke();
        }
        ctx.restore();

        // перо: светящаяся точка на конце линии, пока график строится
        if (v.graph < 1 && s.length >= 2) {
            const tx = len * v.graph;
            let k = s.findIndex(p => p.t >= tx);
            if (k < 0) k = s.length - 1;
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(ix + iw * v.graph, Y(s[k].acc), Math.max(3, 7 * u), 0, Math.PI * 2);
            ctx.fill();
        }
    });
    ctx.globalAlpha = 1;
}

// Подпись на сохранённой картинке (там, где на экране кнопки)
function footer(ctx, right, base, u) {
    const d = data.date;
    const pad2 = n => String(n).padStart(2, '0');
    const when = `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}  ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${26 * u}px ${UI}`;
    ctx.fillText('waltika9.github.io/dahz', right, base);
    ctx.font = `500 ${22 * u}px ${UI}`;
    ctx.globalAlpha = 0.6;
    ctx.fillText(when, right, base - 38 * u);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
}

// Текст, который не вылезает за ширину (лишнее — в «…»)
function fitText(ctx, text, x, y, maxW) {
    let s = String(text);
    if (ctx.measureText(s).width > maxW) {
        while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
        s += '…';
    }
    ctx.fillText(s, x, y);
}
