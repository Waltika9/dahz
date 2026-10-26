// Уровни: предустановленные песни и свои (store.js). Здесь же — загрузка песни уровня и его ноты.
// Уровень: { id, title, artist, source, file | audio, start?, bg?, song?, diffs? }
//   file — путь к песне (предустановленные), audio — сам файл (свои);
//   song — сохранённый разбор песни, diffs — [{ k, approach, notes }] (у предустановленных нот нет — их собирает chart.js)

import * as music from './music.js?v=6';
import { analyzeTrack } from './analyze.js?v=3';
import { makeChart } from './chart.js?v=2';
import { listLevels } from './store.js?v=1';

// Предустановленные песни. start: 95 — в меню включать с 1:35; без него игра сама ищет дроп ближе к середине
export const PRESETS = [
    { id: 'beat-it', title: 'Beat It', artist: 'Michael Jackson', file: 'audio/beat-it.mp3' },
    { id: 'crazy', title: 'CRAZY', artist: 'LE SSERAFIM', file: 'audio/crazy.mp3' },
    { id: 'in-your-eyes', title: 'In Your Eyes', artist: 'The Weeknd', file: 'audio/in-your-eyes.mp3' },
    { id: 'flashing-lights', title: 'Flashing Lights', artist: 'Kanye West feat. Dwele', file: 'audio/flashing-lights.mp3' },
    { id: 'starboy', title: 'Starboy', artist: 'The Weeknd feat. Daft Punk', file: 'audio/starboy.mp3' },
    { id: 'padat-v-gryaz', title: 'Падать в грязь', artist: 'Монеточка', file: 'audio/padat-v-gryaz.mp3' },
    { id: 'i-want-it-that-way', title: 'I Want It That Way', artist: 'Backstreet Boys', file: 'audio/i-want-it-that-way.mp3' },
    { id: 'one-kiss', title: 'One Kiss', artist: 'Calvin Harris, Dua Lipa', file: 'audio/one-kiss.mp3' },
    { id: 'bankomat', title: 'Банкомат', artist: 'DEAD BLONDE', file: 'audio/bankomat.mp3' },
    { id: 'feel-good-inc', title: 'Feel Good Inc.', artist: 'Gorillaz', file: 'audio/feel-good-inc.mp3' },
    { id: 'night-dancer', title: 'Night Dancer', artist: 'imase', file: 'audio/night-dancer.mp3' },
    { id: 'aint-worried', title: "I Ain't Worried", artist: 'OneRepublic', file: 'audio/aint-worried.mp3' },
    { id: 'physical', title: 'Physical', artist: 'Dua Lipa', file: 'audio/physical.mp3' },
    { id: 'apt', title: 'APT.', artist: 'ROSÉ, Bruno Mars', file: 'audio/apt.mp3' },
    { id: 'blinding-lights', title: 'Blinding Lights', artist: 'The Weeknd', file: 'audio/blinding-lights.mp3' },
    { id: 'yoru-ni-kakeru', title: '夜に駆ける', artist: 'YOASOBI', file: 'audio/yoru-ni-kakeru.mp3' },
    { id: 'shoujo-a', title: '少女A', artist: '椎名もた', file: 'audio/shoujo-a.mp3' }
].map(t => ({ ...t, source: 'preset' }));

const songs = new Map();                     // id уровня → разбор песни
let last = { id: null, buffer: null };       // последняя раскодированная песня (держим одну — они большие)

// Разбор песни уровня, если он уже есть (у своих уровней он сохранён вместе с уровнем)
export function songOf(level) {
    let s = songs.get(level.id);
    if (!s && level.song) {
        s = { ...level.song, id: level.id };
        songs.set(level.id, s);
    }
    return s || null;
}

// Песня уровня: раскодированный звук и разбор (биты, дропы). Разбор считается один раз
export async function loadLevel(level) {
    let buffer = last.id === level.id ? last.buffer : null;
    if (!buffer) {
        buffer = level.file
            ? await music.fetchTrack(level.file)
            : await music.decode(await level.audio.arrayBuffer());
        last = { id: level.id, buffer };
    }
    let song = songOf(level);
    if (!song) {
        song = analyzeTrack(buffer);
        song.id = level.id;
        if (level.start != null) song.startAt = level.start;
        songs.set(level.id, song);
    }
    return { song, buffer };
}

// Песню нового уровня уже раскодировали и разобрали (окно «Создать») — второй раз не нужно
export function remember(level, buffer, song) {
    songs.set(level.id, { ...song, id: level.id });
    last = { id: level.id, buffer };
}

// Уровень изменили или удалили — старый разбор и звук больше не нужны
export function forget(id) {
    songs.delete(id);
    if (last.id === id) last = { id: null, buffer: null };
}

// Какие сложности есть у уровня (номера по DIFFS из menu.js)
export const diffsOf = level => (level.diffs ? level.diffs.map(d => d.k).sort((a, b) => a - b) : [0, 1, 2, 3, 4]);

// Ноты уровня для сложности k: свои — как сохранены, у предустановленных — из разбора песни
export function chartFor(level, song, k) {
    const d = level.diffs && level.diffs.find(x => x.k === k);
    if (!d) return makeChart(song, k, level.id);
    const notes = d.notes.map(n => ({ ...n })).sort((a, b) => a.t - b.t);
    const end = notes.reduce((m, n) => Math.max(m, n.end || n.t), 0);
    return { approach: d.approach, notes, end: notes.length ? end + 2 : song.duration };
}

// Свои уровни из браузера (если хранилище недоступно — просто пусто)
export async function userLevels() {
    try {
        return await listLevels();
    } catch (e) {
        console.warn('Свои уровни не прочитались:', e);
        return [];
    }
}

// Разбор песни, который сохраняется вместе со своим уровнем (без тяжёлого onset)
export function songToStore(song) {
    const { duration, bpm, beats, strength, drops, startAt, wave, waveDrop } = song;
    return { duration, bpm, beats, strength, drops, startAt, wave, waveDrop };
}
