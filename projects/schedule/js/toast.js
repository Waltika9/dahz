// ===== Короткие сообщения внизу экрана =====
// toast('текст') — показать на 3 секунды.

let el = null;
let timer = 0;

export function toast(message, ms = 3000) {
    if (!el) {
        el = document.createElement('div');
        el.className = 'toast';
        el.setAttribute('role', 'status');
        document.body.append(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('show'), ms);
}
