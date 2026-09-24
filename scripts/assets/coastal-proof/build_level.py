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
    "lm_town": ["VIS_cobble", "VIS_step", "VIS_mortar", "VIS_plaster", "VIS_plaster_warm", "VIS_quay", "VIS_roof",
                "VIS_wood", "VIS_wood_dark", "VIS_sand"],
}
VERTEX_SUN_OBJECTS = ["VIS_rope", "VIS_cloth_red", "VIS_cloth_cream", "VIS_cloth_blue", "VIS_iron", "VIS_foliage",
                      "VIS_window", "VIS_glow"]

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
    "quay": 2.0, "mortar": 3.0,
}

GRAYBOX_COLOR = {
    "rock": (0.54, 0.49, 0.43), "rock_dark": (0.40, 0.36, 0.32), "cobble": (0.60, 0.57, 0.52),
    "step": (0.64, 0.60, 0.55), "plaster": (0.85, 0.80, 0.70), "plaster_warm": (0.80, 0.70, 0.57),
    "wood": (0.42, 0.29, 0.20), "wood_dark": (0.29, 0.20, 0.14), "roof": (0.63, 0.34, 0.23),
    "cloth_red": (0.61, 0.23, 0.18), "cloth_cream": (0.85, 0.79, 0.66), "cloth_blue": (0.25, 0.36, 0.52),
    "rope": (0.61, 0.52, 0.38), "iron": (0.23, 0.21, 0.19), "foliage": (0.31, 0.42, 0.21),
    "glow": (1.0, 0.72, 0.37), "window": (0.10, 0.08, 0.07), "sand": (0.73, 0.65, 0.50),
    "far": (0.44, 0.42, 0.41), "quay": (0.56, 0.53, 0.49), "mortar": (0.70, 0.64, 0.56),
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
        if acc >= spacing or k == k1:
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


def building(front_center, n_in, width, height, depth, base_z, lanterns, banners, style=0, glow_windows=0.25,
             balcony=False, roof="flat", awning=None):
    """front_center: xy on the facade; n_in: unit xy pointing INTO the rock (away from the lane)."""
    n_in = n_in.normalized()
    t = v2(-n_in.y, n_in.x)
    fc = front_center
    mat = "plaster" if style % 2 == 0 else "plaster_warm"
    shade = 0.85 + 0.15 * rng.random()
    col = (shade, shade * 0.98, shade * 0.95, 1)
    center = fc + n_in * (depth / 2)
    box(geo(mat), v3(center.x, center.y, base_z + height / 2 - 0.5), (depth, width, height + 1.0), fwd=n_in, col=col, cam=True)
    # plinth
    box(geo("mortar"), v3(fc.x - n_in.x * 0.05, fc.y - n_in.y * 0.05, base_z + 0.2), (0.14, width + 0.1, 0.6), fwd=n_in, col=(0.8, 0.8, 0.8, 1))
    out = -n_in
    # door recess + lintel
    door_w = min(1.4, width * 0.3)
    dc = fc + out * 0.01
    box(geo("window"), v3(dc.x, dc.y, base_z + 1.15), (0.06, door_w, 2.3), fwd=n_in)
    box(geo("wood"), v3(dc.x + out.x * 0.03, dc.y + out.y * 0.03, base_z + 2.42), (0.18, door_w + 0.4, 0.18), fwd=n_in)
    # windows per floor
    floors = max(1, int((height - 0.5) / 3.0))
    for fl in range(floors):
        wz = base_z + 1.6 + fl * 3.0 + (1.3 if fl == 0 else 0)
        if wz + 0.8 > base_z + height - 0.3:
            break
        nwin = max(1, int(width / 2.2))
        for wi in range(nwin):
            off = (wi + 0.5) / nwin - 0.5
            if fl == 0 and abs(off * width) < door_w:
                continue
            wc = fc + t * (off * width) + out * 0.02
            glow = rng.random() < glow_windows
            box(geo("glow" if glow else "window"), v3(wc.x, wc.y, wz), (0.05, 0.62, 0.95), fwd=n_in)
            box(geo("wood_dark"), v3(wc.x + out.x * 0.04, wc.y + out.y * 0.04, wz - 0.55), (0.14, 0.8, 0.08), fwd=n_in)
            if glow and rng.random() < 0.4:
                lanterns.append(v3(wc.x + out.x * 0.1, wc.y + out.y * 0.1, wz))
    top = base_z + height - 0.5
    if roof == "tile":
        ridge_h = 1.6
        r = geo("roof")
        a0 = fc + t * (-width / 2 - 0.3) + out * 0.5
        a1 = fc + t * (width / 2 + 0.3) + out * 0.5
        b0 = a0 + n_in * (depth * 0.5 + 0.5)
        b1 = a1 + n_in * (depth * 0.5 + 0.5)
        r.quad(v3(a0.x, a0.y, top), v3(a1.x, a1.y, top), v3(b1.x, b1.y, top + ridge_h), v3(b0.x, b0.y, top + ridge_h), col=col)
        r.quad(v3(b0.x, b0.y, top + ridge_h), v3(b1.x, b1.y, top + ridge_h), v3(a1.x, a1.y, top + ridge_h) + Vector((n_in.x * depth, n_in.y * depth, -ridge_h)),
               v3(a0.x, a0.y, top + ridge_h) + Vector((n_in.x * depth, n_in.y * depth, -ridge_h)), col=col)
    else:
        # parapet lip + a planter
        lip = fc + n_in * (depth / 2)
        for side in (-1, 1):
            e = fc + t * (side * width / 2)
            box(geo(mat), v3(e.x + n_in.x * depth / 2, e.y + n_in.y * depth / 2, top + 0.35), (depth, 0.25, 0.7), fwd=n_in, col=col)
        box(geo(mat), v3(fc.x + out.x * 0.1, fc.y + out.y * 0.1, top + 0.35), (0.25, width, 0.7), fwd=n_in, col=col)
        if rng.random() < 0.7:
            pc = fc + n_in * 1.0 + t * ((rng.random() - 0.5) * width * 0.6)
            plant("shrub", (pc.x, pc.y, top + 0.05), 1.1 + rng.random() * 0.6)
            if rng.random() < 0.5:
                pe = fc + out * 0.1 + t * ((rng.random() - 0.5) * width * 0.7)
                plant("fern", (pe.x, pe.y, top + 0.55), 0.9 + rng.random() * 0.4)
    if balcony and height > 5.5:
        bz = base_z + 3.4
        bc = fc + out * 0.7
        box(geo("wood"), v3(bc.x, bc.y, bz), (1.4, width * 0.6, 0.14), fwd=n_in)
        for side in (-1, 1):
            e = bc + t * (side * width * 0.3) + out * 0.6
            cylinder(geo("wood_dark"), v3(e.x, e.y, bz - 1.2), 0.06, 2.2, seg=5)
        rail0 = bc + out * 0.65 + t * (-width * 0.3)
        rail1 = bc + out * 0.65 + t * (width * 0.3)
        box(geo("wood_dark"), v3((rail0.x + rail1.x) / 2, (rail0.y + rail1.y) / 2, bz + 0.9), (0.08, width * 0.6, 0.08), fwd=n_in)
        # hanging cloth over the balcony rail
        if rng.random() < 0.8:
            ca = rail0.lerp(rail1, 0.2) + out * 0.05
            cb = rail0.lerp(rail1, 0.55) + out * 0.05
            cloth(geo(rng.choice(["cloth_red", "cloth_cream", "cloth_blue"])), v3(ca.x, ca.y, bz + 0.9), v3(cb.x, cb.y, bz + 0.9), 1.1, cols=2, rows=4)
    if awning:
        a0 = fc + t * (-awning / 2) + out * 0.02
        a1 = fc + t * (awning / 2) + out * 0.02
        cloth(geo(rng.choice(["cloth_red", "cloth_cream"])), v3(a0.x, a0.y, base_z + 2.9), v3(a1.x, a1.y, base_z + 2.9), 0.5,
              cols=4, rows=3, slope_out=(out.x * 1.3, out.y * 1.3, 0))
    if rng.random() < 0.45 and height > 4:
        bc = fc + t * (width * (0.25 if rng.random() < 0.5 else -0.25)) + out * 0.06
        b0 = bc + t * -0.4
        b1 = bc + t * 0.4
        cloth(geo(rng.choice(["cloth_red", "cloth_red", "cloth_blue"])), v3(b0.x, b0.y, top - 0.3), v3(b1.x, b1.y, top - 0.3), min(2.6, height - 2.4), cols=2, rows=6)
        banners.append({"top": [bc.x, bc.y, top - 0.3]})


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
        box(geo("plaster"), v3(cen.x, cen.y, zr + 4.2), (length, hwa * 2 + 1.6, 0.8), fwd=T, bottom=True, cam=True)
        box(geo("plaster_warm"), v3(cen.x, cen.y, zr + 6.4), (length, hwa * 2 + 1.2, 3.6), fwd=T, cam=True)
        # arched opening on the sea side: lintel between piers + low balustrade
        sea = mid - L * (hwa + 0.35)
        box(geo("mortar"), v3(sea.x, sea.y, zr + 3.4), (length - 0.6, 0.6, 0.9), fwd=T)
        box(geo("mortar"), v3(sea.x, sea.y, zr + 0.45), (length - 0.6, 0.45, 0.9), fwd=T)
        # windows on the upper storey facing the sea
        box(geo("glow" if k % 2 == 0 else "window"), v3(sea.x, sea.y, zr + 6.3), (length * 0.35, 0.7, 1.0), fwd=T)
        if k % 2 == 1:
            lan = mid + L * (hwa - 0.2)
            wall_lantern(lan, -L, zr + 3.0, meta["lanterns"])


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
                box(geo("wood_dark"), v3(r["p"].x, r["p"].y, r["z"] - 0.2), (0.2, r["w"] + 0.5, 0.18), fwd=r["T"])
        elif kind in ("boardwalk", "pier"):
            rail_posts = []
            acc = 99.0
            for k in range(k0, k1 + 1):
                r = ROUTE[k]
                if k > k0:
                    acc += (r["p"] - ROUTE[k - 1]["p"]).length
                if acc >= 2.2 or k == k1:
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
    # crane on the quay's land side
    rq = ROUTE[quay_k[len(quay_k) // 3]]
    cb = rq["p"] + rq["L"] * (rq["w"] / 2 - 0.4)
    cylinder(geo("wood_dark"), v3(cb.x, cb.y, rq["z"]), 0.22, 7.0, seg=6)
    jib_end = cb - rq["L"] * 5.5 + rq["T"] * 1.0
    tube(geo("wood_dark"), [v3(cb.x, cb.y, rq["z"] + 6.2), v3(jib_end.x, jib_end.y, rq["z"] + 7.6)], 0.14, 5)
    tube(geo("rope"), [v3(jib_end.x, jib_end.y, rq["z"] + 7.6), v3(jib_end.x, jib_end.y, rq["z"] + 3.2)], 0.03, 4)
    box(geo("wood"), v3(jib_end.x, jib_end.y, rq["z"] + 2.9), (0.7, 0.7, 0.5), fwd=rq["T"])
    box(COL_WALL, v3(cb.x, cb.y, rq["z"] + 1), (0.6, 0.6, 2), fwd=rq["T"])
    meta["crane"] = {"tip": [jib_end.x, jib_end.y, rq["z"] + 7.6]}
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
    """Weathered stack: lobed, leaning, with strata ledges, a flared foot and a rounded cap."""
    seg = 16 if detail else 11
    rings = 12 if detail else 7
    lean_a = seed * 2.39
    lean = Vector((math.cos(lean_a), math.sin(lean_a), 0)) * (radius * (0.25 + 0.35 * ((seed * 7.1) % 1)))
    grid = []
    for r in range(rings + 1):
        t = r / rings
        z = -8 + (height + 8) * t
        centre = Vector((x, y, z)) + lean * (t ** 1.6)
        strata = 1.0 + 0.1 * math.floor((t * 4.3 + seed) % 2)
        row = []
        for sidx in range(seg):
            a = 2 * math.pi * sidx / seg
            d = Vector((math.cos(a), math.sin(a), 0))
            taper = 1.0 - 0.32 * t + 0.45 * (1 - t) ** 4 - 0.25 * max(0.0, t - 0.85) / 0.15
            lobes = 0.42 * noise.noise(Vector((d.x * 1.1 + seed, d.y * 1.1, t * 1.6)))
            grain = 0.12 * noise.noise(Vector((d.x * 3.7, d.y * 3.7 + seed, t * 6.0)))
            k = max(0.35, 1.0 + lobes + grain)
            p = centre + d * (radius * taper * k * strata)
            row.append(g.vert(p))
        grid.append(row)
    for r in range(rings):
        ao = 0.42 + 0.58 * (r / rings)
        for sidx in range(seg):
            s2 = (sidx + 1) % seg
            g.face([grid[r][sidx], grid[r][s2], grid[r + 1][s2], grid[r + 1][sidx]], col=(ao, ao, ao, 1))
    top_c = Vector((x, y, height)) + lean + Vector((0, 0, radius * 0.18))
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
        if d:
            for j in range(3):
                a = rng.random() * math.tau
                c = Vector((x + lean.x + math.cos(a) * r * 0.3, y + lean.y + math.sin(a) * r * 0.3, top + 1.0))
                blob(fol, c, r * (0.35 + 0.2 * rng.random()), 0.5, seed=i + j)
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
    }
    with open(os.path.join(OUT_DIR, "level.json"), "w") as f:
        json.dump(level, f, separators=(",", ":"))

    out = os.path.join(OUT_DIR, "level.glb")
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", export_yup=True, export_apply=False, export_extras=False,
        export_attributes=True, export_vertex_color="ACTIVE", export_materials="EXPORT", export_normals=True,
        export_texcoords=True, export_animations=False, export_cameras=False, export_lights=False,
        export_meshopt_compression_enable=True, export_image_format="WEBP",
    )
    if BLEND_OUT:
        bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
    tri = sum(len(g.faces) * 2 for g in GEOS.values())
    print(f"[level] route {ROUTE_LEN:.1f} m, {len(ROUTE)} samples; visual ~{tri} tris; "
          f"walk {len(COL_WALK.faces)} wall {len(COL_WALL.faces)} cam {len(COL_CAM.faces)} faces; "
          f"{len(meta['lanterns'])} lanterns")
    for k, g in sorted(GEOS.items()):
        print(f"  {k}: {len(g.faces)} faces")


main()
