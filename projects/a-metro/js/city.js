// ===== Данные города =====
// Готовые файлы в data/ (собраны из OpenStreetMap и карты высот):
// - city.json — сетка клеток 500×500 м: жители, работа, места притяжения,
//   застройка, дороги, реки, парки, ж/д, аэропорт, высота, район;
// - roads.json — крупные дороги (для раскраски пробок);
// - metro.json — существующая линия метро и станции.

export async function loadCity(onProgress = () => {}) {
    const files = ['city', 'roads', 'metro'];
    let done = 0;
    const [city, roads, metro] = await Promise.all(files.map(async name => {
        const res = await fetch(`data/${name}.json?v=1`);
        if (!res.ok) throw new Error(`Нет файла data/${name}.json`);
        const json = await res.json();
        onProgress(++done / files.length);
        return json;
    }));
    city.size = city.cols * city.rows;
    return { city, roads, metro };
}

// Номер клетки по координатам (или -1 за краем карты)
export function cellAt(city, lon, lat) {
    const c = Math.floor((lon - city.lon0) / city.dLon);
    const r = Math.floor((lat - city.lat0) / city.dLat);
    return c >= 0 && c < city.cols && r >= 0 && r < city.rows ? r * city.cols + c : -1;
}

export function cellCenter(city, i) {
    const r = Math.floor(i / city.cols), c = i % city.cols;
    return [city.lon0 + (c + 0.5) * city.dLon, city.lat0 + (r + 0.5) * city.dLat];
}

// Квадрат клетки для слоя на карте
export function cellPolygon(city, i) {
    const r = Math.floor(i / city.cols), c = i % city.cols;
    const x0 = city.lon0 + c * city.dLon, y0 = city.lat0 + r * city.dLat;
    const x1 = x0 + city.dLon, y1 = y0 + city.dLat;
    return [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
}
