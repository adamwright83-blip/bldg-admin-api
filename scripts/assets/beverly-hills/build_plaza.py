"""Beverly Hills plaza (Blender 5.2, headless): Lantern City's commercial level.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python scripts/assets/beverly-hills/build_plaza.py -- [--render OUT_DIR]

A golden-hour Beverly Hills plaza: a grand hotel entrance (canopy, red carpet, brass stanchions and a velvet rope),
Spanish-revival boutiques with striped awnings and bougainvillea, a pink juice bar, a three-tier marble fountain
crowned by a gilded pom-pom poodle in sunglasses, tall Washingtonia palms, lamp posts and a street with a crosswalk.
Everything is modelled here (no third-party meshes). Surfaces are coloured by material name; the runtime adds the
CC0 Poly Haven detail textures (plaster, terracotta, limestone) and reflections. Signs are blank UV quads the runtime
paints, so the hotel carries the real prospect's name.

Units are metres (the Quaternius heroine is 1.775 m). Blender is Z-up; the glTF export is Y-up.
Outputs: client/public/assets/goldline/beverly-hills-3d/plaza.glb and plaza.json.
"""

import bmesh
import bpy
import json
import math
import os
import random
import sys

from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT_DIR = os.path.join(REPO, "client", "public", "assets", "goldline", "beverly-hills-3d")
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
RENDER = ARGV[ARGV.index("--render") + 1] if "--render" in ARGV else None
rng = random.Random(90210)

# material name -> (hex, roughness, metallic, emissive strength). The runtime keys its look off the prefix.
PALETTE = {
    "BH_plaster_cream": ("#f1e3cc", 0.9, 0.0, 0),
    "BH_plaster_blush": ("#f0cdbd", 0.9, 0.0, 0),
    "BH_plaster_sand": ("#e6cfa6", 0.9, 0.0, 0),
    "BH_plaster_pink": ("#f4b6c2", 0.88, 0.0, 0),
    "BH_trim_white": ("#fbf6ec", 0.7, 0.0, 0),
    "BH_roof_terracotta": ("#c8673f", 0.8, 0.0, 0),
    "BH_paving_limestone": ("#e8dcc5", 0.85, 0.0, 0),
    "BH_paving_inlay": ("#c9a77a", 0.8, 0.0, 0),
    "BH_sidewalk": ("#d9d2c4", 0.9, 0.0, 0),
    "BH_asphalt": ("#3b3a3f", 0.95, 0.0, 0),
    "BH_paint_white": ("#f7f4ee", 0.8, 0.0, 0),
    "BH_curb": ("#bfb7a8", 0.9, 0.0, 0),
    "BH_marble": ("#f6f2ec", 0.25, 0.0, 0),
    "BH_gold": ("#e8b54a", 0.22, 1.0, 0),
    "BH_brass": ("#c99a45", 0.3, 1.0, 0),
    "BH_iron": ("#1e1c1f", 0.55, 0.6, 0),
    "BH_glass_dark": ("#1d2a33", 0.08, 0.0, 0),
    "BH_glass_glow": ("#ffd59a", 0.3, 0.0, 1.6),
    "BH_lamp_glow": ("#ffdc96", 0.3, 0.0, 6.0),
    "BH_fabric_red": ("#9e1424", 0.75, 0.0, 0),
    "BH_fabric_black": ("#17161a", 0.7, 0.0, 0),
    "BH_awning_cream": ("#f5ecd8", 0.85, 0.0, 0),
    "BH_awning_green": ("#1f5c46", 0.85, 0.0, 0),
    "BH_awning_black": ("#1b1a1d", 0.85, 0.0, 0),
    "BH_awning_pink": ("#ee8aa6", 0.85, 0.0, 0),
    "BH_wood_door": ("#5a3420", 0.6, 0.0, 0),
    "BH_wood_light": ("#a77a52", 0.7, 0.0, 0),
    "BH_leaf_hedge": ("#3f6e35", 0.9, 0.0, 0),
    "BH_leaf_topiary": ("#4a7d3a", 0.9, 0.0, 0),
    "BH_palm_trunk": ("#8c6e52", 0.95, 0.0, 0),
    "BH_palm_skirt": ("#9a7a52", 0.95, 0.0, 0),
    "BH_palm_leaf": ("#4f8a3e", 0.8, 0.0, 0),
    "BH_bougain": ("#d6337f", 0.8, 0.0, 0),
    "BH_lavender": ("#8f79c9", 0.85, 0.0, 0),
    "BH_planter": ("#efe6d6", 0.8, 0.0, 0),
    "BH_water": ("#5fc1d6", 0.05, 0.0, 0),
    "BH_umbrella_pink": ("#f7a8b8", 0.8, 0.0, 0),
    "BH_umbrella_white": ("#fbf7ef", 0.8, 0.0, 0),
    "BH_menu_board": ("#26302b", 0.8, 0.0, 0),
    "BH_sign": ("#ffffff", 0.6, 0.0, 0),
}
MATS = {}


def srgb_to_linear(h):
    h = h.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)


def mat(name):
    if name in MATS:
        return MATS[name]
    hexc, rough, metal, emit = PALETTE[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*srgb_to_linear(hexc), 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if emit:
        p.inputs["Emission Color"].default_value = (*srgb_to_linear(hexc), 1)
        p.inputs["Emission Strength"].default_value = emit
    MATS[name] = m
    return m


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def obj_from_bm(name, bm, material, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat(material))
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def box(name, size, loc, material, bevel=0.0, rot_z=0.0, segments=1):
    bm = bmesh.new()
    v = bmesh.ops.create_cube(bm, size=1.0)["verts"]
    bmesh.ops.scale(bm, vec=size, verts=v)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segments, affect="EDGES", profile=0.5)
    ob = obj_from_bm(name, bm, material)
    ob.rotation_euler.z = rot_z
    ob.location = loc
    return ob


