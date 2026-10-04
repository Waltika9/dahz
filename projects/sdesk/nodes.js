/* Short Desk — типы плиток.
   Каждая плитка описана данными: категория, значок, контакты (порты), поля
   и функция run — что плитка делает, когда до неё дошли данные.

   Устройство описания:
     head: { in, out }        — контакты в строке заголовка
     rows: [{ in, out, label, field, showIf }]
       in / out — id контакта слева / справа в этой строке
       field    — поле настройки { key, type: number|text|select|toggle, value, options }
                  Если в строке есть и вход, и поле, то при подключённой линии
                  значение берётся из линии, а поле прячется.
       showIf   — когда строка активна (иначе она приглушена)
     run(c)     — выполнение. c.get(имя) — значение входа (или поля, если вход не подключён),
                  c.input — значение главного входа, c.emit(контакт, значение) — отправить дальше.
                  Если run что-то вернул, это уходит на контакт 'out'.
     selfTimed  — плитка сама показывает свой прогресс (ожидание, ввод) */
const Nodes = (() => {
    const CATEGORIES = [
        { id: 'control', name: 'Управление', color: '#5E5CE6', icon: 'branch' },
        { id: 'input',   name: 'Ввод',       color: '#0A84FF', icon: 'keyboard' },
        { id: 'output',  name: 'Вывод',      color: '#FFD60A', icon: 'output', dark: true },
        { id: 'logic',   name: 'Логика',     color: '#BF5AF2', glyph: '∧' },
        { id: 'math',    name: 'Математика', color: '#30D158', glyph: '+' },
        { id: 'compare', name: 'Сравнения',  color: '#64D2FF', glyph: '≥', dark: true },
        { id: 'vars',    name: 'Переменные', color: '#FF375F', glyph: 'x' },
        { id: 'data',    name: 'Списки и словари', color: '#63E6E2', icon: 'list', dark: true },
        { id: 'text',    name: 'Текст',      color: '#AC8E68', icon: 'text' },
        { id: 'time',    name: 'Время',      color: '#FF453A', icon: 'timer' },
        { id: 'net',     name: 'Сеть',       color: '#5AC8FA', icon: 'globe', dark: true },
        { id: 'code',    name: 'Код',        color: '#3776AB', icon: 'python' },
        { id: 'board',   name: 'Доска',      color: '#40C8E0', icon: 'move' },
        { id: 'media',   name: 'Медиа и файлы', color: '#FF9F0A', icon: 'image' },
        { id: 'service', name: 'Служебные',  color: '#8E8E93', icon: 'note' },
    ];
    const CAT = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
    const TYPES = {};
    const ORDER = [];

    function def(id, spec) {
        const d = { id, width: 220, head: {}, rows: [], desc: '', keywords: '', ...spec };
        // поля-ссылки на объекты доски (их нужно пересчитывать при загрузке и копировании)
        const refs = d.rows.filter(r => r.field && r.field.type === 'ref').map(r => r.field.key);
        if (refs.length) d.refs = refs;
        TYPES[id] = d;
        ORDER.push(id);
    }

    /* ---------- Значения: правила как в Python ---------- */
    const SIGNAL = Object.freeze({ signal: true });     // то, что отправляет «Запуск»
    class RunError extends Error {}
    const fail = msg => { throw new RunError(msg); };

    function parseNum(s) {
        const t = String(s).trim().replace(',', '.').replace(/\s+/g, '');
        if (t === '') return null;
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
    }

    // Число из значения: true → 1, "2,5" → 2.5, остальное → null
    function asNumber(v) {
        if (typeof v === 'number') return v;
        if (typeof v === 'boolean') return v ? 1 : 0;
        if (typeof v === 'string') return parseNum(v);
        return null;
    }

    // Словарь — обычный объект (но не файл и не сигнал запуска)
    const isDict = v => !!v && typeof v === 'object' && !Array.isArray(v) && v !== SIGNAL && !isMedia(v);

    // Истинность как в Python: 0, "", пустой список, пустой словарь и None — ложь
    function truthy(v) {
        if (v === SIGNAL) return true;
        if (v == null) return false;
        if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
        if (typeof v === 'string' || Array.isArray(v)) return v.length > 0;
        if (isDict(v)) return Object.keys(v).length > 0;
        return Boolean(v);
    }

    // Убираем хвосты вроде 0.30000000000000004 и 1.2e-16
    const clean = x => Math.abs(x) < 1e-12 ? 0 : Number(x.toPrecision(12));

    function result(x) {
        if (Number.isNaN(x)) fail('результат не определён');
        if (!Number.isFinite(x)) fail('слишком большое число');
        return clean(x);
    }

    // Файл как значение: { media: вид, asset: id, name, type }
    const MEDIA_MARK = { image: '🖼', video: '🎬', audio: '🎵', text: '📄', file: '📦' };
    function isMedia(v) { return !!v && typeof v === 'object' && typeof v.media === 'string' && !!v.asset; }
    const mediaRef = (asset, tile) => Object.freeze({
        media: tile.def.media, asset: asset.id, name: tile.fileName || asset.name, type: asset.type
    });

    function fmt(v) {
        if (v === SIGNAL) return '▶ сигнал';
        if (v == null) return 'None';
        if (isMedia(v)) return `${MEDIA_MARK[v.media] || '📦'} ${v.name}`;
        if (typeof v === 'boolean') return v ? 'True' : 'False';
        if (typeof v === 'number') {
            if (Number.isNaN(v)) return 'nan';
            if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
            return String(clean(v));
        }
        if (Array.isArray(v)) return '[' + v.map(repr).join(', ') + ']';
        if (isDict(v)) return '{' + Object.entries(v).map(([k, x]) => `${repr(k)}: ${repr(x)}`).join(', ') + '}';
        return String(v);
    }

    // Внутри списков и словарей строки пишутся в кавычках, как в Python
    const repr = x => (typeof x === 'string' ? `'${x}'` : fmt(x));

    function kindOf(v) {
        if (v === SIGNAL) return 'sig';
        if (v == null) return 'none';
        if (typeof v === 'number') return 'num';
        if (typeof v === 'boolean') return 'bool';
        if (Array.isArray(v)) return 'list';
        if (isMedia(v)) return 'media';
        if (isDict(v)) return 'dict';
        return 'str';
    }

    // Имя типа, как type(x).__name__ в Python
    function typeName(v) {
        if (v == null || v === SIGNAL) return 'NoneType';
        if (typeof v === 'boolean') return 'bool';
        if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
        if (typeof v === 'string') return 'str';
        if (Array.isArray(v)) return 'list';
        if (isMedia(v)) return 'file';
        return 'dict';
    }

    // Ввод «авто»: число, логическое или текст
    function parseAuto(s) {
        const n = parseNum(s);
        if (n !== null) return n;
        const low = s.trim().toLowerCase();
        if (low === 'true' || low === 'истина') return true;
        if (low === 'false' || low === 'ложь') return false;
        return s;
    }

    // Равенство: числа сравниваются как числа, остальное — как текст
    function same(a, b) {
        const x = asNumber(a), y = asNumber(b);
        if (x !== null && y !== null) return x === y;
        return fmt(a) === fmt(b);
    }

    function order(a, b) {
        const x = asNumber(a), y = asNumber(b);
        if (x !== null && y !== null) return x - y;
        return fmt(a).localeCompare(fmt(b), 'ru');
    }

    function test(op, a, b) {
        switch (op) {
            case 'truthy': return truthy(a);
            case 'eq': return same(a, b);
            case 'ne': return !same(a, b);
            case 'gt': return order(a, b) > 0;
            case 'lt': return order(a, b) < 0;
            case 'ge': return order(a, b) >= 0;
            case 'le': return order(a, b) <= 0;
            case 'has':
                if (Array.isArray(a)) return a.some(x => same(x, b));
                if (isDict(a)) return Object.prototype.hasOwnProperty.call(a, fmt(b));
                return fmt(a).includes(fmt(b));
            case 'empty': return !truthy(a) && typeof a !== 'number' && typeof a !== 'boolean';
        }
        return false;
    }

    function varName(c) {
        const name = String(c.f('name') || '').trim();
        if (!name) fail('не указано имя переменной');
        return name;
    }

    // Частые куски описаний
    const THROUGH = { in: 'in', out: 'out' };
    const A = { in: 'a', label: 'A' };
    const B = (value, type = 'number') => ({ in: 'b', label: 'B', field: { key: 'b', type, value } });

    /* ── Управление ── */
    def('start', {
        cat: 'control', sub: 'Основное', title: 'Запуск', icon: 'play', runButton: true,
        desc: 'С этой плитки начинается выполнение программы', keywords: 'start run старт начало',
        head: { out: 'out' },
        // внутри блока «Запуск» передаёт значение, с которым запустили блок
        run: c => (c.input === undefined ? SIGNAL : c.input)
    });
    def('if', {
        cat: 'control', sub: 'Условия', title: 'Если / Иначе', icon: 'branch', width: 240,
        desc: 'Проверяет условие и отправляет значение по ветке «Да» или «Иначе»',
        keywords: 'if else условие ветвление если иначе',
        head: { in: 'in' },
        rows: [
            { label: 'Условие', field: { key: 'op', type: 'select', value: 'truthy', options: () => OPS } },
            { in: 'b', label: 'С чем', field: { key: 'b', type: 'text', value: '0' },
              showIf: f => f.op !== 'truthy' && f.op !== 'empty' },
            { out: 'yes', label: 'Да' },
            { out: 'no', label: 'Иначе' }
        ],
        run(c) {
            const ok = test(c.f('op'), c.input, c.get('b'));
            c.emit(ok ? 'yes' : 'no', c.input);
        }
    });
    def('wait', {
        cat: 'control', sub: 'Время', title: 'Подождать', icon: 'clock', selfTimed: true,
        desc: 'Ждёт N секунд и передаёт значение дальше', keywords: 'wait sleep пауза задержка секунды',
        head: THROUGH,
        rows: [{ in: 'sec', label: 'Секунд', field: { key: 'sec', type: 'number', value: 1 } }],
        async run(c) {
            const s = c.num(c.get('sec'), 'Секунд');
            if (s < 0) fail('время ожидания не может быть отрицательным');
            await c.sleep(s * 1000);
            return c.input;
        }
    });
    def('once', {
        cat: 'control', sub: 'Условия', title: 'Только первый раз', glyph: '1×',
        desc: 'Пропускает только первое пришедшее значение за запуск, остальные — на «Потом»',
        keywords: 'once один раз первый однократно',
        head: { in: 'in' },
        rows: [{ out: 'first', label: 'Первый раз' }, { out: 'later', label: 'Потом' }],
        run(c) {
            const m = c.memo();
            c.emit(m.done ? 'later' : 'first', c.input);
            m.done = true;
        }
    });
    def('counter', {
        cat: 'control', sub: 'Условия', title: 'Счётчик', glyph: '+1',
        desc: 'Считает, сколько раз сработал за запуск, и передаёт номер: 1, 2, 3…',
        keywords: 'counter счётчик сколько раз номер',
        head: THROUGH,
        rows: [{ label: 'Начать с', field: { key: 'from', type: 'number', value: 1 } }],
        run(c) {
            const m = c.memo();
            m.n = m.n === undefined ? c.num(c.f('from'), 'Начать с') : m.n + 1;
            return m.n;
        }
    });

    /* ── Блоки и сигналы: отдельные части программы ── */
    def('block', {
        cat: 'control', sub: 'Блоки', title: 'Блок', icon: 'block', runButton: true, block: true,
        body: 'group', extra: { gw: 520, gh: 300 },
        desc: 'Рамка-программа: ▶ запускает только «Запуски» внутри неё. Линия в блок тоже запускает его, а дальше значение уходит, когда всё внутри отработает',
        keywords: 'block блок рамка часть программа раздел запустить отдельно',
        head: THROUGH, selfTimed: true,
        async run(c) {
            c.waiting();
            return c.runBlock(c.input);
        }
    });
    const SIG_NAME = { label: 'Сигнал', field: { key: 'name', type: 'text', value: 'сигнал 1' } };
    const sigName = c => String(c.f('name') || '').trim() || fail('не указано имя сигнала');
    def('send', {
        cat: 'control', sub: 'Блоки', title: 'Отправить сигнал', icon: 'broadcast', selfTimed: true,
        desc: 'Передаёт значение всем плиткам «Получить сигнал» с тем же именем — без линий, хоть в другой блок',
        keywords: 'send broadcast сигнал отправить сообщение событие',
        head: THROUGH,
        rows: [SIG_NAME, { label: 'Ждать получателей', field: { key: 'wait', type: 'toggle', value: false } }],
        async run(c) {
            const name = sigName(c);
            if (c.f('wait')) c.waiting();
            await c.broadcast(name, c.input, c.f('wait'));
            return c.input;
        }
    });
    def('receive', {
        cat: 'control', sub: 'Блоки', title: 'Получить сигнал', icon: 'antenna',
        desc: 'Срабатывает, когда где-то отправили сигнал с этим именем, и передаёт его значение',
        keywords: 'receive when сигнал получить событие когда',
        head: { out: 'out' }, rows: [SIG_NAME],
        run: c => c.input
    });

    /* ── Ввод ── */
    def('ask', {
        cat: 'input', sub: 'Ввод', title: 'Input', icon: 'keyboard', selfTimed: true,
        desc: 'Спрашивает значение у пользователя, как input() в Python',
        keywords: 'input ввод спросить prompt вопрос',
        head: THROUGH,
        rows: [
            { label: 'Вопрос', field: { key: 'prompt', type: 'text', value: 'Введите значение' } },
            { label: 'Тип', field: { key: 'kind', type: 'select', value: 'auto', options: [
                ['auto', 'авто'], ['num', 'число'], ['text', 'текст']
            ] } }
        ],
        run: c => c.ask(c.f('prompt'), c.f('kind'))
    });
    def('yesno', {
        cat: 'input', sub: 'Ввод', title: 'Вопрос Да / Нет', icon: 'help', selfTimed: true, width: 240,
        desc: 'Показывает вопрос с кнопками «Да» и «Нет» и отправляет значение по выбранной ветке',
        keywords: 'confirm вопрос да нет подтверждение выбор',
        head: { in: 'in' },
        rows: [
            { in: 'q', label: 'Вопрос', field: { key: 'q', type: 'text', value: 'Продолжить?' } },
            { out: 'yes', label: 'Да' },
            { out: 'no', label: 'Нет' }
        ],
        async run(c) {
            const ok = await c.dialog({ title: toText(c.get('q')).trim() || 'Продолжить?', text: `Плитка «${titleOf(c.tile)}»`, ok: 'Да', cancel: 'Нет' });
            c.emit(ok ? 'yes' : 'no', c.input);
        }
    });
    def('num', {
        cat: 'input', sub: 'Константы', title: 'Число', glyph: '#',
        desc: 'Передаёт заданное число', keywords: 'number константа число',
        head: THROUGH, rows: [{ field: { key: 'value', type: 'number', value: 0 } }],
        run: c => c.f('value')
    });
    def('str', {
        cat: 'input', sub: 'Константы', title: 'Текст', glyph: 'Aa',
        desc: 'Передаёт заданный текст', keywords: 'string строка константа текст',
        head: THROUGH, rows: [{ field: { key: 'value', type: 'text', value: '' } }],
        run: c => String(c.f('value'))
    });
    def('bool', {
        cat: 'input', sub: 'Константы', title: 'Логическое', icon: 'toggle',
        desc: 'Передаёт «истину» или «ложь»', keywords: 'boolean bool константа логическое',
        head: THROUGH, rows: [{ label: 'Истина', field: { key: 'value', type: 'toggle', value: true } }],
        run: c => !!c.f('value')
    });

    /* ── Вывод ── */
    def('out', {
        cat: 'output', sub: 'Вывод', title: 'Вывод', icon: 'output', width: 260,
        desc: 'Показывает результаты по мере их поступления', keywords: 'output print вывод результат',
        head: { in: 'in' }, body: 'log',
        run(c) { c.log(c.input); }
    });
    // текст для показа: пришедшее значение, а если пришёл сигнал запуска — поле
    const shownText = (c, key) => {
        const v = c.linked(key) ? c.get(key) : c.input !== undefined && c.input !== SIGNAL ? c.input : c.f(key);
        return toText(v);
    };
    def('message', {
        cat: 'output', sub: 'Сообщения', title: 'Сообщение', icon: 'bell', selfTimed: true, width: 250,
        desc: 'Показывает окно с текстом (и ждёт «Дальше») или короткое уведомление сверху',
        keywords: 'message alert сообщение окно уведомление показать',
        head: THROUGH,
        rows: [
            { in: 'text', label: 'Текст', field: { key: 'text', type: 'text', value: 'Готово!' } },
            { label: 'Как', field: { key: 'how', type: 'select', value: 'window', options: [
                ['window', 'окно — ждать «Дальше»'], ['toast', 'уведомление сверху']
            ] } }
        ],
        async run(c) {
            const text = shownText(c, 'text').trim() || ' ';
            if (c.f('how') === 'toast') UI.toast(text);
            else await c.dialog({ title: text.length > 80 ? titleOf(c.tile) : text, text: text.length > 80 ? text : '', ok: 'Дальше', single: true });
            return c.input;
        }
    });
    const LANGS = [['ru-RU', 'русский'], ['kk-KZ', 'казахский'], ['en-US', 'английский']];
    def('speak', {
        cat: 'output', sub: 'Звук', title: 'Озвучить текст', icon: 'speaker', selfTimed: true, width: 250,
        desc: 'Читает текст вслух голосом браузера и ждёт, пока договорит',
        keywords: 'speak tts голос озвучить сказать речь вслух',
        head: THROUGH,
        rows: [
            { in: 'text', label: 'Текст', field: { key: 'text', type: 'text', value: 'Привет!' } },
            { label: 'Язык', field: { key: 'lang', type: 'select', value: 'ru-RU', options: LANGS } },
            { in: 'rate', label: 'Скорость', field: { key: 'rate', type: 'number', value: 1 } }
        ],
        async run(c) {
            if (!window.speechSynthesis) fail('этот браузер не умеет говорить');
            const text = shownText(c, 'text').trim();
            if (!text) fail('нечего озвучивать — текст пустой');
            const rate = Math.min(4, Math.max(0.3, c.num(c.get('rate'), 'Скорость')));
            const u = new SpeechSynthesisUtterance(text.slice(0, 2000));
            u.lang = c.f('lang');
            u.rate = rate;
            const voice = speechSynthesis.getVoices().find(v => v.lang.replace('_', '-') === u.lang);
            if (voice) u.voice = voice;
            c.waiting();
            await new Promise(done => {
                let timer = 0;
                const finish = () => { clearTimeout(timer); off(); done(); };
                const off = c.sound(() => { speechSynthesis.cancel(); finish(); });
                u.onend = u.onerror = finish;
                // если голоса в системе нет, браузер может так и не сообщить о конце — не ждём вечно
                timer = setTimeout(finish, 4000 + text.length * 150 / rate);
                speechSynthesis.speak(u);
            });
            return c.input;
        }
    });
    const NOTES = [['262', 'до'], ['294', 'ре'], ['330', 'ми'], ['349', 'фа'], ['392', 'соль'], ['440', 'ля'], ['494', 'си'], ['523', 'до (выше)'], ['hz', 'своя частота']];
    let audio = null;
    def('beep', {
        cat: 'output', sub: 'Звук', title: 'Звук', icon: 'audio', selfTimed: true, width: 240,
        desc: 'Играет ноту или звук своей частоты — например, сигнал, что программа закончила',
        keywords: 'beep звук нота сигнал музыка пищать',
        head: THROUGH,
        rows: [
            { label: 'Нота', field: { key: 'note', type: 'select', value: '440', options: NOTES } },
            { in: 'hz', label: 'Частота, Гц', field: { key: 'hz', type: 'number', value: 440 }, showIf: f => f.note === 'hz' },
            { in: 'sec', label: 'Секунд', field: { key: 'sec', type: 'number', value: 0.3 } },
            { label: 'Тембр', field: { key: 'wave', type: 'select', value: 'sine', options: [
                ['sine', 'мягкий'], ['triangle', 'флейта'], ['square', 'как в 8-бит'], ['sawtooth', 'резкий']
            ] } }
        ],
        async run(c) {
            const hz = c.f('note') === 'hz' ? c.num(c.get('hz'), 'Частота, Гц') : Number(c.f('note'));
            if (hz < 20 || hz > 20000) fail('частота должна быть от 20 до 20000 Гц');
            const sec = Math.min(10, Math.max(0.02, c.num(c.get('sec'), 'Секунд')));
            if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
            if (audio.state === 'suspended') await audio.resume();
            const osc = audio.createOscillator(), gain = audio.createGain(), t0 = audio.currentTime;
            osc.type = c.f('wave');
            osc.frequency.value = hz;
            // мягкое начало и конец — без щелчков
            gain.gain.setValueAtTime(0, t0);
            gain.gain.linearRampToValueAtTime(0.22, t0 + 0.01);
            gain.gain.setValueAtTime(0.22, t0 + Math.max(0.01, sec - 0.04));
            gain.gain.linearRampToValueAtTime(0, t0 + sec);
            osc.connect(gain).connect(audio.destination);
            osc.start(t0);
            osc.stop(t0 + sec + 0.02);
            const off = c.sound(() => { try { osc.stop(); } catch { /* уже остановлен */ } });
            await c.sleep(sec * 1000);
            off();
            return c.input;
        }
    });

    /* ── Логика ── */
    const gates = [
        ['and',  'AND',  '∧', 'Истина, если истинны оба входа',        'и and',          (a, b) => a && b],
        ['or',   'OR',   '∨', 'Истина, если истинен хотя бы один вход', 'или or',         (a, b) => a || b],
        ['xor',  'XOR',  '⊕', 'Истина, если истинен ровно один вход',   'xor исключающее', (a, b) => a !== b],
        ['nand', 'NAND', '⊼', 'Обратное к AND',                         'nand не-и',      (a, b) => !(a && b)],
        ['nor',  'NOR',  '⊽', 'Обратное к OR',                          'nor не-или',     (a, b) => !(a || b)],
    ];
    for (const [id, title, glyph, desc, kw, fn] of gates) {
        def(id, {
            cat: 'logic', sub: 'Операции', title, glyph, desc, keywords: 'boolean ' + kw,
            head: { out: 'out' }, rows: [A, { in: 'b', label: 'B' }],
            run: c => fn(truthy(c.get('a')), truthy(c.get('b')))
        });
    }
    def('not', {
        cat: 'logic', sub: 'Операции', title: 'NOT', glyph: '¬',
        desc: 'Меняет истину на ложь и наоборот', keywords: 'boolean не not отрицание',
        head: THROUGH, run: c => !truthy(c.input)
    });
    def('true',  { cat: 'logic', sub: 'Значения', title: 'True',  glyph: 'T', desc: 'Всегда передаёт «истину»', keywords: 'истина правда', head: THROUGH, run: () => true });
    def('false', { cat: 'logic', sub: 'Значения', title: 'False', glyph: 'F', desc: 'Всегда передаёт «ложь»',   keywords: 'ложь',          head: THROUGH, run: () => false });
    def('one',   { cat: 'logic', sub: 'Значения', title: '1',     glyph: '1', desc: 'Передаёт 1',               keywords: 'один единица',  head: THROUGH, run: () => 1 });
    def('zero',  { cat: 'logic', sub: 'Значения', title: '0',     glyph: '0', desc: 'Передаёт 0',               keywords: 'ноль нуль',     head: THROUGH, run: () => 0 });

    /* ── Математика ── */
    const arith = [
        ['add', 'Сложить',   '+',  1, 'A + B',                     'плюс сумма add',             (a, b) => a + b],
        ['sub', 'Вычесть',   '−',  1, 'A − B',                     'минус разность sub',         (a, b) => a - b],
        ['mul', 'Умножить',  '×',  2, 'A × B',                     'умножение произведение mul', (a, b) => a * b],
        ['div', 'Разделить', '÷',  2, 'A ÷ B',                     'деление частное div',        (a, b) => b === 0 ? fail('деление на ноль') : a / b],
        ['mod', 'Остаток',   '%',  2, 'Остаток от деления A на B', 'mod остаток',                (a, b) => b === 0 ? fail('деление на ноль') : a - b * Math.floor(a / b)],
        ['pow', 'Степень',   'xʸ', 2, 'A в степени B',             'pow степень возвести',       (a, b) => a === 0 && b < 0 ? fail('деление на ноль') : a ** b],
    ];
    for (const [id, title, glyph, b, desc, kw, fn] of arith) {
        def(id, {
            cat: 'math', sub: 'Арифметика', title, glyph, desc, keywords: kw,
            head: { out: 'out' }, rows: [A, B(b)],
            run(c) {
                const x = c.get('a'), y = c.get('b');
                // текст + текст склеивается, как "a" + "b" в Python
                if (id === 'add' && x !== undefined && x !== SIGNAL && y !== SIGNAL &&
                    ((typeof x === 'string' && asNumber(x) === null) || (typeof y === 'string' && asNumber(y) === null))) {
                    return fmt(x) + fmt(y);
                }
                return result(fn(c.num(x, 'A'), c.num(y, 'B')));
            }
        });
    }
    def('min', {
        cat: 'math', sub: 'Арифметика', title: 'Минимум', glyph: 'min', desc: 'Меньшее из A и B', keywords: 'min минимум меньшее',
        head: { out: 'out' }, rows: [A, B(0)], run: c => Math.min(c.num(c.get('a'), 'A'), c.num(c.get('b'), 'B'))
    });
    def('max', {
        cat: 'math', sub: 'Арифметика', title: 'Максимум', glyph: 'max', desc: 'Большее из A и B', keywords: 'max максимум большее',
        head: { out: 'out' }, rows: [A, B(0)], run: c => Math.max(c.num(c.get('a'), 'A'), c.num(c.get('b'), 'B'))
    });
    def('sqrt', {
        cat: 'math', sub: 'Функции', title: 'Корень', glyph: '√', desc: 'Квадратный корень', keywords: 'sqrt корень',
        head: THROUGH,
        run(c) {
            const x = c.num(c.input);
            if (x < 0) fail('корень из отрицательного числа');
            return result(Math.sqrt(x));
        }
    });
    def('abs', {
        cat: 'math', sub: 'Функции', title: 'Модуль', glyph: '|x|', desc: 'Число без знака', keywords: 'abs модуль',
        head: THROUGH, run: c => Math.abs(c.num(c.input))
    });
    def('round', {
        cat: 'math', sub: 'Функции', title: 'Округлить', glyph: '≈',
        desc: 'До целого или до нужного числа знаков', keywords: 'round floor ceil округление',
        head: THROUGH,
        rows: [
            { label: 'Как', field: { key: 'mode', type: 'select', value: 'round', options: [
                ['round', 'обычно'], ['floor', 'вниз'], ['ceil', 'вверх']
            ] } },
            { label: 'Знаков', field: { key: 'digits', type: 'number', value: 0 } }
        ],
        run(c) {
            const x = c.num(c.input);
            const d = Math.max(0, Math.min(10, Math.round(c.f('digits'))));
            const f = 10 ** d, mode = c.f('mode');
            const k = Number((x * f).toPrecision(15));      // 1.005 × 100 = 100.5, а не 100.4999…
            const r = mode === 'floor' ? Math.floor(k) : mode === 'ceil' ? Math.ceil(k) : Math.sign(k) * Math.round(Math.abs(k));
            return result(r / f);
        }
    });
    const FUNCS = {
        sin: (x, deg) => Math.sin(deg ? x * Math.PI / 180 : x),
        cos: (x, deg) => Math.cos(deg ? x * Math.PI / 180 : x),
        tan: (x, deg) => Math.tan(deg ? x * Math.PI / 180 : x),
        asin: (x, deg) => (Math.abs(x) > 1 ? fail('arcsin определён только от −1 до 1') : Math.asin(x) * (deg ? 180 / Math.PI : 1)),
        acos: (x, deg) => (Math.abs(x) > 1 ? fail('arccos определён только от −1 до 1') : Math.acos(x) * (deg ? 180 / Math.PI : 1)),
        atan: (x, deg) => Math.atan(x) * (deg ? 180 / Math.PI : 1),
        ln: x => (x <= 0 ? fail('логарифм есть только у положительных чисел') : Math.log(x)),
        log10: x => (x <= 0 ? fail('логарифм есть только у положительных чисел') : Math.log10(x)),
        exp: x => Math.exp(x),
    };
    def('func', {
        cat: 'math', sub: 'Функции', title: 'Функция', glyph: 'ƒ',
        desc: 'sin, cos, tan, ln, log и другие', keywords: 'sin cos tan log ln exp тригонометрия',
        head: THROUGH,
        rows: [
            { label: 'Что', field: { key: 'fn', type: 'select', value: 'sin', options: [
                ['sin', 'sin'], ['cos', 'cos'], ['tan', 'tan'], ['asin', 'arcsin'], ['acos', 'arccos'],
                ['atan', 'arctg'], ['ln', 'ln'], ['log10', 'log₁₀'], ['exp', 'eˣ']
            ] } },
            { label: 'В градусах', field: { key: 'deg', type: 'toggle', value: true } }
        ],
        run: c => result(FUNCS[c.f('fn')](c.num(c.input), c.f('deg')))
    });
    const CONSTS = { pi: Math.PI, e: Math.E, phi: (1 + Math.sqrt(5)) / 2 };
    def('mconst', {
        cat: 'math', sub: 'Функции', title: 'Константа', glyph: 'π',
        desc: 'Число π, e или φ', keywords: 'pi пи e фи константа',
        head: THROUGH,
        rows: [{ field: { key: 'c', type: 'select', value: 'pi', options: [
            ['pi', 'π ≈ 3,14159'], ['e', 'e ≈ 2,71828'], ['phi', 'φ ≈ 1,61803']
        ] } }],
        run: c => CONSTS[c.f('c')]
    });
    def('random', {
        cat: 'math', sub: 'Случайность', title: 'Случайное число', icon: 'dice',
        desc: 'Случайное число в диапазоне', keywords: 'random случайное рандом',
        head: THROUGH,
        rows: [
            { in: 'min', label: 'От', field: { key: 'min', type: 'number', value: 1 } },
            { in: 'max', label: 'До', field: { key: 'max', type: 'number', value: 10 } },
            { label: 'Целое', field: { key: 'int', type: 'toggle', value: true } }
        ],
        run(c) {
            let lo = c.num(c.get('min'), 'От'), hi = c.num(c.get('max'), 'До');
            if (lo > hi) [lo, hi] = [hi, lo];
            if (!c.f('int')) return clean(lo + Math.random() * (hi - lo));
            lo = Math.ceil(lo);
            hi = Math.floor(hi);
            if (lo > hi) fail('в этом диапазоне нет целых чисел');
            return lo + Math.floor(Math.random() * (hi - lo + 1));
        }
    });

    /* ── Сравнения ── */
    const cmps = [
        ['eq', 'Равно',            '=', 'Истина, если A равно B'],
        ['ne', 'Не равно',         '≠', 'Истина, если A не равно B'],
        ['gt', 'Больше',           '>', 'Истина, если A больше B'],
        ['lt', 'Меньше',           '<', 'Истина, если A меньше B'],
        ['ge', 'Больше или равно', '≥', 'Истина, если A не меньше B'],
        ['le', 'Меньше или равно', '≤', 'Истина, если A не больше B'],
    ];
    for (const [id, title, glyph, desc] of cmps) {
        def(id, {
            cat: 'compare', sub: 'Сравнения', title, glyph, desc, keywords: 'сравнение compare ' + glyph,
            head: { out: 'out' }, rows: [A, B('0', 'text')],
            run(c) {
                const a = c.get('a');
                if (a === undefined) fail('на вход «A» ничего не пришло');
                return test(id, a, c.get('b'));
            }
        });
    }

    /* ── Переменные ── */
    const NAME = { label: 'Имя', field: { key: 'name', type: 'text', value: 'x' } };
    def('setvar', {
        cat: 'vars', sub: 'Переменные', title: 'Задать переменную', glyph: 'x=',
        desc: 'Запоминает значение под именем', keywords: 'set variable переменная задать',
        head: THROUGH, rows: [NAME],
        run(c) {
            c.vars.set(varName(c), c.input);
            return c.input;
        }
    });
    def('getvar', {
        cat: 'vars', sub: 'Переменные', title: 'Получить переменную', glyph: 'x',
        desc: 'Передаёт значение переменной', keywords: 'get variable переменная получить',
        head: THROUGH, rows: [NAME],
        run(c) {
            const name = varName(c);
            if (!c.vars.has(name)) fail(`переменная «${name}» ещё не задана`);
            return c.vars.get(name);
        }
    });
    def('chvar', {
        cat: 'vars', sub: 'Переменные', title: 'Изменить переменную', glyph: 'x±',
        desc: 'Прибавляет к переменной число (если её нет — начинает с 0)',
        keywords: 'change variable переменная изменить увеличить счётчик',
        head: THROUGH,
        rows: [NAME, { in: 'by', label: 'На', field: { key: 'by', type: 'number', value: 1 } }],
        run(c) {
            const name = varName(c);
            const old = c.vars.has(name) ? c.vars.get(name) : 0;
            const cur = asNumber(old);
            if (cur === null || Number.isNaN(cur)) fail(`в переменной «${name}» лежит «${fmt(old)}», а не число`);
            const v = result(cur + c.num(c.get('by'), 'На'));
            c.vars.set(name, v);
            return v;
        }
    });

    /* ── Циклы ──
       Ветка «Каждый раз» / «Тело цикла» отрабатывает полностью, и только потом
       начинается следующий повтор (c.emitAndWait). */
    const OPS = [
        ['truthy', 'истинно'], ['eq', '='], ['ne', '≠'], ['gt', '>'], ['lt', '<'],
        ['ge', '≥'], ['le', '≤'], ['has', 'содержит'], ['empty', 'пусто']
    ];
    def('repeat', {
        cat: 'control', sub: 'Циклы', title: 'Повторить N раз', icon: 'loop', width: 236,
        desc: 'Запускает ветку «Каждый раз» N раз (передаёт номер 1…N), потом — «Готово»',
        keywords: 'repeat for цикл повторить раз',
        head: { in: 'in' },
        rows: [
            { in: 'n', label: 'Раз', field: { key: 'n', type: 'number', value: 3 } },
            { out: 'each', label: 'Каждый раз' },
            { out: 'done', label: 'Готово' }
        ],
        async run(c) {
            const n = Math.trunc(c.num(c.get('n'), 'Раз'));
            if (n < 0) fail('число повторов не может быть отрицательным');
            for (let i = 1; i <= n; i++) {
                await c.tick();
                await c.emitAndWait('each', i);
            }
            c.emit('done', c.input);
        }
    });
    def('while', {
        cat: 'control', sub: 'Циклы', title: 'Пока условие истинно', icon: 'loop', width: 250,
        desc: 'Пока переменная подходит под условие, запускает «Тело цикла». Меняйте переменную внутри тела',
        keywords: 'while пока цикл условие',
        head: { in: 'in' },
        rows: [
            { label: 'Переменная', field: { key: 'name', type: 'text', value: 'x' } },
            { label: 'Условие', field: { key: 'op', type: 'select', value: 'lt', options: OPS } },
            { in: 'b', label: 'С чем', field: { key: 'b', type: 'text', value: '10' },
              showIf: f => f.op !== 'truthy' && f.op !== 'empty' },
            { out: 'body', label: 'Тело цикла' },
            { out: 'done', label: 'Готово' }
        ],
        async run(c) {
            const name = varName(c);
            for (;;) {
                if (!c.vars.has(name)) fail(`переменная «${name}» ещё не задана — задайте её перед циклом`);
                const v = c.vars.get(name);
                if (!test(c.f('op'), v, c.get('b'))) break;
                await c.tick();
                await c.emitAndWait('body', v);
            }
            c.emit('done', c.vars.get(name));
        }
    });
    def('foreach', {
        cat: 'control', sub: 'Циклы', title: 'Для каждого элемента', icon: 'list', width: 236,
        desc: 'По очереди передаёт каждый элемент списка (символ текста, ключ словаря), потом — «Готово»',
        keywords: 'for each для каждого элемента цикл список',
        head: { in: 'in' },
        rows: [{ out: 'item', label: 'Элемент' }, { out: 'done', label: 'Готово' }],
        async run(c) {
            const v = c.input;
            let items;
            if (Array.isArray(v)) items = v;
            else if (typeof v === 'string') items = [...v];
            else if (isDict(v)) items = Object.keys(v);
            else fail(`на вход нужен список, текст или словарь, а пришло «${fmt(v)}»`);
            for (const x of items) {
                await c.tick();
                await c.emitAndWait('item', x);
            }
            c.emit('done', v);
        }
    });

    /* ── Списки и словари ── */
    const parseItems = s => String(s).split(',').map(x => x.trim()).filter(x => x !== '').map(parseAuto);
    // значение из поля — текст, его превращаем в число/логическое, если похоже
    const valueOf = (c, name) => (c.linked(name) ? c.get(name) : parseAuto(String(c.f(name))));
    function asList(v, what) {
        if (Array.isArray(v)) return v;
        if (v === undefined) fail(`на вход «${what}» ничего не пришло`);
        return fail(`«${what}» должен быть списком, а пришло «${fmt(v)}»`);
    }
    function asDict(v, what) {
        if (isDict(v)) return v;
        if (v === undefined) fail(`на вход «${what}» ничего не пришло`);
        return fail(`«${what}» должен быть словарём, а пришло «${fmt(v)}»`);
    }
    // Номер элемента как в Python: с нуля, −1 — последний
    function index(len, i) {
        i = Math.trunc(i);
        if (i < 0) i += len;
        if (i < 0 || i >= len) fail(`номера ${i} нет — элементов всего ${len} (нумерация с нуля)`);
        return i;
    }
    const LIST = { in: 'list', label: 'Список' };
    const DICT = { in: 'dict', label: 'Словарь' };

    def('list', {
        cat: 'data', sub: 'Списки', title: 'Список', icon: 'list',
        desc: 'Создаёт список из элементов через запятую', keywords: 'list список массив создать',
        head: THROUGH, rows: [{ field: { key: 'items', type: 'text', value: '1, 2, 3' } }],
        run: c => parseItems(c.f('items'))
    });
    def('listAdd', {
        cat: 'data', sub: 'Списки', title: 'Добавить в список', glyph: '+',
        desc: 'Новый список с элементом в конце', keywords: 'append добавить список',
        head: { out: 'out' },
        rows: [LIST, { in: 'value', label: 'Что', field: { key: 'value', type: 'text', value: '4' } }],
        run: c => [...asList(c.get('list'), 'Список'), valueOf(c, 'value')]
    });
    def('listRemove', {
        cat: 'data', sub: 'Списки', title: 'Удалить из списка', glyph: '−',
        desc: 'Новый список без элемента с этим номером (с нуля, −1 — последний)', keywords: 'pop remove удалить список',
        head: { out: 'out' },
        rows: [LIST, { in: 'index', label: 'Номер', field: { key: 'index', type: 'number', value: -1 } }],
        run(c) {
            const l = [...asList(c.get('list'), 'Список')];
            l.splice(index(l.length, c.num(c.get('index'), 'Номер')), 1);
            return l;
        }
    });
    def('listGet', {
        cat: 'data', sub: 'Списки', title: 'Элемент по номеру', glyph: '[i]',
        desc: 'Элемент списка или символ текста по номеру (с нуля, −1 — последний)', keywords: 'index элемент номер список',
        head: { out: 'out' },
        rows: [LIST, { in: 'index', label: 'Номер', field: { key: 'index', type: 'number', value: 0 } }],
        run(c) {
            const v = c.get('list');
            const seq = typeof v === 'string' ? [...v] : asList(v, 'Список');
            return seq[index(seq.length, c.num(c.get('index'), 'Номер'))];
        }
    });
    def('length', {
        cat: 'data', sub: 'Списки', title: 'Длина', glyph: 'len',
        desc: 'Сколько элементов в списке, символов в тексте или ключей в словаре', keywords: 'len длина размер количество',
        head: THROUGH,
        run(c) {
            const v = c.input;
            if (Array.isArray(v)) return v.length;
            if (typeof v === 'string') return [...v].length;
            if (isDict(v)) return Object.keys(v).length;
            return fail(`у «${fmt(v)}» нет длины — нужен список, текст или словарь`);
        }
    });
    def('range', {
        cat: 'data', sub: 'Списки', title: 'Диапазон', glyph: '1…n',
        desc: 'Список чисел от и до (включительно) с шагом — удобно для «Для каждого элемента»',
        keywords: 'range диапазон числа от до шаг последовательность',
        head: THROUGH,
        rows: [
            { in: 'from', label: 'От', field: { key: 'from', type: 'number', value: 1 } },
            { in: 'to', label: 'До', field: { key: 'to', type: 'number', value: 10 } },
            { in: 'step', label: 'Шаг', field: { key: 'step', type: 'number', value: 1 } }
        ],
        run(c) {
            const a = c.num(c.get('from'), 'От'), b = c.num(c.get('to'), 'До');
            let s = c.num(c.get('step'), 'Шаг');
            if (s === 0) fail('шаг не может быть нулём');
            if ((b - a) * s < 0) s = -s;            // «от 10 до 1» считает вниз сам
            const n = Math.floor((b - a) / s + 1e-9) + 1;
            if (n > 100000) fail('слишком длинный список — больше 100 000 чисел');
            return Array.from({ length: n }, (_, i) => clean(a + i * s));
        }
    });
    def('sort', {
        cat: 'data', sub: 'Списки', title: 'Порядок списка', icon: 'sort',
        desc: 'Сортирует, переворачивает или перемешивает список (или символы текста)',
        keywords: 'sort сортировать отсортировать перевернуть reverse перемешать shuffle',
        head: THROUGH,
        rows: [{ label: 'Как', field: { key: 'how', type: 'select', value: 'asc', options: [
            ['asc', 'по возрастанию'], ['desc', 'по убыванию'], ['reverse', 'задом наперёд'], ['shuffle', 'перемешать']
        ] } }],
        run(c) {
            const v = c.input, text = typeof v === 'string';
            const l = text ? [...v] : [...asList(v, 'вход')];
            const how = c.f('how');
            if (how === 'asc') l.sort(order);
            else if (how === 'desc') l.sort((x, y) => order(y, x));
            else if (how === 'reverse') l.reverse();
            else for (let i = l.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [l[i], l[j]] = [l[j], l[i]];
            }
            return text ? l.join('') : l;
        }
    });
    def('listStat', {
        cat: 'data', sub: 'Списки', title: 'Итог списка', glyph: 'Σ',
        desc: 'Сумма, среднее, наименьшее или наибольшее из чисел списка',
        keywords: 'sum сумма среднее average min max минимум максимум итог',
        head: THROUGH,
        rows: [{ label: 'Что', field: { key: 'what', type: 'select', value: 'sum', options: [
            ['sum', 'сумма'], ['avg', 'среднее'], ['min', 'наименьшее'], ['max', 'наибольшее'], ['prod', 'произведение']
        ] } }],
        run(c) {
            const l = asList(c.input, 'вход');
            const nums = l.map(x => {
                const n = asNumber(x);
                if (n === null) fail(`в списке есть «${fmt(x)}» — это не число`);
                return n;
            });
            const what = c.f('what');
            if (!nums.length) {
                if (what === 'sum') return 0;
                if (what === 'prod') return 1;
                fail('список пустой');
            }
            if (what === 'sum') return result(nums.reduce((s, x) => s + x, 0));
            if (what === 'avg') return result(nums.reduce((s, x) => s + x, 0) / nums.length);
            if (what === 'prod') return result(nums.reduce((s, x) => s * x, 1));
            return what === 'min' ? Math.min(...nums) : Math.max(...nums);
        }
    });
    def('pick', {
        cat: 'data', sub: 'Списки', title: 'Случайный элемент', icon: 'dice',
        desc: 'Выбирает случайный элемент списка (или символ текста)', keywords: 'choice random случайный элемент выбрать',
        head: THROUGH,
        run(c) {
            const v = c.input;
            const l = typeof v === 'string' ? [...v] : asList(v, 'вход');
            if (!l.length) fail('выбирать не из чего — список пустой');
            return l[Math.floor(Math.random() * l.length)];
        }
    });
    def('dict', {
        cat: 'data', sub: 'Словари', title: 'Словарь', icon: 'braces',
        desc: 'Создаёт словарь из пар «ключ: значение» через запятую', keywords: 'dict словарь ключ значение',
        head: THROUGH, rows: [{ field: { key: 'items', type: 'text', value: 'имя: Аня, возраст: 16' } }],
        run(c) {
            const d = {};
            for (const part of String(c.f('items')).split(',')) {
                if (!part.trim()) continue;
                const at = part.indexOf(':');
                if (at < 0) fail(`в паре «${part.trim()}» нет двоеточия — пишите «ключ: значение»`);
                d[part.slice(0, at).trim()] = parseAuto(part.slice(at + 1).trim());
            }
            return d;
        }
    });
    def('dictGet', {
        cat: 'data', sub: 'Словари', title: 'Значение по ключу', glyph: '{k}',
        desc: 'Достаёт из словаря значение по ключу', keywords: 'get ключ значение словарь',
        head: { out: 'out' },
        rows: [DICT, { in: 'key', label: 'Ключ', field: { key: 'key', type: 'text', value: 'имя' } }],
        run(c) {
            const d = asDict(c.get('dict'), 'Словарь'), k = fmt(c.get('key'));
            if (!Object.prototype.hasOwnProperty.call(d, k)) fail(`в словаре нет ключа «${k}»`);
            return d[k];
        }
    });
    def('dictSet', {
        cat: 'data', sub: 'Словари', title: 'Задать по ключу', glyph: '{=}',
        desc: 'Новый словарь, где по ключу лежит новое значение', keywords: 'set ключ значение словарь задать',
        head: { out: 'out' },
        rows: [DICT, { in: 'key', label: 'Ключ', field: { key: 'key', type: 'text', value: 'город' } },
            { in: 'value', label: 'Значение', field: { key: 'value', type: 'text', value: 'Алматы' } }],
        run: c => ({ ...asDict(c.get('dict'), 'Словарь'), [fmt(c.get('key'))]: valueOf(c, 'value') })
    });
    def('convert', {
        cat: 'data', sub: 'Типы', title: 'Преобразовать тип', icon: 'convert',
        desc: 'Превращает значение в число, текст, логическое или список', keywords: 'int float str bool list тип преобразовать',
        head: THROUGH,
        rows: [{ label: 'В', field: { key: 'to', type: 'select', value: 'int', options: [
            ['int', 'целое (int)'], ['float', 'дробное (float)'], ['str', 'текст (str)'], ['bool', 'логическое (bool)'], ['list', 'список (list)']
        ] } }],
        run(c) {
            const v = c.input, to = c.f('to');
            if (to === 'str') return toText(v);
            if (to === 'bool') return truthy(v);
            if (to === 'list') {
                if (Array.isArray(v)) return [...v];
                if (typeof v === 'string') return [...v];
                if (isDict(v)) return Object.keys(v);
                return [v];
            }
            const n = asNumber(v);
            if (n === null) fail(`«${fmt(v)}» не превращается в число`);
            return to === 'int' ? Math.trunc(n) : n;
        }
    });
    def('typeof', {
        cat: 'data', sub: 'Типы', title: 'Тип значения', glyph: 'T?',
        desc: 'Имя типа, как type() в Python: int, float, str, bool, list, dict', keywords: 'type тип значения',
        head: THROUGH, run: c => typeName(c.input)
    });

    /* ── Текст ── */
    const toText = v => (typeof v === 'string' ? v : v === SIGNAL || v === undefined ? '' : fmt(v));
    def('join', {
        cat: 'text', sub: 'Текст', title: 'Склеить текст', glyph: 'A+B',
        desc: 'Соединяет A и B через разделитель. Если A — список, склеивает его элементы', keywords: 'join склеить соединить concat',
        head: { out: 'out' },
        rows: [A, { in: 'b', label: 'B', field: { key: 'b', type: 'text', value: '' } },
            { label: 'Между', field: { key: 'sep', type: 'text', value: '' } }],
        run(c) {
            const a = c.get('a'), b = c.get('b'), sep = String(c.f('sep'));
            if (a === undefined) fail('на вход «A» ничего не пришло');
            const parts = Array.isArray(a) ? a.map(toText) : [toText(a)];
            if (toText(b) !== '') parts.push(toText(b));
            return parts.join(sep);
        }
    });
    def('template', {
        cat: 'text', sub: 'Текст', title: 'Шаблон', glyph: '{ }', width: 250,
        desc: 'Вставляет значение в текст: {} — пришедшее значение, {0} {1} — элементы списка, {имя} — ключ словаря',
        keywords: 'template format f-строка шаблон вставить подставить',
        head: THROUGH,
        rows: [{ field: { key: 'text', type: 'text', value: 'Привет, {}!' } }],
        run(c) {
            const v = c.input;
            return String(c.f('text')).replace(/\{([^{}]*)\}/g, (all, key) => {
                key = key.trim();
                if (key === '') return toText(v);
                if (Array.isArray(v) && /^-?\d+$/.test(key)) return toText(v[index(v.length, Number(key))]);
                if (isDict(v)) {
                    if (!Object.prototype.hasOwnProperty.call(v, key)) fail(`в словаре нет ключа «${key}»`);
                    return toText(v[key]);
                }
                return fail(`для {${key}} нужен ${/^-?\d+$/.test(key) ? 'список' : 'словарь'}, а пришло «${fmt(v)}»`);
            });
        }
    });
    def('split', {
        cat: 'text', sub: 'Текст', title: 'Разделить текст', glyph: '✂',
        desc: 'Делит текст на список по разделителю (пробел — по любым пробелам)', keywords: 'split разделить разбить',
        head: THROUGH, rows: [{ label: 'По', field: { key: 'sep', type: 'text', value: ' ' } }],
        run(c) {
            const s = toText(c.input), sep = String(c.f('sep'));
            return sep.trim() === '' ? s.split(/\s+/).filter(Boolean) : s.split(sep);
        }
    });
    def('replace', {
        cat: 'text', sub: 'Текст', title: 'Заменить в тексте', glyph: '⇄',
        desc: 'Заменяет все вхождения одного текста другим', keywords: 'replace заменить',
        head: THROUGH,
        rows: [{ label: 'Что', field: { key: 'find', type: 'text', value: 'кот' } },
            { label: 'На что', field: { key: 'with', type: 'text', value: 'пёс' } }],
        run(c) {
            const s = toText(c.input), find = String(c.f('find'));
            return find ? s.split(find).join(String(c.f('with'))) : s;
        }
    });
    def('case', {
        cat: 'text', sub: 'Текст', title: 'Регистр', glyph: 'Aa',
        desc: 'Заглавные, строчные или «Каждое Слово С Заглавной»', keywords: 'upper lower title регистр заглавные',
        head: THROUGH,
        rows: [{ label: 'Как', field: { key: 'mode', type: 'select', value: 'upper', options: [
            ['upper', 'ВСЕ ЗАГЛАВНЫЕ'], ['lower', 'все строчные'], ['title', 'Каждое Слово'], ['capitalize', 'Первая заглавная']
        ] } }],
        run(c) {
            const s = toText(c.input), mode = c.f('mode');
            if (mode === 'upper') return s.toUpperCase();
            if (mode === 'lower') return s.toLowerCase();
            if (mode === 'title') return s.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (m, p, ch) => p + ch.toUpperCase());
            return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
        }
    });
    def('substr', {
        cat: 'text', sub: 'Текст', title: 'Часть текста', glyph: '[:]',
        desc: 'Символы с номера «С» до «До» (как срез s[с:до] в Python)', keywords: 'substring срез часть подстрока',
        head: THROUGH,
        rows: [{ label: 'С', field: { key: 'from', type: 'number', value: 0 } },
            { label: 'До', field: { key: 'to', type: 'text', value: '', placeholder: 'конца' } }],
        run(c) {
            const s = [...toText(c.input)];
            const raw = String(c.f('to')).trim();
            const to = raw === '' ? s.length : parseNum(raw);
            if (to === null) fail('«До» должно быть числом или пустым');
            return s.slice(Math.trunc(c.f('from')), Math.trunc(to)).join('');
        }
    });
    def('trim', {
        cat: 'text', sub: 'Текст', title: 'Убрать пробелы', glyph: '␣',
        desc: 'Убирает пробелы по краям текста', keywords: 'trim strip пробелы',
        head: THROUGH, run: c => toText(c.input).trim()
    });

    /* ── Время ── */
    const pad = n => String(n).padStart(2, '0');
    const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    def('now', {
        cat: 'time', sub: 'Время', title: 'Текущее время', icon: 'calendar', width: 236,
        desc: 'Время, дата, день недели и другое — в момент срабатывания', keywords: 'time date now время дата сейчас',
        head: THROUGH,
        rows: [{ label: 'Что', field: { key: 'what', type: 'select', value: 'time', options: [
            ['time', 'время'], ['date', 'дата'], ['datetime', 'дата и время'], ['weekday', 'день недели'],
            ['year', 'год'], ['month', 'месяц'], ['day', 'число'], ['hour', 'час'], ['minute', 'минута'],
            ['second', 'секунда'], ['ts', 'секунд с 1970 года']
        ] } }],
        run(c) {
            const d = new Date();
            const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            const date = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
            return {
                time, date, datetime: `${date} ${time}`, weekday: WEEKDAYS[d.getDay()],
                year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
                hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(),
                ts: Math.floor(d.getTime() / 1000)
            }[c.f('what')];
        }
    });
    def('timer', {
        cat: 'time', sub: 'Время', title: 'Таймер', icon: 'timer', selfTimed: true, width: 236,
        desc: 'Каждые N секунд отправляет номер тика, нужное число раз, потом — «Готово»', keywords: 'timer таймер интервал тик',
        head: { in: 'in' },
        rows: [
            { in: 'sec', label: 'Каждые, сек', field: { key: 'sec', type: 'number', value: 1 } },
            { label: 'Раз', field: { key: 'count', type: 'number', value: 5 } },
            { out: 'tick', label: 'Тик' },
            { out: 'done', label: 'Готово' }
        ],
        async run(c) {
            const sec = c.num(c.get('sec'), 'Каждые, сек'), n = Math.trunc(c.f('count'));
            if (sec < 0) fail('интервал не может быть отрицательным');
            for (let i = 1; i <= n; i++) {
                await c.sleep(sec * 1000);
                await c.tick();
                c.emit('tick', i);
            }
            c.emit('done', c.input);
        }
    });

    /* ── Сеть ── */
    def('http', {
        cat: 'net', sub: 'Сеть', title: 'HTTP-запрос', icon: 'globe', width: 280, selfTimed: true,
        desc: 'Запрос к сайту или API. Работает с сайтами, которые разрешают запросы из браузера (CORS)',
        keywords: 'http fetch запрос api сайт интернет get post',
        head: THROUGH,
        rows: [
            { in: 'url', label: 'Адрес', field: { key: 'url', type: 'text', value: 'https://api.github.com/zen' } },
            { label: 'Метод', field: { key: 'method', type: 'select', value: 'GET', options: [
                ['GET', 'GET'], ['POST', 'POST'], ['PUT', 'PUT'], ['DELETE', 'DELETE']
            ] } },
            { label: 'Ответ', field: { key: 'as', type: 'select', value: 'text', options: [
                ['text', 'текст'], ['json', 'JSON → словарь или список']
            ] } }
        ],
        async run(c) {
            const url = toText(c.get('url')).trim();
            if (!/^https?:\/\//i.test(url)) fail('адрес должен начинаться с http:// или https://');
            const method = c.f('method'), init = { method, signal: c.signal(20000) };
            const body = c.input;
            if ((method === 'POST' || method === 'PUT') && body !== undefined && body !== SIGNAL) {
                if (Array.isArray(body) || isDict(body)) {
                    init.body = JSON.stringify(body);
                    init.headers = { 'Content-Type': 'application/json' };
                } else init.body = toText(body);
            }
            c.waiting();
            let res;
            try {
                res = await fetch(url, init);
            } catch (e) {
                if (e && e.name === 'AbortError') fail('сайт не ответил за 20 секунд');
                fail('не удалось получить ответ: сайт недоступен или не разрешает запросы из браузера (CORS)');
            }
            if (!res.ok) fail(`сервер ответил ошибкой ${res.status}`);
            if (c.f('as') === 'json') {
                try { return await res.json(); } catch { fail('ответ сервера — не JSON'); }
            }
            return res.text();
        }
    });

    // Сайт прямо в плитке (устройство окна сайта — в web.js)
    def('web', {
        cat: 'net', sub: 'Сайты', title: 'Ссылка', icon: 'link', width: 460, selfTimed: true,
        body: 'web', extra: { gw: 460, gh: 300, page: '' },
        desc: 'Открывает сайт прямо на доске. Адрес вводится вручную или приходит по линии от другой плитки',
        keywords: 'ссылка сайт браузер страница url link web iframe youtube видео открыть поиск google',
        head: THROUGH,
        rows: [
            { in: 'url', label: 'Адрес', field: { key: 'url', type: 'text', value: '', placeholder: 'сайт или запрос для поиска',
                enter: tile => Web.openTyped(tile) } }
        ],
        async run(c) {
            // адрес: по линии «Адрес», иначе текст на главном входе, иначе поле
            const text = c.linked('url') ? toText(c.get('url'))
                : typeof c.input === 'string' && c.input.trim() ? c.input : c.f('url');
            const page = Web.address(text);
            if (page === '') fail('не указан адрес сайта');
            if (page === null) fail(`адрес «${String(text).trim()}» записан с ошибкой`);
            c.waiting();
            await Web.open(c.tile, page, c.signal(15000));
            return Web.readable(page);
        }
    });
    def('openTab', {
        cat: 'net', sub: 'Браузер', title: 'Открыть вкладку', icon: 'external', selfTimed: true, width: 260,
        desc: 'Открывает страницу в новой вкладке браузера. Адрес — в поле или по линии',
        keywords: 'open tab вкладка открыть страницу сайт браузер ссылка перейти',
        head: THROUGH,
        rows: [{ in: 'url', label: 'Адрес', field: { key: 'url', type: 'text', value: 'ru.wikipedia.org', placeholder: 'сайт или запрос для поиска' } }],
        async run(c) {
            const text = c.linked('url') ? toText(c.get('url')) : typeof c.input === 'string' && c.input.trim() ? c.input : c.f('url');
            const page = Web.address(text);
            if (page === '') fail('не указан адрес страницы');
            if (page === null) fail(`адрес «${String(text).trim()}» записан с ошибкой`);
            let w = window.open(page, '_blank');
            if (!w) {
                // браузер не дал открыть вкладку сам — просим нажать кнопку
                const ok = await c.dialog({ title: 'Открыть страницу?', text: Web.readable(page), ok: 'Открыть', cancel: 'Пропустить' });
                if (ok) w = window.open(page, '_blank');
            }
            if (w) w.opener = null;
            return Web.readable(page);
        }
    });
    def('copy', {
        cat: 'net', sub: 'Браузер', title: 'Скопировать', icon: 'copy',
        desc: 'Кладёт пришедшее значение в буфер обмена (потом его можно вставить через Ctrl + V)',
        keywords: 'copy clipboard буфер обмена скопировать',
        head: THROUGH,
        async run(c) {
            const text = toText(c.input);
            try {
                await navigator.clipboard.writeText(text);
            } catch {
                // запасной способ: через невидимое поле (работает, даже если вкладка не в фокусе)
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
                document.body.append(ta);
                ta.select();
                let ok = false;
                try { ok = document.execCommand('copy'); } catch { /* не вышло */ }
                ta.remove();
                if (!ok) fail('браузер не дал доступ к буферу обмена — нажмите на страницу и запустите ещё раз');
            }
            UI.toast('Скопировано: ' + (text.length > 60 ? text.slice(0, 60) + '…' : text || '(пусто)'));
            return c.input;
        }
    });

    /* ── Код ── */
    const PY_EXAMPLE = [
        '# inp — значение, пришедшее по линии (None от «Запуска»)',
        '# print() отправляет строку дальше, например на «Вывод»',
        '# input() читает то же пришедшее значение',
        'name = inp if inp else "мир"',
        'print(f"Привет, {name}!")',
        '',
        '# переменная result уйдёт дальше в конце',
        'result = len(str(name))'
    ].join('\n');
    def('python', {
        cat: 'code', sub: 'Python', title: 'Python', icon: 'python', width: 360, selfTimed: true,
        desc: 'Настоящий Python прямо в плитке: print() отправляет строки дальше, inp — пришедшее значение',
        keywords: 'python питон код программа print pyodide',
        head: THROUGH,
        rows: [{ field: { key: 'code', type: 'code', value: PY_EXAMPLE } }],
        run: c => c.python(String(c.f('code')), c.input)
    });

    /* ── Служебные ── */
    const fnName = c => String(c.f('name') || '').trim() || fail('не указано имя функции');
    const FN_NAME = { label: 'Имя', field: { key: 'name', type: 'text', value: 'моя функция' } };
    def('comment', {
        cat: 'service', sub: 'Заметки', title: 'Комментарий', icon: 'note', width: 250,
        desc: 'Заметка на доске — на выполнение не влияет', keywords: 'comment комментарий заметка пояснение',
        rows: [{ field: { key: 'text', type: 'textarea', value: 'Напишите здесь пояснение…' } }]
    });
    def('heading', {
        cat: 'service', sub: 'Заметки', title: 'Заголовок', icon: 'heading', body: 'heading', extra: { gw: 420 },
        desc: 'Крупная надпись с цветной чертой — подписывает и разделяет части доски. Ширина меняется за уголок',
        keywords: 'заголовок раздел надпись разделитель секция часть',
        rows: [{ field: { key: 'text', type: 'text', value: 'Новый раздел', heading: true } }]
    });
    def('group', {
        cat: 'service', sub: 'Заметки', title: 'Группа', icon: 'group', body: 'group', extra: { gw: 440, gh: 280 },
        desc: 'Рамка вокруг плиток: перетащите её — плитки внутри поедут вместе', keywords: 'group группа рамка область'
    });
    def('fnStart', {
        cat: 'service', sub: 'Функции', title: 'Функция', icon: 'fn',
        desc: 'Начало своей функции: отсюда выходит значение, с которым её вызвали', keywords: 'function def функция начало',
        head: { out: 'out' }, rows: [FN_NAME]
    });
    def('fnReturn', {
        cat: 'service', sub: 'Функции', title: 'Вернуть результат', icon: 'fnReturn',
        desc: 'Конец функции: пришедшее значение станет результатом вызова', keywords: 'return вернуть результат функция',
        head: { in: 'in' }, rows: [FN_NAME],
        run(c) { c.fnReturn(fnName(c), c.input); }
    });
    def('fnCall', {
        cat: 'service', sub: 'Функции', title: 'Вызвать функцию', icon: 'fnCall',
        desc: 'Запускает функцию с этим именем и передаёт дальше её результат', keywords: 'call вызвать функцию',
        head: THROUGH, rows: [FN_NAME],
        run: c => c.fnCall(fnName(c), c.input)
    });

    /* ── Доска: плитки, которые меняют саму доску ── */
    // Список всех типов плиток для поля «Тип» (по разделам)
    const typeOptions = () => CATEGORIES.map(c => ({
        group: c.name, items: ORDER.filter(id => TYPES[id].cat === c.id).map(id => [id, TYPES[id].title])
    }));

    def('spawn', {
        cat: 'board', sub: 'Плитки', title: 'Добавить плитку', icon: 'addTile', width: 260,
        desc: 'Создаёт новую плитку — в свободном месте или на таргете — и может сразу подсоединить её',
        keywords: 'добавить создать плитку spawn таргет',
        head: THROUGH,
        rows: [
            { label: 'Тип', field: { key: 'kind', type: 'select', value: 'out', options: typeOptions } },
            { label: 'Где', field: { key: 'where', type: 'ref', accept: ['target'], value: '', empty: 'в свободном месте' } },
            { label: 'Связь', field: { key: 'link', type: 'ref', accept: ['tile'], value: '', empty: 'без связи' } },
            { label: 'Как', field: { key: 'dir', type: 'select', value: 'from', options: [
                ['from', 'та плитка → новая'], ['to', 'новая → та плитка']
            ] }, showIf: f => !!f.link }
        ],
        async run(c) {
            const d = get(c.f('kind'));
            if (!d) fail('не выбран тип новой плитки');
            if (Board.tiles.size >= 2000) fail('на доске уже 2000 плиток — больше добавлять нельзя');
            let pos, center = null;
            const where = c.f('where');
            if (where) {
                center = Board.refCenter(where);
                if (!center) fail('выбранный таргет не найден — возможно, он удалён');
                pos = { x: center.x - d.width / 2, y: center.y - estimateHeight(d) / 2 };
            } else {
                const self = c.tile;
                pos = Board.freeSpot(d.width, estimateHeight(d), self.x + self.w + 60 + d.width / 2, self.y + self.h / 2);
            }
            const t = Board.addTile(d.id, { x: pos.x, y: pos.y, animate: true });
            // настоящая высота плитки известна только после отрисовки — ставим точно по центру таргета
            if (center) Board.moveRef('t:' + t.id, center.x, center.y, 0);
            const other = c.f('link') && Board.resolveRef(c.f('link'));
            if (c.f('link')) {
                if (!other) fail('плитка для связи не найдена — возможно, она удалена');
                const [a, b] = c.f('dir') === 'to' ? [t, other.obj] : [other.obj, t];
                const out = ports(a.def).out[0], inp = ports(b.def).in[0];
                if (!out) fail(`у плитки «${titleOf(a)}» нет выхода — соединить нельзя`);
                if (!inp) fail(`у плитки «${titleOf(b)}» нет входа — соединить нельзя`);
                Board.addLink({ tile: a.id, port: out }, { tile: b.id, port: inp }, { animate: true });
            }
            c.settle();
            return c.input;
        }
    });

    def('move', {
        cat: 'board', sub: 'Плитки', title: 'Переместить плитку', icon: 'move', width: 270,
        desc: 'Переносит плитку, таргет или точку линии на место плитки, на таргет или в координаты',
        keywords: 'переместить сдвинуть обменять заменить move таргет точка',
        head: THROUGH,
        rows: [
            { label: 'Что', field: { key: 'obj', type: 'ref', accept: ['tile', 'target', 'point'], value: '', empty: 'не выбрано' } },
            { label: 'Куда', field: { key: 'to', type: 'ref', accept: ['tile', 'target', 'xy'], value: '', empty: 'не выбрано' } },
            { in: 'x', label: 'X', field: { key: 'x', type: 'number', value: 0 }, showIf: f => f.to === '@xy' },
            { in: 'y', label: 'Y', field: { key: 'y', type: 'number', value: 0 }, showIf: f => f.to === '@xy' },
            { label: 'Как', field: { key: 'act', type: 'select', value: 'move', options: [
                ['move', 'переместить'], ['swap', 'обменять местами'], ['replace', 'заменить содержимое']
            ] } }
        ],
        async run(c) {
            const obj = c.f('obj'), to = c.f('to'), act = c.f('act');
            if (!obj) fail('не выбрано, что перемещать');
            if (!to) fail('не выбрано, куда перемещать');
            if (obj === to) fail('объект нельзя переместить на самого себя');
            c.countMove();
            if (act === 'replace') {
                replaceContent(c, obj, to);
                return c.input;
            }
            const from = Board.refCenter(obj);
            if (!from) fail('перемещаемый объект не найден — возможно, он удалён');
            let dest;
            if (to === '@xy') dest = { x: c.num(c.get('x'), 'X'), y: c.num(c.get('y'), 'Y') };
            else {
                dest = Board.refCenter(to);
                if (!dest) fail('место назначения не найдено — возможно, оно удалено');
            }
            const ms = c.moveMs();
            const jobs = [Board.moveRef(obj, dest.x, dest.y, ms)];
            if (act === 'swap' && to !== '@xy') jobs.push(Board.moveRef(to, from.x, from.y, ms));
            await Promise.all(jobs);
            c.settle();
            return c.input;
        }
    });

    // «Заменить содержимое»: в плитке «Куда» появляется содержимое плитки «Что»
    function replaceContent(c, obj, to) {
        const a = Board.resolveRef(obj), b = Board.resolveRef(to);
        if (!a || !b) fail('плитка не найдена — возможно, она удалена');
        if (a.kind !== 'tile' || b.kind !== 'tile') fail('заменять содержимое можно только у плиток');
        const src = a.obj, dst = b.obj;
        if (dst.type === 'out') {
            if (src.type === 'out') logRestore(dst, src.log);
            else {
                logClear(dst);
                logValue(dst, c.input, titleOf(src));
            }
        } else if (dst.def.media && src.def.media) {
            if (!src.asset) fail(`в плитке «${titleOf(src)}» нет файла`);
            Board.setTileAsset(dst.id, src.asset, src.fileName);
        } else if (dst.type === src.type) {
            Board.setTileFields(dst.id, src.fields);
        } else {
            fail(`нельзя положить содержимое «${titleOf(src)}» в «${titleOf(dst)}»: это разные плитки`);
        }
        Board.flash(dst.id);
    }

    /* ── Медиа и файлы ──
       Файл лежит внутри плитки (tile.asset — id встроенного файла в Storage).
       При срабатывании плитка передаёт файл дальше, текстовая — его текст. */
    const MEDIA = [
        ['image', 'Изображение', 'image', 'image', 'image/*', 260,
            'Картинка внутри плитки: png, jpg, gif, svg…', 'image picture фото картинка изображение png jpg'],
        ['video', 'Видео', 'video', 'video', 'video/*', 300,
            'Видео с плеером прямо на доске', 'video видео mp4 webm ролик'],
        ['audio', 'Аудио', 'audio', 'audio', 'audio/*', 280,
            'Звук с плеером: mp3, wav, ogg…', 'audio звук музыка mp3 wav'],
        ['textfile', 'Текстовый файл', 'text', 'textFile', '.txt,.md,.csv,.json,.js,.py,.html,.css,.xml,.yml,.yaml,.log,text/*', 280,
            'Показывает текст файла и передаёт его дальше', 'text txt md csv json текстовый файл'],
        ['file', 'Файл', 'file', 'file', '', 260,
            'Любой файл: pdf, zip, docx… — значок, имя и размер', 'file pdf zip docx документ архив файл'],
    ];
    for (const [id, title, media, ico, accept, width, desc, keywords] of MEDIA) {
        def(id, {
            cat: 'media', sub: 'Медиа и файлы', title, icon: ico, media, accept, width, desc, keywords,
            head: THROUGH, body: 'media',
            run: media === 'text' ? c => c.asset().blob.text() : c => mediaRef(c.asset(), c.tile)
        });
    }

    // «Скачать файл»: файл из медиаплитки или пришедшее значение (текст, список…) как файл
    def('download', {
        cat: 'media', sub: 'Скачивание', title: 'Скачать файл', icon: 'download', width: 270,
        desc: 'Скачивает на компьютер файл из выбранной плитки или пришедшее значение. Поставьте после «Если → Да», чтобы файл скачивался при удаче',
        keywords: 'download скачать сохранить файл загрузить экспорт',
        head: THROUGH,
        rows: [
            { label: 'Что', field: { key: 'what', type: 'select', value: 'value', options: [
                ['value', 'пришедшее значение'], ['tile', 'файл из плитки']
            ] } },
            { label: 'Плитка', field: { key: 'src', type: 'ref', accept: ['tile'], value: '', empty: 'не выбрана' }, showIf: f => f.what === 'tile' },
            { in: 'name', label: 'Имя файла', field: { key: 'name', type: 'text', value: '', placeholder: 'как у файла' } },
            { label: 'Формат', field: { key: 'fmt', type: 'select', value: 'auto', options: [
                ['auto', 'сам подберётся'], ['txt', 'текст .txt'], ['json', 'данные .json'], ['csv', 'таблица .csv']
            ] }, showIf: f => f.what === 'value' }
        ],
        run(c) {
            const named = toText(c.get('name')).trim();
            const withExt = (base, ext) => (/\.[a-z0-9]{1,6}$/i.test(base) ? base : base + '.' + ext);
            if (c.f('what') === 'tile') {
                const ref = c.f('src');
                if (!ref) fail('не выбрана плитка с файлом');
                const hit = Board.resolveRef(ref);
                if (!hit) fail('плитка с файлом не найдена — возможно, она удалена');
                const t = hit.obj;
                const a = t.def.media && t.asset && Storage.asset(t.asset);
                if (!a) fail(t.def.media ? `в плитке «${titleOf(t)}» нет файла` : `«${titleOf(t)}» — не медиаплитка, в ней нет файла`);
                const own = t.fileName || a.name;
                const ext = (/\.([a-z0-9]{1,6})$/i.exec(own) || [, 'bin'])[1];
                Storage.download(a.blob, Storage.safeName(named ? withExt(named, ext) : own));
                return c.input;
            }
            const v = c.input;
            if (v === undefined || v === SIGNAL) fail('скачивать нечего — на вход пришёл только сигнал запуска');
            // пришёл файл (например, из «Изображения») — скачиваем его самого
            if (isMedia(v)) {
                const a = Storage.asset(v.asset);
                if (!a) fail(`файл «${v.name}» не найден`);
                const ext = (/\.([a-z0-9]{1,6})$/i.exec(v.name) || [, 'bin'])[1];
                Storage.download(a.blob, Storage.safeName(named ? withExt(named, ext) : v.name));
                return c.input;
            }
            let f = c.f('fmt');
            if (f === 'auto') f = Array.isArray(v) || isDict(v) ? 'json' : 'txt';
            let body, type;
            if (f === 'json') {
                body = JSON.stringify(v, (k, x) => (isMedia(x) ? x.name : x), 2);
                type = 'application/json';
            } else if (f === 'csv') {
                const cell = x => {
                    const s = toText(x);
                    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
                };
                const rows = Array.isArray(v) ? v : [v];
                body = rows.map(r => (Array.isArray(r) ? r.map(cell).join(';') : isDict(r) ? Object.values(r).map(cell).join(';') : cell(r))).join('\n');
                type = 'text/csv';
            } else {
                body = Array.isArray(v) ? v.map(toText).join('\n') : toText(v);
                type = 'text/plain';
            }
            // невидимая метка UTF-8 в начале — чтобы Блокнот и Excel узнали русские буквы
            const blob = new Blob([f === 'json' ? body : '﻿' + body], { type: type + ';charset=utf-8' });
            Storage.download(blob, Storage.safeName(withExt(named || 'результат', f)));
            return c.input;
        }
    });

    /* ---------- Справочные функции ---------- */
    const get = id => TYPES[id] || null;
    const list = () => ORDER.map(id => TYPES[id]);
    const colorOf = d => (CAT[d.cat] || {}).color || '#8E8E93';
    const titleOf = tile => tile.name || tile.def.title;

    // Список контактов плитки: { in: [id...], out: [id...] }
    function ports(d) {
        if (d._ports) return d._ports;
        const p = { in: [], out: [] };
        if (d.head.in) p.in.push(d.head.in);
        if (d.head.out) p.out.push(d.head.out);
        for (const r of d.rows) {
            if (r.in) p.in.push(r.in);
            if (r.out) p.out.push(r.out);
        }
        d._ports = p;
        return p;
    }

    function portLabel(d, id) {
        if (d.head.in === id || d.head.out === id) return id === 'out' ? 'выход' : 'вход';
        const r = d.rows.find(x => x.in === id || x.out === id);
        return r && r.label ? r.label : id;
    }

    function defaults(d, given = {}) {
        const f = { ...(d.extra || {}) };
        for (const r of d.rows) if (r.field) f[r.field.key] = r.field.value;
        return Object.assign(f, given);
    }

    // Высота до отрисовки — нужна, чтобы заранее найти свободное место
    const MEDIA_H = { image: 250, video: 230, audio: 100, text: 210, file: 100 };
    function estimateHeight(d) {
        if (d.body === 'group') return d.extra.gh;
        if (d.body === 'web') return 50 + d.rows.length * 34 + 40 + d.extra.gh + 14;
        if (d.body === 'heading') return 108;
        const big = d.rows.filter(r => r.field && (r.field.type === 'code' || r.field.type === 'textarea'));
        return 50 + d.rows.length * 34 + big.length * 110 + (d.body === 'log' ? 78 : 0) + (MEDIA_H[d.media] || 0);
    }

    // Цветной квадратный значок (как в Shortcuts)
    function icon(d) {
        const cat = CAT[d.cat] || d;
        const el = document.createElement('span');
        el.className = 'ico' + (cat.dark ? ' dark' : '');
        el.style.setProperty('--ic', cat.color || d.color);
        if (d.icon) el.innerHTML = UI.svg(d.icon);
        else {
            el.textContent = d.glyph;
            if (d.glyph.length === 2) el.classList.add('g2');
            if (d.glyph.length > 2) el.classList.add('g3');
        }
        return el;
    }

    // Значок для миниатюры: у картинки — сама картинка
    function tileIcon(tile) {
        const a = tile.def.media === 'image' && tile.asset && Storage.asset(tile.asset);
        if (!a) return icon(tile.def);
        const el = document.createElement('span');
        el.className = 'ico photo';
        el.style.backgroundImage = `url("${Storage.url(a)}")`;
        return el;
    }

    /* ---------- Построение плитки ---------- */
    function build(tile, hooks) {
        const d = tile.def;
        const ports = {};
        tile.hooks = hooks;
        tile.refEls = {};
        const card = document.createElement('div');
        card.className = 'tile-card' + (d.body === 'group' ? ' group-card' : '') + (d.block ? ' block-card' : '') +
            (d.body === 'heading' ? ' heading-card' : '');
        // у группы, блока, сайта и заголовка размер меняют за уголок — он хранится в полях gw / gh
        const sized = d.body === 'group' || d.body === 'web' || d.body === 'heading';
        card.style.width = (sized ? tile.fields.gw : d.width) + 'px';
        if (d.body === 'group') card.style.height = tile.fields.gh + 'px';
        card.style.setProperty('--cat', colorOf(d));

        // заливка прогресса при выполнении (как в Shortcuts)
        const progress = document.createElement('div');
        progress.className = 'tile-progress';
        card.append(progress);
        tile.progressEl = progress;

        const port = (dir, id, label) => {
            const p = document.createElement('span');
            p.className = 'port ' + dir;
            p.dataset.port = id;
            p.dataset.dir = dir;
            p.title = label;
            ports[id] = p;
            return p;
        };

        const head = document.createElement('div');
        head.className = 'tile-row tile-head';
        if (d.head.in) head.append(port('in', d.head.in, 'Вход'));
        head.append(icon(d));
        const title = document.createElement('span');
        title.className = 'tile-title';
        head.append(title);
        if (d.runButton) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'tile-run';
            b.title = 'Запустить';
            b.innerHTML = UI.svg('play');
            b.addEventListener('click', () => hooks.onRun(tile));
            head.append(b);
            tile.runBtn = b;
        }
        if (d.head.out) head.append(port('out', d.head.out, 'Выход'));
        card.append(head);

        const rows = [];
        for (const spec of d.rows) {
            const r = document.createElement('div');
            r.className = 'tile-row';
            if (spec.in) r.append(port('in', spec.in, spec.label || 'Вход'));
            if (spec.label) {
                const l = document.createElement('span');
                l.className = 'row-label';
                l.textContent = spec.label;
                r.append(l);
            }
            if (spec.field) r.append(field(tile, spec.field, hooks.onField));
            if (spec.in && spec.field) {
                const chip = document.createElement('span');
                chip.className = 'row-linked';
                chip.textContent = 'по линии';
                r.append(chip);
                r.dataset.bind = spec.in;
            }
            if (spec.out) {
                r.classList.add('out-row');
                r.append(port('out', spec.out, spec.label || 'Выход'));
            }
            if (!spec.label && spec.field) r.classList.add('field-row');
            rows.push({ el: r, spec });
            card.append(r);
        }

        if (d.body === 'log') {
            const log = document.createElement('div');
            log.className = 'tile-log scroll';
            card.append(log);
            tile.logEl = log;
            tile.log = [];
            logClear(tile, 'Здесь появятся результаты');
        }
        if (d.body === 'media') {
            const box = document.createElement('div');
            box.className = 'tile-media';
            card.append(box);
            tile.mediaEl = box;
            tile.onPick = () => hooks.onPick(tile);
            renderMedia(tile);
        }
        if (d.body === 'web') card.append(Web.build(tile));
        if (sized) {
            // уголок для изменения размера рамки, окна сайта или ширины заголовка
            const grip = document.createElement('span');
            grip.className = 'group-resize';
            grip.title = 'Потяните, чтобы изменить размер';
            card.append(grip);
        }

        tile.titleEl = title;
        tile.rowEls = rows;
        setTitle(tile);
        refreshRows(tile);
        return { card, ports };
    }

    function field(tile, f, onField) {
        const val = tile.fields[f.key];
        const commit = v => {
            tile.fields[f.key] = v;
            refreshRows(tile);
            onField(tile, f.key, v);
        };

        if (f.type === 'select') {
            const s = document.createElement('select');
            s.className = 'fld fld-sel';
            fillSelect(s, typeof f.options === 'function' ? f.options() : f.options, val);
            s.addEventListener('change', () => commit(s.value));
            return s;
        }
        if (f.type === 'ref') {
            // ссылка на объект доски: список + кнопка «выбрать на доске»
            const wrap = document.createElement('span');
            wrap.className = 'fld-ref';
            const s = document.createElement('select');
            s.className = 'fld fld-sel';
            s.addEventListener('change', () => commit(s.value));
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'fld-pick';
            b.title = 'Выбрать на доске';
            b.innerHTML = UI.svg('pin');
            b.addEventListener('click', () => tile.hooks.onPickRef(tile, f.key, f.accept));
            wrap.append(s, b);
            tile.refEls[f.key] = { select: s, spec: f };
            return wrap;
        }
        if (f.type === 'toggle') {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'fld-toggle' + (val ? ' on' : '');
            b.setAttribute('role', 'switch');
            b.addEventListener('click', () => {
                const v = !tile.fields[f.key];
                b.classList.toggle('on', v);
                commit(v);
            });
            return b;
        }

        if (f.type === 'textarea' || f.type === 'code') {
            const ta = document.createElement('textarea');
            ta.className = 'fld fld-area scroll' + (f.type === 'code' ? ' fld-code' : '');
            ta.value = val == null ? '' : String(val);
            ta.spellcheck = f.type !== 'code';
            ta.rows = f.type === 'code' ? 9 : 3;
            ta.addEventListener('input', () => commit(ta.value));
            if (f.type === 'code') {
                // в коде Tab вставляет 4 пробела, Enter сохраняет отступ строки
                ta.addEventListener('keydown', e => {
                    const s = ta.selectionStart, end = ta.selectionEnd;
                    if (e.key === 'Tab') {
                        e.preventDefault();
                        ta.setRangeText('    ', s, end, 'end');
                        commit(ta.value);
                    } else if (e.key === 'Enter') {
                        const line = ta.value.slice(ta.value.lastIndexOf('\n', s - 1) + 1, s);
                        const indent = (/^\s*/.exec(line)[0]) + (/:\s*$/.test(line) ? '    ' : '');
                        e.preventDefault();
                        ta.setRangeText('\n' + indent, s, end, 'end');
                        commit(ta.value);
                    }
                });
            }
            return ta;
        }

        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'fld' + (f.type === 'number' ? ' fld-num' : '') + (f.heading ? ' fld-heading' : '');
        inp.value = val == null ? '' : String(val);
        inp.placeholder = f.placeholder || '';
        inp.spellcheck = false;
        inp.autocomplete = 'off';
        if (f.type === 'number') {
            inp.inputMode = 'decimal';
            inp.addEventListener('input', () => {
                const n = parseNum(inp.value);
                inp.classList.toggle('bad', n === null);
                if (n !== null) commit(n);
            });
            inp.addEventListener('change', () => {
                if (parseNum(inp.value) === null) inp.value = String(tile.fields[f.key]);
                inp.classList.remove('bad');
            });
        } else {
            inp.addEventListener('input', () => commit(inp.value));
        }
        // Enter внутри поля завершает ввод (а у адреса сайта ещё и открывает его)
        inp.addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            if (f.enter) f.enter(tile);
            inp.blur();
        });
        return inp;
    }

    // Варианты списка: [[значение, подпись]] или [{ group, items: [[значение, подпись]] }]
    function fillSelect(s, list, val) {
        s.innerHTML = '';
        for (const o of list) {
            if (Array.isArray(o)) { s.add(new Option(o[1], o[0], false, o[0] === val)); continue; }
            const parent = o.group ? document.createElement('optgroup') : s;
            if (o.group) parent.label = o.group;
            for (const [v, l] of o.items) parent.append(new Option(l, v, false, v === val));
            if (o.group) s.append(parent);
        }
        s.value = val;
    }

    // Обновить списки объектов в полях-ссылках (объекты появились, исчезли или переименованы)
    function refreshRefs(tile) {
        for (const key in tile.refEls) {
            const { select, spec } = tile.refEls[key];
            const val = tile.fields[key] || '';
            const ok = !val || val === '@xy' || !!Board.resolveRef(val);
            const list = [['', spec.empty || 'не выбрано'], ...Board.refOptions(spec.accept, tile.id)];
            if (!ok) list.push(['__gone', '— объект удалён —']);
            fillSelect(select, list, ok ? val : '__gone');
            const gone = select.querySelector('option[value="__gone"]');
            if (gone) gone.disabled = true;
        }
    }

    // Записать значение поля снаружи (например, объект выбран кликом на доске)
    function setField(tile, key, value) {
        tile.fields[key] = value;
        if (tile.refEls[key]) refreshRefs(tile);
        refreshRows(tile);
    }

    function setTitle(tile) {
        tile.titleEl.textContent = titleOf(tile);
        tile.titleEl.title = titleOf(tile);
    }

    function refreshRows(tile) {
        for (const { el, spec } of tile.rowEls) {
            if (spec.showIf) el.classList.toggle('muted', !spec.showIf(tile.fields));
        }
    }

    // Вход с полем подключён линией → поле прячется, значение придёт по линии
    function setLinked(tile, portId, on) {
        for (const { el } of tile.rowEls) {
            if (el.dataset.bind === portId) el.classList.toggle('linked', on);
        }
    }

    /* ---------- Содержимое медиаплитки ---------- */
    const EXT_COLORS = {
        pdf: '#FF453A', zip: '#8E8E93', rar: '#8E8E93', '7z': '#8E8E93', gz: '#8E8E93',
        doc: '#0A84FF', docx: '#0A84FF', xls: '#30D158', xlsx: '#30D158', csv: '#30D158',
        ppt: '#FF9F0A', pptx: '#FF9F0A', exe: '#5E5CE6', apk: '#30D158', tiles: '#BF5AF2'
    };

    function renderMedia(tile) {
        const box = tile.mediaEl;
        box.innerHTML = '';
        const a = tile.asset ? Storage.asset(tile.asset) : null;
        const name = tile.fileName || (a && a.name) || (tile.assetMeta && tile.assetMeta.name) || 'файл';

        if (!a) {
            const empty = document.createElement('div');
            empty.className = tile.asset ? 'media-empty missing' : 'media-empty';
            const hint = document.createElement('span');
            hint.textContent = tile.asset ? `Файл «${name}» не найден` : 'Перетащите файл сюда';
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'media-pick';
            b.innerHTML = UI.svg('upload') + '<span>' + (tile.asset ? 'Выбрать другой' : 'Выбрать файл') + '</span>';
            b.addEventListener('click', () => tile.onPick());
            empty.append(b, hint);
            box.append(empty);
            return;
        }

        const url = Storage.url(a);
        const kind = tile.def.media;
        if (kind === 'image') {
            const frame = document.createElement('div');
            frame.className = 'media-frame';
            const img = document.createElement('img');
            img.className = 'media-img';
            img.alt = '';
            img.draggable = false;
            img.decoding = 'async';
            img.addEventListener('error', () => frame.replaceWith(fileCard(a, name)), { once: true });
            img.src = url;
            frame.append(img);
            box.append(frame);
        } else if (kind === 'video') {
            const v = document.createElement('video');
            v.className = 'media-video';
            v.controls = true;
            v.preload = 'metadata';
            v.playsInline = true;
            v.src = url;
            box.append(v);
        } else if (kind === 'audio') {
            const au = document.createElement('audio');
            au.className = 'media-audio';
            au.controls = true;
            au.preload = 'metadata';
            au.src = url;
            box.append(au);
        } else if (kind === 'text') {
            const pre = document.createElement('pre');
            pre.className = 'media-text scroll';
            pre.textContent = 'Читаю…';
            const LIMIT = 64 * 1024;
            a.blob.slice(0, LIMIT).text().then(s => {
                pre.textContent = (s || '(пустой файл)') + (a.size > LIMIT ? '\n…' : '');
            });
            box.append(pre);
        } else {
            box.append(fileCard(a, name));
        }

        if (kind !== 'file') {
            const meta = document.createElement('div');
            meta.className = 'media-meta';
            meta.textContent = `${name} · ${Storage.fmtSize(a.size)}`;
            meta.title = name;
            box.append(meta);
        }
    }

    // Карточка «любого файла»: значок с расширением, имя, размер и тип
    function fileCard(a, name) {
        const ext = (/\.([a-z0-9]{1,6})$/i.exec(name) || [, 'file'])[1].toLowerCase();
        const card = document.createElement('div');
        card.className = 'file-card';
        const ic = document.createElement('div');
        ic.className = 'fc-icon';
        ic.style.setProperty('--fc', EXT_COLORS[ext] || '#8E8E93');
        ic.innerHTML = UI.svg('file') + `<span>${ext.slice(0, 5).toUpperCase()}</span>`;
        const text = document.createElement('div');
        text.className = 'fc-text';
        const n = document.createElement('b');
        n.className = 'fc-name';
        n.textContent = name;
        n.title = name;
        const s = document.createElement('span');
        s.className = 'fc-size';
        s.textContent = Storage.fmtSize(a.size) + (a.type ? ' · ' + a.type : '');
        text.append(n, s);
        card.append(ic, text);
        return card;
    }

    /* ---------- Состояние при выполнении ---------- */
    const CLIP_EMPTY = 'inset(0 100% 0 0 round 18px)';
    const CLIP_FULL = 'inset(0 0% 0 0 round 18px)';

    // state: running (заливка слева направо за ms), waiting (ждёт пользователя),
    //        done (заливка гаснет), error / warn (подпись под плиткой), idle (всё сброшено)
    function setRunState(tile, state, info = {}) {
        const p = tile.progressEl;
        if (!p) return;
        tile.el.classList.toggle('waiting', state === 'waiting');
        if (state === 'running' || state === 'waiting' || state === 'done' || state === 'idle') {
            for (const a of p.getAnimations()) a.cancel();
        }
        if (state === 'running') {
            p.style.opacity = '1';
            if (info.ms > 0) {
                p.animate([{ clipPath: CLIP_EMPTY }, { clipPath: CLIP_FULL }], { duration: info.ms, easing: 'linear', fill: 'forwards' });
            } else {
                p.style.clipPath = CLIP_FULL;
            }
        } else if (state === 'waiting') {
            p.style.clipPath = CLIP_FULL;
            p.style.opacity = '1';
            p.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 900, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' });
        } else if (state === 'done') {
            p.style.clipPath = CLIP_FULL;
            p.style.opacity = '0';
            p.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 650, easing: 'ease-out' });
        } else if (state === 'idle') {
            p.style.opacity = '0';
            setBadge(tile, null);
            tile.el.classList.remove('error', 'warn');
        } else if (state === 'error' || state === 'warn') {
            p.style.opacity = '0';
            tile.el.classList.remove('error', 'warn');
            tile.el.classList.add(state);
            setBadge(tile, state, info.text);
        }
    }

    // Подпись под плиткой с ошибкой или предупреждением (клик убирает её)
    function setBadge(tile, kind, text) {
        if (tile.badgeEl) {
            tile.badgeEl.remove();
            tile.badgeEl = null;
        }
        if (!kind) return;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'run-badge ' + kind;
        b.textContent = text;
        b.title = 'Скрыть';
        b.addEventListener('click', () => {
            setBadge(tile, null);
            tile.el.classList.remove('error', 'warn');
        });
        tile.card.append(b);
        tile.badgeEl = b;
    }

    function setRunButton(tile, running) {
        if (!tile.runBtn) return;
        tile.runBtn.classList.toggle('stop', running);
        tile.runBtn.innerHTML = UI.svg(running ? 'stop' : 'play');
        tile.runBtn.title = running ? 'Остановить' : 'Запустить';
    }

    /* ---------- Журнал плитки «Вывод» ---------- */
    const LOG_LIMIT = 500;

    function logClear(tile, placeholder) {
        tile.log = [];
        tile.logAssets = new Set();
        tile.logEl.innerHTML = '';
        if (placeholder) {
            const e = document.createElement('span');
            e.className = 'log-empty';
            e.textContent = placeholder;
            tile.logEl.append(e);
        }
    }

    function logLine(tile, node) {
        const empty = tile.logEl.querySelector('.log-empty');
        if (empty) empty.remove();
        tile.logEl.append(node);
        while (tile.logEl.childElementCount > LOG_LIMIT) tile.logEl.firstChild.remove();
        tile.logEl.scrollTop = tile.logEl.scrollHeight;
    }

    function logValue(tile, value, source) {
        const text = fmt(value);
        tile.log.push(text);
        if (tile.log.length > LOG_LIMIT) tile.log.shift();
        const line = document.createElement('div');
        line.className = 'log-line v-' + kindOf(value);
        const v = document.createElement('span');
        v.className = 'log-val';
        v.textContent = text;
        // картинку показываем прямо в журнале
        const a = isMedia(value) && value.media === 'image' && Storage.asset(value.asset);
        if (a) {
            tile.logAssets.add(a.id);
            const img = document.createElement('img');
            img.className = 'log-img';
            img.alt = '';
            img.draggable = false;
            img.src = Storage.url(a);
            v.prepend(img);
        }
        line.append(v);
        if (source) {
            const s = document.createElement('span');
            s.className = 'log-src';
            s.textContent = source;
            line.append(s);
        }
        logLine(tile, line);
    }

    function logSystem(tile, text, kind = 'muted') {
        tile.log.push('# ' + text);
        const line = document.createElement('div');
        line.className = 'log-sys ' + kind;
        line.textContent = text;
        logLine(tile, line);
    }

    // Журнал из сохранённой доски: строки с «# » — служебные сообщения
    function logRestore(tile, lines) {
        if (!Array.isArray(lines) || !lines.length) return;
        logClear(tile);
        for (const raw of lines.slice(-LOG_LIMIT)) {
            const s = String(raw);
            if (s.startsWith('# ')) { logSystem(tile, s.slice(2), 'muted'); continue; }
            // числа и True/False снова становятся значениями (для цвета строки)
            const n = parseNum(s);
            const v = n !== null && String(n) === s ? n : s === 'True' ? true : s === 'False' ? false : s;
            logValue(tile, v, '');
        }
    }

    return {
        CATEGORIES, CAT, get, list, ports, portLabel, defaults, estimateHeight, colorOf, titleOf,
        icon, tileIcon, build, setTitle, setLinked, renderMedia, refreshRefs, setField,
        setRunState, setRunButton, logClear, logValue, logSystem, logRestore,
        // значения — для движка выполнения
        SIGNAL, RunError, fail, fmt, parseNum, parseAuto, asNumber
    };
})();
