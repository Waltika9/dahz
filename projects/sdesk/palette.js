/* Short Desk — окно добавления (ЛКМ по «+»).
   Поиск, разделы и подразделы, как в палитре действий Shortcuts.
   Кроме плиток здесь есть разделы-действия (например, «Файлы»). */
const Palette = (() => {
    // Разделы, которые не являются типами плиток
    const EXTRA = [
        { id: 'targets', name: 'Таргеты', color: '#FF9F0A', icon: 'target' },
        { id: 'magnets', name: 'Магниты', color: '#FF453A', icon: 'magnet' },
        { id: 'files', name: 'Файлы', color: '#8E8E93', icon: 'folder' }
    ];
    const ACTIONS = [
        {
            cat: 'targets', sub: 'Таргеты', title: 'Таргет', icon: 'target',
            desc: 'Метка-прицел: отмечает место для «Добавить плитку» и «Переместить плитку»',
            keywords: 'таргет прицел метка место target',
            run: at => Board.addTarget({ at, animate: true, select: true }),
            drop: w => Board.addTarget({ x: w.x, y: w.y, animate: true, select: true })
        },
        {
            cat: 'magnets', sub: 'Магниты', title: 'Магнит', icon: 'magnet',
            desc: 'Гнездо: плитка в его круге сама соединяется с партнёрами магнита',
            keywords: 'магнит гнездо партнёр автосвязь magnet',
            run: at => Board.addMagnet({ at, animate: true, select: true }),
            drop: w => Board.addMagnet({ x: w.x, y: w.y, animate: true, select: true })
        },
        {
            cat: 'files', sub: 'Файлы', title: 'Загрузить файл', icon: 'upload',
            desc: 'Картинки, видео, звук, текст и любые другие файлы станут плитками',
            keywords: 'файл загрузить картинка видео аудио upload',
            run: at => Storage.pickFiles(at)
        },
        {
            cat: 'files', sub: 'Доски', title: 'Загрузить код', icon: 'folder',
            desc: 'Открыть доску .tiles — она появится рядом, текущая не пропадёт',
            keywords: 'открыть загрузить доску код tiles zip json',
            run: at => Storage.pickBoards(at)
        },
        {
            cat: 'files', sub: 'Доски', title: 'Сохранить доску', icon: 'download',
            desc: 'Скачать всю доску одним файлом .tiles',
            keywords: 'сохранить скачать доску save',
            run: () => Storage.saveBoard()
        }
    ];

    let sheet, backdrop, input, nav, catalog, navScroll;
    let at = null, isOpen = false;

    function init() {
        sheet = document.getElementById('sheet');
        backdrop = document.getElementById('sheetBackdrop');
        input = document.getElementById('searchInput');
        nav = document.getElementById('catNav');
        catalog = document.getElementById('catalog');

        backdrop.addEventListener('pointerdown', close);
        document.getElementById('sheetClose').addEventListener('click', close);
        document.getElementById('sheetSave').addEventListener('click', () => { close(); Storage.saveBoard(); });
        document.getElementById('sheetLoad').addEventListener('click', () => { close(); Storage.pickBoards(); });
        input.addEventListener('input', () => render(input.value));
        catalog.addEventListener('scroll', spy, { passive: true });

        // ряд разделов (на узком экране он горизонтальный) листается колесом мыши
        navScroll = UI.hscroll(nav);
        nav.addEventListener('wheel', e => {
            if (getComputedStyle(nav).flexDirection !== 'row' || !navScroll.canScroll()) return;
            e.preventDefault();
            navScroll.by(UI.wheelDelta(e, nav.clientWidth).main);
        }, { passive: false });

        buildNav();
    }

    function sections() {
        return [...Nodes.CATEGORIES, ...EXTRA];
    }

    // Всё, что можно выбрать: типы плиток и действия
    function entries() {
        // ширина плитки: у рамок, сайта и заголовка она в поле gw
        const widthOf = d => (d.extra && d.extra.gw ? d.extra.gw : d.width);
        const tiles = Nodes.list().map(d => ({
            cat: d.cat, sub: d.sub, title: d.title, desc: d.desc, keywords: d.keywords,
            icon: () => Nodes.icon(d),
            width: widthOf(d),
            run: where => addTile(d.id, where),
            // перетащили на доску — плитка встаёт заголовком под курсор
            drop: w => Board.addTile(d.id, {
                x: w.x - widthOf(d) / 2, y: w.y - 22, animate: true, select: true
            })
        }));
        const color = Object.fromEntries(EXTRA.map(s => [s.id, s.color]));
        const actions = ACTIONS.map(a => ({ ...a, icon: () => Nodes.icon({ icon: a.icon, color: color[a.cat] }) }));
        return [...tiles, ...actions];
    }

    const norm = s => String(s).toLowerCase().replace(/ё/g, 'е');
    function search(q) {
        const words = norm(q).split(/\s+/).filter(Boolean);
        const names = Object.fromEntries(sections().map(s => [s.id, s.name]));
        const all = entries();
        if (!words.length) return all;
        return all.filter(e => {
            const hay = norm([e.title, e.desc, e.keywords, e.sub, names[e.cat]].join(' '));
            return words.every(w => hay.includes(w));
        });
    }

    function open(o = {}) {
        at = o.at || null;
        UI.menu.close();
        input.value = '';
        render('');
        catalog.scrollTop = 0;
        sheet.classList.add('open');
        backdrop.classList.add('open');
        isOpen = true;
        setTimeout(() => { if (isOpen) input.focus({ preventScroll: true }); }, 80);
    }

    function close() {
        if (!isOpen) return;
        isOpen = false;
        sheet.classList.remove('open');
        backdrop.classList.remove('open');
        input.blur();
    }

    function buildNav() {
        nav.innerHTML = '';
        for (const c of sections()) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'cat-btn';
            b.dataset.cat = c.id;
            const name = document.createElement('span');
            name.textContent = c.name;
            b.append(Nodes.icon(c), name);
            b.addEventListener('click', () => {
                const sec = catalog.querySelector(`[data-sec="${c.id}"]`);
                if (sec) catalog.scrollTo({ top: sec.offsetTop - 6, behavior: 'smooth' });
            });
            nav.append(b);
        }
    }

    function render(q) {
        catalog.innerHTML = '';
        const found = search(q);
        const present = new Set(found.map(e => e.cat));

        for (const c of sections()) {
            if (!present.has(c.id)) continue;
            const sec = document.createElement('section');
            sec.className = 'cat-sec';
            sec.dataset.sec = c.id;
            const h = document.createElement('h3');
            h.textContent = c.name;
            sec.append(h);

            // подразделы — в порядке появления
            const subs = new Map();
            for (const e of found) {
                if (e.cat !== c.id) continue;
                if (!subs.has(e.sub)) subs.set(e.sub, []);
                subs.get(e.sub).push(e);
            }
            for (const [sub, list] of subs) {
                if (subs.size > 1 || sub !== c.name) {
                    const h4 = document.createElement('h4');
                    h4.textContent = sub;
                    sec.append(h4);
                }
                const grid = document.createElement('div');
                grid.className = 'pal-grid';
                for (const e of list) grid.append(item(e));
                sec.append(grid);
            }
            catalog.append(sec);
        }

        if (!found.length) {
            const e = document.createElement('div');
            e.className = 'pal-empty';
            e.textContent = 'Ничего не найдено';
            catalog.append(e);
        }
        for (const b of nav.children) b.classList.toggle('dim', !present.has(b.dataset.cat));
        spy();
    }

    function item(e) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pal-item';
        const text = document.createElement('span');
        text.className = 'pal-text';
        const t = document.createElement('b');
        t.textContent = e.title;
        const s = document.createElement('small');
        s.textContent = e.desc;
        text.append(t, s);
        b.append(e.icon(), text);
        b.addEventListener('click', () => {
            if (b.dataset.dragged) { delete b.dataset.dragged; return; }
            const where = at;
            close();
            e.run(where);
        });
        if (e.drop) draggable(b, e);
        return b;
    }

    /* ---------- Перетаскивание плитки из окна на доску ----------
       Мышью — сразу, пальцем — после короткого удержания (иначе это прокрутка списка).
       Как только плитка «оторвалась», окно закрывается, и её можно положить куда удобно. */
    function draggable(btn, entry) {
        btn.addEventListener('pointerdown', ev => {
            if (ev.button !== 0) return;
            const start = { x: ev.clientX, y: ev.clientY, id: ev.pointerId, touch: ev.pointerType === 'touch' };
            let ready = !start.touch, drag = null;
            const timer = start.touch ? setTimeout(() => { ready = true; UI.pressRing(start.x, start.y); }, 320) : 0;

            const move = m => {
                if (m.pointerId !== start.id) return;
                const dist = Math.hypot(m.clientX - start.x, m.clientY - start.y);
                if (!drag) {
                    if (!ready) { if (dist > 8) cleanup(); return; }   // палец поехал раньше — это прокрутка
                    if (dist < 6) return;
                    drag = lift(entry, m.clientX, m.clientY);
                }
                m.preventDefault();
                place(drag, m.clientX, m.clientY);
            };
            const up = u => {
                if (u.pointerId !== start.id) return;
                cleanup();
                if (!drag) return;
                btn.dataset.dragged = '1';
                setTimeout(() => delete btn.dataset.dragged, 0);
                drop(drag, u.type === 'pointerup' ? u : null);
            };
            const noScroll = t => { if (drag || ready) t.preventDefault(); };
            const cleanup = () => {
                clearTimeout(timer);
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                window.removeEventListener('pointercancel', up);
                btn.removeEventListener('touchmove', noScroll);
            };
            window.addEventListener('pointermove', move, { passive: false });
            window.addEventListener('pointerup', up);
            window.addEventListener('pointercancel', up);
            btn.addEventListener('touchmove', noScroll, { passive: false });
        });
    }

    // Плитка «оторвалась» от списка: окно закрывается, за курсором едет её силуэт
    function lift(entry, x, y) {
        close();
        const ghost = UI.div('drag-ghost glass');
        ghost.append(entry.icon());
        const name = document.createElement('span');
        name.textContent = entry.title;
        ghost.append(name);
        if (entry.width) ghost.style.width = Math.max(150, entry.width * Board.view.k) + 'px';
        document.body.append(ghost);
        const d = { entry, ghost };
        place(d, x, y);
        void ghost.offsetWidth;
        ghost.classList.add('show');
        return d;
    }

    function place(d, x, y) {
        d.ghost.style.left = x + 'px';
        d.ghost.style.top = y + 'px';
    }

    // Отпустили над доской — объект появляется в этой точке; над панелью или окном — отмена
    function drop(d, e) {
        d.ghost.classList.remove('show');
        setTimeout(() => d.ghost.remove(), 200);
        if (!e) return;
        const under = document.elementFromPoint(e.clientX, e.clientY);
        if (!under || !under.closest('#board')) {
            UI.toast('Отпустите плитку над доской');
            return;
        }
        d.entry.drop(Board.screenToWorld(e.clientX, e.clientY));
    }

    function addTile(type, where) {
        const t = Board.addTile(type, { at: where, animate: true, select: true });
        if (!t) return;
        // если плитка вышла за край экрана — плавно подвинем вид
        const v = Board.visibleRect();
        if (t.x < v.x || t.y < v.y || t.x + t.w > v.x + v.w || t.y + t.h > v.y + v.h) {
            Board.flyTo(t.x + t.w / 2, t.y + t.h / 2);
        }
    }

    // Подсветка раздела, который сейчас виден в списке
    function spy() {
        const secs = catalog.querySelectorAll('.cat-sec');
        let active = secs[0] ? secs[0].dataset.sec : null;
        for (const s of secs) if (s.offsetTop - 30 <= catalog.scrollTop) active = s.dataset.sec;
        for (const b of nav.children) {
            const on = b.dataset.cat === active;
            if (on && !b.classList.contains('active') && getComputedStyle(nav).flexDirection === 'row') {
                b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
            }
            b.classList.toggle('active', on);
        }
    }

    return { init, open, close, isOpen: () => isOpen };
})();
