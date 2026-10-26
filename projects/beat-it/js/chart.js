// Ноты уровня из разбора песни. Для одной песни и сложности ноты всегда одинаковые:
// «случайности» берутся из генератора с постоянным зерном

import { mulberry32, hashSeed, pick } from './util.js?v=1';

export const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'hex', 'star'];

// Сложности по порядку DIFFS (menu.js):
//   approach — сколько секунд нота летит от края экрана до круга;
//   every / dropEvery — нота на каждом N-м бите (обычно / в дропе);
//   half / quarter — насколько сильным должен быть удар, чтобы поставить ноту между битами
//                    ([в дропе, вне дропа], Infinity — не ставить);
//   holds / dropHolds — как часто бывают длинные ноты; holdBeats — их длина в битах;
//   twist — насколько сильно длинные ноты закручиваются; twins — двойные ноты с двух сторон;
//   gap — меньше этого (в секундах) между нотами не бывает
const LEVELS = [
    { approach: 1.8, every: 2, dropEvery: 1, half: [Infinity, Infinity], quarter: [Infinity, Infinity], holds: 0.35, dropHolds: 0, holdBeats: [2, 3], twist: 0, twins: false, gap: 0.38 },
    { approach: 1.55, every: 1, dropEvery: 1, half: [1.0, Infinity], quarter: [Infinity, Infinity], holds: 0.3, dropHolds: 0.3, holdBeats: [1, 2], twist: 0.4, twins: false, gap: 0.2 },
    { approach: 1.35, every: 1, dropEvery: 1, half: [0.6, 0.95], quarter: [Infinity, Infinity], holds: 0.25, dropHolds: 0.5, holdBeats: [1, 3], twist: 0.7, twins: true, gap: 0.19 },
    { approach: 1.15, every: 1, dropEvery: 1, half: [0.38, 0.6], quarter: [0.9, Infinity], holds: 0.25, dropHolds: 0.5, holdBeats: [1, 3], twist: 1, twins: true, gap: 0.1 },
    { approach: 0.95, every: 1, dropEvery: 1, half: [0.22, 0.35], quarter: [0.55, 0.8], holds: 0.22, dropHolds: 0.6, holdBeats: [1, 4], twist: 1.3, twins: true, gap: 0.1 }
];

// Скорость нот каждой сложности по умолчанию (для редактора)
export const APPROACH = LEVELS.map(l => l.approach);

// Узоры направлений: откуда летят ноты одной фразы (16 битов)
export const PATTERNS = ['spin', 'alt', 'cross', 'random', 'stream', 'zigzag'];
const DROP_PATTERNS = ['spin', 'random', 'alt', 'cross', 'zigzag'];

