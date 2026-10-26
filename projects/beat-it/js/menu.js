// Список уровней: карточки выпрыгивают снизу, клик по уровню раскрывает кнопки и его сложности.
// Сначала предустановленные песни, потом свои уровни (созданные автоматически, в редакторе или из файла)

import { esc, clock, roundRect, plural } from './util.js?v=1';
import { diffsOf } from './library.js?v=3';
import { bgLabel } from './bg.js?v=2';

// Сложности. Значок — белый квадратик: точки как на кубике, потом звезда и корона
export const DIFFS = [
    { id: 'easy', name: 'Лёгкая', icon: 1 },
    { id: 'normal', name: 'Обычная', icon: 2 },
    { id: 'hard', name: 'Сложная', icon: 3 },
    { id: 'expert', name: 'Эксперт', icon: 'star' },
    { id: 'master', name: 'Мастер', icon: 'crown' }
];

// Откуда взялся уровень (надпись на карточке)
export const SOURCES = {
    preset: 'Предустановленный',
    auto: 'Создан автоматически',
    editor: 'Создан в редакторе',
    importAuto: 'Импортированный · автоматический',
    importEditor: 'Импортированный · редактор'
};

// Знаки внутри квадратика (в клетке 24×24): c — кружок, p — контур, r — скруглённый прямоугольник
const MARKS = {
    1: [['c', 12, 12, 2.8]],
    2: [['c', 8, 8, 2.4], ['c', 16, 16, 2.4]],
    3: [['c', 7.2, 7.2, 2.1], ['c', 12, 12, 2.1], ['c', 16.8, 16.8, 2.1]],
    star: [['p', 'M12 5.5L13.62 9.78L18.18 9.99L14.62 12.85L15.82 17.26L12 14.75L8.18 17.26L9.38 12.85L5.82 9.99L10.38 9.78Z']],
    crown: [['p', 'M6.2 16.2L5.4 9L9.1 11.9L12 7.2L14.9 11.9L18.6 9L17.8 16.2Z'], ['r', 6.2, 17.4, 11.6, 1.8, 0.9]]
};

const ICONS = {
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/></svg>',
    options: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M17.4 7H20M4 17h2.6M11 17h9"/><circle cx="15.2" cy="7" r="2.2"/><circle cx="8.8" cy="17" r="2.2"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19l1-4.2L15.6 5.2a2 2 0 0 1 2.9 0l.3.3a2 2 0 0 1 0 2.9L9.2 18 5 19zM13.5 7.3l3.2 3.2"/></svg>',
    remove: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l.8 12h8.4L17 7M10.5 10.5v5M13.5 10.5v5"/></svg>'
};

function markSvg(m) {
    if (m[0] === 'c') return `<circle cx="${m[1]}" cy="${m[2]}" r="${m[3]}"/>`;
    if (m[0] === 'p') return `<path d="${m[1]}"/>`;
    return `<rect x="${m[1]}" y="${m[2]}" width="${m[3]}" height="${m[4]}" rx="${m[5]}"/>`;
}

// Квадратик сложности: цвет квадрата — цвет текста, значок — цвет фона (--ink)
export function diffIcon(icon, cls = 'dif-icon') {
    return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">`
        + `<rect class="dif-box" width="24" height="24" rx="6.5"/><g class="dif-mark">${MARKS[icon].map(markSvg).join('')}</g></svg>`;
}

// Тот же квадратик на canvas (для картинки результата)
export function drawDiffIcon(ctx, icon, x, y, size, box = '#fff', ink = '#000') {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 24, size / 24);
    ctx.fillStyle = box;
    roundRect(ctx, 0, 0, 24, 24, 6.5);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 0.8;
    ctx.lineJoin = 'round';
    for (const m of MARKS[icon]) {
        if (m[0] === 'p') {
            const path = new Path2D(m[1]);
            ctx.fill(path);
            ctx.stroke(path);
            continue;
        }
        if (m[0] === 'c') {
            ctx.beginPath();
            ctx.arc(m[1], m[2], m[3], 0, Math.PI * 2);
        } else {
            roundRect(ctx, m[1], m[2], m[3], m[4], m[5]);
        }
        ctx.fill();
        ctx.stroke();
    }
    ctx.restore();
}

