"""
Rig the approved Rook mesh (TRELLIS.2 GLB, unchanged) and render overworld
sprite states from four facings.

The mesh is never edited or regenerated. It is imported exactly as the approved
pipeline imports it (rotate -90 about X, recalc normals, concept projection at the
registered view, normalize to 1.75 units, feet on z=0). An armature is fitted to
landmarks measured on that mesh, and procedural skin weights are computed from
vertex positions (TRELLIS output is one fused shell, so bone-heat weighting is
unreliable on it).

    blender --background --factory-startup --python rook_rig.py -- \
        --out DIR --states all --res 288 [--glb PATH] [--concept PATH]
    python3 pack_atlas.py DIR client/public/assets/goldline/companions/rook/overworld rook 261.5

The approved mesh is not in the repo (10.8 MB). It lives with the rest of the
TRELLIS.2 source in the local asset archive; pass --glb to point elsewhere.
"""
import bpy, sys, os, math, json, argparse
import numpy as np
from mathutils import Vector, Matrix, Euler, Quaternion

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from glb_to_frames import import_glb
from rig import normalize
from project_concept import project, projection_material

GLB = os.environ.get("ROOK_GLB", os.path.expanduser(
    "~/Desktop/goldline-local-archive/from-cargo-payment-badge-worktree/rook/3d-trellis-source/rook.glb"))
CONCEPT = os.path.abspath(os.path.join(HERE, "../../../client/public/assets/goldline/companions/rook-concept-v1.png"))

# ---------------------------------------------------------------- landmarks
LEG_X = 0.13
HIP_Z = 0.52
KNEE_Z = 0.30
ANKLE_Z = 0.07
LEG_Y = -0.13
MOUTH_Z = 1.435
TAIL_A = np.array([0.10, 0.52])   # (y, z) where the tail leaves the body
TAIL_B = np.array([0.66, 0.00])   # (y, z) tail tip on the deck
WING_C = np.array([0.0, 0.92])   # (y, z) centre of the folded wing
WING_R = np.array([0.30, 0.33])

BONES = {
    # name: (head, tail, parent)
    "root": ((0, 0, 0), (0, 0, 0.15), None),
    "hips": ((0, -0.02, 0.50), (0, -0.02, 0.74), "root"),
    "chest": ((0, -0.02, 0.74), (0, -0.10, 1.18), "hips"),
    "neck": ((0, -0.10, 1.18), (0, -0.14, 1.32), "chest"),
    "head": ((0, -0.14, 1.32), (0, -0.14, 1.75), "neck"),
    "jaw": ((0, -0.27, MOUTH_Z + 0.01), (0, -0.70, MOUTH_Z - 0.03), "head"),
    "thigh.L": ((LEG_X, LEG_Y, HIP_Z), (LEG_X, LEG_Y - 0.01, KNEE_Z), "hips"),
    "shin.L": ((LEG_X, LEG_Y - 0.01, KNEE_Z), (LEG_X, LEG_Y - 0.02, ANKLE_Z), "thigh.L"),
    "foot.L": ((LEG_X, LEG_Y - 0.02, ANKLE_Z), (LEG_X, LEG_Y - 0.24, 0.02), "shin.L"),
    "thigh.R": ((-LEG_X, LEG_Y, HIP_Z), (-LEG_X, LEG_Y - 0.01, KNEE_Z), "hips"),
    "shin.R": ((-LEG_X, LEG_Y - 0.01, KNEE_Z), (-LEG_X, LEG_Y - 0.02, ANKLE_Z), "thigh.R"),
    "foot.R": ((-LEG_X, LEG_Y - 0.02, ANKLE_Z), (-LEG_X, LEG_Y - 0.24, 0.02), "shin.R"),
    "tail1": ((0, 0.10, 0.52), (0, 0.29, 0.34), "hips"),
    "tail2": ((0, 0.29, 0.34), (0, 0.48, 0.17), "tail1"),
    "tail3": ((0, 0.48, 0.17), (0, 0.66, 0.0), "tail2"),
    "wing.L": ((0.25, -0.04, 1.13), (0.31, 0.01, 0.70), "chest"),
    "wing.R": ((-0.25, -0.04, 1.13), (-0.31, 0.01, 0.70), "chest"),
    "satchel.L": ((0.30, -0.10, 0.73), (0.32, -0.10, 0.47), "hips"),
    "satchel.R": ((-0.30, -0.10, 0.73), (-0.32, -0.10, 0.47), "hips"),
}


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def load_rook():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objs = import_glb(GLB, -90)
    obj = next(o for o in objs if o.type == "MESH")
    img, mean_body, covered = project(obj, CONCEPT, 38, 14)
    projection_material(obj, img, mean_body)
    normalize(objs)
    bpy.context.view_layer.update()
    # Bake the pivot transform into the mesh data so the armature works in world space.
    mw = obj.matrix_world.copy()
    obj.parent = None
    obj.data.transform(mw)
    obj.matrix_world = Matrix.Identity(4)
    for o in list(bpy.data.objects):
        if o.type == "EMPTY":
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.update()
    return obj


