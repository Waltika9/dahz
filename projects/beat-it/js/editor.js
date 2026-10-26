// Редактор уровня: всё, что есть в уровне, можно сделать вручную.
// Сверху — сложности и кнопки; в середине — поле как в игре (на нём же выбирается, откуда летят ноты);
// справа — настройки по вкладкам; снизу — управление песней, лента времени и вся песня целиком.
// Ноты: ставить мышью, расставить автоматически или «записать» — играет песня, нажатия в такт добавляют ноты

import * as music from './music.js?v=6';
import * as sfx from './sfx.js?v=3';
import { analyzeTrack } from './analyze.js?v=3';
import { makeChart, restyle, SHAPES, APPROACH } from './chart.js?v=2';
import { TAU, DEG, fitGeo, drawNotes, placeNote, holdAngle, shapePath } from './field.js?v=3';
import { Backdrop, bgForm } from './bg.js?v=2';
import { FX_TYPES } from './fx.js?v=3';
import { timeline, lowerBound, capture } from './timeline.js?v=4';
import { DIFFS, diffIcon } from './menu.js?v=7';
import { songToStore } from './library.js?v=3';
import { saveLevel, newId } from './store.js?v=1';
import { startGame } from './game.js?v=10';
import { getOptions } from './options.js?v=2';
import { ask, isAsking } from './dialog.js?v=1';
import { dragScroll } from './scroll.js?v=4';
import { esc, clamp, clock, toast, mulberry32 } from './util.js?v=1';

const $ = id => document.getElementById(id);
const root = $('editor');
const stage = $('edStage');
const field = $('edField');
const fc = field.getContext('2d');
const panel = $('edPanel');
const bgPanel = $('edBgPanel');
const backdrop = new Backdrop($('edBg'));

const SHAPE_NAMES = { circle: 'Круг', square: 'Квадрат', triangle: 'Треугольник', diamond: 'Ромб', hex: 'Шестиугольник', star: 'Звезда' };
const SHAPE_SVG = {
    circle: '<circle cx="12" cy="12" r="7"/>',
    square: '<rect x="5.5" y="5.5" width="13" height="13" rx="1.5"/>',
    triangle: '<path d="M12 4.5 20 18.5H4z"/>',
    diamond: '<path d="M12 3.5 17.5 12 12 20.5 6.5 12z"/>',
    hex: '<path d="M4.5 12 8.3 5.5h7.4l3.8 6.5-3.8 6.5H8.3z"/>',
    star: '<path d="M12 3.5l2.2 5.6 5.9.3-4.6 3.7 1.6 5.8L12 15.6l-5.1 3.3 1.6-5.8-4.6-3.7 5.9-.3z"/>'
};
const PATTERNS = [['spin', 'По кругу'], ['alt', 'Туда-обратно'], ['cross', 'Крестом'], ['zigzag', 'Змейкой'], ['stream', 'Потоком'], ['random', 'Случайно']];
const SNAPS = [[0, 'Нет'], [1, '1/1'], [2, '1/2'], [3, '1/3'], [4, '1/4'], [8, '1/8']];
const SPEEDS = [[1, '1×'], [0.75, '¾×'], [0.5, '½×']];
const TOOLS = [['select', 'Выбор', '1'], ['tap', 'Нота', '2'], ['hold', 'Длинная', '3']];
const ICON = {
    start: '<svg viewBox="0 0 24 24"><path d="M6 5v14M18 5.5 9 12l9 6.5z"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13L18.5 12z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M8.5 6v12M15.5 6v12"/></svg>',
    minus: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M6 12h12M12 6v12"/></svg>'
};

let E = null;               // всё про открытый уровень (null — редактор закрыт)
let onClose = () => {};
let raf = 0;
let line = null;            // лента времени
let bgf = null;             // выбор фона
let dpr = 1;
const geo = { W: 0, H: 0, cx: 0, cy: 0, rc: 30, far: 300 };

// ===== Открыть и закрыть =====

// opts: { record } — изменить свой уровень; или { file, title, artist, buffer?, song? } — новый уровень из песни.
// close(сохранённый уровень или null) — когда редактор закрыли
export async function openEditor(opts, close) {
    onClose = close || (() => {});
    const rec = opts.record || null;
    let buffer = opts.buffer;
    let song = opts.song;
    if (!buffer) buffer = await music.decode(await (rec ? rec.audio : opts.file).arrayBuffer());
    if (!song || !song.onset) song = analyzeTrack(buffer);

    E = {
        open: true, testing: false,
        id: rec ? rec.id : newId(),
        created: rec ? rec.created : Date.now(),
        title: rec ? rec.title : opts.title || 'Без названия',
        artist: rec ? rec.artist : opts.artist || '',
        audio: rec ? rec.audio : opts.file,
        audioName: rec ? rec.audioName : opts.file.name,
        bg: rec ? rec.bg : null,
        buffer, song,
        grid: rec && rec.grid ? { ...rec.grid } : { mode: 'auto', bpm: Math.round(song.bpm * 10) / 10, offset: Math.round((song.beats[0] || 0) * 1000) / 1000 },
        fileBeats: rec && rec.song && (!rec.grid || rec.grid.mode !== 'manual') ? Array.from(rec.song.beats) : null,
        fileStrength: rec && rec.song ? Array.from(rec.song.strength || []) : null,
        drops: (rec && rec.song ? rec.song.drops : song.drops).map(d => [...d]),
        beats: [], strength: [], bar0: 0,
        diffs: DIFFS.map((_, k) => {
            const d = rec && rec.diffs && rec.diffs.find(x => x.k === k);
            return { approach: d ? d.approach : APPROACH[k], notes: d ? d.notes.map(n => ({ ...n })).sort((a, b) => a.t - b.t) : [] };
        }),
        effects: Array.isArray(rec && rec.effects) ? rec.effects.map(f => ({ ...f, id: f.id || newId() })).sort((a, b) => a.t - b.t) : [],
        fxMode: ['auto', 'mix', 'manual'].includes(rec && rec.fxMode) ? rec.fxMode : 'auto',
        activeFxId: null,
        k: 0,
        sel: new Set(),
        tool: 'select', snap: 2, speed: 1, zoom: 240,
        t: 0, lastT: 0, playing: false,
        recording: null, recSnap: true, recFlash: -9,
        style: { shape: 'circle', dir: 'spin' },     // какими ставить новые ноты
        metro: false, clicks: true,
        undo: [], redo: [], dirty: !rec, saved: null,
        tab: 'note', aim: null, variant: 0, live: false, taps: []
    };
    const firstFull = E.diffs.findIndex(d => d.notes.length);
    E.k = firstFull >= 0 ? firstFull : 0;
    applyGrid();

    document.body.classList.add('is-editor');
    root.classList.add('is-on');
    if (!line) line = timeline($('edLine'), $('edOver'), ed);
    line.center(E.t);
    backdrop.set(E.bg);
    bgf = bgForm(bgPanel, {
        value: E.bg,
        duration: song.duration,
        onChange: bg => {
            E.bg = bg;
            backdrop.set(bg);
            E.dirty = true;
            renderTop();
        },
        onError: toast
    });
    resize();
    renderAll();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
}

function closeEditor() {
    pause();
    E.open = false;
    cancelAnimationFrame(raf);
    backdrop.clear();
    if (bgf) bgf.destroy();
    root.classList.remove('is-on', 'is-rec');
    document.body.classList.remove('is-editor');
    const saved = E.saved;
    E = null;
    onClose(saved);
}

async function exit() {
    if (E.dirty) {
        const v = await ask({
            title: 'Выйти из редактора?',
            text: 'Есть несохранённые изменения — без сохранения они пропадут.',
            buttons: [
                { label: 'Сохранить и выйти', value: 'save', main: true },
                { label: 'Выйти без сохранения', value: 'drop', danger: true },
                { label: 'Отмена', value: null }
            ]
        });
        if (!v || !E) return;
        if (v === 'save' && !(await save())) return;
    }
    closeEditor();
}

// ===== Сетка битов =====

// Биты: найденные игрой (или из файла уровня) или ровные — по темпу и первому биту
function applyGrid() {
    const g = E.grid;
    if (g.mode === 'manual') {
        const p = 60 / g.bpm;
        const first = g.offset - Math.floor(g.offset / p) * p;
        const beats = [];
        for (let t = first; t < E.song.duration; t += p) beats.push(t);
        E.beats = Float64Array.from(beats);
        E.bar0 = Math.round((g.offset - first) / p) % 4;
        E.strength = strengthFor(E.beats);
    } else if (E.fileBeats) {
        E.beats = Float64Array.from(E.fileBeats);
        E.bar0 = 0;
        E.strength = E.fileStrength && E.fileStrength.length === E.beats.length ? Float32Array.from(E.fileStrength) : strengthFor(E.beats);
    } else {
        E.beats = E.song.beats;
        E.bar0 = 0;
        E.strength = E.song.strength;
    }
}

// Сила битов по «ударам» песни (для эффектов и автоматической расстановки)
function strengthFor(beats) {
    const { onset, fps } = E.song;
    const raw = Array.from(beats, t => {
        const f = Math.round(t * fps - 0.5);
        let m = 0;
        for (let d = -2; d <= 2; d++) m = Math.max(m, onset[f + d] || 0);
        return m;
    });
    const top = [...raw].sort((a, b) => a - b)[Math.floor(raw.length * 0.9)] || 1;
    return Float32Array.from(raw, v => Math.min(1, v / top));
}

