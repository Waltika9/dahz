// ===== AlmaMetro — главный модуль =====
// Экран загрузки → главное меню → 3D-карта Алматы: строим линии и здания,
// время идёт, люди пересаживаются из машин, пробки уменьшаются.
import { initLoader } from './loader.js?v=2';
import { initMenu } from './menu.js?v=3';
import { createMap, toggleTilt, goHome, createOrbit, HOME } from './map.js?v=4';
import { loadCity, cellAt } from './city.js?v=1';
import { computeTerrain, jamLabel, METRO, LRT, SKY } from './model.js?v=4';
import { addDataLayers, showLayer, setTerrainKind, updateTraffic, updateTerrain, TERRAIN_COLORS } from './layers.js?v=5';
import { TYPES, createLines, saveLines, clearLines, serializeLines, nextName, describe,
         extLine, describeExt, joinNodes, cutEnd, endNode } from './lines.js?v=6';
import { setupLineLayers, renderLines } from './render3d.js?v=7';
import { createTrains } from './trains.js?v=7';
import { createDrawer } from './draw.js?v=7';
import { prepareSim, refreshSim, runSim } from './sim.js?v=6';
import { RULES, newGame, loadGame, saveGame, clearGame, createClock, dateOf, fmtDate, fmtMonthYear,
         seasonOf, endDay, isOpen, progress } from './game.js?v=5';
import { USES, ROADS, loadBuilds, saveBuilds, clearBuilds, serializeBuilds, buildName, describeBuild, snapshotCity, applyBuilds,
         setupBuildLayers, renderBuilds } from './builds.js?v=9';
import { createBuilder } from './builder.js?v=10';
import { setupLandmarks } from './landmarks.js?v=4';
import { createScenery } from './scenery.js?v=1';
import { getSlot, setSlot, peek, write } from './store.js?v=2';
import { packSave, unpackSave, cleanSave, download, pickFile, EXT } from './savefile.js?v=8';
import { CHAPTERS, chapterParams, TUTORIAL, createCoach } from './story.js?v=2';
import { band } from './geo.js?v=1';

const loader = initLoader();
loader.setProgress(0.15);

// Меню видно сразу (под экраном загрузки), слайды начинают меняться
const menu = initMenu({ onAction: menuAction });
menu.show();

// Без MapLibre (нет интернета или CDN недоступен) показать карту не получится
if (!window.maplibregl) {
    loader.fail('Не удалось загрузить карту. Проверь интернет');
    throw new Error('maplibre-gl не загрузился');
}

let map;
try {
    map = createMap('map', p => loader.setProgress(p));
} catch (e) {
    // Чаще всего — браузер без WebGL
    loader.fail('Браузер не умеет 3D (WebGL)');
    throw e;
}

// ===== Состояние =====
let data = null, terrain = null, sim = null, traffic = null;
let lines = [], trains = null, drawer = null, selectedId = null;
let builds = [], builder = null, cityBase = null, selectedBuild = null;
let landmarks = null, scenery = null;   // достопримечательности на своих местах, деревья и «зебры»
// Объект игры не заменяется, а перезаписывается (replaceGame): часы держат ссылку именно на него
const game = loadGame() || newGame(getSlot());
game.mode = getSlot();
game.paused = true; // пока открыто меню, время стоит

const isCreative = () => getSlot() === 'creative';
const isStory = () => getSlot() === 'story';
document.body.classList.toggle('is-creative', isCreative());
document.body.classList.toggle('is-story', isStory());

function replaceGame(next) {
    for (const k of Object.keys(game)) delete game[k];
    Object.assign(game, next);
}

const fmt = n => Math.round(n).toLocaleString('ru-RU');
const num = v => v.toFixed(1).replace('.', ',');
const pct = v => `${Math.round(v * 100)}%`;

// ===== Данные города: грузятся вместе с картой =====
const styleReady = new Promise(res => map.once('style.load', res));
const dataReady = Promise.all([loadCity(), styleReady]).then(([d]) => {
    data = d;
    cityBase = snapshotCity(d.city);
    terrain = computeTerrain(d.city);
    // Нормировка пробок — по городу без построек игрока, поэтому сначала считаем исходный город
    sim = prepareSim(d.city);
    lines = createLines(d.metro);
    for (const l of lines) l._d = describe(l);
    builds = loadBuilds();
    if (builds.length) applyCity();
    traffic = runSim(sim, openLines());
    if (game.startAverage == null) game.startAverage = traffic.average;
    addDataLayers(map, d, terrain, traffic);
    landmarks = setupLandmarks(map);
    scenery = createScenery(map, { getObstacles: treeObstacles });
    document.querySelectorAll('.layer:disabled').forEach(b => { b.disabled = false; });
    updatePlace();
    initTransport();
    initBuild();
    initClock();
    refreshAll();
}).catch(e => {
    console.error(e);
    loader.fail('Не удалось загрузить данные города');
});

// Убираем загрузку, когда карта отрисовалась и данные готовы.
// Не дольше 15 секунд: если какие-то тайлы тормозят, всё равно показываем.
let shown = false;
const show = () => {
    if (shown) return;
    shown = true;
    loader.done();
};
Promise.all([new Promise(res => map.once('idle', res)), dataReady]).then(show);
setTimeout(show, 15000);

// ===== Меню ↔ игра =====
let started = false;
let sureRestart = false;
let pendingCamera = null;   // куда подлететь после загрузки из файла
const navRestart = document.getElementById('navRestart');
const navSave = document.getElementById('navSave');
const menuPlay = document.getElementById('menuPlayText');
const menuPlayMode = document.getElementById('menuPlayMode');
const badges = { free: document.getElementById('badgeFree'), creative: document.getElementById('badgeCreative'),
                 story: document.getElementById('badgeStory') };
const SLOT_NAMES = { free: 'свободная игра', creative: 'креатив', story: 'история' };

// Есть ли прогресс в режиме: текущий — по памяти, другой — по сохранению в браузере.
// story — начатая история (глава)
function slotInfo(s) {
    if (s === getSlot() && data) {
        return { has: game.day > 0 || lines.some(l => !l.locked) || builds.length > 0 || !!game.story, day: game.day, story: game.story };
    }
    const g = peek('game', s), l = peek('lines', s), b = peek('builds', s);
    const has = !!(g && (g.day > 0 || g.story)) || (Array.isArray(l) && l.length > 0) || (Array.isArray(b) && b.length > 0);
    return { has, day: g ? Number(g.day) || 0 : 0, story: g && g.story };
}

// Пункты меню: у начатых режимов — «продолжить · год» (у истории — глава)
function syncMenu() {
    for (const s of ['free', 'creative', 'story']) {
        const info = slotInfo(s);
        badges[s].hidden = !info.has;
        badges[s].textContent = s === 'story' && info.story
            ? (info.story.done ? 'пройдена' : `продолжить · глава ${Math.min(CHAPTERS.length, (info.story.chapter || 0) + 1)}`)
            : `продолжить · ${dateOf(info.day).getFullYear()}`;
    }
    const cur = slotInfo(getSlot());
    menuPlay.textContent = cur.has ? 'Продолжить' : 'Играть';
    // на «билете» — какой режим откроется
    menuPlayMode.textContent = SLOT_NAMES[getSlot()] + (cur.has && !(getSlot() === 'story' && cur.story)
        ? ` · ${dateOf(cur.day).getFullYear()}` : '');
    navSave.hidden = !data;
    navRestart.hidden = !cur.has;
    navRestart.textContent = sureRestart ? 'Точно начать заново? Всё построенное пропадёт'
        : `Начать заново · ${SLOT_NAMES[getSlot()]}`;
}

async function menuAction(action) {
    if (!data) {
        await dataReady;   // пока город не загрузился, меню подождёт
        if (!data) return;
    }
    if (action !== 'restart') sureRestart = false;
    if (action === 'play') return startGame();
    if (action === 'free' || action === 'creative' || action === 'story') {
        if (action !== getSlot()) switchSlot(action);
        return startGame();
    }
    if (action === 'save') return saveToFile();
    if (action === 'load') return loadFromFile();
    if (action === 'restart') {
        if (!sureRestart) { sureRestart = true; return syncMenu(); }
        sureRestart = false;
        restartGame();
        startGame();
    }
}

