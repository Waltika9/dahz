// ===== Пёсик на блоке «Сейчас» =====
// Белый пиксельный пёсик по мотивам Надоедливой собаки Тоби Фокса (Undertale).
// Живёт на верхней рамке блока «Сейчас» всегда: и на уроке, и на перемене, и дома.
//
// Занятия (новое — каждые 10–20 секунд, случайно): стоит и дышит, спит («Zzz»), гуляет,
// бегает (пыль из-под лап), играет с мячиком, грызёт косточку или пирог, надевает цилиндр,
// праздничный колпак (конфетти) или картонную коробку, лает («ГАВ!»), виляет хвостом,
// сидит и даёт лапу, валяется на спине, тянется лапой к верёвке, которая спускается сверху. Между позами всегда есть кадры-мостики:
// стоит → сидит → лежит, шаг → стоп, разворот через анфас. Координата X никогда
// не сбрасывается — пёсик не телепортируется.
//
// Нажатие — прыжок. Нажал сразу после приземления — следующий выше; 2 секунды без нажатий —
// сила сбрасывается. 4-й прыжок уносит пёсика за экран, через пару секунд он с грохотом
// падает и сбивает блоки «Сейчас» и «Дальше» вниз экрана (вкладки и часы остаются на месте).
// Ещё нажатие — блоки вместе с пёсиком едут обратно.
// Нажали и потянули вбок — пёсик идёт (или бежит) за пальцем или курсором; отпустили —
// он уходит в случайное место (влево, в середину или вправо) и живёт дальше как обычно.
// Пока идёт сигнал (конец урока / пора на урок), пёсик стоит и трясётся вместе с блоком.
//
// Пиксель пёсика = 3×3 CSS-пикселя, координаты всегда целые (image-rendering: pixelated) —
// ничего не мылится и не дрожит. Чёрный контур дорисовывается автоматически.
// В прыжке пёсик рисуется на холсте поверх всей страницы (выше вкладок) с той же сеткой.

import { now } from './clock.js?v=1';
import { beatAt } from './beat.js?v=1';
import { PixBuf, color } from './pixbuf.js?v=1';

const P = 3;                    // 1 пиксель пёсика = 3×3 CSS-пикселя
const ROOM = 44;                // высота холста над блоком: место для шляп, мячика, «Zzz»
const COMBO_GAP = 2;            // сек после приземления: нажал за это время — прыжок выше
const HOPS = [0, 4, 10, 20];    // высота прыжков 1–3 (пикс.); 4-й — полёт за экран
const GRAV = 360;               // ускорение падения, пикс/с²
const WALK = 9, RUN = 32;       // скорость шага и бега, пикс/с

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const easeOut = (k) => 1 - (1 - k) * (1 - k);

// ----- Цвета -----
// Символ в спрайте → код пикселя → цвет. '.' — пусто.
const CODE = { '#': 1, w: 1, o: 2, g: 3, p: 4, r: 5, k: 6, h: 7, y: 8, b: 9, c: 10, d: 11, n: 12, u: 13, f: 14, t: 15 };
const OUT = 254;                // автоматический контур
const HEX = ['#000000', '#ffffff', '#000000', '#c5cedb', '#f472b6', '#ef4444', '#2b3040', '#7b8494',
    '#facc15', '#60a5fa', '#d9a066', '#a8703a', '#fff2cc', '#b45f2a', '#f6b73c', '#f9d77e'];
const PAL_DAY = HEX.map(color);
const PAL_NIGHT = HEX.map((h, i) => color(i === 3 ? '#aab7dc' : h));

const INK = color('#000000');
const WHITE = color('#ffffff');
const FX_DAY = { dust: ['#cbd5e1', '#94a3b8'].map(color), z: color('#64748b'), line: color('#0f172a'), shadow: color('#0f172a'), star: color('#0f172a') };
const FX_NIGHT = { dust: ['#4a5a92', '#9fb2dc'].map(color), z: color('#c7d2fe'), line: color('#c7d2fe'), shadow: color('#02061a'), star: color('#ffffff') };
const CONFETTI = ['#f472b6', '#facc15', '#60a5fa', '#4ade80', '#fb923c'].map(color);
const DEBRIS = ['#ffffff', '#000000', '#94a3b8'].map(color);
const GOLD = color('#facc15');

// ----- Спрайты -----
// Смотрят вправо (влево — зеркально). '#' белый, 'o' чёрный, 'g' серый (дальние лапы).
// Внешний контур не рисуем — его добавляет Layer.finish().
// Позы собираются в «коробке» 20×15: столбец 10 — центр пёсика, строка 14 — подошвы.

// Голова 12×8. Столбец 0 — край уха (x = −1); глаз (6, 3–4), нос (10, 4), рот (7–8, 6)
const HEAD = [
    '...#######..',
    '..#########.',
    '.ooo########',
    '.##o###o####',
    '.##o###o###o',
    '.##o########',
    '.#o#####oo#.',
    '.o.#######..'
];

// Выражения морды — правки поверх головы: [x, y, символ]
const FACES = {
    open: [],
    closed: [[6, 3, '#'], [5, 4, 'o'], [6, 4, 'o']],
    happy: [[6, 3, 'o'], [6, 4, '#'], [5, 4, 'o'], [7, 4, 'o']],
    up: [[6, 4, '#'], [6, 2, 'o']],
    bark: [[8, 6, 'p'], [9, 6, 'p'], [9, 7, '#'], [10, 7, '#']],
    chew: [[8, 6, 'p'], [9, 7, '#']],
    tongue: [[8, 7, 'p'], [8, 8, 'p'], [9, 8, 'p']],
    yawn: [[6, 3, '#'], [5, 4, 'o'], [6, 4, 'o'], [8, 6, 'p'], [9, 6, 'p'], [9, 7, '#'], [10, 7, '#']]
};

// Поднятая передняя лапа (ближняя): какую опущенную лапу стереть и что нарисовать.
// 1 — чуть вперёд, 2 — высоко (тянется)
const PAWS = {
    stand: {
        erase: [12, 14],
        1: [[15, 11], [16, 11], [16, 10], [17, 10]],
        2: [[15, 10], [16, 10], [16, 9], [17, 9], [17, 8], [18, 8]]
    },
    sit: {
        erase: [11, 14],
        1: [[14, 10], [15, 10], [16, 10], [17, 10], [14, 11], [15, 11], [16, 11], [17, 11]],
        2: [[14, 9], [15, 9], [16, 9], [17, 9], [14, 10], [15, 10], [16, 10], [17, 8], [18, 8]]
    }
};

// Хвост: точки от его основания
const TAILS = {
    up: [[0, -1], [0, -2], [0, -3], [1, -1]],
    l: [[0, -1], [-1, -2], [-1, -3], [-2, -4]],
    r: [[0, -1], [1, -2], [1, -3], [2, -4]],
    down: [[-1, 0], [-1, 1], [-2, 2]],
    ground: [[-1, 0], [-2, 0], [-3, -1]],
    flick: [[-1, 0], [-2, -1], [-3, -2]]       // лежащий хвост приподнялся
};
const WAG = ['l', 'up', 'r', 'up'];

// Туловище стоя (строки 7–11), лапы рисуются отдельно
const STAND_TORSO = [
    '###########.........',
    '###############.....',
    '###############.....',
    '.##############.....',
    '.##############.....'
];

// Сидит (строки 7–14): задняя лапа поджата, передние прямые
const SIT = [
    '.........##.........',
    '........######......',
    '.......#######......',
    '......########......',
    '.....####o#gg##.....',
    '....####o##gg##.....',
    '....####o##gg##.....',
    '....#######gg##.....'
];

// Лежит (строки 10–14), голова поднята / опущена на лапы
const LIE_UP = [
    '..#######...........',
    '.###############....',
    '################....',
    '################....',
    '####################'
];
const LIE = [
    '..######............',
    '.#########..........',
    '###########.........',
    '############........',
    '####################'
];

// Анфас — средний кадр разворота (15×15, центр — столбец 7)
const FRONT = [
    '....#######....',
    '...#########...',
    '..ooo#####ooo..',
    '.##o#######o##.',
    '.##o#o###o#o##.',
    '.##o#o###o#o##.',
    '.#o###ooo###o#.',
    '.o.####o####.o.',
    '....##o#o##....',
    '.....#####.....',
    '...#########...',
    '...#########...',
    '...gg##.##gg...',
    '...gg##.##gg...',
    '...gg##.##gg...'
];

// Лапы: дальние (серые) задняя и передняя, ближние (белые) задняя и передняя.
// Для каждой — сдвиг по x в строках 12, 13, 14.
const LEG_X = [1, 10, 4, 13];
const GAITS = {
    stand: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
    walk0: [[0, -1, -1], [0, -1, -1], [0, 1, 1], [0, 1, 1]],
    walk2: [[0, 1, 1], [0, 1, 1], [0, -1, -1], [0, -1, -1]],
    run0: [[-1, -2, -3], [1, 2, 3], [-1, -2, -3], [1, 2, 3]],
    run1: [[1, 2, 2], [-1, -2, -2], [1, 2, 2], [-1, -2, -2]]
};
const WALK_LEGS = ['walk0', 'stand', 'walk2', 'stand'];