def cyl(name, r, depth, loc, material, verts=32, r2=None, smooth=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    ob = obj_from_bm(name, bm, material, smooth=smooth)
    ob.location = loc
    return ob


def sphere(name, r, loc, material, scale=(1, 1, 1), segs=16):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=max(6, segs // 2), radius=r)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    ob = obj_from_bm(name, bm, material, smooth=True)
    ob.location = loc
    return ob


def ring(name, r0, r1, depth, loc, material, verts=48):
    """A flat annulus with height (a basin rim)."""
    bm = bmesh.new()
    outer = bmesh.ops.create_circle(bm, cap_ends=False, segments=verts, radius=r1)["verts"]
    inner = bmesh.ops.create_circle(bm, cap_ends=False, segments=verts, radius=r0)["verts"]
    for i in range(verts):
        bm.faces.new((outer[i], outer[(i + 1) % verts], inner[(i + 1) % verts], inner[i]))
    top = list(bm.faces)
    ext = bmesh.ops.extrude_face_region(bm, geom=top)
    bmesh.ops.translate(bm, verts=[e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)], vec=(0, 0, depth))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = obj_from_bm(name, bm, material, smooth=True)
    ob.location = loc
    return ob


def quad_uv(name, w, h, loc, material, rot=(math.pi / 2, 0, 0)):
    """A UV-mapped plane (signs the runtime paints)."""
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5, calc_uvs=True)
    bmesh.ops.scale(bm, vec=(w, h, 1), verts=bm.verts)
    ob = obj_from_bm(name, bm, material)
    ob.location = loc
    ob.rotation_euler = rot
    return ob


# ------------------------------------------------------------------ layout (Blender XY; -Y is south, the street)
PLAZA_W, PLAZA_D = 44.0, 38.0
HOTEL_Y = 15.0            # hotel facade line (north)
SHOPS_X = -17.0           # boutique facade line (west)
JUICE_X = 16.0            # juice bar (east)
STREET_Y = -16.5          # curb line (south)

colliders = {"boxes": [], "circles": [], "rings": [], "platforms": []}
points = {}


def col_box(cx, cy, w, d, rot=0.0, tag=None):
    colliders["boxes"].append({"x": round(cx, 3), "y": round(cy, 3), "w": round(w, 3), "d": round(d, 3), "rot": round(rot, 4), **({"tag": tag} if tag else {})})


def col_circle(cx, cy, r, tag=None):
    colliders["circles"].append({"x": round(cx, 3), "y": round(cy, 3), "r": round(r, 3), **({"tag": tag} if tag else {})})


# ------------------------------------------------------------------ ground
def ground():
    # plaza paving: big limestone slabs as a grid of slightly bevelled tiles (reads as hand-laid stone at golden hour)
    tile = 1.5
    nx, ny = int(PLAZA_W / tile), int((HOTEL_Y - STREET_Y - 2.0) / tile)
    bm = bmesh.new()
    for i in range(nx):
        for j in range(ny):
            x = -PLAZA_W / 2 + (i + 0.5) * tile
            y = STREET_Y + 2.0 + (j + 0.5) * tile
            if math.hypot(x, y) < 5.6:  # the inlaid rosette around the fountain
                continue
            h = 0.02 + rng.random() * 0.012
            v = bmesh.ops.create_cube(bm, size=1.0)["verts"]
            bmesh.ops.scale(bm, vec=(tile - 0.04, tile - 0.04, h), verts=v)
            bmesh.ops.translate(bm, vec=(x, y, h / 2), verts=v)
    obj_from_bm("paving", bm, "BH_paving_limestone")
    box("paving_bed", (PLAZA_W + 6, HOTEL_Y - STREET_Y + 14, 0.2), (0, (HOTEL_Y + STREET_Y) / 2, -0.1), "BH_curb")
    # rosette: concentric inlay rings and a compass star
    ring("rosette_outer", 5.0, 5.6, 0.03, (0, 0, 0), "BH_paving_inlay", verts=64)
    ring("rosette_mid", 4.6, 5.0, 0.028, (0, 0, 0), "BH_paving_limestone", verts=64)
    bm = bmesh.new()
    for k in range(8):
        a = k * math.pi / 4
        long = 4.55 if k % 2 == 0 else 3.4
        p0 = Vector((math.cos(a) * long, math.sin(a) * long, 0.03))
        pl = Vector((math.cos(a + 0.22) * 2.6, math.sin(a + 0.22) * 2.6, 0.03))
        pr = Vector((math.cos(a - 0.22) * 2.6, math.sin(a - 0.22) * 2.6, 0.03))
        a_ = bm.verts.new(p0)
        b_ = bm.verts.new(pl)
        c_ = bm.verts.new(pr)
        bm.faces.new((a_, b_, c_))
    obj_from_bm("rosette_star", bm, "BH_paving_inlay")
    # street, sidewalk, curb, crosswalk
    box("sidewalk", (PLAZA_W + 6, 3.0, 0.16), (0, STREET_Y + 0.5, 0.06), "BH_sidewalk")
    box("curb", (PLAZA_W + 6, 0.3, 0.22), (0, STREET_Y - 1.0, 0.07), "BH_curb")
    box("street", (PLAZA_W + 6, 12.0, 0.1), (0, STREET_Y - 7.2, -0.05), "BH_asphalt")
    for k in range(9):
        box(f"crosswalk_{k}", (0.55, 5.2, 0.012), (-2.4 + k * 0.6, STREET_Y - 4.0, 0.006), "BH_paint_white")
    for k in range(-5, 6):
        box(f"laneline_{k}", (2.2, 0.14, 0.012), (k * 5.0, STREET_Y - 9.2, 0.006), "BH_paint_white")


