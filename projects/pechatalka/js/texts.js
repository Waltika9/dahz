// ===== Словари и генератор текстов для тренировки =====
// Слова для уроков берутся из общего словаря: урок выбирает только те,
// в которых есть лишь уже пройденные буквы.

// Set убирает повторы, чтобы одно слово не попадалось чаще других
export const RU_DICT = [...new Set([
    // Простые короткие слова
    'сын', 'дочь', 'тут', 'там', 'вот', 'кто', 'что', 'мой', 'твой', 'свой', 'наш', 'ваш', 'его', 'они',
    'мы', 'вы', 'ты', 'кот', 'кит', 'мак', 'сад', 'лес', 'дом', 'сок', 'суп', 'мёд', 'сыр', 'нос',
    'рот', 'ухо', 'лоб', 'шея', 'спина', 'палец', 'мяч', 'игра', 'урок', 'класс', 'парта', 'доска',
    'мел', 'ручка', 'пенал', 'лампа', 'окно', 'пол', 'стена', 'двор', 'мир', 'сон', 'тон', 'ток',
    // Домашний ряд: ФЫВА ОЛДЖ
    'да', 'до', 'во', 'ад', 'ода', 'оды', 'вал', 'дал', 'лад', 'жал', 'вол', 'дол', 'лов', 'фол',
    'выл', 'выла', 'дала', 'ждал', 'ждала', 'вода', 'воды', 'лава', 'лавы', 'волы', 'овал',
    'жало', 'ложа', 'вдова', 'довод',
    // + П Р
    'пар', 'пол', 'пора', 'пара', 'рад', 'ров', 'вор', 'драл', 'правда', 'опора', 'прав', 'право',
    'вправо', 'провал', 'пропал', 'порвал', 'оправа', 'подвал', 'парад', 'жар', 'жара', 'пожар',
    'плов', 'плод', 'прорыв', 'двор',
    // + Е Н
    'он', 'она', 'оно', 'на', 'не', 'но', 'нож', 'жена', 'пена', 'вена', 'перо', 'дно', 'лед', 'род',
    'народ', 'рано', 'ровно', 'поле', 'полено', 'волна', 'ворона', 'водопад', 'вперед', 'надежда',
    'одежда', 'нерв', 'пенал', 'рана', 'давно', 'ладно', 'небо',
    // + К Г
    'как', 'кого', 'когда', 'где', 'год', 'гора', 'голова', 'окно', 'дорога', 'кожа', 'гонка',
    'ковер', 'новое', 'лодка', 'дракон', 'горка', 'колено', 'порог', 'вагон', 'кадр', 'голод',
    'город', 'немного', 'парк', 'ноготь',
    // + У Ш
    'ну', 'душа', 'наша', 'ваша', 'шар', 'шаг', 'шапка', 'каша', 'лужа', 'кукла', 'дуга', 'рука',
    'нога', 'урок', 'пушка', 'кошка', 'дружок', 'подушка', 'дорожка', 'ушко', 'уголок', 'шкаф',
    'друг', 'круг', 'внук', 'лук', 'жук', 'паук', 'шорох', 'шаровар',
    // + Ц Щ
    'цена', 'овца', 'щука', 'щека', 'плащ', 'еще', 'щенок', 'огурец', 'певец', 'конец', 'лещ',
    'щедро', 'щегол', 'овцы', 'пуговица', 'улица',
    // + Й З Х Ъ
    'хор', 'ход', 'край', 'зной', 'подъезд', 'въезд', 'звук', 'звезда', 'запах', 'заход',
    'здоровый', 'хороший', 'холодно', 'война', 'завод', 'газ', 'раз', 'глаз', 'зеркало', 'заказ',
    'узор', 'поход', 'подход', 'орех', 'кузов', 'подъем', 'зайка', 'дерево', 'захожу',
    // + М И Т Ь
    'мир', 'мама', 'тема', 'тьма', 'день', 'конь', 'мать', 'дети', 'книга', 'тетрадь', 'пить',
    'жить', 'идти', 'ответ', 'утро', 'лето', 'мотор', 'минута', 'ракета', 'планета', 'кит', 'кот',
    'том', 'тигр', 'тень', 'лень', 'пень', 'хитрый', 'мимо', 'итог', 'игра', 'интерес', 'ветер',
    'мотив', 'пример', 'дом', 'труд', 'море', 'гитара', 'метро',
    // + С Б
    'собака', 'сосна', 'стол', 'снег', 'сон', 'сок', 'нос', 'бок', 'бег', 'бумага', 'брат', 'сестра',
    'хлеб', 'рыба', 'зуб', 'баран', 'свет', 'сила', 'слово', 'спорт', 'стена', 'бабушка', 'автобус',
    'обед', 'ребенок', 'работа', 'борщ', 'зебра', 'бобр', 'сумка', 'скоро', 'сразу', 'сыр', 'место',
    'мост', 'мысль', 'страна', 'школа', 'класс', 'кнопка', 'буква', 'текст', 'строка', 'скорость',
    'точность', 'ошибка', 'вопрос', 'сторона', 'история', 'музыка', 'футбол', 'команда', 'улица',
    'солнце', 'облако', 'дождь', 'осень', 'весна', 'неделя', 'суп', 'сад', 'лес', 'песок',
    // + Ч Ю
    'чай', 'час', 'часы', 'ночь', 'речь', 'ключ', 'юла', 'юг', 'люди', 'чудо', 'плечо', 'учитель',
    'юмор', 'ручка', 'туча', 'ручей', 'вечер', 'утюг', 'юбка', 'ночью', 'число', 'человек', 'ученик',
    'компьютер', 'клавиатура', 'пальчик', 'чистота', 'журнал', 'юность',
    // + Я Э Ё
    'я', 'моя', 'твоя', 'семья', 'земля', 'время', 'имя', 'мясо', 'яблоко', 'яма', 'пять', 'тётя',
    'ёж', 'ёлка', 'лёд', 'мёд', 'это', 'эхо', 'этаж', 'поэт', 'экран', 'язык', 'ящик', 'заяц',
    'ёжик', 'всё', 'ещё', 'звёзды', 'месяц', 'программа', 'задача', 'лошадь', 'корова', 'молоко',
    'птица', 'озеро', 'река', 'трава', 'цветок', 'груша', 'слива', 'зима', 'дверь', 'окно', 'стул',
    // Длинные слова
    'здравствуйте', 'путешествие', 'приключение', 'библиотека', 'фотография', 'холодильник',
    'велосипед', 'мороженое', 'электричка', 'самолёт', 'черепаха', 'крокодил', 'шоколад',
    'математика', 'информатика', 'география', 'литература', 'расписание', 'перемена', 'каникулы',
    'объявление', 'съёмка', 'подъёмник', 'щёлкать', 'цыплёнок', 'экзамен', 'юбилей', 'жёлудь'
])];

