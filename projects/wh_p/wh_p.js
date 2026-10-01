// ===== ПРЕЗЕНТАЦИЯ «ИСТОРИЯ ДРЕВНЕЙ ГРЕЦИИ» =====
const $ = (id) => document.getElementById(id);
const IMG = '../../images/';                  // стрелки и иконки
const PHOTOS = '../../images/wh_p_images/';   // фото для презентации

const track = $('track');
const dotsBox = $('dots');
const nextBtn = $('nextBtn');
const nextFill = $('nextFill');
const nextText = $('nextText');
const nextIcon = $('nextIcon');
const mobileModal = $('mobileModal');

const slides = [...track.querySelectorAll('.slide')];
const DELAY = 2000;       // мс — столько же, сколько --delay в wh_p.css
const LEAVE_TIME = 600;   // сколько длится уход старого слайда

let current = -1;
let timer = null;
let mobileWarned = false;
let globe = null;

const slideId = () => slides[current].dataset.id;

// ===== ПОДСКАЗКИ =====
// Показываются один раз, сами скрываются через несколько секунд
// или когда пользователь наведёт курсор на точку / кнопку.
const pointTip = $('pointTip');
const nextTip = $('nextTip');
const cmpTip = $('cmpTip');
const TIP_TIME = 7000;
const tipTimers = new Map();
const tipsDone = new Set();

function showTip(tip) {
    if (tipsDone.has(tip)) return;
    tipsDone.add(tip);
    tip.classList.add('show');
    tipTimers.set(tip, setTimeout(() => hideTip(tip), TIP_TIME));
}

function hideTip(tip) {
    tipsDone.add(tip);
    clearTimeout(tipTimers.get(tip));
    tip.classList.remove('show');
}

const isTouch = matchMedia('(hover: none)').matches;
if (isTouch) {
    $('pointTipText').textContent = 'Нажмите на точку, чтобы узнать подробности';
    $('godsHint').textContent = 'Нажмите на карточку, чтобы перевернуть её';
}

nextBtn.addEventListener('mouseenter', () => hideTip(nextTip));

// ===== ПЛАВНАЯ ЗАМЕНА ТЕКСТА =====
// Старый текст уплывает вверх, новый выплывает снизу
function swapText(el, text) {
    if (el.textContent === text) return;
    el.getAnimations().forEach(a => a.cancel());
    const out = el.animate(
        [{ opacity: 1, transform: 'none', filter: 'blur(0)' },
         { opacity: 0, transform: 'translateY(-12px)', filter: 'blur(8px)' }],
        { duration: 280, easing: 'ease-in', fill: 'forwards' }
    );
    out.onfinish = () => {
        el.textContent = text;
        el.animate(
            [{ opacity: 0, transform: 'translateY(12px)', filter: 'blur(8px)' },
             { opacity: 1, transform: 'none', filter: 'blur(0)' }],
            { duration: 600, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
        );
        out.cancel();
    };
}

// Блок с классом .swappable: содержимое гаснет, меняется и снова появляется
function swapContent(el, update, instant) {
    clearTimeout(el._swapTimer);
    if (instant) { update(); return; }
    el.classList.add('swapping');
    el._swapTimer = setTimeout(() => {
        update();
        el.classList.remove('swapping');
    }, 230);
}

// ===== ФОН, КОТОРЫЙ ОСТАЁТСЯ =====
const orbGold = $('orbGold');
const orbBlue = $('orbBlue');
const bgLetter = $('bgLetter');
const LETTERS = 'ΑΒΓΔΕΖΗΘΙΚΛΜ';
// где находятся золотое и синее свечение на каждом слайде (в % от экрана)
const ORBS = [
    [[70, 40], [100, 100]],
    [[15, 15], [90, 90]],
    [[50, 50], [50, 50]],
    [[85, 10], [10, 95]],
    [[75, 60], [15, 15]],
    [[20, 30], [85, 85]],
    [[50, 0], [0, 100]],
    [[78, 50], [10, 10]],
    [[50, 65], [95, 5]],
    [[50, 50], [15, 85]]
];

function updateAmbient() {
    const [g, b] = ORBS[current % ORBS.length];
    orbGold.style.left = g[0] + '%';
    orbGold.style.top = g[1] + '%';
    orbBlue.style.left = b[0] + '%';
    orbBlue.style.top = b[1] + '%';
    swapText(bgLetter, LETTERS[current % LETTERS.length]);
    const pad = (n) => String(n).padStart(2, '0');
    swapText($('chapterNum'), `${pad(current + 1)} / ${pad(slides.length)}`);
    swapText($('chapterName'), slides[current].dataset.title);
}

// ===== ПЕРЕКЛЮЧЕНИЕ СЛАЙДОВ =====
const dots = slides.map((s, i) => {
    const dot = document.createElement('button');
    dot.className = 'dot';
    dot.setAttribute('aria-label', `Слайд ${i + 1}: ${s.dataset.title}`);
    dot.addEventListener('click', () => { if (!nextBtn.disabled) goTo(i); });
    dotsBox.appendChild(dot);
    return dot;
});

function goTo(index) {
    if (index === current) return;
    const prev = slides[current];
    if (prev) {
        prev.classList.remove('active');
        prev.classList.add('leaving');
        clearTimeout(prev._leaveTimer);
        prev._leaveTimer = setTimeout(() => prev.classList.remove('leaving'), LEAVE_TIME);
        hooks[prev.dataset.id]?.leave?.();
    }

    current = index;
    const slide = slides[current];
    clearTimeout(slide._leaveTimer);
    slide.classList.remove('leaving');
    slide.classList.add('active');
    hooks[slide.dataset.id]?.enter?.();

    dots.forEach((d, i) => d.classList.toggle('active', i === current));
    const last = current === slides.length - 1;
    nextText.textContent = last ? 'В начало' : 'Следующий слайд';
    nextIcon.src = last ? IMG + 'back.png' : IMG + 'next.png';
    updateAmbient();
    lock();
}

// Выполнить действие, когда слайд уже точно ушёл с экрана
function afterLeave(id, fn) {
    setTimeout(() => { if (slideId() !== id) fn(); }, LEAVE_TIME + 300);
}

// Кнопка серая → заливается белым слева направо → активна
function lock() {
    clearTimeout(timer);
    nextBtn.disabled = true;
    nextFill.classList.remove('filling');
    void nextFill.offsetWidth;   // перезапуск анимации
    nextFill.classList.add('filling');
    timer = setTimeout(() => {
        nextBtn.disabled = false;
        if (current === 0) setTimeout(() => { if (current === 0) showTip(nextTip); }, 2500);
    }, DELAY);
}

function next() {
    if (nextBtn.disabled || mobileModal.classList.contains('open')) return;
    hideTip(nextTip);
    hideTip(pointTip);
    if (current === 0 && !mobileWarned && isMobile()) {
        openModal();
        return;
    }
    goTo((current + 1) % slides.length);
}

function prev() {
    if (nextBtn.disabled || mobileModal.classList.contains('open') || current === 0) return;
    goTo(current - 1);
}

nextBtn.addEventListener('click', next);

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    if (mobileModal.classList.contains('open')) return;
    const onControl = e.target.closest('a, button, input');
    if (e.key === 'ArrowRight' || ((e.key === ' ' || e.key === 'Enter') && !onControl)) {
        e.preventDefault();
        next();
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
    }
});