// Меню растворяется, камера подлетает к городу (или к месту из сохранения)
function startGame() {
    menu.hide();
    game.paused = false;
    const first = !started;
    const target = pendingCamera || HOME;
    pendingCamera = null;
    if (first) {
        started = true;
        map.jumpTo({ center: target.center, zoom: Math.max(10, target.zoom - 1.9), pitch: 40, bearing: target.bearing - 38 });
        map.flyTo({ ...target, duration: 2800, essential: true });
    } else if (target !== HOME) {
        map.flyTo({ ...target, duration: 2000, essential: true });
    }
    // В «Наблюдении» облёт начинается после подлёта камеры
    if (document.body.dataset.mode === 'watch') setTimeout(() => orbit.start(), first ? 2900 : 0);
    // История: новая — выбор сложности, начатая — продолжаем обучение
    if (isStory()) setTimeout(resumeStory, first ? 2900 : 300);
}

function openMenu() {
    orbit.stop();
    game.paused = true;
    sureRestart = false;
    saveGame(game);
    syncMenu();
    menu.show();
}

// Новая игра в текущем режиме: стираем линии и постройки игрока и прогресс
function restartGame() {
    clearGame();
    clearLines();
    clearBuilds();
    loadSlot();
    game.startAverage = traffic.average;
    saveGame(game);
    syncMenu();
}

// Перейти в другой режим: текущий остаётся сохранённым в браузере
function switchSlot(s) {
    saveGame(game);
    setSlot(s);
    loadSlot();
}

// Всё состояние — из сохранения текущего режима в браузере
function loadSlot() {
    if (drawer) drawer.cancel();
    if (builder) builder.cancel();
    replaceGame(loadGame() || newGame(getSlot()));
    game.mode = getSlot();
    game.paused = true;
    lines.splice(0, lines.length, ...createLines(data.metro));
    for (const l of lines) l._d = describe(l);
    builds.splice(0, builds.length, ...loadBuilds());
    selectedId = null;
    selectedBuild = null;
    sureDelete = null;
    sureRemove = null;
    storyBusy = false;
    coach.hide();
    endModal.hidden = true;
    applyCity();
    recompute();
    if (game.startAverage == null) game.startAverage = traffic.average;
    setSpeed(game.speed);
    syncCreative();
    updateGoal();
}

// ===== Сохранение в файл и загрузка =====
async function saveToFile() {
    if (!data) return;
    saveGame(game);
    const { paused, ...g } = game;
    const c = map.getCenter();
    const payload = {
        kind: 'almametro-save', v: 1, savedAt: Date.now(), mode: getSlot(), game: g,
        lines: serializeLines(lines), builds: serializeBuilds(builds),
        camera: { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }
    };
    try {
        const d = dateOf(game.day);
        const name = `AlmaMetro-${getSlot() === 'free' ? '' : getSlot() + '-'}${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}${EXT}`;
        download(await packSave(payload), name);
        toast(`Сохранено в файл <b>${name}</b>`);
    } catch (e) {
        console.error(e);
        askFile({ title: 'Не получилось сохранить', text: e.message });
    }
}

async function loadFromFile() {
    const file = await pickFile();
    if (!file) return;
    let save;
    try {
        if (file.size > 5e6) throw new Error('Файл слишком большой — это не сохранение AlmaMetro');
        save = cleanSave(await unpackSave(await file.arrayBuffer()));
    } catch (e) {
        return askFile({ title: 'Не получилось открыть файл', text: e.message });
    }
    const d = dateOf(save.game.day);
    const when = new Date(save.savedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    const replace = slotInfo(save.mode).has;
    askFile({
        title: 'Загрузить сохранение?',
        text: `Режим: ${SLOT_NAMES[save.mode]}. Файл сохранён ${when}.`
            + (replace ? ` Текущая игра в этом режиме заменится — если она нужна, сначала сохрани её в файл.` : ''),
        stats: [['В игре', `${fmtDate(d)} ${d.getFullYear()}`], ['Линий', save.lines.length + 1], ['Построек', save.builds.length]],
        ok: () => applySave(save)
    });
}

function applySave(save) {
    if (save.mode !== getSlot()) saveGame(game);   // другой режим остаётся в браузере как был
    setSlot(save.mode);
    saveGame(save.game);
    write('lines', save.lines);
    write('builds', save.builds);
    loadSlot();
    pendingCamera = save.camera;
    startGame();
    toast(`Сохранение загружено · ${fmtDate(dateOf(game.day))} ${dateOf(game.day).getFullYear()}`);
}

// ===== Окно-вопрос (файлы, главы истории) =====
// buttons: [{ text, primary, esc, onClick }]; esc — кнопка, которую жмёт клавиша Esc.
// Пока окно открыто, время стоит
const dlg = {
    modal: document.getElementById('dialog'),
    kicker: document.getElementById('dialogKicker'),
    title: document.getElementById('dialogTitle'),
    text: document.getElementById('dialogText'),
    extra: document.getElementById('dialogExtra'),
    stats: document.getElementById('dialogStats'),
    actions: document.getElementById('dialogActions')
};
let dialogEsc = null;

function dialog({ kicker = '', title, text = '', extra = null, stats = null, buttons }) {
    dlg.kicker.textContent = kicker;
    dlg.title.textContent = title;
    dlg.text.textContent = text;
    dlg.extra.innerHTML = '';
    if (extra) dlg.extra.appendChild(extra);
    dlg.stats.hidden = !stats;
    dlg.stats.innerHTML = '';
    for (const [label, value] of stats || []) {
        const div = document.createElement('div');
        div.innerHTML = '<small></small><b></b>';
        div.firstChild.textContent = label;
        div.lastChild.textContent = value;
        dlg.stats.appendChild(div);
    }
    dlg.actions.innerHTML = '';
    for (const b of buttons) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = b.primary ? 'btn-primary btn-small' : 'btn-line';
        el.textContent = b.text;
        el.addEventListener('click', () => {
            closeDialog();
            if (b.onClick) b.onClick();
        });
        dlg.actions.appendChild(el);
        if (b.esc) dialogEsc = el;
    }
    game.paused = true;
    dlg.modal.hidden = false;
}

function closeDialog() {
    dlg.modal.hidden = true;
    dialogEsc = null;
    if (!menu.open && endModal.hidden) game.paused = false;
}

// Сообщение о файле: ok — что делать по «Загрузить»; без ok — просто «Понятно»
function askFile({ title, text, stats = null, ok = null }) {
    dialog({
        title, text, stats,
        buttons: ok ? [{ text: 'Отмена', esc: true }, { text: 'Загрузить', primary: true, onClick: ok }]
            : [{ text: 'Понятно', primary: true, esc: true }]
    });
}

document.getElementById('menuBtn').addEventListener('click', openMenu);

// Клавиши: Ctrl+S — в файл; рисование линии или стройка → своё;
// пробел — пауза, 1/2/3 — скорость; Esc — меню
window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
        e.preventDefault();
        saveToFile();
        return;
    }
    if (!dlg.modal.hidden) {
        if (e.key === 'Escape' && dialogEsc) dialogEsc.click();
        return;
    }
    if (!menu.open && builder && builder.handleKey(e)) return;
    if (!menu.open && drawer && drawer.handleKey(e)) return;
    if (!menu.open && endModal.hidden) {
        if (e.code === 'Space') { e.preventDefault(); setSpeed(game.speed === 0 ? (game.lastSpeed || 1) : 0); return; }
        if (['1', '2', '3'].includes(e.key)) { setSpeed(Number(e.key)); return; }
    }
    if (e.key !== 'Escape') return;
    if (menu.open) { if (started) startGame(); }
    else openMenu();
});

// ===== Режимы =====
const modesEl = document.getElementById('modes');
const pill = document.getElementById('modesPill');
const modeBtns = [...modesEl.querySelectorAll('.mode')];
const orbit = createOrbit(map);

function setMode(mode) {
    document.body.dataset.mode = mode;
    modeBtns.forEach(b => {
        const on = b.dataset.mode === mode;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on);
    });
    movePill();
    if (mode !== 'transport' && drawer) drawer.cancel();
    if (mode !== 'build' && builder) builder.cancel();
    if (mode === 'watch' && !menu.open) orbit.start();
    else orbit.stop();
    try { localStorage.setItem('a-metro_mode', mode); } catch (e) { /* не страшно */ }
}

// Белая «таблетка» под выбранным режимом
function movePill() {
    const btn = modeBtns.find(b => b.classList.contains('is-active'));
    if (!btn) return;
    pill.style.width = `${btn.offsetWidth}px`;
    pill.style.transform = `translateX(${btn.offsetLeft}px)`;
}

modeBtns.forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
window.addEventListener('resize', movePill);

