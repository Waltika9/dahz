// Окно с вопросом: ask({ title, text, buttons: [{ label, value, main, danger }] }) → обещание со значением нажатой кнопки.
// Esc или клик мимо окна — null (как «Отмена»)

import { esc } from './util.js?v=1';

const modal = document.getElementById('askModal');
const box = modal.querySelector('.modal-box');
let finish = null;

export function ask({ title, text = '', buttons }) {
    if (finish) finish(null);
    return new Promise(done => {
        box.innerHTML = `<h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}`
            + buttons.map((b, i) => `<button class="modal-btn${b.main ? ' is-main' : ''}${b.danger ? ' is-danger' : ''}" type="button" data-i="${i}">${esc(b.label)}</button>`).join('');
        modal.classList.add('is-open');
        finish = v => {
            finish = null;
            modal.classList.remove('is-open');
            done(v);
        };
        box.querySelectorAll('[data-i]').forEach(btn => btn.addEventListener('click', () => {
            if (finish) finish(buttons[btn.dataset.i].value);
        }));
        const main = box.querySelector('.is-main') || box.querySelector('[data-i]');
        if (main) main.focus({ preventScroll: true });
    });
}

const cancel = () => finish && finish(null);

modal.addEventListener('click', e => {
    if (e.target === modal) cancel();
});

// Esc закрывает вопрос раньше всех остальных окон
addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !finish) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    cancel();
}, true);

export const isAsking = () => !!finish;
