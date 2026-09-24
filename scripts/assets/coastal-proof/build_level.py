"""Coastal Market three.js proof: level builder (Blender 5.2, headless).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python scripts/assets/coastal-proof/build_level.py -- [--blend out.blend]

Everything in the level is generated here from numbers: no external meshes,
so the geometry is ours outright (see the proof's PROVENANCE.md). Output:

    client/public/assets/goldline/coastal-market-three-proof/level.glb
    client/public/assets/goldline/coastal-market-three-proof/level.json

Blender is Z-up; glTF/three is Y-up (x, z, -y). level.json is written in the
three convention so the runtime never converts.

Layout: the coast runs east -> west with the sea to the NORTH (+Y). The sun
sits low at azimuth 168 deg (just north of west), so the first beat looks
along the coast at the harbour and the second half of the walk heads into the
sun: overlook (east headland, z 30) -> market lane in the cove -> arch passage
-> stairs -> bridge over the waterfall gorge -> boardwalk -> stairs -> quay ->
pier pointing at the sun.
"""

import bpy
import json
import math
import os
import random
import sys

from mathutils import Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT_DIR = os.path.join(REPO, "client", "public", "assets", "goldline", "coastal-market-three-proof")

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
BLEND_OUT = argv[argv.index("--blend") + 1] if "--blend" in argv else None
BAKE = "--bake" in argv
BAKE_SAMPLES = int(argv[argv.index("--samples") + 1]) if "--samples" in argv else 48
LM_SIZE = int(argv[argv.index("--lm") + 1]) if "--lm" in argv else 2048

# Lightmap atlases: R = ambient occlusion, G = sun visibility (baked shadow).
# Small props are too thin for an atlas; they carry a per-vertex _SUNVIS instead.
LIGHTMAP_GROUPS = {
    "lm_cliff": ["VIS_rock"],
    "lm_town": ["VIS_cobble", "VIS_step", "VIS_quay", "VIS_wood", "VIS_wood_dark", "VIS_sand"],
    "lm_facade": ["VIS_plaster", "VIS_plaster_warm", "VIS_mortar", "VIS_roof"],
}
VERTEX_SUN_OBJECTS = ["VIS_rope", "VIS_cloth_red", "VIS_cloth_cream", "VIS_cloth_blue", "VIS_iron", "VIS_foliage",
                      "VIS_window", "VIS_glow", "VIS_paint", "VIS_produce", "VIS_brass", "VIS_leather"]

rng = random.Random(1717)
noise.seed_set(4242)

SUN_AZIMUTH_DEG = 162.0   # keep in step with prep_textures.py
SUN_ELEVATION_DEG = 13.0

# --------------------------------------------------------------------------
# small vector helpers (xy plane)
# --------------------------------------------------------------------------


def v2(x, y):
    return Vector((x, y))


def v3(x, y, z):
    return Vector((x, y, z))


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


def fbm(p, scale=1.0, octaves=3):
    return noise.fractal(Vector(p) * scale, 0.55, 2.0, octaves)


# --------------------------------------------------------------------------
# geometry accumulation: one Geo per material, merged into one object each
# --------------------------------------------------------------------------

UV_SCALE = {
    "rock": 6.0, "rock_dark": 6.0, "cobble": 2.5, "step": 1.6, "plaster": 3.0, "plaster_warm": 3.0,
    "wood": 1.5, "wood_dark": 1.5, "roof": 2.0, "cloth_red": 1.0, "cloth_cream": 1.0, "cloth_blue": 1.0,
    "rope": 1.0, "iron": 1.0, "foliage": 1.5, "glow": 1.0, "window": 1.0, "sand": 4.0, "far": 30.0,
    "quay": 2.0, "mortar": 3.0, "paint": 1.5, "produce": 1.0, "brass": 1.0, "leather": 1.0,
}

GRAYBOX_COLOR = {
    "rock": (0.54, 0.49, 0.43), "rock_dark": (0.40, 0.36, 0.32), "cobble": (0.60, 0.57, 0.52),
    "step": (0.64, 0.60, 0.55), "plaster": (0.85, 0.80, 0.70), "plaster_warm": (0.80, 0.70, 0.57),
    "wood": (0.42, 0.29, 0.20), "wood_dark": (0.29, 0.20, 0.14), "roof": (0.63, 0.34, 0.23),
    "cloth_red": (0.61, 0.23, 0.18), "cloth_cream": (0.85, 0.79, 0.66), "cloth_blue": (0.25, 0.36, 0.52),
    "rope": (0.61, 0.52, 0.38), "iron": (0.23, 0.21, 0.19), "foliage": (0.31, 0.42, 0.21),
    "glow": (1.0, 0.72, 0.37), "window": (0.10, 0.08, 0.07), "sand": (0.73, 0.65, 0.50),
    "far": (0.44, 0.42, 0.41), "quay": (0.56, 0.53, 0.49), "mortar": (0.70, 0.64, 0.56),
    "paint": (0.8, 0.8, 0.78), "produce": (0.9, 0.9, 0.9), "brass": (0.7, 0.52, 0.22), "leather": (0.3, 0.17, 0.09),
}


class Geo:
    def __init__(self, name, material=None, smooth=False):
        self.name = name
        self.material = material
        self.smooth = smooth
        self.verts = []
        self.faces = []
        self.face_uv = []      # per face: list of (u, v)
        self.face_col = []     # per face: list of rgba
        self.face_smooth = []
        self.wind = []         # per vertex float

    def vert(self, p, wind=0.0):
        self.verts.append((p[0], p[1], p[2]))
        self.wind.append(wind)
        return len(self.verts) - 1

    def face(self, idx, uvs=None, col=(1, 1, 1, 1), smooth=None):
        pts = [Vector(self.verts[i]) for i in idx]
        if uvs is None:
            uvs = box_uv(pts, UV_SCALE.get(self.material, 2.0))
        cols = col if isinstance(col, list) else [col] * len(idx)
        self.faces.append(tuple(idx))
        self.face_uv.append(uvs)
        self.face_col.append(cols)
        self.face_smooth.append(self.smooth if smooth is None else smooth)

    def quad(self, a, b, c, d, col=(1, 1, 1, 1), uvs=None, wind=(0, 0, 0, 0)):
        i = [self.vert(a, wind[0]), self.vert(b, wind[1]), self.vert(c, wind[2]), self.vert(d, wind[3])]
        self.face(i, uvs=uvs, col=col)

    def tri(self, a, b, c, col=(1, 1, 1, 1), uvs=None, wind=(0, 0, 0)):
        i = [self.vert(a, wind[0]), self.vert(b, wind[1]), self.vert(c, wind[2])]
        self.face(i, uvs=uvs, col=col)

    def empty(self):
        return not self.faces


def box_uv(pts, scale):
    n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
    if len(pts) > 3:
        n = n + (pts[2] - pts[0]).cross(pts[3] - pts[0])
    ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
    out = []
    for p in pts:
        if az >= ax and az >= ay:
            out.append((p.x / scale, p.y / scale))
        elif ax >= ay:
            out.append((p.y / scale, p.z / scale))
        else:
            out.append((p.x / scale, p.z / scale))
    return out


GEOS = {}


def geo(material, prefix="VIS"):
    key = f"{prefix}_{material}"
    if key not in GEOS:
        GEOS[key] = Geo(key, material, smooth=material in ("rock", "rock_dark", "far", "foliage", "sand"))
    return GEOS[key]


PLANTS = []  # instanced in three.js from props.glb: {"t": fern|shrub|grass, "p": blender xyz, "s": scale, "r": yaw}


def plant(kind, p, scale=1.0, yaw=None):
    PLANTS.append({"t": kind, "p": [p[0], p[1], p[2]], "s": scale, "r": yaw if yaw is not None else rng.random() * math.tau})


COL_WALK = Geo("COL_walk")
COL_WALL = Geo("COL_wall")
COL_CAM = Geo("COL_cam")


# --------------------------------------------------------------------------
# primitives
# --------------------------------------------------------------------------


def frame_axes(forward_xy):
    f = Vector((forward_xy[0], forward_xy[1], 0)).normalized()
    left = Vector((-f.y, f.x, 0))
    return f, left, Vector((0, 0, 1))


def box(g, center, size, fwd=(1, 0), col=(1, 1, 1, 1), bottom=False, cam=False, wall=False, top=True):
    """Oriented box. size = (along fwd, along left, up); center at the box centre."""
    f, l, u = frame_axes(fwd)
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    c = Vector(center)
    corners = {}
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                corners[(sx, sy, sz)] = c + f * (sx * hx) + l * (sy * hy) + u * (sz * hz)
    faces = [
        ((1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1)),     # +f
        ((-1, 1, -1), (-1, -1, -1), (-1, -1, 1), (-1, 1, 1)),  # -f
        ((1, 1, -1), (-1, 1, -1), (-1, 1, 1), (1, 1, 1)),     # +l
        ((-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)),  # -l
    ]
    if top:
        faces.append(((-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)))
    if bottom:
        faces.append(((-1, 1, -1), (1, 1, -1), (1, -1, -1), (-1, -1, -1)))
    targets = [g] + ([COL_CAM] if cam else []) + ([COL_WALL] if wall else [])
    for t in targets:
        for fc in faces:
            t.quad(*[corners[k] for k in fc], col=col)


def cylinder(g, base, radius, height, seg=8, col=(1, 1, 1, 1), top=True, r_top=None, cam=False):
    r_top = radius if r_top is None else r_top
    b = Vector(base)
    ring0, ring1 = [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        d = Vector((math.cos(a), math.sin(a), 0))
        ring0.append(b + d * radius)
        ring1.append(b + d * r_top + Vector((0, 0, height)))
    targets = [g] + ([COL_CAM] if cam else [])
    for t in targets:
        for i in range(seg):
            j = (i + 1) % seg
            uvs = [(i / seg, 0), (j / seg, 0), (j / seg, height / 2), (i / seg, height / 2)]
            t.quad(ring0[i], ring0[j], ring1[j], ring1[i], col=col, uvs=uvs)
        if top:
            ci = t.vert(b + Vector((0, 0, height)))
            for i in range(seg):
                j = (i + 1) % seg
                t.face([t.vert(ring1[i]), t.vert(ring1[j]), ci], col=col)


def tube(g, pts, radius, seg=4, col=(1, 1, 1, 1), wind_fn=None):
    """Thin tube along a polyline (ropes)."""
    rings = []
    for k, p in enumerate(pts):
        a = pts[max(k - 1, 0)]
        b = pts[min(k + 1, len(pts) - 1)]
        t = (b - a).normalized()
        side = t.cross(Vector((0, 0, 1)))
        if side.length < 1e-4:
            side = Vector((1, 0, 0))
        side.normalize()
        up = side.cross(t).normalized()
        ring = []
        for i in range(seg):
            ang = 2 * math.pi * i / seg
            ring.append(p + side * (math.cos(ang) * radius) + up * (math.sin(ang) * radius))
        rings.append(ring)
    for k in range(len(pts) - 1):
        w0 = wind_fn(k / (len(pts) - 1)) if wind_fn else 0
        w1 = wind_fn((k + 1) / (len(pts) - 1)) if wind_fn else 0
        for i in range(seg):
            j = (i + 1) % seg
            g.quad(rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i], col=col,
                   uvs=[(i / seg, k), ((i + 1) / seg, k), ((i + 1) / seg, k + 1), (i / seg, k + 1)],
                   wind=(w0, w0, w1, w1))


def catenary(a, b, sag, n=10):
    pts = []
    for i in range(n + 1):
        t = i / n
        p = a.lerp(b, t)
        p.z -= sag * 4 * t * (1 - t)
        pts.append(p)
    return pts


def blob(g, center, radius, squash=0.7, col=(1, 1, 1, 1), seed=0, wind=0.0):
    """Low-poly lumpy ellipsoid: graybox foliage / boulders."""
    c = Vector(center)
    rings, seg = 5, 8
    grid = []
    for r in range(rings + 1):
        phi = math.pi * r / rings
        row = []
        for s in range(seg):
            th = 2 * math.pi * s / seg
            d = Vector((math.sin(phi) * math.cos(th), math.sin(phi) * math.sin(th), math.cos(phi) * squash))
            k = 1.0 + 0.25 * noise.noise(c * 0.37 + d * 1.7 + Vector((seed, 0, 0)))
            p = c + d * radius * k
            row.append(g.vert(p, wind * (0.3 + 0.7 * (1 - r / rings))))
        grid.append(row)
    for r in range(rings):
        for s in range(seg):
            s2 = (s + 1) % seg
            g.face([grid[r][s], grid[r + 1][s], grid[r + 1][s2], grid[r][s2]], col=col)


def cloth(g, top_a, top_b, drop, cols=3, rows=6, col=(1, 1, 1, 1), slope_out=None):
    """Hanging cloth panel from edge a-b hanging `drop` metres; wind weight grows downward."""
    top_a, top_b = Vector(top_a), Vector(top_b)
    grid = []
    for r in range(rows + 1):
        t = r / rows
        row = []
        for c in range(cols + 1):
            s = c / cols
            p = top_a.lerp(top_b, s)
            p = p + Vector((0, 0, -drop * t))
            if slope_out is not None:
                p = p + Vector(slope_out) * t
            row.append(g.vert(p, t))
        grid.append(row)
    for r in range(rows):
        for c in range(cols):
            uvs = [(c / cols, 1 - r / rows), ((c + 1) / cols, 1 - r / rows),
                   ((c + 1) / cols, 1 - (r + 1) / rows), (c / cols, 1 - (r + 1) / rows)]
            g.face([grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]], uvs=uvs, col=col)


# --------------------------------------------------------------------------
# the route (walkable) and the coast spine (cliff sweep)
# --------------------------------------------------------------------------

# (x, y, z, width, kind-of-segment-starting-here, zTop of the cliff above)
SPINE_NODES = [
    (150.0, 20.0, 38.0, 8.0, "ext", 48.0),
    (116.0, 7.0, 33.0, 8.0, "ext", 46.0),
    (88.0, 0.9, 30.0, 7.5, "terrace", 46.0),    # route starts here
    (80.5, 1.4, 30.0, 3.6, "stairs", 50.0),
    (71.0, 0.2, 26.6, 3.4, "stairs", 56.0),
    (62.5, -3.8, 23.9, 3.8, "lane", 62.0),
    (48.0, -12.0, 23.4, 4.6, "lane", 66.0),
    (38.0, -16.5, 22.9, 3.3, "arch", 66.0),
    (30.0, -19.0, 22.7, 3.3, "arch", 66.0),
    (23.0, -20.5, 22.5, 3.2, "stairs", 64.0),
    (14.5, -20.5, 19.0, 3.2, "landing", 62.0),
    (10.0, -18.8, 19.0, 3.2, "stairs", 60.0),
    (2.0, -14.5, 15.2, 2.8, "bridge", 58.0),
    (-13.0, -10.5, 15.2, 3.0, "boardwalk", 56.0),
    (-24.0, -7.0, 14.0, 3.2, "stairs", 52.0),
    (-32.0, -4.8, 10.6, 3.2, "landing", 48.0),
    (-36.0, -3.0, 10.6, 3.2, "stairs", 46.0),
    (-44.5, -0.5, 7.0, 3.2, "stairs", 43.0),
    (-54.0, 2.0, 2.4, 10.0, "quay", 38.0),      # route leaves the spine here
    (-66.0, -1.5, 2.3, 7.0, "shore", 34.0),
    (-76.0, -11.0, 2.2, 6.0, "shore", 36.0),
    (-83.0, -27.0, 2.2, 6.0, "shore", 38.0),
    (-97.0, -41.0, 2.4, 6.0, "shore", 42.0),
    (-119.0, -47.0, 2.6, 6.0, "shore", 44.0),
    (-154.0, -51.0, 3.0, 6.0, "shore", 46.0),
    (-199.0, -53.0, 4.0, 6.0, "shore", 50.0),
    (-249.0, -50.0, 5.0, 6.0, "shore", 52.0),
]
ROUTE_FIRST = [i for i, n in enumerate(SPINE_NODES) if n[4] == "terrace"][0]
ROUTE_LAST_ON_SPINE = [i for i, n in enumerate(SPINE_NODES) if n[4] == "quay"][0]
# after the quay the route runs straight at the sun: quay apron, then the pier
PIER_HEADING_DEG = 163.0
QUAY_APRON_LEN = 8.0
PIER_LEN = 15.0

SURFACE = {
    "terrace": "stone", "stairs": "stone", "lane": "stone", "arch": "stone", "landing": "stone",
    "bridge": "wood", "boardwalk": "wood", "quay": "stone", "pier": "wood",
}
KINDS = ["terrace", "stairs", "lane", "arch", "landing", "bridge", "boardwalk", "quay", "pier"]
RISER = 0.16


def sample_spine(step=0.5):
    """Catmull-Rom through spine nodes; per sample: p(xy), s, node index, t."""
    pts = [v2(n[0], n[1]) for n in SPINE_NODES]
    out = []
    s = 0.0
    prev = None
    for i in range(len(pts) - 1):
        p0 = pts[max(i - 1, 0)]
        p1, p2 = pts[i], pts[i + 1]
        p3 = pts[min(i + 2, len(pts) - 1)]
        seg_len = (p2 - p1).length
        n = max(2, int(seg_len / step))
        for k in range(n):
            t = k / n
            p = catmull(p0, p1, p2, p3, t)
            if prev is not None:
                s += (p - prev).length
            out.append({"p": p, "s": s, "i": i, "t": t})
            prev = p
    p = pts[-1]
    s += (p - prev).length
    out.append({"p": p, "s": s, "i": len(pts) - 1, "t": 0.0})
    # tangents
    for k, smp in enumerate(out):
        a = out[max(k - 1, 0)]["p"]
        b = out[min(k + 1, len(out) - 1)]["p"]
        d = (b - a).normalized()
        smp["T"] = d
        smp["L"] = v2(-d.y, d.x)   # left = land side
    return out


SPINE = sample_spine()
NODE_S = {}
for smp in SPINE:
    if smp["t"] == 0.0 and smp["i"] not in NODE_S:
        NODE_S[smp["i"]] = smp["s"]


def node_attr(i, k):
    return SPINE_NODES[i][k]


def seg_of(s):
    """Spine segment index containing arclength s."""
    for i in range(len(SPINE_NODES) - 1):
        if NODE_S[i] <= s < NODE_S[i + 1]:
            return i
    return len(SPINE_NODES) - 2


def ledge_z(s):
    i = seg_of(s)
    s0, s1 = NODE_S[i], NODE_S[i + 1]
    t = (s - s0) / max(1e-6, s1 - s0)
    return lerp(node_attr(i, 2), node_attr(i + 1, 2), max(0.0, min(1.0, t)))


def width_at(s):
    i = seg_of(s)
    s1 = NODE_S[i + 1]
    w0, w1 = node_attr(i, 3), node_attr(i + 1, 3)
    return lerp(w0, w1, smoothstep(s1 - 1.4, s1, s))


def ztop_at(s):
    i = seg_of(s)
    s0, s1 = NODE_S[i], NODE_S[i + 1]
    t = max(0.0, min(1.0, (s - s0) / max(1e-6, s1 - s0)))
    return lerp(node_attr(i, 5), node_attr(i + 1, 5), t)


def kind_at(s):
    return node_attr(seg_of(s), 4)


def stairs_profile(s):
    """Walk z on a stairs segment (ramp through step centres) and the visual step top."""
    i = seg_of(s)
    s0, s1 = NODE_S[i], NODE_S[i + 1]
    z0, z1 = node_attr(i, 2), node_attr(i + 1, 2)
    n = max(1, round((z0 - z1) / RISER))
    h = (z0 - z1) / n
    t = (s1 - s0) / n
    k = min(n - 1, max(0, int((s - s0) / t)))
    step_top = z0 - (k + 1) * h
    u = s - s0
    if u < 0.5 * t:
        walk = lerp(z0, z0 - h, u / (0.5 * t))
    else:
        walk = z0 - h - (u - 0.5 * t) / t * h
    return max(z1, walk), step_top, (s0, s1, z0, z1, n, h, t)