// ===== ОКНО ДЛЯ ТЕЛЕФОНОВ =====
function isMobile() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
        || (matchMedia('(pointer: coarse)').matches && innerWidth < 1024);
}

function openModal() {
    mobileModal.classList.add('open');
    mobileModal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
    mobileModal.classList.remove('open');
    mobileModal.setAttribute('aria-hidden', 'true');
}

$('modalContinue').addEventListener('click', () => {
    mobileWarned = true;
    closeModal();
    goTo(1);
});

mobileModal.addEventListener('click', (e) => { if (e.target === mobileModal) closeModal(); });

// ===== 1. 3D-ГЛОБУС =====
const PLACES = [
    { name: 'Афины',       note: 'Колыбель демократии, здесь стоит Парфенон',      lat: 37.9715, lng: 23.7257, img: 'greece_athens.jpg' },
    { name: 'Спарта',      note: 'Город-государство воинов',                       lat: 37.0755, lng: 22.4303, img: 'greece_sparta.jpg' },
    { name: 'Олимпия',     note: 'Родина Олимпийских игр (776 г. до н. э.)',       lat: 37.6384, lng: 21.6297, img: 'greece_olympia.jpg' },
    { name: 'Дельфы',      note: 'Святилище Аполлона и знаменитый оракул',         lat: 38.4824, lng: 22.5010, img: 'greece_delphi.jpg' },
    { name: 'Кносс',       note: 'Дворец минойской цивилизации на Крите',          lat: 35.2980, lng: 25.1632, img: 'greece_knossos.jpg' },
    { name: 'Троя',        note: 'Город из «Илиады» Гомера',                       lat: 39.9575, lng: 26.2389, img: 'greece_troy.jpg' },
    { name: 'Александрия', note: 'Основана Александром Македонским в 331 г. до н. э.', lat: 31.2001, lng: 29.9187, img: 'greece_alexandria.jpg' },
    { name: 'Сиракузы',    note: 'Одна из крупнейших греческих колоний, Сицилия',  lat: 37.0755, lng: 15.2866, img: 'greece_syracuse.jpg' }
];

const athens = PLACES[0];
const ARCS = PLACES.slice(5).map(p => ({ startLat: athens.lat, startLng: athens.lng, endLat: p.lat, endLng: p.lng }));

