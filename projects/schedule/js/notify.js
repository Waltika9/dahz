// ===== Уведомления =====
// Переключатель «Уведомления» в настройках (по умолчанию выключен). При включении сайт
// спрашивает разрешение и показывает под-настройки: урок начинается / заканчивается,
// перемена начинается / заканчивается.
//
// Честно об ограничениях (то же написано в настройках):
//   • на iPhone уведомления есть только у сайта, добавленного на экран «Домой» (iOS 16.4+);
//   • без сервера нельзя прислать push в закрытое приложение. Поэтому сейчас уведомления
//     показывает само приложение, пока оно открыто или недавно свёрнуто;
//   • чтобы подключить настоящий Web Push позже, есть subscribePush() ниже
//     и обработчик push в sw.js — останется только сервер.
//
// Как ловятся события: каждую секунду app.js передаёт сюда состояние (state.js).
// Если урок или перемена сменились — это и есть событие. Старые события (телефон «спал»
// дольше 2 минут) не показываем, чтобы не сыпать устаревшими уведомлениями.

import * as settings from './settings.js?v=2';
import { formatMinutes } from './clock.js?v=1';
import { toast } from './toast.js?v=1';

const { subjectName } = settings;

// Под-настройки: ключ в settings и подпись (по умолчанию все включены)
export const EVENTS = [
    { key: 'nLessonStart', label: 'Урок начинается' },
    { key: 'nLessonEnd',   label: 'Урок заканчивается' },
    { key: 'nBreakStart',  label: 'Перемена начинается' },
    { key: 'nBreakEnd',    label: 'Перемена заканчивается' }
];

const STALE_MS = 2 * 60 * 1000;
const ICON = 'assets/icon-192.png';

export const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function isStandalone() {
    return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

export function notifySupported() {
    return 'Notification' in window;
}

function permission() {
    return notifySupported() ? Notification.permission : 'unsupported';
}

export function isEventOn(key) {
    return settings.get(key) ?? true;
}

export function notificationsOn() {
    return !!settings.get('notify') && permission() === 'granted';
}

// Показать уведомление. На iPhone — только через service worker
export async function showNotification(title, body, tag) {
    try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) {
            await reg.showNotification(title, { body, tag, renotify: true, icon: ICON, badge: ICON });
            return true;
        }
    } catch (e) { /* попробуем по-простому */ }
    try {
        new Notification(title, { body, tag, icon: ICON });
        return true;
    } catch (e) {
        return false;
    }
}

// Включить: спросить разрешение (только по нажатию — так требует iPhone)
export async function enableNotifications() {
    if (!notifySupported()) {
        toast(isIOS && !isStandalone()
            ? 'Сначала добавьте сайт на экран «Домой» и откройте его оттуда'
            : 'Этот браузер не умеет показывать уведомления');
        return false;
    }
    let p = Notification.permission;
    if (p === 'default') p = await Notification.requestPermission();
    if (p !== 'granted') {
        toast('Уведомления запрещены. Разрешите их в настройках телефона');
        settings.set('notify', false);
        return false;
    }
    settings.set('notify', true);
    return true;
}

export function disableNotifications() {
    settings.set('notify', false);
}

// ----- Тексты -----
// Урок: номер, предмет, кабинет, длительность. Перемена: то же, но без кабинета.

const room = (l) => (l.room ? ` · каб. ${l.room}` : '');

function lessonStart(l) {
    return [`Урок ${l.n} начался`, `${subjectName(l)}${room(l)} · ${l.duration} мин, до ${formatMinutes(l.end)}`];
}

function lessonEnd(l) {
    return [`Урок ${l.n} закончился`, `${subjectName(l)}${room(l)} · ${l.duration} мин`];
}

function breakStart(b, next) {
    const name = b.gap ? 'Окно' : 'Перемена';
    const after = next ? ` · дальше урок ${next.n}: ${subjectName(next)}` : '';
    return [`${name} началась`, `${b.duration} мин, до ${formatMinutes(b.end)}${after}`];
}

function breakEnd(b, next) {
    const name = b.gap ? 'Окно' : 'Перемена';
    const body = next ? `Урок ${next.n}: ${subjectName(next)} · ${next.duration} мин` : '';
    return [`${name} закончилась`, body];
}

