// ===== Единый бит =====
// Все ритмичные анимации (пульсации, вспышки, кольца, частицы) бьют в один такт:
// 60 ударов в минуту = 1 удар в секунду, ровно на смене секунды на часах сайта.
// Время берётся из clock.js, поэтому и в режиме тестировщика бит совпадает с часами.

export const BPM = 60;
export const BEAT_MS = 60000 / BPM;

// index — номер удара, phase — где мы внутри удара: 0 (сам удар) … 1 (перед следующим)
export function beatAt(ms) {
    return { index: Math.floor(ms / BEAT_MS), phase: (ms % BEAT_MS) / BEAT_MS };
}

// Импульс в начале удара: 1 → 0 за долю len, ступеньками (steps штук) — резко, но ровно
export function pulse(phase, len = 0.3, steps = 4) {
    if (phase >= len) return 0;
    return Math.ceil((1 - phase / len) * steps) / steps;
}
