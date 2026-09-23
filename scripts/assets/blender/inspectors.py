"""
Mooring City's rope inspectors, built and rigged procedurally, rendered through
the same camera and lights as Rook's overworld sheets so the parley reads as one
world. Pell is tall and laughs; Dunmore is short, stout and does not.

    blender --background --factory-startup --python inspectors.py -- --out DIR --res 288 [--test]
    python3 pack_group.py DIR client/public/assets/goldline/wayward/voyage inspector pell,dunmore
"""
import bpy, bmesh, sys, os, math, json, argparse
from mathutils import Vector, Matrix, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rook_rig as R  # camera, lights, rot/move helpers


def mat(name, color, rough=0.72, metal=0.0, noise=0.0, scale=18.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if noise > 0:
        n = nt.nodes.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = 4.0
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.inputs[0].default_value = noise
        mix.inputs[6].default_value = (*color, 1)
        mix.inputs[7].default_value = (color[0] * 0.62, color[1] * 0.62, color[2] * 0.62, 1)
        nt.links.new(n.outputs["Fac"], mix.inputs[0]) if False else None
        ramp = nt.nodes.new("ShaderNodeMath")
        ramp.operation = "MULTIPLY"
        ramp.inputs[1].default_value = noise
        nt.links.new(n.outputs["Fac"], ramp.inputs[0])
        nt.links.new(ramp.outputs[0], mix.inputs[0])
        nt.links.new(mix.outputs[2], b.inputs["Base Color"])
    return m


def smooth(obj, levels=2):
    mod = obj.modifiers.new("sub", "SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    for p in obj.data.polygons:
        p.use_smooth = True


def prim(kind, name, material, loc=(0, 0, 0), scale=(1, 1, 1), rot=(0, 0, 0), sub=1, **kw):
    if kind == "cube":
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    elif kind == "cyl":
        bpy.ops.mesh.primitive_cylinder_add(vertices=kw.get("vertices", 20), radius=0.5, depth=1, location=loc)
    elif kind == "cone":
        bpy.ops.mesh.primitive_cone_add(vertices=kw.get("vertices", 24), radius1=0.5, radius2=kw.get("r2", 0.3), depth=1, location=loc)
    elif kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=14, radius=0.5, location=loc)
    elif kind == "torus":
        bpy.ops.mesh.primitive_torus_add(major_radius=kw.get("major", 0.5), minor_radius=kw.get("minor", 0.08), location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    o.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if sub:
        smooth(o, sub)
    o.data.materials.append(material)
    return o


# Bones: (head, tail, parent). Heights for a figure ~2.9 units tall (Pell); scaled for Dunmore.
def skeleton(k, stout):
    w = 1.32 if stout else 1.0
    return {
        "root": ((0, 0, 0), (0, 0, 0.2 * k), None),
        "hips": ((0, 0, 1.28 * k), (0, 0, 1.55 * k), "root"),
        "chest": ((0, 0, 1.55 * k), (0, 0, 2.2 * k), "hips"),
        "neck": ((0, 0, 2.2 * k), (0, 0, 2.34 * k), "chest"),
        "head": ((0, 0, 2.34 * k), (0, 0, 2.8 * k), "neck"),
        "upper_arm.L": ((0.4 * k * w, 0, 2.14 * k), (0.4 * k * w, 0, 1.66 * k), "chest"),
        "forearm.L": ((0.4 * k * w, 0, 1.66 * k), (0.42 * k * w, 0, 1.24 * k), "upper_arm.L"),
        "upper_arm.R": ((-0.4 * k * w, 0, 2.14 * k), (-0.4 * k * w, 0, 1.66 * k), "chest"),
        "forearm.R": ((-0.4 * k * w, 0, 1.66 * k), (-0.42 * k * w, 0, 1.24 * k), "upper_arm.R"),
        "thigh.L": ((0.14 * k * w, 0, 1.28 * k), (0.14 * k * w, 0, 0.68 * k), "hips"),
        "shin.L": ((0.14 * k * w, 0, 0.68 * k), (0.14 * k * w, 0, 0.1 * k), "thigh.L"),
        "thigh.R": ((-0.14 * k * w, 0, 1.28 * k), (-0.14 * k * w, 0, 0.68 * k), "hips"),
        "shin.R": ((-0.14 * k * w, 0, 0.68 * k), (-0.14 * k * w, 0, 0.1 * k), "thigh.R"),
    }


def bevel(obj, width=0.02, segments=2):
    mod = obj.modifiers.new("bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def build(who):
    stout = who == "dunmore"
    k = 0.86 if stout else 1.0
    w = 1.32 if stout else 1.0
    coat_col = (0.23, 0.06, 0.04) if stout else (0.04, 0.12, 0.14)
    M = {
        "coat": mat(f"{who}_coat", coat_col, 0.82, noise=0.4, scale=26),
        "coat_dark": mat(f"{who}_coat_dark", tuple(c * 0.55 for c in coat_col), 0.85),
        "trousers": mat(f"{who}_trousers", (0.05, 0.045, 0.04), 0.9),
        "boot": mat(f"{who}_boot", (0.03, 0.02, 0.015), 0.45),
        "skin": mat(f"{who}_skin", (0.55, 0.32, 0.22) if stout else (0.6, 0.4, 0.28), 0.62),
        "hat": mat(f"{who}_hat", (0.025, 0.022, 0.02), 0.5),
        "brass": mat(f"{who}_brass", (0.72, 0.5, 0.18), 0.3, metal=0.9),
        "rope": mat(f"{who}_rope", (0.5, 0.36, 0.2), 0.9, noise=0.45, scale=70),
        "hair": mat(f"{who}_hair", (0.55, 0.53, 0.5) if stout else (0.16, 0.1, 0.06), 0.8),
        "eye": mat(f"{who}_eye", (0.02, 0.015, 0.01), 0.3),
        "paper": mat(f"{who}_paper", (0.9, 0.84, 0.66), 0.9),
        "shirt": mat(f"{who}_shirt", (0.78, 0.74, 0.64), 0.85),
    }
    parts = {}

    def add(bone, obj):
        parts.setdefault(bone, []).append(obj)
        return obj

    for side, sx in (("L", 1), ("R", -1)):
        x = 0.14 * k * w * sx
        add(f"thigh.{side}", bevel(prim("cyl", f"thigh.{side}", M["trousers"], (x, 0, 0.98 * k), (0.22 * k, 0.22 * k, 0.62 * k), sub=0)))
        add(f"shin.{side}", bevel(prim("cyl", f"shin.{side}", M["trousers"], (x, 0, 0.42 * k), (0.19 * k, 0.19 * k, 0.6 * k), sub=0)))
        add(f"shin.{side}", prim("cube", f"boot.{side}", M["boot"], (x, -0.07 * k, 0.08 * k), (0.21 * k, 0.4 * k, 0.17 * k), sub=2))
    # A long coat: flared skirt from waist to knee, a torso with square shoulders.
    add("hips", bevel(prim("cone", "skirt", M["coat"], (0, 0, 1.08 * k), (0.8 * k * w, 0.62 * k * w, 0.84 * k), r2=0.34, vertices=10, sub=0), 0.03, 2))
    add("hips", bevel(prim("cone", "skirt_lining", M["coat_dark"], (0, 0.01, 1.06 * k), (0.76 * k * w, 0.58 * k * w, 0.8 * k), r2=0.33, vertices=10, sub=0), 0.02, 1))
    torso = bevel(prim("cone", "torso", M["coat"], (0, 0, 1.86 * k), (0.72 * k * w, 0.5 * k * w, 0.72 * k), r2=0.62, vertices=10, sub=0), 0.04, 3)
    add("chest", torso)
    add("chest", bevel(prim("cube", "shoulders", M["coat"], (0, 0, 2.16 * k), (0.78 * k * w, 0.36 * k * w, 0.16 * k), sub=0), 0.06, 3))
    add("chest", prim("cube", "shirt", M["shirt"], (0, -0.2 * k * w, 2.08 * k), (0.14 * k, 0.04, 0.2 * k), sub=0))
    add("chest", bevel(prim("cube", "lapel.L", M["coat_dark"], (0.1 * k, -0.22 * k * w, 1.98 * k), (0.12 * k, 0.03, 0.44 * k), rot=(0, math.radians(-12), 0), sub=0), 0.01, 1))
    add("chest", bevel(prim("cube", "lapel.R", M["coat_dark"], (-0.1 * k, -0.22 * k * w, 1.98 * k), (0.12 * k, 0.03, 0.44 * k), rot=(0, math.radians(12), 0), sub=0), 0.01, 1))
    for i in range(4):
        for sx in (1, -1):
            add("chest", prim("sphere", f"button{i}{sx}", M["brass"], (0.13 * k * sx, -0.25 * k * w, (1.98 - i * 0.14) * k), (0.045 * k, 0.03 * k, 0.045 * k), sub=0))
    sash = prim("torus", "sash", M["rope"], (0, 0, 1.84 * k), (0.74 * k * w, 0.54 * k * w, 0.72 * k), rot=(0.0, math.radians(36), 0), sub=0, major=0.5, minor=0.04)
    add("chest", sash)
    add("neck", bevel(prim("cyl", "collar", M["coat_dark"], (0, 0, 2.28 * k), (0.34 * k, 0.32 * k, 0.12 * k), sub=0), 0.02, 2))
    add("head", prim("sphere", "head", M["skin"], (0, 0, 2.52 * k), (0.34 * k, 0.37 * k, 0.42 * k), sub=1))
    add("head", prim("sphere", "nose", M["skin"], (0, -0.2 * k, 2.49 * k), (0.08 * k, 0.13 * k, 0.1 * k), sub=1))
    for sx in (1, -1):
        add("head", prim("sphere", f"eye{sx}", M["eye"], (0.085 * k * sx, -0.16 * k, 2.58 * k), (0.035 * k, 0.02, 0.035 * k), sub=0))
        add("head", prim("sphere", f"ear{sx}", M["skin"], (0.17 * k * sx, 0, 2.52 * k), (0.05 * k, 0.08 * k, 0.1 * k), sub=0))
        add("head", prim("cube", f"brow{sx}", M["hair"], (0.08 * k * sx, -0.17 * k, 2.65 * k), (0.11 * k, 0.03, 0.03 * k), sub=0, rot=(0, math.radians(-14 * sx if stout else 6 * sx), 0)))
    if stout:
        for sx in (1, -1):
            add("head", prim("sphere", f"stache{sx}", M["hair"], (0.09 * k * sx, -0.18 * k, 2.4 * k), (0.15 * k, 0.07 * k, 0.055 * k), sub=1, rot=(0, math.radians(-20 * sx), 0)))
        add("head", bevel(prim("cyl", "cap", M["hat"], (0, 0.02, 2.8 * k), (0.42 * k, 0.44 * k, 0.17 * k), sub=0, vertices=24), 0.03, 2))
        add("head", bevel(prim("cube", "peak", M["hat"], (0, -0.23 * k, 2.72 * k), (0.36 * k, 0.17 * k, 0.03 * k), sub=0, rot=(math.radians(-14), 0, 0)), 0.01, 1))
        add("head", prim("sphere", "badge", M["brass"], (0, -0.21 * k, 2.82 * k), (0.08 * k, 0.03, 0.08 * k), sub=0))
        for sx in (1, -1):
            add("chest", prim("torus", f"epaulette{sx}", M["rope"], (0.38 * k * w * sx, 0, 2.22 * k), (0.22 * k, 0.22 * k, 0.2 * k), sub=0, major=0.5, minor=0.13))
    else:
        add("head", bevel(prim("cube", "hair", M["hair"], (0, 0.11 * k, 2.58 * k), (0.34 * k, 0.24 * k, 0.22 * k), sub=0), 0.06, 3))
        add("head", bevel(prim("cyl", "brim", M["hat"], (0, 0, 2.84 * k), (0.6 * k, 0.6 * k, 0.03 * k), sub=0, vertices=32), 0.01, 1))
        add("head", bevel(prim("cyl", "crown", M["hat"], (0, 0, 3.1 * k), (0.38 * k, 0.38 * k, 0.5 * k), sub=0, vertices=32), 0.02, 2))
        add("head", prim("cyl", "band", M["rope"], (0, 0, 2.92 * k), (0.39 * k, 0.39 * k, 0.07 * k), sub=0, vertices=32))
        add("chest", prim("torus", "coil", M["rope"], (0.2 * k, 0.1, 1.92 * k), (0.36 * k, 0.36 * k, 0.5 * k), rot=(math.radians(90), math.radians(20), 0), sub=0, major=0.5, minor=0.075))
    for side, sx in (("L", 1), ("R", -1)):
        x = 0.4 * k * w * sx
        add(f"upper_arm.{side}", bevel(prim("cyl", f"upper.{side}", M["coat"], (x, 0, 1.9 * k), (0.22 * k, 0.22 * k, 0.5 * k), sub=0), 0.03, 2))
        add(f"forearm.{side}", bevel(prim("cyl", f"fore.{side}", M["coat"], (x, 0, 1.46 * k), (0.2 * k, 0.2 * k, 0.46 * k), sub=0), 0.03, 2))
        add(f"forearm.{side}", bevel(prim("cyl", f"cuff.{side}", M["coat_dark"], (x, 0, 1.27 * k), (0.23 * k, 0.23 * k, 0.09 * k), sub=0), 0.01, 1))
        add(f"forearm.{side}", prim("sphere", f"hand.{side}", M["skin"], (x, 0, 1.17 * k), (0.14 * k, 0.11 * k, 0.16 * k), sub=1))
    letter = prim("cube", "letter", M["paper"], (-0.42 * k * w, -0.16 * k, 1.2 * k), (0.02, 0.26 * k, 0.32 * k), sub=0)
    add("forearm.R", letter)
    ledger = None
    if stout:
        ledger = prim("cube", "ledger", mat(f"{who}_ledger", (0.2, 0.07, 0.04), 0.7), (0.52 * k * w, 0.02, 1.62 * k), (0.07, 0.36 * k, 0.46 * k), sub=0)
        add("upper_arm.L", ledger)
    return parts, letter, ledger, k, stout


def rig(parts, k, stout, name):
    bones = skeleton(k, stout)
    data = bpy.data.armatures.new(f"{name}_arm")
    arm = bpy.data.objects.new(f"{name}_arm", data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for bname, (h, t, parent) in bones.items():
        b = data.edit_bones.new(bname)
        b.head, b.tail = Vector(h), Vector(t)
    for bname, (h, t, parent) in bones.items():
        if parent:
            data.edit_bones[bname].parent = data.edit_bones[parent]
    for b in data.edit_bones:
        b.align_roll(Vector((0, -1, 0)))
    bpy.ops.object.mode_set(mode="OBJECT")
    for bname, objs in parts.items():
        for o in objs:
            mw = o.matrix_world.copy()
            o.parent = arm
            o.parent_type = "BONE"
            o.parent_bone = bname
            o.matrix_world = mw
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
    return arm


# ---------------------------------------------------------------- poses (degrees; world-ish axes via R.rot)
def base(arm, t, breathe=1.0):
    ph = t * math.tau
    R.move(arm, "hips", dz=0.006 * math.sin(ph) * breathe)
    R.rot(arm, "chest", x=1.2 * math.sin(ph) * breathe)
    R.rot(arm, "upper_arm.L", y=-6)
    R.rot(arm, "upper_arm.R", y=6)


def p_idle(arm, t):
    base(arm, t)
    R.rot(arm, "head", z=6 * math.sin(t * math.tau))


def p_inspect(arm, t):
    base(arm, t)
    R.rot(arm, "upper_arm.L", x=-55, y=-12)
    R.rot(arm, "forearm.L", x=-35)
    R.rot(arm, "upper_arm.R", x=-50, y=14)
    R.rot(arm, "forearm.R", x=-40)
    R.rot(arm, "head", x=14 + 3 * math.sin(t * math.tau), z=-6)
    R.rot(arm, "chest", x=6)


def p_halt(arm, t):
    k = R.smooth(0.0, 0.35, t)
    base(arm, t, 0.4)
    R.rot(arm, "upper_arm.L", x=-86 * k, y=-10 * k)
    R.rot(arm, "forearm.L", x=-14 * k)
    R.rot(arm, "chest", x=-5 * k)
    R.rot(arm, "head", x=-6 * k)


def p_listen(arm, t):
    base(arm, t)
    R.rot(arm, "upper_arm.L", x=-28, y=-2, z=40)
    R.rot(arm, "forearm.L", x=-95, z=30)
    R.rot(arm, "upper_arm.R", x=-28, y=2, z=-40)
    R.rot(arm, "forearm.R", x=-95, z=-30)
    R.rot(arm, "head", y=6 * math.sin(t * math.tau), x=4)


def p_laugh(arm, t):
    ph = t * math.tau
    shake = abs(math.sin(ph * 3))
    R.move(arm, "hips", dz=-0.01 * shake)
    R.rot(arm, "chest", x=-10 - 5 * shake)
    R.rot(arm, "head", x=-24 - 8 * shake, y=4 * math.sin(ph * 3))
    R.rot(arm, "upper_arm.L", x=-35, z=30)
    R.rot(arm, "forearm.L", x=-80, z=40)
    R.rot(arm, "upper_arm.R", x=-12 + 12 * shake, y=20)
    R.rot(arm, "forearm.R", x=-30)


def p_angry(arm, t):
    ph = t * math.tau
    jab = math.sin(ph * 2)
    R.move(arm, "hips", dz=-0.012 * abs(math.sin(ph)))
    R.rot(arm, "chest", x=12 + 3 * jab)
    R.rot(arm, "head", x=10 + 5 * jab, z=5 * math.sin(ph))
    R.rot(arm, "upper_arm.L", x=-92 - 18 * max(0.0, jab), y=-8)
    R.rot(arm, "forearm.L", x=-10)
    R.rot(arm, "upper_arm.R", x=-40, y=30, z=-20)
    R.rot(arm, "forearm.R", x=-70)
    for side, off in (("L", 0.0), ("R", math.pi)):
        stomp = max(0.0, math.sin(ph + off))
        R.rot(arm, f"thigh.{side}", x=14 * stomp)
        R.rot(arm, f"shin.{side}", x=-20 * stomp)


def p_read(arm, t):
    base(arm, t, 0.5)
    R.rot(arm, "upper_arm.R", x=-62, y=12)
    R.rot(arm, "forearm.R", x=-62)
    R.rot(arm, "upper_arm.L", x=-50, y=-12)
    R.rot(arm, "forearm.L", x=-70)
    R.rot(arm, "head", x=18)
    R.rot(arm, "chest", x=6)
    return {"letter": True}


def p_pocket(arm, t):
    k = R.smooth(0.0, 0.5, t)
    base(arm, t, 0.5)
    R.rot(arm, "upper_arm.R", x=-30 * k, z=-35 * k)
    R.rot(arm, "forearm.R", x=-100 * k, z=-30 * k)
    R.rot(arm, "head", x=-4 * k, z=-6 * k)
    return {"letter": t < 0.45}


def p_tip(arm, t):
    k = R.smooth(0.0, 0.4, t) * (1 - R.smooth(0.75, 1.0, t))
    base(arm, t, 0.5)
    R.rot(arm, "upper_arm.L", x=-150 * k, y=-15 * k)
    R.rot(arm, "forearm.L", x=-60 * k)
    R.rot(arm, "head", x=10 * k)


def p_walk(arm, t):
    ph = t * math.tau
    for side, off in (("L", 0.0), ("R", math.pi)):
        p = ph + off
        swing = 26 * math.sin(p)
        R.rot(arm, f"thigh.{side}", x=swing)
        R.rot(arm, f"shin.{side}", x=-(10 + 36 * max(0.0, math.sin(p + 1.3))))
        R.rot(arm, f"upper_arm.{side}", x=-18 * math.sin(p))
    bob = math.cos(2 * ph)
    R.move(arm, "hips", dz=-0.03 - 0.02 * bob)
    R.rot(arm, "chest", x=5, z=5 * math.sin(ph))
    R.rot(arm, "head", x=-2)


POSES = {
    "idle": (p_idle, 8, True), "inspect": (p_inspect, 8, True), "halt": (p_halt, 6, False),
    "listen": (p_listen, 8, True), "laugh": (p_laugh, 10, True), "angry": (p_angry, 10, True),
    "read": (p_read, 6, True), "pocket": (p_pocket, 6, False), "tip": (p_tip, 8, False), "walk": (p_walk, 10, True),
}
WHO_POSES = {
    "pell": ["idle", "inspect", "halt", "listen", "laugh", "tip", "walk"],
    "dunmore": ["idle", "halt", "listen", "angry", "read", "pocket", "walk"],
}
DIRS = {"left": -80.0, "right": 80.0}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--res", type=int, default=288)
    ap.add_argument("--test", action="store_true")
    ap.add_argument("--who", default="pell,dunmore")
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    index = {}
    for who in a.who.split(","):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        R.build_scene(a.res)
        cam = bpy.context.scene.camera
        # People are taller than Rook: frame more of them, same elevation and lights.
        cam.data.ortho_scale = 3.9
        target = Vector((0, 0, 1.55))
        elev = math.radians(12)
        cam.location = target + Vector((0, -6.0 * math.cos(elev), 6.0 * math.sin(elev)))
        parts, letter, ledger, k, stout = build(who)
        arm = rig(parts, k, stout, who)
        poses = ["idle", "halt", "laugh" if who == "pell" else "angry", "walk"] if a.test else WHO_POSES[who]
        for pose in poses:
            fn, frames, loop = POSES[pose]
            if a.test:
                frames = 3
            for d, yaw in DIRS.items():
                arm.rotation_euler = (0, 0, math.radians(yaw))
                files = []
                for i in range(frames):
                    R.reset(arm)
                    t = i / frames if loop else i / max(1, frames - 1)
                    extra = fn(arm, t) or {}
                    letter.hide_render = not extra.get("letter", False)
                    if ledger:
                        ledger.hide_render = pose in ("read", "pocket", "angry")
                    bpy.context.view_layer.update()
                    path = os.path.join(a.out, f"{who}-{pose}-{d}-{i + 1:02d}.png")
                    bpy.context.scene.render.filepath = path
                    bpy.ops.render.render(write_still=True)
                    files.append(os.path.basename(path))
                index.setdefault(f"{who}-{pose}", {})[d] = files
    json.dump(index, open(os.path.join(a.out, "render-index.json"), "w"), indent=1)
    print("RENDERED", len(index))


if __name__ == "__main__":
    main()