const STAND = { rows: STAND_TORSO, r0: 7, breath: [6, '..######'], neck: '###############', head: [9, 0], tail: [0, 7], legs: 3 };
const BODIES = {
    stand: STAND,
    crouch: { ...STAND, sink: 1, legs: 2 },
    deep: { ...STAND, sink: 2, legs: 1 },
    squash: { ...STAND, sink: 3, legs: 0 },
    sit: { rows: SIT, r0: 7, head: [9, 0], tail: [4, 14] },
    lieUp: { rows: LIE_UP, r0: 10, breath: [9, '...####'], head: [9, 3], tail: [0, 13] },
    lie: { rows: LIE, r0: 10, breath: [9, '...####'], head: [9, 6], tail: [0, 13] }
};

// Вещи
const TOP_HAT = [
    '..kkkkk..',
    '..khkkk..',
    '..khkkk..',
    '..kkkkk..',
    '..rrrrr..',
    'kkkkkkkkk'
];
const PARTY_HAT = [
    '...w...',
    '..www..',
    '...p...',
    '..yyy..',
    '..ppp..',
    '.bbbbb.',
    '.yyyyy.',
    'ppppppp'
];
// Коробка надевается на голову целиком; в дырках блестят глаза (смотрят по сторонам)
const box = (e) => [
    'ccccccccccccc',
    'cccccdccccccc',
    'cccccdccccccc',
    'ccccccccccccc',
    `ccccccc${e}c${e}c`,
    'cccccccoocooc',
    'ccccccccccccc',
    'ccccccccccccc',
    'ddddddddddddd'
];
const BOX_L = box('wo'), BOX_R = box('ow'), BOX_SHUT = box('oo');
const BALLS = [
    ['.rrr.', 'rwrrr', 'rrrrr', 'rrrrr', '.rrr.'],
    ['.rrr.', 'rrrwr', 'rrrrr', 'rrrrr', '.rrr.'],
    ['.rrr.', 'rrrrr', 'rrrrr', 'rrrwr', '.rrr.'],
    ['.rrr.', 'rrrrr', 'rrrrr', 'rwrrr', '.rrr.']
];
const BONE = [
    'nn.....nn',
    'nnnnnnnnn',
    'nnnnnnnnn',
    'nn.....nn'
];
const PIE = [
    '......ttu',
    '....ttttu',
    '..ttffffu',
    'ttffffffu',
    'uuuuuuuuu'
];

// «ГАВ!» и буквы «Z» трёх размеров
const GAV = [
    '###..#..##..#',
    '#...#.#.#.#.#',
    '#...###.##..#',
    '#...#.#.#.#..',
    '#...#.#.##..#'
];
const Z = [
    ['###', '.#.', '###'],
    ['####', '..#.', '.#..', '####'],
    ['#####', '...#.', '..#..', '.#...', '#####']
];

// ----- Сборка позы -----
// Части рисуются на черновик по порядку (позже нарисованное перекрывает раннее),
// потом из черновика берутся точки относительно центра пёсика. Готовые позы кэшируются.

const GW = 160, GH = 48, GX = 100, GY = 24;   // точка (0, 0) коробки → (GX, GY) черновика
const grid = new Uint8Array(GW * GH);
const cache = new Map();

function gput(x, y, c) {
    const gx = x + GX, gy = y + GY;
    if (gx >= 0 && gy >= 0 && gx < GW && gy < GH) grid[gy * GW + gx] = c;
}

function gRows(rows, x, y) {
    rows.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) {
            const c = CODE[row[i]];
            if (c) gput(x + i, y + j, c);
        }
    });
}

function gLegs(gait, len) {
    const g = GAITS[gait] || GAITS.stand;
    for (let n = 0; n < 4; n++) {
        const c = n < 2 ? CODE.g : CODE['#'];
        for (let r = 0; r < len; r++) {
            const x = LEG_X[n] + g[n][r + 3 - len];
            gput(x, 15 - len + r, c);
            gput(x + 1, 15 - len + r, c);
        }
    }
}

// flipY — пёсик вверх ногами (лежит на спине), paw — поднятая передняя лапа (1 или 2)
function pose(body, o) {
    const lying = body === 'sit' || body === 'lie' || body === 'lieUp';
    return { body, legs: 'stand', head: 'open', tail: lying ? 'ground' : 'up', breathe: 0, headDy: 0, paw: 0, flipY: 0, ox: 0, oy: 0, ...o };
}

function buildDog(p) {
    const key = `${p.body}|${p.legs}|${p.head}|${p.tail}|${p.breathe}|${p.headDy}|${p.paw}|${p.flipY}`;
    let s = cache.get(key);
    if (s) return s;

    grid.fill(0);
    let hx = 9, hy = 0;
    if (p.body === 'front') {
        gRows(FRONT, 3, 0);
    } else {
        const b = BODIES[p.body];
        const sink = b.sink || 0;
        for (const [dx, dy] of TAILS[p.tail] || []) gput(b.tail[0] + dx, b.tail[1] + sink + dy, CODE['#']);
        gRows(b.rows, 0, b.r0 + sink);
        if (p.breathe && b.breath) gRows([b.breath[1]], 0, b.breath[0] + sink);
        if (p.headDy < 0 && b.neck) gRows([b.neck], 0, b.r0 + sink);    // голова приподнялась — шея за ней
        if (b.legs) gLegs(p.legs, b.legs);
        const paw = p.paw && PAWS[p.body];
        if (paw) {
            for (let y = paw.erase[0]; y <= paw.erase[1]; y++) { gput(13, y, 0); gput(14, y, 0); }
            for (const [x, y] of paw[p.paw]) gput(x, y + sink, CODE['#']);
        }
        hx = b.head[0];
        hy = b.head[1] + sink + p.headDy;
        gRows(HEAD, hx - 1, hy);
        for (const [x, y, ch] of FACES[p.head] || []) gput(hx + x, hy + y, CODE[ch] || 0);
    }

    const pix = [];
    let x0 = 99, x1 = -99, y0 = 99, y1 = -99;
    for (let gy = 0; gy < GH; gy++) {
        for (let gx = 0; gx < GW; gx++) {
            const c = grid[gy * GW + gx];
            if (!c) continue;
            const x = gx - GX - 10, y = gy - GY - 14;
            pix.push(x, y, c);
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
        }
    }
    // на спине: переворачиваем по вертикали, спина остаётся на полу
    if (p.flipY) for (let i = 1; i < pix.length; i += 3) pix[i] = y0 + y1 - pix[i];
    s = { pix: Int16Array.from(pix), x0, x1, y0, y1, hx: hx - 10, hy: hy - 14 };
    if (cache.size > 600) cache.clear();
    cache.set(key, s);
    return s;
}

// ----- Холст с автоматическим контуром -----
// Сначала рисуем коды пикселей, потом вокруг всего нарисованного — чёрный контур
// в 1 пиксель (как в Undertale), и только потом коды превращаются в цвета.

class Layer {
    constructor(canvas) {
        this.buf = new PixBuf(canvas);
        this.code = new Uint8Array(this.buf.w * this.buf.h);
    }

    resize(w, h) {
        this.buf.resize(w, h);
        this.code = new Uint8Array(this.buf.w * this.buf.h);
    }

    begin() {
        this.code.fill(0);
        this.buf.clear();
        this.x0 = this.y0 = 1e9;
        this.x1 = this.y1 = -1e9;
    }

    put(x, y, c) {
        const { w, h } = this.buf;
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        this.code[y * w + x] = c;
        if (x < this.x0) this.x0 = x;
        if (x > this.x1) this.x1 = x;
        if (y < this.y0) this.y0 = y;
        if (y > this.y1) this.y1 = y;
    }

    sprite(rows, x, y, flip) {
        for (let j = 0; j < rows.length; j++) {
            const row = rows[j], n = row.length;
            for (let i = 0; i < n; i++) {
                const c = CODE[row[i]];
                if (c) this.put(flip ? x + n - 1 - i : x + i, y + j, c);
            }
        }
    }

    finish(pal) {
        if (this.x1 < this.x0) return;
        const { w, h, px } = this.buf, code = this.code;
        const xa = Math.max(0, this.x0 - 1), xb = Math.min(w - 1, this.x1 + 1);
        const ya = Math.max(0, this.y0 - 1), yb = Math.min(h - 1, this.y1 + 1);
        const solid = (j) => code[j] !== 0 && code[j] !== OUT;
        for (let y = ya; y <= yb; y++) {
            for (let x = xa; x <= xb; x++) {
                const i = y * w + x;
                if (code[i]) continue;
                if ((x > 0 && solid(i - 1)) || (x < w - 1 && solid(i + 1)) ||
                    (y > 0 && solid(i - w)) || (y < h - 1 && solid(i + w))) code[i] = OUT;
            }
        }
        for (let y = ya; y <= yb; y++) {
            for (let x = xa; x <= xb; x++) {
                const i = y * w + x, c = code[i];
                if (c) px[i] = c === OUT ? pal[2] : (pal[c] ?? WHITE);
            }
        }
    }
}

// ----- Состояние -----

let card, stack, canvas, air, hit, L, A;
let W = 0, groundY = ROOM - 2, minX = 12, maxX = 12, bw = 3;
let visible = false, raf = 0, lastT = 0;
let T = 0;                      // часы пёсика (сек); стоят, пока вкладка IRL не на экране
let beatNow = { index: 0, phase: 0 };
let night = false, wasNight = false, signal = false;

