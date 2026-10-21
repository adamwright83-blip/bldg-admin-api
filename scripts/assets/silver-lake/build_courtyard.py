"""Silver Lake cozy courtyard (Blender 5.2, headless).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python scripts/assets/silver-lake/build_courtyard.py -- [--kits DIR] [--render OUT_DIR]

The painted Silver Lake plate (client/public/assets/lantern-villager-outreach/environment/) brought to life:
a floating island of grass, a cobbled plaza with a fountain, six chunky pastel cottages with glowing windows,
flower boxes and chimneys, lamp posts, benches, and CC0 Quaternius trees, bushes and flowers.
Lantern City is a cozy game; nothing here comes from the Coastal Market proof.

Units match the KayKit hero (about 2.3 tall). Blender is Z-up; the glTF export is Y-up.
Outputs next to the hero: courtyard.glb and courtyard.json (spawn, villager spots, colliders, bounds).
"""

import bmesh
import bpy
import json
import math
import os
import random
import sys

from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT_DIR = os.path.join(REPO, "client", "public", "assets", "goldline", "silver-lake-3d")
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default


KITS = os.path.expanduser(arg("--kits", "~/Desktop/lantern-city-commercial-game/lantern-kit-sources"))
RENDER = arg("--render")
QN = os.path.join(KITS, "quaternius_stylized_nature", "glTF")
rng = random.Random(7)

PLAZA_R = 8.5
ISLAND_R = 21.0
HOUSE_R = 13.6
WALK_R = 19.2

COL = {
    "grass": "#8dbb5a", "grass_dark": "#6f9d45", "path": "#e3caa0", "stone": "#c9b394", "stone_dark": "#a8927a",
    "cliff": "#9c7a5a", "cliff_dark": "#7a5c44", "cream": "#f3e6cc", "plaster_pink": "#f2c9b8",
    "plaster_blue": "#cfe0ea", "plaster_yellow": "#f4e2a6", "timber": "#7a5234", "door": "#8a4f2c",
    "window": "#ffd98a", "frame": "#f8f1e2", "chimney": "#b9785a", "water": "#7cc6e6", "lamp_post": "#3f3a36",
    "lamp_glow": "#ffcf73", "bench": "#a46a3e", "box": "#8b5a34",
    "roof_blue": "#4f79b8", "roof_orange": "#e07a3f", "roof_green": "#5f9a52", "roof_purple": "#8a68b5",
    "roof_teal": "#3f9a95", "roof_yellow": "#e6b33f",
}
MATS = {}


def hexrgb(h):
    h = h.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)


def mat(name, emissive=0.0, rough=0.85):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*hexrgb(COL[name]), 1)
    p.inputs["Roughness"].default_value = rough
    if emissive:
        p.inputs["Emission Color"].default_value = (*hexrgb(COL[name]), 1)
        p.inputs["Emission Strength"].default_value = emissive
    MATS[name] = m
    return m


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def obj_from_bm(name, bm, material, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def box(name, size, loc, material, bevel=0.06, rot_z=0.0, segments=2):
    bm = bmesh.new()
    v = bmesh.ops.create_cube(bm, size=1.0)["verts"]
    bmesh.ops.scale(bm, vec=size, verts=v)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segments, affect="EDGES", profile=0.5)
    ob = obj_from_bm(name, bm, material)
    ob.rotation_euler.z = rot_z
    ob.location = loc
    return ob


def cyl(name, r, depth, loc, material, verts=24, r2=None, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    if bevel:
        edges = [e for e in bm.edges if len(e.link_faces) == 2 and abs(e.link_faces[0].normal.z) != abs(e.link_faces[1].normal.z)]
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=2, affect="EDGES", profile=0.5)
    ob = obj_from_bm(name, bm, material, smooth=False)
    ob.location = loc
    return ob


