// Разбор песни прямо в браузере: темп, биты и «дропы» (самые громкие и плотные куски).
// Песня никуда не отправляется — всё считается на устройстве.

const HOP_SEC = 0.01;        // шаг разбора — 10 мс
const CUTS = [150, 600, 3000];   // границы полос: бочка и бас | низ середины | голос, гитары | тарелки
const TIGHT = 400;           // насколько строго биты держат темп
const BINS = 64;             // столбиков в мини-графике песни

export function analyzeTrack(buffer) {
    const sr = buffer.sampleRate;
    const hop = Math.round(sr * HOP_SEC);
    const fps = sr / hop;
    const n = Math.floor(buffer.length / hop);
    const duration = buffer.duration;

    // 1. Громкость каждых 10 мс: вся песня и 4 полосы частот отдельно
    const { all, bands } = envelopes(buffer, hop, n);
    const low = bands[0];

    // 2. «Удары»: моменты, где громкость резко выросла. Считаем в каждой полосе отдельно,
    //    иначе бас с хитрым ритмом перекрикивает барабаны
    const onset = new Float32Array(n);
    for (const band of bands) {
        const rise = new Float32Array(n);
        for (let f = 1; f < n; f++) {
            rise[f] = Math.max(0, Math.log1p(100 * band[f]) - Math.log1p(100 * band[f - 1]));
        }
        const sd = std(rise);
        if (sd > 0) for (let f = 0; f < n; f++) onset[f] += rise[f] / sd;
    }
    const sd = std(onset);
    if (sd > 0) for (let f = 0; f < n; f++) onset[f] /= sd;

    // 3. Темп и сами биты
    const period = findPeriod(onset, fps);
    const { frames, local } = trackBeats(onset, period);
    const beats = Float64Array.from(frames, f => (f + 0.5) / fps);

    // Сила каждого бита (0…1): сильные удары — логотип прыгает выше
    const peak = quantile(frames.map(f => local[f]), 0.9) || 1;
    const strength = Float32Array.from(frames, f => Math.min(1, local[f] / peak));
    // Сила ударов в каждые 10 мс (1 — обычный сильный бит): по ней ставятся ноты между битами
    const onsetN = Float32Array.from(local, v => v / peak);

    // 4. Громкость каждого бита → дропы
    const loud = frames.map((f, i) => {
        const end = i + 1 < frames.length ? frames[i + 1] : Math.min(n, f + Math.round(period));
        let sa = 0, sl = 0;
        for (let k = f; k < end; k++) {
            sa += all[k] * all[k];
            sl += low[k] * low[k];
        }
        const c = Math.max(1, end - f);
        return 0.5 * (db(sa / c) + db(sl / c));
    });
    const drops = findDrops(loud).map(([a, b]) => [beats[a], b < beats.length ? beats[b] : duration]);

    // 5. С какого места включать песню в меню: начало дропа ближе к середине
    let startAt = 0;
    const middle = duration * 0.45;
    const late = drops.filter(([a]) => a >= duration * 0.15);
    if (late.length) {
        late.sort((x, y) => Math.abs(x[0] - middle) - Math.abs(y[0] - middle));
        startAt = late[0][0];
    } else if (beats.length) {
        startAt = beats[nearest(beats, duration * 0.4)];
    }
    startAt = Math.max(0, startAt - 0.03);

    // 6. Мини-график для карточки уровня
    const wave = new Float32Array(BINS);
    const waveDrop = new Uint8Array(BINS);
    let top = -Infinity;
    for (let i = 0; i < BINS; i++) {
        const a = Math.floor(i * n / BINS);
        const b = Math.max(a + 1, Math.floor((i + 1) * n / BINS));
        let s = 0;
        for (let f = a; f < b; f++) s += all[f] * all[f];
        wave[i] = db(s / (b - a));
        top = Math.max(top, wave[i]);
        const mid = (i + 0.5) / BINS * duration;
        waveDrop[i] = drops.some(([x, y]) => mid >= x && mid < y) ? 1 : 0;
    }
    for (let i = 0; i < BINS; i++) wave[i] = clamp((wave[i] - (top - 30)) / 30, 0, 1);

    const steps = [];
    for (let i = 1; i < beats.length; i++) steps.push(beats[i] - beats[i - 1]);
    const bpm = steps.length ? 60 / quantile(steps, 0.5) : 60 * fps / period;

    return { duration, bpm, beats, strength, drops, startAt, wave, waveDrop, onset: onsetN, fps };
}

