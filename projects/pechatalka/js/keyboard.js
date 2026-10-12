// ===== Рендер и управление экранной клавиатурой =====
import { ROWS } from './layouts.js?v=1';
import { renderHands, getFingerTitle } from './pixel.js?v=9';

export class VirtualKeyboard {
    /**
     * @param {HTMLElement} container - контейнер клавиатуры
     * @param {HTMLElement} handsEl - место для пиксельных рук (под клавиатурой)
     * @param {HTMLElement} hintContainer - плашка подсказки пальца
     */
    constructor(container, handsEl, hintContainer) {
        this.container = container;
        this.handsEl = handsEl;
        this.hintContainer = hintContainer;
        this.currentLayout = 'ru'; // 'ru' или 'en'
        this.keyElements = new Map(); // code -> DOM element
        this.activeTargets = new Set(); // codes to highlight
        this.errorHeatmap = {}; // code -> count ошибок
        this.hand = { finger: null, shift: null, label: '' }; // что показывают руки
        this.render();
    }

    setLayout(layout) {
        if (this.currentLayout === layout) return;
        this.currentLayout = layout;
        this.container.setAttribute('data-active-layout', layout);
        this.updateHands(); // буквы над пальцами зависят от раскладки
    }

    render() {
        this.container.innerHTML = '';
        this.container.className = 'px-keyboard';
        this.container.setAttribute('data-active-layout', this.currentLayout);

        ROWS.forEach((row, rowIndex) => {
            const rowEl = document.createElement('div');
            rowEl.className = 'kb-row';
            rowEl.setAttribute('data-row', rowIndex);

            row.forEach(k => {
                const keyEl = document.createElement('div');
                keyEl.className = `kb-key finger-${k.finger}`;
                keyEl.setAttribute('data-code', k.code);
                keyEl.style.flex = `${k.width || 1}`;

                // Специальные метки F / J (А / О)
                if (k.homing) {
                    keyEl.classList.add('is-homing');
                }

                // Содержимое клавиши:
                if (k.label && !k.en && !k.ru) {
                    keyEl.classList.add('is-special');
                    keyEl.innerHTML = `<span class="key-label">${k.label}</span>`;
                } else if (k.code === 'Space') {
                    keyEl.classList.add('is-space');
                    keyEl.innerHTML = `<span class="key-label">SPACE</span>`;
                } else {
                    const enDisplay = k.enShift && k.enShift !== k.en.toUpperCase()
                        ? `${k.enShift} ${k.en}`
                        : (k.en ? k.en.toUpperCase() : '');
                    const ruDisplay = k.ruShift && k.ruShift !== k.ru.toUpperCase()
                        ? `${k.ruShift} ${k.ru}`
                        : (k.ru ? k.ru.toUpperCase() : '');

                    keyEl.innerHTML = `
                        <span class="key-char en-char">${enDisplay}</span>
                        <span class="key-char ru-char">${ruDisplay}</span>
                        ${k.homing ? '<span class="key-nub"></span>' : ''}
                    `;
                }

                rowEl.appendChild(keyEl);
                this.keyElements.set(k.code, keyEl);
            });

            this.container.appendChild(rowEl);
        });

        this.updateHands();
    }

    /**
     * Подсветка целевой клавиши (и при необходимости Shift)
     * @param {string|null} targetCode
     * @param {string|null} shiftCode
     * @param {string|null} fingerName
     * @param {string} char - символ, который нужно набрать (для подписи над пальцем)
     */
    setTarget(targetCode, shiftCode = null, fingerName = null, char = '') {
        this.activeTargets.forEach(code => {
            const el = this.keyElements.get(code);
            if (el) el.classList.remove('is-target', 'is-target-shift');
        });
        this.activeTargets.clear();

        if (targetCode) {
            const el = this.keyElements.get(targetCode);
            if (el) {
                el.classList.add('is-target');
                this.activeTargets.add(targetCode);
            }
        }

        if (shiftCode) {
            const el = this.keyElements.get(shiftCode);
            if (el) {
                el.classList.add('is-target-shift');
                this.activeTargets.add(shiftCode);
            }
        }

        this.hand = {
            finger: fingerName,
            shift: shiftCode,
            label: char && char !== ' ' ? char.toUpperCase() : ''
        };
        this.updateHands();
    }

    pressKey(code) {
        const el = this.keyElements.get(code);
        if (el) {
            el.classList.add('is-pressed');
        }
    }

    releaseKey(code) {
        const el = this.keyElements.get(code);
        if (el) {
            el.classList.remove('is-pressed');
        }
    }

    // Руки под клавиатурой и подсказка «какой палец»
    updateHands() {
        const { finger, shift, label } = this.hand;

        if (this.handsEl) {
            this.handsEl.innerHTML = renderHands({ finger, shift, label, layout: this.currentLayout });
        }

        if (this.hintContainer) {
            let hint = finger === 'thumb' ? 'Большой палец (любой)' : getFingerTitle(finger);
            if (hint && shift) {
                hint += shift === 'ShiftLeft' ? ' + Shift левым мизинцем' : ' + Shift правым мизинцем';
            }
            this.hintContainer.innerHTML = `ПАЛЕЦ: <b class="finger-hint-name">${hint ? hint.toUpperCase() : '—'}</b>`;
        }
    }

    /**
     * Применение тепловой карты ошибок на клавиши (пиксельный дизеринг)
     * Чем больше ошибок, тем выше уровень класса (heat-1 .. heat-4)
     * @param {Object} heatmap
     */
    applyHeatmap(heatmap) {
        this.errorHeatmap = heatmap || {};
        const values = Object.values(this.errorHeatmap);
        const maxVal = values.length ? Math.max(...values, 1) : 1;

        this.keyElements.forEach((el, code) => {
            el.classList.remove('heat-1', 'heat-2', 'heat-3', 'heat-4');
            const errs = this.errorHeatmap[code] || 0;
            if (errs > 0) {
                const ratio = errs / maxVal;
                if (ratio > 0.75) el.classList.add('heat-4');
                else if (ratio > 0.5) el.classList.add('heat-3');
                else if (ratio > 0.25) el.classList.add('heat-2');
                else el.classList.add('heat-1');
            }
        });
    }
}
