"""Coastal Market proof: Trailblazer (v2 canon + the two changes Adam approved on 2026-09-23).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python scripts/assets/coastal-proof/build_trailblazer.py -- [--sources ~/Desktop/coastal-proof-sources] [--render out_prefix]

Built ON the CC0 Quaternius Superhero_Female_FullBody base (65-bone skeleton shared with the
animation library). Canon: ~/Desktop/coastal-proof-refs/trailblazer-v2-*.png. Sides below are
HER left/right; the base faces -Y, so her left is +X.

- cream cropped sleeveless top, laced V front, olive side panels, leather shoulder straps with brass buckles
- crossbody leather strap from her RIGHT shoulder to a brown satchel on her LEFT hip (satchel swings)
- bird/phoenix tattoo on her RIGHT upper arm and shoulder (a decal)
- riveted dark leather bracer on her LEFT forearm
- olive distressed denim short shorts, wide belt with pouches
- red patterned bandana at her RIGHT hip (3-bone chain, springs in three.js)
- holster-style pouch on the belt at the RIGHT hip, next to the bandana  (approved change 1: no thigh straps)
- tall brown buckled boots with tassels, olive socks folded over the tops
- black hair in ONE high bun at the crown, brown leather tie, loose face-framing strands  (approved change 2)

Garments are copies of body regions pushed out along the normals, so they keep the body's skin
weights exactly and deform with it. Output: client/public/assets/goldline/coastal-market-three-proof/trailblazer.glb
"""

import bmesh
import bpy
import math
import os
import random
import sys

from mathutils import Vector, noise
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT_DIR = os.path.join(REPO, "client", "public", "assets", "goldline", "coastal-market-three-proof")
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SRC = os.path.expanduser(argv[argv.index("--sources") + 1]) if "--sources" in argv else os.path.expanduser("~/Desktop/coastal-proof-sources")
RENDER = argv[argv.index("--render") + 1] if "--render" in argv else None
Q = os.path.join(SRC, "quaternius", "Universal Base Characters[Standard]", "Universal Base Characters[Standard]")
BASE = os.path.join(Q, "Base Characters", "Godot - UE", "Superhero_Female_FullBody.gltf")
TEXDIR = os.path.join(Q, "Base Characters", "Textures")
HAIR = os.path.join(Q, "Hairstyles", "Rigged to Head Bone", "glTF (Godot -Unreal)", "Hair_Buns.gltf")
UAL1 = os.path.join(SRC, "quaternius", "Universal Animation Library[Standard]", "Universal Animation Library[Standard]", "Unreal-Godot", "UAL1_Standard.glb")

rng = random.Random(8)
BUN_RADIUS = float(argv[argv.index("--bun-radius") + 1]) if "--bun-radius" in argv else 0.118

# palette (linear-ish vertex colours)
CREAM = (0.78, 0.70, 0.55)
OLIVE = (0.30, 0.31, 0.17)
OLIVE_DENIM = (0.27, 0.28, 0.16)
LEATHER = (0.28, 0.16, 0.08)
LEATHER_DARK = (0.13, 0.08, 0.05)
BRASS = (0.62, 0.45, 0.18)
BOOT = (0.26, 0.15, 0.08)
SOLE = (0.06, 0.05, 0.04)
RED = (0.50, 0.08, 0.07)
RED_DARK = (0.28, 0.04, 0.05)
HAIR_BLACK = (0.035, 0.028, 0.025)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_base():
    bpy.ops.import_scene.gltf(filepath=BASE)
    for ob in list(bpy.data.objects):
        if ob.type == "MESH" and ob.parent is None:
            bpy.data.objects.remove(ob)
    arm = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
    body = bpy.data.objects["Superhero_Female"]
    return arm, body


def bone_names(arm):
    return [b.name for b in arm.data.bones]


def dominant_bone(ob, v, names):
    best, bw = None, 0.0
    for g in v.groups:
        if g.weight > bw:
            bw = g.weight
            best = ob.vertex_groups[g.group].name
    return best


def face_info(ob):
    """Per polygon: centroid, normal, dominant bone (by its vertices' strongest weight)."""
    me = ob.data
    info = []
    for p in me.polygons:
        counts = {}
        for vi in p.vertices:
            b = dominant_bone(ob, me.vertices[vi], None)
            counts[b] = counts.get(b, 0) + 1
        info.append((p.center.copy(), p.normal.copy(), max(counts, key=counts.get)))
    return info