def compute_weights(obj):
    me = obj.data
    n = len(me.vertices)
    co = np.empty(n * 3); me.vertices.foreach_get("co", co); co = co.reshape(n, 3)
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    W = {name: np.zeros(n) for name in BONES if name != "root"}

    # --- tail band in the (y, z) plane
    d = TAIL_B - TAIL_A
    L = np.linalg.norm(d); u = d / L
    rel = np.c_[y, z] - TAIL_A
    t = (rel @ u) / L
    perp = np.abs(rel[:, 0] * u[1] - rel[:, 1] * u[0])
    tail = (perp < 0.075) & (t > -0.05) & (t < 1.08) & (y > 0.04) & (z < 0.56) & (np.abs(x) < 0.36)
    # ground contact: tail tip region vs feet
    tail |= (y > 0.38) & (z < 0.12) & (np.abs(x) < 0.32)
    tw = smooth(-0.02, 0.14, t)            # blend into hips at the root
    W["tail1"][tail] = (tw * (1 - smooth(0.25, 0.42, t)))[tail]
    W["tail2"][tail] = (smooth(0.25, 0.42, t) * (1 - smooth(0.60, 0.76, t)))[tail]
    W["tail3"][tail] = smooth(0.60, 0.76, t)[tail]
    W["hips"][tail] += (1 - tw)[tail]

    # --- legs and feet
    leg_region = (~tail) & (z < HIP_Z + 0.04) & (np.abs(y - LEG_Y) < 0.30)
    for side, sx in (("L", 1.0), ("R", -1.0)):
        dx = np.abs(x - sx * LEG_X)
        near = leg_region & (x * sx > 0.0) & ((dx < 0.10) | (z < 0.11))
        # feet splay wide at the bottom: accept anything on this side below the ankle
        near |= (~tail) & (z < 0.10) & (x * sx > 0.0) & (y < 0.36)
        top = 1 - smooth(HIP_Z - 0.06, HIP_Z + 0.03, z)       # fade into the hips/satchel at the top
        foot = 1 - smooth(ANKLE_Z - 0.01, ANKLE_Z + 0.04, z)
        thigh = smooth(KNEE_Z - 0.02, KNEE_Z + 0.05, z)
        shin = (1 - foot) * (1 - thigh)
        W[f"foot.{side}"][near] = (foot * top)[near]
        W[f"shin.{side}"][near] = (shin * top)[near]
        W[f"thigh.{side}"][near] = (thigh * top * (1 - foot))[near]
        W["hips"][near] += (1 - top)[near]
        leg_region &= ~near

    rest = ~(tail)
    assigned = np.zeros(n, bool)
    for k in ("foot.L", "shin.L", "thigh.L", "foot.R", "shin.R", "thigh.R"):
        assigned |= W[k] > 0
    body = rest & ~assigned

    # --- spine by height
    h = z
    hips = 1 - smooth(0.66, 0.80, h)
    head = smooth(1.24, 1.34, h)
    neck = smooth(1.12, 1.24, h) * (1 - head)
    chest = (1 - hips) * (1 - neck) * (1 - head)
    W["hips"][body] += hips[body]
    W["chest"][body] += chest[body]
    W["neck"][body] += neck[body]
    W["head"][body] += head[body]

    # --- jaw: lower beak, in front of the face and below the mouth line
    jaw = body & (y < -0.27) & (z < MOUTH_Z) & (z > 1.28)
    jw = smooth(-0.27, -0.36, y) * (1 - smooth(MOUTH_Z - 0.012, MOUTH_Z + 0.004, z))
    W["jaw"][jaw] = jw[jaw]
    W["head"][jaw] *= (1 - jw[jaw])

    # --- wings: the folded wing covers each flank from the shoulder down past the satchel
    e = ((y - WING_C[0]) / WING_R[0]) ** 2 + ((z - WING_C[1]) / WING_R[1]) ** 2
    inside = 1 - smooth(0.80, 1.15, e)
    for side, sx in (("L", 1.0), ("R", -1.0)):
        outer = smooth(0.15, 0.24, x * sx)
        ww = inside * outer
        m = body & (ww > 0.01)
        W[f"wing.{side}"][m] = ww[m]
        for k in ("hips", "chest", "neck", "head"):
            W[k][m] *= (1 - ww[m])

    # --- satchels: loose kit at the hips
    for side, sx in (("L", 1.0), ("R", -1.0)):
        s = body & (x * sx > 0.2) & (z > 0.40) & (z < 0.76) & (y < 0.3)
        sw = smooth(0.2, 0.28, x * sx) * (1 - smooth(0.70, 0.77, z)) * 0.8
        W[f"satchel.{side}"][s] = sw[s]
        for k in ("hips", "chest"):
            W[k][s] *= (1 - sw[s])

    # normalise
    total = sum(W.values())
    total[total < 1e-6] = 1.0
    for k in W:
        W[k] = W[k] / total
    orphan = (sum(W.values()) < 0.5)
    W["hips"][orphan] = 1.0
    stats = {k: int((v > 0.5).sum()) for k, v in W.items()}
    print("WEIGHTS", json.dumps(stats))
    return W