const dog = { x: 0, face: 1, lift: 0 };   // центр, куда смотрит (1 — вправо), высота над рамкой
let act = null, queue = null, nextPick = 4, forceSleep = false;
let hop = null, combo = 0, lastLand = -10;
let dropped = false, stackOff = 0, stackAnim = null, cheerUntil = 0;
let lastPose = null, lastProps = [];
let parts = [], zs = [], loose = [], bubble = null;
let hitKey = '';
let rope = null;                // верёвка сверху: { x, y — узелок (пиксели холста), want, amp, top, leave }
let press = null;               // палец/мышь нажали на пёсика: { id, x } — ещё не ясно, тап или тянут
let dragging = false, dragX = 0; // тянут: пёсик идёт к dragX (пиксели холста)

export function initDog(opts) {
    card = opts.card;
    stack = opts.stack;

    canvas = document.createElement('canvas');
    canvas.className = 'dog';
    canvas.setAttribute('aria-hidden', 'true');
    card.append(canvas);
    L = new Layer(canvas);

    air = document.createElement('canvas');
    air.className = 'dog-air';
    air.setAttribute('aria-hidden', 'true');
    air.hidden = true;
    document.body.append(air);
    A = new Layer(air);

    // Невидимая «кнопка» по контуру пёсика: нажали и отпустили — прыжок,
    // нажали и потянули вбок — пёсик идёт за пальцем
    hit = document.createElement('div');
    hit.className = 'dog-hit';
    hit.setAttribute('role', 'button');
    hit.tabIndex = 0;
    hit.setAttribute('aria-label', 'Пёсик — нажми, и он подпрыгнет; потяни — пойдёт за тобой');
    hit.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        press = { id: e.pointerId, x: e.clientX };
        try { hit.setPointerCapture(e.pointerId); } catch (err) { /* без захвата тоже работает */ }
    });
    hit.addEventListener('pointermove', (e) => {
        if (!press || e.pointerId !== press.id) return;
        if (!dragging && Math.abs(e.clientX - press.x) > 8) startDrag();
        if (dragging) dragX = (e.clientX - canvas.getBoundingClientRect().left) / P;
    });
    const release = (e) => {
        if (!press || e.pointerId !== press.id) return;
        press = null;
        if (dragging) endDrag();
        else if (e.type === 'pointerup') tap();
    };
    hit.addEventListener('pointerup', release);
    hit.addEventListener('pointercancel', release);
    hit.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); }
    });
    card.append(hit);

    new ResizeObserver(() => { W = 0; }).observe(card);
    new ResizeObserver(refitStack).observe(stack);
    window.addEventListener('resize', () => { W = 0; sizeAir(); refitStack(); });
    sizeAir();

    layout();
    dog.x = W ? Math.round(rand(minX, maxX)) : 40;
    dog.face = Math.random() < 0.5 ? 1 : -1;
    startAction('idle');
}

// Рисуем, только пока вкладка IRL на экране — бережём батарею
export function setDogVisible(on) {
    if (on === visible) return;
    visible = on;
    cancelAnimationFrame(raf);
    if (on) {
        lastT = 0;
        raf = requestAnimationFrame(loop);
    } else {
        air.hidden = true;
    }
}

function loop(t) {
    dogFrame(t);
    raf = requestAnimationFrame(loop);
}

// Холст над блоком: во всю ширину блока, ROOM пикселей в высоту
function layout() {
    const w = Math.floor(card.offsetWidth / P);
    if (!w) return;                 // вкладка скрыта
    W = w;
    bw = parseFloat(getComputedStyle(card).borderTopWidth) || 3;
    canvas.style.width = `${W * P}px`;
    canvas.style.height = `${ROOM * P}px`;
    L.resize(W, ROOM);
    groundY = ROOM - 2;             // нижний ряд лап; под ним — контур, а под контуром рамка блока
    minX = 12;
    maxX = Math.max(minX, W - 13);
    dog.x = clamp(dog.x, minX, maxX);
    hitKey = '';
}

function sizeAir() {
    const w = Math.ceil(innerWidth / P) + 2, h = Math.ceil(innerHeight / P) + 2;
    A.resize(w, h);
    air.style.width = `${w * P}px`;
    air.style.height = `${h * P}px`;
}

// ----- Кадры-мостики -----

const S = (p, d, o) => ({ p, d, ...o });
const P_STAND = pose('stand');
const P_FRONT = pose('front');
const P_SIT = pose('sit');
const P_LIEUP = pose('lieUp');
const P_DOZE = pose('lieUp', { head: 'closed' });
// Разворот: стоит → анфас → стоит в другую сторону
const TURN_STEPS = [S(P_STAND, 0.08), S(P_FRONT, 0.16), S(P_STAND, 0.08, { flip: true })];

const sumSteps = (steps) => steps.reduce((s, x) => s + x.d, 0);

function stepAt(steps, t) {
    for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        if (t < s.d || i === steps.length - 1) return { i, s, k: clamp(t / s.d, 0, 1) };
        t -= s.d;
    }
    return null;
}

function stepPose(steps, t) {
    const st = stepAt(steps, t);
    if (!st) return P_STAND;
    return typeof st.s.p === 'function' ? st.s.p(st.k) : st.s.p;
}

// Дошли до нового кадра последовательности — применить разворот, если он там есть
function syncSteps(o) {
    const st = stepAt(o.steps, T - o.t0);
    if (!st) return;
    while (o.si < st.i) {
        o.si++;
        if (o.steps[o.si].flip) dog.face = -dog.face;
    }
}

const inhale = (beat) => (beat.index % 2 === 0 ? 1 : 0);

// ----- Занятия: начало (кадры входа) → основная часть → кадры выхода → idle -----

function startAction(name, instant = false) {
    const def = ACTIONS[name];
    const a = { name, def, phase: 'enter', t0: T, d: {}, until: nextPick, steps: [], si: -1, len: 0 };
    act = a;
    a.steps = def.start?.(a) || [];
    a.len = sumSteps(a.steps);
    if (instant || !a.len) {
        a.phase = 'loop';
        a.t0 = T;
    }
}

// Попросить закончить занятие (через кадры выхода), потом начать next
function leave(next = null) {
    queue = next;
    const a = act;
    if (a.name === 'idle') {
        if (next) startAction(next);
        return;
    }
    if (a.phase === 'enter') { a.leaveAsap = true; return; }
    if (a.phase === 'exit') return;
    if (a.def.leave?.(a)) return;   // занятие доиграет само (добежит, доест, подбросит мячик)
    exitNow(a);
}

function exitNow(a) {
    if (a.phase === 'exit') return;
    a.phase = 'exit';
    a.t0 = T;
    a.si = -1;
    a.steps = a.def.exit?.(a) || [];
    a.len = sumSteps(a.steps);
}

// Случайный выбор следующего занятия
const WEIGHTS = {
    idle: 1, sleeping: 2, walking: 3, running: 2, playing_ball: 2, eating: 2,
    hat_classy: 1.5, hat_party: 1.5, hat_box: 1.5, bark: 1.5, tail_wag: 2,
    sitting: 2, rolling: 1.5, rope: 1.5
};

function choose() {
    const list = [];
    let sum = 0;
    for (const [name, w0] of Object.entries(WEIGHTS)) {
        if (name === act.name || (ACTIONS[name].can && !ACTIONS[name].can())) continue;
        const w = name === 'sleeping' && night ? 8 : w0;      // дома пёсик чаще спит
        list.push([name, w]);
        sum += w;
    }
    let r = Math.random() * sum;
    for (const [name, w] of list) if ((r -= w) <= 0) return name;
    return 'idle';
}

function think() {
    if (hop || stackAnim || act.name === 'follow') return;
    if (signal) {
        // сигнал: бросает всё, встаёт и трясётся
        if (act.name !== 'idle') leave();
        queue = null;
        nextPick = Math.max(nextPick, T + 3);
        return;
    }
    if (night !== wasNight) {
        wasNight = night;
        if (night) {
            // наступил вечер — пёсик ложится спать (если страницу только открыли — сразу спит)
            if (T < 1.5) {
                startAction('sleeping', true);
                nextPick = T + rand(10, 20);
                return;
            }
            forceSleep = true;
            nextPick = Math.min(nextPick, T + 2);
        }
    }
    if (T < nextPick) return;
    nextPick = T + rand(10, 20);
    if (act.name === 'sleeping' && night && !forceSleep && Math.random() < 0.65) return;   // спит дальше
    const name = forceSleep ? 'sleeping' : choose();
    forceSleep = false;
    if (name !== act.name) leave(name);
}

function update(dt) {
    for (const q of loose) {
        q.x += q.vx * dt;
        q.y += q.vy * dt;
    }
    loose = loose.filter(q => q.y > -24);

    if (hop) { updateHop(dt); return; }

    const a = act;
    if (a.phase === 'enter') {
        syncSteps(a);
        if (T - a.t0 >= a.len) {
            a.phase = 'loop';
            a.t0 = T;
            if (a.leaveAsap) leave(queue);
        }
    }
    if (a.phase === 'loop') a.def.update?.(a, dt, beatNow);
    if (act === a && a.phase === 'exit') {
        syncSteps(a);
        if (T - a.t0 >= a.len) {
            const next = queue || 'idle';
            queue = null;
            startAction(next);
        }
    }
}

function currentPose() {
    if (hop) return hopPose();
    const a = act;
    if (a.phase !== 'loop') return stepPose(a.steps, T - a.t0);
    return a.def.pose ? a.def.pose(a, beatNow) : P_STAND;
}