# ------------------------------------------------------------------ architecture helpers
def window(x, y, z, w, h, facing, arched=False, glow=False, balcony=False, prefix="win"):
    """A recessed window in a facade on the plane y (facing=-1: faces -Y/south) or x (facing='x+'/'x-')."""
    glass = "BH_glass_glow" if glow else "BH_glass_dark"
    if facing in ("x+", "x-"):
        s = 1 if facing == "x+" else -1
        box(f"{prefix}_glass", (0.06, w, h), (x + s * 0.02, y, z), glass)
        box(f"{prefix}_sill", (0.24, w + 0.25, 0.1), (x + s * 0.1, y, z - h / 2 - 0.05), "BH_trim_white")
        box(f"{prefix}_frameL", (0.12, 0.1, h), (x + s * 0.05, y - w / 2 - 0.05, z), "BH_trim_white")
        box(f"{prefix}_frameR", (0.12, 0.1, h), (x + s * 0.05, y + w / 2 + 0.05, z), "BH_trim_white")
        if arched:
            arch(x + s * 0.03, y, z + h / 2, w / 2, "x", glass, prefix)
        else:
            box(f"{prefix}_head", (0.16, w + 0.3, 0.14), (x + s * 0.07, y, z + h / 2 + 0.07), "BH_trim_white")
        if balcony:
            iron_balcony(x + s * 0.45, y, z - h / 2, w + 0.5, "x")
        return
    s = facing
    box(f"{prefix}_glass", (w, 0.06, h), (x, y + s * 0.02, z), glass)
    box(f"{prefix}_sill", (w + 0.25, 0.24, 0.1), (x, y + s * 0.1, z - h / 2 - 0.05), "BH_trim_white")
    box(f"{prefix}_frameL", (0.1, 0.12, h), (x - w / 2 - 0.05, y + s * 0.05, z), "BH_trim_white")
    box(f"{prefix}_frameR", (0.1, 0.12, h), (x + w / 2 + 0.05, y + s * 0.05, z), "BH_trim_white")
    box(f"{prefix}_mullion", (0.05, 0.08, h), (x, y + s * 0.04, z), "BH_trim_white")
    if arched:
        arch(x, y + s * 0.03, z + h / 2, w / 2, "y", glass, prefix)
    else:
        box(f"{prefix}_head", (w + 0.3, 0.16, 0.14), (x, y + s * 0.07, z + h / 2 + 0.07), "BH_trim_white")
    if balcony:
        iron_balcony(x, y + s * 0.45, z - h / 2, w + 0.5, "y")


def arch(x, y, z, r, axis, glass, prefix):
    """A half-disc of glass with a white archivolt."""
    bm = bmesh.new()
    n = 14
    c = bm.verts.new((0, 0, 0))
    rim = [bm.verts.new((math.cos(math.pi * i / n) * r, 0, math.sin(math.pi * i / n) * r)) for i in range(n + 1)]
    for i in range(n):
        bm.faces.new((c, rim[i], rim[i + 1]))
    ob = obj_from_bm(f"{prefix}_arch", bm, glass)
    ob.location = (x, y, z)
    if axis == "x":
        ob.rotation_euler.z = math.pi / 2
    # archivolt: a ring of small boxes
    for i in range(n + 1):
        a = math.pi * i / n
        px, pz = math.cos(a) * (r + 0.07), math.sin(a) * (r + 0.07)
        b = box(f"{prefix}_archv{i}", (0.16, 0.14, 0.12), (0, 0, 0), "BH_trim_white")
        b.rotation_euler.y = -a
        if axis == "x":
            b.location = (x, y + px, z + pz)
            b.rotation_euler = (a - math.pi / 2, 0, math.pi / 2)
        else:
            b.location = (x + px, y, z + pz)


def iron_balcony(x, y, z, w, axis):
    if axis == "y":
        box("bal_floor", (w, 0.7, 0.08), (x, y, z), "BH_trim_white")
        box("bal_rail", (w, 0.05, 0.05), (x, y + 0.32 * (1 if y > 0 else -1) * 0 - 0.32, z + 0.95), "BH_iron")
        for k in range(int(w / 0.14)):
            box("bal_bar", (0.025, 0.025, 0.9), (x - w / 2 + 0.07 + k * 0.14, y - 0.32, z + 0.48), "BH_iron")
    else:
        box("bal_floor", (0.7, w, 0.08), (x, y, z), "BH_trim_white")
        box("bal_rail", (0.05, w, 0.05), (x + (0.32 if x > 0 else -0.32) * -1, y, z + 0.95), "BH_iron")
        for k in range(int(w / 0.14)):
            box("bal_bar", (0.025, 0.025, 0.9), (x + (0.32 if x > 0 else -0.32) * -1, y - w / 2 + 0.07 + k * 0.14, z + 0.48), "BH_iron")


def terracotta_roof(cx, cy, w, d, h, axis="x"):
    """A low hipped roof made of tile courses (ridged rows read as Spanish barrel tile)."""
    rows = 9
    for k in range(rows):
        t = k / rows
        rw = w * (1 - t * 0.8) + 0.4
        rd = d * (1 - t * 0.8) + 0.4
        box("roof_course", (rw, rd, h / rows), (cx, cy, h / rows * (k + 0.5)), "BH_roof_terracotta", bevel=0.04)