const sourceBadge = source => (source ? `<span class="level-source">${esc(SOURCES[source])}</span>` : '');
const meta = song => (song ? `${Math.round(song.bpm)} BPM<br>${clock(song.duration)}` : '');

// levels — все уровни; songOf(уровень) — разбор его песни, если уже есть (у карточки появятся график и темп).
// on: { open(уровень) — карточку раскрыли, play(уровень, сложность, номер), share, edit, remove (уровень), options() }
export function renderLevels(list, levels, songOf, on) {
    const firstUser = levels.findIndex(lv => lv.source !== 'preset');
    list.innerHTML = levels.map((lv, i) => `
        ${i === firstUser ? `<li class="levels-sep" style="--i:${i}">Свои уровни</li>` : ''}
        <li class="level" style="--i:${i}" data-id="${esc(lv.id)}">
            <button class="level-card" type="button" data-i="${i}">${card(lv, songOf(lv))}</button>
            ${diffList(i, lv)}
        </li>`).join('');

    list.querySelectorAll('.level-card').forEach(c => c.addEventListener('click', () => {
        const li = c.parentElement;
        if (toggle(li)) on.open(levels[c.dataset.i]);
    }));
    list.querySelectorAll('.diff').forEach(btn => btn.addEventListener('click', () => {
        const k = Number(btn.dataset.d);
        on.play(levels[btn.dataset.i], DIFFS[k], k);
    }));
    list.querySelectorAll('.act-btn').forEach(btn => btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'options') on.options();
        else on[act](levels[btn.dataset.i]);
    }));
    levels.forEach(lv => drawWave(list, lv, songOf(lv)));
}

function card(lv, song) {
    return `
        <div class="level-row">
            <div class="level-names">
                <div class="level-title">${esc(lv.title)}</div>
                <div class="level-sub">${esc(lv.artist || 'Неизвестный исполнитель')}</div>
            </div>
            <div class="level-meta">${meta(song)}</div>
        </div>
        <div class="level-wave"><canvas></canvas><i class="level-head"></i></div>
        <div class="level-tags">
            ${sourceBadge(lv.source)}
            <span class="level-mini">${diffsOf(lv).map(k => diffIcon(DIFFS[k].icon, 'dif-mini')).join('')}</span>
            ${lv.bg ? `<span>${bgLabel(lv.bg)}</span>` : ''}
            <span class="opt-flag" hidden>${ICONS.options}<b></b></span>
        </div>`;
}

// Под карточкой: «Отправить», «Опции» (у своих уровней ещё «Изменить» и «Удалить») и сложности.
// Пока закрыто — недоступно (inert)
function diffList(i, lv) {
    const own = lv.source !== 'preset';
    return `
        <div class="level-diffs" inert>
            <div class="level-diffs-in">
                <div class="level-actions">
                    <button class="act-btn" type="button" data-act="share" data-i="${i}" title="Скачать файл уровня .rhythm, чтобы отправить его">
                        ${ICONS.share}<span>Отправить</span>
                    </button>
                    <button class="act-btn" type="button" data-act="options" title="Опции уровня">
                        ${ICONS.options}<span>Опции</span><b class="opt-count" hidden></b>
                    </button>
                    ${own ? `
                    <button class="act-btn is-icon" type="button" data-act="edit" data-i="${i}" title="Изменить в редакторе" aria-label="Изменить в редакторе">${ICONS.edit}</button>
                    <button class="act-btn is-icon" type="button" data-act="remove" data-i="${i}" title="Удалить уровень" aria-label="Удалить уровень">${ICONS.remove}</button>` : ''}
                </div>
                ${diffsOf(lv).map((k, j) => `
                    <button class="diff" type="button" style="--d:${j + 1}" data-i="${i}" data-d="${k}">
                        ${diffIcon(DIFFS[k].icon)}
                        <span class="diff-name">${DIFFS[k].name}</span>
                        <span class="diff-pips">${'<i class="on"></i>'.repeat(k + 1)}${'<i></i>'.repeat(DIFFS.length - 1 - k)}</span>
                    </button>`).join('')}
            </div>
        </div>`;
}

