/* Short Desk — контекстные меню (ПКМ).
   Все действия и настройки доски доступны только отсюда. */
const Menus = (() => {
    function init() {
        Board.on('context', show);
    }

    function show(c) {
        const build = {
            tile: tileMenu, selection: selectionMenu, link: linkMenu, point: pointMenu, empty: emptyMenu,
            target: targetMenu, magnet: magnetMenu
        }[c.kind];
        if (!build) return;
        const menu = build(c);
        UI.menu.open({ x: c.x, y: c.y, title: menu.title, items: menu.items });
    }

    /* ---------- Плитка ---------- */
    function tileMenu(c) {
        const t = Board.getTile(c.tile);
        if (!t) return { items: [] };
        const hasLinks = Board.linksOf(t.id).length > 0;
        const hasLog = t.type === 'out' && t.log.length > 0;
        const file = t.def.media && t.asset && Storage.asset(t.asset);
        const page = t.def.body === 'web' && t.fields.page;
        return {
            title: Nodes.titleOf(t),
            items: [
                t.def.runButton && runItem([t.id]),
                page && { label: 'Открыть в новой вкладке', icon: 'external', action: () => Web.openTab(t) },
                page && { label: 'Обновить страницу', icon: 'reload', action: () => Web.reload(t) },
                page && { label: 'Закрыть страницу', icon: 'close', action: () => Web.close(t) },
                page && '-',
                hasLog && { label: 'Сохранить результат', icon: 'download', action: () => Storage.saveOutput(t.id) },
                hasLog && { label: 'Очистить вывод', icon: 'clear', action: () => { Nodes.logClear(t, 'Здесь появятся результаты'); Board.noteChange(); } },
                file && { label: 'Скачать', icon: 'download', action: () => Storage.downloadTile(t.id) },
                t.def.media && { label: t.asset ? 'Заменить файл…' : 'Выбрать файл…', icon: t.asset ? 'replace' : 'upload', action: () => Storage.pickForTile(t.id) },
                (t.def.runButton || hasLog || t.def.media) && '-',
                { label: 'Переименовать', icon: 'pencil', action: () => rename(t.id) },
                { label: 'Дублировать', icon: 'copy', action: () => Board.duplicate([t.id]) },
                hasLinks && { label: 'Отсоединить линии', icon: 'unlink', action: () => Board.disconnect(t.id) },
                { label: 'Поставить магнит', icon: 'magnet', action: () => Board.magnetOnTile(t.id) },
                '-',
                { title: 'Цвет' },
                { colors: t.color, onPick: hex => Board.setTileColor([t.id], hex) },
                '-',
                { label: 'Удалить', icon: 'trash', danger: true, action: () => Board.removeTiles([t.id]) }
            ]
        };
    }

    /* ---------- Таргет ---------- */
    function targetMenu(c) {
        const g = Board.getItem(c.item);
        if (!g) return { items: [] };
        return {
            title: g.name,
            items: [
                { label: 'Переименовать', icon: 'pencil', action: () => renameItem(g.id) },
                { label: 'Дублировать', icon: 'copy', action: () => Board.duplicate([], [g.id]) },
                '-',
                { title: 'Цвет' },
                { colors: g.color, onPick: hex => Board.setTileColor([g.id], hex) },
                '-',
                { label: 'Удалить', icon: 'trash', danger: true, action: () => Board.removeItems([g.id]) }
            ]
        };
    }

    /* ---------- Магнит ---------- */
    function magnetMenu(c) {
        const m = Board.getItem(c.item);
        if (!m) return { items: [] };
        const partners = Board.linksOf(m.id).length;
        const held = m.captured && Board.getTile(m.captured);
        return {
            title: `${m.name} · ${held ? 'держит «' + Nodes.titleOf(held) + '»' : 'пусто'}`,
            items: [
                { label: 'Переименовать', icon: 'pencil', action: () => renameItem(m.id) },
                { label: `Радиус: ${m.r}…`, icon: 'radius', action: () => askRadius(m.id) },
                { label: 'Дублировать', icon: 'copy', action: () => Board.duplicate([], [m.id]) },
                partners > 0 && { label: `Отсоединить партнёров (${partners})`, icon: 'unlink', action: () => Board.disconnect(m.id) },
                '-',
                { title: 'Цвет' },
                { colors: m.color, onPick: hex => Board.setTileColor([m.id], hex) },
                '-',
                { label: 'Удалить', icon: 'trash', danger: true, action: () => Board.removeItems([m.id]) }
            ]
        };
    }

    async function askRadius(id) {
        const m = Board.getItem(id);
        if (!m) return;
        const v = await UI.prompt({
            title: 'Радиус магнита',
            text: 'Плитка, центр которой попал в этот круг, соединится с партнёрами магнита. Радиус можно менять и мышью — за белую точку на краю круга.',
            value: String(m.r), ok: 'Готово',
            validate: x => {
                const n = Nodes.parseNum(x);
                return n === null || n < 20 || n > 3000 ? 'Число от 20 до 3000' : null;
            }
        });
        if (v !== null) Board.setMagnetRadius(id, Nodes.parseNum(v));
    }

    async function renameItem(id) {
        const it = Board.getItem(id);
        if (!it) return;
        const v = await UI.prompt({
            title: it.kind === 'target' ? 'Переименовать таргет' : 'Переименовать магнит',
            value: it.name, ok: 'Готово'
        });
        if (v !== null) Board.renameItem(id, v);
    }

    /* ---------- Выделенная группа ---------- */
    function selectionMenu() {
        const ids = Board.selectedTiles(), items = Board.selectedItems();
        const all = [...ids, ...items];
        const colorOf = id => (Board.getTile(id) || Board.getItem(id)).color;
        const first = all.length ? colorOf(all[0]) : undefined;
        const same = all.length && all.every(id => colorOf(id) === first);
        const any = all.length > 0;
        return {
            title: 'Выделено: ' + countText(ids.length, items.length, Board.selectionSize() - all.length),
            items: [
                any && { label: 'Дублировать', icon: 'copy', action: () => Board.duplicate(ids, items) },
                any && { label: 'Сгруппировать', icon: 'group', action: () => Board.groupSelection() },
                any && { label: 'Сделать блоком', icon: 'block', action: () => Board.groupSelection('block') },
                any && { label: 'Экспортировать выделенное', icon: 'download', action: () => Storage.saveBoard({ selection: true }) },
                { label: 'Снять выделение', icon: 'deselect', action: () => Board.clearSelection() },
                any && '-',
                any && { title: 'Цвет' },
                any && { colors: same ? first : undefined, onPick: hex => Board.setTileColor(all, hex) },
                '-',
                { label: 'Удалить выделенное', icon: 'trash', danger: true, action: deleteSelection }
            ]
        };
    }

    async function deleteSelection() {
        const n = Board.selectedTiles().length;
        if (n >= 5) {
            const ok = await UI.confirm({
                title: 'Удалить выделенное?',
                text: `Будет удалено плиток: ${n}. Их линии тоже исчезнут.`,
                ok: 'Удалить', danger: true
            });
            if (!ok) return;
        }
        Board.deleteSelection();
    }

    /* ---------- Линия ---------- */
    function linkMenu(c) {
        const l = Board.getLink(c.link);
        if (!l) return { items: [] };
        return {
            title: 'Линия',
            items: [
                { label: 'Добавить точку', icon: 'point', action: () => Board.addPoint(l.id, c.wx, c.wy) },
                { label: 'Развернуть', icon: 'reverse', action: () => Board.reverseLink(l.id) },
                l.points.length && { label: 'Убрать все точки', icon: 'noPoints', action: () => Board.clearPoints(l.id) },
                '-',
                ...bendItems(l),
                '-',
                { title: 'Цвет' },
                { colors: l.color, onPick: hex => Board.setLinkColor(l.id, hex) },
                '-',
                { label: 'Удалить линию', icon: 'trash', danger: true, action: () => Board.removeLink(l.id) }
            ]
        };
    }

    function bendItems(l) {
        return [
            { title: 'Изгибы' },
            { label: 'Скруглённые', icon: 'curve', checked: l.bend === 'curve', action: () => Board.setLinkBend(l.id, 'curve') },
            { label: 'Прямые углы', icon: 'angle', checked: l.bend === 'angle', action: () => Board.setLinkBend(l.id, 'angle') }
        ];
    }

    /* ---------- Точка линии ---------- */
    function pointMenu(c) {
        const l = Board.getLink(c.link);
        if (!l) return { items: [] };
        return {
            title: 'Точка линии',
            items: [
                { label: 'Удалить точку', icon: 'trash', action: () => Board.removePoint(l.id, c.point) },
                l.points.length > 1 && { label: 'Убрать все точки', icon: 'noPoints', action: () => Board.clearPoints(l.id) },
                '-',
                ...toTargets(`p:${l.id}/${c.point}`),
                '-',
                ...bendItems(l),
                '-',
                { label: 'Удалить линию', icon: 'trash', danger: true, action: () => Board.removeLink(l.id) }
            ]
        };
    }

    // «Переместить на таргет»: список таргетов доски
    function toTargets(ref) {
        const list = [...Board.targets.values()].slice(0, 12);
        if (!list.length) return [];
        return [
            { title: 'Переместить на таргет' },
            ...list.map(g => ({
                label: g.name, icon: 'target',
                action: () => {
                    Board.moveRef(ref, g.x, g.y, 380);
                    Board.requestMagnets(420);
                }
            }))
        ];
    }

    /* ---------- Пустое место ---------- */
    function emptyMenu(c) {
        const has = !!Board.contentBounds();
        const s = Board.settings;
        const at = { x: c.wx, y: c.wy };
        return {
            // координаты точки — пригодятся для «Переместить плитку → координаты»
            title: `X ${Math.round(c.wx)} · Y ${Math.round(c.wy)}`,
            items: [
                runItem(),
                '-',
                { label: 'Добавить плитку сюда', icon: 'addTile', action: () => Palette.open({ at }) },
                { label: 'Таргет сюда', icon: 'target', action: () => Board.addTarget({ at, animate: true, select: true }) },
                { label: 'Магнит сюда', icon: 'magnet', action: () => Board.addMagnet({ at, animate: true, select: true }) },
                { label: 'Вставить из буфера обмена', icon: 'paste', action: () => Storage.pasteFromClipboard(at) },
                '-',
                has && { label: 'Показать всю доску', icon: 'fit', action: () => Board.fitAll() },
                { label: 'Масштаб 100 %', icon: 'zoom', action: () => Board.zoomTo(1) },
                has && { label: 'Выделить всё', icon: 'selectAll', action: () => Board.selectAll() },
                '-',
                { title: 'Доска' },
                { label: 'Сетка', icon: 'grid', checked: s.grid, action: () => Board.setSetting('grid', !s.grid) },
                { label: 'Привязка к сетке', icon: 'magnetGrid', checked: s.snap, action: () => Board.setSetting('snap', !s.snap) },
                '-',
                ...runSettings(),
                has && '-',
                ...(has ? imageItems() : []),
                has && '-',
                has && { label: 'Очистить доску', icon: 'clear', danger: true, action: clearBoard }
            ]
        };
    }

    // Экспорт доски картинкой PNG
    function imageItems() {
        return [
            { title: 'Картинка PNG' },
            { label: 'Вся доска', icon: 'image', action: () => Storage.exportImage('all') },
            { label: 'Видимая область', icon: 'fit', action: () => Storage.exportImage('view') }
        ];
    }

    /* ---------- Выполнение ---------- */
    // «Запустить» / «Остановить» (ids — какие «Запуски» стартовать; без них — все)
    function runItem(ids) {
        if (Engine.isRunning()) return { label: 'Остановить', icon: 'stop', action: () => Engine.stop() };
        return { label: ids ? 'Запустить' : 'Запустить программу', icon: 'play', action: () => Engine.start(ids) };
    }

    function runSettings() {
        const s = Board.settings;
        return [
            { title: 'Скорость выполнения' },
            {
                segments: [['slow', 'Медленно'], ['fast', 'Быстро'], ['instant', 'Мгновенно']],
                value: s.speed, onPick: id => Board.setSetting('speed', id)
            },
            { label: `Лимит шагов: ${s.stepLimit}`, icon: 'limit', action: askLimit }
        ];
    }

    async function askLimit() {
        const v = await UI.prompt({
            title: 'Лимит шагов',
            text: 'Сколько раз плитки могут сработать за один запуск. Защищает от бесконечных циклов.',
            value: String(Board.settings.stepLimit), ok: 'Сохранить',
            validate: x => {
                const n = Nodes.parseNum(x);
                return n === null || n < 10 || n > 1000000 || n % 1 ? 'Целое число от 10 до 1 000 000' : null;
            }
        });
        if (v !== null) Board.setSetting('stepLimit', Nodes.parseNum(v));
    }

    /* ---------- Кнопка «+» (ПКМ) ---------- */
    function plusMenu(x, y) {
        const has = !!Board.contentBounds();
        UI.menu.open({
            x, y,
            items: [
                { label: 'Добавить плитку', icon: 'addTile', action: () => Palette.open() },
                runItem(),
                '-',
                { label: 'Сохранить доску', icon: 'download', action: () => Storage.saveBoard() },
                { label: 'Загрузить код', icon: 'folder', action: () => Storage.pickBoards() },
                { label: 'Загрузить файл', icon: 'upload', action: () => Storage.pickFiles() },
                has && '-',
                ...(has ? imageItems() : []),
                '-',
                { label: 'Статистика', icon: 'stats', action: () => App.showStats() },
                { label: 'Обучение', icon: 'help', action: () => App.showTutorial() },
                has && '-',
                has && { label: 'Очистить доску', icon: 'clear', danger: true, action: clearBoard }
            ]
        });
    }

    /* ---------- Миниатюра плитки в нижней панели (ПКМ) ---------- */
    function thumbMenu(id, x, y) {
        const t = Board.getTile(id);
        if (!t) return;
        const picked = Board.isSelected(id);
        // миниатюра из выделенной группы — меню всего выделенного
        if (picked && Board.selectionSize() > 1) {
            const m = selectionMenu();
            UI.menu.open({ x, y, title: m.title, items: m.items });
            return;
        }
        UI.menu.open({
            x, y,
            title: Nodes.titleOf(t),
            items: [
                { label: 'Переименовать', icon: 'pencil', action: () => rename(id) },
                { label: picked ? 'Снять выделение' : 'Выделить', icon: picked ? 'deselect' : 'select', action: () => Board.toggleTile(id) },
                '-',
                { title: 'Цвет' },
                { colors: t.color, onPick: hex => Board.setTileColor([id], hex) },
                '-',
                { label: 'Удалить', icon: 'trash', danger: true, action: () => Board.removeTiles([id]) }
            ]
        });
    }

    /* ---------- Общие действия ---------- */
    async function rename(id) {
        const t = Board.getTile(id);
        if (!t) return;
        const v = await UI.prompt({
            title: 'Переименовать плитку',
            text: 'Пустое имя вернёт стандартное название.',
            value: Nodes.titleOf(t), placeholder: t.def.title, ok: 'Готово'
        });
        if (v !== null) Board.renameTile(id, v);
    }

    async function clearBoard() {
        const ok = await UI.confirm({
            title: 'Очистить доску?',
            text: 'Все плитки, линии, таргеты и магниты будут удалены. Это нельзя отменить.',
            ok: 'Очистить', danger: true
        });
        if (ok) Board.clear();
    }

    function countText(tilesN, itemsN, pointsN) {
        const parts = [];
        if (tilesN) parts.push(`${tilesN} ${plural(tilesN, 'плитка', 'плитки', 'плиток')}`);
        if (itemsN) parts.push(`${itemsN} ${plural(itemsN, 'метка', 'метки', 'меток')}`);
        if (pointsN) parts.push(`${pointsN} ${plural(pointsN, 'точка', 'точки', 'точек')}`);
        return parts.join(', ');
    }

    function plural(n, one, few, many) {
        const m10 = n % 10, m100 = n % 100;
        if (m10 === 1 && m100 !== 11) return one;
        if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
        return many;
    }

    return { init, plusMenu, thumbMenu, rename, plural };
})();
