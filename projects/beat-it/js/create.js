// Окно «Создать уровень»: автоматически (игра сама найдёт бит и расставит ноты)
// или в редакторе (всё вручную). Здесь же можно открыть файл уровня .rhythm, который прислали.
// Песня и фон никуда не отправляются — всё считается и хранится на этом устройстве

import * as music from './music.js?v=6';
import { analyzeTrack } from './analyze.js?v=3';
import { makeChart } from './chart.js?v=2';
import { DIFFS, diffIcon } from './menu.js?v=7';
import { bgForm } from './bg.js?v=2';
import { saveLevel, newId } from './store.js?v=1';
import { songToStore } from './library.js?v=3';
import { importLevel } from './pack.js?v=6';
import { clock, toast } from './util.js?v=1';

const modal = document.getElementById('createModal');
const box = modal.querySelector('.modal-box');
// created(уровень, звук, разбор) — уровень готов; editor({ file, title, artist, buffer, song }) — открыть редактор
let hooks = null;
let form = null;          // заполняемая форма: { mode, file, buffer, song, ks, bgf, token }

const ICONS = {
    auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20 15 9M13.5 7.5l3 3M17 3v3M15.5 4.5h3M20 9v2M19 10h2M9 3v2M8 4h2"/></svg>',
    editor: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h7M3 13h5M3 8h9M14 20l.8-3.4 5-5a1.6 1.6 0 0 1 2.3 2.3l-5 5z"/></svg>'
};

export function openCreate(h) {
    hooks = h;
    showPick();
    modal.classList.add('is-open');
}

export function importDroppedFile(file, h) {
    hooks = h;
    return openFile(file);
}

export function closeCreate() {
    if (!modal.classList.contains('is-open')) return false;
    modal.classList.remove('is-open');
    dropForm();
    return true;
}

function dropForm() {
    if (form && form.bgf) form.bgf.destroy();
    form = null;
}

modal.addEventListener('click', e => {
    if (e.target === modal) closeCreate();
});

// ===== Шаг 1: как делать уровень =====

function showPick() {
    dropForm();
    box.innerHTML = `
        <h2>Создать уровень</h2>
        <p>Как будем делать?</p>
        <button class="pick-btn" type="button" data-pick="auto">
            ${ICONS.auto}
            <span><b>Автоматически</b><small>После загрузки песни игра найдёт бит и расставит ноты. Затем можно выбрать сложности и фон.</small></span>
        </button>
        <button class="pick-btn" type="button" data-pick="editor">
            ${ICONS.editor}
            <span><b>Редактор</b><small>Всё вручную: бит, ноты, фигуры, длинные ноты и откуда они летят. Можно начать с автоматических нот или «записать» их, нажимая в такт.</small></span>
        </button>
        <label class="pick-link">
            <input type="file" accept=".rhythm,.zip" hidden>
            Или открыть файл <b>.rhythm</b>
        </label>
        <button class="modal-btn" type="button" data-act="close">Отмена</button>`;
    box.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => showForm(b.dataset.pick)));
    box.querySelector('[data-act="close"]').addEventListener('click', closeCreate);
    const input = box.querySelector('.pick-link input');
    input.addEventListener('change', () => {
        const file = input.files[0];
        input.value = '';
        if (file) openFile(file);
    });
}

// ===== Шаг 2: песня, название, сложности и фон =====