# ------------------------------------------------------------------ island
def ground():
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, radius=ISLAND_R, segments=72)
    obj_from_bm("Grass", bm, mat("grass"))
    # soft rolling rim so the island edge reads as a hill, not a cut disc
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=72, radius1=ISLAND_R, radius2=ISLAND_R - 0.8, depth=0.5)
    rim = obj_from_bm("GrassRim", bm, mat("grass_dark"))
    rim.location.z = -0.25
    # rocky underside: stacked jittered rings tapering to a point
    bm = bmesh.new()
    rings = [(ISLAND_R, -0.5), (ISLAND_R * 0.93, -2.2), (ISLAND_R * 0.75, -4.6), (ISLAND_R * 0.48, -7.4), (ISLAND_R * 0.18, -10.2)]
    seg = 40
    loops = []
    for (r, z) in rings:
        loop = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            rr = r * (1 + rng.uniform(-0.06, 0.06))
            loop.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z + rng.uniform(-0.3, 0.3))))
        loops.append(loop)
    for l0, l1 in zip(loops, loops[1:]):
        for i in range(seg):
            bm.faces.new((l0[i], l0[(i + 1) % seg], l1[(i + 1) % seg], l1[i]))
    tip = bm.verts.new((0, 0, -12.5))
    for i in range(seg):
        bm.faces.new((loops[-1][i], loops[-1][(i + 1) % seg], tip))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    under = obj_from_bm("Cliff", bm, mat("cliff"))
    # plaza: sandy disc plus scattered flat stones
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, radius=PLAZA_R, segments=64)
    pl = obj_from_bm("Plaza", bm, mat("path"))
    pl.location.z = 0.02
    stones = []
    for ring in range(5):
        r0 = 2.6 + ring * 1.25
        n = int(2 * math.pi * r0 / 0.95)
        for i in range(n):
            a = 2 * math.pi * (i + rng.random() * 0.4) / n
            r = r0 + rng.uniform(-0.25, 0.25)
            s = rng.uniform(0.38, 0.55)
            st = cyl("Cobble", s * 0.6, 0.1, (r * math.cos(a), r * math.sin(a), 0.06), mat("stone" if rng.random() > 0.3 else "stone_dark"), verts=7, bevel=0.04)
            st.rotation_euler.z = rng.uniform(0, math.pi)
            stones.append(st)
    return stones


def path_to(angle, inner, outer, width=1.9):
    bm = bmesh.new()
    v = bmesh.ops.create_cube(bm, size=1.0)["verts"]
    bmesh.ops.scale(bm, vec=(outer - inner, width, 0.04), verts=v)
    ob = obj_from_bm("Path", bm, mat("path"))
    mid = (inner + outer) / 2
    ob.location = (mid * math.cos(angle), mid * math.sin(angle), 0.03)
    ob.rotation_euler.z = angle
    for k in range(int((outer - inner) / 0.8)):
        r = inner + 0.4 + k * 0.8
        off = rng.uniform(-0.45, 0.45)
        px = r * math.cos(angle) - off * math.sin(angle)
        py = r * math.sin(angle) + off * math.cos(angle)
        s = rng.uniform(0.42, 0.58)
        box("Cobble", (s, s * 0.85, 0.08), (px, py, 0.06), mat("stone"), bevel=0.06, rot_z=rng.uniform(0, math.pi))


# ------------------------------------------------------------------ cottages
ROOFS = ["roof_blue", "roof_orange", "roof_green", "roof_purple", "roof_teal", "thatch"]
WALLS = ["plaster_blue", "cream", "plaster_mint", "plaster_lilac", "plaster_pink", "plaster_yellow"]
COL.update({
    "plaster_blue": "#bcd8ee", "plaster_mint": "#cdebd2", "plaster_lilac": "#e2d3f1", "plaster_pink": "#f6c8bf",
    "plaster_yellow": "#f8e3a0", "cream": "#f6e8cf", "thatch": "#e7bd5c", "thatch_dark": "#c9963c",
    "picket": "#fbf6ec", "awning": "#e9634f", "awning_light": "#fbeee0", "rope": "#d9c7a4",
    "cloth_coral": "#ff8a73", "cloth_sky": "#7cc4ff", "cloth_butter": "#ffd863", "cloth_mint": "#7fd8a6",
    "cloth_lilac": "#c3a3f0", "mailbox": "#d9504a", "birdhouse": "#f0a14a", "pumpkin": "#f28a2e", "leaf": "#5f9a52",
    "pot": "#c8714a", "crate": "#b98a55",
})


def place_parts(parts, M):
    for p in parts:
        p.matrix_basis = M @ p.matrix_basis


def arched_door(fx, y0, colour):
    parts = [box("DoorFrame", (0.2, 1.62, 2.1), (fx - 0.04, y0, 1.05), mat("frame"), bevel=0.06)]
    top = cyl("DoorArchFrame", 0.81, 0.2, (fx - 0.04, y0, 2.1), mat("frame"), verts=20)
    top.rotation_euler = (0, math.radians(90), 0)
    parts.append(top)
    parts.append(box("Door", (0.22, 1.28, 1.95), (fx - 0.08, y0, 0.98), mat(colour), bevel=0.05))
    arch = cyl("DoorArch", 0.64, 0.22, (fx - 0.08, y0, 1.95), mat(colour), verts=20)
    arch.rotation_euler = (0, math.radians(90), 0)
    parts.append(arch)
    parts.append(cyl("Knob", 0.08, 0.12, (fx - 0.25, y0 + 0.38, 1.05), mat("lamp_glow", emissive=1.5), verts=10))
    return parts