def snap_boundary(bm, snap):
    """Move open-edge vertices onto the garment's ideal edge so hems and straps read as clean lines."""
    if not snap:
        return
    for v in bm.verts:
        if any(e.is_boundary for e in v.link_edges):
            target = snap(v.co)
            if target is not None:
                v.co = target


def extract(body, name, pred, inflate, color_fn, info, snap=None):
    """Copy the body faces where pred(centroid, normal, bone) holds; push out by `inflate` metres."""
    me = body.data.copy()
    ob = body.copy()
    ob.data = me
    ob.name = name
    bpy.context.scene.collection.objects.link(ob)
    keep = set(i for i, (c, n, b) in enumerate(info) if pred(c, n, b))
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context="FACES")
    snap_boundary(bm, snap)
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * inflate
    # the imported body already carries a colour layer; replace it so every piece writes "Color"
    for layer in list(bm.loops.layers.color.values()):
        bm.loops.layers.color.remove(layer)
    col = bm.loops.layers.color.new("Color")
    for f in bm.faces:
        c = f.calc_center_median()
        for loop in f.loops:
            r, g, b_ = color_fn(c, f.normal, loop.vert.co)
            loop[col] = (r, g, b_, 1.0)
    bm.to_mesh(me)
    bm.free()
    me.materials.clear()
    return ob


def shade(base, amount=0.08, p=None, scale=9.0):
    if p is None:
        return base
    k = 1.0 + amount * noise.noise(p * scale)
    return tuple(max(0.0, min(1.0, c * k)) for c in base)


# ---------------------------------------------------------------------------
# garments
# ---------------------------------------------------------------------------

ARM_BONES = {"upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r", "hand_l", "hand_r"}
HEAD_BONES = {"neck_01", "Head"}


def is_hand_or_finger(b):
    return b and (b.startswith(("hand_", "index_", "middle_", "ring_", "pinky_", "thumb_")))


def top_pred(c, n, b):
    if b in ARM_BONES or b in HEAD_BONES or is_hand_or_finger(b):
        return False
    if not (1.165 <= c.z <= 1.49):
        return False
    if abs(c.x) > 0.19:
        return False
    # sleeveless: open armholes
    if abs(c.x) > 0.145 and c.z > 1.33:
        return False
    # laced V at the front
    if c.y < -0.03 and c.z > 1.30 and abs(c.x) < (c.z - 1.30) * 0.55:
        return False
    # shoulder straps only over the shoulder tops
    if c.z > 1.435 and not (0.055 < abs(c.x) < 0.125):
        return False
    return True


def top_color(c, n, v):
    if c.z > 1.405 and 0.055 < abs(c.x) < 0.125:
        return shade(LEATHER, 0.1, v)
    # lacing along the V edges
    if c.y < -0.03 and c.z > 1.28:
        edge = abs(abs(c.x) - (c.z - 1.30) * 0.55)
        if edge < 0.012:
            return LEATHER_DARK
    if abs(n.x) > 0.55:
        return shade(OLIVE, 0.12, v)
    return shade(CREAM, 0.07, v, 14)


def shorts_pred(c, n, b):
    if b in ARM_BONES or is_hand_or_finger(b):
        return False
    if not (0.80 <= c.z <= 1.035):
        return False
    # frayed, uneven hem
    if c.z < 0.835 and noise.noise(c * 40.0) > -0.1:
        return False
    return True


def shorts_color(c, n, v):
    wear = noise.noise(v * 6.0)
    base = OLIVE_DENIM if wear < 0.35 else tuple(min(1, x * 1.45) for x in OLIVE_DENIM)
    if c.z < 0.85:
        base = tuple(min(1, x * 1.25) for x in base)
    return shade(base, 0.1, v, 20)


def belt_pred(c, n, b):
    return 0.962 <= c.z <= 1.022 and not (b in ARM_BONES or is_hand_or_finger(b))


def belt_color(c, n, v):
    return shade(LEATHER, 0.12, v, 30)


def boots_pred(c, n, b):
    return c.z < 0.405 and b and (b.startswith(("calf_", "foot_", "ball_")) or b.startswith("thigh"))


