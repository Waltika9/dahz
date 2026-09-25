const toast = document.getElementById('toast');
const compilerModal = document.getElementById('compilerModal');
const openCompilerBtn = document.getElementById('openCompilerBtn');
const closeModalBtn = document.getElementById('closeModalBtn');
const htmlCompBtn = document.getElementById('htmlCompBtn');
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

// Клик по неактивному HTML-компилятору
htmlCompBtn.addEventListener('click', (e) => {
    e.preventDefault();
    compilerModal.classList.remove('active');
    showToast("Компилятор html пока что недоступен");
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

    // Блокируем прокрутку на время анимации
    document.body.classList.add('intro-locked');

    // Мгновение тёмной паузы, затем из центра расцветает свечение
    setTimeout(() => {
        curtain.classList.add('active');
    }, 500);

    // Свечение дошло до краёв — плавно убираем шторку
    setTimeout(() => {
        curtain.classList.add('done');
        document.body.classList.remove('intro-locked');
    }, 700);

    // Полностью удаляем элемент из DOM
    setTimeout(() => {
        curtain.remove();
    }, 1000);
})();

// Все карточки с классом "not-ready" показывают toast вместо перехода
document.querySelectorAll('.not-ready').forEach(card => {
    card.addEventListener('click', (e) => {
        e.preventDefault();
        showToast("Проект на стадии разработки...");
    });
});
