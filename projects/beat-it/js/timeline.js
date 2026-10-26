// Лента времени редактора (внизу) и полоска всей песни под ней; колесо плавно двигает обзор.
// На ленте: секунды, биты и такты, дропы, эффекты, «удары» песни и ноты. Посередине — «сейчас».
//   Выбор — клик по ноте (Shift — добавить к выбору), рамка по пустому месту, перетаскивание — сдвиг во времени;
//   Нота / Длинная — клик или протяжка по пустому месту ставит ноту; правый клик по ноте — удалить;
//   колесо — листать, Ctrl + колесо — масштаб; верхняя полоса с секундами — перемотка

import { DEG, shapePath } from './field.js?v=2';
import { roundRect, clamp } from './util.js?v=1';

const RULER = 22;           // высота полосы с секундами
const R = 9;                // размер нот на ленте

// ed — редактор: { E, notes(), seek(t), snapT(t), step(t), isBar(i), addNote(t, type), commit(), changed(), select(), remove(list) }
export function timeline(canvas, over, ed) {
    let E = ed.E;             // открытый уровень (редактор открывают заново — берём свежий)
    const c = canvas.getContext('2d');
    const o = over.getContext('2d');
    let W = 0, H = 0, OW = 0, OH = 0, dpr = 1;
    let drag = null;          // что сейчас тянем
    let hover = null;
    let hoverFx = null;
    let viewT = E.t, targetViewT = E.t;
    let lastFrame = performance.now();
    let userPanAt = 0;

    function resize() {
        dpr = Math.min(2, window.devicePixelRatio || 1);
        W = canvas.clientWidth;
        H = canvas.clientHeight;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        OW = over.clientWidth;
        OH = over.clientHeight;
        over.width = Math.round(OW * dpr);
        over.height = Math.round(OH * dpr);
    }

    const X = t => W / 2 + (t - viewT) * E.zoom;
    const T = x => viewT + (x - W / 2) / E.zoom;
    const laneY = () => RULER + (H - RULER) * 0.56;

    function effectMarks() {
        const slots = [[], [], []];
        return E.effects.map(fx => {
            const x = X(fx.t);
            let slot = slots.findIndex(row => row.every(px => Math.abs(px - x) >= 13));
            if (slot < 0) slot = 2;
            slots[slot].push(x);
            return { fx, x, y: H - 14 - slot * 10 };
        });
    }

    function effectAt(x, y) {
        if (y < H - 43) return null;
        let best = null, distance = 11;
        for (const mark of effectMarks()) {
            const d = Math.hypot(x - mark.x, y - mark.y);
            if (d < distance) {
                best = mark.fx;
                distance = d;
            }
        }
        return best;
    }

    function drawEffectIcon(fx, x, y, active, hot) {
        c.save();
        c.translate(x, y);
        if (active) {
            c.fillStyle = '#fff';
            c.beginPath();
            c.arc(0, 0, 9, 0, Math.PI * 2);
            c.fill();
        } else if (hot) {
            c.strokeStyle = '#fff';
            c.lineWidth = 1.5;
            c.beginPath();
            c.arc(0, 0, 9, 0, Math.PI * 2);
            c.stroke();
        }
        c.strokeStyle = active ? '#000' : '#fff';
        c.fillStyle = active ? '#000' : '#fff';
        c.lineWidth = 1.5;
        c.lineCap = 'round';
        c.lineJoin = 'round';

        const polygon = (sides, radius, rotation = -Math.PI / 2) => {
            c.beginPath();
            for (let i = 0; i < sides; i++) {
                const a = rotation + i * Math.PI * 2 / sides;
                const px = Math.cos(a) * radius, py = Math.sin(a) * radius;
                if (i) c.lineTo(px, py);
                else c.moveTo(px, py);
            }
            c.closePath();
            c.stroke();
        };
        const star = (sx, sy, radius) => {
            c.beginPath();
            for (let i = 0; i < 8; i++) {
                const r = i % 2 ? radius * 0.38 : radius;
                const a = -Math.PI / 2 + i * Math.PI / 4;
                const px = sx + Math.cos(a) * r, py = sy + Math.sin(a) * r;
                if (i) c.lineTo(px, py);
                else c.moveTo(px, py);
            }
            c.closePath();
            c.fill();
        };

        switch (fx.type) {
            case 'flash':
                for (let i = 0; i < 8; i++) {
                    const a = i * Math.PI / 4;
                    c.beginPath();
                    c.moveTo(Math.cos(a) * 2, Math.sin(a) * 2);
                    c.lineTo(Math.cos(a) * 7, Math.sin(a) * 7);
                    c.stroke();
                }
                break;
            case 'ring':
                c.beginPath(); c.arc(0, 0, 3, 0, Math.PI * 2); c.stroke();
                c.beginPath(); c.arc(0, 0, 7, 0, Math.PI * 2); c.stroke();
                break;
            case 'poly': polygon(6, 7); break;
            case 'square':
                c.strokeRect(-5, -5, 10, 10);
                c.strokeRect(-2, -2, 4, 4);
                break;
            case 'stars':
                star(-4, 1, 4);
                star(4, -2, 4);
                break;
            case 'lines':
                for (let i = -2; i <= 2; i++) {
                    c.beginPath();
                    c.moveTo(i * 3, 6);
                    c.lineTo(i * 3, -6 + Math.abs(i) * 1.5);
                    c.stroke();
                }
                break;
            case 'confetti':
                c.fillRect(-6, -5, 3, 3);
                c.fillRect(2, -6, 3, 3);
                c.fillRect(-2, 1, 3, 3);
                c.fillRect(5, 3, 3, 3);
                break;
            case 'shake':
                c.beginPath();
                c.moveTo(-7, -2); c.lineTo(-4, 2); c.lineTo(-1, -3); c.lineTo(2, 3); c.lineTo(5, -2); c.lineTo(7, 1);
                c.stroke();
                break;
            case 'salvo':
                c.beginPath(); c.arc(0, 0, 2, 0, Math.PI * 2); c.stroke();
                c.beginPath(); c.arc(0, 0, 5, 0, Math.PI * 2); c.stroke();
                for (let i = 0; i < 4; i++) {
                    const a = i * Math.PI / 2;
                    c.beginPath();
                    c.moveTo(Math.cos(a) * 6, Math.sin(a) * 6);
                    c.lineTo(Math.cos(a) * 8, Math.sin(a) * 8);
                    c.stroke();
                }
                break;
        }
        c.restore();
    }

    // ===== Рисование =====

    function draw() {
        E = ed.E;
        if (!W || !E) return;
        const now = performance.now();
        const dt = Math.min(50, now - lastFrame);
        lastFrame = now;
        if (E.playing && now - userPanAt > 800) targetViewT = E.t;
        viewT += (targetViewT - viewT) * (1 - Math.exp(-dt / 100));
        if (Math.abs(targetViewT - viewT) < 0.001) viewT = targetViewT;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, W, H);
        const t0 = T(0), t1 = T(W);
        const y = laneY();

        // дропы
        for (const [a, b] of E.drops) {
            if (b < t0 || a > t1) continue;
            c.fillStyle = 'rgba(255,255,255,0.08)';
            c.fillRect(X(a), RULER, X(b) - X(a), H - RULER);
            c.fillStyle = 'rgba(255,255,255,0.7)';
            c.fillRect(X(a), RULER, X(b) - X(a), 3);
        }

        // «удары» песни — бледные столбики
        const { onset, fps } = E.song;
        if (onset) {
            c.fillStyle = 'rgba(255,255,255,0.16)';
            const half = (H - RULER) * 0.36;
            for (let x = 0; x < W; x += 2) {
                const fa = Math.floor(T(x) * fps), fb = Math.max(fa + 1, Math.floor(T(x + 2) * fps));
                let v = 0;
                for (let f = Math.max(0, fa); f < fb && f < onset.length; f++) v = Math.max(v, onset[f]);
                if (v <= 0.02) continue;
                const h = Math.min(1.4, v) / 1.4 * half;
                c.fillRect(x, y - h, 1.5, h * 2);
            }
        }

        // сетка: такты, биты и деления по выбранной привязке
        const b = E.beats;
        let i = Math.max(0, lowerBound(b, t0) - 1);
        for (; i < b.length && b[i] <= t1; i++) {
            const x = X(b[i]);
            const bar = ed.isBar(i);
            c.fillStyle = bar ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.28)';
            c.fillRect(x - (bar ? 1 : 0.5), RULER, bar ? 2 : 1, H - RULER);
            const len = (i + 1 < b.length ? b[i + 1] : b[i] + (b[i] - (b[i - 1] ?? b[i] - 0.5))) - b[i];
            if (E.snap > 1 && len / E.snap * E.zoom > 6) {
                c.fillStyle = 'rgba(255,255,255,0.12)';
                for (let j = 1; j < E.snap; j++) c.fillRect(X(b[i] + len * j / E.snap) - 0.5, y - 26, 1, 52);
            }
        }

        // ноты: сначала длинные, поверх — обычные
        const notes = ed.notes();
        for (const n of notes) {
            if (n.type !== 'hold' || n.end < t0 || n.t > t1) continue;
            drawHold(n, y, E.sel.has(n));
        }
        for (const n of notes) {
            if (n.t < t0 - 0.2 || n.t > t1 + 0.2) continue;
            drawHead(c, n, X(n.t), y, E.sel.has(n), hover === n);
        }

        // Эффекты — отдельные маркеры внизу ленты; их можно выбрать и перетаскивать
        if (E.effects.length) {
            const baseY = H - 8;
            c.strokeStyle = 'rgba(255,255,255,0.22)';
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(0, baseY);
            c.lineTo(W, baseY);
            c.stroke();
            c.font = '700 9px Rubik, sans-serif';
            c.textBaseline = 'middle';
            c.fillStyle = 'rgba(255,255,255,0.5)';
            c.fillText('FX', 6, baseY - 9);
            for (const mark of effectMarks()) {
                const { fx, x, y: my } = mark;
                if (x < -12 || x > W + 12) continue;
                const active = fx.id === E.activeFxId;
                c.strokeStyle = active || fx === hoverFx ? '#fff' : 'rgba(255,255,255,0.55)';
                c.lineWidth = active ? 2 : 1;
                c.beginPath();
                c.moveTo(x, my + 6);
                c.lineTo(x, baseY);
                c.stroke();
                drawEffectIcon(fx, x, my, active, fx === hoverFx);
            }
        }

        // рамка выбора
        if (drag && drag.mode === 'box' && drag.moved) {
            c.strokeStyle = '#fff';
            c.lineWidth = 1.5;
            c.setLineDash([5, 4]);
            c.strokeRect(Math.min(drag.x0, drag.x), Math.min(drag.y0, drag.y), Math.abs(drag.x - drag.x0), Math.abs(drag.y - drag.y0));
            c.setLineDash([]);
            c.fillStyle = 'rgba(255,255,255,0.06)';
            c.fillRect(Math.min(drag.x0, drag.x), Math.min(drag.y0, drag.y), Math.abs(drag.x - drag.x0), Math.abs(drag.y - drag.y0));
        }

        // полоса с секундами
        c.fillStyle = '#111';
        c.fillRect(0, 0, W, RULER);
        const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
        const st = steps.find(s => s * E.zoom >= 64) || 60;
        c.font = '500 11px Rubik, sans-serif';
        c.textBaseline = 'middle';
        for (let s = Math.ceil(Math.max(0, t0) / st) * st; s <= t1; s += st) {
            const x = X(s);
            c.fillStyle = 'rgba(255,255,255,0.4)';
            c.fillRect(x, RULER - 6, 1, 6);
            c.fillStyle = 'rgba(255,255,255,0.65)';
            c.fillText(label(s, st), x + 4, RULER / 2);
        }
        // за концом песни — темно
        const xe = X(E.song.duration);
        if (xe < W) {
            c.fillStyle = 'rgba(0,0,0,0.6)';
            c.fillRect(xe, RULER, W - xe, H - RULER);
        }
        const xs = X(0);
        if (xs > 0) {
            c.fillStyle = 'rgba(0,0,0,0.6)';
            c.fillRect(0, RULER, xs, H - RULER);
        }

        // Текущее время песни, включая прокрутку ленты в сторону
        const nowX = X(E.t);
        c.fillStyle = '#fff';
        c.fillRect(nowX - 1, 0, 2, H);
        c.beginPath();
        c.moveTo(nowX - 7, 0);
        c.lineTo(nowX + 7, 0);
        c.lineTo(nowX, 9);
        c.closePath();
        c.fill();

        drawOverview();
    }

    function drawHold(n, y, sel) {
        const xa = X(n.t), xb = X(n.end);
        c.globalAlpha = sel ? 1 : 0.75;
        c.fillStyle = '#fff';
        roundRect(c, xa, y - 6, Math.max(12, xb - xa), 12, 6);
        c.fill();
        // по полоске видно форму: волна — синусоида, спираль — косые чёрточки
        c.strokeStyle = '#000';
        c.lineWidth = 1.6;
        c.beginPath();
        if (n.wiggle) {
            const waves = n.waves || 1;
            for (let x = xa + 6; x <= xb - 2; x += 2) {
                const yy = y + Math.sin((x - xa) / Math.max(1, xb - xa) * Math.PI * 2 * waves) * 3.5;
                if (x === xa + 6) c.moveTo(x, yy);
                else c.lineTo(x, yy);
            }
        } else if (n.twist) {
            const gap = 9;
            for (let x = xa + 10; x < xb - 4; x += gap) {
                c.moveTo(x - 3 * Math.sign(n.twist), y + 4);
                c.lineTo(x + 3 * Math.sign(n.twist), y - 4);
            }
        }
        c.stroke();
        // конец — за него можно тянуть
        c.fillStyle = '#000';
        c.fillRect(xb - 5, y - 3, 2, 6);
        if (sel) {
            c.strokeStyle = '#fff';
            c.lineWidth = 2;
            roundRect(c, xa - 3, y - 9, Math.max(12, xb - xa) + 6, 18, 9);
            c.stroke();
        }
        c.globalAlpha = 1;
    }

    // ===== Полоска всей песни =====

    function drawOverview() {
        o.setTransform(dpr, 0, 0, dpr, 0, 0);
        o.clearRect(0, 0, OW, OH);
        const d = E.song.duration || 1;
        const OX = t => t / d * OW;
        for (const [a, b] of E.drops) {
            o.fillStyle = 'rgba(255,255,255,0.18)';
            o.fillRect(OX(a), 0, OX(b) - OX(a), OH);
        }
        const wave = E.song.wave;
        if (wave) {
            o.fillStyle = 'rgba(255,255,255,0.3)';
            const bw = OW / wave.length;
            wave.forEach((v, i) => {
                const h = Math.max(2, v * OH * 0.8);
                o.fillRect(i * bw + bw * 0.2, (OH - h) / 2, bw * 0.6, h);
            });
        }
        o.fillStyle = '#fff';
        for (const n of ed.notes()) o.fillRect(OX(n.t), 0, 1, 5);
        o.fillStyle = 'rgba(255,255,255,0.9)';
        for (const fx of E.effects) o.fillRect(OX(fx.t) - 1, OH - 7, 2, 6);
        o.strokeStyle = 'rgba(255,255,255,0.8)';
        o.lineWidth = 1.5;
        const va = OX(T(0)), vb = OX(T(W));
        o.strokeRect(Math.max(0.75, va), 0.75, Math.min(OW - 1.5, vb) - Math.max(0.75, va), OH - 1.5);
        o.fillRect(OX(E.t) - 1, 0, 2, OH);
    }

    // ===== Мышь и пальцы =====

    // Нота под точкой: { n, part: 'head' | 'tail' }
    function noteAt(x, y) {
        if (Math.abs(y - laneY()) > 16) return null;
        let best = null, bestD = 13;
        for (const n of ed.notes()) {
            if (n.type === 'hold') {
                const xb = X(n.end);
                if (Math.abs(x - xb) < 8 && Math.abs(x - xb) < bestD) {
                    best = { n, part: 'tail' };
                    bestD = Math.abs(x - xb);
                    continue;
                }
                if (x > X(n.t) && x < xb - 8 && !best) best = { n, part: 'head' };
            }
            const d = Math.abs(x - X(n.t));
            if (d < bestD) {
                best = { n, part: 'head' };
                bestD = d;
            }
        }
        return best;
    }

    const pos = e => {
        const r = canvas.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
    };

    canvas.addEventListener('pointerdown', e => {
        E = ed.E;
        if (!E || E.recording) return;
        const [x, y] = pos(e);
        capture(canvas, e);
        e.preventDefault();
        if (y < RULER) {
            drag = { mode: 'scrub' };
            ed.seek(T(x), false);
            return;
        }
        const fx = effectAt(x, y);
        if (fx) {
            ed.openEffect(fx, false);
            drag = { mode: 'effect', fx, x0: x, moved: false, committed: false };
            return;
        }
        const hit = noteAt(x, y);
        if (e.button === 2) {
            if (hit) {
                ed.commit();
                ed.remove(E.sel.has(hit.n) ? [...E.sel] : [hit.n]);
            }
            return;
        }
        if (hit) {
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                if (E.sel.has(hit.n)) E.sel.delete(hit.n);
                else E.sel.add(hit.n);
            } else if (!E.sel.has(hit.n)) {
                E.sel.clear();
                E.sel.add(hit.n);
            }
            ed.select();
            if (!E.sel.has(hit.n)) return;
            startMove(hit.n, hit.part, x);
            return;
        }
        const t = ed.snapT(T(x));
        if (E.tool === 'tap' || E.tool === 'hold') {
            if (t < 0 || t > E.song.duration) return;
            ed.commit();
            const n = ed.addNote(t, E.tool);
            E.sel.clear();
            E.sel.add(n);
            ed.changed();
            ed.select();
            drag = E.tool === 'hold'
                ? { mode: 'tail', n, x0: x, moved: true, committed: true }
                : { mode: 'move', anchor: n, base: n.t, x0: x, orig: [[n, n.t, n.end]], moved: false, committed: true };
            return;
        }
        if (!e.shiftKey) {
            E.sel.clear();
            ed.select();
        }
        drag = { mode: 'box', x0: x, y0: y, x, y, moved: false, keep: new Set(E.sel) };
    });

    function startMove(n, part, x) {
        if (part === 'tail') {
            drag = { mode: 'tail', n, x0: x, moved: false, committed: false };
            return;
        }
        drag = { mode: 'move', anchor: n, base: n.t, x0: x, orig: [...E.sel].map(m => [m, m.t, m.end]), moved: false, committed: false };
    }

    canvas.addEventListener('pointermove', e => {
        E = ed.E;
        if (!E) return;
        const [x, y] = pos(e);
        if (!drag) {
            const fh = effectAt(x, y);
            const h = noteAt(x, y);
            const nh = h ? h.n : null;
            canvas.style.cursor = fh || h ? 'grab' : y < RULER ? 'ew-resize' : E.tool === 'select' ? 'default' : 'copy';
            if (nh !== hover || fh !== hoverFx) {
                hover = nh;
                hoverFx = fh;
                if (!E.playing) draw();
            }
            return;
        }
        if (drag.mode === 'scrub') {
            ed.seek(T(x), false);
            return;
        }
        if (drag.mode === 'effect') {
            if (Math.abs(x - drag.x0) < 3 && !drag.moved) return;
            if (!drag.committed) {
                ed.commit();
                drag.committed = true;
            }
            drag.moved = true;
            drag.fx.t = clamp(ed.snapT(T(x)), 0, E.song.duration);
            return;
        }
        if (drag.mode === 'box') {
            drag.x = x;
            drag.y = y;
            if (Math.abs(x - drag.x0) > 4) drag.moved = true;
            if (!drag.moved) return;
            const ta = T(Math.min(x, drag.x0)), tb = T(Math.max(x, drag.x0));
            E.sel = new Set(drag.keep);
            for (const n of ed.notes()) {
                if ((n.end || n.t) >= ta && n.t <= tb) E.sel.add(n);
            }
            ed.select(true);
            draw();
            return;
        }
        if (Math.abs(x - drag.x0) < 3 && !drag.moved) return;
        if (!drag.committed) {
            ed.commit();
            drag.committed = true;
        }
        drag.moved = true;
        if (drag.mode === 'tail') {
            const n = drag.n;
            n.end = Math.max(n.t + ed.step(n.t), ed.snapT(T(x)));
            n.end = Math.min(n.end, E.song.duration);
        } else {
            // всё выбранное сдвигается вместе; к сетке привязывается та нота, за которую тянут
            const nt = ed.snapT(drag.base + (x - drag.x0) / E.zoom);
            let delta = nt - drag.base;
            const minT = Math.min(...drag.orig.map(o => o[1]));
            const maxT = Math.max(...drag.orig.map(o => o[2] ?? o[1]));
            delta = clamp(delta, -minT, E.song.duration - maxT);
            for (const [m, t, end] of drag.orig) {
                m.t = t + delta;
                if (end != null) m.end = end + delta;
            }
        }
        ed.changed(true);
    });

    const end = () => {
        if (!drag) return;
        const d = drag;
        drag = null;
        if (d.mode === 'effect') {
            if (d.moved) {
                E.effects.sort((a, b) => a.t - b.t);
                ed.changed();
            } else {
                ed.seek(d.fx.t);
            }
            draw();
            return;
        }
        if (d.mode === 'box') ed.select();
        if ((d.mode === 'move' || d.mode === 'tail') && d.moved) ed.changed();
        draw();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerleave', () => {
        if (hover || hoverFx) {
            hover = null;
            hoverFx = null;
            draw();
        }
    });

    // Колесо плавно двигает видимую часть песни; Ctrl — масштаб
    canvas.addEventListener('wheel', e => {
        E = ed.E;
        if (!E) return;
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
            ed.zoom(E.zoom * Math.exp(-e.deltaY * 0.0015));
            return;
        }
        const unit = e.deltaMode === 1 ? 30 : e.deltaMode === 2 ? H : 1;
        const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * unit;
        targetViewT = clamp(targetViewT + d / E.zoom * 0.8, 0, E.song.duration);
        userPanAt = performance.now();
    }, { passive: false });

    // Полоска всей песни: нажал или ведёшь — перемотка
    let overDrag = false;
    const overSeek = e => {
        E = ed.E;
        if (!E) return;
        const r = over.getBoundingClientRect();
        ed.seek((e.clientX - r.left) / r.width * E.song.duration);
    };
    over.addEventListener('pointerdown', e => {
        capture(over, e);
        overDrag = true;
        overSeek(e);
    });
    over.addEventListener('pointermove', e => {
        if (overDrag) overSeek(e);
    });
    over.addEventListener('pointerup', () => {
        overDrag = false;
    });

    return {
        draw, resize,
        center: t => {
            E = ed.E;
            viewT = targetViewT = clamp(t, 0, E.song.duration);
        },
        pauseFollow: () => {
            userPanAt = performance.now();
        }
    };
}

