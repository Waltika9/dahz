// ==========================================
// ГЛУБОКИЙ БОЛЬНОЙ ✨
// Автор: Waltika
// Движок бота: собирает ответы, считает, ищет в Google.
// Сами ответы лежат в папке answers/ — по одному файлу на тему.
// Чтобы добавить тему: создай файл в answers/ и подключи его в index.html.
// ==========================================

const bot = new RiveScript({
    utf8: true
});

// ==========================================
// ВСТРОЕННЫЕ ФУНКЦИИ (<call>...</call> в ответах)
// ==========================================

const GOOGLE_MARK = '[[google]]';
let lastRawMessage = '';   // сообщение пользователя как есть (с точками и запятыми)

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

bot.setSubroutine('time', () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
bot.setSubroutine('date', () => new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s*г\.$/, ''));
bot.setSubroutine('weekday', () => WEEKDAYS[new Date().getDay()]);
bot.setSubroutine('year', () => String(new Date().getFullYear()));

// Калькулятор: превращаем «5 плюс 3 умножить на 2» в «5+3*2» и считаем
function calculate(text) {
    let expr = text.toLowerCase()
        .replace(/сколько будет|посчитай|вычисли|реши|сколько это|равно|=|\?/g, ' ')
        .replace(/умножить на|умножь на|умножить|умножь|помножить на|[x×х]/g, '*')
        .replace(/разделить на|поделить на|делить на|раздели на|подели на|÷|:/g, '/')
        .replace(/плюс/g, '+')
        .replace(/минус/g, '-')
        .replace(/,/g, '.');
    expr = expr.replace(/\s+/g, '');
    if (!/^[\d+\-*/().]+$/.test(expr) || !/\d/.test(expr) || !/[+\-*/]/.test(expr)) return null;
    try {
        const result = Function('"use strict"; return (' + expr + ')')();
        if (!isFinite(result)) return '∞';
        return String(Math.round(result * 1e10) / 1e10);
    } catch {
        return null;
    }
}

const CALC_REPLIES = [
    'Это {r}. Waltika бы посчитал быстрее, но он занят. 😎',
    'Получается {r}. Проверено процессором. 🧮',
    '{r}. Математика — единственное, в чём я уверен. ✨',
    'Ответ: {r}. Можешь не перепроверять. Хотя лучше перепроверь. 🗿'
];

bot.setSubroutine('calc', () => {
    const r = calculate(lastRawMessage);
    if (r === null) return GOOGLE_MARK;
    if (r === '∞') return 'На ноль делить нельзя! Даже я это знаю. 💥';
    return CALC_REPLIES[Math.floor(Math.random() * CALC_REPLIES.length)].replace('{r}', r);
});

// Загружаем мозг бота из всех файлов папки answers/
const answerFiles = window.DEEPSICK_ANSWERS || [];
answerFiles.forEach((text, i) => {
    try {
        bot.stream(text);
    } catch (e) {
        console.error('Ошибка в файле ответов №' + (i + 1), e);
    }
});
bot.sortReplies();
console.log(`Глубокий Больной ✨ готов! Файлов с ответами: ${answerFiles.length}`);

// ==========================================
// ОБЩЕНИЕ С БОТОМ
// Возвращает { text, google } — google: запрос для поиска или null
// ==========================================

const UNKNOWN_REPLIES = [
    'Хм, этого Waltika меня не научил. Спрошу у Google! 🔎',
    'Не знаю, что на это ответить. Зато знаю, кто знает — Google. 🔎',
    'Тут я бессилен. Перенаправляю в большую библиотеку интернета. 📚',
    'Интересный вопрос! Пусть на него ответит Google. 🔎'
];

// убираем «найди», «загугли» и т.п. из запроса для поиска
function cleanQuery(text) {
    return text.trim()
        .replace(/^(эй|слушай|бот|глубокий больной)[,\s]+/i, '')
        .replace(/^(загугли|погугли|найди мне|найди|поищи|ищи|поиск|покажи)\s+/i, '')
        .replace(/[?!.]+$/, '')
        .trim();
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// ==========================================
// ПАМЯТЬ: бот помнит собеседника даже после перезагрузки страницы
// (хранится только в этом браузере)
// ==========================================

const MEMORY_KEY = 'deepsick_memory';
const MEMORY_FIELDS = ['username', 'age', 'city', 'game', 'color', 'subject', 'food', 'hobby', 'pet', 'petname'];

async function loadMemory() {
    try {
        const saved = JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}');
        for (const [k, v] of Object.entries(saved)) await bot.setUservar('user', k, v);
    } catch { /* нет доступа к памяти браузера — ничего страшного */ }
}

async function saveMemory() {
    try {
        const vars = await bot.getUservars('user') || {};
        const data = {};
        MEMORY_FIELDS.forEach((k) => {
            if (vars[k] && vars[k] !== 'undefined') data[k] = vars[k];
        });
        localStorage.setItem(MEMORY_KEY, JSON.stringify(data));
    } catch { /* ничего страшного */ }
}

const memoryReady = loadMemory();

