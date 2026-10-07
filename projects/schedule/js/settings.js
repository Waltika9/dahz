// ===== Настройки пользователя =====
// Хранятся в этом браузере (localStorage), поэтому переживают перезагрузку:
//   tester — режим тестировки, sound — музыка во внеурочное время, volume — громкость 0…1.
// Уведомления добавятся на этапе 5.

const KEY = 'irl_settings';
const DEFAULTS = { tester: false, sound: false, volume: 0.6 };

const listeners = new Set();
let values = load();

function load() {
    try {
        return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch (e) {
        return { ...DEFAULTS };   // приватный режим или испорченная запись
    }
}

export function get(name) {
    return values[name];
}

export function set(name, value) {
    if (values[name] === value) return;
    values[name] = value;
    try { localStorage.setItem(KEY, JSON.stringify(values)); } catch (e) { /* не сохранится — не страшно */ }
    listeners.forEach(fn => fn(name, value));
}

// fn(name, value) — вызывается при каждом изменении настройки
export function onChange(fn) {
    listeners.add(fn);
}

// Как показывать предмет: в режиме тестировки — «Урок-1», «Урок-2»…
export function subjectName(lesson) {
    return values.tester ? `Урок-${lesson.n}` : lesson.subject;
}
