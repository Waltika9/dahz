// ===== Домашний режим (внеурочное время) =====
// Страница становится тёмно-синей (класс night у <body>, цвета — в CSS),
// на фоне мигают пиксельные звёзды и иногда пролетает падающая звезда.
// (Пёсик на блоке «Сейчас» живёт в js/dog.js — он там всегда, а не только дома.)
// Всё бьёт в единый бит (beat.js). Рисуется, только пока режим включён.

import { now } from './clock.js?v=1';
import { beatAt } from './beat.js?v=1';
import { PixBuf, color } from './pixbuf.js?v=1';

const SKY_S = 3;           // пиксель неба = 3×3 CSS-пикселя

const STAR_COLORS = ['#ffffff', '#c7d2fe', '#8fa0d8', '#fde68a'].map(color);
const DIM = color('#4a5a92');
const WHITE = color('#ffffff');

let sky, skyBuf;
let topSky, topCtx, topBar;     // копия верхней полосы неба внутри липкой шапки
let stars = [];
let shooting = null;
let on = false, raf = 0, lastKey = '';

export function initNight() {
    sky = document.createElement('canvas');
    sky.className = 'night-sky';
    sky.setAttribute('aria-hidden', 'true');
    document.body.prepend(sky);
    skyBuf = new PixBuf(sky);

    // У шапки свой фон (чтобы под неё не заезжал текст при прокрутке), поэтому звёзды
    // под ней не видны. Рисуем в шапке ту же полосу неба — шапка всегда сверху экрана.
    topBar = document.querySelector('.top');
    topSky = document.createElement('canvas');
    topSky.className = 'night-sky-top';
    topSky.setAttribute('aria-hidden', 'true');
    topBar.prepend(topSky);
    topCtx = topSky.getContext('2d');

    window.addEventListener('resize', () => { if (on) makeStars(); });
}

// Включить или выключить домашний режим
export function setNight(next) {
    if (next === on) return;
    on = next;
    document.body.classList.toggle('night', on);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', on ? '#0b1533' : '#f8fafc');
    cancelAnimationFrame(raf);
    if (on) {
        makeStars();
        lastKey = '';
        raf = requestAnimationFrame(loop);
    }
}

// Звёзды раскиданы случайно; у каждой свой ритм мигания (раз в 2, 3 или 4 удара)
function makeStars() {
    const W = Math.ceil(innerWidth / SKY_S), H = Math.ceil(innerHeight / SKY_S);
    skyBuf.resize(W, H);
    stars = [];
    const count = Math.round(W * H / 170);
    for (let i = 0; i < count; i++) {
        stars.push({
            x: Math.floor(Math.random() * W), y: Math.floor(Math.random() * H),
            c: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
            period: 2 + Math.floor(Math.random() * 3),
            offset: Math.floor(Math.random() * 4),
            big: Math.random() < 0.18
        });
    }
    lastKey = '';
}

function loop() {
    nightFrame();
    raf = requestAnimationFrame(loop);
}

export function nightFrame(t = performance.now()) {
    drawSky(beatAt(now().getTime()), t / 1000);
}

// ----- Небо -----

function drawSky(beat, tSec) {
    const half = beat.phase < 0.5 ? 0 : 1;

    // раз в несколько ударов — падающая звезда
    if (!shooting && beat.index % 6 === 0 && half === 0 && Math.random() < 0.02) {
        shooting = { t0: tSec, x: skyBuf.w * (0.4 + Math.random() * 0.6), y: Math.random() * skyBuf.h * 0.4 };
    }

    // перерисовываем, только когда что-то поменялось (экономим батарею)
    const key = beat.index * 2 + half;
    if (key === lastKey && !shooting) return;
    lastKey = key;

    skyBuf.clear();
    for (const s of stars) {
        const bright = (beat.index + s.offset) % s.period === 0 && half === 0;
        if (bright && s.big) {
            // звёздочка-крестик
            skyBuf.dot(s.x, s.y, s.c);
            skyBuf.dot(s.x - 1, s.y, s.c); skyBuf.dot(s.x + 1, s.y, s.c);
            skyBuf.dot(s.x, s.y - 1, s.c); skyBuf.dot(s.x, s.y + 1, s.c);
        } else {
            skyBuf.dot(s.x, s.y, bright || s.big ? s.c : DIM);
        }
    }

    if (shooting) {
        const k = (tSec - shooting.t0) / 0.9;
        if (k >= 1) {
            shooting = null;
        } else {
            // летит вниз-влево ступеньками, хвост тает узором
            const d = Math.floor(k * 18) * 4;
            const hx = shooting.x - d, hy = shooting.y + d * 0.5;
            for (let i = 0; i < 12; i++) {
                skyBuf.fade = i / 12;
                skyBuf.dot(hx + i, hy - i * 0.5, WHITE);
            }
            skyBuf.fade = 0;
        }
    }
    skyBuf.flush();
    copyTopSky();
}

// Верхняя полоса неба → в шапку (пиксель в пиксель: высота холста кратна 3)
function copyTopSky() {
    const rows = Math.min(skyBuf.h, Math.ceil(topBar.offsetHeight / SKY_S));
    if (topSky.width !== skyBuf.w || topSky.height !== rows) {
        topSky.width = skyBuf.w;
        topSky.height = rows;
        topSky.style.width = `${skyBuf.w * SKY_S}px`;
        topSky.style.height = `${rows * SKY_S}px`;
    }
    topCtx.clearRect(0, 0, topSky.width, rows);
    topCtx.drawImage(sky, 0, 0, skyBuf.w, rows, 0, 0, skyBuf.w, rows);
}
