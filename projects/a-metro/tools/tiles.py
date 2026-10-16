"""Запасной путь, если Overpass перегружен: берём дома и землепользование из
векторных тайлов OpenFreeMap (z14) и считаем по клеткам игры:
площадь этажей жилья и работы, застроенность. Результат — buildings_cells.json."""
import json, math, sys, time, urllib.request, pathlib

OUT = pathlib.Path(sys.argv[1])
G = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
URL = sys.argv[3]  # шаблон тайла {z}/{x}/{y}
CACHE = OUT / "tiles"; CACHE.mkdir(parents=True, exist_ok=True)
Z = 14
COLS, ROWS = G["cols"], G["rows"]
LON0, LAT0, DLON, DLAT = G["lon0"], G["lat0"], G["dLon"], G["dLat"]

# ---------- Минимальный разбор protobuf / Mapbox Vector Tile ----------
def varint(b, i):
    r = s = 0
    while True:
        x = b[i]; i += 1
        r |= (x & 0x7F) << s; s += 7
        if x < 0x80: return r, i

def fields(b):
    i = 0
    while i < len(b):
        key, i = varint(b, i)
        f, t = key >> 3, key & 7
        if t == 0: v, i = varint(b, i)
        elif t == 2:
            n, i = varint(b, i); v = b[i:i + n]; i += n
        elif t == 5: v = b[i:i + 4]; i += 4
        elif t == 1: v = b[i:i + 8]; i += 8
        else: raise ValueError("wire type %d" % t)
        yield f, t, v

def packed(b):
    out, i = [], 0
    while i < len(b):
        v, i = varint(b, i); out.append(v)
    return out

def value(b):
    import struct
    for f, t, v in fields(b):
        if f == 1: return v.decode("utf-8", "replace")
        if f == 2: return struct.unpack("<f", v)[0]
        if f == 3: return struct.unpack("<d", v)[0]
        if f in (4, 5): return v
        if f == 6: return (v >> 1) ^ -(v & 1)
        if f == 7: return bool(v)

def rings(geom):
    """Команды геометрии → список колец (координаты тайла)."""
    out, cur, x, y, i = [], [], 0, 0, 0
    while i < len(geom):
        cmd, cnt = geom[i] & 7, geom[i] >> 3; i += 1
        if cmd in (1, 2):
            for _ in range(cnt):
                dx, dy = geom[i], geom[i + 1]; i += 2
                x += (dx >> 1) ^ -(dx & 1); y += (dy >> 1) ^ -(dy & 1)
                if cmd == 1 and cur: out.append(cur); cur = []
                cur.append((x, y))
        elif cmd == 7:
            if cur: out.append(cur); cur = []
    if cur: out.append(cur)
    return out

def layers(data):
    res = {}
    for f, t, v in fields(data):
        if f != 3: continue
        name, feats, keys, vals, extent = "", [], [], [], 4096
        for lf, lt, lv in fields(v):
            if lf == 1: name = lv.decode()
            elif lf == 2: feats.append(lv)
            elif lf == 3: keys.append(lv.decode())
            elif lf == 4: vals.append(value(lv))
            elif lf == 5: extent = lv
        out = []
        for fb in feats:
            tags, gtype, geom = [], 0, []
            for ff, ft, fv in fields(fb):
                if ff == 2: tags = packed(fv)
                elif ff == 3: gtype = fv
                elif ff == 4: geom = packed(fv)
            props = {keys[tags[k]]: vals[tags[k + 1]] for k in range(0, len(tags), 2)}
            out.append((props, gtype, geom))
        res[name] = (out, extent)
    return res

# ---------- Тайлы, покрывающие рамку ----------
def tx(lon): return int((lon + 180) / 360 * 2 ** Z)
def ty(lat): return int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 2 ** Z)
def tile_lonlat(x, y, px, py, extent):
    n = 2 ** Z
    lon = (x + px / extent) / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + py / extent) / n))))
    return lon, lat

X0, X1 = tx(LON0), tx(LON0 + COLS * DLON)
Y0, Y1 = ty(LAT0 + ROWS * DLAT), ty(LAT0)

def get(x, y):
    p = CACHE / f"{x}_{y}.pbf"
    if p.exists(): return p.read_bytes()
    url = URL.replace("{z}", str(Z)).replace("{x}", str(x)).replace("{y}", str(y))
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "AlmaMetro-school-project/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r: data = r.read()
            p.write_bytes(data); return data
        except Exception as e:
            print("повтор", x, y, e); time.sleep(3)
    return b""

M_LAT = 111320.0
M_LON = 111320.0 * math.cos(math.radians(LAT0 + ROWS * DLAT / 2))

def area_m2(ring):
    s = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        s += (x1 * M_LON) * (y2 * M_LAT) - (x2 * M_LON) * (y1 * M_LAT)
    return abs(s) / 2

def point_in(poly, x, y):
    inside, j = False, len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]; xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi: inside = not inside
        j = i
    return inside

N = COLS * ROWS
home = [0.0] * N; work = [0.0] * N; built = [0.0] * N
WORK_LANDUSE = {"commercial", "retail", "industrial", "school", "university", "college", "hospital", "railway", "military"}
total = (X1 - X0 + 1) * (Y1 - Y0 + 1); k = 0; nb = 0
for y in range(Y0, Y1 + 1):
    for x in range(X0, X1 + 1):
        k += 1
        data = get(x, y)
        if not data: continue
        L = layers(data)
        # землепользование тайла: кольца + класс
        lu = []
        for props, gtype, geom in L.get("landuse", ([], 4096))[0]:
            cls = props.get("class")
            if gtype == 3 and cls in WORK_LANDUSE | {"residential"}:
                for r in rings(geom): lu.append((cls, r))
        feats, extent = L.get("building", ([], 4096))
        for props, gtype, geom in feats:
            if gtype != 3: continue
            # Одна «фигура» тайла = много домов с одинаковой высотой (склеены).
            # Внешнее кольцо (площадь > 0 в координатах тайла) — отдельный дом, дырки пропускаем.
            h = props.get("render_height") or 6
            levels = max(1, min(float(h) / 3.0, 80))
            for outer in rings(geom):
                if len(outer) < 3: continue
                signed = sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(outer, outer[1:] + outer[:1]))
                if signed <= 0: continue
                cx = sum(p[0] for p in outer) / len(outer); cy = sum(p[1] for p in outer) / len(outer)
                if not (0 <= cx < extent and 0 <= cy < extent): continue  # дом из соседнего тайла (буфер)
                lon, lat = tile_lonlat(x, y, cx, cy, extent)
                c = int((lon - LON0) / DLON); r = int((lat - LAT0) / DLAT)
                if not (0 <= c < COLS and 0 <= r < ROWS): continue
                i = r * COLS + c
                geo = [tile_lonlat(x, y, px, py, extent) for px, py in outer]
                a = area_m2(geo)
                floor = a * levels
                cls = next((cl for cl, ring in lu if point_in(ring, cx, cy)), None)
                if cls == "residential": share = 0.92
                elif cls in WORK_LANDUSE: share = 0.08
                else: share = 0.7 if levels >= 4 else 0.55
                home[i] += floor * share; work[i] += floor * (1 - share); built[i] += a
                nb += 1
        if k % 50 == 0: print(f"{k}/{total} тайлов, домов {nb}")
        time.sleep(0.05)

(OUT / "buildings_cells.json").write_text(json.dumps({"home": home, "work": work, "built": built}), encoding="utf-8")
print("готово: тайлов", total, "домов", nb)
