// ===== IRL расписание: точка входа =====
// Вкладки, загрузка расписания и «сердце» сайта: раз в секунду (ровно на смене секунды)
// обновляются часы, блоки «Сейчас» и «Дальше»; подсветка расписания — раз в минуту.
// Во внеурочное время включается домашний режим: ночная тема, звёзды, собака и музыка.
// Ещё здесь подключаются уведомления и работа с экрана «Домой» (service worker).

import { now, onTimeChange, minuteOfDay } from './clock.js?v=1';
import { loadSchedule } from './data.js?v=1';
import { renderSchedule, highlightSchedule, scrollToToday } from './schedule.js?v=5';
import { fillIcons, icon } from './pixel.js?v=5';
import { renderIrl, showIrlError } from './irl.js?v=4';
import { initTester, renderTesterDock } from './tester.js?v=2';
import { initFx, setFxVisible, setFxNight } from './fx.js?v=2';
import { initNight, setNight } from './night.js?v=2';
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
const updateFx = () => setFxVisible(current === 'irl' && !document.hidden);

// Домашний режим: небо со звёздами и собака
initNight({ card: nowCard });

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

// ----- Вкладки -----
// Активная вкладка заливается чёрным ступеньками: новая — со стороны старой,
// а старая «утекает» в сторону новой. Так кажется, что чёрная плашка переезжает.

function showTab(name, { focus = false } = {}) {
    if (!TABS.includes(name)) name = 'irl';
    const from = TABS.indexOf(current);
    const to = TABS.indexOf(name);
    const toRight = from < 0 || to >= from;
    current = name;

    tabButtons.forEach((btn, i) => {
        const on = i === to;
        if (on) btn.style.backgroundPosition = toRight ? 'left center' : 'right center';
        else if (i === from) btn.style.backgroundPosition = toRight ? 'right center' : 'left center';
        btn.setAttribute('aria-selected', on);
        btn.tabIndex = on ? 0 : -1;
        if (on && focus) btn.focus();
    });
    TABS.forEach(t => {
        document.getElementById(`tab-${t}`).hidden = t !== name;
    });
    updateFx();
    applyHome();

    // Адрес запоминает вкладку (#schedule), IRL — без решётки
    const url = name === 'irl' ? location.pathname + location.search : `#${name}`;
    history.replaceState(null, '', url);

    if (name === 'schedule' && data && !scheduleSeen) {
        scheduleSeen = true;
        scrollToToday(scheduleRoot);
    } else {
        window.scrollTo(0, 0);
    }
}

tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.dataset.tab !== current) showTab(btn.dataset.tab);
    });
});

// Стрелки ←/→ переключают вкладки (для клавиатуры)
tabsNav.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const step = e.key === 'ArrowRight' ? 1 : -1;
    const index = (TABS.indexOf(current) + step + TABS.length) % TABS.length;
    showTab(TABS[index], { focus: true });
    e.preventDefault();
});

showTab(location.hash.slice(1));

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
