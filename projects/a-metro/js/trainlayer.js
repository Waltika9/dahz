// ===== Поезда в 3D: свой слой на видеокарте (WebGL) =====
// Поезда двигаются каждый кадр. Если отдавать их карте как обычные данные (GeoJSON),
// карта каждый раз пересчитывает их в фоне — и вагоны дёргаются. Поэтому рисуем сами:
// каждый вагон — несколько цветных «коробочек», они сразу уходят на видеокарту.
// Коробочка: центр (x, y в координатах карты Меркатора), направление ux, uy,
// длина l, ширина w, низ z0 и верх z1 (тоже в единицах Меркатора) и цвет r, g, b.

const VS = `
attribute vec3 a_pos;
attribute vec3 a_color;
uniform mat4 u_matrix;
varying vec3 v_color;
void main() {
    gl_Position = u_matrix * vec4(a_pos, 1.0);
    v_color = a_color;
}`;

const FS = `
precision mediump float;
varying vec3 v_color;
void main() { gl_FragColor = vec4(v_color, 1.0); }`;

// Свет падает с юго-востока: стены к солнцу светлее, от солнца — темнее, крыша светлее всех
const LIGHT = [0.55, -0.83];
const shade = (nx, ny) => 0.72 + 0.24 * (nx * LIGHT[0] + ny * LIGHT[1]);

function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
}

// getBoxes(origin) — коробочки, которые видно сейчас; origin — центр карты в Меркаторе
export function createTrainLayer(map, getBoxes) {
    let gl = null, prog = null, buf = null, aPos = -1, aColor = -1, uMatrix = null;
    let data = new Float32Array(30 * 6 * 256);

    // 5 граней (низ не видно) × 2 треугольника × 3 вершины, у каждой x y z r g b
    function fill(boxes, ox, oy) {
        const need = boxes.length * 180;
        if (data.length < need) data = new Float32Array(need * 1.5 | 0);
        let i = 0;
        const put = (x, y, z, c) => { data[i++] = x; data[i++] = y; data[i++] = z; data[i++] = c[0]; data[i++] = c[1]; data[i++] = c[2]; };
        for (const b of boxes) {
            const cx = b.x - ox, cy = b.y - oy;
            // вдоль: u, поперёк: v (в Меркаторе ось y смотрит на юг, поэтому v = (uy, −ux))
            const ax = b.ux * b.l / 2, ay = b.uy * b.l / 2, vx = b.uy * b.w / 2, vy = -b.ux * b.w / 2;
            const p = [[cx + ax + vx, cy + ay + vy], [cx + ax - vx, cy + ay - vy], [cx - ax - vx, cy - ay - vy], [cx - ax + vx, cy - ay + vy]];
            const z0 = b.z0, z1 = b.z1, col = b.c;
            // крыша
            put(p[0][0], p[0][1], z1, col); put(p[1][0], p[1][1], z1, col); put(p[2][0], p[2][1], z1, col);
            put(p[0][0], p[0][1], z1, col); put(p[2][0], p[2][1], z1, col); put(p[3][0], p[3][1], z1, col);
            // стены: нормали в «географических» осях (восток, север): вперёд u = (ux, −uy), влево v = (uy, ux)
            const gu = [b.ux, -b.uy], gv = [b.uy, b.ux];
            const sides = [[0, 1, gu], [1, 2, [-gv[0], -gv[1]]], [2, 3, [-gu[0], -gu[1]]], [3, 0, gv]];
            for (const [a, c, n] of sides) {
                const k = shade(n[0], n[1]), sc = [col[0] * k, col[1] * k, col[2] * k];
                const A = p[a], B = p[c];
                put(A[0], A[1], z0, sc); put(B[0], B[1], z0, sc); put(B[0], B[1], z1, sc);
                put(A[0], A[1], z0, sc); put(B[0], B[1], z1, sc); put(A[0], A[1], z1, sc);
            }
        }
        return i / 6;
    }

    const layer = {
        id: 'tr-trains',
        type: 'custom',
        renderingMode: '3d',
        onAdd(m, context) {
            gl = context;
            prog = gl.createProgram();
            gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
            gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
            gl.linkProgram(prog);
            aPos = gl.getAttribLocation(prog, 'a_pos');
            aColor = gl.getAttribLocation(prog, 'a_color');
            uMatrix = gl.getUniformLocation(prog, 'u_matrix');
            buf = gl.createBuffer();
        },
        render(context, matrix) {
            // Центр карты — «ноль» координат: так точности float32 хватает, вагоны не дрожат
            const o = maplibregl.MercatorCoordinate.fromLngLat(map.getCenter(), 0);
            const boxes = getBoxes(o);
            if (!boxes.length) return;
            const count = fill(boxes, o.x, o.y);
            // матрица × сдвиг на центр (считаем в double, отдаём float)
            const m = Array.from(matrix);
            m[12] = matrix[0] * o.x + matrix[4] * o.y + matrix[12];
            m[13] = matrix[1] * o.x + matrix[5] * o.y + matrix[13];
            m[14] = matrix[2] * o.x + matrix[6] * o.y + matrix[14];
            m[15] = matrix[3] * o.x + matrix[7] * o.y + matrix[15];
            gl.useProgram(prog);
            gl.uniformMatrix4fv(uMatrix, false, new Float32Array(m));
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * 6), gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(aPos);
            gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 24, 0);
            gl.enableVertexAttribArray(aColor);
            gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, 24, 12);
            gl.drawArrays(gl.TRIANGLES, 0, count);
            gl.disableVertexAttribArray(aPos);
            gl.disableVertexAttribArray(aColor);
        },
        onRemove() {
            if (gl) { gl.deleteBuffer(buf); gl.deleteProgram(prog); }
        }
    };
    return layer;
}
