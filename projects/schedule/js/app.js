// ===== IRL расписание: точка входа =====
// Вкладки, загрузка расписания и «сердце» сайта: раз в секунду (ровно на смене секунды)
// обновляются часы, блоки «Сейчас» и «Дальше»; подсветка расписания — раз в минуту.
// Во внеурочное время включается домашний режим: ночная тема, звёзды и музыка.
// На блоке «Сейчас» всегда живёт пёсик (js/dog.js).
// Ещё здесь подключаются уведомления и работа с экрана «Домой» (service worker).

import { now, onTimeChange, minuteOfDay } from './clock.js?v=1';
import { loadSchedule } from './data.js?v=1';
import { renderSchedule, highlightSchedule, scrollToToday } from './schedule.js?v=7';
import { fillIcons, icon } from './pixel.js?v=6';
import { renderIrl, showIrlError } from './irl.js?v=7';
import { initTester, renderTesterDock } from './tester.js?v=4';
import { initFx, setFxVisible, setFxNight } from './fx.js?v=4';
import { initNight, setNight } from './night.js?v=3';
import { initDog, setDogVisible } from './dog.js?v=5';
import { initPress } from './press.js?v=1';
import { toggleSound, skipTrack, setHome, isSoundOn, isPlaying, onAudioChange } from './audio.js?v=3';
import { initNotifyUI, checkNotifications } from './notify.js?v=1';
import { initPwa } from './pwa.js?v=1';
import * as settings from './settings.js?v=2';

const TABS = ['irl', 'schedule', 'settings'];

const tabsNav = document.getElementById('tabs');
const tabButtons = [...tabsNav.querySelectorAll('.tab')];
const scheduleRoot = document.getElementById('scheduleRoot');
const classBadge = document.getElementById('classBadge');
const nowCard = document.getElementById('nowCard');

let data = null;            // расписание из schedule.json
let scheduleSeen = false;   // к сегодняшнему дню прокручиваем только при первом открытии
let current = '';
let home = false;           // сейчас внеурочное время (нет уроков)

fillIcons();
initPress();                // волна от каждой нажатой кнопки
initPwa();                  // service worker и инструкция «На экран Домой»
initNotifyUI(() => data);   // переключатели уведомлений в настройках

// Высота липкой шапки — в CSS-переменную, чтобы прокрутка к дню не прятала его под вкладками
const topBar = document.querySelector('.top');
function measureTop() {
    document.documentElement.style.setProperty('--top-h', `${topBar.offsetHeight}px`);
}
measureTop();
new ResizeObserver(measureTop).observe(topBar);

// Пиксельные часы и эффекты блока «Сейчас» (рисуются, только пока открыта вкладка IRL)
initFx({
    card: nowCard,
    dialCanvas: document.getElementById('nowDial'),
    getData: () => data
});
// Пёсик на блоке «Сейчас» (и блоки, которые он умеет сбивать вниз)
initDog({ card: nowCard, stack: document.getElementById('dropStack') });

const updateFx = () => {
    const on = current === 'irl' && !document.hidden;
    setFxVisible(on);
    setDogVisible(on);
};

// Домашний режим: небо со звёздами
initNight();

// Ночная тема — только на вкладке IRL (расписание и настройки остаются светлыми)
function applyHome() {
    const night = home && current === 'irl';
    setNight(night);
    setFxNight(night);
    soundBtn.hidden = !night;
    skipBtn.hidden = !night || !isSoundOn();
}

// ----- Кнопки музыки и громкость -----

const soundBtn = document.getElementById('soundBtn');
const skipBtn = document.getElementById('skipBtn');
const volumeInput = document.getElementById('volumeInput');
const volumeValue = document.getElementById('volumeValue');

skipBtn.innerHTML = icon('skip');

function renderSound() {
    const on = isSoundOn();
    soundBtn.innerHTML = icon(on ? 'sound' : 'mute');
    soundBtn.setAttribute('aria-pressed', String(on));
    soundBtn.title = on ? 'Выключить музыку' : 'Включить музыку';
    soundBtn.classList.toggle('playing', isPlaying());
    // «следующий трек» — рядом с динамиком, только пока музыка включена
    skipBtn.hidden = soundBtn.hidden || !on;
}
soundBtn.addEventListener('click', toggleSound);
skipBtn.addEventListener('click', skipTrack);
onAudioChange(renderSound);
renderSound();

function renderVolume() {
    const v = Math.round(settings.get('volume') * 100);
    volumeInput.value = v;
    volumeValue.textContent = `${v}%`;
    volumeInput.style.setProperty('--fill', `${v}%`);
}
volumeInput.addEventListener('input', () => settings.set('volume', Number(volumeInput.value) / 100));
renderVolume();

