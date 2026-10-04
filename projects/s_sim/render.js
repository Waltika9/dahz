/* ============================================================
   Space Simulator 🌏 — render.js
   Пиксельная отрисовка: звёздный фон и туманности, планеты
   с текстурами и освещением, звёзды, пульсары, чёрные дыры
   с искажением пространства, кометы, корабли, следы, орбиты.
   Всё рисуется на холсте низкого разрешения и растягивается
   «пикселями» (image-rendering: pixelated).
   ============================================================ */
'use strict';

const Render = (() => {

    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

    // Матрица Байера 4×4 — классический «ретро» дизеринг вместо полупрозрачности
    const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const bayer = (x, y) => (BAYER4[(x & 3) | ((y & 3) << 2)] + 0.5) / 16;

    // Цвет пикселя в формате Uint32 (байты в памяти: R, G, B, A)
    const pack = (r, g, b) => (0xff000000 | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
    const packA = (c) => pack(c[0], c[1], c[2]);
    const cssOf = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
    const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
    const WHITE = [255, 255, 255];
    const BG = [7, 4, 15];
    const BG32 = packA(BG);

    // ---------- Состояние холста и камеры ----------
    let canvas = null, ctx = null, overlay = null, octx = null;
    let W = 0, H = 0, PX = 3, DPR = 1, cssW = 0, cssH = 0;
    let image = null, buf = null;            // пиксельный слой
    const cam = { x: 0, y: 0, zoom: 1 };     // zoom — CSS-пикселей на единицу мира
    let s = 1 / 3;                           // пикселей холста на единицу мира
    let ox = 0, oy = 0;                      // центр экрана на холсте (+ тряска)
    let frame = 0, now = 0;

    const toBufX = (x) => (x - cam.x) * s + ox;
    const toBufY = (y) => (y - cam.y) * s + oy;

    function init(mainCanvas, overlayCanvas) {
        canvas = mainCanvas;
        overlay = overlayCanvas;
        ctx = canvas.getContext('2d', { willReadFrequently: true });
        octx = overlay.getContext('2d');
        buildStars();
    }

    function resize(w, h, pixelSize) {
        cssW = w; cssH = h; PX = pixelSize;
        DPR = Math.min(2, window.devicePixelRatio || 1);
        W = Math.max(1, Math.ceil(w / PX));
        H = Math.max(1, Math.ceil(h / PX));
        canvas.width = W; canvas.height = H;
        canvas.style.width = W * PX + 'px';
        canvas.style.height = H * PX + 'px';
        overlay.width = Math.round(w * DPR);
        overlay.height = Math.round(h * DPR);
        overlay.style.width = w + 'px';
        overlay.style.height = h + 'px';
        ctx.imageSmoothingEnabled = false;
        image = ctx.createImageData(W, H);
        buf = new Uint32Array(image.data.buffer);
        if (!nebula) buildNebula();
    }

    // Перевод координат: CSS-пиксели экрана ↔ мир
    function toWorld(cx, cy) {
        return { x: cam.x + (cx - (W * PX) / 2) / cam.zoom, y: cam.y + (cy - (H * PX) / 2) / cam.zoom };
    }
    function toCss(x, y) {
        return { x: (x - cam.x) * cam.zoom + (W * PX) / 2, y: (y - cam.y) * cam.zoom + (H * PX) / 2 };
    }

    // ---------- Генератор случайных чисел и шум ----------
    function mulberry32(a) {
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function hash3(x, y, z, seed) {
        let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177) ^ Math.imul(seed | 0, 1442695041);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    }

    function noise3(x, y, z, seed) {
        const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
        const xf = x - xi, yf = y - yi, zf = z - zi;
        const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
        const c000 = hash3(xi, yi, zi, seed), c100 = hash3(xi + 1, yi, zi, seed);
        const c010 = hash3(xi, yi + 1, zi, seed), c110 = hash3(xi + 1, yi + 1, zi, seed);
        const c001 = hash3(xi, yi, zi + 1, seed), c101 = hash3(xi + 1, yi, zi + 1, seed);
        const c011 = hash3(xi, yi + 1, zi + 1, seed), c111 = hash3(xi + 1, yi + 1, zi + 1, seed);
        const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
        const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
        const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
        return y0 + (y1 - y0) * w;
    }

    function fbm3(x, y, z, seed, oct) {
        let sum = 0, amp = 0.5, f = 1, norm = 0;
        for (let i = 0; i < oct; i++) {
            sum += amp * noise3(x * f, y * f, z * f, seed + i * 101);
            norm += amp; amp *= 0.5; f *= 2.03;
        }
        return sum / norm;
    }

    // Повторяющийся (бесшовный) двумерный шум — для туманностей
    function noise2p(x, y, period, seed) {
        const xi = Math.floor(x), yi = Math.floor(y);
        const xf = x - xi, yf = y - yi;
        const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
        const m = (a) => ((a % period) + period) % period;
        const a = hash3(m(xi), m(yi), 0, seed), b = hash3(m(xi + 1), m(yi), 0, seed);
        const c = hash3(m(xi), m(yi + 1), 0, seed), d = hash3(m(xi + 1), m(yi + 1), 0, seed);
        return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
    }

    // ---------- Цвет звезды по температуре ----------
    // В пиксель-арте цвета звёзд ярче и сочнее, чем у настоящего «чёрного тела»:
    // красные → оранжевые → жёлтые → белые → голубые
    const STAR_STOPS = [
        [1500, [255, 60, 30]], [2600, [255, 90, 40]], [3500, [255, 128, 56]], [4500, [255, 176, 72]],
        [5800, [255, 222, 96]], [7200, [255, 246, 200]], [9500, [228, 236, 255]], [15000, [176, 200, 255]],
        [30000, [130, 160, 255]], [100000, [150, 190, 255]], [1e6, [200, 225, 255]]
    ];
    const starColorCache = new Map();
    function starColor(kelvin) {
        const key = Math.round(Math.log(Math.max(kelvin, 100)) * 200);
        let c = starColorCache.get(key);
        if (c) return c;
        const t = clamp(kelvin, STAR_STOPS[0][0], STAR_STOPS[STAR_STOPS.length - 1][0]);
        let i = 0;
        while (i < STAR_STOPS.length - 2 && t > STAR_STOPS[i + 1][0]) i++;
        const [t0, c0] = STAR_STOPS[i], [t1, c1] = STAR_STOPS[i + 1];
        const k = clamp(Math.log(t / t0) / Math.log(t1 / t0), 0, 1);
        c = mix(c0, c1, k).map(v => v | 0);
        if (starColorCache.size > 600) starColorCache.clear();
        starColorCache.set(key, c);
        return c;
    }

    // ---------- Звёздный фон ----------
    const TILE = 256;
    let starLayers = [];
    function buildStars() {
        const rnd = mulberry32(20261003);
        const colors = [[255, 255, 255], [196, 214, 255], [255, 238, 190], [255, 186, 160], [170, 200, 255]];
        starLayers = [
            { par: 0.03, n: 80 },
            { par: 0.08, n: 46 },
            { par: 0.16, n: 20 }
        ].map((L, li) => {
            const stars = [];
            for (let i = 0; i < L.n; i++) {
                stars.push({
                    x: (rnd() * TILE) | 0, y: (rnd() * TILE) | 0,
                    b: 0.35 + rnd() * 0.65 * (0.6 + li * 0.2),
                    c: colors[(rnd() * colors.length) | 0],
                    ph: rnd() * TAU, sp: 0.6 + rnd() * 2.6,
                    big: li === 2 && rnd() < 0.35
                });
            }
            return { par: L.par, stars };
        });
    }

    // Туманности: пиксельные облака с дизерингом
    let nebula = null;
    function buildNebula() {
        nebula = new Uint32Array(TILE * TILE);
        const purple = [[16, 7, 28], [25, 10, 40], [36, 14, 54]];
        const teal = [[6, 13, 26], [9, 20, 38], [13, 30, 52]];
        for (let y = 0; y < TILE; y++) {
            for (let x = 0; x < TILE; x++) {
                let v = 0, amp = 0.5, norm = 0;
                for (let o = 0, p = 4; o < 5; o++, p *= 2) {
                    v += amp * noise2p(x * p / TILE, y * p / TILE, p, 77 + o);
                    norm += amp; amp *= 0.5;
                }
                v /= norm;
                const hue = noise2p(x * 3 / TILE, y * 3 / TILE, 3, 555);
                const d = smooth(0.54, 0.8, v);
                const lv = Math.floor(d * 3.2 + bayer(x, y) - 0.25);
                if (lv <= 0) continue;
                const pal = hue > 0.5 ? purple : teal;
                nebula[y * TILE + x] = packA(pal[Math.min(2, lv - 1)]);
            }
        }
    }

    function drawBackground() {
        const nx = Math.floor(cam.x * 0.012), ny = Math.floor(cam.y * 0.012);
        for (let y = 0; y < H; y++) {
            const row = ((y + ny) & (TILE - 1)) * TILE;
            let i = y * W;
            for (let x = 0; x < W; x++, i++) {
                const v = nebula[row + ((x + nx) & (TILE - 1))];
                buf[i] = v || BG32;
            }
        }
        for (const L of starLayers) {
            const sx = Math.floor(cam.x * L.par), sy = Math.floor(cam.y * L.par);
            for (const st of L.stars) {
                const tw = 0.7 + 0.3 * Math.sin(now * st.sp + st.ph);
                const lv = Math.round(st.b * tw * 3) / 3;
                if (lv <= 0) continue;
                const col = pack(st.c[0] * lv, st.c[1] * lv, st.c[2] * lv);
                for (let ty = -TILE; ty < H + TILE; ty += TILE) {
                    const py = ((st.y - sy) % TILE + TILE) % TILE + ty;
                    if (py < 0 || py >= H) continue;
                    for (let tx = -TILE; tx < W + TILE; tx += TILE) {
                        const px = ((st.x - sx) % TILE + TILE) % TILE + tx;
                        if (px < 0 || px >= W) continue;
                        buf[py * W + px] = col;
                        if (st.big && tw > 0.85) {
                            const dim = pack(st.c[0] * 0.45, st.c[1] * 0.45, st.c[2] * 0.45);
                            if (px > 0) buf[py * W + px - 1] = dim;
                            if (px < W - 1) buf[py * W + px + 1] = dim;
                            if (py > 0) buf[(py - 1) * W + px] = dim;
                            if (py < H - 1) buf[(py + 1) * W + px] = dim;
                        }
                    }
                }
            }
        }
    }

    // ---------- Простые пиксельные примитивы в буфере ----------
    function plot(x, y, c) {
        if (x >= 0 && y >= 0 && x < W && y < H) buf[y * W + x] = c;
    }

    // Линия Брезенхэма. pattern(x, y, k) решает, ставить ли пиксель (пунктир, затухание)
    function line(x0, y0, x1, y1, c, pattern) {
        x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
        if ((x0 < 0 && x1 < 0) || (y0 < 0 && y1 < 0) || (x0 >= W && x1 >= W) || (y0 >= H && y1 >= H)) return;
        const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
        const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
        if (dx - dy > 6000) return;
        let err = dx + dy, k = 0;
        for (;;) {
            if (x0 >= 0 && y0 >= 0 && x0 < W && y0 < H && (!pattern || pattern(x0, y0, k))) buf[y0 * W + x0] = c;
            if (x0 === x1 && y0 === y1) break;
            const e2 = 2 * err;
            if (e2 >= dy) { err += dy; x0 += sx; }
            if (e2 <= dx) { err += dx; y0 += sy; }
            k++;
        }
    }

    // То же, но поверх готовой картинки (через ctx)
    function ctxLine(x0, y0, x1, y1, style, pattern) {
        x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
        const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
        const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
        if (dx - dy > 4000) return;
        ctx.fillStyle = style;
        let err = dx + dy, k = 0;
        for (;;) {
            if (!pattern || pattern(x0, y0, k)) ctx.fillRect(x0, y0, 1, 1);
            if (x0 === x1 && y0 === y1) break;
            const e2 = 2 * err;
            if (e2 >= dy) { err += dy; x0 += sx; }
            if (e2 <= dx) { err += dx; y0 += sy; }
            k++;
        }
    }

    // Пиксельная окружность (алгоритм средней точки)
    function ctxCircle(cx, cy, r, style, density = 1) {
        cx = Math.round(cx); cy = Math.round(cy); r = Math.round(r);
        if (r <= 0) return;
        ctx.fillStyle = style;
        let x = r, y = 0, err = 1 - r;
        const put = (px, py) => { if (density >= 1 || bayer(px, py) < density) ctx.fillRect(px, py, 1, 1); };
        while (x >= y) {
            put(cx + x, cy + y); put(cx + y, cy + x); put(cx - y, cy + x); put(cx - x, cy + y);
            put(cx - x, cy - y); put(cx - y, cy - x); put(cx + y, cy - x); put(cx + x, cy - y);
            y++;
            if (err < 0) err += 2 * y + 1;
            else { x--; err += 2 * (y - x) + 1; }
        }
    }

    // ---------- Цвета видов ----------
    function lookGen(b) {
        switch (b.look) {
            case 'gas_giant': return (b.seed & 1) ? 'jupiter' : 'saturn';
            case 'ice_giant': return (b.seed & 1) ? 'uranus' : 'neptune';
            case 'yellow_dwarf': case 'red_dwarf': return 'sun';
            case 'red_giant': return 'redgiant';
            case 'blue_giant': return 'bluestar';
            case 'neutron': return 'flat';
            default: return b.look;
        }
    }

    const LOOK_COLOR = {
        earth: [90, 150, 255], venus: [236, 200, 120], mars: [222, 110, 70], desert: [232, 198, 128],
        jupiter: [222, 180, 130], saturn: [232, 210, 150], uranus: [150, 222, 232], neptune: [90, 130, 240],
        volcanic: [255, 120, 40], moon: [170, 170, 172], mercury: [172, 152, 134],
        asteroid: [150, 140, 125], debris: [160, 120, 100], comet: [150, 220, 255],
        ship: [240, 240, 255], satellite: [255, 216, 96], black_hole: [190, 120, 255]
    };

    function bodyColor(b) {
        if (b.kind === 'star' || b.kind === 'neutron') return starColor(b.temp || 5800);
        if (b.kind === 'bh') return LOOK_COLOR.black_hole;
        if (b.look === 'earth' && b.temp > 420) return LOOK_COLOR.venus;
        return LOOK_COLOR[lookGen(b)] || LOOK_COLOR[b.tint] || [200, 200, 200];
    }

    // ---------- Текстуры планет и звёзд ----------
    // Текстура — развёртка шара (долгота × широта). Цвета в пикселях фиксированной палитры.
    const o = { c: null, n: 0, e: 0, cl: 0 };
    const craterCache = new Map();

    function craters(seed) {
        let list = craterCache.get(seed);
        if (list) return list;
        const rnd = mulberry32(seed ^ 0x5bd1e995);
        list = [];
        for (let i = 0; i < 24; i++) {
            const zz = rnd() * 2 - 1, a = rnd() * TAU, rr = Math.sqrt(1 - zz * zz);
            const rad = 0.05 + Math.pow(rnd(), 2.2) * 0.32;
            list.push({ x: rr * Math.cos(a), y: zz, z: rr * Math.sin(a), floor: Math.cos(rad * 0.78), rim: Math.cos(rad), out: Math.cos(rad * 1.12) });
        }
        craterCache.set(seed, list);
        return list;
    }

    function angDiff(a, b) {
        let d = a - b;
        while (d > Math.PI) d -= TAU;
        while (d < -Math.PI) d += TAU;
        return d;
    }

    const GEN = {
        earth(x, y, z, lat, lon, seed, bucket, u, v) {
            const hgt = fbm3(x * 1.8 + 11, y * 1.8, z * 1.8, seed, 5);
            const wet = fbm3(x * 2.6, y * 2.6 + 5, z * 2.6, seed + 7, 3);
            const alat = Math.abs(lat);
            o.n = (fbm3(x * 6, y * 6, z * 6, seed + 3, 2) * 255) | 0;
            const sea = 0.53;
            if (bucket === 0) {            // замёрзшая планета-снежок
                o.c = hgt < sea ? (hgt < 0.47 ? [150, 190, 226] : [182, 214, 240]) : (hgt > 0.62 ? [196, 204, 216] : [232, 240, 248]);
                return;
            }
            if (bucket >= 2) {             // перегретая: океаны выкипели, плотные облака (как у Венеры)
                const band = fbm3(x * 3, y * 9, z * 3, seed + 9, 3);
                o.c = band > 0.56 ? [240, 214, 150] : band > 0.48 ? [222, 184, 112] : [196, 150, 86];
                return;
            }
            const cloud = fbm3(x * 3.2 + 40, y * 5, z * 3.2, seed + 21, 4);
            o.cl = cloud > 0.64 ? 2 : cloud > 0.58 ? 1 : 0;
            if (alat > 1.2 - (hgt - 0.5) * 0.8) { o.c = [236, 244, 255]; return; }
            if (hgt < sea) {
                o.c = hgt < 0.44 ? [22, 52, 132] : hgt < 0.5 ? [32, 82, 170] : [58, 128, 204];
                return;
            }
            if (hgt > 0.68) o.c = hgt > 0.72 ? [236, 236, 236] : [124, 110, 92];
            else if (wet < 0.45 && alat < 0.75) o.c = [210, 184, 112];
            else if (wet < 0.55) o.c = [84, 156, 64];
            else o.c = [36, 108, 50];
            if (hgt < 0.62 && hash3(u, v, 9, seed) < 0.07) o.e = 1;   // огни городов
        },
        mars(x, y, z, lat, lon, seed) {
            const h = fbm3(x * 2.2, y * 2.2, z * 2.2, seed, 5);
            o.n = (fbm3(x * 5, y * 5, z * 5, seed + 4, 3) * 255) | 0;
            if (Math.abs(lat) > 1.28 - (h - 0.5) * 0.5) { o.c = [240, 236, 230]; return; }
            o.c = h < 0.44 ? [112, 48, 30] : h < 0.5 ? [150, 66, 38] : h < 0.58 ? [186, 92, 52] : [214, 130, 82];
        },
        desert(x, y, z, lat, lon, seed) {
            const h = fbm3(x * 2.4, y * 2.4, z * 2.4, seed, 5);
            o.n = (h * 255) | 0;
            o.c = h < 0.44 ? [150, 110, 64] : h < 0.5 ? [196, 156, 94] : h < 0.58 ? [224, 192, 128] : [244, 220, 162];
        },
        jupiter(x, y, z, lat, lon, seed) {
            const turb = fbm3(x * 2.5, y * 7, z * 2.5, seed, 4) - 0.5;
            const k = Math.sin(lat * 8.5 + turb * 2.6 + (seed % 7)) * 0.5 + 0.5;
            const P = [[170, 104, 66], [204, 152, 104], [226, 196, 152], [242, 226, 192], [214, 170, 120]];
            o.c = P[Math.min(4, (k * 5) | 0)];
            o.n = (k * 255) | 0;
            const dl = angDiff(lon, (seed % 628) / 100), dlat = lat + 0.36;
            const e = (dl / 0.42) ** 2 + (dlat / 0.13) ** 2;
            if (e < 1) o.c = e < 0.55 ? [200, 90, 58] : [224, 140, 96];
        },
        saturn(x, y, z, lat, lon, seed) {
            const turb = fbm3(x * 2, y * 6, z * 2, seed, 3) - 0.5;
            const k = Math.sin(lat * 7 + turb * 1.6 + (seed % 5)) * 0.5 + 0.5;
            const P = [[190, 158, 100], [214, 186, 126], [232, 210, 152], [244, 228, 180]];
            o.c = P[Math.min(3, (k * 4) | 0)];
            o.n = (k * 255) | 0;
        },
        uranus(x, y, z, lat, lon, seed) {
            const turb = fbm3(x * 2, y * 5, z * 2, seed, 3) - 0.5;
            const k = Math.sin(lat * 6 + turb * 1.2) * 0.5 + 0.5;
            const P = [[128, 198, 210], [150, 216, 226], [172, 232, 238]];
            o.c = P[Math.min(2, (k * 3) | 0)];
            o.n = (k * 255) | 0;
        },
        neptune(x, y, z, lat, lon, seed) {
            const turb = fbm3(x * 2.4, y * 6, z * 2.4, seed, 4) - 0.5;
            const k = Math.sin(lat * 6.5 + turb * 1.8) * 0.5 + 0.5;
            const P = [[44, 78, 190], [64, 108, 218], [92, 140, 236]];
            o.c = P[Math.min(2, (k * 3) | 0)];
            o.n = (k * 255) | 0;
            const dl = angDiff(lon, (seed % 628) / 100), dlat = lat + 0.32;
            if ((dl / 0.32) ** 2 + (dlat / 0.12) ** 2 < 1) o.c = [26, 44, 130];
            if (turb > 0.17) o.c = [210, 226, 255];
        },
        volcanic(x, y, z, lat, lon, seed, bucket, u, v) {
            const h = fbm3(x * 2.4, y * 2.4, z * 2.4, seed, 4);
            const rv = fbm3(x * 3.6 + 3, y * 3.6, z * 3.6, seed + 5, 4);
            const ridge = 1 - Math.abs(rv - 0.5) * 2;
            o.n = (h * 255) | 0;
            o.c = h < 0.45 ? [44, 34, 38] : h < 0.55 ? [66, 52, 52] : [92, 74, 68];
            if (ridge > 0.93) { o.c = ridge > 0.97 ? [255, 214, 90] : [255, 118, 24]; o.e = ridge > 0.97 ? 255 : 170; }
            else if (h > 0.62 && hash3(u, v, 3, seed) < 0.05) { o.c = [255, 90, 20]; o.e = 140; }
        },
        moon(x, y, z, lat, lon, seed) { rockySphere(x, y, z, seed, [[92, 92, 98], [122, 122, 128], [150, 150, 152], [182, 182, 182]]); },
        mercury(x, y, z, lat, lon, seed) { rockySphere(x, y, z, seed, [[98, 88, 82], [128, 116, 106], [158, 146, 134], [188, 178, 166]]); },
        // звёзды: в o.n яркость участка поверхности (0..255)
        sun(x, y, z, lat, lon, seed) {
            const gran = fbm3(x * 10, y * 10, z * 10, seed, 3);
            const spot = fbm3(x * 2.2, y * 2.2, z * 2.2, seed + 3, 3);
            let I = 0.74 + gran * 0.32;
            if (spot > 0.65 && Math.abs(lat) < 0.75) I = spot > 0.69 ? 0.22 : 0.5;
            o.n = (clamp(I, 0, 1) * 255) | 0;
        },
        redgiant(x, y, z, lat, lon, seed) {
            const cells = fbm3(x * 2.6, y * 2.6, z * 2.6, seed, 4);
            o.n = (clamp(0.4 + 0.85 * Math.pow(cells, 1.3), 0, 1) * 255) | 0;
        },
        bluestar(x, y, z, lat, lon, seed) {
            o.n = (clamp(0.86 + fbm3(x * 7, y * 7, z * 7, seed, 2) * 0.24, 0, 1) * 255) | 0;
        },
        flat() { o.n = 255; }
    };

    function rockySphere(x, y, z, seed, P) {
        const h = fbm3(x * 3, y * 3, z * 3, seed, 4);
        const maria = fbm3(x * 1.4 + 9, y * 1.4, z * 1.4, seed + 13, 3);
        let i = h < 0.45 ? 1 : h < 0.55 ? 2 : 3;
        if (maria < 0.43) i = Math.max(0, i - 1);
        for (const c of craters(seed)) {
            const d = x * c.x + y * c.y + z * c.z;
            if (d > c.floor) { i = Math.max(0, i - 1); break; }
            if (d > c.rim) { i = 3; break; }
            if (d > c.out) { i = Math.max(0, i - 1); }
        }
        o.c = P[i];
        o.n = (h * 255) | 0;
    }

    const STAR_LOOKS = new Set(['sun', 'redgiant', 'bluestar', 'flat']);
    const FROST_LOOKS = new Set(['mars', 'desert', 'volcanic', 'moon', 'mercury', 'asteroid', 'debris']);

    function tempBucket(b) {
        if (b.look !== 'earth') return 1;
        return b.temp < 235 ? 0 : b.temp < 420 ? 1 : 2;
    }

    function texWidth(R) {
        let w = 32;
        while (w < R * 6.3 && w < 256) w *= 2;
        return w;
    }

    function getTexture(b, R) {
        const w = texWidth(R), h = w >> 1;
        const gen = lookGen(b);
        const bucket = tempBucket(b);
        const key = `${gen}|${b.seed}|${w}|${bucket}`;
        if (b._tex && b._tex.key === key) return b._tex;
        const fn = GEN[gen] || GEN.moon;
        const tex = { key, w, h, star: STAR_LOOKS.has(gen), col: new Uint32Array(w * h), n: new Uint8Array(w * h), e: new Uint8Array(w * h), cl: null };
        if (gen === 'earth' && bucket === 1) tex.cl = new Uint8Array(w * h);
        for (let v = 0; v < h; v++) {
            const lat = (0.5 - (v + 0.5) / h) * Math.PI;
            const cl = Math.cos(lat), sl = Math.sin(lat);
            for (let u = 0; u < w; u++) {
                const lon = ((u + 0.5) / w) * TAU;
                o.c = null; o.n = 128; o.e = 0; o.cl = 0;
                fn(cl * Math.sin(lon), sl, cl * Math.cos(lon), lat, lon, b.seed, bucket, u, v);
                const i = v * w + u;
                if (o.c) tex.col[i] = packA(o.c);
                tex.n[i] = o.n;
                tex.e[i] = o.e;
                if (tex.cl) tex.cl[i] = o.cl;
            }
        }
        b._tex = tex;
        return tex;
    }

    // Таблица для шара радиуса R: какой пиксель смотрит в какую точку сферы
    const lutCache = new Map();
    function sphereLUT(R) {
        let L = lutCache.get(R);
        if (L) return L;
        const D = 2 * R;
        const max = D * D;
        const px = new Int16Array(max), py = new Int16Array(max);
        const nx = new Float32Array(max), ny = new Float32Array(max), nz = new Float32Array(max);
        const uu = new Float32Array(max), vv = new Float32Array(max);
        let n = 0;
        for (let j = 0; j < D; j++) {
            for (let i = 0; i < D; i++) {
                const x = (i + 0.5 - R) / R, y = (j + 0.5 - R) / R;
                const d2 = x * x + y * y;
                if (d2 > 1) continue;
                const z = Math.sqrt(1 - d2);
                px[n] = i; py[n] = j; nx[n] = x; ny[n] = y; nz[n] = z;
                uu[n] = Math.atan2(x, z) / TAU;
                vv[n] = 0.5 - Math.asin(clamp(-y, -1, 1)) / Math.PI;
                n++;
            }
        }
        L = { R, D, n, px, py, nx, ny, nz, u: uu, v: vv };
        if (lutCache.size > 80) lutCache.delete(lutCache.keys().next().value);
        lutCache.set(R, L);
        return L;
    }

    // Переиспользуемые маленькие холсты для спрайтов
    const scratchPool = new Map();
    function scratch(D) {
        let sc = scratchPool.get(D);
        if (!sc) {
            const c = document.createElement('canvas');
            c.width = D; c.height = D;
            const x = c.getContext('2d');
            const img = x.createImageData(D, D);
            sc = { canvas: c, ctx: x, img, u32: new Uint32Array(img.data.buffer) };
            if (scratchPool.size > 120) scratchPool.clear();
            scratchPool.set(D, sc);
        }
        return sc;
    }

    const LEVELS = [0.12, 0.34, 0.58, 0.82, 1.0];
    const DEFAULT_LIGHT = (() => { const v = [-0.55, -0.5, 0.67], l = Math.hypot(...v); return v.map(a => a / l); })();

    // ---------- Планета ----------
    function renderPlanet(b, R, light) {
        const tex = getTexture(b, R);
        const L = sphereLUT(R);
        const rings = b.rings && b.kind === 'planet';
        const E = rings ? Math.ceil(R * 2.35) : R;
        const D = 2 * E;
        const sc = scratch(D);
        const u32 = sc.u32;
        u32.fill(0);
        const off = E - R;
        const gen = lookGen(b);
        if (rings) drawRing(u32, D, E, R, b, gen, false);

        const tw = tex.w, th = tex.h;
        const rotFrac = (b.rot / TAU) % 1;
        const ushift = rotFrac * tw;
        const cshift = ((b.rot * 1.35) / TAU % 1) * tw;
        const lx = light[0], ly = light[1], lz = light[2];
        const heat = clamp((b.temp - 650) / 1600, 0, 1);
        const frost = FROST_LOOKS.has(gen) ? clamp((120 - b.temp) / 110, 0, 1) * 0.8 : 0;
        const atm = gen === 'earth' ? (b.temp > 420 ? [250, 220, 150] : [140, 200, 255])
            : gen === 'uranus' || gen === 'neptune' ? [190, 236, 255]
            : gen === 'jupiter' || gen === 'saturn' ? [250, 236, 200] : null;
        const lavaMode = gen === 'volcanic';
        const flick = 0.85 + 0.15 * Math.sin(now * 7 + b.seed);

        for (let k = 0; k < L.n; k++) {
            const px = L.px[k], py = L.py[k];
            let tu = Math.floor(L.u[k] * tw + ushift) % tw;
            if (tu < 0) tu += tw;
            const tv = Math.min(th - 1, (L.v[k] * th) | 0);
            const ti = tv * tw + tu;
            const c = tex.col[ti];
            let r = c & 255, g = (c >>> 8) & 255, bl = (c >>> 16) & 255;

            if (tex.cl) {
                let cu = Math.floor(L.u[k] * tw + cshift) % tw;
                if (cu < 0) cu += tw;
                const cv = tex.cl[tv * tw + cu];
                if (cv === 2 || (cv === 1 && bayer(px, py) < 0.5)) { r = 245; g = 248; bl = 255; }
            }

            const dot = L.nx[k] * lx + L.ny[k] * ly + L.nz[k] * lz;
            const shade = 0.13 + 0.87 * (dot > 0 ? dot : 0);
            let lv = (shade * 4 + bayer(px, py)) | 0;
            if (lv > 4) lv = 4;
            const f = LEVELS[lv];
            r *= f; g *= f; bl *= f;

            if (atm && L.nz[k] < 0.32 && dot > -0.1 && bayer(px, py) < 0.6) {
                r = (r + atm[0]) * 0.5; g = (g + atm[1]) * 0.5; bl = (bl + atm[2]) * 0.5;
            }
            const e = tex.e[ti];
            if (e) {
                if (lavaMode) {
                    const k2 = (e / 255) * flick;
                    r = Math.max(r, 255 * k2); g = Math.max(g, (e > 200 ? 210 : 110) * k2); bl = Math.max(bl, 30 * k2);
                } else if (dot < 0.02) {
                    r = 255; g = 214; bl = 110;            // огни городов на ночной стороне
                }
            }
            if (heat > 0) {
                const gl = heat * (0.3 + 0.7 * (1 - tex.n[ti] / 255));
                if (gl * 1.25 > bayer(px + 1, py)) {
                    const hc = gl > 0.75 ? [255, 228, 120] : gl > 0.45 ? [255, 138, 40] : [200, 52, 22];
                    r = Math.max(r, hc[0]); g = Math.max(g, hc[1]); bl = Math.max(bl, hc[2]);
                }
            }
            if (frost > 0 && frost * (0.5 + tex.n[ti] / 510) > bayer(px, py)) {
                r = (r + 214) * 0.5; g = (g + 232) * 0.5; bl = (bl + 255) * 0.5;
            }
            u32[(py + off) * D + px + off] = pack(r, g, bl);
        }
        if (rings) drawRing(u32, D, E, R, b, gen, true);
        sc.ctx.putImageData(sc.img, 0, 0);
        return { canvas: sc.canvas, E, D };
    }

    // Кольца: дальняя половина рисуется до планеты, ближняя — поверх
    function drawRing(u32, D, E, R, b, gen, front) {
        const ca = Math.cos(b.ringAngle), sa = Math.sin(b.ringAngle);
        const k = 0.3;
        const P = gen === 'saturn' || gen === 'jupiter'
            ? [pack(176, 156, 112), pack(210, 190, 144), pack(232, 214, 170)]
            : gen === 'uranus' || gen === 'neptune'
                ? [pack(110, 150, 170), pack(150, 186, 204), pack(180, 210, 222)]
                : [pack(140, 130, 120), pack(170, 160, 150), pack(200, 192, 182)];
        for (let y = 0; y < D; y++) {
            for (let x = 0; x < D; x++) {
                const dx = x + 0.5 - E, dy = y + 0.5 - E;
                const yr = -dx * sa + dy * ca;
                if ((yr > 0) !== front) continue;
                const xr = dx * ca + dy * sa;
                const rho = Math.sqrt(xr * xr + (yr / k) * (yr / k)) / R;
                if (rho < 1.3 || rho > 2.3) continue;
                if (rho > 1.9 && rho < 1.98) continue;            // щель Кассини
                const band = (rho * 26) | 0;
                const h = hash3(band, 0, 0, b.seed);
                if (h < 0.12) continue;
                const edge = rho < 1.38 || rho > 2.22;
                if (edge && bayer(x, y) < 0.5) continue;
                u32[y * D + x] = P[h < 0.45 ? 0 : h < 0.8 ? 1 : 2];
            }
        }
    }

    // ---------- Звезда ----------
    function renderStar(b, R) {
        const tex = getTexture(b, R);
        const L = sphereLUT(R);
        const D = 2 * R;
        const sc = scratch(D);
        const u32 = sc.u32;
        u32.fill(0);
        const base = starColor(b.temp);
        const pal = [packA(mul(base, 0.45)), packA(mul(base, 0.68)), packA(mix(base, WHITE, 0.08)), packA(mix(base, WHITE, 0.55))];
        const tw = tex.w, th = tex.h;
        const ushift = ((b.rot / TAU) % 1) * tw;
        const fr = frame >> 2;
        for (let k = 0; k < L.n; k++) {
            const px = L.px[k], py = L.py[k];
            let tu = Math.floor(L.u[k] * tw + ushift) % tw;
            if (tu < 0) tu += tw;
            const tv = Math.min(th - 1, (L.v[k] * th) | 0);
            const I = (tex.n[tv * tw + tu] / 255) * (0.5 + 0.5 * Math.sqrt(L.nz[k]));
            let lv = (I * 3.3 + bayer(px, py) - 0.15) | 0;
            if (hash3(px, py, fr, b.seed) < 0.025) lv++;          // мерцание поверхности
            u32[py * D + px] = pal[lv < 0 ? 0 : lv > 3 ? 3 : lv];
        }
        sc.ctx.putImageData(sc.img, 0, 0);
        return { canvas: sc.canvas, E: R, D };
    }

    // Дизеринговое свечение вокруг звёзд (кэшируется)
    const glowCache = new Map();
    function glowSprite(R, rgb, reach, variant) {
        const Rq = R <= 16 ? R : R <= 64 ? ((R + 2) >> 2) << 2 : 64;
        const key = `${Rq}|${rgb[0] >> 3},${rgb[1] >> 3},${rgb[2] >> 3}|${reach}|${variant}`;
        let g = glowCache.get(key);
        if (g) return g;
        const ext = Math.ceil(Rq * reach) + 1;
        const D = ext * 2;
        const c = document.createElement('canvas');
        c.width = D; c.height = D;
        const x2 = c.getContext('2d');
        const img = x2.createImageData(D, D);
        const u32 = new Uint32Array(img.data.buffer);
        const c1 = packA(mix(rgb, WHITE, 0.3)), c2 = packA(rgb), c3 = packA(mul(rgb, 0.5)), c4 = packA(mul(rgb, 0.26));
        for (let y = 0; y < D; y++) {
            for (let x = 0; x < D; x++) {
                const d = Math.hypot(x + 0.5 - ext, y + 0.5 - ext) / Rq;
                if (d < 0.85 || d > reach) continue;
                const t = (d - 0.85) / (reach - 0.85);
                const inten = Math.pow(1 - t, 2.4);
                const th = BAYER4[((x + variant) & 3) | (((y + variant * 2) & 3) << 2)] / 16;
                if (inten < th * 0.9 + 0.03) continue;
                u32[y * D + x] = inten > 0.6 ? c1 : inten > 0.35 ? c2 : inten > 0.16 ? c3 : c4;
            }
        }
        x2.putImageData(img, 0, 0);
        g = { canvas: c, ext, Rq };
        if (glowCache.size > 300) glowCache.clear();
        glowCache.set(key, g);
        return g;
    }

    function drawGlow(target, bx, by, R, rgb, reach, variant) {
        const Ri = Math.max(1, Math.round(R));
        const g = glowSprite(Ri, rgb, reach, variant & 3);
        const k = Ri / g.Rq;
        const size = Math.round(g.ext * 2 * k);
        target.drawImage(g.canvas, Math.round(bx - size / 2), Math.round(by - size / 2), size, size);
    }

    // ---------- Камни: астероиды, обломки, ядро кометы ----------
    const ROCK_PAL = {
        asteroid: [[62, 56, 52], [96, 86, 76], [130, 118, 104], [162, 150, 134]],
        icy: [[110, 130, 150], [150, 172, 190], [190, 210, 225], [228, 238, 246]],
        lava: [[50, 36, 36], [80, 60, 56], [120, 92, 80], [160, 130, 112]],
        earthy: [[70, 60, 44], [104, 92, 64], [140, 124, 86], [170, 160, 120]],
        red: [[96, 44, 30], [136, 62, 38], [176, 90, 54], [206, 126, 82]],
        gas: [[120, 96, 70], [160, 130, 96], [200, 170, 126], [232, 208, 164]]
    };
    function rockPalette(b) {
        if (b.type === 'comet') return ROCK_PAL.icy;
        const t = b.tint;
        if (!t) return ROCK_PAL.asteroid;
        if (t === 'comet' || t === 'ice_giant' || t === 'uranus' || t === 'neptune') return ROCK_PAL.icy;
        if (t === 'volcanic') return ROCK_PAL.lava;
        if (t === 'earth' || t === 'desert') return ROCK_PAL.earthy;
        if (t === 'mars') return ROCK_PAL.red;
        if (t === 'gas_giant' || t === 'jupiter' || t === 'saturn') return ROCK_PAL.gas;
        return ROCK_PAL.asteroid;
    }

    function renderRock(b, R, light) {
        const ext = Math.ceil(R * 1.4) + 1;
        const D = ext * 2;
        const sc = scratch(D);
        const u32 = sc.u32;
        u32.fill(0);
        const P = rockPalette(b).map(packA);
        const p1 = (b.seed % 100) / 16, p2 = (b.seed % 37) / 6, p3 = (b.seed % 53) / 8;
        const lx = light[0], ly = light[1], lz = light[2];
        const cr = Math.cos(-b.rot), sr = Math.sin(-b.rot);
        const heat = clamp((b.temp - 600) / 1400, 0, 1);
        for (let y = 0; y < D; y++) {
            for (let x = 0; x < D; x++) {
                const dx = x + 0.5 - ext, dy = y + 0.5 - ext;
                const d = Math.hypot(dx, dy) / R;
                const a = Math.atan2(dy, dx) - b.rot;
                const rr = 1 + 0.18 * Math.sin(2 * a + p1) + 0.12 * Math.sin(3 * a + p2) + 0.08 * Math.sin(5 * a + p3);
                if (d > rr) continue;
                const q = d / rr;
                const nz = Math.sqrt(Math.max(0, 1 - q * q));
                const nx = dx / (R * rr), ny = dy / (R * rr);
                const dot = nx * lx + ny * ly + nz * lz;
                const shade = 0.15 + 0.85 * Math.max(0, dot);
                const tx = (dx * cr - dy * sr) / R, ty = (dx * sr + dy * cr) / R;
                const tex = fbm3(tx * 2.2 + 5, ty * 2.2, 0.5, b.seed, 2);
                let lv = Math.floor(shade * 3.2 + (tex - 0.5) * 1.6 + bayer(x, y) * 0.8);
                lv = lv < 0 ? 0 : lv > 3 ? 3 : lv;
                let c = P[lv];
                if (heat > 0 && heat * (1.1 - tex) > bayer(x + 2, y)) c = heat > 0.6 ? pack(255, 190, 80) : pack(230, 80, 26);
                u32[y * D + x] = c;
            }
        }
        sc.ctx.putImageData(sc.img, 0, 0);
        return { canvas: sc.canvas, E: ext, D };
    }

    // ---------- Корабли и спутники (пиксель-арт, поворачивается) ----------
    const SHIP_ART = [
        '..RR.........',
        '..RWWW.......',
        '..GWWWWWWW...',
        'GGWWWBBWWWWR.',
        'GGWWWBBWWWWWR',
        'GGWWWBBWWWWR.',
        '..GWWWWWWW...',
        '..RWWW.......',
        '..RR.........'
    ];
    const SAT_ART = [
        'bBbB.....bBbB',
        'BbBb..W..BbBb',
        'bBbB=YYY=bBbB',
        'BbBb.YRY.BbBb',
        'bBbB..Y..bBbB'
    ];
    const ART_COL = {
        W: pack(232, 232, 244), G: pack(128, 128, 150), B: pack(70, 160, 255), R: pack(230, 60, 60),
        b: pack(110, 160, 240), Y: pack(236, 192, 64), '=': pack(150, 150, 164)
    };

    function renderCraft(b, art, angle, scale) {
        const bw = art[0].length, bh = art.length;
        const ext = Math.ceil(Math.hypot(bw, bh) * scale / 2) + 1;
        const D = ext * 2;
        const sc = scratch(D);
        const u32 = sc.u32;
        u32.fill(0);
        const ca = Math.cos(angle), sa = Math.sin(angle);
        const blink = ((now * 2) | 0) % 2 === 0;
        for (let y = 0; y < D; y++) {
            for (let x = 0; x < D; x++) {
                const dx = x + 0.5 - ext, dy = y + 0.5 - ext;
                const ux = (dx * ca + dy * sa) / scale + bw / 2;
                const uy = (-dx * sa + dy * ca) / scale + bh / 2;
                const ix = Math.floor(ux), iy = Math.floor(uy);
                if (ix < 0 || iy < 0 || ix >= bw || iy >= bh) continue;
                const ch = art[iy][ix];
                if (ch === '.') continue;
                if (ch === 'R' && art === SAT_ART && !blink) { u32[y * D + x] = ART_COL.Y; continue; }
                u32[y * D + x] = ART_COL[ch];
            }
        }
        sc.ctx.putImageData(sc.img, 0, 0);
        return { canvas: sc.canvas, E: ext, D };
    }

    // ---------- Чёрная дыра ----------
    const BH_PAL = [pack(255, 250, 228), pack(255, 214, 120), pack(255, 150, 52), pack(212, 70, 28), pack(118, 30, 22)];
    const BLACK = pack(0, 0, 0);
    function renderBlackHole(b, rH) {
        const ext = Math.ceil(rH * 5.2) + 1;
        const D = ext * 2;
        const sc = scratch(D);
        const u32 = sc.u32;
        u32.fill(0);
        const k = 0.27;
        const tilt = b.ringAngle * 0.35;
        const ca = Math.cos(tilt), sa = Math.sin(tilt);
        const feed = b.feed || 0;
        const t = now;
        const sd = (b.seed % 100) / 10;

        const diskCol = (rho, xr, yr, x, y, dim) => {
            const psi = Math.atan2(yr / k, xr);
            const speed = 2.4 / Math.pow(rho, 1.5);
            const sw = 0.5 + 0.5 * Math.sin(psi * 5 - t * speed * 3 + rho * 6 + sd) * Math.sin(psi * 3 + t * speed * 1.7 - rho * 9);
            const heat = 1 - (rho - 1.9) / 3.1;
            const dop = 1 + 0.55 * (xr / (rho * rH));
            const I = (0.3 + 0.7 * heat) * (0.55 + 0.45 * sw) * dop * (1 + feed * 0.5) * dim;
            const lv = Math.floor(I * 4.4 + bayer(x, y) - 0.4);
            if (lv <= 0) return 0;
            return BH_PAL[Math.max(0, 5 - Math.min(5, lv))] || BH_PAL[0];
        };

        for (let y = 0; y < D; y++) {
            for (let x = 0; x < D; x++) {
                const dx = x + 0.5 - ext, dy = y + 0.5 - ext;
                const rr = Math.hypot(dx, dy) / rH;
                const xr = dx * ca + dy * sa, yr = -dx * sa + dy * ca;
                const rho = Math.sqrt(xr * xr + (yr / k) * (yr / k)) / rH;
                const inDisk = rho >= 1.9 && rho <= 5;
                let c = 0;
                if (inDisk && yr > 0) c = diskCol(rho, xr, yr, x, y, 1);
                if (c) { u32[y * D + x] = c; continue; }
                if (rr < 1) { u32[y * D + x] = BLACK; continue; }
                if (rr < 1.16) {                                   // фотонное кольцо
                    if (bayer(x, y) < 0.85) u32[y * D + x] = rr < 1.08 ? BH_PAL[0] : BH_PAL[1];
                    continue;
                }
                if (inDisk) { c = diskCol(rho, xr, yr, x, y, 0.9); if (c) u32[y * D + x] = c; continue; }
                // изображение дальней части диска, изогнутое гравитацией над тенью
                if (yr < 0 && rr < 1.8) {
                    const fade = 1 - (rr - 1.16) / 0.64;
                    const dop = 1 + 0.5 * (xr / (rr * rH));
                    const I = fade * dop * (0.8 + feed * 0.4);
                    const lv = Math.floor(I * 3.6 + bayer(x, y) - 0.5);
                    if (lv > 0) u32[y * D + x] = BH_PAL[Math.max(0, 4 - lv)];
                } else if (yr > 0 && rr < 1.32) {
                    if (bayer(x, y) < 0.4) u32[y * D + x] = BH_PAL[2];
                }
            }
        }
        sc.ctx.putImageData(sc.img, 0, 0);
        return { canvas: sc.canvas, E: ext, D };
    }

    // Гравитационная линза: свет фоновых звёзд огибает чёрную дыру
    function lens(cx, cy, rH) {
        const RL = Math.min(170, Math.max(10, rH * 7)) | 0;
        const x0 = Math.max(0, Math.floor(cx - RL)), y0 = Math.max(0, Math.floor(cy - RL));
        const x1 = Math.min(W, Math.ceil(cx + RL)), y1 = Math.min(H, Math.ceil(cy + RL));
        const w = x1 - x0, h = y1 - y0;
        if (w <= 2 || h <= 2) return;
        const src = ctx.getImageData(x0, y0, w, h);
        const s32 = new Uint32Array(src.data.buffer);
        const dst = new ImageData(w, h);
        const d32 = new Uint32Array(dst.data.buffer);
        d32.set(s32);
        const E2 = (rH * 2.2) ** 2;
        const RL2 = RL * RL;
        for (let y = 0; y < h; y++) {
            const dy = y0 + y + 0.5 - cy;
            for (let x = 0; x < w; x++) {
                const dx = x0 + x + 0.5 - cx;
                const d2 = dx * dx + dy * dy;
                if (d2 > RL2 || d2 < 0.01) continue;
                const fade = 1 - smooth(0.45 * RL, RL, Math.sqrt(d2));
                const f = 1 - (E2 / d2) * fade;
                const sx = Math.floor(cx + dx * f - x0), sy = Math.floor(cy + dy * f - y0);
                d32[y * w + x] = (sx >= 0 && sy >= 0 && sx < w && sy < h) ? s32[sy * w + sx] : BG32;
            }
        }
        ctx.putImageData(dst, x0, y0);
    }

    // Рябь пространства (гравитационные волны, поглощения)
    function ripple(cx, cy, radius, amp, width) {
        const RL = radius + width * 3;
        const x0 = Math.max(0, Math.floor(cx - RL)), y0 = Math.max(0, Math.floor(cy - RL));
        const x1 = Math.min(W, Math.ceil(cx + RL)), y1 = Math.min(H, Math.ceil(cy + RL));
        const w = x1 - x0, h = y1 - y0;
        if (w <= 2 || h <= 2) return;
        const src = ctx.getImageData(x0, y0, w, h);
        const s32 = new Uint32Array(src.data.buffer);
        const dst = new ImageData(w, h);
        const d32 = new Uint32Array(dst.data.buffer);
        d32.set(s32);
        const inner = Math.max(0, radius - width * 3);
        for (let y = 0; y < h; y++) {
            const dy = y0 + y + 0.5 - cy;
            for (let x = 0; x < w; x++) {
                const dx = x0 + x + 0.5 - cx;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < inner || d > RL || d < 0.5) continue;
                const t = (d - radius) / width;
                const disp = amp * Math.sin(t * Math.PI) * Math.exp(-t * t);
                const f = (d + disp) / d;
                const sx = Math.floor(cx + dx * f - x0), sy = Math.floor(cy + dy * f - y0);
                if (sx >= 0 && sy >= 0 && sx < w && sy < h) d32[y * w + x] = s32[sy * w + sx];
            }
        }
        ctx.putImageData(dst, x0, y0);
    }

    // ---------- Освещение ----------
    function luminosity(l) {
        if (l.kind === 'neutron') return 0.4 * l.r * l.r;
        return l.r * l.r * Math.min(1e4, Math.pow(Math.max(l.temp, 1000) / 5800, 4));
    }

    function lightFor(b, lights) {
        let best = null, bestV = 0;
        for (const l of lights) {
            if (l === b) continue;
            const d2 = (l.x - b.x) ** 2 + (l.y - b.y) ** 2 + 1;
            const v = luminosity(l) / d2;
            if (v > bestV) { bestV = v; best = l; }
        }
        if (!best) return { v: DEFAULT_LIGHT, src: null };
        const dx = best.x - b.x, dy = best.y - b.y;
        const d = Math.hypot(dx, dy) || 1;
        const v = [dx / d * 0.95, dy / d * 0.95, 0.3];
        const l = Math.hypot(v[0], v[1], v[2]);
        return { v: [v[0] / l, v[1] / l, v[2] / l], src: best, dist: d };
    }

    // ---------- Хвост кометы (в пиксельный слой) ----------
    function drawCometTail(b, bx, by, li) {
        if (!li.src) return;
        const dirx = -(li.src.x - b.x) / li.dist, diry = -(li.src.y - b.y) / li.dist;
        const lum = Math.sqrt(luminosity(li.src) / (26 * 26));
        const lenW = clamp(18000 * Math.min(lum, 4) / li.dist, 4, 220);
        const Lb = Math.min(260, lenW * s + 3);
        const sp = Math.hypot(b.vx, b.vy) || 1;
        const vx = b.vx / sp, vy = b.vy / sp;
        let ddx = dirx - vx * 0.45, ddy = diry - vy * 0.45;
        const dl = Math.hypot(ddx, ddy) || 1;
        ddx /= dl; ddy /= dl;
        const ion = [pack(210, 236, 255), pack(140, 196, 255), pack(80, 130, 220)];
        const dust = [pack(255, 248, 220), pack(240, 214, 160), pack(180, 150, 110)];
        const fr = frame >> 1;
        const tail = (dx, dy, pal, widthK, bend) => {
            const px = -dy, py = dx;
            for (let t = 1; t < Lb; t++) {
                const fall = 1 - t / Lb;
                const w = 0.6 + t * widthK;
                const bendOff = bend * t * t / Lb;
                for (let q = -Math.ceil(w); q <= Math.ceil(w); q++) {
                    const across = 1 - Math.abs(q) / (w + 1);
                    const I = fall * across * (0.75 + 0.5 * hash3(t, q, fr, b.seed));
                    const x = Math.round(bx + dx * t + px * (q + bendOff));
                    const y = Math.round(by + dy * t + py * (q + bendOff));
                    if (I < bayer(x, y) * 0.9 + 0.05) continue;
                    plot(x, y, pal[I > 0.6 ? 0 : I > 0.33 ? 1 : 2]);
                }
            }
        };
        tail(ddx, ddy, dust, 0.16, 0.25);
        tail(dirx, diry, ion, 0.05, 0);
    }

    // ---------- Отрисовка одного тела ----------
    function drawBody(b, lights, nearestBH) {
        const bx = toBufX(b.x), by = toBufY(b.y);
        const Rb = b.r * s;
        const margin = Math.max(Rb * 3, 12) + (b.kind === 'star' ? Rb * 2 : 0);
        if (bx < -margin || by < -margin || bx > W + margin || by > H + margin) return;
        const li = b.kind === 'star' || b.kind === 'neutron' ? null : lightFor(b, lights);

        let spr = null;
        let halfRes = false;
        if (b.kind === 'star') {
            const R = Math.max(1, Math.round(Rb));
            if (R > 140) { halfRes = true; spr = renderStar(b, Math.round(R / 2)); }
            else spr = renderStar(b, R);
        } else if (b.kind === 'neutron') {
            spr = renderStar(b, Math.max(1, Math.round(Math.max(Rb, 1.5))));
        } else if (b.kind === 'craft') {
            const scale = clamp(b.r * s * 2 / 9, 0.6, 4);
            spr = renderCraft(b, b.type === 'ship' ? SHIP_ART : SAT_ART, b.heading, scale);
            if (b.thrusting) drawThrust(b, bx, by, scale);
        } else if (b.type === 'asteroid' || b.type === 'debris' || b.type === 'comet') {
            const R = Math.max(1, Math.round(Rb));
            if (Rb < 1.1) {
                ctx.fillStyle = cssOf(bodyColor(b));
                ctx.fillRect(Math.round(bx), Math.round(by), 1, 1);
                if (b.type === 'comet') drawGlow(ctx, bx, by, 1, [150, 220, 255], 3, frame >> 3);
                return;
            }
            if (b.type === 'comet') drawGlow(ctx, bx, by, R, [150, 220, 255], 3.2, frame >> 3);
            spr = renderRock(b, R, li.v);
        } else {
            if (Rb < 0.7) {
                ctx.fillStyle = cssOf(bodyColor(b));
                ctx.fillRect(Math.round(bx), Math.round(by), 1, 1);
                return;
            }
            const R = Math.max(1, Math.round(Rb));
            if (R > 160) { halfRes = true; spr = renderPlanet(b, Math.round(R / 2), li.v); }
            else spr = renderPlanet(b, R, li.v);
        }
        if (!spr) return;

        const k = halfRes ? 2 : 1;
        // Спагеттификация: тело у чёрной дыры вытягивается к ней
        const stretch = nearestBH && b.kind !== 'craft' ? Math.max(b.stripped ? 0.8 : 0, (b.nearBH || 0) * 0.9) : 0;
        if (stretch > 0.05) {
            const ang = Math.atan2(nearestBH.y - b.y, nearestBH.x - b.x);
            ctx.save();
            ctx.translate(Math.round(bx), Math.round(by));
            ctx.rotate(ang);
            ctx.scale(1 + stretch * 1.4, 1 / (1 + stretch * 0.6));
            ctx.rotate(-ang);
            ctx.drawImage(spr.canvas, -spr.E * k, -spr.E * k, spr.D * k, spr.D * k);
            ctx.restore();
        } else {
            ctx.drawImage(spr.canvas, Math.round(bx) - spr.E * k, Math.round(by) - spr.E * k, spr.D * k, spr.D * k);
        }
    }

    // Огонь двигателя
    function drawThrust(b, bx, by, scale) {
        const back = b.type === 'ship' ? b.heading + (b.thrusting < 0 ? 0 : Math.PI) : (b.thrustDir ?? 0) + Math.PI;
        const len = (b.type === 'ship' ? 6 : 3) * scale * Math.abs(b.thrusting || 1) + 1;
        const start = b.type === 'ship' ? 6.5 * scale : 2 * scale;
        const fr = frame;
        const cols = b.type === 'ship' ? ['#fff4b0', '#ffb020', '#ff5a1a'] : ['#ffffff', '#c8e4ff', '#8ab8ff'];
        for (let t = 0; t < len; t++) {
            const w = 1 + t * 0.35;
            for (let q = -w; q <= w; q += 1) {
                if (hash3(t, q * 7, fr, b.id) > 1 - t / len * 0.9) continue;
                const x = Math.round(bx + Math.cos(back) * (start + t) - Math.sin(back) * q * 0.6);
                const y = Math.round(by + Math.sin(back) * (start + t) + Math.cos(back) * q * 0.6);
                ctx.fillStyle = cols[Math.min(2, (t / len * 3) | 0)];
                ctx.fillRect(x, y, 1, 1);
            }
        }
    }

    // Лучи пульсара
    function drawPulsarBeams(b, bx, by) {
        const Rb = Math.max(1.5, b.r * s);
        const len = Math.max(16, Rb * 9);
        const pulse = 0.55 + 0.45 * Math.abs(Math.sin(b.rot * 2));
        for (const side of [0, Math.PI]) {
            const a = b.rot + side;
            const dx = Math.cos(a), dy = Math.sin(a);
            for (let t = Rb; t < len; t++) {
                const fall = Math.pow(1 - t / len, 1.2) * pulse;
                const w = 0.4 + t * 0.09;
                for (let q = -Math.ceil(w); q <= Math.ceil(w); q++) {
                    const across = 1 - Math.abs(q) / (w + 1);
                    const I = fall * across;
                    const x = Math.round(bx + dx * t - dy * q), y = Math.round(by + dy * t + dx * q);
                    if (I < bayer(x, y)) continue;
                    ctx.fillStyle = I > 0.55 ? '#ffffff' : I > 0.3 ? '#bcd8ff' : '#6f8fe0';
                    ctx.fillRect(x, y, 1, 1);
                }
            }
        }
    }

    // ---------- Следы, орбиты, сетка ----------
    function drawTrails(B) {
        for (const b of B) {
            const tr = b.trail;
            const n = tr.length >> 1;
            if (n < 2) continue;
            const c = packA(mul(bodyColor(b), 0.85));
            let px = toBufX(tr[0]), py = toBufY(tr[1]);
            for (let i = 1; i <= n; i++) {
                const x = i < n ? toBufX(tr[i * 2]) : toBufX(b.x);
                const y = i < n ? toBufY(tr[i * 2 + 1]) : toBufY(b.y);
                const alpha = i / n;
                line(px, py, x, y, c, (X, Y) => bayer(X, Y) < alpha * 0.9);
                px = x; py = y;
            }
        }
    }

    function drawEllipse(orb, c, dash) {
        const cx = toBufX(orb.cx), cy = toBufY(orb.cy);
        const A = orb.a * s, Bm = orb.b * s;
        if (A < 3) return;
        if (cx + A < 0 || cx - A > W || cy + A < 0 || cy - A > H) return;
        const per = Math.PI * (3 * (A + Bm) - Math.sqrt((3 * A + Bm) * (A + 3 * Bm)));
        const N = Math.min(8000, Math.max(24, Math.ceil(per * 1.2)));
        const ca = Math.cos(orb.angle), sa = Math.sin(orb.angle);
        let lx = -99999, ly = -99999, k = 0;
        for (let i = 0; i <= N; i++) {
            const t = (i / N) * TAU;
            const ex = A * Math.cos(t), ey = Bm * Math.sin(t);
            const x = Math.round(cx + ex * ca - ey * sa), y = Math.round(cy + ex * sa + ey * ca);
            if (x === lx && y === ly) continue;
            lx = x; ly = y; k++;
            if (((k + dash) >> 2) & 1) continue;
            plot(x, y, c);
        }
    }

    function drawOrbits(S) {
        const dash = (now * 6) | 0;
        for (const b of S.world.bodies) {
            const sel = b.id === S.selectedId;
            if (!sel && (b.debris || b.kind === 'craft' || (b.type === 'asteroid' && !S.showAsteroidOrbits))) continue;
            const att = Physics.attractorAt(S.world, b.x, b.y, b);
            const orb = Physics.orbitOf(b, att);
            if (!orb) continue;
            const c = sel ? pack(255, 255, 255) : packA(mul(bodyColor(b), 0.42));
            drawEllipse(orb, c, sel ? -dash : dash);
        }
    }

    // Сетка пространства-времени: массы «продавливают» её, как шар на батуте
    function drawGrid(B) {
        const heavy = B.filter(b => b.m > 0.5).sort((a, b) => b.m - a.m).slice(0, 12);
        let step = 24 / s;
        const mag = Math.pow(2, Math.round(Math.log2(step)));
        step = mag;
        const tl = toWorld(0, 0), br = toWorld(W * PX, H * PX);
        const x0 = Math.floor(tl.x / step) * step - step, y0 = Math.floor(tl.y / step) * step - step;
        const cols = Math.ceil((br.x - x0) / step) + 2, rows = Math.ceil((br.y - y0) / step) + 2;
        if (cols * rows > 6000) return;
        const P = new Float32Array(cols * rows * 2);
        for (let j = 0; j < rows; j++) {
            for (let i = 0; i < cols; i++) {
                let x = x0 + i * step, y = y0 + j * step;
                let dxs = 0, dys = 0;
                for (const b of heavy) {
                    const dx = b.x - x, dy = b.y - y;
                    const d = Math.hypot(dx, dy) || 1e-6;
                    let pull = 2500 * Math.sqrt(b.m / Physics.M_SUN) / (d + 40);
                    pull = Math.min(pull, d * 0.85);
                    dxs += dx / d * pull; dys += dy / d * pull;
                }
                const k = (j * cols + i) * 2;
                P[k] = toBufX(x + dxs); P[k + 1] = toBufY(y + dys);
            }
        }
        const c = pack(54, 36, 96);
        for (let j = 0; j < rows; j++) {
            for (let i = 0; i < cols; i++) {
                const k = (j * cols + i) * 2;
                if (i + 1 < cols) line(P[k], P[k + 1], P[k + 2], P[k + 3], c);
                if (j + 1 < rows) line(P[k], P[k + 1], P[k + cols * 2], P[k + cols * 2 + 1], c);
            }
        }
    }

    // ---------- Интерфейс поверх космоса ----------
    function brackets(bx, by, R, style) {
        const r = Math.round(Math.max(R + 3, 5));
        const x = Math.round(bx), y = Math.round(by);
        const L = Math.max(2, Math.min(5, r >> 1));
        ctx.fillStyle = style;
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const cx = x + sx * r, cy = y + sy * r;
            ctx.fillRect(sx < 0 ? cx : cx - L + 1, cy, L, 1);
            ctx.fillRect(cx, sy < 0 ? cy : cy - L + 1, 1, L);
        }
    }

    function arrow(x0, y0, x1, y1, style, handle) {
        const ax = toBufX(x0), ay = toBufY(y0), bx = toBufX(x1), by = toBufY(y1);
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 1) return;
        ctxLine(ax, ay, bx, by, style);
        const a = Math.atan2(by - ay, bx - ax);
        const hl = Math.min(6, Math.max(3, len * 0.3));
        ctxLine(bx, by, bx - Math.cos(a - 0.55) * hl, by - Math.sin(a - 0.55) * hl, style);
        ctxLine(bx, by, bx - Math.cos(a + 0.55) * hl, by - Math.sin(a + 0.55) * hl, style);
        if (handle) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(Math.round(bx) - 2, Math.round(by) - 2, 5, 5);
            ctx.fillStyle = '#000000';
            if ((frame >> 4) & 1) ctx.fillRect(Math.round(bx) - 1, Math.round(by) - 1, 3, 3);
        }
    }

    // Узоры дизеринга для вспышек на весь экран
    const ditherPatterns = [];
    function ditherPattern(level, color) {
        const key = level + color;
        if (ditherPatterns[key]) return ditherPatterns[key];
        const c = document.createElement('canvas');
        c.width = 4; c.height = 4;
        const x = c.getContext('2d');
        x.fillStyle = color;
        for (let i = 0; i < 16; i++) if (BAYER4[i] < level) x.fillRect(i & 3, i >> 2, 1, 1);
        ditherPatterns[key] = ctx.createPattern(c, 'repeat');
        return ditherPatterns[key];
    }

    // ---------- Главная функция кадра ----------
    function draw(S) {
        frame++;
        now = S.clock;
        s = cam.zoom / PX;
        const sh = S.shake || 0;
        ox = W / 2 + (sh ? Math.round((Math.random() - 0.5) * sh * 2) : 0);
        oy = H / 2 + (sh ? Math.round((Math.random() - 0.5) * sh * 2) : 0);
        const B = S.world.bodies;

        // 1. Пиксельный слой
        drawBackground();
        if (S.showGrid) drawGrid(B);
        if (S.showTrails) drawTrails(B);
        if (S.showOrbits) drawOrbits(S);
        const lights = B.filter(b => b.kind === 'star' || b.kind === 'neutron');
        for (const b of B) {
            if (b.type !== 'comet') continue;
            const bx = toBufX(b.x), by = toBufY(b.y);
            if (bx < -300 || by < -300 || bx > W + 300 || by > H + 300) continue;
            drawCometTail(b, bx, by, lightFor(b, lights));
        }
        if (S.preview && S.preview.pts) {
            const p = S.preview.pts, n = p.length >> 1;
            const c1 = pack(255, 255, 255), c2 = pack(150, 150, 170);
            for (let i = 1; i < n; i++) {
                if (i % 3 === 2) continue;
                plot(Math.round(toBufX(p[i * 2])), Math.round(toBufY(p[i * 2 + 1])), i < n * 0.5 ? c1 : c2);
            }
        }
        ctx.putImageData(image, 0, 0);

        // 2. Свечение звёзд
        const glowVar = (frame >> 3) & 3;
        for (const b of B) {
            if (b.kind !== 'star' && b.kind !== 'neutron') continue;
            const bx = toBufX(b.x), by = toBufY(b.y);
            const Rb = Math.max(1, b.r * s);
            const reach = b.kind === 'neutron' ? 4.5 : b.type === 'blue_giant' ? 2.7 : b.type === 'red_giant' ? 1.45 : 2.1;
            const m = Rb * reach + 4;
            if (bx < -m || by < -m || bx > W + m || by > H + m) continue;
            const pulse = b.kind === 'neutron' ? 1 + 0.5 * Math.abs(Math.sin(b.rot * 2)) : 1;
            drawGlow(ctx, bx, by, Math.max(Rb, b.kind === 'neutron' ? 2 : 1), starColor(b.temp), reach * pulse, glowVar);
            if (b.kind === 'neutron') drawPulsarBeams(b, bx, by);
        }

        // 3. Тела (большие — первыми, чтобы маленькие были поверх)
        const bhs = B.filter(b => b.kind === 'bh');
        const order = B.filter(b => b.kind !== 'bh').sort((a, b) => b.r - a.r);
        for (const b of order) {
            let near = null;
            if (bhs.length && (b.nearBH > 0.02 || b.stripped)) {
                let bd = Infinity;
                for (const h of bhs) { const d = (h.x - b.x) ** 2 + (h.y - b.y) ** 2; if (d < bd) { bd = d; near = h; } }
            }
            drawBody(b, lights, near);
            // корона звезды: протуберанцы
            if (b.type === 'yellow_dwarf' || b.type === 'blue_giant') drawFlares(b);
        }
        if (S.ghost) drawBody(S.ghost, lights, null);

        // 4. Чёрные дыры: сначала искажаем всё позади, потом рисуем саму дыру
        for (const h of bhs) {
            const bx = toBufX(h.x), by = toBufY(h.y);
            const rH = Math.max(1.6, h.r * s);
            const m = rH * 7 + 4;
            if (bx < -m || by < -m || bx > W + m || by > H + m) continue;
            lens(bx, by, rH);
            let spr, k = 1;
            if (rH > 60) { spr = renderBlackHole(h, Math.round(rH / 2)); k = 2; }
            else spr = renderBlackHole(h, rH);
            ctx.drawImage(spr.canvas, Math.round(bx) - spr.E * k, Math.round(by) - spr.E * k, spr.D * k, spr.D * k);
        }

        // 5. Частицы и эффекты
        for (const p of S.particles) {
            const x = Math.round(toBufX(p.x)), y = Math.round(toBufY(p.y));
            if (x < -4 || y < -4 || x > W + 4 || y > H + 4) continue;
            const t = 1 - p.life / p.max;
            ctx.fillStyle = p.c[Math.min(p.c.length - 1, (t * p.c.length) | 0)];
            const sz = p.size || 1;
            ctx.fillRect(x, y, sz, sz);
        }
        for (const e of S.effects) {
            const t = 1 - e.life / e.max;
            const bx = toBufX(e.x), by = toBufY(e.y);
            if (e.kind === 'ring') {
                const r = (e.r0 + (e.r1 - e.r0) * t) * (e.screen ? 1 : s);
                if (r < 0.5 || r > 2000) continue;
                ctxCircle(bx, by, r, e.color, 1 - t * 0.85);
                if (e.double && r > 4) ctxCircle(bx, by, r * 0.7, e.color, (1 - t) * 0.5);
            } else if (e.kind === 'ripple') {
                const r = (e.r1 * t) * s + 2;
                ripple(bx, by, r, e.amp * (1 - t), Math.max(3, e.width * s));
            }
        }

        // 6. Подсветка выбора, стрелки
        for (const b of B) {
            const isSel = b.id === S.selectedId, isHover = b.id === S.hoverId;
            const ci = S.compareIds ? S.compareIds.indexOf(b.id) : -1;
            if (!isSel && !isHover && ci < 0) continue;
            const bx = toBufX(b.x), by = toBufY(b.y);
            const R = b.kind === 'craft' ? 5 : Math.max(1.5, b.r * s * (b.rings ? 1.6 : 1));
            if (ci >= 0) brackets(bx, by, R + 3, '#ffffff');
            if (isSel) brackets(bx, by, R, (frame >> 4) & 1 ? '#ffffff' : '#8a8a96');
            else if (isHover) brackets(bx, by, R, '#6a6a76');
        }
        if (S.arrow) {
            const a = S.arrow;
            arrow(a.x0, a.y0, a.x1, a.y1, a.color || '#ffffff', a.handle);
        }
        if (S.preview && S.preview.hit && S.preview.pts.length >= 2) {
            const p = S.preview.pts;
            const x = Math.round(toBufX(p[p.length - 2])), y = Math.round(toBufY(p[p.length - 1]));
            ctx.fillStyle = '#ffffff';
            for (let i = -2; i <= 2; i++) { ctx.fillRect(x + i, y + i, 1, 1); ctx.fillRect(x + i, y - i, 1, 1); }
        }

        // 7. Вспышка на весь экран (дизерингом)
        if (S.flash > 0.02) {
            const lvl = Math.round(clamp(S.flash, 0, 1) * 16);
            if (lvl > 0) {
                ctx.fillStyle = ditherPattern(lvl, S.flashColor || '#ffffff');
                ctx.fillRect(0, 0, W, H);
            }
        }

        drawOverlay(S);
    }

    // Протуберанцы — маленькие дуги на краю звезды
    function drawFlares(b) {
        const bx = toBufX(b.x), by = toBufY(b.y);
        const R = b.r * s;
        if (R < 6) return;
        const col = cssOf(mix(starColor(b.temp), [255, 120, 40], 0.5));
        ctx.fillStyle = col;
        for (let i = 0; i < 3; i++) {
            const phase = Math.floor(now / 3 + i * 0.37);
            const life = (now / 3 + i * 0.37) % 1;
            const a = hash3(phase, i, 0, b.seed) * TAU;
            const h = Math.sin(life * Math.PI) * Math.max(2, R * 0.18);
            for (let t = 0; t <= 8; t++) {
                const u = t / 8;
                const aa = a + (u - 0.5) * 0.35 * Math.min(1, 12 / R);
                const rr = R + Math.sin(u * Math.PI) * h;
                const x = Math.round(bx + Math.cos(aa) * rr), y = Math.round(by + Math.sin(aa) * rr);
                if (bayer(x, y) < 0.8) ctx.fillRect(x, y, 1, 1);
            }
        }
    }

    // ---------- Подписи (полное разрешение, пиксельный шрифт) ----------
    function drawOverlay(S) {
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.clearRect(0, 0, overlay.width, overlay.height);
        octx.setTransform(DPR, 0, 0, DPR, 0, 0);
        octx.font = '8px "Press Start 2P", monospace';
        octx.textAlign = 'center';
        octx.textBaseline = 'top';
        octx.lineJoin = 'round';
        octx.lineWidth = 3;
        const B = S.world.bodies;
        let count = 0;
        for (const b of B) {
            const isSel = b.id === S.selectedId, isHover = b.id === S.hoverId;
            const ci = S.compareIds ? S.compareIds.indexOf(b.id) : -1;
            const minor = b.debris || b.type === 'asteroid';
            if (!isSel && !isHover && ci < 0) {
                if (!S.showLabels || minor) continue;
                if (count > 60) continue;
            }
            const p = toCss(b.x, b.y);
            const R = Math.max(b.kind === 'craft' ? 12 : 5, b.r * cam.zoom * (b.kind === 'bh' ? 1.4 : 1));
            if (p.x < -60 || p.y < -60 || p.x > cssW + 60 || p.y > cssH + 60) continue;
            count++;
            const y = p.y + R + 6;
            octx.strokeStyle = '#000';
            octx.fillStyle = isSel || ci >= 0 || isHover ? '#ffffff' : '#9a9aa6';
            const label = ci >= 0 ? `${ci + 1}: ${b.name}` : b.name;
            octx.strokeText(label, p.x, y);
            octx.fillText(label, p.x, y);
        }
        if (S.arrow && S.arrow.label) {
            const p = toCss(S.arrow.x1, S.arrow.y1);
            octx.textAlign = 'left';
            octx.fillStyle = '#ffffff';
            octx.strokeStyle = '#000';
            const lines = S.arrow.label.split('\n');
            lines.forEach((t, i) => {
                octx.strokeText(t, p.x + 12, p.y - 6 + i * 13);
                octx.fillText(t, p.x + 12, p.y - 6 + i * 13);
            });
        }
    }

    // ---------- Иконки для меню ----------
    // opts — варианты из меню (например, лёгкая или тяжёлая чёрная дыра)
    function makeIcon(type, size = 36, target = null, opts = null) {
        const t = Physics.TYPES[type];
        const m = (opts && opts.mass) ?? t.mass;
        const fake = {
            id: -1, type, kind: t.kind, look: type, r: 1, m, temp: t.temp, baseTemp: t.temp,
            seed: 4242 + type.length * 17, rot: 0.9, spin: 0, rings: !!t.rings, ringAngle: -0.32,
            heading: -0.65, thrusting: 0, x: 0, y: 0, vx: 0, vy: 0, tint: null,
            iconScale: opts && opts.mass ? clamp(Math.cbrt(m / t.mass), 0.55, 1.25)
                : opts && opts.radius ? clamp(opts.radius / t.radius, 0.6, 1.6) : 1
        };
        return bodyIcon(fake, size, target);
    }

    function bodyIcon(b, size = 36, target = null) {
        const c = target || document.createElement('canvas');
        c.width = size; c.height = size;
        const x = c.getContext('2d');
        x.imageSmoothingEnabled = false;
        x.clearRect(0, 0, size, size);
        const mid = size / 2;
        const prevNow = now;
        now = now || 1;
        const k = b.iconScale || 1;
        let spr = null;
        if (b.kind === 'bh') {
            spr = renderBlackHole(b, Math.max(1.5, Math.round(size * 0.09 * k)));
        } else if (b.kind === 'star' || b.kind === 'neutron') {
            const R = b.kind === 'neutron' ? Math.max(2, Math.round(size * 0.09)) : Math.round(size * (b.type === 'red_giant' ? 0.34 : b.type === 'red_dwarf' ? 0.22 : 0.27));
            drawGlow(x, mid, mid, R, starColor(b.temp), b.kind === 'neutron' ? 4 : 1.6, 0);
            spr = renderStar(b, R);
        } else if (b.kind === 'craft') {
            spr = renderCraft(b, b.type === 'ship' ? SHIP_ART : SAT_ART, b.heading, size / 18);
        } else if (b.type === 'asteroid' || b.type === 'debris' || b.type === 'comet') {
            if (b.type === 'comet') {
                const L = size * 0.45;
                x.fillStyle = '#8cc4ff';
                for (let i = 0; i < L; i++) {
                    const w = 1 + i * 0.22;
                    for (let q = -w; q <= w; q++) if (hash3(i, q, 1, 9) < 0.7 - i / L * 0.6) x.fillRect(Math.round(mid + i * 0.75), Math.round(mid - i * 0.62 + q * 0.6), 1, 1);
                }
                drawGlow(x, mid, mid, 3, [150, 220, 255], 2.6, 0);
            }
            spr = renderRock(b, Math.max(1, Math.round(size * (b.type === 'comet' ? 0.12 : 0.24) * k)), DEFAULT_LIGHT);
        } else {
            const R = Math.round(size * (b.rings ? 0.2 : 0.36));
            spr = renderPlanet(b, R, DEFAULT_LIGHT);
        }
        if (spr) x.drawImage(spr.canvas, Math.round(mid - spr.E), Math.round(mid - spr.E));
        if (b.kind === 'neutron') {
            x.fillStyle = '#cfe0ff';
            for (let i = 3; i < size * 0.45; i++) {
                if (bayer(i, i) < 1 - i / (size * 0.45)) {
                    x.fillRect(Math.round(mid + i * 0.7), Math.round(mid - i * 0.7), 1, 1);
                    x.fillRect(Math.round(mid - i * 0.7), Math.round(mid + i * 0.7), 1, 1);
                }
            }
        }
        now = prevNow;
        return c;
    }

    return {
        init, resize, draw, cam, toWorld, toCss, makeIcon, bodyIcon, starColor, bodyColor, cssOf,
        get width() { return W; }, get height() { return H; }, get pixel() { return PX; }
    };
})();
