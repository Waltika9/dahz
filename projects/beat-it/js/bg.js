// Фон уровня: картинка или видео за нотами. Видео идёт вместе с песней:
// у него можно обрезать начало и конец, а если оно короче песни — повторять по кругу или затемнить.
// bg = { blob, kind: 'image' | 'video', name, dim, offset, cut, end: 'loop' | 'dim' }
//   dim — насколько фон затемнён (0 — как есть, 1 — чёрный); offset / cut — с какой и до какой секунды видео

import { clock } from './util.js?v=1';

export const BG_DIM = 0.55;
const BIG_FILE = 150 * 1024 * 1024;

// ===== Фон во время игры и в предпросмотре редактора =====

export class Backdrop {
    constructor(host) {
        this.host = host;
        this.el = null;
        this.url = '';
        this.bg = null;
    }

    set(bg) {
        if (bg && this.bg && bg.blob === this.bg.blob && this.el) {
            this.bg = bg;                            // тот же файл — поменялись только настройки
            return;
        }
        this.clear();
        if (!bg || !bg.blob) return;
        this.bg = bg;
        this.url = URL.createObjectURL(bg.blob);
        const el = document.createElement(bg.kind === 'video' ? 'video' : 'img');
        if (bg.kind === 'video') {
            el.muted = true;                         // звук — только песня
            el.playsInline = true;
            el.preload = 'auto';
            el.setAttribute('muted', '');
            el.setAttribute('playsinline', '');
        } else {
            el.alt = '';
        }
        el.className = 'backdrop';
        el.src = this.url;
        this.host.append(el);
        this.el = el;
    }

    // Сколько секунд видео идёт до своего конца (null — картинка или ещё не загрузилось)
    length() {
        const v = this.el;
        if (!v || this.bg.kind !== 'video' || !v.duration) return null;
        const cut = Math.min(v.duration, this.bg.cut || v.duration);
        return Math.max(0.1, cut - (this.bg.offset || 0));
    }

    // Насколько затемнить фон в секунду песни t (1 — совсем чёрный)
    shade(t) {
        if (!this.bg) return 1;
        const dim = this.bg.dim ?? BG_DIM;
        const len = this.length();
        if (len != null && this.bg.end !== 'loop' && t > len) {
            return dim + (1 - dim) * Math.min(1, (t - len) / 1.5);   // видео кончилось — плавно темнеет
        }
        return dim;
    }

    // Видео показывает ту же секунду, что и песня; rate — скорость песни (в редакторе бывает медленнее)
    sync(t, playing, rate = 1) {
        const v = this.el;
        const len = this.length();
        if (len == null) return;
        const offset = this.bg.offset || 0;
        let target = offset + Math.max(0, t);
        let run = playing && t >= 0;
        if (t >= len) {
            if (this.bg.end === 'loop') {
                target = offset + (t % len);
            } else {
                target = offset + len - 0.05;        // стоит на последнем кадре и темнеет
                run = false;
            }
        }
        if (v.playbackRate !== rate) v.playbackRate = rate;
        if (!run) {
            if (!v.paused) v.pause();
            if (Math.abs(v.currentTime - target) > 0.06 && !v.seeking) v.currentTime = target;
            return;
        }
        if (Math.abs(v.currentTime - target) > 0.25 && !v.seeking) v.currentTime = target;
        if (v.paused) v.play().catch(() => {});
    }

    pause() {
        if (this.el && this.el.pause) this.el.pause();
    }

    clear() {
        if (this.el) {
            if (this.el.pause) this.el.pause();
            this.el.removeAttribute('src');
            if (this.el.load) this.el.load();
            this.el.remove();
        }
        if (this.url) URL.revokeObjectURL(this.url);
        this.el = null;
        this.url = '';
        this.bg = null;
    }
}

// Длина видео из файла (или null, если браузер его не открывает)
export function videoLength(blob) {
    return new Promise(done => {
        const v = document.createElement('video');
        const url = URL.createObjectURL(blob);
        const end = d => {
            URL.revokeObjectURL(url);
            v.removeAttribute('src');
            done(d);
        };
        v.preload = 'metadata';
        v.muted = true;
        v.onloadedmetadata = () => end(Number.isFinite(v.duration) ? v.duration : null);
        v.onerror = () => end(null);
        v.src = url;
    });
}

// ===== Выбор фона (окно «Автоматически» и вкладка «Фон» в редакторе) =====