// Пример для кнопки «Проверить»: ближайший урок из расписания
export function testNotification(data) {
    const day = data?.days.find(d => d.lessons.length);
    const l = day?.lessons[0];
    const [title, body] = l ? lessonStart(l) : ['Проверка', 'Так будут выглядеть уведомления'];
    return showNotification(title, body, 'irl-test');
}

// ----- События -----

let prev = null;    // { kind, item } прошлой секунды

// Дата этого дня + minutes минут от полуночи
function at(date, minutes) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return d.getTime() + minutes * 60000;
}

// Каждую секунду (из app.js). state — из state.js, date — «текущее» время сайта
export function checkNotifications(state, date) {
    if (!state) return;
    const cur = { kind: state.kind, item: state.item, next: state.next };
    const was = prev;
    prev = cur;
    if (!was || was.item === cur.item || !notificationsOn()) return;

    const fresh = (minutes) => Math.abs(date.getTime() - at(date, minutes)) < STALE_MS;
    const list = [];

    if (was.kind === 'lesson' && fresh(was.item.end) && isEventOn('nLessonEnd')) {
        list.push([...lessonEnd(was.item), 'irl-lesson-end']);
    }
    if (was.kind === 'break' && fresh(was.item.end) && isEventOn('nBreakEnd')) {
        list.push([...breakEnd(was.item, cur.kind === 'lesson' ? cur.item : null), 'irl-break-end']);
    }
    if (cur.kind === 'lesson' && fresh(cur.item.start) && isEventOn('nLessonStart')) {
        list.push([...lessonStart(cur.item), 'irl-lesson-start']);
    }
    if (cur.kind === 'break' && fresh(cur.item.start) && isEventOn('nBreakStart')) {
        list.push([...breakStart(cur.item, cur.next?.item), 'irl-break-start']);
    }
    list.forEach(([title, body, tag]) => showNotification(title, body, tag));
}

// ----- Настройки на экране -----

function makeSwitch(on, label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'switch switch-sm';
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(on));
    b.setAttribute('aria-label', label);
    b.innerHTML = '<span class="switch-knob"></span>';
    return b;
}

export function initNotifyUI(getData) {
    const sw = document.getElementById('notifySwitch');
    const options = document.getElementById('notifyOptions');
    const events = document.getElementById('notifyEvents');
    const test = document.getElementById('notifyTest');
    const note = document.getElementById('notifyNote');

    // четыре под-переключателя
    for (const ev of EVENTS) {
        const row = document.createElement('div');
        row.className = 'sub-row';
        const label = document.createElement('span');
        label.textContent = ev.label;
        const s = makeSwitch(isEventOn(ev.key), ev.label);
        s.dataset.key = ev.key;
        s.addEventListener('click', () => settings.set(ev.key, !isEventOn(ev.key)));
        row.append(label, s);
        events.append(row);
    }

    sw.addEventListener('click', async () => {
        if (notificationsOn()) disableNotifications();
        else await enableNotifications();
        render();
    });

    test.addEventListener('click', async () => {
        const ok = await testNotification(getData());
        if (!ok) toast('Не получилось показать уведомление');
    });

    function render() {
        const on = notificationsOn();
        sw.setAttribute('aria-checked', String(on));
        options.hidden = !on;
        events.querySelectorAll('.switch').forEach(s => s.setAttribute('aria-checked', String(isEventOn(s.dataset.key))));

        // честная пометка об ограничениях
        const lines = [];
        if (isIOS && !isStandalone()) {
            lines.push('На iPhone уведомления работают, только если сайт добавлен на экран «Домой» (iOS 16.4 и новее) и открыт оттуда.');
        }
        if (permission() === 'denied') {
            lines.push('Уведомления запрещены. Разрешите их: Настройки телефона → Уведомления → IRL.');
        }
        lines.push('Без сервера уведомления приходят, только пока приложение открыто или недавно свёрнуто. Если его полностью закрыть, телефон их не покажет.');
        note.textContent = lines.join(' ');
    }

    settings.onChange((name) => {
        if (name === 'notify' || name.startsWith('n')) render();
    });
    render();
}

// ----- На будущее: настоящий Web Push -----
// Нужен сервер и пара VAPID-ключей. Сервер хранит подписку и в нужное время
// отправляет на неё сообщение — sw.js покажет уведомление даже при закрытом приложении.
export async function subscribePush(vapidPublicKey) {
    const reg = await navigator.serviceWorker.ready;
    const b64 = vapidPublicKey.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const key = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    return sub.toJSON();    // это отправить на сервер
}