// ----- Ходьба и развороты -----

const TURN_T = [0.08, 0.24, 0.32];      // стоит | анфас | стоит в другую сторону

function startTurn(a) {
    a.d.turnAt = T;
    a.d.flipped = false;
}

// true, пока разворот идёт
function turning(a) {
    const k = T - a.d.turnAt;
    if (k >= TURN_T[1] && !a.d.flipped) {
        dog.face = -dog.face;
        a.d.flipped = true;
    }
    if (k >= TURN_T[2]) {
        a.d.turnAt = null;
        return false;
    }
    return true;
}

function turnPose(a) {
    const k = T - a.d.turnAt;
    return k >= TURN_T[0] && k < TURN_T[1] ? P_FRONT : P_STAND;
}

// Шаг к цели; если цель позади — сначала разворот. true — дошёл
function go(a, target, speed, dt) {
    const diff = target - dog.x;
    if (Math.abs(diff) < 0.01) return true;
    if (Math.sign(diff) !== dog.face) {
        startTurn(a);
        return false;
    }
    const step = Math.min(Math.abs(diff), speed * dt);
    dog.x += dog.face * step;
    a.d.dist = (a.d.dist || 0) + step;
    return Math.abs(target - dog.x) < 0.01;
}

function walkTarget() {
    for (let i = 0; i < 8; i++) {
        const x = Math.round(rand(minX, maxX));
        if (Math.abs(x - dog.x) > 15) return x;
    }
    return dog.x > (minX + maxX) / 2 ? minX : maxX;
}

// Сколько места впереди (dir = 1 — справа)
const roomAhead = (dir) => (dir > 0 ? W - 2 - dog.x : dog.x - 1);

// Вещь рядом с пёсиком: relX/relY — от центра пёсика, будто он смотрит вправо
function placeProp(rows, relX, relY, gx, gy) {
    const w = rows[0].length;
    return { rows, x: dog.face > 0 ? gx + relX : gx - relX - w + 1, y: gy + relY, flip: dog.face < 0 };
}

// Опускается сверху (k: 0 → 1) и чуть подпрыгивает; улетает вверх (k: 0 → 1)
const dropIn = (k) => (k < 0.8 ? -Math.round(12 * (1 - k / 0.8) ** 2) : k < 0.9 ? -1 : 0);
const flyOut = (k) => -Math.round(40 * k * k);

// ----- Частицы -----

function puff(x, y, vx, vy, life = 0.45) {
    if (parts.length > 180) return;
    parts.push({ x, y, vx, vy, g: -8, life, max: life, k: Math.random() < 0.5 ? 1 : 2, w: 2, h: 2 });
}

function bit(x, y, vx, vy, c, g = 160, life = 0.9, w = 1, h = 1) {
    if (parts.length > 180) return;
    parts.push({ x, y, vx, vy, g, life, max: life, c, k: 0, w, h });
}

function feetDust(n, spread = 1) {
    for (let i = 0; i < n; i++) {
        const s = i % 2 ? 1 : -1;
        puff(dog.x + s * rand(3, 9), groundY - rand(0, 2), s * rand(8, 25) * spread, -rand(3, 12) * spread);
    }
}

// ----- Занятия -----

function hatAction(rows, party) {
    return {
        start: () => [S(pose('stand', { head: 'happy' }), 0.5, { tag: 'in' })],
        update(a, dt, beat) {
            if (!party || beat.index === a.d.lb) return;
            a.d.lb = beat.index;
            if (beat.index % 2 || !a.d.tip) return;
            // хлоп — конфетти из макушки колпака
            for (let i = 0; i < 12; i++) {
                bit(a.d.tip[0], a.d.tip[1], rand(-45, 45), -rand(35, 80), pick(CONFETTI), 140, rand(0.8, 1.3), Math.random() < 0.5 ? 2 : 1, 1);
            }
        },
        pose(a, beat) {
            if (party) return pose('stand', { head: 'happy', tail: WAG[Math.floor(T * 8) % 4], oy: beat.phase < 0.12 ? -1 : 0 });
            const tip = beat.index % 4 === 0 && beat.phase < 0.6;     // приподнимает цилиндр и подмигивает
            return pose('stand', { head: tip ? 'closed' : 'open', breathe: tip ? 0 : inhale(beat) });
        },
        exit: () => [S(pose('stand', { head: 'up' }), 0.5, { tag: 'out' })],
        props(a, s, gx, gy, beat) {
            let dy = 0;
            if (a.phase === 'enter') dy = dropIn(stepAt(a.steps, T - a.t0).k);
            else if (a.phase === 'exit') dy = flyOut(stepAt(a.steps, T - a.t0).k);
            else if (!party && beat.index % 4 === 0 && beat.phase > 0.1 && beat.phase < 0.5) dy = -2;
            const w = rows[0].length;
            const it = placeProp(rows, s.hx + 5 - (w >> 1), s.hy - rows.length + dy, gx, gy);
            a.d.tip = [gx + dog.face * (s.hx + 5), it.y];
            return [it];
        }
    };
}