export const EN_DICT = [...new Set([
    // Simple short words
    'cat', 'dog', 'sun', 'run', 'fun', 'big', 'red', 'hot', 'pen', 'cup', 'bed', 'box', 'hat', 'map',
    'bus', 'car', 'day', 'way', 'say', 'see', 'eat', 'sit', 'top', 'yes', 'no', 'go', 'do', 'we',
    'me', 'be', 'he', 'up', 'in', 'on', 'at', 'to', 'it', 'so', 'my', 'by', 'and', 'you', 'are',
    // Home row: ASDF JKL
    'as', 'ask', 'asks', 'all', 'fall', 'falls', 'sad', 'lad', 'lads', 'dad', 'dads', 'add', 'adds',
    'flask', 'salad', 'alas', 'lass', 'fad', 'fads', 'salsa', 'alfalfa', 'flasks', 'ads',
    // + G H
    'has', 'had', 'half', 'hall', 'halls', 'glass', 'flash', 'dash', 'gash', 'shall', 'hash', 'lash',
    'sash', 'flag', 'flags', 'glad', 'gas', 'hag', 'jag', 'shag',
    // + R U
    'rug', 'rush', 'hurl', 'surf', 'dull', 'full', 'gull', 'hull', 'lard', 'hard', 'shard', 'drag',
    'rag', 'sugar', 'slur', 'jar', 'far', 'guard', 'us', 'ash', 'rash', 'drug', 'hug', 'jug', 'hula',
    // + E I
    'red', 'see', 'she', 'here', 'hire', 'fire', 'idea', 'side', 'ride', 'like', 'life', 'file', 'fees',
    'free', 'rule', 'sure', 'ideal', 'legal', 'read', 'real', 'deal', 'seal', 'said', 'field', 'glide',
    'fish', 'dish', 'high', 'hike', 'kid', 'lid', 'his', 'is', 'he', 'fridge', 'jeans',
    // + T Y
    'the', 'that', 'they', 'yes', 'yet', 'try', 'tree', 'true', 'test', 'data', 'stay', 'today',
    'light', 'right', 'eight', 'style', 'still', 'start', 'their', 'there', 'these', 'year', 'easy',
    'tiger', 'yard', 'sky', 'its', 'list', 'type', 'typist', 'faster',
    // + W O
    'two', 'who', 'how', 'word', 'work', 'world', 'wood', 'water', 'show', 'slow', 'follow', 'door',
    'food', 'good', 'told', 'tower', 'yellow', 'flower', 'allow', 'wise', 'write', 'white', 'worth',
    'look', 'old', 'road', 'story', 'house', 'shoe', 'water', 'wolf',
    // + Q P
    'quiet', 'quote', 'power', 'paper', 'pupil', 'quest', 'equip', 'poetry', 'quite', 'queue', 'top',
    'put', 'tip', 'pot', 'pure', 'root', 'route', 'group', 'sport', 'shop', 'paw', 'prize',
    // + V M
    'move', 'very', 'view', 'more', 'most', 'mother', 'home', 'time', 'movie', 'love', 'live', 'five',
    'give', 'have', 'room', 'make', 'mile', 'small', 'summer', 'map', 'many', 'music', 'game', 'smile',
    // + B N
    'bring', 'begin', 'number', 'best', 'blue', 'bank', 'brown', 'been', 'but', 'one', 'now', 'night',
    'run', 'sun', 'moon', 'lesson', 'finger', 'friend', 'garden', 'morning', 'evening', 'banana',
    'bread', 'bird', 'big', 'bag', 'green', 'planet', 'mountain', 'river', 'winter', 'spring',
    // + C , X . Z /
    'can', 'code', 'clean', 'cat', 'call', 'city', 'school', 'music', 'space', 'pixel', 'screen',
    'computer', 'practice', 'keyboard', 'box', 'fox', 'six', 'next', 'exit', 'example', 'text', 'taxi',
    'zero', 'lazy', 'size', 'zone', 'puzzle', 'pizza', 'quick', 'black', 'jump', 'cheese', 'coffee',
    'apple', 'orange', 'people', 'forest', 'autumn', 'horse', 'dog', 'mouse', 'program', 'letter',
    'line', 'simple', 'smart', 'happy', 'little', 'great', 'large', 'speed', 'typing', 'zebra',
    // Long words
    'adventure', 'beautiful', 'chocolate', 'dinosaur', 'elephant', 'fantastic', 'geography',
    'hamburger', 'important', 'javascript', 'knowledge', 'landscape', 'microphone', 'notebook',
    'question', 'restaurant', 'skateboard', 'telephone', 'umbrella', 'vacation', 'waterfall',
    'yesterday', 'crocodile', 'butterfly', 'strawberry', 'quarterback', 'wizard', 'oxygen'
])];

