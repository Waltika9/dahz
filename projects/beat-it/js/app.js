// BEAT IT by Waltika — главное меню.
// Порядок: предупреждение и загрузка → нажатие → логотип падает → волна и музыка → по клику уровни.
// Как в osu: раскрыл уровень в списке — заиграла его песня

import * as music from './music.js?v=6';
import { buildLogo, spawnWave, flipLetters } from './logo.js?v=5';
import { renderLevels, closeDiffs, markOptions, openLevel, updateLevel, headOf, drawWave } from './menu.js?v=7';
import { getOptions, activeOptions, openOptions, closeOptions } from './options.js?v=2';
import { startGame } from './game.js?v=10';
import { exportLevel } from './pack.js?v=6';
import { PRESETS, loadLevel, songOf, chartFor, userLevels, forget, remember } from './library.js?v=3';
import { openCreate, closeCreate, importDroppedFile } from './create.js?v=6';
import { openEditor } from './editor.js?v=15';
import { deleteLevel } from './store.js?v=1';
import { ask } from './dialog.js?v=1';
import { dragScroll } from './scroll.js?v=5';
import { toast } from './util.js?v=1';

const MIN_LOADING = 1000;      // чтобы экран загрузки не исчезал мгновенно
const FALL_MS = 800;           // сколько падает логотип
const FADE_SEC = 1.2;          // за сколько музыка плавно становится громкой
const PULL = 0.02;             // насколько логотип тянется к курсору (доля экрана)
const FLIP = [5000, 10000];    // «перелив» букв логотипа — раз в 5–10 секунд (случайно), всегда на бит
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;   // без вспышек и тряски

const $ = id => document.getElementById(id);
const body = document.body;
const logoSvg = $('logoSvg');
const logoMove = $('logoMove');
const logoFall = $('logoFall');
const waves = $('logoWaves');
const levelsList = $('levelsList');

let levels = [...PRESETS];   // все уровни в списке: предустановленные, потом свои
let cur = null;           // { level, song, buffer } — чья песня сейчас играет в меню
let song = null;          // её разбор: биты, дропы, с какого места играть
let switching = 0;        // номер последнего переключения песни (старые загрузки не мешают)
let autoPlaylist = true;
let advancing = false;
let loaded = false;
let pressed = false;
let landedAt = 0;
let flipAt = 0;           // когда в следующий раз «переливаются» буквы логотипа
let playhead = null;      // полоска «сейчас здесь» на графике песни
let inGame = false;       // идёт уровень или открыт редактор — меню спит

const wait = ms => new Promise(r => setTimeout(r, ms));

// ===== 1. Загрузка: шрифт, свои уровни, случайная песня и её разбор =====

async function load() {
    const pageReady = document.readyState === 'complete'
        ? Promise.resolve()
        : new Promise(resolve => addEventListener('load', resolve, { once: true }));
    const fontsReady = document.fonts.load('200px Anton', 'BEATIby Waltka').catch(() => {});
    levels = [...PRESETS, ...(await userLevels())];
    const first = levels[Math.floor(Math.random() * levels.length)];
    try {
        const { song: s, buffer } = await loadLevel(first);
        music.use(buffer);
        cur = { level: first, song: s, buffer };
        song = s;
    } catch (e) {
        console.warn('Музыка не загрузилась:', e);
    }
    await Promise.all([pageReady, fontsReady, document.fonts.ready]);
    buildLogo(logoSvg);
}

Promise.all([load(), wait(MIN_LOADING)]).then(() => {
    loaded = true;
    $('loader').classList.add('is-hidden');
    if (pressed) start();
});

// ===== 2. Предупреждение: продолжить — любая клавиша или кнопка мыши =====

if (matchMedia('(pointer: coarse)').matches) {
    $('disclaimerHint').textContent = 'Коснись экрана, чтобы продолжить';
}

function onPress(e) {
    music.unlock();
    if (pressed || e.repeat) return;
    pressed = true;
    if (loaded) start();
    else $('disclaimerHint').textContent = 'Почти готово…';
}
addEventListener('keydown', onPress);
addEventListener('pointerdown', onPress);
// iPhone включает звук только когда палец отпускают
addEventListener('pointerup', music.unlock);
addEventListener('touchend', music.unlock);

