// ===== Сохранение в файл .almametro =====
// Внутри: время и деньги, линии игрока, постройки и место камеры.
// JSON сжимается (gzip) и шифруется AES-GCM.
// Честно: ключ лежит в коде сайта, поэтому шифр защищает только от правки файла
// «блокнотом» (например, приписать себе денег). Изменённый или испорченный файл не откроется.
import { TYPES } from './lines.js?v=6';
import { USES, MODELS, ROADS } from './builds.js?v=9';

const MAGIC = [0x41, 0x4d, 0x53, 0x56];   // «AMSV» — по этим буквам узнаём свой файл
const VERSION = 1;
const PASSPHRASE = 'AlmaMetro · Алматы · метро, ЛРТ и SkyTrain';
export const EXT = '.almametro';

// ---------- Шифр ----------
let keyPromise = null;
function getKey() {
    if (!keyPromise) {
        keyPromise = crypto.subtle.digest('SHA-256', new TextEncoder().encode(PASSPHRASE))
            .then(raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
    }
    return keyPromise;
}

// Прогнать байты через поток (сжатие или распаковка)
async function through(bytes, stream) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

export async function packSave(obj) {
    if (!window.crypto?.subtle) throw new Error('Браузер не умеет шифровать (нужен https)');
    let bytes = new TextEncoder().encode(JSON.stringify(obj));
    const zip = typeof CompressionStream === 'function';
    if (zip) bytes = await through(bytes, new CompressionStream('gzip'));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getKey(), bytes));
    // Заголовок: AMSV, версия, сжат ли, затем iv и шифр
    const out = new Uint8Array(6 + iv.length + enc.length);
    out.set(MAGIC, 0);
    out[4] = VERSION;
    out[5] = zip ? 1 : 0;
    out.set(iv, 6);
    out.set(enc, 6 + iv.length);
    return out;
}

export async function unpackSave(buffer) {
    const b = new Uint8Array(buffer);
    if (b.length < 40 || MAGIC.some((v, i) => b[i] !== v)) throw new Error('Это не сохранение AlmaMetro');
    if (b[4] !== VERSION) throw new Error('Сохранение из другой версии игры');
    if (!window.crypto?.subtle) throw new Error('Браузер не умеет расшифровывать (нужен https)');
    let bytes;
    try {
        bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(6, 18) }, await getKey(), b.slice(18)));
    } catch (e) {
        throw new Error('Файл повреждён или был изменён');
    }
    if (b[5] & 1) {
        if (typeof DecompressionStream !== 'function') throw new Error('Браузер слишком старый — обнови его');
        bytes = await through(bytes, new DecompressionStream('gzip'));
    }
    try {
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
        throw new Error('Файл повреждён');
    }
}

// ---------- Скачать и выбрать файл ----------
export function download(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Окно выбора файла; null — если передумали
export function pickFile() {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        // Без accept: на iPhone файл с необычным расширением иначе нельзя выбрать
        input.addEventListener('change', () => resolve(input.files[0] || null));
        input.addEventListener('cancel', () => resolve(null));
        input.click();
    });
}