let startMode = 'transport';
try { startMode = localStorage.getItem('a-metro_mode') || 'transport'; } catch (e) { /* по умолчанию */ }
// Облёт в «Наблюдении» начнётся только после выхода из меню
setMode(startMode);
if (document.fonts) document.fonts.ready.then(movePill);

// ===== Камера =====
const tiltLabel = document.getElementById('camTiltLabel');
const compass = document.getElementById('compass');

document.getElementById('camZoomIn').addEventListener('click', () => map.zoomIn());
document.getElementById('camZoomOut').addEventListener('click', () => map.zoomOut());
document.getElementById('camNorth').addEventListener('click', () => map.easeTo({ bearing: 0, duration: 800 }));
document.getElementById('camHome').addEventListener('click', () => goHome(map));
document.getElementById('camTilt').addEventListener('click', () => toggleTilt(map));

// Компас поворачивается вместе с картой, подпись кнопки — куда переключит
const syncCamera = () => {
    compass.style.transform = `rotate(${-map.getBearing()}deg)`;
    tiltLabel.textContent = map.getPitch() < 10 ? '3D' : '2D';
};
map.on('move', syncCamera);
syncCamera();

// Слева сверху: район в центре экрана
const placeEl = document.getElementById('place');
function updatePlace() {
    if (!data) return;
    const c = map.getCenter();
    const i = cellAt(data.city, c.lng, c.lat);
    const d = i >= 0 ? data.city.district[i] : -1;
    placeEl.textContent = d >= 0 ? `Алматы · ${data.city.districtNames[d]}` : 'Окрестности Алматы';
}
map.on('moveend', updatePlace);

// ===== Слои: карта, загруженность, местность =====
const layerBtns = [...document.querySelectorAll('.layer')];
const legend = document.getElementById('legend');
let layer = 'map', terrainKind = 'all';

const KIND_NAMES = { metro: 'Метро', lrt: 'ЛРТ', sky: 'SkyTrain' };
const COMBO_NAMES = [
    [METRO | LRT | SKY, 'Все три вида'],
    [METRO | LRT, 'Метро и ЛРТ'],
    [METRO | SKY, 'Метро и SkyTrain'],
    [LRT | SKY, 'ЛРТ и SkyTrain'],
    [METRO, 'Только метро'],
    [LRT, 'Только ЛРТ'],
    [SKY, 'Только SkyTrain']
];

function setLayer(name) {
    layer = name;
    layerBtns.forEach(b => b.classList.toggle('is-active', b.dataset.layer === name));
    showLayer(map, name);
    renderLegend();
    hideTip();
}

function renderLegend() {
    if (layer === 'traffic' && traffic) {
        legend.innerHTML = `
            <div>Средняя загрузка дорог</div>
            <div class="legend-big">${pct(traffic.average)}</div>
            <div class="legend-bar"></div>
            <div class="legend-scale"><span>свободно</span><span>пробки</span><span>коллапс</span></div>
            <div class="legend-note">Час пик утром. На метро, ЛРТ и SkyTrain едет ${pct(traffic.transitShare)} людей — их машины не стоят в пробках. Автобусы стоят в тех же пробках.</div>`;
    } else if (layer === 'terrain') {
        const chips = ['all', 'metro', 'lrt', 'sky'].map(k =>
            `<button class="legend-chip${k === terrainKind ? ' is-active' : ''}" type="button" data-kind="${k}">${k === 'all' ? 'Все' : KIND_NAMES[k]}</button>`).join('');
        const rows = terrainKind === 'all'
            ? COMBO_NAMES.map(([bits, text]) => `<div class="legend-row"><span class="legend-sw" style="background:${TERRAIN_COLORS[bits]}"></span>${text}</div>`).join('')
            : `<div class="legend-row"><span class="legend-sw" style="background:${TERRAIN_COLORS[{ metro: METRO, lrt: LRT, sky: SKY }[terrainKind]]}"></span>Можно строить</div>`;
        legend.innerHTML = `
            <div class="legend-chips">${chips}</div>
            <div class="legend-list">${rows}
                <div class="legend-row"><span class="legend-sw" style="background:#9aa5b8"></span>Нельзя</div>
            </div>
            <div class="legend-note">Наведи на клетку, чтобы узнать почему.</div>`;
        legend.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
            terrainKind = b.dataset.kind;
            setTerrainKind(map, terrainKind);
            renderLegend();
        }));
    }
    legend.hidden = layer === 'map';
}

layerBtns.forEach(b => b.addEventListener('click', () => { if (!b.disabled) setLayer(b.dataset.layer); }));

// ===== Подсказка о клетке под курсором (на телефоне — по нажатию) =====
const tip = document.getElementById('tip');

function hideTip() { tip.hidden = true; }

function showTip(point, lngLat) {
    if (!data || layer === 'map' || (drawer && drawer.active) || (builder && builder.active)) return hideTip();
    const { city } = data;
    const i = cellAt(city, lngLat.lng, lngLat.lat);
    if (i < 0) return hideTip();

    const d = city.district[i];
    let html = `<b>${d >= 0 ? city.districtNames[d] : 'За границей районов'}</b><br>`;
    html += `<span class="muted">Жители: ${fmt(city.pop[i])} · работа: ${fmt(city.jobs[i])}</span><br>`;

    if (layer === 'traffic') {
        const j = traffic.jam[i];
        html += j > 0 ? `Загрузка: <b>${pct(j)}</b> — ${jamLabel(j)}` : '<span class="muted">Здесь почти никто не живёт и не работает</span>';
    } else {
        const a = terrain.allow[i];
        const ok = [[METRO, 'Метро', '#e5484d'], [LRT, 'ЛРТ', '#2fb67c'], [SKY, 'SkyTrain', '#8b5cf6']]
            .filter(([bit]) => a & bit).map(([, n, c]) => `<span class="tag" style="background:${c}">${n}</span>`).join('');
        html += ok ? `Можно: ${ok}` : '<b>Строить нельзя</b>';
        if (terrain.why[i].length) html += `<br><span class="muted">${terrain.why[i].join('; ')}</span>`;
        html += `<br><span class="muted">Высота ${fmt(city.elev[i])} м · уклон ${Math.round(terrain.slope[i] * 100)}%</span>`;
    }
    tip.innerHTML = html;
    tip.hidden = false;
    // Не даём подсказке вылезти за правый и нижний край
    const x = Math.min(point.x, innerWidth - tip.offsetWidth - 24);
    const y = Math.min(point.y, innerHeight - tip.offsetHeight - 24);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
}

let tipFrame = 0;
map.on('mousemove', e => {
    cancelAnimationFrame(tipFrame);
    tipFrame = requestAnimationFrame(() => showTip(e.point, e.lngLat));
});
map.on('click', e => showTip(e.point, e.lngLat));
map.getCanvas().addEventListener('mouseleave', hideTip);
map.on('movestart', hideTip);

// ===== Пересчёт: кто на чём ездит, пробки, станции =====
const openLines = () => lines.filter(l => isOpen(l, game.day));

// Линии и их строящиеся продления (продление рисуется как отдельная «стройка»)
const shownLines = () => lines.concat(lines.filter(l => l.ext).map(l => extLine(l)));

function drawLines() {
    renderLines(map, shownLines(), selectedId, { isOpen: l => isOpen(l, game.day), stationRiders: traffic ? traffic.stationRiders : new Map() });
    scenery?.refresh();
}

// Где деревьям не место: достопримечательности, свои постройки и дороги, наземные линии (метро — под землёй)
function treeObstacles() {
    const out = landmarks ? landmarks.footprints() : [];
    for (const b of builds) {
        const d = describeBuild(b);
        out.push(b.kind === 'road' ? band(d.path.pts, d.width + 4)[0] : d.footprint);
    }
    for (const l of shownLines()) {
        if (l.type === 'metro') continue;
        const d = l._d || (l._d = describe(l));
        out.push(band(d.path.pts, 18)[0]);
    }
    return out;
}

function recompute() {
    for (const l of lines) l._d = l._d || describe(l);
    traffic = runSim(sim, openLines());
    updateTraffic(map, data, traffic.jam);
    if (trains) trains.rebuild();
    refreshAll();
}

// Город = данные OSM + готовые постройки игрока: заново жители, дороги, поездки, местность
function applyCity() {
    applyBuilds(data.city, cityBase, builds, b => isOpen(b, game.day));
    // История: город вырос — жителей и рабочих мест больше, поездок тоже
    const grow = game.growth || 1;
    if (grow !== 1) {
        for (let i = 0; i < data.city.size; i++) { data.city.pop[i] *= grow; data.city.jobs[i] *= grow; }
    }
    refreshSim(sim);
    // Слой местности перерисовываем, только если где-то поменялось, что можно строить
    const old = terrain;
    terrain = computeTerrain(data.city);
    if (!old || old.allow.some((a, i) => a !== terrain.allow[i])) updateTerrain(map, data.city, terrain);
}