const ACTIONS = {
    // Стоит и дышит, иногда моргает. Во время сигнала — поджимает хвост и дрожит
    idle: {
        start(a) { a.d.blink = T + rand(1, 4); },
        pose(a, beat) {
            if (signal) {
                const shiver = beat.phase < 0.45 ? (Math.floor(T * 24) % 2 ? 1 : -1) : 0;
                return pose('stand', { tail: 'down', ox: shiver });
            }
            if (T < cheerUntil) return pose('stand', { head: 'happy', tail: WAG[Math.floor(T * 10) % 4] });
            if (T > a.d.blink + 0.13) a.d.blink = T + rand(2, 5);
            return pose('stand', { head: T > a.d.blink ? 'closed' : 'open', breathe: inhale(beat) });
        }
    },

    // Садится → ложится → засыпает, над головой «Zzz»
    sleeping: {
        start: () => [S(P_SIT, 0.3), S(P_LIEUP, 0.4), S(P_DOZE, 0.4)],
        update(a, dt, beat) {
            if (beat.index === a.d.zb || beat.index % 2) return;
            a.d.zb = beat.index;
            const s = buildDog(pose('lie'));
            zs.push({ t0: T, x: Math.round(dog.x) + dog.face * (s.hx + 5), y: groundY + s.hy - 2, face: dog.face });
        },
        pose: (a, beat) => pose('lie', { head: 'closed', breathe: inhale(beat) }),
        exit: () => [S(P_DOZE, 0.25), S(P_LIEUP, 0.35), S(P_SIT, 0.3)]
    },

    // Гуляет туда-сюда, иногда останавливается; у краёв разворачивается
    walking: {
        can: () => maxX - minX > 30,
        start(a) {
            a.d.dist = 0;
            a.d.target = walkTarget();
            return [S(pose('stand', { legs: 'walk0' }), 0.1)];
        },
        update(a, dt) {
            const d = a.d;
            if (d.turnAt != null && turning(a)) return;
            if (d.leaving) { exitNow(a); return; }
            if (d.wait > 0) { d.wait -= dt; return; }
            if (go(a, d.target, WALK, dt)) {
                d.target = walkTarget();
                if (Math.random() < 0.4) d.wait = rand(0.6, 1.6);
            }
        },
        leave(a) { a.d.leaving = true; return true; },
        pose(a, beat) {
            const d = a.d;
            if (d.turnAt != null) return turnPose(a);
            if (d.wait > 0) return pose('stand', { breathe: inhale(beat) });
            return pose('stand', { legs: WALK_LEGS[Math.floor(d.dist / 1.5) % 4] });
        },
        exit: () => [S(pose('stand', { legs: 'walk2' }), 0.1)]
    },

    // Носится от края до края, из-под лап летит пыль, у края — занос и разворот
    running: {
        can: () => maxX - minX > 40,
        start(a) {
            a.d.dist = 0;
            a.d.laps = 0;
            a.d.max = Math.random() < 0.5 ? 2 : 3;
            a.d.target = maxX - dog.x > dog.x - minX ? maxX : minX;
            return [S(pose('crouch'), 0.12)];
        },
        update(a, dt) {
            const d = a.d;
            if (d.turnAt != null && turning(a)) return;
            const before = d.dist;
            if (go(a, d.target, RUN, dt)) {
                for (let i = 0; i < 6; i++) puff(dog.x + dog.face * rand(4, 9), groundY - rand(0, 2), dog.face * rand(10, 35), -rand(4, 14));
                d.laps++;
                if (d.laps >= d.max || d.leaving) { exitNow(a); return; }
                d.target = d.target === minX ? maxX : minX;
            }
            if (Math.floor(d.dist / 5) !== Math.floor(before / 5)) {
                puff(dog.x - dog.face * 9, groundY - 1, -dog.face * rand(8, 20), -rand(4, 12));
            }
        },
        leave(a) { a.d.leaving = true; return true; },
        pose(a) {
            const d = a.d;
            if (d.turnAt != null) return turnPose(a);
            const f = Math.floor(d.dist / 3) % 2;
            return pose('stand', { legs: f ? 'run1' : 'run0', oy: f ? -1 : 0, tail: 'l' });
        },
        exit: () => [S(pose('crouch'), 0.12)]
    },

    // Мячик: подбрасывает носом в такт или гоняет по блоку
    playing_ball: {
        start(a) {
            const d = a.d;
            d.mode = maxX - minX > 50 && Math.random() < 0.5 ? 'chase' : 'juggle';
            d.stage = d.mode === 'chase' ? 'drop' : 'wait';
            d.dist = 0;
            d.ball = { x: clamp(Math.round(dog.x) + dog.face * 16, 4, W - 5), y: -8, vx: 0, vy: 0, roll: 0 };
        },
        update(a, dt, beat) {
            if (a.d.mode === 'juggle') juggle(a, beat);
            else chase(a, dt);
        },
        leave(a) { a.d.leaving = true; return true; },
        pose(a, beat) {
            const d = a.d;
            if (d.mode === 'juggle') {
                const bump = d.stage === 'juggle' && beat.phase < 0.1 ? -1 : 0;
                return pose('stand', { head: d.stage === 'wait' ? 'open' : 'up', headDy: bump, tail: WAG[Math.floor(T * 8) % 4] });
            }
            if (d.turnAt != null) return turnPose(a);
            const nudge = T - (d.kickAt ?? -9) < 0.15;
            if (d.moving) {
                if (d.fast) {
                    const f = Math.floor(d.dist / 3) % 2;
                    return pose('stand', { legs: f ? 'run1' : 'run0', oy: f ? -1 : 0, head: 'happy', tail: 'l' });
                }
                return pose('stand', { legs: WALK_LEGS[Math.floor(d.dist / 1.5) % 4], head: 'happy' });
            }
            return pose('stand', { head: d.stage === 'gone' ? 'up' : 'happy', headDy: nudge ? 1 : 0, tail: WAG[Math.floor(T * 8) % 4] });
        },
        props(a) {
            const b = a.d.ball;
            return [{ rows: BALLS[((Math.round(b.roll) % 4) + 4) % 4], x: Math.round(b.x) - 2, y: Math.round(b.y), flip: false }];
        }
    },

    // Сверху падает косточка или кусок пирога; пёсик ложится и грызёт, пока не доест
    eating: {
        can: () => roomAhead(1) >= 22 || roomAhead(-1) >= 22,
        start(a) {
            a.d.food = Math.random() < 0.5 ? BONE : PIE;
            a.d.bites = 0;
            const steps = roomAhead(dog.face) < 22 ? [...TURN_STEPS] : [];
            steps.push(S(pose('stand', { head: 'happy' }), 0.6, { tag: 'drop' }), S(P_SIT, 0.3), S(P_LIEUP, 0.3));
            return steps;
        },
        update(a, dt, beat) {
            const d = a.d;
            const half = beat.index * 2 + (beat.phase >= 0.5 ? 1 : 0);
            const key = d.hurry ? half : beat.index;            // торопится — кусает в 2 раза чаще
            if (key === d.lb) return;
            if (d.lb == null) { d.lb = key; return; }
            d.lb = key;
            d.bites++;
            d.chewAt = T;
            const w = d.food[0].length;
            const cx = Math.round(dog.x) + dog.face * (11 + d.bites);
            for (let i = 0; i < 3; i++) bit(cx, groundY - rand(1, 3), rand(-25, 25), -rand(30, 60), PAL_DAY[d.food === BONE ? 12 : 14], 220, 0.5);
            if (d.bites >= w) exitNow(a);
        },
        leave(a) { a.d.hurry = true; return true; },
        pose(a) {
            const chew = T - (a.d.chewAt ?? -9) < 0.25;
            return pose('lieUp', { head: chew ? 'chew' : 'open', headDy: chew ? 1 : 0 });
        },
        exit: () => [S(pose('lieUp', { head: 'tongue' }), 0.5), S(P_SIT, 0.3)],
        props(a, s, gx) {
            const d = a.d, food = d.food, h = food.length;
            let dy = 0;
            if (a.phase === 'enter') {
                const st = stepAt(a.steps, T - a.t0);
                const iDrop = a.steps.findIndex(x => x.tag === 'drop');
                if (st.i < iDrop) return [];
                if (st.i === iDrop) {
                    const k = st.k;
                    dy = k < 0.7 ? -Math.round((groundY + 2) * (1 - (k / 0.7) ** 2)) : k < 0.85 ? -1 : 0;
                }
            }
            if (d.bites >= food[0].length) return [];
            const rows = d.bites ? food.map(r => '.'.repeat(d.bites) + r.slice(d.bites)) : food;
            return [placeProp(rows, 11, 0, gx, groundY - h + 1 + dy)];
        }
    },

    hat_classy: hatAction(TOP_HAT, false),
    hat_party: hatAction(PARTY_HAT, true),

    // Садится и надевает коробку с дырками для глаз; глаза в дырках смотрят по сторонам
    hat_box: {
        start: () => [S(P_STAND, 0.05), S(P_SIT, 0.35), S(P_SIT, 0.5, { tag: 'in' })],
        pose: () => P_SIT,
        exit: () => [S(P_SIT, 0.5, { tag: 'out' }), S(P_SIT, 0.15)],
        props(a, s, gx, gy, beat) {
            const st = a.phase === 'loop' ? null : stepAt(a.steps, T - a.t0);
            let dy = 0, dx = 0;
            if (a.phase === 'enter') {
                if (st.s.tag !== 'in') return [];
                dy = dropIn(st.k);
            } else if (a.phase === 'exit') {
                if (st.s.tag !== 'out') return [];
                dy = flyOut(st.k);
            } else if (beat.index % 4 === 2 && beat.phase < 0.3) {
                dx = Math.floor(beat.phase * 20) % 2 ? 1 : -1;     // встряхнул коробку
            }
            const rows = beat.index % 5 === 3 && beat.phase < 0.15 ? BOX_SHUT : beat.index % 6 < 3 ? BOX_R : BOX_L;
            return [placeProp(rows, s.hx - 1 + dx, s.hy - 1 + dy, gx, gy)];
        }
    },

    // Сидит: моргает, оглядывается вверх, зевает, стучит хвостом по полу и даёт лапу
    sitting: {
        start: () => [S(P_SIT, 0.3)],
        update(a, dt, beat) {
            const d = a.d;
            if (beat.index === d.lb) return;
            d.lb = beat.index;
            if (T < (d.busy ?? 0)) return;
            const r = Math.random();
            d.move = r < 0.25 ? 'paw' : r < 0.37 ? 'yawn' : r < 0.55 ? 'look' : r < 0.75 ? 'wag' : null;
            d.at = T;
            d.busy = T + (d.move === 'paw' ? 1.6 : d.move ? 1.3 : 0);
            d.blink = d.blink ?? T + 2;
        },
        pose(a, beat) {
            const d = a.d, k = T - (d.at ?? -9);
            if (T < (d.busy ?? 0)) {
                if (d.move === 'paw') return pose('sit', { paw: k < 0.15 || k > 1.45 ? 1 : 2, head: k > 0.3 && k < 1.3 ? 'tongue' : 'open' });
                if (d.move === 'yawn') return pose('sit', { head: k > 0.25 && k < 1 ? 'yawn' : 'closed' });
                if (d.move === 'look') return pose('sit', { head: 'up' });
                if (d.move === 'wag') return pose('sit', { tail: Math.floor(T * 8) % 2 ? 'ground' : 'flick' });
            }
            if (T > (d.blink ?? 0) + 0.13) d.blink = T + rand(2, 5);
            return pose('sit', { head: T > (d.blink ?? 1e9) ? 'closed' : 'open' });
        },
        exit: () => [S(P_SIT, 0.15)]
    },

    // Валяется: ложится, перекатывается на спину и дрыгает лапами в воздухе, потом обратно
    rolling: {
        start: () => [S(P_SIT, 0.25), S(P_LIEUP, 0.3), S(pose('lie', { head: 'happy' }), 0.15),
            S(pose('squash', { flipY: 1, head: 'happy' }), 0.12), S(pose('crouch', { flipY: 1, head: 'happy' }), 0.12)],
        update(a) { if (T - a.t0 > 3.6) exitNow(a); },
        pose: (a, beat) => pose('stand', {
            flipY: 1, head: 'happy', tail: WAG[Math.floor(T * 8) % 4],
            legs: Math.floor(T * 8) % 2 ? 'walk0' : 'walk2',
            ox: beat.phase < 0.2 ? (beat.index % 2 ? 1 : -1) : 0          // елозит спиной
        }),
        exit: () => [S(pose('crouch', { flipY: 1, head: 'happy' }), 0.12), S(pose('squash', { flipY: 1, head: 'happy' }), 0.12),
            S(pose('lie', { head: 'happy' }), 0.15), S(P_LIEUP, 0.3), S(P_SIT, 0.25)]
    },

    // Сверху спускается верёвка с узелком: пёсик тянется лапой, подпрыгивает,
    // верёвка дразнит и отскакивает вверх. В конце уезжает наверх
    rope: {
        can: () => roomAhead(1) >= 16 || roomAhead(-1) >= 16,
        start(a) {
            const steps = roomAhead(dog.face) < 16 ? [...TURN_STEPS] : [];
            steps.push(S(pose('stand', { head: 'up' }), 0.2));
            return steps;
        },
        update(a, dt, beat) {
            const d = a.d;
            if (!rope) {
                // узелок висит чуть выше макушки и впереди морды — лапой почти не достать
                rope = { x: Math.round(dog.x) + dog.face * 11, y: -60, want: groundY - 17, amp: 1, top: -60 };
                rope.y = rope.top = ropeTop();
            }
            if (d.lb == null) d.lb = beat.index;
            if (beat.index !== d.lb) {
                d.lb = beat.index;
                if (d.done) {
                    if (T - d.done > 0.8) exitNow(a);
                } else if (d.leaving || T > a.until - 1.5) {
                    d.move = 'hop';                // последний прыжок — и верёвка уезжает
                    d.at = T;
                    d.done = T;
                    rope.leave = true;
                } else if (Math.abs(rope.y - rope.want) < 3) {
                    const r = Math.random();
                    d.move = r < 0.45 ? 'swipe' : r < 0.8 ? 'hop' : null;
                    d.at = T;
                }
            }
            const k = T - (d.at ?? -9);
            if (d.move === 'swipe' && k > 0.25 && !d.hit) { d.hit = d.at; rope.amp = 3; }
            if (d.move === 'hop' && k > 0.22 && d.hit !== d.at) {
                d.hit = d.at;
                rope.amp = 4;
                if (!rope.leave) { rope.y -= 7; }          // почти достал — верёвка дёрнулась вверх
            }
        },
        leave(a) { a.d.leaving = true; return true; },
        pose(a) {
            const d = a.d, k = T - (d.at ?? -9);
            if (d.move === 'swipe' && k < 0.6) return pose('stand', { head: 'up', paw: k < 0.12 || k > 0.48 ? 1 : 2 });
            if (d.move === 'hop' && k < 0.5) {
                if (k < 0.08 || k > 0.42) return pose('crouch', { head: 'up' });
                const h = Math.round(5 * Math.sin(Math.PI * (k - 0.08) / 0.34));
                return pose('stand', { head: 'up', paw: 2, legs: 'run0', oy: -h });
            }
            return pose('stand', { head: 'up', tail: WAG[Math.floor(T * 6) % 4] });
        }
    },

    // Три раза тявкает в такт: «ГАВ!» в пиксельном пузыре
    bark: {
        start(a) {
            a.d.n = 0;
            a.d.at = -9;
            a.d.lb = beatNow.index;
        },
        update(a, dt, beat) {
            const d = a.d;
            if (beat.index === d.lb) return;
            d.lb = beat.index;
            if (d.n < 3 && !d.leaving) {
                d.n++;
                d.at = T;
                bubble = { t0: T };
            } else if (T - d.at > 1) {
                exitNow(a);
            }
        },
        leave(a) { a.d.leaving = true; return true; },
        pose(a) {
            if (T - a.d.at < 0.22) return pose('stand', { head: 'bark', headDy: -1, tail: 'r', oy: -1 });
            return pose('stand', { tail: 'r' });
        }
    },

    // Радостно виляет хвостом
    tail_wag: {
        update(a) { if (T - a.t0 > 6) exitNow(a); },
        pose: (a, beat) => pose('stand', { head: 'happy', tail: WAG[Math.floor(T * 10) % 4], oy: beat.phase < 0.1 ? -1 : 0 })
    },

    // Пёсика тянут: идёт к пальцу (далеко — бежит), под пальцем стоит и виляет хвостом.
    // Отпустили — доходит до случайного места и заканчивает (не в списке случайных занятий)
    follow: {
        start: () => bridgeFrom(lastPose || P_STAND),
        update(a, dt) {
            const d = a.d;
            d.moving = false;
            if (d.turnAt != null && turning(a)) return;
            const target = dragging ? clamp(Math.round(dragX), minX, maxX) : (d.target ?? dog.x);
            const diff = target - dog.x;
            // рядом с целью (или цель чуть-чуть позади) — стоим, чтобы не крутиться туда-сюда
            if (Math.abs(diff) < 1.5 || (Math.sign(diff) !== dog.face && Math.abs(diff) < 4)) {
                if (!dragging) exitNow(a);
                return;
            }
            d.fast = Math.abs(diff) > 14;
            const was = dog.x;
            go(a, target, d.fast ? RUN : WALK * 1.8, dt);
            d.moving = dog.x !== was;
            if (d.fast && d.moving && Math.floor(d.dist / 5) !== Math.floor((d.dist - Math.abs(dog.x - was)) / 5)) {
                puff(dog.x - dog.face * 9, groundY - 1, -dog.face * rand(8, 20), -rand(4, 12));
            }
        },
        leave: () => true,
        pose(a, beat) {
            const d = a.d;
            if (d.turnAt != null) return turnPose(a);
            if (d.moving && d.fast) {
                const f = Math.floor(d.dist / 3) % 2;
                return pose('stand', { legs: f ? 'run1' : 'run0', oy: f ? -1 : 0, head: 'happy', tail: 'l' });
            }
            if (d.moving) return pose('stand', { legs: WALK_LEGS[Math.floor(d.dist / 1.5) % 4], head: 'happy', tail: WAG[Math.floor(T * 8) % 4] });
            return pose('stand', { head: 'happy', tail: WAG[Math.floor(T * 10) % 4], breathe: inhale(beat) });
        },
        exit: () => [S(pose('stand', { legs: 'walk2' }), 0.1)]
    }
};