// ---------- Проверка содержимого ----------
// Файл могли подменить, поэтому берём только знакомые поля нужного вида:
// числа — в разумных пределах, тексты — без символов разметки
const has = (obj, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(obj, k);
const num = (v, min, max, def = 0) => {
    const n = Number(v);
    return v !== null && v !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const text = (v, max = 40) => (typeof v === 'string' ? v.replace(/[<>&"'`\\]/g, '').trim().slice(0, max) : '');
const point = p => (Array.isArray(p) && p.length >= 2 && Number.isFinite(+p[0]) && Number.isFinite(+p[1])
    && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90 ? [+p[0], +p[1]] : null);
const points = (arr, max) => (Array.isArray(arr) ? arr.slice(0, max).map(point).filter(Boolean) : []);
const color = c => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : '#2f80ed');
const ident = (v, k) => (typeof v === 'string' && /^[a-z0-9]{1,24}$/i.test(v) ? v : `${k}${Math.random().toString(36).slice(2, 10)}`);
const DAYS = 365 * 300;

// withStory = false — для «точки сохранения» главы внутри истории (без вложенной копии)
function cleanGame(g, mode, withStory = true) {
    if (!g || typeof g !== 'object') throw new Error('В файле нет игры');
    const out = {
        v: 1,
        mode,
        day: num(g.day, 0, DAYS),
        budget: num(g.budget, -1e6, 1e7),
        speed: Math.round(num(g.speed, 0, 3, 1)),
        lastSpeed: Math.round(num(g.lastSpeed, 1, 3, 1)),
        ended: ['late', 'bankrupt', 'free'].includes(g.ended) ? g.ended : null,
        won: g.won === true,
        income: num(g.income, -1e5, 1e5),
        startAverage: num(g.startAverage, 0, 5, null),
        instant: mode === 'creative' ? g.instant !== false : false,
        growth: num(g.growth, 1, 3, 1)
    };
    if (mode === 'story' && g.story && typeof g.story === 'object') out.story = cleanStory(g.story, withStory);
    return out;
}

// История: номер главы, срок, шаг обучения и копия игры на начало главы (чтобы переиграть)
function cleanStory(s, withCheckpoint) {
    const cp = s.checkpoint;
    return {
        chapter: Math.round(num(s.chapter, 0, 20)),
        hard: s.hard === true,
        tutorial: s.tutorial === true,
        step: Math.round(num(s.step, 0, 50)),
        start: num(s.start, 0, DAYS),
        deadline: num(s.deadline, 0, DAYS, null),
        startAvg: num(s.startAvg, 0, 5, null),
        yearly: num(s.yearly, 0, 1e4, 100),
        done: s.done === true,
        checkpoint: withCheckpoint && cp && typeof cp === 'object' && cp.game
            ? { game: cleanGame(cp.game, 'story', false), lines: cleanLines(cp.lines), builds: cleanBuilds(cp.builds) }
            : null
    };
}

function cleanNodes(list) {
    return (Array.isArray(list) ? list.slice(0, 600) : []).map(n => {
        const c = point(n && n.c);
        return c && { c, s: n.s ? text(n.s) || 'Станция' : null };
    }).filter(Boolean);
}

function cleanLines(list) {
    return (Array.isArray(list) ? list.slice(0, 100) : []).map(l => {
        if (!l || !has(TYPES, l.type)) return null;
        const nodes = cleanNodes(l.nodes);
        if (nodes.filter(n => n.s).length < 2) return null;
        const line = {
            id: ident(l.id, 'l'), type: l.type, name: text(l.name) || 'Линия', color: color(l.color), nodes,
            start: num(l.start, 0, DAYS), ready: num(l.ready, 0, DAYS), cost: num(l.cost, 0, 1e5)
        };
        // строящееся продление: конец линии и новые узлы (хотя бы одна станция)
        const e = l.ext;
        if (e && typeof e === 'object' && (e.end === 'head' || e.end === 'tail')) {
            const ext = cleanNodes(e.nodes);
            if (ext.some(n => n.s)) line.ext = { end: e.end, nodes: ext, start: num(e.start, 0, DAYS), ready: num(e.ready, 0, DAYS), cost: num(e.cost, 0, 1e5) };
        }
        return line;
    }).filter(Boolean);
}

function cleanBuilds(list) {
    return (Array.isArray(list) ? list.slice(0, 400) : []).map(b => {
        if (!b) return null;
        const base = { id: ident(b.id, 'b'), kind: b.kind, name: text(b.name) || 'Постройка',
                       start: num(b.start, 0, DAYS), ready: num(b.ready, 0, DAYS) };
        if (b.cost != null) base.cost = num(b.cost, 0, 1e5);
        if (b.kind === 'custom' && has(USES, b.use)) {
            const ring = points(b.ring, 80);
            return ring.length >= 3 && { ...base, use: b.use, floors: Math.round(num(b.floors, 1, 100, 1)), ring };
        }
        if (b.kind === 'model' && has(MODELS, b.model) && point(b.c)) {
            return { ...base, model: b.model, c: point(b.c), a: num(b.a, -7, 7) };
        }
        if (b.kind === 'road' && has(ROADS, b.road)) {
            const nodes = points(b.nodes, 400);
            const spans = (Array.isArray(b.spans) ? b.spans.slice(0, 200) : []).map(s => s && ({
                s0: num(s.s0, 0, 1e5), s1: num(s.s1, 0, 1e5), h: num(s.h, 0, 20, 4), ramp: num(s.ramp, 1, 200, 25)
            })).filter(s => s && s.s1 > s.s0);
            return nodes.length >= 2 && { ...base, road: b.road, raised: b.raised === true, nodes, spans };
        }
        return null;
    }).filter(Boolean);
}

function cleanCamera(c) {
    const center = point(c && c.center);
    if (!center) return null;
    return { center, zoom: num(c.zoom, 9.5, 18, 14), pitch: num(c.pitch, 0, 75, 60), bearing: num(c.bearing, -360, 360) };
}

// Проверенное сохранение: { mode, savedAt, game, lines, builds, camera }
export function cleanSave(obj) {
    if (!obj || obj.kind !== 'almametro-save') throw new Error('Это не сохранение AlmaMetro');
    const mode = ['creative', 'story'].includes(obj.mode) ? obj.mode : 'free';
    return {
        mode,
        savedAt: num(obj.savedAt, 0, 8.64e15, Date.now()),
        game: cleanGame(obj.game, mode),
        lines: cleanLines(obj.lines),
        builds: cleanBuilds(obj.builds),
        camera: cleanCamera(obj.camera)
    };
}