function refreshAll() {
    drawLines();
    drawBuilds();
    renderLegend();
    renderLinesPanel();
    renderBuildsPanel();
    updateGoal();
    updateMoney();
    updateClock(true);
    syncMenu();
}

// ===== Транспорт: линии, поезда, рисование =====
const toolBtns = [...document.querySelectorAll('[data-tool]')];
const linesList = document.getElementById('linesList');
const linesCount = document.getElementById('linesCount');
let sureDelete = null;      // линия, которую уже раз попросили снести
let sureCut = null;         // у какой линии открыт выбор «какой конец укоротить»
let layerBeforeDraw = null; // какой слой был до рисования — вернём после

function initTransport() {
    setupLineLayers(map);
    trains = createTrains(map, openLines, () => (game.paused ? 0 : [0, 1, 1.6, 2.5][game.speed]));
    drawer = createDrawer({
        map, lines,
        getCity: () => data.city,
        getTerrain: () => terrain,
        getBudget: () => (isCreative() ? Infinity : game.budget),
        onBuild: buildLine,
        onExtend: extendLine,
        onChange: syncTools
    });
    toolBtns.forEach(b => {
        b.disabled = false;
        b.addEventListener('click', () => {
            if (drawer.type === b.dataset.tool) return drawer.cancel();
            if (drawer.active) drawer.cancel(); // сменили вид посреди рисования — начнём заново
            // Пока рисуем — показываем слой местности, чтобы было видно, где можно строить
            layerBeforeDraw = layer;
            setLayer('terrain');
            drawer.start(b.dataset.tool);
        });
    });

    // Нажатие на линию на карте — выбрать её в списке
    map.on('click', e => {
        if (drawer.active || document.body.dataset.mode !== 'transport') return;
        const p = e.point;
        const f = map.queryRenderedFeatures([[p.x - 6, p.y - 6], [p.x + 6, p.y + 6]], { layers: ['tr-path-line', 'tr-path-building'] })[0];
        if (f) select(String(f.properties.id).replace(/:ext$/, ''));
    });
}

// Вид, который сейчас рисуем, — кольцо закрашено; при рисовании на телефоне прячем лишнее
function syncTools() {
    const type = drawer && drawer.type, active = drawer && drawer.active;
    toolBtns.forEach(b => b.classList.toggle('is-active', b.dataset.tool === type));
    document.body.classList.toggle('is-drawing', !!active);
    if (active) hideTip();
    else if (layerBeforeDraw) { setLayer(layerBeforeDraw); layerBeforeDraw = null; }
}

// Новая линия: платим сразу, строится месяцами.
// В креативе денег не берём, а с «Строить сразу» линия открывается мгновенно
function buildLine(line) {
    const d = describe(line);
    const instant = isCreative() && game.instant;
    line._d = d;
    line.name = nextName(lines);
    line.cost = isCreative() ? 0 : d.cost;
    line.start = Math.floor(game.day);
    line.ready = instant ? line.start : line.start + Math.round(d.months * 30.4);
    game.budget -= line.cost;
    lines.push(line);
    selectedId = line.id;
    saveLines(lines);
    saveGame(game);
    if (instant) {
        toast(`<b>${line.name}</b> открыта! Поезда вышли на линию`);
        recompute();
    } else {
        toast(`Стройка началась: <b>${line.name}</b> · откроется в ${fmtMonthYear(dateOf(line.ready))}`);
        refreshAll();
    }
}

function select(id) {
    selectedId = selectedId === id ? null : id;
    sureDelete = null;
    sureCut = null;
    drawLines();
    renderLinesPanel();
}

// Снос: недостроенная линия возвращает половину денег
function removeLine(id) {
    const i = lines.findIndex(l => l.id === id);
    if (i < 0 || lines[i].locked) return;
    const line = lines[i];
    const wasOpen = isOpen(line, game.day);
    lines.splice(i, 1);
    selectedId = null;
    // недостроенное продление тоже возвращает половину
    const extBack = line.ext ? Math.round((line.ext.cost || 0) / 2) : 0;
    if (!wasOpen) {
        const back = Math.round((line.cost || 0) / 2) + extBack;
        game.budget += back;
        toast(`${line.name} снесена${back ? ` · вернули ${back} млрд ₸` : ''}`);
    } else {
        game.budget += extBack;
        toast(`${line.name} закрыта${extBack ? ` · за продление вернули ${extBack} млрд ₸` : ''}`);
    }
    saveLines(lines);
    saveGame(game);
    if (wasOpen) recompute(); else refreshAll();
}

// ---------- Продление и укорачивание ----------
// Продлить: открытая линия продолжает работать, новый участок строится отдельно (line.ext).
// Недостроенная линия просто становится длиннее, а стройка — дольше
function extendLine(line, end, nodes) {
    const info = describeExt(line, end, nodes);
    const cost = isCreative() ? 0 : info.cost;
    const today = Math.floor(game.day), instant = isCreative() && game.instant;
    const months = Math.round(info.months * 30.4);
    game.budget -= cost;
    selectedId = line.id;
    if (instant || !isOpen(line, game.day)) {
        line.nodes = joinNodes(line, end, nodes);
        line._d = null;
        line.cost = (line.cost || 0) + cost;
        if (!isOpen(line, game.day)) line.ready = instant ? today : Math.max(line.ready, today + months);
        toast(instant ? `<b>${line.name}</b> продлена: +${info.stations} ст.` : `<b>${line.name}</b> стала длиннее · откроется в ${fmtMonthYear(dateOf(line.ready))}`);
    } else {
        line.ext = { end, nodes, start: today, ready: today + months, cost };
        toast(`Продление <b>${line.name}</b>: стройка до ${fmtMonthYear(dateOf(line.ext.ready))} · линия пока работает как была`);
    }
    saveLines(lines);
    saveGame(game);
    if (instant) recompute(); else refreshAll();
}

// Достроенные продления присоединяем к линиям (проверка раз в игровой день)
function checkExtensions() {
    const done = lines.filter(l => l.ext && l.ext.ready <= game.day);
    if (!done.length) return;
    for (const l of done) {
        const added = l.ext.nodes.filter(n => n.s).length;
        l.nodes = joinNodes(l, l.ext.end, l.ext.nodes);
        l.cost = (l.cost || 0) + (l.ext.cost || 0);
        delete l.ext;
        l._d = null;
        toast(`<b>${l.name}</b>: продление открыто, +${added} ст.`);
    }
    saveLines(lines);
    recompute();
    saveGame(game);
    checkGoal();
}

// Отменить строящееся продление — вернуть половину денег
function cancelExtension(line) {
    if (!line.ext) return;
    const back = Math.round((line.ext.cost || 0) / 2);
    game.budget += back;
    delete line.ext;
    toast(`Продление <b>${line.name}</b> отменено${back ? ` · вернули ${back} млрд ₸` : ''}`);
    saveLines(lines);
    saveGame(game);
    refreshAll();
}

// Укоротить: убрать конечную станцию. На стройке — вернуть половину за убранный кусок
// и, может быть, открыть раньше; у открытой линии станция просто закрывается
function shortenLine(line, end) {
    const nodes = cutEnd(line, end);
    if (!nodes) return;
    const gone = endNode(line, end).s;
    const open = isOpen(line, game.day);
    const before = describe(line);
    line.nodes = nodes;
    line._d = describe(line);
    if (!open) {
        const back = isCreative() ? 0 : Math.round(Math.max(0, (line.cost || 0) - line._d.cost) / 2);
        game.budget += back;
        line.cost = Math.min(line.cost || 0, line._d.cost);
        const shorter = Math.round((before.months - line._d.months) * 30.4);
        line.ready = Math.max(Math.floor(game.day), line.ready - Math.max(0, shorter));
        toast(`${line.name} короче: без «${gone}»${back ? ` · вернули ${back} млрд ₸` : ''}`);
    } else {
        toast(`${line.name}: станция «${gone}» закрыта`);
    }
    sureCut = null;
    saveLines(lines);
    saveGame(game);
    if (open || isOpen(line, game.day)) recompute(); else refreshAll();
}

