// ===== Модуль статистики, истории тренировок и графика на Canvas =====

const STORAGE_KEY = 'pechatalka_data';
const OLD_KEY = 'slepysh_data'; // так ключ назывался раньше — переносим данные

// Загрузка всех данных из localStorage
export function loadData() {
    try {
        const old = localStorage.getItem(OLD_KEY);
        if (old !== null) {
            if (localStorage.getItem(STORAGE_KEY) === null) localStorage.setItem(STORAGE_KEY, old);
            localStorage.removeItem(OLD_KEY);
        }
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            return JSON.parse(raw);
        }
    } catch (e) {
        // Ошибка парсинга
    }
    return {
        history: [], // массив сессий: { date, cpm, wpm, accuracy, errors, mode, layout }
        heatmap: {}, // code -> число ошибок
        records: { cpm: 0, wpm: 0 }
    };
}

// Сохранение данных в localStorage
export function saveData(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        // Игнорируем
    }
}

// Запись результата тренировки
export function recordSession(session, errorCodes = []) {
    const data = loadData();

    // Добавляем сессию (храним последние 30 для графика)
    data.history.push({
        date: Date.now(),
        cpm: session.cpm,
        wpm: session.wpm,
        accuracy: session.accuracy,
        errors: session.errors,
        mode: session.mode,
        layout: session.layout
    });

    if (data.history.length > 30) {
        data.history = data.history.slice(-30);
    }

    // Обновляем рекорды
    let isRecord = false;
    if (session.cpm > (data.records.cpm || 0)) {
        data.records.cpm = session.cpm;
        data.records.wpm = session.wpm;
        isRecord = true;
    }

    // Обновляем тепловую карту ошибок
    if (errorCodes && errorCodes.length > 0) {
        errorCodes.forEach(code => {
            data.heatmap[code] = (data.heatmap[code] || 0) + 1;
        });
    }

    saveData(data);
    return { isRecord, records: data.records, data };
}

// Сброс всех данных
export function resetAllData() {
    try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem('pechatalka_lessons_progress');
    } catch (e) {
        // Игнорируем
    }
}

/**
 * Рендерит строгий пиксельный график скорости за последние 30 тренировок на Canvas
 * @param {HTMLCanvasElement} canvas 
 * @param {Array} history 
 */
export function drawPixelGraph(canvas, history = []) {
    if (!canvas) return;
    // Холст в размер элемента (1:1 с CSS px), иначе график растягивается и пиксели «плывут»
    if (canvas.clientWidth > 0) canvas.width = Math.round(canvas.clientWidth);
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // Очищаем фон (почти чёрный)
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Рамка 2px
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);

    if (!history || history.length < 2) {
        ctx.fillStyle = '#666666';
        ctx.font = '12px Tiny5, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('НУЖНО МИНИМУМ 2 ТРЕНИРОВКИ ДЛЯ ГРАФИКА', w / 2, h / 2 + 4);
        return;
    }

    // Сетка: горизонтальные пунктирные линии через пиксельный дизеринг
    ctx.fillStyle = '#222222';
    for (let y = 20; y < h - 20; y += 20) {
        for (let x = 8; x < w - 8; x += 4) {
            ctx.fillRect(x, y, 2, 1);
        }
    }

    const cpms = history.map(item => item.cpm);
    const maxCpm = Math.max(...cpms, 100);
    const minCpm = Math.max(0, Math.min(...cpms) - 20);

    const padLeft = 16;
    const padRight = 16;
    const padTop = 16;
    const padBottom = 20;

    const graphW = w - padLeft - padRight;
    const graphH = h - padTop - padBottom;

    const points = history.map((item, idx) => {
        const x = Math.round(padLeft + (idx / (history.length - 1)) * graphW);
        const ratio = (item.cpm - minCpm) / (maxCpm - minCpm || 1);
        const y = Math.round(h - padBottom - ratio * graphH);
        return { x, y, cpm: item.cpm };
    });

    // Рисуем ступенчатую пиксельную линию графика (step-after)
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
        // Ступенчатый пиксельный переход: сначала по X, затем по Y
        ctx.lineTo(points[i].x, points[i - 1].y);
        ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();

    // Рисуем квадратные пиксельные точки (4x4)
    ctx.fillStyle = '#ffffff';
    points.forEach(p => {
        ctx.fillRect(p.x - 2, p.y - 2, 5, 5);
    });

    // Подписи минимальной и максимальной скорости
    ctx.fillStyle = '#888888';
    ctx.font = '10px Tiny5, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`МАКС: ${maxCpm}`, padLeft + 2, padTop - 2);
    ctx.textAlign = 'right';
    ctx.fillText(`ПОСЛЕДНИЙ: ${history[history.length - 1].cpm} ЗН/МИН`, w - padRight, h - 4);
}
