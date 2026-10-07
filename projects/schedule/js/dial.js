// ===== Пиксельные часы в блоке «Сейчас» =====
// Холст 44×44 пикселя, на экране 88×88 (каждый пиксель — квадратик 2×2).
//   hand — урок: одна стрелка идёт по кругу, на 12 часах урок окончен;
//   pie  — перемена: белый круг «уходит», чёрный сектор растёт по часовой,
//          к концу перемены круг полностью чёрный;
//   moon — вне занятий; empty — пока расписание грузится.
// accent — подсветка «скоро конец» (в такт биту), flash — вспышка-инверсия на удар.
// night — домашний режим: белые линии на тёмно-синем.

import { PixBuf, color } from './pixbuf.js?v=1';

export const DIAL_SIZE = 44;
const C = DIAL_SIZE / 2;     // центр
const R = 21;                // внешний радиус обода
const RIM = 2;               // толщина обода
const HAND = 14;             // длина стрелки
const TAU = Math.PI * 2;

const INK = color('#000000');
const PAPER = color('#ffffff');
const NIGHT_INK = color('#ffffff');
const NIGHT_PAPER = color('#13224a');
const MOON_GLOW = color('#fde68a');
const RIM_ACCENT = color('#16a34a');     // остаток обода до 12 часов в конце урока
const PIE_ACCENT = color('#86efac');     // остаток круга в конце перемены

// Полумесяц 9×9 (рисуется квадратиками 2×2)
const MOON = [
    '...###...',
    '.###.....',
    '.##......',
    '###......',
    '###......',
    '###....#.',
    '.###..##.',
    '.######..',
    '...###...'
];

export class Dial {
    constructor(canvas) {
        this.buf = new PixBuf(canvas);
        this.buf.resize(DIAL_SIZE, DIAL_SIZE);
    }

    // v = { mode, progress (0…1), accent, flash, pulse, twinkle }
    draw(v) {
        const b = this.buf;
        let ink = v.night ? NIGHT_INK : INK;
        let paper = v.night ? NIGHT_PAPER : PAPER;
        if (v.flash) [ink, paper] = [paper, ink];
        const sweep = (v.progress || 0) * TAU;
        b.clear();

        // Круг: обод и заливка, пиксель за пикселем
        for (let y = 0; y < DIAL_SIZE; y++) {
            for (let x = 0; x < DIAL_SIZE; x++) {
                const dx = x + 0.5 - C, dy = y + 0.5 - C;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d >= R) continue;
                // угол от 12 часов по часовой стрелке
                let a = Math.atan2(dx, -dy);
                if (a < 0) a += TAU;

                let c;
                if (d >= R - RIM) {
                    c = ink;
                    if (v.accent && v.mode === 'hand' && a > sweep) c = RIM_ACCENT;
                } else if (v.mode === 'pie') {
                    c = a < sweep ? ink : (v.accent ? PIE_ACCENT : paper);
                } else {
                    c = paper;
                }
                b.px[y * DIAL_SIZE + x] = c;
            }
        }

        if (v.mode === 'hand' || v.mode === 'empty') {
            // метки 12, 3, 6, 9 часов
            b.rect(C - 1, C - 17, 2, 3, ink);
            b.rect(C - 1, C + 14, 2, 3, ink);
            b.rect(C - 17, C - 1, 3, 2, ink);
            b.rect(C + 14, C - 1, 3, 2, ink);
        }

        if (v.mode === 'hand') {
            // стрелка толщиной 2 пикселя
            const tx = C + Math.sin(sweep) * HAND, ty = C - Math.cos(sweep) * HAND;
            b.line(C - 1, C - 1, tx - 1, ty - 1, ink);
            b.line(C, C - 1, tx, ty - 1, ink);
            b.line(C - 1, C, tx - 1, ty, ink);
            b.line(C, C, tx, ty, ink);
            // центр пульсирует в такт
            const s = v.pulse ? 6 : 4;
            b.rect(C - s / 2, C - s / 2, s, s, ink);
        }

        if (v.mode === 'moon') {
            // ночью луна жёлтая, днём — просто контур цвета линий
            const moon = v.night ? MOON_GLOW : ink;
            const ox = C - 9, oy = C - 9;
            MOON.forEach((row, j) => {
                for (let i = 0; i < row.length; i++) {
                    if (row[i] === '#') b.rect(ox + i * 2, oy + j * 2, 2, 2, moon);
                }
            });
            // звёздочка мигает в такт
            if (v.twinkle) {
                b.rect(C + 6, C - 9, 2, 2, ink);
                b.rect(C + 4, C - 7, 2, 2, ink);
                b.rect(C + 8, C - 7, 2, 2, ink);
                b.rect(C + 6, C - 5, 2, 2, ink);
            } else {
                b.rect(C + 6, C - 7, 2, 2, ink);
            }
        }

        b.flush();
    }
}