// Мячик на носу: касается носа точно на каждый удар, раз в 4 удара — выше
function juggle(a, beat) {
    const d = a.d, b = d.ball;
    const rest = groundY - 16;                  // мячик лежит на носу (нос на 10 пикс. выше подошв)
    b.x = Math.round(dog.x) + dog.face * 9;
    if (d.stage === 'wait') {
        // ждём середины удара, чтобы мячик упал сверху ровно в такт
        if (beat.phase > 0.4 && beat.phase < 0.7) {
            d.stage = 'drop';
            d.t0 = T;
            d.len = 1 - beat.phase;
            d.b0 = beat.index;
        }
    }
    if (d.stage === 'drop') {
        const k = Math.min(1, (T - d.t0) / d.len);
        b.y = -6 + (rest + 6) * k * k;
        if (beat.index !== d.b0) d.stage = 'juggle';
    }
    if (d.stage === 'juggle') {
        const hgt = beat.index % 4 === 3 ? 18 : 10;
        b.y = rest - Math.round(hgt * 4 * beat.phase * (1 - beat.phase));
        b.roll = beat.index;
        if ((d.leaving || T > a.until - 1.5) && beat.phase < 0.05) {
            d.stage = 'toss';
            d.t0 = T;
        }
    }
    if (d.stage === 'toss') {
        // последний бросок — мячик улетает вверх, пёсик провожает его взглядом
        const k = T - d.t0;
        b.y = rest - 50 * k - 140 * k * k;
        b.roll = Math.floor(k * 12);
        if (b.y < -10 && k > 0.9) exitNow(a);
    }
}

// Мячик на полу: катится, отскакивает от краёв; пёсик догоняет и толкает носом
function chase(a, dt) {
    const d = a.d, b = d.ball, rest = groundY - 4;
    if (d.stage === 'gone') {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.roll += dt * 12;
        if (b.y < -10) exitNow(a);
        return;
    }
    b.vy += 300 * dt;
    b.y += b.vy * dt;
    if (b.y >= rest) {
        b.y = rest;
        b.vy = Math.abs(b.vy) > 30 ? -Math.abs(b.vy) * 0.45 : 0;
    }
    b.x += b.vx * dt;
    b.vx *= Math.exp(-1.6 * dt);
    if (b.x < 4) { b.x = 4; b.vx = Math.abs(b.vx) * 0.7; }
    if (b.x > W - 5) { b.x = W - 5; b.vx = -Math.abs(b.vx) * 0.7; }
    b.roll += b.vx * dt / 2;
    d.moving = false;
    if (d.stage === 'drop') {
        if (b.y >= rest && b.vy === 0) d.stage = 'chase';
        return;
    }

    if (d.turnAt != null && turning(a)) return;
    const side = b.x >= dog.x ? 1 : -1;
    const target = clamp(Math.round(b.x - side * 13), minX, maxX);
    d.fast = Math.abs(target - dog.x) > 18;
    const was = dog.x;
    const there = go(a, target, d.fast ? RUN : WALK * 1.6, dt);
    d.moving = dog.x !== was;
    if (d.moving && d.fast && Math.floor(d.dist / 6) !== Math.floor((d.dist - Math.abs(dog.x - was)) / 6)) {
        puff(dog.x - dog.face * 9, groundY - 1, -dog.face * rand(8, 20), -rand(4, 12));
    }
    if (there && dog.face === side && Math.abs(b.vx) < 8 && b.y >= rest - 1 && T - (d.kickAt ?? -9) > 0.6) {
        d.kickAt = T;
        if (d.leaving || T > a.until - 1.2) {
            b.vx = side * 25;           // подкинул вверх — и всё, мячик улетел
            b.vy = -170;
            d.stage = 'gone';
        } else {
            b.vx = side * rand(30, 60);
            b.vy = -60;
        }
    }
}

// ----- Верёвка -----
// Висит от самого верха экрана (рисуется на холсте поверх страницы), узелок раскачивается.
// Занятие кончилось или пёсика отвлекли — верёвка уезжает наверх.

const ROPE_DAY = ['#b7791f', '#8a5a1c'].map(color);
const ROPE_NIGHT = ['#e2b56b', '#b8873e'].map(color);

// Верх экрана в пикселях холста над блоком (с запасом)
const ropeTop = () => -Math.ceil(canvas.getBoundingClientRect().top / P) - 3;

function stepRope(dt) {
    if (!rope) return;
    rope.top = ropeTop();
    const away = rope.leave || act.name !== 'rope';
    const target = away ? rope.top - 6 : rope.want;
    rope.y += (target - rope.y) * Math.min(1, dt * (away ? 6 : 4));
    rope.amp = Math.max(1, rope.amp * Math.exp(-1.2 * dt));
    if (away && rope.y < rope.top) rope = null;
}