def build_armature(obj, W):
    arm_data = bpy.data.armatures.new("rook_armature")
    arm = bpy.data.objects.new("rook_armature", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones
    for name, (h, t, parent) in BONES.items():
        b = eb.new(name)
        b.head = Vector(h); b.tail = Vector(t)
        b.roll = 0.0
    for name, (h, t, parent) in BONES.items():
        if parent:
            eb[name].parent = eb[parent]
            eb[name].use_connect = False
    # Align rolls so local X is world X for sagittal bones (flex about world X).
    for b in eb:
        b.align_roll(Vector((0, 0, 1)) if abs((b.tail - b.head).normalized().z) < 0.7 else Vector((0, -1, 0)))
    bpy.ops.object.mode_set(mode="OBJECT")
    for name, w in W.items():
        vg = obj.vertex_groups.new(name=name)
        idx = np.nonzero(w > 0.002)[0]
        for i in idx:
            vg.add([int(i)], float(w[i]), "REPLACE")
    mod = obj.modifiers.new("armature", "ARMATURE")
    mod.object = arm
    obj.parent = arm
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
    return arm


# ---------------------------------------------------------------- posing
def reset(arm):
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)


def rot(arm, bone, x=0.0, y=0.0, z=0.0):
    """Degrees, applied in world-ish axes: x = pitch (flex forward/back), y = roll, z = yaw."""
    pb = arm.pose.bones[bone]
    # Convert a world-axis rotation into the bone's local frame at rest.
    rest = pb.bone.matrix_local.to_3x3()
    q = Euler((math.radians(x), math.radians(y), math.radians(z)), "XYZ").to_matrix()
    local = rest.inverted() @ q @ rest
    pb.rotation_euler = local.to_euler("XYZ")


def move(arm, bone, dx=0.0, dy=0.0, dz=0.0):
    pb = arm.pose.bones[bone]
    rest = pb.bone.matrix_local.to_3x3()
    pb.location = rest.inverted() @ Vector((dx, dy, dz))


