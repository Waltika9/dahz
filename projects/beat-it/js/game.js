// Сам уровень: ноты разных форм летят от краёв экрана к кругу в центре.
// Нажимать — любая клавиша или кнопка мыши (на телефоне — касание); длинные ноты — держать.
// Нажал, когда нот рядом нет, — «лишнее нажатие»: отнимается здоровье (просто долбить по кнопке не выйдет)

import * as music from './music.js?v=6';
import * as sfx from './sfx.js?v=3';
import { Fx } from './fx.js?v=3';
import { TAU, DEG, fitGeo, drawNotes, placeNote, holdAngle } from './field.js?v=3';
import { Backdrop } from './bg.js?v=2';
import { showResults } from './results.js?v=8';
import { diffIcon, SOURCES } from './menu.js?v=7';
import { activeOptions } from './options.js?v=2';
import { clamp, hashSeed, esc } from './util.js?v=1';

const WIN = [0.045, 0.09, 0.14];        // окна попадания (± секунды): Идеально / Отлично / Хорошо
const EXTRA_HP = -0.04;                 // сколько здоровья отнимает лишнее нажатие
const JUDGES = [
    { name: 'Идеально', points: 300, acc: 1, hp: 0.025 },
    { name: 'Отлично', points: 150, acc: 0.65, hp: 0.012 },
    { name: 'Хорошо', points: 50, acc: 0.3, hp: 0 },
    { name: 'Мимо', points: 0, acc: 0, hp: -0.09 },
    { name: 'Лишнее' }                   // только надпись: нажал, а нот рядом нет
];

const $ = id => document.getElementById(id);
const screen = $('game');
const canvas = $('gameCanvas');
const ctx = canvas.getContext('2d');
const backdrop = new Backdrop($('gameBg'));
const el = {
    hp: $('hpFill'), score: $('score'), add: $('scoreAdd'), progress: $('progress'), watch: $('stopwatch'),
    combo: $('combo'), intro: $('gameIntro'), fail: $('gameFail'), pause: $('pauseMenu'), mods: $('gameMods')
};

let g = null;            // текущая игра
let cfg = null;          // с чем её запустили (для «Заново»)
let introTimer = 0;
let dpr = 1;
const geo = { W: 0, H: 0, cx: 0, cy: 0, rc: 40, far: 500 };   // размеры экрана и круга

// cfg: { level, diff, diffIndex, song, chart, options, onExit, from?, test? }
//   chart — ноты (library.js chartFor); test — проверка из редактора: с секунды from, без проигрыша и без результата
export function startGame(c) {
    cfg = c;
    const { level, diffIndex, song, chart } = c;
    const options = c.test ? { ...c.options, nofail: true } : c.options;
    const from = c.from || 0;
    const notes = chart.notes.filter(n => n.t >= from).map(n => ({ ...n, state: 0 }));   // 0 — летит, 1 — длинную держат, 2 — всё
    const effects = Array.isArray(level.effects) ? level.effects.slice().sort((a, b) => a.t - b.t) : [];
    const fxMode = ['auto', 'mix', 'manual'].includes(level.fxMode) ? level.fxMode : 'auto';
    const first = notes.length ? notes[0].t - from : 0;
    // пауза перед песней: успеть увидеть название (в проверке — только долететь первой ноте)
    const lead = c.test ? Math.max(1, chart.approach + 0.3 - first) : Math.max(2.2, chart.approach + 0.6 - first);

    g = {
        chart, song, options, notes, from, effects, fxMode,
        view: { ctx, geo, approach: chart.approach, hidden: options.hidden },
        fx: new Fx(options, hashSeed(`${level.id}:fx:${diffIndex}`)),
        end: Math.min(song.duration, chart.end),
        score: 0, shown: -1, combo: 0, maxCombo: 0, hp: 1, hpShown: 1,
        counts: [0, 0, 0, 0], extra: 0, accSum: 0, judged: 0, recent: [],
        samples: [], nextSample: from, misses: [],
        next: 0, beat: -1, bumpAt: -99, bumpDrop: false,
        nextEffect: Math.max(0, effects.findIndex(f => f.t >= from)),
        inputs: new Set(), pressAt: -99, autoUntil: -99, fill: 0,
        judge: null, paused: false, done: false, failed: false, failAt: 0, raf: 0
    };
    if (document.activeElement) document.activeElement.blur();   // чтобы пробел не нажимал кнопки меню
    resize();
    backdrop.set(options.nobg ? null : level.bg);

    el.score.textContent = '000000';
    el.add.textContent = '';
    el.add.classList.remove('is-pop');
    el.combo.textContent = '';
    el.fail.classList.remove('is-on');
    el.pause.classList.remove('is-open');
    el.mods.innerHTML = (c.test ? ['Проверка'] : activeOptions().map(o => o.name)).map(n => `<span>${esc(n)}</span>`).join('');
    $('quitBtn').textContent = c.test ? 'В редактор' : 'В главное меню';
    if (c.test) el.intro.classList.remove('is-on');
    else showIntro(level, c.diff, lead);

    screen.classList.add('is-on');
    music.playOnce(lead, from);
    g.raf = requestAnimationFrame(frame);
}

