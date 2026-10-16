// ===== Режим истории: обучение и главы =====
// Глава 1 — обучение: подсказчик по шагам показывает, что где.
// Дальше главы с разными целями. У каждой главы свой срок и свои деньги.
// С «усложнением» каждая следующая глава короче, денег меньше, а жителей больше.
import { TYPES } from './lines.js?v=6';

// goal.kind: lines — открыть новые линии, riders — пассажиров в день,
// transfers — станций-пересадок, jam — загрузка дорог не выше value
export const CHAPTERS = [
    {
        title: 'Первая линия',
        text: 'Акимат решил: хватит пробок! Тебя назначили главным по транспорту Алматы. Для начала построй одну новую линию — я покажу, как.',
        goal: { kind: 'lines', value: 1 }, years: 2, grant: 300, yearly: 100, growth: 0
    },
    {
        title: 'Пассажиры',
        text: 'Линия работает, но транспортом пользуется ещё мало людей. Сделай так, чтобы метро, ЛРТ и SkyTrain возили 200 тысяч человек в день. Станции ставь там, где живут и работают.',
        goal: { kind: 'riders', value: 200000 }, years: 2, grant: 250, yearly: 120, growth: 0
    },
    {
        title: 'Пересадки',
        text: 'Чтобы проехать через весь город, нужны пересадки. Построй линии так, чтобы они сходились на общих станциях: поставь новую станцию прямо на старую — получится пересадка.',
        goal: { kind: 'transfers', value: 2 }, years: 2, grant: 250, yearly: 120, growth: 0
    },
    {
        title: 'Город растёт',
        text: 'В Алматы переезжают люди со всей страны: жителей стало на 5 % больше, и пробки выросли. Верни загрузку дорог хотя бы до 48 %.',
        goal: { kind: 'jam', value: 0.48 }, years: 3, grant: 300, yearly: 150, growth: 0.05
    },
    {
        title: 'Алматы без пробок',
        text: 'Последняя глава. Город растёт дальше (ещё +2 % жителей), а цель — загрузка дорог 46 % и ниже. Нужна большая сеть с пересадками.',
        goal: { kind: 'jam', value: 0.46 }, years: 4, grant: 350, yearly: 150, growth: 0.02
    }
];

// Глава с учётом усложнения: каждая следующая — на 10 % короче и беднее, жителей больше
export function chapterParams(k, hard) {
    const c = CHAPTERS[k];
    if (!hard || k === 0) return { ...c };
    const less = 1 - 0.1 * k;
    return {
        ...c,
        years: Math.max(1, Math.round(c.years * less * 2) / 2),
        grant: Math.round(c.grant * less),
        yearly: Math.round(c.yearly * less),
        growth: c.growth + 0.005 * k
    };
}

// ---------- Обучение ----------
// target — что подсветить; done(ctx) — шаг выполнен сам; без done — кнопка «Дальше»
const price = t => `${TYPES[t].costKm} млрд ₸ за км, ${TYPES[t].speed} км/ч`;

