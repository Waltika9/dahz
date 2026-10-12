// ===== Раскладки клавиатуры и привязка к пальцам =====
// Каждая клавиша привязана к физическому коду event.code.
// Раскладки: QWERTY (en) и ЙЦУКЕН (ru, стандартная Windows).
// Зоны пальцев:
// 'left-pinky'   — левый мизинец (узор: мелкая точка)
// 'left-ring'    — левый безымянный (узор: косая полоска)
// 'left-middle'  — левый средний (узор: вертикальная полоска)
// 'left-index'   — левый указательный (узор: горизонтальная полоска)
// 'thumb'        — большие пальцы (узор: чистый фон с точкой)
// 'right-index'  — правый указательный (узор: горизонтальная полоска)
// 'right-middle' — правый средний (узор: вертикальная полоска)
// 'right-ring'   — правый безымянный (узор: косая полоска)
// 'right-pinky'  — правый мизинец (узор: мелкая точка)

export const ROWS = [
    // Ряд 1 (цифровой)
    [
        { code: 'Backquote', en: '`', enShift: '~', ru: 'ё', ruShift: 'Ё', finger: 'left-pinky', width: 1 },
        { code: 'Digit1', en: '1', enShift: '!', ru: '1', ruShift: '!', finger: 'left-pinky', width: 1 },
        { code: 'Digit2', en: '2', enShift: '@', ru: '2', ruShift: '"', finger: 'left-ring', width: 1 },
        { code: 'Digit3', en: '3', enShift: '#', ru: '3', ruShift: '№', finger: 'left-middle', width: 1 },
        { code: 'Digit4', en: '4', enShift: '$', ru: '4', ruShift: ';', finger: 'left-index', width: 1 },
        { code: 'Digit5', en: '5', enShift: '%', ru: '5', ruShift: '%', finger: 'left-index', width: 1 },
        { code: 'Digit6', en: '6', enShift: '^', ru: '6', ruShift: ':', finger: 'right-index', width: 1 },
        { code: 'Digit7', en: '7', enShift: '&', ru: '7', ruShift: '?', finger: 'right-index', width: 1 },
        { code: 'Digit8', en: '8', enShift: '*', ru: '8', ruShift: '*', finger: 'right-middle', width: 1 },
        { code: 'Digit9', en: '9', enShift: '(', ru: '9', ruShift: '(', finger: 'right-ring', width: 1 },
        { code: 'Digit0', en: '0', enShift: ')', ru: '0', ruShift: ')', finger: 'right-pinky', width: 1 },
        { code: 'Minus', en: '-', enShift: '_', ru: '-', ruShift: '_', finger: 'right-pinky', width: 1 },
        { code: 'Equal', en: '=', enShift: '+', ru: '=', ruShift: '+', finger: 'right-pinky', width: 1 },
        { code: 'Backspace', label: 'BACK', finger: 'right-pinky', width: 2 }
    ],
    // Ряд 2 (верхний буквенный)
    [
        { code: 'Tab', label: 'TAB', finger: 'left-pinky', width: 1.5 },
        { code: 'KeyQ', en: 'q', enShift: 'Q', ru: 'й', ruShift: 'Й', finger: 'left-pinky', width: 1 },
        { code: 'KeyW', en: 'w', enShift: 'W', ru: 'ц', ruShift: 'Ц', finger: 'left-ring', width: 1 },
        { code: 'KeyE', en: 'e', enShift: 'E', ru: 'у', ruShift: 'У', finger: 'left-middle', width: 1 },
        { code: 'KeyR', en: 'r', enShift: 'R', ru: 'к', ruShift: 'К', finger: 'left-index', width: 1 },
        { code: 'KeyT', en: 't', enShift: 'T', ru: 'е', ruShift: 'Е', finger: 'left-index', width: 1 },
        { code: 'KeyY', en: 'y', enShift: 'Y', ru: 'н', ruShift: 'Н', finger: 'right-index', width: 1 },
        { code: 'KeyU', en: 'u', enShift: 'U', ru: 'г', ruShift: 'Г', finger: 'right-index', width: 1 },
        { code: 'KeyI', en: 'i', enShift: 'I', ru: 'ш', ruShift: 'Ш', finger: 'right-middle', width: 1 },
        { code: 'KeyO', en: 'o', enShift: 'O', ru: 'щ', ruShift: 'Щ', finger: 'right-ring', width: 1 },
        { code: 'KeyP', en: 'p', enShift: 'P', ru: 'з', ruShift: 'З', finger: 'right-pinky', width: 1 },
        { code: 'BracketLeft', en: '[', enShift: '{', ru: 'х', ruShift: 'Х', finger: 'right-pinky', width: 1 },
        { code: 'BracketRight', en: ']', enShift: '}', ru: 'ъ', ruShift: 'Ъ', finger: 'right-pinky', width: 1 },
        { code: 'Backslash', en: '\\', enShift: '|', ru: '\\', ruShift: '/', finger: 'right-pinky', width: 1.5 }
    ],
    // Ряд 3 (домашний ряд)
    [
        { code: 'CapsLock', label: 'CAPS', finger: 'left-pinky', width: 1.75 },
        { code: 'KeyA', en: 'a', enShift: 'A', ru: 'ф', ruShift: 'Ф', finger: 'left-pinky', width: 1 },
        { code: 'KeyS', en: 's', enShift: 'S', ru: 'ы', ruShift: 'Ы', finger: 'left-ring', width: 1 },
        { code: 'KeyD', en: 'd', enShift: 'D', ru: 'в', ruShift: 'В', finger: 'left-middle', width: 1 },
        { code: 'KeyF', en: 'f', enShift: 'F', ru: 'а', ruShift: 'А', finger: 'left-index', width: 1, homing: true },
        { code: 'KeyG', en: 'g', enShift: 'G', ru: 'п', ruShift: 'П', finger: 'left-index', width: 1 },
        { code: 'KeyH', en: 'h', enShift: 'H', ru: 'р', ruShift: 'Р', finger: 'right-index', width: 1 },
        { code: 'KeyJ', en: 'j', enShift: 'J', ru: 'о', ruShift: 'О', finger: 'right-index', width: 1, homing: true },
        { code: 'KeyK', en: 'k', enShift: 'K', ru: 'л', ruShift: 'Л', finger: 'right-middle', width: 1 },
        { code: 'KeyL', en: 'l', enShift: 'L', ru: 'д', ruShift: 'Д', finger: 'right-ring', width: 1 },
        { code: 'Semicolon', en: ';', enShift: ':', ru: 'ж', ruShift: 'Ж', finger: 'right-pinky', width: 1 },
        { code: 'Quote', en: "'", enShift: '"', ru: 'э', ruShift: 'Э', finger: 'right-pinky', width: 1 },
        { code: 'Enter', label: 'ENTER', finger: 'right-pinky', width: 2.25 }
    ],
    // Ряд 4 (нижний буквенный)
    [
        { code: 'ShiftLeft', label: 'SHIFT', finger: 'left-pinky', width: 2.25 },
        { code: 'KeyZ', en: 'z', enShift: 'Z', ru: 'я', ruShift: 'Я', finger: 'left-pinky', width: 1 },
        { code: 'KeyX', en: 'x', enShift: 'X', ru: 'ч', ruShift: 'Ч', finger: 'left-ring', width: 1 },
        { code: 'KeyC', en: 'c', enShift: 'C', ru: 'с', ruShift: 'С', finger: 'left-middle', width: 1 },
        { code: 'KeyV', en: 'v', enShift: 'V', ru: 'м', ruShift: 'М', finger: 'left-index', width: 1 },
        { code: 'KeyB', en: 'b', enShift: 'B', ru: 'и', ruShift: 'И', finger: 'left-index', width: 1 },
        { code: 'KeyN', en: 'n', enShift: 'N', ru: 'т', ruShift: 'Т', finger: 'right-index', width: 1 },
        { code: 'KeyM', en: 'm', enShift: 'M', ru: 'ь', ruShift: 'Ь', finger: 'right-index', width: 1 },
        { code: 'Comma', en: ',', enShift: '<', ru: 'б', ruShift: 'Б', finger: 'right-middle', width: 1 },
        { code: 'Period', en: '.', enShift: '>', ru: 'ю', ruShift: 'Ю', finger: 'right-ring', width: 1 },
        { code: 'Slash', en: '/', enShift: '?', ru: '.', ruShift: ',', finger: 'right-pinky', width: 1 },
        { code: 'ShiftRight', label: 'SHIFT', finger: 'right-pinky', width: 2.75 }
    ],
    // Ряд 5 (пробел)
    [
        { code: 'ControlLeft', label: 'CTRL', finger: 'left-pinky', width: 1.5 },
        { code: 'AltLeft', label: 'ALT', finger: 'thumb', width: 1.5 },
        { code: 'Space', label: 'SPACE', en: ' ', ru: ' ', finger: 'thumb', width: 8 },
        { code: 'AltRight', label: 'ALT', finger: 'thumb', width: 1.5 },
        { code: 'ControlRight', label: 'CTRL', finger: 'right-pinky', width: 1.5 }
    ]
];