function drawRope(buf, kx, ky) {
    const cols = night ? ROPE_NIGHT : ROPE_DAY;
    const x0 = rope.x + kx;
    const ex = rope.x + Math.round(Math.sin(T * 3.2) * rope.amp) + kx, ey = Math.round(rope.y) + ky;
    for (let y = 0; y < ey; y++) {
        const x = Math.round(x0 + (ex - x0) * (y / Math.max(1, ey)));
        buf.dot(x, y, cols[(y >> 1) & 1]);            // витая верёвка: два цвета полосками
    }
    // узелок на конце
    buf.rect(ex - 2, ey - 1, 5, 5, INK);
    buf.rect(ex - 1, ey, 3, 3, cols[0]);
    buf.dot(ex - 1, ey, cols[1]);
}

// ----- Нажатие и прыжки -----

function tap() {
    if (!W || stackAnim) return;
    if (hop) {
        // нажали в прыжке — прыгнет ещё раз, как только приземлится
        if (['bridge', 'prep', 'air', 'land'].includes(hop.stage) && hop.level < 4) hop.buffer = true;
        return;
    }
    if (dropped) { raise(); return; }
    startHop(T - lastLand < COMBO_GAP ? Math.min(4, combo + 1) : 1);
}

// ----- Пёсика тянут -----

function startDrag() {
    if (!W || hop || stackAnim) return;
    dragging = true;
    dragX = dog.x;
    hit.classList.add('dragging');
    if (act.name !== 'follow') {
        dropProps();
        queue = null;
        startAction('follow');
    }
}

// Отпустили — пёсик сам уходит в случайное место (влево, в середину или вправо)
// и там продолжает обычные занятия
function endDrag() {
    dragging = false;
    hit.classList.remove('dragging');
    if (act.name !== 'follow') return;
    act.d.target = randomSpot();
    nextPick = T + rand(1.5, 3);
}

function randomSpot() {
    const mid = Math.round((minX + maxX) / 2);
    const spots = [minX + Math.round(rand(0, 6)), mid + Math.round(rand(-5, 5)), maxX - Math.round(rand(0, 6))];
    const far = spots.filter(x => Math.abs(x - dog.x) > 15);
    return pick(far.length ? far : spots);
}

// Занятие бросается: шляпа, мячик, еда подлетают и улетают вверх
function dropProps() {
    for (const q of lastProps) loose.push({ ...q, vx: rand(-15, 15), vy: -rand(80, 120) });
    lastProps = [];
}

// Быстрые кадры-мостики из текущей позы в стойку (лёг → сел → встал, с ног на голову — обратно)
function bridgeFrom(from = P_STAND) {
    if (from.flipY) return [S(pose('squash', { flipY: 1 }), 0.06), S(P_LIEUP, 0.08), S(P_SIT, 0.08)];
    if (from.body === 'lie' || from.body === 'lieUp') return [S(P_SIT, 0.08)];
    if (from.body === 'front') return [S(P_STAND, 0.05)];
    return [];
}

function startHop(level) {
    combo = level;
    dropProps();
    const bridge = bridgeFrom(lastPose || P_STAND);
    startAction('idle');
    queue = null;
    hop = { level, stage: bridge.length ? 'bridge' : 'prep', t0: T, steps: bridge, si: -1, len: sumSteps(bridge), buffer: false, vy: 0, top: 0 };
}

// Сколько пикселей до верха экрана (с запасом) — столько лететь вверх
function flightHeight() {
    const r = canvas.getBoundingClientRect();
    return Math.max(40, Math.ceil(r.top / P) + groundY + 24);
}

function updateHop(dt) {
    const h = hop, k = T - h.t0;
    const next = (stage) => { h.stage = stage; h.t0 = T; };
    switch (h.stage) {
        case 'bridge':
            syncSteps(h);
            if (k >= h.len) next('prep');
            break;
        case 'prep':
            if (h.level === 4) {
                if (Math.random() < 0.25) feetDust(1, 0.5);
                if (k >= 0.32) {
                    h.top = flightHeight();
                    feetDust(10, 1.6);
                    next('up');
                }
            } else if (k >= 0.07) {
                h.vy = Math.sqrt(2 * GRAV * HOPS[h.level]);
                feetDust(2);
                next('air');
            }
            break;
        case 'air':
            dog.lift += h.vy * dt;
            h.vy -= GRAV * dt;
            if (dog.lift <= 0) {
                dog.lift = 0;
                lastLand = T;
                feetDust(3);
                next('land');
            }
            break;
        case 'land':
            if (k < 0.1) break;
            if (h.buffer) {
                const lv = Math.min(4, h.level + 1);
                combo = lv;
                hop = { level: lv, stage: 'prep', t0: T, steps: [], si: -1, len: 0, buffer: false, vy: 0, top: 0 };
            } else {
                endHop();
            }
            break;
        case 'up':
            dog.lift = h.top * easeOut(Math.min(1, k / 0.5));
            if (k >= 0.5) next('away');
            break;
        case 'away':
            if (k >= 1.9) next('down');
            break;
        case 'down': {
            const q = Math.min(1, k / 0.55);
            dog.lift = h.top * (1 - q * q);
            if (q >= 1) {
                dog.lift = 0;
                crash();
                next('impact');
            }
            break;
        }
        case 'impact':
            if (k >= 0.5) endHop();
            break;
    }
}

function endHop() {
    hop = null;
    dog.lift = 0;
    startAction('idle');
    nextPick = Math.max(nextPick, T + rand(3, 6));
}

function hopPose() {
    const h = hop, k = T - h.t0;
    switch (h.stage) {
        case 'bridge': return stepPose(h.steps, k);
        case 'prep': return h.level === 4 ? pose('deep', { head: 'closed', ox: Math.floor(T * 30) % 2 }) : pose('crouch');
        case 'air': return pose('stand', { legs: h.vy > 0 ? 'run1' : 'run0', head: h.level > 1 ? 'happy' : 'open' });
        case 'land': return pose('crouch');
        case 'up': return pose('stand', { legs: 'run1', head: 'happy' });
        case 'away': return null;
        case 'down': return pose('stand', { legs: Math.floor(T * 12) % 2 ? 'run0' : 'run1', head: 'bark' });
        default: return pose(k < 0.18 ? 'squash' : k < 0.3 ? 'deep' : 'crouch', { head: k < 0.3 ? 'closed' : 'open' });
    }
}

// Грохот: пыль, обломки — и блоки «Сейчас» и «Дальше» съезжают вниз экрана
function crash() {
    const x = Math.round(dog.x);
    for (let i = 0; i < 20; i++) {
        const s = i % 2 ? 1 : -1;
        puff(x + s * rand(4, 11), groundY - rand(0, 3), s * rand(20, 65), -rand(5, 25), rand(0.5, 0.9));
    }
    for (let i = 0; i < 14; i++) bit(x + rand(-10, 10), groundY, rand(-55, 55), -rand(40, 110), pick(DEBRIS), 260, rand(0.6, 1), 2, 2);
    combo = 0;
    if (!dropped) stackAnim = { from: stackOff, to: dropDistance(), keys: DROP_KEYS, t0: T, step: 0.045, shake: true };
    navigator.vibrate?.(70);
}

// ----- Блоки «Сейчас» и «Дальше»: вниз и обратно (ступеньками, кратно пикселю пёсика) -----

const DROP_KEYS = [0.04, 0.12, 0.26, 0.46, 0.72, 1, 0.92, 1, 0.97, 1];
const RISE_KEYS = [0.06, 0.18, 0.36, 0.58, 0.8, 0.95, 1.04, 1];

// Насколько опустить, чтобы нижний блок встал у низа экрана
function dropDistance() {
    const r = stack.lastElementChild.getBoundingClientRect();
    const bottom = r.bottom - stackOff + 4;                         // +4 — тень блока
    const panel = stack.closest('.tab-panel');                     // нижний отступ вкладки (с полосой теста — больше)
    const pad = panel ? parseFloat(getComputedStyle(panel).paddingBottom) || 32 : 32;
    return Math.max(10 * P, Math.floor((innerHeight - pad - bottom) / P) * P);
}

function setStack(y, x = 0) {
    stackOff = y;
    stack.style.transform = y || x ? `translate(${x}px, ${y}px)` : '';
}

function stepStack() {
    const s = stackAnim;
    if (!s) return;
    const i = Math.floor((T - s.t0) / s.step);
    if (i >= s.keys.length) {
        stackAnim = null;
        dropped = s.to !== 0;
        setStack(s.to);
        return;
    }
    const y = s.from + (s.to - s.from) * s.keys[i];
    setStack(Math.round(y / P) * P, s.shake && i < 4 ? [3, -3, 3, -3][i] : 0);
}

// Нажали на пёсика внизу — блоки вместе с ним едут на место
function raise() {
    stackAnim = { from: stackOff, to: 0, keys: RISE_KEYS, t0: T, step: 0.05 };
    cheerUntil = T + 1;
    combo = 0;
}

// Экран повернули или блок стал выше — блоки снова встают у низа экрана
function refitStack() {
    if (!stack || !dropped || stackAnim || !card.offsetParent) return;
    setStack(dropDistance());
}

// ----- Кадр -----