def bougainvillea(x, y, z, spread, density=90, facing=-1, axis="y"):
    """Clusters of magenta bracts spilling over a wall."""
    bm = bmesh.new()
    for _ in range(density):
        dx = (rng.random() - 0.5) * spread
        dz = -abs(rng.gauss(0, spread * 0.35))
        s = 0.1 + rng.random() * 0.12
        if axis == "y":
            p = Vector((x + dx, y + facing * (0.12 + rng.random() * 0.3), z + dz))
        else:
            p = Vector((x + facing * (0.12 + rng.random() * 0.3), y + dx, z + dz))
        v = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=s)["verts"]
        bmesh.ops.translate(bm, vec=p, verts=v)
    obj_from_bm("bougain", bm, "BH_bougain", smooth=False)
    # a few leafy clumps behind the blossoms
    bm = bmesh.new()
    for _ in range(density // 3):
        dx = (rng.random() - 0.5) * spread
        dz = -abs(rng.gauss(0, spread * 0.3))
        p = Vector((x + dx, y + facing * 0.1, z + dz)) if axis == "y" else Vector((x + facing * 0.1, y + dx, z + dz))
        v = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.16 + rng.random() * 0.1)["verts"]
        bmesh.ops.translate(bm, vec=p, verts=v)
    obj_from_bm("bougain_leaf", bm, "BH_leaf_hedge", smooth=False)


def topiary(x, y, kind="ball", scale=1.0):
    cyl("planter", 0.42 * scale, 0.6 * scale, (x, y, 0.3 * scale), "BH_planter", verts=20, r2=0.5 * scale)
    if kind == "ball":
        cyl("topi_stem", 0.04, 0.9 * scale, (x, y, 0.95 * scale), "BH_wood_light", verts=8)
        sphere("topi_ball", 0.5 * scale, (x, y, 1.55 * scale), "BH_leaf_topiary", segs=14)
    else:
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.45 * scale, radius2=0.0, depth=1.6 * scale)
        ob = obj_from_bm("topi_cone", bm, "BH_leaf_topiary", smooth=True)
        ob.location = (x, y, 1.4 * scale)
    col_circle(x, y, 0.5 * scale)


def lamp(x, y):
    cyl("lamp_base", 0.18, 0.4, (x, y, 0.2), "BH_iron", verts=12, r2=0.12)
    cyl("lamp_post", 0.06, 3.4, (x, y, 2.0), "BH_iron", verts=10)
    for k, a in enumerate((0, math.pi)):
        ax = x + math.cos(a) * 0.38
        box("lamp_arm", (0.42, 0.04, 0.04), (x + math.cos(a) * 0.19, y, 3.55), "BH_iron")
        cyl("lamp_cap", 0.16, 0.08, (ax, y, 3.72), "BH_iron", verts=8, r2=0.05)
        cyl("lamp_globe", 0.14, 0.34, (ax, y, 3.5), "BH_lamp_glow", verts=10, r2=0.11)
    col_circle(x, y, 0.22)
    points.setdefault("lamps", []).append([round(x, 2), round(y, 2), 3.5])


def palm(x, y, height, lean=0.0, lean_dir=0.0, skirt=True):
    """A Washingtonia: tall slender trunk with growth rings, a dead-frond skirt and a crown of drooping fronds."""
    segs = 14
    top = None
    bm = bmesh.new()
    for i in range(segs):
        t0, t1 = i / segs, (i + 1) / segs
        bend = lean * (t0 ** 1.8)
        r0 = 0.24 - 0.07 * t0
        c = Vector((x + math.cos(lean_dir) * bend, y + math.sin(lean_dir) * bend, t0 * height))
        v = bmesh.ops.create_cone(bm, cap_ends=False, segments=10, radius1=r0 * (1.04 if i % 2 else 1.0), radius2=r0 * 0.96, depth=height / segs)["verts"]
        bmesh.ops.translate(bm, vec=c + Vector((0, 0, height / segs / 2)), verts=v)
        top = c + Vector((0, 0, height / segs))
    obj_from_bm("palm_trunk", bm, "BH_palm_trunk", smooth=True)
    tx, ty, tz = top
    if skirt:
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.42, radius2=0.26, depth=1.4)
        bmesh.ops.translate(bm, vec=(tx, ty, tz - 0.55), verts=bm.verts)
        obj_from_bm("palm_skirt", bm, "BH_palm_skirt", smooth=True)
    # fronds: a ribbon along a drooping spine; leaflet edges zig-zag so the silhouette reads as a palm
    bm = bmesh.new()
    n = 15
    for k in range(n):
        a = k / n * math.tau + rng.random() * 0.3
        up = 0.55 - (k % 3) * 0.35 + rng.random() * 0.2
        length = 2.3 + rng.random() * 0.6
        steps = 9
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-d.y, d.x, 0))
        prev = None
        for s in range(steps + 1):
            t = s / steps
            p = Vector((tx, ty, tz + 0.15)) + d * (t * length) + Vector((0, 0, up * t * length * 0.6 - 1.25 * t * t * length * 0.55))
            w = math.sin(math.pi * min(1, t * 1.15)) * (0.42 if s % 2 else 0.3)
            l = bm.verts.new(p + side * w)
            r = bm.verts.new(p - side * w)
            c = bm.verts.new(p + Vector((0, 0, 0.04)))
            if prev:
                bm.faces.new((prev[0], prev[2], c, l))
                bm.faces.new((prev[2], prev[1], r, c))
            prev = (l, r, c)
    obj_from_bm("palm_crown", bm, "BH_palm_leaf", smooth=False)
    col_circle(x, y, 0.32)
    points.setdefault("palms", []).append([round(x, 2), round(y, 2), round(height, 2)])


