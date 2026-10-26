// Музыка через Web Audio: по часам AudioContext видно точное время песни,
// поэтому логотип и ноты попадают ровно в биты

const AC = window.AudioContext || window.webkitAudioContext;
const ctx = AC ? new AC() : null;
const VOLUME = 0.8;

// Цепочка: песня → фильтр (приглушает на экране результата) → тише/громче → общая громкость
let gain = null, dim = null, filter = null;
if (ctx) {
    gain = ctx.createGain();
    gain.gain.value = VOLUME;
    gain.connect(ctx.destination);
    dim = ctx.createGain();
    dim.connect(gain);
    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 22000;
    filter.connect(dim);
}

// Нужен звукам игры (sfx.js)
export const audioContext = () => ctx;

let buffer = null;       // песня, которая включится следующей (use)
let source = null;
let startedAt = 0;       // время AudioContext, когда песня начинается
let offset = 0;          // с какой секунды песни включили
let rate = 1;            // скорость (в редакторе можно замедлить)
let looping = true;      // в меню песня крутится по кругу, в уровне — один раз
let held = false;        // пауза в уровне: не включать звук, даже если вернулись на вкладку

// Скачать и раскодировать песню (сама она ещё не включается — для этого use)
export async function fetchTrack(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Не нашёл файл ${url}`);
    return decode(await res.arrayBuffer());
}

// Раскодировать звук из файла (mp3, m4a, wav…)
export function decode(data) {
    if (!ctx) return Promise.reject(new Error('Браузер не умеет Web Audio'));
    // Старый Safari понимает только вариант с колбэками
    return new Promise((ok, fail) => ctx.decodeAudioData(data, ok, fail));
}

// Какую песню включать в play / playOnce
export function use(buf) {
    buffer = buf;
}

// Браузер разрешает звук только после нажатия — вызываем на любое нажатие
export function unlock() {
    if (!ctx || ctx.state === 'running' || held) return;
    ctx.resume();
    // iPhone: короткий пустой звук окончательно «будит» аудио
    const s = ctx.createBufferSource();
    s.buffer = ctx.createBuffer(1, 1, 22050);
    s.connect(ctx.destination);
    s.start(0);
}

// Меню: играет с секунды from; loop включает повтор песни по кругу
export function play(from = 0, fade = 0.03, loop = true) {
    if (!start(loop, 1)) return false;
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(VOLUME, now + fade);   // без щелчка и резкого начала
    source.start(now, from);
    startedAt = now;
    offset = from;
    return true;
}

// Уровень: песня один раз через lead секунд (время до этого — отрицательное),
// с секунды from (проверка из редактора) и со скоростью r
export function playOnce(lead, from = 0, r = 1) {
    if (!start(false, r)) return false;
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(VOLUME, now);
    source.start(now + lead, Math.max(0, from));
    startedAt = now + lead;
    offset = from;
    return true;
}

function start(loop, r) {
    if (!ctx || !buffer) return false;
    stop();
    held = false;
    if (ctx.state !== 'running' && !document.hidden) ctx.resume();
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.playbackRate.value = r;
    source.connect(filter);
    looping = loop;
    rate = r;
    return true;
}

// Приглушить (как из-за стены) или вернуть обычный звук
export function muffle(on, sec = 0.6) {
    if (!ctx) return;
    const now = ctx.currentTime;
    const end = now + Math.max(0.01, sec);
    filter.frequency.cancelScheduledValues(now);
    filter.frequency.setValueAtTime(filter.frequency.value, now);
    filter.frequency.exponentialRampToValueAtTime(on ? 1400 : 22000, end);
    dim.gain.cancelScheduledValues(now);
    dim.gain.setValueAtTime(dim.gain.value, now);
    dim.gain.linearRampToValueAtTime(on ? 0.55 : 1, end);
}

// Играет ли сейчас песня по кругу (меню или экран результата)
export const isLooping = () => !!source && looping;

export function stop() {
    if (!source) return;
    try { source.stop(); } catch (e) { /* уже остановлен */ }
    source.disconnect();
    source = null;
}

// Плавно затихнуть и остановиться
export function fadeOut(sec) {
    if (!source) return;
    const s = source;
    const now = ctx.currentTime;
    holdGain(now);
    gain.gain.linearRampToValueAtTime(0, now + sec);
    setTimeout(() => {
        if (source === s) stop();
    }, sec * 1000 + 60);
}

// Провал: песня замедляется и затихает, как в osu
export function slowDown(sec) {
    if (!source) return;
    const now = ctx.currentTime;
    source.playbackRate.setValueAtTime(rate, now);
    source.playbackRate.linearRampToValueAtTime(0.3 * rate, now + sec);
    fadeOut(sec);
}

function holdGain(now) {
    if (gain.gain.cancelAndHoldAtTime) {
        gain.gain.cancelAndHoldAtTime(now);
    } else {
        const v = gain.gain.value;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(v, now);
    }
}

// Пауза в уровне: часы AudioContext останавливаются вместе со звуком
export function pause() {
    held = true;
    if (ctx) ctx.suspend();
}

export function resume() {
    held = false;
    if (ctx) ctx.resume();
}

// Какая секунда песни сейчас слышна (с поправкой на задержку колонок/наушников)
export function time() {
    if (!source) return null;
    const lag = ctx.outputLatency || ctx.baseLatency || 0;
    const t = (ctx.currentTime - startedAt - lag) * rate + offset;
    if (!looping) return t;
    const d = source.buffer.duration;
    return ((t % d) + d) % d;
}

// Ушли со вкладки — музыка на паузе, вернулись — играет дальше с того же места
document.addEventListener('visibilitychange', () => {
    if (!ctx || !source) return;
    if (document.hidden) ctx.suspend();
    else if (!held) ctx.resume();
});