def round_window(x, y, z, axis, r=0.42):
    f = cyl("RoundFrame", r + 0.12, 0.18, (x, y, z), mat("frame"), verts=24)
    g = cyl("RoundWin", r, 0.2, (x, y, z), mat("window", emissive=2.4), verts=24)
    rot = (0, math.radians(90), 0) if axis == "x" else (math.radians(90), 0, 0)
    f.rotation_euler = rot
    g.rotation_euler = rot
    return [f, g]


FENCES = []


def picket_run(x0, y0, x1, y1):
    parts = []
    FENCES.append((x0, y0, x1, y1))
    n = max(2, int(math.hypot(x1 - x0, y1 - y0) / 0.32))
    ang = math.atan2(y1 - y0, x1 - x0)
    for k in range(n + 1):
        t = k / n
        x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        parts.append(box("Picket", (0.12, 0.12, 0.8), (x, y, 0.4), mat("picket"), bevel=0.04))
        parts.append(box("PicketTip", (0.09, 0.09, 0.09), (x, y, 0.84), mat("picket"), bevel=0.04, rot_z=math.radians(45)))
    L = math.hypot(x1 - x0, y1 - y0)
    for z in (0.28, 0.6):
        parts.append(box("Rail", (L, 0.06, 0.1), ((x0 + x1) / 2, (y0 + y1) / 2, z), mat("picket"), bevel=0.02, rot_z=ang))
    return parts


def garment(kind, colour, x, y, z):
    m = mat(colour)
    if kind == "shirt":
        return [box("Shirt", (0.08, 0.62, 0.7), (x, y, z - 0.35), m, bevel=0.06),
                box("Sleeve", (0.08, 0.26, 0.24), (x, y - 0.4, z - 0.12), m, bevel=0.05, rot_z=0),
                box("Sleeve", (0.08, 0.26, 0.24), (x, y + 0.4, z - 0.12), m, bevel=0.05)]
    if kind == "pants":
        return [box("Waist", (0.08, 0.5, 0.18), (x, y, z - 0.09), m, bevel=0.04),
                box("Leg", (0.08, 0.22, 0.7), (x, y - 0.13, z - 0.5), m, bevel=0.05),
                box("Leg", (0.08, 0.22, 0.7), (x, y + 0.13, z - 0.5), m, bevel=0.05)]
    if kind == "sock":
        return [box("Sock", (0.08, 0.16, 0.42), (x, y, z - 0.21), m, bevel=0.05),
                box("Toe", (0.08, 0.26, 0.15), (x, y + 0.06, z - 0.42), m, bevel=0.05)]
    return [box("Towel", (0.07, 0.7, 0.85), (x, y, z - 0.43), m, bevel=0.05)]


def clothesline(x0, y0, x1, y1):
    parts = []
    for (x, y) in ((x0, y0), (x1, y1)):
        parts.append(box("LinePost", (0.16, 0.16, 2.6), (x, y, 1.3), mat("timber"), bevel=0.04))
        parts.append(box("LineCross", (0.12, 0.7, 0.12), (x, y, 2.5), mat("timber"), bevel=0.03, rot_z=math.atan2(y1 - y0, x1 - x0) + math.pi / 2))
    L = math.hypot(x1 - x0, y1 - y0)
    ang = math.atan2(y1 - y0, x1 - x0)
    segs = 10
    pts = []
    for k in range(segs + 1):
        t = k / segs
        pts.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 2.45 - 0.35 * math.sin(math.pi * t)))
    for a, b in zip(pts, pts[1:]):
        mid = [(a[i] + b[i]) / 2 for i in range(3)]
        seg = cyl("Rope", 0.025, math.dist(a, b), mid, mat("rope"), verts=6)
        d = Vector(b) - Vector(a)
        seg.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
        parts.append(seg)
    items = [("shirt", "cloth_coral"), ("sock", "cloth_butter"), ("pants", "cloth_sky"), ("towel", "cloth_mint"),
             ("sock", "cloth_lilac"), ("shirt", "cloth_butter"), ("towel", "cloth_coral")]
    for k, (kind, colour) in enumerate(items):
        t = (k + 0.7) / (len(items) + 0.4)
        x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        z = 2.45 - 0.35 * math.sin(math.pi * t)
        g = garment(kind, colour, 0, 0, 0)
        M = Matrix.Translation((x, y, z)) @ Matrix.Rotation(ang - math.pi / 2, 4, "Z") @ Matrix.Rotation(math.radians(rng.uniform(-6, 6)), 4, "X")
        place_parts(g, M)
        parts.extend(g)
        parts.append(box("Peg", (0.05, 0.05, 0.12), (x, y, z), mat("timber"), bevel=0.01))
    return parts