def pose_idle(arm, t):
    """Standing easy: breathing, weight on one leg, a slow look around. Never still."""
    ph = t * math.tau
    breathe = math.sin(ph)
    move(arm, "hips", dx=0.01 * math.sin(ph * 0.5), dz=-0.004 + 0.006 * breathe)
    rot(arm, "hips", y=2.0 * math.sin(ph * 0.5))
    rot(arm, "thigh.L", x=2 * math.sin(ph * 0.5)); rot(arm, "thigh.R", x=-2 * math.sin(ph * 0.5))
    rot(arm, "chest", x=-3 + 1.2 * breathe, y=-1.5 * math.sin(ph * 0.5))
    look = math.sin(ph * 0.5)
    rot(arm, "neck", x=1.5 - 1.0 * breathe, z=10 * look)
    rot(arm, "head", x=-1.5 * breathe + 3 * max(0.0, math.sin(ph)), z=12 * look, y=4 * math.sin(ph * 0.5 + 1.2))
    rot(arm, "tail1", z=3 * math.sin(ph + 0.8))
    rot(arm, "tail2", z=4 * math.sin(ph + 0.3))
    rot(arm, "tail3", z=5 * math.sin(ph - 0.2))
    rot(arm, "wing.L", y=-1.5 * breathe)
    rot(arm, "wing.R", y=1.5 * breathe)
    rot(arm, "satchel.L", x=1.2 * math.sin(ph - 0.6))
    rot(arm, "satchel.R", x=1.2 * math.sin(ph - 0.6))


def leg(arm, side, swing, knee, foot):
    rot(arm, f"thigh.{side}", x=swing)
    rot(arm, f"shin.{side}", x=-knee)
    rot(arm, f"foot.{side}", x=foot)


def pose_walk(arm, t):
    """A small person's walk with a little swagger: heel-strike, passing, push-off.
    Chest up, head level. No hopping and no pigeon head-bob."""
    ph = t * math.tau
    for side, off in (("L", 0.0), ("R", math.pi)):
        p = ph + off
        swing = 34 * math.sin(p)                         # + = foot forward
        lift = max(0.0, math.sin(p + math.pi * 0.45))    # swing phase: foot travelling forward
        knee = 8 + 46 * lift ** 1.5 if math.cos(p) > -0.25 else 8
        foot = -0.55 * swing + 14 * max(0.0, -math.cos(p)) * max(0.0, -math.sin(p)) - 4
        leg(arm, side, swing, knee, foot)
    bob = math.cos(2 * ph)
    move(arm, "hips", dx=0.014 * math.sin(ph), dz=-0.03 - 0.02 * bob)
    rot(arm, "hips", y=4 * math.sin(ph), z=-6 * math.sin(ph))
    rot(arm, "chest", x=-6 + 1.5 * bob, z=8 * math.sin(ph), y=-2.5 * math.sin(ph))
    rot(arm, "neck", x=3, z=-5 * math.sin(ph))
    rot(arm, "head", x=-2 + 1.0 * bob, z=-3 * math.sin(ph), y=3 * math.sin(ph))
    rot(arm, "wing.L", x=-16 * math.sin(ph), y=-4)
    rot(arm, "wing.R", x=16 * math.sin(ph), y=4)
    rot(arm, "tail1", z=8 * math.sin(ph - 0.7), x=-4 + 2 * bob)
    rot(arm, "tail2", z=9 * math.sin(ph - 1.2))
    rot(arm, "tail3", z=10 * math.sin(ph - 1.7))
    rot(arm, "satchel.L", x=7 * math.sin(2 * ph - 0.9), y=-2)
    rot(arm, "satchel.R", x=7 * math.sin(2 * ph - 0.9), y=2)


def beak(arm, t, scale=1.0):
    ph = t * math.tau
    open_ = max(0.0, math.sin(ph * 3) * 0.6 + math.sin(ph * 5 + 1.1) * 0.5 + 0.2)
    rot(arm, "jaw", x=-30 * min(1.0, open_) * scale)


