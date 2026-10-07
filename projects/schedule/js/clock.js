// ===== Часы сайта =====
// Все модули берут «текущее время» только отсюда. Обычно это часы устройства,
// но режим тестировщика может подменить время (setFakeTime) — и весь сайт
// будет думать, что сейчас другой момент. Подменённое время продолжает идти.

let offsetMs = 0;               // насколько «наше» время отличается от настоящего
const listeners = new Set();    // кто хочет знать, что время подменили

export function now() {
    return new Date(Date.now() + offsetMs);
}

// Подменить время: дальше часы идут от этого момента
export function setFakeTime(date) {
    offsetMs = date.getTime() - Date.now();
    listeners.forEach(fn => fn());
}

// Вернуть настоящее время устройства
export function resetTime() {
    offsetMs = 0;
    listeners.forEach(fn => fn());
}

export function isFakeTime() {
    return offsetMs !== 0;
}

// fn вызывается, когда время подменили или сбросили. Возвращает функцию отписки.
export function onTimeChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

// ----- Помощники -----

// "08:05" → 485 (минуты от полуночи). Неверная строка → null
export function toMinutes(text) {
    const m = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(String(text ?? ''));
    if (!m) return null;
    const h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
}

// 485 → "8:05"
export function formatMinutes(total) {
    const h = Math.floor(total / 60), m = total % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
}

// Сколько минут прошло с полуночи (с долями — секунды тоже учитываются)
export function minuteOfDay(date) {
    return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

// Номер дня недели как в JS: 0 — воскресенье, 1 — понедельник … 6 — суббота
export const WEEKDAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
export const WEEKDAYS_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

// Склонение: plural(5, 'урок', 'урока', 'уроков') → 'уроков'
export function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b >= 2 && b <= 4) return few;
    return many;
}