export function dogFrame(t = performance.now()) {
    const dt = lastT ? clamp((t - lastT) / 1000, 0, 0.1) : 0;
    lastT = t;
    if (!W) layout();
    if (!W) return;
    T += dt;
    beatNow = beatAt(now().getTime());
    night = document.body.classList.contains('night');
    signal = !!card.dataset.fx;

    think();
    update(dt);
    stepStack();
    stepRope(dt);
    for (const q of parts) {
        q.vy += q.g * dt;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.life -= dt;
    }
    parts = parts.filter(q => q.life > 0);
    render();
}

function drawDog(layer, s, x, y) {
    const p = s.pix, f = dog.face;
    for (let i = 0; i < p.length; i += 3) layer.put(x + f * p[i], y + p[i + 1], p[i + 2]);
}

function render() {
    const pal = night ? PAL_NIGHT : PAL_DAY;
    const ink = night ? FX_NIGHT : FX_DAY;
    const p = currentPose();
    if (p) lastPose = p;
    const s = p ? buildDog(p) : null;
    const gx = Math.round(dog.x) + (p ? p.ox : 0);
    const gy = groundY - Math.round(dog.lift) + (p ? p.oy : 0);
    const flying = !!hop && dog.lift > 0.5;

    L.begin();
    lastProps = s && !hop && act.def.props ? act.def.props(act, s, gx, gy, beatNow) : [];
    for (const q of loose) L.sprite(q.rows, Math.round(q.x), Math.round(q.y), q.flip);
    if (s && !flying) drawDog(L, s, gx, gy);
    for (const q of lastProps) L.sprite(q.rows, q.x, q.y, q.flip);
    L.finish(pal);
    effects(L.buf, ink, p, s, gx, gy);
    L.buf.flush();

    // В прыжке — холст поверх страницы
    if (flying || (hop && hop.stage === 'away') || rope) drawAir(pal, ink, flying ? s : null, gx, gy);
    else if (!air.hidden) air.hidden = true;

    placeHit(s, gx, gy, !s || (flying && hop.stage !== 'air'));
}

// ----- Эффекты (без контура) -----

function effects(buf, ink, p, s, gx, gy) {
    // частицы: пыль, конфетти, крошки, обломки — под конец тают узором
    for (const q of parts) {
        const f = 1 - q.life / q.max;
        buf.fade = f > 0.5 ? (f - 0.5) / 0.5 : 0;
        buf.rect(Math.round(q.x), Math.round(q.y), q.w, q.h, q.k ? ink.dust[q.k - 1] : q.c);
    }
    buf.fade = 0;

    // «Zzz»: летят вверх и назад, растут и тают
    zs = zs.filter(z => T - z.t0 < 3);
    for (const z of zs) {
        const k = clamp((T - z.t0) / 3, 0, 0.99), step = Math.floor(k * 9);
        const glyph = Z[Math.min(2, Math.floor(k * 3))];
        const x = z.x - z.face * Math.round(step * 1.2) - (z.face < 0 ? glyph[0].length - 1 : 0);
        const y = z.y - Math.round(step * 1.6) - glyph.length;
        buf.fade = k > 0.6 ? (k - 0.6) / 0.4 : 0;
        glyph.forEach((row, j) => {
            for (let i = 0; i < row.length; i++) if (row[i] === '#') buf.dot(x + i, y + j, ink.z);
        });
    }
    buf.fade = 0;

    if (!p || !s) return;

    // линии движения у виляющего хвоста
    if (p.body === 'stand' && (p.tail === 'l' || p.tail === 'r') && (act.name === 'tail_wag' || act.name === 'hat_party' || act.name === 'follow' || T < cheerUntil)) {
        const tip = TAILS[p.tail][3];
        const tx = -10 + tip[0], ty = -7 + tip[1];
        const side = p.tail === 'l' ? -1 : 1;
        for (const [dx, dy] of [[2, 0], [2, 1], [1, 3], [2, 4]]) buf.dot(gx + dog.face * (tx + side * dx), gy + ty + dy, ink.line);
    }

    // тень падающего с неба пёсика растёт
    if (hop && hop.stage === 'down') {
        const k = Math.min(1, (T - hop.t0) / 0.55);
        const w = Math.round(3 + 14 * k);
        buf.fade = 0.7 - 0.5 * k;
        for (let x = -w; x <= w; x++) {
            buf.dot(Math.round(dog.x) + x, groundY + 1, ink.shadow);
            if (Math.abs(x) < w - 3) buf.dot(Math.round(dog.x) + x, groundY, ink.shadow);
        }
        buf.fade = 0;
    }

    if (bubble) drawBubble(buf, s, gx, gy);
}

// Пузырь «ГАВ!» над головой; хвостик смотрит на морду. Выскакивает в 2 шага, тает узором
function drawBubble(buf, s, gx, gy) {
    const k = T - bubble.t0;
    if (k > 1) { bubble = null; return; }
    const BW = 19, BH = 11;
    const mouth = gx + dog.face * (s.hx + 8);
    const head = gy + s.hy;
    const small = k < 0.07;
    const w = small ? 9 : BW, h = small ? 5 : BH;
    const left = clamp(dog.face > 0 ? mouth - 4 : mouth - w + 5, 0, W - w);
    const top = Math.max(0, head - h - 3);
    buf.fade = k > 0.75 ? (k - 0.75) / 0.25 : 0;
    buf.rect(left + 1, top + 1, w - 2, h - 2, WHITE);
    buf.line(left + 1, top, left + w - 2, top, INK);
    buf.line(left + 1, top + h - 1, left + w - 2, top + h - 1, INK);
    buf.line(left, top + 1, left, top + h - 2, INK);
    buf.line(left + w - 1, top + 1, left + w - 1, top + h - 2, INK);
    // хвостик
    const tx = clamp(mouth, left + 2, left + w - 4);
    const by = top + h - 1;
    buf.dot(tx, by, WHITE); buf.dot(tx + 1, by, WHITE);
    buf.dot(tx - 1, by + 1, INK); buf.dot(tx, by + 1, WHITE); buf.dot(tx + 1, by + 1, INK);
    buf.dot(tx, by + 2, INK);
    if (!small) {
        GAV.forEach((row, j) => {
            for (let i = 0; i < row.length; i++) if (row[i] === '#') buf.dot(left + 3 + i, top + 3 + j, INK);
        });
    }
    buf.fade = 0;
}

// ----- Холст поверх страницы (пёсик в прыжке, верёвка) -----
// Сетка совпадает с сеткой холста над блоком: сдвигаем холст на остаток от деления на 3

function drawAir(pal, ink, s, gx, gy) {
    const r = canvas.getBoundingClientRect();
    const kx = Math.floor(r.left / P), ky = Math.floor(r.top / P);
    air.style.transform = `translate(${r.left - kx * P}px, ${r.top - ky * P}px)`;
    if (air.hidden) air.hidden = false;

    const x = gx + kx, y = gy + ky;
    A.begin();
    if (s) drawDog(A, s, x, y);
    A.finish(pal);
    const buf = A.buf;

    if (rope) drawRope(buf, kx, ky);
    if (!hop) { buf.flush(); return; }

    if (hop.stage === 'up' || hop.stage === 'down') {
        // линии скорости: снизу, когда летит вверх, и сверху, когда падает
        const dir = hop.stage === 'up' ? 1 : -1;
        const y0 = dir > 0 ? y + 2 : y + (s ? s.y0 : -15) - 2;
        for (const [dx, len] of [[-7, 7], [-3, 12], [2, 9], [6, 13]]) {
            for (let i = 0; i < len; i++) {
                buf.fade = i / len;
                buf.dot(x + dx, y0 + dir * i, ink.line);
            }
        }
        buf.fade = 0;
    }

    if (hop.stage === 'away') {
        // улетел так высоко, что у края экрана только блеснул звёздочкой
        const k = T - hop.t0;
        if (k > 0.1 && k < 0.8) {
            const n = [1, 2, 3, 2, 1][Math.min(4, Math.floor((k - 0.1) / 0.14))];
            const sx = x, sy = 6;
            for (let i = 1; i <= n; i++) {
                buf.dot(sx + i, sy, ink.star); buf.dot(sx - i, sy, ink.star);
                buf.dot(sx, sy + i, ink.star); buf.dot(sx, sy - i, ink.star);
            }
            buf.dot(sx, sy, GOLD);
        }
    }
    buf.flush();
}

// ----- Невидимая кнопка по контуру пёсика -----

function placeHit(s, gx, gy, hide) {
    if (hide || !s) {
        if (hitKey !== 'none') {
            hit.style.display = 'none';
            hitKey = 'none';
        }
        return;
    }
    const a = dog.face > 0 ? s.x0 : -s.x1, b = dog.face > 0 ? s.x1 : -s.x0;
    const x0 = gx + a - 2, x1 = gx + b + 2;
    const y0 = gy + s.y0 - 2, y1 = Math.min(ROOM - 1, gy + s.y1 + 1);
    const left = -bw + x0 * P, top = -bw - ROOM * P + y0 * P;
    const key = `${left},${top},${x1 - x0},${y1 - y0}`;
    if (key === hitKey) return;
    hitKey = key;
    hit.style.display = '';
    hit.style.transform = `translate(${left}px, ${top}px)`;
    hit.style.width = `${(x1 - x0 + 1) * P}px`;
    hit.style.height = `${(y1 - y0 + 1) * P}px`;
}
