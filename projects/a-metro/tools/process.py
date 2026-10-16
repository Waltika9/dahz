"""Превращает скачанные данные OSM в компактные файлы для игры AlmaMetro.
Аргументы: папка с сырыми данными, файл сетки, папка вывода (projects/a-metro/data)."""
import json, math, sys, pathlib, collections

RAW = pathlib.Path(sys.argv[1])
G = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
OUT = pathlib.Path(sys.argv[3]); OUT.mkdir(parents=True, exist_ok=True)

COLS, ROWS = G["cols"], G["rows"]
LON0, LAT0, DLON, DLAT = G["lon0"], G["lat0"], G["dLon"], G["dLat"]
N = COLS * ROWS
M_LAT = 111320.0
M_LON = 111320.0 * math.cos(math.radians(LAT0 + ROWS * DLAT / 2))
CELL_AREA = G["cell"] ** 2

TARGET_POP = 2_700_000   # Алматы ≈ 2,3 млн + пригороды в рамке карты
TARGET_JOBS = 1_250_000

def load(name):
    p = RAW / f"{name}.json"
    return json.loads(p.read_text(encoding="utf-8"))["elements"] if p.exists() else []

def cell(lon, lat):
    c = int((lon - LON0) / DLON); r = int((lat - LAT0) / DLAT)
    return r * COLS + c if 0 <= c < COLS and 0 <= r < ROWS else None

def center(i):
    r, c = divmod(i, COLS)
    return LON0 + (c + 0.5) * DLON, LAT0 + (r + 0.5) * DLAT

def dist(a, b):
    return math.hypot((a[0] - b[0]) * M_LON, (a[1] - b[1]) * M_LAT)

def sample(coords, step=50):
    """Точки вдоль линии каждые step метров: (lon, lat, длина куска)."""
    for a, b in zip(coords, coords[1:]):
        d = dist(a, b)
        n = max(1, int(d / step))
        for k in range(n):
            t = (k + 0.5) / n
            yield a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, d / n

def geom(e):
    return [(p["lon"], p["lat"]) for p in e.get("geometry") or [] if p]

def simplify(pts, tol=8.0):
    """Дуглас–Пекер в метрах."""
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    ax, ay, bx, by = a[0] * M_LON, a[1] * M_LAT, b[0] * M_LON, b[1] * M_LAT
    L = math.hypot(bx - ax, by - ay) or 1e-9
    best, idx = -1, 0
    for i in range(1, len(pts) - 1):
        px, py = pts[i][0] * M_LON, pts[i][1] * M_LAT
        d = abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / L
        if d > best:
            best, idx = d, i
    if best <= tol:
        return [a, b]
    return simplify(pts[:idx + 1], tol)[:-1] + simplify(pts[idx:], tol)

def rnd(p):
    return [round(p[0], 5), round(p[1], 5)]

def point_in(poly, x, y):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]; xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside

def fill_polygon(poly, arr, value=1):
    """Ставит value в клетки, чей центр внутри многоугольника."""
    xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
    c0 = max(0, int((min(xs) - LON0) / DLON)); c1 = min(COLS - 1, int((max(xs) - LON0) / DLON))
    r0 = max(0, int((min(ys) - LAT0) / DLAT)); r1 = min(ROWS - 1, int((max(ys) - LAT0) / DLAT))
    hit = 0
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            i = r * COLS + c
            if point_in(poly, *center(i)):
                arr[i] = value; hit += 1
    if hit == 0:  # маленький объект: хотя бы клетка с его центром
        i = cell(sum(xs) / len(xs), sum(ys) / len(ys))
        if i is not None: arr[i] = value

def rings(e):
    """Внешние кольца: замкнутая линия или склейка внешних частей отношения."""
    if e["type"] == "way":
        g = geom(e)
        return [g] if len(g) > 3 and g[0] == g[-1] else []
    parts = [[(p["lon"], p["lat"]) for p in m["geometry"]] for m in e.get("members", [])
             if m.get("role") in ("outer", "") and m.get("geometry")]
    out = []
    while parts:
        ring = parts.pop(0)
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for k, p in enumerate(parts):
                if p[0] == ring[-1]: ring += p[1:]
                elif p[-1] == ring[-1]: ring += p[::-1][1:]
                elif p[-1] == ring[0]: ring = p[:-1] + ring
                elif p[0] == ring[0]: ring = p[::-1][:-1] + ring
                else: continue
                parts.pop(k); changed = True; break
        if len(ring) > 3 and ring[0] == ring[-1]:
            out.append(ring)
    return out