function showLine(line) {
    const d = line._d || (line._d = describe(line));
    const lons = d.path.pts.map(p => p[0]), lats = d.path.pts.map(p => p[1]);
    // Отступы под панели; на узком экране — меньше, иначе карте не хватит места
    const wide = innerWidth > 760;
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
        { padding: wide ? { top: 90, bottom: 150, left: 290, right: 310 } : { top: 70, bottom: 140, left: 70, right: 70 },
          pitch: 55, maxZoom: 16, duration: 1400 });
}

function renderLinesPanel() {
    linesCount.textContent = `· ${lines.length}`;
    linesList.innerHTML = '';
    for (const line of lines) {
        const d = line._d || (line._d = describe(line));
        const open = isOpen(line, game.day);
        const riders = traffic && traffic.riders.get(line.id) || 0;
        const row = document.createElement('div');
        row.className = `line-row${line.id === selectedId ? ' is-selected' : ''}`;
        const status = open
            ? `${Math.round(riders / 1000)} тыс./день`
            : `стройка ${Math.round(progress(line, game.day) * 100)}%`;
        row.innerHTML = `
            <span class="line-bar" style="background:${line.color}${open ? '' : ';opacity:.45'}"></span>
            <div class="line-main"><b>${line.name}</b><small>${TYPES[line.type].name} · ${d.stations.length} ст. · ${num(d.km)} км</small></div>
            <span class="line-cost">${status}</span>`;
        row.addEventListener('click', () => select(line.id));

        if (line.id === selectedId) {
            const more = document.createElement('div');
            more.className = 'line-more';
            more.innerHTML = line.locked ? '<span>Открыта в 2011 году</span>'
                : open ? (line.cost ? `<span>Стоила ${line.cost} млрд ₸</span>` : '')
                : `<span>Откроется в ${fmtMonthYear(dateOf(line.ready))}</span>`;
            const btn = (text, onClick, cls = '') => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = `btn-line${cls ? ` ${cls}` : ''}`;
                b.textContent = text;
                b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
                more.appendChild(b);
                return b;
            };
            btn('Показать', () => showLine(line));
            if (!line.locked) {
                // Продлить с любого конца; пока продление строится — его можно отменить
                if (line.ext) {
                    const info = document.createElement('span');
                    info.textContent = `Продление откроется в ${fmtMonthYear(dateOf(line.ext.ready))}`;
                    more.appendChild(info);
                    btn('Отменить продление', () => cancelExtension(line));
                } else {
                    btn('Продлить', () => {
                        if (drawer.active) drawer.cancel();
                        layerBeforeDraw = layer;
                        setLayer('terrain');
                        toggleList(false);
                        drawer.extend(line);
                    });
                }
                // Укоротить: выбрать, какую конечную убрать (не тот конец, где строится продление)
                const ends = ['head', 'tail'].filter(end => !(line.ext && line.ext.end === end));
                if (d.stations.length >= 3 && ends.length) {
                    if (sureCut === line.id) {
                        for (const end of ends) btn(`Убрать «${endNode(line, end).s}»`, () => shortenLine(line, end), 'is-danger');
                    } else btn('Укоротить', () => { sureCut = line.id; renderLinesPanel(); });
                }
                const del = document.createElement('button');
                del.type = 'button';
                del.className = `btn-line is-danger${sureDelete === line.id ? ' is-sure' : ''}`;
                del.textContent = sureDelete === line.id ? (open ? 'Точно закрыть?' : 'Точно снести? Вернём ½') : (open ? 'Закрыть' : 'Снести');
                del.addEventListener('click', e => {
                    e.stopPropagation();
                    if (sureDelete === line.id) removeLine(line.id);
                    else { sureDelete = line.id; renderLinesPanel(); }
                });
                more.appendChild(del);
            }
            row.appendChild(more);
        }
        linesList.appendChild(row);
    }
    if (lines.length === 1) {
        const hint = document.createElement('div');
        hint.className = 'lines-empty';
        hint.textContent = 'Выбери внизу метро, ЛРТ или SkyTrain и нажимай на карту, чтобы поставить станции.';
        linesList.appendChild(hint);
    }
}

// ===== Телефон: кнопка «Список» в нижней панели открывает список линий или построек =====
const listBtns = [...document.querySelectorAll('[data-list]')];
function toggleList(on = !document.body.classList.contains('show-list')) {
    document.body.classList.toggle('show-list', on);
    listBtns.forEach(b => b.classList.toggle('is-active', on));
}
listBtns.forEach(b => b.addEventListener('click', () => toggleList()));

// ===== Строительство: свои здания, готовые модели, дороги =====
const buildBtns = [...document.querySelectorAll('[data-build]')];
const buildsList = document.getElementById('buildsList');
const buildsCount = document.getElementById('buildsCount');
let sureRemove = null;   // постройка, которую уже раз попросили снести

function initBuild() {
    setupBuildLayers(map);
    builder = createBuilder({
        map, builds,
        getCity: () => data.city,
        getLines: () => lines,
        getBudget: () => (isCreative() ? Infinity : game.budget),
        onBuild: addBuild,
        onChange: syncBuildTools
    });
    buildBtns.forEach(b => {
        b.disabled = false;
        b.addEventListener('click', () => {
            if (builder.tool === b.dataset.build) return builder.cancel();
            builder.start(b.dataset.build);
        });
    });

    // Нажатие на свою постройку — выбрать её в списке
    map.on('click', e => {
        if (builder.active || document.body.dataset.mode !== 'build') return;
        const p = e.point;
        const f = map.queryRenderedFeatures([[p.x - 4, p.y - 4], [p.x + 4, p.y + 4]], { layers: ['bd-solid', 'bd-grow', 'bd-roads-line'] })[0];
        if (f) selectBuild(f.properties.id);
    });
}

function syncBuildTools() {
    const tool = builder && builder.tool;
    buildBtns.forEach(b => b.classList.toggle('is-active', b.dataset.build === tool));
    document.body.classList.toggle('is-drawing', !!tool);
    if (tool) hideTip();
}

function drawBuilds(onlyGrowing = false) {
    renderBuilds(map, builds, { selectedId: selectedBuild, progressOf: b => progress(b, game.day), t: game.day, onlyGrowing });
    if (!onlyGrowing) scenery?.refresh();
}

// Пока что-то строится — здания растут этажами (перерисовка раз в игровой день)
// Не чаще 4 раз в секунду: на большой скорости дни летят, а перерисовка не бесплатная
let grownDay = -1, grownAt = 0;
function growBuilds() {
    const day = Math.floor(game.day);
    if (day === grownDay || performance.now() - grownAt < 250) return;
    grownDay = day;
    grownAt = performance.now();
    if (builds.some(b => !isOpen(b, game.day))) drawBuilds(true);
}

// Новая постройка строится месяцами. Здания — бесплатно (инвесторы), дороги — из бюджета.
// В креативе всё бесплатно, а с «Строить сразу» появляется мгновенно
function addBuild(b) {
    const d = describeBuild(b);
    const instant = isCreative() && game.instant;
    b.id = `b${Date.now().toString(36)}`;
    b.name = buildName(builds, b);
    b.start = Math.floor(game.day);
    b.ready = instant ? b.start : b.start + Math.round(d.months * 30.4);
    if (b.kind === 'road' && !isCreative()) {
        b.cost = d.cost;
        game.budget -= d.cost;
        updateMoney();
    }
    builds.push(b);
    selectedBuild = b.id;
    sureRemove = null;
    saveBuilds(builds);
    saveGame(game);
    if (instant) {
        toast(`<b>${b.name}</b>: готово`);
        applyCity();
        recompute();
        return;
    }
    const price = b.cost ? ` · ${b.cost} млрд ₸` : '';
    toast(`Стройка началась: <b>${b.name}</b>${price} · готово в ${fmtMonthYear(dateOf(b.ready))}`);
    drawBuilds();
    renderBuildsPanel();
    syncMenu();
}

function selectBuild(id) {
    selectedBuild = selectedBuild === id ? null : id;
    sureRemove = null;
    drawBuilds();
    renderBuildsPanel();
}

// Снести можно только своё. Недостроенная дорога возвращает половину денег
function removeBuild(id) {
    const i = builds.findIndex(b => b.id === id);
    if (i < 0) return;
    const b = builds[i];
    const wasReady = isOpen(b, game.day);
    builds.splice(i, 1);
    selectedBuild = null;
    saveBuilds(builds);
    const back = !wasReady && b.cost ? Math.round(b.cost / 2) : 0;
    if (back) {
        game.budget += back;
        updateMoney();
        saveGame(game);
    }
    toast(`Снесли: <b>${b.name}</b>${back ? ` · вернули ${back} млрд ₸` : ''}`);
    if (wasReady) { applyCity(); recompute(); }
    else { drawBuilds(); renderBuildsPanel(); syncMenu(); }
}