def walk_z_spine(s):
    kind = kind_at(s)
    if kind == "stairs":
        return stairs_profile(s)[0]
    if kind == "bridge":
        i = seg_of(s)
        s0, s1 = NODE_S[i], NODE_S[i + 1]
        return ledge_z(s) - 0.22 * math.sin(math.pi * (s - s0) / (s1 - s0))
    return ledge_z(s)


ROUTE_S0 = NODE_S[ROUTE_FIRST]
ROUTE_S_QUAY = NODE_S[ROUTE_LAST_ON_SPINE]
BRIDGE_I = [i for i, n in enumerate(SPINE_NODES) if n[4] == "bridge"][0]
BRIDGE_S0, BRIDGE_S1 = NODE_S[BRIDGE_I], NODE_S[BRIDGE_I + 1]


def gorge_amount(s):
    return smoothstep(BRIDGE_S0 - 1.0, BRIDGE_S0 + 3.0, s) * (1 - smoothstep(BRIDGE_S1 - 3.0, BRIDGE_S1 + 1.0, s))


def build_route():
    """Route samples: spine range terrace..quay, then straight quay apron + pier."""
    route = []
    for smp in SPINE:
        if ROUTE_S0 <= smp["s"] <= ROUTE_S_QUAY + 1e-6:
            s = smp["s"]
            route.append({
                "p": smp["p"].copy(), "T": smp["T"].copy(), "L": smp["L"].copy(),
                "z": walk_z_spine(s), "w": width_at(s), "kind": kind_at(s), "spine_s": s,
            })
    # straight run at the sun
    h = math.radians(PIER_HEADING_DEG)
    d = v2(math.cos(h), math.sin(h))
    base = route[-1]["p"].copy()
    z_quay = route[-1]["z"]
    total = QUAY_APRON_LEN + PIER_LEN
    n = int(total / 0.5)
    for k in range(1, n + 1):
        u = k * total / n
        kind = "quay" if u < QUAY_APRON_LEN else "pier"
        w = 10.0 if u < QUAY_APRON_LEN - 2.0 else lerp(10.0, 3.0, smoothstep(QUAY_APRON_LEN - 2.0, QUAY_APRON_LEN, u))
        z = z_quay if u < QUAY_APRON_LEN else z_quay - 0.25
        route.append({"p": base + d * u, "T": d.copy(), "L": v2(-d.y, d.x), "z": z, "w": w, "kind": kind, "spine_s": None})
    # blend the spine tangent into the pier heading across the quay
    s = 0.0
    for k, r in enumerate(route):
        if k:
            s += (r["p"] - route[k - 1]["p"]).length
        r["s"] = s
    return route


ROUTE = build_route()
ROUTE_LEN = ROUTE[-1]["s"]


def route_at(s):
    for k in range(len(ROUTE) - 1):
        if ROUTE[k]["s"] <= s <= ROUTE[k + 1]["s"]:
            a, b = ROUTE[k], ROUTE[k + 1]
            t = (s - a["s"]) / max(1e-6, b["s"] - a["s"])
            return a["p"].lerp(b["p"], t), lerp(a["z"], b["z"], t), a
    return ROUTE[-1]["p"], ROUTE[-1]["z"], ROUTE[-1]


# --------------------------------------------------------------------------
# cliff sweep
# --------------------------------------------------------------------------


def build_cliff():
    g = geo("rock")
    rows_per = None
    grid = []
    for smp in SPINE[::2]:
        s = smp["s"]
        p, L = smp["p"], smp["L"]
        kind = kind_at(s)
        zr = ledge_z(s)
        hw = width_at(s) / 2 + 0.25
        zt = ztop_at(s) + 6.0 * fbm((p.x, p.y, 0), 0.02)
        H = max(6.0, zt - zr)
        gz = gorge_amount(s)
        ledge_drop = 0.0
        land_hw = hw
        if kind == "boardwalk":
            ledge_drop, land_hw = 1.6, hw * 0.3
        if kind in ("shore", "ext"):
            ledge_drop = 0.3
        sea_slope = 0.10 if kind in ("quay", "shore") else 0.33
        D = zr + 7.0
        rows = []
        # sea side, far -> near (u negative)
        sea = [(-hw - 0.55 - D * sea_slope - 34.0, -10.0, 0.0)]
        for f in (1.0, 0.78, 0.52, 0.28, 0.1):
            dz = -D * f
            sea.append((-hw - 0.55 - abs(dz) * sea_slope, zr + dz, 1.6 if f > 0.2 else 0.6))
        sea.append((-hw - 0.3, zr - 0.9 - ledge_drop, 0.1))
        sea.append((-hw, zr - 0.3 - ledge_drop, 0.0))
        rows.extend(sea)
        # ledge / walk band (kept under the floor meshes)
        rows.append((0.0, zr - 0.35 - ledge_drop, 0.0))
        # land side
        land = [(land_hw, zr - 0.3 - ledge_drop, 0.0), (land_hw + 0.25, zr + 0.25, 0.0)]
        for f in (0.05, 0.14, 0.3, 0.52, 0.76, 1.0):
            dz = H * f
            land.append((land_hw + 0.45 + dz * 0.2 + 1.5 * f, zr + dz, 0.5 + 2.8 * f))
        top_u = land[-1][0]
        land.append((top_u + 7.0, zr + H + 2.5, 3.0))
        land.append((top_u + 48.0, zr + H + 7.0, 5.0))
        rows.extend(land)
        ring = []
        for ri, (u, z, amp) in enumerate(rows):
            uu = u
            zz = z
            if gz > 0.0:
                if u >= land_hw - 0.01:
                    uu = u + 17.0 * gz
                if -hw - 0.35 <= u <= land_hw + 0.3:
                    zz = lerp(z, -2.0, gz)
                if u >= land_hw - 0.01 and z < zr + 1.0:
                    zz = lerp(z, -2.0, gz)
            xy = p + L * uu
            nrm = fbm((xy.x, xy.y, zz), 0.09) * 0.7 + fbm((xy.x, xy.y, zz), 0.25) * 0.3
            outward = L * (1.0 if u > 0 else -1.0)
            xy = xy + outward * (nrm * amp)
            zz = zz + (fbm((xy.x * 1.3, xy.y, zz), 0.12) * amp * 0.35 if amp > 0.8 else 0.0)
            ring.append(v3(xy.x, xy.y, zz))
        grid.append(ring)
        rows_per = len(rows)
    idx = [[g.vert(p) for p in ring] for ring in grid]
    cam_idx = [[COL_CAM.vert(p) for p in ring] for ring in grid]
    for k in range(len(grid) - 1):
        for r in range(rows_per - 1):
            a, b = idx[k][r], idx[k][r + 1]
            c, d = idx[k + 1][r + 1], idx[k + 1][r]
            pts = [grid[k][r], grid[k][r + 1], grid[k + 1][r + 1], grid[k + 1][r]]
            height_ao = max(0.35, min(1.0, 0.55 + 0.02 * (pts[0].z + 2)))
            g.face([a, b, c, d], col=(height_ao, height_ao * 0.98, height_ao * 0.95, 1))
            COL_CAM.face([cam_idx[k][r], cam_idx[k][r + 1], cam_idx[k + 1][r + 1], cam_idx[k + 1][r]])


# --------------------------------------------------------------------------
# walkway: floors, steps, collision
# --------------------------------------------------------------------------

EDGE_WALL_H = 2.4


def edges(r):
    hw = r["w"] / 2
    p, L = r["p"], r["L"]
    left = p + L * hw
    right = p - L * hw
    return left, right


def build_walk():
    # collision floor + edge walls for the whole route
    for k in range(len(ROUTE) - 1):
        a, b = ROUTE[k], ROUTE[k + 1]
        al, ar = edges(a)
        bl, br = edges(b)
        if in_hole(ROUTE_LEN - (a["s"] + b["s"]) / 2):
            # the boardwalk gap and the bridge leaves: walls stay, floor goes
            for e0, e1 in ((al, bl), (ar, br)):
                COL_WALL.quad(v3(e0.x, e0.y, a["z"] - 0.6), v3(e1.x, e1.y, b["z"] - 0.6), v3(e1.x, e1.y, b["z"] + EDGE_WALL_H), v3(e0.x, e0.y, a["z"] + EDGE_WALL_H))
            continue
        COL_WALK.quad(v3(ar.x, ar.y, a["z"]), v3(br.x, br.y, b["z"]), v3(bl.x, bl.y, b["z"]), v3(al.x, al.y, a["z"]))
        for e0, e1 in ((al, bl), (ar, br)):
            z0, z1 = a["z"], b["z"]
            COL_WALL.quad(v3(e0.x, e0.y, z0 - 0.6), v3(e1.x, e1.y, z1 - 0.6), v3(e1.x, e1.y, z1 + EDGE_WALL_H), v3(e0.x, e0.y, z0 + EDGE_WALL_H))
    for r in (ROUTE[0], ROUTE[-1]):
        l, rt = edges(r)
        COL_WALL.quad(v3(l.x, l.y, r["z"] - 0.6), v3(rt.x, rt.y, r["z"] - 0.6), v3(rt.x, rt.y, r["z"] + EDGE_WALL_H), v3(l.x, l.y, r["z"] + EDGE_WALL_H))

    # visual floors by kind
    cob = geo("cobble")
    wood = geo("wood")
    step = geo("step")
    quay = geo("quay")
    k = 0
    while k < len(ROUTE) - 1:
        a, b = ROUTE[k], ROUTE[k + 1]
        kind = a["kind"]
        al, ar = edges(a)
        bl, br = edges(b)
        if kind in ("terrace", "lane", "arch", "landing", "quay"):
            g = quay if kind == "quay" else cob
            for j in range(3):
                t0, t1 = j / 3, (j + 1) / 3
                p00, p01 = ar.lerp(al, t0), ar.lerp(al, t1)
                p10, p11 = br.lerp(bl, t0), br.lerp(bl, t1)
                shade = 0.92 + 0.08 * fbm((p00.x, p00.y, 0), 0.3)
                g.quad(v3(p00.x, p00.y, a["z"]), v3(p10.x, p10.y, b["z"]), v3(p11.x, p11.y, b["z"]), v3(p01.x, p01.y, a["z"]),
                       col=(shade, shade, shade, 1))
            if kind == "quay" and a["spine_s"] is None:
                # apron slab sides down into the water
                for e0, e1 in ((ar, br), (bl, al)):
                    g.quad(v3(e0.x, e0.y, -2.5), v3(e1.x, e1.y, -2.5), v3(e1.x, e1.y, b["z"]), v3(e0.x, e0.y, a["z"]), col=(0.8, 0.8, 0.8, 1))
        elif kind in ("bridge", "boardwalk", "pier"):
            if in_hole(ROUTE_LEN - (a["s"] + b["s"]) / 2):
                k += 1
                continue
            # planks across the walk, 0.35 m pitch with small gaps
            L = a["L"]
            pl = geo("wood_dark") if (k % 7 == 0) else wood
            thick = 0.1
            mid = a["p"].lerp(b["p"], 0.5)
            zc = (a["z"] + b["z"]) / 2
            length = (b["p"] - a["p"]).length * 0.92
            box(pl, v3(mid.x, mid.y, zc - thick / 2 + 0.01), (length, a["w"] + 0.2, thick), fwd=a["T"], col=(0.9 + 0.1 * rng.random(),) * 3 + (1,))
        k += 1

    # stairs: one box per step on each stairs segment
    for i, node in enumerate(SPINE_NODES[:-1]):
        if node[4] != "stairs" or i < ROUTE_FIRST or i >= ROUTE_LAST_ON_SPINE:
            continue
        s0, s1 = NODE_S[i], NODE_S[i + 1]
        z0, z1 = node[2], SPINE_NODES[i + 1][2]
        n = max(1, round((z0 - z1) / RISER))
        h = (z0 - z1) / n
        t = (s1 - s0) / n
        for j in range(n):
            sa, sb = s0 + j * t, s0 + (j + 1) * t
            top = z0 - (j + 1) * h
            pa, _, ra = route_at_spine(sa)
            pb, _, rb = route_at_spine(sb)
            wa, wb = width_at(sa) / 2 + 0.05, width_at(sb) / 2 + 0.05
            La, Lb = ra["L"], rb["L"]
            corners_top = [pa - La * wa, pb - Lb * wb, pb + Lb * wb, pa + La * wa]
            shade = 0.88 + 0.12 * rng.random()
            c = (shade, shade, shade, 1)
            q = [v3(p.x, p.y, top) for p in corners_top]
            step.quad(q[0], q[1], q[2], q[3], col=c)
            # riser (front, facing back up the stairs, i.e. at sa) down to the previous level
            prev_top = top + h
            step.quad(v3(corners_top[3].x, corners_top[3].y, prev_top), v3(corners_top[3].x, corners_top[3].y, top - 0.02),
                      v3(corners_top[0].x, corners_top[0].y, top - 0.02), v3(corners_top[0].x, corners_top[0].y, prev_top), col=c)
            # step cheeks down into the rock
            for e0, e1 in ((corners_top[0], corners_top[1]), (corners_top[2], corners_top[3])):
                step.quad(v3(e0.x, e0.y, top - 1.2), v3(e1.x, e1.y, top - 1.2), v3(e1.x, e1.y, top), v3(e0.x, e0.y, top), col=(0.8, 0.8, 0.8, 1))


def route_at_spine(s):
    for smp_k in range(len(SPINE) - 1):
        a, b = SPINE[smp_k], SPINE[smp_k + 1]
        if a["s"] <= s <= b["s"]:
            t = (s - a["s"]) / max(1e-6, b["s"] - a["s"])
            return a["p"].lerp(b["p"], t), ledge_z(s), a
    return SPINE[-1]["p"], ledge_z(s), SPINE[-1]


# --------------------------------------------------------------------------
# edge treatments: parapets, rope rails, arcade
# --------------------------------------------------------------------------


def parapet_run(k0, k1, side=-1, height=0.9, thick=0.45, g=None):
    g = g or geo("mortar")
    for k in range(k0, k1):
        a, b = ROUTE[k], ROUTE[k + 1]
        ea = a["p"] + a["L"] * (side * (a["w"] / 2 + thick / 2 - 0.05))
        eb = b["p"] + b["L"] * (side * (b["w"] / 2 + thick / 2 - 0.05))
        mid = ea.lerp(eb, 0.5)
        zc = (a["z"] + b["z"]) / 2
        length = (eb - ea).length + 0.04
        shade = 0.85 + 0.15 * fbm((mid.x, mid.y, 0), 0.4)
        box(g, v3(mid.x, mid.y, zc + height / 2 - 0.6), (length, thick, height + 1.2), fwd=a["T"], col=(shade, shade, shade, 1), cam=False)
        # coping
        box(geo("step"), v3(mid.x, mid.y, zc + height + 0.04), (length, thick + 0.12, 0.08), fwd=a["T"], col=(0.95, 0.95, 0.95, 1))


def rope_rail(k0, k1, side=-1, spacing=2.4, post_h=1.05, bridge=False):
    posts = []
    acc = 999.0
    for k in range(k0, k1 + 1):
        r = ROUTE[k]
        if k > k0:
            acc += (r["p"] - ROUTE[k - 1]["p"]).length
        if (acc >= spacing or k == k1) and not in_hole(ROUTE_LEN - r["s"]):
            e = r["p"] + r["L"] * (side * (r["w"] / 2 + 0.08))
            posts.append(v3(e.x, e.y, r["z"]))
            acc = 0.0
    wood = geo("wood_dark")
    for i, p in enumerate(posts):
        big = bridge and (i == 0 or i == len(posts) - 1)
        base_z = p.z - (2.5 if not bridge or big else 0.2)
        cylinder(wood, v3(p.x, p.y, base_z), 0.12 if big else 0.07, (p.z - base_z) + (post_h + (0.6 if big else 0)), seg=6)
    rope = geo("rope")
    for i in range(len(posts) - 1):
        a, b = posts[i], posts[i + 1]
        for hgt, sag in ((post_h - 0.08, 0.12), (post_h * 0.5, 0.08)):
            tube(rope, catenary(a + Vector((0, 0, hgt)), b + Vector((0, 0, hgt)), sag, 6), 0.025, 4,
                 wind_fn=lambda t: 0.25 * math.sin(math.pi * t))
    return posts


def lantern_post(p, z, side_vec, lanterns, height=2.6):
    wood = geo("wood_dark")
    cylinder(wood, v3(p.x, p.y, z - 0.3), 0.08, height + 0.3, seg=6)
    arm_end = v3(p.x + side_vec.x * 0.45, p.y + side_vec.y * 0.45, z + height - 0.05)
    tube(geo("iron"), [v3(p.x, p.y, z + height - 0.05), arm_end], 0.025, 4)
    lan = arm_end + Vector((0, 0, -0.32))
    box(geo("iron"), lan + Vector((0, 0, 0.17)), (0.26, 0.26, 0.04), fwd=(1, 0))
    box(geo("glow"), lan, (0.2, 0.2, 0.28), fwd=(1, 0))
    lanterns.append(lan)


def wall_lantern(p, n, z, lanterns):
    base = v3(p.x, p.y, z)
    out = base + Vector((n.x * 0.35, n.y * 0.35, 0))
    tube(geo("iron"), [base, out], 0.02, 4)
    lan = out + Vector((0, 0, -0.25))
    box(geo("glow"), lan, (0.17, 0.17, 0.24), fwd=(n.x, n.y))
    lanterns.append(lan)


# --------------------------------------------------------------------------
# buildings carved into the cliff
# --------------------------------------------------------------------------


# ==========================================================================
# facade kit (Phase 2 art pass): every building is authored from parts so the lane reads as
# built architecture: stone plinth + quoins, arched doors with voussoirs, framed windows with
# sills, lintels and painted shutters, balconies on corbels, deep eaves with rafter tails,
# drainpipes, hanging signs, grime gradients.
# ==========================================================================

# plaster washes (linear vertex colour, multiplies the cream plaster texture)
PLASTER_TINTS = [
    (1.0, 0.97, 0.9), (1.0, 0.86, 0.66), (1.0, 0.8, 0.72), (0.86, 0.9, 0.82), (1.0, 0.92, 0.76),
    (0.94, 0.88, 0.94), (1.0, 0.74, 0.55),
]
# painted joinery (linear), on the pale "paint" material
PAINTS = [
    (0.06, 0.26, 0.27), (0.1, 0.2, 0.11), (0.3, 0.07, 0.05), (0.07, 0.13, 0.26), (0.42, 0.28, 0.08),
    (0.05, 0.18, 0.2), (0.2, 0.22, 0.2),
]
PRODUCE = [(0.8, 0.55, 0.04), (0.75, 0.28, 0.02), (0.55, 0.06, 0.03), (0.2, 0.36, 0.06), (0.5, 0.1, 0.22), (0.85, 0.72, 0.18)]
CHIMNEYS = []


def mul(c, k):
    return (c[0] * k, c[1] * k, c[2] * k, 1)


def fpt(fc, t, out, u, z, d=0.0):
    """Point on a facade: u along t (left as seen from outside), z up, d out of the wall."""
    p = fc + t * u + out * d
    return v3(p.x, p.y, z)


def facade_quad(g, fc, t, out, u0, u1, z0, z1, d, cols):
    """Quad in the facade plane facing out. cols: (bl, br, tr, tl) as seen from outside."""
    g.quad(fpt(fc, t, out, u1, z0, d), fpt(fc, t, out, u0, z0, d), fpt(fc, t, out, u0, z1, d), fpt(fc, t, out, u1, z1, d),
           col=[cols[0], cols[1], cols[2], cols[3]])


def fbox(g, fc, t, out, n_in, u, z, d, size_u, size_z, size_d, col=(1, 1, 1, 1), cam=False):
    """Box on the facade: centre (u, z) with its back face on the wall plane pushed out d."""
    c = fpt(fc, t, out, u, z, d + size_d / 2)
    box(g, c, (size_d, size_u, size_z), fwd=n_in, col=col, cam=cam)