function makeMarker(p) {
    const el = document.createElement('div');
    el.className = 'marker';
    el.innerHTML = `
        <span class="marker-dot"></span>
        <div class="marker-card">
            <img src="${PHOTOS}${p.img}" alt="">
            <b>${p.name}</b>
            <span>${p.note}</span>
        </div>`;
    // если картинку ещё не скачали — просто не показываем её
    el.querySelector('img').onerror = function () { this.remove(); };
    el.addEventListener('mouseenter', () => hideTip(pointTip));
    el.addEventListener('click', (e) => {
        e.stopPropagation();
        hideTip(pointTip);
        const wasOpen = el.classList.contains('open');
        document.querySelectorAll('.marker.open').forEach(m => m.classList.remove('open'));
        if (!wasOpen) el.classList.add('open');
    });
    return el;
}

function initGlobe() {
    const wrap = $('globeWrap');
    const box = $('globe');
    if (typeof Globe === 'undefined') return;   // нет интернета — без глобуса

    const TEX = 'https://cdn.jsdelivr.net/npm/three-globe/example/img/';
    globe = new Globe(box)
        .backgroundColor('rgba(0,0,0,0)')
        .globeImageUrl(TEX + 'earth-blue-marble.jpg')
        .bumpImageUrl(TEX + 'earth-topology.png')
        .showAtmosphere(true)
        .atmosphereColor('#f2c94c')
        .atmosphereAltitude(0.18)
        .htmlElementsData(PLACES)
        .htmlElement(makeMarker)
        .arcsData(ARCS)
        .arcColor(() => ['rgba(242,201,76,0.9)', 'rgba(255,233,168,0.3)'])
        .arcStroke(0.5)
        .arcDashLength(0.4)
        .arcDashGap(0.2)
        .arcDashAnimateTime(2500)
        .arcAltitudeAutoScale(0.35)
        .ringsData([athens])
        .ringColor(() => t => `rgba(242,201,76,${1 - t})`)
        .ringMaxRadius(3)
        .ringPropagationSpeed(2)
        .ringRepeatPeriod(1400);

    // точки на обратной стороне Земли прячем
    if (typeof globe.htmlElementVisibilityModifier === 'function') {
        globe.htmlElementVisibilityModifier((el, visible) => {
            el.style.opacity = visible ? 1 : 0;
            el.style.pointerEvents = visible ? 'auto' : 'none';
        });
    }

    const controls = globe.controls();
    controls.enableZoom = true;
    controls.minDistance = 140;
    controls.maxDistance = 500;

    // размер под контейнер
    const resize = () => globe.width(box.clientWidth).height(box.clientHeight);
    new ResizeObserver(resize).observe(box);
    resize();

    // появление из темноты: Земля поворачивается к Греции и плавно приближается к точкам
    globe.pointOfView({ lat: 15, lng: -60, altitude: 1.4 });
    let shown = false;
    const show = () => {
        if (shown) return;
        shown = true;
        wrap.classList.add('ready');
        globe.pointOfView({ lat: 36.5, lng: 23, altitude: 0.75 }, 3500);
        setTimeout(() => { if (current === 0) showTip(pointTip); }, 2500);
    };
    if (typeof globe.onGlobeReady === 'function') globe.onGlobeReady(() => setTimeout(show, 600));
    setTimeout(show, 2500);   // на всякий случай

    document.addEventListener('click', () => {
        document.querySelectorAll('.marker.open').forEach(m => m.classList.remove('open'));
    });
}

// ===== 2. ЛЕНТА ВРЕМЕНИ =====
const EPOCHS = [
    {
        name: 'Крито-микенский', short: 'ок. 3000–1100',
        date: 'Около 3000–1100 гг. до н. э.', title: 'Крито-микенская цивилизация', img: 'greece_knossos.jpg',
        text: 'На Крите расцветает минойская цивилизация с огромным Кносским дворцом, а на материке — города-крепости Микены и Пилос. Появляется первая письменность — линейное письмо.'
    },
    {
        name: 'Гомеровский', short: 'XI–IX вв.',
        date: 'XI–IX вв. до н. э.', title: 'Гомеровский период', img: 'timeline_homer.jpg',
        text: 'После гибели микенских царств Греция приходит в упадок: письменность забыта, города пустеют. Об этом времени мы узнаём из поэм Гомера «Илиада» и «Одиссея».'
    },
    {
        name: 'Архаический', short: 'VIII–VI вв.',
        date: 'VIII–VI вв. до н. э.', title: 'Архаический период', img: 'greece_olympia.jpg',
        text: 'Возникают полисы — города-государства. Греки основывают колонии по берегам Средиземного и Чёрного морей, появляется алфавит, а в 776 г. до н. э. проходят первые Олимпийские игры.'
    },
    {
        name: 'Классический', short: 'V–IV вв.',
        date: 'V–IV вв. до н. э.', title: 'Классический период', img: 'greece_athens.jpg',
        text: 'Золотой век Греции. Греки побеждают персов при Марафоне и Саламине, в Афинах при Перикле расцветает демократия и строится Парфенон. Позже Афины и Спарта сталкиваются в Пелопоннесской войне.'
    },
    {
        name: 'Эллинистический', short: '323–30 гг.',
        date: '323–30 гг. до н. э.', title: 'Эллинистический период', img: 'greece_alexandria.jpg',
        text: 'После походов Александра Македонского его огромная держава распадается на эллинистические царства. Греческий язык и культура распространяются по всему Востоку, а центром науки становится Александрия.'
    },
    {
        name: 'Завоевание Римом', short: '146 г.',
        date: '146 г. до н. э.', title: 'Греция под властью Рима', img: 'timeline_corinth.jpg',
        text: 'Римляне разрушают Коринф, и Греция становится частью Римской державы. Но греческая культура покоряет самих римлян: они перенимают у греков богов, искусство и науку.'
    }
];

