// ===== Главное меню =====
// Фон — фотографии Алматы. Новая картинка «проявляется» справа налево
// с мягким краем и небольшим сдвигом, старая чуть уезжает влево.
// Весь фон слегка двигается за мышкой. Справа сверху — подпись к фото.
// Пункты меню — станции на линии: к выбранной подъезжает «поезд»
// (разгоняется, вытягивается на ходу и тормозит). Главная кнопка — «билет».

const PHOTOS = [
    ['img/menu/alatau-peaks.webp', 'Заилийский Алатау'],
    ['img/menu/city-drone.webp', 'Алматы сверху'],
    ['img/menu/koktobe-sunset.jpg', 'Кок-Тобе, закат'],
    ['img/menu/tv-tower-view.webp', 'Вид от телебашни'],
    ['img/menu/cable-car-winter.jpg', 'Канатка зимой'],
    ['img/menu/koktobe-green.jpg', 'Кок-Тобе летом'],
    ['img/menu/park-night.jpg', 'Парк ночью']
];

const SHOW_MS = 7000;   // сколько висит одна картинка
const MOVE_MS = 1800;   // сколько длится переход
const FEATHER = 30;     // ширина мягкого края перехода, %
const TRAIN_MS = 520;   // поезд едет между станциями

const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function makeSlide(src) {
    const slide = document.createElement('div');
    slide.className = 'slide';
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.decoding = 'async';
    slide.appendChild(img);
    return { slide, img };
}

// Маска «проявления» справа налево: правее края p — видно, левее мягко исчезает
function setReveal(el, p) {
    const edge = p * (100 + FEATHER);
    const mask = p >= 1 ? 'none' : `linear-gradient(270deg, #000 ${edge - FEATHER}%, transparent ${edge}%)`;
    el.style.maskImage = mask;
    el.style.webkitMaskImage = mask;
}