const isBar = i => (((i - E.bar0) % 4) + 4) % 4 === 0;
const inDrop = t => E.drops.some(([a, b]) => t >= a && t < b);

// Бит, внутри которого время t: [начало, длина] (до первого и после последнего бита — продолжаем ровно)
function segment(t) {
    const b = E.beats, n = b.length;
    if (n < 2) return [Math.floor(t * 2) / 2, 0.5];
    const i = lowerBound(b, t + 1e-9) - 1;
    if (i < 0) {
        const len = b[1] - b[0];
        return [b[0] - Math.ceil((b[0] - t) / len) * len, len];
    }
    if (i >= n - 1) {
        const len = b[n - 1] - b[n - 2];
        return [b[n - 1] + Math.floor((t - b[n - 1]) / len) * len, len];
    }
    return [b[i], b[i + 1] - b[i]];
}

// Привязать время к сетке (1/2 — к половинкам битов и т. д.)
function snapT(t) {
    if (!E.snap) return Math.max(0, t);
    const [a, len] = segment(t);
    const s = len / E.snap;
    return Math.max(0, a + Math.round((t - a) / s) * s);
}

const step = t => segment(t)[1] / (E.snap || 4);
const beatLen = t => segment(t)[1];
const gridBpm = () => {
    if (E.grid.mode === 'manual') return E.grid.bpm;
    const b = E.beats;
    const steps = [];
    for (let i = 1; i < b.length; i++) steps.push(b[i] - b[i - 1]);
    steps.sort((x, y) => x - y);
    return steps.length ? 60 / steps[steps.length >> 1] : E.song.bpm;
};

// ===== Ноты и отмена =====

const notes = () => E.diffs[E.k].notes;
const sortNotes = () => notes().sort((a, b) => a.t - b.t);
const norm = a => Math.round((((a % 360) + 360) % 360) * 10) / 10;

// Откуда полетит новая нота: по кругу от прошлой (+45°), случайно или так же
function nextAngle(t) {
    const list = notes();
    const i = lowerBound(list.map(n => n.t), t) - 1;
    const prev = i >= 0 ? list[i] : null;
    if (E.style.dir === 'random') return Math.floor(Math.random() * 24) * 15;
    if (!prev) return 270;                               // первая — сверху
    return E.style.dir === 'same' ? prev.angle : norm(prev.angle + 45);
}

const nextShape = () => (E.style.shape === 'random' ? SHAPES[Math.floor(Math.random() * SHAPES.length)] : E.style.shape);

function addNote(t, type) {
    const n = { t, type: 'tap', angle: nextAngle(t), shape: nextShape(), size: 1 };
    if (type === 'hold') makeHold(n, Math.min(E.song.duration, t + beatLen(t)));
    notes().push(n);
    sortNotes();
    return n;
}

function makeHold(n, end) {
    Object.assign(n, { type: 'hold', end, twist: n.twist || 0, wiggle: n.wiggle || 0, waves: n.waves || 2 });
    delete n.twin;
}

function makeTap(n) {
    n.type = 'tap';
    delete n.end;
    delete n.twist;
    delete n.wiggle;
    delete n.waves;
}

const snapshot = () => JSON.stringify({ diffs: E.diffs, effects: E.effects, fxMode: E.fxMode, drops: E.drops, grid: E.grid, fileBeats: E.fileBeats });

// Запомнить, как было, — перед любым изменением (для Ctrl+Z)
function commit() {
    E.undo.push(snapshot());
    if (E.undo.length > 150) E.undo.shift();
    E.redo = [];
    E.dirty = true;
}

function restore(s) {
    const o = JSON.parse(s);
    const picked = [...E.sel].map(n => notes().indexOf(n));   // выбор остаётся на тех же местах
    E.diffs = o.diffs;
    E.effects = o.effects || [];
    E.fxMode = o.fxMode || 'auto';
    if (!E.effects.some(fx => fx.id === E.activeFxId)) E.activeFxId = null;
    E.drops = o.drops;
    E.grid = o.grid;
    E.fileBeats = o.fileBeats;
    applyGrid();
    E.sel = new Set(picked.map(i => notes()[i]).filter(Boolean));
    E.dirty = true;
    renderAll();
}

function undo() {
    if (!E.undo.length) return toast('Отменять нечего');
    E.redo.push(snapshot());
    restore(E.undo.pop());
}

function redo() {
    if (!E.redo.length) return toast('Возвращать нечего');
    E.undo.push(snapshot());
    restore(E.redo.pop());
}

// Ноты поменялись. live — прямо сейчас тянут мышью: только перерисовать
function changed(live = false) {
    E.dirty = true;
    if (live) return;
    sortNotes();
    renderTop();
    if (E.tab === 'note' || E.tab === 'make' || E.tab === 'level' || E.tab === 'fx') renderPanel();
}

function select(live = false) {
    if (live) return;
    if (E.tab !== 'note' && E.sel.size) setTab('note');
    else if (E.tab === 'note') renderPanel();
}

function remove(list) {
    const kill = new Set(list);
    E.diffs[E.k].notes = notes().filter(n => !kill.has(n));
    for (const n of kill) E.sel.delete(n);
    changed();
}

function quantize(list) {
    if (!E.snap) return toast('Сначала выберите деление сетки внизу');
    if (!list.length) return;
    commit();
    for (const n of list) {
        const delta = snapT(n.t) - n.t;
        n.t += delta;
        if (n.type === 'hold') n.end = clamp(n.end + delta, n.t + step(n.t), E.song.duration);
    }
    sortNotes();
    changed();
}

// Всё, что нужно ленте времени
const ed = {
    get E() {
        return E;
    },
    notes, seek, snapT, step, isBar, addNote, commit, changed, select, remove,
    openEffect: (fx, move = true) => {
        E.activeFxId = fx.id;
        E.tab = 'fx';
        if (move) seek(fx.t);
        renderPanel();
        const row = panel.querySelector('.fx-row.is-active');
        if (row) {
            const rowRect = row.getBoundingClientRect();
            const panelRect = panel.getBoundingClientRect();
            if (rowRect.top < panelRect.top) panel.scrollTop -= panelRect.top - rowRect.top;
            else if (rowRect.bottom > panelRect.bottom) panel.scrollTop += rowRect.bottom - panelRect.bottom;
        }
    },
    zoom: z => {
        E.zoom = clamp(z, 40, 1600);
    }
};

// ===== Песня: играть, пауза, перемотка =====

function play() {
    if (E.playing) return;
    if (E.t >= E.song.duration - 0.05) E.t = 0;
    music.use(E.buffer);
    music.muffle(false, 0.01);
    music.playOnce(0.06, E.t, E.speed);
    E.playing = true;
    E.lastT = E.t;
    syncBar();
}

function pause() {
    if (!E || !E.playing) return;
    const t = music.time();
    music.stop();
    backdrop.pause();
    E.playing = false;
    if (t != null) E.t = clamp(t, 0, E.song.duration);
    if (E.recording) stopRecord();
    syncBar();
}

const togglePlay = () => (E.playing ? pause() : play());

function seek(t, center = true) {
    t = clamp(t, 0, E.song.duration);
    E.t = t;
    E.lastT = t;
    if (line) {
        if (center) line.center(t);
        else line.pauseFollow();
    }
    if (E.playing) music.playOnce(0.03, t, E.speed);
}

// Щелчки нот и метроном между прошлым кадром и этим
function sounds(a, b) {
    if (b <= a || b - a > 0.5) return;
    if (E.clicks) {
        const list = notes();
        for (let i = lowerBound(list.map(n => n.t), a + 1e-6); i < list.length && list[i].t <= b; i++) sfx.click(0);
        for (const n of list) if (n.type === 'hold' && n.end > a && n.end <= b) sfx.soft();
    }
    if (E.metro) {
        for (let i = lowerBound(E.beats, a + 1e-6); i < E.beats.length && E.beats[i] <= b; i++) sfx.tick(isBar(i));
    }
}

// ===== Запись: песня играет, а каждое нажатие ставит ноту =====

function startRecord() {
    if (E.recording) {
        stopRecord();
        return;
    }
    commit();
    E.recording = { keys: new Map(), added: [] };
    E.sel.clear();
    root.classList.add('is-rec');
    if (document.activeElement) document.activeElement.blur();
    if (!E.playing) play();
    syncBar();
    renderPanel();
}

function stopRecord() {
    const r = E.recording;
    if (!r) return;
    E.recording = null;
    root.classList.remove('is-rec');
    if (E.playing) pause();
    if (!r.added.length) E.undo.pop();
    E.sel = new Set(r.added.filter(n => notes().includes(n)));
    toast(r.added.length ? `Записано нот: ${r.added.length}. Их можно сразу поправить` : 'Ни одной ноты не записалось');
    syncBar();
    changed();
    setTab('note');
}

function recDown(id) {
    const r = E.recording;
    if (!r || !E.playing || r.keys.has(id)) return;
    const raw = music.time();
    if (raw == null || raw < 0) return;
    const t = E.recSnap ? snapT(raw) : raw;
    E.recFlash = performance.now();
    if (notes().some(n => Math.abs(n.t - t) < 0.04)) {
        r.keys.set(id, null);                         // здесь нота уже есть
        return;
    }
    const n = addNote(t, 'tap');
    r.added.push(n);
    r.keys.set(id, { raw, n });
    E.dirty = true;
}

