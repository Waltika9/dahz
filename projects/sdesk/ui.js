/* Short Desk — общие элементы интерфейса:
   значки, контекстное меню, диалоги и панели в стиле iOS, уведомления
   и плавная прокрутка рядов колесом мыши. */
const UI = (() => {
    // Палитра цветов iOS: ей красятся плитки, линии и (позже) таргеты
    const COLORS = [
        { name: 'Красный',    hex: '#FF453A' },
        { name: 'Оранжевый',  hex: '#FF9F0A' },
        { name: 'Жёлтый',     hex: '#FFD60A' },
        { name: 'Зелёный',    hex: '#30D158' },
        { name: 'Мятный',     hex: '#63E6E2' },
        { name: 'Голубой',    hex: '#64D2FF' },
        { name: 'Синий',      hex: '#0A84FF' },
        { name: 'Индиго',     hex: '#5E5CE6' },
        { name: 'Фиолетовый', hex: '#BF5AF2' },
        { name: 'Розовый',    hex: '#FF375F' },
        { name: 'Коричневый', hex: '#AC8E68' },
    ];

    // Линейные значки 24×24 (рисуются цветом текста)
    const ICONS = {
        plus:     '<path d="M12 5v14M5 12h14"/>',
        addTile:  '<rect x="4" y="4" width="16" height="16" rx="5"/><path d="M12 8.5v7M8.5 12h7"/>',
        trash:    '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2h9.2L17.5 7M10 11v5M14 11v5"/>',
        pencil:   '<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>',
        copy:     '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="3"/><path d="M15.5 8.5V6.5a2.5 2.5 0 0 0-2.5-2.5H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2"/>',
        unlink:   '<path d="M9.5 14.5l-2.3 2.3a3 3 0 0 1-4.2-4.2l3-3a3 3 0 0 1 4.2 0M14.5 9.5l2.3-2.3a3 3 0 0 1 4.2 4.2l-3 3a3 3 0 0 1-4.2 0M8 3.5v2M3.5 8h2M16 20.5v-2M20.5 16h-2"/>',
        point:    '<circle cx="12" cy="12" r="3.2"/><path d="M3 17c3 0 4.5-2 6-3.7M15 10.7C16.5 9 18 7 21 7"/>',
        noPoints: '<path d="M3 12h18"/><circle cx="12" cy="12" r="3.2"/><path d="M5 5l14 14"/>',
        reverse:  '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
        curve:    '<path d="M4 18c8 0 8-12 16-12"/>',
        angle:    '<path d="M4 18h8V6h8"/>',
        fit:      '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
        zoom:     '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3M8.5 11h5"/>',
        selectAll:'<rect x="4" y="4" width="16" height="16" rx="4" stroke-dasharray="3.2 3.2"/><path d="M9 12.2l2.2 2.2L15.5 10"/>',
        deselect: '<rect x="4" y="4" width="16" height="16" rx="4" stroke-dasharray="3.2 3.2"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/>',
        select:   '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 12.2l2.2 2.2L15.5 10"/>',
        grid:     '<path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>',
        magnetGrid:'<path d="M4 4h4v4H4zM16 4h4v4h-4zM4 16h4v4H4zM16 16h4v4h-4z"/><path d="M8 6h8M8 18h8M6 8v8M18 8v8" stroke-dasharray="2 2.5"/>',
        clear:    '<path d="M5 19h14M7.5 15.5 15 5l4 3-6.8 9.5"/><path d="M10.6 11.3l3.9 2.8"/>',
        check:    '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
        close:    '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
        search:   '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
        stop:     '<rect x="6.5" y="6.5" width="11" height="11" rx="2.6" fill="currentColor" stroke="none"/>',
        limit:    '<path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z"/><path d="M12 8.3v4.4M12 15.6h.01"/>',
        upload:   '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15"/>',
        download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15"/>',
        folder:   '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
        paste:    '<rect x="5" y="4.5" width="14" height="16" rx="2.5"/><path d="M9 4.5v-1h6v1M9 11h6M9 14.5h4"/>',
        replace:  '<path d="M4.5 12a7.5 7.5 0 0 1 13-5.1L19.5 9M19.5 4.5V9H15M19.5 12a7.5 7.5 0 0 1-13 5.1L4.5 15M4.5 19.5V15H9"/>',
        stats:    '<path d="M5 20v-8M10 20V5M15 20v-6M20 20V9"/>',
        help:     '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 0 1 4.8.9c0 1.6-2.4 2-2.4 3.6M12 16.9h.01"/>',
        hand:     '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5-2.7L3.6 14.1a1.5 1.5 0 0 1 2.4-1.8L8 14.5"/>',
        mouse:    '<rect x="6.5" y="3" width="11" height="18" rx="5.5"/><path d="M12 7v3"/>',
        menu:     '<rect x="4" y="5" width="16" height="14" rx="3.5"/><path d="M8 9.5h8M8 12.5h8M8 15.5h5"/>',
        wire:     '<path d="M6.5 16.5c4 0 4-9 8-9h3"/><circle cx="4.8" cy="16.5" r="1.8"/><circle cx="19.2" cy="7.5" r="1.8"/>',
        dock:     '<rect x="3" y="14.5" width="18" height="6" rx="3"/><path d="M7 10.5h10M9 6.5h6"/>',
        target:   '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
        magnet:   '<path d="M5.5 4h4v7.5a2.5 2.5 0 0 0 5 0V4h4v7.5a6.5 6.5 0 0 1-13 0z"/><path d="M5.5 8h4M14.5 8h4"/>',
        move:     '<path d="M12 3v18M3 12h18M9.5 5.5 12 3l2.5 2.5M9.5 18.5 12 21l2.5-2.5M5.5 9.5 3 12l2.5 2.5M18.5 9.5 21 12l-2.5 2.5"/>',
        radius:   '<circle cx="12" cy="12" r="8.5" stroke-dasharray="3 3"/><path d="M12 12h8.5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
        pin:      '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
        touch:    '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11M12 10.5V9a1.5 1.5 0 0 1 3 0v2M15 10.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.6a5.5 5.5 0 0 1-4.6-2.5L4.5 14.6a1.5 1.5 0 0 1 2.4-1.8L9 15"/>',
        loop:     '<path d="M17 2.5l3 3-3 3"/><path d="M4 11.5v-1a5 5 0 0 1 5-5h11M7 21.5l-3-3 3-3"/><path d="M20 12.5v1a5 5 0 0 1-5 5H4"/>',
        list:     '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r="1.2" fill="currentColor"/><circle cx="4.8" cy="12" r="1.2" fill="currentColor"/><circle cx="4.8" cy="17.5" r="1.2" fill="currentColor"/>',
        braces:   '<path d="M8.5 4C6 4 6 5.5 6 7.5S5.5 11 3.5 12c2 1 2.5 2.5 2.5 4.5S6 20 8.5 20M15.5 4C18 4 18 5.5 18 7.5s.5 3.5 2.5 4.5c-2 1-2.5 2.5-2.5 4.5S18 20 15.5 20"/>',
        text:     '<path d="M5 6.5V5h14v1.5M12 5v14M9 19h6"/>',
        globe:    '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.5 3.5 5.3 3.5 8.5s-1.1 6-3.5 8.5c-2.4-2.5-3.5-5.3-3.5-8.5s1.1-6 3.5-8.5z"/>',
        code:     '<path d="M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15"/>',
        python:   '<path d="M12 3.5c-4 0-4 1.8-4 3V9h4.5v1H5.8c-1.8 0-2.8 1.4-2.8 3.5s1 3.5 2.8 3.5H8"/><path d="M12 20.5c4 0 4-1.8 4-3V15h-4.5v-1h6.7c1.8 0 2.8-1.4 2.8-3.5S20 7 18.2 7H16"/><circle cx="10" cy="5.8" r=".8" fill="currentColor"/><circle cx="14" cy="18.2" r=".8" fill="currentColor"/>',
        note:     '<path d="M5 4.5h14v10l-5 5H5z"/><path d="M14 19.5v-5h5M8.5 9h7M8.5 12.5h4"/>',
        group:    '<rect x="3.5" y="5" width="17" height="14" rx="3" stroke-dasharray="3 2.6"/><path d="M7 9h5"/>',
        fn:       '<path d="M14.5 4.5c-2 0-3 1-3.4 3L9.4 17c-.4 2-1.4 2.5-3 2.5M7.5 10h8M15 13l5 5M20 13l-5 5"/>',
        fnReturn: '<path d="M19 6v5a4 4 0 0 1-4 4H5M9 11l-4 4 4 4"/>',
        fnCall:   '<path d="M5 6.5h9a5 5 0 0 1 0 10H8"/><path d="M11 13.5l-3 3 3 3"/><circle cx="5" cy="16.5" r="1.4" fill="currentColor"/>',
        timer:    '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 1.5M9.5 2.5h5M19 6l1.5-1.5"/>',
        calendar: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
        convert:  '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
        link:     '<path d="M10.2 13.8a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.1 1.1M13.8 10.2a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.1-1.1"/>',
        external: '<path d="M13.5 4.5h6v6M19.5 4.5l-8 8M18 14v3.5a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2H10"/>',
        reload:   '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9M19.5 4v5h-5"/>',
        lock:     '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
        block:    '<rect x="3.5" y="4.5" width="17" height="15" rx="3.5"/><path d="M3.5 9h17"/><path d="M10.5 12.5v4.5l4-2.25z" fill="currentColor" stroke="none"/>',
        broadcast:'<circle cx="12" cy="12" r="2"/><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2"/>',
        antenna:  '<path d="M12 11v9.5M8.5 20.5h7"/><circle cx="12" cy="9" r="2"/><path d="M8 5a5.6 5.6 0 0 0 0 8M16 5a5.6 5.6 0 0 1 0 8"/>',
        bell:     '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
        speaker:  '<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.2 6.5a7.5 7.5 0 0 1 0 11"/>',
        sort:     '<path d="M7 4.5v15M4 16.5l3 3 3-3M13 6.5h7M13 11h5M13 15.5h3"/>',
        heading:  '<path d="M6 5v14M15 5v14M6 12h9M18.5 19V9.5l-2 1.5"/>',
        // значки плиток
        play:     '<path d="M8.5 5.8v12.4a.8.8 0 0 0 1.2.7l9.6-6.2a.8.8 0 0 0 0-1.4L9.7 5.1a.8.8 0 0 0-1.2.7z" fill="currentColor" stroke="none"/>',
        keyboard: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 10h.01M10.3 10h.01M13.7 10h.01M17 10h.01M8 14h8"/>',
        output:   '<path d="M5.5 4.5h13a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H11l-4.5 3.5V17h-1a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2z"/><path d="M8 9h8M8 12.5h5"/>',
        branch:   '<path d="M12 20.5V14L6.5 8.5V4M12 14l5.5-5.5V4M4 6.5 6.5 4 9 6.5M15 6.5 17.5 4 20 6.5"/>',
        clock:    '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
        dice:     '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="8.8" cy="8.8" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/><circle cx="15.2" cy="15.2" r="1.1" fill="currentColor"/>',
        toggle:   '<rect x="2.5" y="7" width="19" height="10" rx="5"/><circle cx="16.5" cy="12" r="2.6" fill="currentColor"/>',
        image:    '<rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5L6 19"/>',
        video:    '<rect x="3" y="6" width="13" height="12" rx="3"/><path d="M16 10.5l5-3v9l-5-3"/>',
        audio:    '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
        textFile: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5M8.5 12.5h7M8.5 16h5"/>',
        file:     '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5"/>',
    };

    function svg(name) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
    }

    function div(cls, text) {
        const el = document.createElement('div');
        el.className = cls;
        if (text != null) el.textContent = text;
        return el;
    }

    /* ---------- Контекстное меню ----------
       items: { label, icon, action, danger, disabled, checked }
              '-'                      — разделитель
              { title }                — подпись раздела
              { colors, onPick }       — ряд цветов (colors — текущий цвет, null — без цвета,
                                         undefined — цвета разные, ничего не отмечено)
              { segments, value, onPick } — переключатель из нескольких вариантов */
    const menu = (() => {
        let el = null;

        function close() {
            if (!el) return;
            const old = el;
            el = null;
            old.classList.remove('open');
            old.classList.add('closing');
            setTimeout(() => old.remove(), 180);
        }

        function swatches(current, onPick) {
            const row = div('swatches');
            const pick = hex => () => { close(); onPick(hex); };
            const none = document.createElement('button');
            none.type = 'button';
            none.className = 'swatch none' + (current === null ? ' active' : '');
            none.title = 'Без цвета';
            none.addEventListener('click', pick(null));
            row.append(none);
            for (const c of COLORS) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'swatch' + (current === c.hex ? ' active' : '');
                b.style.setProperty('--sw', c.hex);
                b.title = c.name;
                b.addEventListener('click', pick(c.hex));
                row.append(b);
            }
            return row;
        }

        // Переключатель-сегменты, как в iOS: { segments: [[id, подпись]...], value, onPick }
        function segments(it) {
            const row = div('segments');
            for (const [id, label] of it.segments) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'segment' + (id === it.value ? ' active' : '');
                b.textContent = label;
                b.addEventListener('click', () => { close(); it.onPick(id); });
                row.append(b);
            }
            return row;
        }

        function item(it) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'menu-item' + (it.danger ? ' danger' : '');
            b.disabled = !!it.disabled;
            if (it.checked !== undefined) {
                const c = document.createElement('span');
                c.className = 'mi-check';
                if (it.checked) c.innerHTML = svg('check');
                b.append(c);
            }
            const l = document.createElement('span');
            l.className = 'mi-label';
            l.textContent = it.label;
            b.append(l);
            if (it.icon) {
                const i = document.createElement('span');
                i.className = 'mi-icon';
                i.innerHTML = svg(it.icon);
                b.append(i);
            }
            b.addEventListener('click', () => { close(); it.action && it.action(); });
            return b;
        }

        function open({ x, y, items, title }) {
            close();
            el = div('menu glass');
            if (title) el.append(div('menu-head', title));
            let lastSep = true;
            for (const it of items) {
                if (!it) continue;
                if (it === '-') {
                    if (!lastSep) el.append(div('menu-sep'));
                    lastSep = true;
                    continue;
                }
                lastSep = false;
                if (it.title) el.append(div('menu-title', it.title));
                else if ('colors' in it) el.append(swatches(it.colors, it.onPick));
                else if (it.segments) el.append(segments(it));
                else el.append(item(it));
            }
            if (el.lastChild && el.lastChild.classList.contains('menu-sep')) el.lastChild.remove();
            document.body.append(el);

            // держим меню в пределах окна (offset-размеры не зависят от анимации масштаба)
            const w = el.offsetWidth, h = el.offsetHeight, m = 8;
            let left = x, top = y;
            if (left + w > innerWidth - m) left = Math.max(m, x - w);
            if (top + h > innerHeight - m) top = Math.max(m, innerHeight - m - h);
            el.style.left = left + 'px';
            el.style.top = top + 'px';
            el.style.transformOrigin = `${x - left}px ${y - top}px`;
            void el.offsetWidth;
            el.classList.add('open');
        }

        document.addEventListener('pointerdown', e => {
            if (el && !el.contains(e.target)) close();
        }, true);
        window.addEventListener('resize', close);
        window.addEventListener('blur', close);

        return { open, close, isOpen: () => !!el };
    })();

    /* ---------- Диалоги (подтверждение и ввод текста) ----------
       validate(значение) → текст ошибки или null: окно не закроется, пока ввод неверный
       bind(cancel)       → отдаёт функцию, которой окно можно закрыть снаружи
       backdropClose      → закрывать ли окно кликом мимо него
       single             → только одна кнопка (сообщение) */
    function dialog({
        title, text, input = false, value = '', placeholder = '', ok = 'OK', cancel = 'Отмена',
        danger = false, validate = null, bind = null, backdropClose = true, maxLength = 80, single = false
    }) {
        return new Promise(resolve => {
            menu.close();
            const back = div('dlg-backdrop');
            const box = div('dlg glass');
            const h = document.createElement('h3');
            h.textContent = title;
            box.append(h);
            if (text) {
                const p = document.createElement('p');
                p.textContent = text;
                box.append(p);
            }
            let field = null;
            if (input) {
                field = document.createElement('input');
                field.type = 'text';
                field.className = 'dlg-input';
                field.value = value;
                field.placeholder = placeholder;
                field.spellcheck = false;
                field.maxLength = maxLength;
                box.append(field);
            }
            const err = div('dlg-error');
            if (input) box.append(err);
            const btns = div('dlg-btns');
            const no = document.createElement('button');
            no.type = 'button';
            no.className = 'dlg-btn';
            no.textContent = cancel;
            const yes = document.createElement('button');
            yes.type = 'button';
            yes.className = 'dlg-btn ' + (danger ? 'danger' : 'primary');
            yes.textContent = ok;
            if (!single) btns.append(no);
            btns.append(yes);
            box.append(btns);
            back.append(box);

            let done = false;
            const finish = v => {
                if (done) return;
                done = true;
                back.classList.remove('open');
                setTimeout(() => back.remove(), 240);
                resolve(v);
            };
            const dismiss = () => finish(input ? null : false);
            no.addEventListener('click', dismiss);
            yes.addEventListener('click', () => {
                if (!input) return finish(true);
                const problem = validate && validate(field.value);
                if (!problem) return finish(field.value);
                err.textContent = problem;
                box.classList.remove('shake');
                void box.offsetWidth;
                box.classList.add('shake');
                field.focus();
            });
            if (backdropClose) back.addEventListener('pointerdown', e => { if (e.target === back) dismiss(); });
            if (bind) bind(dismiss);

            document.body.append(back);
            void back.offsetWidth;
            back.classList.add('open');
            if (field) {
                field.focus();
                field.select();
                // Enter внутри поля ввода подтверждает (это текстовый ввод, а не горячая клавиша)
                field.addEventListener('keydown', e => { if (e.key === 'Enter') yes.click(); });
            }
        });
    }

    const confirm = o => dialog(o);
    const prompt = o => dialog({ ...o, input: true });
    const alert = o => dialog({ ok: 'Понятно', ...o, single: true });

    /* ---------- Большое окно-панель (статистика, обучение) ---------- */
    function panel({ title, body, className = '' }) {
        menu.close();
        const back = div('panel-backdrop');
        const box = div('panel glass ' + className);
        const head = div('panel-head');
        const h = document.createElement('h2');
        h.textContent = title;
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'round-btn';
        x.setAttribute('aria-label', 'Закрыть');
        x.innerHTML = svg('close');
        head.append(h, x);
        const content = div('panel-body');
        content.append(body);
        box.append(head, content);
        back.append(box);

        const close = () => {
            back.classList.remove('open');
            setTimeout(() => back.remove(), 320);
        };
        x.addEventListener('click', close);
        back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
        document.body.append(back);
        void back.offsetWidth;
        back.classList.add('open');
        return { close, el: box };
    }

    /* ---------- Сенсорный экран ---------- */
    const isTouch = () => matchMedia('(pointer: coarse)').matches;

    // Кружок-отклик под пальцем при долгом нажатии
    function pressRing(x, y) {
        const ring = div('press-ring');
        ring.style.left = x + 'px';
        ring.style.top = y + 'px';
        document.body.append(ring);
        setTimeout(() => ring.remove(), 600);
        if (navigator.vibrate) navigator.vibrate(12);
    }

    // Долгое нажатие пальцем — замена правой кнопки мыши.
    // selector — на каких элементах внутри el оно срабатывает; клик после него отменяется.
    function longPress(el, cb, { selector = null, ms = 480 } = {}) {
        let timer = 0, start = null, fired = false;
        const cancel = () => clearTimeout(timer);
        el.addEventListener('pointerdown', e => {
            if (e.pointerType !== 'touch') return;
            const target = selector ? e.target.closest(selector) : el;
            if (!target || !el.contains(target)) return;
            fired = false;
            start = { x: e.clientX, y: e.clientY, id: e.pointerId };
            cancel();
            timer = setTimeout(() => {
                fired = true;
                pressRing(start.x, start.y);
                cb(target, start.x, start.y);
            }, ms);
        });
        el.addEventListener('pointermove', e => {
            if (start && e.pointerId === start.id && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
        });
        el.addEventListener('pointerup', cancel);
        el.addEventListener('pointercancel', cancel);
        el.addEventListener('click', e => {
            if (!fired) return;
            fired = false;
            e.preventDefault();
            e.stopImmediatePropagation();
        }, true);
    }

    /* ---------- Колесо мыши ---------- */
    // Сдвиг колеса в пикселях (у некоторых мышей он приходит «строками» или «страницами»)
    function wheelDelta(e, page = innerHeight) {
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? page : 1;
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        return { x: e.deltaX * unit, y: e.deltaY * unit, main: d * unit };
    }

    // Плавная горизонтальная прокрутка ряда колесом мыши
    function hscroll(el) {
        let target = 0, raf = 0;
        const max = () => Math.max(0, el.scrollWidth - el.clientWidth);
        const step = () => {
            const cur = el.scrollLeft, d = target - cur;
            if (Math.abs(d) < 1) { el.scrollLeft = target; raf = 0; return; }
            let s = d * 0.22;
            if (Math.abs(s) < 1) s = Math.sign(d) * Math.min(Math.abs(d), 1);
            el.scrollLeft = cur + s;
            if (el.scrollLeft === cur) { raf = 0; return; }   // упёрлись в край
            raf = requestAnimationFrame(step);
        };
        return {
            by(delta) {
                if (!raf) target = el.scrollLeft;
                target = Math.max(0, Math.min(max(), target + delta));
                if (!raf) raf = requestAnimationFrame(step);
            },
            stop() {
                cancelAnimationFrame(raf);
                raf = 0;
            },
            canScroll: () => max() > 1
        };
    }

    /* ---------- Уведомление сверху ---------- */
    let toastEl = null, toastTimer = 0;
    function toast(text) {
        if (!toastEl) {
            toastEl = div('toast glass');
            document.body.append(toastEl);
        }
        toastEl.textContent = text;
        void toastEl.offsetWidth;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
    }

    return {
        COLORS, ICONS, svg, div, menu, confirm, prompt, alert, panel, toast,
        wheelDelta, hscroll, isTouch, pressRing, longPress
    };
})();