# ------------------------------------------------------------------ the hotel (the commercial property)
def hotel():
    y = HOTEL_Y
    w, h = 30.0, 13.5
    # main block, with a darker base course and stacked cornices
    box("hotel_block", (w, 6.0, h), (0, y + 3.0, h / 2), "BH_plaster_cream")
    col_box(0, y + 3.0, w, 6.0)
    box("hotel_base", (w + 0.2, 6.2, 1.1), (0, y + 3.0, 0.55), "BH_plaster_sand")
    for k, (dz, dd) in enumerate(((h - 0.2, 0.5), (h + 0.05, 0.7), (h + 0.3, 0.9))):
        box(f"hotel_cornice{k}", (w + dd, 6.0 + dd, 0.25), (0, y + 3.0, dz), "BH_trim_white")
    box("hotel_belt", (w + 0.3, 6.3, 0.22), (0, y + 3.0, 4.6), "BH_trim_white")
    terracotta_roof(0, y + 3.0, w + 0.6, 6.6, 2.0)
    bpy.data.objects["roof_course"].location.z += h + 0.4  # first course only; shift the stack below
    for o in [o for o in bpy.data.objects if o.name.startswith("roof_course")]:
        if o.location.z < h:
            o.location.z += h + 0.4
    # pilasters between bays
    bays = [-12.5, -8.5, -4.5, 4.5, 8.5, 12.5]
    for bx in (-14.6, -10.5, -6.5, -2.4, 2.4, 6.5, 10.5, 14.6):
        box("pilaster", (0.5, 0.3, h - 1.2), (bx, y - 0.05, (h - 1.2) / 2 + 0.6), "BH_trim_white")
    for bx in bays:
        window(bx, y - 0.02, 2.4, 2.0, 2.6, -1, arched=True, glow=True, prefix="hotel_gw")
        for fz in (6.4, 9.6):
            window(bx, y - 0.02, fz, 1.5, 2.0, -1, arched=False, glow=False, balcony=True, prefix="hotel_uw")
    # the grand entrance: tall arch, doors, steps, canopy on brass poles
    box("entry_recess", (4.2, 0.5, 5.2), (0, y - 0.1, 2.6), "BH_plaster_sand")
    arch(0, y - 0.36, 4.6, 2.1, "y", "BH_glass_glow", "entry")
    box("entry_door_l", (1.5, 0.12, 3.6), (-0.8, y - 0.38, 1.8), "BH_wood_door", bevel=0.03)
    box("entry_door_r", (1.5, 0.12, 3.6), (0.8, y - 0.38, 1.8), "BH_wood_door", bevel=0.03)
    for dx in (-0.12, 0.12):
        cyl("door_handle", 0.03, 0.9, (dx, y - 0.48, 1.6), "BH_brass", verts=8)
    for k in range(3):
        box(f"entry_step{k}", (7.0 - k * 0.8, 1.0 - k * 0.2, 0.18), (0, y - 0.8 - (2 - k) * 0.45, 0.09 + k * 0.18), "BH_marble", bevel=0.02)
    # canopy
    box("canopy", (6.4, 4.6, 0.32), (0, y - 2.6, 4.3), "BH_fabric_black", bevel=0.04)
    box("canopy_trim", (6.5, 4.7, 0.08), (0, y - 2.6, 4.12), "BH_brass")
    for cx in (-3.0, 3.0):
        cyl("canopy_pole", 0.07, 4.2, (cx, y - 4.7, 2.1), "BH_brass", verts=12)
        col_circle(cx, y - 4.7, 0.15)
    # the sign above the entrance: painted with the real prospect's name at runtime
    quad_uv("SIGN_HOTEL", 6.0, 1.0, (0, y - 0.32, 5.85), "BH_sign")
    # red carpet down the steps and out across the plaza
    box("CARPET", (2.6, 8.4, 0.03), (0, y - 5.4, 0.035), "BH_fabric_red")
    # brass stanchions with velvet rope along both sides; the GATE rope crosses the carpet (it drops when you're in)
    posts = []
    for side in (-1, 1):
        for k in range(5):
            py = y - 2.0 - k * 1.7
            px = side * 1.75
            cyl("stanchion", 0.05, 1.0, (px, py, 0.5), "BH_brass", verts=12)
            cyl("stanchion_base", 0.18, 0.06, (px, py, 0.03), "BH_brass", verts=16)
            sphere("stanchion_knob", 0.07, (px, py, 1.03), "BH_brass")
            posts.append((px, py))
            col_circle(px, py, 0.18, tag="stanchion")
        for k in range(4):
            a = Vector((side * 1.75, y - 2.0 - k * 1.7, 0.95))
            b = Vector((side * 1.75, y - 2.0 - (k + 1) * 1.7, 0.95))
            rope(a, b, f"rope_side_{side}_{k}")
    gate_y = y - 2.0 - 4 * 1.7
    rope(Vector((-1.75, gate_y, 0.95)), Vector((1.75, gate_y, 0.95)), "ROPE_GATE", sag=0.32)
    col_box(0, gate_y, 3.5, 0.3, tag="rope_gate")
    # topiaries flanking the entrance, hedges along the base
    for sx in (-4.2, 4.2):
        topiary(sx, y - 1.4, "cone", 1.25)
    for sx in (-7.8, 7.8):
        topiary(sx, y - 1.1, "ball", 1.1)
    for side in (-1, 1):
        box("hotel_hedge", (8.5, 0.8, 0.9), (side * 10.6, y - 0.6, 0.45), "BH_leaf_hedge", bevel=0.25, segments=3)
        col_box(side * 10.6, y - 0.6, 8.5, 0.8)
    bougainvillea(-12.5, y - 0.1, 5.4, 3.4, 120)
    bougainvillea(12.5, y - 0.1, 5.4, 3.4, 120)
    points["hotel"] = {"door": [0, round(y - 1.2, 2)], "gate": [0, round(gate_y, 2)], "doorman": [2.6, round(gate_y + 0.9, 2)],
                       "sign": [0, round(y - 0.32, 2), 5.85], "carpetStart": [0, round(gate_y - 0.6, 2)]}


def rope(a, b, name, sag=0.22):
    bm = bmesh.new()
    n = 10
    prev = None
    for i in range(n + 1):
        t = i / n
        p = a.lerp(b, t) + Vector((0, 0, -sag * math.sin(math.pi * t)))
        v = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.05)["verts"]
        bmesh.ops.translate(bm, vec=p, verts=v)
        if prev is not None:
            mid = (prev + p) / 2
            d = (p - prev)
            v = bmesh.ops.create_cone(bm, cap_ends=False, segments=6, radius1=0.045, radius2=0.045, depth=d.length)["verts"]
            rot = d.to_track_quat("Z", "Y").to_matrix().to_4x4()
            bmesh.ops.transform(bm, matrix=rot, verts=v)
            bmesh.ops.translate(bm, vec=mid, verts=v)
        prev = p
    return obj_from_bm(name, bm, "BH_fabric_red", smooth=True)