def pose_talk(arm, t):
    """Talking to someone he has decided to charm: beak going, near wing working."""
    ph = t * math.tau
    pose_idle(arm, t * 0.5)
    beak(arm, t)
    rot(arm, "head", x=-4 * math.sin(ph * 2), z=9 * math.sin(ph), y=7 * math.sin(ph * 2 + 0.5))
    rot(arm, "chest", x=-4 + 2.5 * math.sin(ph * 2), z=5 * math.sin(ph))
    g = max(0.0, math.sin(ph * 2 + 0.3))
    rot(arm, "wing.L", x=-25 - 35 * g, y=-20 - 25 * g)
    rot(arm, "wing.R", x=-8 * math.sin(ph), y=6)


def pose_confide(arm, t):
    """Leaning in, voice down. The beak moves less; the whole body says 'between us'."""
    ph = t * math.tau
    pose_idle(arm, t * 0.5)
    beak(arm, t, 0.55)
    move(arm, "hips", dz=-0.03)
    rot(arm, "thigh.L", x=10); rot(arm, "thigh.R", x=10)
    rot(arm, "shin.L", x=-14); rot(arm, "shin.R", x=-14)
    rot(arm, "chest", x=16 + 2 * math.sin(ph))
    rot(arm, "neck", x=8)
    rot(arm, "head", x=-6, z=6 * math.sin(ph))
    rot(arm, "wing.L", x=-45 - 10 * math.sin(ph * 2), y=-30)


def pose_wait(arm, t):
    """'Wait here.' The near wing comes up, palm out; head turns toward her; beak says it."""
    k = smooth(0.0, 0.3, t) * (1 - smooth(0.82, 1.0, t))
    pose_idle(arm, t * 0.4)
    rot(arm, "wing.R", x=-38 * k, y=78 * k, z=-8 * k)
    rot(arm, "chest", x=-5 * k, z=-8 * k, y=4 * k)
    rot(arm, "head", z=-10 * k, x=7 * k, y=-6 * k)
    speak = smooth(0.3, 0.36, t) * (1 - smooth(0.55, 0.62, t))
    rot(arm, "jaw", x=-26 * speak * (0.6 + 0.4 * math.sin(t * 40)))


def pose_letter(arm, t):
    """Reach into the satchel, come out with a sealed letter, hold it out."""
    reach = smooth(0.0, 0.25, t) * (1 - smooth(0.35, 0.55, t))
    out = smooth(0.42, 0.66, t)
    pose_idle(arm, t * 0.3)
    rot(arm, "wing.L", x=-15 * reach - 88 * out, y=-40 * reach - 18 * out, z=6 * out)
    rot(arm, "chest", x=-10 * reach + 8 * out, z=12 * reach - 6 * out)
    rot(arm, "head", x=14 * reach - 6 * out)
    rot(arm, "hips", z=6 * reach)
    return {"letter": out > 0.05}


def pose_dangle(arm, t):
    """Hanging on to her as the line takes them: wings up, feet paddling air."""
    ph = t * math.tau
    rot(arm, "wing.L", x=-158, y=-14)
    rot(arm, "wing.R", x=-158, y=14)
    rot(arm, "chest", x=-8)
    for side, off in (("L", 0.0), ("R", math.pi)):
        p = ph + off
        leg(arm, side, 28 * math.sin(p), 30 + 26 * max(0.0, math.sin(p + 1)), 14)
    rot(arm, "tail1", x=-22 + 6 * math.sin(ph * 2), z=12 * math.sin(ph))
    rot(arm, "tail2", x=-10, z=10 * math.sin(ph - 0.6))
    rot(arm, "jaw", x=-24)
    rot(arm, "head", x=-14)


def pose_shrug(arm, t):
    """'Nothing untrue.' Both wings lift a little, head tips, and settles."""
    k = smooth(0.0, 0.35, t) * (1 - smooth(0.7, 1.0, t))
    pose_idle(arm, t * 0.3)
    rot(arm, "wing.L", x=-22 * k, y=-38 * k)
    rot(arm, "wing.R", x=-22 * k, y=38 * k)
    move(arm, "chest", dz=0.02 * k)
    rot(arm, "chest", x=-4 * k)
    rot(arm, "head", y=14 * k, z=-8 * k, x=-4 * k)
    speak = smooth(0.15, 0.22, t) * (1 - smooth(0.5, 0.58, t))
    rot(arm, "jaw", x=-22 * speak * (0.6 + 0.4 * math.sin(t * 36)))


