// Прокрутка списков как в osu: колесом — плавно, левой кнопкой мыши — перетаскиванием (с разгоном).
// У края список можно ещё немного «перетянуть», потом он пружиной возвращается на место.
// Пальцем на телефоне — обычная прокрутка браузера (там такая пружина уже есть)

const OVER = 56;            // насколько можно утянуть за край (px)

// axis: 'y' — вверх-вниз, 'x' — влево-вправо
export function dragScroll(el, axis = 'y', options = {}) {
    const Y = axis === 'y';
    const rubberEdge = options.rubber !== false;
    const overLimit = Math.max(1, Number(options.over) || OVER);
    const st = { pos: 0, vel: 0, target: null, release: false, drag: null, raf: 0, last: 0, timer: 0, eat: false, padA: 0, padB: 0 };
    el.classList.add('drag-scroll');
    if (!Y) el.classList.add('is-x');

    // Сколько можно прокрутить (без пустых «пружинных» отступов в начале и конце)
    const max = () => Math.max(0, (Y ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth) - st.padA - st.padB);
    const busy = () => st.drag || st.target != null || st.raf;
    // Пока список стоит, берём положение у браузера (его мог прокрутить и кто-то другой)
    const current = () => (busy() ? st.pos : Y ? el.scrollTop : el.scrollLeft);
    // За краем список двигается всё туже и туже, не выходя за заданный предел
    const rubber = x => overLimit * (1 - 1 / (x / overLimit * 0.55 + 1));

    // За краем список не сдвигается целиком: в начале или в конце появляется пустое место
    // (::before / ::after в CSS), и мы докручиваем до него
    function apply() {
        const m = max();
        const inside = Math.min(m, Math.max(0, st.pos));
        const over = st.pos - inside;
        st.padA = Math.max(0, -over);
        st.padB = Math.max(0, over);
        el.style.setProperty(Y ? '--over-a-y' : '--over-a-x', `${st.padA.toFixed(1)}px`);
        el.style.setProperty(Y ? '--over-b-y' : '--over-b-x', `${st.padB.toFixed(1)}px`);
        const to = over > 0 ? m + over : inside;
        if (Y) el.scrollTop = to;
        else el.scrollLeft = to;
    }

    function run() {
        if (st.raf) return;
        st.last = performance.now();
        st.raf = requestAnimationFrame(step);
    }

    function step(now) {
        const dt = Math.min(0.05, (now - st.last) / 1000);
        st.last = now;
        const m = max();
        if (st.drag) {
            st.raf = 0;
            return;
        }
        if (st.target != null) {
            // Колесо плавно догоняет цель; после прокрутки упруго возвращается к краю
            st.pos += (st.target - st.pos) * (1 - Math.exp(-dt * 16));
            if (st.release && (st.pos < 0 || st.pos > m)) {
                st.target = Math.min(m, Math.max(0, st.pos));
                st.release = false;
            }
            if (Math.abs(st.target - st.pos) < 0.5) {
                if (!st.release) st.pos = st.target;
                st.target = null;
                st.release = false;
            }
        } else if (Math.abs(st.vel) > 30) {
            // бросок мышью: катится и тормозит, за краем — тормозит сильно
            st.pos += st.vel * dt;
            const outside = st.pos < 0 || st.pos > m;
            if (outside && !rubberEdge) {
                st.pos = Math.min(m, Math.max(0, st.pos));
                st.vel = 0;
            } else {
                st.vel *= Math.exp(-dt * (outside ? 20 : 3.5));
            }
        } else {
            // пружина обратно к краю
            st.vel = 0;
            const edge = Math.min(m, Math.max(0, st.pos));
            st.pos += (edge - st.pos) * (1 - Math.exp(-dt * 18));
            if (Math.abs(edge - st.pos) < 0.5) {
                st.pos = edge;
                apply();
                st.raf = 0;
                return;
            }
        }
        apply();
        st.raf = requestAnimationFrame(step);
    }

    // ===== Колесо мыши =====
    function wheel(e) {
        let d = Y ? e.deltaY : (e.deltaX || e.deltaY);
        if (e.deltaMode === 1) d *= 40;
        else if (e.deltaMode === 2) d *= Y ? el.clientHeight : el.clientWidth;
        if (!d) return;
        e.preventDefault();
        const m = max();
        const now = current();
        const reversingOverscroll = st.target != null
            && ((st.target < 0 && d > 0) || (st.target > m && d < 0));
        const base = st.target != null && !reversingOverscroll ? st.target : now;
        st.pos = now;
        const raw = base + d;
        st.target = !rubberEdge ? Math.min(m, Math.max(0, raw))
            : raw < 0 ? -rubber(-raw)
            : raw > m ? m + rubber(raw - m)
            : raw;
        st.vel = 0;
        st.release = false;
        run();
        // колесо остановилось, а цель за краем — как только доедем до края, пружина вернёт список
        clearTimeout(st.timer);
        st.timer = setTimeout(() => {
            if (st.target != null && (st.target < 0 || st.target > max())) st.release = true;
            run();
        }, 90);
    }
    el.addEventListener('wheel', wheel, { passive: false });

    // ===== Перетаскивание левой кнопкой мыши =====
    el.addEventListener('pointerdown', e => {
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        // ползунки, поля ввода и «циферблат» тянутся сами — список при этом не листаем
        if (e.target.closest('input, textarea, select, .no-drag')) return;
        st.pos = current();
        if (!rubberEdge) st.pos = Math.min(max(), Math.max(0, st.pos));
        st.drag = { id: e.pointerId, start: Y ? e.clientY : e.clientX, base: st.pos, moved: false, track: [] };
        st.target = null;
        st.vel = 0;
    });

    addEventListener('pointermove', e => {
        const d = st.drag;
        if (!d || e.pointerId !== d.id) return;
        const delta = d.start - (Y ? e.clientY : e.clientX);
        if (!d.moved) {
            if (Math.abs(delta) < 6) return;         // маленький сдвиг — это ещё просто клик
            d.moved = true;
            el.classList.add('is-dragging');
        }
        const m = max();
        const now = performance.now();
        const raw = d.base + delta;
        if (!rubberEdge && (raw < 0 || raw > m)) {
            // Уровни не растягиваются за край; после разворота движение сразу снова листает список
            st.pos = Math.min(m, Math.max(0, raw));
            d.base = st.pos;
            d.start = Y ? e.clientY : e.clientX;
            d.track = [[now, st.pos]];
        } else {
            st.pos = raw < 0 ? -rubber(-raw) : raw > m ? m + rubber(raw - m) : raw;
            d.track.push([now, raw]);
            while (d.track.length > 2 && now - d.track[0][0] > 100) d.track.shift();
        }
        apply();
    });

    function end(e) {
        const d = st.drag;
        if (!d || e.pointerId !== d.id) return;
        st.drag = null;
        el.classList.remove('is-dragging');
        if (d.moved) {
            // скорость броска — по последним 100 мс движения
            const a = d.track[0], b = d.track[d.track.length - 1];
            const span = (b[0] - a[0]) / 1000;
            if (span > 0 && performance.now() - b[0] < 80) st.vel = (b[1] - a[1]) / span;
            // отпускание после перетаскивания — не клик по карточке
            st.eat = true;
            setTimeout(() => {
                st.eat = false;
            }, 0);
        }
        run();
    }
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);

    el.addEventListener('click', e => {
        if (!st.eat) return;
        st.eat = false;
        e.stopPropagation();
        e.preventDefault();
    }, true);

    return { wheel };
}
