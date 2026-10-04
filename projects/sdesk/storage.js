/* Short Desk — хранение: ZIP-архивы досок, формат board.json, встроенные файлы
   с дедупликацией, импорт и экспорт, перетаскивание файлов в окно и вставка из буфера.

   ФАЙЛ ДОСКИ (.tiles) — обычный ZIP, его можно открыть любым архиватором:
     board.json                    описание доски, сжат DEFLATE на максимум (уровень 9)
     preview.png                   маленькая картинка доски (необязательно)
     assets/<sha256>.<расширение>  встроенные файлы с исходными байтами (без base64).
                                   Имя — хеш содержимого, поэтому одинаковый файл
                                   хранится один раз, сколько бы плиток его ни использовало.
                                   Уже сжатые форматы (png, jpg, mp3, mp4, zip…) лежат без
                                   повторного сжатия (STORE), остальные — DEFLATE.

   board.json, версия формата 1:
     {
       "format": "short-desk", "version": 1, "app": "Short Desk", "saved": "<дата ISO>",
       "view":   { "x": центр вида по X, "y": по Y, "k": масштаб },
       "tiles":  [{ "id", "type", "x", "y", "w", "h", "name"?, "color"?, "fields": {…},
                    "asset"?: "<sha256>.<ext>", "fileName"?: "исходное имя", "log"?: ["строки «Вывода»"] }],
       "links":  [{ "id", "from": { "tile", "port" }, "to": { "tile", "port" },
                    "points": [{ "id", "x", "y" }], "bend": "curve" | "angle", "color"? }],
                  (конец линии может быть магнитом: тогда "tile" — id магнита, "port" — in/out;
                   автосвязи магнитов не сохраняются, они строятся заново)
       "targets": [{ "id", "name", "x", "y", "color"? }],
       "magnets": [{ "id", "name", "x", "y", "r", "color"? }],
       Поля-ссылки плиток («Что», «Куда», «Где», «Связь») хранят 't:id', 'g:id', 'p:idЛинии/idТочки'
       или '@xy'; при загрузке они пересчитываются на новые id.
       "assets": { "<sha256>.<ext>": { "name", "type", "size" } }
     }
   Когда формат поменяется, version вырастет, а migrate() будет поднимать старые файлы
   до новой версии шаг за шагом — поэтому старые доски всегда откроются.

   ZIP собирается своим кодом: большие файлы не копируются в память, архив складывается
   из ссылок на них (Blob), а при открытии файлы — это «срезы» самого архива.
   DEFLATE делает библиотека fflate (jsDelivr): она маленькая, быстрая, умеет уровень 9
   и сжимает в фоновом потоке. Если она не загрузилась, работает встроенный в браузер
   CompressionStream. */
