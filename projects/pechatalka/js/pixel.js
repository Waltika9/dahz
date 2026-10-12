// ===== Пиксельные иконки и пиксельные руки =====

const ICONS = {
    home: [
        '....#....',
        '...###...',
        '..#####..',
        '.#######.',
        '#########',
        '###...###',
        '###...###',
        '###...###'
    ],
    soundOn: [
        '...........',
        '.....#..#..',
        '....##...#.',
        '...###.#..#',
        '######..#.#',
        '######..#.#',
        '######..#.#',
        '...###.#..#',
        '....##...#.',
        '.....#..#..',
        '...........'
    ],
    soundOff: [
        '...........',
        '.....#.....',
        '....##.....',
        '...###.#..#',
        '######..##.',
        '######..##.',
        '######.#..#',
        '...###.....',
        '....##.....',
        '.....#.....',
        '...........'
    ],
    repeat: [
        '..#####..',
        '.#.....##',
        '#...#...#',
        '#...##..#',
        '#.......#',
        '.##...##.',
        '..#####..'
    ],
    warning: [
        '....#....',
        '...###...',
        '..##.##..',
        '..##.##..',
        '.##...##.',
        '.#######.',
        '#########',
        '....#....'
    ],
    eye: [
        '...#####...',
        '.##.....##.',
        '#...###...#',
        '#..#####..#',
        '#...###...#',
        '.##.....##.',
        '...#####...'
    ],
    eyeOff: [
        '#..#####...',
        '.##..#..##.',
        '#...#.#...#',
        '#..#.#.#..#',
        '#...#.#...#',
        '.##..#..##.',
        '...#####..#'
    ],
    lock: [
        '..####..',
        '.#....#.',
        '.#....#.',
        '########',
        '########',
        '###..###',
        '###..###',
        '########'
    ],
    check: [
        '...........',
        '..........#',
        '.........##',
        '........##.',
        '#......##..',
        '##....##...',
        '.##..##....',
        '..####.....',
        '...##......',
        '...........'
    ],
    keyboard: [
        '#############',
        '#.#.#.#.#.#.#',
        '#############',
        '#.#.#.#.#.#.#',
        '#############',
        '#..#######..#',
        '#############'
    ],
    star: [
        '....#....',
        '....#....',
        '..#####..',
        '.#######.',
        '..#####..',
        '.##...##.',
        '#.......#'
    ],
    chart: [
        '#........',
        '#......#.',
        '#.....##.',
        '#..#..##.',
        '#.##.###.',
        '#.######.',
        '#.######.',
        '#########'
    ]
};

function toPath(rows) {
    let d = '';
    rows.forEach((row, y) => {
        let x = 0;
        while (x < row.length) {
            if (row[x] !== '#') { x++; continue; }
            let len = 1;
            while (row[x + len] === '#') len++;
            d += `M${x} ${y}h${len}v1h-${len}z`;
            x += len;
        }
    });
    return d;
}

export function createPixelSvg(map, size = 20) {
    if (!map || !map.length) return '';
    const h = map.length;
    const w = map[0].length;
    const pathData = toPath(map);
    return `<svg viewBox="0 0 ${w} ${h}" width="${size}" height="${size}" shape-rendering="crispEdges" style="display:inline-block; vertical-align:middle;"><path fill="currentColor" d="${pathData}"/></svg>`;
}

export function getIcon(name, size = 20) {
    return createPixelSvg(ICONS[name] || ICONS.home, size);
}

const FINGER_TITLES = {
    'left-pinky':   'Левый мизинец',
    'left-ring':    'Левый безымянный',
    'left-middle':  'Левый средний',
    'left-index':   'Левый указательный',
    'thumb':        'Большой палец',
    'right-index':  'Правый указательный',
    'right-middle': 'Правый средний',
    'right-ring':   'Правый безымянный',
    'right-pinky':  'Правый мизинец'
};

export function getFingerTitle(fingerName) {
    return FINGER_TITLES[fingerName] || '';
}

// ===== ПИКСЕЛЬНЫЕ РУКИ =====
// Руки стоят под клавиатурой и её не закрывают.
// Одна рука — сетка HW×HH «пикселей», 1 пиксель = 4 CSS px (размер задан в .hands-svg).
// Над кончиками пальцев — буквы домашнего ряда; у пальца, которым нужно нажать, — нужная буква.

const HW = 42, HH = 44;   // размер одной руки
const GAP = 14;           // промежуток между руками
const TOP = 9;            // место над пальцами под буквы
const PARTS = ['palm', 'pinky', 'ring', 'middle', 'index', 'thumb'];

// Пальцы левой руки: левый край и верх (низ у всех — 31-я строка)
const FINGERS = [
    { part: 'pinky',  x: 1,  top: 13 },
    { part: 'ring',   x: 8,  top: 5 },
    { part: 'middle', x: 15, top: 1 },
    { part: 'index',  x: 22, top: 4 }
];

