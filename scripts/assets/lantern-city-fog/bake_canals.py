"""Canals between neighbourhoods: a distance field (metres to the nearest shared boundary between two
board neighbourhoods) that Lantern City v7 uses to cut Venice-style canals along every border.

    python3 scripts/assets/lantern-city-fog/bake_canals.py

Reads the world manifest written by bake_service_area.py; writes world/canal.png (8-bit metres,
255 = far from any canal) on the same grid as world/mask.png.
"""
import json
import os

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
WORLD = os.path.join(REPO, "client/public/assets/goldline/lantern-city/v7/world")
m = json.load(open(os.path.join(WORLD, "manifest.json")))
X0, Z0 = m["bounds"][0], m["bounds"][1]
cell, w, h = m["mask"]["cell"], m["mask"]["w"], m["mask"]["h"]
names = m["served"] + m["between"]

hoods = json.load(open(os.path.join(REPO, "shared/data/mapping-la/la-county-neighborhoods-v5.geojson")))["features"]
lat0, lon0 = m["origin"]
kx, kz = m["kx"], m["kz"]
ids = Image.new("L", (w, h), 0)
d = ImageDraw.Draw(ids)
for f in hoods:
    n = f["properties"]["name"]
    if n not in names:
        continue
    g = f["geometry"]
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    for p in polys:
        ring = [(((lon - lon0) * kx - X0) / cell, (-(lat - lat0) * kz - Z0) / cell) for lon, lat in p[0]]
        d.polygon(ring, fill=names.index(n) + 1)
a = np.array(ids).astype(np.int32)
# the boundary data leaves hairline slivers between some neighbours: give each empty pixel within
# 40 m the id of its nearest neighbourhood so shared borders are continuous
gap, (iy, ix) = distance_transform_edt(a == 0, return_indices=True)
fill = (a == 0) & (gap * cell <= 40)
a[fill] = a[iy[fill], ix[fill]]
# a border pixel: a neighbourhood pixel whose right or lower neighbour is a different neighbourhood
border = np.zeros_like(a, dtype=bool)
for dy, dx in ((0, 1), (1, 0), (1, 1), (1, -1)):
    b = np.roll(np.roll(a, -dy, 0), -dx, 1)
    border |= (a > 0) & (b > 0) & (a != b)
dist = distance_transform_edt(~border) * cell
Image.fromarray(np.clip(dist, 0, 255).astype(np.uint8)).save(os.path.join(WORLD, "canal.png"), optimize=True)
print("canal border pixels", int(border.sum()), "->", os.path.join(WORLD, "canal.png"))