async function start() {
    removeEventListener('keydown', onPress);
    removeEventListener('pointerdown', onPress);
    if (!song) song = quietSong();
    $('disclaimer').classList.add('is-hidden');
    await wait(500);
    renderList();
    body.classList.add('is-menu');
    fitLevels();

    // Музыка плавно включается, как только логотип начинает падать,
    // а начало дропа звучит ровно в момент приземления
    let fallMs = FALL_MS;
    if (!song.quiet) {
        music.play(Math.max(0, song.startAt - FALL_MS / 1000), FADE_SEC, !autoPlaylist);
        const left = (song.startAt - music.time()) * 1000;
        if (left > FALL_MS * 0.8 && left < FALL_MS * 1.5) fallMs = left;
    }
    await fall(fallMs);
    land();
}

// Музыка не загрузилась — логотип всё равно качается, как будто играет 120 BPM
function quietSong() {
    const beats = Float64Array.from({ length: 120 }, (_, i) => i * 0.5);
    return { id: null, quiet: true, duration: 60, bpm: 120, beats, strength: new Float32Array(120).fill(0.5), drops: [], startAt: 0 };
}

// ===== 3. Падение: камера смотрит сверху, логотип летит от неё вниз =====

function fall(ms) {
    return new Promise(done => {
        const t0 = performance.now();
        const D0 = 0.1;                         // сначала логотип в 10 раз ближе к камере
        function step(now) {
            const p = Math.min(1, (now - t0) / ms);
            const d = D0 + (1 - D0) * p * p;    // расстояние растёт с ускорением, как при падении
            logoFall.style.opacity = Math.min(1, p * 4);
            logoFall.style.transform = `scale(${(1 / d).toFixed(4)})`;
            if (p < 1) {
                requestAnimationFrame(step);
            } else {
                logoFall.style.transform = '';
                done();
            }
        }
        requestAnimationFrame(step);
    });
}

function land() {
    landedAt = performance.now();
    flipAt = landedAt + nextFlip();
    lastT = song.quiet ? 0 : music.time();
    beatIdx = findBeat(lastT);

    // Отскок от «земли», волны в форме логотипа, вспышка и тряска
    logoFall.animate([
        { transform: 'scale(1)' },
        { transform: 'scale(1.07)', offset: 0.35 },
        { transform: 'scale(0.985)', offset: 0.7 },
        { transform: 'scale(1)' }
    ], { duration: 480, easing: 'ease-out' });
    spawnWave(waves, { fill: true, scale: 1.3, alpha: 0.35, duration: 700 });
    spawnWave(waves, { scale: 1.6, alpha: 0.9, width: 5, duration: 1000 });
    spawnWave(waves, { scale: 1.95, alpha: 0.6, width: 4, duration: 1200, delay: 130 });
    if (!calm) {
        $('flashFull').animate([{ opacity: 0.5 }, { opacity: 0 }], { duration: 600, easing: 'ease-out' });
        shake();
    }

    body.classList.add('is-ready');
    if (song.quiet) toast('Музыка не загрузилась — меню без звука');
    else setTimeout(showNowPlaying, 600);
    requestAnimationFrame(tick);
}

function shake() {
    const frames = [];
    for (let i = 0; i <= 8; i++) {
        const a = 7 * (1 - i / 8);
        const x = ((Math.random() * 2 - 1) * a).toFixed(1);
        const y = ((Math.random() * 2 - 1) * a).toFixed(1);
        frames.push({ transform: `translate(${x}px, ${y}px)` });
    }
    $('menu').animate(frames, { duration: 320 });
}

function showNowPlaying() {
    if (!cur) return;
    $('nowPlayingTitle').textContent = `♪ ${cur.level.artist ? `${cur.level.artist} — ` : ''}${cur.level.title}`;
    $('nowPlaying').classList.add('is-shown');
}

// ===== 4. Логотип прыгает в такт, на дропах — сильнее и с волнами =====

let beatIdx = -1;         // последний бит, который уже прозвучал
let lastT = 0;

function songTime(now) {
    if (song.quiet) return ((now - landedAt) / 1000) % song.duration;
    return music.time();
}

function inDrop(t) {
    for (const [a, b] of song.drops) {
        if (t >= a && t < b) return true;
    }
    return false;
}