// Отпустил: держал дольше ~полбита — получилась длинная нота
function recUp(id) {
    const r = E.recording;
    if (!r || !r.keys.has(id)) return;
    const k = r.keys.get(id);
    r.keys.delete(id);
    if (!k) return;
    const raw = music.time();
    if (raw == null) return;
    if (raw - k.raw >= Math.max(0.22, beatLen(k.n.t) * 0.6)) {
        const end = E.recSnap ? Math.max(snapT(raw), k.n.t + step(k.n.t)) : raw;
        makeHold(k.n, Math.min(E.song.duration, end));
    }
}

// ===== Кадр: поле, лента, время =====

function frame() {
    if (!E || !E.open) return;
    raf = requestAnimationFrame(frame);
    if (E.testing) return;
    if (E.playing) {
        const t = music.time();
        if (t != null) {
            sounds(E.lastT, t);
            E.lastT = t;
            E.t = clamp(t, 0, E.song.duration);
            if (t >= E.song.duration) {
                pause();
                E.t = E.song.duration;
            }
        }
    }
    backdrop.sync(E.t, E.playing, E.speed);
    drawField();
    line.draw();
    $('edTime').textContent = `${fmt(E.t)} / ${clock(E.song.duration)}`;
}

// 1:23.456
const fmt = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;

function resize() {
    if (!E) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = stage.clientWidth, H = stage.clientHeight;
    field.width = Math.round(W * dpr);
    field.height = Math.round(H * dpr);
    fitGeo(geo, W, H, 16);
    line.resize();
}

addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);

// Поле как в игре. Уже прошедшие ноты — как будто их отбили (как в «Авто»)
function drawField() {
    const { W, H, cx, cy, rc } = geo;
    const c = fc;
    const t = E.t;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.globalAlpha = 1;
    if (backdrop.bg) {
        c.clearRect(0, 0, W, H);
        c.fillStyle = `rgba(0, 0, 0, ${backdrop.shade(t).toFixed(3)})`;
    } else {
        c.fillStyle = '#000';
    }
    c.fillRect(0, 0, W, H);

    const d = E.diffs[E.k];
    const v = { ctx: c, geo, approach: d.approach, hidden: false };
    const list = d.notes;
    let s = lowerBound(list.map(n => n.t), t - 0.6);
    while (s > 0 && (list[s - 1].end || 0) > t - 0.6) s--;
    const vis = [];
    for (let k = s; k < list.length && list[k].t <= t + d.approach; k++) {
        const n = list[k];
        if (n.type === 'hold') {
            if (t >= n.end) vis.push({ ...n, result: 'hit', hitAt: n.end, hitA: holdAngle(n, n.end) });
            else vis.push(t >= n.t ? { ...n, state: 1 } : n);
        } else {
            vis.push(t >= n.t ? { ...n, result: 'hit', hitAt: n.t, hitR: rc, hitA: n.angle * DEG, hitS: 1, kick: 0.25 } : n);
        }
    }
    drawNotes(v, vis, 0, t);

    // круг: «дышит» на битах, пока играет; в записи — вспыхивает на нажатии
    const bi = lowerBound(E.beats, t + 1e-6) - 1;
    const bump = E.playing && bi >= 0 ? Math.exp(-(t - E.beats[bi]) * 9) : 0;
    const r = rc * (1 + bump * (inDrop(E.beats[bi]) ? 0.13 : 0.06));
    const flash = Math.max(0, 1 - (performance.now() - E.recFlash) / 160);
    if (flash > 0 || (E.recording && E.recording.keys.size)) {
        c.globalAlpha = E.recording && E.recording.keys.size ? 1 : flash;
        c.fillStyle = '#fff';
        c.beginPath();
        c.arc(cx, cy, r * 0.9, 0, TAU);
        c.fill();
        c.globalAlpha = 1;
    }
    c.lineWidth = Math.max(3, rc * 0.13);
    c.strokeStyle = '#fff';
    c.beginPath();
    c.arc(cx, cy, r, 0, TAU);
    c.stroke();

    // выбранные ноты: пунктир — откуда прилетят, и кружок вокруг, если нота сейчас на поле
    const len = Math.min(W, H) * 0.44;
    for (const n of E.sel) {
        const a = n.angle * DEG;
        const dirs = n.twin && n.type === 'tap' ? [a, a + Math.PI] : [a];
        for (const da of dirs) {
            c.globalAlpha = 0.6;
            c.strokeStyle = '#fff';
            c.lineWidth = 2;
            c.setLineDash([6, 6]);
            c.beginPath();
            c.moveTo(cx + Math.cos(da) * rc * 1.3, cy + Math.sin(da) * rc * 1.3);
            c.lineTo(cx + Math.cos(da) * len, cy + Math.sin(da) * len);
            c.stroke();
            c.setLineDash([]);
            c.save();
            c.translate(cx + Math.cos(da) * len, cy + Math.sin(da) * len);
            shapePath(c, n.shape, rc * 0.3 * (n.size || 1));
            c.globalAlpha = 0.55;
            c.fillStyle = '#fff';
            c.fill();
            c.restore();
        }
        const p = t <= n.t ? placeNote(v, n, t) : null;
        if (p && p.alpha > 0.05) {
            c.globalAlpha = 1;
            c.lineWidth = 2;
            c.beginPath();
            c.arc(cx + Math.cos(p.a) * p.r, cy + Math.sin(p.a) * p.r, rc * 0.42 * (n.size || 1) + 9, 0, TAU);
            c.stroke();
        }
    }
    c.globalAlpha = 1;
}

// ===== Поле: тянешь мышью вокруг круга — выбираешь, откуда летят выбранные ноты =====

stage.addEventListener('pointerdown', e => {
    if (!E || E.testing) return;
    if (E.recording) {
        e.preventDefault();
        recDown(`p${e.pointerId}`);
        return;
    }
    if (!E.sel.size) return;
    e.preventDefault();
    capture(stage, e);
    commit();
    const sel = [...E.sel].sort((a, b) => a.t - b.t);
    E.aim = { orig: sel.map(n => [n, n.angle]) };
    aim(e);
});

stage.addEventListener('pointermove', e => {
    if (E && E.aim) aim(e);
});

function aim(e) {
    const r = stage.getBoundingClientRect();
    let a = Math.atan2(e.clientY - r.top - geo.cy, e.clientX - r.left - geo.cx) / DEG;
    if (!e.shiftKey) a = Math.round(a / 15) * 15;             // шаг 15°, с Shift — точно
    // первая из выбранных смотрит на курсор, остальные поворачиваются вместе с ней
    const delta = a - E.aim.orig[0][1];
    for (const [n, base] of E.aim.orig) n.angle = norm(base + delta);
    E.dirty = true;
}

const aimEnd = () => {
    if (!E || !E.aim) return;
    E.aim = null;
    changed();
};
stage.addEventListener('pointerup', aimEnd);
stage.addEventListener('pointercancel', aimEnd);
addEventListener('pointerup', e => {
    if (E && E.recording) recUp(`p${e.pointerId}`);
});
stage.addEventListener('contextmenu', e => e.preventDefault());

// ===== Верх: название, сложности, отмена, проверка, сохранение =====

function renderTop() {
    $('edName').innerHTML = `<b>${esc(E.title || 'Без названия')}</b><span>${esc(E.artist || '')}</span>`;
    $('edDiffs').innerHTML = DIFFS.map((d, k) => `
        <button class="ed-diff${k === E.k ? ' is-on' : ''}${E.diffs[k].notes.length ? '' : ' is-empty'}" type="button" data-k="${k}" title="${d.name}: ${E.diffs[k].notes.length} нот">
            ${diffIcon(d.icon)}<span>${E.diffs[k].notes.length}</span>
        </button>`).join('');
    $('edUndo').disabled = !E.undo.length;
    $('edRedo').disabled = !E.redo.length;
}

$('edDiffs').addEventListener('click', e => {
    const b = e.target.closest('[data-k]');
    if (!b || !E) return;
    setDiff(Number(b.dataset.k));
});

function setDiff(k) {
    if (E.recording) stopRecord();
    E.k = k;
    E.sel.clear();
    renderAll();
}

$('edExit').addEventListener('click', () => exit());
$('edUndo').addEventListener('click', () => undo());
$('edRedo').addEventListener('click', () => redo());
$('edSave').addEventListener('click', () => save());
$('edTest').addEventListener('click', () => test());

// ===== Низ: песня, скорость, инструмент, сетка, масштаб, запись =====

function renderBar() {
    $('edBar').innerHTML = `
        <div class="ed-group">
            <button class="ed-btn is-icon" type="button" data-act="start" title="В начало (Home)">${ICON.start}</button>
            <button class="ed-btn is-icon is-play" type="button" data-act="play" title="Играть / пауза (пробел)">${ICON.play}</button>
            <span class="ed-time" id="edTime"></span>
        </div>
        <div class="ed-group" title="Скорость песни"><span class="ed-label">Скорость</span>
            ${SPEEDS.map(([v, l]) => `<button class="seg-btn" type="button" data-speed="${v}">${l}</button>`).join('')}</div>
        <div class="ed-group"><span class="ed-label">Инструмент</span>
            ${TOOLS.map(([v, l, key]) => `<button class="seg-btn" type="button" data-tool="${v}" title="Инструмент «${l}» (клавиша ${key})">${l}</button>`).join('')}</div>
        <div class="ed-group" title="Сетка: к каким долям бита привязываются ноты"><span class="ed-label">Сетка</span>
            ${SNAPS.map(([v, l]) => `<button class="seg-btn" type="button" data-snap="${v}">${l}</button>`).join('')}</div>
        <div class="ed-group">
            <button class="ed-btn is-icon" type="button" data-act="zoom-out" title="Мельче (Ctrl + колесо)">${ICON.minus}</button>
            <button class="ed-btn is-icon" type="button" data-act="zoom-in" title="Крупнее (Ctrl + колесо)">${ICON.plus}</button>
        </div>
        <button class="ed-btn rec-btn" type="button" data-act="record"><i></i><span>Запись</span></button>`;
}
renderBar();

