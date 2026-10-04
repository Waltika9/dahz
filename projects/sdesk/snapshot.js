/* Short Desk — картинка доски (PNG): экспорт и миниатюра preview.png в архиве.

   Плитки — это DOM со стеклом, браузер не умеет «сфотографировать» его сам.
   Поэтому доска заново рисуется на canvas: положения строк, полей, контактов,
   журнала и медиа берутся из настоящих элементов плиток, а линии — из тех же
   SVG-путей. Так картинка совпадает с тем, что на экране. */
const Snapshot = (() => {
    const MAX_SIDE = 8192;          // ограничение размера canvas в браузерах
    const MAX_AREA = 40e6;
    const PAD = 48;
    const FONT = '"Inter", -apple-system, "Segoe UI", Roboto, sans-serif';
    const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    const icons = new Map();        // готовые картинки SVG-значков

    async function render({ area = 'all', ids = null, maxSide = MAX_SIDE, scale = 2 } = {}) {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        let list = [...Board.tiles.values()];
        if (ids) list = list.filter(t => ids.includes(t.id));

        let rect;
        if (area === 'view') {
            rect = Board.visibleRect();
            list = list.filter(t => t.x < rect.x + rect.w && t.x + t.w > rect.x && t.y < rect.y + rect.h && t.y + t.h > rect.y);
            scale = Board.view.k * (window.devicePixelRatio || 1);
        } else {
            const b = ids ? bounds(list) : Board.contentBounds();
            if (!b) throw new Error('нечего рисовать');
            rect = { x: b.x - PAD, y: b.y - PAD, w: b.w + PAD * 2, h: b.h + PAD * 2 };
        }
        const s = Math.min(scale, maxSide / rect.w, maxSide / rect.h, Math.sqrt(MAX_AREA / (rect.w * rect.h)));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(rect.w * s));
        canvas.height = Math.max(1, Math.round(rect.h * s));
        const ctx = canvas.getContext('2d');
        ctx.scale(s, s);
        ctx.translate(-rect.x, -rect.y);

        background(ctx, rect, s);
        await loadIcons(list);
        const inside = new Set([...list.map(t => t.id), ...(ids ? [] : Board.magnets.keys())]);
        for (const l of Board.links.values()) {
            if (area === 'view' ? inside.has(l.from.tile) || inside.has(l.to.tile) : inside.has(l.from.tile) && inside.has(l.to.tile)) link(ctx, l);
        }
        list.sort((a, b) => (Number(a.el.style.zIndex) || 0) - (Number(b.el.style.zIndex) || 0));
        for (const t of list) tile(ctx, t);
        if (!ids) items(ctx);
        return canvas;
    }

    // Таргеты (прицел) и магниты (круг с подписью) — поверх плиток, как на экране
    function items(ctx) {
        const label = (it, dy) => {
            ctx.font = `600 11.5px ${FONT}`;
            const w = ctx.measureText(it.name).width + 16;
            rr(ctx, it.x - w / 2, it.y + dy, w, 18, 8);
            ctx.fillStyle = 'rgba(28,28,32,0.85)';
            ctx.fill();
            text(ctx, it.name, { x: it.x - w / 2, y: it.y + dy, w, h: 18 }, `600 11.5px ${FONT}`, '#F5F5F7', 'center');
        };
        for (const m of Board.magnets.values()) {
            const c = m.color || '#FF453A';
            circle(ctx, m.x, m.y, 24);
            ctx.fillStyle = c;
            ctx.fill();
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 2.6;
            ctx.beginPath();
            ctx.moveTo(m.x - 8, m.y - 9);
            ctx.lineTo(m.x - 8, m.y + 1);
            ctx.arc(m.x, m.y + 1, 8, Math.PI, 0, true);
            ctx.lineTo(m.x + 8, m.y - 9);
            ctx.stroke();
            for (const dx of [-30, 30]) {
                circle(ctx, m.x + dx, m.y, 5);
                ctx.fillStyle = '#1C1C1F';
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = 'rgba(235,235,245,0.45)';
                ctx.stroke();
            }
            label(m, 31);
        }
        for (const g of Board.targets.values()) {
            const c = g.color || '#F5F5F7';
            circle(ctx, g.x, g.y, 22);
            ctx.fillStyle = 'rgba(28,28,32,0.8)';
            ctx.fill();
            ctx.strokeStyle = c;
            ctx.lineWidth = 1.8;
            circle(ctx, g.x, g.y, 11);
            ctx.stroke();
            ctx.beginPath();
            for (const [x1, y1, x2, y2] of [[0, -17, 0, -9], [0, 9, 0, 17], [-17, 0, -9, 0], [9, 0, 17, 0]]) {
                ctx.moveTo(g.x + x1, g.y + y1);
                ctx.lineTo(g.x + x2, g.y + y2);
            }
            ctx.stroke();
            circle(ctx, g.x, g.y, 2.2);
            ctx.fillStyle = c;
            ctx.fill();
            label(g, 28);
        }
    }

    // Маленькая картинка доски для preview.png
    async function preview(ids) {
        const canvas = await render({ ids, maxSide: 480, scale: 1 });
        return new Promise(ok => canvas.toBlob(ok, 'image/png'));
    }

    function bounds(list) {
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        const ids = new Set(list.map(t => t.id));
        for (const t of list) {
            x1 = Math.min(x1, t.x); y1 = Math.min(y1, t.y);
            x2 = Math.max(x2, t.x + t.w); y2 = Math.max(y2, t.y + t.h);
        }
        for (const l of Board.links.values()) {
            if (!ids.has(l.from.tile) || !ids.has(l.to.tile)) continue;
            for (const p of l.points) {
                x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y);
                x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y);
            }
        }
        return x1 === Infinity ? null : { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }

    /* ---------- Простые фигуры ---------- */
    function rr(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
    }

    function circle(ctx, x, y, r) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
    }

    function fit(ctx, text, w) {
        // небольшой запас: шрифт на холсте бывает на пару пикселей шире, чем на странице
        if (ctx.measureText(text).width <= w + 4) return text;
        let lo = 0, hi = text.length;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (ctx.measureText(text.slice(0, mid) + '…').width <= w) lo = mid; else hi = mid - 1;
        }
        return text.slice(0, lo) + '…';
    }

    // Текст по середине прямоугольника b
    function text(ctx, str, b, font, color, align = 'left', pad = 0) {
        ctx.font = font;
        ctx.fillStyle = color;
        ctx.textBaseline = 'middle';
        ctx.textAlign = align;
        const x = align === 'right' ? b.x + b.w - pad : align === 'center' ? b.x + b.w / 2 : b.x + pad;
        ctx.fillText(fit(ctx, String(str), Math.max(0, b.w - pad * 2)), x, b.y + b.h / 2);
    }

    // Положение элемента плитки в координатах доски
    function box(t, el) {
        let x = 0, y = 0;
        for (let n = el; n && n !== t.el; n = n.offsetParent) {
            x += n.offsetLeft;
            y += n.offsetTop;
        }
        return { x: t.x + x, y: t.y + y, w: el.offsetWidth, h: el.offsetHeight };
    }

    /* ---------- Фон и линии ---------- */
    function background(ctx, r, s) {
        ctx.fillStyle = '#0D0D0E';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        if (!Board.settings.grid) return;
        let g = 24;
        while ((r.w / g) * (r.h / g) > 120000) g *= 4;
        const d = Math.max(1.2 / s, 0.8);
        ctx.fillStyle = 'rgba(255,255,255,0.085)';
        for (let x = Math.floor(r.x / g) * g; x < r.x + r.w; x += g) {
            for (let y = Math.floor(r.y / g) * g; y < r.y + r.h; y += g) ctx.fillRect(x, y, d, d);
        }
    }

    function link(ctx, l) {
        const d = l.line.getAttribute('d');
        if (!d) return;
        const color = l.color || 'rgba(235,235,245,0.5)';
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke(new Path2D(d));
        const m = /translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\)/.exec(l.arrow.getAttribute('transform') || '');
        if (m && l.arrow.style.display !== 'none') {
            ctx.translate(Number(m[1]), Number(m[2]));
            ctx.rotate(Number(m[3]) * Math.PI / 180);
            ctx.beginPath();
            ctx.moveTo(-3.5, -4.5);
            ctx.lineTo(2, 0);
            ctx.lineTo(-3.5, 4.5);
            ctx.stroke();
        }
        ctx.restore();
        for (const p of l.points) {
            circle(ctx, p.x, p.y, 4);
            ctx.fillStyle = '#121214';
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    /* ---------- Значки ---------- */
    function iconKey(name, color) { return name + color; }

    async function loadIcons(list) {
        const need = new Set();
        for (const t of list) {
            const cat = Nodes.CAT[t.def.cat];
            if (t.def.icon) need.add(iconKey(t.def.icon, cat.dark ? '#1C1C1E' : '#FFFFFF'));
            if (t.def.runButton) need.add(iconKey('play', '#000000'));
            if (t.mediaEl) need.add(iconKey('upload', '#FFFFFF')).add(iconKey('file', '#FFFFFF'));
            if (t.web) need.add(iconKey('globe', '#FFFFFF'));
        }
        await Promise.all([...need].filter(k => !icons.has(k)).map(k => {
            const color = k.slice(-7), name = k.slice(0, -7);
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="${color}" ` +
                `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${(UI.ICONS[name] || '').replace(/currentColor/g, color)}</svg>`;
            const img = new Image();
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
            icons.set(k, img);
            return img.decode().catch(() => null);
        }));
    }

    function drawIcon(ctx, name, color, x, y, size) {
        const img = icons.get(iconKey(name, color));
        if (img && img.complete && img.naturalWidth) ctx.drawImage(img, x, y, size, size);
    }

    /* ---------- Плитка ---------- */
    function tile(ctx, t) {
        const cat = Nodes.CAT[t.def.cat];
        const c = box(t, t.card);

        rr(ctx, c.x, c.y, c.w, c.h, 18);
        if (t.def.block) {
            // «Блок»: лёгкая заливка, сплошная граница и полоса заголовка
            const col = t.color || cat.color;
            ctx.globalAlpha = 0.07;
            ctx.fillStyle = col;
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.lineWidth = 2;
            ctx.strokeStyle = col + '99';
            ctx.stroke();
            const head = box(t, t.card.querySelector('.tile-head'));
            ctx.save();
            rr(ctx, c.x, c.y, c.w, c.h, 18);
            ctx.clip();
            ctx.globalAlpha = 0.22;
            ctx.fillStyle = col;
            ctx.fillRect(c.x, c.y, c.w, head.y + head.h - c.y);
            ctx.restore();
        } else if (t.def.body === 'group') {
            // рамка-группа: полупрозрачная заливка и пунктир
            ctx.globalAlpha = 0.09;
            ctx.fillStyle = t.color || '#8E8E93';
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.setLineDash([6, 5]);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = (t.color || '#8E8E93') + '8C';
            ctx.stroke();
            ctx.setLineDash([]);
        } else {
            // стеклянная карточка
            const g = ctx.createLinearGradient(0, c.y, 0, c.y + c.h);
            g.addColorStop(0, '#2E2E33');
            g.addColorStop(1, '#232327');
            ctx.fillStyle = g;
            ctx.fill();
            if (t.color) {
                ctx.globalAlpha = 0.24;
                ctx.fillStyle = t.color;
                ctx.fill();
                ctx.globalAlpha = 1;
            }
            ctx.lineWidth = 1;
            ctx.strokeStyle = t.color ? t.color + '8C' : 'rgba(255,255,255,0.1)';
            ctx.stroke();
        }

        // заголовок
        const ico = t.card.querySelector('.tile-head .ico');
        if (ico) {
            const b = box(t, ico);
            rr(ctx, b.x, b.y, b.w, b.h, 8);
            ctx.fillStyle = cat.color;
            ctx.fill();
            if (t.def.icon) drawIcon(ctx, t.def.icon, cat.dark ? '#1C1C1E' : '#FFFFFF', b.x + b.w * 0.2, b.y + b.h * 0.2, b.w * 0.6);
            else {
                const size = t.def.glyph.length > 2 ? 10 : t.def.glyph.length === 2 ? 12.5 : 15;
                text(ctx, t.def.glyph, b, `700 ${size}px ${FONT}`, cat.dark ? '#1C1C1E' : '#FFFFFF', 'center');
            }
        }
        text(ctx, Nodes.titleOf(t), box(t, t.titleEl), `600 14px ${FONT}`, '#F5F5F7');
        if (t.runBtn) {
            const b = box(t, t.runBtn);
            circle(ctx, b.x + b.w / 2, b.y + b.h / 2, b.w / 2);
            ctx.fillStyle = '#FFFFFF';
            ctx.fill();
            drawIcon(ctx, 'play', '#000000', b.x + b.w * 0.24 + 1, b.y + b.h * 0.24, b.w * 0.52);
        }

        // строки с подписями и полями
        for (const { el } of t.rowEls) {
            ctx.globalAlpha = el.classList.contains('muted') ? 0.35 : 1;
            const lab = el.querySelector('.row-label');
            if (lab) text(ctx, lab.textContent, box(t, lab), `400 12.5px ${FONT}`, 'rgba(235,235,245,0.62)');
            if (el.classList.contains('linked')) {
                const chip = el.querySelector('.row-linked');
                const b = box(t, chip);
                rr(ctx, b.x, b.y, b.w, b.h, 8);
                ctx.fillStyle = 'rgba(255,255,255,0.06)';
                ctx.fill();
                text(ctx, chip.textContent, b, `400 11.5px ${FONT}`, 'rgba(235,235,245,0.32)', 'center');
            } else {
                for (const f of el.querySelectorAll('.fld, .fld-toggle')) field(ctx, t, f);
            }
            ctx.globalAlpha = 1;
        }

        if (t.logEl) log(ctx, t);
        if (t.mediaEl) media(ctx, t);
        if (t.web) web(ctx, t);

        // контакты
        for (const id in t.portEls) {
            const p = t.portPos[id];
            if (!p) continue;
            const on = t.portEls[id].classList.contains('connected');
            circle(ctx, t.x + p.x, t.y + p.y, 5);
            ctx.fillStyle = on ? cat.color : '#1C1C1F';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = on ? cat.color : 'rgba(235,235,245,0.45)';
            ctx.stroke();
        }
    }

    function field(ctx, t, f) {
        const b = box(t, f);
        if (f.classList.contains('fld-heading')) {
            // «Заголовок»: крупный текст и цветная черта под ним
            text(ctx, f.value, { ...b, h: b.h - 3 }, `700 26px ${FONT}`, '#F5F5F7', 'left', 4);
            ctx.fillStyle = t.color || Nodes.colorOf(t.def);
            ctx.fillRect(b.x, b.y + b.h - 3, b.w, 3);
            return;
        }
        if (f.classList.contains('fld-toggle')) {
            const on = f.classList.contains('on');
            rr(ctx, b.x, b.y, b.w, b.h, b.h / 2);
            ctx.fillStyle = on ? '#30D158' : 'rgba(120,120,128,0.36)';
            ctx.fill();
            circle(ctx, on ? b.x + b.w - b.h / 2 : b.x + b.h / 2, b.y + b.h / 2, b.h / 2 - 2);
            ctx.fillStyle = '#FFFFFF';
            ctx.fill();
            return;
        }
        rr(ctx, b.x, b.y, b.w, b.h, 9);
        ctx.fillStyle = f.classList.contains('fld-code') ? 'rgba(0,0,0,0.4)' : 'rgba(118,118,128,0.24)';
        ctx.fill();
        if (f.tagName === 'TEXTAREA') {
            // многострочное поле: видимые строки текста или кода
            const code = f.classList.contains('fld-code');
            const lh = code ? 18 : 17.5;
            ctx.save();
            ctx.clip();
            f.value.split('\n').forEach((line, i) => {
                const y = b.y + 7 + i * lh - f.scrollTop;
                if (y > b.y - lh && y < b.y + b.h) {
                    text(ctx, line, { x: b.x, y, w: b.w, h: lh }, code ? `12px ${MONO}` : `500 12.5px ${FONT}`, '#F5F5F7', 'left', 9);
                }
            });
            ctx.restore();
            return;
        }
        if (f.tagName === 'SELECT') {
            const opt = f.options[f.selectedIndex];
            text(ctx, opt ? opt.text : '', { ...b, w: b.w - 18 }, `500 12.5px ${FONT}`, '#F5F5F7', 'left', 9);
            ctx.strokeStyle = '#AAAAAA';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(b.x + b.w - 16, b.y + b.h / 2 - 2);
            ctx.lineTo(b.x + b.w - 12.5, b.y + b.h / 2 + 1.5);
            ctx.lineTo(b.x + b.w - 9, b.y + b.h / 2 - 2);
            ctx.stroke();
        } else {
            text(ctx, f.value, b, `500 12.5px ${FONT}`, '#F5F5F7', f.classList.contains('fld-num') ? 'right' : 'left', 9);
        }
    }

    // Журнал «Вывода»: видимые строки с учётом прокрутки
    function log(ctx, t) {
        const lb = box(t, t.logEl);
        rr(ctx, lb.x, lb.y, lb.w, lb.h, 12);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fill();
        ctx.save();
        ctx.clip();
        const top = t.logEl.scrollTop;
        for (const line of t.logEl.children) {
            const b = { x: lb.x + line.offsetLeft, y: lb.y + line.offsetTop - top, w: line.offsetWidth, h: Math.min(line.offsetHeight, 22) };
            if (b.y + b.h < lb.y || b.y > lb.y + lb.h) continue;
            if (line.classList.contains('log-empty') || line.classList.contains('log-sys')) {
                const color = line.classList.contains('error') ? '#FF8A80' : 'rgba(235,235,245,0.32)';
                text(ctx, line.textContent, b, `500 12px ${FONT}`, color);
                continue;
            }
            const val = line.querySelector('.log-val'), src = line.querySelector('.log-src');
            const kind = (line.className.match(/v-(\w+)/) || [])[1];
            const color = kind === 'num' ? '#64D2FF' : kind === 'bool' ? '#DA8FFF' : kind === 'sig' || kind === 'none' ? 'rgba(235,235,245,0.62)' : '#F5F5F7';
            const img = val.querySelector('img');
            let vb = { ...b, w: val.offsetWidth };
            if (img && img.complete && img.naturalWidth) {
                const ib = { x: lb.x + img.offsetLeft, y: lb.y + img.offsetTop - top, w: img.offsetWidth, h: img.offsetHeight };
                ctx.drawImage(img, ib.x, ib.y, ib.w, ib.h);
                vb = { x: ib.x + ib.w + 6, y: b.y + line.offsetHeight - 20, w: val.offsetWidth - ib.w - 6, h: 18 };
            }
            text(ctx, val.textContent, vb, `12.5px ${MONO}`, color);
            if (src) text(ctx, src.textContent, { x: lb.x + src.offsetLeft, y: b.y, w: src.offsetWidth, h: b.h }, `10.5px ${FONT}`, 'rgba(235,235,245,0.32)', 'right');
        }
        ctx.restore();
    }

    // Картинка в прямоугольнике с сохранением пропорций
    function contain(ctx, src, sw, sh, b) {
        const k = Math.min(b.w / sw, b.h / sh);
        const w = sw * k, h = sh * k;
        ctx.drawImage(src, b.x + (b.w - w) / 2, b.y + (b.h - h) / 2, w, h);
    }

    function media(ctx, t) {
        const m = t.mediaEl;
        const empty = m.querySelector('.media-empty');
        if (empty) {
            const btn = empty.querySelector('.media-pick'), hint = empty.querySelector(':scope > span');
            const b = box(t, btn);
            rr(ctx, b.x, b.y, b.w, b.h, b.h / 2);
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.fill();
            text(ctx, btn.textContent, b, `600 13px ${FONT}`, '#F5F5F7', 'center');
            if (hint) text(ctx, hint.textContent, box(t, hint), `400 12px ${FONT}`, 'rgba(235,235,245,0.32)', 'center');
            return;
        }
        const frame = m.querySelector('.media-frame'), img = m.querySelector('.media-img');
        if (frame) {
            const b = box(t, frame);
            rr(ctx, b.x, b.y, b.w, b.h, 12);
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.fill();
            if (img && img.complete && img.naturalWidth) {
                ctx.save();
                ctx.clip();
                contain(ctx, img, img.naturalWidth, img.naturalHeight, b);
                ctx.restore();
            }
        }
        const vid = m.querySelector('video');
        if (vid) {
            const b = box(t, vid);
            rr(ctx, b.x, b.y, b.w, b.h, 12);
            ctx.fillStyle = '#000000';
            ctx.fill();
            if (vid.readyState >= 2 && vid.videoWidth) {
                ctx.save();
                ctx.clip();
                try { contain(ctx, vid, vid.videoWidth, vid.videoHeight, b); } catch { /* кадр недоступен */ }
                ctx.restore();
            }
            circle(ctx, b.x + b.w / 2, b.y + b.h / 2, 18);
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.fill();
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.moveTo(b.x + b.w / 2 - 5, b.y + b.h / 2 - 8);
            ctx.lineTo(b.x + b.w / 2 + 9, b.y + b.h / 2);
            ctx.lineTo(b.x + b.w / 2 - 5, b.y + b.h / 2 + 8);
            ctx.fill();
        }
        const aud = m.querySelector('audio');
        if (aud) {
            const b = box(t, aud);
            rr(ctx, b.x, b.y, b.w, b.h, b.h / 2);
            ctx.fillStyle = 'rgba(118,118,128,0.3)';
            ctx.fill();
            ctx.fillStyle = '#F5F5F7';
            ctx.beginPath();
            ctx.moveTo(b.x + 16, b.y + b.h / 2 - 7);
            ctx.lineTo(b.x + 28, b.y + b.h / 2);
            ctx.lineTo(b.x + 16, b.y + b.h / 2 + 7);
            ctx.fill();
            rr(ctx, b.x + 40, b.y + b.h / 2 - 2, b.w - 60, 4, 2);
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.fill();
        }
        const pre = m.querySelector('pre');
        if (pre) {
            const b = box(t, pre);
            rr(ctx, b.x, b.y, b.w, b.h, 12);
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.fill();
            ctx.save();
            ctx.clip();
            const lines = pre.textContent.split('\n');
            const first = Math.floor(pre.scrollTop / 17);
            for (let i = first; i < lines.length; i++) {
                const y = b.y + 9 + (i - first) * 17;
                if (y > b.y + b.h) break;
                text(ctx, lines[i], { x: b.x, y, w: b.w, h: 17 }, `12px ${MONO}`, '#F5F5F7', 'left', 10);
            }
            ctx.restore();
        }
        const card = m.querySelector('.file-card');
        if (card) {
            const ic = box(t, card.querySelector('.fc-icon'));
            const color = getComputedStyle(card.querySelector('.fc-icon')).getPropertyValue('--fc').trim() || '#8E8E93';
            rr(ctx, ic.x, ic.y, ic.w, ic.h, 10);
            ctx.fillStyle = color;
            ctx.fill();
            text(ctx, card.querySelector('.fc-icon span').textContent, { x: ic.x, y: ic.y + ic.h * 0.55, w: ic.w, h: ic.h * 0.35 }, `800 10px ${FONT}`, '#FFFFFF', 'center');
            drawIcon(ctx, 'file', '#FFFFFF', ic.x + ic.w * 0.28, ic.y + ic.h * 0.12, ic.w * 0.44);
            text(ctx, card.querySelector('.fc-name').textContent, box(t, card.querySelector('.fc-name')), `600 13px ${FONT}`, '#F5F5F7');
            text(ctx, card.querySelector('.fc-size').textContent, box(t, card.querySelector('.fc-size')), `400 11.5px ${FONT}`, 'rgba(235,235,245,0.62)');
        }
        const meta = m.querySelector('.media-meta');
        if (meta) text(ctx, meta.textContent, box(t, meta), `400 11.5px ${FONT}`, 'rgba(235,235,245,0.45)');
    }

    // Плитка «Ссылка»: чужой сайт в картинку попасть не может — рисуем окно со значком и адресом
    function web(ctx, t) {
        const w = t.web;
        const fav = box(t, w.fav), addr = box(t, w.addr);
        ctx.globalAlpha = 0.5;
        drawIcon(ctx, 'globe', '#FFFFFF', fav.x, fav.y, fav.w);
        ctx.globalAlpha = 1;
        text(ctx, w.addr.textContent, addr, `400 12px ${FONT}`, 'rgba(235,235,245,0.62)');
        const v = box(t, w.view);
        rr(ctx, v.x, v.y, v.w, v.h, 12);
        ctx.fillStyle = '#0B0B0D';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.stroke();
        const s = Math.min(44, v.h * 0.3);
        ctx.globalAlpha = 0.35;
        drawIcon(ctx, 'globe', '#FFFFFF', v.x + v.w / 2 - s / 2, v.y + v.h / 2 - s / 2 - 10, s);
        ctx.globalAlpha = 1;
        const host = t.fields.page ? (Web.frameOf(t.fields.page) || {}).host || '' : 'Страница не открыта';
        text(ctx, host, { x: v.x, y: v.y + v.h / 2 + s / 2 - 2, w: v.w, h: 20 }, `500 12.5px ${FONT}`, 'rgba(235,235,245,0.45)', 'center', 12);
    }

    return { render, preview };
})();