# ------------------------------------------------------------------ boutiques (west) and juice bar (east)
def boutiques():
    x = SHOPS_X
    fronts = [(-7.0, "BH_plaster_blush", "BH_awning_black", "SIGN_SHOP_A"), (2.0, "BH_plaster_cream", "BH_awning_green", "SIGN_SHOP_B"),
              (10.0, "BH_plaster_sand", "BH_awning_black", "SIGN_SHOP_C")]
    for cy, wall, stripe, sign in fronts:
        d, h = 8.0, 8.5
        box("shop_block", (6.0, d, h), (x - 3.0, cy, h / 2), wall)
        col_box(x - 3.0, cy, 6.0, d)
        box("shop_cornice", (6.4, d + 0.3, 0.3), (x - 3.0, cy, h), "BH_trim_white")
        box("shop_parapet", (6.0, d, 0.7), (x - 3.0, cy, h + 0.5), wall)
        terracotta_roof(x - 3.0, cy, 5.6, d - 0.6, 1.2)
        for o in [o for o in bpy.data.objects if o.name.startswith("roof_course") and o.location.z < 2.0 and abs(o.location.y - cy) < 0.1]:
            o.location.z += h + 0.85
        # display windows (glowing) with an arched door between
        for wy in (cy - 2.4, cy + 2.4):
            window(x + 0.02, wy, 1.9, 2.4, 2.6, "x+", arched=True, glow=True, prefix="shop_win")
        box("shop_door", (0.1, 1.3, 2.6), (x + 0.03, cy, 1.3), "BH_wood_door")
        arch(x + 0.04, cy, 2.6, 0.65, "x", "BH_glass_glow", "shop_door_arch")
        window(x + 0.02, cy - 2.0, 5.6, 1.4, 1.7, "x+", balcony=True, prefix="shop_up")
        window(x + 0.02, cy + 2.0, 5.6, 1.4, 1.7, "x+", balcony=True, prefix="shop_up")
        # striped scalloped awning, sloping out over the sidewalk
        n = 12
        for k in range(n):
            yy = cy - 3.6 + (k + 0.5) * 7.2 / n
            o = box("awning", (1.8, 7.2 / n + 0.005, 0.05), (x + 0.85, yy, 3.65), stripe if k % 2 else "BH_awning_cream")
            o.rotation_euler.y = math.radians(-20)
            v = box("awning_val", (0.05, 7.2 / n, 0.32), (x + 1.7, yy, 3.17), stripe if k % 2 else "BH_awning_cream")
        quad_uv(sign, 3.6, 0.7, (x + 0.06, cy, 4.55), "BH_sign", rot=(math.pi / 2, 0, math.pi / 2))
        bougainvillea(x + 0.1, cy + (2.8 if cy < 5 else -2.8), 7.6, 2.2, 70, facing=1, axis="x")
        topiary(x + 1.4, cy - 3.9, "ball", 0.9)


def juice_bar():
    x, cy = JUICE_X, 2.0
    d, h = 9.0, 6.2
    box("juice_block", (6.0, d, h), (x + 3.0, cy, h / 2), "BH_plaster_pink")
    col_box(x + 3.0, cy, 6.0, d)
    box("juice_cornice", (6.3, d + 0.3, 0.3), (x + 3.0, cy, h), "BH_trim_white")
    box("juice_scallop", (6.0, d, 0.9), (x + 3.0, cy, h + 0.5), "BH_plaster_pink")
    # service window + counter
    box("juice_window", (0.06, 4.6, 1.9), (x - 0.02, cy, 2.25), "BH_glass_glow")
    box("juice_counter", (1.0, 5.2, 1.05), (x - 0.4, cy, 0.53), "BH_trim_white", bevel=0.04)
    box("juice_countertop", (1.2, 5.4, 0.08), (x - 0.45, cy, 1.09), "BH_marble")
    col_box(x - 0.4, cy, 1.0, 5.2)
    n = 10
    for k in range(n):
        yy = cy - 3.0 + (k + 0.5) * 6.0 / n
        o = box("juice_awning", (1.6, 6.0 / n + 0.005, 0.05), (x - 0.75, yy, 3.75), "BH_awning_pink" if k % 2 else "BH_awning_cream")
        o.rotation_euler.y = math.radians(20)
        box("juice_val", (0.05, 6.0 / n, 0.3), (x - 1.5, yy, 3.33), "BH_awning_pink" if k % 2 else "BH_awning_cream")
    quad_uv("SIGN_JUICE", 4.4, 0.9, (x - 0.06, cy, 4.75), "BH_sign", rot=(math.pi / 2, 0, -math.pi / 2))
    # menu board, cups, fruit
    box("menu_board", (0.08, 1.2, 1.6), (x - 0.02, cy + 3.6, 2.3), "BH_menu_board")
    for k in range(6):
        cyl("cup", 0.06, 0.16, (x - 0.55, cy - 1.6 + k * 0.6, 1.21), "BH_umbrella_white", verts=10, r2=0.075)
    # cafe tables with pink umbrellas
    for tx, ty in ((x - 4.5, cy - 5.5), (x - 6.5, cy + 6.2), (x - 3.2, cy + 7.6)):
        cyl("table_top", 0.5, 0.05, (tx, ty, 0.75), "BH_marble", verts=20)
        cyl("table_leg", 0.04, 0.75, (tx, ty, 0.37), "BH_brass", verts=8)
        cyl("umbrella_pole", 0.03, 2.4, (tx, ty, 1.5), "BH_trim_white", verts=8)
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=False, segments=8, radius1=1.4, radius2=0.05, depth=0.5)
        ob = obj_from_bm("umbrella", bm, "BH_umbrella_pink", smooth=False)
        ob.location = (tx, ty, 2.55)
        for c in range(2):
            a = c * math.pi + 0.6
            cyl("chair_seat", 0.22, 0.05, (tx + math.cos(a) * 0.85, ty + math.sin(a) * 0.85, 0.45), "BH_iron", verts=12)
        col_circle(tx, ty, 0.7)
    # the queue: three influencer spots facing the counter, each phone points back at its owner (selfie)
    points["juice"] = {"barista": [round(x + 0.8, 2), cy], "counter": [round(x - 1.4, 2), cy],
                       "queue": [[round(x - 2.6, 2), round(cy - 1.2, 2)], [round(x - 4.4, 2), round(cy - 1.0, 2)], [round(x - 6.2, 2), round(cy - 1.3, 2)]],
                       "sign": [round(x - 0.06, 2), cy, 4.75]}


