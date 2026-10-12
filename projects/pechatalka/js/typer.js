// ===== Движок набора текста (Typer) =====
// Управляет строкой ввода, курсором, проверкой символов,
// режимами «стоп на ошибке» и расчётом первичных метрик.

import { getKeyForChar, isWrongLayoutChar } from './layouts.js?v=1';
import { playClick, playError } from './sound.js?v=2';

export class Typer {
    /**
     * @param {Object} options
     * @param {HTMLElement} options.displayEl - контейнер строки ввода
     * @param {VirtualKeyboard} options.keyboard - виртуальная клавиатура
     * @param {Function} options.onCharTyped - колбэк при вводе символа (char, isCorrect)
     * @param {Function} options.onComplete - колбэк завершения текста
     * @param {Function} options.onLayoutMismatch - колбэк при неверной раскладке
     */
    constructor(options) {
        this.displayEl = options.displayEl;
        this.keyboard = options.keyboard;
        this.onCharTyped = options.onCharTyped || (() => {});
        this.onComplete = options.onComplete || (() => {});
        this.onLayoutMismatch = options.onLayoutMismatch || (() => {});
        this.onTick = options.onTick || (() => {});

        this.text = '';
        this.layout = 'ru'; // 'ru' или 'en'
        this.stopOnError = true; // режим «стоп на ошибке»
        this.currentIndex = 0;
        this.hasErrorAtCurrent = false;

        this.startTime = null;
        this.timeLimitSec = 0; // 0 = без ограничения (урок/текст), >0 = режим с таймером
        this.timerInterval = null;
        this.isPaused = false;
        this.errorsCount = 0;
        this.totalTyped = 0;
        this.errorCodes = []; // список клавиш, на которых совершены ошибки
        this.isActive = false;
    }

    setText(text, layout = 'ru', stopOnError = true, timeLimitSec = 0) {
        this.clearTimer();
        this.text = text;
        this.layout = layout;
        this.stopOnError = stopOnError;
        this.timeLimitSec = timeLimitSec;
        this.currentIndex = 0;
        this.hasErrorAtCurrent = false;
        this.startTime = null;
        this.isPaused = false;
        this.pausedAt = null;
        this.errorsCount = 0;
        this.totalTyped = 0;
        this.errorCodes = [];
        this.isActive = true;

        this.keyboard.setLayout(layout);
        this.renderText();
        this.highlightNextChar();
    }

    clearTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    reset() {
        this.currentIndex = 0;
        this.hasErrorAtCurrent = false;
        this.startTime = null;
        this.errorsCount = 0;
        this.totalTyped = 0;
        this.renderText();
        this.highlightNextChar();
    }

