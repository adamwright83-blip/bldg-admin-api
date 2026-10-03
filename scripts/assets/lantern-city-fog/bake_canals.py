"""Canals between neighbourhoods, as vector paths plus a fine distance field.

Every border two board neighbourhoods share becomes a canal: the shared stretch of boundary is
traced, simplified and corner-rounded (so a street-grid border becomes a canal that bends), then
written as polylines (the renderer builds water, walls, coping and bridges from them) and as a
distance field in metres (the renderer uses it to open the ground, keep buildings back, and cut the
fog into islands).

    python3 scripts/assets/lantern-city-fog/bake_canals.py

Reads world/manifest.json (bake_service_area.py); writes world/canals.json and world/canal.png.
"""
import json
import math
import os

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
WORLD = os.path.join(REPO, "client/public/assets/goldline/lantern-city/v7/world")
m = json.load(open(os.path.join(WORLD, "manifest.json")))
X0, Z0, X1, Z1 = m["bounds"]
names = m["served"] + m["between"]
lat0, lon0 = m["origin"]
kx, kz = m["kx"], m["kz"]
STEP = 5.0            # densify boundaries to this spacing (m)
SHARED = 45.0         # a boundary point is shared if another neighbourhood's boundary is this close
FIELD = 4.0           # distance-field resolution (m per pixel)


def xy(lon, lat):
    return ((lon - lon0) * kx, -(lat - lat0) * kz)


hoods = json.load(open(os.path.join(REPO, "shared/data/mapping-la/la-county-neighborhoods-v5.geojson")))["features"]
rings = {}
for f in hoods:
    n = f["properties"]["name"]
    if n not in names:
        continue
    g = f["geometry"]
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    rings[n] = []
    for p in polys:
        ring = [xy(lon, lat) for lon, lat in p[0]]
        dense = []
        for (ax, az), (bx, bz) in zip(ring, ring[1:] + ring[:1]):
            L = math.hypot(bx - ax, bz - az)
            k = max(1, int(L / STEP))
            dense += [(ax + (bx - ax) * i / k, az + (bz - az) * i / k) for i in range(k)]
        if len(dense) > 8:
            rings[n].append(np.array(dense))

# every other neighbourhood's boundary points, for the "is this border shared" test
trees = {n: cKDTree(np.concatenate(rs)) for n, rs in rings.items()}


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0]), np.array(pts[-1])
    ab = b - a
    L = np.linalg.norm(ab) or 1e-9
    d = [abs(np.cross(ab, np.array(p) - a)) / L for p in pts[1:-1]]
    i = int(np.argmax(d)) + 1
    if d[i - 1] > eps:
        return rdp(pts[:i + 1], eps)[:-1] + rdp(pts[i:], eps)
    return [pts[0], pts[-1]]


def chaikin(pts, it=3):
    for _ in range(it):
        out = [pts[0]]
        for p, q in zip(pts, pts[1:]):
            out += [(0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]), (0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1])]
        out.append(pts[-1])
        pts = out
    return pts


canals = []
order = {n: i for i, n in enumerate(names)}
for n, rs in rings.items():
    for ring in rs:
        # for each boundary point: the neighbour it borders (lower-index owner keeps the canal)
        nb = []
        for x, z in ring:
            best = None
            for o, t in trees.items():
                if o == n:
                    continue
                d, _ = t.query((x, z))
                if d < SHARED and (best is None or d < best[0]):
                    best = (d, o)
            nb.append(best[1] if best and order[best[1]] > order[n] else None)
        # runs of consecutive points bordering the same neighbour (the ring is circular)
        N = len(ring)
        start = next((i for i in range(N) if nb[i] != nb[i - 1]), None)
        if start is None:
            if nb[0]:
                canals.append({"a": n, "b": nb[0], "p": [tuple(p) for p in ring] + [tuple(ring[0])]})
            continue
        i = start
        run, key = [], nb[start]
        for k in range(N + 1):
            j = (start + k) % N
            if nb[j] != key or k == N:
                if key and len(run) >= 6:
                    canals.append({"a": n, "b": key, "p": run})
                run, key = [], nb[j]
            run.append(tuple(ring[j]))
def meander(pts, amp=26.0, wave=460.0, seed=0.0):
    """A lazy-river wiggle along the path, tapered to zero at both ends so canals still meet."""
    pts = [np.array(p, dtype=float) for p in pts]
    # resample every 8 m
    dense = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        n = max(1, int(np.linalg.norm(b - a) / 8.0))
        dense += [a + (b - a) * k / n for k in range(1, n + 1)]
    s = [0.0]
    for a, b in zip(dense, dense[1:]):
        s.append(s[-1] + float(np.linalg.norm(b - a)))
    L = s[-1]
    out = []
    for i, p in enumerate(dense):
        a, b = dense[max(0, i - 2)], dense[min(len(dense) - 1, i + 2)]
        t = b - a
        t /= (np.linalg.norm(t) or 1.0)
        nrm = np.array([-t[1], t[0]])
        taper = min(1.0, s[i] / 180.0, (L - s[i]) / 180.0)
        taper = taper * taper * (3 - 2 * taper)
        w = amp * taper * (math.sin(2 * math.pi * s[i] / wave + seed) + 0.35 * math.sin(2 * math.pi * s[i] / (wave * 0.43) + seed * 1.7))
        out.append(tuple(p + nrm * w))
    return out


out = []
for k, c in enumerate(canals):
    pts = rdp(c["p"], 4.0)
    pts = chaikin(pts, 3)
    pts = meander(pts, seed=k * 1.37)
    pts = chaikin(rdp(pts, 1.5), 2)
    out.append({"a": c["a"], "b": c["b"], "p": [[round(x, 1), round(z, 1)] for x, z in pts]})
total = sum(sum(math.dist(p, q) for p, q in zip(c["p"], c["p"][1:])) for c in out)
json.dump({"canals": out}, open(os.path.join(WORLD, "canals.json"), "w"), separators=(",", ":"))

# distance field from the same paths the renderer draws, measured exactly at every pixel centre
fw, fh = int((X1 - X0) / FIELD) + 1, int((Z1 - Z0) / FIELD) + 1
dense = []
for c in out:
    for (ax, az), (bx, bz) in zip(c["p"], c["p"][1:]):
        n = max(1, int(math.hypot(bx - ax, bz - az) / 0.75))
        dense += [(ax + (bx - ax) * k / n, az + (bz - az) * k / n) for k in range(n + 1)]
tree = cKDTree(np.array(dense))
cx = X0 + (np.arange(fw) + 0.5) * FIELD
cz = Z0 + (np.arange(fh) + 0.5) * FIELD
gx, gz = np.meshgrid(cx, cz)
d, _ = tree.query(np.stack([gx.ravel(), gz.ravel()], 1), distance_upper_bound=255.0, workers=-1)
d = np.where(np.isfinite(d), d, 255.0).reshape(fh, fw)
Image.fromarray(np.clip(np.round(d), 0, 255).astype(np.uint8)).save(os.path.join(WORLD, "canal.png"), optimize=True)
print(f"{len(out)} canals, {total / 1000:.1f} km, field {fw}x{fh}")
