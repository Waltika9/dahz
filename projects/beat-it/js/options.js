// Опции уровня (как моды в osu). Запоминаются в браузере и действуют на все уровни

const KEY = 'beatit_options';

export const OPTIONS = [
    { id: 'auto', name: 'Авто', text: 'Уровень проходится сам — можно просто смотреть' },
    { id: 'nofail', name: 'Без проигрыша', text: 'Даже без здоровья уровень доиграется до конца' },
    { id: 'hidden', name: 'Скрытые ноты', text: 'Ноты исчезают, не долетев до круга' },
    { id: 'nobg', name: 'Без фона', text: 'Вместо картинки или видео уровня — просто чёрный фон' },
    { id: 'noflash', name: 'Без мигания', text: 'Экран не вспыхивает и не трясётся' },
    { id: 'nofx', name: 'Без эффектов', text: 'Без волн, звёздочек, линий и конфетти' },
    { id: 'nosfx', name: 'Без звуков', text: 'Без щелчков при попадании и звуков на дропах (музыка останется)' }
];

let state = {};
try {
    state = JSON.parse(localStorage.getItem(KEY)) || {};
} catch (e) { /* хранилище недоступно — все опции выключены */ }

function save() {
    try {
        localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) { /* не запомнится, но работать будет */ }
}

// { auto: true, nofail: false, … }
export function getOptions() {
    const o = {};
    for (const opt of OPTIONS) o[opt.id] = state[opt.id] === true;
    return o;
}

// Включённые опции (для значков на карточке, в игре и на результате)
export function activeOptions() {
    return OPTIONS.filter(o => state[o.id] === true);
}

const modal = document.getElementById('optionsModal');
const list = document.getElementById('optionsList');
let changed = () => {};

// Окно опций; onChange — после каждого переключения
export function openOptions(onChange) {
    changed = onChange;
    list.innerHTML = OPTIONS.map(o => `
        <button class="opt${state[o.id] ? ' is-on' : ''}" type="button" data-id="${o.id}" aria-pressed="${state[o.id] === true}">
            <span class="opt-text"><b>${o.name}</b><small>${o.text}</small></span>
            <span class="switch"><i></i></span>
        </button>`).join('');
    modal.classList.add('is-open');
}

export function closeOptions() {
    if (!modal.classList.contains('is-open')) return false;
    modal.classList.remove('is-open');
    return true;
}

list.addEventListener('click', e => {
    const btn = e.target.closest('.opt');
    if (!btn) return;
    const id = btn.dataset.id;
    state[id] = !state[id];
    btn.classList.toggle('is-on', state[id]);
    btn.setAttribute('aria-pressed', state[id]);
    save();
    changed();
});

document.getElementById('optionsReset').addEventListener('click', () => {
    state = {};
    save();
    list.querySelectorAll('.opt').forEach(btn => {
        btn.classList.remove('is-on');
        btn.setAttribute('aria-pressed', 'false');
    });
    changed();
});

document.getElementById('optionsClose').addEventListener('click', closeOptions);
modal.addEventListener('click', e => {
    if (e.target === modal) closeOptions();
});