function syncBar() {
    if (!E) return;
    const bar = $('edBar');
    bar.querySelector('.is-play').innerHTML = E.playing ? ICON.pause : ICON.play;
    bar.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('is-on', Number(b.dataset.speed) === E.speed));
    bar.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('is-on', b.dataset.tool === E.tool));
    bar.querySelectorAll('[data-snap]').forEach(b => b.classList.toggle('is-on', Number(b.dataset.snap) === E.snap));
    bar.querySelector('.rec-btn span').textContent = E.recording ? 'Стоп' : 'Запись';
    bar.querySelector('.rec-btn').classList.toggle('is-on', !!E.recording);
}

$('edBar').addEventListener('click', e => {
    if (!E) return;
    const b = e.target.closest('button');
    if (!b) return;
    b.blur();
    if (b.dataset.speed) {
        E.speed = Number(b.dataset.speed);
        if (E.playing) {
            pause();
            play();
        }
    } else if (b.dataset.tool) {
        E.tool = b.dataset.tool;
    } else if (b.dataset.snap != null) {
        E.snap = Number(b.dataset.snap);
    } else {
        const act = b.dataset.act;
        if (act === 'play') togglePlay();
        if (act === 'start') seek(0);
        if (act === 'zoom-in') ed.zoom(E.zoom * 1.4);
        if (act === 'zoom-out') ed.zoom(E.zoom / 1.4);
        if (act === 'record') startRecord();
    }
    syncBar();
});

// ===== Вкладки справа =====

const TABS = [['note', 'Нота'], ['make', 'Создать'], ['beat', 'Бит'], ['fx', 'Эффекты'], ['bg', 'Фон'], ['level', 'Уровень']];
$('edTabs').innerHTML = TABS.map(([id, name]) => `<button type="button" data-tab="${id}">${name}</button>`).join('');
$('edTabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (b && E) setTab(b.dataset.tab);
});

function setTab(id) {
    E.tab = id;
    renderPanel();
}

function renderAll() {
    renderTop();
    syncBar();
    renderPanel();
}

function renderPanel() {
    $('edTabs').querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('is-on', b.dataset.tab === E.tab));
    const bg = E.tab === 'bg';
    bgPanel.hidden = !bg;
    panel.hidden = bg;
    if (bg) return;
    const sameTab = panel.dataset.tab === E.tab;
    const scrollTop = sameTab ? panel.scrollTop : 0;
    const html = { note: notePanel, make: makePanel, beat: beatPanel, fx: effectsPanel, level: levelPanel }[E.tab]();
    panel.innerHTML = html;
    panel.dataset.tab = E.tab;
    panel.scrollTop = scrollTop;
    drawDial();
}

const seg = (items, cur, attr) => `<div class="seg">${items.map(([v, l]) =>
    `<button type="button" data-${attr}="${v}"${String(v) === String(cur) ? ' class="is-on"' : ''}>${l}</button>`).join('')}</div>`;
const shapeBtn = (s, on, attr) => `<button class="shape-btn${on ? ' is-on' : ''}" type="button" data-${attr}="${s}" title="${SHAPE_NAMES[s]}"><svg viewBox="0 0 24 24">${SHAPE_SVG[s]}</svg></button>`;
const toggle = (act, on, label) => `<button class="tgl${on ? ' is-on' : on === null ? ' is-mixed' : ''}" type="button" data-act="${act}"><span class="switch"><i></i></span>${label}</button>`;
const range = (name, val, min, max, stp, label) => `<label class="field"><span>${label}</span><input class="range" type="range" data-field="${name}" min="${min}" max="${max}" step="${stp}" value="${val}"></label>`;

// Вкладка «Нота»: всё про выбранные ноты (или какими ставить новые)
function notePanel() {
    const sel = [...E.sel].sort((a, b) => a.t - b.t);
    if (!sel.length) {
        return `
            <h3>Ничего не выбрано</h3>
            <p class="ed-tip">Нажмите на ноту на ленте снизу. Shift — выбор нескольких, рамка по пустому месту — выбор сразу нескольких, Ctrl+A — выбор всех.</p>
            <h4>Новые ноты</h4>
            <div class="shape-row">${SHAPES.map(s => shapeBtn(s, E.style.shape === s, 'style-shape')).join('')}
                <button class="shape-btn is-text${E.style.shape === 'random' ? ' is-on' : ''}" type="button" data-style-shape="random">Случайная</button></div>
            <span class="ed-label">Откуда летят</span>
            ${seg([['spin', 'По кругу'], ['random', 'Случайно'], ['same', 'Как прошлая']], E.style.dir, 'style-dir')}
            <h4>Клавиши</h4>
            <ul class="ed-keys">
                <li><b>Пробел</b> играть / пауза</li>
                <li><b>1 2 3</b> выбор, нота, длинная</li>
                <li><b>← →</b> на деление сетки (Shift — на такт)</li>
                <li><b>Delete</b> удалить выбранные</li>
                <li><b>Ctrl+C / V</b> копировать / вставить сюда</li>
                <li><b>Ctrl+Z / Y</b> отменить / вернуть</li>
                <li><b>Ctrl+S</b> сохранить</li>
                <li><b>Правый клик</b> по ноте — удалить</li>
            </ul>`;
    }
    const all = f => sel.every(f);
    const some = f => sel.some(f);
    const tri = f => (all(f) ? true : some(f) ? null : false);
    const type = all(n => n.type === 'tap') ? 'tap' : all(n => n.type === 'hold') ? 'hold' : '';
    const shape = all(n => n.shape === sel[0].shape) ? sel[0].shape : '';
    const size = sel.reduce((s, n) => s + (n.size || 1), 0) / sel.length;
    const holds = sel.filter(n => n.type === 'hold');
    const first = sel[0];
    let holdHtml = '';
    if (holds.length) {
        const h = holds[0];
        const form = h.twist ? 'spiral' : h.wiggle ? 'wave' : 'line';
        holdHtml = `
            <h4>Длинная нота${holds.length > 1 ? ` (${holds.length})` : ''}</h4>
            <span class="ed-label">Форма линии</span>
            ${seg([['line', 'Прямая'], ['spiral', 'Спираль'], ['wave', 'Волна']], form, 'form')}
            ${form === 'spiral' ? range('twist', h.twist, -2, 2, 0.05, `Закрутка: <b data-out="twist">${twistText(h.twist)}</b>`) : ''}
            ${form === 'wave' ? range('wiggle', h.wiggle, 0.05, 0.8, 0.01, `Размах волны: <b data-out="wiggle">${Math.round(h.wiggle * 100)}</b>`)
                + range('waves', h.waves || 1, 1, 6, 1, `Сколько волн: <b data-out="waves">${h.waves || 1}</b>`) : ''}
            <span class="ed-label">Длина: <b>${(h.end - h.t).toFixed(2).replace('.', ',')} с</b> — или перетащите конец ноты на ленте</span>
            <div class="seg"><button type="button" data-act="len" data-v="-1">Короче</button><button type="button" data-act="len" data-v="1">Длиннее</button></div>`;
    }
    return `
        <div class="ed-head-row"><h3>Выбрано: ${sel.length}</h3>
            <button class="mini-btn" type="button" data-act="unsel">Снять</button>
            <button class="mini-btn is-danger" type="button" data-act="del">Удалить</button></div>
        <p class="ed-tip">${sel.length === 1 ? `Нота на ${fmt(first.t)}` : `С ${fmt(first.t)} по ${fmt(sel[sel.length - 1].t)}`}</p>
        <button class="mini-btn" type="button" data-act="quantize-sel"${E.snap ? '' : ' disabled'}>Привязать к сетке ${E.snap ? `1/${E.snap}` : ''}</button>
        <span class="ed-label">Тип</span>
        ${seg([['tap', 'Обычная'], ['hold', 'Длинная']], type, 'type')}
        <span class="ed-label">Фигура</span>
        <div class="shape-row">${SHAPES.map(s => shapeBtn(s, shape === s, 'shape')).join('')}
            <button class="shape-btn is-text" type="button" data-act="shape-rand">Случайные</button></div>
        <div class="tgl-row">
            ${toggle('hollow', tri(n => n.hollow), 'Пустая внутри')}
            ${toggle('twin', tri(n => n.twin), 'С двух сторон')}
        </div>
        ${range('size', size.toFixed(2), 0.6, 1.5, 0.05, `Размер: <b data-out="size">${Math.round(size * 100)} %</b>`)}
        <h4>Откуда летит</h4>
        <div class="dial-row">
            <svg class="dial no-drag" id="edDial" viewBox="0 0 120 120"></svg>
            <div class="dial-side">
                <label class="field"><span>Угол, °</span><input class="text" type="number" data-field="angle" min="0" max="359" step="1" value="${Math.round(first.angle)}"></label>
                <div class="seg"><button type="button" data-act="rot" data-v="-15">↺ 15°</button><button type="button" data-act="rot" data-v="15">↻ 15°</button></div>
                <button class="mini-btn" type="button" data-act="mirror">Отразить</button>
            </div>
        </div>
        <p class="ed-tip">Направление также можно менять на поле, перетаскивая мышь вокруг круга. ${sel.length > 1 ? 'Выбранные ноты поворачиваются вместе.' : ''}</p>
        ${sel.length > 1 ? `<span class="ed-label">Узор для выбранных</span>${seg(PATTERNS, '', 'pattern')}` : ''}
        ${holdHtml}`;
}

