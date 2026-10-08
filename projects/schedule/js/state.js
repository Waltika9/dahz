// ===== Что происходит сейчас =====
// По расписанию и времени определяет состояние:
//   lesson  — идёт урок
//   break   — перемена (или «окно», если между уроками пропуск)
//   soon    — до начала урока 2 минуты или меньше (красный сигнал)
//   off     — вне занятий: до первого урока или после последнего
//   weekend — сегодня уроков нет (выходной)
// ending = до конца УРОКА 5 минут или меньше (зелёный сигнал). У перемены зелёного
// сигнала нет — только красный за 2 минуты до урока.
// Функция чистая: ей можно дать любое время — так работает режим тестировки.

import { minuteOfDay } from './clock.js?v=1';

export const SOON_MIN = 2;      // за сколько минут до урока — красный сигнал
export const ENDING_MIN = 5;    // за сколько минут до конца урока — зелёный сигнал

/* Возвращает объект:
   phase  — 'lesson' | 'break' | 'soon' | 'off' | 'weekend'
   kind   — 'lesson' | 'break' | 'off' (что идёт на самом деле: в 'soon' это перемена или 'off')
   reason — для 'off': 'before' (до уроков), 'after' (после), 'weekend'
   ending — зелёный сигнал «скоро конец урока»
   item   — текущий урок или перемена (или null)
   left   — сколько минут (с долями) до конца текущего или до первого урока
   next   — что дальше: { type: 'lesson' | 'break' | 'end' | 'none', item, daysAhead, weekday } */
export function getState(data, date) {
    const minute = minuteOfDay(date);
    const day = data.byWeekday.get(date.getDay());

    // Сегодня уроков нет
    if (!day || !day.lessons.length) {
        return off('weekend', 'weekend', 0, upcoming(data, date));
    }

    const first = day.lessons[0];
    const last = day.lessons[day.lessons.length - 1];

    // До первого урока
    if (minute < first.start) {
        const left = first.start - minute;
        const next = { type: 'lesson', item: first, daysAhead: 0, weekday: date.getDay() };
        return off(left <= SOON_MIN ? 'soon' : 'off', 'before', left, next);
    }

    // После последнего
    if (minute >= last.end) {
        return off('off', 'after', 0, upcoming(data, date));
    }

    // Урок или перемена: ищем, в какой отрезок попадает время
    const i = day.items.findIndex(it => minute >= it.start && minute < it.end);
    if (i < 0) return off('off', 'after', 0, upcoming(data, date));   // на случай странных данных

    const item = day.items[i];
    const after = day.items[i + 1] || null;
    const left = item.end - minute;

    if (item.type === 'lesson') {
        return {
            phase: 'lesson', kind: 'lesson', reason: '',
            ending: left <= ENDING_MIN,
            item, left,
            next: after ? { type: 'break', item: after } : { type: 'end' }
        };
    }

    const soon = left <= SOON_MIN;
    return {
        phase: soon ? 'soon' : 'break', kind: 'break', reason: '',
        ending: false,      // у перемены зелёного сигнала нет
        item, left,
        next: { type: 'lesson', item: after, daysAhead: 0, weekday: date.getDay() }
    };
}

function off(phase, reason, left, next) {
    return { phase, kind: 'off', reason, ending: false, item: null, left, next };
}

// Первый урок ближайшего следующего учебного дня
function upcoming(data, date) {
    for (let i = 1; i <= 7; i++) {
        const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + i);
        const day = data.byWeekday.get(d.getDay());
        if (day?.lessons.length) {
            return { type: 'lesson', item: day.lessons[0], daysAhead: i, weekday: d.getDay() };
        }
    }
    return { type: 'none' };
}
