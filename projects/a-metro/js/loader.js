// ===== Экран загрузки =====
// Сзади — полупрозрачная панорама Алматы: горы Заилийского Алатау,
// Кок-Тобе с телебашней и силуэт города. Слои двигаются за мышкой
// с разной силой (дальние меньше, ближние больше) — получается объём.

const W = 1600, H = 700;

// Повторяемые «случайные» числа: панорама каждый раз одинаковая
function seeded(seed) {
    return () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
    };
}

// Линия хребта: зубцы гор от левого края до правого
function ridge(rand, baseY, amp, step) {
    const pts = [];
    for (let x = -40; x <= W + 40; x += step * (0.6 + rand() * 0.8)) {
        pts.push([x, baseY - amp * (0.35 + rand() * 0.65)]);
    }
    return pts;
}

function polygon(pts, fill) {
    const d = `M${pts.map(p => p.join(',')).join('L')}L${W + 40},${H}L-40,${H}Z`;
    return `<path d="${d}" fill="${fill}"/>`;
}

// Снежные шапки на самых высоких вершинах
function snow(pts, limitY) {
    let s = '';
    for (let i = 1; i < pts.length - 1; i++) {
        const [x, y] = pts[i];
        if (y > limitY) continue;
        const [lx, ly] = pts[i - 1], [rx, ry] = pts[i + 1];
        const k = 0.28; // какая часть склона в снегу
        s += `<path d="M${x},${y}L${x + (rx - x) * k},${y + (ry - y) * k}L${x + (rx - x) * k * 0.5},${y + (ry - y) * k + 6}L${x},${y + 10}L${x + (lx - x) * k * 0.5},${y + (ly - y) * k + 6}L${x + (lx - x) * k},${y + (ly - y) * k}Z" fill="rgba(255,255,255,0.55)"/>`;
    }
    return s;
}

// Силуэт города: дома разной высоты и несколько башен
function skyline(rand, baseY) {
    let s = '';
    let x = -40;
    while (x < W + 40) {
        const w = 18 + rand() * 46;
        const tall = rand() < 0.08;
        const h = tall ? 120 + rand() * 90 : 20 + rand() * 60;
        s += `<rect x="${x.toFixed(0)}" y="${(baseY - h).toFixed(0)}" width="${w.toFixed(0)}" height="${(h + 200).toFixed(0)}" rx="3" fill="rgba(255,255,255,0.38)"/>`;
        if (tall) s += `<rect x="${(x + w / 2 - 1.5).toFixed(0)}" y="${(baseY - h - 18).toFixed(0)}" width="3" height="20" fill="rgba(255,255,255,0.38)"/>`;
        x += w + 2 + rand() * 6;
    }
    return s;
}

// Кок-Тобе: холм и телебашня
function kokTobe(x, baseY) {
    return `
        <path d="M${x - 260},${baseY + 30} Q${x - 120},${baseY - 70} ${x},${baseY - 78} Q${x + 140},${baseY - 70} ${x + 280},${baseY + 30} Z" fill="rgba(255,255,255,0.3)"/>
        <g fill="rgba(255,255,255,0.3)">
            <path d="M${x - 14},${baseY - 74} L${x - 3},${baseY - 300} L${x + 3},${baseY - 300} L${x + 14},${baseY - 74} Z"/>
            <rect x="${x - 10}" y="${baseY - 236}" width="20" height="8" rx="3"/>
            <rect x="${x - 7}" y="${baseY - 196}" width="14" height="6" rx="3"/>
            <rect x="${x - 1.5}" y="${baseY - 360}" width="3" height="62"/>
        </g>`;
}

function buildScene() {
    const rand = seeded(20251014);
    const far = ridge(rand, 300, 190, 70);
    const mid = ridge(rand, 390, 150, 60);

    // depth — насколько сильно слой двигается за мышкой
    const layers = [
        { depth: 0.15, svg: polygon(far, 'rgba(255,255,255,0.16)') + snow(far, 190) },
        { depth: 0.35, svg: polygon(mid, 'rgba(255,255,255,0.22)') + snow(mid, 260) },
        { depth: 0.6, svg: kokTobe(1080, 520) },
        { depth: 1, svg: skyline(rand, 610) }
    ];

    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice">
        ${layers.map(l => `<g class="layer-g" data-depth="${l.depth}">${l.svg}</g>`).join('')}
    </svg>`;
}

export function initLoader() {
    const root = document.getElementById('loader');
    const scene = document.getElementById('loaderScene');
    const fill = document.getElementById('loaderFill');
    const text = document.getElementById('loaderText');
    scene.innerHTML = buildScene();
    const groups = [...scene.querySelectorAll('.layer-g')];

    // Плавное следование за мышкой (и за наклоном на телефоне)
    let tx = 0, ty = 0, x = 0, y = 0, raf = 0, running = true;
    const onMove = e => {
        tx = (e.clientX / innerWidth - 0.5) * 2;
        ty = (e.clientY / innerHeight - 0.5) * 2;
    };
    window.addEventListener('pointermove', onMove);

    const tick = () => {
        x += (tx - x) * 0.06;
        y += (ty - y) * 0.06;
        for (const g of groups) {
            const d = Number(g.dataset.depth);
            g.setAttribute('transform', `translate(${(-x * 40 * d).toFixed(2)} ${(-y * 18 * d).toFixed(2)})`);
        }
        if (running) raf = requestAnimationFrame(tick);
    };
    tick();

    let progress = 0;
    return {
        // Полоска загрузки (0..1) — только вперёд
        setProgress(p) {
            progress = Math.max(progress, Math.min(1, p));
            fill.style.width = `${(progress * 100).toFixed(0)}%`;
        },
        fail(message) {
            text.textContent = message;
            fill.style.background = 'var(--metro)';
        },
        done() {
            this.setProgress(1);
            setTimeout(() => {
                root.classList.add('is-done');
                setTimeout(() => {
                    running = false;
                    cancelAnimationFrame(raf);
                    window.removeEventListener('pointermove', onMove);
                }, 900);
            }, 300);
        }
    };
}
