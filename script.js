const toast = document.getElementById('toast');
const compilerModal = document.getElementById('compilerModal');
const openCompilerBtn = document.getElementById('openCompilerBtn');
const closeModalBtn = document.getElementById('closeModalBtn');
const soonCard = document.getElementById('soonCard');

let toastTimeout;

// type: '' (красный), 'success', 'info', 'warning' — цвета в style.css
function showToast(message, type = '') {
    clearTimeout(toastTimeout);
    toast.textContent = message;
    toast.className = 'toast show' + (type ? ' ' + type : '');
    toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Авторизация — в firebase.js

// Открытие модалки
openCompilerBtn.addEventListener('click', (e) => {
    e.preventDefault();
    compilerModal.classList.add('active');
});

// Закрытие по крестику
closeModalBtn.addEventListener('click', () => {
    compilerModal.classList.remove('active');
});

// Закрытие по фону
compilerModal.addEventListener('click', (e) => {
    if (e.target === compilerModal) {
        compilerModal.classList.remove('active');
    }
});

// Клик по карточке "soon"
if (soonCard) {
    soonCard.addEventListener('click', () => {
        showToast("Скоро появятся новые проекты");
    });
}

// ===== Анимация входа на главную страницу =====
(function () {
    const curtain = document.getElementById('introCurtain');
    if (!curtain) return;

    // Кто отключил анимации в системе — сразу показываем сайт
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        curtain.remove();
        return;
    }

    // Блокируем прокрутку на время анимации
    document.body.classList.add('intro-locked');

    // Искра в центре успевает загореться, затем расходится волна и «подлетает» сайт
    setTimeout(() => {
        curtain.classList.add('active');
        document.body.classList.add('intro-playing');
    }, 650);

    // Волна дошла до краёв — убираем шторку
    setTimeout(() => {
        curtain.remove();
        document.body.classList.remove('intro-locked');
    }, 1650);

    // Анимация блоков закончилась
    setTimeout(() => {
        document.body.classList.remove('intro-playing');
    }, 1900);
})();

// Все карточки с классом "not-ready" показывают toast вместо перехода
document.querySelectorAll('.not-ready').forEach(card => {
    card.addEventListener('click', (e) => {
        e.preventDefault();
        showToast("Проект на стадии разработки...");
    });
});
