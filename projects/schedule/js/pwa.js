// ===== Приложение на экране «Домой» =====
// Регистрирует service worker (sw.js) — он даёт работу без интернета и показывает уведомления.
// После загрузки страница отправляет ему список всех своих файлов, чтобы они попали в кэш
// уже с первого открытия. Ещё здесь — карточка с инструкцией «На экран Домой».

import { isStandalone, isIOS } from './notify.js?v=1';

export function initPwa() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', async () => {
            try {
                await navigator.serviceWorker.register('sw.js');
                const reg = await navigator.serviceWorker.ready;
                // шрифт и картинки могут догрузиться чуть позже — подождём
                setTimeout(() => {
                    const urls = [location.href.split('#')[0], ...performance.getEntriesByType('resource').map(e => e.name)];
                    reg.active?.postMessage({ type: 'cache-urls', urls });
                }, 1500);
            } catch (e) {
                /* без service worker сайт просто работает только с интернетом */
            }
        });
    }
    renderInstall();
}

// Если сайт уже открыт с экрана «Домой» — инструкция не нужна, показываем галочку
function renderInstall() {
    const steps = document.getElementById('installSteps');
    const done = document.getElementById('installDone');
    const hint = document.getElementById('installHint');
    if (!steps) return;
    const installed = isStandalone();
    steps.hidden = installed;
    done.hidden = !installed;
    // на Android и компьютере кнопка называется иначе
    if (!installed && !isIOS) {
        hint.textContent = 'На Android: меню ⋮ в Chrome → «Добавить на главный экран». Шаги ниже — для iPhone.';
        hint.hidden = false;
    }
}
