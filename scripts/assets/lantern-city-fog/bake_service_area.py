"""Bakes the Lantern City world for the neighbourhoods we serve into static tiles the admin app
streams: real OpenStreetMap footprints (LA County import: height, ground elevation, units), roads,
water and parks, a terrain grid, and the service-area outline from the Mapping L.A. boundaries
already in the repo.

    python3 scripts/assets/lantern-city-fog/bake_service_area.py [--cache DIR]

Writes client/public/assets/goldline/lantern-city/v7/world/{manifest.json, tiles/*.json}.
Map data © OpenStreetMap contributors (ODbL).
"""
import json
import math
import os
import sys
import time
import subprocess

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import binary_dilation, gaussian_filter
from scipy.spatial import cKDTree

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
OUT = os.path.join(REPO, "client/public/assets/goldline/lantern-city/v7/world")
CACHE = sys.argv[sys.argv.index("--cache") + 1] if "--cache" in sys.argv else os.path.join(REPO, "tmp/lantern-osm-cache")
SERVED = ["Silver Lake", "East Hollywood", "Los Feliz", "Hollywood", "West Hollywood", "Beverly Hills", "Century City", "Koreatown"]
TILE = 1000.0          # metres
MASK_CELL = 10.0       # metres
TERRAIN_CELL = 25.0

hoods = json.load(open(os.path.join(REPO, "shared/data/mapping-la/la-county-neighborhoods-v5.geojson")))["features"]
allp = {}
for f in hoods:
    g = f["geometry"]
    allp[f["properties"]["name"]] = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
assert all(n in allp for n in SERVED), set(SERVED) - set(allp)


# The neighbourhoods between the ones we serve. They are part of the world (fogged until won), so
# the map is one continuous board. Add a name here to extend the board.
BETWEEN = ["Beverly Grove", "Fairfax", "Carthay", "Hancock Park", "Larchmont", "Windsor Square", "Mid-Wilshire"]
assert all(n in allp for n in BETWEEN), set(BETWEEN) - set(allp)
print("served:", SERVED)
print("between (fogged until won):", BETWEEN)
polys = {n: allp[n] for n in SERVED + BETWEEN}
lons = [x for pp in polys.values() for p in pp for x, _ in p[0]]
lats = [y for pp in polys.values() for p in pp for _, y in p[0]]
S, W, N, E = min(lats) - 0.002, min(lons) - 0.002, max(lats) + 0.002, max(lons) + 0.002
LAT0, LON0 = (S + N) / 2, (W + E) / 2
KX = 111320 * math.cos(math.radians(LAT0))
KZ = 110540


def xy(lon, lat):
    return ((lon - LON0) * KX, -(lat - LAT0) * KZ)


X0, Z0 = xy(W, N)
X1, Z1 = xy(E, S)
print(f"service area {X1 - X0:.0f} x {Z1 - Z0:.0f} m")

# service-area mask (and a buffer for roads that run along the edge)
mw, mh = int((X1 - X0) / MASK_CELL) + 1, int((Z1 - Z0) / MASK_CELL) + 1
img = Image.new("L", (mw, mh), 0)
dr = ImageDraw.Draw(img)
outline = []
for name, pp in polys.items():
    for p in pp:
        ring = [xy(x, y) for x, y in p[0]]
        dr.polygon([((x - X0) / MASK_CELL, (z - Z0) / MASK_CELL) for x, z in ring], fill=255)
        outline.append({"n": name, "served": name in SERVED, "p": [[round(x, 1), round(z, 1)] for x, z in ring[::2]]})
        for hole in p[1:]:
            dr.polygon([((xy(*q)[0] - X0) / MASK_CELL, (xy(*q)[1] - Z0) / MASK_CELL) for q in hole], fill=0)
mask = np.array(img) > 0
near = binary_dilation(mask, iterations=12)      # 120 m