# ===== Дороги =====
ROAD_CLASS = {"motorway": 0, "trunk": 0, "primary": 1, "secondary": 2, "tertiary": 3}
ROAD_WEIGHT = [6.0, 4.0, 3.0, 2.0, 1.5]   # «полосность»: сколько машин пропускает
roadcap = [0.0] * N
features = []
for e in load("roads"):
    h = e["tags"].get("highway", "")
    k = ROAD_CLASS.get(h, 4)
    g = geom(e)
    if len(g) < 2: continue
    for lon, lat, d in sample(g):
        i = cell(lon, lat)
        if i is not None: roadcap[i] += d * ROAD_WEIGHT[k] / 1000  # км × полосы
    s = simplify(g)
    features.append({"type": "Feature", "properties": {"k": k},
                     "geometry": {"type": "LineString", "coordinates": [rnd(p) for p in s]}})
(OUT / "roads.json").write_text(json.dumps({"type": "FeatureCollection", "features": features},
                                           separators=(",", ":")), encoding="utf-8")
print("дорог:", len(features), "точек:", sum(len(f["geometry"]["coordinates"]) for f in features))

# ===== Природа, ж/д, аэропорт =====
water = [0] * N; park = [0] * N; rail = [0] * N; airport = [0] * N
for e in load("nature"):
    t = e.get("tags", {})
    if t.get("waterway") == "river":
        for lon, lat, _ in sample(geom(e), 40):
            i = cell(lon, lat)
            if i is not None: water[i] = 1
    elif t.get("railway") == "rail":
        for lon, lat, _ in sample(geom(e), 40):
            i = cell(lon, lat)
            if i is not None: rail[i] = 1
    elif t.get("aeroway") in ("runway", "aerodrome"):
        if t.get("aeroway") == "runway":
            for lon, lat, _ in sample(geom(e), 40):
                i = cell(lon, lat)
                if i is not None: airport[i] = 1
        for ring in rings(e): fill_polygon(ring, airport)
    else:  # парки, леса, кладбища
        for ring in rings(e):
            # крошечные скверы не считаем — это не помеха стройке
            xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
            if (max(xs) - min(xs)) * M_LON * (max(ys) - min(ys)) * M_LAT > 0.4 * CELL_AREA:
                fill_polygon(ring, park)
print("река:", sum(water), "парки:", sum(park), "ж/д:", sum(rail), "аэропорт:", sum(airport))

# ===== Районы =====
district = [-1] * N; district_names = []
for e in load("districts"):
    t = e.get("tags", {})
    name = t.get("name:ru") or t.get("name")
    if not name or "район" not in name.lower(): continue
    rs = rings(e)
    if not rs: continue
    k = len(district_names); district_names.append(name)
    for ring in rs: fill_polygon(ring, district, k)
print("районов:", len(district_names), district_names)

# ===== Здания: жители, рабочие места, застроенность =====
HOME_TYPES = {"apartments", "residential", "house", "detached", "dormitory", "terrace", "semidetached_house", "bungalow"}
JOB_TYPES = {"commercial", "office", "retail", "industrial", "warehouse", "school", "university", "college",
             "hospital", "public", "government", "kindergarten", "hotel", "supermarket", "service", "civic",
             "train_station", "transportation", "mall", "factory", "manufacture", "clinic", "sports_centre", "stadium"}
SKIP_TYPES = {"garage", "garages", "shed", "roof", "hut", "construction", "carport", "ruins", "greenhouse", "kiosk", "toilets"}
DEFAULT_LEVELS = {"apartments": 5, "residential": 5, "house": 1, "detached": 1, "yes": 2, "industrial": 1, "warehouse": 1}

pop = [0.0] * N; jobs = [0.0] * N; built = [0.0] * N
nb = 0
for e in load("buildings"):
    t = e.get("tags", {})
    b = t.get("b", "yes")
    if b in SKIP_TYPES: continue
    g = e.get("geometry") or {}
    co = g.get("coordinates")
    if not co: continue
    i = cell(co[0], co[1])
    if i is None: continue
    try: per = float(t.get("p") or 0)
    except ValueError: per = 0
    area = min((per / 4) ** 2 * 0.9, 40000) if per > 0 else 100
    lv = None
    try: lv = float(t.get("l")) if t.get("l") else None
    except ValueError: pass
    if lv is None and t.get("h"):
        try: lv = float(str(t["h"]).split()[0]) / 3
        except ValueError: pass
    lv = max(1, min(lv or DEFAULT_LEVELS.get(b, 2), 80))
    floor = area * lv
    built[i] += area
    if b in HOME_TYPES:
        pop[i] += floor
    elif b in JOB_TYPES:
        jobs[i] += floor
    else:  # «просто здание»: многоэтажки чаще жилые, низкие — смешанные
        share = 0.75 if lv >= 4 else 0.55
        pop[i] += floor * share; jobs[i] += floor * (1 - share)
    nb += 1
print("зданий учтено (Overpass):", nb)

# Запасной путь: дома из векторных тайлов (tiles.py), уже разложенные по клеткам
bc = RAW / "buildings_cells.json"
if nb == 0 and bc.exists():
    d = json.loads(bc.read_text(encoding="utf-8"))
    pop, jobs, built = d["home"], d["work"], d["built"]
    print("дома взяты из тайлов")