// Громкость (RMS) кусочков по hop отсчётов: вся песня и 4 полосы.
// Полосы — разность простых фильтров (каждый в два прохода)
function envelopes(buffer, hop, n) {
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    const [k1, k2, k3] = CUTS.map(fc => 1 - Math.exp(-2 * Math.PI * fc / buffer.sampleRate));
    const all = new Float32Array(n);
    const bands = [0, 1, 2, 3].map(() => new Float32Array(n));
    let a1 = 0, b1 = 0, a2 = 0, b2 = 0, a3 = 0, b3 = 0, i = 0;
    for (let f = 0; f < n; f++) {
        let s = 0, s0 = 0, s1 = 0, s2 = 0, s3 = 0;
        for (const end = i + hop; i < end; i++) {
            const x = (left[i] + right[i]) * 0.5;
            a1 += k1 * (x - a1); b1 += k1 * (a1 - b1);
            a2 += k2 * (x - a2); b2 += k2 * (a2 - b2);
            a3 += k3 * (x - a3); b3 += k3 * (a3 - b3);
            const m = b2 - b1, h = b3 - b2, t = x - b3;
            s += x * x;
            s0 += b1 * b1;
            s1 += m * m;
            s2 += h * h;
            s3 += t * t;
        }
        all[f] = Math.sqrt(s / hop);
        bands[0][f] = Math.sqrt(s0 / hop);
        bands[1][f] = Math.sqrt(s1 / hop);
        bands[2][f] = Math.sqrt(s2 / hop);
        bands[3][f] = Math.sqrt(s3 / hop);
    }
    return { all, bands };
}

// Темп: через сколько кадров «удары» чаще всего повторяются (от 60 до 200 BPM, ближе к 120 — лучше).
// Настоящий бит повторяется ещё и через 2 и 4 бита (такт) — это тоже учитываем.
// Такт весит заметно: иначе в песнях с «рваным» ритмом (Starboy) темп выходит в полтора раза больше
function findPeriod(onset, fps) {
    const n = onset.length;
    const sm = smooth(onset, 2);
    let mean = 0;
    for (let f = 0; f < n; f++) mean += sm[f];
    mean /= n || 1;
    const c = Float32Array.from(sm, v => v - mean);

    const minLag = Math.floor(fps * 60 / 200);
    const maxLag = Math.ceil(fps * 60 / 60);
    const acf = new Float32Array(4 * maxLag + 6);
    for (let lag = 1; lag < acf.length; lag++) {
        let s = 0;
        for (let f = lag; f < n; f++) s += c[f] * c[f - lag];
        acf[lag] = s / Math.max(1, n - lag);
    }

    const score = new Float32Array(maxLag + 2);
    let best = Math.round(fps / 2), bestV = -Infinity;
    for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
        const bpm = 60 * fps / lag;
        score[lag] = (acf[lag] + 0.5 * acf[2 * lag] + 0.4 * acf[4 * lag]) * Math.exp(-0.5 * Math.log2(bpm / 120) ** 2);
        if (lag >= minLag && lag <= maxLag && score[lag] > bestV) {
            bestV = score[lag];
            best = lag;
        }
    }
    // Уточняем между соседними кадрами (вершина параболы)
    const y0 = score[best - 1], y1 = score[best], y2 = score[best + 1];
    const d = y0 - 2 * y1 + y2;
    return best + (d < 0 ? clamp(0.5 * (y0 - y2) / d, -0.5, 0.5) : 0);
}

