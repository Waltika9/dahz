const loginBtn = document.getElementById('loginBtn');
const toast = document.getElementById('toast');
const compilerModal = document.getElementById('compilerModal');
const openCompilerBtn = document.getElementById('openCompilerBtn');
const closeModalBtn = document.getElementById('closeModalBtn');
const htmlCompBtn = document.getElementById('htmlCompBtn');
const soonCard = document.getElementById('soonCard');

let toastTimeout;

function showToast(message) {
    clearTimeout(toastTimeout);
    toast.textContent = message;
    toast.classList.add('show');
    toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Авторизация
loginBtn.addEventListener('click', () => {
    showToast("Вход и авторизация временно недоступны");
});

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
        showToast("Этот проект пока находится в разработке");
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
    }, 250);

    // Свечение дошло до краёв — плавно убираем шторку
    setTimeout(() => {
        curtain.classList.add('done');
        document.body.classList.remove('intro-locked');
    }, 1700);

    // Полностью удаляем элемент из DOM
    setTimeout(() => {
        curtain.remove();
    }, 2100);
})();