// Простые фразы для урока «Короткие фразы»
export const RU_PHRASES = [
    'Мама мыла раму.', 'Кот спит на диване.', 'Я люблю читать книги.', 'Сегодня тёплый день.',
    'Мы идём в школу.', 'У меня есть собака.', 'Папа пьёт горячий чай.', 'Солнце светит ярко.',
    'Летом мы ездим на море.', 'Брат играет в футбол.', 'На улице идёт снег.', 'Мой друг пишет код.',
    'Бабушка печёт пироги.', 'Птицы поют весной.', 'Учитель задал урок.', 'Вечером я гуляю в парке.',
    'Река течёт быстро.', 'Мы смотрим новый фильм.', 'Сестра рисует цветы.', 'Утром я пью сок.'
];

export const EN_PHRASES = [
    'The cat is on the mat.', 'I like to read books.', 'We go to school today.', 'My dog can run fast.',
    'The sun is hot.', 'She has a red bag.', 'He plays the guitar.', 'It is a nice day.',
    'Birds sing in the morning.', 'I drink tea with milk.', 'The sky is blue.', 'We play games at home.',
    'My friend writes code.', 'The river is very long.', 'Snow falls in winter.', 'I can type fast now.',
    'Mom bakes a big cake.', 'The bus is late again.', 'He reads a new book.', 'We walk in the park.'
];

// Города и имена для урока заглавных букв
export const RU_NAMES = ['Москва', 'Алматы', 'Астана', 'Шымкент', 'Караганда', 'Актобе', 'Тараз',
    'Павлодар', 'Байкал', 'Волга', 'Каспий', 'Урал', 'Иртыш', 'Есиль'];
export const EN_NAMES = ['London', 'Paris', 'Tokyo', 'Berlin', 'Almaty', 'Astana', 'Madrid', 'Rome',
    'Oslo', 'Dublin', 'Vienna', 'Seoul', 'Cairo', 'Lima'];

