// ===== Программа уроков слепой печати =====
// Сначала буквы (по 2–4 новые за урок) с повторениями между ними,
// потом практика: слова разной длины, трудные буквы, фразы, предложения.
// Упражнение строится только из пройденных букв.
import {
    RU_DICT, EN_DICT, RU_NAMES, EN_NAMES, RU_PHRASES, EN_PHRASES,
    generateLesson, generateWords, generateSentences, generateCaps, generateNumbers, wordsFrom, shuffled
} from './texts.js?v=3';

// Буквы, которые нажимают мизинцы, и «трудные» буквы
const RU_PINKY = 'йфяёжэхъз';
const RU_HARD = 'щцъьёэюжхш';
const EN_PINKY = 'qazp';
const EN_HARD = 'qzxjkvyw';

const has = letters => w => [...letters].some(ch => w.includes(ch));

// kind: (нет) — новые буквы fresh; review — повторение пройденного;
// words — слова из словаря по условию pick; caps, nums, phrases, sentences, speed
const RU_STEPS = [
    { name: 'А и О',              desc: 'Указательные пальцы на клавишах с засечками', fresh: 'ао' },
    { name: 'Домашний ряд',       desc: 'Все 8 пальцев на месте: ФЫВА ОЛДЖ', fresh: 'фывлдж' },
    { name: 'Повторение',         desc: 'Слова из букв домашнего ряда', kind: 'review' },
    { name: 'П и Р',              desc: 'Указательные тянутся к центру', fresh: 'пр' },
    { name: 'Е и Н',              desc: 'Указательные вверх', fresh: 'ен' },
    { name: 'Повторение',         desc: 'Центр и первые буквы верхнего ряда', kind: 'review' },
    { name: 'К и Г',              desc: 'Указательные вверх, к краю', fresh: 'кг' },
    { name: 'У и Ш',              desc: 'Средние пальцы вверх', fresh: 'уш' },
    { name: 'Ц и Щ',              desc: 'Безымянные пальцы вверх', fresh: 'цщ' },
    { name: 'Й, З, Х, Ъ',         desc: 'Мизинцы вверх', fresh: 'йзхъ' },
    { name: 'Повторение',         desc: 'Весь верхний ряд и домашний', kind: 'review' },
    { name: 'М, И, Т, Ь',         desc: 'Указательные вниз', fresh: 'мить' },
    { name: 'С и Б',              desc: 'Средние пальцы вниз', fresh: 'сб' },
    { name: 'Ч и Ю',              desc: 'Безымянные пальцы вниз', fresh: 'чю' },
    { name: 'Я, Э, Ё',            desc: 'Мизинцы: вниз, вправо и в угол', fresh: 'яэё' },
    { name: 'Все буквы',          desc: 'Повторение всего алфавита', kind: 'review' },
    { name: 'Короткие слова',     desc: 'Слова из 2–4 букв', kind: 'words', pick: w => w.length <= 4 },
    { name: 'Простые слова',      desc: 'Слова из 5–6 букв', kind: 'words', pick: w => w.length >= 5 && w.length <= 6 },
    { name: 'Длинные слова',      desc: 'Слова от 7 букв', kind: 'words', pick: w => w.length >= 7 },
    { name: 'Мизинцы',            desc: 'Слова с Й, Ф, Я, Ж, Э, Х, З', kind: 'words', pick: has(RU_PINKY) },
    { name: 'Трудные буквы',      desc: 'Щ, Ц, Ъ, Ь, Ё, Э, Ю, Ж, Х, Ш', kind: 'words', pick: has(RU_HARD) },
    { name: 'Заглавные',          desc: 'Shift нажимает мизинец другой руки', kind: 'caps' },
    { name: 'Цифры и знаки',      desc: 'Цифровой ряд, точка, запятая, ! и ?', kind: 'nums' },
    { name: 'Короткие фразы',     desc: 'Простые предложения', kind: 'phrases' },
    { name: 'Предложения',        desc: 'С большой буквы и с точкой', kind: 'sentences' },
    { name: 'На скорость',        desc: 'Много частых слов подряд', kind: 'speed' }
];