function showForm(mode) {
    const auto = mode === 'auto';
    box.innerHTML = `
        <h2>${auto ? 'Автоматически' : 'Новый уровень в редакторе'}</h2>
        <div class="form">
            <div class="field">
                <span class="field-name">Песня</span>
                <label class="file-btn is-wide"><input type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac" hidden><span>Выбрать песню</span></label>
                <p class="field-note" data-out="music">mp3, m4a, wav… Песня никуда не отправляется — всё считается на этом устройстве.</p>
            </div>
            <label class="field"><span class="field-name">Название</span><input class="text" type="text" data-f="title" maxlength="80" placeholder="Как называется песня"></label>
            <label class="field"><span class="field-name">Исполнитель</span><input class="text" type="text" data-f="artist" maxlength="80" placeholder="Кто исполняет"></label>
            ${auto ? `
            <div class="field">
                <span class="field-name">Сложности</span>
                <div class="diff-picks">${DIFFS.map((d, k) => `
                    <button class="diff-pick is-on" type="button" data-k="${k}">${diffIcon(d.icon)}<span>${d.name}</span></button>`).join('')}</div>
            </div>
            <div class="field">
                <span class="field-name">Фон — картинка или видео</span>
                <div class="bg-host"></div>
            </div>` : '<p class="field-note">Фон, бит, ноты и всё остальное настраивается в самом редакторе.</p>'}
        </div>
        <div class="modal-row">
            <button class="modal-btn" type="button" data-act="back">Назад</button>
            <button class="modal-btn is-main" type="button" data-act="go" disabled>${auto ? 'Создать уровень' : 'Открыть редактор'}</button>
        </div>`;

    form = { mode, file: null, buffer: null, song: null, ks: new Set([0, 1, 2, 3, 4]), bgf: null, token: 0, busy: false };
    if (auto) form.bgf = bgForm(box.querySelector('.bg-host'), { onError: toast });

    const input = box.querySelector('.file-btn input');
    input.addEventListener('change', () => {
        const file = input.files[0];
        input.value = '';
        if (file) pickMusic(file);
    });
    box.querySelectorAll('.diff-pick').forEach(b => b.addEventListener('click', () => {
        const k = Number(b.dataset.k);
        if (form.ks.has(k)) form.ks.delete(k);
        else form.ks.add(k);
        b.classList.toggle('is-on', form.ks.has(k));
        refresh();
    }));
    box.querySelector('[data-act="back"]').addEventListener('click', showPick);
    box.querySelector('[data-act="go"]').addEventListener('click', () => (auto ? createAuto() : openEditorStep()));
}

const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
const field = name => box.querySelector(`[data-f="${name}"]`);

function refresh() {
    if (!form) return;
    const go = box.querySelector('[data-act="go"]');
    if (go) go.disabled = form.busy || !form.song || (form.mode === 'auto' && !form.ks.size);
    const note = box.querySelector('[data-out="music"]');
    if (note && form.mode === 'auto' && form.song && !form.ks.size) note.textContent = 'Выберите хотя бы одну сложность';
}

async function pickMusic(file) {
    const f = form;
    const token = ++f.token;
    const note = box.querySelector('[data-out="music"]');
    const btn = box.querySelector('.file-btn span');
    btn.textContent = file.name;
    f.file = file;
    f.song = null;
    f.busy = true;
    refresh();
    const names = guessNames(file.name);
    if (!field('title').value) field('title').value = names.title;
    if (!field('artist').value) field('artist').value = names.artist;
    note.textContent = 'Открываю песню…';
    try {
        const buffer = await music.decode(await file.arrayBuffer());
        if (form !== f || token !== f.token) return;
        note.textContent = 'Ищу бит и дропы…';
        await frame();
        const song = analyzeTrack(buffer);
        if (form !== f || token !== f.token) return;
        if (!song.beats.length) throw new Error('нет битов');
        f.buffer = buffer;
        f.song = song;
        note.textContent = `${Math.round(song.bpm)} BPM · ${clock(song.duration)} · дропов: ${song.drops.length}`;
        if (f.bgf) f.bgf.setDuration(song.duration);
    } catch (e) {
        console.warn(e);
        if (form !== f || token !== f.token) return;
        f.file = null;
        note.textContent = 'Эту песню открыть не получилось — попробуйте другой файл (лучше mp3)';
        btn.textContent = 'Выбрать песню';
    }
    f.busy = false;
    refresh();
}