function showBuild(b) {
    const d = describeBuild(b);
    const pts = b.kind === 'road' ? d.path.pts : d.footprint;
    const lons = pts.map(p => p[0]), lats = pts.map(p => p[1]);
    const wide = innerWidth > 760;
    // Высокое здание показываем издалека, иначе верх не влезет
    const maxZoom = b.kind === 'road' ? 16 : d.height > 300 ? 14.4 : d.height > 100 ? 15.4 : 16.4;
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
        { padding: wide ? { top: 90, bottom: 150, left: 290, right: 310 } : { top: 70, bottom: 140, left: 70, right: 70 },
          pitch: 60, maxZoom, duration: 1400 });
}

// Коротко о постройке: «Жильё · 12 эт. · 1 200 жит.»
function buildSummary(b, d) {
    if (b.kind === 'road') {
        const r = ROADS[b.road];
        const extra = b.raised ? 'эстакада' : d.bridges ? `мостов: ${d.bridges}` : `${r.lanes} ${r.lanes < 5 ? 'полосы' : 'полос'}`;
        return `${r.name} · ${num(d.km)} км · ${extra}`;
    }
    const who = d.pop ? `${fmt(d.pop)} жит.` : `${fmt(d.jobs)} раб. мест`;
    return b.kind === 'custom' ? `${USES[b.use].name} · ${b.floors} эт. · ${who}` : `${Math.round(d.height)} м · ${who}`;
}

const BUILD_COLORS = { model: '#f2b15a', road: '#c3cad4' };

function renderBuildsPanel() {
    buildsCount.textContent = `· ${builds.length}`;
    buildsList.innerHTML = '';
    for (const b of builds) {
        const d = describeBuild(b);
        const ready = isOpen(b, game.day);
        const row = document.createElement('div');
        row.className = `line-row${b.id === selectedBuild ? ' is-selected' : ''}`;
        const color = b.kind === 'custom' ? USES[b.use].color : BUILD_COLORS[b.kind];
        row.innerHTML = `
            <span class="line-bar" style="background:${color}${ready ? '' : ';opacity:.45'}"></span>
            <div class="line-main"><b>${b.name}</b><small>${buildSummary(b, d)}</small></div>
            <span class="line-cost">${ready ? 'готово' : `стройка ${Math.round(progress(b, game.day) * 100)}%`}</span>`;
        row.addEventListener('click', () => selectBuild(b.id));

        if (b.id === selectedBuild) {
            const more = document.createElement('div');
            more.className = 'line-more';
            more.innerHTML = !ready ? `<span>Готово в ${fmtMonthYear(dateOf(b.ready))}</span>`
                : b.cost ? `<span>Стоила ${b.cost} млрд ₸</span>` : '';
            const showBtn = document.createElement('button');
            showBtn.type = 'button';
            showBtn.className = 'btn-line';
            showBtn.textContent = 'Показать';
            showBtn.addEventListener('click', e => { e.stopPropagation(); showBuild(b); });
            const del = document.createElement('button');
            del.type = 'button';
            del.className = `btn-line is-danger${sureRemove === b.id ? ' is-sure' : ''}`;
            del.textContent = sureRemove === b.id ? (!ready && b.cost ? 'Точно снести? Вернём ½' : 'Точно снести?') : 'Снести';
            del.addEventListener('click', e => {
                e.stopPropagation();
                if (sureRemove === b.id) removeBuild(b.id);
                else { sureRemove = b.id; renderBuildsPanel(); }
            });
            more.append(showBtn, del);
            row.appendChild(more);
        }
        buildsList.appendChild(row);
    }
    if (!builds.length) {
        const hint = document.createElement('div');
        hint.className = 'lines-empty';
        hint.textContent = 'Выбери внизу, что построить. Здания строят инвесторы — бесплатно, но новые жители и офисы добавляют поездок. Дороги и мосты оплачивает город из бюджета.';
        buildsList.appendChild(hint);
    }
}

// ===== Время, деньги, цель =====
const speedBtns = [...document.querySelectorAll('[data-speed]')];
const clockEls = {
    year: document.getElementById('clockYear'),
    date: document.getElementById('clockDate'),
    season: document.getElementById('clockSeason'),
    seasonIcon: document.getElementById('seasonIcon'),
    quarters: document.getElementById('quarters')
};
const SEASON_ICONS = {
    'зима': '<svg viewBox="0 0 24 24"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5"/></svg>',
    'весна': '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.5"/><path d="M12 9.5C10 6 12 3 12 3s2 3 0 6.5M14.5 12c3.5-2 6.5 0 6.5 0s-3 2-6.5 0M12 14.5c2 3.5 0 6.5 0 6.5s-2-3 0-6.5M9.5 12C6 14 3 12 3 12s3-2 6.5 0"/></svg>',
    'лето': '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>',
    'осень': '<svg viewBox="0 0 24 24"><path d="M5 19c0-8 6-14 15-14 0 9-6 15-14 15M5 19l7-7"/></svg>'
};
const QUARTERS = RULES.years * 4;
clockEls.quarters.innerHTML = '<i></i>'.repeat(QUARTERS);
const quarterDots = [...clockEls.quarters.children];

function setSpeed(s) {
    if (game.speed > 0) game.lastSpeed = game.speed;
    game.speed = s;
    speedBtns.forEach(b => b.classList.toggle('is-active', Number(b.dataset.speed) === s));
    saveGame(game);
}
speedBtns.forEach(b => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));
setSpeed(game.speed);

let shownDay = -1;
function updateClock(force = false) {
    const day = Math.floor(game.day);
    if (day === shownDay && !force) return;
    shownDay = day;
    const d = dateOf(day);
    clockEls.year.textContent = d.getFullYear();
    clockEls.date.textContent = fmtDate(d);
    const season = seasonOf(d);
    if (clockEls.season.textContent !== season || force) {
        clockEls.season.textContent = season;
        clockEls.seasonIcon.innerHTML = SEASON_ICONS[season];
    }
    const q = Math.floor(day / (365 / 4));
    quarterDots.forEach((el, i) => {
        el.className = i < q ? 'is-past' : i === q ? 'is-now' : '';
    });
}

const moneyEl = document.getElementById('money');
const moneyDelta = document.getElementById('moneyDelta');
function updateMoney() {
    if (isCreative()) {
        moneyEl.textContent = '₸ ∞';
        moneyDelta.textContent = 'креатив';
        return;
    }
    moneyEl.textContent = `₸ ${fmt(game.budget)} млрд`;
    const v = game.income || 0;
    moneyDelta.textContent = `${v >= 0 ? '+' : '−'}${num(Math.abs(v))} млрд/мес`;
}

const goalEls = {
    card: document.getElementById('goal'),
    top: document.getElementById('goalTop'),
    now: document.getElementById('goalNow'),
    what: document.getElementById('goalWhat'),
    target: document.getElementById('goalTarget'),
    fill: document.getElementById('goalFill'),
    sub: document.getElementById('goalSub')
};
function updateGoal() {
    if (!traffic) return;
    goalEls.sub.textContent = `На транспорте ${pct(traffic.transitShare)} поездок · ${fmt(traffic.totalRiders / 1000)} тыс. пасс./день`;
    // История: цель текущей главы
    const st = storyGoal();
    if (st) {
        const s = game.story;
        goalEls.now.textContent = st.nowText;
        goalEls.what.textContent = st.what;
        goalEls.target.textContent = st.targetText;
        goalEls.fill.style.width = `${Math.max(0, Math.min(1, st.progress)) * 100}%`;
        goalEls.card.classList.toggle('is-done', st.done || s.done);
        goalEls.top.textContent = s.done ? 'История пройдена · строй дальше'
            : `Глава ${s.chapter + 1} · ${CHAPTERS[s.chapter].title} · ${s.deadline == null ? 'без срока' : `до ${fmtMonthYear(dateOf(s.deadline))}`}`;
        return;
    }
    const start = game.startAverage ?? traffic.average;
    const done = (start - traffic.average) / Math.max(0.001, start - RULES.target);
    goalEls.now.textContent = pct(traffic.average);
    goalEls.what.textContent = 'загрузка дорог';
    goalEls.target.textContent = pct(RULES.target);
    goalEls.fill.style.width = `${Math.max(0, Math.min(1, done)) * 100}%`;
    goalEls.card.classList.toggle('is-done', game.won);
    const end = dateOf(endDay());
    goalEls.top.textContent = isCreative() ? 'Креатив · без денег и срока'
        : isStory() ? 'История' : game.ended === 'free' ? 'Цель · без срока' : `Цель · до ${fmtDate(end)} ${end.getFullYear()}`;
}