async function aboutMe() {
    const v = await bot.getUservars('user') || {};
    const has = (k) => v[k] && v[k] !== 'undefined';
    const cap = (s) => s.replace(/(^|[\s-])(\S)/g, (m, a, b) => a + b.toUpperCase());   // «алматы» → «Алматы»
    const facts = [];
    if (has('username')) facts.push(`тебя зовут ${cap(v.username)}`);
    if (has('age')) facts.push(`тебе ${v.age}`);
    if (has('city')) facts.push(`ты из ${cap(v.city)}`);
    if (has('game')) facts.push(`твоя любимая игра — ${cap(v.game)}`);
    if (has('subject')) facts.push(`любимый предмет — ${v.subject}`);
    if (has('color')) facts.push(`любимый цвет — ${v.color}`);
    if (has('food')) facts.push(`любимая еда — ${v.food}`);
    if (has('hobby')) facts.push(`ты увлекаешься: ${v.hobby}`);
    if (has('pet')) facts.push(`у тебя есть ${v.pet}` + (has('petname') ? ` по имени ${cap(v.petname)}` : ''));
    if (!facts.length) {
        return 'Пока ничего 🤷 Расскажи о себе! Например: «меня зовут …», «мне 16 лет», «я из …», «моя любимая игра …».';
    }
    return 'Вот что я о тебе знаю 🧠\n• ' + facts.join('\n• ') + '\n\nВсё это хранится только в твоём браузере. Напиши «забудь меня», чтобы стереть.';
}

async function forgetMe() {
    for (const k of MEMORY_FIELDS) await bot.setUservar('user', k, 'undefined');
    try { localStorage.removeItem(MEMORY_KEY); } catch { /* ничего страшного */ }
    return pick([
        'Готово. Я тебя забыл. Кто ты? Шучу, правда забыл. 🧹',
        'Память о тебе стёрта. Начнём знакомство заново? ✨'
    ]);
}

// ==========================================
// ЗАГАДКИ: проверка ответа
// ==========================================

const GIVE_UP = /^(сдаюсь|я сдаюсь|скажи ответ|какой ответ|ответ|не знаю|не знаю ответ|подскажи ответ|хз)[.!?\s]*$/i;
const RIDDLE_RIGHT = [
    'Правильно! 🎉 Ты гений. Почти как Waltika.',
    'Верно! 🏆 Хочешь ещё? Напиши «ещё загадку».',
    'Точно! ✨ Мой процессор аплодирует.',
    'Угадал! 🎯 С тобой опасно играть.'
];
const RIDDLE_WRONG = [
    'Не-а! 🙃 Попробуй ещё раз или напиши «сдаюсь».',
    'Мимо! 🤔 Подумай ещё. Или «сдаюсь».',
    'Не угадал, но мысль интересная. 😅 Ещё попытка?'
];
let riddleTries = 0;

const normalize = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

async function checkRiddle(message) {
    const ans = await bot.getUservar('user', 'riddleans');
    if (!ans || ans === 'undefined') return null;
    const show = await bot.getUservar('user', 'riddleshow');

    const finish = async () => {
        riddleTries = 0;
        await bot.setUservar('user', 'riddleans', 'undefined');
    };

    if (GIVE_UP.test(message.trim())) {
        await finish();
        return `Ответ: ${show}! 💡 Ничего, в следующий раз угадаешь. Напиши «ещё загадку».`;
    }

    // длинное сообщение или вопрос — человек, видимо, сменил тему
    const msg = normalize(message);
    if (msg.split(' ').length > 4 || message.includes('?')) {
        await finish();
        return null;
    }

    const variants = ans.split('/').map(normalize);
    if (variants.some((v) => v && (` ${msg} `).includes(` ${v}`))) {
        await finish();
        return pick(RIDDLE_RIGHT);
    }

    riddleTries++;
    if (riddleTries >= 3) {
        await finish();
        return `Три попытки — и мимо 😅 Правильный ответ: ${show}. Напиши «ещё загадку», если хочешь реванш!`;
    }
    return pick(RIDDLE_WRONG);
}

async function askDeepSick(message) {
    await memoryReady;
    lastRawMessage = message;

    // просто пример вроде «12*3» или «5 + 5» — сразу считаем
    if (/^[\d\s+\-*/().,x×÷:=?]+$/i.test(message) && /\d\s*[+\-*/x×÷:]\s*\d/i.test(message)) {
        const r = calculate(message);
        if (r !== null) {
            return { text: r === '∞' ? 'На ноль делить нельзя! 💥' : pick(CALC_REPLIES).replace('{r}', r), google: null };
        }
    }

    try {
        // если сейчас идёт загадка — сначала проверяем ответ
        const riddleReply = await checkRiddle(message);
        if (riddleReply) return { text: riddleReply, google: null };

        let reply = await bot.reply('user', message);
        const trigger = await bot.lastMatch('user');
        saveMemory();

        // «что ты обо мне знаешь» и «забудь меня»
        if (reply.includes('[[aboutme]]')) return { text: await aboutMe(), google: null };
        if (reply.includes('[[forgetme]]')) return { text: await forgetMe(), google: null };

        // новая загадка — обнуляем счётчик попыток
        if (/riddle|загад/i.test(trigger)) riddleTries = 0;

        // бот сам решил искать в Google
        if (reply.includes(GOOGLE_MARK)) {
            const text = reply.replace(GOOGLE_MARK, '').trim() || UNKNOWN_REPLIES[0];
            return { text, google: cleanQuery(message) };
        }

        // бот не нашёл подходящего ответа — ищем в Google, если в сообщении есть слова
        const letters = (message.match(/[a-zа-яё0-9]/gi) || []).length;
        if (trigger === '*' && letters >= 3) {
            return { text: UNKNOWN_REPLIES[Math.floor(Math.random() * UNKNOWN_REPLIES.length)], google: cleanQuery(message) };
        }

        return { text: reply, google: null };
    } catch (e) {
        return { text: 'Упс, произошла ошибка в коде бота...', google: null };
    }
}

// Экспортируем функцию для интерфейса
window.DeepSick = {
    ask: askDeepSick
};