const tlPoints = $('tlPoints');
const tlDetail = $('tlDetail');
const tlImg = $('tlImg');
let tlActive = -1;

const tlButtons = EPOCHS.map((ep, i) => {
    const b = document.createElement('button');
    b.className = 'tl-point';
    b.style.setProperty('--i', i);
    b.innerHTML = `<span class="tl-dot"></span><span class="tl-pill"><b>${ep.name}</b><span>${ep.short}</span></span>`;
    b.addEventListener('mouseenter', () => selectEpoch(i));
    b.addEventListener('click', () => selectEpoch(i));
    tlPoints.appendChild(b);
    return b;
});

tlImg.addEventListener('error', () => tlDetail.classList.add('noimg'));

function selectEpoch(i, instant) {
    if (i === tlActive) return;
    tlActive = i;
    tlButtons.forEach((b, j) => {
        b.classList.toggle('active', j === i);
        b.classList.toggle('passed', j <= i);
    });
    $('tlProgress').style.transform = `scaleX(${i / (EPOCHS.length - 1)})`;
    swapContent(tlDetail, () => {
        const ep = EPOCHS[i];
        tlDetail.classList.remove('noimg');
        tlImg.src = PHOTOS + ep.img;
        $('tlDate').textContent = ep.date;
        $('tlTitle').textContent = ep.title;
        $('tlDesc').textContent = ep.text;
    }, instant);
}

selectEpoch(0, true);

// ===== 3. АФИНЫ ПРОТИВ СПАРТЫ =====
const cmp = $('cmp');
let cmpDrag = false;
let cmpRaf = 0;

function setCmp(p) {
    cmp.style.setProperty('--p', Math.max(0, Math.min(100, p)));
}

function cmpFromEvent(e) {
    const r = cmp.getBoundingClientRect();
    return (e.clientX - r.left) / r.width * 100;
}

cmp.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    cancelAnimationFrame(cmpRaf);
    cmpDrag = true;
    cmp.setPointerCapture(e.pointerId);
    cmp.classList.add('dragging', 'smooth');   // по клику ползунок плавно едет к курсору
    setCmp(cmpFromEvent(e));
    hideTip(cmpTip);
});

cmp.addEventListener('pointermove', (e) => {
    if (!cmpDrag) return;
    cmp.classList.remove('smooth');            // а при перетаскивании — сразу за пальцем
    setCmp(cmpFromEvent(e));
});

const cmpEnd = () => {
    cmpDrag = false;
    cmp.classList.remove('dragging');
};
cmp.addEventListener('pointerup', cmpEnd);
cmp.addEventListener('pointercancel', cmpEnd);

// При входе ползунок сам «покачивается», чтобы было понятно, что его можно двигать
function cmpIntro() {
    cancelAnimationFrame(cmpRaf);
    cmp.classList.remove('smooth');
    setCmp(50);
    const keys = [[0, 50], [800, 32], [1700, 68], [2500, 50]];
    const start = performance.now() + 1400;
    const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const frame = (now) => {
        const t = now - start;
        if (t >= 0) {
            let k = 1;
            while (k < keys.length - 1 && t > keys[k][0]) k++;
            const [t0, p0] = keys[k - 1];
            const [t1, p1] = keys[k];
            const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
            setCmp(p0 + (p1 - p0) * ease(f));
            if (t >= keys[keys.length - 1][0]) { showTip(cmpTip); return; }
        }
        cmpRaf = requestAnimationFrame(frame);
    };
    cmpRaf = requestAnimationFrame(frame);
}

