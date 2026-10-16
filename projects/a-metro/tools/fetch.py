"""Скачивает данные OSM для AlmaMetro через Overpass API в указанную папку."""
import json, sys, time, urllib.request, urllib.parse, pathlib

OUT = pathlib.Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
BBOX = "43.10,76.60,43.42,77.25"   # юг, запад, север, восток
SERVERS = ["https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
           "https://overpass.kumi.systems/api/interpreter", "https://overpass-api.de/api/interpreter"]

QUERIES = {
    "roads": f"""[out:json][timeout:300];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link)$"]({BBOX});
out tags geom;""",
    "metro": f"""[out:json][timeout:180];
(
  way["railway"="subway"]({BBOX});
  way["railway"="construction"]["construction"="subway"]({BBOX});
  nwr["station"="subway"]({BBOX});
  nwr["railway"="station"]["subway"="yes"]({BBOX});
);
out tags geom;""",
    "pois": f"""[out:json][timeout:180];
(
  nwr["shop"="mall"]({BBOX});
  nwr["amenity"~"^(university|college|marketplace|hospital)$"]({BBOX});
  nwr["railway"="station"]["station"!="subway"]["subway"!="yes"]({BBOX});
  nwr["aeroway"="aerodrome"]({BBOX});
  nwr["leisure"="stadium"]({BBOX});
);
out center tags;""",
    "nature": f"""[out:json][timeout:180];
(
  way["waterway"="river"]({BBOX});
  nwr["leisure"="park"]({BBOX});
  nwr["landuse"~"^(forest|cemetery)$"]({BBOX});
  nwr["aeroway"~"^(runway|aerodrome)$"]({BBOX});
  way["railway"="rail"]({BBOX});
);
out tags geom;""",
    "districts": f"""[out:json][timeout:300];
rel["boundary"="administrative"]["admin_level"="6"]({BBOX});
out geom;""",
    "route": f"""[out:json][timeout:180];
rel["route"="subway"]({BBOX});
out geom;""",
    "buildings": f"""[out:json][timeout:900][maxsize:2000000000];
way["building"]({BBOX});
convert b ::id=id(), ::geom=center(geom()), b=t["building"], l=t["building:levels"], h=t["height"], p=length();
out geom;""",
}

def fetch(name, query):
    target = OUT / f"{name}.json"
    if target.exists() and target.stat().st_size > 100:
        print(name, "уже есть", target.stat().st_size)
        return
    data = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(4):
        url = SERVERS[attempt % len(SERVERS)]
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "AlmaMetro-school-project/1.0"})
            t0 = time.time()
            with urllib.request.urlopen(req, timeout=1000) as r:
                body = r.read()
            json.loads(body)  # проверяем, что это JSON
            target.write_bytes(body)
            print(name, "ok", len(body), "байт за", round(time.time() - t0), "с с", url)
            return
        except Exception as e:
            print(name, "ошибка", url, e)
            time.sleep(15)
    print(name, "НЕ СКАЧАН")

# Здания — кусками 4×3, чтобы сервер не падал по таймауту
S, W, Nn, E = map(float, BBOX.split(","))
for a in range(3):
    for b in range(4):
        s, n = S + (Nn - S) * a / 3, S + (Nn - S) * (a + 1) / 3
        w, e = W + (E - W) * b / 4, W + (E - W) * (b + 1) / 4
        QUERIES[f"bld_{a}{b}"] = f"""[out:json][timeout:300];
way["building"]({s:.4f},{w:.4f},{n:.4f},{e:.4f});
convert b ::id=id(), ::geom=center(geom()), b=t["building"], l=t["building:levels"], h=t["height"], p=length();
out geom;"""

names = sys.argv[2:] or [k for k in QUERIES if k != "buildings"]
if names == ["bld"]:
    names = [k for k in QUERIES if k.startswith("bld_")]
for n in names:
    fetch(n, QUERIES[n])
