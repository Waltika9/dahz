// ===== Пиксельный холст =====
// Рисуем прямо в массив пикселей (ImageData): быстро и без сглаживания.
// Холст маленький, а CSS растягивает его с image-rendering: pixelated —
// поэтому каждый «пиксель» тут — чёткий квадратик на экране.

// Матрица Байера 4×4: по ней пиксели «тают» шахматным узором вместо полупрозрачности
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);

export function bayer(x, y) {
    return BAYER[(y & 3) * 4 + (x & 3)];
}

// '#22c55e' → число для Uint32Array (порядок байт в ImageData: R, G, B, A)
export function color(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

export class PixBuf {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.fade = 0;      // 0 — рисуем всё; 0.5 — половину пикселей (узором); 1 — ничего
        this.resize(canvas.width || 1, canvas.height || 1);
    }

    resize(w, h) {
        this.w = Math.max(1, w | 0);
        this.h = Math.max(1, h | 0);
        this.canvas.width = this.w;
        this.canvas.height = this.h;
        this.img = this.ctx.createImageData(this.w, this.h);
        this.px = new Uint32Array(this.img.data.buffer);
    }

    clear() {
        this.px.fill(0);
    }

    dot(x, y, c) {
        x = Math.floor(x);
        y = Math.floor(y);
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
        if (this.fade > 0 && bayer(x, y) < this.fade) return;
        this.px[y * this.w + x] = c;
    }

    rect(x, y, w, h, c) {
        for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) this.dot(x + i, y + j, c);
        }
    }

    // Линия Брезенхэма — ступеньками, как в пиксель-арте
    line(x0, y0, x1, y1, c) {
        x0 = Math.round(x0); y0 = Math.round(y0);
        x1 = Math.round(x1); y1 = Math.round(y1);
        const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
        const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
        let err = dx + dy;
        for (let guard = 0; guard < 2000; guard++) {
            this.dot(x0, y0, c);
            if (x0 === x1 && y0 === y1) break;
            const e2 = 2 * err;
            if (e2 >= dy) { err += dy; x0 += sx; }
            if (e2 <= dx) { err += dx; y0 += sy; }
        }
    }

    // Контур круга (алгоритм средней точки)
    ring(cx, cy, r, c) {
        cx = Math.round(cx); cy = Math.round(cy); r = Math.round(r);
        if (r <= 0) { this.dot(cx, cy, c); return; }
        let x = r, y = 0, err = 1 - r;
        while (x >= y) {
            this.dot(cx + x, cy + y, c); this.dot(cx - x, cy + y, c);
            this.dot(cx + x, cy - y, c); this.dot(cx - x, cy - y, c);
            this.dot(cx + y, cy + x, c); this.dot(cx - y, cy + x, c);
            this.dot(cx + y, cy - x, c); this.dot(cx - y, cy - x, c);
            y++;
            if (err < 0) err += 2 * y + 1;
            else { x--; err += 2 * (y - x) + 1; }
        }
    }

    // Контур правильного многоугольника
    poly(cx, cy, r, sides, angle, c) {
        let px = cx + Math.cos(angle) * r, py = cy + Math.sin(angle) * r;
        for (let i = 1; i <= sides; i++) {
            const a = angle + (i / sides) * Math.PI * 2;
            const nx = cx + Math.cos(a) * r, ny = cy + Math.sin(a) * r;
            this.line(px, py, nx, ny, c);
            px = nx; py = ny;
        }
    }

    flush() {
        this.ctx.putImageData(this.img, 0, 0);
    }
}