    renderText() {
        if (!this.displayEl) return;
        this.displayEl.innerHTML = '';

        const chars = this.text.split('');
        const frag = document.createDocumentFragment();

        chars.forEach((ch, idx) => {
            const span = document.createElement('span');
            span.className = 'char';
            span.setAttribute('data-idx', idx);

            if (idx < this.currentIndex) {
                span.classList.add('is-done');
            } else if (idx === this.currentIndex) {
                span.classList.add('is-current');
                if (this.hasErrorAtCurrent) {
                    span.classList.add('is-error');
                }
            } else {
                span.classList.add('is-pending');
            }

            // Заменяем пробел на видимый символ пробела для наглядности при рендере
            if (ch === ' ') {
                span.classList.add('is-space');
                span.textContent = '·';
            } else {
                span.textContent = ch;
            }

            frag.appendChild(span);
        });

        this.displayEl.appendChild(frag);

        // Прокручиваем строку так, чтобы текущий символ был в поле зрения
        const currentEl = this.displayEl.querySelector('.is-current');
        if (currentEl) {
            currentEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }

    highlightNextChar() {
        if (this.currentIndex >= this.text.length) {
            this.keyboard.setTarget(null, null, null);
            return;
        }

        const nextChar = this.text[this.currentIndex];
        const keyInfo = getKeyForChar(nextChar, this.layout);

        if (keyInfo) {
            this.keyboard.setTarget(keyInfo.code, keyInfo.whichShift, keyInfo.finger, nextChar);
        } else {
            this.keyboard.setTarget(null, null, null);
        }
    }

    togglePause() {
        if (!this.isActive) return false;
        this.isPaused = !this.isPaused;
        // Время на паузе не считается: после паузы сдвигаем старт вперёд
        if (this.isPaused) {
            this.pausedAt = performance.now();
        } else if (this.startTime && this.pausedAt) {
            this.startTime += performance.now() - this.pausedAt;
            this.pausedAt = null;
        }
        return this.isPaused;
    }

    startTimerIfNeeded() {
        if (!this.startTime) {
            this.startTime = performance.now();
            if (this.timeLimitSec > 0) {
                this.timerInterval = setInterval(() => {
                    if (this.isPaused) return;
                    const elapsed = (performance.now() - this.startTime) / 1000;
                    const remaining = Math.max(0, Math.ceil(this.timeLimitSec - elapsed));
                    this.onTick(remaining);
                    if (elapsed >= this.timeLimitSec) {
                        this.clearTimer();
                        this.isActive = false;
                        this.onComplete(this.getStats());
                    }
                }, 200);
            }
        }
    }

    /**
     * Обработка нажатия клавиши
     * @param {KeyboardEvent} e 
     */
    handleKeyDown(e) {
        if (!this.isActive || this.isPaused || this.currentIndex >= this.text.length) return;

        // Игнорируем служебные системные клавиши
        if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(e.key)) {
            return;
        }

        // Если нажат Backspace в обычном режиме (не «стоп на ошибке»)
        if (e.code === 'Backspace') {
            if (!this.stopOnError && this.currentIndex > 0) {
                this.currentIndex--;
                this.hasErrorAtCurrent = false;
                this.renderText();
                this.highlightNextChar();
                playClick();
            }
            e.preventDefault();
            return;
        }

        const inputChar = e.key;

        // Если нажата клавиша с длиной строки > 1 (например Escape, Enter и т.п.)
        if (inputChar.length !== 1) return;

        // Проверка неверной раскладки (например, нажали русскую букву вместо английской)
        if (isWrongLayoutChar(inputChar, this.layout)) {
            playError();
            this.onLayoutMismatch(this.layout);
            e.preventDefault();
            return;
        }

        // Засекаем время первого нажатия и запускаем таймер
        this.startTimerIfNeeded();

        const targetChar = this.text[this.currentIndex];
        this.totalTyped++;

        if (inputChar === targetChar) {
            // Верно!
            this.hasErrorAtCurrent = false;
            this.currentIndex++;
            playClick();
            this.onCharTyped(targetChar, true);

            this.renderText();
            this.highlightNextChar();

            // Проверка завершения
            if (this.currentIndex >= this.text.length) {
                this.clearTimer();
                this.isActive = false;
                this.onComplete(this.getStats());
            }
        } else {
            // Ошибка!
            this.errorsCount++;
            this.hasErrorAtCurrent = true;
            const targetKey = getKeyForChar(targetChar, this.layout);
            if (targetKey && targetKey.code) {
                this.errorCodes.push(targetKey.code);
            }
            playError();
            this.triggerShake();
            this.onCharTyped(inputChar, false);

            if (!this.stopOnError) {
                // В обычном режиме идём дальше даже с ошибкой
                this.currentIndex++;
                this.hasErrorAtCurrent = false;
                if (this.currentIndex >= this.text.length) {
                    this.clearTimer();
                    this.isActive = false;
                    this.onComplete(this.getStats());
                }
            }

            this.renderText();
            this.highlightNextChar();
        }

        e.preventDefault();
    }

    triggerShake() {
        if (!this.displayEl) return;
        this.displayEl.classList.remove('is-shaking');
        // trigger reflow
        void this.displayEl.offsetWidth;
        this.displayEl.classList.add('is-shaking');
        setTimeout(() => {
            this.displayEl.classList.remove('is-shaking');
        }, 250);
    }

    getStats() {
        const now = this.isPaused && this.pausedAt ? this.pausedAt : performance.now();
        const durationSec = this.startTime ? (now - this.startTime) / 1000 : 0;
        const cpm = durationSec > 0 ? Math.round((this.currentIndex / durationSec) * 60) : 0;
        const wpm = Math.round(cpm / 5);
        const accuracy = this.totalTyped > 0
            ? Math.max(0, Math.round(((this.totalTyped - this.errorsCount) / this.totalTyped) * 100))
            : 100;

        return {
            cpm,
            wpm,
            accuracy,
            errors: this.errorsCount,
            currentIndex: this.currentIndex,
            totalChars: this.text.length,
            durationSec,
            errorCodes: [...this.errorCodes]
        };
    }
}
