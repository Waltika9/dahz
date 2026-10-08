// ===== Режим тестировки =====
// Переключатель в «Настройках». Когда он включён, предметы называются «Урок-1», «Урок-2»…,
// а внизу экрана появляется панель сценариев: выбор сценария подменяет «текущее время»
// (clock.js), и весь сайт показывает это состояние. Подменённое время дальше идёт само.

import { setFakeTime, resetTime, isFakeTime, formatMinutes, WEEKDAYS_SHORT } from './clock.js?v=1';
import * as settings from './settings.js?v=2';

// Порядок и названия — как в ТЗ (+ «За 5 мин до конца» и «Выходной»).
// «Конец перемены» убран: зелёного сигнала в конце перемены больше нет.
const SCENARIOS = [
    { id: 'break',     name: 'Перемена',          hint: 'зелёный' },
    { id: 'lesson',    name: 'Урок',              hint: 'белый' },
    { id: 'off',       name: 'Вне занятий',       hint: 'вечер' },
    { id: 'soon3',     name: '3 мин до урока',    hint: 'перемена, сигнал через 1 мин' },
    { id: 'soon',      name: 'До начала урока',   hint: '2 мин, красный сигнал' },
    { id: 'lesson5',   name: 'За 5 мин до конца', hint: 'урок, сигнал через 3 с' },
    { id: 'lessonEnd', name: 'Конец урока',       hint: '5 мин, зелёный сигнал' },
    { id: 'weekend',   name: 'Выходной',          hint: 'нет уроков' }
];

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

// Дата day + minutes минут от полуночи (минуты могут быть дробными: 1.5 = 1 мин 30 с)
function at(day, minutes) {
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    d.setSeconds(Math.round(minutes * 60));
    return d;
}

// Ближайший день (начиная с сегодня), где есть уроки / где уроков нет
function findDay(data, withLessons) {
    const today = new Date();
    for (let i = 0; i < 14; i++) {
        const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
        const day = data.byWeekday.get(date.getDay());
        if (!!day?.lessons.length === withLessons) return { date, day };
    }
    return null;
}

// Перемена для сценариев: первая на 10+ минут (иначе самая длинная)
function pickBreak(day) {
    const breaks = day.items.filter(it => it.type === 'break' && !it.gap);
    return breaks.find(b => b.duration >= 10) || [...breaks].sort((a, b) => b.duration - a.duration)[0] || null;
}

// Время для сценария. null — сценарий невозможен с таким расписанием
function scenarioTime(id, data) {
    if (id === 'weekend') {
        const free = findDay(data, false);
        return free ? at(free.date, 12 * 60) : null;
    }
    const school = findDay(data, true);
    if (!school) return null;
    const { date, day } = school;
    const lessons = day.lessons;
    const brk = pickBreak(day);
    // урок прямо перед выбранной переменой — так сценарии идут по порядку
    const lesson = (brk && lessons.find(l => l.end === brk.start)) || lessons[0];
    const lastEnd = lessons[lessons.length - 1].end;

    switch (id) {
        case 'lesson':    return at(date, lesson.start + 5);
        // ровно за 5 минут до конца урока, плюс 3 секунды — видно, как белый блок сменяется сигналом
        case 'lesson5':   return at(date, lesson.end - 5 - 3 / 60);
        case 'lessonEnd': return at(date, lesson.end - 4);
        case 'break':     return brk && at(date, brk.start + 1);
        // за 3 минуты до урока: ещё обычная перемена, через минуту — красный сигнал
        case 'soon3':     return at(date, (brk ? brk.end : lessons[0].start) - 3);
        case 'soon':      return at(date, (brk ? brk.end : lessons[0].start) - 1.5);
        case 'off':       return at(date, Math.min(lastEnd + 90, 23 * 60 + 30));
    }
    return null;
}

export function initTester(getData) {
    const sw = $('testerSwitch');
    const dock = $('testerDock');
    const chips = $('testerChips');
    const resetBtn = $('testerReset');
    let active = '';

    for (const sc of SCENARIOS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'dock-chip';
        b.dataset.id = sc.id;
        b.innerHTML = `<span>${sc.name}</span><small>${sc.hint}</small>`;
        b.addEventListener('click', () => {
            const data = getData();
            const date = data && scenarioTime(sc.id, data);
            if (!date) return;
            active = sc.id;
            mark();
            setFakeTime(date);
        });
        chips.append(b);
    }

    function mark() {
        chips.querySelectorAll('.dock-chip').forEach(b => b.classList.toggle('active', b.dataset.id === active));
    }

    resetBtn.addEventListener('click', () => {
        active = '';
        mark();
        resetTime();
    });

    sw.addEventListener('click', () => settings.set('tester', !settings.get('tester')));

    // Колесо мыши листает сценарии вбок (на компьютере)
    chips.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        chips.scrollLeft += e.deltaY;
        e.preventDefault();
    }, { passive: false });

    // Высота панели — в CSS-переменную, чтобы низ страницы не прятался под ней
    new ResizeObserver(() => {
        document.documentElement.style.setProperty('--dock-h', `${dock.offsetHeight}px`);
    }).observe(dock);

    function sync() {
        const on = !!settings.get('tester');
        sw.setAttribute('aria-checked', String(on));
        dock.hidden = !on;
        document.body.classList.toggle('tester-on', on);
        // выключили режим — время снова настоящее
        if (!on && isFakeTime()) {
            active = '';
            mark();
            resetTime();
        }
    }
    settings.onChange((name) => { if (name === 'tester') sync(); });
    sync();
}

// Строка в панели: какое время сейчас «на часах» сайта
export function renderTesterDock(date) {
    const label = $('testerTime');
    if (!label || $('testerDock').hidden) return;
    const text = isFakeTime()
        ? `${WEEKDAYS_SHORT[date.getDay()]} ${date.getDate()}.${pad(date.getMonth() + 1)}, ${formatMinutes(date.getHours() * 60 + date.getMinutes())}`
        : 'настоящее время';
    if (label.textContent !== text) label.textContent = text;
    $('testerReset').disabled = !isFakeTime();
}