// value — фон, который уже выбран (или null); duration — длина песни (можно сообщить позже через setDuration)
export function bgForm(root, { value = null, duration = 0, onChange = () => {}, onError = () => {} } = {}) {
    let bg = value ? { ...value } : null;
    let vdur = 0;                 // длина выбранного видео
    let songDur = duration;
    let url = '';

    root.innerHTML = `
        <div class="bgf">
            <div class="bgf-row">
                <label class="file-btn"><input type="file" accept="image/*,video/*" hidden><span>Выбрать фото или видео</span></label>
                <button class="mini-btn bgf-clear" type="button" hidden>Убрать</button>
            </div>
            <div class="bgf-preview" hidden>
                <div class="bgf-media"></div>
                <i class="bgf-shade"></i>
                <span class="bgf-name"></span>
            </div>
            <div class="bgf-video" hidden>
                <p class="bgf-info"></p>
                <label class="field"><span>Начало видео: <b class="bgf-from">0:00</b></span>
                    <input class="range bgf-offset" type="range" min="0" max="1" step="0.1" value="0"></label>
                <label class="field"><span>Конец видео: <b class="bgf-to">0:00</b></span>
                    <input class="range bgf-cut" type="range" min="0" max="1" step="0.1" value="1"></label>
                <div class="bgf-end" hidden>
                    <p class="bgf-endtext"></p>
                    <div class="seg">
                        <button type="button" data-end="loop">Повторять заново</button>
                        <button type="button" data-end="dim">Затемнить</button>
                    </div>
                </div>
            </div>
            <label class="field bgf-dimrow" hidden><span>Затемнение фона: <b class="bgf-dimv"></b></span>
                <input class="range bgf-dim" type="range" min="0.2" max="0.9" step="0.05" value="${BG_DIM}"></label>
        </div>`;

    const q = s => root.querySelector(s);
    const input = q('input[type=file]');
    const media = q('.bgf-media');
    const offsetEl = q('.bgf-offset');
    const cutEl = q('.bgf-cut');
    const dimEl = q('.bgf-dim');

    input.addEventListener('change', async () => {
        const file = input.files[0];
        input.value = '';
        if (!file) return;
        const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null;
        if (!kind) {
            onError('Это не картинка и не видео');
            return;
        }
        let len = 0;
        if (kind === 'video') {
            len = await videoLength(file);
            if (!len) {
                onError('Это видео не открывается в браузере. Нужен файл mp4.');
                return;
            }
        }
        if (file.size > BIG_FILE) onError('Большой файл — уровень займёт много места');
        bg = { blob: file, kind, name: file.name, dim: bg ? bg.dim : BG_DIM, offset: 0, cut: len || 0, end: 'loop' };
        vdur = len;
        show(true);
        onChange(bg);
    });

    q('.bgf-clear').addEventListener('click', () => {
        bg = null;
        show(true);
        onChange(bg);
    });

    offsetEl.addEventListener('input', () => {
        bg.offset = Math.min(Number(offsetEl.value), bg.cut - 0.5);
        offsetEl.value = bg.offset;
        seek(bg.offset);
        refresh();
        onChange(bg);
    });
    cutEl.addEventListener('input', () => {
        bg.cut = Math.max(Number(cutEl.value), bg.offset + 0.5);
        cutEl.value = bg.cut;
        seek(bg.cut - 0.1);
        refresh();
        onChange(bg);
    });
    dimEl.addEventListener('input', () => {
        bg.dim = Number(dimEl.value);
        refresh();
        onChange(bg);
    });
    q('.bgf-end').addEventListener('click', e => {
        const b = e.target.closest('[data-end]');
        if (!b) return;
        bg.end = b.dataset.end;
        refresh();
        onChange(bg);
    });

    function seek(sec) {
        const v = media.querySelector('video');
        if (v && v.readyState >= 1) v.currentTime = Math.max(0, sec);
    }

    // Перерисовать предпросмотр (newFile — сменился сам файл)
    function show(newFile) {
        if (newFile) {
            if (url) URL.revokeObjectURL(url);
            url = bg ? URL.createObjectURL(bg.blob) : '';
            media.innerHTML = !bg ? '' : bg.kind === 'video'
                ? `<video src="${url}" muted playsinline preload="auto"></video>`
                : `<img src="${url}" alt="">`;
            const v = media.querySelector('video');
            if (v) {
                v.addEventListener('loadedmetadata', () => {
                    if (!vdur) vdur = v.duration;
                    seek(bg.offset);
                    refresh();
                }, { once: true });
            }
        }
        refresh();
    }

    function refresh() {
        q('.bgf-clear').hidden = !bg;
        q('.bgf-preview').hidden = !bg;
        q('.bgf-dimrow').hidden = !bg;
        q('.file-btn span').textContent = bg ? 'Другой файл' : 'Выбрать фото или видео';
        const isVideo = bg && bg.kind === 'video' && vdur > 0;
        q('.bgf-video').hidden = !isVideo;
        if (!bg) return;
        q('.bgf-name').textContent = bg.name || (bg.kind === 'video' ? 'Видео' : 'Картинка');
        dimEl.value = bg.dim;
        q('.bgf-dimv').textContent = `${Math.round(bg.dim * 100)} %`;
        q('.bgf-shade').style.opacity = bg.dim;
        if (!isVideo) return;

        if (!bg.cut || bg.cut > vdur) bg.cut = vdur;
        offsetEl.max = cutEl.max = vdur.toFixed(1);
        offsetEl.value = bg.offset;
        cutEl.value = bg.cut;
        q('.bgf-from').textContent = clock(bg.offset);
        q('.bgf-to').textContent = clock(bg.cut);
        const len = bg.cut - bg.offset;
        q('.bgf-info').innerHTML = `Видео: <b>${clock(vdur)}</b>, берём <b>${clock(len)}</b>`
            + (songDur ? `, песня: <b>${clock(songDur)}</b>` : '');
        const short = songDur > 0 && len < songDur - 0.5;
        q('.bgf-end').hidden = !short;
        if (short) {
            q('.bgf-endtext').textContent = `Видео закончится на ${clock(songDur - len)} раньше песни. Что делать дальше?`;
            q('.bgf-end').querySelectorAll('[data-end]').forEach(b => b.classList.toggle('is-on', b.dataset.end === bg.end));
        } else if (songDur > 0 && len > songDur + 0.5) {
            q('.bgf-info').innerHTML += '<br>Видео длиннее песни — лишний конец просто не покажется.';
        }
    }

    // Уже выбранный фон (из редактора): длину видео узнаём заново
    if (bg && bg.kind === 'video') {
        videoLength(bg.blob).then(len => {
            vdur = len || 0;
            refresh();
        });
    }
    show(true);

    return {
        get value() {
            return bg;
        },
        setDuration(d) {
            songDur = d;
            refresh();
        },
        destroy() {
            if (url) URL.revokeObjectURL(url);
            media.innerHTML = '';
        }
    };
}

// Короткая подпись фона для карточки уровня
export const bgLabel = bg => (!bg ? '' : bg.kind === 'video' ? 'Видео' : 'Фото');