export const TUTORIAL = [
    {
        title: 'Привет!',
        text: 'Алматы стоит в пробках. Строй метро, ЛРТ и SkyTrain, чтобы люди пересели из машин. Я покажу, как всё устроено. Любой шаг можно пропустить.'
    },
    {
        title: 'Камера',
        text: 'Двигай карту мышкой. Колесо — приблизить, правая кнопка — повернуть и наклонить (на телефоне — двумя пальцами). Справа внизу — те же кнопки.',
        target: '.camera',
        enter: ctx => { ctx.cam = ctx.camera(); },
        done: ctx => {
            const a = ctx.cam, b = ctx.camera();
            return Math.abs(a.zoom - b.zoom) > 0.3 || Math.abs(a.bearing - b.bearing) > 10 || Math.abs(a.pitch - b.pitch) > 8
                || Math.hypot(a.lng - b.lng, a.lat - b.lat) > 0.004;
        }
    },
    {
        title: 'Где пробки',
        text: 'Нажми «Загрузка». Красные улицы — пробки. Где красно и много людей, транспорт нужнее всего.',
        target: '.layer[data-layer="traffic"] .ring',
        done: ctx => ctx.layer() === 'traffic'
    },
    {
        title: 'Где можно строить',
        text: 'Теперь «Местность». Метро можно почти везде, кроме русла рек. ЛРТ идёт по земле — ему нужно ровное свободное место. SkyTrain — эстакада, в тесноте только над большими дорогами. Наведи на клетку — увидишь причину.',
        target: '.layer[data-layer="terrain"] .ring',
        done: ctx => ctx.layer() === 'terrain'
    },
    {
        title: 'Три вида транспорта',
        text: `Метро — ${price('metro')}: быстрое, но дорогое и строится дольше всех. ЛРТ — ${price('lrt')}: дешёвое, но медленное. SkyTrain — ${price('sky')}: что-то среднее. Станции оплачиваются отдельно.`
    },
    {
        title: 'Новая линия',
        text: 'Внизу выбери вид транспорта. Для начала подойдёт ЛРТ — он дешёвый. Если в центре не получается — попробуй метро.',
        target: '.dock[data-for="transport"]',
        enter: ctx => ctx.setMode('transport'),
        done: ctx => ctx.drawing() || ctx.userLines() > 0
    },
    {
        title: 'Станции',
        text: 'Нажимай на карту — каждая точка станет станцией. Ставь их рядом с домами и местами работы, не ближе 400–700 м друг к другу. Если нельзя — внизу будет написано почему. Нужно хотя бы две станции.',
        done: ctx => ctx.draftStations() >= 2 || ctx.userLines() > 0
    },
    {
        title: 'Построить',
        text: 'Нажми «Построить» (или Enter). Деньги спишутся сразу, а сама линия будет строиться несколько месяцев.',
        target: '#drawDone',
        done: ctx => ctx.userLines() > 0
    },
    {
        title: 'Время',
        text: 'Время идёт само — дата слева внизу. Ускорь игру (кнопки или клавиши 1–3, пробел — пауза) и дождись, когда линия откроется.',
        target: '#speeds',
        done: ctx => ctx.openUserLines() > 0
    },
    {
        title: 'Пассажиры',
        text: 'Линия открылась! Чем больше пассажиров, тем крупнее кружок станции, а рядом — сколько людей в день. Справа список линий, слева цель главы.',
        target: '#goal'
    },
    {
        title: 'Деньги',
        text: 'Билеты приносят деньги, а обслуживание линий их тратит — итог за месяц написан рядом с бюджетом. Каждый январь город даёт ещё. Уйдёшь в минус больше 50 млрд — игра окончена.',
        target: '.money'
    },
    {
        title: 'Строительство',
        text: 'Во вкладке «Строительство» ставят здания и дороги. Новые дома — это новые пассажиры и новые пробки, поэтому подводи к ним транспорт. Здания бесплатные, дороги — из бюджета.',
        target: '.mode[data-mode="build"]',
        done: ctx => ctx.mode() === 'build'
    },
    {
        title: 'Готово!',
        text: 'Это всё, что нужно знать. В меню (Esc) можно сохранить игру в файл. Дальше главы будут сложнее — удачи!'
    }
];

/**
 * Подсказчик: карточка сверху с шагом обучения, подсветка нужной кнопки.
 * ctx — функции, по которым видно, что сделал игрок (см. app.js).
 * onStep(i) — запомнить шаг; onFinish(skipped) — обучение закончилось.
 */
export function createCoach({ ctx, onStep, onFinish }) {
    const el = {
        card: document.getElementById('coach'),
        count: document.getElementById('coachCount'),
        title: document.getElementById('coachTitle'),
        text: document.getElementById('coachText'),
        next: document.getElementById('coachNext'),
        skip: document.getElementById('coachSkip')
    };
    let step = -1, timer = 0, lit = null, passed = false;

    function light(selector) {
        if (lit) lit.classList.remove('coach-target');
        lit = selector ? document.querySelector(selector) : null;
        if (lit) lit.classList.add('coach-target');
    }

    function show(i) {
        clearInterval(timer);
        step = i;
        passed = false;
        if (i >= TUTORIAL.length) return finish(false);
        const s = TUTORIAL[i];
        if (s.enter) s.enter(ctx);
        el.count.textContent = `Обучение · шаг ${i + 1} из ${TUTORIAL.length}`;
        el.title.textContent = s.title;
        el.text.textContent = s.text;
        // Шаг-действие: кнопка «Пропустить шаг»; шаг-рассказ: «Дальше»
        el.next.textContent = s.done ? 'Пропустить шаг' : i === TUTORIAL.length - 1 ? 'Начать' : 'Дальше';
        el.next.className = s.done ? 'btn-line' : 'btn-primary btn-small';
        el.card.hidden = false;
        el.card.classList.remove('is-passed');
        document.body.classList.add('has-coach');
        light(s.target);
        onStep(i);
        // Действие проверяем несколько раз в секунду
        if (s.done) timer = setInterval(() => {
            if (passed || !s.done(ctx)) return;
            passed = true;
            el.card.classList.add('is-passed');
            setTimeout(() => show(step + 1), 700);
        }, 300);
    }

    function hide() {
        clearInterval(timer);
        light(null);
        el.card.hidden = true;
        document.body.classList.remove('has-coach');
    }

    function finish(skipped) {
        hide();
        step = -1;
        onFinish(skipped);
    }

    el.next.addEventListener('click', () => { if (step >= 0 && !passed) show(step + 1); });
    el.skip.addEventListener('click', () => { if (step >= 0) finish(true); });

    return {
        start: (i = 0) => show(Math.max(0, Math.min(TUTORIAL.length - 1, i))),
        hide,
        get active() { return step >= 0; }
    };
}