export function initMenu({ onAction }) {
    const root = document.getElementById('menu');
    const bg = document.getElementById('menuBg');
    const nav = document.getElementById('menuNav');
    const train = document.getElementById('menuTrain');
    const play = document.getElementById('menuPlay');
    const photo = document.getElementById('menuPhoto');
    const photoName = document.getElementById('menuPhotoName');
    const photoNum = document.getElementById('menuPhotoNum');

    let index = 0, current = null, timer = 0, busy = false, open = false;

    function caption() {
        photo.classList.remove('is-new');
        void photo.offsetWidth;   // перезапуск анимации подписи
        photo.classList.add('is-new');
        photoName.textContent = PHOTOS[index][1];
        photoNum.textContent = `${index + 1}/${PHOTOS.length}`;
    }

    // Первая картинка — сразу, без перехода
    current = makeSlide(PHOTOS[0][0]);
    bg.appendChild(current.slide);
    caption();

    async function next() {
        if (busy) return;
        busy = true;
        clearTimeout(timer);
        index = (index + 1) % PHOTOS.length;

        const incoming = makeSlide(PHOTOS[index][0]);
        setReveal(incoming.slide, 0);
        bg.appendChild(incoming.slide);
        try { await incoming.img.decode(); } catch (e) { /* покажем как есть */ }
        caption();

        const old = current;
        const t0 = performance.now();
        const step = now => {
            const t = Math.min(1, (now - t0) / MOVE_MS);
            const e = ease(t);
            setReveal(incoming.slide, e);
            incoming.slide.style.transform = `translateX(${(60 * (1 - e)).toFixed(1)}px)`;
            old.slide.style.transform = `translateX(${(-40 * e).toFixed(1)}px)`;
            if (t < 1) return requestAnimationFrame(step);
            old.slide.remove();
            incoming.slide.style.transform = '';
            current = incoming;
            busy = false;
            schedule();
        };
        requestAnimationFrame(step);
    }

    function schedule() {
        clearTimeout(timer);
        if (open) timer = setTimeout(next, SHOW_MS);
    }

    photo.addEventListener('click', next);

    // Фон слегка следует за мышкой
    let tx = 0, ty = 0, x = 0, y = 0, raf = 0;
    window.addEventListener('pointermove', e => {
        tx = (e.clientX / innerWidth - 0.5) * 2;
        ty = (e.clientY / innerHeight - 0.5) * 2;
    });
    const drift = () => {
        x += (tx - x) * 0.05;
        y += (ty - y) * 0.05;
        bg.style.transform = `translate(${(-x * 22).toFixed(2)}px, ${(-y * 14).toFixed(2)}px)`;
        if (open) raf = requestAnimationFrame(drift);
    };

    // ---------- Поезд на линии ----------
    const items = () => [...nav.querySelectorAll('.nav-item')].filter(b => !b.hidden);
    let at = null, trainY = 0, run = null;

    // Центр станции (кружка) по высоте, относительно nav
    const stopY = item => item.offsetTop + item.offsetHeight / 2;

    function goTo(item, instant = false) {
        if (!item || !open) return;
        at = item;
        train.style.setProperty('--c', getComputedStyle(item).getPropertyValue('--c').trim() || '#5b6670');
        const to = stopY(item);
        const from = trainY;
        trainY = to;
        if (run) run.cancel();
        const end = `translateY(${to}px)`;
        train.style.transform = end;
        if (instant || calm() || Math.abs(to - from) < 1) return;
        // на ходу поезд вытягивается — тем сильнее, чем дальше ехать
        const stretch = Math.min(2.4, 1 + Math.abs(to - from) / 80);
        run = train.animate([
            { transform: `translateY(${from}px) scaleY(1)` },
            { transform: `translateY(${(from + to) / 2}px) scaleY(${stretch})`, offset: 0.5 },
            { transform: end }
        ], { duration: TRAIN_MS, easing: 'cubic-bezier(.55,0,.35,1)' });
    }

    // Линия — от первой станции до последней; пунктов бывает разное число
    function layout() {
        const list = items();
        if (!list.length) return;
        const a = stopY(list[0]), b = stopY(list[list.length - 1]);
        nav.style.setProperty('--line-top', `${a}px`);
        nav.style.setProperty('--line-h', `${b - a}px`);
        if (open) goTo(at && !at.hidden ? at : list[0], true);
    }
    new ResizeObserver(layout).observe(nav);

    // Порядковые номера для появления пунктов по очереди
    function stagger() {
        items().forEach((b, i) => b.style.setProperty('--i', i));
    }

    // Кнопки меню
    root.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn === play) play.classList.add('is-torn');
            onAction(btn.dataset.action);
            // текст пункта мог поменяться («Точно начать заново?») — поезд встанет точно
            if (btn.classList.contains('nav-item')) requestAnimationFrame(() => goTo(btn, true));
        });
    });
    nav.addEventListener('pointerover', e => {
        const item = e.target.closest('.nav-item');
        if (item && item !== at) goTo(item);
    });
    nav.addEventListener('focusin', e => {
        const item = e.target.closest('.nav-item');
        if (item && item !== at) goTo(item);
    });

    // Стрелки вверх/вниз — по пунктам, как в меню игры
    window.addEventListener('keydown', e => {
        if (!open || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
        const list = [...items(), play];
        const i = list.indexOf(document.activeElement);
        const k = e.key === 'ArrowDown' ? (i < 0 ? 0 : (i + 1) % list.length) : (i <= 0 ? list.length - 1 : i - 1);
        e.preventDefault();
        list[k].focus();
    });

    return {
        show() {
            if (open) return;
            open = true;
            play.classList.remove('is-torn');
            root.classList.remove('is-hidden');
            stagger();
            requestAnimationFrame(layout);
            raf = requestAnimationFrame(drift);
            schedule();
        },
        hide() {
            open = false;
            at = null;
            clearTimeout(timer);
            cancelAnimationFrame(raf);
            root.classList.add('is-hidden');
        },
        get open() { return open; }
    };
}