// ===== Креатив: «строить сразу» или месяцами =====
const instantSeg = document.getElementById('instantSeg');

function syncCreative() {
    document.body.classList.toggle('is-creative', isCreative());
    document.body.classList.toggle('is-story', isStory());
    instantSeg.hidden = !isCreative();
    instantSeg.querySelectorAll('button').forEach(b => b.classList.toggle('is-active', (b.dataset.instant === '1') === !!game.instant));
    updateMoney();
}

// Включили «Строить сразу» — всё, что строилось, сразу готово
function setInstant(on) {
    game.instant = on;
    saveGame(game);
    syncCreative();
    if (!on) return;
    const day = Math.floor(game.day);
    let changed = 0;
    for (const x of [...lines, ...builds]) {
        if (x.ext) { x.ext.ready = Math.min(x.ext.ready, day); changed++; }
        if (x.locked || isOpen(x, game.day)) continue;
        x.ready = Math.max(x.start || 0, Math.min(x.ready, day));
        changed++;
    }
    if (!changed) return;
    checkExtensions();
    saveLines(lines);
    saveBuilds(builds);
    applyCity();
    recompute();
    toast(`Стройка закончена сразу: ${changed} шт.`);
}

instantSeg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => setInstant(b.dataset.instant === '1')));
syncCreative();

// Месячный итог: билеты минус обслуживание открытых линий
function monthlyIncome() {
    const fares = (traffic ? traffic.totalRiders : 0) * 30 * RULES.fare / 1e9;
    let upkeep = 0;
    for (const l of openLines()) upkeep += l._d.km * RULES.upkeep[l.type];
    return fares - upkeep;
}

function initClock() {
    game.income = monthlyIncome();
    createClock(game, {
        getLines: () => lines,
        getBuilds: () => builds,
        onDay: () => { updateClock(); growBuilds(); checkExtensions(); checkStoryDeadline(); },
        onBuildReady(b) {
            const d = describeBuild(b);
            const what = b.kind === 'road' ? 'машинам стало просторнее'
                : d.pop ? `новые жители: ${fmt(d.pop)}` : `новые рабочие места: ${fmt(d.jobs)}`;
            toast(`<b>${b.name}</b>: стройка закончена · ${what}`);
            applyCity();
            recompute();
            saveGame(game);
            checkGoal();
        },
        onLineReady(line) {
            toast(`<b>${line.name}</b> открыта! Поезда вышли на линию`);
            recompute();
            const riders = traffic.riders.get(line.id) || 0;
            if (riders > 0) toast(`${line.name}: ${fmt(riders / 1000)} тыс. пассажиров в день`);
            saveGame(game);
            checkGoal();
        },
        onMonth() {
            // В креативе денег нет — только обновляем стройку
            if (!isCreative()) {
                game.income = monthlyIncome();
                game.budget += game.income;
                updateMoney();
            }
            renderLinesPanel();
            renderBuildsPanel();
            saveGame(game);
            if (!isCreative() && game.budget < -50 && !game.ended) endGame('bankrupt');
            checkGoal();
        },
        onYear(d) {
            if (isCreative()) return;
            // В истории каждая глава даёт свои ежегодные деньги
            const money = isStory() ? (game.story ? game.story.yearly || 0 : 0) : RULES.yearly;
            if (!money) return;
            game.budget += money;
            toast(`${d.getFullYear()} год: город выделил <b>${money} млрд ₸</b> на транспорт`);
            updateMoney();
        },
        onDeadline() {
            // Срок в 5 лет — только у свободной игры; в истории сроки у глав
            if (getSlot() === 'free' && !game.won && !game.ended) endGame('late');
        }
    });
}

// Цель достигнута: в обычной игре — окно победы, в креативе — просто сообщение,
// в истории — проверка цели главы
function checkGoal() {
    if (isStory()) return checkStory();
    if (game.won || game.ended || traffic.average > RULES.target) return;
    if (!isCreative()) return endGame('win');
    game.won = true;
    saveGame(game);
    updateGoal();
    toast(`Загрузка дорог ${pct(traffic.average)} — в обычной игре это была бы победа!`);
}

// ===== Сообщения =====
const toastsEl = document.getElementById('toasts');
function toast(html) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = html;
    toastsEl.appendChild(el);
    setTimeout(() => el.classList.add('is-out'), 4200);
    setTimeout(() => el.remove(), 4800);
}

// ===== Конец игры =====
const endModal = document.getElementById('endModal');
const endEls = {
    title: document.getElementById('endTitle'),
    text: document.getElementById('endText'),
    stats: document.getElementById('endStats'),
    cont: document.getElementById('endContinue')
};

function endGame(kind) {
    const d = dateOf(game.day);
    if (kind === 'win') {
        game.won = true;
        endEls.title.textContent = 'Цель выполнена!';
        endEls.text.textContent = `К ${fmtMonthYear(d)} загрузка дорог снизилась до ${pct(traffic.average)}. Алматинцы стали меньше стоять в пробках. Можно строить дальше — уже без срока.`;
        endEls.cont.textContent = 'Строить дальше';
    } else if (kind === 'late') {
        endEls.title.textContent = 'Время вышло';
        endEls.text.textContent = `Срок закончился, а загрузка дорог — ${pct(traffic.average)}. Цель была ${pct(RULES.target)}. Можно продолжить без срока или начать заново.`;
        endEls.cont.textContent = 'Продолжить без срока';
    } else {
        endEls.title.textContent = 'Бюджет исчерпан';
        endEls.text.textContent = 'Обслуживание линий стоит дороже, чем приносят билеты, и деньги кончились. Начни заново и строй линии там, где много пассажиров.';
        endEls.cont.textContent = 'Продолжить в долг';
    }
    game.ended = kind === 'win' ? null : kind;
    // В истории «Начать заново» переигрывает только текущую главу
    document.getElementById('endRestart').textContent = isStory() && game.story ? 'Переиграть главу' : 'Начать заново';
    endEls.stats.innerHTML = `
        <div><small>Загрузка дорог</small><b>${pct(traffic.average)}</b></div>
        <div><small>Линий</small><b>${lines.length}</b></div>
        <div><small>Пассажиров в день</small><b>${fmt(traffic.totalRiders / 1000)} тыс.</b></div>`;
    game.paused = true;
    endModal.hidden = false;
    saveGame(game);
}

endEls.cont.addEventListener('click', () => {
    // После победы или конца срока игра идёт дальше без срока
    game.ended = 'free';
    game.paused = false;
    endModal.hidden = true;
    saveGame(game);
    updateGoal();
});
document.getElementById('endRestart').addEventListener('click', () => {
    endModal.hidden = true;
    if (isStory() && game.story) return retryChapter();
    restartGame();
    game.paused = false;
});
document.getElementById('endMenu').addEventListener('click', () => { endModal.hidden = true; openMenu(); });

// ===== История: главы и обучение =====
let storyBusy = false;   // открыто окно главы — повторно не проверяем