// Номер последнего бита не позже t (−1, если битов ещё не было)
function findBeat(t) {
    const b = song.beats;
    let lo = 0, hi = b.length - 1, ans = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (b[mid] <= t) {
            ans = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return ans;
}

const nextFlip = () => FLIP[0] + Math.random() * (FLIP[1] - FLIP[0]);

function onBeat(i) {
    // время пришло — буквы логотипа «переливаются», начиная ровно с бита
    if (flipAt && performance.now() >= flipAt) {
        flipLetters();
        flipAt = performance.now() + nextFlip();
    }
    if (!inDrop(song.beats[i])) return;
    if (performance.now() - landedAt < 600) return;           // только что приземлились — волны уже есть
    const first = i === 0 || !inDrop(song.beats[i - 1]);     // дроп только начался
    spawnWave(waves, first
        ? { scale: 1.8, alpha: 0.9, width: 5, duration: 1100 }
        : { scale: 1.4, alpha: 0.5, width: 3.5, duration: 800 });
    if (calm) return;
    const side = i % 2 ? $('flashRight') : $('flashLeft');
    side.animate([{ opacity: first ? 1 : 0.6 }, { opacity: 0 }], { duration: 650, easing: 'ease-out' });
    if (first) $('flashFull').animate([{ opacity: 0.25 }, { opacity: 0 }], { duration: 500, easing: 'ease-out' });
}

// Логотип плавно тянется в сторону курсора (только мышь; на телефоне стоит на месте)
let aimX = 0, aimY = 0, pullX = 0, pullY = 0, lastFrame = 0;
addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    aimX = e.clientX / innerWidth - 0.5;
    aimY = e.clientY / innerHeight - 0.5;
});
document.documentElement.addEventListener('mouseleave', () => {
    aimX = 0;
    aimY = 0;
});

function tick(now) {
    requestAnimationFrame(tick);
    if (inGame) return;
    const ease = 1 - Math.exp(-Math.min(0.1, (now - (lastFrame || now)) / 1000) * 5);
    lastFrame = now;
    pullX += (aimX - pullX) * ease;
    pullY += (aimY - pullY) * ease;
    logoMove.style.transform = `translate(${(pullX * 2 * PULL * innerWidth).toFixed(1)}px, ${(pullY * 2 * PULL * innerHeight).toFixed(1)}px)`;

    const t = songTime(now);
    if (t == null) return;
    if (autoPlaylist && !song.quiet && t >= song.duration) {
        advancePlaylist();
        return;
    }
    const beats = song.beats;
    if (t < lastT - 0.25 || t > lastT + 1) {
        beatIdx = findBeat(t);                              // песня пошла по кругу или вкладка «спала»
    } else {
        while (beatIdx + 1 < beats.length && beats[beatIdx + 1] <= t) onBeat(++beatIdx);
    }
    lastT = t;

    // Прыжок: резко вверх на бите и плавно обратно до следующего
    let jump = 0;
    if (beatIdx >= 0) {
        const tb = beats[beatIdx];
        const len = beatIdx + 1 < beats.length ? beats[beatIdx + 1] - tb : 0.5;
        const dt = t - tb;
        const amp = (inDrop(tb) ? 0.075 : 0.028) * (0.55 + 0.45 * (song.strength[beatIdx] ?? 0.6));
        jump = amp * (1 - Math.exp(-dt / 0.02)) * Math.exp(-dt / (len * 0.35));
    }
    logoSvg.style.transform = `scale(${(1 + jump).toFixed(4)})`;

    if (playhead && body.classList.contains('is-levels')) {
        playhead.style.left = `${(t / song.duration * 100).toFixed(2)}%`;
    }
}

// ===== 5. Уровни =====

function renderList() {
    renderLevels(levelsList, levels, songOf, {
        open: switchTo,
        play: playLevel,
        share: shareLevel,
        edit: editLevel,
        remove: removeLevel,
        options: () => openOptions(() => markOptions(levelsList, activeOptions()))
    });
    markOptions(levelsList, activeOptions());
    playhead = cur ? headOf(levelsList, cur.level.id) : null;
}

const reloadLevels = async () => {
    levels = [...PRESETS, ...(await userLevels())];
    renderList();
};

function openLevels() {
    body.classList.add('is-levels');
}

function closeLevels() {
    body.classList.remove('is-levels');
    closeDiffs(levelsList);
}