// Фразы, пословицы и авторские панграммы для режима «Текст»
export const RU_TEXTS = [
    'Тише едешь, дальше будешь от беды и суеты.',
    'Делу время, а потехе целый час для отдыха.',
    'Терпенье и труд все преграды на пути перетрут.',
    'Ученье свет, а неученье тьма и вечные потёмки.',
    'Семь раз отмерь, один раз отрежь аккуратно ножницами.',
    'Век живи, век учись, и каждый день узнавай новое.',
    'Широкая электрификация южных губерний даст мощный толчок подъёму сельского хозяйства.',
    'Съешь же ещё этих мягких французских булок, да выпей крепкого чаю.',
    'В чащах юга жил бы цитрус? Да, но фальшивый экземпляр!',
    'Любя, съешь щипцы, - вздохнёт мэр, - кайф жгуч!'
];

export const EN_TEXTS = [
    'The quick brown fox jumps over the lazy dog near the river bank.',
    'Pack my box with five dozen liquor jugs before noon arrives.',
    'Jackdaws love my big sphinx of quartz and obsidian stone.',
    'How vexingly quick daft zebras jump across the deep valley.',
    'Bright vixens jump, dozy fowl quack, and quiet wolves run fast.',
    'Practice makes perfect when you type with all ten fingers daily.',
    'Keep your eyes on the screen and trust your muscle memory.',
    'Code is like humor; when you have to explain it, it is bad.',
    'Simplicity is prerequisite for reliability in computer software.',
    'Stay focused, keep a steady rhythm, and avoid looking down at keys.'
];

const rnd = n => Math.floor(Math.random() * n);
const pick = list => list[rnd(list.length)];

// Слова словаря, в которых есть только разрешённые буквы
export function wordsFrom(dict, allowed) {
    return dict.filter(w => [...w].every(ch => allowed.has(ch)));
}

/**
 * Упражнение урока: сочетания новых букв + настоящие слова из пройденных букв
 * @param {string[]} fresh - новые буквы урока
 * @param {string[]} known - буквы прошлых уроков
 * @param {string[]} dict - словарь
 * @param {number} count - сколько «слов» в упражнении
 */
export function generateLesson(fresh, known, dict, count = 12) {
    const allowed = new Set([...known, ...fresh]);
    const words = wordsFrom(dict, allowed);
    const withNew = words.filter(w => fresh.some(ch => w.includes(ch)));
    const letters = [...allowed];

    // Сочетание вроде «апа», «ппа», «оп»: всегда с новой буквой
    const drill = () => {
        const n = pick(fresh);
        const k = pick(letters);
        return pick([n + k + n, n + n + k, k + n + k, n + k, k + n]);
    };

    const out = [];
    // Если слов мало, упражнение почти целиком из сочетаний
    const drillEvery = words.length >= 5 ? 3 : 1;
    while (out.length < count) {
        const item = out.length % drillEvery === 0
            ? drill()
            : pick(withNew.length && Math.random() < 0.7 ? withNew : words);
        if (item !== out[out.length - 1]) out.push(item);
    }
    return out.join(' ');
}

// Просто слова из списка, без сочетаний букв
export function generateWords(words, count = 14) {
    const out = [];
    while (out.length < count) {
        const item = pick(words);
        if (item !== out[out.length - 1] || words.length < 2) out.push(item);
    }
    return out.join(' ');
}

// Предложения из случайных слов: с большой буквы и с точкой в конце
export function generateSentences(words, count = 4) {
    const out = [];
    for (let i = 0; i < count; i++) {
        const s = Array.from({ length: 3 + rnd(3) }, () => pick(words)).join(' ');
        out.push(s[0].toUpperCase() + s.slice(1) + '.');
    }
    return out.join(' ');
}

// Урок заглавных: города вперемешку со словами с большой буквы
export function generateCaps(dict, names, count = 10) {
    const out = [];
    while (out.length < count) {
        const w = out.length % 2 ? pick(dict) : pick(names);
        const item = w[0].toUpperCase() + w.slice(1);
        if (item !== out[out.length - 1]) out.push(item);
    }
    return out.join(' ');
}

// Урок цифр и знаков: числа и слова с запятой, точкой, ! и ?
export function generateNumbers(dict, count = 12) {
    const marks = [',', '.', '!', '?'];
    const out = [];
    for (let i = 0; i < count; i++) {
        if (i % 2 === 0) out.push(String(1 + rnd([9, 99, 999, 9999][rnd(4)])));
        else out.push(pick(dict) + pick(marks));
    }
    return out.join(' ');
}

// Перемешанная копия списка
export function shuffled(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = rnd(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