function showIntro(level, diff, lead) {
    el.intro.innerHTML = `
        <div class="intro-box">
            <div class="intro-title">${esc(level.title)}</div>
            <div class="intro-sub">${esc(level.artist)}</div>
            <div class="intro-diff">${diffIcon(diff.icon)}<span>${esc(diff.name)}</span></div>
        </div>`;
    el.intro.classList.add('is-on');
    clearTimeout(introTimer);
    introTimer = setTimeout(() => el.intro.classList.remove('is-on'), Math.max(900, (lead - 1.1) * 1000));
}

function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    fitGeo(geo, innerWidth, innerHeight);
    if (g) g.fx.setCenter(geo.cx, geo.cy);
}

addEventListener('resize', () => {
    if (g) resize();
});

// ===== Главный цикл =====

function frame() {
    if (!g) return;
    g.raf = requestAnimationFrame(frame);
    if (g.paused) return;
    const t = music.time();
    if (t == null) return;
    backdrop.sync(t, true);
    update(t);
    draw(t);
    hud(t);
}

const inDrop = t => g.song.drops.some(([a, b]) => t >= a && t < b);

function update(t) {
    const { song, notes } = g;
    // Биты: эффекты и «пульс» круга
    while (g.beat + 1 < song.beats.length && song.beats[g.beat + 1] <= t) {
        const i = ++g.beat;
        const bt = song.beats[i];
        if (t - bt > 0.25) continue;                 // вкладка «спала» — старые биты пропускаем
        const drop = inDrop(bt);
        const first = drop && (i === 0 || !inDrop(song.beats[i - 1]));
        if (g.fxMode !== 'manual') g.fx.beat(i, bt, drop, first, geo);
        if (first && !g.options.nosfx) sfx.drop();
        g.bumpAt = bt;
        g.bumpDrop = drop;
    }
    while (g.nextEffect < g.effects.length && g.effects[g.nextEffect].t <= t) {
        const effect = g.effects[g.nextEffect++];
        if (g.fxMode !== 'auto' && t - effect.t <= 0.25) g.fx.playEvent(effect, geo);
    }
    if (g.done) return;
    if (g.options.auto) autoplay(t);

    // Пропущенные ноты и концы длинных
    for (let k = g.next; k < notes.length; k++) {
        const n = notes[k];
        if (n.t - WIN[2] > t || g.done) break;
        if (n.state === 0 && t > n.t + WIN[2]) miss(n, t);
        else if (n.state === 1 && t >= n.end) finishHold(n, true, t);
    }
    while (g.next < notes.length && notes[g.next].state === 2) g.next++;

    // Точки для графика на результате — каждые полсекунды
    if (t >= 0 && t >= g.nextSample) {
        g.samples.push({ t, acc: recentAcc(), hp: g.hp });
        g.nextSample = t + 0.5;
    }
    if (!g.done && t >= g.end) finish(false, t);
}

function recentAcc() {
    if (!g.recent.length) return 1;
    return g.recent.reduce((s, v) => s + v, 0) / g.recent.length;
}

// «Авто»: игра нажимает сама — ровно вовремя
function autoplay(t) {
    for (let k = g.next; k < g.notes.length; k++) {
        const n = g.notes[k];
        if (n.t > t) break;
        if (n.state !== 0) continue;
        hit(n, 0, 0, t);
        g.pressAt = t;
        if (n.type === 'hold') g.autoUntil = n.end;
    }
}