def inside(x, z, m=mask):
    i, j = int((x - X0) / MASK_CELL), int((z - Z0) / MASK_CELL)
    return 0 <= i < mw and 0 <= j < mh and bool(m[j, i])


# ---------------------------------------------------------------- Overpass, in cached chunks
os.makedirs(CACHE, exist_ok=True)
QUERY = """[out:json][timeout:180];
(
  way["building"]({s},{w},{n},{e});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)$"]({s},{w},{n},{e});
  way["natural"="water"]({s},{w},{n},{e});
  relation["natural"="water"]({s},{w},{n},{e});
  way["leisure"~"^(park|pitch|playground|golf_course)$"]({s},{w},{n},{e});
);
out geom;"""
elements = {}
# public Overpass instances serving the same OpenStreetMap data; one worker each, in parallel
MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
           "https://overpass.private.coffee/api/interpreter"]
nx_c, ny_c = 10, 6
jobs = []
for i in range(nx_c):
    for j in range(ny_c):
        w_, e_ = W + (E - W) * i / nx_c, W + (E - W) * (i + 1) / nx_c
        s_, n_ = S + (N - S) * j / ny_c, S + (N - S) * (j + 1) / ny_c
        cx0, cz0 = xy(w_, n_)
        cx1, cz1 = xy(e_, s_)
        sub = near[max(0, int((cz0 - Z0) / MASK_CELL)):int((cz1 - Z0) / MASK_CELL) + 1, max(0, int((cx0 - X0) / MASK_CELL)):int((cx1 - X0) / MASK_CELL) + 1]
        if sub.any():
            jobs.append((i, j, QUERY.format(s=s_, w=w_, n=n_, e=e_), os.path.join(CACHE, f"chunk_{i}_{j}.json")))
todo = [jb for jb in jobs if not os.path.exists(jb[3])]
print(f"{len(jobs)} chunks, {len(todo)} to fetch", flush=True)
import queue
import threading
q_ = queue.Queue()
for jb in todo:
    q_.put(jb)
failed = []


def worker(endpoint):
    while True:
        try:
            i, j, q, path = q_.get_nowait()
        except queue.Empty:
            return
        tmp = path + f".{abs(hash(endpoint)) % 1000}.part"
        ok = False
        for attempt in range(4):
            subprocess.run(["curl", "-s", "-m", "300", "-A", "joystick-lantern-city-bake/0.1", "--data-urlencode", "data@-", endpoint, "-o", tmp],
                           input=q.encode())
            try:
                json.load(open(tmp))
                os.replace(tmp, path)
                ok = True
                break
            except Exception:
                time.sleep(15 * (attempt + 1))
        if not ok:
            # hand it to another mirror
            q_.put((i, j, q, path)) if len(failed) < 60 else None
            failed.append((i, j))
            time.sleep(30)
        print(f"chunk {i},{j} {'ok' if ok else 'retry elsewhere'} via {endpoint.split('/')[2]} ({len(jobs) - q_.qsize()} of {len(jobs)})", flush=True)


threads = [threading.Thread(target=worker, args=(m,)) for m in MIRRORS]
for t_ in threads:
    t_.start()
for t_ in threads:
    t_.join()
missing = [jb for jb in jobs if not os.path.exists(jb[3])]
if missing:
    raise SystemExit(f"{len(missing)} chunks could not be fetched; rerun to resume")
for *_, path in jobs:
    for el in json.load(open(path))["elements"]:
        elements[(el["type"], el["id"])] = el
print(len(elements), "elements", flush=True)

# ---------------------------------------------------------------- features
TYPES = ["house", "apartments", "residential", "retail", "commercial", "yes", "garage", "office", "school", "hotel", "industrial", "church", "other"]
buildings, roads, water, parks = [], [], [], []


def area(r):
    a = 0
    for k in range(len(r)):
        x1, z1 = r[k]
        x2, z2 = r[(k + 1) % len(r)]
        a += x1 * z2 - x2 * z1
    return a / 2


