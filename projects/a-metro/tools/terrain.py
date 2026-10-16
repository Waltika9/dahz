"""Скачивает тайлы высот Terrain Tiles (terrarium) z11 для области AlmaMetro и
сохраняет сетку высот в JSON: elev[row][col] для центров клеток игры."""
import json, math, sys, struct, urllib.request, zlib, pathlib

OUT = pathlib.Path(sys.argv[1])
GRID = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))  # lon0, lat0, dLon, dLat, cols, rows
Z = 11

def tile_xy(lon, lat):
    n = 2 ** Z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y

def decode_png(data):
    """Минимальный декодер PNG (8 бит RGB/RGBA, без интерлейса)."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos, idat, w = 8, b"", 0
    while pos < len(data):
        ln, typ = struct.unpack(">I4s", data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", chunk[:10])
            bpp = {2: 3, 6: 4}[ctype]
        elif typ == b"IDAT":
            idat += chunk
        pos += 12 + ln
    raw = zlib.decompress(idat)
    stride = w * bpp
    rows, prev, i = [], bytearray(stride), 0
    for _ in range(h):
        f = raw[i]; line = bytearray(raw[i + 1:i + 1 + stride]); i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]; c = prev[x - bpp] if x >= bpp else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c; pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line); prev = line
    return w, bpp, rows

cache = {}
def tile(tx, ty):
    if (tx, ty) not in cache:
        url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png"
        req = urllib.request.Request(url, headers={"User-Agent": "AlmaMetro-school-project/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            cache[(tx, ty)] = decode_png(r.read())
    return cache[(tx, ty)]

def elevation(lon, lat):
    x, y = tile_xy(lon, lat)
    tx, ty = int(x), int(y)
    w, bpp, rows = tile(tx, ty)
    px, py = int((x - tx) * w), int((y - ty) * w)
    r, g, b = rows[py][px * bpp:px * bpp + 3]
    return r * 256 + g + b / 256 - 32768

g = GRID
elev = []
for row in range(g["rows"]):
    lat = g["lat0"] + (row + 0.5) * g["dLat"]
    elev.append([round(elevation(g["lon0"] + (col + 0.5) * g["dLon"], lat)) for col in range(g["cols"])])
OUT.write_text(json.dumps(elev), encoding="utf-8")
print("тайлов:", len(cache), "мин/макс высота:", min(map(min, elev)), max(map(max, elev)))
