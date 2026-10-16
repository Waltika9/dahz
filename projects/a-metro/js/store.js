// ===== Где игра хранится в браузере =====
// У свободной игры, креатива и истории — свои сохранения, чтобы одно не стирало другое.
// Свободная игра: a-metro_game, a-metro_lines, a-metro_builds (как раньше);
// креатив: a-metro_creative_game и т. д.; история: a-metro_story_game и т. д.

export const SLOTS = ['free', 'creative', 'story'];
const LAST_KEY = 'a-metro_slot';   // в каком режиме играли в прошлый раз

let slot = 'free';
try {
    const saved = localStorage.getItem(LAST_KEY);
    if (SLOTS.includes(saved)) slot = saved;
} catch (e) { /* по умолчанию — свободная игра */ }

export const getSlot = () => slot;

export function setSlot(s) {
    slot = SLOTS.includes(s) ? s : 'free';
    try { localStorage.setItem(LAST_KEY, slot); } catch (e) { /* не страшно */ }
}

export const storeKey = (name, s = slot) => (s === 'free' ? `a-metro_${name}` : `a-metro_${s}_${name}`);

// Прочитать сохранённое (в том числе другого режима — для меню)
export function peek(name, s = slot) {
    try { return JSON.parse(localStorage.getItem(storeKey(name, s)) || 'null'); } catch (e) { return null; }
}

// Записать как есть (сохранение из файла)
export function write(name, value, s = slot) {
    try { localStorage.setItem(storeKey(name, s), JSON.stringify(value)); } catch (e) { /* нет места — не страшно */ }
}