$('logoBtn').addEventListener('click', () => {
    if (!body.classList.contains('is-ready')) return;
    if (body.classList.contains('is-levels')) closeLevels();
    else openLevels();
});
// Esc: сначала закрывает окна, потом сложности, потом список уровней (в уровне — пауза, это в game.js)
addEventListener('keydown', e => {
    if (e.key !== 'Escape' || inGame) return;
    if (!closeCreate() && !closeOptions() && !closeDiffs(levelsList)) closeLevels();
});
addEventListener('resize', () => {
    fitLevels();
    levels.forEach(lv => drawWave(levelsList, lv, songOf(lv)));
});

// На узком экране логотип при открытых уровнях уменьшается до ~1/5 высоты и встаёт сверху,
// а список начинается сразу под ним (на широком это не используется — там логотип слева)
function fitLevels() {
    const h = $('logoBtn').offsetHeight;
    if (!h) return;
    const vh = innerHeight;
    const s = Math.min(0.5, vh * 0.2 / h);
    const top = 24;
    const css = document.documentElement.style;
    css.setProperty('--top-ls', s.toFixed(3));
    css.setProperty('--top-ly', `${(top + h * s / 2 - vh / 2).toFixed(1)}px`);
    css.setProperty('--top-list', `${(top + h * s + 14).toFixed(1)}px`);
}

// Раскрыли уровень — включаем его песню (с того места, где дроп)
async function switchTo(lv, automatic = false) {
    const wasAuto = autoPlaylist;
    autoPlaylist = automatic;
    const my = ++switching;
    if (cur && cur.level.id === lv.id) {
        if (wasAuto && !automatic) menuMusic();
        return;
    }
    const known = songOf(lv);
    updateLevel(levelsList, lv, known, true);
    try {
        const { song: s, buffer } = await loadLevel(lv);
        if (my !== switching) return;
        updateLevel(levelsList, lv, s, false);
        music.fadeOut(0.25);
        await wait(260);
        if (my !== switching || inGame) return;
        music.use(buffer);
        music.muffle(false, 0.01);
        music.play(s.startAt, 0.8, !automatic);
        cur = { level: lv, song: s, buffer };
        song = s;
        lastT = music.time() || s.startAt;
        beatIdx = findBeat(lastT);
        playhead = headOf(levelsList, lv.id);
        showNowPlaying();
    } catch (e) {
        console.warn(e);
        if (automatic) autoPlaylist = false;
        if (my === switching) toast('Песня этого уровня не загрузилась');
        updateLevel(levelsList, lv, known, false);
    }
}

async function advancePlaylist(force = false) {
    if (advancing || (!autoPlaylist && !force)) return;
    advancing = true;
    const choices = levels.filter(lv => !cur || lv.id !== cur.level.id);
    if (!choices.length) {
        menuMusic();
        advancing = false;
        return;
    }
    const next = choices[Math.floor(Math.random() * choices.length)];
    try {
        await switchTo(next, true);
    } finally {
        advancing = false;
    }
}

$('skipTrack').addEventListener('click', () => advancePlaylist(true));

// ===== 6. Уровень: музыка меню затихает, начинается игра; после — обратно в список уровней =====

function playLevel(lv, diff, k) {
    if (inGame) return;
    if (!cur || cur.level.id !== lv.id) {
        toast('Песня ещё загружается — секунду');
        return;
    }
    const chart = chartFor(lv, song, k);
    inGame = true;
    body.classList.add('is-game');
    music.fadeOut(0.35);
    setTimeout(() => startGame({ level: lv, diff, diffIndex: k, song, chart, options: getOptions(), onExit: backToMenu }), 400);
}

// fromResults — пришли с экрана результата: там песня уже играет, её просто перестаём приглушать
function backToMenu(fromResults) {
    inGame = false;
    body.classList.remove('is-game');
    body.classList.add('is-levels');            // возвращаемся именно к списку уровней
    if (fromResults && music.isLooping()) {
        music.muffle(false, 0.8);
    } else {
        menuMusic();
    }
}

// Песня меню — заново с места дропа
function menuMusic() {
    if (!cur) return;
    music.use(cur.buffer);
    music.muffle(false, 0.01);
    music.play(song.startAt, FADE_SEC, !autoPlaylist);
    lastT = music.time() || song.startAt;
    beatIdx = findBeat(lastT);
}