def wedge(g, fc, t, out, zc, r0, r1, a0, a1, d0, d1, col):
    def P(r, a, d):
        return fpt(fc, t, out, math.cos(a) * r, zc + math.sin(a) * r, d)
    q = [(P(r0, a0, d1), P(r0, a1, d1), P(r1, a1, d1), P(r1, a0, d1)),     # front
         (P(r0, a1, d0), P(r0, a0, d0), P(r0, a0, d1), P(r0, a1, d1)),     # soffit
         (P(r1, a0, d0), P(r1, a1, d0), P(r1, a1, d1), P(r1, a0, d1)),     # extrados
         (P(r0, a0, d0), P(r1, a0, d0), P(r1, a0, d1), P(r0, a0, d1)),
         (P(r1, a1, d0), P(r0, a1, d0), P(r0, a1, d1), P(r1, a1, d1))]
    for a, b, c, d in q:
        g.quad(a, b, c, d, col=col)


def lathe(g, base, profile, seg=10, col=(1, 1, 1, 1)):
    """Surface of revolution: profile = [(radius, z), ...] bottom to top."""
    b = Vector(base)
    rings = []
    for r, z in profile:
        rings.append([b + Vector((math.cos(2 * math.pi * i / seg) * r, math.sin(2 * math.pi * i / seg) * r, z)) for i in range(seg)])
    for k in range(len(rings) - 1):
        for i in range(seg):
            j = (i + 1) % seg
            g.quad(rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i], col=col,
                   uvs=[(i / seg, profile[k][1]), (j / seg, profile[k][1]), (j / seg, profile[k + 1][1]), (i / seg, profile[k + 1][1])])


def arched_door(fc, t, out, n_in, u, base_z, dw, hs, paint, shop, lanterns):
    """Arched doorway: dark void, plank leaves (or open with a lit interior), stone jambs + voussoirs."""
    r = dw / 2
    zc = base_z + hs
    dark = geo("window")
    # void: rectangle + semicircle fan
    facade_quad(dark, fc + t * u, t, out, -r, r, base_z, zc, 0.012, [(1, 1, 1, 1)] * 4)
    n = 8
    ctr = fpt(fc, t, out, u, zc, 0.012)
    for k in range(n):
        a0, a1 = math.pi * k / n, math.pi * (k + 1) / n
        dark.tri(ctr, fpt(fc, t, out, u + math.cos(a0) * r, zc + math.sin(a0) * r, 0.012),
                 fpt(fc, t, out, u + math.cos(a1) * r, zc + math.sin(a1) * r, 0.012))
    pg = geo("paint")
    pc = mul(paint, 1.0)
    if shop:
        # leaves folded open against the reveal, warm light inside the fanlight and low in the room
        for side in (-1, 1):
            hinge = fc + t * (u + side * r)
            a = hinge + out * 0.02
            b = hinge + out * 0.02 + (t * side * 0.12) + out * (r * 0.9)
            for zz0, zz1 in ((base_z + 0.05, zc - 0.05),):
                g2 = pg
                g2.quad(v3(a.x, a.y, zz0), v3(b.x, b.y, zz0), v3(b.x, b.y, zz1), v3(a.x, a.y, zz1), col=pc)
        fan = geo("glow")
        for k in range(n):
            a0, a1 = math.pi * k / n, math.pi * (k + 1) / n
            fan.tri(fpt(fc, t, out, u, zc, 0.016), fpt(fc, t, out, u + math.cos(a0) * r * 0.9, zc + math.sin(a0) * r * 0.9, 0.016),
                    fpt(fc, t, out, u + math.cos(a1) * r * 0.9, zc + math.sin(a1) * r * 0.9, 0.016))
        # lit interior band low in the doorway (a counter lamp beyond)
        facade_quad(geo("glow"), fc + t * u, t, out, -r * 0.55, r * 0.55, base_z + 0.9, base_z + 1.35, 0.014, [(0.55, 0.55, 0.55, 1)] * 4)
        lanterns.append(fpt(fc, t, out, u, base_z + 1.6, 0.3))
    else:
        # closed plank leaves with a centre stile
        planks = max(4, int(dw / 0.16))
        for k in range(planks):
            u0 = -r + dw * k / planks
            u1 = -r + dw * (k + 1) / planks - 0.01
            shade = 0.85 + 0.15 * ((k * 7919) % 11) / 10
            facade_quad(pg, fc + t * u, t, out, u0, u1, base_z + 0.02, zc - 0.02, 0.03, [mul(paint, shade)] * 4)
        for zz in (base_z + 0.5, zc - 0.45):
            fbox(pg, fc, t, out, n_in, u, zz, 0.035, dw - 0.06, 0.1, 0.03, mul(paint, 0.8))
        # iron ring handle
        fbox(geo("iron"), fc, t, out, n_in, u + r * 0.35, base_z + 1.05, 0.06, 0.06, 0.12, 0.04)
    stone = geo("mortar")
    # jambs: alternating long/short blocks
    z = base_z
    k = 0
    while z < zc - 0.05:
        h = min(0.36, zc - z)
        wblk = 0.34 if k % 2 == 0 else 0.24
        for side in (-1, 1):
            fbox(stone, fc, t, out, n_in, u + side * (r + wblk / 2), z + h / 2, 0.0, wblk, h - 0.02, 0.13,
                 col=mul((1, 1, 1), 0.86 + 0.1 * ((k + side) % 2)))
        z += h
        k += 1
    # voussoirs + keystone
    nv = 9
    for k in range(nv):
        a0 = math.pi * k / nv + 0.012
        a1 = math.pi * (k + 1) / nv - 0.012
        key = k == nv // 2
        wedge(stone, fc + t * u, t, out, zc, r, r + (0.4 if key else 0.3), a0, a1, 0.0, 0.18 if key else 0.13,
              col=mul((1, 1, 1), 0.92 if key else 0.84 + 0.08 * (k % 2)))
    # threshold step
    fbox(geo("step"), fc, t, out, n_in, u, base_z + 0.05, 0.0, dw + 0.3, 0.1, 0.32)


def window_unit(fc, t, out, n_in, u, wz, ww, wh, paint, glow, shutters, flower, lanterns):
    """Framed window: dark glass (or lit), frame + glazing bars, stone sill + lintel, painted shutters."""
    hw, hh = ww / 2, wh / 2
    glass = geo("glow" if glow else "window")
    facade_quad(glass, fc + t * u, t, out, -hw, hw, wz - hh, wz + hh, 0.01, [(1, 1, 1, 1)] * 4)
    frame = geo("paint")
    fcol = mul(paint, 0.9) if rng.random() < 0.5 else (0.9, 0.87, 0.8, 1)
    for (du, dz, su, sz) in ((0, hh, ww + 0.14, 0.07), (0, -hh, ww + 0.14, 0.07), (-hw, 0, 0.07, wh), (hw, 0, 0.07, wh),
                             (0, 0, 0.035, wh), (0, hh * 0.35, ww, 0.035)):
        fbox(frame, fc, t, out, n_in, u + du, wz + dz, 0.0, su, sz, 0.07, fcol)
    fbox(geo("step"), fc, t, out, n_in, u, wz - hh - 0.07, 0.0, ww + 0.3, 0.08, 0.17, (0.95, 0.95, 0.95, 1))
    fbox(geo("mortar"), fc, t, out, n_in, u, wz + hh + 0.12, 0.0, ww + 0.34, 0.18, 0.07, (0.9, 0.9, 0.9, 1))
    pg = geo("paint")
    pc = mul(paint, 1.0)
    if shutters == "open":
        for side in (-1, 1):
            hinge_u = u + side * (hw + 0.07)
            ang = math.radians(12)
            a = fc + t * hinge_u + out * 0.05
            dirv = t * (side * math.cos(ang)) + out * math.sin(ang)
            b = a + dirv * (hw - 0.02)
            # face out of the wall on both sides (winding)
            lo_a, lo_b = (a, b) if side < 0 else (b, a)
            pg.quad(v3(lo_a.x, lo_a.y, wz - hh), v3(lo_b.x, lo_b.y, wz - hh), v3(lo_b.x, lo_b.y, wz + hh), v3(lo_a.x, lo_a.y, wz + hh), col=pc)
            # louvre rails for relief
            for k in range(4):
                zz = wz - hh + wh * (k + 0.5) / 4
                m = a.lerp(b, 0.5) + out * 0.02
                box(pg, v3(m.x, m.y, zz), ((b - a).length * 0.92, 0.03, 0.05), fwd=(dirv.x, dirv.y), col=mul(paint, 0.72))
    elif shutters == "closed":
        for side in (-1, 1):
            facade_quad(pg, fc + t * u, t, out, 0 if side > 0 else -hw, hw if side > 0 else 0, wz - hh, wz + hh, 0.06, [pc] * 4)
            for k in range(5):
                zz = wz - hh + wh * (k + 0.5) / 5
                fbox(pg, fc, t, out, n_in, u + side * hw / 2, zz, 0.06, hw - 0.04, 0.05, 0.025, mul(paint, 0.7))
    if flower:
        fbox(geo("wood_dark"), fc, t, out, n_in, u, wz - hh - 0.2, 0.08, ww + 0.1, 0.22, 0.22)
        c = fpt(fc, t, out, u, wz - hh - 0.08, 0.2)
        plant("shrub", (c.x, c.y, c.z), 0.42 + rng.random() * 0.12)
        for k in range(4):
            fp = fpt(fc, t, out, u - hw + ww * (k + 0.5) / 4, wz - hh + 0.02 + rng.random() * 0.1, 0.24 + rng.random() * 0.06)
            blob(geo("produce"), fp, 0.06, 0.8, col=rng.choice([(0.7, 0.05, 0.08, 1), (0.85, 0.3, 0.45, 1), (0.9, 0.75, 0.15, 1)]), seed=k)
    if glow and rng.random() < 0.35:
        lanterns.append(fpt(fc, t, out, u, wz, 0.1))


def rafter_eave(fc, t, out, n_in, width, top, depth, overhang=0.62, pitch=0.42, col=(1, 1, 1, 1), chimney=False):
    """Tiled lean-to roof rising into the rock: deep front eave, rafter tails, fascia, barrel-tile edge."""
    r = geo("roof")
    wd = geo("wood_dark")
    run = depth * 0.8 + overhang
    rise = run * pitch
    e0 = fc + t * (width / 2 + 0.3) + out * overhang
    e1 = fc + t * (-width / 2 - 0.3) + out * overhang
    b0 = e0 - out * run
    b1 = e1 - out * run
    ze = top - 0.05
    # winding matters for the AO bake: the tiles face up, the soffit faces down
    r.quad(v3(e0.x, e0.y, ze), v3(e1.x, e1.y, ze), v3(b1.x, b1.y, ze + rise), v3(b0.x, b0.y, ze + rise), col=col)
    wd.quad(v3(e1.x, e1.y, ze - 0.06), v3(e0.x, e0.y, ze - 0.06), v3(b0.x, b0.y, ze + rise - 0.06), v3(b1.x, b1.y, ze + rise - 0.06),
            col=(0.7, 0.7, 0.7, 1))
    # fascia
    mid = e0.lerp(e1, 0.5)
    box(wd, v3(mid.x, mid.y, ze - 0.06), (0.05, width + 0.6, 0.16), fwd=n_in, col=(0.8, 0.8, 0.8, 1))
    # rafter tails
    n = max(3, int(width / 0.55))
    for k in range(n + 1):
        uu = -width / 2 + width * k / n
        c = fpt(fc, t, out, uu, ze - 0.14, overhang * 0.5)
        box(wd, c, (overhang, 0.08, 0.11), fwd=n_in, col=(0.75, 0.75, 0.75, 1))
    # barrel-tile edge along the eave: short half cylinders running up the slope
    slope = Vector((-out.x * run, -out.y * run, rise)).normalized()
    across = Vector((t.x, t.y, 0))
    n = int((width + 0.6) / 0.24)
    for k in range(n):
        uu = -width / 2 - 0.3 + 0.24 * (k + 0.5)
        base = fpt(fc, t, out, uu, ze + 0.02, overhang - 0.02)
        pts = []
        for j in range(5):
            a = math.pi * j / 4
            pts.append(across * (math.cos(a) * 0.085) + Vector((0, 0, math.sin(a) * 0.07)))
        L = 0.42
        for j in range(4):
            p0, p1 = base + pts[j], base + pts[j + 1]
            r.quad(p0, p1, p1 + slope * L, p0 + slope * L, col=mul((1, 1, 1), 0.95))
    if chimney:
        cu = (rng.random() - 0.5) * width * 0.6
        c = fpt(fc, t, out, cu, ze + rise * 0.6, -run * 0.55 + overhang)
        box(geo("plaster"), v3(c.x, c.y, c.z + 0.5), (0.55, 0.55, 1.6), fwd=(t.x, t.y), col=(0.8, 0.78, 0.74, 1))
        box(geo("mortar"), v3(c.x, c.y, c.z + 1.35), (0.7, 0.7, 0.1), fwd=(t.x, t.y))
        CHIMNEYS.append(v3(c.x, c.y, c.z + 1.45))


def balcony_unit(fc, t, out, n_in, u, bz, bw, paint, lanterns):
    """Timber balcony slab on three corbels with an iron railing and a tall door behind."""
    wood = geo("wood")
    fbox(wood, fc, t, out, n_in, u, bz, 0.0, bw, 0.14, 0.95)
    for k in (-1, 0, 1):
        cu = u + k * (bw / 2 - 0.2)
        for j, (dz, dd) in enumerate(((-0.12, 0.8), (-0.3, 0.55), (-0.46, 0.3))):
            fbox(geo("wood_dark"), fc, t, out, n_in, cu, bz + dz, 0.0, 0.14, 0.18, dd)
    iron = geo("iron")
    rail_d = 0.9
    fbox(iron, fc, t, out, n_in, u, bz + 0.95, rail_d - 0.03, bw, 0.05, 0.05)
    fbox(iron, fc, t, out, n_in, u, bz + 0.16, rail_d - 0.03, bw, 0.04, 0.04)
    n = int(bw / 0.14)
    for k in range(n + 1):
        fbox(iron, fc, t, out, n_in, u - bw / 2 + bw * k / n, bz + 0.55, rail_d - 0.025, 0.025, 0.8, 0.025)
    for side in (-1, 1):
        for k in range(6):
            dd = 0.08 + (rail_d - 0.1) * k / 5
            fbox(iron, fc, t, out, n_in, u + side * bw / 2, bz + 0.55, dd, 0.025, 0.8, 0.025)
    # French window behind
    window_unit(fc, t, out, n_in, u, bz + 1.2, 1.0, 2.0, paint, rng.random() < 0.4, "open", False, lanterns)
    if rng.random() < 0.8:
        a = fpt(fc, t, out, u - bw * 0.35, bz + 0.95, rail_d)
        b = fpt(fc, t, out, u + bw * 0.05, bz + 0.95, rail_d)
        cloth(geo(rng.choice(["cloth_red", "cloth_cream", "cloth_blue"])), a, b, 0.9, cols=2, rows=4)
    if rng.random() < 0.6:
        for k in range(2):
            c = fpt(fc, t, out, u + bw * (0.3 - 0.2 * k), bz + 0.08, 0.3)
            lathe(geo("roof"), c, [(0.12, 0), (0.16, 0.22), (0.19, 0.3)], seg=8)
            plant("shrub", (c.x, c.y, c.z + 0.28), 0.5)


def hanging_sign(fc, t, out, n_in, u, z, paint):
    """Iron bracket out from the wall with a painted board swinging under it: reads down the lane."""
    a = fpt(fc, t, out, u, z, 0.0)
    b = fpt(fc, t, out, u, z, 0.95)
    tube(geo("iron"), [a, b], 0.022, 4)
    tube(geo("iron"), [fpt(fc, t, out, u, z - 0.45, 0.0), a.lerp(b, 0.6)], 0.016, 4)
    g = geo("paint")
    top = z - 0.16
    c0 = fpt(fc, t, out, u, top, 0.22)
    c1 = fpt(fc, t, out, u, top, 0.86)
    for c in (c0, c1):
        tube(geo("iron"), [c + Vector((0, 0, 0.16)), c], 0.008, 3)
    # board hangs in the plane perpendicular to the wall (facing along the lane); swings on _WIND
    wv = (0.0, 0.0, 0.5, 0.5)
    for dt_, shade in ((0.022, 1.0), (-0.022, 0.92)):
        off = Vector((t.x * dt_, t.y * dt_, 0))
        g.quad(c0 + off, c1 + off, c1 + off + Vector((0, 0, -0.52)), c0 + off + Vector((0, 0, -0.52)), col=mul(paint, shade), wind=wv)
    # gilt border
    g2 = geo("brass")
    for dt_ in (0.028, -0.028):
        off = Vector((t.x * dt_, t.y * dt_, 0))
        g2.quad(c0 + off + Vector((0, 0, -0.04)), c1 + off + Vector((0, 0, -0.04)), c1 + off + Vector((0, 0, -0.07)), c0 + off + Vector((0, 0, -0.07)), wind=(0, 0, 0.05, 0.05))