// Знак включённых опций: число на кнопке «Опции» и плашка на карточке уровня
export function markOptions(list, active) {
    const n = active.length;
    list.querySelectorAll('.opt-count').forEach(el => {
        el.hidden = !n;
        el.textContent = n;
    });
    list.querySelectorAll('.act-btn[data-act="options"]').forEach(el => el.classList.toggle('has-options', n > 0));
    list.querySelectorAll('.opt-flag').forEach(el => {
        el.hidden = !n;
        el.title = active.map(o => o.name).join(', ');
        el.querySelector('b').textContent = n <= 2
            ? active.map(o => o.name).join(' · ')
            : `${n} ${plural(n, 'опция', 'опции', 'опций')}`;
    });
}

const itemOf = (list, id) => [...list.querySelectorAll('.level')].find(li => li.dataset.id === id) || null;

// Открыть сложности уровня (другой открытый уровень закрывается); true — если открылся
function toggle(li) {
    const list = li.parentElement;
    const open = !li.classList.contains('is-open');
    closeDiffs(list);
    if (!open) return false;
    li.classList.add('is-open');
    li.querySelector('.level-diffs').inert = false;
    // Когда сложности раскроются, докручиваем список, чтобы их было видно
    setTimeout(() => {
        const box = list.getBoundingClientRect();
        const r = li.getBoundingClientRect();
        if (r.bottom > box.bottom || r.top < box.top) {
            list.scrollBy({ top: r.top < box.top ? r.top - box.top - 6 : Math.min(r.bottom - box.bottom + 10, r.top - box.top - 6), behavior: 'smooth' });
        }
    }, 420);
    return true;
}

// Раскрыть уровень по id (например, только что созданный)
export function openLevel(list, id) {
    const li = itemOf(list, id);
    if (li && !li.classList.contains('is-open')) toggle(li);
    return !!li;
}

// Закрывает открытые сложности; true — если что-то было открыто
export function closeDiffs(list) {
    const li = list.querySelector('.level.is-open');
    if (!li) return false;
    li.classList.remove('is-open');
    li.querySelector('.level-diffs').inert = true;
    return true;
}

// Песня уровня загрузилась (или загружается — loading): темп, длина и график на карточке
export function updateLevel(list, lv, song, loading = false) {
    const li = itemOf(list, lv.id);
    if (!li) return;
    li.classList.toggle('is-loading', loading);
    li.querySelector('.level-meta').innerHTML = loading ? 'Загрузка…' : meta(song);
    drawWave(list, lv, song);
}

// Полоска «сейчас играет» на графике этого уровня (видна только у него)
export const headOf = (list, id) => {
    list.querySelectorAll('.level.is-current').forEach(li => li.classList.remove('is-current'));
    const li = itemOf(list, id);
    if (!li) return null;
    li.classList.add('is-current');
    return li.querySelector('.level-head');
};

// Мини-график песни: дропы — яркие столбики, остальное — бледные. Песня ещё не загружена — пунктир
export function drawWave(list, lv, song) {
    const li = itemOf(list, lv.id);
    const canvas = li && li.querySelector('.level-wave canvas');
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const c = canvas.getContext('2d');
    c.scale(dpr, dpr);
    c.fillStyle = '#fff';
    li.classList.toggle('has-song', !!song);
    if (!song || !song.wave) {
        c.globalAlpha = 0.3;
        for (let x = 0; x < w; x += 9) c.fillRect(x, h / 2 - 1.5, 5, 3);
        return;
    }
    const n = song.wave.length;
    const step = w / n;
    const bw = Math.max(2, step * 0.55);
    for (let i = 0; i < n; i++) {
        const bh = Math.max(3, song.wave[i] * h);
        c.globalAlpha = song.waveDrop[i] ? 1 : 0.35;
        c.fillRect(i * step + (step - bw) / 2, (h - bh) / 2, bw, bh);
    }
}