// ----- Вкладки: одна лента -----
// Все три вкладки стоят в ряд, как одна длинная лента, и едут вместе с чёрной плашкой
// в шапке. pos — дробный номер вкладки (0 — IRL, 1 — Расписание, 2 — Настройки):
// pos = 0.4 — лента и плашка сдвинуты на 40% от IRL к Расписанию.
// Переключение всегда плавное: нажатие на вкладку, свайп пальцем по странице
// или «вождение» по шапке пальцем/мышкой.
//
// Открытая вкладка стоит в обычном потоке страницы. Соседние, пока лента едет,
// выглядывают сбоку и сдвинуты по вертикали так, будто прокручены туда, где их оставили.
// Невидимые вкладки не выключаются (display: none), а сжаты в ноль — их не нужно
// заново строить при показе, поэтому переключение без фризов.

const panels = TABS.map(t => document.getElementById(`tab-${t}`));
const mainEl = document.querySelector('main');
const scrollMemory = {};        // где была прокрутка на каждой вкладке
const SCRUB_DELAY = 220;        // мс: столько плашка стоит на вкладке при «вождении», чтобы та открылась
let pos = 0, goal = 0;          // где лента сейчас и куда едет
let glideRaf = 0, glideT = 0;
let held = -1, heldAt = 0;      // на какой вкладке плашка стоит и с какого момента
let swipe = null, scrub = null, scrubbed = false;

const lastTab = TABS.length - 1;
const clampPos = (p) => Math.min(lastTab, Math.max(0, p));
const activeIndex = () => TABS.indexOf(current);

// Плашка: на 0.3 она на 70% на первой вкладке и на 30% на второй
function paintPlate(p) {
    p = clampPos(p);
    const a = Math.floor(p), f = p - a;
    tabButtons.forEach((btn, i) => {
        let cover = 0, side = 'left';
        if (i === a) { cover = 1 - f; side = 'right'; }
        else if (i === a + 1) { cover = f; side = 'left'; }
        btn.style.backgroundSize = `${cover * 100}% 100%`;
        btn.style.backgroundPosition = `${side} center`;
        btn.classList.toggle('lit', cover >= 0.5);
    });
}

// Расписание в первый раз открывается на сегодняшнем дне
function todayScroll() {
    const card = scheduleRoot.querySelector('.day-card.is-today, .day-card.is-next');
    if (!card || card === scheduleRoot.querySelector('.day-card')) return 0;
    const inPanel = card.getBoundingClientRect().top - panels[1].getBoundingClientRect().top;
    const top = mainEl.getBoundingClientRect().top + window.scrollY;
    return top + inPanel - (parseFloat(getComputedStyle(card).scrollMarginTop) || 0);
}

// Куда прокручена вкладка i (если открыть её сейчас)
function scrollOf(i) {
    const name = TABS[i];
    let y = scrollMemory[name];
    if (y == null && name === 'schedule' && data && !scheduleSeen) y = scrollMemory.schedule = todayScroll();
    y = y || 0;
    // не дальше конца вкладки (у сжатой вкладки нет отступов — добавим их)
    const el = panels[i], cs = getComputedStyle(panels[activeIndex()] || el);
    const pad = el.classList.contains('active') || el.classList.contains('peek') ? 0 : parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const top = mainEl.getBoundingClientRect().top + window.scrollY;
    return Math.max(0, Math.min(y, top + el.scrollHeight + pad - window.innerHeight));
}

// Расставить вкладки по ленте и нарисовать плашку
function renderTrack() {
    paintPlate(pos);
    const W = mainEl.clientWidth, a = activeIndex(), y = window.scrollY;
    panels.forEach((el, i) => {
        const d = i - pos;
        const peek = i !== a && Math.abs(d) < 0.999;
        el.classList.toggle('peek', peek);
        const dx = Math.round(d * W);
        if (i === a ? dx === 0 : !peek) { el.style.transform = ''; return; }
        const dy = i === a ? 0 : Math.round(y - scrollOf(i));
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    });
}

