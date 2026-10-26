// Файл уровня .rhythm — это обычный ZIP без сжатия (mp3 и видео и так сжаты):
//   level.json — название, исполнитель, откуда уровень, биты, дропы, ноты сложностей и настройки фона;
//   audio.mp3 — песня; background.jpg / .mp4 — фон (если есть)

import { chartFor, diffsOf } from './library.js?v=3';
import { DIFFS } from './menu.js?v=7';
import { download, safeName } from './util.js?v=1';
import { newId } from './store.js?v=1';

const ms = v => Math.round(v * 1000) / 1000;
const extOf = (name, type, def) => {
    const m = /\.([a-z0-9]{2,5})$/i.exec(name || '');
    if (m) return m[1].toLowerCase();
    const t = (type || '').split('/')[1];
    return t ? t.replace('mpeg', 'mp3').replace('quicktime', 'mov').replace('jpeg', 'jpg') : def;
};

// level — уровень (library.js), song — разбор его песни
export async function exportLevel({ level, song }) {
    let audio, audioExt;
    if (level.file) {
        const res = await fetch(level.file);
        if (!res.ok) throw new Error('Не нашёл файл песни');
        audio = new Uint8Array(await res.arrayBuffer());
        audioExt = extOf(level.file, '', 'mp3');
    } else {
        audio = new Uint8Array(await level.audio.arrayBuffer());
        audioExt = extOf(level.audioName, level.audio.type, 'mp3');
    }
    const files = [];
    let background = null;
    if (level.bg) {
        const name = `background.${extOf(level.bg.name, level.bg.blob.type, level.bg.kind === 'video' ? 'mp4' : 'jpg')}`;
        const { kind, dim, offset, cut, end } = level.bg;
        background = { file: name, kind, dim, offset, cut, end };
        files.push({ name, data: new Uint8Array(await level.bg.blob.arrayBuffer()) });
    }

    const info = {
        format: 'beat-it-level',
        version: 3,
        title: level.title,
        artist: level.artist,
        author: level.source === 'preset' ? 'Waltika' : null,
        source: level.source,
        audio: `audio.${audioExt}`,
        background,
        bpm: ms(song.bpm),
        duration: ms(song.duration),
        preview: ms(song.startAt),
        beats: Array.from(song.beats, ms),
        strength: Array.from(song.strength, v => Math.round(v * 100) / 100),
        drops: song.drops.map(([a, b]) => [ms(a), ms(b)]),
        grid: level.grid || null,
        fxMode: ['auto', 'mix', 'manual'].includes(level.fxMode) ? level.fxMode : 'auto',
        effects: Array.isArray(level.effects) ? level.effects.map(f => ({
            t: ms(f.t), type: f.type, power: ms(f.power || 1), duration: ms(f.duration || 0.5), side: f.side || 'all'
        })) : [],
        difficulties: diffsOf(level).map(k => {
            const chart = chartFor(level, song, k);
            return {
                id: DIFFS[k].id,
                name: DIFFS[k].name,
                approach: chart.approach,
                notes: chart.notes.map(n => {
                    const o = { ...n, t: ms(n.t), size: ms(n.size) };
                    if (n.end != null) Object.assign(o, { end: ms(n.end), twist: ms(n.twist || 0), wiggle: ms(n.wiggle || 0) });
                    return o;
                })
            };
        }),
        exportedAt: new Date().toISOString()
    };

    const blob = zip([
        { name: 'level.json', data: new TextEncoder().encode(JSON.stringify(info)) },
        { name: info.audio, data: audio },
        ...files
    ]);
    download(blob, `${safeName(level.title)}.rhythm`);
}

// ===== Открыть чужой файл .rhythm =====