const Storage = (() => {
    const FORMAT = 'short-desk';
    const VERSION = 1;
    const FFLATE_URL = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js';
    const MB = 1024 * 1024;
    const BIG_ARCHIVE = 100 * MB;       // больше — спрашиваем, точно ли сохранять
    const HASH_FULL = 256 * MB;         // до этого размера хеш считается по всему файлу
    const DEFLATE_MAX = 64 * MB;        // большие несжатые файлы кладём как есть, чтобы не забивать память
    const STORED = new Set(('png jpg jpeg gif webp avif heic heif ico mp3 m4a aac ogg oga opus flac mp4 m4v mov ' +
        'webm mkv avi wmv 3gp zip rar 7z gz tgz bz2 xz zst docx xlsx pptx odt ods odp epub jar apk pdf woff woff2 tiles').split(' '));
    const TEXT_EXT = new Set(('txt md markdown csv tsv json js mjs ts jsx tsx py java c h cpp hpp cs go rs rb php ' +
        'html htm css scss xml yaml yml ini cfg conf log sql sh bat ps1 tex srt').split(' '));
    const MIME = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
        avif: 'image/avif', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
        mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg',
        mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4',
        aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/opus',
        txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
        html: 'text/html', css: 'text/css', js: 'text/javascript', xml: 'application/xml',
        pdf: 'application/pdf', zip: 'application/zip'
    };
    const TILE_FOR = { image: 'image', video: 'video', audio: 'audio', text: 'textfile', file: 'file' };

    // Понятная пользователю ошибка (её текст показывается как есть)
    class UserError extends Error {}
    const broken = () => new UserError('Архив повреждён: часть данных не читается.');

    const assets = new Map();           // id → { id, name, type, size, blob, url, crc }
    let fflateLoad = null, pruneTimer = 0;

    function init() {
        Board.on('pick', id => pickForTile(id));
        Board.on('tiles', () => {
            clearTimeout(pruneTimer);
            pruneTimer = setTimeout(prune, 3000);
        });
        Board.on('change', () => scheduleAutosave(700));
        Board.on('view', () => scheduleAutosave(1500));
        // вкладку закрывают или прячут — сохраняем сразу
        window.addEventListener('pagehide', () => autosave());
        document.addEventListener('visibilitychange', () => { if (document.hidden) autosave(); });
        initDrop();
        initPaste();
    }

    /* ---------- Автосохранение в браузере ----------
       Доска сама сохраняется в IndexedDB этого браузера (вместе со встроенными файлами)
       и открывается снова после обновления страницы, закрытия браузера или ухода назад.
       Пропадает она, только если её очистить кнопкой или стереть данные сайта в браузере. */
    const DB_NAME = 'short-desk', DB_VERSION = 1;
    let db = null, autosaveOk = false, saveTimer = 0, pending = false, saving = false, restoring = false;
    let savedAssets = new Set(), quotaWarned = false;

    function openDB() {
        return new Promise((ok, bad) => {
            if (!window.indexedDB) { bad(new Error('IndexedDB недоступен')); return; }
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                req.result.createObjectStore('board');
                req.result.createObjectStore('assets');
            };
            req.onsuccess = () => ok(req.result);
            req.onerror = () => bad(req.error);
        });
    }

    const request = r => new Promise((ok, bad) => { r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
    const finished = tx => new Promise((ok, bad) => { tx.oncomplete = ok; tx.onerror = () => bad(tx.error); tx.onabort = () => bad(tx.error); });

    function scheduleAutosave(delay) {
        if (restoring || !db) return;
        pending = true;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(autosave, delay);
    }

    async function autosave() {
        clearTimeout(saveTimer);
        if (!db || restoring || !pending) return;
        if (saving) { scheduleAutosave(300); return; }
        saving = true;
        pending = false;
        try {
            const { data, files } = serialize(false);
            const tx = db.transaction(['board', 'assets'], 'readwrite');
            tx.objectStore('board').put(data, 'current');
            const store = tx.objectStore('assets'), used = new Set();
            for (const a of files) {
                used.add(a.id);
                if (!savedAssets.has(a.id)) store.put({ id: a.id, name: a.name, type: a.type, size: a.size, blob: a.blob, crc: a.crc }, a.id);
            }
            for (const id of savedAssets) if (!used.has(id)) store.delete(id);
            await finished(tx);
            savedAssets = used;
            autosaveOk = true;
        } catch (err) {
            pending = true;
            if (!quotaWarned && err && err.name === 'QuotaExceededError') {
                quotaWarned = true;
                UI.alert({
                    title: 'Не хватает места',
                    text: 'Браузер не даёт сохранить доску — на ней слишком большие файлы. Сохраните доску в файл: ПКМ по «+» → «Сохранить доску».'
                });
            }
            autosaveOk = false;
        } finally {
            saving = false;
        }
    }

    // При запуске: открыть доску, сохранённую в браузере
    async function restore() {
        try {
            db = await openDB();
        } catch {
            return false;
        }
        autosaveOk = true;
        try {
            const tx = db.transaction(['board', 'assets'], 'readonly');
            const data = await request(tx.objectStore('board').get('current'));
            const stored = await request(tx.objectStore('assets').getAll());
            if (!data || !Array.isArray(data.tiles)) return false;
            const d = migrate(data);
            if (!d.tiles.length && !d.targets.length && !d.magnets.length) return false;
            const found = new Map();
            for (const a of stored) if (a && a.id && a.blob) found.set(a.id, { ...a, url: null });
            restoring = true;
            place(d, found, null, true);
            savedAssets = new Set(found.keys());
            const v = d.view || {};
            if (Number.isFinite(v.x) && Number.isFinite(v.y)) Board.centerOn(v.x, v.y, Number(v.k) || 1);
            Board.clearSelection();
            Board.markSaved();
            return true;
        } catch (err) {
            console.error(err);
            UI.toast('Сохранённую доску не удалось открыть');
            return false;
        } finally {
            restoring = false;
        }
    }

    // Есть изменения, которые ещё не успели попасть в браузер?
    const unsaved = () => !autosaveOk || pending || saving;

    /* ---------- Мелочи ---------- */
    const r1 = n => Math.round(n * 10) / 10;

    function extOf(name = '', type = '') {
        const m = /\.([a-z0-9]{1,10})$/i.exec(name);
        if (m) return m[1].toLowerCase();
        const t = (type.split('/')[1] || '').replace('jpeg', 'jpg').replace('svg+xml', 'svg').replace(/[^a-z0-9]/g, '');
        return t.slice(0, 10) || 'bin';
    }

    function kindOf(name, type = '') {
        const ext = extOf(name, type);
        if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico'].includes(ext)) return 'image';
        if (type.startsWith('video/') || ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv'].includes(ext)) return 'video';
        if (type.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) return 'audio';
        if (type.startsWith('text/') || TEXT_EXT.has(ext) || type === 'application/json') return 'text';
        return 'file';
    }

    function fmtSize(n) {
        if (n < 1024) return n + ' Б';
        if (n < MB) return (n / 1024).toFixed(n < 10240 ? 1 : 0).replace('.', ',') + ' КБ';
        if (n < 1024 * MB) return (n / MB).toFixed(n < 10 * MB ? 1 : 0).replace('.', ',') + ' МБ';
        return (n / 1024 / MB).toFixed(1).replace('.', ',') + ' ГБ';
    }

    function stamp() {
        const d = new Date(), p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    }

    const safeName = s => String(s).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'файл';

    function download(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    function report(err, title) {
        if (!(err instanceof UserError)) console.error(err);
        UI.alert({ title, text: err instanceof UserError ? err.message : 'Что-то пошло не так: ' + (err && err.message || err) });
    }

    /* ---------- Встроенные файлы ---------- */
    const asset = id => assets.get(id) || null;

    function url(a) {
        if (!a.url) a.url = URL.createObjectURL(a.blob);
        return a.url;
    }

    // Файл попадает в хранилище один раз: id = sha256 содержимого + расширение
    async function addAsset(blob, name) {
        const type = blob.type || MIME[extOf(name)] || '';
        const id = (await hashBlob(blob)) + '.' + extOf(name, type);
        let a = assets.get(id);
        if (!a) {
            a = { id, name: name || id, type, size: blob.size, blob: type && !blob.type ? blob.slice(0, blob.size, type) : blob, url: null, crc: null };
            assets.set(id, a);
        }
        return a;
    }

    // Убираем файлы, которыми больше не пользуется ни одна плитка
    function prune() {
        const used = new Set();
        for (const t of Board.tiles.values()) {
            if (t.asset) used.add(t.asset);
            if (t.logAssets) for (const id of t.logAssets) used.add(id);
        }
        for (const [id, a] of assets) {
            if (used.has(id)) continue;
            if (a.url) URL.revokeObjectURL(a.url);
            assets.delete(id);
        }
    }

    const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');

    async function hashBlob(blob) {
        let data = blob;
        if (blob.size > HASH_FULL) {
            // огромный файл: хешируем размер, начало, середину и конец — без чтения всего файла в память
            const part = 4 * MB, mid = Math.floor(blob.size / 2);
            data = new Blob([String(blob.size), blob.slice(0, part), blob.slice(mid - part / 2, mid + part / 2), blob.slice(blob.size - part)]);
        }
        if (window.crypto && crypto.subtle) return hex(await crypto.subtle.digest('SHA-256', await data.arrayBuffer()));
        // без https (например, файл открыт с диска) WebCrypto недоступен — берём CRC32 и размер
        return 'crc' + (await crcOfBlob(data)).toString(16).padStart(8, '0') + blob.size.toString(16);
    }

    /* ---------- CRC32 и сжатие ---------- */
    const CRC_TABLE = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            t[n] = c >>> 0;
        }
        return t;
    })();

    function crc32(u8, crc = 0) {
        let c = crc ^ -1;
        for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ -1) >>> 0;
    }

    // CRC файла по кусочкам — файл целиком в память не попадает
    async function crcOfBlob(blob) {
        const reader = blob.stream().getReader();
        let crc = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) return crc;
            crc = crc32(value, crc);
        }
    }

    function loadFflate() {
        if (window.fflate) return Promise.resolve(window.fflate);
        if (!fflateLoad) {
            fflateLoad = new Promise(resolve => {
                const s = document.createElement('script');
                s.src = FFLATE_URL;
                s.async = true;
                const timer = setTimeout(() => resolve(null), 10000);
                s.onload = () => { clearTimeout(timer); resolve(window.fflate || null); };
                s.onerror = () => { clearTimeout(timer); fflateLoad = null; resolve(null); };
                document.head.append(s);
            });
        }
        return fflateLoad;
    }

    const through = async (u8, stream) =>
        new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer());

    async function deflate(u8) {
        const f = await loadFflate();
        if (f) {
            try {
                return await new Promise((ok, bad) => f.deflate(u8, { level: 9 }, (e, out) => (e ? bad(e) : ok(out))));
            } catch {
                return f.deflateSync(u8, { level: 9 });
            }
        }
        if (window.CompressionStream) return through(u8, new CompressionStream('deflate-raw'));
        throw new UserError('Не удалось загрузить модуль сжатия. Проверьте подключение к интернету.');
    }

    async function inflate(u8) {
        const f = await loadFflate();
        if (f) {
            try {
                return await new Promise((ok, bad) => f.inflate(u8, (e, out) => (e ? bad(e) : ok(out))));
            } catch {
                return f.inflateSync(u8);
            }
        }
        if (window.DecompressionStream) return through(u8, new DecompressionStream('deflate-raw'));
        throw new UserError('Не удалось загрузить модуль сжатия. Проверьте подключение к интернету.');
    }

    /* ---------- ZIP: запись ----------
       entries: [{ name, data: Blob | Uint8Array, deflate: bool, crc? }] */
    async function makeZip(entries) {
        if (entries.length > 65535) throw new UserError('Слишком много файлов для одного архива.');
        const enc = new TextEncoder();
        const now = new Date();
        const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
        const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
        const parts = [], central = [];
        let offset = 0;

        for (const e of entries) {
            const name = enc.encode(e.name);
            let body, crc, usize, method = 0;
            if (e.deflate) {
                const raw = e.data instanceof Uint8Array ? e.data : new Uint8Array(await e.data.arrayBuffer());
                crc = crc32(raw);
                usize = raw.length;
                const packed = await deflate(raw);
                if (packed.length < raw.length) { body = packed; method = 8; } else body = raw;
            } else {
                body = e.data;                                   // Blob кладётся ссылкой, без копии
                usize = body.size != null ? body.size : body.length;
                crc = e.crc != null ? e.crc : await crcOfBlob(body instanceof Blob ? body : new Blob([body]));
            }
            const csize = body.size != null ? body.size : body.length;
            const h = new DataView(new ArrayBuffer(30));
            h.setUint32(0, 0x04034b50, true);       // подпись локального заголовка
            h.setUint16(4, 20, true);               // версия 2.0
            h.setUint16(6, 0x0800, true);           // имена в UTF-8
            h.setUint16(8, method, true);
            h.setUint16(10, time, true);
            h.setUint16(12, date, true);
            h.setUint32(14, crc, true);
            h.setUint32(18, csize, true);
            h.setUint32(22, usize, true);
            h.setUint16(26, name.length, true);
            parts.push(h.buffer, name, body);
            central.push({ name, method, crc, csize, usize, offset });
            offset += 30 + name.length + csize;
            if (offset > 0xFFFFFFFF) throw new UserError('Архив получается больше 4 ГБ — такой ZIP не поддерживается.');
        }

        const cdStart = offset;
        for (const c of central) {
            const h = new DataView(new ArrayBuffer(46));
            h.setUint32(0, 0x02014b50, true);       // подпись записи оглавления
            h.setUint16(4, 20, true);
            h.setUint16(6, 20, true);
            h.setUint16(8, 0x0800, true);
            h.setUint16(10, c.method, true);
            h.setUint16(12, time, true);
            h.setUint16(14, date, true);
            h.setUint32(16, c.crc, true);
            h.setUint32(20, c.csize, true);
            h.setUint32(24, c.usize, true);
            h.setUint16(28, c.name.length, true);
            h.setUint32(42, c.offset, true);
            parts.push(h.buffer, c.name);
            offset += 46 + c.name.length;
        }
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true);         // конец оглавления
        end.setUint16(8, central.length, true);
        end.setUint16(10, central.length, true);
        end.setUint32(12, offset - cdStart, true);
        end.setUint32(16, cdStart, true);
        parts.push(end.buffer);
        return new Blob(parts, { type: 'application/zip' });
    }

    /* ---------- ZIP: чтение ----------
       Читается только оглавление в конце файла; содержимое берётся срезами по требованию. */
    async function readZip(file) {
        const tailSize = Math.min(file.size, 22 + 65535);
        const tail = new DataView(await file.slice(file.size - tailSize).arrayBuffer());
        let at = -1;
        for (let i = tailSize - 22; i >= 0; i--) {
            if (tail.getUint32(i, true) === 0x06054b50) { at = i; break; }
        }
        if (at < 0) throw new UserError('Это не ZIP-архив или он повреждён.');
        const count = tail.getUint16(at + 10, true);
        const cdSize = tail.getUint32(at + 12, true), cdOff = tail.getUint32(at + 16, true);
        if (cdOff === 0xFFFFFFFF || count === 0xFFFF) throw new UserError('Слишком большой архив (ZIP64) — такие не поддерживаются.');
        if (cdOff + cdSize > file.size) throw broken();

        const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
        const dec = new TextDecoder();
        const entries = new Map();
        let p = 0;
        for (let k = 0; k < count; k++) {
            if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== 0x02014b50) throw broken();
            const nlen = cd.getUint16(p + 28, true), elen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true);
            const name = dec.decode(new Uint8Array(cd.buffer, p + 46, nlen));
            entries.set(name, {
                name,
                flags: cd.getUint16(p + 8, true),
                method: cd.getUint16(p + 10, true),
                crc: cd.getUint32(p + 16, true),
                csize: cd.getUint32(p + 20, true),
                usize: cd.getUint32(p + 24, true),
                offset: cd.getUint32(p + 42, true)
            });
            p += 46 + nlen + elen + clen;
        }
        return entries;
    }

    async function entryData(file, e) {
        if (e.flags & 1) throw new UserError('Архив защищён паролем — такие не поддерживаются.');
        const lh = new DataView(await file.slice(e.offset, e.offset + 30).arrayBuffer());
        if (lh.byteLength < 30 || lh.getUint32(0, true) !== 0x04034b50) throw broken();
        const start = e.offset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
        const raw = file.slice(start, start + e.csize);
        if (raw.size !== e.csize) throw broken();
        if (e.method !== 0 && e.method !== 8) throw new UserError('В архиве неизвестный способ сжатия.');
        return raw;
    }

    // Содержимое записи как байты (с проверкой CRC) — для board.json
    async function entryBytes(file, e) {
        const raw = new Uint8Array(await (await entryData(file, e)).arrayBuffer());
        let out = raw;
        if (e.method === 8) {
            try { out = await inflate(raw); } catch { throw broken(); }
        }
        if (out.length !== e.usize || crc32(out) !== e.crc) throw broken();
        return out;
    }

    // Содержимое записи как Blob: без сжатия — это просто срез архива, без копии
    async function entryBlob(file, e, type) {
        const raw = await entryData(file, e);
        if (e.method === 0) return raw.slice(0, raw.size, type);
        let out;
        try { out = await inflate(new Uint8Array(await raw.arrayBuffer())); } catch { throw broken(); }
        return new Blob([out], { type });
    }

    /* ---------- Формат board.json ---------- */
    function serialize(onlySelected) {
        const ids = new Set(onlySelected
            ? [...Board.selectedTiles(), ...Board.selectedItems()]
            : [...Board.tiles.keys(), ...Board.targets.keys(), ...Board.magnets.keys()]);
        const tiles = [], links = [], used = new Map();
        const targets = [...Board.targets.values()].filter(g => ids.has(g.id)).map(g => ({
            id: g.id, name: g.name, x: r1(g.x), y: r1(g.y), ...(g.color ? { color: g.color } : {})
        }));
        const magnets = [...Board.magnets.values()].filter(m => ids.has(m.id)).map(m => ({
            id: m.id, name: m.name, x: r1(m.x), y: r1(m.y), r: m.r, ...(m.color ? { color: m.color } : {})
        }));
        for (const t of Board.tiles.values()) {
            if (!ids.has(t.id)) continue;
            const o = { id: t.id, type: t.type, x: r1(t.x), y: r1(t.y), w: t.w, h: t.h, fields: t.fields };
            if (t.name) o.name = t.name;
            if (t.color) o.color = t.color;
            if (t.asset) {
                o.asset = t.asset;
                if (t.fileName) o.fileName = t.fileName;
                const a = assets.get(t.asset);
                if (a) used.set(a.id, a);
            }
            if (t.log && t.log.length) o.log = t.log.slice(-200);
            tiles.push(o);
        }
        for (const l of Board.links.values()) {
            // автосвязи магнитов не сохраняются — после загрузки магниты построят их заново
            if (l.auto || !ids.has(l.from.tile) || !ids.has(l.to.tile)) continue;
            const o = { id: l.id, from: l.from, to: l.to, points: l.points.map(p => ({ id: p.id, x: r1(p.x), y: r1(p.y) })), bend: l.bend };
            if (l.color) o.color = l.color;
            links.push(o);
        }
        const c = Board.visibleCenter();
        const data = {
            format: FORMAT, version: VERSION, app: 'Short Desk', saved: new Date().toISOString(),
            view: { x: r1(c.x), y: r1(c.y), k: Math.round(Board.view.k * 1000) / 1000 },
            tiles, links, targets, magnets,
            assets: Object.fromEntries([...used.values()].map(a => [a.id, { name: a.name, type: a.type, size: a.size }]))
        };
        return { data, files: [...used.values()] };
    }

    // Проверка и подъём старых версий формата
    function migrate(d) {
        if (!d || typeof d !== 'object' || d.format !== FORMAT) throw new UserError('Это не доска Short Desk.');
        const v = Number(d.version);
        if (!Number.isInteger(v) || v < 1) throw new UserError('Не удаётся понять версию формата доски.');
        if (v > VERSION) throw new UserError(`Доска сохранена более новой версией Short Desk (формат ${v}). Обновите страницу.`);
        // здесь появятся шаги вида: if (d.version === 1) { …; d.version = 2; }
        if (!Array.isArray(d.tiles)) throw broken();
        d.links = Array.isArray(d.links) ? d.links : [];
        d.targets = Array.isArray(d.targets) ? d.targets : [];
        d.magnets = Array.isArray(d.magnets) ? d.magnets : [];
        d.assets = d.assets && typeof d.assets === 'object' ? d.assets : {};
        return d;
    }

    function parseJSON(bytes) {
        try {
            return JSON.parse(new TextDecoder().decode(bytes));
        } catch {
            throw new UserError('Доску не удаётся прочитать: файл повреждён или это не доска Short Desk.');
        }
    }

    const isNum = n => typeof n === 'number' && Number.isFinite(n);
    const colorOk = c => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : null);
    function cleanFields(f) {
        const out = {};
        if (f && typeof f === 'object') {
            for (const [k, v] of Object.entries(f)) if (['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
        }
        return out;
    }

    /* ---------- Открытие досок ---------- */
    async function isBoardFile(f) {
        const ext = extOf(f.name);
        if (ext === 'tiles') return true;
        if (ext === 'zip') {
            try { return [...(await readZip(f)).keys()].some(n => n === 'board.json' || n.endsWith('/board.json')); } catch { return false; }
        }
        if (ext === 'json' && f.size < 64 * MB) {
            try { return JSON.parse(await f.text()).format === FORMAT; } catch { return false; }
        }
        return false;
    }

    // Читаем доску целиком, и только потом что-то создаём — ошибка не испортит текущую доску
    async function readBoard(file) {
        const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
        if (!(head[0] === 0x50 && head[1] === 0x4B)) {
            return { data: migrate(parseJSON(new Uint8Array(await file.arrayBuffer()))), found: new Map() };
        }
        const zip = await readZip(file);
        const boardName = [...zip.keys()]
            .filter(n => n === 'board.json' || n.endsWith('/board.json'))
            .sort((a, b) => a.length - b.length)[0];
        if (!boardName) throw new UserError('В архиве нет board.json — это не доска Short Desk.');
        const base = boardName.slice(0, -'board.json'.length);
        const data = migrate(parseJSON(await entryBytes(file, zip.get(boardName))));

        const found = new Map();
        for (const t of data.tiles) {
            const id = t && typeof t.asset === 'string' ? t.asset : null;
            if (!id || found.has(id) || assets.has(id)) continue;
            const e = zip.get(base + 'assets/' + id);
            if (!e) continue;                  // файла нет — плитка покажет «файл не найден»
            const meta = data.assets[id] || {};
            const type = meta.type || MIME[extOf(id)] || '';
            found.set(id, { id, name: String(meta.name || id), type, size: e.usize, blob: await entryBlob(file, e, type), url: null, crc: e.crc });
        }
        return { data, found };
    }

    // Загруженное появляется в свободном месте рядом с видом, не задевая объекты на доске.
    // exact — поставить всё ровно туда, где было (восстановление доски из браузера).
    function place(data, found, at, exact = false) {
        const ok = data.tiles.filter(t => t && Nodes.get(t.type) && isNum(t.x) && isNum(t.y));
        const tgs = data.targets.filter(g => g && isNum(g.x) && isNum(g.y));
        const mgs = data.magnets.filter(m => m && isNum(m.x) && isNum(m.y));
        const skipped = data.tiles.length - ok.length;
        if (!ok.length && !tgs.length && !mgs.length) throw new UserError('В этой доске нет ничего, что можно открыть.');
        for (const [id, a] of found) if (!assets.has(id)) assets.set(id, a);

        // общая рамка загружаемого
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        const grow = (x, y, w, h) => {
            x1 = Math.min(x1, x); y1 = Math.min(y1, y);
            x2 = Math.max(x2, x + w); y2 = Math.max(y2, y + h);
        };
        for (const t of ok) {
            const d = Nodes.get(t.type);
            grow(t.x, t.y, isNum(t.w) && t.w > 0 ? t.w : d.width, isNum(t.h) && t.h > 0 ? t.h : Nodes.estimateHeight(d));
        }
        for (const g of tgs) grow(g.x - 24, g.y - 24, 48, 64);
        for (const m of mgs) grow(m.x - 42, m.y - 28, 84, 72);
        const near = at || Board.visibleCenter();
        const spot = exact ? { x: x1, y: y1 } : Board.freeSpot(x2 - x1, y2 - y1, near.x, near.y);
        const dx = spot.x - x1, dy = spot.y - y1;
        const animate = !exact;

        const map = new Map();          // старый id → новый (плитки и магниты — концы линий)
        const refs = new Map();         // старая ссылка поля → новая
        const tileIds = [], itemIds = [];
        for (const t of ok) {
            const tile = Board.addTile(t.type, {
                x: t.x + dx, y: t.y + dy, animate,
                name: typeof t.name === 'string' ? t.name.slice(0, 80) : '',
                color: colorOk(t.color), fields: cleanFields(t.fields),
                asset: typeof t.asset === 'string' ? t.asset : null,
                fileName: typeof t.fileName === 'string' ? t.fileName : '',
                assetMeta: t.asset ? data.assets[t.asset] || null : null,
                log: Array.isArray(t.log) ? t.log : null
            });
            map.set(t.id, tile.id);
            refs.set('t:' + t.id, 't:' + tile.id);
            tileIds.push(tile.id);
        }
        const name = n => (typeof n === 'string' && n.trim() ? n.slice(0, 60) : '');
        for (const g of tgs) {
            const it = Board.addTarget({ x: g.x + dx, y: g.y + dy, name: name(g.name), color: colorOk(g.color), animate });
            refs.set('g:' + g.id, 'g:' + it.id);
            itemIds.push(it.id);
        }
        for (const m of mgs) {
            const it = Board.addMagnet({ x: m.x + dx, y: m.y + dy, r: m.r, name: name(m.name), color: colorOk(m.color), animate });
            map.set(m.id, it.id);
            refs.set('m:' + m.id, 'm:' + it.id);
            itemIds.push(it.id);
        }
        for (const l of data.links) {
            const a = l && l.from && map.get(l.from.tile), b = l && l.to && map.get(l.to.tile);
            if (!a || !b) continue;
            const pts = (Array.isArray(l.points) ? l.points : []).filter(p => p && isNum(p.x) && isNum(p.y));
            const made = Board.addLink({ tile: a, port: l.from.port }, { tile: b, port: l.to.port }, {
                points: pts.map(p => ({ x: p.x + dx, y: p.y + dy })),
                bend: l.bend, color: colorOk(l.color), animate
            });
            if (made) pts.forEach((p, i) => { if (p.id) refs.set(`p:${l.id}/${p.id}`, `p:${made.id}/${made.points[i].id}`); });
        }
        // ссылки на объекты, которых нет в загруженном, очищаются — иначе они указали бы на чужие объекты
        Board.remapRefs(tileIds, refs, true);
        return { ids: tileIds, items: itemIds, skipped };
    }

    /* ---------- Импорт файлов ---------- */
    // files — из проводника, перетаскивания или буфера обмена; at — точка доски; target — плитка под курсором
    async function importFiles(list, { at = null, target = null } = {}) {
        const files = [...list].filter(Boolean);
        if (!files.length) return;
        const boards = [], plain = [];
        for (const f of files) (await isBoardFile(f) ? boards : plain).push(f);

        // один файл брошен на подходящую медиаплитку — предлагаем заменить её содержимое
        if (!boards.length && plain.length === 1 && target && target.def.media) {
            const f = plain[0];
            if (target.def.media === kindOf(f.name, f.type) || target.def.media === 'file') {
                const old = target.fileName || (target.asset && asset(target.asset) && asset(target.asset).name);
                const yes = !target.asset || await UI.confirm({
                    title: 'Заменить файл?',
                    text: `Положить «${f.name}» в плитку «${Nodes.titleOf(target)}»${old ? ` вместо «${old}»` : ''}?`,
                    ok: 'Заменить'
                });
                if (yes) {
                    const a = await addAsset(f, f.name);
                    Board.setTileAsset(target.id, a.id, f.name);
                    Board.flash(target.id);
                    return;
                }
            }
        }

        const made = [], madeItems = [];
        let skipped = 0;
        for (const f of boards) {
            try {
                const { data, found } = await readBoard(f);
                const res = place(data, found, at);
                made.push(...res.ids);
                madeItems.push(...res.items);
                skipped += res.skipped;
            } catch (err) {
                report(err, `Не удалось открыть «${f.name}»`);
            }
        }
        if (plain.length) {
            try {
                made.push(...await addFileTiles(plain, at));
            } catch (err) {
                report(err, 'Не удалось добавить файлы');
            }
        }
        if (!made.length && !madeItems.length) return;
        Board.selectObjects({ tiles: made, items: madeItems });
        reveal(made, madeItems);
        if (skipped) UI.toast(`Пропущено плиток неизвестного типа: ${skipped}`);
    }

    // Несколько файлов раскладываются аккуратной сеткой в свободном месте
    async function addFileTiles(files, at) {
        const items = [];
        for (const f of files) {
            const a = await addAsset(f, f.name);
            items.push({ a, name: f.name, type: TILE_FOR[kindOf(f.name, a.type)] });
        }
        const cols = Math.ceil(Math.sqrt(items.length));
        const rows = Math.ceil(items.length / cols);
        const cellW = Math.max(...items.map(i => Nodes.get(i.type).width)) + 32;
        const cellH = Math.max(...items.map(i => Nodes.estimateHeight(Nodes.get(i.type)))) + 32;
        const near = at || Board.visibleCenter();
        const spot = Board.freeSpot(cols * cellW - 32, rows * cellH - 32, near.x, near.y);
        return items.map((it, i) => Board.addTile(it.type, {
            x: spot.x + (i % cols) * cellW, y: spot.y + Math.floor(i / cols) * cellH,
            asset: it.a.id, fileName: it.name, animate: true
        }).id);
    }

    // Плавно показываем загруженное и подсвечиваем его
    function reveal(ids, itemIds = []) {
        const list = ids.map(id => Board.getTile(id)).filter(Boolean);
        const boxes = [...list, ...itemIds.map(Board.getItem).filter(Boolean).map(it => ({ x: it.x - 40, y: it.y - 30, w: 80, h: 70 }))];
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        for (const t of boxes) {
            x1 = Math.min(x1, t.x); y1 = Math.min(y1, t.y);
            x2 = Math.max(x2, t.x + t.w); y2 = Math.max(y2, t.y + t.h);
        }
        const v = Board.visibleRect();
        const fit = Math.min(v.w * Board.view.k / (x2 - x1 + 160), v.h * Board.view.k / (y2 - y1 + 160));
        Board.flyTo((x1 + x2) / 2, (y1 + y2) / 2, Math.min(Board.view.k, Math.max(0.3, fit)));
        setTimeout(() => list.forEach(t => Board.flash(t.id)), 450);
    }

    /* ---------- Окно выбора файлов ---------- */
    function pick({ accept = '', multiple = true } = {}) {
        return new Promise(resolve => {
            const inp = document.createElement('input');
            inp.type = 'file';
            inp.multiple = multiple;
            if (accept) inp.accept = accept;
            inp.addEventListener('change', () => resolve([...inp.files]), { once: true });
            inp.addEventListener('cancel', () => resolve([]), { once: true });
            inp.click();
        });
    }

    async function pickFiles(at) {
        const files = await pick();
        if (files.length) importFiles(files, { at });
    }

    async function pickBoards(at) {
        const files = await pick({ accept: '.tiles,.zip,.json' });
        if (files.length) importFiles(files, { at });
    }

    async function pickForTile(id) {
        const t = Board.getTile(id);
        if (!t || !t.def.media) return;
        const [f] = await pick({ accept: t.def.accept, multiple: false });
        if (!f || !Board.getTile(id)) return;
        try {
            const a = await addAsset(f, f.name);
            Board.setTileAsset(id, a.id, f.name);
        } catch (err) {
            report(err, 'Не удалось загрузить файл');
        }
    }

    /* ---------- Сохранение ---------- */
    async function saveBoard({ selection = false } = {}) {
        if (selection && !Board.selectedTiles().length && !Board.selectedItems().length) { UI.toast('Сначала выделите плитки'); return; }
        if (!selection && !Board.tiles.size && !Board.targets.size && !Board.magnets.size) { UI.toast('Доска пуста — сохранять нечего'); return; }
        const { data, files } = serialize(selection);
        const json = new TextEncoder().encode(JSON.stringify(data));
        const total = json.length + files.reduce((s, a) => s + a.size, 0);
        if (total > BIG_ARCHIVE) {
            const ok = await UI.confirm({
                title: 'Большой файл',
                text: `Архив получится примерно ${fmtSize(total)} — в основном из-за встроенных файлов. Сохранить?`,
                ok: 'Сохранить'
            });
            if (!ok) return;
        }
        UI.toast('Сохраняю…');
        try {
            const entries = [{ name: 'board.json', data: json, deflate: true }];
            const preview = await Snapshot.preview(selection ? Board.selectedTiles() : null).catch(() => null);
            if (preview) entries.push({ name: 'preview.png', data: preview });
            for (const a of files) {
                const ext = a.id.split('.').pop();
                const pack = a.size > 0 && a.size <= DEFLATE_MAX && !STORED.has(ext);
                if (!pack && a.crc == null) a.crc = await crcOfBlob(a.blob);
                entries.push({ name: 'assets/' + a.id, data: a.blob, deflate: pack, crc: a.crc });
            }
            const zip = await makeZip(entries);
            download(zip, `short-desk-${selection ? 'выделенное-' : ''}${stamp()}.tiles`);
            if (!selection) Board.markSaved();
            UI.toast(`${selection ? 'Выделенное сохранено' : 'Доска сохранена'} · ${fmtSize(zip.size)}`);
        } catch (err) {
            report(err, 'Не удалось сохранить');
        }
    }

    /* ---------- Экспорт ---------- */
    function downloadTile(id) {
        const t = Board.getTile(id);
        const a = t && t.asset && asset(t.asset);
        if (!a) { UI.toast('В плитке нет файла'); return; }
        download(a.blob, t.fileName || a.name);
    }

    function saveOutput(id) {
        const t = Board.getTile(id);
        if (!t || !t.log || !t.log.length) { UI.toast('Вывод пуст'); return; }
        const text = t.log.map(l => (l.startsWith('# ') ? l.slice(2) : l)).join('\n') + '\n';
        download(new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' }), safeName(Nodes.titleOf(t)) + '.txt');
    }

    async function exportImage(area) {
        if (area === 'all' && !Board.contentBounds()) { UI.toast('Доска пуста'); return; }
        UI.toast('Готовлю картинку…');
        try {
            const canvas = await Snapshot.render({ area });
            const blob = await new Promise((ok, bad) => canvas.toBlob(b => (b ? ok(b) : bad(new UserError('Картинка получилась слишком большой.'))), 'image/png'));
            download(blob, `short-desk-${area === 'view' ? 'вид-' : ''}${stamp()}.png`);
            UI.toast('Картинка сохранена');
        } catch (err) {
            report(err, 'Не удалось сделать картинку');
        }
    }

    /* ---------- Буфер обмена ---------- */
    function initPaste() {
        document.addEventListener('paste', e => {
            if (e.target.closest && e.target.closest('input, textarea')) return;
            const files = [...((e.clipboardData && e.clipboardData.files) || [])];
            if (!files.length) return;
            e.preventDefault();
            importFiles(files, { at: Board.visibleCenter() });
        });
    }

    // Пункт меню «Вставить из буфера обмена» — без клавиатуры
    async function pasteFromClipboard(at) {
        if (!navigator.clipboard || !navigator.clipboard.read) {
            UI.toast('Браузер не даёт прочитать буфер — нажмите Ctrl+V');
            return;
        }
        try {
            const files = [];
            for (const item of await navigator.clipboard.read()) {
                const type = item.types.find(t => t.startsWith('image/')) || item.types.find(t => t === 'text/plain');
                if (!type) continue;
                const blob = await item.getType(type);
                const name = type === 'text/plain' ? 'Текст из буфера.txt' : 'Картинка из буфера.' + extOf('', type);
                files.push(new File([blob], name, { type: type === 'text/plain' ? 'text/plain' : type }));
            }
            if (!files.length) { UI.toast('В буфере обмена нет картинки или текста'); return; }
            importFiles(files, { at });
        } catch {
            UI.toast('Нет доступа к буферу обмена — разрешите его или нажмите Ctrl+V');
        }
    }

    /* ---------- Перетаскивание файлов в окно ----------
       Окно-подсказка появляется только для файлов (не для перетаскивания внутри страницы).
       Пока оно открыто, всё событие перетаскивания приходит в него одно, а его содержимое
       не ловит мышь — поэтому подсказка не мигает при переходе между элементами. */
    function initDrop() {
        const ov = document.getElementById('dropOverlay');
        let watchdog = 0;
        const hasFiles = e => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
        const hide = () => {
            clearTimeout(watchdog);
            ov.classList.remove('show');
        };
        const show = () => {
            if (!ov.classList.contains('show')) {
                UI.menu.close();
                ov.classList.add('show');
            }
            // если браузер не сообщил об уходе курсора, подсказка всё равно спрячется
            clearTimeout(watchdog);
            watchdog = setTimeout(hide, 1000);
        };

        window.addEventListener('dragenter', e => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            show();
        });
        window.addEventListener('dragover', e => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            show();
        });
        ov.addEventListener('dragleave', e => {
            // курсор ушёл за пределы окна браузера
            if (!e.relatedTarget || e.clientX <= 0 || e.clientY <= 0 || e.clientX >= innerWidth || e.clientY >= innerHeight) hide();
        });
        window.addEventListener('drop', e => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            hide();
            const files = [...e.dataTransfer.files];
            const under = document.elementFromPoint(e.clientX, e.clientY);
            const tileEl = under && under.closest('.tile');
            importFiles(files, {
                at: Board.screenToWorld(e.clientX, e.clientY),
                target: tileEl ? Board.getTile(tileEl.dataset.id) : null
            });
        });
        window.addEventListener('dragend', hide);
        window.addEventListener('blur', hide);
    }

    /* ---------- Статистика ---------- */
    function stats() {
        const byType = new Map(), byKind = new Map(), used = new Map();
        let points = 0, refs = 0;
        for (const t of Board.tiles.values()) {
            byType.set(t.type, (byType.get(t.type) || 0) + 1);
            if (t.def.media && t.asset) {
                refs++;
                byKind.set(t.def.media, (byKind.get(t.def.media) || 0) + 1);
                const a = asset(t.asset);
                if (a) used.set(a.id, a);
            }
        }
        for (const l of Board.links.values()) points += l.points.length;
        const bytes = [...used.values()].reduce((s, a) => s + a.size, 0);
        return {
            tiles: Board.tiles.size, links: Board.links.size, points,
            targets: Board.targets.size, magnets: Board.magnets.size,
            byType, byKind, media: refs, unique: used.size, bytes
        };
    }

    return {
        init, restore, autosave, unsaved, asset, url, fmtSize, stats, kindOf,
        importFiles, pickFiles, pickBoards, pickForTile, pasteFromClipboard,
        saveBoard, downloadTile, saveOutput, exportImage, download, safeName
    };
})();