// ===== Оценка нажатий =====

// Ближайшая ещё не сыгранная нота в окне попадания
function findNote(t) {
    for (let k = g.next; k < g.notes.length; k++) {
        const n = g.notes[k];
        if (n.t - WIN[2] > t) return null;
        if (n.state === 0 && Math.abs(t - n.t) <= WIN[2]) return n;
    }
    return null;
}

function hit(n, j, err, t) {
    judge(j, t);
    if (!g.options.nosfx) sfx.click(j);
    if (n.type === 'hold') {
        n.state = 1;
        g.fx.hit(t, holdAngle(n, Math.max(t, n.t)), geo, 3 - j);
        return;
    }
    // Запоминаем, где нота была в момент нажатия, — оттуда она отскочит от круга
    const p = placeNote(g.view, n, t) || { r: geo.rc, a: n.angle * DEG, s: 1 };
    Object.assign(n, { state: 2, result: 'hit', hitAt: t, hitR: p.r, hitA: p.a, hitS: p.s, kick: (Math.random() - 0.5) * 0.7 });
    g.fx.hit(t, p.a, geo, 3 - j);
    if (n.twin) g.fx.hit(t, p.a + Math.PI, geo, 3 - j);
}

function miss(n, t) {
    n.state = 2;
    n.result = 'miss';
    judge(3, t);
    if (n.type === 'hold') judge(3, t, 0.5);        // хвост тоже не засчитан (по здоровью — вдвое мягче)
    g.misses.push(n.t);
}

// Конец длинной ноты: досидел до конца — «Идеально», отпустил раньше — «Мимо»
function finishHold(n, ok, t) {
    n.state = 2;
    n.result = ok ? 'hit' : 'broken';
    judge(ok ? 0 : 3, t, 0.6);
    if (ok) {
        n.hitAt = t;                                 // конец линии тоже отскакивает
        n.hitA = holdAngle(n, n.end);
        g.fx.hit(t, n.hitA, geo, 3);
        if (!g.options.nosfx) sfx.soft();
    } else {
        g.misses.push(t);
    }
}

function judge(j, t, hpScale = 1) {
    const J = JUDGES[j];
    g.counts[j]++;
    g.judged++;
    g.accSum += J.acc;
    g.recent.push(J.acc);
    if (g.recent.length > 16) g.recent.shift();
    if (j === 3) {
        g.combo = 0;
    } else {
        g.combo++;
        g.maxCombo = Math.max(g.maxCombo, g.combo);
    }
    // Очки растут с комбо: до ×4 при комбо 300 — поэтому 999999 набрать трудно, но можно
    const add = Math.round(J.points * (1 + Math.min(g.combo, 300) / 100));
    if (add) {
        g.score += add;
        popScore(add);
    }
    hurt(J.hp * hpScale, t);
    g.judge = { j, t };
}

// Нажал, а нот рядом нет: на точность не влияет, но здоровье уходит
function extra(t) {
    g.extra++;
    g.judge = { j: 4, t };
    if (!g.options.nosfx) sfx.wrong();
    hurt(EXTRA_HP, t);
}

function hurt(dhp, t) {
    g.hp = clamp(g.hp + dhp, 0, 1);
    if (g.hp <= 0 && !g.options.nofail && !g.options.auto) finish(true, t);
}

function popScore(add) {
    el.add.textContent = `+${add}`;
    el.add.classList.remove('is-pop');
    void el.add.offsetWidth;                         // перезапуск анимации — и таймера «исчезнуть через пару секунд»
    el.add.classList.add('is-pop');
}

// ===== Управление =====

function press(id) {
    if (!g || g.paused || g.done || g.inputs.has(id)) return;
    g.inputs.add(id);
    const t = music.time();
    if (t == null) return;
    g.pressAt = t;
    if (g.options.auto) return;
    const n = findNote(t);
    if (!n) {
        if (t >= g.from) extra(t);                  // пока песня не началась — можно жать сколько угодно
        return;
    }
    const a = Math.abs(t - n.t);
    hit(n, a <= WIN[0] ? 0 : a <= WIN[1] ? 1 : 2, t - n.t, t);
}