// ===== 4. БОГИ ОЛИМПА =====
const GODS = [
    { name: 'Зевс',     role: 'Верховный бог',          emoji: '⚡', img: 'god_zeus.jpg',     symbol: 'Молния и орёл',
      text: 'Царь богов и людей, повелитель неба, грома и молний. Жил на вершине горы Олимп.' },
    { name: 'Гера',     role: 'Царица богов',           emoji: '👑', img: 'god_hera.jpg',     symbol: 'Павлин и диадема',
      text: 'Жена Зевса, покровительница брака, семьи и рождения детей.' },
    { name: 'Посейдон', role: 'Бог морей',              emoji: '🔱', img: 'god_poseidon.jpg', symbol: 'Трезубец',
      text: 'Брат Зевса, владыка морей. Ударом трезубца вызывал бури и землетрясения.' },
    { name: 'Афина',    role: 'Богиня мудрости',        emoji: '🦉', img: 'god_athena.jpg',   symbol: 'Сова и оливковая ветвь',
      text: 'Богиня мудрости, ремёсел и справедливой войны. Покровительница Афин — город назван в её честь.' },
    { name: 'Аполлон',  role: 'Бог света и искусств',   emoji: '☀️', img: 'god_apollo.jpg',   symbol: 'Лира и лавровый венок',
      text: 'Покровитель музыки, поэзии и врачевания. В Дельфах находилось его святилище с оракулом.' },
    { name: 'Артемида', role: 'Богиня охоты',           emoji: '🏹', img: 'god_artemis.jpg',  symbol: 'Лук, стрелы и лань',
      text: 'Сестра-близнец Аполлона, покровительница охоты, лесов и диких животных.' },
    { name: 'Арес',     role: 'Бог войны',              emoji: '⚔️', img: 'god_ares.jpg',     symbol: 'Копьё и шлем',
      text: 'Бог жестокой, яростной войны. Греки почитали его меньше, чем мудрую Афину.' },
    { name: 'Гермес',   role: 'Вестник богов',          emoji: '🪶', img: 'god_hermes.jpg',   symbol: 'Крылатые сандалии и жезл',
      text: 'Посланник Олимпа, покровитель путешественников, торговли и хитрости.' }
];

const godsBox = $('gods');
GODS.forEach((g, i) => {
    const card = document.createElement('div');
    card.className = 'god reveal';
    card.style.setProperty('--i', 2 + i * 0.5);
    card.tabIndex = 0;
    card.innerHTML = `
        <div class="god-inner">
            <div class="god-front">
                <img alt="">
                <span class="god-emoji">${g.emoji}</span>
                <div class="god-name"><b>${g.name}</b><span>${g.role}</span></div>
            </div>
            <div class="god-back">
                <span class="god-emoji">${g.emoji}</span>
                <b>${g.name}</b>
                <p>${g.text}</p>
                <span class="god-symbol">Символ: ${g.symbol}</span>
            </div>
        </div>`;
    const img = card.querySelector('img');
    img.onload = () => card.classList.add('has-img');
    img.src = PHOTOS + g.img;
    card.addEventListener('click', () => { if (isTouch) card.classList.toggle('flipped'); });
    godsBox.appendChild(card);
});

// Лента богов: колесо мыши листает вбок (плавно), ползунок сверху показывает, где мы
const godsBar = $('godsBar');
const godsThumb = $('godsThumb');
let godsTarget = 0;
let godsRaf = 0;

function godsMax() { return godsBox.scrollWidth - godsBox.clientWidth; }

function godsScrollTo(x) {
    godsTarget = Math.max(0, Math.min(godsMax(), x));
    if (godsRaf) return;
    const step = () => {
        const d = godsTarget - godsBox.scrollLeft;
        if (Math.abs(d) < 0.5) { godsBox.scrollLeft = godsTarget; godsRaf = 0; return; }
        godsBox.scrollLeft += d * 0.18;
        godsRaf = requestAnimationFrame(step);
    };
    godsRaf = requestAnimationFrame(step);
}

godsBox.addEventListener('wheel', (e) => {
    const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (godsMax() <= 0) return;
    e.preventDefault();
    if (!godsRaf) godsTarget = godsBox.scrollLeft;
    godsScrollTo(godsTarget + delta * 1.2);
}, { passive: false });

function updateGodsBar() {
    const max = godsMax();
    godsBar.style.visibility = max > 1 ? 'visible' : 'hidden';
    const part = godsBox.clientWidth / godsBox.scrollWidth;
    const w = godsBar.clientWidth * part;
    godsThumb.style.width = w + 'px';
    godsThumb.style.transform = `translateX(${max > 0 ? godsBox.scrollLeft / max * (godsBar.clientWidth - w) : 0}px)`;
}

godsBox.addEventListener('scroll', updateGodsBar);
new ResizeObserver(updateGodsBar).observe(godsBox);

// ползунок можно тянуть или нажать в любое место полоски
let godsDrag = null;
godsBar.addEventListener('pointerdown', (e) => {
    const r = godsBar.getBoundingClientRect();
    const w = godsThumb.offsetWidth;
    const thumbLeft = r.left + new DOMMatrix(getComputedStyle(godsThumb).transform).m41;
    const grabOffset = e.target === godsThumb ? e.clientX - thumbLeft : w / 2;
    godsDrag = { r, w, grabOffset };
    godsBar.setPointerCapture(e.pointerId);
    godsBar.classList.add('dragging');
    moveGodsDrag(e);
});

function moveGodsDrag(e) {
    if (!godsDrag) return;
    const { r, w, grabOffset } = godsDrag;
    const f = (e.clientX - r.left - grabOffset) / (r.width - w);
    godsScrollTo(Math.max(0, Math.min(1, f)) * godsMax());
}

godsBar.addEventListener('pointermove', moveGodsDrag);
const endGodsDrag = () => { godsDrag = null; godsBar.classList.remove('dragging'); };
godsBar.addEventListener('pointerup', endGodsDrag);
godsBar.addEventListener('pointercancel', endGodsDrag);