def pose_brace(arm, t):
    """The deck lurches: drop the hips, wings out for balance, tail up."""
    k = smooth(0.0, 0.25, t) * (1 - smooth(0.75, 1.0, t))
    wob = math.sin(t * math.tau * 2) * k
    move(arm, "hips", dz=-0.09 * k, dx=0.02 * wob)
    for side, sx in (("L", 1.0), ("R", -1.0)):
        rot(arm, f"thigh.{side}", x=26 * k, y=-8 * sx * k)
        rot(arm, f"shin.{side}", x=-40 * k)
        rot(arm, f"foot.{side}", x=14 * k)
    rot(arm, "chest", x=14 * k, y=6 * wob)
    rot(arm, "wing.L", x=-20 * k, y=-62 * k)
    rot(arm, "wing.R", x=-20 * k, y=62 * k)
    rot(arm, "tail1", x=-20 * k)
    rot(arm, "head", x=-12 * k)
    rot(arm, "jaw", x=-18 * k)


def pose_point(arm, t):
    """'There.' Near wing out toward something, head along it."""
    k = smooth(0.0, 0.3, t)
    pose_idle(arm, t * 0.3)
    rot(arm, "wing.L", x=-92 * k, y=-26 * k, z=10 * k)
    rot(arm, "chest", z=10 * k, x=-4 * k)
    rot(arm, "head", z=10 * k, x=-6 * k)
    speak = smooth(0.35, 0.4, t) * (1 - smooth(0.55, 0.6, t))
    rot(arm, "jaw", x=-22 * speak)


# state: (pose fn, frames, looping, facings)
POSES = {
    "idle": (pose_idle, 12, True, ("front", "back", "left", "right")),
    "walk": (pose_walk, 10, True, ("front", "back", "left", "right")),
    "talk": (pose_talk, 10, True, ("front", "back", "left", "right")),
    "confide": (pose_confide, 8, True, ("back", "left", "right")),
    "wait": (pose_wait, 10, False, ("front", "left", "right")),
    "letter": (pose_letter, 12, False, ("back", "left", "right")),
    "dangle": (pose_dangle, 6, True, ("back", "left", "right")),
    "shrug": (pose_shrug, 8, False, ("front", "left", "right")),
    "brace": (pose_brace, 6, False, ("front", "back", "left", "right")),
    "point": (pose_point, 6, False, ("back", "left", "right")),
}
LOOPING = {k for k, v in POSES.items() if v[2]}

# Facing = where Rook looks on screen. The camera looks along +Y; Rook rests facing -Y.
DIRS = {"front": 8.0, "back": 188.0, "left": -78.0, "right": 78.0}


# ---------------------------------------------------------------- scene
def build_scene(res):
    scn = bpy.context.scene
    scn.render.engine = "BLENDER_EEVEE"
    scn.render.resolution_x = scn.render.resolution_y = res
    scn.render.film_transparent = True
    scn.render.image_settings.file_format = "PNG"
    scn.render.image_settings.color_mode = "RGBA"
    scn.view_settings.view_transform = "Standard"
    try:
        scn.eevee.taa_render_samples = 32
    except Exception:
        pass
    cam_data = bpy.data.cameras.new("cam"); cam_data.type = "ORTHO"; cam_data.ortho_scale = 2.35
    cam = bpy.data.objects.new("cam", cam_data); scn.collection.objects.link(cam); scn.camera = cam
    elev = math.radians(12)
    target = Vector((0, 0, 0.98))
    dist = 6.0
    cam.location = target + Vector((0, -dist * math.cos(elev), dist * math.sin(elev)))
    cam.rotation_euler = (math.radians(90) - elev, 0, 0)
    # World-space lights to match the Wayward plates: low sun beyond the city (behind, left),
    # cool open-sky fill from the camera side, warm deck bounce from below.
    def area(name, loc, energy, size, color, look=(0, 0, 0.9)):
        d = bpy.data.lights.new(name, "AREA"); d.energy = energy; d.size = size; d.color = color
        o = bpy.data.objects.new(name, d); scn.collection.objects.link(o); o.location = loc
        direction = Vector(look) - Vector(loc)
        o.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        return o
    area("sun_rim", (-2.8, 4.2, 3.6), 620, 2.5, (1.0, 0.72, 0.42))
    area("sky_fill", (2.2, -4.2, 3.2), 150, 5.0, (0.74, 0.84, 1.0))
    area("key_front", (-2.6, -3.4, 3.4), 330, 3.0, (1.0, 0.93, 0.84))
    area("deck_bounce", (0.4, -2.0, -1.2), 45, 5.0, (1.0, 0.72, 0.45))
    return scn