// «Artist - Title (Official Audio).mp3» → исполнитель и название
function guessNames(name) {
    let s = name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ');
    s = s.replace(/\((official|audio|video|lyrics?|color coded|mp3\.pm|hd|hq|music video)[^)]*\)/gi, '')
        .replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
    const parts = s.split(/\s+[-–—]\s+/);
    if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
    return { artist: '', title: s };
}

async function createAuto() {
    const f = form;
    if (!f || !f.song || f.busy) return;
    f.busy = true;
    refresh();
    const go = box.querySelector('[data-act="go"]');
    go.textContent = 'Расставляю ноты…';
    await frame();
    const id = newId();
    const now = Date.now();
    const diffs = [...f.ks].sort((a, b) => a - b).map(k => {
        const c = makeChart(f.song, k, id);
        return { k, approach: c.approach, notes: c.notes };
    });
    const rec = {
        id,
        title: field('title').value.trim() || 'Без названия',
        artist: field('artist').value.trim(),
        source: 'auto',
        created: now,
        updated: now,
        audio: f.file,
        audioName: f.file.name,
        bg: f.bgf ? f.bgf.value : null,
        song: songToStore(f.song),
        diffs
    };
    try {
        await saveLevel(rec);
    } catch (e) {
        console.warn(e);
        toast('Не получилось сохранить: браузер не даёт место (может, это приватное окно?)');
        f.busy = false;
        go.textContent = 'Создать уровень';
        refresh();
        return;
    }
    const { buffer, song } = f;
    closeCreate();
    toast(`Уровень готов: ${diffs.reduce((s, d) => s + d.notes.length, 0)} нот`);
    hooks.created(rec, buffer, song);
}

function openEditorStep() {
    const f = form;
    if (!f || !f.song) return;
    const data = { file: f.file, title: field('title').value.trim(), artist: field('artist').value.trim(), buffer: f.buffer, song: f.song };
    closeCreate();
    hooks.editor(data);
}

// ===== Чужой уровень из файла .rhythm =====

async function openFile(file) {
    toast('Открываю уровень…');
    try {
        const rec = await importLevel(file);
        const buffer = await music.decode(await rec.audio.arrayBuffer());
        await frame();
        const song = analyzeTrack(buffer);
        given(song, rec.given);
        delete rec.given;
        rec.song = songToStore(song);
        await saveLevel(rec);
        closeCreate();
        toast(`Уровень «${rec.title}» добавлен`);
        hooks.created(rec, buffer, song);
    } catch (e) {
        console.warn(e);
        toast(e && e.message && /[а-я]/i.test(e.message) ? e.message : 'Не получилось открыть этот файл');
    }
}

// Биты, дропы и место для меню — как в файле уровня (ноты ставились именно под них)
function given(song, g) {
    if (!g) return;
    if (g.beats && g.beats.length > 8) {
        song.beats = Float64Array.from(g.beats);
        song.strength = g.strength && g.strength.length === g.beats.length
            ? Float32Array.from(g.strength)
            : new Float32Array(g.beats.length).fill(0.6);
        const steps = [];
        for (let i = 1; i < song.beats.length; i++) steps.push(song.beats[i] - song.beats[i - 1]);
        steps.sort((a, b) => a - b);
        song.bpm = 60 / steps[steps.length >> 1];
    }
    if (g.drops) {
        song.drops = g.drops.filter(d => Array.isArray(d) && d.length === 2).map(([a, b]) => [Number(a), Number(b)]);
        for (let i = 0; i < song.waveDrop.length; i++) {
            const mid = (i + 0.5) / song.waveDrop.length * song.duration;
            song.waveDrop[i] = song.drops.some(([a, b]) => mid >= a && mid < b) ? 1 : 0;
        }
    }
    if (g.startAt != null && g.startAt < song.duration) song.startAt = g.startAt;
}