function twistText(v) {
    if (!v) return 'нет';
    const turns = Math.abs(v).toFixed(2).replace('.', ',').replace(/,?0+$/, '');
    return `${turns} оборота ${v > 0 ? 'по часовой' : 'против часовой'}`;
}

// Круглый «циферблат»: где ручка — оттуда и прилетит нота
function drawDial() {
    const svg = $('edDial');
    if (!svg) return;
    const sel = [...E.sel].sort((a, b) => a.t - b.t);
    let ticks = '';
    for (let i = 0; i < 24; i++) {
        const a = i * 15 * DEG;
        const r1 = i % 6 === 0 ? 44 : 49;
        ticks += `<line x1="${60 + Math.cos(a) * r1}" y1="${60 + Math.sin(a) * r1}" x2="${60 + Math.cos(a) * 54}" y2="${60 + Math.sin(a) * 54}"/>`;
    }
    const knobs = sel.slice(0, 24).map((n, i) => {
        const a = n.angle * DEG;
        return `<circle class="${i ? 'dial-dot' : 'dial-knob'}" cx="${60 + Math.cos(a) * 40}" cy="${60 + Math.sin(a) * 40}" r="${i ? 3 : 7}"/>`;
    }).join('');
    const a0 = sel.length ? sel[0].angle * DEG : 0;
    svg.innerHTML = `<g class="dial-ticks">${ticks}</g><circle class="dial-ring" cx="60" cy="60" r="14"/>
        <line class="dial-hand" x1="60" y1="60" x2="${60 + Math.cos(a0) * 40}" y2="${60 + Math.sin(a0) * 40}"/>${knobs}`;
}

panel.addEventListener('pointerdown', e => {
    const svg = e.target.closest('#edDial');
    if (!svg || !E || !E.sel.size) return;
    e.preventDefault();
    capture(svg, e);
    commit();
    E.aim = { orig: [...E.sel].sort((a, b) => a.t - b.t).map(n => [n, n.angle]), dial: svg };
    dialAim(e);
});
panel.addEventListener('pointermove', e => {
    if (E && E.aim && E.aim.dial) dialAim(e);
});
panel.addEventListener('pointerup', () => {
    if (E && E.aim && E.aim.dial) {
        E.aim = null;
        changed();
    }
});

function dialAim(e) {
    const r = E.aim.dial.getBoundingClientRect();
    let a = Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2) / DEG;
    if (!e.shiftKey) a = Math.round(a / 15) * 15;
    const delta = a - E.aim.orig[0][1];
    for (const [n, base] of E.aim.orig) n.angle = norm(base + delta);
    E.dirty = true;
    drawDial();
    const input = panel.querySelector('[data-field="angle"]');
    if (input) input.value = Math.round(E.aim.orig[0][0].angle);
}

// Вкладка «Создать»: автоматически, запись, узоры для всех нот
function makePanel() {
    const n = notes().length;
    const d = DIFFS[E.k];
    return `
        <h3>Автоматически</h3>
        <p class="ed-tip">Игра сама расставит ноты под бит для сложности «${d.name}»${n ? ` — сейчас тут ${n} нот, они заменятся` : ''}. Нажмите ещё раз, чтобы создать другой вариант.</p>
        <button class="mini-btn is-main" type="button" data-act="auto">Расставить ноты</button>
        <button class="mini-btn" type="button" data-act="quantize-all"${n && E.snap ? '' : ' disabled'}>Привязать все ноты к сетке ${E.snap ? `1/${E.snap}` : ''}</button>
        <h3>Запись</h3>
        <p class="ed-tip">Песня заиграет с текущего места. Нажимайте любую клавишу или кнопку мыши на поле в такт, и ноты появятся сами. Удерживайте кнопку дольше, чтобы создать длинную ноту. Esc — стоп.</p>
        ${toggle('rec-snap', E.recSnap, 'Привязывать к сетке')}
        <button class="mini-btn is-main" type="button" data-act="record">${E.recording ? 'Остановить запись' : '● Начать запись'}</button>
        <h3>Для всех нот сложности</h3>
        <div class="btn-col">
            <button class="mini-btn" type="button" data-act="all-shapes">Случайные фигуры</button>
            <button class="mini-btn" type="button" data-act="all-dirs">Случайные направления (узор в каждой фразе)</button>
            <button class="mini-btn" type="button" data-act="mirror-all">Отразить все направления</button>
        </div>
        <span class="ed-label">Один узор на всю песню</span>
        ${seg(PATTERNS, '', 'all-pattern')}
        <h3>Скопировать из другой сложности</h3>
        <div class="seg">${DIFFS.map((x, k) => `<button type="button" data-copy="${k}"${k === E.k || !E.diffs[k].notes.length ? ' disabled' : ''}>${x.name}</button>`).join('')}</div>
        <button class="mini-btn is-danger" type="button" data-act="clear"${n ? '' : ' disabled'}>Удалить все ноты сложности</button>`;
}

// Вкладка «Бит»: сетка битов (найти автоматически или задать темп вручную), метроном и дропы
function beatPanel() {
    const g = E.grid;
    const drops = E.drops.map(([a, b], i) => `
        <div class="drop-row">
            <button class="drop-time" type="button" data-drop-go="${i}" title="Перейти">${fmt(a)} — ${fmt(b)}</button>
            <button class="mini-btn" type="button" data-drop-a="${i}" title="Начало дропа — сюда">Начало</button>
            <button class="mini-btn" type="button" data-drop-b="${i}" title="Конец дропа — сюда">Конец</button>
            <button class="mini-btn is-danger" type="button" data-drop-del="${i}" title="Удалить дроп">×</button>
        </div>`).join('');
    return `
        <h3>Бит</h3>
        ${seg([['auto', 'Автоматически'], ['manual', 'Вручную']], g.mode, 'grid')}
        ${g.mode === 'auto' ? `
            <p class="ed-tip">Игра сама нашла биты в песне: примерно <b>${gridBpm().toFixed(1).replace('.', ',')} BPM</b>, битов: ${E.beats.length}. Если ноты «не в такт», переключитесь на «Вручную».</p>
            ${E.fileBeats ? '<button class="mini-btn" type="button" data-act="reanalyze">Найти биты заново</button>' : ''}` : `
            <div class="field-row">
                <label class="field"><span>Темп (BPM)</span><input class="text" type="number" data-field="bpm" min="40" max="300" step="0.1" value="${g.bpm}"></label>
                <div class="seg"><button type="button" data-act="bpm-half">÷2</button><button type="button" data-act="bpm-x2">×2</button></div>
            </div>
            <div class="field-row">
                <label class="field"><span>Первый бит, с</span><input class="text" type="number" data-field="offset" min="0" step="0.001" value="${g.offset}"></label>
                <button class="mini-btn" type="button" data-act="offset-here" title="Первый бит такта — на текущем месте">Сюда</button>
            </div>
            <button class="mini-btn tap-btn" type="button" data-act="tap">Простучать темп${E.taps.length > 1 ? ` · ${tapBpm().toFixed(1)}` : ''}</button>
            <p class="ed-tip">Нажимайте «Простучать» в такт песне 5–10 раз — темп посчитается автоматически.</p>`}
        <div class="tgl-row">
            ${toggle('metro', E.metro, 'Метроном')}
            ${toggle('clicks', E.clicks, 'Щелчки нот')}
        </div>
        <h3>Дропы</h3>
        <p class="ed-tip">Самые громкие куски песни: там сильнее эффекты, а «Расставить ноты» ставит их гуще.</p>
        ${drops || '<p class="ed-tip">Дропов нет.</p>'}
        <div class="btn-col">
            <button class="mini-btn" type="button" data-act="drop-add">+ Дроп с текущего места</button>
            <button class="mini-btn" type="button" data-act="drops-auto">Найти дропы автоматически</button>
        </div>`;
}

// Вкладка «Эффекты»: эффекты можно поставить на текущую секунду, затем менять и проверять в игре
const FX_SIDES = [['all', 'Весь экран'], ['l', 'Слева'], ['r', 'Справа'], ['t', 'Сверху'], ['b', 'Снизу']];
const gameSelect = (options, value, attrs = '') => `
    <div class="game-select" data-game-select data-value="${esc(value)}" ${attrs}>
        <button class="game-select-button text" type="button" data-select-toggle aria-haspopup="listbox" aria-expanded="false">
            <span data-select-label>${esc(options.find(([id]) => id === value)?.[1] || '')}</span>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 6 5 5 5-5"/></svg>
        </button>
        <div class="game-select-menu" role="listbox" hidden>
            ${options.map(([id, label]) => `<button class="game-select-option${id === value ? ' is-on' : ''}" type="button" role="option" aria-selected="${id === value}" data-select-option="${esc(id)}">${esc(label)}</button>`).join('')}
        </div>
    </div>`;