// Списки листаются колесом и перетаскиванием мышью, как в osu
const levelsScroll = dragScroll(levelsList, 'y', { over: 72 });
document.addEventListener('wheel', e => {
    if (!body.classList.contains('is-levels') || body.classList.contains('is-game') || body.classList.contains('is-editor') || e.ctrlKey || levelsList.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.modal, .pause-menu')) return;
    levelsScroll.wheel(e);
}, { passive: false });
dragScroll(document.querySelector('#optionsModal .modal-box'));
dragScroll(document.querySelector('#createModal .modal-box'));

// «Отправить уровень»: скачивается один файл .rhythm со всем уровнем
async function shareLevel(lv) {
    const s = songOf(lv);
    if (!s) {
        toast('Песня ещё загружается — секунду');
        return;
    }
    toast('Собираю файл уровня…');
    try {
        await exportLevel({ level: lv, song: s });
        toast('Готово! Файл .rhythm скачан — его можно отправить');
    } catch (e) {
        console.warn(e);
        toast('Не получилось собрать файл уровня');
    }
}

// ===== 7. Свои уровни: создать, изменить в редакторе, удалить =====

$('createBtn').addEventListener('click', () => openCreate({
    created: onCreated,
    editor: data => enterEditor(data)
}));

const fileDrop = $('fileDrop');
const importHooks = { created: onCreated, editor: data => enterEditor(data) };
let fileDragDepth = 0;
const hasFiles = e => Array.from(e.dataTransfer.types).includes('Files');
const isLevelFile = file => /\.(rhythm|zip)$/i.test(file.name);

document.addEventListener('dragenter', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    fileDragDepth++;
    fileDrop.classList.add('is-on');
});
document.addEventListener('dragover', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    fileDrop.classList.add('is-on');
});
document.addEventListener('dragleave', e => {
    if (!hasFiles(e)) return;
    fileDragDepth = Math.max(0, fileDragDepth - 1);
    if (!fileDragDepth) fileDrop.classList.remove('is-on');
});
document.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    fileDragDepth = 0;
    fileDrop.classList.remove('is-on');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!isLevelFile(file)) {
        toast('Перетащите файл уровня .rhythm');
        return;
    }
    if (inGame) {
        toast('Сначала выйди из игры или редактора');
        return;
    }
    importDroppedFile(file, importHooks);
});

// Новый уровень готов (автоматически или из файла) — он появляется в списке и сразу играет
async function onCreated(rec, buffer, s) {
    remember(rec, buffer, s);
    await reloadLevels();
    openLevel(levelsList, rec.id);
    switchTo(levels.find(lv => lv.id === rec.id) || rec);
}

function editLevel(lv) {
    toast('Открываю редактор…');
    enterEditor({ record: lv });
}

async function enterEditor(opts) {
    if (inGame) return;
    inGame = true;
    switching++;                                 // песня, которая ещё грузилась, уже не нужна
    music.fadeOut(0.3);
    try {
        await openEditor(opts, leaveEditor);
    } catch (e) {
        console.warn(e);
        toast('Не получилось открыть редактор');
        inGame = false;
        menuMusic();
    }
}

// Вышли из редактора; saved — сохранённый уровень (или null, если не сохраняли)
async function leaveEditor(saved) {
    inGame = false;
    body.classList.add('is-levels');
    if (!saved) {
        menuMusic();
        return;
    }
    forget(saved.id);
    await reloadLevels();
    openLevel(levelsList, saved.id);
    if (cur && cur.level.id === saved.id) cur = null;  // песню уровня поменяли — переключаемся заново
    switchTo(levels.find(lv => lv.id === saved.id) || saved);
}

async function removeLevel(lv) {
    const ok = await ask({
        title: `Удалить уровень «${lv.title}»?`,
        text: 'Он удалится из этого браузера насовсем. Чтобы его не потерять, можно сначала нажать «Отправить» и сохранить файл.',
        buttons: [
            { label: 'Удалить', value: true, danger: true },
            { label: 'Отмена', value: null, main: true }
        ]
    });
    if (!ok) return;
    try {
        await deleteLevel(lv.id);
    } catch (e) {
        console.warn(e);
        toast('Не получилось удалить');
        return;
    }
    forget(lv.id);
    await reloadLevels();
    toast('Уровень удалён');
    if (cur && cur.level.id === lv.id) {
        cur = null;
        switchTo(PRESETS[Math.floor(Math.random() * PRESETS.length)]);
    }
}
