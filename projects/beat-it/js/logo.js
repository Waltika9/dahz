// Логотип «BEAT IT by Waltika» в SVG.
// Буквы ставятся по меркам шрифта Anton, поэтому «IT» всегда ровно под «AT».

const NS = 'http://www.w3.org/2000/svg';
const FONT = 'Anton, Impact, "Arial Narrow", sans-serif';
const BIG = 200;          // BEAT и IT (в единицах SVG)
const SMALL = 34;         // «by Waltika»
const SKEW = -11;         // наклон, как у курсива (градусы)
const SX = 1.22;          // буквы шире…
const SY = 0.86;          // …и ниже, чем в самом шрифте
const EDGE = 9;           // обводка цветом самих букв — скругляет углы
const RIM = 11;           // белая рамка у «IT»
const GAP = 20;           // расстояние между строками

let box = '0 0 100 100';  // viewBox логотипа — волны рисуются в тех же координатах
let parts = null;         // те же буквы для рисования на canvas (картинка результата)
let flip = null;          // буквы для «перелива»: копии B, E, A, T поверх BEAT и само слово IT

let pen = null;
function measure(text, size) {
    if (!pen) pen = document.createElement('canvas').getContext('2d');
    pen.font = `${size}px ${FONT}`;
    const m = pen.measureText(text);
    return {
        w: m.width,
        l: m.actualBoundingBoxLeft,       // насколько буквы вылезают левее точки x
        r: m.actualBoundingBoxRight,
        t: m.actualBoundingBoxAscent,
        b: m.actualBoundingBoxDescent
    };
}

// Вызывать после загрузки шрифта Anton
export function buildLogo(svg) {
    const beat = measure('BEAT', BIG);
    const be = measure('BE', BIG);
    const it = measure('IT', BIG);
    const by = measure('by Waltika', SMALL);

    // BEAT: верх букв на нуле
    const beatY = beat.t;
    // IT: по центру под буквами «AT»
    const itX = (be.w + beat.w) / 2 - it.w / 2;
    const itY = beatY + beat.b + GAP + it.t;
    // by Waltika: слева от IT, по нижнему краю
    const byX = itX - it.l - RIM / 2 - BIG * 0.06 - by.r;
    const byY = itY;

    // Рамка вокруг всего логотипа с учётом растяжения и наклона
    const k = Math.tan(SKEW * Math.PI / 180);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const add = (l, r, t, b, pad) => {
        for (const y of [t - pad, b + pad]) {
            for (const x of [l - pad, r + pad]) {
                const sx = SX * x + k * SY * y;
                x0 = Math.min(x0, sx);
                x1 = Math.max(x1, sx);
                y0 = Math.min(y0, SY * y);
                y1 = Math.max(y1, SY * y);
            }
        }
    };
    add(-beat.l, beat.r, beatY - beat.t, beatY + beat.b, EDGE / 2);
    add(itX - it.l, itX + it.r, itY - it.t, itY + it.b, RIM / 2);
    add(byX - by.l, byX + by.r, byY - by.t, byY + by.b, 0);
    const m = 4;
    const rect = [x0 - m, y0 - m, x1 - x0 + 2 * m, y1 - y0 + 2 * m];
    box = rect.map(v => v.toFixed(1)).join(' ');
    parts = {
        rect,
        texts: [
            { str: 'BEAT', x: 0, y: beatY, size: BIG, fill: '#fff', stroke: EDGE },
            { str: 'IT', x: itX, y: itY, size: BIG, fill: '#000', stroke: RIM },
            { str: 'by Waltika', x: byX, y: byY, size: SMALL, fill: '#fff', stroke: 0 }
        ]
    };

    const text = (x, y, size, str, paint = '') =>
        `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" ${paint}>${str}</text>`;

    // Где стоит каждая буква BEAT (с учётом кернинга — так же, как во всём слове)
    const letters = [...'BEAT'].map((ch, i) => ({ ch, x: measure('BEAT'.slice(0, i + 1), BIG).w - measure(ch, BIG).w }));

    const shape = `transform="skewX(${SKEW}) scale(${SX} ${SY})" font-family='${FONT}'`;
    svg.setAttribute('viewBox', box);
    svg.innerHTML = `
        <defs>
            <g id="logoShape" ${shape}>
                ${text(0, beatY, BIG, 'BEAT')}
                ${text(itX, itY, BIG, 'IT')}
            </g>
        </defs>
        <g ${shape} stroke-linejoin="round">
            ${text(0, beatY, BIG, 'BEAT', `fill="#fff" stroke="#fff" stroke-width="${EDGE}"`)}
            ${text(itX, itY, BIG, 'IT', `class="logo-it" fill="#000" stroke="#fff" stroke-width="${RIM}"`)}
            ${text(byX, byY, SMALL, 'by Waltika', 'fill="#fff"')}
        </g>
        <g ${shape} stroke-linejoin="round" fill="#000" stroke="#fff" stroke-width="${EDGE}">
            ${letters.map(l => text(l.x, beatY, BIG, l.ch, 'class="logo-flip" opacity="0"')).join('')}
        </g>`;
    flip = { letters: [...svg.querySelectorAll('.logo-flip')], it: svg.querySelector('.logo-it'), busy: false };
}

