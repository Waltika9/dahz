// ===== «VISION» — камера, которая понимает, что видит =====
const $ = (id) => document.getElementById(id);

const video = $('video');
const preview = $('preview');
const previewText = $('previewText');
const liveBadge = $('liveBadge');
const allowBtn = $('allowBtn');
const cameraSwitch = $('cameraSwitch');
const cameraName = $('cameraName');
const switchBtn = $('switchBtn');
const cameraError = $('cameraError');
const startBtn = $('startBtn');
const snackbar = $('snackbar');

const session = $('session');
const stage = $('stage');
const sessionVideo = $('sessionVideo');
const overlay = $('overlay');
const octx = overlay.getContext('2d');
const loader = $('loader');
const foundBox = $('found');
const fpsLabel = $('fps');

let stream = null;
let cameras = [];        // все камеры устройства
let cameraIndex = 0;     // какая сейчас включена
let mirrored = true;     // фронтальную камеру показываем зеркально

let model = null;        // нейросеть
let modelPromise = null;
let sessionOn = false;
let tracks = [];         // найденные объекты (с плавным движением рамок)

const MIN_SCORE = 0.5;   // показываем, если нейросеть уверена хотя бы на 50%

// ===== «Рябь» при нажатии на кнопки =====
document.querySelectorAll('.ripple').forEach((el) => {
    el.addEventListener('pointerdown', (e) => {
        const r = el.getBoundingClientRect();
        const size = Math.max(r.width, r.height) * 2;
        const wave = document.createElement('span');
        wave.className = 'ripple-wave';
        wave.style.width = wave.style.height = size + 'px';
        wave.style.left = (e.clientX - r.left - size / 2) + 'px';
        wave.style.top = (e.clientY - r.top - size / 2) + 'px';
        el.appendChild(wave);
        wave.addEventListener('animationend', () => wave.remove());
    });
});

// ===== Сообщение снизу =====
let snackTimer = null;
function showSnackbar(text) {
    clearTimeout(snackTimer);
    snackbar.textContent = text;
    snackbar.classList.add('show');
    snackTimer = setTimeout(() => snackbar.classList.remove('show'), 3500);
}

function showError(text) {
    cameraError.textContent = text;
    cameraError.hidden = !text;
}

// ===== Включение камеры =====
async function startCamera(deviceId) {
    if (!navigator.mediaDevices?.getUserMedia) {
        showError('Этот браузер не даёт доступ к камере. Откройте страницу в Chrome или Edge по адресу https://');
        return;
    }

    // старую камеру выключаем, прежде чем включить новую
    if (stream) stream.getTracks().forEach((t) => t.stop());

    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: deviceId
                ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
                : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            showError('Доступ к камере запрещён. Разрешите его в настройках браузера: значок замка слева от адреса сайта → Камера → Разрешить.');
        } else if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
            showError('Камера не найдена. Проверьте, что она подключена.');
        } else if (err.name === 'NotReadableError') {
            showError('Камера занята другой программой. Закройте её и попробуйте снова.');
        } else {
            showError('Не удалось включить камеру.');
        }
        return;
    }

    showError('');
    video.srcObject = stream;
    sessionVideo.srcObject = stream;
    await video.play().catch(() => {});
    if (sessionOn) await sessionVideo.play().catch(() => {});

    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings();

    // список камер виден только после разрешения
    cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    cameraIndex = Math.max(0, cameras.findIndex((c) => c.deviceId === settings.deviceId));

    // задняя камера телефона — без зеркала, все остальные — как в зеркале
    mirrored = settings.facingMode !== 'environment';
    preview.classList.toggle('mirror', mirrored);
    session.classList.toggle('mirror', mirrored);
    preview.classList.add('on');
    liveBadge.hidden = false;
    tracks = [];

    cameraName.textContent = '📷 ' + (track.label || 'Камера');
    cameraSwitch.hidden = false;
    switchBtn.hidden = cameras.length < 2;

    allowBtn.classList.add('done');
    allowBtn.querySelector('span').textContent = 'Доступ разрешён';
    allowBtn.disabled = true;

    startBtn.classList.remove('is-locked');

    // пока человек читает страницу, нейросеть уже грузится в фоне
    loadModel().catch(() => {});
}

allowBtn.addEventListener('click', () => startCamera());

function nextCamera() {
    if (cameras.length < 2) {
        showSnackbar('На этом устройстве только одна камера');
        return;
    }
    cameraIndex = (cameraIndex + 1) % cameras.length;
    preview.classList.remove('on');   // короткое «затемнение» при смене
    setTimeout(() => startCamera(cameras[cameraIndex].deviceId), 250);
}

switchBtn.addEventListener('click', nextCamera);
$('sessionSwitch').addEventListener('click', nextCamera);

