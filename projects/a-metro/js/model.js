// ===== Модель города: где что можно строить и где пробки =====

// ---------- Местность: где можно метро, ЛРТ и SkyTrain ----------
// Биты: 1 — метро, 2 — ЛРТ, 4 — SkyTrain
export const METRO = 1, LRT = 2, SKY = 4;

const LIMITS = {
    mountainElev: 1250,   // выше — горы, ничего не строим
    metroSlope: 0.08,     // тоннели: уклон до 8 %
    skySlope: 0.06,       // эстакада: до 6 %
    lrtSlope: 0.04,       // наземные пути: до 4 %
    lrtBuilt: 30,         // при застройке плотнее 30 % для путей по земле нет места
    skyBuilt: 25          // эстакада в плотной застройке — только вдоль дорог
};

// Уклон клетки: самый большой перепад высот до соседей на 500 м
function slopes(city) {
    const { cols, rows, elev, cell } = city;
    const out = new Float32Array(city.size);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const i = r * cols + c;
            let m = 0;
            if (c > 0) m = Math.max(m, Math.abs(elev[i] - elev[i - 1]));
            if (c < cols - 1) m = Math.max(m, Math.abs(elev[i] - elev[i + 1]));
            if (r > 0) m = Math.max(m, Math.abs(elev[i] - elev[i - cols]));
            if (r < rows - 1) m = Math.max(m, Math.abs(elev[i] - elev[i + cols]));
            out[i] = m / cell;
        }
    }
    return out;
}

// Для каждой клетки: какие виды можно (биты) и почему нельзя остальные
export function computeTerrain(city) {
    const slope = slopes(city);
    const allow = new Uint8Array(city.size);
    const why = new Array(city.size);

    for (let i = 0; i < city.size; i++) {
        const s = slope[i], e = city.elev[i], built = city.built[i];
        const reasons = [];
        let a = 0;

        if (e > LIMITS.mountainElev || s > LIMITS.metroSlope) {
            reasons.push('горы: слишком круто');
        } else {
            // Тоннель можно почти везде, где не горы. Под руслом реки грунт рыхлый —
            // там реку переходят по мосту (ЛРТ) или по эстакаде
            if (city.water[i]) reasons.push('метро: под рекой рыхлый грунт');
            else a |= METRO;

            if (city.airport[i]) reasons.push('аэропорт: над землёй нельзя');
            else if (city.park[i]) reasons.push('парк или лес: только под землёй');
            else {
                // ЛРТ: ровно и есть место; вдоль железной дороги место есть всегда
                if (s > LIMITS.lrtSlope) reasons.push('ЛРТ: уклон больше 4 %');
                else if (built > LIMITS.lrtBuilt && !city.rail[i]) reasons.push('ЛРТ: плотная застройка, нет места');
                else a |= LRT;

                // SkyTrain: не слишком круто; в плотной застройке — только над крупной дорогой
                if (s > LIMITS.skySlope) reasons.push('SkyTrain: уклон больше 6 %');
                else if (built > LIMITS.skyBuilt && city.road[i] < 2) reasons.push('SkyTrain: плотно и нет большой дороги');
                else a |= SKY;
            }
        }
        allow[i] = a;
        why[i] = reasons;
    }
    return { allow, why, slope };
}

// ---------- Загруженность ----------
// Сам расчёт пробок и пересадок на транспорт — в js/sim.js

// Подпись уровня загрузки
export function jamLabel(v) {
    if (v < 0.35) return 'свободно';
    if (v < 0.7) return 'умеренно';
    if (v < 1) return 'плотно';
    if (v < 1.3) return 'пробки';
    return 'коллапс';
}