function release(id) {
    if (!g || !g.inputs.delete(id) || g.inputs.size || g.paused || g.done || g.options.auto) return;
    const t = music.time();
    for (let k = g.next; k < g.notes.length; k++) {
        const n = g.notes[k];
        if (n.t - WIN[2] > t) break;                 // длинную могли нажать чуть раньше её времени
        if (n.state === 1) finishHold(n, t >= n.end - 0.12, t);
    }
}

addEventListener('keydown', e => {
    if (!g || !screen.classList.contains('is-on')) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        if (g.paused) resumeGame();
        else pauseGame();
        return;
    }
    if (g.paused || e.repeat) return;
    // Пробел и стрелки не листают страницу; Ctrl+R, F5 и подобное работают как обычно
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !/^F\d+$/.test(e.key)) e.preventDefault();
    press(`k${e.code}`);
});
addEventListener('keyup', e => release(`k${e.code}`));
screen.addEventListener('pointerdown', e => {
    if (!g || g.paused || e.target.closest('button')) return;
    e.preventDefault();
    press(`p${e.pointerId}`);
});
addEventListener('pointerup', e => release(`p${e.pointerId}`));
addEventListener('pointercancel', e => release(`p${e.pointerId}`));
screen.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('blur', () => pauseGame());
document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseGame();
});

// ===== Пауза =====

function pauseGame() {
    if (!g || g.paused || g.done) return;
    g.paused = true;
    g.inputs.clear();
    music.pause();
    backdrop.pause();
    el.pause.classList.add('is-open');
}

function resumeGame() {
    if (!g || !g.paused) return;
    g.paused = false;
    el.pause.classList.remove('is-open');
    if (document.activeElement) document.activeElement.blur();
    music.resume();
}

$('pauseBtn').addEventListener('click', () => {
    pauseGame();
    $('pauseBtn').blur();
});
$('resumeBtn').addEventListener('click', resumeGame);
$('restartBtn').addEventListener('click', () => {
    const c = cfg;
    stopGame();
    music.resume();
    startGame(c);
});
$('quitBtn').addEventListener('click', () => {
    const c = cfg;
    stopGame();
    music.resume();
    c.onExit(false);
});

function stopGame() {
    if (!g) return;
    cancelAnimationFrame(g.raf);
    music.stop();
    backdrop.clear();
    g = null;
    clearTimeout(introTimer);
    screen.classList.remove('is-on');
    el.pause.classList.remove('is-open');
    el.intro.classList.remove('is-on');
}

// ===== Конец уровня =====

function finish(failed, t) {
    if (g.done) return;
    g.done = true;
    g.failed = failed;
    g.failAt = t;
    g.samples.push({ t, acc: recentAcc(), hp: g.hp });
    if (failed) {
        music.slowDown(1.5);
        el.fail.classList.add('is-on');
    } else {
        music.fadeOut(1.2);
    }
    const game = g;
    if (cfg.test) {
        // проверка из редактора: результата нет, сразу обратно
        setTimeout(() => {
            if (g !== game) return;
            const exit = cfg.onExit;
            stopGame();
            exit(false);
        }, 1300);
        return;
    }
    setTimeout(() => results(game), failed ? 1900 : 1400);
}

function results(game) {
    if (g !== game) return;                          // уже вышли или начали заново
    const acc = game.judged ? game.accSum / game.judged : 0;
    const { level, diff } = cfg;
    const data = {
        title: level.title,
        artist: level.artist,
        sourceLabel: SOURCES[level.source] || '',
        diff,
        options: activeOptions().map(o => o.name),
        auto: game.options.auto,
        failed: game.failed,
        score: game.score,
        acc,
        maxCombo: game.maxCombo,
        counts: game.counts,
        extra: game.extra,
        grade: gradeOf(acc, game.counts[3], game.failed),
        samples: game.samples,
        misses: game.misses,
        length: game.failed ? game.failAt : game.end,
        quiet: game.options.nosfx,
        date: new Date()
    };
    const exit = cfg.onExit;
    stopGame();
    // Как в osu: на результате песня снова играет с середины, но приглушённо
    music.muffle(true, 0.01);
    music.play(game.song.startAt, 1.5);
    showResults(data, () => exit(true), game.song);
}