// ===== 5. АРХИТЕКТУРА =====
const ORDERS = [
    {
        name: 'Дорический ордер',
        text: 'Самый древний и строгий. У колонны нет базы — она стоит прямо на ступенях, а капитель похожа на простую каменную подушку с плитой сверху. В этом ордере построен Парфенон.',
        chips: ['Без базы', '20 желобков-каннелюр', 'Простая капитель']
    },
    {
        name: 'Ионический ордер',
        text: 'Стройнее и изящнее дорического. У колонны появляется база, а капитель украшают два завитка — волюты, похожие на свиток. Пример — храм Эрехтейон в Афинах.',
        chips: ['База из колец', '24 каннелюры', 'Волюты-завитки']
    },
    {
        name: 'Коринфский ордер',
        text: 'Самый пышный и поздний. Капитель похожа на корзину, обвитую листьями аканта. Этот ордер особенно полюбили римляне. Пример — храм Зевса Олимпийского в Афинах.',
        chips: ['Высокая база', '24 каннелюры', 'Листья аканта']
    }
];

const orderSwitch = $('orderSwitch');
const segButtons = [...orderSwitch.querySelectorAll('button')];
const segIndicator = orderSwitch.querySelector('.seg-indicator');
let order = 0;
let column = null;

function moveIndicator() {
    const b = segButtons[order];
    segIndicator.style.width = b.offsetWidth + 'px';
    segIndicator.style.transform = `translateX(${b.offsetLeft}px)`;
}

function fillOrder() {
    const o = ORDERS[order];
    $('archName').textContent = o.name;
    $('archDesc').textContent = o.text;
    $('archChips').innerHTML = o.chips.map(c => `<span class="chip">${c}</span>`).join('');
}

function setOrder(i) {
    if (i === order) return;
    order = i;
    segButtons.forEach((b, j) => b.classList.toggle('active', j === i));
    moveIndicator();
    swapContent($('archInfo'), fillOrder);
    if (column) column.setOrder(i);
}

segButtons.forEach((b, i) => b.addEventListener('click', () => setOrder(i)));
fillOrder();
addEventListener('resize', moveIndicator);
document.fonts?.ready.then(moveIndicator);