// Карты быстрого поиска: символ -> { code, needShift, whichShift, finger }
const CHAR_MAP_EN = {};
const CHAR_MAP_RU = {};

// Заполняем карты символов
ROWS.forEach(row => {
    row.forEach(k => {
        // EN
        if (k.en) {
            CHAR_MAP_EN[k.en] = { code: k.code, needShift: false, whichShift: null, finger: k.finger };
        }
        if (k.enShift) {
            // Если нажимаем правой рукой — Shift нажимаем левой, и наоборот
            const whichShift = k.finger.startsWith('left') ? 'ShiftRight' : 'ShiftLeft';
            CHAR_MAP_EN[k.enShift] = { code: k.code, needShift: true, whichShift, finger: k.finger };
        }
        // RU
        if (k.ru) {
            CHAR_MAP_RU[k.ru] = { code: k.code, needShift: false, whichShift: null, finger: k.finger };
        }
        if (k.ruShift) {
            const whichShift = k.finger.startsWith('left') ? 'ShiftRight' : 'ShiftLeft';
            CHAR_MAP_RU[k.ruShift] = { code: k.code, needShift: true, whichShift, finger: k.finger };
        }
    });
});

// Пробел
CHAR_MAP_EN[' '] = { code: 'Space', needShift: false, whichShift: null, finger: 'thumb' };
CHAR_MAP_RU[' '] = { code: 'Space', needShift: false, whichShift: null, finger: 'thumb' };