# ------------------------------------------------------------------ the fountain with the golden poodle
def fountain():
    ring("basin_rim", 3.8, 4.25, 0.62, (0, 0, 0), "BH_marble", verts=64)
    cyl("basin_floor", 3.8, 0.25, (0, 0, 0.125), "BH_marble", verts=64)
    cyl("WATER_BASIN", 3.78, 0.02, (0, 0, 0.46), "BH_water", verts=64)
    # tiers (standable platforms; the poodle's sunglasses are reached by hopping up them)
    cyl("tier1_body", 1.9, 1.2, (0, 0, 0.6), "BH_marble", verts=48, r2=1.6)
    ring("tier1_lip", 1.7, 1.95, 0.12, (0, 0, 1.1), "BH_marble", verts=48)
    cyl("WATER_T1", 1.72, 0.02, (0, 0, 1.15), "BH_water", verts=48)
    cyl("tier2_body", 1.1, 1.0, (0, 0, 1.7), "BH_marble", verts=40, r2=0.9)
    ring("tier2_lip", 0.95, 1.15, 0.1, (0, 0, 2.12), "BH_marble", verts=40)
    cyl("WATER_T2", 0.96, 0.02, (0, 0, 2.16), "BH_water", verts=40)
    cyl("pedestal", 0.55, 0.8, (0, 0, 2.6), "BH_marble", verts=24, r2=0.45)
    cyl("pedestal_cap", 0.62, 0.12, (0, 0, 3.02), "BH_gold", verts=24)
    colliders["rings"].append({"x": 0, "y": 0, "r0": 3.8, "r1": 4.25, "top": 0.62})
    colliders["platforms"] += [{"x": 0, "y": 0, "r": 3.8, "top": 0.27, "water": 0.46}, {"x": 0, "y": 0, "r": 1.9, "top": 1.2, "water": 1.16},
                               {"x": 0, "y": 0, "r": 1.12, "top": 2.2, "water": 2.17}, {"x": 0, "y": 0, "r": 0.6, "top": 3.08}]
    poodle(0, 0, 3.08)


def poodle(x, y, z):
    """A gilded pom-pom poodle, posing, in oversized black sunglasses (the SHADES are picked up in the game)."""
    g = "BH_gold"
    sphere("poodle_body", 0.34, (x, y, z + 0.62), g, scale=(0.8, 1.25, 0.9))
    sphere("poodle_chest", 0.32, (x, y - 0.32, z + 0.75), g)
    for lx, ly in ((-0.16, -0.32), (0.16, -0.32), (-0.16, 0.32), (0.16, 0.32)):
        cyl("poodle_leg", 0.06, 0.42, (x + lx, y + ly, z + 0.21), g, verts=10)
        sphere("poodle_pom", 0.11, (x + lx, y + ly, z + 0.12), g)
    sphere("poodle_neck", 0.16, (x, y - 0.42, z + 1.0), g)
    sphere("poodle_head", 0.21, (x, y - 0.52, z + 1.22), g)
    sphere("poodle_topknot", 0.17, (x, y - 0.5, z + 1.44), g)
    sphere("poodle_snout", 0.1, (x, y - 0.72, z + 1.17), g, scale=(0.9, 1.4, 0.85))
    for ex in (-0.2, 0.2):
        sphere("poodle_ear", 0.12, (x + ex, y - 0.48, z + 1.1), g, scale=(0.8, 0.9, 1.4))
    cyl("poodle_tail", 0.035, 0.32, (x, y + 0.48, z + 0.86), g, verts=8)
    sphere("poodle_tailpom", 0.12, (x, y + 0.52, z + 1.04), g)
    # SHADES: a separate object so the runtime can lift them off the statue
    bm = bmesh.new()
    for ex in (-0.085, 0.085):
        v = bmesh.ops.create_cylinder if False else None
        c = bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.075, radius2=0.075, depth=0.02)["verts"]
        bmesh.ops.rotate(bm, verts=c, cent=(0, 0, 0), matrix=Vector((1, 0, 0)).to_track_quat("Z", "Y").to_matrix().to_4x4() if False else __import__("mathutils").Matrix.Rotation(math.pi / 2, 4, "X"))
        bmesh.ops.translate(bm, vec=(ex, 0, 0), verts=c)
    v = bmesh.ops.create_cube(bm, size=1.0)["verts"]
    bmesh.ops.scale(bm, vec=(0.06, 0.02, 0.018), verts=v)
    bmesh.ops.translate(bm, vec=(0, 0, 0.02), verts=v)
    for ex in (-0.17, 0.17):
        v = bmesh.ops.create_cube(bm, size=1.0)["verts"]
        bmesh.ops.scale(bm, vec=(0.012, 0.16, 0.014), verts=v)
        bmesh.ops.translate(bm, vec=(ex, 0.08, 0.02), verts=v)
    sh = obj_from_bm("SHADES", bm, "BH_iron", smooth=True)
    sh.location = (x, y - 0.78, z + 1.27)
    points["shades"] = [x, y, round(z + 1.27, 2)]