def boots_color(c, n, v):
    for z0 in (0.085, 0.19, 0.30):
        if z0 <= c.z <= z0 + 0.022:
            return LEATHER_DARK
    if c.z < 0.018:
        return SOLE
    if c.z > 0.37:
        return shade(tuple(x * 1.15 for x in BOOT), 0.1, v)
    return shade(BOOT, 0.12, v, 16)


def socks_pred(c, n, b):
    return 0.375 <= c.z <= 0.455 and b and (b.startswith(("calf_", "thigh")))


def socks_color(c, n, v):
    return shade(OLIVE, 0.12, v, 30)


def bracer_pred(c, n, b):
    # HER LEFT forearm = +X
    return b in ("lowerarm_l", "hand_l") and 0.47 <= c.x <= 0.625


def bracer_color(c, n, v):
    rivet = (math.fmod(c.x * 40.0, 1.0) < 0.12) and n.z > 0.5
    return BRASS if rivet else shade(LEATHER_DARK, 0.15, v, 25)


# crossbody strap: a band around the plane through HER RIGHT shoulder top and HER LEFT hip
STRAP_A = Vector((-0.095, 0.0, 1.47))
STRAP_B = Vector((0.175, 0.0, 0.965))


def strap_pred(c, n, b):
    if b in ARM_BONES or is_hand_or_finger(b) or b in HEAD_BONES:
        return False
    if not (0.955 <= c.z <= 1.49) or abs(c.x) > 0.2:
        return False
    d = STRAP_B - STRAP_A
    nrm = d.cross(Vector((0, 1, 0))).normalized()
    return abs((c - STRAP_A).dot(nrm)) < 0.024


def strap_snap(co):
    d = STRAP_B - STRAP_A
    nrm = d.cross(Vector((0, 1, 0))).normalized()
    dist = (co - STRAP_A).dot(nrm)
    if abs(dist) < 0.012:
        return None  # an end, not a side
    return co + nrm * ((0.024 if dist > 0 else -0.024) - dist)


def z_snap(levels, reach=0.03, keep=None):
    def snap(co):
        if keep and keep(co):
            return None
        z = min(levels, key=lambda l: abs(co.z - l))
        if abs(co.z - z) > reach:
            return None
        return Vector((co.x, co.y, z))
    return snap


def x_snap(levels, reach=0.03):
    def snap(co):
        x = min(levels, key=lambda l: abs(co.x - l))
        if abs(co.x - x) > reach:
            return None
        return Vector((x, co.y, co.z))
    return snap


def top_snap(co):
    if co.z < 1.2:
        return Vector((co.x, co.y, 1.165))
    # shoulder straps: clean inner/outer edges over the shoulder tops
    if co.z > 1.43 and 0.035 < abs(co.x) < 0.15:
        x = min((0.055, 0.125), key=lambda l: abs(abs(co.x) - l))
        return Vector((math.copysign(x, co.x), co.y, co.z))
    # armholes
    if 1.32 < co.z <= 1.43 and 0.12 < abs(co.x) < 0.2:
        return Vector((math.copysign(0.145, co.x), co.y, co.z))
    # the laced V: pull edge vertices onto the two lines
    if co.y < -0.03 and 1.30 < co.z < 1.47 and abs(co.x) < 0.13:
        target = (co.z - 1.30) * 0.55
        if abs(abs(co.x) - target) < 0.025:
            return Vector((math.copysign(target, co.x), co.y, co.z))
    return None


def strap_color(c, n, v):
    return shade(LEATHER, 0.12, v, 30)


# ---------------------------------------------------------------------------
# rigid accessories on bones
# ---------------------------------------------------------------------------


def add_bone(arm, name, head, tail, parent):
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones.new(name)
    eb.head = head
    eb.tail = tail
    eb.parent = arm.data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")