def scale(arr, total):
    s = sum(arr) or 1
    return [round(v * total / s) for v in arr]
pop = scale(pop, TARGET_POP)
jobs = scale(jobs, TARGET_JOBS)
built = [min(100, round(v / CELL_AREA * 100)) for v in built]

# ===== Места притяжения людей =====
ATTR = {"mall": ("ТЦ", 9000), "university": ("Университет", 6000), "college": ("Колледж", 2500),
        "marketplace": ("Рынок", 7000), "hospital": ("Больница", 2500), "station": ("Вокзал", 6000),
        "aerodrome": ("Аэропорт", 8000), "stadium": ("Стадион", 3000)}
attr = [0] * N; pois = []
for e in load("pois"):
    t = e.get("tags", {})
    kind = ("mall" if t.get("shop") == "mall" else t.get("amenity") if t.get("amenity") in ATTR
            else "station" if t.get("railway") == "station" else "aerodrome" if t.get("aeroway") == "aerodrome"
            else "stadium" if t.get("leisure") == "stadium" else None)
    if not kind: continue
    lon = e.get("lon") or (e.get("center") or {}).get("lon"); lat = e.get("lat") or (e.get("center") or {}).get("lat")
    if lon is None: continue
    i = cell(lon, lat)
    if i is None: continue
    attr[i] += ATTR[kind][1]
    name = t.get("name:ru") or t.get("name")
    if name: pois.append({"n": name, "k": kind, "c": rnd((lon, lat))})
print("мест притяжения:", len(pois))

# ===== Метро =====
stations_raw = []
for e in load("metro"):
    t = e.get("tags", {})
    if e["type"] == "node" and (t.get("station") == "subway" or t.get("subway") == "yes"):
        stations_raw.append({"n": t.get("name:ru") or t.get("name") or "", "c": (e["lon"], e["lat"])})

def name_near(pt, maxd=350):
    best = min(stations_raw, key=lambda s: dist(s["c"], pt), default=None)
    return best["n"] if best and dist(best["c"], pt) < maxd else ""

line = {"name": "Линия 1", "path": [], "stations": []}
routes = load("route")
if routes:
    rel = max(routes, key=lambda r: len(r.get("members", [])))
    path, pieces = [], 0
    for m in rel["members"]:
        if m["type"] == "way" and m.get("geometry") and m.get("role", "") in ("", "forward", "backward"):
            seg = [(p["lon"], p["lat"]) for p in m["geometry"]]
            if pieces == 1:
                # первый кусок мог быть записан задом наперёд — разворачиваем по второму
                ends = [dist(path[0], seg[0]), dist(path[0], seg[-1]), dist(path[-1], seg[0]), dist(path[-1], seg[-1])]
                if min(ends) in ends[:2]: path = path[::-1]
            if path and dist(path[-1], seg[-1]) < dist(path[-1], seg[0]):
                seg = seg[::-1]  # кусок продолжает путь с другого конца
            path += seg
            pieces += 1
        elif m["type"] == "node" and m.get("role", "").startswith("stop"):
            pt = (m["lon"], m["lat"])
            line["stations"].append({"n": name_near(pt) or "Станция", "c": rnd(pt)})
    line["path"] = [rnd(p) for p in simplify(path, 5)]
used = {s["n"] for s in line["stations"]}
building = []
for s in stations_raw:
    if s["n"] and s["n"] not in used:
        used.add(s["n"]); building.append({"n": s["n"], "c": rnd(s["c"])})
(OUT / "metro.json").write_text(json.dumps({"lines": [line], "construction": building}, ensure_ascii=False,
                                           separators=(",", ":")), encoding="utf-8")
print("метро:", line["name"], "станций:", len(line["stations"]), [s["n"] for s in line["stations"]],
      "точек пути:", len(line["path"]), "строятся/прочие:", [s["n"] for s in building])

# ===== Высоты =====
elev_rows = json.loads((RAW / "elev.json").read_text(encoding="utf-8"))
elev = [v for row in elev_rows for v in row]

city = {
    "v": 1, "cell": G["cell"], "cols": COLS, "rows": ROWS,
    "lon0": LON0, "lat0": LAT0, "dLon": DLON, "dLat": DLAT,
    "pop": pop, "jobs": jobs, "attr": attr, "built": built,
    "road": [round(v, 1) for v in roadcap], "water": water, "park": park, "rail": rail, "airport": airport,
    "elev": elev, "district": district, "districtNames": district_names, "pois": pois,
}
(OUT / "city.json").write_text(json.dumps(city, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("жителей:", sum(pop), "работ:", sum(jobs), "клеток с жителями:", sum(1 for v in pop if v > 50))
for f in OUT.iterdir(): print(f.name, f.stat().st_size)