// Буквы домашнего ряда над пальцами
const HOME = {
    ru: { left:  { pinky: 'Ф', ring: 'Ы', middle: 'В', index: 'А' },
          right: { pinky: 'Ж', ring: 'Д', middle: 'Л', index: 'О' } },
    en: { left:  { pinky: 'A', ring: 'S', middle: 'D', index: 'F' },
          right: { pinky: ';', ring: 'L', middle: 'K', index: 'J' } }
};

// Сетка левой руки: в каждой клетке имя части или ''
function buildLeftHand() {
    const g = Array.from({ length: HH }, () => new Array(HW).fill(''));
    const fill = (x0, x1, y0, y1, part) => {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = part;
    };
    // Ладонь
    fill(1, 27, 30, 33, 'palm');
    fill(1, 29, 34, HH - 1, 'palm');
    g[HH - 1][1] = g[HH - 1][29] = '';
    // Пальцы со скруглёнными кончиками
    FINGERS.forEach(f => {
        fill(f.x, f.x + 5, f.top, 31, f.part);
        g[f.top][f.x] = g[f.top][f.x + 5] = '';
    });
    // Большой палец — наискосок к пробелу
    for (let y = 28; y <= 40; y++) {
        const xs = 25 + Math.round((40 - y) * 0.6);
        fill(xs, xs + 6, y, y, 'thumb');
        if (y === 28) g[y][xs] = g[y][xs + 6] = '';
    }
    return g;
}

const LEFT = buildLeftHand();
const RIGHT = LEFT.map(row => [...row].reverse());

// Контур: у клетки есть сосед другой части (или пустота)
function isEdge(g, x, y) {
    const p = g[y][x];
    return (g[y - 1]?.[x] ?? '') !== p || (g[y + 1]?.[x] ?? '') !== p
        || (g[y][x - 1] ?? '') !== p || (g[y][x + 1] ?? '') !== p;
}

// Path из клеток, подходящих под test, сдвинутый на (ox, oy)
function pathOf(g, test, ox, oy) {
    let d = '';
    for (let y = 0; y < HH; y++) {
        let x = 0;
        while (x < HW) {
            if (!test(x, y)) { x++; continue; }
            let len = 1;
            while (x + len < HW && test(x + len, y)) len++;
            d += `M${x + ox} ${y + oy}h${len}v1h-${len}z`;
            x += len;
        }
    }
    return d;
}

// Пути всех частей считаются один раз
const PATHS = {};
for (const side of ['left', 'right']) {
    const g = side === 'left' ? LEFT : RIGHT;
    const ox = side === 'left' ? 0 : HW + GAP;
    for (const part of PARTS) {
        PATHS[`${side}-${part}`] = {
            fill: pathOf(g, (x, y) => g[y][x] === part && !isEdge(g, x, y), ox, TOP),
            edge: pathOf(g, (x, y) => g[y][x] === part && isEdge(g, x, y), ox, TOP)
        };
    }
}

function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * SVG двух рук.
 * @param {string|null} finger - палец для нажатия ('left-index', 'thumb'…)
 * @param {string|null} shift - 'ShiftLeft' / 'ShiftRight': мизинец, который держит Shift
 * @param {'ru'|'en'} layout - раскладка (для букв над пальцами)
 * @param {string} label - символ, который нужно нажать (пишется над активным пальцем)
 */
export function renderHands({ finger = null, shift = null, layout = 'ru', label = '' } = {}) {
    const on = new Set();
    if (finger === 'thumb') { on.add('left-thumb'); on.add('right-thumb'); }
    else if (finger) on.add(finger);
    const extra = shift === 'ShiftLeft' ? 'left-pinky' : shift === 'ShiftRight' ? 'right-pinky' : null;

    let body = '';
    for (const side of ['left', 'right']) {
        for (const part of PARTS) {
            const id = `${side}-${part}`;
            const cls = on.has(id) ? 'hp is-on' : id === extra ? 'hp is-extra' : 'hp';
            body += `<g class="${cls}"><path class="hp-fill" d="${PATHS[id].fill}"/><path class="hp-edge" d="${PATHS[id].edge}"/></g>`;
        }
        for (const f of FINGERS) {
            const cx = side === 'left' ? f.x + 3 : HW + GAP + HW - f.x - 3;
            const isOn = on.has(`${side}-${f.part}`);
            const text = isOn && label ? label : HOME[layout][side][f.part];
            body += `<text class="hl${isOn ? ' is-on' : ''}" x="${cx}" y="${TOP + f.top - 2}">${esc(text)}</text>`;
        }
    }

    return `<svg class="hands-svg" viewBox="0 0 ${HW * 2 + GAP} ${HH + TOP}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <pattern id="hp-dim" width="2" height="2" patternUnits="userSpaceOnUse">
                <rect width="1" height="1" fill="#3a3a3a"/><rect x="1" y="1" width="1" height="1" fill="#3a3a3a"/>
            </pattern>
            <pattern id="hp-half" width="2" height="2" patternUnits="userSpaceOnUse">
                <rect width="1" height="1" fill="#ffffff"/><rect x="1" y="1" width="1" height="1" fill="#ffffff"/>
            </pattern>
        </defs>
        ${body}
    </svg>`;
}
