// ===== Анимация входа на главную страницу =====
// Стоит в самом начале файла: даже если ниже что-то сломается,
// шторка всё равно уберётся и сайт не останется чёрным.
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

// Модалка выбора компилятора (?. — не падаем, если элемента нет на странице)
openCompilerBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    compilerModal.classList.add('active');
});

// Закрытие по крестику
closeModalBtn?.addEventListener('click', () => {
    compilerModal.classList.remove('active');
});

// Закрытие по фону
compilerModal?.addEventListener('click', (e) => {
    if (e.target === compilerModal) {
        compilerModal.classList.remove('active');
    }
});

// Клик по карточке "soon"
soonCard?.addEventListener('click', () => {
    showToast("Скоро появятся новые проекты");
});

// ===== Поиск проектов =====
// Ищет по названию, автору и подписи справа. Карточки рисует firebase.js,
// поэтому после каждой перерисовки фильтр применяется заново.
const searchBox = document.getElementById('searchBox');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const searchEmpty = document.getElementById('searchEmpty');
const projectCardsBox = document.getElementById('projectCards');

function applySearch() {
    const query = searchInput.value.trim().toLowerCase();
    let found = 0;
    projectCardsBox.querySelectorAll('.project-card').forEach(card => {
        const text = [...card.querySelectorAll('.project-title, .project-author, .project-tag')]
            .map(el => el.textContent).join(' ').toLowerCase();
        const match = !query || text.includes(query);
        card.classList.toggle('search-hidden', !match);
        if (match) found++;
    });
    document.body.classList.toggle('searching', !!query);
    searchEmpty.hidden = !query || found > 0;
}

function closeSearch() {
    searchInput.value = '';
    searchBox.classList.remove('open');
    applySearch();
}

searchBtn?.addEventListener('click', () => {
    if (!searchBox.classList.contains('open')) {
        searchBox.classList.add('open');
        searchInput.focus();
    } else if (!searchInput.value) {
        closeSearch();
    } else {
        searchInput.focus();
    }
});

searchInput?.addEventListener('input', applySearch);
searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSearch();
});

if (projectCardsBox) {
    new MutationObserver(applySearch).observe(projectCardsBox, { childList: true });
}

// Все карточки с классом "not-ready" показывают toast вместо перехода
document.querySelectorAll('.not-ready').forEach(card => {
    card.addEventListener('click', (e) => {
        e.preventDefault();
        showToast("Проект на стадии разработки...");
    });
});