def rigid_mesh(name, arm, parts, bone_weights_fn):
    """parts: list of (bmesh-building callback, colour). bone_weights_fn(co) -> {bone: w}."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    for build, color in parts:
        before = set(bm.faces)
        build(bm)
        for f in bm.faces:
            if f not in before:
                for loop in f.loops:
                    loop[col] = (*color, 1.0)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = arm
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    groups = {}
    for v in me.vertices:
        for bone, w in bone_weights_fn(v.co).items():
            g = groups.get(bone) or ob.vertex_groups.new(name=bone)
            groups[bone] = g
            g.add([v.index], w, "REPLACE")
    return ob


def cube(center, size, rot_z=0.0, bevel=0.0):
    def build(bm):
        res = bmesh.ops.create_cube(bm, size=1.0)
        verts = res["verts"]
        bmesh.ops.scale(bm, vec=Vector(size), verts=verts)
        if rot_z:
            from mathutils import Matrix
            bmesh.ops.rotate(bm, cent=Vector((0, 0, 0)), matrix=Matrix.Rotation(rot_z, 3, "Z"), verts=verts)
        bmesh.ops.translate(bm, vec=Vector(center), verts=verts)
        if bevel:
            edges = list({e for v in verts for e in v.link_edges})
            bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=2, affect="EDGES", profile=0.5)
    return build


def cloth_strip(top_left, top_right, length, rows, taper=0.6):
    def build(bm):
        grid = []
        for r in range(rows + 1):
            t = r / rows
            left = Vector(top_left).lerp((Vector(top_left) + Vector(top_right)) / 2, t * taper)
            right = Vector(top_right).lerp((Vector(top_left) + Vector(top_right)) / 2, t * taper)
            z = -length * t
            sway = 0.012 * math.sin(t * 5.0)
            grid.append([bm.verts.new(left + Vector((0, sway, z))), bm.verts.new(right + Vector((0, sway, z)))])
        for r in range(rows):
            bm.faces.new((grid[r][0], grid[r][1], grid[r + 1][1], grid[r + 1][0]))
    return build


def body_surface(tree, x, z, from_dir):
    """First hit on the body coming in along -from_dir at height z."""
    origin = Vector((x, 0, z)) + Vector(from_dir) * 1.0
    hit = tree.ray_cast(origin, -Vector(from_dir), 2.0)
    return hit[0]


# ---------------------------------------------------------------------------
# hair
# ---------------------------------------------------------------------------


def build_hair(arm, head_tree):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=HAIR)
    new = [o for o in bpy.data.objects if o not in before]
    hair = [o for o in new if o.type == "MESH"][0]
    world = hair.matrix_world.copy()
    hair.parent = None
    hair.matrix_world = world
    for o in new:
        if o is not hair:
            bpy.data.objects.remove(o)
    me = hair.data
    bm = bmesh.new()
    bm.from_mesh(me)
    # split into connected pieces; the two buns are the pieces well off the midline
    bm.verts.ensure_lookup_table()
    seen = set()
    pieces = []
    for v in bm.verts:
        if v in seen:
            continue
        stack, part = [v], []
        seen.add(v)
        while stack:
            cur = stack.pop()
            part.append(cur)
            for e in cur.link_edges:
                o = e.other_vert(cur)
                if o not in seen:
                    seen.add(o)
                    stack.append(o)
        pieces.append(part)
    # the pack's buns sit outside the scalp, high on each side; the cap cards hug the skull
    head_c = Vector((0.0, 0.015, 1.665))
    left_bun, right_bun = [], []
    for part in pieces:
        outside = sum(1 for v in part if (v.co - head_c).length > BUN_RADIUS and v.co.z > 1.64) / len(part)
        if outside < 0.3:
            continue
        cx = sum(v.co.x for v in part) / len(part)
        if cx > 0.04:
            left_bun.append(part)
        elif cx < -0.04:
            right_bun.append(part)
    print(f"[trailblazer] hair pieces {len(pieces)}: bun cards left {len(left_bun)} right {len(right_bun)}")
    if left_bun and right_bun:
        bmesh.ops.delete(bm, geom=list({v for part in right_bun for v in part}), context="VERTS")
        keep = [v for part in left_bun for v in part]
        c = sum((v.co for v in keep), Vector()) / len(keep)
        target = Vector((0.0, 0.035, 1.80))
        for v in keep:
            v.co = target + (v.co - c) * 1.12
    bm.to_mesh(me)
    bm.free()
    # vertex colour black for all hair (texture still carries the strands)
    ca = me.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
    for i in range(len(ca.data)):
        ca.data[i].color = (*HAIR_BLACK, 1.0)
    me.color_attributes.active_color = ca
    for g in list(hair.vertex_groups):
        hair.vertex_groups.remove(g)
    hair.parent = arm
    hg = hair.vertex_groups.new(name="Head")
    hg.add([v.index for v in me.vertices], 1.0, "REPLACE")
    mod = hair.modifiers.get("Armature") or hair.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    hair.name = "TB_Hair"
    return hair


def build_tie_and_strands(arm):
    parts = []

    def tie(bm):
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.036, radius2=0.034, depth=0.022)
        bmesh.ops.translate(bm, vec=Vector((0.0, 0.03, 1.748)), verts=res["verts"])
    parts.append((tie, LEATHER))
    # loose face-framing strands: short, tapered, curving in along the cheek (head sheet)
    for side in (-1, 1):
        for k, (dx, length) in enumerate(((0.0, 0.085), (0.011, 0.065))):
            def strand(bm, side=side, dx=dx, k=k, length=length):
                top = Vector((side * (0.071 + dx), -0.062 + 0.008 * k, 1.705))
                vs = []
                for i in range(5):
                    t = i / 4
                    p = top + Vector((-side * 0.012 * t * t, -0.012 * t, -length * t))
                    w = 0.0065 * (1 - 0.75 * t)
                    vs.append((bm.verts.new(p + Vector((0, -w, 0))), bm.verts.new(p + Vector((0, w, 0)))))
                for i in range(4):
                    bm.faces.new((vs[i][0], vs[i][1], vs[i + 1][1], vs[i + 1][0]))
            parts.append((strand, HAIR_BLACK))
    return rigid_mesh("TB_HairBits", arm, parts, lambda co: {"Head": 1.0})


# ---------------------------------------------------------------------------
# tattoo decal
# ---------------------------------------------------------------------------


def phoenix_image(w=256, h=384):
    """Stylised phoenix line art, ink on transparent, drawn here (owned outright)."""
    import numpy as np
    img = np.zeros((h, w, 4), np.float32)

    def stroke(points, width):
        for (x0, y0), (x1, y1) in zip(points, points[1:]):
            n = int(max(abs(x1 - x0), abs(y1 - y0)) * w) + 2
            for i in range(n):
                t = i / (n - 1)
                x, y = (x0 + (x1 - x0) * t) * w, (y0 + (y1 - y0) * t) * h
                r = width * w
                ys, ye = int(max(0, y - r - 1)), int(min(h, y + r + 2))
                xs, xe = int(max(0, x - r - 1)), int(min(w, x + r + 2))
                if ys >= ye or xs >= xe:
                    continue
                yy, xx = np.mgrid[ys:ye, xs:xe]
                d = np.hypot(xx - x, yy - y)
                a = np.clip(r - d + 0.8, 0, 1)
                img[ys:ye, xs:xe, 3] = np.maximum(img[ys:ye, xs:xe, 3], a)

    def curve(cx, cy, r, a0, a1, width, n=24):
        pts = [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]
        stroke(pts, width)

    # head + beak + crest
    curve(0.5, 0.14, 0.05, 0, 2 * math.pi, 0.012)
    stroke([(0.54, 0.12), (0.62, 0.135), (0.545, 0.155)], 0.01)
    for k in range(3):
        stroke([(0.47 - k * 0.02, 0.1), (0.42 - k * 0.05, 0.04 - k * 0.01)], 0.008)
    # neck + body
    stroke([(0.5, 0.19), (0.47, 0.28), (0.5, 0.38), (0.52, 0.48)], 0.014)
    # wings: sweeping feather arcs up and out on both sides
    for side in (-1, 1):
        for k in range(5):
            r = 0.22 + k * 0.045
            a0 = math.pi * (1.5 + side * 0.08)
            base_x = 0.5 + side * 0.02
            pts = []
            for i in range(20):
                t = i / 19
                ang = math.pi * 0.9 + side * (math.pi * 0.35 * t)
                x = base_x + side * (0.05 + t * (0.34 + 0.02 * k))
                y = 0.33 - math.sin(t * math.pi * 0.8) * (0.2 + 0.03 * k) + t * 0.05
                pts.append((x, y))
            stroke(pts, 0.009 - k * 0.0008)
            tip = pts[-1]
            stroke([tip, (tip[0] + side * 0.03, tip[1] + 0.05)], 0.006)
    # tail plumes curling down
    for k in range(4):
        pts = []
        for i in range(24):
            t = i / 23
            x = 0.52 + (k - 1.5) * 0.05 * t + 0.08 * math.sin(t * math.pi * 1.3 + k) * t
            y = 0.48 + t * 0.46
            pts.append((x, y))
        stroke(pts, 0.009)
        end = pts[-1]
        curve(end[0] + 0.02, end[1] - 0.02, 0.025, 0, math.pi * 1.6, 0.006)
    img[..., 0:3] = np.array([0.1, 0.12, 0.11])
    img[..., 3] *= 0.82
    im = bpy.data.images.new("TB_Tattoo", w, h, alpha=True)
    im.pixels.foreach_set(img[::-1].ravel())
    im.pack()
    return im


def build_tattoo(body, info):
    """HER RIGHT upper arm (x < 0) and shoulder; cylindrical UVs around the arm axis."""
    def pred(c, n, b):
        return (b in ("upperarm_r", "clavicle_r", "spine_03") and -0.36 <= c.x <= -0.13 and c.z > 1.36) and not (b == "spine_03" and c.x > -0.14)
    ob = extract(body, "TB_Tattoo", pred, 0.0018, lambda c, n, v: (1, 1, 1), info)
    me = ob.data
    uv = me.uv_layers.new(name="TattooUV")
    me.uv_layers.active = uv
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            # angle around the arm axis (x); 0 = straight up (the outer arm when her arms hang)
            ang = math.atan2(co.y - 0.055, co.z - 1.418)
            u = 0.5 + ang / (math.pi * 1.1)
            v = (-co.x - 0.14) / 0.2
            uv.data[li].uv = (u, 1.0 - v)
    for old in list(me.uv_layers):
        if old.name != "TattooUV":
            me.uv_layers.remove(old)
    mat = bpy.data.materials.new("TB_Tattoo")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = phoenix_image()
    tex.extension = "CLIP"
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    mat.node_tree.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.6
    if hasattr(mat, "blend_method"):
        mat.blend_method = "BLEND"
    me.materials.append(mat)
    return ob


# ---------------------------------------------------------------------------
# assemble
# ---------------------------------------------------------------------------


def garments_material():
    m = bpy.data.materials.new("TB_Garments")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    vc = nt.nodes.new("ShaderNodeAttribute")
    vc.attribute_name = "Color"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.72
    return m


def main():
    reset()
    arm, body = import_base()
    # skin: the pack's light base colour (the v2 sheet's East Asian skin tone), warmed slightly in three.js
    light = os.path.join(TEXDIR, "T_Superhero_Female_Light_BaseColor.png")
    for mat in body.data.materials:
        for node in mat.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image and "BaseColor" in node.image.name:
                node.image = bpy.data.images.load(light)
    for mat in bpy.data.materials:
        for node in list(mat.node_tree.nodes):
            if node.type == "TEX_IMAGE" and (node.image is None or node.image.size[0] == 0):
                mat.node_tree.nodes.remove(node)

    # the pack's meshes carry spare UV sets and colour layers; keep the render UV only so the
    # garments' own "Color" becomes COLOR_0 (and the file shrinks)
    for ob in [o for o in bpy.data.objects if o.type == "MESH"]:
        me = ob.data
        render_uv = next((uv.name for uv in me.uv_layers if uv.active_render), me.uv_layers[0].name if me.uv_layers else None)
        for uv in list(me.uv_layers):
            if uv.name != render_uv:
                me.uv_layers.remove(uv)
        for ca in list(me.color_attributes):
            me.color_attributes.remove(ca)

    info = face_info(body)
    gm = garments_material()
    pieces = [
        extract(body, "TB_Top", top_pred, 0.0075, top_color, info, top_snap),
        extract(body, "TB_Shorts", shorts_pred, 0.0085, shorts_color, info, z_snap([1.035], keep=lambda co: co.z < 0.9)),
        extract(body, "TB_Belt", belt_pred, 0.016, belt_color, info, z_snap([0.962, 1.022])),
        extract(body, "TB_Boots", boots_pred, 0.012, boots_color, info, z_snap([0.405])),
        extract(body, "TB_Socks", socks_pred, 0.0085, socks_color, info, z_snap([0.375, 0.455])),
        extract(body, "TB_Bracer", bracer_pred, 0.0095, bracer_color, info, x_snap([0.47, 0.625])),
        extract(body, "TB_Strap", strap_pred, 0.0175, strap_color, info, strap_snap),
    ]
    tattoo = build_tattoo(body, info)

    verts = [tuple(v.co) for v in body.data.vertices]
    polys = [tuple(p.vertices) for p in body.data.polygons]
    tree = BVHTree.FromPolygons(verts, polys)

    # spring bones: satchel (her LEFT hip, +X) and the bandana chain (her RIGHT hip, -X)
    add_bone(arm, "satchel", (0.175, 0.03, 0.985), (0.19, 0.03, 0.86), "pelvis")
    add_bone(arm, "bandana_1", (-0.15, 0.04, 0.975), (-0.152, 0.045, 0.88), "pelvis")
    add_bone(arm, "bandana_2", (-0.152, 0.045, 0.88), (-0.154, 0.05, 0.79), "bandana_1")
    add_bone(arm, "bandana_3", (-0.154, 0.05, 0.79), (-0.156, 0.055, 0.70), "bandana_2")

    hip_l = body_surface(tree, 0.0, 0.92, (1, 0, 0))
    hip_r = body_surface(tree, 0.0, 0.93, (-1, 0, 0))
    print("[trailblazer] hips", hip_l, hip_r)
    sx = (hip_l.x if hip_l else 0.17) + 0.045
    satchel = rigid_mesh("TB_Satchel", arm, [
        (cube((sx, 0.035, 0.885), (0.07, 0.21, 0.16), bevel=0.012), LEATHER),
        (cube((sx + 0.012, 0.035, 0.935), (0.058, 0.215, 0.07), bevel=0.008), tuple(c * 0.8 for c in LEATHER)),
        (cube((sx + 0.04, 0.035, 0.915), (0.012, 0.03, 0.035)), BRASS),
    ], lambda co: {"satchel": 1.0})
    bx = (hip_r.x if hip_r else -0.17) - 0.012

    def bandana_weights(co):
        z = co.z
        if z > 0.9:
            return {"bandana_1": 1.0}
        if z > 0.81:
            return {"bandana_2": 1.0}
        return {"bandana_3": 1.0}
    # hang it on the back-outer corner of her right hip so it reads from the gameplay camera
    a0 = Vector((bx + 0.02, -0.01, 0.985))
    a1 = Vector((bx + 0.07, 0.085, 0.985))
    bandana = rigid_mesh("TB_Bandana", arm, [
        (cloth_strip(tuple(a0), tuple(a1), 0.31, 8, taper=0.85), RED),
        (cloth_strip(tuple(a0 + Vector((-0.006, 0.02, -0.01))), tuple(a1 + Vector((-0.004, -0.02, -0.01))), 0.25, 6, taper=0.9), RED_DARK),
    ], bandana_weights)
    # holster-style pouch on the belt at her right hip, forward of the bandana (approved change 1)
    front_r = body_surface(tree, -0.12, 0.95, (0, -1, 0))
    py = (front_r.y if front_r else -0.1) - 0.025
    pouch = rigid_mesh("TB_Pouch", arm, [
        (cube((-0.135, py + 0.03, 0.935), (0.09, 0.05, 0.11), rot_z=0.35, bevel=0.01), LEATHER),
        (cube((-0.135, py + 0.005, 0.975), (0.08, 0.02, 0.03), rot_z=0.35), BRASS),
    ], lambda co: {"pelvis": 1.0})
    # brass buckles: belt front, shoulder straps
    front = body_surface(tree, 0.0, 0.99, (0, -1, 0))
    fy = (front.y if front else -0.11) - 0.02
    chest_l = body_surface(tree, 0.09, 1.405, (0, -1, 0))
    chest_r = body_surface(tree, -0.09, 1.405, (0, -1, 0))
    buckles = rigid_mesh("TB_Buckles", arm, [
        (cube((0.0, fy, 0.99), (0.055, 0.012, 0.045)), BRASS),
        (cube((0.09, (chest_l.y if chest_l else -0.1) - 0.02, 1.405), (0.03, 0.01, 0.028)), BRASS),
        (cube((-0.09, (chest_r.y if chest_r else -0.1) - 0.02, 1.405), (0.03, 0.01, 0.028)), BRASS),
    ], lambda co: {"pelvis": 1.0} if co.z < 1.2 else {"spine_03": 1.0})
    # boot tassels (outer side of each boot top)
    tassels = []
    for side, bone in ((1, "calf_l"), (-1, "calf_r")):
        outer = body_surface(tree, side * 0.11, 0.36, (side, 0, 0))
        ox = (outer.x if outer else side * 0.16) + side * 0.02
        tassels.append((cloth_strip((ox, -0.012, 0.37), (ox, 0.012, 0.37), 0.08, 2, taper=0.5), BOOT))
    tassel_ob = rigid_mesh("TB_Tassels", arm, tassels, lambda co: {"calf_l" if co.x > 0 else "calf_r": 1.0})
    hair = build_hair(arm, tree)
    hairbits = build_tie_and_strands(arm)

    # join garments + rigid accessories into one skinned mesh (one draw call)
    garments = pieces + [satchel, bandana, pouch, buckles, tassel_ob, hairbits]
    for ob in garments:
        ob.data.materials.clear()
        ob.data.materials.append(gm)
        for mod in ob.modifiers:
            if mod.type == "ARMATURE":
                mod.object = arm
    for o in bpy.data.objects:
        o.select_set(False)
    for ob in garments:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = garments[0]
    bpy.ops.object.join()
    garments[0].name = "TB_Garments"
    gme = garments[0].data
    gca = gme.color_attributes.get("Color")
    if gca:
        gme.color_attributes.active_color = gca
        gme.color_attributes.render_color_index = gme.color_attributes.active_color_index
    print(f"[trailblazer] garment colour attributes: {[(a.name, a.domain, a.data_type) for a in gme.color_attributes]}")

    tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == "MESH" for p in o.data.polygons)
    print(f"[trailblazer] total tris {tris}")

    for img in bpy.data.images:
        if img.size[0] > 1024:
            img.scale(1024, 1024)
    out = os.path.join(OUT_DIR, "trailblazer.glb")
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", export_yup=True, export_animations=False, export_skins=True,
        export_morph=False, export_materials="EXPORT", export_image_format="WEBP", export_image_quality=85,
        export_vertex_color="ACTIVE", export_meshopt_compression_enable=True, export_def_bones=False,
        export_cameras=False, export_lights=False,
    )
    print(f"[trailblazer] wrote {os.path.relpath(out, REPO)} ({os.path.getsize(out) // 1024} KB)")
    if RENDER:
        render_views(arm, RENDER)


def render_views(arm, prefix):
    """Mid-walk turnaround for review: behind, behind-left, behind-right, side, front."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=UAL1)
    walk = bpy.data.actions.get("Walk_Loop")
    for o in list(bpy.data.objects):
        if o not in before:
            bpy.data.objects.remove(o)
    arm.animation_data_create()
    arm.animation_data.action = walk
    if hasattr(arm.animation_data, "action_slot") and walk.slots:
        arm.animation_data.action_slot = walk.slots[0]
    sc = bpy.context.scene
    sc.frame_set(9)
    sc.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE_NEXT"
    sc.render.resolution_x, sc.render.resolution_y = 512, 900
    sc.render.film_transparent = False
    world = bpy.data.worlds.new("w")
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.42, 0.42, 0.44, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.2
    sun = bpy.data.lights.new("s", "SUN")
    sun.energy = 3.0
    so = bpy.data.objects.new("s", sun)
    so.rotation_euler = (math.radians(50), 0, math.radians(30))
    sc.collection.objects.link(so)
    cam = bpy.data.cameras.new("c")
    cam.lens = 70
    co = bpy.data.objects.new("c", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    # she faces -Y; "behind" means the camera sits at +Y
    views = [("behind", 0, 4.2, 0.95), ("behind-left", 35, 4.2, 0.95), ("behind-right", -35, 4.2, 0.95),
             ("side", 90, 4.2, 0.95), ("front", 180, 4.2, 0.95),
             ("head-back", 20, 1.1, 1.66), ("head-front", 160, 1.1, 1.66), ("head-side", 90, 1.1, 1.66)]
    for label, ang, dist, look_z in views:
        a = math.radians(ang)
        pos = Vector((math.sin(a) * dist, math.cos(a) * dist, 1.35 if dist > 2 else 1.72))
        co.location = pos
        d = Vector((0, 0, look_z)) - pos
        co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = f"{prefix}_{label}.png"
        bpy.ops.render.render(write_still=True)


main()