def cottage(i, angle):
    """A chunky, slightly wonky cottage whose door faces the plaza centre (local -X)."""
    w, d, h = 5.0, 4.4, 3.1
    roof_c, wall_c = ROOFS[i], WALLS[i]
    tilt = math.radians(rng.uniform(-2.5, 2.5))
    parts = []
    parts.append(box("Wall", (d, w, h), (0, 0, h / 2), mat(wall_c), bevel=0.28, segments=3))
    parts.append(box("Plinth", (d + 0.35, w + 0.35, 0.5), (0, 0, 0.25), mat("stone_dark"), bevel=0.16, segments=3))
    for xx in (-d / 2 + 0.02, d / 2 - 0.02):
        for yy in (-w / 2 + 0.02, w / 2 - 0.02):
            parts.append(box("Beam", (0.34, 0.34, h - 0.1), (xx, yy, h / 2 + 0.05), mat("timber"), bevel=0.08))
    parts.append(box("Trim", (d + 0.14, w + 0.14, 0.26), (0, 0, h - 0.05), mat("timber"), bevel=0.08))
    pitch = math.radians(40 if i != 5 else 46)
    half = d / 2 + 0.6
    thick = 0.5 if i != 5 else 0.95
    slab_len = half / math.cos(pitch) + 0.2
    for side in (-1, 1):
        s = box("Roof", (slab_len, w + 1.15, thick), (side * half / 2, 0, h + math.tan(pitch) * half / 2 + thick * 0.2), mat(roof_c), bevel=0.2 if i != 5 else 0.42, segments=3)
        s.rotation_euler.y = side * pitch
        parts.append(s)
    ridge_z = h + math.tan(pitch) * half
    parts.append(cyl("Ridge", 0.3 if i != 5 else 0.55, w + 1.3, (0, 0, ridge_z + 0.15), mat(roof_c if i != 5 else "thatch_dark"), verts=12))
    parts[-1].rotation_euler.x = math.radians(90)
    for yy in (-w / 2, w / 2):
        bm = bmesh.new()
        a = bm.verts.new((-d / 2, 0, h - 0.1))
        b = bm.verts.new((d / 2, 0, h - 0.1))
        c = bm.verts.new((0, 0, h + math.tan(pitch) * d / 2))
        bm.faces.new((a, b, c))
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.34)
        g = obj_from_bm("Gable", bm, mat(wall_c))
        g.location.y = yy + (0.17 if yy > 0 else -0.17)
        parts.append(g)
    # chimney (crooked on the lilac cottage)
    ch_tilt = math.radians(9) if i == 3 else 0
    c1 = box("Chimney", (0.85, 0.85, 2.2), (0.7, w / 2 - 1.1, ridge_z - 0.25), mat("chimney"), bevel=0.12)
    c2 = box("ChimneyCap", (1.08, 1.08, 0.28), (0.7 + math.sin(ch_tilt) * 1.1, w / 2 - 1.1, ridge_z + 0.85), mat("stone_dark"), bevel=0.08)
    c1.rotation_euler.y = ch_tilt
    c2.rotation_euler.y = ch_tilt
    parts += [c1, c2]
    fx = -d / 2
    door_colour = ["door", "door_blue", "door_red", "door", "door_green", "door_blue"][i]
    COL.update({"door_blue": "#4a76b0", "door_red": "#c4523f", "door_green": "#4f8a55"})
    parts += arched_door(fx, 0, door_colour)
    parts.append(box("Step", (1.0, 2.0, 0.3), (fx - 0.5, 0, 0.15), mat("stone"), bevel=0.1))
    for yy in (-1.65, 1.65):
        if i in (0, 5) and yy > 0:
            parts += round_window(fx - 0.05, yy, 1.95, "x")
        else:
            parts.append(box("WinFrame", (0.2, 1.25, 1.2), (fx - 0.03, yy, 1.95), mat("frame"), bevel=0.08))
            parts.append(box("Window", (0.22, 0.95, 0.9), (fx - 0.06, yy, 1.95), mat("window", emissive=2.4), bevel=0.04))
            parts.append(box("Mullion", (0.24, 0.07, 0.9), (fx - 0.07, yy, 1.95), mat("frame"), bevel=0.0))
            parts.append(box("Mullion", (0.24, 0.95, 0.07), (fx - 0.07, yy, 1.95), mat("frame"), bevel=0.0))
            for sh in (-0.72, 0.72):
                parts.append(box("Shutter", (0.12, 0.42, 1.05), (fx - 0.08, yy + sh, 1.95), mat(roof_c if i != 5 else "door_green"), bevel=0.05))
        parts.append(box("FlowerBox", (0.5, 1.35, 0.34), (fx - 0.28, yy, 1.26), mat("box"), bevel=0.06))
    for xx in (-0.8, 0.8):
        for yy in (-w / 2 - 0.02, w / 2 + 0.02):
            parts.append(box("WinFrame", (1.05, 0.2, 1.05), (xx, yy, 1.95), mat("frame"), bevel=0.06))
            parts.append(box("Window", (0.8, 0.22, 0.8), (xx, yy, 1.95), mat("window", emissive=2.4), bevel=0.04))
    parts.append(box("WallLamp", (0.32, 0.32, 0.42), (fx - 0.22, -1.0 if i % 2 else 1.0, 2.75), mat("lamp_glow", emissive=5), bevel=0.06))
    # personality
    extra_colliders = []
    if i == 0:  # blue: mailbox by the path and a round attic window
        parts.append(box("MailPost", (0.14, 0.14, 1.1), (fx - 2.2, 1.4, 0.55), mat("timber"), bevel=0.03))
        parts.append(box("Mailbox", (0.6, 0.36, 0.38), (fx - 2.2, 1.4, 1.2), mat("mailbox"), bevel=0.14, segments=3))
        parts.append(box("MailFlag", (0.05, 0.05, 0.3), (fx - 2.0, 1.6, 1.4), mat("mailbox"), bevel=0.0))
        parts += round_window(0, -w / 2 - 0.2, h + 0.95, "y", r=0.36)
    if i == 2:  # mint: striped porch awning, pots and crates
        for k in range(5):
            parts.append(box("Awning", (1.2, 0.5, 0.14), (fx - 0.65, -1.0 + k * 0.5, 2.75 - 0.0), mat("awning" if k % 2 == 0 else "awning_light"), bevel=0.04))
            parts[-1].rotation_euler.y = math.radians(-22)
        for yy in (-1.6, 1.6):
            parts.append(cyl("Pot", 0.3, 0.45, (fx - 1.1, yy * 0.7, 0.23), mat("pot"), verts=12, r2=0.38))
        parts.append(box("Crate", (0.6, 0.6, 0.55), (fx - 1.0, 2.6, 0.28), mat("crate"), bevel=0.05))
        parts.append(box("Crate", (0.5, 0.5, 0.45), (fx - 1.05, 2.6, 0.78), mat("crate"), bevel=0.05, rot_z=0.3))
    if i == 4:  # pink: dormer window and a bird house on a pole
        parts.append(box("Dormer", (1.2, 1.3, 1.2), (-0.9, -0.9, h + 0.9), mat(wall_c), bevel=0.15))
        dr = box("DormerRoof", (1.6, 1.6, 0.3), (-0.9, -0.9, h + 1.6), mat(roof_c), bevel=0.1)
        dr.rotation_euler.y = math.radians(-20)
        parts.append(dr)
        parts.append(box("DormerWin", (0.2, 0.75, 0.7), (-1.5, -0.9, h + 0.9), mat("window", emissive=2.4), bevel=0.04))
        parts.append(box("BirdPole", (0.12, 0.12, 2.4), (fx - 2.0, -2.0, 1.2), mat("timber"), bevel=0.03))
        parts.append(box("BirdHouse", (0.55, 0.55, 0.6), (fx - 2.0, -2.0, 2.6), mat("birdhouse"), bevel=0.1))
        bh = box("BirdRoof", (0.8, 0.7, 0.14), (fx - 2.0, -2.0, 3.0), mat("roof_teal"), bevel=0.05)
        parts.append(bh)
        parts += round_window(fx - 2.28, -2.0, 2.6, "x", r=0.1)
    if i == 5:  # thatched: pumpkin patch
        for k in range(4):
            px, py = fx - 1.4 - (k % 2) * 0.8, 2.6 + (k // 2) * 0.7
            parts.append(cyl("Pumpkin", 0.32 - 0.04 * k, 0.4, (px, py, 0.2), mat("pumpkin"), verts=10, bevel=0.08))
            parts.append(box("Stem", (0.06, 0.06, 0.16), (px, py, 0.46), mat("leaf"), bevel=0.0))
    fence_from = len(FENCES)
    if i in (1, 3, 4):
        side = 1 if i != 4 else -1
        parts += picket_run(fx - 0.6, side * (w / 2 + 0.3), fx - 0.6, side * (w / 2 + 2.6))
        parts += picket_run(fx - 0.6, side * (w / 2 + 2.6), d / 2 + 0.4, side * (w / 2 + 2.6))
    R = Matrix.Translation((HOUSE_R * math.cos(angle), HOUSE_R * math.sin(angle), 0)) @ Matrix.Rotation(angle, 4, "Z") @ Matrix.Rotation(tilt, 4, "X") @ Matrix.Rotation(0, 4, "Z")
    R = Matrix.Translation((HOUSE_R * math.cos(angle), HOUSE_R * math.sin(angle), 0)) @ Matrix.Rotation(angle, 4, "Z")
    roofs = [p for p in parts if p.name.startswith(("Roof", "Ridge", "Chimney"))]
    for p in roofs:
        p.matrix_basis = Matrix.Translation((0, 0, h)) @ Matrix.Rotation(tilt, 4, "X") @ Matrix.Translation((0, 0, -h)) @ p.matrix_basis
    place_parts(parts, R)
    for k in range(fence_from, len(FENCES)):
        x0, y0, x1, y1 = FENCES[k]
        a, b = R @ Vector((x0, y0, 0)), R @ Vector((x1, y1, 0))
        FENCES[k] = (round(a.x, 3), round(a.y, 3), round(b.x, 3), round(b.y, 3))
    door = R @ Vector((fx - 1.7, 0, 0))
    box_world = [(R @ Vector((x, y, 0))) for x, y in ((-d / 2 - 0.25, -w / 2 - 0.5), (d / 2 + 0.6, -w / 2 - 0.5), (d / 2 + 0.6, w / 2 + 0.5), (-d / 2 - 0.25, w / 2 + 0.5))]
    flower_spots = [R @ Vector((fx - 0.28, yy + o, 1.44)) for yy in (-1.65, 1.65) for o in (-0.38, 0.0, 0.38)]
    extras = []
    if i == 0:
        extras.append(R @ Vector((fx - 2.2, 1.4, 0)))
    if i == 4:
        extras.append(R @ Vector((fx - 2.0, -2.0, 0)))
    chimney = R @ Vector((0.7 + math.sin(ch_tilt) * 1.1, w / 2 - 1.1, ridge_z + 1.05))
    return {"door": door, "poly": box_world, "flowers": flower_spots, "angle": angle, "R": R, "extras": extras, "chimney": chimney}


# ------------------------------------------------------------------ props
def fountain():
    parts = [
        cyl("FountainBase", 2.3, 0.7, (0, 0, 0.35), mat("stone"), verts=32, bevel=0.1),
        cyl("FountainWater", 2.0, 0.08, (0, 0, 0.66), mat("water", emissive=0.25), verts=32),
        cyl("FountainPillar", 0.42, 1.5, (0, 0, 1.3), mat("stone"), verts=16, bevel=0.06),
        cyl("FountainBowl", 0.95, 0.35, (0, 0, 2.05), mat("stone"), verts=24, r2=1.15, bevel=0.06),
        cyl("FountainTopWater", 0.95, 0.06, (0, 0, 2.24), mat("water", emissive=0.4), verts=24),
        cyl("FountainCap", 0.22, 0.5, (0, 0, 2.45), mat("stone"), verts=12),
        cyl("FountainSpout", 0.1, 0.9, (0, 0, 2.95), mat("water", emissive=0.6), verts=10, r2=0.04),
    ]
    return parts


def lamp_post(x, y):
    COL["lamp_post"] = "#3d5a45"
    cyl("LampPost", 0.12, 2.5, (x, y, 1.25), mat("lamp_post"), verts=12)
    cyl("LampBase", 0.3, 0.35, (x, y, 0.18), mat("lamp_post"), verts=12, r2=0.22)
    cyl("LampGlow", 0.3, 0.55, (x, y, 2.75), mat("lamp_glow", emissive=6), verts=12, r2=0.36)
    cyl("LampHat", 0.48, 0.32, (x, y, 3.15), mat("lamp_post"), verts=12, r2=0.1)
    cyl("LampFinial", 0.08, 0.2, (x, y, 3.4), mat("lamp_glow", emissive=2), verts=8)


def bench(x, y, rot):
    R = Matrix.Translation((x, y, 0)) @ Matrix.Rotation(rot, 4, "Z")
    parts = [
        box("BenchSeat", (0.7, 2.1, 0.16), (0, 0, 0.55), mat("bench"), bevel=0.06),
        box("BenchBack", (0.14, 2.1, 0.6), (0.32, 0, 0.92), mat("bench"), bevel=0.06),
    ]
    for yy in (-0.85, 0.85):
        parts.append(box("BenchLeg", (0.55, 0.14, 0.5), (0.05, yy, 0.25), mat("lamp_post"), bevel=0.04))
    place_parts(parts, R)


# ------------------------------------------------------------------ foliage
NATURE = {}


def nature(name):
    if name in NATURE:
        return NATURE[name]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(QN, name + ".gltf"))
    new = [o for o in set(bpy.data.objects) - before]
    meshes = [o for o in new if o.type == "MESH"]
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    for o in new:
        if o.type != "MESH":
            bpy.data.objects.remove(o)
    for o in meshes:
        bpy.context.scene.collection.objects.unlink(o) if o.name in bpy.context.scene.collection.objects else None
        for c in o.users_collection:
            c.objects.unlink(o)
    NATURE[name] = meshes
    return meshes