for (kind, _), el in elements.items():
    t = el.get("tags", {})
    if kind == "relation":
        if t.get("natural") == "water":
            for m in el.get("members", []):
                if m.get("role") == "outer" and m.get("geometry"):
                    ring = [xy(p["lon"], p["lat"]) for p in m["geometry"]]
                    if any(inside(x, z, near) for x, z in ring):
                        water.append(ring)
        continue
    g = el.get("geometry")
    if not g:
        continue
    pts = [xy(p["lon"], p["lat"]) for p in g]
    if "building" in t:
        if len(pts) < 4:
            continue
        ring = pts[:-1]
        a = area(ring)
        if abs(a) < 12:
            continue
        if a < 0:
            ring = ring[::-1]
        cx = sum(p[0] for p in ring) / len(ring)
        cz = sum(p[1] for p in ring) / len(ring)
        if not inside(cx, cz):
            continue
        try:
            h = float(t.get("height", 0) or 0)
        except ValueError:
            h = 0
        if not h:
            lv = t.get("building:levels")
            h = float(lv) * 3.2 if lv and lv.replace(".", "", 1).isdigit() else (5.5 if t["building"] == "house" else 8.0)
        try:
            ele = float(t["ele"]) if "ele" in t else None
        except ValueError:
            ele = None
        u = t.get("building:units")
        u = int(float(u)) if u and u.replace(".", "", 1).isdigit() else 0
        ty = t["building"] if t["building"] in TYPES else "other"
        buildings.append({"ring": ring, "cx": cx, "cz": cz, "h": max(2.5, min(h, 220.0)), "e": ele, "u": u, "t": TYPES.index(ty),
                          "ain": t.get("lacounty:ain", ""), "area": abs(a),
                          "name": t.get("name", ""), "addr": (t.get("addr:housenumber", "") + " " + t.get("addr:street", "")).strip()})
    elif "highway" in t:
        if any(inside(x, z, near) for x, z in pts):
            roads.append({"k": t["highway"], "n": t.get("name", ""), "p": pts})
    elif t.get("natural") == "water":
        if any(inside(x, z, near) for x, z in pts):
            water.append(pts[:-1])
    elif "leisure" in t:
        if any(inside(x, z, near) for x, z in pts):
            parks.append(pts[:-1])
# LA County tags every building on a parcel with the parcel's total units (each Park La Brea tower
# says 770): count a parcel's units once, on its largest building
by_parcel = {}
for b in buildings:
    if b["ain"] and b["u"]:
        by_parcel.setdefault(b["ain"], []).append(b)
for group in by_parcel.values():
    keep = max(group, key=lambda b: b["area"])
    for b in group:
        if b is not keep:
            b["u"] = 0
print(len(buildings), "buildings", len(roads), "roads", len(water), "water", len(parks), "parks")

# ---------------------------------------------------------------- terrain from building elevations
cent = np.array([[b["cx"], b["cz"]] for b in buildings if b["e"] is not None])
ele = np.array([b["e"] for b in buildings if b["e"] is not None])
tree = cKDTree(cent)
tnx, tnz = int((X1 - X0) / TERRAIN_CELL) + 1, int((Z1 - Z0) / TERRAIN_CELL) + 1
gx, gz = np.meshgrid(X0 + np.arange(tnx) * TERRAIN_CELL, Z0 + np.arange(tnz) * TERRAIN_CELL)
d, ix = tree.query(np.stack([gx.ravel(), gz.ravel()], 1), k=10)
wgt = 1 / np.maximum(d, 6) ** 2
grid = gaussian_filter(((ele[ix] * wgt).sum(1) / wgt.sum(1)).reshape(tnz, tnx), 1.4)
base = float(np.percentile(grid, 1))
grid = grid - base