// Сделать вкладку i открытой (лента в этот момент может ещё ехать — шва не видно)
function commit(i) {
    const name = TABS[i];
    if (name === current) return;
    const y = scrollOf(i);
    if (current) scrollMemory[current] = window.scrollY;     // запомнить, где были
    if (name === 'schedule' && data) scheduleSeen = true;
    current = name;

    tabButtons.forEach((btn, k) => {
        btn.setAttribute('aria-selected', k === i);
        btn.tabIndex = k === i ? 0 : -1;
    });
    panels.forEach((el, k) => {
        el.classList.toggle('active', k === i);
        el.inert = k !== i;
    });
    updateFx();
    applyHome();

    // Адрес запоминает вкладку (#schedule), IRL — без решётки
    history.replaceState(null, '', name === 'irl' ? location.pathname + location.search : `#${name}`);

    renderTrack();              // старая вкладка теперь выглядывает сбоку…
    window.scrollTo(0, y);      // …а страница прокручена туда, где новая была
    renderTrack();
}

// Плавный ход ленты: догоняет цель, быстро в начале и мягко в конце
function glide(t) {
    const dt = glideT ? Math.min(0.05, (t - glideT) / 1000) : 0;
    glideT = t;
    pos += (goal - pos) * (1 - Math.exp(-dt * (scrub ? 10 : 11)));
    if (!scrub && Math.abs(goal - pos) < 0.002) pos = goal;

    // «водишь» по шапке и плашка постояла на вкладке — та открывается, не дожидаясь отпускания
    const n = Math.round(clampPos(pos));
    if (n !== held) { held = n; heldAt = t; }
    else if (scrub && n !== activeIndex() && t - heldAt > SCRUB_DELAY) commit(n);

    renderTrack();
    if (!scrub && pos === goal) {
        glideRaf = 0;
        commit(goal);
        return;
    }
    glideRaf = requestAnimationFrame(glide);
}

function startGlide() {
    if (glideRaf) return;
    glideT = 0;
    glideRaf = requestAnimationFrame(glide);
}

function stopGlide() {
    cancelAnimationFrame(glideRaf);
    glideRaf = 0;
}

function goTo(i) {
    goal = clampPos(i);
    startGlide();
}

tabButtons.forEach((btn, i) => {
    btn.addEventListener('click', () => {
        if (scrubbed) return;                   // это был не клик, а «вождение» по шапке
        if (i !== activeIndex() || glideRaf) goTo(i);
        // нажали на уже открытую вкладку — плавно наверх (удобно в длинном расписании)
        else window.scrollTo({ top: 0, behavior: 'smooth' });
    });
});

// Стрелки ←/→ переключают вкладки (для клавиатуры)
tabsNav.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const step = e.key === 'ArrowRight' ? 1 : -1;
    const index = (Math.round(goal) + step + TABS.length) % TABS.length;
    goTo(index);
    tabButtons[index].focus();
    e.preventDefault();
});

window.addEventListener('resize', renderTrack);

// ----- Свайп по странице (только пальцем) -----
// Лента едет за пальцем. Отпустил дальше четверти экрана (или резко смахнул) — доезжает
// до соседней вкладки, иначе возвращается. Мышь сюда не попадает: только touch-события.
// Не мешаем: пёсику (его тянут), полосе сценариев, ползунку громкости и самой шапке.

const NO_SWIPE = '.dog-hit, input, textarea, .tester-dock, .top';

document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest(NO_SWIPE)) { swipe = null; return; }
    const t = e.touches[0];
    swipe = { x: t.clientX, y: t.clientY, t: performance.now(), on: false, p0: pos };
}, { passive: true });

document.addEventListener('touchmove', (e) => {
    if (!swipe) return;
    if (e.touches.length !== 1) { if (swipe.on) goTo(Math.round(swipe.p0)); swipe = null; return; }
    const t = e.touches[0];
    const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
    if (!swipe.on) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        // палец пошёл вверх-вниз — это прокрутка, не свайп
        if (Math.abs(dx) < Math.abs(dy) * 1.2) { swipe = null; return; }
        swipe.on = true;
        swipe.x = t.clientX;                         // без рывка на первые 10 пикселей
        stopGlide();
        swipe.p0 = pos;                              // подхватили ленту там, где она ехала
        return;
    }
    e.preventDefault();                              // страница не прокручивается вбок
    let p = swipe.p0 - dx / mainEl.clientWidth;
    if (p < 0) p *= 0.3;                             // дальше вкладок нет — тянется туго
    if (p > lastTab) p = lastTab + (p - lastTab) * 0.3;
    pos = p;
    renderTrack();
}, { passive: false });

const touchEnd = () => {
    if (!swipe) return;
    const s = swipe;
    swipe = null;
    if (!s.on) return;
    const base = Math.round(clampPos(s.p0));
    const moved = pos - base;
    const fast = Math.abs(moved) > 0.08 && Math.abs(moved) * mainEl.clientWidth / (performance.now() - s.t) > 0.5;
    goTo(Math.abs(moved) > 0.25 || fast ? base + Math.sign(moved) : base);
};
document.addEventListener('touchend', touchEnd);
document.addEventListener('touchcancel', touchEnd);