// если камеру выдернули или отключили — возвращаемся в начальное состояние
navigator.mediaDevices?.addEventListener?.('devicechange', async () => {
    if (!stream) return;
    const alive = stream.getVideoTracks().some((t) => t.readyState === 'live');
    if (!alive) {
        if (sessionOn) endSession();
        preview.classList.remove('on');
        liveBadge.hidden = true;
        startBtn.classList.add('is-locked');
        previewText.textContent = 'Камера отключилась';
        allowBtn.classList.remove('done');
        allowBtn.querySelector('span').textContent = 'Разрешить доступ к камере';
        allowBtn.disabled = false;
    }
});

// ===== Нейросеть =====
function loadModel() {
    if (model) return Promise.resolve(model);
    if (!modelPromise) {
        if (typeof cocoSsd === 'undefined') return Promise.reject(new Error('no library'));
        modelPromise = cocoSsd.load({ base: 'lite_mobilenet_v2' })
            .then((m) => { model = m; return m; })
            .catch((err) => { modelPromise = null; throw err; });
    }
    return modelPromise;
}

async function prepareModel() {
    if (model) { loader.classList.add('hide'); return; }
    loader.classList.remove('hide', 'error');
    $('loaderTitle').textContent = 'Загружаем нейросеть…';
    $('loaderText').textContent = 'Это займёт несколько секунд, только в первый раз';
    $('retryBtn').hidden = true;
    try {
        await loadModel();
        loader.classList.add('hide');
    } catch {
        loader.classList.add('error');
        $('loaderTitle').textContent = 'Не удалось загрузить нейросеть';
        $('loaderText').textContent = 'Проверьте подключение к интернету и попробуйте ещё раз.';
        $('retryBtn').hidden = false;
    }
}

$('retryBtn').addEventListener('click', prepareModel);

// ===== Начать / завершить сессию =====
startBtn.addEventListener('click', () => {
    if (startBtn.classList.contains('is-locked')) {
        showSnackbar('Необходимо дать разрешение на использование камеры устройства');
        // подсказываем, какую кнопку нажать
        allowBtn.classList.remove('nudge');
        void allowBtn.offsetWidth;
        allowBtn.classList.add('nudge');
        return;
    }
    startSession();
});

async function startSession() {
    sessionOn = true;
    tracks = [];
    session.hidden = false;
    document.body.classList.add('in-session');
    renderFound([]);
    await sessionVideo.play().catch(() => {});
    requestAnimationFrame(drawLoop);
    await prepareModel();
    if (sessionOn) detectLoop();
}

function endSession() {
    sessionOn = false;
    session.hidden = true;
    document.body.classList.remove('in-session');
    fpsLabel.textContent = '';
}

$('endBtn').addEventListener('click', endSession);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sessionOn) endSession(); });

// ===== Распознавание =====
// Нейросеть смотрит на кадр, а мы плавно двигаем рамки к новым местам — так они не дёргаются
let loopId = 0;   // если сессию быстро перезапустили — старый цикл сам остановится
async function detectLoop() {
    const myId = ++loopId;
    let frames = 0;
    let since = performance.now();
    while (sessionOn && myId === loopId) {
        if (model && sessionVideo.readyState >= 2) {
            const predictions = await model.detect(sessionVideo, 20, MIN_SCORE);
            if (!sessionOn || myId !== loopId) break;
            updateTracks(predictions);
            frames++;
            const now = performance.now();
            if (now - since > 1000) {
                fpsLabel.textContent = `${Math.round(frames * 1000 / (now - since))} кадр/с`;
                frames = 0;
                since = now;
            }
        }
        await new Promise((r) => requestAnimationFrame(r));
    }
}

// насколько две рамки перекрываются (0 — никак, 1 — полностью)
function overlap(a, b) {
    const x1 = Math.max(a[0], b[0]);
    const y1 = Math.max(a[1], b[1]);
    const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
    const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    return inter / (a[2] * a[3] + b[2] * b[3] - inter || 1);
}

function updateTracks(predictions) {
    tracks.forEach((t) => { t.matched = false; });
    for (const p of predictions) {
        let best = null;
        let bestScore = 0.2;
        for (const t of tracks) {
            if (t.matched || t.cls !== p.class) continue;
            const o = overlap(t.target, p.bbox);
            if (o > bestScore) { best = t; bestScore = o; }
        }
        if (best) {
            best.target = p.bbox;
            best.score = p.score;
            best.matched = true;
        } else {
            tracks.push({ cls: p.class, box: [...p.bbox], target: p.bbox, score: p.score, alpha: 0, matched: true });
        }
    }
    renderFound(tracks.filter((t) => t.matched));
}

