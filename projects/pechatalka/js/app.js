// ===== Главный модуль приложения Печаталка =====
import { VirtualKeyboard } from './keyboard.js?v=7';
import { Typer } from './typer.js?v=4';
import { toggleSound, isSoundEnabled } from './sound.js?v=2';
import { getIcon } from './pixel.js?v=9';
import { RU_LESSONS, EN_LESSONS, getUnlockedLessons, saveLessonProgress } from './lessons.js?v=3';
import { RU_TEXTS, EN_TEXTS, shuffled } from './texts.js?v=3';
import { loadData, recordSession, resetAllData, drawPixelGraph } from './stats.js?v=2';
import { isWrongLayoutChar } from './layouts.js?v=1';

document.addEventListener('DOMContentLoaded', () => {
    // Контейнеры
    const kbSection = document.querySelector('.keyboard-section');
    const kbContainer = document.getElementById('kb-container');
    const handsEl = document.getElementById('hands');
    const fingerHintContainer = document.getElementById('finger-hint-container');
    const displayEl = document.getElementById('typer-text');
    const graphCanvas = document.getElementById('graph-canvas');

    // Кнопки режимов
    const tabLessons = document.getElementById('tab-mode-lessons');
    const tabText = document.getElementById('tab-mode-text');
    const tabTest = document.getElementById('tab-mode-test');

    // Карта уроков
    const lessonsContainer = document.getElementById('lessons-container');
    const lessonsGrid = document.getElementById('lessons-grid');
    const lessonsTitleText = document.getElementById('lessons-title-text');
    const lessonsDescText = document.getElementById('lessons-desc-text');

    // Контролы
    const homeBtn = document.getElementById('home-btn');
    const soundBtn = document.getElementById('sound-btn');
    const soundIconEl = document.getElementById('sound-icon');
    const layoutRuBtn = document.getElementById('btn-layout-ru');
    const layoutEnBtn = document.getElementById('btn-layout-en');
    const modeStopBtn = document.getElementById('btn-mode-stop');
    const restartBtn = document.getElementById('btn-restart');
    const toggleKbBtn = document.getElementById('btn-toggle-kb');
    const toggleKbIcon = document.getElementById('toggle-kb-icon');
    const toggleKbLabel = document.getElementById('toggle-kb-label');
    const btnResetData = document.getElementById('btn-reset-data');

    // Статистика и таймер
    const statItemTimer = document.getElementById('stat-item-timer');
    const statTimer = document.getElementById('stat-timer');
    const statCpm = document.getElementById('stat-cpm');
    const statWpm = document.getElementById('stat-wpm');
    const statAcc = document.getElementById('stat-acc');
    const statErr = document.getElementById('stat-err');

    // Модальные окна
    const modalMismatch = document.getElementById('modal-mismatch');
    const modalMismatchClose = document.getElementById('modal-mismatch-close');
    const modalMismatchLayoutName = document.getElementById('mismatch-layout-name');
    const modalIconWarning = document.getElementById('modal-icon-warning');

    const modalPause = document.getElementById('modal-pause');
    const modalPauseResume = document.getElementById('modal-pause-resume');

    const modalResult = document.getElementById('modal-result');
    const resultTitle = document.getElementById('result-title');
    const resultDesc = document.getElementById('result-desc');
    const resCpm = document.getElementById('res-cpm');
    const resWpm = document.getElementById('res-wpm');
    const resAcc = document.getElementById('res-acc');
    const resErr = document.getElementById('res-err');
    const resultRecordBanner = document.getElementById('result-record-banner');
    const resultBtnNext = document.getElementById('result-btn-next');
    const resultBtnRepeat = document.getElementById('result-btn-repeat');

    const modalConfirmReset = document.getElementById('modal-confirm-reset');
    const btnConfirmResetYes = document.getElementById('btn-confirm-reset-yes');
    const btnConfirmResetNo = document.getElementById('btn-confirm-reset-no');

    // Мобильная заглушка
    const mobileBlocker = document.getElementById('mobile-blocker');
    const mobileContinueBtn = document.getElementById('mobile-continue-btn');

    // Проверка мобильного устройства (сенсорный экран смартфона без клавиатуры)
    function checkMobileDevice() {
        const isMobileUserAgent = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        const isSmallScreen = window.innerWidth <= 600;
        
        // Показываем заглушку только на реальных смартфонах без клавиатуры
        if (isMobileUserAgent && isTouch && isSmallScreen && !sessionStorage.getItem('pechatalka_has_keyboard')) {
            if (mobileBlocker) mobileBlocker.hidden = false;
        } else {
            if (mobileBlocker) mobileBlocker.hidden = true;
        }
    }
    checkMobileDevice();

    if (mobileContinueBtn) {
        mobileContinueBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            sessionStorage.setItem('pechatalka_has_keyboard', '1');
            if (mobileBlocker) {
                mobileBlocker.hidden = true;
                mobileBlocker.style.display = 'none';
            }
        });
    }

    // Иконки
    if (homeBtn) homeBtn.innerHTML = getIcon('home', 18);
    if (restartBtn) restartBtn.prepend(document.createRange().createContextualFragment(getIcon('repeat', 16) + ' '));
    if (modalIconWarning) modalIconWarning.innerHTML = getIcon('warning', 24);
    document.querySelectorAll('[data-icon]').forEach(el => {
        el.innerHTML = getIcon(el.dataset.icon, Number(el.dataset.size) || 20);
    });

    function updateSoundIcon() {
        if (soundIconEl) {
            soundIconEl.innerHTML = isSoundEnabled() ? getIcon('soundOn', 20) : getIcon('soundOff', 20);
        }
    }
    updateSoundIcon();

    // Загрузка сохранённых данных
    let store = loadData();

    // Инициализация клавиатуры с оверлеем рук и тепловой картой
    const keyboard = new VirtualKeyboard(kbContainer, handsEl, fingerHintContainer);
    keyboard.applyHeatmap(store.heatmap);

    // Отрисовка графика при старте
    function updateGraph() {
        if (graphCanvas) {
            drawPixelGraph(graphCanvas, store.history);
        }
    }
    updateGraph();
    // Перерисовка: когда загрузится пиксельный шрифт и когда меняется ширина окна
    if (document.fonts) document.fonts.ready.then(updateGraph);
    window.addEventListener('resize', updateGraph);

    // Видимость клавиатуры
    let isKeyboardVisible = true;
    function updateKeyboardVisibilityUI() {
        if (isKeyboardVisible) {
            kbSection.classList.remove('is-hidden');
            if (toggleKbIcon) toggleKbIcon.innerHTML = getIcon('eyeOff', 16);
            if (toggleKbLabel) toggleKbLabel.textContent = 'СКРЫТЬ КЛАВ.';
        } else {
            kbSection.classList.add('is-hidden');
            if (toggleKbIcon) toggleKbIcon.innerHTML = getIcon('eye', 16);
            if (toggleKbLabel) toggleKbLabel.textContent = 'ПОКАЗАТЬ КЛАВ.';
        }
    }
    updateKeyboardVisibilityUI();

    if (toggleKbBtn) {
        toggleKbBtn.addEventListener('click', () => {
            isKeyboardVisible = !isKeyboardVisible;
            updateKeyboardVisibilityUI();
        });
    }

    // Состояние
    let currentMode = 'lessons'; // 'lessons' | 'text' | 'test'
    let currentLayout = 'ru';
    let currentLessonId = 1;
    let stopOnError = true;

    // Уроки текущей раскладки и последний открытый урок
    const lessonsOf = layout => (layout === 'ru' ? RU_LESSONS : EN_LESSONS);
    const lastOpenLesson = layout => Math.min(getUnlockedLessons(layout), lessonsOf(layout).length);
    currentLessonId = lastOpenLesson(currentLayout);

    // Инициализация Тайпера
    const typer = new Typer({
        displayEl,
        keyboard,
        onCharTyped: () => {
            updateLiveStats();
        },
        onTick: (remainingSec) => {
            if (statTimer) statTimer.textContent = remainingSec;
        },
        onComplete: (stats) => {
            handleComplete(stats);
        },
        onLayoutMismatch: (requiredLayout) => {
            showLayoutMismatchModal(requiredLayout);
        }
    });

    function updateLiveStats() {
        const stats = typer.getStats();
        if (statCpm) statCpm.textContent = stats.cpm;
        if (statWpm) statWpm.textContent = stats.wpm;
        if (statAcc) statAcc.textContent = `${stats.accuracy}%`;
        if (statErr) statErr.textContent = stats.errors;
    }

    function renderLessonsGrid() {
        const lessons = currentLayout === 'ru' ? RU_LESSONS : EN_LESSONS;
        const maxUnlocked = getUnlockedLessons(currentLayout);

        lessonsGrid.innerHTML = '';
        lessons.forEach(l => {
            const isLocked = l.id > maxUnlocked;
            const isActive = l.id === currentLessonId;

            const card = document.createElement('div');
            card.className = `lesson-card ${isActive ? 'is-active' : ''} ${isLocked ? 'is-locked' : ''}`;
            card.setAttribute('data-id', l.id);

            const iconLock = isLocked ? getIcon('lock', 12) : (l.id < maxUnlocked ? getIcon('check', 12) : '');

            card.innerHTML = `
                <div class="lesson-card-num">${l.id}</div>
                <div>${iconLock}</div>
            `;

            if (!isLocked) {
                card.addEventListener('click', () => {
                    currentLessonId = l.id;
                    renderLessonsGrid();
                    startExercise();
                });
            }

            lessonsGrid.appendChild(card);
        });

        const activeLesson = lessons.find(l => l.id === currentLessonId) || lessons[0];
        if (lessonsTitleText) lessonsTitleText.textContent = activeLesson.title;
        if (lessonsDescText) lessonsDescText.textContent = activeLesson.desc;
    }

    function startExercise() {
        if (modalResult) modalResult.hidden = true;
        if (modalPause) modalPause.hidden = true;
        // Убираем фокус с нажатой кнопки: иначе пробел «нажмёт» её снова
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

        let textToType = '';
        let timeLimit = 0;

        if (currentMode === 'lessons') {
            lessonsContainer.hidden = false;
            statItemTimer.hidden = true;
            renderLessonsGrid();
            const lessons = currentLayout === 'ru' ? RU_LESSONS : EN_LESSONS;
            const lesson = lessons.find(l => l.id === currentLessonId) || lessons[0];
            textToType = lesson.generate();
        } else if (currentMode === 'text') {
            lessonsContainer.hidden = true;
            statItemTimer.hidden = true;
            const texts = currentLayout === 'ru' ? RU_TEXTS : EN_TEXTS;
            textToType = texts[Math.floor(Math.random() * texts.length)];
        } else if (currentMode === 'test') {
            lessonsContainer.hidden = true;
            statItemTimer.hidden = false;
            if (statTimer) statTimer.textContent = '60';
            timeLimit = 60;
            // Все фразы в случайном порядке — за минуту текст не кончится
            const texts = currentLayout === 'ru' ? RU_TEXTS : EN_TEXTS;
            textToType = shuffled(texts).join(' ');
        }

        typer.setText(textToType, currentLayout, stopOnError, timeLimit);
        updateLiveStats();
    }

    function handleComplete(stats) {
        if (!modalResult) return;

        // Сохраняем сессию в localStorage и обновляем тепловую карту
        const recResult = recordSession({
            cpm: stats.cpm,
            wpm: stats.wpm,
            accuracy: stats.accuracy,
            errors: stats.errors,
            mode: currentMode,
            layout: currentLayout
        }, stats.errorCodes);

        store = recResult.data;
        keyboard.applyHeatmap(store.heatmap);
        updateGraph();

        if (resCpm) resCpm.textContent = stats.cpm;
        if (resWpm) resWpm.textContent = stats.wpm;
        if (resAcc) resAcc.textContent = `${stats.accuracy}%`;
        if (resErr) resErr.textContent = stats.errors;

        if (resultRecordBanner) {
            resultRecordBanner.hidden = !recResult.isRecord;
        }

        if (currentMode === 'lessons') {
            const isPassed = stats.accuracy >= 95;
            if (isPassed) {
                resultTitle.textContent = 'УРОК ПРОЙДЕН! ★';
                resultDesc.textContent = 'Отличная точность! Следующий урок разблокирован.';
                saveLessonProgress(currentLayout, currentLessonId);
                resultBtnNext.hidden = false;
            } else {
                resultTitle.textContent = 'ПОПРОБУЙ ЕЩЁ РАЗ';
                resultDesc.textContent = 'Для открытия следующего урока нужна точность не ниже 95%.';
                resultBtnNext.hidden = true;
            }
        } else if (currentMode === 'text') {
            resultTitle.textContent = 'ТЕКСТ ЗАВЕРШЁН!';
            resultDesc.textContent = 'Прекрасная тренировка ритма и беглости.';
            resultBtnNext.hidden = false;
        } else if (currentMode === 'test') {
            resultTitle.textContent = 'ТЕСТ 1 МИНУТА ЗАВЕРШЁН!';
            resultDesc.textContent = `Твой результат: ${stats.cpm} знаков/мин (${stats.wpm} WPM).`;
            resultBtnNext.hidden = true;
        }

        modalResult.hidden = false;
    }

    // Обработчики кнопок модалки результата
    if (resultBtnNext) {
        resultBtnNext.addEventListener('click', () => {
            modalResult.hidden = true;
            if (currentMode === 'lessons' && currentLessonId < lastOpenLesson(currentLayout)) {
                currentLessonId++;
            }
            startExercise();
        });
    }

    if (resultBtnRepeat) {
        resultBtnRepeat.addEventListener('click', () => {
            modalResult.hidden = true;
            startExercise();
        });
    }

    // Режимы
    function setMode(mode) {
        currentMode = mode;
        [tabLessons, tabText, tabTest].forEach(b => b.classList.remove('is-active'));
        if (mode === 'lessons') tabLessons.classList.add('is-active');
        if (mode === 'text') tabText.classList.add('is-active');
        if (mode === 'test') tabTest.classList.add('is-active');
        startExercise();
    }

    if (tabLessons) tabLessons.addEventListener('click', () => setMode('lessons'));
    if (tabText) tabText.addEventListener('click', () => setMode('text'));
    if (tabTest) tabTest.addEventListener('click', () => setMode('test'));

    // Раскладки
    if (layoutRuBtn && layoutEnBtn) {
        layoutRuBtn.addEventListener('click', () => {
            currentLayout = 'ru';
            currentLessonId = lastOpenLesson('ru');
            layoutRuBtn.classList.add('is-active');
            layoutEnBtn.classList.remove('is-active');
            startExercise();
        });

        layoutEnBtn.addEventListener('click', () => {
            currentLayout = 'en';
            currentLessonId = lastOpenLesson('en');
            layoutEnBtn.classList.add('is-active');
            layoutRuBtn.classList.remove('is-active');
            startExercise();
        });
    }

    // Режим «Стоп на ошибке»
    if (modeStopBtn) {
        modeStopBtn.addEventListener('click', () => {
            stopOnError = !stopOnError;
            modeStopBtn.textContent = stopOnError ? 'РЕЖИМ: СТОП НА ОШИБКЕ' : 'РЕЖИМ: СВОБОДНЫЙ (BACKSPACE)';
            startExercise();
        });
    }

    // Звук
    if (soundBtn) {
        soundBtn.addEventListener('click', () => {
            toggleSound();
            updateSoundIcon();
        });
    }

    // Перезапуск
    if (restartBtn) {
        restartBtn.addEventListener('click', () => {
            startExercise();
        });
    }

    // Сброс данных
    if (btnResetData) {
        btnResetData.addEventListener('click', () => {
            if (modalConfirmReset) modalConfirmReset.hidden = false;
        });
    }

    if (btnConfirmResetNo) {
        btnConfirmResetNo.addEventListener('click', () => {
            if (modalConfirmReset) modalConfirmReset.hidden = true;
        });
    }

    if (btnConfirmResetYes) {
        btnConfirmResetYes.addEventListener('click', () => {
            resetAllData();
            store = loadData();
            currentLessonId = 1;
            keyboard.applyHeatmap({});
            updateGraph();
            if (modalConfirmReset) modalConfirmReset.hidden = true;
            startExercise();
        });
    }

    // Модалка раскладки
    function showLayoutMismatchModal(reqLayout) {
        if (!modalMismatch) return;
        const name = reqLayout === 'ru' ? 'РУССКУЮ' : 'АНГЛИЙСКУЮ';
        if (modalMismatchLayoutName) modalMismatchLayoutName.textContent = name;
        modalMismatch.hidden = false;
    }

    function closeMismatchModal() {
        if (modalMismatch) modalMismatch.hidden = true;
    }

    if (modalMismatchClose) {
        modalMismatchClose.addEventListener('click', closeMismatchModal);
    }

    // Пауза (Esc)
    function togglePause() {
        if (!typer.isActive) return;
        const paused = typer.togglePause();
        if (modalPause) {
            modalPause.hidden = !paused;
        }
    }

    if (modalPauseResume) {
        modalPauseResume.addEventListener('click', () => {
            togglePause();
        });
    }

    // Горячие клавиши
    let isTabPressed = false;

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            isTabPressed = true;
            e.preventDefault(); // Tab не уводит фокус на кнопки
        }

        // Tab + Enter — заново
        if (isTabPressed && e.key === 'Enter') {
            e.preventDefault();
            startExercise();
            return;
        }

        // Esc
        if (e.key === 'Escape') {
            e.preventDefault();
            if (modalConfirmReset && !modalConfirmReset.hidden) {
                modalConfirmReset.hidden = true;
            } else if (modalMismatch && !modalMismatch.hidden) {
                closeMismatchModal();
            } else if (modalResult && !modalResult.hidden) {
                modalResult.hidden = true;
                startExercise();
            } else {
                togglePause();
            }
            return;
        }

        // Окно сброса открыто — клавиатура не печатает
        if (modalConfirmReset && !modalConfirmReset.hidden) return;

        // Окно результата: Enter — следующий (или заново)
        if (modalResult && !modalResult.hidden) {
            if (e.key === 'Enter') {
                e.preventDefault();
                (resultBtnNext.hidden ? resultBtnRepeat : resultBtnNext).click();
            }
            return;
        }

        // Если открыто предупреждение раскладки
        if (modalMismatch && !modalMismatch.hidden) {
            if (e.key === 'Enter' || e.key === ' ') {
                closeMismatchModal();
                e.preventDefault();
                return;
            }
            // Раскладку переключили и печатают дальше — окно закрывается само
            if (e.key.length === 1 && !isWrongLayoutChar(e.key, currentLayout)) {
                closeMismatchModal();
            }
        }

        // Физическое вдавливание клавиши
        keyboard.pressKey(e.code);

        // Ввод в тайпер
        typer.handleKeyDown(e);
    });

    window.addEventListener('keyup', (e) => {
        if (e.key === 'Tab') {
            isTabPressed = false;
        }
        keyboard.releaseKey(e.code);
    });

    // Запуск
    startExercise();
});