// Возвращает свой уровень (без разбора песни — его досчитает app.js) или бросает ошибку с понятным текстом
export async function importLevel(file) {
    const entries = await unzip(file);
    const get = name => entries.find(e => e.name === name);
    const json = get('level.json');
    if (!json) throw new Error('В файле нет level.json — это не уровень BEAT IT');
    let info;
    try {
        info = JSON.parse(await (await json.blob()).text());
    } catch (e) {
        throw new Error('Файл уровня повреждён');
    }
    if (info.format !== 'beat-it-level') throw new Error('Это не уровень BEAT IT');
    const audioEntry = get(info.audio);
    if (!audioEntry) throw new Error('В файле нет песни');
    const audio = await audioEntry.blob(`audio/${info.audio.endsWith('mp3') ? 'mpeg' : info.audio.split('.').pop()}`);

    let bg = null;
    if (info.background && get(info.background.file)) {
        const b = info.background;
        const ext = b.file.split('.').pop();
        const blob = await get(b.file).blob(`${b.kind}/${ext === 'jpg' ? 'jpeg' : ext === 'mov' ? 'quicktime' : ext}`);
        bg = { blob, kind: b.kind === 'video' ? 'video' : 'image', name: b.file, dim: b.dim ?? 0.55, offset: b.offset || 0, cut: b.cut || 0, end: b.end === 'dim' ? 'dim' : 'loop' };
    }

    const diffs = [];
    for (const d of info.difficulties || []) {
        const k = DIFFS.findIndex(x => x.id === d.id);
        if (k < 0 || !Array.isArray(d.notes) || diffs.some(x => x.k === k)) continue;
        diffs.push({ k, approach: Number(d.approach) || 1.5, notes: d.notes.filter(n => Number.isFinite(n.t)) });
    }
    if (!diffs.length) throw new Error('В уровне нет ни одной сложности');

    const fxTypes = new Set(['flash', 'ring', 'poly', 'square', 'stars', 'lines', 'confetti', 'shake', 'salvo']);
    const effects = (Array.isArray(info.effects) ? info.effects : []).filter(f =>
        f && fxTypes.has(f.type) && Number.isFinite(Number(f.t)) && Number(f.t) >= 0 && Number(f.t) <= Number(info.duration || Infinity)
    ).map(f => ({
        t: ms(Number(f.t)), type: f.type,
        power: Math.max(0.1, Math.min(2, Number(f.power) || 1)),
        duration: Math.max(0.05, Math.min(3, Number(f.duration) || 0.5)),
        side: ['all', 'l', 'r', 't', 'b'].includes(f.side) ? f.side : 'all'
    }));

    const fromEditor = info.source === 'editor' || info.source === 'importEditor';
    const now = Date.now();
    return {
        id: newId(),
        title: String(info.title || 'Без названия').slice(0, 80),
        artist: String(info.artist || '').slice(0, 80),
        source: fromEditor ? 'importEditor' : 'importAuto',
        created: now,
        updated: now,
        audio,
        audioName: info.audio,
        bg,
        grid: info.grid || null,
        effects,
        fxMode: ['auto', 'mix', 'manual'].includes(info.fxMode) ? info.fxMode : (effects.length ? 'mix' : 'auto'),
        diffs,
        // биты и дропы из файла; график и прочее app.js досчитает по самой песне
        given: {
            beats: Array.isArray(info.beats) ? info.beats : null,
            strength: Array.isArray(info.strength) ? info.strength : null,
            drops: Array.isArray(info.drops) ? info.drops : null,
            startAt: Number(info.preview) || null
        }
    };
}

// ===== ZIP =====

let table = null;
function crc32(data) {
    if (!table) {
        table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            table[n] = c >>> 0;
        }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zip(files) {
    const enc = new TextEncoder();
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parts = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
        const name = enc.encode(f.name);
        const crc = crc32(f.data);
        const size = f.data.length;

        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true);          // имена в UTF-8
        local.setUint16(8, 0, true);               // без сжатия
        local.setUint16(10, time, true);
        local.setUint16(12, date, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, size, true);
        local.setUint32(22, size, true);
        local.setUint16(26, name.length, true);
        parts.push(local, name, f.data);

        const entry = new DataView(new ArrayBuffer(46));
        entry.setUint32(0, 0x02014b50, true);
        entry.setUint16(4, 20, true);
        entry.setUint16(6, 20, true);
        entry.setUint16(8, 0x0800, true);
        entry.setUint16(12, time, true);
        entry.setUint16(14, date, true);
        entry.setUint32(16, crc, true);
        entry.setUint32(20, size, true);
        entry.setUint32(24, size, true);
        entry.setUint16(28, name.length, true);
        entry.setUint32(42, offset, true);
        central.push(entry, name);

        offset += 30 + name.length + size;
    }

    const cdSize = central.reduce((s, p) => s + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

// Читает оглавление ZIP с конца файла. Сами файлы не копируются, пока их не попросят (blob)
async function unzip(file) {
    const tailSize = Math.min(file.size, 65557);
    const tail = new DataView(await file.slice(file.size - tailSize).arrayBuffer());
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) {
        if (tail.getUint32(i, true) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) throw new Error('Это не файл уровня (.rhythm)');
    const count = tail.getUint16(eocd + 10, true);
    const cdSize = tail.getUint32(eocd + 12, true);
    const cdStart = tail.getUint32(eocd + 16, true);
    const cd = new DataView(await file.slice(cdStart, cdStart + cdSize).arrayBuffer());
    const dec = new TextDecoder();
    const entries = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.byteLength; i++) {
        if (cd.getUint32(p, true) !== 0x02014b50) break;
        const method = cd.getUint16(p + 10, true);
        const packed = cd.getUint32(p + 20, true);
        const nameLen = cd.getUint16(p + 28, true);
        const extraLen = cd.getUint16(p + 30, true);
        const commentLen = cd.getUint16(p + 32, true);
        const at = cd.getUint32(p + 42, true);
        const name = dec.decode(new Uint8Array(cd.buffer, p + 46, nameLen));
        entries.push({
            name,
            async blob(type = '') {
                const head = new DataView(await file.slice(at, at + 30).arrayBuffer());
                const start = at + 30 + head.getUint16(26, true) + head.getUint16(28, true);
                const raw = file.slice(start, start + packed);
                if (method === 0) return new Blob([raw], { type });
                if (method === 8 && window.DecompressionStream) {
                    const stream = raw.stream().pipeThrough(new DecompressionStream('deflate-raw'));
                    return new Blob([await new Response(stream).arrayBuffer()], { type });
                }
                throw new Error('Файл сжат так, что браузер его не откроет');
            }
        });
        p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
}
