// ===== 3D-КОЛОННЫ ДЛЯ СЛАЙДА «АРХИТЕКТУРА» =====
// Три ордера (дорический, ионический, коринфский) строятся прямо в коде на Three.js.
// При переключении старая колонна «стирается» сверху вниз, а новая «вырастает» снизу вверх,
// за срезом бежит золотое кольцо.
(function () {
    'use strict';
    if (typeof THREE === 'undefined') return;   // нет интернета — без 3D

    const S = 0.66;          // высота ступеней (стилобата)
    const TOP = 9.9;         // выше самой высокой колонны
    const OUT_TIME = 650;    // мс — исчезновение старой колонны
    const IN_TIME = 1300;    // мс — появление новой
    const OVERLAP = 250;

    const easeInOut = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const clamp01 = (t) => Math.min(1, Math.max(0, t));

    // ---------- детали колонн ----------

    function marble(plane) {
        return new THREE.MeshStandardMaterial({
            color: 0xe6dfd1,
            roughness: 0.55,
            metalness: 0,
            side: THREE.DoubleSide,
            clippingPlanes: [plane]
        });
    }

    function lathe(points, mat, segments = 72) {
        return new THREE.Mesh(
            new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments),
            mat
        );
    }

    function box(w, h, d, mat, y) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        m.position.y = y + h / 2;
        return m;
    }

    // Ствол колонны с желобками-каннелюрами и лёгким утолщением посередине (энтазис)
    function fluteShaft({ H, rb, rt, bulge, n, depth, fillet }, mat) {
        const g = new THREE.CylinderGeometry(1, 1, H, n * 8, 60, true);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
            const x = p.getX(i);
            const z = p.getZ(i);
            const y = p.getY(i) + H / 2;
            const t = y / H;
            const R = rb + (rt - rb) * t + bulge * Math.sin(Math.PI * t);
            const th = Math.atan2(z, x);
            let f = (th / (2 * Math.PI)) * n % 1;
            if (f < 0) f += 1;
            let k;
            if (fillet) {
                // у ионических и коринфских колонн между желобками есть плоская полоска
                const u = (f - fillet / 2) / (1 - fillet);
                k = u >= 0 && u <= 1 ? Math.sin(Math.PI * u) : 0;
            } else {
                // у дорических желобки сходятся острым ребром
                k = Math.sin(Math.PI * f);
            }
            const r = R * (1 - depth * k);
            p.setXYZ(i, r * Math.cos(th), y, r * Math.sin(th));
        }
        g.computeVertexNormals();
        return new THREE.Mesh(g, mat);
    }

    // Аттическая база: плита + два валика с желобком между ними
    function atticBase(mat, r) {
        const g = new THREE.Group();
        g.add(box(1.6, 0.16, 1.6, mat, S));
        const prof = lathe([
            [0, 0], [0.74, 0], [0.78, 0.05], [0.77, 0.11], [0.72, 0.15], [0.63, 0.16],
            [0.59, 0.2], [0.59, 0.24], [0.63, 0.27], [0.65, 0.3], [0.62, 0.34],
            [0.57, 0.36], [r + 0.03, 0.38], [r + 0.03, 0.42], [0, 0.42]
        ], mat);
        prof.position.y = S + 0.16;
        g.add(prof);
        return { group: g, height: 0.58 };
    }

    // Спираль для волют
    class Spiral extends THREE.Curve {
        constructor(cx, cy, z, r0, turns, dir) {
            super();
            this.cx = cx; this.cy = cy; this.z = z;
            this.r0 = r0; this.turns = turns; this.dir = dir;
        }
        getPoint(t, target = new THREE.Vector3()) {
            const a = Math.PI / 2 - this.dir * t * this.turns * Math.PI * 2;
            const r = this.r0 * (1 - 0.82 * t);
            return target.set(this.cx + r * Math.cos(a), this.cy + r * Math.sin(a), this.z);
        }
    }

    function spiralTube(cx, cy, z, r0, turns, dir, thick, mat) {
        return new THREE.Mesh(new THREE.TubeGeometry(new Spiral(cx, cy, z, r0, turns, dir), 160, thick, 8, false), mat);
    }

    // Лист аканта: изогнутая пластина, кончик загибается наружу
    function leafGeometry(w, h) {
        const g = new THREE.PlaneGeometry(w, h, 8, 14);
        g.translate(0, h / 2, 0);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
            const x0 = p.getX(i);
            let y = p.getY(i);
            const v = y / h;
            const xn = x0 / (w / 2);
            const x = x0 * (0.3 + 0.7 * Math.sin(Math.PI * Math.min(v * 0.95 + 0.05, 1)));
            let z = 0.05 * Math.sin(Math.PI * v) + 0.035 * (1 - Math.abs(xn));
            if (v > 0.62) {
                const c = (v - 0.62) / 0.38;
                z += 0.24 * h * c * c;
                y -= 0.14 * h * c * c;
            }
            z += 0.015 * Math.sin(xn * 6 + v * 22);   // волнистый край
            p.setXYZ(i, x, y, z);
        }
        g.computeVertexNormals();
        return g;
    }

    // ---------- три ордера ----------

    function doric(mat) {
        const g = new THREE.Group();
        const H = 6.4, rt = 0.5;
        const shaft = fluteShaft({ H, rb: 0.64, rt, bulge: 0.025, n: 20, depth: 0.07, fillet: 0 }, mat);
        shaft.position.y = S;
        g.add(shaft);
        const y0 = S + H;
        for (let i = 0; i < 3; i++) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(rt + 0.005, 0.018, 8, 64), mat);
            ring.rotation.x = Math.PI / 2;
            ring.position.y = y0 - 0.05 - i * 0.05;
            g.add(ring);
        }
        const echinus = lathe([
            [0, 0], [rt, 0], [rt + 0.04, 0.06], [rt + 0.14, 0.17], [rt + 0.24, 0.27],
            [rt + 0.28, 0.33], [rt + 0.28, 0.36], [0, 0.36]
        ], mat);
        echinus.position.y = y0;
        g.add(echinus);
        g.add(box(1.7, 0.3, 1.7, mat, y0 + 0.36));
        return g;
    }

    function ionic(mat) {
        const g = new THREE.Group();
        const rb = 0.54, rt = 0.46, H = 6.7;
        const base = atticBase(mat, rb);
        g.add(base.group);
        const shaft = fluteShaft({ H, rb, rt, bulge: 0.015, n: 24, depth: 0.075, fillet: 0.25 }, mat);
        shaft.position.y = S + base.height;
        g.add(shaft);

        const y0 = S + base.height + H;
        const echinus = lathe([[0, 0], [rt + 0.02, 0], [rt + 0.1, 0.08], [rt + 0.12, 0.14], [0, 0.14]], mat);
        echinus.position.y = y0;
        g.add(echinus);

        const cy = y0 + 0.08;     // центр волют
        const vr = 0.27;          // радиус волюты
        g.add(box(1.3, 0.16, 1.0, mat, cy + vr - 0.16));
        for (const sx of [-1, 1]) {
            const bolster = new THREE.Mesh(new THREE.CylinderGeometry(vr, vr, 1.0, 48), mat);
            bolster.rotation.x = Math.PI / 2;
            bolster.position.set(sx * 0.65, cy, 0);
            g.add(bolster);
            for (const sz of [-1, 1]) {
                g.add(spiralTube(sx * 0.65, cy, sz * 0.505, vr * 0.95, 2.6, sx, 0.03, mat));
                const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), mat);
                eye.position.set(sx * 0.65, cy, sz * 0.5);
                g.add(eye);
            }
        }
        g.add(box(1.25, 0.08, 1.05, mat, cy + vr));
        return g;
    }

    function corinthian(mat) {
        const g = new THREE.Group();
        const rb = 0.5, rt = 0.43, H = 6.5;
        const base = atticBase(mat, rb);
        g.add(base.group);
        const shaft = fluteShaft({ H, rb, rt, bulge: 0.012, n: 24, depth: 0.075, fillet: 0.25 }, mat);
        shaft.position.y = S + base.height;
        g.add(shaft);

        const y0 = S + base.height + H;
        const astragal = new THREE.Mesh(new THREE.TorusGeometry(rt + 0.02, 0.04, 10, 64), mat);
        astragal.rotation.x = Math.PI / 2;
        astragal.position.y = y0;
        g.add(astragal);

        // «корзина» капители
        const bell = lathe([
            [0, 0], [rt, 0], [rt + 0.01, 0.4], [rt + 0.06, 0.85],
            [rt + 0.14, 1.1], [rt + 0.2, 1.18], [0, 1.18]
        ], mat);
        bell.position.y = y0;
        g.add(bell);

        // два ряда листьев аканта
        const rows = [
            { count: 8, h: 0.55, w: 0.42, r: rt + 0.03, offset: 0, tilt: 0.12 },
            { count: 8, h: 0.85, w: 0.4,  r: rt + 0.0,  offset: Math.PI / 8, tilt: 0.16 }
        ];
        for (const row of rows) {
            const geo = leafGeometry(row.w, row.h);
            for (let i = 0; i < row.count; i++) {
                const a = row.offset + i * Math.PI * 2 / row.count;
                const leaf = new THREE.Mesh(geo, mat);
                leaf.rotation.order = 'YXZ';
                leaf.rotation.y = Math.PI / 2 - a;
                leaf.rotation.x = row.tilt;
                leaf.position.set(row.r * Math.cos(a), y0 + 0.02, row.r * Math.sin(a));
                g.add(leaf);
            }
        }

        // маленькие завитки по углам
        for (let i = 0; i < 4; i++) {
            const a = Math.PI / 4 + i * Math.PI / 2;
            const holder = new THREE.Group();
            holder.add(spiralTube(0, 0, 0, 0.13, 1.8, 1, 0.025, mat));
            holder.position.set(0.66 * Math.cos(a), y0 + 1.0, 0.66 * Math.sin(a));
            holder.rotation.y = Math.PI / 2 - a;
            g.add(holder);
        }

        g.add(box(1.5, 0.16, 1.5, mat, y0 + 1.18));
        return g;
    }

    // Мягкое золотое пятно света на «полу»
    function floorGlow() {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const ctx = c.getContext('2d');
        const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        grad.addColorStop(0, 'rgba(242, 201, 76, 0.35)');
        grad.addColorStop(1, 'rgba(242, 201, 76, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 256, 256);
        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(9, 9),
            new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.002;
        return mesh;
    }

    // ---------- сцена ----------

    window.createColumn3D = function (container, initialOrder) {
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0x000000, 0);
        renderer.outputEncoding = THREE.sRGBEncoding;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.85;
        renderer.localClippingEnabled = true;
        container.prepend(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);

        // свет сбоку — так лучше видны желобки на колонне
        scene.add(new THREE.AmbientLight(0xffffff, 0.08));
        scene.add(new THREE.HemisphereLight(0xfff4e0, 0x111111, 0.3));
        const key = new THREE.DirectionalLight(0xfff1d6, 1.7);
        key.position.set(8, 9, 3);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x8fb4ff, 0.8);
        rim.position.set(-8, 5, -6);
        scene.add(rim);
        const warm = new THREE.PointLight(0xf2c94c, 0.5, 20);
        warm.position.set(0, 1, 4);
        scene.add(warm);

        const pivot = new THREE.Group();
        scene.add(pivot);

        // ступени (стилобат) — не меняются при переключении
        const stepMat = new THREE.MeshStandardMaterial({ color: 0xd9d2c4, roughness: 0.7 });
        [[3.2, 0], [2.7, 0.22], [2.2, 0.44]].forEach(([w, y]) => pivot.add(box(w, 0.22, w, stepMat, y)));
        scene.add(floorGlow());

        // колонны: у каждой своя плоскость среза
        const builders = [doric, ionic, corinthian];
        const orders = builders.map((build) => {
            const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), S);
            const group = build(marble(plane));
            group.visible = false;
            pivot.add(group);
            return { group, plane };
        });

        // золотое кольцо, которое бежит по срезу
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.95, 0.014, 8, 96),
            new THREE.MeshBasicMaterial({ color: 0xf2c94c })
        );
        ring.rotation.x = Math.PI / 2;
        ring.visible = false;
        pivot.add(ring);

        let active = initialOrder || 0;
        let anim = null;
        let first = true;

        function setOrder(i) {
            if (anim ? anim.to === i : active === i) return;
            const from = anim ? anim.to : active;
            orders.forEach((o, j) => { if (j !== from && j !== i) o.group.visible = false; });
            anim = { from, fromH: orders[from].plane.constant, to: i, t0: performance.now() };
        }

        function updateAnim(now) {
            if (!anim) return;
            const t = now - anim.t0;
            const outDur = anim.from === null ? 0 : OUT_TIME;
            const inStart = anim.from === null ? 0 : OUT_TIME - OVERLAP;
            const outP = outDur ? clamp01(t / outDur) : 1;
            const inP = clamp01((t - inStart) / IN_TIME);

            if (anim.from !== null && anim.from !== anim.to) {
                const o = orders[anim.from];
                o.plane.constant = anim.fromH + (S - anim.fromH) * easeInOut(outP);
                o.group.visible = outP < 1;
            }
            const n = orders[anim.to];
            n.group.visible = true;
            n.plane.constant = S + (TOP - S) * easeInOut(inP);

            if (inP > 0 && inP < 1) {
                ring.visible = true;
                ring.position.y = n.plane.constant;
            } else if (outP < 1) {
                ring.visible = true;
                ring.position.y = orders[anim.from].plane.constant;
            } else {
                ring.visible = false;
            }

            if (inP >= 1) {
                active = anim.to;
                anim = null;
                ring.visible = false;
            }
        }

        // вращение мышью / пальцем с инерцией
        let dragging = false;
        let lastX = 0, lastY = 0;
        let velocity = 0;
        let tilt = 0;
        const AUTO = 0.0035;

        container.addEventListener('pointerdown', (e) => {
            dragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
            container.setPointerCapture(e.pointerId);
        });
        container.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const dx = e.clientX - lastX;
            const dy = e.clientY - lastY;
            lastX = e.clientX;
            lastY = e.clientY;
            velocity = dx * 0.008;
            pivot.rotation.y += velocity;
            tilt = Math.max(-0.25, Math.min(0.25, tilt + dy * 0.003));
        });
        const endDrag = () => { dragging = false; };
        container.addEventListener('pointerup', endDrag);
        container.addEventListener('pointercancel', endDrag);

        function resize() {
            const w = container.clientWidth;
            const h = container.clientHeight;
            if (!w || !h) return;
            renderer.setSize(w, h);
            camera.aspect = w / h;
            const dist = 21.5 * Math.max(1, 0.85 / camera.aspect);
            camera.position.set(0, 5.4, dist);
            camera.lookAt(0, 4.5, 0);
            camera.updateProjectionMatrix();
        }
        new ResizeObserver(resize).observe(container);
        resize();

        let running = false;
        let raf = 0;

        function loop(now) {
            if (!running) return;
            raf = requestAnimationFrame(loop);
            updateAnim(now);
            if (!dragging) {
                velocity *= 0.95;
                pivot.rotation.y += AUTO + velocity;
                tilt *= 0.96;
            }
            pivot.rotation.x = tilt;
            renderer.render(scene, camera);
        }

        return {
            start() {
                if (running) return;
                running = true;
                resize();
                if (first) {
                    // первое появление: колонна «вырастает» снизу вверх
                    first = false;
                    anim = { from: null, fromH: S, to: active, t0: performance.now() + 500 };
                }
                raf = requestAnimationFrame(loop);
            },
            stop() {
                running = false;
                cancelAnimationFrame(raf);
            },
            setOrder
        };
    };
})();