// «Перелив»: B, E, A, T быстро вспыхивают контуром и становятся чёрными,
// затем слово IT тоже вспыхивает белым. Возвращает false, если анимация уже идёт
export function flipLetters() {
    if (!flip || flip.busy) return false;
    flip.busy = true;
    const STEP = 280;                        // через сколько начинается следующая буква
    const easing = 'ease-in-out';
    flip.letters.forEach((el, i) => el.animate([
        { opacity: 0, filter: 'drop-shadow(0 0 0px #fff)' },
        { opacity: 1, filter: 'drop-shadow(0 0 12px #fff)', offset: 0.24 },
        { opacity: 1, filter: 'drop-shadow(0 0 5px #fff)', offset: 0.55 },
        { opacity: 0, filter: 'drop-shadow(0 0 0px #fff)' }
    ], { duration: 680, delay: i * STEP, easing }));
    const itAt = flip.letters.length * STEP + 100;
    const last = flip.it.animate([
        { fill: '#000' },
        { fill: '#fff', filter: 'drop-shadow(0 0 12px #fff)', offset: 0.2 },
        { fill: '#fff', filter: 'drop-shadow(0 0 5px #fff)', offset: 0.65 },
        { fill: '#000', filter: 'drop-shadow(0 0 0px #fff)' }
    ], { duration: 1100, delay: itAt, easing });
    last.onfinish = () => {
        flip.busy = false;
    };
    return true;
}

// Тот же логотип на canvas: по центру (cx, cy), шириной width. Возвращает высоту
export function drawLogo(ctx, cx, cy, width) {
    if (!parts) return 0;
    const [vx, vy, vw, vh] = parts.rect;
    const s = width / vw;
    ctx.save();
    ctx.translate(cx - width / 2 - vx * s, cy - vh * s / 2 - vy * s);
    ctx.scale(s, s);
    ctx.transform(1, 0, Math.tan(SKEW * Math.PI / 180), 1, 0, 0);
    ctx.scale(SX, SY);
    ctx.lineJoin = 'round';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (const p of parts.texts) {
        ctx.font = `${p.size}px ${FONT}`;
        ctx.fillStyle = p.fill;
        ctx.fillText(p.str, p.x, p.y);
        if (p.stroke) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = p.stroke;
            ctx.strokeText(p.str, p.x, p.y);
        }
    }
    ctx.restore();
    return vh * s;
}

// Волна в форме логотипа: копия букв расходится и тает.
// fill: true — сплошной силуэт, иначе только контур
export function spawnWave(layer, { scale = 1.45, duration = 850, alpha = 0.6, width = 4, fill = false, delay = 0 } = {}) {
    const el = document.createElementNS(NS, 'svg');
    el.setAttribute('class', 'wave');
    el.setAttribute('viewBox', box);
    const use = document.createElementNS(NS, 'use');
    use.setAttribute('href', '#logoShape');
    if (fill) {
        use.setAttribute('fill', '#fff');
    } else {
        use.setAttribute('fill', 'none');
        use.setAttribute('stroke', '#fff');
        use.setAttribute('stroke-width', width);
        use.setAttribute('stroke-linejoin', 'round');
    }
    el.append(use);
    layer.append(el);
    const anim = el.animate([
        { transform: 'scale(1)', opacity: alpha },
        { transform: `scale(${scale})`, opacity: 0 }
    ], { duration, delay, easing: 'cubic-bezier(0.1, 0.7, 0.3, 1)', fill: 'backwards' });
    anim.onfinish = () => el.remove();
}