// Нота на ленте: фигура и «стрелка» — откуда она прилетит (как стрелка часов)
export function drawHead(c, n, x, y, sel, hot) {
    const a = n.angle * DEG;
    c.strokeStyle = '#fff';
    c.lineWidth = 2;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * (R + 8), y + Math.sin(a) * (R + 8));
    if (n.twin) {
        c.moveTo(x, y);
        c.lineTo(x - Math.cos(a) * (R + 8), y - Math.sin(a) * (R + 8));
    }
    c.stroke();
    c.save();
    c.translate(x, y);
    shapePath(c, n.shape, R * 0.8 * (0.7 + 0.3 * (n.size || 1)));
    c.lineJoin = 'round';
    if (n.hollow) {
        c.fillStyle = '#000';
        c.fill();
        c.lineWidth = 3;
        c.strokeStyle = '#fff';
        c.stroke();
    } else {
        c.fillStyle = '#fff';
        c.fill();
        c.lineWidth = 2;
        c.strokeStyle = '#000';
        c.stroke();
    }
    c.restore();
    if (sel || hot) {
        c.strokeStyle = '#fff';
        c.lineWidth = sel ? 2.5 : 1.5;
        c.setLineDash(sel ? [] : [3, 3]);
        c.beginPath();
        c.arc(x, y, R + 5, 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([]);
    }
}

// Мышь или палец «прилипают» к элементу, пока не отпустят (даже если увести за его край)
export function capture(el, e) {
    try {
        el.setPointerCapture(e.pointerId);
    } catch (err) { /* уже отпустили */ }
}

// Первая позиция в отсортированном массиве, где значение ≥ v
export function lowerBound(arr, v) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] < v) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

// Подпись секунд на ленте: 1:05 или 1:05.5
function label(s, step) {
    const m = Math.floor(s / 60);
    const sec = s - m * 60;
    const whole = step >= 1 || Math.abs(sec - Math.round(sec)) < 1e-6;
    const ss = whole ? String(Math.round(sec)).padStart(2, '0') : sec.toFixed(2).padStart(5, '0');
    return `${m}:${ss}`;
}