def building(front_center, n_in, width, height, depth, base_z, lanterns, banners, style=0, glow_windows=0.25,
             balcony=False, roof="flat", awning=None, detail=True):
    """front_center: xy on the facade; n_in: unit xy pointing INTO the rock (away from the lane)."""
    n_in = n_in.normalized()
    t = v2(-n_in.y, n_in.x)
    fc = front_center
    out = -n_in
    mat = "plaster" if style % 2 == 0 else "plaster_warm"
    tint = PLASTER_TINTS[rng.randrange(len(PLASTER_TINTS))]
    paint = PAINTS[rng.randrange(len(PAINTS))]
    g = geo(mat)
    top = base_z + height - 0.5
    # body: side + back walls as a box (camera collider too); the street facade gets its own gradient
    center = fc + n_in * (depth / 2)
    box(g, v3(center.x, center.y, base_z + height / 2 - 0.5), (depth, width, height + 1.0), fwd=n_in, col=mul(tint, 0.9), cam=True, top=True)
    damp = mul(tint, 0.62)
    mid = mul(tint, 0.9)
    hi = mul(tint, 1.0)
    under = mul(tint, 0.82)
    z_d = base_z + 1.1
    facade_quad(g, fc, t, out, -width / 2, width / 2, base_z - 0.5, z_d, 0.005, [damp, damp, mid, mid])
    facade_quad(g, fc, t, out, -width / 2, width / 2, z_d, top - 0.6, 0.005, [mid, mid, hi, hi])
    facade_quad(g, fc, t, out, -width / 2, width / 2, top - 0.6, top, 0.005, [hi, hi, under, under])
    if not detail:
        return
    stone = geo("mortar")
    # plinth + quoins
    fbox(stone, fc, t, out, n_in, 0, base_z + 0.3, 0.0, width + 0.08, 0.95, 0.07, (0.8, 0.78, 0.75, 1))
    fbox(geo("step"), fc, t, out, n_in, 0, base_z + 0.8, 0.0, width + 0.12, 0.08, 0.1, (0.9, 0.9, 0.9, 1))
    z = base_z + 0.84
    k = 0
    while z < top - 0.3:
        h = 0.32
        for side in (-1, 1):
            wq = 0.42 if (k + (side > 0)) % 2 == 0 else 0.26
            fbox(stone, fc, t, out, n_in, side * (width / 2 - wq / 2 + 0.03), z + h / 2, 0.0, wq, h - 0.025, 0.05,
                 col=mul((1, 1, 1), 0.86 + 0.06 * (k % 2)))
        z += h
        k += 1
    floors = max(1, int((height - 0.5) / 3.0))
    # string courses at the floor lines
    for fl in range(1, floors):
        fbox(geo("step"), fc, t, out, n_in, 0, base_z + fl * 3.0 + 0.2, 0.0, width, 0.1, 0.09, (0.92, 0.92, 0.92, 1))
    # ground floor: arched door (a shop when the lane is a market) + a window
    door_w = min(1.5, max(1.05, width * 0.26))
    door_u = (rng.random() - 0.5) * (width - door_w - 1.4) * 0.8
    shop = rng.random() < 0.55
    arched_door(fc, t, out, n_in, door_u, base_z, door_w, 1.95, paint, shop, lanterns)
    if width > 4.2:
        wu = door_u + (1 if door_u < 0 else -1) * (door_w / 2 + 1.1)
        if abs(wu) < width / 2 - 0.6:
            window_unit(fc, t, out, n_in, wu, base_z + 1.55, 0.75, 1.05, paint, rng.random() < glow_windows,
                        rng.choice(["open", "closed", None]), False, lanterns)
    # upper floors
    bal_floor = 1 if (balcony and floors > 1) else -1
    for fl in range(1, floors):
        wz = base_z + fl * 3.0 + 1.55
        if wz + 0.7 > top - 0.2:
            break
        if fl == bal_floor:
            bw = min(width * 0.62, 3.2)
            balcony_unit(fc, t, out, n_in, 0.0, base_z + fl * 3.0 + 0.3, bw, paint, lanterns)
            for side in (-1, 1):
                wu = side * (bw / 2 + 0.75)
                if abs(wu) < width / 2 - 0.55:
                    window_unit(fc, t, out, n_in, wu, wz, 0.7, 1.15, paint, rng.random() < glow_windows, "open", rng.random() < 0.5, lanterns)
            continue
        nwin = max(1, int(width / 2.1))
        for wi in range(nwin):
            wu = ((wi + 0.5) / nwin - 0.5) * width
            window_unit(fc, t, out, n_in, wu, wz, 0.72, 1.2, paint, rng.random() < glow_windows,
                        rng.choice(["open", "open", "closed", None]), rng.random() < 0.35, lanterns)
    # roofline
    if roof == "tile":
        rafter_eave(fc, t, out, n_in, width, top, depth, col=mul((1, 1, 1), 0.9 + 0.1 * rng.random()), chimney=rng.random() < 0.5)
    else:
        fbox(geo("step"), fc, t, out, n_in, 0, top - 0.12, 0.0, width + 0.1, 0.12, 0.14, (0.92, 0.92, 0.92, 1))
        fbox(geo("step"), fc, t, out, n_in, 0, top + 0.02, 0.0, width + 0.2, 0.14, 0.26, (0.95, 0.95, 0.95, 1))
        for side in (-1, 1):
            e = fc + t * (side * width / 2)
            box(g, v3(e.x + n_in.x * depth / 2, e.y + n_in.y * depth / 2, top + 0.4), (depth, 0.25, 0.7), fwd=n_in, col=mul(tint, 0.9))
        fbox(g, fc, t, out, n_in, 0, top + 0.45, -0.25, width, 0.7, 0.25, mul(tint, 0.95))
        fbox(geo("step"), fc, t, out, n_in, 0, top + 0.83, -0.28, width + 0.06, 0.06, 0.34)
        if rng.random() < 0.75:
            pc = fc + n_in * 1.0 + t * ((rng.random() - 0.5) * width * 0.6)
            plant("shrub", (pc.x, pc.y, top + 0.1), 1.1 + rng.random() * 0.6)
        if rng.random() < 0.45:
            # rooftop laundry line
            a = fc + n_in * 1.4 + t * (-width * 0.35)
            b = fc + n_in * 1.4 + t * (width * 0.35)
            line = catenary(v3(a.x, a.y, top + 1.6), v3(b.x, b.y, top + 1.6), 0.18, 8)
            tube(geo("rope"), line, 0.01, 3)
            for j in range(1, 7, 2):
                cloth(geo(rng.choice(["cloth_cream", "cloth_blue", "cloth_red"])), line[j], line[j + 1], 0.55 + rng.random() * 0.3, cols=1, rows=3)
    # drainpipe at one corner
    du = (width / 2 - 0.22) * (1 if rng.random() < 0.5 else -1)
    p = fpt(fc, t, out, du, base_z, 0.09)
    cylinder(geo("iron"), p, 0.045, top - base_z - 0.25, seg=6, top=False)
    fbox(geo("iron"), fc, t, out, n_in, du, top - 0.3, 0.02, 0.2, 0.22, 0.2)
    # hanging trade sign by the door, a wall lamp on the other side
    if shop or rng.random() < 0.4:
        hanging_sign(fc, t, out, n_in, door_u + (door_w / 2 + 0.4) * (1 if rng.random() < 0.5 else -1), base_z + 3.25, paint)
    if awning:
        a0 = fc + t * (-awning / 2) + out * 0.02
        a1 = fc + t * (awning / 2) + out * 0.02
        striped_awning(v3(a0.x, a0.y, base_z + 2.95), v3(a1.x, a1.y, base_z + 2.95), out, paint)
    if rng.random() < 0.45 and height > 4:
        bc = fc + t * (width * (0.25 if rng.random() < 0.5 else -0.25)) + out * 0.06
        b0 = bc + t * -0.4
        b1 = bc + t * 0.4
        cloth(geo(rng.choice(["cloth_red", "cloth_red", "cloth_blue"])), v3(b0.x, b0.y, top - 0.3), v3(b1.x, b1.y, top - 0.3), min(2.6, height - 2.4), cols=2, rows=6)
        banners.append({"top": [bc.x, bc.y, top - 0.3]})
    # vines climbing one corner
    if rng.random() < 0.3:
        vu = -du
        a = fpt(fc, t, out, vu - 0.5, top - 0.2, 0.08)
        b = fpt(fc, t, out, vu + 0.5, top - 0.2, 0.08)
        cloth(geo("foliage"), a, b, min(height - 1.2, 3.5 + rng.random() * 2), cols=2, rows=6)
    return {"fc": fc, "t": t, "out": out, "door_u": door_u, "door_w": door_w, "base_z": base_z, "paint": paint, "shop": shop}


def striped_awning(a, b, out, paint):
    """Sloped canvas awning in cream with coloured stripes, on two iron rods."""
    g = geo("cloth_cream")
    cols, rows = 10, 3
    stripe = PAINTS[rng.randrange(len(PAINTS))] if rng.random() < 0.5 else (0.62, 0.1, 0.07)
    grid = []
    for r in range(rows + 1):
        tt = r / rows
        row = []
        for c in range(cols + 1):
            s = c / cols
            p = a.lerp(b, s) + Vector((out.x * 1.35 * tt, out.y * 1.35 * tt, -0.55 * tt))
            row.append(g.vert(p, tt * 0.6))
        grid.append(row)
    for r in range(rows):
        for c in range(cols):
            col = (1, 1, 1, 1) if c % 2 == 0 else (stripe[0] * 1.4, stripe[1] * 1.4, stripe[2] * 1.4, 1)
            g.face([grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]],
                   uvs=[(c / cols, 1 - r / rows), ((c + 1) / cols, 1 - r / rows), ((c + 1) / cols, 1 - (r + 1) / rows), (c / cols, 1 - (r + 1) / rows)],
                   col=col)
    # scalloped valance
    for c in range(cols):
        p0 = Vector(g.verts[grid[rows][c]])
        p1 = Vector(g.verts[grid[rows][c + 1]])
        col = (1, 1, 1, 1) if c % 2 == 0 else (stripe[0] * 1.4, stripe[1] * 1.4, stripe[2] * 1.4, 1)
        g.tri(p0, p1, p0.lerp(p1, 0.5) + Vector((0, 0, -0.16)), col=col, wind=(0.6, 0.6, 1.0))
    for e in (a, b):
        tip = e + Vector((out.x * 1.35, out.y * 1.35, -0.55))
        tube(geo("iron"), [e + Vector((0, 0, 0.35)), tip], 0.015, 3)
    # the camera arm stops at a canopy instead of passing through it
    mid = a.lerp(b, 0.5) + Vector((out.x * 0.65, out.y * 0.65, -0.3))
    o2 = Vector((out.x, out.y)).normalized()
    box(COL_CAM, mid, (1.4, (b - a).length, 0.7), fwd=(-o2.x, -o2.y))



def cliff_wall_u(zr, hw, H, dz):
    """Approximate land-side cliff offset (from centerline) at height dz above the ledge."""
    return hw + 0.25 + 0.45 + dz * 0.2 + 1.5 * min(1.0, dz / max(H, 1))


# --------------------------------------------------------------------------
# the settlement
# --------------------------------------------------------------------------


def build_settlement(meta):
    lanterns, banners = meta["lanterns"], meta["banners"]
    # lane-front buildings (land side) along lane + arch + landing stretches
    s = ROUTE_S0 + 18.0
    while s < ROUTE_S_QUAY - 4:
        kind = kind_at(s)
        width = 4.5 + rng.random() * 3.5
        if kind in ("lane", "arch", "landing", "boardwalk") and gorge_amount(s) < 0.01:
            p, _, smp = route_at_spine(s)
            hw = width_at(s) / 2
            zr = ledge_z(s)
            L = smp["L"]
            if kind == "boardwalk":
                fc = p + L * (hw * 0.3 + 0.8)
                building(fc, L, width, 3.6 + rng.random() * 1.5, 4.0, zr - 0.2, lanterns, banners, style=rng.randint(0, 3),
                         roof="tile", glow_windows=0.5, awning=None)
            else:
                fc = p + L * (hw + 0.26)
                h = 5.0 + rng.random() * 4.0 if kind != "arch" else 9.5
                stall = kind == "lane" and width_at(s) > 4.3
                building(fc, L, width, h, 6.0, zr, lanterns, banners, style=rng.randint(0, 3),
                         balcony=rng.random() < 0.5, roof="flat", awning=(width * 0.7 if (stall or rng.random() < 0.35) else None))
                if rng.random() < 0.5:
                    wall_lantern(fc + smp["T"] * (width * 0.45), -L, zr + 2.8, lanterns)
                if stall:
                    market_stall(p, smp, hw, zr, lanterns)
        s += width + 0.2
    # stacked upper city on the cliff wall
    for tier, (dz0, spacing, keep) in enumerate(((8.5, 6.5, 0.8), (16.5, 7.5, 0.65), (26.0, 9.0, 0.5), (37.0, 11.0, 0.35))):
        s = ROUTE_S0 + 8.0 + tier * 3.0
        while s < ROUTE_S_QUAY + 30:
            width = 4.0 + rng.random() * 4.0
            ss = min(s, SPINE[-1]["s"] - 1)
            if gorge_amount(ss) < 0.01 and rng.random() < keep:
                p, _, smp = route_at_spine(ss)
                zr = ledge_z(ss)
                H = max(6.0, ztop_at(ss) - zr)
                if dz0 + 5 < H:
                    hw = width_at(ss) / 2
                    u = cliff_wall_u(zr, hw, H, dz0) - 1.4
                    fc = smp["p"] + smp["L"] * u
                    building(fc, smp["L"], width, 5.0 + rng.random() * 3.5, 7.0, zr + dz0, lanterns, banners,
                             style=rng.randint(0, 3), balcony=rng.random() < 0.4, roof="tile" if rng.random() < 0.35 else "flat",
                             glow_windows=0.35)
                    # a terrace ledge + vines under it
                    ter = fc - smp["L"] * 0.8
                    box(geo("mortar"), v3(ter.x, ter.y, zr + dz0 - 0.2), (width + 0.6, 1.8, 0.4), fwd=smp["T"], col=(0.8, 0.8, 0.8, 1))
                    if rng.random() < 0.6:
                        vc = ter - smp["L"] * 0.6
                        cloth(geo("foliage"), v3(vc.x - smp["T"].x * 0.8, vc.y - smp["T"].y * 0.8, zr + dz0 - 0.1),
                              v3(vc.x + smp["T"].x * 0.8, vc.y + smp["T"].y * 0.8, zr + dz0 - 0.1), 2.5 + rng.random() * 3, cols=2, rows=5)
            s += width + 1.0 + rng.random() * 2.0
    # lower town at the harbour: houses on the shore ledge south of the quay
    s = NODE_S[ROUTE_LAST_ON_SPINE] + 8.0
    while s < NODE_S[ROUTE_LAST_ON_SPINE + 5]:
        width = 5.0 + rng.random() * 3.0
        p, _, smp = route_at_spine(s)
        zr = ledge_z(s)
        hw = width_at(s) / 2
        fc = p + smp["L"] * (hw + 0.26)
        building(fc, smp["L"], width, 4.5 + rng.random() * 3.0, 6.0, zr, lanterns, banners, style=rng.randint(0, 3),
                 roof="tile", glow_windows=0.45, awning=width * 0.6 if rng.random() < 0.5 else None)
        s += width + 0.3


def market_stall(p, smp, hw, zr, lanterns):
    L, T = smp["L"], smp["T"]
    c = p + L * (hw - 0.55)
    box(geo("wood"), v3(c.x, c.y, zr + 0.45), (1.9, 0.8, 0.9), fwd=T, col=(0.9, 0.9, 0.9, 1), wall=True)
    for j in range(3):
        g = geo(rng.choice(["cloth_red", "foliage", "sand", "plaster_warm"]))
        gc = c + T * ((j - 1) * 0.55)
        box(g, v3(gc.x, gc.y, zr + 1.02), (0.45, 0.5, 0.22), fwd=T)
    for side in (-1, 1):
        post = c + T * (side * 0.95) - L * 0.35
        cylinder(geo("wood_dark"), v3(post.x, post.y, zr), 0.05, 2.2, seg=5)
    for j in range(rng.randint(1, 3)):
        bc = c + T * (1.3 + j * 0.55) + L * 0.1
        cylinder(geo("wood"), v3(bc.x, bc.y, zr), 0.28, 0.8, seg=8)
        box(COL_WALL, v3(bc.x, bc.y, zr + 0.6), (0.6, 0.6, 1.2), fwd=T)


def build_arch(meta):
    """Arch passage: a vaulted span over the lane with an arcade opening to the sea."""
    i0 = [i for i, n in enumerate(SPINE_NODES) if n[4] == "arch"][0]
    s0, s1 = NODE_S[i0] + 1.0, NODE_S[i0 + 2] - 1.0
    s = s0
    pier_positions = []
    while s <= s1 + 1e-3:
        p, _, smp = route_at_spine(s)
        pier_positions.append((p, smp, ledge_z(s), width_at(s) / 2))
        s += 3.2
    for k, (p, smp, zr, hw) in enumerate(pier_positions):
        L, T = smp["L"], smp["T"]
        sea_pier = p - L * (hw + 0.35)
        box(geo("plaster"), v3(sea_pier.x, sea_pier.y, zr + 1.9 - 1.0), (0.7, 0.7, 5.8), fwd=T, cam=True)
        box(COL_WALL, v3(sea_pier.x, sea_pier.y, zr + 1.2), (0.7, 0.7, 2.4), fwd=T)
    # roof slab + upper storey over the passage
    for k in range(len(pier_positions) - 1):
        (pa, sa, za, hwa), (pb, sb, zb, hwb) = pier_positions[k], pier_positions[k + 1]
        mid = pa.lerp(pb, 0.5)
        L, T = sa["L"], sa["T"]
        zr = (za + zb) / 2
        length = (pb - pa).length + 0.05
        cen = mid - L * 0.2
        box(geo("plaster"), v3(cen.x, cen.y, zr + 4.45), (length, hwa * 2 + 1.6, 0.5), fwd=T, bottom=True, cam=True)
        # barrel vault springing from the walls at 2.9 m, crown just under the slab
        vault = geo("mortar")
        span = hwa + 0.35
        n_arc = 8
        for j in range(n_arc):
            a0, a1 = math.pi * j / n_arc, math.pi * (j + 1) / n_arc
            def ring(a):
                return (math.cos(a) * span, 2.9 + math.sin(a) * 1.25)
            (u0, h0), (u1, h1) = ring(a0), ring(a1)
            pa0 = pa + sa["L"] * u0 - sa["L"] * 0.2
            pa1 = pa + sa["L"] * u1 - sa["L"] * 0.2
            pb0 = pb + sb["L"] * u0 - sb["L"] * 0.2
            pb1 = pb + sb["L"] * u1 - sb["L"] * 0.2
            shade = 0.72 + 0.28 * math.sin(a0 + 0.2)
            vault.quad(v3(pa0.x, pa0.y, za + h0), v3(pb0.x, pb0.y, zb + h0), v3(pb1.x, pb1.y, zb + h1), v3(pa1.x, pa1.y, za + h1),
                       col=(shade, shade, shade, 1))
        # a transverse rib at each pier line
        rib = pa - sa["L"] * 0.2
        box(geo("step"), v3(rib.x, rib.y, za + 4.12), (0.35, hwa * 2 + 0.8, 0.22), fwd=T)
        box(geo("plaster_warm"), v3(cen.x, cen.y, zr + 6.4), (length, hwa * 2 + 1.2, 3.6), fwd=T, cam=True)
        # arched opening on the sea side: lintel between piers + low balustrade
        sea = mid - L * (hwa + 0.35)
        box(geo("mortar"), v3(sea.x, sea.y, zr + 3.4), (length - 0.6, 0.6, 0.9), fwd=T)
        box(geo("mortar"), v3(sea.x, sea.y, zr + 0.45), (length - 0.6, 0.45, 0.9), fwd=T)
        # windows on the upper storey facing the sea
        box(geo("glow" if k % 2 == 0 else "window"), v3(sea.x, sea.y, zr + 6.3), (length * 0.35, 0.7, 1.0), fwd=T)
        # a lantern hanging from the vault crown every bay
        hang = mid - L * 0.2
        tube(geo("iron"), [v3(hang.x, hang.y, zr + 4.15), v3(hang.x, hang.y, zr + 3.35)], 0.012, 3)
        box(geo("glow"), v3(hang.x, hang.y, zr + 3.2), (0.22, 0.22, 0.3), fwd=T)
        meta["lanterns"].append(v3(hang.x, hang.y, zr + 3.2))