function gradeOf(acc, misses, failed) {
    if (failed) return 'F';
    if (acc >= 0.9999) return 'SS';
    if (acc >= 0.95 && misses === 0) return 'S';
    if (acc >= 0.9) return 'A';
    if (acc >= 0.8) return 'B';
    if (acc >= 0.7) return 'C';
    return 'D';
}

// ===== Счёт, здоровье, время =====

function hud(t) {
    if (g.shown !== g.score) {
        // счёт «докручивается» быстро, по нескольку очков за кадр
        g.shown = Math.min(g.score, Math.max(0, g.shown) + Math.max(1, Math.ceil((g.score - Math.max(0, g.shown)) / 7)));
        el.score.textContent = String(g.shown).padStart(6, '0');
    }
    g.hpShown += (g.hp - g.hpShown) * 0.18;
    el.hp.style.transform = `scaleX(${g.hpShown.toFixed(4)})`;
    el.progress.style.setProperty('--p', clamp(t / g.end, 0, 1).toFixed(4));
    el.watch.textContent = stopwatch(Math.max(0, t));
    const combo = g.combo >= 2 ? `${g.combo}x` : '';
    if (el.combo.textContent !== combo) el.combo.textContent = combo;
}

// 01:23:456 — минуты:секунды:миллисекунды
function stopwatch(sec) {
    const ms = Math.floor(sec * 1000);
    const p2 = n => String(n).padStart(2, '0');
    return `${p2(Math.floor(ms / 60000))}:${p2(Math.floor(ms / 1000) % 60)}:${String(ms % 1000).padStart(3, '0')}`;
}

// ===== Рисование =====

function draw(t) {
    const { W, H } = geo;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    if (backdrop.bg) {
        // за canvas — картинка или видео уровня, поверх неё — затемнение
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = `rgba(0, 0, 0, ${backdrop.shade(t).toFixed(3)})`;
    } else {
        ctx.fillStyle = '#000';
    }
    ctx.fillRect(0, 0, W, H);
    const [sx, sy] = g.fx.shakeOffset(t);
    ctx.translate(sx, sy);
    g.fx.drawBack(ctx, t, geo);
    // С какой ноты рисовать: ещё видны отскакивающие, засасываемые и хвосты отпущенных длинных нот
    const notes = g.notes;
    let s = g.next;
    while (s > 0 && g.next - s < 40 && (notes[s - 1].end || notes[s - 1].t) > t - 0.7) s--;
    drawNotes(g.view, notes, s, t);
    drawCircle(t);
    g.fx.drawFront(ctx, t);
    drawJudge(t);
}

// Круг в центре: белеет, пока нажата любая кнопка, и чуть «дышит» на битах
function drawCircle(t) {
    const { cx, cy, rc } = geo;
    const held = g.inputs.size > 0 || (g.options.auto && (t < g.autoUntil || t - g.pressAt < 0.09));
    g.fill += ((held ? 1 : 0) - g.fill) * (held ? 0.55 : 0.22);
    const k = t >= g.bumpAt ? Math.exp(-(t - g.bumpAt) * 9) : 0;
    const r = rc * (1 + k * (g.bumpDrop ? 0.13 : 0.06));
    ctx.globalAlpha = 1;
    if (g.fill > 0.02) {
        ctx.globalAlpha = Math.min(1, g.fill * 1.2);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(cx, cy, r * (0.35 + 0.65 * g.fill), 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
    ctx.lineWidth = Math.max(4, rc * 0.13);
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.stroke();
}

// «ИДЕАЛЬНО» / «МИМО» / «ЛИШНЕЕ» под кругом
function drawJudge(t) {
    const j = g.judge;
    if (!j) return;
    const dt = t - j.t;
    if (dt < 0 || dt > 0.6) return;
    const k = dt / 0.6;
    ctx.globalAlpha = (1 - k) * (j.j >= 3 ? 0.6 : 1);
    const size = 17 * (1 + 0.35 * Math.max(0, 1 - dt / 0.08));
    ctx.font = `700 ${size.toFixed(1)}px Rubik, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(JUDGES[j.j].name.toUpperCase(), geo.cx, geo.cy + geo.rc + 34 - k * 8);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 1;
}