// ===== Рисование рамок =====
function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// view: как кадр камеры уложен в область рисования (масштаб, сдвиг, зеркало)
function drawTracks(ctx, view, ui = 1) {
    for (const t of tracks) {
        if (t.alpha < 0.02) continue;
        const [bx, by, bw, bh] = t.box;
        let x = view.ox + bx * view.scale;
        const y = view.oy + by * view.scale;
        const w = bw * view.scale;
        const h = bh * view.scale;
        if (view.mirror) x = view.width - x - w;

        const color = colorOf(t.cls);
        const [name, emoji] = labelOf(t.cls);

        ctx.globalAlpha = t.alpha;
        roundRect(ctx, x, y, w, h, 16 * ui);
        ctx.fillStyle = color + '1f';
        ctx.fill();
        ctx.lineWidth = 3 * ui;
        ctx.strokeStyle = color;
        ctx.stroke();

        // подпись в цветной «таблетке»
        const text = `${emoji} ${name} · ${Math.round(t.score * 100)}%`;
        ctx.font = `500 ${15 * ui}px 'Google Sans Flex', 'Google Sans', Roboto, Arial, sans-serif`;
        const tw = ctx.measureText(text).width + 24 * ui;
        const th = 30 * ui;
        let lx = Math.min(Math.max(x, 4 * ui), view.width - tw - 4 * ui);
        let ly = y - th - 6 * ui;
        if (ly < 4 * ui) ly = y + 6 * ui;   // если не влезает сверху — внутрь рамки
        roundRect(ctx, lx, ly, tw, th, th / 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.fillStyle = color === '#fbbc04' ? '#202124' : '#fff';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, lx + 12 * ui, ly + th / 2 + 1 * ui);
    }
    ctx.globalAlpha = 1;
}

// как видео (object-fit: cover) уложено в экран
function screenView() {
    const cw = stage.clientWidth;
    const ch = stage.clientHeight;
    const vw = sessionVideo.videoWidth || 1;
    const vh = sessionVideo.videoHeight || 1;
    const scale = Math.max(cw / vw, ch / vh);
    return { width: cw, scale, ox: (cw - vw * scale) / 2, oy: (ch - vh * scale) / 2, mirror: mirrored };
}

function drawLoop() {
    if (!sessionOn) return;
    requestAnimationFrame(drawLoop);

    const dpr = Math.min(devicePixelRatio, 2);
    const cw = stage.clientWidth;
    const ch = stage.clientHeight;
    if (overlay.width !== Math.round(cw * dpr) || overlay.height !== Math.round(ch * dpr)) {
        overlay.width = Math.round(cw * dpr);
        overlay.height = Math.round(ch * dpr);
    }

    // плавное движение рамок и появление / исчезание
    for (const t of tracks) {
        for (let i = 0; i < 4; i++) t.box[i] += (t.target[i] - t.box[i]) * 0.35;
        t.alpha += ((t.matched ? 1 : 0) - t.alpha) * 0.2;
    }
    tracks = tracks.filter((t) => t.matched || t.alpha > 0.02);

    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, cw, ch);
    drawTracks(octx, screenView());
}

// ===== Список «что сейчас в кадре» =====
let lastFound = null;
function renderFound(list) {
    const counts = {};
    list.forEach((t) => { counts[t.cls] = (counts[t.cls] || 0) + 1; });
    const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
    const signature = keys.map((k) => k + counts[k]).join('|');
    if (signature === lastFound) return;   // ничего не изменилось — не перерисовываем
    lastFound = signature;

    if (!keys.length) {
        foundBox.innerHTML = '<span class="found-hint">Наведите камеру на человека, животное или предмет</span>';
        return;
    }
    foundBox.innerHTML = keys.map((k) => {
        const [name, emoji] = labelOf(k);
        const n = counts[k] > 1 ? ` <em>×${counts[k]}</em>` : '';
        return `<span class="found-chip"><i style="background:${colorOf(k)}"></i>${emoji} ${name}${n}</span>`;
    }).join('');
}

// ===== Снимок: кадр вместе с рамками сохраняется в файл =====
$('shotBtn').addEventListener('click', () => {
    const vw = sessionVideo.videoWidth;
    const vh = sessionVideo.videoHeight;
    if (!vw) return;

    const canvas = document.createElement('canvas');
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');
    if (mirrored) {
        ctx.translate(vw, 0);
        ctx.scale(-1, 1);
    }
    ctx.drawImage(sessionVideo, 0, 0, vw, vh);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawTracks(ctx, { width: vw, scale: 1, ox: 0, oy: 0, mirror: mirrored }, vw / 900);

    const flash = $('flash');
    flash.classList.remove('go');
    void flash.offsetWidth;
    flash.classList.add('go');

    canvas.toBlob((blob) => {
        const a = document.createElement('a');
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        a.href = URL.createObjectURL(blob);
        a.download = `vision-${stamp}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        showSnackbar('Снимок сохранён в «Загрузки» 📸');
    }, 'image/png');
});
