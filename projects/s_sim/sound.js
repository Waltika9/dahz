/* ============================================================
   Space Simulator 🌏 — sound.js
   8-битные звуки, которые генерируются прямо в браузере
   (Web Audio API) — никаких аудиофайлов.
   ============================================================ */
'use strict';

const Sound = (() => {
    let ac = null;            // AudioContext
    let master = null;        // общая громкость
    let crushNoise = null;    // «хрустящий» шум как в старых приставках
    let whiteNoise = null;
    let muted = false;
    let volume = 0.55;
    const lastPlayed = {};
    let engineNode = null;

    // Браузер разрешает звук только после действия пользователя — включаем по первому клику
    function unlock() {
        if (!ac) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            ac = new AC();
            master = ac.createGain();
            master.gain.value = muted ? 0 : volume;
            master.connect(ac.destination);
            whiteNoise = makeNoise(1);
            crushNoise = makeNoise(18);
        }
        if (ac.state === 'suspended') ac.resume();
    }

    // Шум; hold > 1 — каждое значение повторяется несколько раз (звучит «по-пиксельному»)
    function makeNoise(hold) {
        const len = ac.sampleRate * 2;
        const b = ac.createBuffer(1, len, ac.sampleRate);
        const d = b.getChannelData(0);
        let v = 0;
        for (let i = 0; i < len; i++) {
            if (i % hold === 0) v = Math.random() * 2 - 1;
            d[i] = v;
        }
        return b;
    }

    const ready = () => ac && !muted && ac.state === 'running';

    // Частота меняется ступеньками — как у старых звуковых чипов
    function steppedSweep(param, f0, f1, t0, dur, steps = 14, exp = true) {
        for (let i = 0; i <= steps; i++) {
            const k = i / steps;
            const f = exp ? f0 * Math.pow(f1 / f0, k) : f0 + (f1 - f0) * k;
            param.setValueAtTime(Math.max(1, f), t0 + dur * k);
        }
    }

    function tone({ type = 'square', f0 = 440, f1 = null, dur = 0.1, vol = 0.15, delay = 0, steps = 12, attack = 0.004, exp = true, vibrato = 0 }) {
        const t = ac.currentTime + delay;
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = type;
        if (f1 && f1 !== f0) steppedSweep(osc.frequency, f0, f1, t, dur, steps, exp);
        else osc.frequency.setValueAtTime(f0, t);
        if (vibrato) {
            const lfo = ac.createOscillator();
            const lg = ac.createGain();
            lfo.frequency.value = vibrato;
            lg.gain.value = f0 * 0.04;
            lfo.connect(lg).connect(osc.frequency);
            lfo.start(t); lfo.stop(t + dur + 0.05);
        }
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(vol, t + attack);
        g.gain.setValueAtTime(vol, t + dur * 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g).connect(master);
        osc.start(t);
        osc.stop(t + dur + 0.02);
    }

    function noise({ dur = 0.3, vol = 0.2, f0 = 3000, f1 = 200, delay = 0, crunchy = true, q = 0.7, filter = 'lowpass' }) {
        const t = ac.currentTime + delay;
        const src = ac.createBufferSource();
        src.buffer = crunchy ? crushNoise : whiteNoise;
        src.loop = true;
        const f = ac.createBiquadFilter();
        f.type = filter;
        f.Q.value = q;
        steppedSweep(f.frequency, f0, f1, t, dur, 16);
        const g = ac.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f).connect(g).connect(master);
        src.start(t, Math.random());
        src.stop(t + dur + 0.02);
    }

    function arp(notes, step, opts = {}) {
        notes.forEach((f, i) => tone({ f0: f, dur: step * 1.1, delay: i * step + (opts.delay || 0), vol: opts.vol ?? 0.12, type: opts.type || 'square' }));
    }

    // ---------- Набор звуков ----------
    const FX = {
        hover() { tone({ f0: 1480, dur: 0.025, vol: 0.035 }); },
        click() { tone({ f0: 880, f1: 1320, dur: 0.06, vol: 0.09, steps: 2 }); },
        select() { arp([660, 990], 0.045, { vol: 0.09 }); },
        open() { arp([523, 784, 1047], 0.04, { vol: 0.08 }); },
        close() { arp([784, 523], 0.04, { vol: 0.07 }); },
        notify() { arp([988, 1319], 0.05, { vol: 0.05, type: 'triangle' }); },
        spawn() { arp([523, 659, 784, 1047], 0.045, { vol: 0.1 }); },
        spawnBig() {
            arp([262, 330, 392, 523, 659], 0.06, { vol: 0.11 });
            tone({ type: 'triangle', f0: 90, f1: 60, dur: 0.5, vol: 0.18 });
        },
        impact() { noise({ dur: 0.12, vol: 0.12, f0: 2600, f1: 400 }); },
        merge() {
            noise({ dur: 0.45, vol: 0.22, f0: 2400, f1: 120 });
            tone({ type: 'triangle', f0: 180, f1: 45, dur: 0.45, vol: 0.25 });
        },
        burn() {
            noise({ dur: 0.5, vol: 0.13, f0: 6000, f1: 1500, filter: 'highpass', crunchy: false });
            tone({ f0: 300, f1: 120, dur: 0.3, vol: 0.06 });
        },
        explode() {
            noise({ dur: 0.9, vol: 0.3, f0: 3500, f1: 80 });
            tone({ type: 'square', f0: 220, f1: 40, dur: 0.6, vol: 0.12, steps: 18 });
        },
        absorb() {
            tone({ type: 'sine', f0: 760, f1: 28, dur: 1.1, vol: 0.22, steps: 30, vibrato: 9 });
            tone({ type: 'square', f0: 380, f1: 20, dur: 0.9, vol: 0.05, steps: 20 });
            noise({ dur: 1.0, vol: 0.12, f0: 900, f1: 60 });
        },
        collapse() {
            noise({ dur: 1.8, vol: 0.34, f0: 5000, f1: 50 });
            tone({ type: 'sawtooth', f0: 240, f1: 18, dur: 1.6, vol: 0.14, steps: 32 });
            arp([1047, 784, 523, 392, 262, 196], 0.09, { vol: 0.08, delay: 0.15 });
        },
        ignite() {
            arp([262, 330, 392, 523, 659, 784, 1047, 1319], 0.05, { vol: 0.1 });
            noise({ dur: 0.7, vol: 0.08, f0: 800, f1: 6000, filter: 'bandpass', q: 3, crunchy: false });
        },
        chirp() {
            // «чирп» гравитационной волны, как в записи детектора LIGO
            tone({ type: 'sine', f0: 40, f1: 520, dur: 1.2, vol: 0.28, steps: 40 });
            tone({ type: 'square', f0: 40, f1: 520, dur: 1.2, vol: 0.04, steps: 40 });
            noise({ dur: 1.6, vol: 0.18, f0: 400, f1: 40, delay: 1.15 });
        },
        crash() {
            noise({ dur: 0.5, vol: 0.22, f0: 4000, f1: 200 });
            tone({ type: 'square', f0: 600, f1: 90, dur: 0.35, vol: 0.08 });
        },
        play() { tone({ f0: 330, f1: 660, dur: 0.12, vol: 0.09, steps: 2 }); },
        pause() { tone({ f0: 660, f1: 330, dur: 0.12, vol: 0.09, steps: 2 }); },
        step() { tone({ f0: 990, dur: 0.035, vol: 0.07 }); },
        remove() { arp([620, 420, 260], 0.05, { vol: 0.09 }); noise({ dur: 0.2, vol: 0.08, f0: 2000, f1: 300 }); },
        error() { tone({ f0: 110, dur: 0.18, vol: 0.12 }); tone({ f0: 104, dur: 0.18, vol: 0.12, delay: 0.02 }); },
        pulsar() { noise({ dur: 0.03, vol: 0.16, f0: 4000, f1: 2000, crunchy: false }); },
        escape() { tone({ f0: 880, f1: 220, dur: 0.6, vol: 0.06, type: 'triangle' }); },
        start() { arp([392, 523, 784, 1047], 0.06, { vol: 0.1 }); }
    };

    // Чтобы одинаковые звуки не сливались в шум при сотне столкновений
    const COOLDOWN = { notify: 0.3, hover: 0.04, impact: 0.08, merge: 0.15, burn: 0.2, absorb: 0.4, explode: 0.25, crash: 0.25, pulsar: 0.05, spawn: 0.05, escape: 0.5 };

    function play(name) {
        if (!ready() || !FX[name]) return;
        const t = ac.currentTime;
        const cd = COOLDOWN[name] ?? 0.02;
        if (lastPlayed[name] && t - lastPlayed[name] < cd) return;
        lastPlayed[name] = t;
        try { FX[name](); } catch (e) { /* звук — не главное */ }
    }

    // Гул двигателя корабля, пока игрок держит газ
    function engine(on) {
        if (!ac) return;
        if (on && ready() && !engineNode) {
            const src = ac.createBufferSource();
            src.buffer = crushNoise;
            src.loop = true;
            const f = ac.createBiquadFilter();
            f.type = 'lowpass';
            f.frequency.value = 420;
            const g = ac.createGain();
            g.gain.setValueAtTime(0.0001, ac.currentTime);
            g.gain.linearRampToValueAtTime(0.09, ac.currentTime + 0.08);
            src.connect(f).connect(g).connect(master);
            src.start();
            engineNode = { src, g };
        } else if (!on && engineNode) {
            const n = engineNode;
            engineNode = null;
            n.g.gain.setTargetAtTime(0.0001, ac.currentTime, 0.04);
            n.src.stop(ac.currentTime + 0.2);
        }
    }

    function setMuted(m) {
        muted = m;
        if (m) engine(false);
        if (master) master.gain.setTargetAtTime(m ? 0 : volume, ac.currentTime, 0.02);
    }

    return { unlock, play, engine, setMuted, isMuted: () => muted };
})();
