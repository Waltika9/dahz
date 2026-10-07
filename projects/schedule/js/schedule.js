// ===== Вкладка «Расписание» =====
// Рисует всю неделю: уроки, кабинеты, перемены, время и длительность.
// Подсветка (сегодняшний день, текущий урок или перемена) обновляется отдельно —
// highlightSchedule() вызывается раз в минуту и когда режим тестировки подменяет время.
// В режиме тестировки предметы называются «Урок-1», «Урок-2»… (subjectName).

import { formatMinutes, minuteOfDay, plural, WEEKDAYS, WEEKDAYS_SHORT } from './clock.js?v=1';
import { icon } from './pixel.js?v=5';
import { subjectName } from './settings.js?v=2';

// Маленький помощник: создать элемент с классом и текстом
function el(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

const mins = (n) => `${n} мин`;

export function renderSchedule(root, data) {
    root.innerHTML = '';

    // Быстрый переход к дню
    const chips = el('nav', 'day-chips');
    chips.setAttribute('aria-label', 'Дни недели');
    for (const day of data.days) {
        const chip = el('button', 'day-chip', WEEKDAYS_SHORT[day.weekday]);
        chip.type = 'button';
        chip.dataset.weekday = day.weekday;
        chip.addEventListener('click', () => {
            root.querySelector(`#day-${day.weekday}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        chips.append(chip);
    }
    root.append(chips);

    // Пометка «сегодня выходной» и т. п.
    const note = el('div', 'sched-note');
    note.hidden = true;
    root.append(note);

    for (const day of data.days) root.append(renderDay(day));
    root.append(renderBells(data));
}

function renderDay(day) {
    const card = el('article', 'card day-card');
    card.id = `day-${day.weekday}`;
    card.dataset.weekday = day.weekday;

    const head = el('header', 'day-head');
    const title = el('div', 'day-title');
    title.append(el('h2', 'day-name', day.name), el('span', 'day-badge'));
    head.append(title);

    const count = day.lessons.length;
    const first = day.lessons[0], last = day.lessons[count - 1];
    head.append(el('div', 'day-meta', count
        ? `${formatMinutes(first.start)} – ${formatMinutes(last.end)} · ${count} ${plural(count, 'урок', 'урока', 'уроков')}`
        : 'Уроков нет'));
    card.append(head);

    const list = el('ol', 'day-list');
    for (const item of day.items) {
        list.append(item.type === 'lesson' ? renderLesson(item) : renderBreak(item));
    }
    card.append(list);
    return card;
}

function renderLesson(l) {
    const row = el('li', 'lesson' + (l.extra ? ' is-extra' : ''));
    row.dataset.start = l.start;
    row.dataset.end = l.end;

    const num = el('span', 'l-num', String(l.n));
    num.title = `${l.n}-й урок`;

    // Предмет, а под ним время и длительность
    const main = el('span', 'l-main');
    const when = el('span', 'l-when');
    when.append(el('b', '', `${formatMinutes(l.start)} – ${formatMinutes(l.end)}`), el('span', 'l-dur', ` · ${mins(l.duration)}`));
    main.append(el('span', 'l-subj', subjectName(l)), when);

    const room = el('span', 'l-room');
    room.append(el('small', '', 'каб.'), el('b', '', l.room || '—'));

    row.append(num, main, room);
    return row;
}

function renderBreak(b) {
    const row = el('li', 'break' + (b.gap ? ' is-gap' : ''));
    row.dataset.start = b.start;
    row.dataset.end = b.end;
    row.append(el('span', '', `${b.gap ? 'окно' : 'перемена'} · ${mins(b.duration)}`));
    return row;
}

// Таблица звонков — как в бумажном расписании
function renderBells(data) {
    const card = el('article', 'card day-card bells-card');
    const head = el('header', 'day-head');
    const title = el('div', 'day-title');
    const name = el('h2', 'day-name');
    name.innerHTML = icon('bell') + '<span>Звонки</span>';
    title.append(name);
    const days = data.days;
    head.append(title, el('div', 'day-meta', days.length
        ? `${days[0].name} – ${days[days.length - 1].name.toLowerCase()}`
        : ''));
    card.append(head);

    const list = el('ol', 'bell-list');
    for (const b of data.bells) {
        const row = el('li', 'bell-row');
        row.append(
            el('span', 'l-num', String(b.n)),
            el('span', 'bell-time', `${formatMinutes(b.start)} – ${formatMinutes(b.end)}`),
            el('span', 'bell-dur', mins(b.duration)),
            el('span', 'bell-break', b.breakAfter ? `перемена ${mins(b.breakAfter)}` : '')
        );
        list.append(row);
    }
    card.append(list);
    return card;
}

// ----- Подсветка -----

// Ближайший следующий учебный день после weekday (для выходных)
function nextSchoolDay(data, weekday) {
    for (let i = 1; i <= 7; i++) {
        const day = data.byWeekday.get((weekday + i) % 7);
        if (day && day.lessons.length) return day;
    }
    return null;
}

export function highlightSchedule(root, data, date) {
    const weekday = date.getDay();
    const minute = minuteOfDay(date);
    const today = data.byWeekday.get(weekday);
    const hasLessons = !!today?.lessons.length;
    const next = hasLessons ? null : nextSchoolDay(data, weekday);

    root.querySelectorAll('.day-card[data-weekday]').forEach(card => {
        const wd = Number(card.dataset.weekday);
        const isToday = wd === weekday;
        const isNext = next?.weekday === wd;
        card.classList.toggle('is-today', isToday);
        card.classList.toggle('is-next', isNext);
        card.querySelector('.day-badge').textContent = isToday ? 'Сегодня' : isNext ? 'Следующий' : '';

        // Текущий урок / перемена и прошедшие — только у сегодняшнего дня
        card.querySelectorAll('.lesson, .break').forEach(row => {
            const start = Number(row.dataset.start), end = Number(row.dataset.end);
            row.classList.toggle('is-now', isToday && minute >= start && minute < end);
            row.classList.toggle('is-past', isToday && minute >= end);
        });
    });

    root.querySelectorAll('.day-chip').forEach(chip => {
        const wd = Number(chip.dataset.weekday);
        chip.classList.toggle('is-today', wd === weekday);
        chip.classList.toggle('is-next', wd === next?.weekday);
    });

    // Пометка над расписанием
    const note = root.querySelector('.sched-note');
    let text = '';
    if (!hasLessons) {
        text = `Сегодня ${WEEKDAYS[weekday].toLowerCase()} — уроков нет.`;
        if (next) text += ` Следующий учебный день — ${next.name.toLowerCase()}.`;
    } else if (minute >= today.lessons[today.lessons.length - 1].end) {
        text = 'На сегодня уроки закончились.';
    }
    note.hidden = !text;
    if (text) note.innerHTML = icon('moon') + `<span>${text}</span>`;
}

// Прокрутить к сегодняшнему (или следующему учебному) дню
export function scrollToToday(root) {
    const card = root.querySelector('.day-card.is-today, .day-card.is-next');
    if (card && card !== root.querySelector('.day-card')) {
        card.scrollIntoView({ block: 'start' });
    }
}