# ------------------------------------------------------------------ street dressing
def street():
    for k, px in enumerate((-19.0, -13.0, -6.5, 6.5, 13.0, 19.0)):
        palm(px, STREET_Y + 0.6, 12.5 + rng.random() * 3.5, lean=0.5 + rng.random() * 0.7, lean_dir=rng.random() * math.tau)
    for px, py in ((-9.0, 8.5), (9.0, 8.5), (-11.0, -8.5), (10.5, -9.0)):
        palm(px, py, 9.5 + rng.random() * 2.5, lean=0.4, lean_dir=rng.random() * math.tau)
        ring("palm_bed", 0.6, 1.1, 0.3, (px, py, 0), "BH_planter", verts=24)
        cyl("palm_soil", 0.62, 0.26, (px, py, 0.13), "BH_leaf_hedge", verts=24)
        for k in range(14):
            a = k / 14 * math.tau
            sphere("palm_flower", 0.12, (px + math.cos(a) * 0.85, py + math.sin(a) * 0.85, 0.36), "BH_lavender" if k % 2 else "BH_bougain", segs=8)
        col_circle(px, py, 1.15)
    for lx, ly in ((-6.0, -12.0), (6.0, -12.0), (-12.0, 4.0), (12.5, 9.5), (-5.0, 10.0), (5.0, 10.0)):
        lamp(lx, ly)
    # benches facing the fountain
    for a in (math.radians(200), math.radians(-20), math.radians(250), math.radians(-70)):
        bx, by = math.cos(a) * 7.2, math.sin(a) * 7.2
        b = box("bench_seat", (2.0, 0.55, 0.08), (bx, by, 0.48), "BH_wood_light", bevel=0.02)
        b.rotation_euler.z = a + math.pi / 2
        bk = box("bench_back", (2.0, 0.06, 0.5), (bx + math.cos(a) * 0.3, by + math.sin(a) * 0.3, 0.8), "BH_wood_light", bevel=0.02)
        bk.rotation_euler.z = a + math.pi / 2
        for s in (-0.85, 0.85):
            lx = bx + math.cos(a + math.pi / 2) * s
            ly = by + math.sin(a + math.pi / 2) * s
            box("bench_leg", (0.08, 0.5, 0.46), (lx, ly, 0.23), "BH_iron").rotation_euler.z = a + math.pi / 2
        col_circle(bx, by, 0.9)
    points["cars"] = []


def build():
    ground()
    hotel()
    boutiques()
    juice_bar()
    fountain()
    street()
    # the pug's lap around the fountain, and where the heroine arrives (from the street, looking up the red carpet)
    points["pugLoop"] = {"x": 0, "y": 0, "r": 5.4}
    points["spawn"] = [0, round(STREET_Y + 3.4, 2), 0]
    bounds = {"minX": -PLAZA_W / 2 + 1.0, "maxX": PLAZA_W / 2 - 1.0, "minY": STREET_Y + 0.4, "maxY": HOTEL_Y - 0.3}
    return {"units": "metres", "up": "Blender Z (glTF Y)", "colliders": colliders, "points": points, "bounds": bounds}


KEEP_SEPARATE = ("SIGN_", "ROPE_GATE", "SHADES", "CARPET", "WATER_")


def join_by_material():
    groups = {}
    for o in list(bpy.context.scene.collection.objects):
        if o.type != "MESH" or o.name.startswith(KEEP_SEPARATE):
            continue
        key = o.data.materials[0].name if o.data.materials else "none"
        groups.setdefault(key, []).append(o)
    for key, objs in groups.items():
        if len(objs) < 2:
            objs[0].name = "VIS_" + key
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
    path = os.path.join(OUT_DIR, "plaza.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_apply=True,
                              export_materials="EXPORT", export_meshopt_compression_enable=False)
    return path


def render(out):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = 1600, 900
    sc.view_settings.view_transform = "AgX"
    w = bpy.data.worlds.new("sky")
    sc.world = w
    w.use_nodes = True
    hdr = os.path.expanduser("~/Desktop/lantern-city-commercial-game/coastal-proof-sources/polyhaven/hdri/belfast_sunset_puresky_2k.hdr")
    if os.path.exists(hdr):
        env = w.node_tree.nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(hdr)
        w.node_tree.links.new(env.outputs["Color"], w.node_tree.nodes["Background"].inputs["Color"])
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4.0
    sun.data.color = (1.0, 0.82, 0.62)
    sun.rotation_euler = (math.radians(68), 0, math.radians(-120))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 28
    sc.collection.objects.link(cam)
    sc.camera = cam
    files = []
    for label, loc, tgt in (("overview", (0, -40, 26), (0, 2, 0)), ("player", (0, -10, 3.2), (0, 6, 2.2)), ("juice", (3, -6, 2.4), (15, 3, 2.0))):
        cam.location = loc
        cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = os.path.join(out, f"plaza-{label}.png")
        bpy.ops.render.render(write_still=True)
        files.append(sc.render.filepath)
    return files


if __name__ == "__main__":
    reset()
    os.makedirs(OUT_DIR, exist_ok=True)
    meta = build()
    join_by_material()
    path = export()
    with open(os.path.join(OUT_DIR, "plaza.json"), "w") as f:
        json.dump(meta, f, indent=1)
    report = {"glb": path, "bytes": os.path.getsize(path), "objects": len(bpy.context.scene.collection.objects)}
    if RENDER:
        os.makedirs(RENDER, exist_ok=True)
        report["renders"] = render(RENDER)
    print("PLAZA_REPORT " + json.dumps(report))
