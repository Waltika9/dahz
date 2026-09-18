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