def place(name, x, y, scale, rot=None, z=0.0):
    out = []
    for src in nature(name):
        o = src.copy()
        o.data = src.data
        bpy.context.scene.collection.objects.link(o)
        o.matrix_world = Matrix.Translation((x, y, z)) @ Matrix.Rotation(rot if rot is not None else rng.uniform(0, 6.28), 4, "Z") @ Matrix.Scale(scale, 4) @ src.matrix_world
        out.append(o)
    return out


def inside_poly(p, poly):
    x, y = p
    inside = False
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        if (a.y > y) != (b.y > y) and x < (b.x - a.x) * (y - a.y) / (b.y - a.y + 1e-9) + a.x:
            inside = not inside
    return inside


def build():
    reset()
    ground()
    angles = [math.radians(a) for a in (90, 150, 210, 270, 330, 30)]
    houses = [cottage(i, a) for i, a in enumerate(angles)]
    for h in houses:
        path_to(h["angle"], PLAZA_R - 0.3, HOUSE_R - 2.6)
    R1 = houses[1]["R"]
    a0, a1 = R1 @ Vector((-1.6, 3.4, 0)), R1 @ Vector((1.8, 6.6, 0))
    clothesline(a0.x, a0.y, a1.x, a1.y)
    fountain()
    colliders = {"circles": [{"x": 0, "y": 0, "r": 2.6}], "polys": [[[round(v.x, 3), round(v.y, 3)] for v in h["poly"]] for h in houses]}
    for h in houses:
        for e in h["extras"]:
            colliders["circles"].append({"x": round(e.x, 3), "y": round(e.y, 3), "r": 0.45})
    for e in (a0, a1):
        colliders["circles"].append({"x": round(e.x, 3), "y": round(e.y, 3), "r": 0.3})
    colliders["segments"] = [list(f) for f in FENCES]
    # lamps around the plaza, between paths
    for k in range(6):
        a = math.radians(60 * k)
        x, y = (PLAZA_R + 0.4) * math.cos(a), (PLAZA_R + 0.4) * math.sin(a)
        lamp_post(x, y)
        colliders["circles"].append({"x": round(x, 3), "y": round(y, 3), "r": 0.35})
    for k, a in enumerate((math.radians(0), math.radians(180))):
        bx, by = 4.6 * math.cos(a + 0.5), 4.6 * math.sin(a + 0.5)
        bench(bx, by, a + 0.5)
        colliders["circles"].append({"x": round(bx, 3), "y": round(by, 3), "r": 1.0})
    # flower boxes
    for h in houses:
        for p in h["flowers"]:
            place(rng.choice(["Flower_3_Group", "Flower_4_Group", "Bush_Common_Flowers"]), p.x, p.y, 0.32, z=p.z)
    # trees between cottages and around the rim
    tree_spots = []
    for k in range(6):
        a = math.radians(60 * k + 60) + rng.uniform(-0.12, 0.12)
        tree_spots.append((15.8 + rng.uniform(-0.6, 0.6), a))
    for k in range(10):
        tree_spots.append((18.6 + rng.uniform(-0.5, 0.5), rng.uniform(0, 2 * math.pi)))
    for r, a in tree_spots:
        x, y = r * math.cos(a), r * math.sin(a)
        if any(inside_poly((x, y), [Vector((v.x * 1.1, v.y * 1.1, 0)) for v in h["poly"]]) for h in houses):
            continue
        place(rng.choice(["CommonTree_1", "CommonTree_2", "CommonTree_3", "CommonTree_4"]), x, y, rng.uniform(0.36, 0.46))
        colliders["circles"].append({"x": round(x, 3), "y": round(y, 3), "r": 0.75})
    # bushes, flowers, grass on the green, kept off the plaza, paths and houses
    def free(x, y, pad=0.0):
        r = math.hypot(x, y)
        if r < PLAZA_R + 0.8 + pad or r > ISLAND_R - 1.0:
            return False
        a = math.atan2(y, x)
        for h in houses:
            if inside_poly((x, y), [Vector((v.x * 1.04, v.y * 1.04, 0)) for v in h["poly"]]):
                return False
            da = (a - h["angle"] + math.pi) % (2 * math.pi) - math.pi
            if abs(da) * r < 1.6 and r < HOUSE_R:
                return False
        return True

    placed = 0
    while placed < 70:
        r, a = rng.uniform(PLAZA_R + 1, ISLAND_R - 1.2), rng.uniform(0, 2 * math.pi)
        x, y = r * math.cos(a), r * math.sin(a)
        if not free(x, y):
            continue
        kind = rng.random()
        if kind < 0.22:
            place("Bush_Common_Flowers", x, y, rng.uniform(0.55, 0.8))
        elif kind < 0.32:
            place("Bush_Common", x, y, rng.uniform(0.55, 0.8))
        elif kind < 0.62:
            place(rng.choice(["Flower_3_Group", "Flower_4_Group"]), x, y, rng.uniform(0.5, 0.75))
        elif kind < 0.72:
            place(rng.choice(["Mushroom_Common", "Plant_1_Big", "Fern_1"]), x, y, rng.uniform(0.45, 0.7))
        else:
            place(rng.choice(["Grass_Common_Tall", "Grass_Common_Short", "Clover_1"]), x, y, rng.uniform(0.6, 0.9))
        placed += 1
    for k in range(28):
        a = rng.uniform(0, 2 * math.pi)
        r = PLAZA_R + rng.uniform(0.2, 0.7)
        x, y = r * math.cos(a), r * math.sin(a)
        if free(x, y, pad=-1.2):
            place(rng.choice(["Flower_3_Group", "Flower_4_Group", "Grass_Common_Short"]), x, y, rng.uniform(0.4, 0.55))

    spots = [{"x": round(h["door"].x, 3), "y": round(h["door"].y, 3), "face": round(h["angle"] + math.pi, 4), "house": i} for i, h in enumerate(houses)]
    for a in (math.radians(240 + 30), math.radians(60 + 30)):
        spots.append({"x": round(5.4 * math.cos(a), 3), "y": round(5.4 * math.sin(a), 3), "face": round(a + math.pi, 4), "house": None})
    meta = {
        "version": 1,
        "units": "blender z-up metres; three uses x=x, y=z, z=-y",
        "spawn": {"x": 0.0, "y": -6.2, "face": math.pi / 2},
        "walkRadius": WALK_R,
        "plazaRadius": PLAZA_R,
        "villagerSpots": spots,
        "colliders": colliders,
        "feature": {"x": 3.3, "y": -3.3},
        "chimneys": [[round(h["chimney"].x, 3), round(h["chimney"].y, 3), round(h["chimney"].z, 3)] for h in houses],
    }
    return meta


