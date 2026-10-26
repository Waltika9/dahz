// Мелкие помощники, которые нужны сразу нескольким модулям

export const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 4:35
export function clock(sec) {
    const s = Math.round(sec);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Генератор случайностей с зерном: одно и то же зерно — одни и те же числа
export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function hashSeed(str) {
    let h = 2166136261;
    for (const ch of str) {
        h ^= ch.codePointAt(0);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// Прямоугольник со скруглёнными углами на canvas (без ctx.roundRect — его нет в старом Safari)
export function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// Скачать файл на устройство
export function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Имя файла без запрещённых символов
export const safeName = s => String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

// 1 опция, 2 опции, 5 опций
export function plural(n, one, few, many) {
    const d = n % 10, dd = n % 100;
    if (d === 1 && dd !== 11) return one;
    if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
    return many;
}

let toastTimer = 0;
export function toast(text) {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-shown'), 2600);
}
