// ===== Web Audio API — 8-битные звуки без внешних файлов =====
// Звуки генерируются программно через осцилляторы.

let audioCtx = null;
const SOUND_KEY = 'pechatalka_sound'; // выбор «звук вкл/выкл» запоминается
let soundEnabled = true;
try {
    soundEnabled = localStorage.getItem(SOUND_KEY) !== 'off';
} catch (e) {
    // Нет доступа к localStorage — звук включён
}

function saveSound() {
    try {
        localStorage.setItem(SOUND_KEY, soundEnabled ? 'on' : 'off');
    } catch (e) {
        // Игнорируем
    }
}

function getAudioContext() {
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            audioCtx = new AudioContextClass();
        }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

// Короткий мягкий 8-битный щелчок на успешное нажатие клавиши
export function playClick() {
    if (!soundEnabled) return;
    try {
        const ctx = getAudioContext();
        if (!ctx) return;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        // Быстрый щелчок с резким спадом
        osc.type = 'triangle';
        const now = ctx.currentTime;
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(120, now + 0.035);

        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.04);
    } catch (e) {
        // Игнорируем ошибки автовоспроизведения до первого клика
    }
}

// Низкий 8-битный «бип» на ошибку
export function playError() {
    if (!soundEnabled) return;
    try {
        const ctx = getAudioContext();
        if (!ctx) return;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        // Резкая прямоугольная волна для ошибки
        osc.type = 'sawtooth';
        const now = ctx.currentTime;
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.setValueAtTime(110, now + 0.04);

        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.13);
    } catch (e) {
        // Игнорируем
    }
}

// Переключение звука
export function toggleSound() {
    soundEnabled = !soundEnabled;
    saveSound();
    return soundEnabled;
}

export function isSoundEnabled() {
    return soundEnabled;
}

export function setSoundEnabled(enabled) {
    soundEnabled = !!enabled;
    saveSound();
}