const EN_STEPS = [
    { name: 'F и J',              desc: 'Указательные пальцы на клавишах с засечками', fresh: 'fj' },
    { name: 'Домашний ряд',       desc: 'Все 8 пальцев на месте: ASDF JKL;', fresh: 'asdkl' },
    { name: 'Повторение',         desc: 'Слова из букв домашнего ряда', kind: 'review' },
    { name: 'G и H',              desc: 'Указательные тянутся к центру', fresh: 'gh' },
    { name: 'R и U',              desc: 'Указательные вверх', fresh: 'ru' },
    { name: 'E и I',              desc: 'Средние пальцы вверх', fresh: 'ei' },
    { name: 'Повторение',         desc: 'Домашний ряд и первые буквы сверху', kind: 'review' },
    { name: 'T и Y',              desc: 'Указательные вверх, к центру', fresh: 'ty' },
    { name: 'W и O',              desc: 'Безымянные пальцы вверх', fresh: 'wo' },
    { name: 'Q и P',              desc: 'Мизинцы вверх', fresh: 'qp' },
    { name: 'Повторение',         desc: 'Весь верхний ряд и домашний', kind: 'review' },
    { name: 'V и M',              desc: 'Указательные вниз', fresh: 'vm' },
    { name: 'B и N',              desc: 'Указательные вниз, к центру', fresh: 'bn' },
    { name: 'C и запятая',        desc: 'Средние пальцы вниз', fresh: 'c,' },
    { name: 'X и точка',          desc: 'Безымянные пальцы вниз', fresh: 'x.' },
    { name: 'Z',                  desc: 'Левый мизинец вниз', fresh: 'z' },
    { name: 'Все буквы',          desc: 'Повторение всего алфавита', kind: 'review' },
    { name: 'Короткие слова',     desc: 'Слова из 2–4 букв', kind: 'words', pick: w => w.length <= 4 },
    { name: 'Простые слова',      desc: 'Слова из 5–6 букв', kind: 'words', pick: w => w.length >= 5 && w.length <= 6 },
    { name: 'Длинные слова',      desc: 'Слова от 7 букв', kind: 'words', pick: w => w.length >= 7 },
    { name: 'Мизинцы',            desc: 'Слова с Q, A, Z, P', kind: 'words', pick: has(EN_PINKY) },
    { name: 'Трудные буквы',      desc: 'Q, Z, X, J, K, V, Y, W', kind: 'words', pick: has(EN_HARD) },
    { name: 'Заглавные',          desc: 'Shift нажимает мизинец другой руки', kind: 'caps' },
    { name: 'Цифры и знаки',      desc: 'Цифровой ряд, точка, запятая, ! и ?', kind: 'nums' },
    { name: 'Короткие фразы',     desc: 'Простые предложения', kind: 'phrases' },
    { name: 'Предложения',        desc: 'С большой буквы и с точкой', kind: 'sentences' },
    { name: 'На скорость',        desc: 'Много частых слов подряд', kind: 'speed' }
];

// Из шагов собираем уроки: у каждого урока свои буквы + все прошлые
function buildLessons(steps, dict, names, phrases) {
    const known = [];
    return steps.map((s, i) => {
        const fresh = s.fresh ? [...s.fresh] : [];
        const before = [...known];
        known.push(...fresh);
        const all = new Set(known);
        const pool = wordsFrom(dict, all); // слова только из пройденных букв
        const short = pool.filter(w => w.length <= 5);

        let generate;
        switch (s.kind) {
            case 'review':    generate = () => generateLesson([...all], [], dict, 14); break;
            case 'words':     generate = () => generateWords(pool.filter(s.pick)); break;
            case 'caps':      generate = () => generateCaps(pool, names); break;
            case 'nums':      generate = () => generateNumbers(pool); break;
            case 'phrases':   generate = () => shuffled(phrases).slice(0, 4).join(' '); break;
            case 'sentences': generate = () => generateSentences(short); break;
            case 'speed':     generate = () => generateWords(short, 30); break;
            default:          generate = () => generateLesson(fresh, before, dict);
        }
        return { id: i + 1, title: `Урок ${i + 1}: ${s.name}`, desc: s.desc, letters: fresh, generate };
    });
}

export const RU_LESSONS = buildLessons(RU_STEPS, RU_DICT, RU_NAMES, RU_PHRASES);
export const EN_LESSONS = buildLessons(EN_STEPS, EN_DICT, EN_NAMES, EN_PHRASES);

const STORAGE_KEY = 'pechatalka_lessons_progress';

export function getUnlockedLessons(layout = 'ru') {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const data = JSON.parse(raw);
            return data[layout] || 1;
        }
    } catch (e) {
        // Игнорируем ошибки парсинга
    }
    return 1; // По умолчанию открыт только 1-й урок
}

export function saveLessonProgress(layout = 'ru', completedLessonId) {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const data = raw ? JSON.parse(raw) : { ru: 1, en: 1 };
        const nextId = completedLessonId + 1;
        if (!data[layout] || nextId > data[layout]) {
            data[layout] = nextId;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        }
    } catch (e) {
        // Игнорируем
    }
}
