// ===== Загрузка расписания =====
// Читает data/schedule.json и превращает его в удобный вид: у каждого урока
// есть время начала и конца в минутах, а между уроками — перемены.
// Если в файле ошибка, сообщение говорит, где именно, — чтобы было легко поправить руками.

import { toMinutes, WEEKDAYS } from './clock.js?v=1';

// "Понедельник" → 1 и т. д. (как в JS: 0 — воскресенье)
const DAY_INDEX = Object.fromEntries(WEEKDAYS.map((name, i) => [name.toLowerCase(), i]));

export async function loadSchedule(url = 'data/schedule.json') {
    let res;
    try {
        // no-cache: браузер всё равно спросит сервер, не изменился ли файл
        res = await fetch(url, { cache: 'no-cache' });
    } catch (e) {
        throw new Error('Не получилось загрузить расписание. Проверьте интернет.');
    }
    if (!res.ok) throw new Error(`Файл ${url} не найден (ошибка ${res.status}).`);

    let raw;
    try {
        raw = JSON.parse(await res.text());
    } catch (e) {
        throw new Error('Ошибка в schedule.json: ' + e.message);
    }
    return normalize(raw);
}

function normalize(raw) {
    // Звонки: номер урока → время
    const bells = new Map();
    for (const b of raw.bells || []) {
        const n = Number(b.n);
        const start = toMinutes(b.start), end = toMinutes(b.end);
        if (!n) throw new Error('Звонки: у одной из строк нет номера урока (n).');
        if (start === null || end === null) throw new Error(`Звонки, урок ${n}: время пишется так — "08:00".`);
        if (end <= start) throw new Error(`Звонки, урок ${n}: конец раньше начала.`);
        bells.set(n, { n, start, end, duration: end - start });
    }
    const bellList = [...bells.values()].sort((a, b) => a.start - b.start);
    // перемена после каждого звонка — до начала следующего
    bellList.forEach((b, i) => {
        b.breakAfter = bellList[i + 1] ? bellList[i + 1].start - b.end : 0;
    });

    // Дни недели
    const days = [];
    for (const d of raw.week || []) {
        const weekday = DAY_INDEX[String(d.day ?? '').trim().toLowerCase()];
        if (weekday === undefined) throw new Error(`Неизвестный день «${d.day}». Пишите полностью: «Понедельник».`);
        if (days.some(x => x.weekday === weekday)) throw new Error(`День «${d.day}» записан два раза.`);

        const lessons = (d.lessons || []).map(l => {
            const bell = bells.get(Number(l.n));
            if (!bell) throw new Error(`${WEEKDAYS[weekday]}: для урока ${l.n} нет звонка в bells.`);
            return {
                type: 'lesson',
                n: bell.n,
                subject: String(l.subject ?? '').trim() || 'Без названия',
                room: String(l.room ?? '').trim(),
                extra: !!l.extra,
                start: bell.start,
                end: bell.end,
                duration: bell.duration
            };
        }).sort((a, b) => a.start - b.start);

        // Уроки вперемешку с переменами: урок, перемена, урок…
        const items = [];
        lessons.forEach((lesson, i) => {
            const prev = lessons[i - 1];
            if (prev) {
                items.push({
                    type: 'break',
                    start: prev.end,
                    end: lesson.start,
                    duration: lesson.start - prev.end,
                    gap: lesson.n - prev.n > 1      // пропущен урок — это «окно», а не перемена
                });
            }
            items.push(lesson);
        });

        days.push({ weekday, name: WEEKDAYS[weekday], lessons, items });
    }

    // Неделя по-нашему: с понедельника, воскресенье в конце
    days.sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7));

    return {
        className: String(raw.class ?? ''),
        bells: bellList,
        days,
        byWeekday: new Map(days.map(d => [d.weekday, d]))
    };
}
