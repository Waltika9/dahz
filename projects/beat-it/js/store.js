// Свои уровни хранятся в этом браузере (IndexedDB): песня, фон, ноты и разбор песни.
// На сервер ничего не уходит. Чтобы перенести уровень на другое устройство — «Отправить уровень» (.rhythm)

const DB = 'beatit';
const STORE = 'levels';
let opening = null;

function open() {
    if (!opening) {
        opening = new Promise((ok, fail) => {
            if (!window.indexedDB) {
                fail(new Error('Нет IndexedDB'));
                return;
            }
            const req = indexedDB.open(DB, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
            req.onsuccess = () => ok(req.result);
            req.onerror = () => fail(req.error);
        });
        opening.catch(() => {
            opening = null;
        });
    }
    return opening;
}

async function run(mode, fn) {
    const db = await open();
    return new Promise((ok, fail) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => ok(req && req.result);
        tx.onerror = () => fail(tx.error);
        tx.onabort = () => fail(tx.error || new Error('Не получилось сохранить'));
    });
}

// Все свои уровни — сначала старые, потом новые
export async function listLevels() {
    const all = await run('readonly', s => s.getAll());
    return (all || []).sort((a, b) => a.created - b.created);
}

export const saveLevel = rec => run('readwrite', s => s.put(rec));
export const deleteLevel = id => run('readwrite', s => s.delete(id));

// Новый id для своего уровня
export const newId = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