function effectsPanel() {
    const rows = E.effects.map((fx, i) => `
        <div class="fx-row${fx.id === E.activeFxId ? ' is-active' : ''}">
            <button class="drop-time" type="button" data-fx-go="${i}" title="Перейти к эффекту">${fmt(fx.t)}</button>
            <label class="fx-value"><span>Время, с</span><input class="text" type="number" data-fx-index="${i}" data-fx-field="t" min="0" max="${E.song.duration}" step="0.001" value="${fx.t.toFixed(3)}"></label>
            ${gameSelect(FX_TYPES, fx.type, `data-fx-index="${i}" data-fx-field="type"`)}
            <label class="fx-value"><span>Сила</span><input class="text" type="number" data-fx-index="${i}" data-fx-field="power" min="0.1" max="2" step="0.1" value="${fx.power || 1}"></label>
            <label class="fx-value"><span>Длительность</span><input class="text" type="number" data-fx-index="${i}" data-fx-field="duration" min="0.05" max="3" step="0.05" value="${fx.duration || 0.5}"></label>
            ${fx.type === 'flash' ? gameSelect(FX_SIDES, fx.side || 'all', `data-fx-index="${i}" data-fx-field="side"`) : ''}
            <button class="mini-btn is-danger" type="button" data-fx-del="${i}" aria-label="Удалить эффект">×</button>
        </div>`).join('');
    return `
        <h3>Эффекты</h3>
        <p class="ed-tip">Добавляйте вспышки, волны, фигуры и частицы в точные моменты песни. Нажмите на время эффекта, чтобы перейти к нему.</p>
        <span class="ed-label">Автоматические и ручные эффекты</span>
        ${seg([['auto', 'Авто'], ['mix', 'Вместе'], ['manual', 'Только мои']], E.fxMode, 'fx-mode')}
        <p class="ed-tip">«Авто» — эффекты игры на битах и дропах. «Вместе» добавляет ваши. «Только мои» выключает автоматические эффекты.</p>
        <div class="field"><span>Новый эффект</span>${gameSelect(FX_TYPES, FX_TYPES[0][0], 'data-fx-new')}</div>
        <button class="mini-btn is-main" type="button" data-act="fx-add">Добавить на ${fmt(snapT(E.t))}</button>
        <h4>Добавленные эффекты: ${E.effects.length}</h4>
        ${rows || '<p class="ed-tip">Пока эффектов нет.</p>'}`;
}

const tapBpm = () => {
    const t = E.taps;
    if (t.length < 2) return 0;
    return 60 / ((t[t.length - 1] - t[0]) / (t.length - 1));
};

// Вкладка «Уровень»: название, скорость нот, сложности
function levelPanel() {
    const d = E.diffs[E.k];
    return `
        <h3>Уровень</h3>
        <label class="field"><span>Название</span><input class="text" type="text" data-field="title" maxlength="80" value="${esc(E.title)}"></label>
        <label class="field"><span>Исполнитель</span><input class="text" type="text" data-field="artist" maxlength="80" value="${esc(E.artist)}"></label>
        <h3>Скорость нот — «${DIFFS[E.k].name}»</h3>
        ${range('approach', d.approach, 0.6, 2.6, 0.05, `Нота летит до круга: <b data-out="approach">${d.approach.toFixed(2).replace('.', ',')} с</b>`)}
        <p class="ed-tip">Меньше — быстрее и сложнее. По умолчанию для этой сложности — ${APPROACH[E.k].toFixed(2).replace('.', ',')} с.</p>
        <h3>Сложности</h3>
        <div class="diff-sum">${DIFFS.map((x, k) => `
            <button class="diff-sum-row${k === E.k ? ' is-on' : ''}" type="button" data-k="${k}">
                ${diffIcon(x.icon)}<span>${x.name}</span><b>${E.diffs[k].notes.length ? `${E.diffs[k].notes.length} нот` : 'пусто'}</b>
            </button>`).join('')}</div>
        <p class="ed-tip">В меню появятся только сложности, где есть ноты.</p>
        <h3>Песня</h3>
        <p class="ed-tip">${esc(E.audioName || '')} · ${clock(E.song.duration)}</p>`;
}

// ===== Кнопки и поля во вкладках =====

function closeGameSelects() {
    panel.querySelectorAll('[data-game-select]').forEach(select => {
        const menu = select.querySelector('.game-select-menu');
        const toggle = select.querySelector('[data-select-toggle]');
        menu.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
    });
}

let gameMenuDragged = false;

function bindGameSelectMenu(menu) {
    if (menu.dataset.scrollReady) return;
    menu.dataset.scrollReady = '1';
    let drag = null;
    let targetTop = menu.scrollTop;
    let scrollFrame = 0;
    let lastScrollFrame = 0;

    const animateScroll = () => {
        if (scrollFrame) return;
        lastScrollFrame = performance.now();
        const step = now => {
            const dt = Math.min(50, now - lastScrollFrame);
            lastScrollFrame = now;
            const delta = targetTop - menu.scrollTop;
            if (Math.abs(delta) < 0.4) {
                menu.scrollTop = targetTop;
                scrollFrame = 0;
                return;
            }
            menu.scrollTop += delta * (1 - Math.exp(-dt / 65));
            scrollFrame = requestAnimationFrame(step);
        };
        scrollFrame = requestAnimationFrame(step);
    };

    menu.addEventListener('wheel', e => {
        const unit = e.deltaMode === 1 ? 20 : e.deltaMode === 2 ? menu.clientHeight : 1;
        targetTop = clamp(targetTop + e.deltaY * unit, 0, menu.scrollHeight - menu.clientHeight);
        animateScroll();
        e.preventDefault();
        e.stopPropagation();
    }, { passive: false });

    menu.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        targetTop = menu.scrollTop;
        drag = { id: e.pointerId, y: e.clientY, top: menu.scrollTop, moved: false };
    });
    menu.addEventListener('pointermove', e => {
        if (!drag || drag.id !== e.pointerId) return;
        const delta = e.clientY - drag.y;
        if (!drag.moved && Math.abs(delta) < 4) return;
        if (!drag.moved) {
            drag.moved = true;
            menu.classList.add('is-dragging');
            menu.setPointerCapture(e.pointerId);
        }
        targetTop = clamp(drag.top - delta, 0, menu.scrollHeight - menu.clientHeight);
        animateScroll();
        e.preventDefault();
    });
    const endDrag = e => {
        if (!drag || drag.id !== e.pointerId) return;
        if (drag.moved) {
            gameMenuDragged = true;
            setTimeout(() => gameMenuDragged = false, 0);
        }
        drag = null;
        menu.classList.remove('is-dragging');
    };
    menu.addEventListener('pointerup', endDrag);
    menu.addEventListener('pointercancel', endDrag);
}

function openGameSelect(select) {
    closeGameSelects();
    const menu = select.querySelector('.game-select-menu');
    bindGameSelectMenu(menu);
    const toggle = select.querySelector('[data-select-toggle]');
    const r = toggle.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 156), window.innerWidth - 16);
    const left = clamp(r.left, 8, window.innerWidth - width - 8);
    const below = window.innerHeight - r.bottom - 16;
    const above = r.top - 16;
    const openDown = below >= above || below >= 180;
    const room = Math.max(96, Math.min(240, openDown ? below : above));
    menu.style.left = `${left}px`;
    menu.style.width = `${width}px`;
    menu.style.maxHeight = `${room}px`;
    menu.style.top = openDown ? `${Math.min(r.bottom + 5, window.innerHeight - room - 8)}px` : 'auto';
    menu.style.bottom = openDown ? 'auto' : `${window.innerHeight - r.top + 5}px`;
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
}

document.addEventListener('pointerdown', e => {
    if (!e.target.closest('[data-game-select]')) closeGameSelects();
});
panel.addEventListener('scroll', e => {
    if (e.target.closest && e.target.closest('.game-select-menu')) return;
    closeGameSelects();
}, { passive: true });