/**
 * Находит параметры нужной клавиши для конкретного символа в текущей раскладке
 * @param {string} char 
 * @param {'ru'|'en'} layout 
 */
export function getKeyForChar(char, layout = 'ru') {
    if (layout === 'ru') {
        if (CHAR_MAP_RU[char]) return CHAR_MAP_RU[char];
        // Если символа нет в ru (например, английский попался случайно), проверим en
        if (CHAR_MAP_EN[char]) return CHAR_MAP_EN[char];
    } else {
        if (CHAR_MAP_EN[char]) return CHAR_MAP_EN[char];
        if (CHAR_MAP_RU[char]) return CHAR_MAP_RU[char];
    }
    return null;
}

/**
 * Проверяет, принадлежит ли введённый символ другой раскладке
 * Например, если текущая раскладка 'ru', а пользователь ввёл латинскую букву 'f'
 */
export function isWrongLayoutChar(char, currentLayout = 'ru') {
    if (char === ' ' || !char || char.length !== 1) return false;
    const isEnLetter = /^[a-zA-Z]$/.test(char);
    const isRuLetter = /^[а-яА-ЯёЁ]$/.test(char);

    if (currentLayout === 'ru' && isEnLetter) return true;
    if (currentLayout === 'en' && isRuLetter) return true;
    return false;
}