def build_edges(meta):
    lanterns = meta["lanterns"]
    # indices of route samples by kind runs
    runs = []
    k = 0
    while k < len(ROUTE) - 1:
        kind = ROUTE[k]["kind"]
        j = k
        while j < len(ROUTE) - 1 and ROUTE[j]["kind"] == kind:
            j += 1
        runs.append((kind, k, j))
        k = j
    for idx, (kind, k0, k1) in enumerate(runs):
        if kind == "terrace":
            parapet_run(k0, k1, side=-1, height=0.95, thick=0.55)
            # east end wall of the terrace
            r = ROUTE[0]
            l, rt = edges(r)
            mid = l.lerp(rt, 0.5) - r["T"] * 0.3
            box(geo("mortar"), v3(mid.x, mid.y, r["z"] + 0.35), (0.55, r["w"] + 0.8, 1.9), fwd=r["T"])
        elif kind == "stairs":
            if idx == 1 or idx >= len(runs) - 4:
                posts = rope_rail(k0, k1, side=-1)
                for pi, p in enumerate(posts):
                    if pi % 3 == 1:
                        lantern_post(p.to_2d() - ROUTE[k0]["L"] * 0.25, p.z, -ROUTE[k0]["L"], lanterns, height=1.9)
            else:
                parapet_run(k0, k1, side=-1, height=0.9)
        elif kind in ("lane", "landing"):
            parapet_run(k0, k1, side=-1, height=0.85)
        elif kind == "bridge":
            posts_l = rope_rail(k0, k1, side=1, spacing=1.6, post_h=1.0, bridge=True)
            posts_r = rope_rail(k0, k1, side=-1, spacing=1.6, post_h=1.0, bridge=True)
            rope = geo("rope")
            for posts in (posts_l, posts_r):
                a, b = posts[0], posts[-1]
                tube(rope, catenary(a + Vector((0, 0, 1.6)), b + Vector((0, 0, 1.6)), 0.9, 16), 0.05, 5,
                     wind_fn=lambda t: 0.35 * math.sin(math.pi * t))
            # under-deck beams
            for k in range(k0, k1, 4):
                r = ROUTE[k]
                if in_hole(ROUTE_LEN - r["s"]):
                    continue
                box(geo("wood_dark"), v3(r["p"].x, r["p"].y, r["z"] - 0.2), (0.2, r["w"] + 0.5, 0.18), fwd=r["T"])
        elif kind in ("boardwalk", "pier"):
            rail_posts = []
            acc = 99.0
            for k in range(k0, k1 + 1):
                r = ROUTE[k]
                if k > k0:
                    acc += (r["p"] - ROUTE[k - 1]["p"]).length
                if (acc >= 2.2 or k == k1) and not in_hole(ROUTE_LEN - r["s"]):
                    acc = 0.0
                    for side in ((-1, 1) if kind == "pier" else (-1,)):
                        e = r["p"] + r["L"] * (side * (r["w"] / 2 + 0.08))
                        base = -3.0 if kind == "pier" else r["z"] - 3.5
                        cylinder(geo("wood_dark"), v3(e.x, e.y, base), 0.14 if kind == "pier" else 0.1, r["z"] - base + 1.0, seg=6)
                        rail_posts.append((side, v3(e.x, e.y, r["z"] + 0.95)))
                    if kind == "pier":
                        box(geo("wood_dark"), v3(r["p"].x, r["p"].y, r["z"] - 0.28), (0.2, r["w"] + 0.5, 0.2), fwd=r["T"])
            rope = geo("rope")
            for side in (-1, 1):
                pts = [p for s_, p in rail_posts if s_ == side]
                for a, b in zip(pts, pts[1:]):
                    if kind == "pier":
                        tube(rope, catenary(a, b, 0.14, 5), 0.03, 4, wind_fn=lambda t: 0.2 * math.sin(math.pi * t))
                    else:
                        box(geo("wood"), a.lerp(b, 0.5), ((b - a).length, 0.08, 0.08), fwd=(b - a).to_2d())
            if kind == "pier":
                for k in range(k0 + 6, k1, 12):
                    r = ROUTE[k]
                    side = 1 if (k // 12) % 2 else -1
                    e = r["p"] + r["L"] * (side * (r["w"] / 2 + 0.08))
                    lantern_post(e, r["z"], r["L"] * side, lanterns, height=2.2)
        elif kind == "quay":
            # bollards along the sea edge with a heavy rope between them
            bol = []
            for k in range(k0, k1, 5):
                r = ROUTE[k]
                if r["spine_s"] is not None:
                    e = r["p"] - r["L"] * (r["w"] / 2 - 0.25)
                    cylinder(geo("iron"), v3(e.x, e.y, r["z"]), 0.22, 0.75, seg=8)
                    bol.append(v3(e.x, e.y, r["z"] + 0.6))
            for a, b in zip(bol, bol[1:]):
                tube(geo("rope"), catenary(a, b, 0.25, 6), 0.04, 4)
    # end-of-pier platform rail across the end
    r = ROUTE[-1]
    l, rt = edges(r)
    box(geo("wood"), v3((l.x + rt.x) / 2, (l.y + rt.y) / 2, r["z"] + 0.95), (0.1, r["w"] + 0.3, 0.1), fwd=r["T"])


def build_props(meta):
    lanterns = meta["lanterns"]
    # terrace: foreground framing (lantern post, banner pole, planter, broken column)
    r0 = ROUTE[4]
    L, T = r0["L"], r0["T"]
    z = r0["z"]
    lp = r0["p"] - L * 3.4 + T * 1.5
    lantern_post(lp, z, -L, lanterns, height=2.9)
    pole = r0["p"] + L * 3.3 + T * 3.0
    cylinder(geo("wood_dark"), v3(pole.x, pole.y, z), 0.09, 5.2, seg=6)
    cloth(geo("cloth_red"), v3(pole.x, pole.y, z + 5.0) + Vector((T.x * 0.05, T.y * 0.05, 0)),
          v3(pole.x, pole.y, z + 5.0) + Vector((-L.x * 1.0, -L.y * 1.0, 0)), 2.8, cols=3, rows=8)
    meta["banners"].append({"top": [pole.x, pole.y, z + 5.0], "pole": True})
    box(COL_WALL, v3(pole.x, pole.y, z + 1), (0.4, 0.4, 2), fwd=T)
    for j in range(3):
        pc = ROUTE[8 + j * 5]["p"] + ROUTE[8 + j * 5]["L"] * 3.3
        box(geo("mortar"), v3(pc.x, pc.y, z + 0.25), (1.1, 0.9, 0.5), fwd=ROUTE[8 + j * 5]["T"], wall=True)
        plant("shrub", (pc.x, pc.y, z + 0.5), 1.2 + 0.25 * j)
        plant("fern", (pc.x + 0.3, pc.y - 0.2, z + 0.5), 0.9)
    col = ROUTE[14]["p"] + ROUTE[14]["L"] * 3.0
    cylinder(geo("mortar"), v3(col.x, col.y, z), 0.35, 2.6, seg=10)
    box(COL_WALL, v3(col.x, col.y, z + 1), (0.8, 0.8, 2), fwd=T)
    # quay clutter: crates, barrels, nets, a crane
    quay_k = [k for k, r in enumerate(ROUTE) if r["kind"] == "quay"]
    for n in range(10):
        k = quay_k[rng.randint(0, len(quay_k) - 1)]
        r = ROUTE[k]
        if r["spine_s"] is None and n % 2 == 0:
            continue
        side = 1
        e = r["p"] + r["L"] * (side * (r["w"] / 2 - 0.5 - rng.random() * 0.6))
        if rng.random() < 0.5:
            sz = 0.6 + rng.random() * 0.4
            box(geo("wood"), v3(e.x, e.y, r["z"] + sz / 2), (sz, sz, sz), fwd=(rng.random() - 0.5, 1), wall=True)
        else:
            cylinder(geo("wood_dark"), v3(e.x, e.y, r["z"]), 0.3, 0.9, seg=8)
            box(COL_WALL, v3(e.x, e.y, r["z"] + 0.6), (0.62, 0.62, 1.2), fwd=r["T"])
    meta["crane"] = {"tip": [0.0, 0.0, 0.0]}  # superseded by the RIDE crane (rigs.crane)
    # bunting across the lane
    for s in (26.0, 40.0, 52.0, 64.0):
        p, zr, r = route_at(s)
        a = p + r["L"] * (r["w"] / 2 + 0.3)
        b = p - r["L"] * (r["w"] / 2 + 0.3)
        a3 = v3(a.x, a.y, zr + 4.6)
        b3 = v3(b.x, b.y, zr + 3.6)
        line = catenary(a3, b3, 0.6, 10)
        tube(geo("rope"), line, 0.015, 3)
        for j in range(1, 10):
            q = line[j]
            nxt = line[j + 1]
            g = geo("cloth_red" if j % 3 else "cloth_cream")
            g.tri(q, nxt, q.lerp(nxt, 0.5) + Vector((0, 0, -0.45)), wind=(0.2, 0.2, 1.0))
            g.tri(nxt, q, q.lerp(nxt, 0.5) + Vector((0, 0, -0.45)), wind=(0.2, 0.2, 1.0))
    # vegetation tufts along the sea-side parapets and cliff ledges
    for k in range(20, len(ROUTE) - 60, 17):
        r = ROUTE[k]
        if r["kind"] in ("bridge", "pier", "quay"):
            continue
        e = r["p"] - r["L"] * (r["w"] / 2 + 0.75)
        plant("fern" if rng.random() < 0.6 else "shrub", (e.x, e.y, r["z"] - 0.1), 0.9 + rng.random() * 0.5)
        e2 = r["p"] + r["L"] * (r["w"] / 2 + 0.28)
        if rng.random() < 0.55:
            plant("grass", (e2.x, e2.y, r["z"] - 0.02), 0.7 + rng.random() * 0.4)
        # ferns tucked into the cliff wall above the path
        if rng.random() < 0.5 and r["kind"] in ("stairs", "landing", "boardwalk"):
            e3 = r["p"] + r["L"] * (r["w"] / 2 + 1.1)
            plant("fern", (e3.x, e3.y, r["z"] + 1.6 + rng.random() * 2.0), 0.8 + rng.random() * 0.4)
    # grass along the quay's land side and the boardwalk
    for k in range(len(ROUTE) - 60, len(ROUTE) - 30, 4):
        r = ROUTE[k]
        e = r["p"] + r["L"] * (r["w"] / 2 + 0.2)
        plant("grass", (e.x, e.y, r["z"]), 0.8)


def build_boats(meta):
    end = ROUTE[-1]
    T, L = end["T"], end["L"]
    moored_skiff = end["p"] - T * 5.0 + L * 3.3
    moored_sail = end["p"] - T * 12.0 - L * 4.6
    h = math.degrees(math.atan2(T.y, T.x))
    meta["boats"] = [
        {"type": "skiff", "p": [moored_skiff.x, moored_skiff.y], "h": h + 4},
        {"type": "sailboat", "p": [moored_sail.x, moored_sail.y], "h": h - 176},
        # drifting in the bay, one out in the glitter path, the pinnace crossing the far water
        {"type": "sailboat", "circle": {"c": [-232.0, 52.0], "r": 26.0, "speed": 0.7}},
        {"type": "skiff", "circle": {"c": [-104.0, 34.0], "r": 17.0, "speed": -0.5}},
        {"type": "ship", "line": {"a": [-395.0, 108.0], "b": [-640.0, 180.0], "speed": 1.4}},
    ]


def build_foreground(meta):
    """Near-camera framing along the path: banner poles, hanging vines, flower pots on the parapets.

    The concepts all frame the view with something close to the lens; the camera rides 4-5 m
    behind her, so these sit right at the path edges where it passes them.
    """
    def pole_banner(s, side, height=4.2, color="cloth_red"):
        p, z, r = route_at(s)
        base = p + r["L"] * (side * (r["w"] / 2 + 0.35))
        cylinder(geo("wood_dark"), v3(base.x, base.y, z - 0.4), 0.075, height + 0.4, seg=6)
        tube(geo("wood_dark"), [v3(base.x, base.y, z + height - 0.1), v3(base.x - r["L"].x * side * 0.9, base.y - r["L"].y * side * 0.9, z + height - 0.1)], 0.03, 4)
        top = v3(base.x - r["L"].x * side * 0.12, base.y - r["L"].y * side * 0.12, z + height - 0.12)
        top2 = v3(base.x - r["L"].x * side * 0.85, base.y - r["L"].y * side * 0.85, z + height - 0.12)
        cloth(geo(color), top, top2, 1.9, cols=3, rows=7)
        meta["banners"].append({"top": [top.x, top.y, top.z]})
        box(COL_WALL, v3(base.x, base.y, z + 1), (0.3, 0.3, 2), fwd=r["T"])

    def vines(s, side, drop=2.6):
        p, z, r = route_at(s)
        e = p + r["L"] * (side * (r["w"] / 2 + 0.18))
        a = e + r["T"] * -0.6
        b = e + r["T"] * 0.6
        cloth(geo("foliage"), v3(a.x, a.y, z + 4.6), v3(b.x, b.y, z + 4.6), drop + rng.random(), cols=3, rows=6)

    def pots(s, side):
        p, z, r = route_at(s)
        e = p + r["L"] * (side * (r["w"] / 2 + 0.2))
        cylinder(geo("roof"), v3(e.x, e.y, z + 0.85), 0.2, 0.3, seg=8, r_top=0.26)
        plant("shrub", (e.x, e.y, z + 1.12), 0.55)

    for s, side in ((9.0, -1), (22.0, -1), (80.5, -1), (107.0, 1), (126.0, -1), (146.0, 1)):
        pole_banner(s, side, color="cloth_red" if side < 0 else "cloth_blue")
    for s in (30, 38, 45, 52, 58):
        vines(s, 1)
    for s in (33, 41, 49, 60, 64):
        pots(s, -1)


def build_waterfall(meta):
    s = (BRIDGE_S0 + BRIDGE_S1) / 2
    p, _, smp = route_at_spine(s)
    zr = ledge_z(s)
    hw = width_at(s) / 2
    H = ztop_at(s) - zr
    back = p + smp["L"] * (hw + 0.25 + 17.0 + 0.45 + 0.3)
    top_z = zr + H * 0.9
    meta["waterfall"] = {
        "top": [back.x, back.y, top_z],
        "bottom": [back.x, back.y, -0.5],
        "width": 5.0,
        "out": [-smp["L"].x, -smp["L"].y],
        "along": [smp["T"].x, smp["T"].y],
    }


# ==========================================================================
# Phase 2 chase: the route is played pier -> terrace ("chase metres", cs = ROUTE_LEN - s).
# One tension rule, three rigs: a line under load becomes her lift.
#   RIDE      quay crane: its counterweight is on a brake; hooked, the weight drops, she rises
#             and the jib slews her up onto the stair landing
#   RELEASE   gorge boom: held back by a tie-back against its counterweight; hooked, the tie
#             lets go and the boom swings her across the raised bridge leaves
#   TRANSFER  the ropeway haul rope never stops; she catches a passing carrier at the lane's end
#             and rides the rising span to the terrace where Rook's cage docks
# The shutdown drops two gates and raises the bridge leaves so each rig is the way through.
# Static structure is baked into level.glb; everything that moves goes to rigs.glb.
# ==========================================================================

HOOK_REACH = 2.15      # hook height above the floor where she grabs it (hands overhead)
HOLES = [(58.6, 60.9), (70.5, 77.5)]   # chase-metre ranges with no floor: the boardwalk gap, the bridge leaves
OBSTACLES = [  # mantle-height obstacles across the walk (chase metres, height, depth along route)
    {"cs": 6.8, "h": 1.0, "d": 1.3, "kind": "crates"},
    {"cs": 108.5, "h": 1.05, "d": 1.5, "kind": "cart"},
    {"cs": 127.0, "h": 0.95, "d": 1.25, "kind": "stall"},
]
RIGS = {}


def chase(cs):
    """(xy, walk z, forward xy, land xy, width) at chase metres."""
    p, z, r = route_at(ROUTE_LEN - cs)
    return p.copy(), z, -r["T"], r["L"], r["w"]


def in_hole(cs):
    return any(a <= cs <= b for a, b in HOLES)


def t3(p):
    return [round(p[0], 3), round(p[2], 3), round(-p[1], 3)]


def perp_center(p0, p1, toward, h):
    """Point h metres off the chord p0-p1 on the side of `toward` (a direction), equidistant from both."""
    mid = (p0 + p1) / 2
    d = (p1 - p0).normalized()
    n = v2(-d.y, d.x)
    if n.dot(toward) < 0:
        n = -n
    return mid + n * h


def timber_tower(g, center, size, z0, z1, brace=2.4, post_r=0.14, fwd=(1, 0)):
    """Four-post timber tower with X bracing on every face."""
    f, l, _ = frame_axes(fwd)
    hs = size / 2
    corners = [center + f.to_2d() * sx * hs + l.to_2d() * sy * hs for sx, sy in ((1, 1), (1, -1), (-1, -1), (-1, 1))]
    for c in corners:
        cylinder(g, v3(c.x, c.y, z0), post_r, z1 - z0, seg=6)
    z = z0 + 0.6
    while z + brace <= z1 + 0.01:
        for i in range(4):
            a, b = corners[i], corners[(i + 1) % 4]
            tube(g, [v3(a.x, a.y, z), v3(b.x, b.y, z + brace)], post_r * 0.55, 4)
            tube(g, [v3(b.x, b.y, z), v3(a.x, a.y, z + brace)], post_r * 0.55, 4)
            tube(g, [v3(a.x, a.y, z + brace), v3(b.x, b.y, z + brace)], post_r * 0.6, 4)
        z += brace
    return corners


def build_gate_frame(cs, name):
    p, z, F, L, w = chase(cs)
    stone = geo("mortar")
    for side in (-1, 1):
        c = p + L * (side * (w / 2 + 0.45))
        box(stone, v3(c.x, c.y, z + 2.1 - 1.0), (0.85, 0.85, 6.2), fwd=F, col=(0.86, 0.86, 0.86, 1), cam=True, wall=True)
        box(geo("step"), v3(c.x, c.y, z + 4.3), (1.0, 1.0, 0.16), fwd=F)
        box(geo("mortar"), v3(c.x, c.y, z + 4.55), (0.7, 0.7, 0.35), fwd=F)
    lint = p
    box(geo("wood_dark"), v3(lint.x, lint.y, z + 3.85), (0.5, w + 1.9, 0.45), fwd=F, col=(0.85, 0.85, 0.85, 1))
    box(geo("iron"), v3(lint.x, lint.y, z + 3.6), (0.22, w + 0.5, 0.08), fwd=F)
    # a little tiled hood over the lintel
    r = geo("roof")
    a0 = p + L * (w / 2 + 1.0) - F * 0.6
    a1 = p - L * (w / 2 + 1.0) - F * 0.6
    b0 = a0 + F * 1.2
    b1 = a1 + F * 1.2
    zt = z + 4.1
    r.quad(v3(a1.x, a1.y, zt), v3(a0.x, a0.y, zt), v3(p.x + L.x * (w / 2 + 1.0), p.y + L.y * (w / 2 + 1.0), zt + 0.5),
           v3(p.x - L.x * (w / 2 + 1.0), p.y - L.y * (w / 2 + 1.0), zt + 0.5))
    r.quad(v3(p.x - L.x * (w / 2 + 1.0), p.y - L.y * (w / 2 + 1.0), zt + 0.5), v3(p.x + L.x * (w / 2 + 1.0), p.y + L.y * (w / 2 + 1.0), zt + 0.5),
           v3(b0.x, b0.y, zt), v3(b1.x, b1.y, zt))
    RIGS[name] = {"cs": cs, "pos": t3(v3(p.x, p.y, z)), "fwd": [round(F.x, 4), 0, round(-F.y, 4)], "width": round(w + 0.3, 3),
                  "height": 3.55, "block": [round(cs - 0.35, 2), round(cs + 0.55, 2)]}


def build_crane():
    cs0, cs1 = 20.5, 43.8
    p0, z0, F0, L0, w0 = chase(cs0)
    p1, z1, F1, L1, w1 = chase(cs1)
    h0 = p0 + L0 * 1.0
    h1 = p1
    M = perp_center(h0, h1, (L0 + L1).normalized(), 5.2)
    R = (h0 - M).length
    zj = z1 + HOOK_REACH + 2.7
    wd = geo("wood_dark")
    timber_tower(wd, M, 1.5, z0 - 1.5, zj - 0.35, brace=2.3, post_r=0.16, fwd=(F0 + F1).to_2d())
    # stone footing on the cliff and a slewing ring on top
    box(geo("mortar"), v3(M.x, M.y, z0 - 0.4), (2.4, 2.4, 2.2), fwd=F0, col=(0.8, 0.8, 0.8, 1))
    cylinder(geo("iron"), v3(M.x, M.y, zj - 0.4), 1.05, 0.22, seg=12)
    box(COL_CAM, v3(M.x, M.y, (z0 + zj) / 2), (1.6, 1.6, zj - z0), fwd=F0)
    yaw = lambda q: math.atan2(q.y - M.y, q.x - M.x)
    RIGS["crane"] = {
        "pivot": t3(v3(M.x, M.y, zj)), "radius": round(R, 3), "counterArm": 3.5,
        "yaw0": round(yaw(h0), 4), "yaw1": round(yaw(h1), 4),   # blender yaw (x-axis toward the hook, about +z)
        "hook0": t3(v3(h0.x, h0.y, z0 + HOOK_REACH)), "hook1": t3(v3(h1.x, h1.y, z1 + HOOK_REACH)),
        "csGrab": cs0, "csLand": cs1, "grabRadius": 2.2,
    }


def build_bridge_gantries():
    lo, hi = HOLES[1]
    RIGS["bridge"] = {"leaves": []}
    for cs, sgn in ((lo, 1), (hi, -1)):
        p, z, F, L, w = chase(cs)
        d = F * sgn   # the leaf extends from its hinge into the gap
        for side in (-1, 1):
            c = p + L * (side * (w / 2 + 0.35))
            cylinder(geo("wood_dark"), v3(c.x, c.y, z - 3.0), 0.16, 9.8, seg=6)
            cylinder(geo("iron"), v3(c.x, c.y, z + 6.55), 0.2, 0.12, seg=8)
        a = p + L * (w / 2 + 0.35)
        b = p - L * (w / 2 + 0.35)
        tube(geo("wood_dark"), [v3(a.x, a.y, z + 6.5), v3(b.x, b.y, z + 6.5)], 0.13, 5)
        RIGS["bridge"]["leaves"].append({
            "hinge": t3(v3(p.x, p.y, z)), "dir": [round(d.x, 4), 0, round(-d.y, 4)], "length": round((hi - lo) / 2 - 0.05, 3),
            "width": round(w + 0.1, 3), "raised": 1.18, "gantryTop": t3(v3(p.x, p.y, z + 6.5)), "gantryHalf": round(w / 2 + 0.35, 3),
        })
    RIGS["bridge"]["hole"] = [lo, hi]
    RIGS["bridge"]["trigger"] = 49.0


def build_boom():
    cs0, cs1 = 69.0, 79.4
    p0, z0, F0, L0, w0 = chase(cs0)
    p1, z1, F1, L1, w1 = chase(cs1)
    h0 = p0 + L0 * 0.3
    h1 = p1
    M = perp_center(h0, h1, (L0 + L1).normalized(), 2.6)
    R = (h0 - M).length
    zb = max(z0, z1) + HOOK_REACH + 3.3
    wd = geo("wood_dark")
    cylinder(wd, v3(M.x, M.y, -2.5), 0.3, zb + 2.5 + 0.5, seg=8, cam=True)
    for k in range(4):
        a = k * math.pi / 2 + 0.4
        foot = M + v2(math.cos(a), math.sin(a)) * 2.4
        tube(wd, [v3(foot.x, foot.y, -1.5), v3(M.x, M.y, zb - 5.0)], 0.12, 5)
    blob(geo("rock"), v3(M.x, M.y, -1.8), 3.2, 0.5, seed=7)
    cylinder(geo("iron"), v3(M.x, M.y, zb - 0.35), 0.42, 0.2, seg=10)
    # the cleat the tie-back is made fast to, at the near end on the sea side
    cp, cz, cF, cL, cw = chase(67.6)
    cleat = cp - cL * (cw / 2 + 0.2)
    cylinder(geo("wood_dark"), v3(cleat.x, cleat.y, cz - 0.3), 0.12, 1.5, seg=6)
    yaw = lambda q: math.atan2(q.y - M.y, q.x - M.x)
    RIGS["boom"] = {
        "pivot": t3(v3(M.x, M.y, zb)), "radius": round(R, 3),
        "yaw0": round(yaw(h0), 4), "yaw1": round(yaw(h1), 4),
        "hook0": t3(v3(h0.x, h0.y, z0 + HOOK_REACH)), "hook1": t3(v3(h1.x, h1.y, z1 + HOOK_REACH)),
        "cleat": t3(v3(cleat.x, cleat.y, cz + 1.1)), "csGrab": cs0, "csLand": cs1, "grabRadius": 2.2,
    }


def cable_points(a, b, sag, n):
    pts = []
    for i in range(n + 1):
        t = i / n
        q = a.lerp(b, t)
        q.z -= sag * 4 * t * (1 - t)
        pts.append(q)
    return pts


def build_ropeway():
    """Stations A (quay) and D (terrace), towers B (a sea rock in the cove) and C (lane end)."""
    pa, za, Fa, La, wa = chase(17.0)
    A = pa - La * (wa / 2 + 2.6)
    pb, zb_, Fb, Lb, wb = chase(74.0)
    B = pb - Lb * 19.0
    pc, zc, Fc, Lc, wc = chase(140.8)
    C = pc - Lc * (wc / 2 + 1.55)
    # the terrace station stands beyond the cage dock, clear of the reveal's sightlines
    pd, zd, Fd, Ld, wd_ = chase(173.2)
    D = pd - Ld * 3.3
    hanger = 1.6    # carrier grip to hook
    lp, lz, lF, lL, lw = chase(167.4)
    heads = [v3(A.x, A.y, za + 3.45), None, v3(C.x, C.y, zc + HOOK_REACH + hanger), v3(D.x, D.y, zd + HOOK_REACH + hanger)]
    # B on the straight line's height, a little high so the long span sags into it
    ab = (B - A).length
    bc = (C - B).length
    heads[1] = v3(B.x, B.y, heads[0].z + (heads[2].z - heads[0].z) * ab / (ab + bc) + 1.2)
    sags = []
    for i in range(3):
        sags.append(round(min(1.6, (heads[i + 1] - heads[i]).length * 0.012), 3))
    # rope pair: haul (uphill, landward) and return (seaward)
    offs = []
    for i, h in enumerate(heads):
        land = (La, Lb, Lc, Ld)[i]
        offs.append(land.normalized())
    rope = geo("iron")
    for sgn in (1, -1):
        for i in range(3):
            a = heads[i] + Vector((offs[i].x, offs[i].y, 0)) * (0.8 * sgn)
            b = heads[i + 1] + Vector((offs[i + 1].x, offs[i + 1].y, 0)) * (0.8 * sgn)
            n = max(8, int((b - a).length / 3.0))
            tube(rope, cable_points(a, b, sags[i], n), 0.028, 4)
    wd = geo("wood_dark")
    # towers: A and D are stations with a roofed bullwheel house; B and C are trestles
    for i, (h, kind) in enumerate(zip(heads, ("station", "trestle", "trestle", "station"))):
        land = offs[i]
        fwd = (land.y, -land.x)
        base = -3.0 if i == 1 else (za - 1.5 if i == 0 else (zc - 6.0 if i == 2 else zd - 2.0))
        top = h.z + 0.35
        timber_tower(wd, h.to_2d(), 2.0 if kind == "station" else 1.4, base, top, brace=2.5, post_r=0.17 if i == 1 else 0.14, fwd=fwd)
        box(COL_CAM, v3(h.x, h.y, (base + top) / 2), (2.1, 2.1, top - base), fwd=fwd)
        # head: cross arm carrying both sheaves
        box(wd, v3(h.x, h.y, top + 0.1), (0.3, 2.4, 0.3), fwd=fwd)
        for sgn in (1, -1):
            s = h + Vector((land.x, land.y, 0)) * (0.8 * sgn)
            cylinder(geo("iron"), v3(s.x, s.y, top - 0.05), 0.32, 0.12, seg=10)
        if kind == "station":
            # bullwheel house: a tiled hood over the wheel
            box(geo("wood"), v3(h.x, h.y, top + 0.35), (2.8, 2.8, 0.14), fwd=fwd)
            r = geo("roof")
            c0 = h.to_2d()
            f2 = v2(*fwd)
            l2 = land.to_2d()
            corners = [c0 + f2 * sx * 1.7 + l2 * sy * 1.7 for sx, sy in ((1, 1), (1, -1), (-1, -1), (-1, 1))]
            apex = v3(c0.x, c0.y, top + 2.0)
            for k in range(4):
                a, b = corners[k], corners[(k + 1) % 4]
                r.tri(v3(b.x, b.y, top + 0.9), v3(a.x, a.y, top + 0.9), apex)
            cylinder(geo("iron"), v3(h.x, h.y, top + 0.45), 1.15, 0.18, seg=16)
        if i == 1:
            blob(geo("rock"), v3(h.x, h.y, -2.5), 4.5, 0.55, seed=11)
            blob(geo("rock"), v3(h.x + 2.5, h.y - 1.5, -2.0), 2.6, 0.6, seed=12)
    # station A deck on piles beside the quay apron, station D's dock under the cage
    for (st, z, F, L, extent) in ((A, za, Fa, La, 3.2), (D, zd, Fd, Ld, 0.0)):
        if extent:
            box(geo("wood"), v3(st.x, st.y, z - 0.08), (4.2, 5.0, 0.16), fwd=F)
            for sx in (-1.9, 1.9):
                for sy in (-2.2, 0, 2.2):
                    q = st + F * sx + L * sy
                    cylinder(geo("wood_dark"), v3(q.x, q.y, -3.0), 0.14, z + 3.0, seg=6)
    RIGS["ropeway"] = {
        "heads": [t3(h) for h in heads],
        "land": [[round(o.x, 4), 0, round(-o.y, 4)] for o in offs],
        "offset": 0.8, "sags": sags, "hanger": hanger, "speed": 4.2, "spacing": 11.0,
        "csGrab": 140.8, "grabRadius": 1.9, "csLand": 167.4,
        "land_point": t3(v3(lp.x - lL.x * 1.2, lp.y - lL.y * 1.2, lz)),
    }
    # the cage dock at the terrace end: the cage sits here once it arrives; her door faces back down the route
    qp, qz, qF, qL, qw = chase(172.15)
    dock = qp - qL * 1.55
    RIGS["cage"] = {
        "dock": t3(v3(dock.x, dock.y, qz)), "doorDir": [round(-qF.x, 4), 0, round(qF.y, 4)],
        "start": t3(v3(A.x - La.x * 0.0, A.y - La.y * 0.0, za)), "size": [2.6, 2.5, 2.2],
    }
    # the docked cage is solid; she stands at its open door
    box(COL_WALL, v3(dock.x, dock.y, qz + 1.2), (2.2, 2.6, 2.4), fwd=qF)
    box(COL_CAM, v3(dock.x, dock.y, qz + 1.3), (2.0, 2.4, 2.6), fwd=qF)
    # the spur rail from the station to the dock, carried overhead from the station tower
    tube(geo("iron"), [v3(D.x, D.y, heads[3].z), v3(dock.x, dock.y, qz + 4.25)], 0.05, 4)


def build_obstacles():
    """Mantle obstacles: a floor top in COL_walk at mantle height, no wall, so she climbs, not bumps."""
    for ob in OBSTACLES:
        p, z, F, L, w = chase(ob["cs"])
        h, d = ob["h"], ob["d"]
        span = w + 0.4
        a = p - F * (d / 2)
        b = p + F * (d / 2)
        # collision top
        c0, c1 = a + L * (span / 2), a - L * (span / 2)
        c2, c3 = b - L * (span / 2), b + L * (span / 2)
        COL_WALK.quad(v3(c1.x, c1.y, z + h), v3(c2.x, c2.y, z + h), v3(c3.x, c3.y, z + h), v3(c0.x, c0.y, z + h))
        if ob["kind"] == "crates":
            # a toppled cargo stack across the pier: three crates and a net over them
            for k, (u, dd, hh, rot) in enumerate(((-0.95, 0.0, h, 0.08), (0.05, 0.1, h, -0.05), (1.05, -0.05, h * 0.92, 0.12))):
                c = p + L * u + F * dd
                crate(v3(c.x, c.y, z + hh / 2), (d, 1.0, hh), (F.x * math.cos(rot) - F.y * math.sin(rot), F.x * math.sin(rot) + F.y * math.cos(rot)))
            cloth(geo("rope"), v3(a.x + L.x * 1.5, a.y + L.y * 1.5, z + h + 0.05), v3(a.x - L.x * 1.5, a.y - L.y * 1.5, z + h + 0.05), 0.6,
                  cols=6, rows=2, slope_out=(F.x * 0.9, F.y * 0.9, 0))
        elif ob["kind"] == "cart":
            # an overturned handcart: bed on its side, one wheel up
            box(geo("wood"), v3(p.x, p.y, z + h / 2), (d, span - 0.2, h), fwd=F, col=(0.85, 0.85, 0.85, 1))
            for k in range(5):
                q = p + L * ((k - 2) * (span - 0.4) / 4)
                box(geo("wood_dark"), v3(q.x, q.y, z + h / 2), (d + 0.06, 0.08, h + 0.04), fwd=F)
            wc = p + L * (span / 2 - 0.3) - F * 0.1
            cyl_axis(geo("wood_dark"), v3(wc.x, wc.y, z + h + 0.12), F, 0.5, 0.1, seg=12)
            for k in range(4):
                blob(geo("produce"), v3(p.x + F.x * (1.0 + 0.3 * k) + L.x * (0.6 - 0.4 * k), p.y + F.y * (1.0 + 0.3 * k) + L.y * (0.6 - 0.4 * k), z + 0.12),
                     0.13, 0.9, col=rng.choice(PRODUCE) + (1,), seed=k)
        else:
            # a market barricade: stall boards, baskets and crates
            box(geo("wood"), v3(p.x, p.y, z + h / 2), (d, span - 0.2, h), fwd=F, col=(0.8, 0.8, 0.8, 1))
            for k in range(3):
                q = p + L * ((k - 1) * 1.5)
                crate(v3(q.x, q.y, z + h + 0.01 + 0.2), (0.6, 0.8, 0.4), F.to_2d(), produce=True)
    RIGS["obstacles"] = [{"cs": ob["cs"], "h": ob["h"], "d": ob["d"]} for ob in OBSTACLES]
    RIGS["holes"] = [list(hh) for hh in HOLES]


def crate(center, size, fwd, produce=False):
    """Slatted crate (wood) with dark corner posts; optionally heaped with produce."""
    box(geo("wood"), center, size, fwd=fwd, col=(0.9, 0.9, 0.9, 1))
    f, l, _ = frame_axes(fwd)
    c = Vector(center)
    for sx in (-1, 1):
        for sy in (-1, 1):
            q = c + f * (sx * (size[0] / 2 - 0.03)) + l * (sy * (size[1] / 2 - 0.03))
            box(geo("wood_dark"), q, (0.07, 0.07, size[2] + 0.02), fwd=fwd)
    for k in (-1, 1):
        q = c + Vector((0, 0, k * size[2] * 0.22))
        box(geo("wood_dark"), q, (size[0] + 0.02, size[1] + 0.02, 0.05), fwd=fwd, top=False)
    if produce:
        col = rng.choice(PRODUCE)
        for k in range(7):
            q = c + f * ((rng.random() - 0.5) * size[0] * 0.7) + l * ((rng.random() - 0.5) * size[1] * 0.7) + Vector((0, 0, size[2] / 2 + 0.05))
            blob(geo("produce"), q, 0.09, 0.85, col=tuple(x * (0.85 + 0.3 * rng.random()) for x in col) + (1,), seed=k)


def cyl_axis(g, center, axis, radius, length, seg=10):
    """Cylinder whose axis lies along the horizontal direction `axis` (a wheel, a drum)."""
    ax = Vector((axis[0], axis[1], 0)).normalized()
    up = Vector((0, 0, 1))
    side = ax.cross(up).normalized()
    c = Vector(center)
    ring0, ring1 = [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        d = side * math.cos(a) + up * math.sin(a)
        ring0.append(c - ax * (length / 2) + d * radius)
        ring1.append(c + ax * (length / 2) + d * radius)
    for i in range(seg):
        j = (i + 1) % seg
        g.quad(ring0[i], ring0[j], ring1[j], ring1[i])
    for ring, cc in ((ring0, c - ax * (length / 2)), (ring1, c + ax * (length / 2))):
        ci = g.vert(cc)
        for i in range(seg):
            g.face([g.vert(ring[i]), g.vert(ring[(i + 1) % seg]), ci])


def build_chase_set(meta):
    build_gate_frame(24.1, "gate1")
    build_gate_frame(146.8, "gate3")
    build_crane()
    build_bridge_gantries()
    build_boom()
    build_ropeway()
    build_obstacles()
    build_market(meta)


def build_market(meta):
    """Stalls, goods and laundry where the camera lives: the quay and the upper market lane."""
    # quay: fish and rope stalls on the land side, nets and barrels at the sea edge
    for cs, side in ((18.2, 1), (21.4, 1), (17.6, -1)):
        p, z, F, L, w = chase(cs)
        c = p + L * (side * (w / 2 - 1.1))
        market_stall2(c, z, F, L * side)
    # lane: stalls under striped canopies against the buildings, laundry across
    for cs in (121.5, 132.5, 138.0):
        p, z, F, L, w = chase(cs)
        c = p + L * (w / 2 - 0.75)
        market_stall2(c, z, F, L)
    for cs in (116.0, 124.5, 135.0, 143.0):
        p, z, F, L, w = chase(cs)
        a = p + L * (w / 2 + 0.3)
        b = p - L * (w / 2 + 0.6)
        la = v3(a.x, a.y, z + 5.2)
        lb = v3(b.x, b.y, z + 4.4)
        line = catenary(la, lb, 0.45, 10)
        tube(geo("rope"), line, 0.012, 3)
        cylinder(geo("wood_dark"), v3(b.x, b.y, z - 0.4), 0.06, 5.0, seg=5)
        for j in range(1, 9, 2):
            cloth(geo(rng.choice(["cloth_cream", "cloth_cream", "cloth_blue", "cloth_red"])), line[j], line[j + 1],
                  0.5 + rng.random() * 0.5, cols=1, rows=3)
    # pottery and baskets at doors along the lane and the landing
    for cs in (118.0, 126.0, 130.0, 141.5, 44.5, 92.0):
        p, z, F, L, w = chase(cs)
        c = p + L * (w / 2 - 0.35)
        for k in range(rng.randint(2, 4)):
            q = c + F * (k * 0.45 - 0.5)
            kind = rng.random()
            if kind < 0.45:
                lathe(geo("roof"), v3(q.x, q.y, z), [(0.12, 0), (0.24, 0.18), (0.26, 0.38), (0.15, 0.62), (0.1, 0.7), (0.13, 0.76)], seg=10)
            elif kind < 0.75:
                lathe(geo("wood"), v3(q.x, q.y, z), [(0.18, 0), (0.24, 0.3), (0.26, 0.34)], seg=10)
                for j in range(3):
                    blob(geo("produce"), v3(q.x + (j - 1) * 0.08, q.y, z + 0.34), 0.08, 0.9, col=rng.choice(PRODUCE) + (1,), seed=j)
            else:
                lathe(geo("wood_dark"), v3(q.x, q.y, z), [(0.26, 0), (0.3, 0.45), (0.26, 0.9)], seg=10)
                for zz in (0.12, 0.78):
                    cylinder(geo("iron"), v3(q.x, q.y, z + zz), 0.285 if zz < 0.5 else 0.27, 0.04, seg=10, top=False)


def market_stall2(c, z, F, toward_wall):
    """Trestle table heaped with crates of produce under a striped canopy on four posts."""
    W = toward_wall.normalized()
    box(geo("wood"), v3(c.x, c.y, z + 0.82), (2.0, 0.85, 0.07), fwd=F, col=(0.9, 0.9, 0.9, 1))
    for sx in (-0.9, 0.9):
        for sy in (-0.35, 0.35):
            q = c + F * sx + W * sy
            box(geo("wood_dark"), v3(q.x, q.y, z + 0.4), (0.07, 0.07, 0.8), fwd=F)
    box(COL_WALL, v3(c.x, c.y, z + 0.6), (2.0, 0.85, 1.2), fwd=F)
    for k in range(3):
        q = c + F * ((k - 1) * 0.62)
        crate(v3(q.x, q.y, z + 0.99), (0.55, 0.72, 0.28), F.to_2d(), produce=True)
    posts = []
    for sx in (-1.05, 1.05):
        for sy, hgt in ((-0.55, 2.2), (0.6, 2.55)):
            q = c + F * sx + W * sy
            cylinder(geo("wood_dark"), v3(q.x, q.y, z), 0.045, hgt, seg=5)
            posts.append(v3(q.x, q.y, z + hgt))
    a = c - F * 1.15 + W * 0.65
    b = c + F * 1.15 + W * 0.65
    striped_awning(v3(a.x, a.y, z + 2.55), v3(b.x, b.y, z + 2.55), -W * 0.9, PAINTS[0])



# --------------------------------------------------------------------------
# moving parts -> rigs.glb (each part in its own local frame; the runtime places and animates them)
# local frames: Blender +X forward (the jib, the leaf, the boom, the cage door side), +Z up.
# --------------------------------------------------------------------------

class Part:
    def __init__(self, name):
        self.name = name
        self.geos = {}

    def g(self, material):
        if material not in self.geos:
            self.geos[material] = Geo(f"{self.name}__{material}", material, smooth=material in ("brass",))
        return self.geos[material]


def emit(part):
    root = bpy.data.objects.new(f"RIG_{part.name}", None)
    bpy.context.scene.collection.objects.link(root)
    for g in part.geos.values():
        ob = to_object(g)
        if ob:
            ob.parent = root
    return root


def rod(g, a, b, r, seg=6):
    tube(g, [Vector(a), Vector(b)], r, seg)


def part_crane_jib(R):
    p = Part("crane_jib")
    wd, iron = p.g("wood_dark"), p.g("iron")
    cylinder(iron, (0, 0, -0.05), 1.0, 0.22, seg=14)
    box(p.g("wood"), (-0.9, 0, 1.0), (1.8, 1.5, 1.6), fwd=(1, 0), col=(0.85, 0.85, 0.85, 1))
    box(p.g("window"), (0.02, 0, 1.25), (0.02, 0.9, 0.55), fwd=(1, 0))
    r = p.g("roof")
    r.quad(v3(0.25, -0.9, 1.8), v3(0.25, 0.9, 1.8), v3(-1.0, 0.9, 2.35), v3(-1.0, -0.9, 2.35))
    r.quad(v3(-1.0, -0.9, 2.35), v3(-1.0, 0.9, 2.35), v3(-2.05, 0.9, 1.8), v3(-2.05, -0.9, 1.8))
    # jib: a timber truss out to the tip sheave
    for y in (-0.32, 0.32):
        rod(wd, (0.2, y, 1.55), (R, y * 0.35, 0.45), 0.09)
        rod(wd, (0.2, y, 0.3), (R, y * 0.35, 0.15), 0.08)
    n = max(4, int(R / 1.1))
    for k in range(n + 1):
        t_ = k / n
        x = 0.2 + (R - 0.2) * t_
        ztop = 1.55 + (0.45 - 1.55) * t_
        zb = 0.3 + (0.15 - 0.3) * t_
        ys = 0.32 * (1 - 0.65 * t_)
        for y in (-ys, ys):
            rod(wd, (x, y, zb), (x, y, ztop), 0.045, 4)
            if k < n:
                x2 = 0.2 + (R - 0.2) * (k + 1) / n
                zt2 = 1.55 + (0.45 - 1.55) * (k + 1) / n
                rod(wd, (x, y, zb), (x2, y * (1 - 0.65 / n), zt2), 0.04, 4)
    cyl_axis(iron, (R, 0, 0.2), (0, 1), 0.28, 0.16, seg=12)
    # counter-jib, king post and stays
    for y in (-0.3, 0.3):
        rod(wd, (0, y, 0.9), (-3.7, y, 0.75), 0.09)
    rod(wd, (0, 0, 0.0), (0, 0, 3.6), 0.12)
    rod(p.g("rope"), (0, 0, 3.55), (R, 0, 0.5), 0.025, 4)
    rod(p.g("rope"), (0, 0, 3.55), (-3.6, 0, 0.8), 0.025, 4)
    cyl_axis(iron, (-3.5, 0, 0.7), (0, 1), 0.24, 0.14, seg=10)
    return p, {"tip": [R, 0.15, 0.0], "counterTip": [-3.5, 0.62, 0.0]}


def part_counterweight():
    p = Part("counterweight")
    box(p.g("mortar"), (0, 0, -0.95), (1.1, 1.1, 1.3), fwd=(1, 0), col=(0.8, 0.8, 0.8, 1))
    for z in (-0.5, -1.4):
        box(p.g("iron"), (0, 0, z), (1.16, 1.16, 0.08), fwd=(1, 0), top=False)
    for a in (-0.5, 0.5):
        rod(p.g("iron"), (a, 0, -0.3), (0, 0, 0), 0.03, 4)
    cylinder(p.g("iron"), (0, 0, -0.02), 0.08, 0.05, seg=8)
    return p


def part_hook(name="hook"):
    p = Part(name)
    iron = p.g("iron")
    box(iron, (0, 0, -0.16), (0.16, 0.24, 0.3), fwd=(1, 0))
    cyl_axis(iron, (0, 0, -0.1), (1, 0), 0.08, 0.18, seg=8)
    pts = [Vector((0, 0, -0.3))]
    for k in range(9):
        a = math.pi * 0.2 + math.pi * 1.3 * k / 8
        pts.append(Vector((0.0, -0.1 + math.cos(a) * 0.1 * 0 + 0.12 * math.sin(a) * 0, 0)))
    # a J: straight shank then a round belly curling up
    j = [Vector((0, 0, -0.3)), Vector((0, 0, -0.5))]
    for k in range(7):
        a = math.pi + math.pi * k / 6
        j.append(Vector((0, 0.1 + math.cos(a) * 0.1, -0.5 + math.sin(a) * 0.12)))
    tube(iron, j, 0.028, 6)
    # a turned toggle on a rope loop under the hook: what hands actually close on (along local X)
    tog_z = -0.9
    cyl_axis(p.g("wood_dark"), (0, 0, tog_z), (1, 0), 0.024, 0.36, seg=8)
    for sx in (-0.11, 0.11):
        cyl_axis(p.g("iron"), (sx, 0, tog_z), (1, 0), 0.03, 0.02, seg=8)
        tube(p.g("rope"), [Vector((sx, 0, tog_z + 0.02)), Vector((0, 0.1, -0.64))], 0.012, 4)
    return p


def part_carrier(hanger):
    p = Part("carrier")
    iron = p.g("iron")
    box(iron, (0, 0, -0.08), (0.5, 0.16, 0.16), fwd=(1, 0))
    for x in (-0.18, 0.18):
        cyl_axis(iron, (x, 0, 0.05), (0, 1), 0.09, 0.08, seg=10)
    # the toggle under the hook (where her hands close) sits `hanger` below the grip; the hook part
    # is turned a quarter so the toggle runs across the direction of travel
    drop = hanger - 0.9
    tube(iron, [Vector((0, 0, -0.12)), Vector((0.12, 0, -0.45)), Vector((0.1, 0, -0.8)), Vector((0, 0, -drop))], 0.03, 5)
    h = part_hook()
    for mat, g in h.geos.items():
        for i, face in enumerate(g.faces):
            pts = [Vector((-g.verts[k][1], g.verts[k][0], g.verts[k][2])) + Vector((0, 0, -drop)) for k in face]
            if len(pts) == 4:
                p.g(mat).quad(*pts)
            else:
                p.g(mat).tri(*pts)
    return p


def part_gate(name, width, height):
    """Portcullis: an iron grid with spiked feet; origin bottom centre, grid in the local Y-Z plane."""
    p = Part(name)
    iron = p.g("iron")
    n = int(width / 0.22)
    for k in range(n + 1):
        y = -width / 2 + width * k / n
        box(iron, (0, y, height / 2), (0.07, 0.06, height), fwd=(1, 0))
        iron.tri(v3(0, y - 0.04, 0.02), v3(0, y + 0.04, 0.02), v3(0, y, -0.18))
        iron.tri(v3(0, y + 0.04, 0.02), v3(0, y - 0.04, 0.02), v3(0, y, -0.18))
    z = 0.35
    while z < height:
        box(iron, (0, 0, z), (0.09, width, 0.07), fwd=(1, 0))
        z += 0.55
    box(p.g("wood_dark"), (0, 0, height + 0.08), (0.18, width + 0.1, 0.2), fwd=(1, 0))
    return p


def part_leaf(name, length, width):
    p = Part(name)
    wood, wd, iron = p.g("wood"), p.g("wood_dark"), p.g("iron")
    n = int(length / 0.36)
    for k in range(n):
        x = (k + 0.5) * length / n
        box(wood if k % 5 else wd, (x, 0, -0.05), (length / n - 0.03, width, 0.1), fwd=(1, 0),
            col=(0.9 + 0.1 * ((k * 37) % 7) / 6,) * 3 + (1,))
    for y in (-width / 2 + 0.2, width / 2 - 0.2):
        box(wd, (length / 2, y, -0.22), (length, 0.18, 0.22), fwd=(1, 0))
    box(iron, (length - 0.06, 0, -0.04), (0.12, width + 0.04, 0.12), fwd=(1, 0))
    for y in (-width / 2, width / 2):
        cylinder(iron, (length - 0.1, y, 0.0), 0.06, 0.1, seg=6)
    return p, {"tipLocal": [length - 0.1, 0.05, width / 2]}


def part_boom(R):
    p = Part("boom")
    wd, iron = p.g("wood_dark"), p.g("iron")
    cylinder(iron, (0, 0, -0.1), 0.5, 0.25, seg=12)
    tube(wd, [Vector((-1.9, 0, 0.25)), Vector((R + 0.3, 0, 0.18))], 0.17, 7)
    rod(wd, (0, 0, 0.1), (0, 0, 1.9), 0.1)
    rod(p.g("rope"), (0, 0, 1.85), (R, 0, 0.3), 0.022, 4)
    rod(p.g("rope"), (0, 0, 1.85), (-1.7, 0, 0.35), 0.022, 4)
    cyl_axis(iron, (R, 0, 0.05), (0, 1), 0.2, 0.14, seg=10)
    # the heavy side: a stone-filled basket on the tail
    box(p.g("mortar"), (-1.7, 0, -0.55), (0.8, 0.8, 0.8), fwd=(1, 0), col=(0.75, 0.75, 0.75, 1))
    for a in ((-2.05, -0.35), (-2.05, 0.35), (-1.35, -0.35), (-1.35, 0.35)):
        rod(p.g("rope"), (a[0], a[1], -0.15), (-1.7, 0, 0.25), 0.015, 3)
    return p, {"tip": [R, -0.05, 0.0]}


def part_cage():
    """Rook's hanging workshop: brass cage on a ropeway grip. Origin at the floor centre; the door is
    on the +X face; the grip sits 3.45 m up (the station cable height above the floor)."""
    p = Part("cage")
    brass, wood, wd, iron = p.g("brass"), p.g("wood"), p.g("wood_dark"), p.g("iron")
    X, Y, H = 1.1, 1.3, 2.45
    box(wood, (0, 0, 0.06), (2 * X, 2 * Y, 0.12), fwd=(1, 0), col=(0.95, 0.95, 0.95, 1))
    for k in range(7):
        box(wd, (0, -Y + (2 * Y) * (k + 0.5) / 7, 0.125), (2 * X - 0.05, 0.02, 0.01), fwd=(1, 0))
    for x in (-X, X):
        for y in (-Y, Y):
            cylinder(brass, (x, y, 0), 0.05, H + 0.1, seg=8)
    for z in (0.14, 1.12, H):
        for (a, b) in (((-X, -Y), (X, -Y)), ((-X, Y), (X, Y)), ((-X, -Y), (-X, Y)), ((X, -Y), (X, -0.52)), ((X, 0.52), (X, Y))):
            rod(brass, (a[0], a[1], z), (b[0], b[1], z), 0.03 if z != 1.12 else 0.022, 6)
    rod(brass, (X, -0.52, H), (X, 0.52, H), 0.03, 6)

    def bars(a, b, step=0.19):
        a, b = Vector(a), Vector(b)
        n = max(1, int((b - a).length / step))
        for k in range(1, n):
            q = a.lerp(b, k / n)
            rod(brass, (q.x, q.y, 0.14), (q.x, q.y, H), 0.016, 5)
    bars((-X, -Y), (X, -Y))
    bars((-X, Y), (X, Y))
    bars((-X, -Y), (-X, Y))
    bars((X, -Y), (X, -0.52))
    bars((X, 0.52), (X, Y))
    # onion dome with ribs and a finial
    prof = [(1.55, 0.0), (1.62, 0.1), (1.45, 0.34), (1.1, 0.58), (0.62, 0.8), (0.25, 0.95), (0.08, 1.05)]
    lathe(brass, (0, 0, H), prof, seg=16)
    for k in range(8):
        a = k * math.pi / 4
        pts = [Vector((math.cos(a) * r_, math.sin(a) * r_, H + z_ + 0.02)) for r_, z_ in prof]
        tube(brass, pts, 0.025, 4)
    lathe(brass, (0, 0, H + 1.05), [(0.09, 0), (0.12, 0.1), (0.04, 0.3), (0.0, 0.34)], seg=8)
    # hanger arm and grip at the cable
    tube(iron, [Vector((0, 0, H + 1.2)), Vector((0.25, 0, H + 1.5)), Vector((0.1, 0, 3.3))], 0.045, 6)
    box(iron, (0, 0, 3.38), (0.6, 0.18, 0.18), fwd=(1, 0))
    for x in (-0.22, 0.22):
        cyl_axis(iron, (x, 0, 3.5), (0, 1), 0.11, 0.1, seg=10)
    # the workshop: bench, shelves of jars, a pigeonhole rack of dispatches, charts, a hanging lamp
    box(wood, (-0.78, 0, 0.82), (0.5, 2.1, 0.07), fwd=(1, 0))
    for y in (-0.95, 0.95):
        box(wd, (-0.78, y, 0.41), (0.45, 0.06, 0.8), fwd=(1, 0))
    for zz in (1.45, 1.95):
        box(wood, (-0.95, 0, zz), (0.26, 2.1, 0.04), fwd=(1, 0))
        for k in range(9):
            y = -0.95 + 1.9 * k / 8
            lathe(p.g("produce"), (-0.95, y, zz + 0.02), [(0.045, 0), (0.05, 0.1), (0.02, 0.14), (0.025, 0.18)], seg=6,
                  col=rng.choice([(0.1, 0.35, 0.3, 1), (0.5, 0.25, 0.05, 1), (0.25, 0.08, 0.2, 1), (0.6, 0.55, 0.3, 1)]))
    # pigeonholes of letters on the side wall
    box(wd, (-0.2, -1.12, 1.35), (0.9, 0.22, 0.9), fwd=(1, 0))
    for i in range(4):
        for j in range(3):
            box(p.g("cloth_cream"), (-0.55 + i * 0.23, -1.0, 1.02 + j * 0.3), (0.18, 0.04, 0.1), fwd=(1, 0))
    # rolled charts on the bench, a spread chart pinned to the back bars
    for k in range(3):
        cyl_axis(p.g("cloth_cream"), (-0.72, -0.6 + k * 0.18, 0.9), (0, 1), 0.04, 0.5, seg=8)
    p.g("cloth_cream").quad(v3(-1.06, 0.2, 1.05), v3(-1.06, 1.15, 1.05), v3(-1.06, 1.15, 1.75), v3(-1.06, 0.2, 1.75))
    p.g("produce").quad(v3(-1.05, 0.35, 1.2), v3(-1.05, 0.9, 1.3), v3(-1.05, 0.95, 1.36), v3(-1.05, 0.4, 1.26),
                        col=(0.5, 0.12, 0.06, 1))
    # hanging lamp
    tube(iron, [Vector((0, 0.2, H)), Vector((0, 0.2, H - 0.55))], 0.012, 4)
    box(p.g("glow"), (0, 0.2, H - 0.7), (0.16, 0.16, 0.22), fwd=(1, 0))
    box(brass, (0, 0.2, H - 0.57), (0.22, 0.22, 0.04), fwd=(1, 0))
    # signal lamp on the roof edge
    cylinder(brass, (0.9, 1.1, H + 0.02), 0.09, 0.2, seg=8)
    box(p.g("glow"), (0.97, 1.1, H + 0.12), (0.03, 0.12, 0.12), fwd=(1, 0))
    return p, {"lamp": [0, H - 0.7, -0.2], "rook": [0.62, 0.13, 0.25], "doorHinge": [X, 0.0, -0.52]}


def part_cage_door():
    """Door leaf hinged on its local origin, closing along -Y (1.04 m)."""
    p = Part("cage_door")
    brass = p.g("brass")
    Wd, H = 1.04, 2.4
    for z in (0.16, 1.12, H - 0.02):
        rod(brass, (0, 0, z), (0, -Wd, z), 0.022, 6)
    rod(brass, (0, 0, 0.14), (0, 0, H), 0.03, 6)
    rod(brass, (0, -Wd, 0.14), (0, -Wd, H), 0.03, 6)
    for k in range(1, 5):
        y = -Wd * k / 5
        rod(brass, (0, y, 0.14), (0, y, H), 0.016, 5)
    cyl_axis(brass, (0.02, -Wd + 0.1, 1.12), (1, 0), 0.05, 0.06, seg=8)
    return p


def part_satchel():
    """The sealed dispatch satchel. Origin at the top of its strap loop (where a hook or a wing holds it)."""
    p = Part("satchel")
    lea = p.g("leather")
    box(lea, (0, 0, -0.42), (0.13, 0.36, 0.28), fwd=(1, 0), col=(0.9, 0.9, 0.9, 1))
    lea.quad(v3(0.07, -0.18, -0.29), v3(0.07, 0.18, -0.29), v3(0.075, 0.18, -0.45), v3(0.075, -0.18, -0.45), col=(0.7, 0.7, 0.7, 1))
    box(p.g("brass"), (0.08, 0, -0.43), (0.02, 0.07, 0.06), fwd=(1, 0))
    cyl_axis(p.g("cloth_red"), (0.085, 0.0, -0.36), (1, 0), 0.04, 0.02, seg=10)
    loop = [Vector((0, -0.16, -0.3)), Vector((0, -0.1, -0.08)), Vector((0, 0, 0)), Vector((0, 0.1, -0.08)), Vector((0, 0.16, -0.3))]
    tube(lea, loop, 0.012, 4)
    return p


def part_dispatch_hook():
    """Station bracket with a brass hook; origin at the hook's seat. Bracket runs back along -X."""
    p = Part("dispatch_hook")
    iron, brass = p.g("iron"), p.g("brass")
    tube(iron, [Vector((-0.9, 0, 0.12)), Vector((0, 0, 0.12))], 0.025, 5)
    tube(iron, [Vector((-0.9, 0, -0.35)), Vector((-0.35, 0, 0.12))], 0.018, 4)
    j = [Vector((0, 0, 0.12)), Vector((0, 0, 0.03))]
    for k in range(6):
        a = math.pi + math.pi * k / 5
        j.append(Vector((0.05 + math.cos(a) * 0.05, 0, 0.03 + math.sin(a) * 0.06)))
    tube(brass, j, 0.013, 5)
    return p


def build_parts():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    meta = {}
    jib, meta["crane_jib"] = part_crane_jib(RIGS["crane"]["radius"])
    boom, meta["boom"] = part_boom(RIGS["boom"]["radius"])
    leaf_meta = RIGS["bridge"]["leaves"][0]
    leaf, meta["leaf"] = part_leaf("leaf", leaf_meta["length"], leaf_meta["width"])
    cage, meta["cage"] = part_cage()
    parts = [jib, part_counterweight(), part_hook(), part_carrier(RIGS["ropeway"]["hanger"]),
             part_gate("gate1", RIGS["gate1"]["width"], RIGS["gate1"]["height"]),
             part_gate("gate3", RIGS["gate3"]["width"], RIGS["gate3"]["height"]),
             leaf, boom, cage, part_cage_door(), part_satchel(), part_dispatch_hook()]
    roots = [emit(pt) for pt in parts]
    for o in bpy.data.objects:
        o.select_set(o in roots or o.parent in roots)
    out = os.path.join(OUT_DIR, "rigs.glb")
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", use_selection=True, export_yup=True, export_apply=False, export_extras=False,
        export_attributes=True, export_vertex_color="ACTIVE", export_materials="EXPORT", export_normals=True,
        export_texcoords=True, export_animations=False, export_cameras=False, export_lights=False,
        export_meshopt_compression_enable=True,
    )
    tri = sum(len(g.faces) * 2 for pt in parts for g in pt.geos.values())
    print(f"[rigs] wrote {os.path.relpath(out, REPO)} ({os.path.getsize(out) // 1024} KB), ~{tri} tris")
    return meta



# --------------------------------------------------------------------------
# distant scenery
# --------------------------------------------------------------------------

STACKS = [
    # x, y, radius, height, detail: layered out toward the sun (WNW) so they fade in steps
    (-190, 60, 10, 26, 1), (-232, 8, 8, 18, 1), (-160, 122, 13, 38, 1),
    (-330, 95, 15, 32, 1), (-360, 192, 21, 68, 1), (-420, 22, 17, 50, 1), (-300, 272, 23, 78, 1),
    (-60, 185, 15, 44, 1), (22, 245, 19, 58, 1),
    (-640, 242, 36, 112, 0), (-590, 72, 29, 86, 0), (-720, 392, 38, 104, 0), (-470, 422, 33, 122, 0),
    (-1400, 380, 80, 200, 0), (-1250, 130, 70, 160, 0), (-1600, 650, 90, 220, 0), (-1100, 800, 70, 180, 0),
]
LIGHTHOUSE_STACK = 3


def sea_stack(g, x, y, radius, height, detail, seed):
    """Weathered stack: columnar, lobed, leaning, with strata ledges and a flared foot. Each one differs."""
    r = random.Random(int(seed * 1000))
    seg = 16 if detail else 11
    rings = 14 if detail else 8
    lean_a = r.random() * math.tau
    lean = Vector((math.cos(lean_a), math.sin(lean_a), 0)) * (radius * r.uniform(0.1, 0.55))
    taper_k = r.uniform(0.05, 0.4)
    lobe_amp = r.uniform(0.22, 0.5)
    strata_n = r.randint(3, 6)
    strata_amp = r.uniform(0.06, 0.16)
    notch_t = r.uniform(0.35, 0.75)
    grid = []
    for ring in range(rings + 1):
        t = ring / rings
        z = -8 + (height + 8) * t
        centre = Vector((x, y, z)) + lean * (t ** 1.6)
        strata = 1.0 + strata_amp * (1 if math.floor(t * strata_n + seed) % 2 else -0.4)
        notch = 1.0 - 0.18 * math.exp(-((t - notch_t) / 0.06) ** 2)
        row = []
        for sidx in range(seg):
            a = 2 * math.pi * sidx / seg
            d = Vector((math.cos(a), math.sin(a), 0))
            taper = 1.0 - taper_k * t + 0.5 * (1 - t) ** 5 - 0.35 * max(0.0, t - 0.88) / 0.12
            lobes = lobe_amp * noise.noise(Vector((d.x * 1.1 + seed, d.y * 1.1, t * 1.4)))
            grain = 0.1 * noise.noise(Vector((d.x * 3.7, d.y * 3.7 + seed, t * 7.0)))
            k = max(0.3, 1.0 + lobes + grain)
            row.append(g.vert(centre + d * (radius * taper * k * strata * notch)))
        grid.append(row)
    for ring in range(rings):
        ao = 0.4 + 0.6 * (ring / rings)
        for sidx in range(seg):
            s2 = (sidx + 1) % seg
            g.face([grid[ring][sidx], grid[ring][s2], grid[ring + 1][s2], grid[ring + 1][sidx]], col=(ao, ao, ao, 1))
    top_c = Vector((x, y, height)) + lean + Vector((0, 0, radius * 0.12))
    top = g.vert(top_c)
    for sidx in range(seg):
        s2 = (sidx + 1) % seg
        g.face([grid[rings][sidx], grid[rings][s2], top], col=(1, 1, 1, 1))
    return height, lean


def build_far(meta):
    far = geo("far", prefix="FAR")
    fol = geo("foliage", prefix="FAR")
    for i, (x, y, r, h, d) in enumerate(STACKS):
        top, lean = sea_stack(far, x, y, r, h, d, i * 3.1 + 0.7)
        if d and rng.random() < 0.65:
            # scrubby tufts clinging to the top, never a neat hat
            for j in range(rng.randint(2, 5)):
                a = rng.random() * math.tau
                rr = r * rng.uniform(0.1, 0.45)
                c = Vector((x + lean.x + math.cos(a) * rr, y + lean.y + math.sin(a) * rr, top + rng.uniform(-1.5, 0.8)))
                blob(fol, c, r * rng.uniform(0.1, 0.22), 0.45, seed=i + j)
    # lighthouse
    x, y, r, h, _ = STACKS[LIGHTHOUSE_STACK]
    _, lean = sea_stack(Geo("scratch"), x, y, r, h, 1, LIGHTHOUSE_STACK * 3.1 + 0.7)
    x, y = x + lean.x, y + lean.y
    base = v3(x, y, h - 1.0)
    cylinder(geo("plaster", prefix="FAR"), base, 3.2, 17.0, seg=12, r_top=2.4)
    cylinder(geo("iron", prefix="FAR"), base + Vector((0, 0, 17.0)), 2.9, 0.4, seg=12)
    cylinder(geo("glow", prefix="FAR"), base + Vector((0, 0, 17.4)), 1.9, 2.4, seg=10, top=False)
    cylinder(geo("roof", prefix="FAR"), base + Vector((0, 0, 19.8)), 2.6, 2.2, seg=10, r_top=0.2)
    meta["lighthouse"] = {"lamp": [x, y, h - 1.0 + 18.6]}
    # far headland ridge left of the sun, and a low coast running east behind the start
    ridge = [(-520, -160, 60), (-600, -90, 120), (-660, -20, 150), (-700, 40, 110), (-730, 90, 70), (-760, 130, 30)]
    grid = []
    for (x, y, hgt) in ridge:
        row = []
        for f, zf in ((-1.0, -8.0), (-0.5, 0.55), (0.0, 1.0), (0.6, 0.6), (1.2, -8.0)):
            off = Vector((1.0, 0.25, 0)).normalized() * (f * hgt * 1.4)
            z = hgt * zf if zf > 0 else zf
            p = Vector((x, y, 0)) + off + Vector((0, 0, z + (noise.noise(Vector((x * 0.01, y * 0.01, f))) * 18 if zf > 0 else 0)))
            row.append(far.vert(p))
        grid.append(row)
    for a in range(len(grid) - 1):
        for b in range(4):
            far.face([grid[a][b], grid[a + 1][b], grid[a + 1][b + 1], grid[a][b + 1]], col=(0.8, 0.8, 0.8, 1))


# --------------------------------------------------------------------------
# Blender objects, export
# --------------------------------------------------------------------------


def make_material(name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    c = GRAYBOX_COLOR.get(name, (0.8, 0.8, 0.8))
    bsdf.inputs["Base Color"].default_value = (c[0], c[1], c[2], 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9
    if name == "glow":
        bsdf.inputs["Emission Color"].default_value = (c[0], c[1], c[2], 1.0)
        bsdf.inputs["Emission Strength"].default_value = 3.0
    return m


def to_object(g):
    if g.empty():
        return None
    me = bpy.data.meshes.new(g.name)
    me.from_pydata(g.verts, [], g.faces)
    me.update()
    uv = me.uv_layers.new(name="UVMap")
    flat_uv = [c for fu in g.face_uv for uvp in fu for c in uvp]
    uv.data.foreach_set("uv", flat_uv)
    ca = me.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
    flat_col = [c for fc in g.face_col for col in fc for c in col]
    ca.data.foreach_set("color", flat_col)
    me.color_attributes.active_color = ca
    if any(w != 0 for w in g.wind):
        wa = me.attributes.new("_WIND", "FLOAT", "POINT")
        wa.data.foreach_set("value", g.wind)
    me.polygons.foreach_set("use_smooth", g.face_smooth)
    me.validate()
    ob = bpy.data.objects.new(g.name, me)
    bpy.context.scene.collection.objects.link(ob)
    if g.material:
        me.materials.append(make_material(g.material))
    return ob


def sun_vector():
    az, el = math.radians(SUN_AZIMUTH_DEG), math.radians(SUN_ELEVATION_DEG)
    return Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))


def setup_cycles():
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scene.cycles.device = "GPU"
    except Exception as err:  # CPU is fine, just slower
        print("[bake] GPU unavailable:", err)
    scene.cycles.samples = BAKE_SAMPLES
    scene.cycles.use_denoising = False
    world = bpy.data.worlds.new("bake_world")
    scene.world = world
    world.light_settings.distance = 3.5  # AO reach in metres
    sun = bpy.data.lights.new("bake_sun", "SUN")
    sun.angle = math.radians(1.6)
    sun.energy = 3.0
    so = bpy.data.objects.new("bake_sun", sun)
    so.rotation_euler = sun_vector().to_track_quat("Z", "Y").to_euler()
    scene.collection.objects.link(so)
    for ob in scene.objects:
        if ob.name.startswith(("COL_", "FAR_")):
            ob.hide_render = True


def unwrap_group(obs):
    for ob in bpy.data.objects:
        ob.select_set(False)
    for ob in obs:
        lm = ob.data.uv_layers.get("LM") or ob.data.uv_layers.new(name="LM")
        ob.data.uv_layers.active = lm
        ob.data.uv_layers["UVMap"].active_render = True
        ob.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(58), island_margin=0.0, area_weight=0.0, correct_aspect=True,
                             scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(margin=0.003, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")


def bake_group(name, obs):
    import numpy as np
    unwrap_group(obs)
    images = {}
    for kind in ("AO", "SHADOW"):
        img = bpy.data.images.new(f"{name}_{kind}", LM_SIZE, LM_SIZE, alpha=False, float_buffer=True)
        images[kind] = img
        for ob in obs:
            for mat in ob.data.materials:
                nt = mat.node_tree
                node = nt.nodes.get("bake_target") or nt.nodes.new("ShaderNodeTexImage")
                node.name = "bake_target"
                node.image = img
                nt.nodes.active = node
        for o in bpy.data.objects:
            o.select_set(o in obs)
        bpy.context.view_layer.objects.active = obs[0]
        t0 = __import__("time").time()
        bpy.ops.object.bake(type=kind, margin=6, margin_type="EXTEND", uv_layer="LM", use_clear=True)
        print(f"[bake] {name} {kind} {LM_SIZE}px {BAKE_SAMPLES} spp in {__import__('time').time() - t0:.1f}s")
    ao = np.array(images["AO"].pixels[:], dtype=np.float32).reshape(LM_SIZE, LM_SIZE, 4)
    sh = np.array(images["SHADOW"].pixels[:], dtype=np.float32).reshape(LM_SIZE, LM_SIZE, 4)
    rgb = np.zeros((LM_SIZE, LM_SIZE, 3), np.float32)
    rgb[..., 0] = ao[..., 0]
    rgb[..., 1] = sh[..., 0]
    return np.clip(rgb, 0, 1)  # rows bottom-up, as Blender stores them


def save_lightmap(name, rgb):
    """WebP straight from Blender; glTF-style UVs mean the runtime samples it with flipY off."""
    import numpy as np
    path = os.path.join(OUT_DIR, "tex", f"{name}.webp")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img = bpy.data.images.new(name + "_out", rgb.shape[1], rgb.shape[0], alpha=False)
    flat = np.concatenate([rgb.astype(np.float32), np.ones(rgb.shape[:2] + (1,), np.float32)], axis=-1)
    img.pixels.foreach_set(flat.ravel())
    img.filepath_raw = path
    img.file_format = "WEBP"
    scene = bpy.context.scene
    scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.quality = 88
    img.save_render(path, scene=scene)
    print(f"[bake] wrote {os.path.relpath(path, REPO)} ({os.path.getsize(path) // 1024} KB)")


def vertex_sun_visibility():
    """_SUNVIS per vertex for thin props: one ray toward the sun against everything visible."""
    from mathutils.bvhtree import BVHTree
    verts, polys = [], []
    for ob in bpy.data.objects:
        if ob.type != "MESH" or ob.name.startswith(("COL_", "FAR_")) or ob.name in VERTEX_SUN_OBJECTS:
            continue
        base = len(verts)
        verts.extend([tuple(v.co) for v in ob.data.vertices])
        polys.extend([tuple(base + i for i in p.vertices) for p in ob.data.polygons])
    tree = BVHTree.FromPolygons(verts, polys, epsilon=0.0)
    sun = sun_vector()
    for name in VERTEX_SUN_OBJECTS:
        ob = bpy.data.objects.get(name)
        if not ob:
            continue
        vals = []
        for v in ob.data.vertices:
            hit = tree.ray_cast(v.co + sun * 0.08, sun, 400.0)
            vals.append(0.0 if hit[0] is not None else 1.0)
        attr = ob.data.attributes.get("_SUNVIS") or ob.data.attributes.new("_SUNVIS", "FLOAT", "POINT")
        attr.data.foreach_set("value", vals)
        print(f"[bake] {name}: {sum(vals) / max(1, len(vals)):.2f} of {len(vals)} verts sunlit")


def bake_all():
    setup_cycles()
    for name, obj_names in LIGHTMAP_GROUPS.items():
        obs = [bpy.data.objects[n] for n in obj_names if n in bpy.data.objects]
        if obs:
            save_lightmap(name, bake_group(name, obs))
    vertex_sun_visibility()
    # the bake target nodes are not wired into the BSDF, so the glTF export ignores them



SHORE_RECT = (-320.0, -80.0, 520.0)  # x0, y0, size (Blender metres); covers the coast and near stacks
SHORE_PX = 512
SHORE_REACH_M = 22.0


def build_shore_mask():
    """Top-down shallow-water mask: 1 at the waterline, fading to 0 SHORE_REACH_M out to sea.

    Ray-cast straight down onto everything (level + stacks); land is anything above -0.6 m.
    The water shader uses it for shallows, foam and the depth tint.
    """
    import numpy as np
    from mathutils.bvhtree import BVHTree
    verts, polys = [], []
    for ob in bpy.data.objects:
        if ob.type != "MESH" or ob.name.startswith("COL_"):
            continue
        base = len(verts)
        verts.extend([tuple(v.co) for v in ob.data.vertices])
        polys.extend([tuple(base + i for i in p.vertices) for p in ob.data.polygons])
    tree = BVHTree.FromPolygons(verts, polys, epsilon=0.0)
    x0, y0, size = SHORE_RECT
    px = size / SHORE_PX
    land = np.zeros((SHORE_PX, SHORE_PX), bool)
    down = Vector((0, 0, -1))
    for j in range(SHORE_PX):
        y = y0 + (j + 0.5) * px
        for i in range(SHORE_PX):
            hit = tree.ray_cast(Vector((x0 + (i + 0.5) * px, y, 400.0)), down, 800.0)
            if hit[0] is not None and hit[0].z > -0.6:
                land[j, i] = True
    # distance to land by repeated dilation (in pixels, 8-connected, good enough for a soft ramp)
    reach = int(SHORE_REACH_M / px) + 1
    dist = np.full(land.shape, reach, np.float32)
    front = land.copy()
    dist[land] = 0
    for step in range(1, reach):
        grown = front.copy()
        grown[1:, :] |= front[:-1, :]
        grown[:-1, :] |= front[1:, :]
        grown[:, 1:] |= front[:, :-1]
        grown[:, :-1] |= front[:, 1:]
        newly = grown & ~front
        dist[newly] = step
        front = grown
    val = np.clip(1.0 - dist / reach, 0, 1) ** 1.5
    val[land] = 1.0
    # store rows bottom-up (Blender image convention) so v = (y - y0) / size
    img = bpy.data.images.new("shore", SHORE_PX, SHORE_PX, alpha=False)
    rgba = np.stack([val, land.astype(np.float32), np.zeros_like(val), np.ones_like(val)], -1)
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    path = os.path.join(OUT_DIR, "tex", "shore.webp")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    scene = bpy.context.scene
    scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.quality = 90
    img.save_render(path, scene=scene)
    print(f"[level] shore mask {SHORE_PX}px over {size:.0f} m -> {os.path.relpath(path, REPO)}")


def main():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    meta = {"lanterns": [], "banners": []}
    build_cliff()
    build_walk()
    build_edges(meta)
    build_arch(meta)
    build_settlement(meta)
    build_props(meta)
    build_waterfall(meta)
    build_boats(meta)
    build_foreground(meta)
    build_chase_set(meta)
    build_far(meta)

    for g in list(GEOS.values()) + [COL_WALK, COL_WALL, COL_CAM]:
        to_object(g)
    if BAKE:
        bake_all()
    build_shore_mask()

    os.makedirs(OUT_DIR, exist_ok=True)

    def t3(p):
        # blender (x, y, z) -> three (x, z, -y)
        return [round(p[0], 3), round(p[2], 3), round(-p[1], 3)]

    route_out = []
    for r in ROUTE[::1]:
        route_out.append([round(r["p"].x, 3), round(r["z"], 3), round(-r["p"].y, 3), round(r["w"], 2), KINDS.index(r["kind"])])
    sun_az, sun_el = math.radians(SUN_AZIMUTH_DEG), math.radians(SUN_ELEVATION_DEG)
    sun_dir_blender = (math.cos(sun_az) * math.cos(sun_el), math.sin(sun_az) * math.cos(sun_el), math.sin(sun_el))
    level = {
        "version": 1,
        "generator": "scripts/assets/coastal-proof/build_level.py",
        "routeLength": round(ROUTE_LEN, 2),
        "routeKinds": KINDS,
        "surfaceByKind": SURFACE,
        "route": route_out,
        "sunDirection": t3(sun_dir_blender),
        "baked": BAKE,
        # three xz rect of tex/shore.webp: x from x0, z from -(y0 + size) .. -y0; v runs with blender y
        "shore": {"x0": SHORE_RECT[0], "y0": SHORE_RECT[1], "size": SHORE_RECT[2], "texture": "tex/shore.webp"},
        "lightmaps": {name: f"tex/{name}.webp" for name in LIGHTMAP_GROUPS} if BAKE else {},
        "lightmapGroups": {name: [n.replace("VIS_", "") for n in obs] for name, obs in LIGHTMAP_GROUPS.items()} if BAKE else {},
        "lanterns": [t3(p) for p in meta["lanterns"]],
        "banners": [{**b, "top": t3(b["top"])} for b in meta["banners"]],
        "waterfall": {
            "top": t3(meta["waterfall"]["top"]), "bottom": t3(meta["waterfall"]["bottom"]),
            "width": meta["waterfall"]["width"],
            "out": [meta["waterfall"]["out"][0], 0, -meta["waterfall"]["out"][1]],
            "along": [meta["waterfall"]["along"][0], 0, -meta["waterfall"]["along"][1]],
        },
        "lighthouse": {"lamp": t3(meta["lighthouse"]["lamp"])},
        "crane": {"tip": t3(meta["crane"]["tip"])},
        "plants": [{"t": pl["t"], "p": t3(pl["p"]), "s": round(pl["s"], 2), "r": round(pl["r"], 3)} for pl in PLANTS],
        # boats: positions in three xz; headings in three yaw (atan2(x, z) convention, radians)
        "boats": [
            {**{k: v for k, v in b.items() if k not in ("p", "h", "circle", "line")},
             **({"p": [b["p"][0], -b["p"][1]], "yaw": math.atan2(math.cos(math.radians(b["h"])), -math.sin(math.radians(b["h"])))} if "p" in b else {}),
             **({"circle": {"c": [b["circle"]["c"][0], -b["circle"]["c"][1]], "r": b["circle"]["r"], "speed": b["circle"]["speed"]}} if "circle" in b else {}),
             **({"line": {"a": [b["line"]["a"][0], -b["line"]["a"][1]], "b": [b["line"]["b"][0], -b["line"]["b"][1]], "speed": b["line"]["speed"]}} if "line" in b else {})}
            for b in meta["boats"]
        ],
        "segments": [{"kind": SPINE_NODES[i][4], "s0": round(NODE_S[i] - ROUTE_S0, 2), "s1": round(NODE_S[i + 1] - ROUTE_S0, 2)}
                     for i in range(ROUTE_FIRST, ROUTE_LAST_ON_SPINE)],
        "shots": {
            "overlook": 6.2,
            "descent": round(NODE_S[BRIDGE_I - 1] - ROUTE_S0 + 2.0, 1),
            "waterfront": round(ROUTE_LEN - 13.0, 1),
        },
        "stacks": [[t3((x, y, 0))[0], t3((x, y, 0))[2], r, h] for (x, y, r, h, _) in STACKS],
        "rigs": RIGS,
        "chimneys": [t3(c) for c in CHIMNEYS],
    }
    out = os.path.join(OUT_DIR, "level.glb")
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", export_yup=True, export_apply=False, export_extras=False,
        export_attributes=True, export_vertex_color="ACTIVE", export_materials="EXPORT", export_normals=True,
        export_texcoords=True, export_animations=False, export_cameras=False, export_lights=False,
        export_meshopt_compression_enable=True, export_image_format="WEBP",
    )
    if BLEND_OUT:
        bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
    level["rigParts"] = build_parts()
    with open(os.path.join(OUT_DIR, "level.json"), "w") as f:
        json.dump(level, f, separators=(",", ":"))
    tri = sum(len(g.faces) * 2 for g in GEOS.values())
    print(f"[level] route {ROUTE_LEN:.1f} m, {len(ROUTE)} samples; visual ~{tri} tris; "
          f"walk {len(COL_WALK.faces)} wall {len(COL_WALL.faces)} cam {len(COL_CAM.faces)} faces; "
          f"{len(meta['lanterns'])} lanterns")
    for k, g in sorted(GEOS.items()):
        print(f"  {k}: {len(g.faces)} faces")


main()