def add_letter(arm):
    """A sealed letter from Rook's satchel, carried in the left wing tip for the handoff."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.032, depth=0.2)
    scroll = bpy.context.active_object; scroll.name = "letter"
    m = bpy.data.materials.new("letter_paper"); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]; b.inputs["Base Color"].default_value = (0.93, 0.86, 0.66, 1); b.inputs["Roughness"].default_value = 0.9
    scroll.data.materials.append(m)
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.022, depth=0.012)
    seal = bpy.context.active_object; seal.name = "seal"
    ms = bpy.data.materials.new("letter_seal"); ms.use_nodes = True
    bs = ms.node_tree.nodes["Principled BSDF"]; bs.inputs["Base Color"].default_value = (0.62, 0.05, 0.04, 1); bs.inputs["Roughness"].default_value = 0.4
    seal.data.materials.append(ms)
    seal.parent = scroll; seal.location = (0.0, -0.034, 0.0); seal.rotation_euler = (math.radians(90), 0, 0)
    tip = arm.pose.bones["wing.L"]
    scroll.parent = arm; scroll.parent_type = "BONE"; scroll.parent_bone = "wing.L"
    # parent_bone places the child at the bone's tail; nudge it into the wing tip, lying across
    scroll.location = (0.0, -0.04, -0.03)
    scroll.rotation_euler = (0, math.radians(90), math.radians(20))
    for o in (scroll, seal):
        o.hide_render = True
    return (scroll, seal)


def render_state(arm, obj, state, dirs, out_dir, res, frames_override=None, props=None):
    fn, frames, looping, facings = POSES[state]
    if frames_override:
        frames = frames_override
    dirs = [d for d in dirs if d in facings]
    files = {}
    for d in dirs:
        arm.rotation_euler = (0, 0, math.radians(DIRS[d]))
        files[d] = []
        for i in range(frames):
            reset(arm)
            t = i / frames if looping else (i / max(1, frames - 1))
            extra = fn(arm, t) or {}
            for p in (props or ()):
                p.hide_render = not extra.get("letter", False)
            bpy.context.view_layer.update()
            path = os.path.join(out_dir, f"rook-{state}-{d}-{i + 1:02d}.png")
            bpy.context.scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            files[d].append(os.path.basename(path))
    return files


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--states", default="idle,walk")
    ap.add_argument("--dirs", default="front,back,left,right")
    ap.add_argument("--res", type=int, default=384)
    ap.add_argument("--frames", type=int, default=0)
    ap.add_argument("--blend", default="")
    ap.add_argument("--glb", default=GLB)
    ap.add_argument("--concept", default=CONCEPT)
    a = ap.parse_args(argv)
    globals()["GLB"], globals()["CONCEPT"] = a.glb, a.concept
    os.makedirs(a.out, exist_ok=True)
    obj = load_rook()
    W = compute_weights(obj)
    arm = build_armature(obj, W)
    build_scene(a.res)
    if a.blend:
        bpy.ops.wm.save_as_mainfile(filepath=a.blend)
    props = add_letter(arm)
    result = {}
    states = list(POSES) if a.states == "all" else [s for s in a.states.split(",") if s]
    for state in states:
        result[state] = render_state(arm, obj, state, [d for d in a.dirs.split(",") if d], a.out, a.res,
                                     a.frames or None, props if state == "letter" else None)
        for p in props:
            p.hide_render = True
    json.dump(result, open(os.path.join(a.out, "render-index.json"), "w"), indent=1)
    print("RENDERED", json.dumps({k: {d: len(v) for d, v in s.items()} for k, s in result.items()}))


if __name__ == "__main__":
    main()