# ---------------------------------------------------------------- tiles
os.makedirs(os.path.join(OUT, "tiles"), exist_ok=True)
for fn in os.listdir(os.path.join(OUT, "tiles")):
    os.remove(os.path.join(OUT, "tiles", fn))
tiles = {}
for b in buildings:
    key = (int((b["cx"] - X0) // TILE), int((b["cz"] - Z0) // TILE))
    tiles.setdefault(key, {"b": [], "r": []})["b"].append(b)
for r in roads:
    keys = {(int((x - X0) // TILE), int((z - Z0) // TILE)) for x, z in r["p"]}
    for key in keys:
        tiles.setdefault(key, {"b": [], "r": []})["r"].append(r)
index = []
total = 0
for (ti, tj), content in sorted(tiles.items()):
    ox, oz = X0 + ti * TILE, Z0 + tj * TILE
    bl = []
    for b in content["b"]:
        flat = []
        for x, z in b["ring"]:
            flat += [round((x - ox) * 10), round((z - oz) * 10)]
        rec = [flat, round(b["h"] * 10), b["u"], b["t"]]
        if b["name"] or b["addr"]:
            rec.append(b["name"] or b["addr"])
        bl.append(rec)
    rl = []
    seen = set()
    for r in content["r"]:
        flat = []
        for x, z in r["p"]:
            flat += [round((x - ox) * 10), round((z - oz) * 10)]
        k = (r["k"], tuple(flat[:4]))
        if k in seen:
            continue
        seen.add(k)
        rl.append([r["k"], r["n"], flat])
    body = json.dumps({"o": [round(ox, 1), round(oz, 1)], "b": bl, "r": rl}, separators=(",", ":"))
    open(os.path.join(OUT, "tiles", f"{ti}_{tj}.json"), "w").write(body)
    total += len(body)
    index.append([ti, tj, len(bl)])
# doors grid (for the map's uncharted-land cards) and the named main roads (to say where a place is)
DC = 100.0
dnx, dnz = int((X1 - X0) / DC) + 1, int((Z1 - Z0) / DC) + 1
doors = np.zeros((dnz, dnx), dtype=np.int32)
for b in buildings:
    doors[int((b["cz"] - Z0) // DC), int((b["cx"] - X0) // DC)] += max(1, b["u"])
major = {}
for r in roads:
    if r["k"] in ("primary", "secondary", "trunk") and r["n"]:
        major.setdefault(r["n"], []).extend([[round(x), round(z)] for x, z in r["p"][::3]])
manifest = {
    "version": 1,
    "attribution": "Map data © OpenStreetMap contributors (ODbL). Neighbourhood boundaries: Mapping L.A. (Los Angeles Times).",
    "origin": [LAT0, LON0], "kx": KX, "kz": KZ,
    "bounds": [round(X0, 1), round(Z0, 1), round(X1, 1), round(Z1, 1)],
    "tile": TILE, "tiles": index,
    "served": SERVED, "between": BETWEEN, "outline": outline,
    "mask": {"cell": MASK_CELL, "w": mw, "h": mh},
    "terrain": {"cell": TERRAIN_CELL, "nx": tnx, "nz": tnz, "base": round(base, 1),
                "h": [round(v * 10) for v in grid.ravel().tolist()]},
    "water": [[[round(x, 1), round(z, 1)] for x, z in w] for w in water],
    "parks": [[[round(x, 1), round(z, 1)] for x, z in p] for p in parks],
    "doors": {"cell": DC, "nx": dnx, "nz": dnz, "v": doors.ravel().tolist()},
    "major": major,
}
json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), separators=(",", ":"))
# the service-area mask as a PNG (the page samples it to decide where land exists)
Image.fromarray((mask * 255).astype(np.uint8)).save(os.path.join(OUT, "mask.png"), optimize=True)
print(f"{len(index)} tiles, {total / 1e6:.1f} MB tiles, manifest {os.path.getsize(os.path.join(OUT, 'manifest.json')) / 1e6:.1f} MB")