def join_by_material():
    groups = {}
    for o in list(bpy.context.scene.collection.objects):
        if o.type != "MESH":
            continue
        key = o.data.materials[0].name if o.data.materials else "none"
        groups.setdefault(key, []).append(o)
    for key, objs in groups.items():
        if len(objs) < 2:
            continue
        for o in objs:
            if o.data.users > 1:
                o.data = o.data.copy()
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        objs[0].name = "VIS_" + key


def export():
    for img in bpy.data.images:
        if img.size[0] > 512:
            img.scale(512, max(1, int(512 * img.size[1] / img.size[0])))
    path = os.path.join(OUT_DIR, "courtyard.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_apply=True, export_image_format="WEBP", export_image_quality=80)
    return path


def render(out):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = 1600, 900
    sc.view_settings.view_transform = "AgX"
    try:
        sc.view_settings.look = "AgX - Punchy"
    except TypeError:
        pass
    w = bpy.data.worlds.new("sky")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.80, 0.97, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.55
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.4
    sun.data.color = (1.0, 0.93, 0.82)
    sun.data.angle = math.radians(8)
    sun.rotation_euler = (math.radians(48), 0, math.radians(-40))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 35
    sc.collection.objects.link(cam)
    sc.camera = cam
    files = []
    for label, loc, tgt in (("overview", (0, -38, 30), (0, 0, -1)), ("player", (0, -14.5, 4.2), (0, 2, 1.6)), ("cottage", (-6, -6, 3.2), (-1, 10, 2.2))):
        cam.location = loc
        cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = os.path.join(out, f"courtyard-{label}.png")
        bpy.ops.render.render(write_still=True)
        files.append(sc.render.filepath)
    return files


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    meta = build()
    join_by_material()
    path = export()
    with open(os.path.join(OUT_DIR, "courtyard.json"), "w") as f:
        json.dump(meta, f, indent=1)
    report = {"glb": path, "bytes": os.path.getsize(path), "objects": len(bpy.context.scene.collection.objects)}
    if RENDER:
        os.makedirs(RENDER, exist_ok=True)
        report["renders"] = render(RENDER)
    print("COURTYARD_REPORT " + json.dumps(report))
