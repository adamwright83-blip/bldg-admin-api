"""Packs an Overpass export (see query.overpass) into the compact district file the
Lantern City fog proof renders: local-metre footprints with real LA County heights,
ground elevation and unit counts, a terrain grid interpolated from building elevations,
roads, water and parks.

    curl -s --data-urlencode data@query.overpass https://overpass-api.de/api/interpreter -o sl.json
    python3 build_district.py sl.json district.json
"""
import json, math, sys
import numpy as np
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree

SRC, OUT = sys.argv[1], sys.argv[2]
S, W, N, E = 34.0745, -118.2860, 34.1010, -118.2530
LAT0, LON0 = (S + N) / 2, (W + E) / 2
KX = 111320 * math.cos(math.radians(LAT0))
KZ = 110540


def xy(p):
    return ((p['lon'] - LON0) * KX, -(p['lat'] - LAT0) * KZ)


def area(pts):
    a = 0
    for i in range(len(pts)):
        x1, z1 = pts[i]; x2, z2 = pts[(i + 1) % len(pts)]
        a += x1 * z2 - x2 * z1
    return a / 2


els = json.load(open(SRC))['elements']
buildings, roads, water, parks = [], [], [], []
for e in els:
    t = e.get('tags', {})
    if e['type'] == 'relation':
        rings = [[xy(p) for p in m['geometry']] for m in e.get('members', []) if m.get('role') == 'outer' and 'geometry' in m]
        # stitch outer member ways into closed rings
        merged = []
        while rings:
            ring = rings.pop(0)
            changed = True
            while changed and math.dist(ring[0], ring[-1]) > 0.5:
                changed = False
                for i, r in enumerate(rings):
                    if math.dist(ring[-1], r[0]) < 0.5: ring += r[1:]; rings.pop(i); changed = True; break
                    if math.dist(ring[-1], r[-1]) < 0.5: ring += r[::-1][1:]; rings.pop(i); changed = True; break
            merged.append(ring)
        for ring in merged:
            water.append({'n': t.get('name', ''), 'p': [[round(x, 1), round(z, 1)] for x, z in ring[:-1]]})
        continue
    g = e.get('geometry')
    if not g: continue
    pts = [xy(p) for p in g]
    if 'building' in t:
        if len(pts) < 4 or 'ele' not in t: continue
        ring = pts[:-1]
        a = area(ring)
        if abs(a) < 12: continue
        if a < 0: ring = ring[::-1]  # CCW in x/z
        try:
            h = float(t.get('height', 6)); ele = float(t['ele'])
        except ValueError:
            continue
        units = t.get('building:units')
        buildings.append({
            'p': [[round(x, 1), round(z, 1)] for x, z in ring],
            'h': round(max(2.5, min(h, 90)), 1), 'e': round(ele, 1),
            'u': int(float(units)) if units and units.replace('.', '', 1).isdigit() else 0,
            't': t['building'],
        })
    elif 'highway' in t:
        roads.append({'k': t['highway'], 'n': t.get('name', ''), 'p': [[round(x, 1), round(z, 1)] for x, z in pts]})
    elif t.get('natural') == 'water':
        water.append({'n': t.get('name', ''), 'p': [[round(x, 1), round(z, 1)] for x, z in pts[:-1]]})
    elif 'leisure' in t:
        parks.append({'k': t['leisure'], 'p': [[round(x, 1), round(z, 1)] for x, z in pts[:-1]]})

# terrain: building elevations -> smooth grid
x0, z0 = (W - LON0) * KX, -(N - LAT0) * KZ
x1, z1 = (E - LON0) * KX, -(S - LAT0) * KZ
CELL = 15.0
nx, nz = int((x1 - x0) / CELL) + 1, int((z1 - z0) / CELL) + 1
cent = np.array([[np.mean([p[0] for p in b['p']]), np.mean([p[1] for p in b['p']])] for b in buildings])
ele = np.array([b['e'] for b in buildings])
tree = cKDTree(cent)
gx, gz = np.meshgrid(x0 + np.arange(nx) * CELL, z0 + np.arange(nz) * CELL)
q = np.stack([gx.ravel(), gz.ravel()], 1)
d, i = tree.query(q, k=8)
w = 1 / np.maximum(d, 5) ** 2
grid = (ele[i] * w).sum(1) / w.sum(1)
grid = gaussian_filter(grid.reshape(nz, nx), 1.6)
base = float(np.percentile(grid, 1))

out = {
    'origin': [LAT0, LON0], 'kx': KX, 'kz': KZ,
    'terrain': {'x0': round(x0, 1), 'z0': round(z0, 1), 'cell': CELL, 'nx': nx, 'nz': nz, 'base': round(base, 1),
                'h': [round(v - base, 1) for v in grid.ravel().tolist()]},
    'buildings': buildings, 'roads': roads, 'water': water, 'parks': parks,
}
json.dump(out, open(OUT, 'w'), separators=(',', ':'))
print(len(buildings), 'buildings', len(roads), 'roads', len(water), 'water', len(parks), 'parks', nx, 'x', nz, 'terrain; relief',
      round(float(grid.max() - grid.min()), 1), 'm')
