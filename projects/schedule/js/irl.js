// ===== Вкладка IRL =====
// Сверху дата и часы с секундами, ниже блоки «Сейчас» и «Дальше».
// renderIrl() вызывается каждую секунду; текст в DOM меняется, только если он правда другой.
// Пиксельные часы слева и все анимации блока рисует fx.js.
// Когда состояние меняется (урок начался, перемена кончилась…), от блока расходится волна.

import { formatMinutes, isFakeTime, WEEKDAYS } from './clock.js?v=1';
import { getState } from './state.js?v=2';
import { subjectName } from './settings.js?v=2';
import { waveAround } from './press.js?v=1';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const ON_DAY = ['в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу'];

const $ = (id) => document.getElementById(id);
const els = {
    date: $('irlDate'), time: $('irlTime'), fake: $('fakeBadge'),
    now: $('nowCard'), badge: $('nowBadge'),
    title: $('nowTitle'), subject: $('nowSubject'), status: $('nowStatus'), sub: $('nowSub'),
    nextTitle: $('nextTitle'), nextSubject: $('nextSubject'), nextSub: $('nextSub')
};

const pad = (n) => String(n).padStart(2, '0');

function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
    el.hidden = !text;
}

// Сколько осталось: «24 мин», «1 ч 5 мин» (минуты округляем вверх: 30 секунд — это «1 мин»)
export function formatLeft(min) {
    const total = Math.max(1, Math.ceil(min - 1e-6));
    if (total < 60) return `${total} мин`;
    const h = Math.floor(total / 60), m = total % 60;
    return m ? `${h} ч ${m} мин` : `${h} ч`;
}

// «Урок 3, каб. 21» (без кабинета — просто «Урок 3»)
function lessonTitle(l) {
    return `Урок ${l.n}${l.room ? `, каб. ${l.room}` : ''}`;
}

// Все тексты и цвета для текущего состояния
// Плашка справа сразу говорит, что делать: «Скоро конец» — расслабиться, «Пора на урок!» — идти.
// На перемене строки идут так: «Перемена» → сколько осталось → до скольки.
// Какой урок дальше и в каком кабинете — в блоке «Дальше» ниже.
function describe(s) {
    const v = { phase: s.phase, ending: s.ending, badge: '', title: '', subject: '', status: '', sub: '' };
    const it = s.item;
    const soon = s.phase === 'soon';

    if (s.kind === 'lesson') {
        v.badge = s.ending ? 'Скоро конец' : 'Урок';
        v.title = lessonTitle(it);
        v.subject = subjectName(it);
        v.status = `закончится через ${formatLeft(s.left)}`;
        v.sub = `${formatMinutes(it.start)} – ${formatMinutes(it.end)}`;
    } else if (s.kind === 'break') {
        const name = it.gap ? 'Окно' : 'Перемена';
        v.badge = soon ? 'Пора на урок!' : name;
        v.title = name;
        v.status = soon ? `урок начнётся через ${formatLeft(s.left)}` : `закончится через ${formatLeft(s.left)}`;
        v.sub = `до ${formatMinutes(it.end)}`;
    } else if (s.reason === 'before') {
        v.badge = soon ? 'Пора на урок!' : 'Вне занятий';
        v.title = soon ? 'Скоро первый урок' : 'Вне занятий';
        v.status = `уроки начнутся через ${formatLeft(s.left)}`;
        v.sub = `в ${formatMinutes(s.next.item.start)}`;
    } else if (s.reason === 'after') {
        v.badge = 'Вне занятий';
        v.title = 'Вне занятий';
        v.status = 'уроки на сегодня закончились';
    } else {
        v.badge = 'Выходной';
        v.title = 'Выходной';
        v.status = 'сегодня уроков нет';
    }

    // «Дальше»
    const n = s.next;
    v.next = { title: '', subject: '', sub: '' };
    if (n.type === 'break') {
        v.next.title = `${n.item.gap ? 'Окно' : 'Перемена'}, ${n.item.duration} мин`;
        v.next.sub = `${formatMinutes(n.item.start)} – ${formatMinutes(n.item.end)}`;
    } else if (n.type === 'end') {
        v.next.title = 'Уроки закончатся';
        v.next.sub = 'это последний урок на сегодня';
    } else if (n.type === 'lesson') {
        const l = n.item;
        v.next.title = `${lessonTitle(l)}, длится ${l.duration} мин`;
        v.next.subject = subjectName(l);
        const time = formatMinutes(l.start);
        v.next.sub = n.daysAhead === 0 ? `${time} – ${formatMinutes(l.end)}`
            : n.daysAhead === 1 ? `завтра в ${time}`
            : `${ON_DAY[n.weekday]} в ${time}`;
    } else {
        v.next.title = 'В расписании нет уроков';
    }
    return v;
}

// Часы: каждая цифра в своей ячейке, чтобы при смене секунд ничего не прыгало
function renderTime(text) {
    const box = els.time;
    if (box.childElementCount !== text.length) {
        box.innerHTML = [...text].map(ch => `<span class="${ch === ':' ? 'colon' : 'digit'}"></span>`).join('');
    }
    [...text].forEach((ch, i) => {
        const cell = box.children[i];
        if (cell.textContent !== ch) cell.textContent = ch;
    });
}

let lastCls = '';

// Возвращает состояние (getState) — app.js по нему включает домашний режим
export function renderIrl(data, date) {
    setText(els.date, `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]}`);
    renderTime(`${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`);
    els.fake.hidden = !isFakeTime();
    if (!data) return null;

    const state = getState(data, date);
    const v = describe(state);

    // Цвет (и запасное мигание, если анимации отключены). Мигание — ровно с начала секунды.
    const cls = `card now-card phase-${v.phase}${v.ending ? ' is-ending' : ''}`;
    if (els.now.className !== cls) {
        els.now.className = cls;
        els.now.style.animationDelay = `-${date.getMilliseconds()}ms`;
        if (lastCls) waveAround(els.now, true);     // состояние сменилось — большая волна
    }
    lastCls = cls;

    setText(els.badge, v.badge);
    setText(els.title, v.title);
    setText(els.subject, v.subject);
    setText(els.status, v.status);
    setText(els.sub, v.sub);
    setText(els.nextTitle, v.next.title);
    setText(els.nextSubject, v.next.subject);
    setText(els.nextSub, v.next.sub);
    return state;
}

// Расписание не загрузилось — пишем об этом прямо в блоке «Сейчас»
export function showIrlError(message) {
    els.now.className = 'card now-card phase-error';
    setText(els.badge, 'Ошибка');
    setText(els.title, 'Нет расписания');
    setText(els.subject, '');
    setText(els.status, message);
    setText(els.sub, '');
    setText(els.nextTitle, '—');
    setText(els.nextSubject, '');
    setText(els.nextSub, '');
}