// ----- Водить по шапке (пальцем или мышкой) -----
// Как с пёсиком: зажал и водишь — плашка, а с ней и лента страниц плавно догоняют
// палец или курсор. Постояла на вкладке SCRUB_DELAY — вкладка открывается, не дожидаясь
// отпускания. Отпустил — лента доезжает до ближайшей вкладки. Обычное нажатие — как раньше.

function scrubPos(clientX) {
    const r = tabsNav.getBoundingClientRect();
    return clampPos((clientX - r.left) / (r.width / TABS.length) - 0.5);
}

tabsNav.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || swipe) return;
    scrub = { id: e.pointerId, x: e.clientX, on: false };
});

tabsNav.addEventListener('pointermove', (e) => {
    if (!scrub || e.pointerId !== scrub.id) return;
    if (!scrub.on) {
        if (Math.abs(e.clientX - scrub.x) < 8) return;
        scrub.on = true;
        try { tabsNav.setPointerCapture(e.pointerId); } catch (err) { /* и без захвата работает */ }
    }
    goal = scrubPos(e.clientX);
    startGlide();
});

const scrubEnd = (e) => {
    if (!scrub || e.pointerId !== scrub.id) return;
    const s = scrub;
    scrub = null;
    if (!s.on) return;
    // после «вождения» браузер ещё пришлёт click — его пропускаем
    scrubbed = true;
    setTimeout(() => { scrubbed = false; }, 0);
    goTo(Math.round(clampPos(pos)));                  // доехать до ближайшей вкладки
};
tabsNav.addEventListener('pointerup', scrubEnd);
tabsNav.addEventListener('pointercancel', scrubEnd);

// Открыть вкладку из адреса (#schedule, #settings) сразу, без анимации
{
    const start = Math.max(0, TABS.indexOf(location.hash.slice(1)));
    pos = goal = start;
    commit(start);
}

// ----- Режим тестировки -----

initTester(() => data);

settings.onChange((name) => {
    // включили или выключили — перерисовываем расписание с другими названиями предметов
    if (name === 'tester' && data) {
        renderSchedule(scheduleRoot, data);
        lastMinute = '';
        frame();
    }
    if (name === 'volume') renderVolume();
    if (name === 'sound') renderSound();
});

// ----- Ход времени -----

let timer = 0;
let lastMinute = '';

function frame() {
    clearTimeout(timer);
    const date = now();

    const state = renderIrl(data, date);
    renderTesterDock(date);
    checkNotifications(state, date);     // урок или перемена сменились — уведомление

    // Домашний режим: вне занятий (но не за 2 минуты до первого урока — тогда «Пора на урок!»)
    const isHome = !!state && state.kind === 'off' && state.phase !== 'soon';
    if (isHome !== home) {
        home = isHome;
        setHome(home);
        applyHome();
    }

    // Подсветка расписания — только когда сменилась минута
    if (data) {
        const key = date.toDateString() + '|' + Math.floor(minuteOfDay(date));
        if (key !== lastMinute) {
            lastMinute = key;
            highlightSchedule(scheduleRoot, data, date);
        }
    }

    // Следующий кадр — ровно на смене секунды
    timer = setTimeout(frame, 1000 - now().getMilliseconds() + 5);
}

// Режим тестировки подменил время — сразу показываем новое состояние
onTimeChange(() => { lastMinute = ''; frame(); });
// Телефон разблокировали / вернулись на вкладку — таймеры могли спать
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) frame();
    updateFx();
});

frame();

// ----- Загрузка расписания -----

async function start() {
    try {
        data = await loadSchedule();
    } catch (err) {
        showIrlError(err.message);
        scheduleRoot.innerHTML = '';
        const box = document.createElement('div');
        box.className = 'card error-card';
        const text = document.createElement('p');
        text.textContent = err.message;
        const retry = document.createElement('button');
        retry.className = 'btn';
        retry.type = 'button';
        retry.textContent = 'Попробовать снова';
        retry.addEventListener('click', () => location.reload());
        box.append(text, retry);
        scheduleRoot.append(box);
        return;
    }

    if (data.className) {
        classBadge.textContent = data.className;
        classBadge.hidden = false;
    }
    renderSchedule(scheduleRoot, data);
    lastMinute = '';
    frame();
    if (current === 'schedule' && !scheduleSeen) {
        scheduleSeen = true;
        scrollToToday(scheduleRoot);
    }
}

start();
