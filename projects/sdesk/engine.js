/* Short Desk — движок выполнения.

   Как идут данные:
   • Выполнение начинается только с плиток «Запуск».
   • Плитка срабатывает, когда на все её подключённые входы пришли значения.
     Каждое новое значение запускает её снова — с последними значениями остальных входов.
   • Результат уходит по всем линиям из выхода, поэтому ветвления работают сами собой.
   • Ветки идут одновременно: «Подождать» в одной ветке не задерживает другие.
     Срабатывания одной и той же плитки идут строго по очереди.
   • Циклы и функции ждут, пока их ветка отработает целиком. Для этого у каждой
     волны срабатываний есть «метка» (token) со счётчиком: пока счётчик не ноль,
     ветка ещё работает.
   • Защита от бесконечных циклов: не больше N срабатываний (и N перемещений) за запуск
     (N меняется в меню ПКМ по пустому месту → «Лимит шагов»). Python выполняется
     в отдельном потоке, поэтому «Стоп» прерывает даже зациклившийся Python-код. */
const Engine = (() => {
    // Скорость показа: сколько длится заливка плитки и импульс по линии (мс)
    const SPEEDS = {
        instant: { step: 0, flow: 0 },
        fast:    { step: 240, flow: 180 },
        slow:    { step: 700, flow: 480 }
    };
    // В режиме «Быстро» длинные программы (циклы) постепенно разгоняются до мгновенных
    const ACCEL_FROM = 60, ACCEL_SPAN = 60;
    const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

    class LimitError extends Error {}
    class StopError extends Error {}

    let run = null, seq = 0;
    let pill, pillText, pillSteps, pillTimer = 0;
    let py = null, pySeq = 0;           // поток с Python (Pyodide)

    function init() {
        pill = document.getElementById('runPill');
        pillText = document.getElementById('runText');
        pillSteps = document.getElementById('runSteps');
        document.getElementById('runStop').addEventListener('click', () => stop());
        Board.on('run', id => (run ? stop() : start([id])));
    }

    /* ---------- Блоки ----------
       «Блок» — рамка-программа. Плитка принадлежит самому маленькому блоку, в котором лежит
       её середина. «Запуски» внутри блока срабатывают, только когда запускают сам блок. */
    function ownerBlock(t) {
        let best = null;
        const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
        for (const b of Board.tiles.values()) {
            if (b.type !== 'block' || b === t) continue;
            if (cx < b.x || cx > b.x + b.w || cy < b.y || cy > b.y + b.h) continue;
            if (!best || b.w * b.h < best.w * best.h) best = b;
        }
        return best;
    }

    // С чего начинается блок (или вся программа, если block = null):
    // его «Запуски» и вложенные блоки, в которые не входит ни одна линия
    function entries(block) {
        return [...Board.tiles.values()].filter(t =>
            (t.type === 'start' || (t.type === 'block' && !Board.inputsOf(t.id).size)) && ownerBlock(t) === block);
    }

    const startIds = () => entries(null).map(t => t.id);
    const receivers = name => [...Board.tiles.values()].filter(x => x.type === 'receive' && String(x.fields.name).trim() === name);
    const setRunButtons = on => {
        for (const t of Board.tiles.values()) if (t.def.runButton) Nodes.setRunButton(t, on);
    };

    /* ---------- Запуск и остановка ---------- */
    function start(ids) {
        if (run) stop();
        ids = (ids || startIds()).filter(id => Board.getTile(id));
        if (!ids.length) {
            UI.toast(Board.tiles.size && [...Board.tiles.values()].some(t => t.type === 'start')
                ? 'Все «Запуски» лежат внутри блоков — запустите блок кнопкой ▶ на нём'
                : 'Добавьте плитку «Запуск» — выполнение начинается с неё');
            return;
        }
        const r = {
            id: ++seq, stopped: false, steps: 0, moves: 0, active: 0,
            limit: Math.max(1, Math.round(Board.settings.stepLimit) || 1000),
            speed: Board.settings.speed,
            vars: new Map(), state: new Map(), busy: new Set(),
            timers: new Set(), wakers: new Set(), tokens: new Set(), aborts: new Set(),
            functions: new Map(), cancelDialog: null, pyCancel: null, sounds: new Set(),
            outputs: reachableOutputs(ids)
        };
        run = r;
        for (const t of Board.tiles.values()) Nodes.setRunState(t, 'idle');
        for (const t of r.outputs) Nodes.logClear(t);
        setRunButtons(true);
        showPill('run');
        for (const id of ids) schedule(r, Board.getTile(id), {}, {}, null);
    }

    function stop(reason = 'Выполнение остановлено') {
        const r = run;
        if (!r) return;
        for (const o of outputsOf(r)) Nodes.logSystem(o, reason, 'muted');
        end(r, 'stopped');
    }

    // Все «Выводы», до которых можно дойти от выбранных «Запусков»
    // (по линиям, а также внутрь блоков, к получателям сигналов и в функции)
    function reachableOutputs(ids) {
        const seen = new Set(ids), queue = [...ids], outs = [];
        const visit = id => {
            if (seen.has(id)) return;
            seen.add(id);
            queue.push(id);
        };
        while (queue.length) {
            const id = queue.shift();
            const t = Board.getTile(id);
            if (!t) continue;
            if (t.type === 'out') outs.push(t);
            for (const l of Board.linksOf(id)) if (l.from.tile === id) visit(l.to.tile);
            const name = String(t.fields.name || '').trim();
            if (t.type === 'block') for (const e of entries(t)) visit(e.id);
            if (t.type === 'send') for (const x of receivers(name)) visit(x.id);
            if (t.type === 'fnCall') {
                for (const x of Board.tiles.values()) if (x.type === 'fnStart' && String(x.fields.name).trim() === name) visit(x.id);
            }
        }
        return outs;
    }

    function outputsOf(r) {
        const set = new Set(r.outputs);
        for (const id of r.state.keys()) {
            const t = Board.getTile(id);
            if (t && t.type === 'out') set.add(t);
        }
        return [...set].filter(t => Board.tiles.has(t.id));
    }

    function pace(r) {
        const base = SPEEDS[r.speed] || SPEEDS.fast;
        if (r.speed !== 'fast' || r.steps <= ACCEL_FROM) return base;
        const k = Math.max(0, 1 - (r.steps - ACCEL_FROM) / ACCEL_SPAN);
        return { step: base.step * k, flow: base.flow * k };
    }

    /* ---------- Метки волн: «ветка ещё работает?» ---------- */
    function makeToken(r, parent) {
        const tok = { count: 0, waiters: [], parent };
        r.tokens.add(tok);
        return tok;
    }
    function hold(tok) {
        if (tok) tok.count++;
    }
    function release(tok) {
        if (tok && --tok.count <= 0) {
            tok.count = 0;
            for (const w of tok.waiters.splice(0)) w();
        }
    }
    // Ждать, пока все срабатывания с этой меткой закончатся
    function settled(r, tok) {
        return new Promise(resolve => {
            tok.waiters.push(resolve);
            release(tok);           // снимаем «страховку», поставленную при создании волны
        });
    }
    const descends = (tok, from) => {
        for (let t = tok; t; t = t.parent) if (t === from) return true;
        return false;
    };

    /* ---------- Срабатывание плиток ---------- */
    function stateOf(r, id) {
        let st = r.state.get(id);
        if (!st) {
            st = { inputs: {}, from: {}, got: new Set(), chain: Promise.resolve(), awaiting: null };
            r.state.set(id, st);
        }
        return st;
    }

    // Ставим срабатывание в очередь плитки (одна плитка — по одному за раз)
    function schedule(r, t, inputs, from, tok) {
        const st = stateOf(r, t.id);
        // волна вернулась в ту же плитку, которая её ждёт, — не считаем её частью волны (иначе вечное ожидание)
        if (tok && st.awaiting && descends(tok, st.awaiting)) tok = st.awaiting.parent;
        hold(tok);
        r.active++;
        st.chain = st.chain
            .then(() => fire(r, t, inputs, from, tok))
            .catch(err => fail(r, t, err))
            .finally(() => {
                r.active--;
                release(tok);
                checkDone(r);
            });
    }

    async function fire(r, t, inputs, from, tok) {
        if (r.stopped || !Board.tiles.has(t.id)) return;
        if (++r.steps > r.limit) throw new LimitError();
        pillSteps.textContent = 'шаг ' + r.steps;
        // в длинных циклах даём браузеру перерисоваться и принять «Стоп»
        if (r.steps % 200 === 0) await new Promise(ok => setTimeout(ok, 0));
        if (r.stopped) return;
        if (!t.def.run) return;

        r.busy.add(t.id);
        const p = pace(r);
        if (!t.def.selfTimed) {
            Nodes.setRunState(t, 'running', { ms: p.step });
            if (p.step > 0) await sleep(r, p.step);
            if (r.stopped) return;
        }
        const value = await t.def.run(context(r, t, inputs, from, tok));
        if (r.stopped || !Board.tiles.has(t.id)) return;
        if (value !== undefined && Nodes.ports(t.def).out.includes('out')) emit(r, t, 'out', value, tok);
        r.busy.delete(t.id);
        Nodes.setRunState(t, 'done');
    }

    function context(r, t, inputs, from, tok) {
        const linked = Board.inputsOf(t.id);
        // Запустить новую волну срабатываний и дождаться, пока она вся отработает
        // (как emitAndWait, только плитки ставятся в очередь напрямую, без линий)
        const wave = async launch => {
            const st = stateOf(r, t.id);
            const w = makeToken(r, tok), prev = st.awaiting;
            st.awaiting = w;
            hold(w);
            launch(w);
            await settled(r, w);
            st.awaiting = prev;
            if (r.stopped) throw new StopError();
        };
        const ctx = {
            tile: t,
            vars: r.vars,
            input: inputs.in,
            f: key => t.fields[key],
            linked: name => linked.has(name),
            // значение входа; если вход не подключён — значение поля с тем же именем
            get: name => (linked.has(name) ? inputs[name] : t.fields[name]),
            num(v, what) {
                const on = what ? `на вход «${what}»` : 'на вход';
                if (v === undefined) Nodes.fail(`${on} ничего не пришло`);
                if (v === Nodes.SIGNAL) Nodes.fail(`${on} пришёл сигнал запуска, а нужно число`);
                const n = Nodes.asNumber(v);
                if (n === null || Number.isNaN(n)) Nodes.fail(`${on} пришло «${Nodes.fmt(v)}», а нужно число`);
                return n;
            },
            emit: (port, value) => emit(r, t, port, value, tok),
            // отправить и дождаться, пока вся ветка за этим контактом отработает (для циклов)
            async emitAndWait(port, value) {
                const st = stateOf(r, t.id);
                const wave = makeToken(r, tok), prev = st.awaiting;
                st.awaiting = wave;
                hold(wave);
                emit(r, t, port, value, wave);
                await settled(r, wave);
                st.awaiting = prev;
                if (r.stopped) throw new StopError();
            },
            // один шаг цикла: считается в лимит и даёт браузеру передохнуть
            async tick() {
                if (r.stopped) throw new StopError();
                if (++r.steps > r.limit) throw new LimitError();
                pillSteps.textContent = 'шаг ' + r.steps;
                if (r.steps % 100 === 0) await new Promise(ok => setTimeout(ok, 0));
                if (r.stopped) throw new StopError();
            },
            waiting: () => Nodes.setRunState(t, 'waiting'),
            // сигнал отмены для сетевого запроса: «Стоп» или тайм-аут
            signal(ms) {
                const ctl = new AbortController();
                r.aborts.add(ctl);
                setTimeout(() => ctl.abort(), ms);
                return ctl.signal;
            },
            // перемещения: свой счётчик, чтобы зациклившиеся перестановки тоже останавливались
            countMove() {
                if (++r.moves > r.limit) throw new LimitError('moves');
            },
            moveMs: () => (r.speed === 'instant' ? 0 : Math.max(260, pace(r).step * 1.6)),
            // магниты сработают, когда цепочка перемещений закончится
            settle: () => Board.requestMagnets(r.speed === 'instant' ? 0 : SPEEDS[r.speed].step + SPEEDS[r.speed].flow + 120),
            // встроенный файл медиаплитки
            asset() {
                const a = t.asset && Storage.asset(t.asset);
                if (!a) Nodes.fail(t.asset ? 'файл не найден — выберите его заново' : 'файл ещё не выбран');
                return a;
            },
            async sleep(ms) {
                Nodes.setRunState(t, 'running', { ms });
                if (ms > 0) await sleep(r, ms);
            },
            ask: (question, kind) => ask(r, t, question, kind),
            // окно с сообщением или вопросом «да/нет»; «Стоп» закрывает его
            async dialog(opts) {
                Nodes.setRunState(t, 'waiting');
                const res = await UI.confirm({ backdropClose: false, ...opts, bind: cancel => { r.cancelDialog = cancel; } });
                r.cancelDialog = null;
                if (r.stopped) throw new StopError();
                Nodes.setRunState(t, 'running', { ms: 0 });
                return res;
            },
            // своё «хранилище» плитки на время запуска (счётчики, «только первый раз»)
            memo() {
                const st = stateOf(r, t.id);
                return st.memo || (st.memo = {});
            },
            // звук или речь: функция stop заглушит их при остановке программы
            sound(stopFn) {
                r.sounds.add(stopFn);
                return () => r.sounds.delete(stopFn);
            },
            // «Блок»: запускает свои «Запуски» (передавая им значение) и ждёт, пока всё внутри отработает
            async runBlock(value) {
                const inner = entries(t);
                if (!inner.length) Nodes.fail('внутри блока нет плитки «Запуск» — положите её в рамку');
                await wave(st => {
                    for (const e of inner) schedule(r, e, value === undefined ? {} : { in: value }, { in: t.id }, st);
                });
                return value === undefined ? Nodes.SIGNAL : value;
            },
            // «Отправить сигнал»: значение получают все «Получить сигнал» с этим именем
            async broadcast(name, value, wait) {
                const list = receivers(name);
                if (!list.length) Nodes.fail(`сигнал «${name}» никто не получает — добавьте плитку «Получить сигнал» с этим именем`);
                const v = value === undefined ? Nodes.SIGNAL : value;
                if (!wait) {
                    for (const x of list) schedule(r, x, { in: v }, { in: t.id }, tok);
                    return;
                }
                await wave(st => {
                    for (const x of list) schedule(r, x, { in: v }, { in: t.id }, st);
                });
            },
            log(value) {
                const src = from.in && Board.getTile(from.in);
                Nodes.logValue(t, value, src ? Nodes.titleOf(src) : '');
            },
            python: (code, input) => python(r, t, code, input, line => emit(r, t, 'out', line, tok)),
            fnCall: (name, value) => callFunction(r, t, name, value, tok),
            fnReturn: (name, value) => returnFromFunction(r, name, value)
        };
        return ctx;
    }

    // Значение уходит по всем линиям из контакта; импульс бежит по линии.
    // Если одно значение идёт сразу на несколько входов одной плитки (например, на A и B),
    // оно приходит туда одновременно, и плитка срабатывает один раз.
    function emit(r, t, port, value, tok) {
        if (r.stopped) return;
        const p = pace(r);
        const byTile = new Map();
        for (const l of Board.outLinks(t.id, port)) {
            if (!byTile.has(l.to.tile)) byTile.set(l.to.tile, []);
            byTile.get(l.to.tile).push(l);
        }
        for (const group of byTile.values()) {
            if (p.flow > 0) {
                for (const l of group) Board.pulseLink(l.id, p.flow);
                r.active++;
                hold(tok);
                later(r, p.flow, () => {
                    deliver(r, group, value, tok);
                    r.active--;
                    release(tok);
                    checkDone(r);
                });
            } else {
                deliver(r, group, value, tok);
            }
        }
    }

    function deliver(r, group, value, tok) {
        if (r.stopped) return;
        const live = group.filter(l => Board.links.has(l.id));
        const t = live.length && Board.getTile(live[0].to.tile);
        if (!t) return;
        const st = stateOf(r, t.id);
        for (const l of live) {
            st.inputs[l.to.port] = value;
            st.from[l.to.port] = l.from.tile;
            st.got.add(l.to.port);
        }
        for (const p of Board.inputsOf(t.id)) if (!st.got.has(p)) return;   // ждём остальные входы
        schedule(r, t, { ...st.inputs }, { ...st.from }, tok);
    }

    function later(r, ms, fn) {
        const id = setTimeout(() => {
            r.timers.delete(id);
            if (!r.stopped) fn();
        }, ms);
        r.timers.add(id);
    }

    // Пауза, которую «Стоп» прерывает сразу
    function sleep(r, ms) {
        return new Promise(resolve => {
            const wake = () => {
                clearTimeout(id);
                r.wakers.delete(wake);
                resolve();
            };
            const id = setTimeout(wake, ms);
            r.wakers.add(wake);
        });
    }

    // input(): окно с вопросом. «Остановить» прекращает выполнение.
    async function ask(r, t, question, kind) {
        Nodes.setRunState(t, 'waiting');
        const answer = await UI.prompt({
            title: String(question || '').trim() || 'Введите значение',
            text: kind === 'num' ? 'Нужно ввести число' : `Плитка «${Nodes.titleOf(t)}»`,
            ok: 'Готово', cancel: 'Остановить', backdropClose: false, maxLength: 2000,
            validate: v => (kind === 'num' && Nodes.parseNum(v) === null ? 'Введите число, например 5 или 2,5' : null),
            bind: cancel => { r.cancelDialog = cancel; }
        });
        r.cancelDialog = null;
        if (answer === null) {
            if (!r.stopped) stop('Ввод отменён — выполнение остановлено');
            return undefined;
        }
        Nodes.setRunState(t, 'running', { ms: 0 });
        if (kind === 'num') return Nodes.parseNum(answer);
        return kind === 'text' ? answer : Nodes.parseAuto(answer);
    }

    /* ---------- Свои функции ----------
       «Вызвать функцию» отправляет значение из плитки «Функция» с тем же именем
       и ждёт, пока её ветка отработает; результат приносит «Вернуть результат».
       Вызовы одной функции идут по очереди; рекурсия не поддерживается. */
    async function callFunction(r, t, name, value, tok) {
        const starts = [...Board.tiles.values()].filter(x => x.type === 'fnStart' && String(x.fields.name).trim() === name);
        if (!starts.length) Nodes.fail(`функция «${name}» не найдена — добавьте плитку «Функция» с этим именем`);
        if (starts.length > 1) Nodes.fail(`функций с именем «${name}» несколько — переименуйте лишние`);
        const busy = r.functions.get(name);
        if (busy && descends(tok, busy.wave)) Nodes.fail(`функция «${name}» вызывает сама себя — рекурсия не поддерживается`);
        while (r.functions.get(name)) await r.functions.get(name).done;
        if (r.stopped) throw new StopError();

        let finish;
        const call = { wave: makeToken(r, tok), done: new Promise(f => { finish = f; }), has: false, result: undefined };
        r.functions.set(name, call);
        try {
            const head = starts[0];
            Nodes.setRunState(head, 'running', { ms: pace(r).step });
            hold(call.wave);
            emit(r, head, 'out', value, call.wave);
            await settled(r, call.wave);
            Nodes.setRunState(head, 'done');
            if (r.stopped) throw new StopError();
            if (!call.has) Nodes.fail(`функция «${name}» закончилась, но до «Вернуть результат» ничего не дошло`);
            return call.result;
        } finally {
            r.functions.delete(name);
            finish();
        }
    }

    function returnFromFunction(r, name, value) {
        const call = r.functions.get(name);
        if (!call) Nodes.fail(`«Вернуть результат» сработал вне вызова функции «${name}»`);
        call.result = value;
        call.has = true;
    }

    /* ---------- Python (Pyodide в отдельном потоке) ----------
       Плюсы: настоящий Python 3 и пакеты вроде numpy прямо в браузере, без сервера.
       Ограничения: первая загрузка ≈ 10 МБ (дальше из кэша), нет доступа к файлам
       компьютера, input() читает значение, пришедшее по линии, а не спрашивает. */
    function pyWorker() {
        if (py) return py;
        const src = `
importScripts('${PYODIDE}pyodide.js');
let pyodide = null, queue = Promise.resolve();
// вызовы выполняются строго по очереди: у каждого свой print() и input()
self.onmessage = e => { queue = queue.then(() => runCode(e.data)); };
async function runCode({ id, code, input, stdin }) {
    try {
        if (!pyodide) {
            self.postMessage({ id, type: 'loading' });
            pyodide = await loadPyodide({ indexURL: '${PYODIDE}' });
            self.postMessage({ id, type: 'ready' });
        }
        const lines = stdin.slice();
        pyodide.setStdout({ batched: text => self.postMessage({ id, type: 'out', text }) });
        pyodide.setStderr({ batched: () => {} });
        pyodide.setStdin({ stdin: () => (lines.length ? lines.shift() : undefined) });
        await pyodide.loadPackagesFromImports(code);
        const ns = pyodide.globals.get('dict')();
        ns.set('inp', pyodide.toPy(input));
        await pyodide.runPythonAsync(code, { globals: ns });
        const res = ns.get('result');
        let out = res && res.toJs ? res.toJs({ dict_converter: Object.fromEntries }) : res;
        try { structuredClone(out); } catch { out = String(res); }
        ns.destroy();
        self.postMessage({ id, type: 'done', result: out === undefined ? null : out });
    } catch (err) {
        self.postMessage({ id, type: 'error', text: String((err && err.message) || err) });
    }
}`;
        const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        py = { worker, calls: new Map(), ready: false };
        worker.onmessage = e => {
            const handler = py && py.calls.get(e.data.id);
            if (handler) handler(e.data);
        };
        worker.onerror = e => {
            e.preventDefault();
            const calls = py ? [...py.calls.values()] : [];
            killPython();
            for (const h of calls) h({ type: 'error', text: 'не удалось загрузить Python — проверьте интернет' });
        };
        return py;
    }

    function killPython() {
        if (!py) return;
        py.worker.terminate();
        py = null;
    }

    // Значение для Python: только то, что можно передать в поток
    function plain(v) {
        if (v === undefined || v === Nodes.SIGNAL) return null;
        if (Array.isArray(v)) return v.map(plain);
        if (v && typeof v === 'object') {
            if (v.media && v.asset) return v.name;
            return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
        }
        return v;
    }

    function python(r, t, code, input, onLine) {
        return new Promise((resolve, reject) => {
            const p = pyWorker(), id = ++pySeq;
            const value = plain(input);
            const stdin = value == null ? [] : (typeof value === 'string' ? value : Nodes.fmt(input)).split('\n');
            const done = () => {
                p.calls.delete(id);
                r.pyCancel = null;
            };
            r.pyCancel = () => { done(); resolve(undefined); };
            p.calls.set(id, m => {
                if (m.type === 'loading') {
                    Nodes.setRunState(t, 'waiting');
                    UI.toast('Загружаю Python — в первый раз это займёт несколько секунд');
                } else if (m.type === 'ready') {
                    p.ready = true;
                    Nodes.setRunState(t, 'running', { ms: 0 });
                } else if (m.type === 'out') {
                    onLine(m.text);
                } else if (m.type === 'done') {
                    done();
                    resolve(m.result === null ? undefined : m.result);
                } else if (m.type === 'error') {
                    done();
                    // из длинного traceback показываем последнюю строку, например «ZeroDivisionError: division by zero»
                    const lines = String(m.text).trim().split('\n').filter(s => s.trim());
                    reject(new Nodes.RunError('Python — ' + (lines[lines.length - 1] || m.text)));
                }
            });
            Nodes.setRunState(t, p.ready ? 'running' : 'waiting', { ms: 0 });
            p.worker.postMessage({ id, code, input: value, stdin });
        });
    }

    /* ---------- Завершение ---------- */
    function fail(r, t, err) {
        if (r.stopped || run !== r || err instanceof StopError) return;
        r.busy.delete(t.id);
        if (err instanceof LimitError) {
            const what = err.message === 'moves' ? 'перемещений' : 'шагов';
            Nodes.setRunState(t, 'warn', { text: `Здесь сработал лимит: ${r.limit} ${what}` });
            report(r, `Остановлено: больше ${r.limit} ${what} — похоже на бесконечный цикл. ` +
                'Лимит меняется так: ПКМ по пустому месту доски → «Лимит шагов».');
            end(r, 'limit');
            return;
        }
        const known = err instanceof Nodes.RunError;
        if (!known) console.error(err);
        const msg = known ? err.message : 'внутренняя ошибка: ' + (err && err.message);
        Nodes.setRunState(t, 'error', { text: msg.charAt(0).toUpperCase() + msg.slice(1) });
        report(r, `Ошибка в «${Nodes.titleOf(t)}»: ${msg}`);
        end(r, 'error');
    }

    function report(r, text) {
        const outs = outputsOf(r);
        if (outs.length) for (const o of outs) Nodes.logSystem(o, text, 'error');
        else UI.toast(text);
    }

    function checkDone(r) {
        if (r.active === 0 && run === r && !r.stopped) finish(r);
    }

    // Всё отработало: отмечаем плитки, которые так и не дождались части входов
    function finish(r) {
        let waiting = 0;
        for (const [id, st] of r.state) {
            const t = Board.getTile(id);
            if (!t || !st.got.size) continue;
            const missing = [...Board.inputsOf(id)].filter(p => !st.got.has(p));
            if (!missing.length) continue;
            waiting++;
            Nodes.setRunState(t, 'warn', { text: 'Не дождалась входа: ' + missing.map(p => Nodes.portLabel(t.def, p)).join(', ') });
        }
        for (const o of outputsOf(r)) if (!o.log.length) Nodes.logClear(o, 'Сюда ничего не пришло');
        end(r, waiting ? 'warn' : 'done', waiting);
    }

    function end(r, kind, extra) {
        if (run !== r) return;
        r.stopped = true;
        run = null;
        for (const wake of [...r.wakers]) wake();
        for (const id of r.timers) clearTimeout(id);
        r.timers.clear();
        for (const ctl of r.aborts) ctl.abort();
        for (const tok of r.tokens) for (const w of tok.waiters.splice(0)) w();
        if (r.cancelDialog) r.cancelDialog();
        // зависший или ещё работающий Python останавливаем вместе с потоком
        if (r.pyCancel) {
            killPython();
            r.pyCancel();
        }
        for (const id of r.busy) {
            const t = Board.getTile(id);
            if (t) Nodes.setRunState(t, 'done');
        }
        setRunButtons(false);
        // звуки и речь замолкают вместе с остановкой
        for (const s of r.sounds) s();
        r.sounds.clear();
        Board.requestMagnets();
        Board.noteChange();         // журналы «Вывода» изменились — пусть сохранятся
        showPill(kind, extra);
    }

    /* ---------- Плашка «Выполняется» ---------- */
    function showPill(kind, extra) {
        clearTimeout(pillTimer);
        const texts = {
            run: 'Выполняется',
            done: 'Готово',
            warn: `Готово · ${extra} ${Menus.plural(extra || 0, 'плитка не дождалась', 'плитки не дождались', 'плиток не дождались')} входа`,
            error: 'Ошибка',
            limit: 'Остановлено: лимит шагов',
            stopped: 'Остановлено'
        };
        pill.className = 'run-pill glass show ' + kind;
        pillText.textContent = texts[kind];
        if (kind === 'run') pillSteps.textContent = '';
        document.body.classList.toggle('is-running', true);
        if (kind !== 'run') {
            pillTimer = setTimeout(() => {
                pill.classList.remove('show');
                document.body.classList.remove('is-running');
            }, kind === 'done' || kind === 'stopped' ? 1800 : 4200);
        }
    }

    return { init, start, stop, isRunning: () => !!run, hasStart: () => startIds().length > 0 };
})();
