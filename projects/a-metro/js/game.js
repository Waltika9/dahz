// ===== Игра: время, бюджет, стройка, цель =====
// Время идёт днями: на скорости ×1 — 2 дня в секунду.
// Каждый месяц: доход от билетов минус обслуживание линий.
// Каждый январь город выделяет новые деньги. Линии строятся месяцами,
// а начинают возить людей, только когда стройка закончена.
// В креативе денег и срока нет (это решает app.js), а стройка может быть мгновенной.
// В истории деньги и сроки дают главы (story.js), growth — во сколько раз выросло население.
import { storeKey } from './store.js?v=2';

export const START = new Date(2027, 0, 1);      // 1 января 2027
export const RULES = {
    budget: 700,          // млрд ₸ на старте
    yearly: 180,          // млрд ₸ каждый январь
    years: 5,             // срок
    target: 0.45,         // цель: средняя загрузка дорог не выше 45 %
    fare: 200,            // ₸ за поездку
    upkeep: { metro: 0.06, lrt: 0.03, sky: 0.04 }   // млрд ₸ в месяц за 1 км
};
export const SPEEDS = [0, 2, 6, 15];   // дней в секунду: пауза, ×1, ×2, ×3

export function dateOf(day) {
    const d = new Date(START);
    d.setDate(d.getDate() + Math.floor(day));
    return d;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const SEASONS = ['зима', 'зима', 'весна', 'весна', 'весна', 'лето', 'лето', 'лето', 'осень', 'осень', 'осень', 'зима'];

export const fmtDate = d => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
export const fmtMonthYear = d => `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
export const seasonOf = d => SEASONS[d.getMonth()];
export const endDay = () => RULES.years * 365;

// mode: free — обычная игра, creative — без денег и срока, story — история (деньги дают главы);
// instant — строить сразу
export function newGame(mode = 'free') {
    return { v: 1, mode, day: 0, budget: mode === 'story' ? 0 : RULES.budget, speed: 1, ended: null, won: false, income: 0,
             startAverage: null, instant: mode === 'creative', growth: 1 };
}

export function loadGame() {
    try {
        const g = JSON.parse(localStorage.getItem(storeKey('game')) || 'null');
        if (g && g.v === 1) return g;
    } catch (e) { /* испорчено — новая игра */ }
    return null;
}

export function saveGame(g) {
    // paused — только пока открыто меню, его не храним
    const { paused, ...keep } = g;
    try { localStorage.setItem(storeKey('game'), JSON.stringify(keep)); } catch (e) { /* не страшно */ }
}

export function clearGame() {
    try { localStorage.removeItem(storeKey('game')); } catch (e) { /* не страшно */ }
}

// Линия открыта, если стройка закончилась (у линии 1 стройки нет)
export const isOpen = (line, day) => line.locked || (line.ready ?? 0) <= day;

// Доля готовности стройки 0..1 (уже открытое — всегда 1, даже если построено «сразу» в этот же день)
export const progress = (line, day) =>
    isOpen(line, day) ? 1 : Math.max(0, Math.min(1, (day - line.start) / Math.max(1, line.ready - line.start)));

/**
 * Часы игры. Каждый кадр двигает день; на смене месяца и года зовёт onMonth / onYear.
 * onDay — каждый кадр (обновить часы на экране), onLineReady — когда достроилась линия,
 * onBuildReady — когда достроилось здание или дорога (режим строительства).
 */
export function createClock(game, { getLines, getBuilds = () => [], onDay, onMonth, onYear, onLineReady, onBuildReady = () => {}, onDeadline }) {
    let last = 0, raf = 0;
    function frame(now) {
        const dt = last ? Math.min((now - last) / 1000, 0.25) : 0;
        last = now;
        const add = dt * SPEEDS[game.speed];
        if (add > 0 && !game.paused) {
            const before = dateOf(game.day);
            const prevDay = game.day;
            game.day += add;
            const after = dateOf(game.day);
            for (const l of getLines()) {
                if (!l.locked && l.ready > prevDay && l.ready <= game.day) onLineReady(l);
            }
            for (const b of getBuilds().slice()) {
                if (b.ready > prevDay && b.ready <= game.day) onBuildReady(b);
            }
            if (after.getMonth() !== before.getMonth() || after.getFullYear() !== before.getFullYear()) {
                if (after.getFullYear() !== before.getFullYear()) onYear(after);
                onMonth(after);
            }
            if (prevDay < endDay() && game.day >= endDay()) onDeadline();
        }
        onDay(game.day);
        raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return { stop() { cancelAnimationFrame(raf); } };
}