// ===== 6. ОЛИМПИЙСКИЕ ИГРЫ: цифры «набегают» от нуля =====
function countUp(el, delay) {
    cancelAnimationFrame(el._raf);
    const to = Number(el.dataset.to);
    const dur = 1800;
    const start = performance.now() + delay;
    el.textContent = '0';
    const step = (now) => {
        const t = Math.min(1, Math.max(0, (now - start) / dur));
        const e = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
        el.textContent = Math.round(to * e);
        if (t < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
}

// ===== 7. НАСЛЕДИЕ =====
const ALPHABET = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ';
let alphaTimer = null;
let alphaIndex = 0;

// светлое пятно за курсором
document.querySelectorAll('.tile').forEach(tile => {
    tile.addEventListener('pointermove', (e) => {
        const r = tile.getBoundingClientRect();
        tile.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        tile.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
});

// ===== 8. ВИКТОРИНА =====
const QUIZ = [
    {
        q: 'В каком году прошли первые Олимпийские игры?',
        options: ['476 г. до н. э.', '776 г. до н. э.', '1896 г.', '146 г. до н. э.'], answer: 1,
        explain: 'Первые игры прошли в Олимпии в 776 г. до н. э.'
    },
    {
        q: 'Кто был верховным богом Олимпа?',
        options: ['Посейдон', 'Аполлон', 'Зевс', 'Гермес'], answer: 2,
        explain: 'Зевс — царь богов, повелитель грома и молний.'
    },
    {
        q: 'Как называлось устройство Афин, при котором законы принимал народ?',
        options: ['Демократия', 'Монархия', 'Тирания', 'Олигархия'], answer: 0,
        explain: '«Демократия» по-гречески значит «власть народа».'
    },
    {
        q: 'У какого ордера капитель украшена листьями аканта?',
        options: ['Дорический', 'Ионический', 'Тосканский', 'Коринфский'], answer: 3,
        explain: 'Коринфская капитель похожа на корзину из листьев аканта.'
    },
    {
        q: 'Какой полис славился лучшими воинами Греции?',
        options: ['Афины', 'Спарта', 'Коринф', 'Дельфы'], answer: 1,
        explain: 'Спартанских мальчиков с 7 лет воспитывали как воинов.'
    }
];

const quizMain = $('quizMain');
const quizResult = $('quizResult');
const quizOptions = $('quizOptions');
const quizNextWrap = $('quizNextWrap');
let qIndex = 0;
let qScore = 0;

function renderQuestion() {
    const q = QUIZ[qIndex];
    $('quizCounter').textContent = `Вопрос ${qIndex + 1} из ${QUIZ.length}`;
    $('quizBar').style.width = `${qIndex / QUIZ.length * 100}%`;
    $('quizQ').textContent = q.q;
    $('quizFeedback').textContent = '';
    quizNextWrap.classList.remove('show');
    quizOptions.innerHTML = '';
    q.options.forEach((text, i) => {
        const b = document.createElement('button');
        b.className = 'quiz-opt';
        b.innerHTML = `<span class="letter">${'АБВГ'[i]}</span><span></span>`;
        b.lastChild.textContent = text;
        b.addEventListener('click', () => answerQuestion(i));
        quizOptions.appendChild(b);
    });
}

function answerQuestion(i) {
    const q = QUIZ[qIndex];
    const buttons = [...quizOptions.children];
    const right = i === q.answer;
    if (right) qScore++;
    buttons.forEach((b, j) => {
        b.disabled = true;
        if (j === q.answer) b.classList.add('correct');
        else if (j === i) b.classList.add('wrong');
        else b.classList.add('dim');
    });
    $('quizFeedback').innerHTML = `<b class="${right ? 'ok' : 'bad'}">${right ? 'Верно!' : 'Неверно.'}</b> ${q.explain}`;
    $('quizBar').style.width = `${(qIndex + 1) / QUIZ.length * 100}%`;
    $('quizNext').textContent = qIndex === QUIZ.length - 1 ? 'Узнать результат' : 'Следующий вопрос';
    quizNextWrap.classList.add('show');
}

function showResult() {
    quizMain.hidden = true;
    quizResult.hidden = false;
    $('quizScore').textContent = `${qScore} из ${QUIZ.length}`;
    $('quizResultTitle').textContent =
        qScore === QUIZ.length ? 'Великолепно! Вы настоящие знатоки Древней Греции 🏛️'
        : qScore >= 3 ? 'Отличный результат! 👏'
        : 'Неплохо — есть повод перечитать параграф 😉';
}

$('quizNext').addEventListener('click', () => {
    if (qIndex < QUIZ.length - 1) {
        qIndex++;
        swapContent(quizMain, renderQuestion);
    } else {
        showResult();
    }
});

$('quizRestart').addEventListener('click', () => {
    qIndex = 0;
    qScore = 0;
    quizResult.hidden = true;
    quizMain.hidden = false;
    renderQuestion();
});

renderQuestion();

// ===== 8. МУЗЫКА: плеер «Эпитафии Сейкила» =====
const audio = $('audio');
const player = $('player');
const playBtn = $('playBtn');
const playerBar = $('playerBar');
const waveCanvas = $('playerWave');
const waveCtx = waveCanvas.getContext('2d');
const BARS = 42;
const barLevels = new Array(BARS).fill(0.08);
let audioCtx = null;
let analyser = null;
let freqData = null;
let waveRaf = 0;

// Настоящий анализ звука работает только на сайте (http/https).
// Если открыть файл прямо с компьютера, браузер его запрещает — тогда волна просто «танцует» сама.
const canAnalyse = location.protocol.startsWith('http') && 'AudioContext' in window;

const fmtTime = (s) => {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

function setupAnalyser() {
    if (audioCtx || !canAnalyse) return;
    audioCtx = new AudioContext();
    const source = audioCtx.createMediaElementSource(audio);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
}

playBtn.addEventListener('click', () => {
    if (audio.paused) {
        setupAnalyser();
        if (audioCtx) audioCtx.resume();
        if (audio.readyState === 0) audio.load();   // браузер ещё не начал грузить — подтолкнём
        audio.play().catch((err) => console.warn('audio', err));
    } else {
        audio.pause();
    }
});

audio.addEventListener('play', () => player.classList.add('playing'));
audio.addEventListener('pause', () => player.classList.remove('playing'));
audio.addEventListener('ended', () => { player.classList.remove('playing'); audio.currentTime = 0; });
const showDuration = () => { $('timeDur').textContent = fmtTime(audio.duration); };
audio.addEventListener('durationchange', showDuration);
if (audio.readyState >= 1) showDuration();   // файл мог загрузиться ещё до запуска скрипта
audio.addEventListener('timeupdate', () => {
    $('timeCur').textContent = fmtTime(audio.currentTime);
    $('playerProgress').style.width = (audio.duration ? audio.currentTime / audio.duration * 100 : 0) + '%';
});

// если звук не загрузился — кнопка просто становится неактивной
audio.addEventListener('error', () => {
    console.warn('audio', audio.error);
    playBtn.disabled = true;
});
audio.addEventListener('canplay', () => { playBtn.disabled = false; });
if (audio.error) playBtn.disabled = true;   // ошибка могла случиться ещё до запуска скрипта

// перемотка: нажать или потянуть полоску
let seeking = false;
function seek(e) {
    if (!audio.duration) return;
    const r = playerBar.getBoundingClientRect();
    audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
}
playerBar.addEventListener('pointerdown', (e) => { seeking = true; playerBar.setPointerCapture(e.pointerId); seek(e); });
playerBar.addEventListener('pointermove', (e) => { if (seeking) seek(e); });
playerBar.addEventListener('pointerup', () => { seeking = false; });
playerBar.addEventListener('pointercancel', () => { seeking = false; });

// звуковая волна: золотые закруглённые столбики
function drawWave(now) {
    waveRaf = requestAnimationFrame(drawWave);
    const dpr = Math.min(devicePixelRatio, 2);
    const w = waveCanvas.clientWidth;
    const h = waveCanvas.clientHeight;
    if (waveCanvas.width !== Math.round(w * dpr)) {
        waveCanvas.width = Math.round(w * dpr);
        waveCanvas.height = Math.round(h * dpr);
    }
    waveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    waveCtx.clearRect(0, 0, w, h);

    const playing = !audio.paused;
    if (playing && analyser) analyser.getByteFrequencyData(freqData);
    const t = now / 1000;

    const gap = 3;
    const bw = (w - gap * (BARS - 1)) / BARS;
    const grad = waveCtx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#f2c94c');
    grad.addColorStop(0.5, '#ffe9a8');
    grad.addColorStop(1, '#f2c94c');
    waveCtx.fillStyle = grad;

    for (let i = 0; i < BARS; i++) {
        // симметрично от центра: низкие частоты посередине
        const k = Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2);
        let target;
        if (playing && analyser) {
            // музыка в основном в низких частотах — растягиваем их на все столбики
            const bin = Math.floor(Math.pow(k, 1.5) * freqData.length * 0.35);
            target = 0.08 + (freqData[bin] / 255) * 0.92;
        } else if (playing) {
            target = 0.15 + 0.55 * (1 - k * 0.6) * Math.abs(Math.sin(t * 3 + i * 0.6) * Math.sin(t * 1.7 + i * 0.23));
        } else {
            target = 0.08 + 0.05 * (Math.sin(t * 1.5 + i * 0.35) + 1) / 2;   // тихое «дыхание»
        }
        barLevels[i] += (target - barLevels[i]) * 0.2;
        const bh = Math.max(4, barLevels[i] * h);
        const x = i * (bw + gap);
        const y = (h - bh) / 2;
        waveCtx.globalAlpha = playing ? 1 : 0.45;
        waveCtx.beginPath();
        if (waveCtx.roundRect) waveCtx.roundRect(x, y, bw, bh, bw / 2);
        else waveCtx.rect(x, y, bw, bh);
        waveCtx.fill();
    }
}

// ===== 10. ФИНАЛ: произношение «Ευχαριστώ» =====
// Кнопка появляется, только если в браузере есть греческий голос (обычно есть в Microsoft Edge)
const speakBtn = $('speakBtn');
let greekVoice = null;

function findGreekVoice() {
    if (!('speechSynthesis' in window)) return;
    greekVoice = speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith('el')) || null;
    speakBtn.hidden = !greekVoice;
}

if ('speechSynthesis' in window) {
    findGreekVoice();
    speechSynthesis.addEventListener('voiceschanged', findGreekVoice);
}

speakBtn.addEventListener('click', () => {
    if (!greekVoice) return;
    speechSynthesis.cancel();
    const say = new SpeechSynthesisUtterance('Ευχαριστώ');
    say.voice = greekVoice;
    say.lang = greekVoice.lang;
    say.rate = 0.8;
    say.onstart = () => speakBtn.classList.add('speaking');
    say.onend = say.onerror = () => speakBtn.classList.remove('speaking');
    speechSynthesis.speak(say);
});

// ===== ЧТО ДЕЛАТЬ ПРИ ВХОДЕ НА СЛАЙД И УХОДЕ С НЕГО =====
const hooks = {
    hero: {
        enter() { if (globe) globe.resumeAnimation(); },
        // глобус крутится только на первом слайде — так меньше нагрузка
        leave() { afterLeave('hero', () => globe && globe.pauseAnimation()); }
    },
    gods: {
        enter: updateGodsBar
    },
    music: {
        enter() {
            cancelAnimationFrame(waveRaf);
            waveRaf = requestAnimationFrame(drawWave);
        },
        // уходим со слайда — музыка останавливается
        leave() {
            audio.pause();
            afterLeave('music', () => cancelAnimationFrame(waveRaf));
        }
    },
    compare: {
        enter: cmpIntro,
        leave() { afterLeave('compare', () => { cancelAnimationFrame(cmpRaf); setCmp(50); }); }
    },
    arch: {
        enter() {
            moveIndicator();
            if (!column && window.createColumn3D) column = window.createColumn3D($('column3d'), order);
            if (column) column.start();
        },
        leave() { afterLeave('arch', () => column && column.stop()); }
    },
    olymp: {
        enter() {
            document.querySelectorAll('.stat-num').forEach((el, i) => countUp(el, 700 + i * 150));
        }
    },
    legacy: {
        enter() {
            clearInterval(alphaTimer);
            alphaTimer = setInterval(() => {
                alphaIndex = (alphaIndex + 1) % ALPHABET.length;
                swapText($('alphaLetter'), ALPHABET[alphaIndex]);
            }, 1300);
        },
        leave() { clearInterval(alphaTimer); }
    }
};

goTo(0);
initGlobe();
