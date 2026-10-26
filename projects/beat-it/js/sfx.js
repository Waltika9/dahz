// Звуки игры без файлов — собираются из шума и тонов прямо в браузере:
//   щелчок при попадании, порыв ветра и хлопушка с конфетти в начале дропа, «бум» при появлении оценки,
//   метроном в редакторе. Тихие, чтобы не мешать музыке

import { audioContext } from './music.js?v=6';

const ctx = audioContext();
let out = null;
let sounds = null;

function ready() {
    if (!ctx) return false;
    if (!out) {
        out = ctx.createGain();
        out.gain.value = 0.4;
        out.connect(ctx.destination);
        sounds = { click: makeClick(), whoosh: makeWhoosh(), pop: makePop(), boom: makeBoom(), tick: makeTick() };
    }
    return ctx.state === 'running';
}

function play(name, vol = 1, rate = 1) {
    if (!ready()) return;
    const s = ctx.createBufferSource();
    s.buffer = sounds[name];
    s.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = vol;
    s.connect(g);
    g.connect(out);
    s.start();
}

// j — оценка попадания: чем точнее, тем звонче
export function click(j = 0) {
    play('click', [0.75, 0.6, 0.45][j] ?? 0.45, [1, 0.93, 0.86][j] ?? 0.86);
}

// Конец длинной ноты — щелчок потише и повыше
export function soft() {
    play('click', 0.4, 1.15);
}

// Начало дропа: порыв ветра и хлопушка
export function drop() {
    play('whoosh', 0.55);
    play('pop', 0.45);
}

// Появилась оценка на экране результата
export function boom() {
    play('boom', 0.7);
}

// Лишнее нажатие (нот рядом нет) — глухой короткий звук
export function wrong() {
    play('tick', 0.5, 0.55);
}

// Метроном в редакторе: первый бит такта — выше
export function tick(strong) {
    play('tick', strong ? 0.7 : 0.45, strong ? 1.5 : 1);
}

// ===== Сборка звуков =====

function buffer(sec, fill) {
    const sr = ctx.sampleRate;
    const b = ctx.createBuffer(1, Math.floor(sr * sec), sr);
    const d = b.getChannelData(0);
    fill(d, sr);
    // выравниваем громкость: пик 0.8
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (peak > 0) for (let i = 0; i < d.length; i++) d[i] *= 0.8 / peak;
    return b;
}

const noise = () => Math.random() * 2 - 1;

// Щелчок: короткий «тик» — верхушка шума и звонкий тон, всё затихает за 30 мс
function makeClick() {
    return buffer(0.05, (d, sr) => {
        let lp = 0;
        for (let i = 0; i < d.length; i++) {
            const t = i / sr;
            const n = noise();
            lp += 0.35 * (n - lp);
            d[i] = (n - lp) * 0.7 * Math.exp(-t / 0.004) + Math.sin(2 * Math.PI * 2300 * t) * 0.5 * Math.exp(-t / 0.012);
        }
    });
}

// Порыв ветра: шум, у которого фильтр быстро «открывается» и медленно «закрывается»
function makeWhoosh() {
    return buffer(1.2, (d, sr) => {
        let hi = 0, lo = 0;
        for (let i = 0; i < d.length; i++) {
            const p = i / d.length;
            const env = p < 0.3 ? (p / 0.3) ** 2 : ((1 - p) / 0.7) ** 1.6;
            const fc = 300 + 3500 * env;
            const k1 = 1 - Math.exp(-2 * Math.PI * fc / sr);
            const k2 = 1 - Math.exp(-2 * Math.PI * fc * 0.3 / sr);
            const n = noise();
            hi += k1 * (n - hi);
            lo += k2 * (n - lo);
            d[i] = (hi - lo) * env;
        }
    });
}

// Хлопушка: глухой хлопок, а за ним треск разлетающегося конфетти
function makePop() {
    return buffer(0.9, (d, sr) => {
        let lp = 0;
        for (let i = 0; i < d.length; i++) {
            const t = i / sr;
            lp += 0.2 * (noise() - lp);
            d[i] = lp * 2 * Math.exp(-t / 0.02) + Math.sin(2 * Math.PI * 140 * t) * 0.5 * Math.exp(-t / 0.05);
        }
        for (let c = 0; c < 50; c++) {
            const at = 0.04 + Math.random() ** 1.6 * 0.8;
            const start = Math.floor(at * sr);
            const amp = 0.3 * (1 - at / 0.9);
            for (let i = 0; i < sr * 0.004 && start + i < d.length; i++) {
                d[start + i] += noise() * amp * Math.exp(-i / (sr * 0.0008));
            }
        }
    });
}

// Метроном: деревянный «ток» — чистый тон, затихает за 40 мс
function makeTick() {
    return buffer(0.08, (d, sr) => {
        for (let i = 0; i < d.length; i++) {
            const t = i / sr;
            d[i] = Math.sin(2 * Math.PI * 1100 * t) * Math.exp(-t / 0.015) + Math.sin(2 * Math.PI * 2750 * t) * 0.3 * Math.exp(-t / 0.006);
        }
    });
}

// «Бум»: низкий удар, который быстро съезжает вниз по высоте
function makeBoom() {
    return buffer(0.7, (d, sr) => {
        let phase = 0, lp = 0;
        for (let i = 0; i < d.length; i++) {
            const t = i / sr;
            phase += 2 * Math.PI * (55 + 120 * Math.exp(-t / 0.05)) / sr;
            lp += 0.1 * (noise() - lp);
            d[i] = Math.sin(phase) * Math.exp(-t / 0.22) + lp * 1.5 * Math.exp(-t / 0.03);
        }
    });
}
