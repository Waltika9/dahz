/* ============================================================
   Space Simulator 🌏 — s_sim.js
   Главный файл: связывает физику, отрисовку и звук с интерфейсом.
   Мышь и касания, меню создания тел, инспектор, сравнение,
   сценарии, управление временем, сообщения о событиях.
   ============================================================ */
'use strict';

(() => {
    const P = Physics;
    const T = P.TYPES;
    const cam = Render.cam;
    const $ = (id) => document.getElementById(id);
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const TAU = Math.PI * 2;
    const MOBILE_W = 760;

    // Скорость, которую даёт перетаскивание: 1 пиксель мира стрелки = 0.8 пикс/с
    const DRAG_K = 0.8;
    const SPEEDS = [0.1, 1, 2, 5, 10, 50];
    const STEP_TIME = P.YEAR / 73;        // кнопка «шаг» = 5 земных суток

    // ---------- Элементы страницы ----------
    const spaceEl = $('space');
    const overlayEl = $('overlay');
    const toolbar = $('toolbar');
    const catList = $('catList');
    const catMenu = $('catMenu');
    const inspector = $('inspector');
    const inspIcon = $('inspIcon');
    const inspName = $('inspName');
    const inspType = $('inspType');
    const inspDesc = $('inspDesc');
    const inspFacts = $('inspFacts');
    const inspTip = $('inspTip');
    const shipPad = $('shipPad');
    const massRange = $('massRange'), massVal = $('massVal');
    const radiusRange = $('radiusRange'), radiusVal = $('radiusVal');
    const tempRange = $('tempRange'), tempVal = $('tempVal');
    const followBtn = $('followBtn'), stopBtn = $('stopBtn'), engineBtn = $('engineBtn'), bhBtn = $('bhBtn'), deleteBtn = $('deleteBtn');
    const pauseBtn = $('pauseBtn'), stepBtn = $('stepBtn');
    const pauseBadge = $('pauseBadge'), modeHint = $('modeHint');
    const statBodies = $('statBodies'), statTime = $('statTime'), statLag = $('statLag');
    const compareModal = $('compareModal'), helpModal = $('helpModal');
    const logEl = $('log');
    const intro = $('intro'), introPlanet = $('introPlanet');

    // ---------- Что можно создать (категории меню) ----------
    const CATEGORIES = [
        {
            id: 'stars', name: 'Звёзды', items: [
                { type: 'yellow_dwarf', name: 'Жёлтый карлик', note: 'Звезда как наше Солнце' },
                { type: 'red_giant', name: 'Красный гигант', note: 'Огромная старая звезда' },
                { type: 'blue_giant', name: 'Голубой гигант', note: 'Очень горячая и яркая' },
                { type: 'neutron', name: 'Нейтронная звезда', note: 'Пульсар: крошечный, но тяжёлый' }
            ]
        },
        {
            id: 'planets', name: 'Планеты', items: [
                { type: 'earth', name: 'Землеподобная', note: 'Материки, океаны, облака' },
                { type: 'gas_giant', name: 'Газовый гигант', note: 'С кольцами, как Сатурн' },
                { type: 'ice_giant', name: 'Ледяной гигант', note: 'Как Уран и Нептун' },
                { type: 'volcanic', name: 'Вулканическая', note: 'Реки раскалённой лавы' },
                { type: 'moon', name: 'Спутник (луна)', note: 'Камень с кратерами' }
            ]
        },
        {
            id: 'blackholes', name: 'Чёрные дыры', items: [
                { type: 'black_hole', name: 'Звёздная', note: '8 масс Солнца' },
                { type: 'black_hole', name: 'Тяжёлая', note: '40 масс Солнца', opts: { mass: 40 * P.M_SUN } },
                { type: 'black_hole', name: 'Первичная', note: 'Масса Земли, размер с горошину', opts: { mass: 1 } }
            ]
        },
        {
            id: 'comets', name: 'Кометы', items: [
                { type: 'comet', name: 'Ледяная комета', note: 'Хвост всегда смотрит от звезды' },
                { type: 'comet', name: 'Большая комета', note: 'Крупное ядро, длинный хвост', opts: { radius: 3.4, mass: 1e-6 } }
            ]
        },
        {
            id: 'asteroids', name: 'Астероиды', items: [
                { type: 'asteroid', name: 'Астероид', note: 'Каменистый, неправильной формы' },
                { type: 'asteroid', name: 'Карликовая планета', note: 'Большой камень, как Церера', opts: { radius: 3.8, mass: 1.6e-4 } },
                { type: 'asteroid', name: 'Рой астероидов', note: 'Сразу 12 камней', swarm: true }
            ]
        },
        {
            id: 'tech', name: 'Техника', items: [
                { type: 'ship', name: 'Корабль', note: 'Управление: W A S D' },
                { type: 'satellite', name: 'Спутник', note: 'Сам держит круговую орбиту' }
            ]
        }
    ];
    CATEGORIES.forEach(c => c.items.forEach(it => { it.cat = c.id; }));

    // ---------- Состояние ----------
    const state = {
        world: P.createWorld(),
        paused: false,
        speed: 1,
        tool: 'select',
        spawnItem: CATEGORIES[1].items[0],
        openCat: null,
        selectedId: null,
        hoverId: null,
        compare: [],
        followId: null,
        showOrbits: true,
        showTrails: true,
        showLabels: true,
        showGrid: false,
        pixel: window.innerWidth < MOBILE_W ? 2 : 3,
        particles: [],
        effects: [],
        flash: 0,
        flashColor: '#ffffff',
        shake: 0,
        drag: null,
        preview: null,
        arrow: null,
        ghost: null,
        lag: 0,
        clock: 0,
        introOpen: true,
        pointer: null,
        spawnedTypes: new Set()
    };

    // Сохранённые настройки (только для этого браузера)
    const SETTINGS_KEY = 'ssim_settings';
    try {
        const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
        if (saved) {
            ['showOrbits', 'showTrails', 'showLabels', 'showGrid'].forEach(k => { if (typeof saved[k] === 'boolean') state[k] = saved[k]; });
            if ([2, 3, 4].includes(saved.pixel)) state.pixel = saved.pixel;
            if (saved.muted) Sound.setMuted(true);
        }
    } catch (e) { /* без сохранений */ }

    function saveSettings() {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify({
                showOrbits: state.showOrbits, showTrails: state.showTrails, showLabels: state.showLabels,
                showGrid: state.showGrid, pixel: state.pixel, muted: Sound.isMuted()
            }));
        } catch (e) { /* без сохранений */ }
    }

    const byId = (id) => (id == null ? null : state.world.bodies.find(b => b.id === id) || null);
    const selected = () => byId(state.selectedId);

    // ---------- Форматирование чисел ----------
    const nf = (x, d) => x.toLocaleString('ru-RU', { maximumFractionDigits: d });
    const SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
    function sci(x) {
        if (x === 0) return '0';
        let e = Math.floor(Math.log10(Math.abs(x)));
        let m = x / 10 ** e;
        if (Math.abs(m) >= 9.95) { m /= 10; e++; }
        return `${nf(m, 1)}·10${String(e).split('').map(c => SUP[c]).join('')}`;
    }
    function num(x) {
        const a = Math.abs(x);
        if (!isFinite(x)) return '∞';
        if (a === 0) return '0';
        if (a >= 1e7) return sci(x);
        if (a >= 100) return nf(Math.round(x), 0);
        if (a >= 10) return nf(x, 1);
        if (a >= 0.01) return nf(x, 2);
        return sci(x);
    }
    const fmt = {
        mass: (m) => (m >= 0.01 * P.M_SUN ? `${num(m / P.M_SUN)} M☉` : `${num(m)} M⊕`),
        speed: (v) => `${num(v * P.KM_S)} км/с`,
        dist: (d) => { const au = d / P.AU; return au < 0.01 ? `${num(au * 1.496e8)} км` : `${num(au)} а.е.`; },
        temp: (t) => `${num(Math.round(t))} K`,
        km: (r) => (r >= 1e7 ? `${num(r / 696000)} R☉` : r < 1 ? `${num(r * 1000)} м` : `${num(r)} км`),
        time(sec) {
            const d = sec / P.YEAR * 365.25;
            if (d < 365.25) return `${Math.floor(d)} ДН.`;
            const y = Math.floor(d / 365.25);
            return `${nf(y, 0)} Г. ${Math.floor(d - y * 365.25)} ДН.`;
        },
        period(sec) {
            const d = sec / P.YEAR * 365.25;
            if (d < 2) return `${num(d * 24)} ч`;
            if (d < 730) return `${num(d)} дн.`;
            return `${num(d / 365.25)} г.`;
        }
    };

    // ---------- Описания объектов ----------
    const DESC = {
        yellow_dwarf: 'Обычная звезда, как наше Солнце. Греет и освещает планеты вокруг.',
        red_giant: 'Старая раздувшаяся звезда. Огромная, но не очень плотная.',
        blue_giant: 'Очень горячая и яркая звезда. Живёт недолго — всего несколько миллионов лет.',
        neutron: 'Остаток взорвавшейся звезды. Чайная ложка её вещества весит как гора, а крутится она сотни раз в секунду.',
        black_hole: 'Гравитация настолько сильна, что даже свет не может вырваться из-за горизонта событий.',
        earth: 'Голубая планета с океанами и материками. Здесь живёт Waltika, поэтому она особенная.',
        gas_giant: 'Огромный шар из газа без твёрдой поверхности. Часто с кольцами из льда и камней.',
        ice_giant: 'Холодный гигант из воды, аммиака и метана. Говорят, внутри идут алмазные дожди.',
        volcanic: 'Молодая горячая планета, покрытая вулканами и реками лавы.',
        moon: 'Каменистый спутник с кратерами от древних ударов.',
        asteroid: 'Каменная глыба, оставшаяся со времён рождения планет.',
        comet: 'Ледяной «грязный снежок». У звезды лёд испаряется, и хвост сдувает звёздным ветром.',
        ship: 'Космический корабль со слабым ионным двигателем. Выдели и управляй: W/S — газ, A/D — поворот.',
        satellite: 'Искусственный спутник. Маленькими двигателями сам держит круговую орбиту.',
        red_dwarf: 'Бывшая планета: набрала столько массы, что в ней зажглись термоядерные реакции.',
        debris: 'Обломок, оставшийся после сильного удара.'
    };
    const DESC_BY_NAME = {
        'Солнце': 'Наша звезда. В ней поместился бы миллион Земель.',
        'Меркурий': 'Ближе всех к Солнцу. Днём +430°, ночью −180°.',
        'Венера': 'Самая горячая планета: облака из серной кислоты и +460° у поверхности.',
        'Земля': 'Голубая планета с океанами и материками. Здесь живёт Waltika, поэтому она особенная.',
        'Марс': 'Красный из-за ржавчины в песке. По нему ездят марсоходы.',
        'Юпитер': 'Самая большая планета. Большое красное пятно — шторм больше Земли.',
        'Сатурн': 'Такой лёгкий, что плавал бы в воде. Кольца — из льда и камней.',
        'Уран': 'Лежит на боку и катится по орбите, как мячик.',
        'Нептун': 'Самые сильные ветра в Солнечной системе — до 2000 км/ч.',
        'Комета Галлея': 'Прилетает раз в 76 лет. Следующий раз — в 2061 году.',
        'Татуин': 'Здесь два заката. Где-то тут вырос один известный джедай.'
    };
    const descOf = (b) => DESC_BY_NAME[b.name] || DESC[b.type] || DESC.asteroid;

    // ---------- Сообщения о событиях ----------
    function say(text, prio = 1) {
        const items = [...logEl.children].filter(el => !el.classList.contains('out'));
        if (items.some(el => el.dataset.text === text)) return;
        if (prio === 0 && items.length >= 2) return;           // мелочи не забивают экран
        const item = document.createElement('div');
        item.className = 'log-item frame';
        item.dataset.text = text;
        item.textContent = text;
        logEl.appendChild(item);
        const alive = [...logEl.children].filter(el => !el.classList.contains('out'));
        const maxItems = window.innerWidth <= MOBILE_W ? 2 : 3;
        while (alive.length > maxItems) hideLog(alive.shift());
        item.addEventListener('click', () => hideLog(item));
        setTimeout(() => hideLog(item), 4500 + text.length * 45);
        if (prio === 1) Sound.play('notify');      // у важных событий свои звуки
    }

    function hideLog(item) {
        if (!item.isConnected || item.classList.contains('out')) return;
        item.classList.add('out');
        setTimeout(() => item.remove(), 260);
    }

    function clearLog() { logEl.textContent = ''; }

    // ---------- Частицы и эффекты ----------
    const PAL = {
        fire: ['#ffffff', '#fff2a0', '#ffc040', '#ff7a1a', '#c8321a', '#5a1a14'],
        ice: ['#ffffff', '#d8f0ff', '#90c8ff', '#5a8ae0', '#2a3a80'],
        rock: ['#e8e0d8', '#b0a090', '#7a6a5a', '#4a3e34'],
        spark: ['#ffffff', '#e0e0e0', '#a0a0a0', '#606060'],
        purple: ['#ffffff', '#e0b0ff', '#a060ff', '#6020c0', '#300a60'],
        blue: ['#ffffff', '#c0e0ff', '#80b0ff', '#4060c0'],
        white: ['#ffffff', '#d0d0d0', '#909090', '#505050']
    };

    function burst(x, y, n, pal, speed, life = 1, base = null) {
        const bvx = base ? base.vx : 0, bvy = base ? base.vy : 0;
        for (let i = 0; i < n && state.particles.length < 2600; i++) {
            const a = Math.random() * TAU;
            const sp = speed * (0.15 + Math.random());
            const l = life * (0.45 + Math.random() * 0.75);
            state.particles.push({
                x, y, bvx, bvy, kx: Math.cos(a) * sp, ky: Math.sin(a) * sp,
                life: l, max: l, c: pal, size: Math.random() < 0.2 ? 2 : 1
            });
        }
    }

    // Частицы, которые закручиваются в чёрную дыру
    function spiral(h, x, y, n, pal) {
        for (let i = 0; i < n && state.particles.length < 2600; i++) {
            const dx = x - h.x, dy = (y - h.y) / 0.3;
            const l = 1.2 + Math.random() * 1.5;
            state.particles.push({
                target: h, ang: Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.4,
                rad: Math.hypot(dx, dy) * (0.9 + Math.random() * 0.2) + Math.random() * 3,
                w: 1 + Math.random(), x, y, life: l, max: l, c: pal, size: 1
            });
        }
    }

    function ring(x, y, r0, r1, life, color, extra = {}) {
        state.effects.push({ kind: 'ring', x, y, r0, r1, life, max: life, color, ...extra });
    }

    function rippleFx(x, y, r1, amp, width, life) {
        if (state.effects.filter(e => e.kind === 'ripple').length >= 3) return;
        state.effects.push({ kind: 'ripple', x, y, r1, amp, width, life, max: life });
    }

    function flash(k, color = '#ffffff') {
        if (k >= state.flash) { state.flash = k; state.flashColor = color; }
    }

    function shake(k) { state.shake = Math.max(state.shake, k); }

    function updateParticles(dt) {
        const ps = state.particles;
        let w = 0;
        const decay = Math.exp(-dt * 1.4);
        for (let i = 0; i < ps.length; i++) {
            const p = ps[i];
            p.life -= dt;
            if (p.life <= 0) continue;
            if (p.target) {
                const h = p.target;
                if (!h.alive) continue;
                p.rad *= Math.max(0, 1 - dt * 1.5);
                p.ang += dt * p.w * Math.min(9, 2 * Math.sqrt(h.r * 4 / Math.max(p.rad, 1)));
                p.x = h.x + Math.cos(p.ang) * p.rad;
                p.y = h.y + Math.sin(p.ang) * p.rad * 0.3;
                if (p.rad < h.r * 1.05) continue;
            } else {
                p.x += (p.bvx + p.kx) * dt;
                p.y += (p.bvy + p.ky) * dt;
                p.kx *= decay; p.ky *= decay;
            }
            ps[w++] = p;
        }
        ps.length = w;

        const ef = state.effects;
        w = 0;
        for (let i = 0; i < ef.length; i++) {
            ef[i].life -= dt;
            if (ef[i].life > 0) ef[w++] = ef[i];
        }
        ef.length = w;
    }

    // ---------- События физики → звук, эффекты, сообщения ----------
    const majorKinds = new Set(['star', 'neutron', 'planet', 'bh']);

    // «Чёрная дыра» или «Чёрная дыра «Гаргантюа»» — без повтора, если имя стандартное
    const bhTitle = (h) => (h.name.startsWith(T.black_hole.short) ? `«${h.name}»` : `Чёрная дыра «${h.name}»`);

    function handleEvents(events) {
        for (const e of events) {
            const a = e.a, b = e.b;
            switch (e.type) {
                case 'merge': {
                    if (e.share > 0.08) {
                        ring(e.x, e.y, a.r, a.r * 4, 0.9, '#ffffff', { double: true });
                        burst(e.x, e.y, 50, PAL.fire, a.r * 4, 1.4, a);
                        shake(4);
                        Sound.play('merge');
                        if (majorKinds.has(a.kind) && majorKinds.has(b.kind)) {
                            say(`«${b.name}» и «${a.name}» столкнулись и слились в одно тело.` + (a.temp > 900 ? '\nУдар раскалил поверхность докрасна.' : ''), 2);
                        }
                    } else {
                        burst(e.x, e.y, Math.min(14, 4 + b.r * 2), PAL.rock, Math.max(4, b.r * 5), 0.8, a);
                        Sound.play('impact');
                        if (b.kind === 'planet') say(`«${b.name}» упал(а) на «${a.name}».`, 0);
                    }
                    break;
                }
                case 'burn':
                    burst(e.x, e.y, 16, PAL.fire, Math.max(6, b.r * 4), 1, a);
                    ring(e.x, e.y, b.r, b.r * 3, 0.6, '#ffc040');
                    Sound.play('burn');
                    if (b.kind === 'planet') say(`«${b.name}» сгорает в звезде «${a.name}».`, 1);
                    break;
                case 'starmerge':
                case 'kilonova':
                    flash(0.6);
                    ring(e.x, e.y, a.r, a.r * 8, 1.6, '#ffffff', { double: true });
                    burst(e.x, e.y, 120, PAL.fire, a.r * 5, 2, a);
                    rippleFx(e.x, e.y, a.r * 14, 4, a.r * 0.8, 1.6);
                    shake(9);
                    Sound.play(e.type === 'kilonova' ? 'collapse' : 'explode');
                    say(e.type === 'kilonova'
                        ? 'Две нейтронные звезды столкнулись — это килоновая.\nВ таких взрывах во Вселенной рождается золото.'
                        : `Звёзды «${a.name}» и «${b.name}» слились в одну.\nНовая звезда тяжелее, горячее и ярче.`, 2);
                    break;
                case 'shatter':
                    burst(e.x, e.y, 40, PAL.rock, a.r * 3, 1.6, a);
                    burst(e.x, e.y, 30, PAL.fire, a.r * 3, 1, a);
                    ring(e.x, e.y, b.r, b.r * 5, 0.8, '#ffffff');
                    shake(6);
                    Sound.play('explode');
                    if (majorKinds.has(b.kind)) say(`Удар разнёс «${b.name}» на ${e.count} обломков.`, 2);
                    break;
                case 'absorb': {
                    const pal = b.kind === 'star' || b.kind === 'neutron' ? PAL.fire : b.type === 'comet' || b.look === 'ice_giant' ? PAL.ice : PAL.purple;
                    spiral(a, e.x, e.y, Math.min(60, 10 + b.r * 3), pal);
                    if (b.m > 1e-3 || b.kind === 'craft') {
                        rippleFx(a.x, a.y, a.r * 10, 3, a.r * 0.8, 1.2);
                        Sound.play('absorb');
                    } else Sound.play('impact');
                    if (b.kind === 'craft') say(`«${b.name}» пересёк горизонт событий. Связь потеряна.`, 2);
                    else if (majorKinds.has(b.kind) && !b.debris) say(`${bhTitle(a)} поглощает «${b.name}».\nОттуда не возвращаются.`, 2);
                    break;
                }
                case 'bhmerge':
                    flash(0.35, '#e0c8ff');
                    rippleFx(e.x, e.y, 2500 / Math.max(0.05, cam.zoom), 7, 50 / Math.max(0.05, cam.zoom), 3);
                    shake(12);
                    Sound.play('chirp');
                    say(`Чёрные дыры слились в одну — пространство дрожит.\nГравитационные волны унесли ${fmt.mass(e.lost)} массы.`, 3);
                    break;
                case 'tobh':
                    if (e.reason === 'supernova') {
                        flash(1);
                        ring(e.x, e.y, a.r, a.r * 30, 2.4, '#ffffff', { double: true });
                        burst(e.x, e.y, 220, PAL.fire, a.r * 40, 2.6, a);
                        rippleFx(e.x, e.y, a.r * 60, 6, a.r * 3, 2.5);
                        shake(16);
                        Sound.play('collapse');
                        say(`«${a.name}» не выдержала собственной тяжести.\nВзрыв сверхновой! На этом месте теперь чёрная дыра.`, 3);
                    } else if (e.reason === 'neutron') {
                        flash(0.5, '#c8d8ff');
                        burst(e.x, e.y, 80, PAL.blue, 60, 1.6, a);
                        rippleFx(e.x, e.y, 300, 5, 12, 1.6);
                        shake(10);
                        Sound.play('collapse');
                        say(`Нейтронная звезда «${a.name}» стала тяжелее 2,5 M☉\nи схлопнулась в чёрную дыру.`, 3);
                    } else {
                        burst(e.x, e.y, 60, PAL.purple, Math.max(10, a.r * 6), 1.4, a);
                        rippleFx(e.x, e.y, Math.max(80, a.r * 12), 4, Math.max(6, a.r), 1.4);
                        shake(6);
                        Sound.play('absorb');
                        say(`«${a.name}» сжалась в чёрную дыру.\nМасса та же — поэтому вдали притяжение не изменилось.`, 2);
                    }
                    break;
                case 'ignite':
                    flash(0.4, '#ffd0a0');
                    ring(e.x, e.y, a.r, a.r * 6, 1.4, '#ffb060', { double: true });
                    burst(e.x, e.y, 60, PAL.fire, a.r * 4, 1.6, a);
                    Sound.play('ignite');
                    say(`«${a.name}» набрала столько массы, что в недрах зажглись термоядерные реакции.\nТеперь это звезда — красный карлик.`, 3);
                    break;
                case 'crash':
                    burst(e.x, e.y, 28, PAL.fire, 18, 1.1, b && b.alive ? b : a);
                    Sound.play('crash');
                    say(`«${a.name}» разбился вдребезги.`, 1);
                    break;
            }
            // выбор переходит к выжившему телу
            if (b && !b.alive) {
                if (state.selectedId === b.id) select(a && a.alive ? a.id : null);
                if (state.followId === b.id) state.followId = a && a.alive ? a.id : null;
            }
            if (a && state.selectedId === a.id && !inspector.hidden) refreshInspector(true);
        }
        if (state.compare.length) {
            const before = state.compare.length;
            state.compare = state.compare.filter(id => byId(id));
            if (state.compare.length !== before && !compareModal.hidden) closeModal(compareModal);
        }
    }

    // ---------- Камера ----------
    function fitView(radius) {
        cam.zoom = clamp(Math.min(window.innerWidth, window.innerHeight) * 0.42 / radius, 0.015, 60);
    }

    function zoomAt(cx, cy, factor) {
        const before = Render.toWorld(cx, cy);
        cam.zoom = clamp(cam.zoom * factor, 0.015, 60);
        if (state.followId) return;
        const after = Render.toWorld(cx, cy);
        cam.x += before.x - after.x;
        cam.y += before.y - after.y;
    }

    // ---------- Сценарии ----------
    // Круговая орбита вокруг тела center на расстоянии r под углом ang (против часовой)
    function orbitAround(center, r, ang, M = center.m, dir = -1) {
        const v = Math.sqrt(P.G * M / r);
        return {
            x: center.x + Math.cos(ang) * r,
            y: center.y + Math.sin(ang) * r,
            vx: center.vx + dir * -Math.sin(ang) * v,
            vy: center.vy + dir * Math.cos(ang) * v
        };
    }

    // Общий импульс = 0, чтобы система не уплывала
    function zeroMomentum(w) {
        let M = 0, px = 0, py = 0;
        for (const b of w.bodies) { M += b.m; px += b.m * b.vx; py += b.m * b.vy; }
        if (!M) return;
        for (const b of w.bodies) { b.vx -= px / M; b.vy -= py / M; }
    }

    const rnd = (a, b) => a + Math.random() * (b - a);

    const SOLAR = [
        // имя, вид, внешний вид, расстояние (а.е.), масса (M⊕), размер, температура, реальный радиус (км), кольца
        ['Меркурий', 'moon', 'mercury', 0.387, 0.055, 4, 440, 2440, false],
        ['Венера', 'earth', 'earth', 0.723, 0.815, 7.5, 737, 6052, false],
        ['Земля', 'earth', 'earth', 1, 1, 8, 288, 6371, false],
        ['Марс', 'earth', 'mars', 1.524, 0.107, 5.5, 210, 3390, false],
        ['Юпитер', 'gas_giant', 'jupiter', 5.2, 317.8, 21, 165, 69911, false],
        ['Сатурн', 'gas_giant', 'saturn', 9.54, 95.2, 17, 134, 58232, true],
        ['Уран', 'ice_giant', 'uranus', 19.2, 14.5, 12, 76, 25362, false],
        ['Нептун', 'ice_giant', 'neptune', 30.1, 17.1, 12, 72, 24622, false]
    ];

    const SOLAR_LINES = [
        'Солнечная система. Массы планет — как в реальности,\nа расстояния сжаты, чтобы всё поместилось на экран.',
        'Колёсико мыши — приблизить или отдалить.\nКлик по планете откроет инспектор.'
    ];

    // Расстояния сжаты (корень из настоящего), чтобы всё поместилось на экран
    const auToPx = (au) => P.AU * Math.sqrt(au);

    function addPlanets(w, sun, list, fixedAngles = {}) {
        const out = {};
        for (const [name, type, look, au, mass, radius, temp, realR, rings] of list) {
            const ang = fixedAngles[name] ?? Math.random() * TAU;
            const o = orbitAround(sun, auToPx(au), ang, sun.m + mass);
            out[name] = P.createBody(w, type, o.x, o.y, o.vx, o.vy, {
                name, look, mass, radius, temp, realR, rings, ringAngle: -0.38, seed: 1000 + name.length * 31 + Math.round(au * 10)
            });
        }
        return out;
    }

    const PRESETS = {
        solar() {
            const w = P.createWorld();
            const sun = P.createBody(w, 'yellow_dwarf', 0, 0, 0, 0, { name: 'Солнце', seed: 11 });
            addPlanets(w, sun, SOLAR);
            // пояс астероидов между Марсом и Юпитером
            for (let i = 0; i < 36; i++) {
                const o = orbitAround(sun, auToPx(rnd(2.2, 3.3)), Math.random() * TAU);
                P.createBody(w, 'asteroid', o.x, o.y, o.vx * rnd(0.98, 1.02), o.vy * rnd(0.98, 1.02), {
                    mass: rnd(2e-6, 2e-5), radius: rnd(1.5, 2.6), name: `Астероид ${i + 1}`
                });
            }
            // комета Галлея летит в обратную сторону (ретроградно) по вытянутой орбите
            const rp = 120, ra = 1300, a = (rp + ra) / 2;
            const ang = Math.random() * TAU;
            const vp = Math.sqrt(P.G * sun.m * (2 / rp - 1 / a));
            P.createBody(w, 'comet', Math.cos(ang) * rp, Math.sin(ang) * rp, -Math.sin(ang) * vp, Math.cos(ang) * vp, {
                name: 'Комета Галлея'
            });
            zeroMomentum(w);
            return { world: w, view: 300, lines: SOLAR_LINES };
        },
        binary() {
            const w = P.createWorld();
            const mA = 1.1 * P.M_SUN, mB = 0.9 * P.M_SUN, M = mA + mB, d = 150;
            const om = Math.sqrt(P.G * M / d ** 3);
            const r1 = d * mB / M, r2 = d * mA / M;
            P.createBody(w, 'yellow_dwarf', -r1, 0, 0, om * r1, { name: 'Альфа A', mass: mA, radius: 26, temp: 6000, seed: 5 });
            P.createBody(w, 'yellow_dwarf', r2, 0, 0, -om * r2, { name: 'Альфа B', mass: mB, radius: 22, temp: 4500, seed: 8, realR: 600000 });
            const center = { x: 0, y: 0, vx: 0, vy: 0, m: M };
            const add = (type, name, r, opts) => {
                const o = orbitAround(center, r, Math.random() * TAU);
                return P.createBody(w, type, o.x, o.y, o.vx, o.vy, { name, ...opts });
            };
            add('earth', 'Татуин', 430, { look: 'desert', radius: 7, temp: 320, seed: 4040 });
            add('volcanic', 'Хаос', 235, { seed: 777 });
            add('ice_giant', 'Ледышка', 650, { look: 'uranus', seed: 9 });
            add('moon', 'Камешек', 520, { seed: 31 });
            for (let i = 0; i < 14; i++) {
                const o = orbitAround(center, rnd(760, 820), Math.random() * TAU);
                P.createBody(w, 'asteroid', o.x, o.y, o.vx, o.vy, { radius: rnd(1.5, 2.5), name: `Астероид ${i + 1}` });
            }
            zeroMomentum(w);
            return {
                world: w, view: 470,
                lines: [
                    'Двойная звезда, как Альфа Центавра.\nДве звезды кружатся вокруг общего центра масс.',
                    'Татуин летает далеко и спокойно.\nА планета «Хаос» слишком близко — следи за ней.'
                ]
            };
        },
        blackhole() {
            const w = P.createWorld();
            const sun = P.createBody(w, 'yellow_dwarf', 0, 0, 0, 0, { name: 'Солнце', seed: 11 });
            // положения подобраны так, чтобы дыра пролетела совсем рядом с Землёй, но мимо Солнца
            const pl = addPlanets(w, sun, SOLAR.slice(0, 5), { 'Меркурий': 2.4, 'Венера': 0.6, 'Земля': 1.8, 'Марс': 3.6, 'Юпитер': 0.9 });
            // блуждающая чёрная дыра летит со скоростью ~75 км/с
            P.createBody(w, 'black_hole', -1300, -330, 170, 0, { name: 'Гаргантюа', mass: 5 * P.M_SUN, seed: 3 });
            return {
                world: w, view: 560, follow: pl['Земля'],
                lines: [
                    'Блуждающая чёрная дыра массой 5 Солнц\nлетит к Солнечной системе.',
                    'Камера следит за Землёй. Как думаешь, что будет?\nПробел — пауза, чтобы рассмотреть.'
                ]
            };
        },
        chaos() {
            const w = P.createWorld();
            const starType = ['yellow_dwarf', 'yellow_dwarf', 'red_giant', 'blue_giant'][(Math.random() * 4) | 0];
            const star = P.createBody(w, starType, 0, 0, 0, 0);
            const types = ['earth', 'gas_giant', 'ice_giant', 'volcanic', 'moon', 'earth', 'gas_giant'];
            const nPlanets = 5 + ((Math.random() * 3) | 0);
            for (let i = 0; i < nPlanets; i++) {
                const type = types[(Math.random() * types.length) | 0];
                const r = rnd(star.r * 3.5, 720);
                const o = orbitAround(star, r, Math.random() * TAU, star.m, Math.random() < 0.2 ? 1 : -1);
                const k = rnd(0.65, 1.3);
                const ang = Math.atan2(o.y, o.x);
                const rad = rnd(-0.25, 0.25) * Math.hypot(o.vx, o.vy);
                P.createBody(w, type, o.x, o.y, o.vx * k + Math.cos(ang) * rad, o.vy * k + Math.sin(ang) * rad, {
                    look: type === 'earth' && Math.random() < 0.4 ? 'mars' : undefined
                });
            }
            const nSmall = 20 + ((Math.random() * 11) | 0);
            for (let i = 0; i < nSmall; i++) {
                const type = Math.random() < 0.72 ? 'asteroid' : 'comet';
                const r = rnd(star.r * 3, 900);
                const o = orbitAround(star, r, Math.random() * TAU, star.m, Math.random() < 0.3 ? 1 : -1);
                const k = rnd(0.35, 1.35);
                P.createBody(w, type, o.x, o.y, o.vx * k, o.vy * k, { radius: type === 'asteroid' ? rnd(1.6, 3.2) : undefined });
            }
            if (Math.random() < 0.3) {
                const o = orbitAround(star, rnd(900, 1100), Math.random() * TAU, star.m);
                P.createBody(w, 'black_hole', o.x, o.y, o.vx * 0.6, o.vy * 0.6, { mass: rnd(1, 3) * P.M_SUN });
            }
            zeroMomentum(w);
            return {
                world: w, view: 620,
                lines: ['Хаос: планеты, астероиды и кометы летят как попало.\nКто кого поглотит первым?']
            };
        },
        empty() {
            return {
                world: P.createWorld(), view: 300, empty: true,
                lines: ['Пустой космос.\nВыбери тело в меню «Создать» слева и кликни по экрану.']
            };
        }
    };

    function loadPreset(name, quiet = false) {
        const p = PRESETS[name]();
        state.world = p.world;
        state.selectedId = null;
        state.hoverId = null;
        state.compare = [];
        state.followId = p.follow ? p.follow.id : null;
        state.particles = [];
        state.effects = [];
        state.preview = null;
        state.arrow = null;
        state.drag = null;
        state.lag = 0;
        cam.x = p.follow ? p.follow.x : 0;
        cam.y = p.follow ? p.follow.y : 0;
        fitView(p.view);
        closeInspector();
        if (!compareModal.hidden) closeModal(compareModal);
        clearLog();
        if (p.empty) setTool('spawn', true);
        else if (state.tool === 'compare') setTool('select', true);
        if (!quiet) {
            p.lines.forEach((l, i) => setTimeout(() => say(l, 1), i * 700));
            flash(0.25);
            Sound.play('spawnBig');
        }
        updateHint();
        return p;
    }

    // ---------- Создание объектов ----------
    const SPAWN_TIPS = {
        black_hole: 'Всё, что коснётся горизонта событий, исчезнет навсегда.',
        neutron: 'Пульсар крутится и светит лучами, как маяк.\nВыдели его — услышишь, как он тикает.',
        ship: 'Выдели корабль и управляй им: W/S — газ, A/D — поворот.',
        satellite: 'Спутник сам держит круговую орбиту маленькими двигателями.',
        comet: 'Хвост кометы всегда направлен от звезды — его сдувает звёздный ветер.',
        red_giant: 'Красный гигант огромный, но совсем не плотный.',
        blue_giant: 'Голубой гигант в 12 раз тяжелее Солнца и намного горячее.'
    };

    function spawn(item, x, y, vx, vy) {
        const w = state.world;
        const count = item.swarm ? 12 : 1;
        if (w.bodies.length + count > P.MAX_BODIES) {
            Sound.play('error');
            say('В космосе слишком тесно. Удали что-нибудь.', 2);
            return null;
        }
        let b = null;
        if (item.swarm) {
            // рой: 12 камней вокруг точки с почти одинаковой скоростью
            const spread = 30 / Math.max(cam.zoom, 0.05);
            const sp = Math.hypot(vx, vy);
            for (let i = 0; i < count; i++) {
                const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * spread;
                b = P.createBody(w, 'asteroid', x + Math.cos(a) * d, y + Math.sin(a) * d,
                    vx + (Math.random() - 0.5) * sp * 0.06, vy + (Math.random() - 0.5) * sp * 0.06,
                    { radius: rnd(1.4, 2.6), mass: rnd(2e-6, 2e-5) });
            }
        } else {
            b = P.createBody(w, item.type, x, y, vx, vy, item.opts || {});
        }
        const big = b.kind === 'star' || b.kind === 'bh' || b.kind === 'neutron';
        ring(x, y, b.r, b.r * (big ? 5 : 3), 0.7, '#ffffff', { double: big });
        burst(x, y, big ? 30 : 12, PAL.spark, Math.max(8, b.r * 3), 0.8, b);
        if (b.kind === 'bh') rippleFx(x, y, b.r * 14, 4, b.r, 1.3);
        Sound.play(big ? 'spawnBig' : 'spawn');
        if (!state.spawnedTypes.has(item.type)) {
            state.spawnedTypes.add(item.type);
            if (SPAWN_TIPS[item.type]) say(SPAWN_TIPS[item.type], 1);
        }
        return b;
    }

    function makeGhost(item) {
        const t = T[item.type];
        const o = item.opts || {};
        const m = o.mass ?? t.mass;
        return {
            id: -2, type: item.type, kind: t.kind, look: item.type, name: '', x: 1e9, y: 1e9, vx: 0, vy: 0,
            m, r: t.kind === 'bh' ? P.bhRadius(m) : (o.radius ?? t.radius), temp: t.temp, baseTemp: t.temp,
            seed: 777, rot: 0, spin: t.spin, rings: !!t.rings, ringAngle: -0.3, heading: -0.5,
            thrusting: 0, trail: [], nearBH: 0, stripped: 0, feed: 0, tint: null, debris: false
        };
    }

    // Скорость нового объекта по перетаскиванию
    function spawnVelocity(d) {
        const w = state.world;
        const cur = Render.toWorld(d.cx, d.cy);
        const circ = P.circularVelocity(w, d.wx, d.wy);
        const dragCss = Math.hypot(d.cx - d.sx, d.cy - d.sy);
        if (dragCss < 6) {
            return circ ? { vx: circ.vx, vy: circ.vy, auto: true, circ } : { vx: 0, vy: 0, auto: true, circ: null };
        }
        const bvx = circ ? circ.att.vx : 0, bvy = circ ? circ.att.vy : 0;
        let rvx = (cur.x - d.wx) * DRAG_K, rvy = (cur.y - d.wy) * DRAG_K;
        let snapped = false;
        if (circ) {
            const cvx = circ.vx - bvx, cvy = circ.vy - bvy;
            const cv = Math.hypot(cvx, cvy);
            if (Math.hypot(rvx - cvx, rvy - cvy) < cv * 0.12) { rvx = cvx; rvy = cvy; snapped = true; }
            else if (Math.hypot(rvx + cvx, rvy + cvy) < cv * 0.12) { rvx = -cvx; rvy = -cvy; snapped = true; }
        }
        return { vx: bvx + rvx, vy: bvy + rvy, rvx, rvy, auto: false, snapped, circ };
    }

    // ---------- Меню «Создать» ----------
    function buildCategories() {
        catList.textContent = '';
        for (const c of CATEGORIES) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'px-btn cat';
            btn.dataset.cat = c.id;
            btn.innerHTML = `<span></span><svg class="ico" viewBox="0 0 7 7" aria-hidden="true"><path d="M2 0h1v1H2zM3 1h1v1H3zM4 2h1v1H4zM5 3h1v1H5zM4 4h1v1H4zM3 5h1v1H3zM2 6h1v1H2z"/></svg>`;
            btn.firstChild.textContent = c.name;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (state.openCat === c.id) closeCatMenu();
                else openCatMenu(c, btn);
                Sound.play('click');
            });
            catList.appendChild(btn);
        }
        markCategories();
    }

    function openCatMenu(c, btn) {
        closeDropdowns();
        state.openCat = c.id;
        catMenu.textContent = '';
        const title = document.createElement('div');
        title.className = 'menu-title';
        title.textContent = c.name.toUpperCase();
        catMenu.appendChild(title);
        for (const it of c.items) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'menu-item body-item' + (state.tool === 'spawn' && state.spawnItem === it ? ' active' : '');
            const icon = Render.makeIcon(it.type, 26, null, it.opts);
            const txt = document.createElement('span');
            txt.className = 'txt';
            const b = document.createElement('b');
            b.textContent = it.name;
            const n = document.createElement('span');
            n.textContent = it.note;
            txt.append(b, n);
            item.append(icon, txt);
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                state.spawnItem = it;
                closeCatMenu();
                setTool('spawn');
            });
            catMenu.appendChild(item);
        }
        catMenu.hidden = false;
        // на компьютере меню выезжает справа от панели, напротив кнопки
        if (window.innerWidth > MOBILE_W) {
            const tb = toolbar.getBoundingClientRect();
            const bb = btn.getBoundingClientRect();
            const h = catMenu.offsetHeight;
            catMenu.style.left = `${Math.round(tb.right + 14)}px`;
            catMenu.style.top = `${Math.round(clamp(bb.top - 10, 12, window.innerHeight - h - 12))}px`;
        } else {
            catMenu.style.left = '';
            catMenu.style.top = '';
        }
        markCategories();
    }

    function closeCatMenu() {
        state.openCat = null;
        catMenu.hidden = true;
        markCategories();
    }

    function markCategories() {
        catList.querySelectorAll('.cat').forEach(btn => {
            const cur = state.tool === 'spawn' && state.spawnItem.cat === btn.dataset.cat;
            btn.classList.toggle('active', state.openCat === btn.dataset.cat || cur);
        });
    }

    // ---------- Выпадающие меню сверху ----------
    function closeDropdowns(except = null) {
        document.querySelectorAll('.dropdown.open').forEach(d => { if (d !== except) d.classList.remove('open'); });
    }

    document.querySelectorAll('.dropdown [data-drop]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const d = btn.closest('.dropdown');
            closeCatMenu();
            closeDropdowns(d);
            d.classList.toggle('open');
            btn.classList.toggle('active', d.classList.contains('open'));
            Sound.play(d.classList.contains('open') ? 'open' : 'close');
        });
    });

    document.querySelectorAll('.drop-menu').forEach(m => m.addEventListener('click', (e) => e.stopPropagation()));
    document.addEventListener('click', () => {
        closeDropdowns();
        document.querySelectorAll('[data-drop].active').forEach(b => b.classList.remove('active'));
        if (state.openCat) closeCatMenu();
    });

    // Сценарии
    document.querySelectorAll('[data-preset]').forEach(btn => {
        btn.addEventListener('click', () => {
            closeDropdowns();
            document.querySelectorAll('[data-drop].active').forEach(b => b.classList.remove('active'));
            loadPreset(btn.dataset.preset);
            if (state.paused) togglePause();
        });
    });

    // ---------- Выбор и инспектор ----------
    let sliderBusy = false;

    function select(id) {
        if (state.selectedId === id) return;
        const prev = selected();
        if (prev && prev.input) { prev.input.thrust = 0; prev.input.turn = 0; }
        state.selectedId = id;
        if (id == null) { closeInspector(); return; }
        inspector.hidden = false;
        refreshInspector(true);
    }

    function closeInspector() {
        inspector.hidden = true;
        state.selectedId = null;
        Sound.engine(false);
    }

    function setFill(input) {
        const k = (input.value - input.min) / (input.max - input.min) * 100;
        input.style.setProperty('--fill', `${k}%`);
    }

    function typeName(b) {
        if (b.look === 'earth' && b.kind === 'planet') {
            if (b.temp > 900) return 'Расплавленная планета';
            if (b.temp > 420) return 'Перегретая планета';
            if (b.temp < 235) return 'Замёрзшая планета';
        }
        return (T[b.type] || T.asteroid).name;
    }

    function factsFor(b) {
        const w = state.world;
        const rows = [];
        const att = P.attractorAt(w, b.x, b.y, b);
        if (att) {
            const name = att.body ? `«${att.body.name}»` : 'центра пары звёзд';
            const d = Math.hypot(b.x - att.x, b.y - att.y);
            rows.push(['Скорость', fmt.speed(Math.hypot(b.vx - att.vx, b.vy - att.vy))]);
            rows.push([`До ${name}`, fmt.dist(d)]);
            const orb = P.orbitOf(b, att);
            if (orb) {
                rows.push(['Год (период)', fmt.period(orb.period)]);
                rows.push(['Эксцентриситет', orb.e < 0.001 ? '0 (круг)' : nf(orb.e, 3)]);
            } else {
                rows.push(['Орбита', 'незамкнутая']);
            }
        } else {
            rows.push(['Скорость', fmt.speed(Math.hypot(b.vx, b.vy))]);
        }
        const re = b.realR / 6371;
        if (b.kind === 'bh') {
            rows.push(['Радиус горизонта', fmt.km(2.95 * b.m / P.M_SUN)]);
            rows.push(['2-я косм. скорость', 'быстрее света']);
        } else if (b.kind !== 'craft') {
            rows.push(['Настоящий радиус', fmt.km(b.realR)]);
            rows.push(['Плотность', `${num(5.51 * b.m / re ** 3)} г/см³`]);
            rows.push(['Притяжение', `${num(b.m / re ** 2)} g`]);
            rows.push(['2-я косм. скорость', `${num(11.19 * Math.sqrt(b.m / re))} км/с`]);
        }
        if (b.kind === 'star' || b.kind === 'neutron') {
            rows.push(['Светимость', `${num((b.realR / 696000) ** 2 * (b.temp / 5772) ** 4)} L☉`]);
        }
        return rows;
    }

    function refreshInspector(full) {
        const b = selected();
        if (!b) { closeInspector(); return; }
        if (full) {
            Render.bodyIcon(b, 32, inspIcon);
            if (document.activeElement !== inspName) inspName.value = b.name;
            inspType.textContent = typeName(b).toUpperCase();
            inspDesc.textContent = descOf(b);
            const isBH = b.kind === 'bh', isCraft = b.kind === 'craft';
            radiusRange.disabled = isBH;
            tempRange.disabled = isBH || isCraft;
            bhBtn.disabled = isBH;
            bhBtn.textContent = isBH ? 'УЖЕ ДЫРА' : 'В ЧЁРНУЮ ДЫРУ';
            engineBtn.hidden = !isCraft;
            if (isCraft) engineBtn.textContent = b.type === 'ship'
                ? `АВТОТЯГА: ${b.engine ? 'ВКЛ' : 'ВЫКЛ'}`
                : `СТАБИЛИЗ.: ${b.engine ? 'ВКЛ' : 'ВЫКЛ'}`;
            shipPad.hidden = b.type !== 'ship';
            inspTip.textContent = b.type === 'ship' ? 'Пока корабль выбран, им управляешь ты: W/S или ↑/↓ — газ, A/D или ←/→ — поворот (или кнопки выше). Автотяга работает, когда корабль не выбран.'
                : isBH ? 'Чем тяжелее чёрная дыра, тем больше её горизонт событий.'
                : state.paused ? 'Пауза: перетащи объект или квадратик на конце стрелки, чтобы изменить скорость.' : '';
        }
        if (!sliderBusy) {
            massRange.value = Math.log10(Math.max(1e-12, b.m));
            radiusRange.value = b.r;
            tempRange.value = Math.log10(Math.max(10, b.temp || 10));
        }
        [massRange, radiusRange, tempRange].forEach(setFill);
        massVal.textContent = fmt.mass(b.m);
        radiusVal.textContent = b.kind === 'bh' ? `${num(b.r)} пикс. (по массе)` : `${num(b.r)} пикс.`;
        tempVal.textContent = b.kind === 'bh' ? '≈ 0 K' : fmt.temp(b.temp);
        followBtn.textContent = state.followId === b.id ? 'НЕ СЛЕДИТЬ' : 'СЛЕДИТЬ';
        followBtn.classList.toggle('active', state.followId === b.id);

        inspFacts.textContent = '';
        for (const [k, v] of factsFor(b)) {
            const dt = document.createElement('dt');
            dt.textContent = k;
            const dd = document.createElement('dd');
            dd.textContent = v;
            inspFacts.append(dt, dd);
        }
    }

    // Кнопки управления кораблём (для телефонов)
    const padState = { thrust: 0, turn: 0 };
    shipPad.querySelectorAll('[data-pad]').forEach(btn => {
        const key = btn.dataset.pad, val = +btn.dataset.val;
        const on = (e) => { e.preventDefault(); padState[key] = val; };
        const off = () => { if (padState[key] === val) padState[key] = 0; };
        btn.addEventListener('pointerdown', on);
        btn.addEventListener('pointerup', off);
        btn.addEventListener('pointerleave', off);
        btn.addEventListener('pointercancel', off);
    });

    // Ползунки
    const sliderStart = () => { sliderBusy = true; };
    const sliderEnd = () => { sliderBusy = false; };
    [massRange, radiusRange, tempRange].forEach(r => {
        r.addEventListener('pointerdown', sliderStart);
        r.addEventListener('pointerup', sliderEnd);
        r.addEventListener('change', sliderEnd);
        r.addEventListener('blur', sliderEnd);
    });

    massRange.addEventListener('input', () => {
        const b = selected();
        if (!b) return;
        const events = [];
        P.setMass(state.world, b, 10 ** +massRange.value, events);
        handleEvents(events);
        refreshInspector(events.length > 0);
    });
    radiusRange.addEventListener('input', () => {
        const b = selected();
        if (!b) return;
        P.setRadius(b, +radiusRange.value);
        refreshInspector(false);
    });
    tempRange.addEventListener('input', () => {
        const b = selected();
        if (!b) return;
        const t = 10 ** +tempRange.value;
        b.temp = t; b.baseTemp = t;
        refreshInspector(true);
    });
    inspName.addEventListener('input', () => {
        const b = selected();
        if (b && inspName.value.trim()) b.name = inspName.value.trim().slice(0, 24);
    });
    inspName.addEventListener('blur', () => { const b = selected(); if (b) inspName.value = b.name; });

    $('inspClose').addEventListener('click', () => { Sound.play('close'); closeInspector(); });

    followBtn.addEventListener('click', () => toggleFollow());
    stopBtn.addEventListener('click', () => {
        const b = selected();
        if (!b) return;
        b.vx = 0; b.vy = 0;
        Sound.play('click');
        say(`Скорость «${b.name}» обнулена.\nТеперь ничто не мешает гравитации тянуть.`, 1);
        refreshInspector(true);
    });
    engineBtn.addEventListener('click', () => {
        const b = selected();
        if (!b || b.kind !== 'craft') return;
        b.engine = !b.engine;
        Sound.play('click');
        refreshInspector(true);
    });
    bhBtn.addEventListener('click', () => {
        const b = selected();
        if (!b || b.kind === 'bh') return;
        const events = [];
        P.toBlackHole(state.world, b, events, 'manual');
        handleEvents(events);
        refreshInspector(true);
    });
    deleteBtn.addEventListener('click', () => deleteSelected());

    function deleteSelected() {
        const b = selected();
        if (!b) return;
        burst(b.x, b.y, 24, PAL.white, Math.max(6, b.r * 3), 0.8, b);
        ring(b.x, b.y, b.r, b.r * 2.5, 0.5, '#ffffff');
        Sound.play('remove');
        if (state.followId === b.id) state.followId = null;
        state.compare = state.compare.filter(id => id !== b.id);
        P.removeBody(state.world, b);
        closeInspector();
        updateHint();
    }

    function toggleFollow() {
        const b = selected();
        if (!b) return;
        state.followId = state.followId === b.id ? null : b.id;
        Sound.play('click');
        refreshInspector(false);
        updateHint();
    }

    // ---------- Сравнение ----------
    function compareStats(b) {
        const re = b.realR / 6371;
        const att = P.attractorAt(state.world, b.x, b.y, b);
        const v = att ? Math.hypot(b.vx - att.vx, b.vy - att.vy) : Math.hypot(b.vx, b.vy);
        const isBH = b.kind === 'bh';
        return {
            mass: b.m,
            radius: isBH ? 2.95 * b.m / P.M_SUN : b.realR,
            temp: isBH ? null : b.temp,
            density: isBH || b.kind === 'craft' ? null : 5.51 * b.m / re ** 3,
            gravity: isBH ? Infinity : b.kind === 'craft' ? null : b.m / re ** 2,
            escape: isBH ? Infinity : b.kind === 'craft' ? null : 11.19 * Math.sqrt(b.m / re),
            speed: v
        };
    }

    function renderCompare() {
        const [a, b] = state.compare.map(byId);
        if (!a || !b) return;
        Render.bodyIcon(a, 32, $('cmpIcon1'));
        Render.bodyIcon(b, 32, $('cmpIcon2'));
        $('cmpName1').textContent = a.name;
        $('cmpName2').textContent = b.name;
        const A = compareStats(a), B = compareStats(b);
        const rows = [
            ['Масса', 'mass', fmt.mass],
            ['Радиус', 'radius', fmt.km],
            ['Температура', 'temp', fmt.temp],
            ['Плотность', 'density', (v) => `${num(v)} г/см³`],
            ['Притяжение', 'gravity', (v) => (isFinite(v) ? `${num(v)} g` : '∞')],
            ['2-я косм.', 'escape', (v) => (isFinite(v) ? `${num(v)} км/с` : 'больше c')],
            ['Скорость', 'speed', fmt.speed]
        ];
        const table = $('compareTable');
        table.textContent = '';
        for (const [label, key, f] of rows) {
            const va = A[key], vb = B[key];
            const l = document.createElement('div');
            l.className = 'cmp-label';
            l.textContent = label.toUpperCase();
            table.appendChild(l);
            const max = Math.max(va ?? 0, vb ?? 0);
            for (const v of [va, vb]) {
                const cell = document.createElement('div');
                cell.className = 'cmp-cell';
                if (v == null) {
                    cell.textContent = '—';
                } else {
                    // полоски в логарифмическом масштабе: иначе Земля рядом с Солнцем была бы нулём
                    const ratio = !isFinite(max) ? (isFinite(v) ? 0.05 : 1) : max > 0 ? v / max : 0;
                    const share = ratio > 0 ? 1 / (1 + Math.log10(1 / ratio)) : 0;
                    if (v === max && va !== vb) cell.classList.add('win');
                    const t = document.createElement('span');
                    t.textContent = f(v);
                    const bar = document.createElement('div');
                    bar.className = 'cmp-bar';
                    const fill = document.createElement('i');
                    fill.style.width = `${Math.round(clamp(share, 0, 1) * 100)}%`;
                    bar.appendChild(fill);
                    cell.append(t, bar);
                }
                table.appendChild(cell);
            }
        }
        // Закон всемирного тяготения для этой пары (в настоящих единицах)
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const rMeters = d / P.AU * 1.496e11;
        const F = 6.674e-11 * (a.m * 5.972e24) * (b.m * 5.972e24) / (rMeters * rMeters);
        const heavy = a.m >= b.m ? a : b, light = heavy === a ? b : a;
        const ratio = heavy.m / Math.max(light.m, 1e-30);
        const foot = $('compareFoot');
        foot.textContent = '';
        const add = (text, cls) => {
            const p = document.createElement('div');
            if (cls) p.className = cls;
            p.textContent = text;
            foot.appendChild(p);
        };
        add(`Расстояние между ними: ${fmt.dist(d)}`);
        add(`F = G·m₁·m₂ / r² ≈ ${sci(F)} Н`, 'formula');
        add(ratio < 1.01 ? 'Массы почти одинаковые.' : `«${heavy.name}» тяжелее «${light.name}» в ${num(ratio)} раз.`);
    }

    // ---------- Окна ----------
    function openModal(m) {
        m.hidden = false;
        Sound.play('open');
    }

    function closeModal(m) {
        if (m.hidden) return;
        m.hidden = true;
        Sound.play('close');
        if (m === compareModal) state.compare = [];
        updateHint();
    }

    document.querySelectorAll('.modal').forEach(m => {
        m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) closeModal(m); });
    });
    $('helpBtn').addEventListener('click', () => openModal(helpModal));

    // ---------- Настройки ----------
    const optMap = { optOrbits: 'showOrbits', optTrails: 'showTrails', optLabels: 'showLabels', optGrid: 'showGrid' };
    for (const [id, key] of Object.entries(optMap)) {
        const el = $(id);
        el.checked = state[key];
        el.addEventListener('change', () => {
            state[key] = el.checked;
            if (key === 'showTrails' && !el.checked) state.world.bodies.forEach(b => { b.trail.length = 0; });
            Sound.play('click');
            saveSettings();
        });
    }
    const optSound = $('optSound');
    optSound.checked = !Sound.isMuted();
    optSound.addEventListener('change', () => {
        Sound.setMuted(!optSound.checked);
        if (optSound.checked) { Sound.unlock(); Sound.play('click'); }
        saveSettings();
    });
    document.querySelectorAll('[data-px]').forEach(btn => {
        btn.classList.toggle('active', +btn.dataset.px === state.pixel);
        btn.addEventListener('click', () => {
            state.pixel = +btn.dataset.px;
            document.querySelectorAll('[data-px]').forEach(b => b.classList.toggle('active', b === btn));
            resize();
            Sound.play('click');
            saveSettings();
        });
    });

    // ---------- Время ----------
    const ICON_PAUSE = '<svg class="ico" viewBox="0 0 7 7" aria-hidden="true"><path d="M1 0h2v7H1zM4 0h2v7H4z"/></svg>';
    const ICON_PLAY = '<svg class="ico" viewBox="0 0 7 7" aria-hidden="true"><path d="M1 0h1v7H1zM2 1h1v5H2zM3 2h1v3H3zM4 3h1v1H4z"/></svg>';

    function togglePause() {
        state.paused = !state.paused;
        pauseBtn.innerHTML = state.paused ? ICON_PLAY : ICON_PAUSE;
        pauseBtn.classList.toggle('active', state.paused);
        pauseBtn.setAttribute('aria-label', state.paused ? 'Продолжить' : 'Пауза');
        pauseBadge.hidden = !state.paused;
        Sound.play(state.paused ? 'pause' : 'play');
        if (selected()) refreshInspector(true);
        updateHint();
    }

    function setSpeed(v) {
        state.speed = v;
        document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('active', +b.dataset.speed === v));
        Sound.play('click');
    }

    function stepOnce() {
        if (!state.paused) togglePause();
        const res = P.advance(state.world, STEP_TIME, 3000);
        handleEvents(res.events);
        updateTrails(true);
        Sound.play('step');
    }

    pauseBtn.addEventListener('click', togglePause);
    stepBtn.addEventListener('click', stepOnce);
    document.querySelectorAll('[data-speed]').forEach(btn => btn.addEventListener('click', () => setSpeed(+btn.dataset.speed)));

    // ---------- Режимы ----------
    function setTool(tool, silent = false) {
        state.tool = tool;
        document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
        if (tool !== 'compare') state.compare = [];
        state.ghost = tool === 'spawn' ? makeGhost(state.spawnItem) : null;
        state.preview = null;
        state.drag = null;
        if (!silent) Sound.play('select');
        markCategories();
        updateHint();
        updateCursor();
    }

    document.querySelectorAll('[data-tool]').forEach(btn => {
        btn.addEventListener('click', () => setTool(btn.dataset.tool));
    });

    function updateHint() {
        let h = '';
        const f = byId(state.followId);
        if (state.tool === 'spawn') {
            h = `${state.spawnItem.name}: клик — круговая орбита, зажать и тянуть — своя скорость`;
        } else if (state.tool === 'compare') {
            h = `Выбери два объекта для сравнения (${state.compare.length}/2)`;
        } else if (f) {
            h = `Камера следит за «${f.name}»`;
        } else if (state.paused) {
            h = 'Пауза: объекты можно перетаскивать';
        }
        modeHint.textContent = h;
    }

    // Курсор — белый пиксельный прицел
    const CROSS_CURSOR = (() => {
        const c = document.createElement('canvas');
        c.width = 19; c.height = 19;
        const x = c.getContext('2d');
        const bar = (px, py, w, h) => {
            x.fillStyle = '#000'; x.fillRect(px - 1, py - 1, w + 2, h + 2);
        };
        const fill = (px, py, w, h) => { x.fillStyle = '#fff'; x.fillRect(px, py, w, h); };
        const parts = [[8, 0, 2, 6], [8, 13, 2, 6], [0, 8, 6, 2], [13, 8, 6, 2], [8, 8, 2, 2]];
        parts.forEach(p => bar(...p));
        parts.forEach(p => fill(...p));
        return `url(${c.toDataURL()}) 9 9, crosshair`;
    })();

    function updateCursor() {
        const d = state.drag;
        if (d && (d.mode === 'pan' || d.mode === 'move' || d.mode === 'pinch') && d.moved) spaceEl.style.cursor = 'grabbing';
        else if (state.tool !== 'spawn' && state.hoverId != null) spaceEl.style.cursor = 'pointer';
        else spaceEl.style.cursor = CROSS_CURSOR;
    }

    // ---------- Мышь и касания ----------
    const pointers = new Map();

    function pick(cx, cy) {
        let best = null, bestScore = Infinity;
        for (const b of state.world.bodies) {
            const p = Render.toCss(b.x, b.y);
            const R = Math.max(b.kind === 'craft' ? 13 : 10, b.r * cam.zoom * (b.kind === 'bh' ? 2 : b.rings ? 1.3 : 1));
            const d = Math.hypot(p.x - cx, p.y - cy);
            if (d > R) continue;
            const score = d / R;
            if (score < bestScore) { bestScore = score; best = b; }
        }
        return best;
    }

    // Стрелка скорости выбранного объекта на паузе
    function velocityArrow(b) {
        const att = P.attractorAt(state.world, b.x, b.y, b);
        const bvx = att ? att.vx : 0, bvy = att ? att.vy : 0;
        return {
            x0: b.x, y0: b.y,
            x1: b.x + (b.vx - bvx) / DRAG_K, y1: b.y + (b.vy - bvy) / DRAG_K,
            bvx, bvy
        };
    }

    function onDown(e) {
        Sound.unlock();
        if (state.introOpen) return;
        closeDropdowns();
        document.querySelectorAll('[data-drop].active').forEach(b => b.classList.remove('active'));
        if (state.openCat) closeCatMenu();
        try { spaceEl.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const cx = e.clientX, cy = e.clientY;

        if (pointers.size === 2) {
            const [p1, p2] = [...pointers.values()];
            state.drag = {
                mode: 'pinch', moved: true, z0: cam.zoom,
                d0: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1,
                mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2
            };
            state.preview = null;
            return;
        }
        if (pointers.size > 2) return;

        if (e.button === 1 || e.button === 2) {
            state.drag = { mode: 'pan', sx: cx, sy: cy, lx: cx, ly: cy, moved: false };
            return;
        }

        const w = Render.toWorld(cx, cy);
        if (state.tool === 'spawn') {
            state.drag = { mode: 'spawn', sx: cx, sy: cy, cx, cy, wx: w.x, wy: w.y, moved: false };
            return;
        }

        const sel = selected();
        if (state.tool === 'select' && state.paused && sel) {
            const a = velocityArrow(sel);
            const tip = Render.toCss(a.x1, a.y1);
            if (Math.hypot(tip.x - cx, tip.y - cy) < 14) {
                state.drag = { mode: 'vel', body: sel, bvx: a.bvx, bvy: a.bvy, moved: false };
                return;
            }
        }

        const hit = pick(cx, cy);
        if (hit && state.tool === 'compare') {
            const i = state.compare.indexOf(hit.id);
            if (i >= 0) state.compare.splice(i, 1);
            else {
                state.compare.push(hit.id);
                if (state.compare.length > 2) state.compare.shift();
            }
            Sound.play('select');
            updateHint();
            if (state.compare.length === 2) { renderCompare(); openModal(compareModal); }
            state.drag = { mode: 'none' };
            return;
        }
        if (hit) {
            if (state.selectedId !== hit.id) Sound.play('select');
            select(hit.id);
            state.drag = state.paused
                ? { mode: 'move', body: hit, offx: hit.x - w.x, offy: hit.y - w.y, sx: cx, sy: cy, moved: false }
                : { mode: 'press', sx: cx, sy: cy, moved: false };
            return;
        }
        state.drag = { mode: 'pan', sx: cx, sy: cy, lx: cx, ly: cy, moved: false, clickEmpty: true };
    }

    let warnedMove = false;

    function onMove(e) {
        if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const cx = e.clientX, cy = e.clientY;
        state.pointer = { x: cx, y: cy };
        const d = state.drag;

        if (!d) {
            if (e.target === spaceEl && !state.introOpen) {
                const hit = state.tool !== 'spawn' ? pick(cx, cy) : null;
                state.hoverId = hit ? hit.id : null;
                updateCursor();
            }
            return;
        }

        switch (d.mode) {
            case 'pinch': {
                if (pointers.size < 2) return;
                const [p1, p2] = [...pointers.values()];
                const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
                const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
                const target = clamp(d.z0 * dist / d.d0, 0.015, 60);
                zoomAt(mx, my, target / cam.zoom);
                if (!state.followId) {
                    cam.x -= (mx - d.mx) / cam.zoom;
                    cam.y -= (my - d.my) / cam.zoom;
                }
                d.mx = mx; d.my = my;
                break;
            }
            case 'pan': {
                if (!d.moved && Math.hypot(cx - d.sx, cy - d.sy) > 4) {
                    d.moved = true;
                    if (state.followId) { state.followId = null; updateHint(); if (selected()) refreshInspector(false); }
                }
                if (d.moved) {
                    cam.x -= (cx - d.lx) / cam.zoom;
                    cam.y -= (cy - d.ly) / cam.zoom;
                }
                d.lx = cx; d.ly = cy;
                break;
            }
            case 'spawn':
                d.cx = cx; d.cy = cy;
                if (Math.hypot(cx - d.sx, cy - d.sy) > 6) d.moved = true;
                break;
            case 'move': {
                if (!d.moved && Math.hypot(cx - d.sx, cy - d.sy) > 3) d.moved = true;
                if (!d.moved || !d.body.alive) break;
                const w = Render.toWorld(cx, cy);
                d.body.x = w.x + d.offx;
                d.body.y = w.y + d.offy;
                d.body.trail.length = 0;
                break;
            }
            case 'vel': {
                d.moved = true;
                if (!d.body.alive) break;
                const w = Render.toWorld(cx, cy);
                d.body.vx = d.bvx + (w.x - d.body.x) * DRAG_K;
                d.body.vy = d.bvy + (w.y - d.body.y) * DRAG_K;
                break;
            }
            case 'press':
                if (!d.moved && Math.hypot(cx - d.sx, cy - d.sy) > 8) {
                    d.moved = true;
                    if (!warnedMove) { warnedMove = true; say('Поставь паузу (пробел), чтобы перетаскивать объекты.', 1); }
                }
                break;
        }
        updateCursor();
    }

    function onUp(e) {
        pointers.delete(e.pointerId);
        const d = state.drag;
        if (!d) return;
        if (d.mode === 'pinch') {
            if (pointers.size === 0) state.drag = null;
            return;
        }
        if (d.mode === 'spawn' && e.type === 'pointerup') {
            const v = spawnVelocity(d);
            const b = spawn(state.spawnItem, d.wx, d.wy, v.vx, v.vy);
            if (b && b.kind === 'craft' && (v.rvx || v.rvy)) b.heading = Math.atan2(v.rvy, v.rvx);
        }
        if (d.mode === 'pan' && d.clickEmpty && !d.moved && state.tool === 'select' && state.selectedId != null) {
            Sound.play('close');
            closeInspector();
        }
        if ((d.mode === 'move' || d.mode === 'vel') && d.moved && selected()) refreshInspector(false);
        state.drag = null;
        state.preview = null;
        updateCursor();
    }

    spaceEl.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    spaceEl.addEventListener('contextmenu', (e) => e.preventDefault());
    spaceEl.addEventListener('pointerleave', () => { if (!state.drag) { state.hoverId = null; state.pointer = null; } });
    spaceEl.addEventListener('wheel', (e) => {
        e.preventDefault();
        const k = e.deltaMode === 1 ? 40 : 1;
        zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * k * 0.0015));
    }, { passive: false });

    // ---------- Клавиатура ----------
    const keys = new Set();
    window.addEventListener('keydown', (e) => {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
            if (e.key === 'Escape' || e.key === 'Enter') e.target.blur();
            return;
        }
        if (state.introOpen) {
            if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); startGame(); }
            return;
        }
        keys.add(e.code);
        const sel = selected();
        const shipKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
        if (sel && sel.type === 'ship' && shipKeys.includes(e.code)) { e.preventDefault(); return; }
        switch (e.code) {
            case 'Space': e.preventDefault(); togglePause(); break;
            case 'KeyN': case 'Period': stepOnce(); break;
            case 'KeyF': toggleFollow(); break;
            case 'Delete': case 'Backspace': deleteSelected(); break;
            case 'Escape': {
                const open = [...document.querySelectorAll('.modal')].find(m => !m.hidden);
                if (open) closeModal(open);
                else if (document.querySelector('.dropdown.open') || state.openCat) {
                    closeDropdowns();
                    document.querySelectorAll('[data-drop].active').forEach(b => b.classList.remove('active'));
                    closeCatMenu();
                }
                else if (state.drag && state.drag.mode === 'spawn') { state.drag = null; state.preview = null; }
                else if (state.selectedId != null) { closeInspector(); Sound.play('close'); }
                else if (state.tool !== 'select') setTool('select');
                break;
            }
            default:
                if (/^Digit[1-6]$/.test(e.code)) setSpeed(SPEEDS[+e.code.slice(5) - 1]);
        }
    });
    window.addEventListener('keyup', (e) => keys.delete(e.code));
    window.addEventListener('blur', () => keys.clear());

    // Короткий звук при наведении на кнопки
    document.addEventListener('pointerover', (e) => {
        if (e.pointerType !== 'mouse') return;
        const btn = e.target.closest('.px-btn, .menu-item, .px-check');
        if (btn && !btn.contains(e.relatedTarget)) Sound.play('hover');
    });
    document.addEventListener('pointerdown', () => Sound.unlock(), { capture: true });

    // ---------- Кадр ----------
    function updateTrails(force) {
        if (!state.showTrails) return;
        const minStep = 2 * state.pixel / cam.zoom;
        for (const b of state.world.bodies) {
            const tr = b.trail;
            const max = b.debris ? 24 : b.type === 'asteroid' ? 40 : b.kind === 'star' ? 70 : 130;
            const n = tr.length;
            if (n >= 2 && !force) {
                const dx = b.x - tr[n - 2], dy = b.y - tr[n - 1];
                if (dx * dx + dy * dy < minStep * minStep) continue;
            }
            tr.push(b.x, b.y);
            if (tr.length > max * 2) tr.splice(0, tr.length - max * 2);
        }
    }

    let lastTime = performance.now();
    let statTimer = 0, factTimer = 0, escapeTimer = 0, previewTick = 0;
    let lastPulse = null;

    function frame(now) {
        const realDt = Math.min(0.05, (now - lastTime) / 1000);
        lastTime = now;
        state.clock += realDt;
        const w = state.world;
        const sel = selected();

        // управление кораблём
        let thrusting = false;
        for (const b of w.bodies) {
            if (b.type !== 'ship') continue;
            b.input.manual = b === sel;          // выбранным кораблём управляет игрок, а не автопилот
            if (b === sel) {
                const up = keys.has('KeyW') || keys.has('ArrowUp');
                const down = keys.has('KeyS') || keys.has('ArrowDown');
                const left = keys.has('KeyA') || keys.has('ArrowLeft');
                const right = keys.has('KeyD') || keys.has('ArrowRight');
                b.input.thrust = (up ? 1 : 0) - (down ? 1 : 0) || padState.thrust;
                b.input.turn = (right ? 1 : 0) - (left ? 1 : 0) || padState.turn;
                if (!state.paused) b.heading += b.input.turn * 2.6 * realDt;
                thrusting = !!b.input.thrust && !state.paused;
            } else {
                b.input.thrust = 0; b.input.turn = 0;
            }
        }
        Sound.engine(thrusting);

        // физика
        if (!state.paused && !state.introOpen) {
            const n = w.bodies.length;
            const maxSteps = clamp(Math.floor(2.5e6 / (n * n / 2 + 1)), 30, 900);
            const res = P.advance(w, realDt * state.speed, maxSteps);
            if (res.dropped > 1e-6) state.lag = 1.5;
            handleEvents(res.events);
            updateTrails(false);
        }
        const world = state.world;

        // приливные потоки к чёрным дырам, затухание эффектов
        const bhs = world.bodies.filter(b => b.kind === 'bh');
        for (const b of world.bodies) {
            if (b.stripped && bhs.length) {
                let near = bhs[0], bd = Infinity;
                for (const h of bhs) { const dd = (h.x - b.x) ** 2 + (h.y - b.y) ** 2; if (dd < bd) { bd = dd; near = h; } }
                const pal = b.kind === 'star' ? PAL.fire : PAL.purple;
                if (!state.paused) spiral(near, b.x + (Math.random() - 0.5) * b.r, b.y + (Math.random() - 0.5) * b.r, 2, pal);
                b.stripped = 0;
            }
            if (b.nearBH) b.nearBH = Math.max(0, b.nearBH - realDt * 2);
            if (b.feed) b.feed = Math.max(0, b.feed - realDt * 0.8);
        }

        // улетевшие навсегда
        escapeTimer += realDt;
        if (escapeTimer > 1) {
            escapeTimer = 0;
            for (const b of P.findEscaped(world, 9000)) {
                if (!b.debris && b.type !== 'asteroid') {
                    say(`«${b.name}» улетает в межзвёздное пространство.`, 1);
                    Sound.play('escape');
                }
                if (state.selectedId === b.id) closeInspector();
                if (state.followId === b.id) state.followId = null;
                P.removeBody(world, b);
            }
        }

        // камера следит за объектом
        const f = byId(state.followId);
        if (state.followId != null && !f) { state.followId = null; updateHint(); }
        if (f) {
            const k = Math.min(1, realDt * 10);
            cam.x += (f.x - cam.x) * k;
            cam.y += (f.y - cam.y) * k;
        }

        // частицы и эффекты
        const visDt = state.paused ? 0 : realDt * clamp(state.speed, 0.1, 2.5);
        updateParticles(visDt);
        state.flash = Math.max(0, state.flash - realDt * 1.6);
        state.shake = Math.max(0, state.shake - realDt * 22);
        if (state.lag > 0) state.lag -= realDt;

        // создание: «призрак», стрелка и прогноз пути
        state.arrow = null;
        const d = state.drag;
        if (state.tool === 'spawn' && state.ghost) {
            const g = state.ghost;
            if (d && d.mode === 'spawn') {
                g.x = d.wx; g.y = d.wy;
                const v = spawnVelocity(d);
                const ax = v.circ ? v.circ.att.vx : 0, ay = v.circ ? v.circ.att.vy : 0;
                const sp = Math.hypot(v.vx - ax, v.vy - ay);
                state.arrow = {
                    x0: d.wx, y0: d.wy,
                    x1: d.wx + (v.vx - ax) / DRAG_K, y1: d.wy + (v.vy - ay) / DRAG_K,
                    label: `${fmt.speed(sp)}${v.auto ? '\nкруговая орбита' : v.snapped ? '\n= круговая' : ''}`
                };
                if (++previewTick % 2 === 0 || !state.preview) {
                    state.preview = P.predict(world, d.wx, d.wy, v.vx, v.vy, { radius: g.r });
                }
            } else if (state.pointer && !d) {
                const wp = Render.toWorld(state.pointer.x, state.pointer.y);
                g.x = wp.x; g.y = wp.y;
            } else if (!state.pointer) {
                g.x = 1e9; g.y = 1e9;
            }
            g.rot += realDt * (g.spin || 0.5);
        } else if (sel && state.paused && state.tool === 'select') {
            const a = velocityArrow(sel);
            const sp = Math.hypot(sel.vx - a.bvx, sel.vy - a.bvy);
            state.arrow = { x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y1, handle: true, label: fmt.speed(sp) };
            if (d && (d.mode === 'vel' || d.mode === 'move') && d.moved) {
                if (++previewTick % 2 === 0 || !state.preview) state.preview = P.predict(world, sel.x, sel.y, sel.vx, sel.vy, { exclude: sel, radius: sel.r });
            } else if (!d) state.preview = null;
        }

        // тиканье пульсара
        if (sel && sel.type === 'neutron' && !state.paused) {
            const ph = Math.floor(sel.rot / Math.PI);
            if (lastPulse !== null && ph !== lastPulse) Sound.play('pulsar');
            lastPulse = ph;
        } else lastPulse = null;

        Render.draw({
            world, clock: state.clock,
            selectedId: state.selectedId, hoverId: state.hoverId,
            compareIds: state.tool === 'compare' || !compareModal.hidden ? state.compare : null,
            showOrbits: state.showOrbits, showTrails: state.showTrails, showLabels: state.showLabels, showGrid: state.showGrid,
            preview: state.preview, arrow: state.arrow,
            ghost: state.tool === 'spawn' && state.ghost && state.ghost.x < 1e8 ? state.ghost : null,
            particles: state.particles, effects: state.effects,
            flash: state.flash, flashColor: state.flashColor, shake: state.shake
        });

        statTimer += realDt;
        if (statTimer > 0.25) {
            statTimer = 0;
            statBodies.textContent = `ОБЪЕКТОВ: ${world.bodies.length}`;
            statTime.textContent = fmt.time(world.time);
            statLag.hidden = !(state.lag > 0 && !state.paused);
        }
        factTimer += realDt;
        if (factTimer > 0.2) {
            factTimer = 0;
            if (state.selectedId != null) {
                if (selected()) refreshInspector(false);
                else closeInspector();
            }
            if (!compareModal.hidden) renderCompare();
        }

        if (state.introOpen) {
            introEarth.rot += realDt * 0.6;
            Render.bodyIcon(introEarth, 64, introPlanet);
        }
        requestAnimationFrame(frame);
    }

    // ---------- Заставка ----------
    const introEarth = makeGhost(CATEGORIES[1].items[0]);
    introEarth.seed = 2024;

    function startGame() {
        if (!state.introOpen) return;
        Sound.unlock();
        Sound.play('start');
        state.introOpen = false;
        intro.classList.add('hide');
        setTimeout(() => { intro.hidden = true; }, 420);
        SOLAR_LINES.forEach((l, i) => setTimeout(() => say(l, 1), 300 + i * 700));
    }

    $('startBtn').addEventListener('click', startGame);

    // ---------- Запуск ----------
    function resize() {
        Render.resize(window.innerWidth, window.innerHeight, state.pixel);
        if (state.openCat) closeCatMenu();
    }
    window.addEventListener('resize', resize);

    Render.init(spaceEl, overlayEl);
    resize();
    buildCategories();
    loadPreset('solar', true);
    setTool('select', true);
    updateCursor();
    requestAnimationFrame(frame);
})();
