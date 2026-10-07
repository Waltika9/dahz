// ===== Музыка во внеурочное время =====
// Список треков — ниже. Файлы лежат в папке audio/ рядом с index.html.
// Имена — латиницей, без пробелов. Чтобы добавить трек, допишите строку;
// отсутствующие файлы просто пропускаются.
export const TRACKS = [
    'audio/uwa-so-temperate.mp3',
    'audio/home.mp3',
    'audio/uwa-so-holiday.mp3',
    'audio/shop.mp3',
    'audio/memory.mp3',
    'audio/hotel.mp3',
    'audio/finale.mp3',
    'audio/dont-give-up.mp3',
    'audio/last-goodbye.mp3',
    'audio/good-night.mp3'
];

// Как это работает:
// • музыка играет, только когда идёт домашний режим (нет уроков) и звук включён кнопкой;
// • трек выбирается случайно, закончился — включается другой случайный;
//   кнопка «следующий» рядом с динамиком сразу переключает на другой случайный трек;
// • включён ли звук и громкость хранятся в localStorage (settings.js), по умолчанию звук выключен;
// • iPhone разрешает звук только после нажатия, поэтому первое включение — всегда по кнопке.
//   Если звук был включён в прошлый раз, музыка начнётся от первого касания экрана;
// • громкость меняется через Web Audio (GainNode): у <audio> на iPhone громкость не меняется.

import * as settings from './settings.js?v=2';

let audio = null, ctx = null, gain = null;
let home = false;           // идёт ли сейчас домашний режим
let current = '';           // какой трек играет
let token = 0;              // номер попытки запуска — чтобы старые ошибки не мешали новым
let starting = false;       // идёт попытка запуска (её ошибки ловит start)
let waitingTap = false;
const bad = new Set();      // треки, которые не загрузились
const listeners = new Set();

// fn() — когда меняется состояние (для иконки звука)
export function onAudioChange(fn) {
    listeners.add(fn);
}

function notify() {
    listeners.forEach(fn => fn());
}

export function isSoundOn() {
    return !!settings.get('sound');
}

export function isPlaying() {
    return !!audio && !audio.paused;
}

function ensure() {
    if (audio) return;
    audio = new Audio();
    audio.preload = 'auto';
    audio.addEventListener('ended', () => playNext());
    // ошибка посреди игры (например, пропал интернет) — следующий трек
    audio.addEventListener('error', () => { if (!starting) failed(token); });
    audio.addEventListener('play', notify);
    audio.addEventListener('pause', notify);
    // Web Audio — только на настоящем сайте (http/https). Если index.html открыт просто
    // как файл (file://), браузер из соображений безопасности отдаёт в Web Audio тишину,
    // поэтому тогда играем напрямую, а громкость — через audio.volume.
    const web = location.protocol === 'https:' || location.protocol === 'http:';
    try {
        if (!web) throw new Error('file');
        const AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC();
        gain = ctx.createGain();
        ctx.createMediaElementSource(audio).connect(gain).connect(ctx.destination);
    } catch (e) {
        ctx = null;     // без Web Audio — громкость через audio.volume (на компьютере работает)
        gain = null;
    }
    applyVolume(0);
}

// Плавно (fade секунд) подвести громкость к нужной; target = null — к громкости из настроек
function applyVolume(fade = 0.4, target = null) {
    const v = target ?? settings.get('volume');
    if (gain && ctx) {
        const g = gain.gain;
        g.cancelScheduledValues(ctx.currentTime);
        g.setValueAtTime(g.value, ctx.currentTime);
        g.linearRampToValueAtTime(v, ctx.currentTime + fade);
    } else if (audio) {
        audio.volume = Math.min(1, Math.max(0, v));
    }
}

function pickTrack() {
    const ok = TRACKS.filter(t => !bad.has(t));
    if (!ok.length) return null;
    let t;
    do { t = ok[Math.floor(Math.random() * ok.length)]; } while (ok.length > 1 && t === current);
    return t;
}

async function playNext() {
    if (!shouldPlay()) return;
    ensure();
    const t = pickTrack();
    if (!t) { noMusic(); return; }
    current = t;
    const my = ++token;
    audio.src = t;
    await start(my);
}

async function start(my) {
    starting = true;
    try {
        // resume не ждём: без нажатия он может «висеть»
        if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
        if (gain) gain.gain.value = 0;
        await audio.play();
        if (my !== token) return;
        applyVolume(1.2);           // мягко нарастает
        // браузер дал играть, но Web Audio ещё спит (не было нажатия) — разбудим касанием
        if (ctx && ctx.state !== 'running') waitForTap();
    } catch (e) {
        if (my !== token) return;
        if (e.name === 'NotAllowedError') waitForTap();   // iPhone ждёт касания
        else if (e.name !== 'AbortError') failed(my);     // файла нет или он битый
    } finally {
        if (my === token) starting = false;
        notify();
    }
}

function failed(my) {
    if (my !== token || !current) return;
    bad.add(current);
    current = '';
    playNext();
}

// Ни один трек не загрузился — тихо выключаем звук
function noMusic() {
    settings.set('sound', false);
    notify();
}

// Звук был включён раньше, но браузер не дал играть без нажатия — ждём любого касания
function waitForTap() {
    if (waitingTap) return;
    waitingTap = true;
    const go = () => {
        document.removeEventListener('pointerdown', go, true);
        document.removeEventListener('keydown', go, true);
        if (!waitingTap) return;
        waitingTap = false;
        if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
        resume();
    };
    document.addEventListener('pointerdown', go, true);
    document.addEventListener('keydown', go, true);
}

function shouldPlay() {
    return home && isSoundOn();
}

// Запустить, если надо, или продолжить с паузы
function resume() {
    if (!shouldPlay()) return;
    ensure();
    if (current && audio.src && audio.paused && !audio.ended) start(++token);
    else if (!current || audio.ended) playNext();
}

// Плавно затихнуть и поставить на паузу
function fadeOut() {
    if (!audio || audio.paused) return;
    applyVolume(0.8, 0);
    const my = ++token;
    setTimeout(() => { if (my === token) audio.pause(); }, 850);
}

// Кнопка звука на блоке «Сейчас» (это нажатие — разрешение для iPhone)
export function toggleSound() {
    const next = !isSoundOn();
    settings.set('sound', next);
    if (next) {
        bad.clear();            // вдруг музыку уже загрузили — пробуем заново
        ensure();
        if (ctx && ctx.state !== 'running') ctx.resume();
        resume();
    } else {
        fadeOut();
    }
    notify();
}

// Кнопка «следующий трек»: сразу другой случайный (нажатие — тоже разрешение для iPhone)
export function skipTrack() {
    if (!shouldPlay()) return;
    ensure();
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
    playNext();
}

// Каждую секунду: идёт ли сейчас домашний режим
export function setHome(on) {
    if (on === home) return;
    home = on;
    if (home) resume();
    else fadeOut();
    notify();
}

// Громкость поменяли в настройках
settings.onChange((name) => {
    if (name === 'volume') applyVolume(0.15);
});