// Биты: цепочка ударов с шагом около period (динамическое программирование, как у Эллиса)
function trackBeats(onset, period) {
    const n = onset.length;
    const local = smooth(onset, period / 32);
    const lo = Math.max(1, Math.round(period / 2));
    const hi = Math.round(period * 2);
    const penalty = new Float32Array(hi + 1);
    for (let d = lo; d <= hi; d++) penalty[d] = TIGHT * Math.log(d / period) ** 2;

    let maxLocal = 0;
    for (let f = 0; f < n; f++) maxLocal = Math.max(maxLocal, local[f]);

    const score = new Float32Array(n);
    const back = new Int32Array(n).fill(-1);
    let started = false;
    for (let f = 0; f < n; f++) {
        let bestV = -Infinity, bestI = -1;
        for (let d = lo; d <= hi && d <= f; d++) {
            const v = score[f - d] - penalty[d];
            if (v > bestV) {
                bestV = v;
                bestI = f - d;
            }
        }
        if (bestI < 0 || (!started && local[f] < 0.01 * maxLocal)) {
            score[f] = local[f];
        } else {
            score[f] = local[f] + bestV;
            back[f] = bestI;
            started = true;
        }
    }

    // Последний бит — последний заметный пик общего счёта, дальше идём по цепочке назад
    const peaks = [];
    for (let f = 1; f < n - 1; f++) {
        if (score[f] > score[f - 1] && score[f] >= score[f + 1]) peaks.push(f);
    }
    if (!peaks.length) return { frames: [], local };
    const med = quantile(peaks.map(f => score[f]), 0.5);
    let last = peaks[peaks.length - 1];
    for (let j = peaks.length - 1; j >= 0; j--) {
        if (score[peaks[j]] >= 0.5 * med) {
            last = peaks[j];
            break;
        }
    }
    const frames = [];
    for (let f = last; f >= 0; f = back[f]) frames.push(f);
    frames.reverse();

    // Слабые биты в начале и в конце (тишина, разговоры) убираем
    let rms = 0;
    for (const f of frames) rms += local[f] * local[f];
    const thr = 0.5 * Math.sqrt(rms / Math.max(1, frames.length));
    let a = 0, b = frames.length;
    while (a < b && local[frames[a]] <= thr) a++;
    while (b > a && local[frames[b - 1]] <= thr) b--;
    return { frames: frames.slice(a, b), local };
}

// Дропы: куски от 4 тактов, где песня громче обычного. Возвращает [начальный бит, конечный бит]
function findDrops(loud) {
    const m = loud.length;
    if (m < 32) return [];
    const sm = loud.map((_, i) => avg(loud, i - 8, i + 8));     // сглаживаем по 4 такта

    // Тихие места (вступление без музыки) в расчёт не берём
    const top = quantile(sm, 0.95);
    const thr = quantile(sm.filter(v => v > top - 12), 0.6);

    let runs = [];
    let s = -1;
    for (let i = 0; i <= m; i++) {
        const on = i < m && sm[i] >= thr;
        if (on && s < 0) s = i;
        if (!on && s >= 0) {
            runs.push([s, i]);
            s = -1;
        }
    }
    // Склеиваем, если между громкими кусками меньше 2 тактов
    const merged = [];
    for (const r of runs) {
        const prev = merged[merged.length - 1];
        if (prev && r[0] - prev[1] < 8) prev[1] = r[1];
        else merged.push(r);
    }
    runs = merged.filter(([a, b]) => b - a >= 16);

    // Уточняем края: бит, где громкость прыгает сильнее всего
    for (const r of runs) {
        r[0] = bestJump(loud, r[0], 1);
        r[1] = bestJump(loud, r[1], -1);
    }
    return runs.filter(([a, b]) => b - a >= 8);
}

function bestJump(loud, i, dir) {
    let best = i, bestV = -Infinity;
    for (let j = i - 6; j <= i + 6; j++) {
        if (j < 4 || j > loud.length - 4) continue;
        const v = dir * (avg(loud, j, j + 4) - avg(loud, j - 4, j));
        if (v > bestV) {
            bestV = v;
            best = j;
        }
    }
    return best;
}

// ===== Мелкие помощники =====

function smooth(src, sigma) {
    const r = Math.max(1, Math.ceil(sigma * 3));
    const w = [];
    for (let i = -r; i <= r; i++) w.push(Math.exp(-0.5 * (i / sigma) ** 2));
    const out = new Float32Array(src.length);
    for (let f = 0; f < src.length; f++) {
        let s = 0;
        for (let i = -r; i <= r; i++) {
            const g = f + i;
            if (g >= 0 && g < src.length) s += src[g] * w[i + r];
        }
        out[f] = s;
    }
    return out;
}

function avg(arr, a, b) {
    a = Math.max(0, a);
    b = Math.min(arr.length, b);
    let s = 0;
    for (let i = a; i < b; i++) s += arr[i];
    return b > a ? s / (b - a) : 0;
}

function std(arr) {
    let m = 0;
    for (const v of arr) m += v;
    m /= arr.length || 1;
    let s = 0;
    for (const v of arr) s += (v - m) * (v - m);
    return Math.sqrt(s / Math.max(1, arr.length - 1));
}

function quantile(arr, p) {
    if (!arr.length) return 0;
    const s = Array.from(arr).sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
}

function nearest(sorted, t) {
    let best = 0;
    for (let i = 1; i < sorted.length; i++) {
        if (Math.abs(sorted[i] - t) < Math.abs(sorted[best] - t)) best = i;
    }
    return best;
}

function db(power) {
    return 10 * Math.log10(power + 1e-10);
}

function clamp(v, a, b) {
    return Math.min(b, Math.max(a, v));
}