panel.addEventListener('keydown', e => {
    const select = e.target.closest('[data-game-select]');
    if (!select) return;
    const options = [...select.querySelectorAll('[data-select-option]')];
    const current = options.indexOf(e.target);
    if (e.target.matches('[data-select-toggle]') && ['ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        openGameSelect(select);
        const active = options.findIndex(option => option.getAttribute('aria-selected') === 'true');
        options[Math.max(0, active)].focus();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeGameSelects();
        select.querySelector('[data-select-toggle]').focus();
    } else if (current >= 0 && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        options[next].focus();
    }
});

panel.addEventListener('click', async e => {
    if (!E) return;
    if (gameMenuDragged) {
        e.preventDefault();
        return;
    }
    const option = e.target.closest('[data-select-option]');
    if (option) {
        const select = option.closest('[data-game-select]');
        const value = option.dataset.selectOption;
        select.dataset.value = value;
        select.querySelector('[data-select-label]').textContent = option.textContent;
        select.querySelectorAll('[data-select-option]').forEach(item => {
            const active = item === option;
            item.classList.toggle('is-on', active);
            item.setAttribute('aria-selected', String(active));
        });
        closeGameSelects();
        if (select.dataset.fxIndex != null && select.dataset.fxField) {
            const fx = E.effects[Number(select.dataset.fxIndex)];
            if (!fx) return;
            const field = select.dataset.fxField;
            if ((field === 'type' && !FX_TYPES.some(([id]) => id === value)) || (field === 'side' && !FX_SIDES.some(([id]) => id === value))) return;
            if (fx[field] === value) return;
            commit();
            fx[field] = value;
            E.activeFxId = fx.id;
            E.dirty = true;
            renderPanel();
            renderTop();
        }
        return;
    }
    const selectToggle = e.target.closest('[data-select-toggle]');
    if (selectToggle) {
        const select = selectToggle.closest('[data-game-select]');
        if (select.querySelector('.game-select-menu').hidden) openGameSelect(select);
        else closeGameSelects();
        return;
    }
    closeGameSelects();
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const sel = [...E.sel].sort((x, y) => x.t - y.t);
    const ds = b.dataset;

    if (ds.k != null) {
        setDiff(Number(ds.k));
        return;
    }
    if (ds.styleShape) E.style.shape = ds.styleShape;
    else if (ds.styleDir) E.style.dir = ds.styleDir;
    else if (ds.type) {
        commit();
        for (const n of sel) {
            if (ds.type === 'hold' && n.type !== 'hold') makeHold(n, Math.min(E.song.duration, n.t + beatLen(n.t)));
            if (ds.type === 'tap' && n.type !== 'tap') makeTap(n);
        }
        changed();
        return;
    } else if (ds.shape) {
        commit();
        for (const n of sel) n.shape = ds.shape;
        changed();
        return;
    } else if (ds.form) {
        commit();
        for (const n of sel.filter(x => x.type === 'hold')) {
            n.twist = ds.form === 'spiral' ? n.twist || 0.5 : 0;
            n.wiggle = ds.form === 'wave' ? n.wiggle || 0.25 : 0;
            n.waves = n.waves || 2;
        }
        changed();
        return;
    } else if (ds.pattern) {
        commit();
        applyPattern(sel, ds.pattern, sel[0].angle);
        changed();
        return;
    } else if (ds.allPattern) {
        commit();
        restyleAll({ shapes: false, pattern: ds.allPattern });
        return;
    } else if (ds.copy != null) {
        const k = Number(ds.copy);
        if (notes().length && !(await sure(`Заменить ноты «${DIFFS[E.k].name}» нотами «${DIFFS[k].name}»?`))) return;
        commit();
        E.diffs[E.k].notes = E.diffs[k].notes.map(n => ({ ...n }));
        E.sel.clear();
        changed();
        return;
    } else if (ds.grid) {
        if (ds.grid === E.grid.mode) return;
        commit();
        if (ds.grid === 'manual') {
            E.grid = { mode: 'manual', bpm: Math.round(gridBpm() * 10) / 10, offset: Math.round((E.beats[0] || 0) * 1000) / 1000 };
        } else {
            E.grid = { ...E.grid, mode: 'auto' };
        }
        applyGrid();
    } else if (ds.dropGo != null) {
        seek(E.drops[ds.dropGo][0]);
        return;
    } else if (ds.dropA != null || ds.dropB != null) {
        commit();
        const i = Number(ds.dropA ?? ds.dropB);
        E.drops[i][ds.dropA != null ? 0 : 1] = E.t;
        fixDrops();
    } else if (ds.dropDel != null) {
        commit();
        E.drops.splice(Number(ds.dropDel), 1);
    } else if (ds.fxMode) {
        commit();
        E.fxMode = ds.fxMode;
    } else if (ds.fxGo != null) {
        const fx = E.effects[Number(ds.fxGo)];
        if (fx) {
            E.activeFxId = fx.id;
            seek(fx.t);
            renderPanel();
        }
        return;
    } else if (ds.fxDel != null) {
        commit();
        const [fx] = E.effects.splice(Number(ds.fxDel), 1);
        if (fx && fx.id === E.activeFxId) E.activeFxId = null;
    } else {
        await action(ds.act, sel, ds);
        return;
    }
    renderPanel();
});

async function action(act, sel, ds) {
    switch (act) {
        case 'unsel':
            E.sel.clear();
            break;
        case 'del':
            commit();
            remove(sel);
            return;
        case 'shape-rand':
            commit();
            for (const n of sel) n.shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
            changed();
            return;
        case 'hollow':
        case 'twin': {
            commit();
            const on = !sel.every(n => n[act]);
            for (const n of sel) {
                if (on && !(act === 'twin' && n.type === 'hold')) n[act] = true;
                else delete n[act];
            }
            if (act === 'twin' && on && sel.some(n => n.type === 'hold')) toast('С двух сторон бывают только обычные ноты');
            changed();
            return;
        }
        case 'rot':
            commit();
            for (const n of sel) n.angle = norm(n.angle + Number(ds.v));
            changed();
            return;
        case 'mirror':
            commit();
            for (const n of sel) n.angle = norm(180 - n.angle);
            changed();
            return;
        case 'len':
            commit();
            for (const n of sel.filter(x => x.type === 'hold')) {
                n.end = clamp(n.end + Number(ds.v) * step(n.end), n.t + step(n.t), E.song.duration);
            }
            changed();
            return;
        case 'auto':
            if (notes().length && !(await sure(`Заменить ${notes().length} нот новыми?`))) return;
            commit();
            autoNotes();
            return;
        case 'quantize-sel':
            quantize(sel);
            return;
        case 'quantize-all':
            quantize(notes());
            return;
        case 'fx-add': {
            const type = panel.querySelector('[data-fx-new]')?.dataset.value || FX_TYPES[0][0];
            commit();
            const fx = { id: newId(), t: snapT(E.t), type, power: 1, duration: 0.5, side: 'all' };
            E.effects.push(fx);
            E.effects.sort((a, b) => a.t - b.t);
            E.activeFxId = fx.id;
            if (E.fxMode === 'auto') E.fxMode = 'mix';
            E.tab = 'fx';
            break;
        }
        case 'record':
            startRecord();
            return;
        case 'rec-snap':
            E.recSnap = !E.recSnap;
            break;
        case 'all-shapes':
            commit();
            restyleAll({ angles: false });
            return;
        case 'all-dirs':
            commit();
            restyleAll({ shapes: false });
            return;
        case 'mirror-all':
            commit();
            for (const n of notes()) n.angle = norm(180 - n.angle);
            changed();
            return;
        case 'clear':
            if (!(await sure(`Удалить все ноты сложности «${DIFFS[E.k].name}»?`))) return;
            commit();
            E.diffs[E.k].notes = [];
            E.sel.clear();
            changed();
            return;
        case 'reanalyze':
            commit();
            E.fileBeats = null;
            applyGrid();
            break;
        case 'bpm-half':
        case 'bpm-x2':
            commit();
            E.grid.bpm = clamp(Math.round(E.grid.bpm * (act === 'bpm-x2' ? 2 : 0.5) * 10) / 10, 40, 300);
            applyGrid();
            break;
        case 'offset-here':
            commit();
            E.grid.offset = Math.round(E.t * 1000) / 1000;
            applyGrid();
            break;
        case 'tap': {
            const now = performance.now() / 1000;
            if (E.taps.length && now - E.taps[E.taps.length - 1] > 2) E.taps = [];
            E.taps.push(now);
            if (E.taps.length > 16) E.taps.shift();
            if (E.taps.length >= 4) {
                if (!E.live) commit();
                E.live = true;
                E.grid.bpm = Math.round(tapBpm() * 10) / 10;
                applyGrid();
                clearTimeout(E.tapTimer);
                E.tapTimer = setTimeout(() => {
                    if (E) E.live = false;
                }, 2100);
            }
            break;
        }
        case 'metro':
            E.metro = !E.metro;
            break;
        case 'clicks':
            E.clicks = !E.clicks;
            break;
        case 'drop-add': {
            commit();
            const a = snapT(E.t);
            E.drops.push([a, Math.min(E.song.duration, a + beatLen(a) * 16)]);
            fixDrops();
            break;
        }
        case 'drops-auto':
            commit();
            E.drops = E.song.drops.map(d => [...d]);
            break;
        default:
            return;
    }
    renderPanel();
    renderTop();
}

const sure = text => ask({ title: text, buttons: [{ label: 'Да', value: true, main: true }, { label: 'Отмена', value: null }] });

function fixDrops() {
    for (const d of E.drops) if (d[0] > d[1]) d.reverse();
    E.drops = E.drops.filter(([a, b]) => b - a > 0.2).sort((x, y) => x[0] - y[0]);
}

// Ползунки и поля ввода: двигаешь — сразу видно, отпустил — запомнилось для «Отменить»
panel.addEventListener('input', e => {
    const f = e.target.dataset.field;
    if (!f || !E) return;
    const v = e.target.type === 'number' || e.target.type === 'range' ? Number(e.target.value) : e.target.value;
    if (f === 'title' || f === 'artist') {
        E[f] = v;
        E.dirty = true;
        renderTop();
        return;
    }
    if (e.target.type === 'number') return;             // числа — по «change», когда допечатал
    if (!E.live) {
        commit();
        E.live = true;
    }
    const sel = [...E.sel];
    const out = panel.querySelector(`[data-out="${f}"]`);
    if (f === 'size') {
        for (const n of sel) n.size = v;
        if (out) out.textContent = `${Math.round(v * 100)} %`;
    } else if (f === 'twist' || f === 'wiggle' || f === 'waves') {
        for (const n of sel) if (n.type === 'hold') n[f] = v;
        if (out) out.textContent = f === 'twist' ? twistText(v) : f === 'wiggle' ? Math.round(v * 100) : v;
    } else if (f === 'approach') {
        E.diffs[E.k].approach = v;
        if (out) out.textContent = `${v.toFixed(2).replace('.', ',')} с`;
    }
});

panel.addEventListener('change', e => {
    const fxIndex = e.target.dataset.fxIndex;
    const fxField = e.target.dataset.fxField;
    if (fxIndex != null && fxField && E) {
        const fx = E.effects[Number(fxIndex)];
        if (!fx) return;
        const raw = e.target.value;
        const value = fxField === 'type' || fxField === 'side' ? raw : Number(raw);
        if (fxField === 't' && (!Number.isFinite(value) || value < 0 || value > E.song.duration)) return;
        if (['power', 'duration'].includes(fxField) && !Number.isFinite(value)) return;
        commit();
        if (fxField === 't') fx.t = Math.round(clamp(value, 0, E.song.duration) * 1000) / 1000;
        else if (fxField === 'power') fx.power = Math.round(clamp(value, 0.1, 2) * 10) / 10;
        else if (fxField === 'duration') fx.duration = Math.round(clamp(value, 0.05, 3) * 100) / 100;
        else if (fxField === 'type' && FX_TYPES.some(([id]) => id === value)) fx.type = value;
        else if (fxField === 'side' && ['all', 'l', 'r', 't', 'b'].includes(value)) fx.side = value;
        E.effects.sort((a, b) => a.t - b.t);
        E.activeFxId = fx.id;
        E.dirty = true;
        renderPanel();
        renderTop();
        return;
    }
    const f = e.target.dataset.field;
    if (!f || !E) return;
    E.live = false;
    const v = Number(e.target.value);
    if (f === 'angle' && Number.isFinite(v)) {
        commit();
        const sel = [...E.sel].sort((a, b) => a.t - b.t);
        const delta = v - sel[0].angle;
        for (const n of sel) n.angle = norm(n.angle + delta);
    } else if (f === 'bpm' && v >= 40 && v <= 300) {
        commit();
        E.grid.bpm = v;
        applyGrid();
    } else if (f === 'offset' && v >= 0) {
        commit();
        E.grid.offset = Math.min(v, E.song.duration);
        applyGrid();
    } else if (f === 'title' || f === 'artist') {
        return;
    }
    changed();
});

// Узор направлений для нот подряд, начиная с угла base
function applyPattern(list, p, base) {
    list.forEach((n, i) => {
        let a;
        switch (p) {
            case 'spin': a = base + i * 45; break;
            case 'alt': a = base + (i % 2) * 180; break;
            case 'cross': a = base + (i % 4) * 90; break;
            case 'zigzag': a = base + (i % 2 ? 70 : 0); break;
            case 'stream': a = base + i * 12; break;
            default: a = Math.floor(Math.random() * 24) * 15;
        }
        n.angle = norm(a);
    });
}

// Узор по фразам (как при автоматической расстановке) для всех нот сложности
function restyleAll(opts) {
    const list = notes();
    const tmp = list.map(n => ({
        n, t: n.t, angle: n.angle, shape: n.shape,
        beat: Math.max(0, lowerBound(E.beats, n.t + 1e-6) - 1), drop: inDrop(n.t)
    }));
    restyle(tmp, mulberry32((Math.random() * 2 ** 32) >>> 0), opts);
    for (const x of tmp) {
        x.n.angle = x.angle;
        x.n.shape = x.shape;
    }
    changed();
}

// Ноты сами — по сетке битов, дропам и «ударам» песни
function autoNotes() {
    const song = { ...E.song, beats: E.beats, strength: E.strength, drops: E.drops };
    const chart = makeChart(song, E.k, `${E.id}#${E.variant++}`);
    E.diffs[E.k].notes = chart.notes;
    E.sel.clear();
    changed();
    toast(`Готово: ${chart.notes.length} нот`);
}

// ===== Клавиши =====

addEventListener('keydown', e => {
    if (!E || !E.open || E.testing || isAsking()) return;
    const typing = e.target.closest && e.target.closest('input, textarea, select, [data-game-select]');
    if (E.recording) {
        if (e.key === 'Escape') {
            e.preventDefault();
            stopRecord();
            return;
        }
        if (typing || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        recDown(`k${e.code}`);
        return;
    }
    if (typing) {
        if (!typing.matches('[data-game-select]') && (e.key === 'Escape' || e.key === 'Enter')) e.target.blur();
        return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl) {
        const k = e.code;
        if (k === 'KeyZ') e.shiftKey ? redo() : undo();
        else if (k === 'KeyY') redo();
        else if (k === 'KeyS') save();
        else if (k === 'KeyA') {
            E.sel = new Set(notes());
            select();
        } else if (k === 'KeyC') copy();
        else if (k === 'KeyV') paste();
        else return;
        e.preventDefault();
        return;
    }
    switch (e.code) {
        case 'Space':
            // пробел — только «играть / пауза», а не нажатие кнопки, по которой только что кликнули
            if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
            togglePlay();
            break;
        case 'Delete':
        case 'Backspace':
            if (!E.sel.size) return;
            commit();
            remove([...E.sel]);
            break;
        case 'Escape':
            if (!E.sel.size) return;
            E.sel.clear();
            select();
            break;
        case 'ArrowLeft':
        case 'ArrowRight': {
            const dir = e.code === 'ArrowLeft' ? -1 : 1;
            const s = e.shiftKey ? beatLen(E.t) * 4 : step(E.t);
            seek(E.snap ? snapT(E.t + dir * s) : E.t + dir * s);
            break;
        }
        case 'Home':
            seek(0);
            break;
        case 'Digit1':
        case 'Digit2':
        case 'Digit3':
            E.tool = TOOLS[Number(e.code.slice(-1)) - 1][0];
            syncBar();
            break;
        default:
            return;
    }
    e.preventDefault();
});

addEventListener('keyup', e => {
    if (E && E.recording) recUp(`k${e.code}`);
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden && E && E.open && !E.testing) pause();
});

let clip = null;
function copy() {
    const sel = [...E.sel].sort((a, b) => a.t - b.t);
    if (!sel.length) return toast('Сначала выберите ноты');
    const t0 = sel[0].t;
    clip = sel.map(n => ({ ...n, t: n.t - t0, end: n.end != null ? n.end - t0 : undefined }));
    toast(`Скопировано нот: ${clip.length}`);
}

function paste() {
    if (!clip) return toast('Сначала скопируйте ноты (Ctrl+C)');
    commit();
    const base = snapT(E.t);
    const added = clip.filter(c => base + c.t <= E.song.duration).map(c => {
        const n = { ...c, t: base + c.t };
        if (c.end != null) n.end = Math.min(E.song.duration, base + c.end);
        else delete n.end;
        return n;
    });
    notes().push(...added);
    E.sel = new Set(added);
    changed();
    select();
}

// ===== Сохранить и проверить =====

// Нота в том виде, в каком она хранится (без лишнего и с округлением)
function clean(n) {
    const r = v => Math.round(v * 1000) / 1000;
    const o = { t: r(n.t), type: n.type, angle: norm(n.angle), shape: n.shape, size: r(n.size || 1) };
    if (n.hollow) o.hollow = true;
    if (n.twin && n.type === 'tap') o.twin = true;
    if (n.type === 'hold') Object.assign(o, { end: r(n.end), twist: r(n.twist || 0), wiggle: r(n.wiggle || 0), waves: n.waves || 1 });
    return o;
}

// Разбор песни с сеткой и дропами редактора
function songNow() {
    const waveDrop = new Uint8Array(E.song.wave.length);
    for (let i = 0; i < waveDrop.length; i++) {
        const mid = (i + 0.5) / waveDrop.length * E.song.duration;
        waveDrop[i] = inDrop(mid) ? 1 : 0;
    }
    return { ...E.song, id: E.id, bpm: gridBpm(), beats: E.beats, strength: E.strength, drops: E.drops.map(d => [...d]), waveDrop };
}

async function save() {
    const diffs = E.diffs.map((d, k) => ({ k, approach: d.approach, notes: d.notes.map(clean) })).filter(d => d.notes.length);
    if (!diffs.length) {
        toast('Добавьте хотя бы одну ноту — пустой уровень нельзя сохранить');
        return false;
    }
    const rec = {
        id: E.id,
        title: E.title.trim() || 'Без названия',
        artist: E.artist.trim(),
        source: 'editor',
        created: E.created,
        updated: Date.now(),
        audio: E.audio,
        audioName: E.audioName,
        bg: E.bg,
        song: songToStore(songNow()),
        diffs,
        grid: { ...E.grid },
        effects: E.effects.map(f => ({ ...f })),
        fxMode: E.fxMode
    };
    try {
        await saveLevel(rec);
    } catch (err) {
        console.warn(err);
        toast('Не получилось сохранить: браузер не даёт место (может, это приватное окно?)');
        return false;
    }
    E.dirty = false;
    E.saved = rec;
    toast('Уровень сохранён — он появится в меню');
    return true;
}

// Проверка: уровень с текущего места (с начала, если стоим в самом начале или конце)
function test() {
    const list = notes();
    if (!list.length) {
        toast('В этой сложности пока нет нот');
        return;
    }
    pause();
    const from = E.t > 1 && E.t < E.song.duration - 3 ? E.t : 0;
    const d = E.diffs[E.k];
    const chartNotes = list.map(clean);
    const end = chartNotes.reduce((m, n) => Math.max(m, n.end || n.t), 0) + 2;
    E.testing = true;
    backdrop.pause();
    music.use(E.buffer);
    startGame({
        level: { id: E.id, title: E.title || 'Без названия', artist: E.artist, source: 'editor', bg: E.bg, effects: E.effects, fxMode: E.fxMode },
        diff: DIFFS[E.k],
        diffIndex: E.k,
        song: songNow(),
        chart: { approach: d.approach, notes: chartNotes, end },
        options: getOptions(),
        from,
        test: true,
        onExit: () => {
            if (!E) return;
            E.testing = false;
            music.stop();
        }
    });
}

// Панель настроек листается колесом и мышью, как списки в меню
dragScroll(panel);
dragScroll(bgPanel);