export function makeChart(song, k, id) {
    const cfg = LEVELS[k];
    const rng = mulberry32(hashSeed(`${id}:${k}`));
    const { beats, strength, onset, fps, drops } = song;
    const inDrop = t => drops.some(([a, b]) => t >= a && t < b);
    // Сила удара около момента t (±20 мс)
    const at = t => {
        const f = Math.round(t * fps - 0.5);
        let m = 0;
        for (let d = -2; d <= 2; d++) m = Math.max(m, onset[f + d] || 0);
        return m;
    };

    // 1. Моменты нот: биты и (на сложных) сильные удары между ними
    let even = 0, odd = 0;
    strength.forEach((s, i) => (i % 2 ? (odd += s) : (even += s)));
    const parity = odd > even ? 1 : 0;      // на лёгкой — те биты из каждых двух, что сильнее
    const list = [];
    for (let i = 0; i < beats.length; i++) {
        const t = beats[i];
        const len = (i + 1 < beats.length ? beats[i + 1] : t + 0.45) - t;
        const drop = inDrop(t);
        const step = drop ? cfg.dropEvery : cfg.every;
        if ((i - parity) % step === 0 && strength[i] > 0.12) {
            list.push({ t, beat: i, main: true, s: strength[i], drop });
        }
        const half = cfg.half[drop ? 0 : 1];
        const sh = at(t + len / 2);
        if (sh >= half) list.push({ t: t + len / 2, beat: i, main: false, s: sh, drop });
        const quarter = cfg.quarter[drop ? 0 : 1];
        for (const f of [0.25, 0.75]) {
            const sq = at(t + len * f);
            if (sq >= quarter) list.push({ t: t + len * f, beat: i, main: false, s: sq, drop });
        }
    }
    list.sort((a, b) => a.t - b.t);

    // 2. Длинные ноты — в начале некоторых тактов; внутри них и сразу после нот нет
    const notes = [];
    let holdUntil = -1, lastHold = -99;
    for (const c of list) {
        if (c.t <= holdUntil) continue;
        const n = { t: c.t, type: 'tap', main: c.main, beat: c.beat, drop: c.drop, s: c.s };
        const chance = c.drop ? cfg.holds * cfg.dropHolds : cfg.holds;
        if (c.main && (c.beat - parity) % 4 === 0 && c.beat - lastHold >= 8 && rng() < chance) {
            const [lo, hi] = cfg.holdBeats;
            const endBeat = c.beat + lo + Math.floor(rng() * (hi - lo + 1));
            if (endBeat < beats.length) {
                n.type = 'hold';
                n.end = beats[endBeat];
                // прямая, спираль в одну или другую сторону или волна
                n.twist = cfg.twist && rng() < 0.6 ? (rng() < 0.5 ? -1 : 1) * (0.2 + rng() * cfg.twist) : 0;
                n.wiggle = !n.twist && k > 0 && rng() < 0.5 ? 0.18 + rng() * 0.2 : 0;
                n.waves = 1 + Math.floor(rng() * 3);
                holdUntil = n.end + Math.max(cfg.gap, 0.2);
                lastHold = c.beat;
            }
        }
        notes.push(n);
    }

    // 3. Слишком близкие ноты убираем
    const out = [];
    for (const n of notes) {
        const prev = out[out.length - 1];
        if (prev && n.t - (prev.type === 'hold' ? prev.end : prev.t) < cfg.gap) continue;
        out.push(n);
    }

    // 4. Направления и формы — своим узором на каждую фразу
    restyle(out, rng);
    for (const n of out) {
        n.hollow = !n.main;                             // ноты между битами — пустые внутри
        n.size = n.main ? 0.9 + 0.35 * Math.min(1, n.s) : 0.75;
        n.twin = cfg.twins && n.drop && n.main && (n.beat - parity) % 4 === 0 && n.type === 'tap';
    }

    const notesOut = out.map(n => {
        const o = { t: n.t, type: n.type, angle: n.angle, shape: n.shape, size: n.size };
        if (n.hollow) o.hollow = true;
        if (n.twin) o.twin = true;
        if (n.type === 'hold') Object.assign(o, { end: n.end, twist: n.twist, wiggle: n.wiggle, waves: n.waves });
        return o;
    });
    const last = notesOut[notesOut.length - 1];
    const end = last ? (last.end || last.t) + 2 : song.duration;
    return { approach: cfg.approach, notes: notesOut, end };
}

// Откуда летят ноты и какой они формы — своим узором на каждую фразу (16 битов).
// Нужны n.beat (номер бита) и n.drop. pattern — один узор на всё (иначе в каждой фразе случайный);
// shapes / angles: false — не трогать формы / направления (так делает редактор)
export function restyle(notes, rng, { shapes = true, angles = true, pattern = null } = {}) {
    let phrase = -1, pat = 'spin', base = 0, dir = 1, set = ['circle'], idx = 0;
    for (const n of notes) {
        const p = Math.floor(n.beat / 16);
        if (p !== phrase) {
            phrase = p;
            idx = 0;
            pat = pick(rng, n.drop ? DROP_PATTERNS : PATTERNS);
            if (pattern) pat = pattern;
            base = Math.floor(rng() * 24) * 15;
            dir = rng() < 0.5 ? 1 : -1;
            set = n.drop ? [pick(rng, SHAPES), pick(rng, SHAPES)] : [pick(rng, SHAPES)];
        }
        if (angles) n.angle = angleFor(pat, base, idx, dir, rng);
        if (shapes) n.shape = set[idx % set.length];
        idx++;
    }
}

function angleFor(pattern, base, i, dir, rng) {
    let a;
    switch (pattern) {
        case 'spin': a = base + i * 45 * dir; break;
        case 'alt': a = base + (i % 2) * 180; break;
        case 'cross': a = base + (i % 4) * 90 * dir; break;
        case 'stream': a = base + i * 12 * dir; break;
        case 'zigzag': a = base + (i % 2 ? 35 : -35); break;
        default: a = Math.floor(rng() * 24) * 15;
    }
    return ((a % 360) + 360) % 360;
}