// Подсказчик обучения смотрит, что сделал игрок
const coach = createCoach({
    ctx: {
        camera: () => {
            const c = map.getCenter();
            return { lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
        },
        layer: () => layer,
        mode: () => document.body.dataset.mode,
        setMode: m => { if (document.body.dataset.mode !== m) setMode(m); },
        drawing: () => !!(drawer && drawer.active),
        draftStations: () => Number(document.getElementById('drawSt').textContent) || 0,
        userLines: () => lines.filter(l => !l.locked).length,
        openUserLines: () => lines.filter(l => !l.locked && isOpen(l, game.day)).length
    },
    onStep(i) {
        if (!game.story) return;
        game.story.step = i;
        saveGame(game);
    },
    onFinish(skipped) {
        if (!game.story) return;
        game.story.tutorial = false;
        saveGame(game);
        if (skipped) toast('Обучение пропущено. Пройти его снова: меню → «Начать заново · история»');
        checkStory();
    }
});

const currentChapter = () => (game.story ? chapterParams(Math.min(game.story.chapter, CHAPTERS.length - 1), game.story.hard) : null);
const yearsText = y => (y === 1 ? '1 год' : `${String(y).replace('.', ',')} года`);

function goalText(goal) {
    if (goal.kind === 'lines') return goal.value === 1 ? 'открыть одну новую линию' : `открыть ${goal.value} новые линии`;
    if (goal.kind === 'riders') return `${fmt(goal.value / 1000)} тыс. пассажиров в день`;
    if (goal.kind === 'transfers') return `${goal.value} станции-пересадки`;
    return `загрузка дорог не выше ${pct(goal.value)}`;
}

// Станции, где сходятся две и больше открытых линий
function countTransfers() {
    const at = new Map();
    for (const l of lines) {
        if (!isOpen(l, game.day)) continue;
        for (const st of (l._d || describe(l)).stations) {
            const key = st.c[0].toFixed(5) + ',' + st.c[1].toFixed(5);
            if (!at.has(key)) at.set(key, new Set());
            at.get(key).add(l.id);
        }
    }
    let n = 0;
    for (const ids of at.values()) if (ids.size > 1) n++;
    return n;
}

// Где мы по цели главы: { nowText, what, targetText, progress, done } (или null вне истории)
function storyGoal() {
    if (!isStory() || !game.story || !traffic) return null;
    const goal = currentChapter().goal;
    if (goal.kind === 'jam') {
        const start = game.story.startAvg ?? traffic.average;
        return {
            nowText: pct(traffic.average), what: 'загрузка дорог', targetText: pct(goal.value),
            progress: (start - traffic.average) / Math.max(0.001, start - goal.value), done: traffic.average <= goal.value
        };
    }
    const now = goal.kind === 'lines' ? lines.filter(l => !l.locked && isOpen(l, game.day)).length
        : goal.kind === 'riders' ? traffic.totalRiders : countTransfers();
    const big = goal.kind === 'riders';
    return {
        nowText: big ? `${fmt(now / 1000)} тыс.` : String(now),
        what: big ? 'пассажиров в день' : goal.kind === 'lines' ? 'новых линий' : 'пересадок',
        targetText: big ? `${fmt(goal.value / 1000)} тыс.` : String(goal.value),
        progress: now / goal.value, done: now >= goal.value
    };
}

// После выхода из меню: новая история — выбор сложности, начатая — продолжаем
function resumeStory() {
    if (!isStory() || menu.open || !dlg.modal.hidden) return;
    if (!game.story) return askStoryStart();
    if (game.story.tutorial && !coach.active) coach.start(game.story.step || 0);
    else checkStory();
}

function askStoryStart() {
    let hard = false;
    const box = document.createElement('div');
    box.innerHTML = `<div class="seg" role="radiogroup" aria-label="Сложность">
        <button type="button" data-hard="0">Обычная</button><button type="button" data-hard="1">С усложнением</button></div>
        <p class="dialog-note"></p>`;
    const note = box.querySelector('.dialog-note');
    const sync = () => {
        box.querySelectorAll('[data-hard]').forEach(b => b.classList.toggle('is-active', (b.dataset.hard === '1') === hard));
        note.textContent = hard
            ? 'С каждой главой срок короче и денег меньше на 10 %, а жителей в городе больше. Для тех, кто уже освоился.'
            : 'Спокойные сроки и деньги в каждой главе. Хорошо для первого раза.';
    };
    box.querySelectorAll('[data-hard]').forEach(b => b.addEventListener('click', () => { hard = b.dataset.hard === '1'; sync(); }));
    sync();
    dialog({
        kicker: 'Режим истории',
        title: 'Алматы ждёт метро',
        text: `${CHAPTERS.length} глав: от первой линии до города без пробок. Первая глава — обучение: я покажу, что где.`,
        extra: box,
        buttons: [
            { text: 'В меню', esc: true, onClick: openMenu },
            { text: 'Начать', primary: true, onClick: () => {
                game.story = { chapter: 0, hard, tutorial: true, step: 0, done: false };
                startChapter(0);
            } }
        ]
    });
}

// Новая глава: деньги, срок, рост города; запоминаем «точку сохранения», чтобы можно было переиграть
function startChapter(k) {
    const s = game.story;
    s.chapter = k;
    const c = chapterParams(k, s.hard);
    if (c.growth) {
        game.growth = (game.growth || 1) * (1 + c.growth);
        applyCity();
        recompute();
    }
    game.budget += c.grant;
    s.start = Math.floor(game.day);
    s.deadline = s.start + Math.round(c.years * 365);
    s.yearly = c.yearly;
    s.startAvg = traffic.average;
    const { paused, story, ...g } = game;
    s.checkpoint = { game: JSON.parse(JSON.stringify(g)), lines: serializeLines(lines), builds: serializeBuilds(builds) };
    saveGame(game);
    updateMoney();
    updateGoal();
    syncMenu();
    showChapter();
}

// Окно с заданием главы
function showChapter() {
    const s = game.story, c = currentChapter();
    const extra = document.createElement('div');
    extra.className = 'dialog-goal';
    extra.innerHTML = `Цель: <b>${goalText(c.goal)}</b><br>Срок: <b>${yearsText(c.years)}</b>, до ${fmtMonthYear(dateOf(s.deadline))}<br>`
        + `Деньги: <b>+${c.grant} млрд ₸</b> сейчас и по ${c.yearly} млрд каждый январь`
        + (c.growth ? `<br>Город вырос: <b>+${String(Math.round(c.growth * 1000) / 10).replace('.', ',')} %</b> жителей` : '');
    dialog({
        kicker: `Глава ${s.chapter + 1} из ${CHAPTERS.length}${s.hard ? ' · с усложнением' : ''}`,
        title: c.title,
        text: c.text,
        extra,
        buttons: [{ text: s.tutorial ? 'Начать обучение' : 'Вперёд', primary: true, esc: true, onClick: () => {
            if (s.tutorial) coach.start(s.step || 0);
            else checkStory();
        } }]
    });
}

// Цель главы выполнена?
function checkStory() {
    const s = game.story;
    if (!isStory() || !s || s.done || s.tutorial || storyBusy || !dlg.modal.hidden) return;
    const st = storyGoal();
    if (st && st.done) chapterDone();
}

function chapterDone() {
    const s = game.story, k = s.chapter;
    const last = k >= CHAPTERS.length - 1;
    storyBusy = true;
    if (last) {
        s.done = true;
        s.deadline = null;
        saveGame(game);
    }
    dialog({
        kicker: `Глава ${k + 1} из ${CHAPTERS.length}`,
        title: last ? 'История пройдена!' : 'Глава пройдена!',
        text: last
            ? 'Алматы задышал: люди пересели на метро, ЛРТ и SkyTrain, пробок стало намного меньше. Можно строить дальше — уже без целей и сроков.'
            : `Отлично! Дальше — глава «${CHAPTERS[k + 1].title}».`,
        stats: [['Загрузка дорог', pct(traffic.average)], ['Пассажиров в день', `${fmt(traffic.totalRiders / 1000)} тыс.`], ['Линий', lines.length]],
        buttons: last
            ? [{ text: 'В меню', onClick: () => { storyBusy = false; openMenu(); } },
               { text: 'Строить дальше', primary: true, esc: true, onClick: () => { storyBusy = false; updateGoal(); syncMenu(); } }]
            : [{ text: 'Следующая глава', primary: true, esc: true, onClick: () => { storyBusy = false; startChapter(k + 1); } }]
    });
}

// Срок главы вышел, а цель не выполнена
function checkStoryDeadline() {
    const s = game.story;
    if (!isStory() || !s || s.done || s.tutorial || storyBusy || s.deadline == null || game.day < s.deadline || !dlg.modal.hidden) return;
    const st = storyGoal();
    if (st.done) return chapterDone();
    storyBusy = true;
    dialog({
        kicker: `Глава ${s.chapter + 1} из ${CHAPTERS.length}`,
        title: 'Время главы вышло',
        text: 'Цель не выполнена. Можно переиграть главу с начала или продолжить без срока.',
        stats: [['Цель', st.what], ['Сейчас', st.nowText], ['Нужно', st.targetText]],
        buttons: [
            { text: 'Продолжить без срока', onClick: () => { storyBusy = false; s.deadline = null; saveGame(game); updateGoal(); } },
            { text: 'Переиграть главу', primary: true, esc: true, onClick: () => { storyBusy = false; retryChapter(); } }
        ]
    });
}

// Вернуть всё как было в начале главы
function retryChapter() {
    const s = game.story, cp = s && s.checkpoint;
    if (!cp) return;
    saveGame({ ...cp.game, story: { ...s, tutorial: false } });
    write('lines', cp.lines);
    write('builds', cp.builds);
    loadSlot();
    toast(`Глава ${s.chapter + 1} начата заново`);
    showChapter();
}

// Сохраняем, когда закрывают вкладку
window.addEventListener('beforeunload', () => saveGame(game));
