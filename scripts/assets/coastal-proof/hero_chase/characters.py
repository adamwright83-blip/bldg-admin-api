"""The two characters of the hero chase.

ROOK: the approved TRELLIS.2 mesh with the approved concept projection and his existing procedural
rig (scripts/assets/blender/rook_rig.py), at ROOK_RATIO of Trailblazer's height. His motion is
authored here as pose functions of time (the same method as his sprite states), baked to keyframes.

TRAILBLAZER: the VRoid character (the game's current Trailblazer, trailblazer.vrm). Her body motion
is the Quaternius animation library retargeted onto her humanoid rig in the same way the runtime
does it (vrmHero.ts): each bone's rotation away from its T-pose bind, in the character's own space,
carries over to the matching bone. Her ponytail and hair are simulated as spring chains.
"""

import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

from common import REPO, SOURCES, FPS, collection, link

BLENDER_DIR = os.path.join(REPO, "scripts", "assets", "blender")
if BLENDER_DIR not in sys.path:
    sys.path.insert(0, BLENDER_DIR)

TRAILBLAZER_HEIGHT = 1.66
ROOK_RATIO = 0.62


# =================================================================== Rook

def load_rook():
    import rook_rig as RR
    from glb_to_frames import import_glb
    from project_concept import project, projection_material
    from rig import normalize

    objs = import_glb(RR.GLB, -90)
    obj = next(o for o in objs if o.type == "MESH")
    img, mean_body, _ = project(obj, RR.CONCEPT, 38, 14)
    projection_material(obj, img, mean_body)
    normalize(objs)
    bpy.context.view_layer.update()
    mw = obj.matrix_world.copy()
    obj.parent = None
    obj.data.transform(mw)
    obj.matrix_world = Matrix.Identity(4)
    for o in objs:
        if o.type == "EMPTY":
            bpy.data.objects.remove(o, do_unlink=True)
    for o in [o for o in bpy.data.objects if o.type == "EMPTY" and o.name.startswith("Empty")]:
        bpy.data.objects.remove(o, do_unlink=True)
    W = RR.compute_weights(obj)
    arm = RR.build_armature(obj, W)
    obj.name = "rook_mesh"
    arm.name = "rook_armature"
    root = bpy.data.objects.new("rook_root", None)
    link(root)
    arm.parent = root
    s = TRAILBLAZER_HEIGHT * ROOK_RATIO / RR.TARGET_HEIGHT if hasattr(RR, "TARGET_HEIGHT") else TRAILBLAZER_HEIGHT * ROOK_RATIO / 1.75
    root.scale = (s, s, s)
    for o in (obj, arm, root):
        for c in o.users_collection:
            c.objects.unlink(o)
        collection("rook").objects.link(o)
    # a touch of sheen and a warmer rim on the feathers; keep the approved colour
    m = obj.data.materials[0]
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 0.7
    bsdf.inputs["Sheen Weight"].default_value = 0.35
    bsdf.inputs["Sheen Roughness"].default_value = 0.35
    return root, arm, obj


class RookPose:
    """Pose functions over his rig. Angles in degrees in his own frame (x pitch, y roll, z yaw)."""

    def __init__(self, arm):
        import rook_rig as RR
        self.RR = RR
        self.arm = arm

    def reset(self):
        self.RR.reset(self.arm)

    def rot(self, bone, x=0.0, y=0.0, z=0.0):
        self.RR.rot(self.arm, bone, x, y, z)

    def move(self, bone, dx=0.0, dy=0.0, dz=0.0):
        self.RR.move(self.arm, bone, dx, dy, dz)

    def legs(self, thigh, knee, foot, split=0.0):
        for side, s in (("L", 1), ("R", -1)):
            self.rot(f"thigh.{side}", x=thigh + split * s)
            self.rot(f"shin.{side}", x=-knee)
            self.rot(f"foot.{side}", x=foot)

    def wings(self, flare=0.0, lift=0.0, pump=0.0):
        """flare: wings out from the flanks (deg); lift: wing tips up; pump: a flap phase value."""
        self.rot("wing.L", y=-flare - pump, x=-lift)
        self.rot("wing.R", y=flare + pump, x=-lift)

    def tail(self, up=0.0, sway=0.0, t=0.0):
        self.rot("tail1", x=-up * 0.5, z=sway * math.sin(t * 6.0))
        self.rot("tail2", x=-up * 0.3, z=sway * math.sin(t * 6.0 - 0.6))
        self.rot("tail3", x=-up * 0.2, z=sway * math.sin(t * 6.0 - 1.2))

    def head(self, yaw=0.0, pitch=0.0, tilt=0.0, beak=0.0):
        self.rot("neck", x=pitch * 0.4, z=yaw * 0.45)
        self.rot("head", x=pitch * 0.6, z=yaw * 0.55, y=tilt)
        self.rot("jaw", x=-beak)

    # --- composed poses, each a function of a 0..1 amount or of time

    def perch(self, t, look_yaw=0.0, look_pitch=0.0, tilt=0.0, amused=0.0, lean=0.0):
        ph = t * math.tau * 0.8
        br = math.sin(ph)
        self.move("hips", dz=-0.01 + 0.006 * br)
        self.rot("chest", x=-4 + 1.2 * br - lean)
        self.legs(3, 8, -3)
        self.wings(flare=2 + 1.5 * br)
        self.tail(up=4, sway=4, t=t)
        laugh = amused * max(0.0, math.sin(t * 22.0)) * 0.6 + amused * 0.4
        self.head(look_yaw, look_pitch, tilt, beak=18 * laugh)

    def crouch(self, k, look_yaw=0.0):
        self.move("hips", dz=-0.16 * k, dy=0.04 * k)
        self.rot("hips", x=18 * k)
        self.rot("chest", x=-26 * k)
        self.legs(38 * k, 70 * k, -30 * k)
        self.wings(flare=10 * k, lift=6 * k)
        self.tail(up=30 * k)
        self.head(look_yaw, pitch=16 * k)

    def leap(self, k, t):
        """Launched: legs driving back, body long, wings flaring for lift."""
        self.move("hips", dz=0.04 * k)
        self.rot("hips", x=-8 * k)
        self.rot("chest", x=-32 * k)
        self.legs(-26 * k, 10 * k, 30 * k)
        self.wings(flare=62 * k, lift=10 * k, pump=14 * k * math.sin(t * 34))
        self.tail(up=-18 * k)
        self.head(0, pitch=-8 * k)

    def tuck(self, k, t):
        """At the top of the arc: knees up, wings wide, tail fanned."""
        self.rot("chest", x=-18 * k)
        self.legs(62 * k, 95 * k, -20 * k)
        self.wings(flare=70 * k, lift=20 * k, pump=10 * k * math.sin(t * 30))
        self.tail(up=10 * k)
        self.head(0, pitch=-4 * k)

    def land(self, k, look_yaw=0.0):
        self.move("hips", dz=-0.14 * k)
        self.rot("hips", x=12 * k)
        self.rot("chest", x=-14 * k)
        self.legs(30 * k, 62 * k, -26 * k)
        self.wings(flare=40 * k, lift=26 * k)
        self.tail(up=24 * k)
        self.head(look_yaw, pitch=-6 * k)

    def scurry(self, t, speed=1.0, look_yaw=0.0):
        """A fast strut: the walk cycle, quicker, leaning in, wings pumping for balance."""
        ph = t * math.tau * (2.6 * speed)
        for side, off in (("L", 0.0), ("R", math.pi)):
            p = ph + off
            swing = 40 * math.sin(p)
            lift = max(0.0, math.sin(p + math.pi * 0.45))
            knee = 10 + 60 * lift ** 1.4
            self.rot(f"thigh.{side}", x=swing)
            self.rot(f"shin.{side}", x=-knee)
            self.rot(f"foot.{side}", x=-0.5 * swing - 6)
        bob = math.cos(2 * ph)
        self.move("hips", dz=-0.05 - 0.03 * bob)
        self.rot("hips", z=-7 * math.sin(ph))
        self.rot("chest", x=-20 + 3 * bob, z=9 * math.sin(ph))
        self.wings(flare=14 + 8 * math.sin(ph * 2), lift=6)
        self.tail(up=12, sway=10, t=t * 2)
        self.head(look_yaw, pitch=4)

    def surf(self, t, look_yaw=-70.0):
        """Riding a rope down: sideways stance, low, wings out for balance, looking at her."""
        self.move("hips", dz=-0.1)
        self.rot("hips", z=70, x=10)
        self.rot("chest", x=-16, z=-30)
        self.legs(20, 46, -20, split=18)
        self.wings(flare=48 + 6 * math.sin(t * 12), lift=12)
        self.tail(up=18, sway=6, t=t)
        self.head(look_yaw, pitch=10, tilt=-8, beak=10)

    def salute(self, t, k):
        """At the top: one wing to the hat brim, a laugh."""
        self.perch(t, look_yaw=-18, look_pitch=14, tilt=10, amused=k)
        self.rot("wing.R", y=40 * k, x=-95 * k)
        self.rot("chest", x=-2 - 4 * k, z=-10 * k)


# =================================================================== Trailblazer

def load_trailblazer():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.vrm(filepath=os.path.join(SOURCES, "vroid", "trailblazer.vrm"))
    objs = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in objs if o.type == "ARMATURE")
    arm.name = "tb_armature"
    root = bpy.data.objects.new("tb_root", None)
    link(root)
    arm.parent = root
    coll = collection("trailblazer")
    for o in objs + [root]:
        for c in o.users_collection:
            c.objects.unlink(o)
        coll.objects.link(o)
        if o.type == "EMPTY" and o is not root:
            o.hide_render = True
    meshes = [o for o in objs if o.type == "MESH"]
    return root, arm, meshes


def restyle_trailblazer(meshes):
    """Keep her VRoid textures and cel-shaded read, but let the scene's sun, sky and shadows land
    on her: each MToon material's lit texture becomes the base colour of a soft, skin-aware
    Principled surface with a sun-side rim. Eyes, brows and lashes stay unlit (as authored)."""
    done = {}
    for ob in meshes:
        for slot in ob.material_slots:
            m = slot.material
            if not m or m.name in done:
                continue
            tex = None
            alpha_clip = False
            if m.use_nodes:
                imgs = [n for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image]
                # the lit colour texture is the MToon "lit" or base colour image
                for n in imgs:
                    nm = (n.label + n.name + n.image.name).lower()
                    if "shade" in nm or "normal" in nm or "emission" in nm or "matcap" in nm or "rim" in nm:
                        continue
                    tex = n.image
                    break
                if tex is None and imgs:
                    tex = imgs[0].image
            # VRoid keeps recolours (the olive shorts) in the MToon base colour factor, not the texture
            factor = (1.0, 1.0, 1.0, 1.0)
            try:
                mt = m.vrm_addon_extension.mtoon1
                factor = tuple(mt.pbr_metallic_roughness.base_color_factor)
                src = mt.pbr_metallic_roughness.base_color_texture.index.source
                if src:
                    tex = src
            except Exception as err:
                print("[hero] mtoon read", m.name, err)
            name = m.name.lower()
            unlit = any(k in name for k in ("eye", "brow", "lash", "eyeline", "facemouth"))
            skin = "skin" in name
            hair = "hair" in name
            nm = bpy.data.materials.new("tb_" + m.name.split(" (")[0])
            nm.use_nodes = True
            nt = nm.node_tree
            nt.nodes.clear()
            out = nt.nodes.new("ShaderNodeOutputMaterial")
            t = nt.nodes.new("ShaderNodeTexImage")
            if tex:
                t.image = tex
            if unlit:
                em = nt.nodes.new("ShaderNodeEmission")
                em.inputs["Strength"].default_value = 0.9
                nt.links.new(t.outputs["Color"], em.inputs["Color"])
                tr = nt.nodes.new("ShaderNodeBsdfTransparent")
                mix = nt.nodes.new("ShaderNodeMixShader")
                nt.links.new(t.outputs["Alpha"], mix.inputs["Fac"])
                nt.links.new(tr.outputs["BSDF"], mix.inputs[1])
                nt.links.new(em.outputs["Emission"], mix.inputs[2])
                nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
            else:
                b = nt.nodes.new("ShaderNodeBsdfPrincipled")
                mul = nt.nodes.new("ShaderNodeMix")
                mul.data_type = "RGBA"
                mul.blend_type = "MULTIPLY"
                mul.inputs["Factor"].default_value = 1.0
                nt.links.new(t.outputs["Color"], mul.inputs["A"])
                mul.inputs["B"].default_value = (factor[0], factor[1], factor[2], 1.0)
                nt.links.new(mul.outputs["Result"], b.inputs["Base Color"])
                nt.links.new(t.outputs["Alpha"], b.inputs["Alpha"])
                b.inputs["Roughness"].default_value = 0.55 if hair else (0.62 if skin else 0.8)
                b.inputs["Specular IOR Level"].default_value = 0.35 if skin else 0.25
                if skin:
                    b.inputs["Subsurface Weight"].default_value = 0.18
                    b.inputs["Subsurface Radius"].default_value = (1.0, 0.35, 0.2)
                    b.inputs["Subsurface Scale"].default_value = 0.02
                if hair:
                    b.inputs["Coat Weight"].default_value = 0.15
                    b.inputs["Sheen Weight"].default_value = 0.3
                nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
            nm.use_backface_culling = False
            if hasattr(nm, "surface_render_method"):
                nm.surface_render_method = "DITHERED"
            done[m.name] = nm
        for slot in ob.material_slots:
            if slot.material and slot.material.name in done:
                slot.material = done[slot.material.name]


# --------------------------------------------------------------- retargeting

VRM_MAP = {
    "pelvis": "J_Bip_C_Hips", "spine_01": "J_Bip_C_Spine", "spine_02": "J_Bip_C_Chest",
    "spine_03": "J_Bip_C_UpperChest", "neck_01": "J_Bip_C_Neck", "Head": "J_Bip_C_Head",
}
for _s, _v in (("l", "L"), ("r", "R")):
    VRM_MAP.update({
        f"clavicle_{_s}": f"J_Bip_{_v}_Shoulder", f"upperarm_{_s}": f"J_Bip_{_v}_UpperArm",
        f"lowerarm_{_s}": f"J_Bip_{_v}_LowerArm", f"hand_{_s}": f"J_Bip_{_v}_Hand",
        f"thigh_{_s}": f"J_Bip_{_v}_UpperLeg", f"calf_{_s}": f"J_Bip_{_v}_LowerLeg",
        f"foot_{_s}": f"J_Bip_{_v}_Foot", f"ball_{_s}": f"J_Bip_{_v}_ToeBase",
        f"thumb_01_{_s}": f"J_Bip_{_v}_Thumb1", f"thumb_02_{_s}": f"J_Bip_{_v}_Thumb2",
        f"thumb_03_{_s}": f"J_Bip_{_v}_Thumb3",
    })
    for _q, _n in (("index", "Index"), ("middle", "Middle"), ("ring", "Ring"), ("pinky", "Little")):
        for _i in (1, 2, 3):
            VRM_MAP[f"{_q}_0{_i}_{_s}"] = f"J_Bip_{_v}_{_n}{_i}"


class ClipLibrary:
    """The Quaternius clips on their own armature, sampled at any clip time."""

    def __init__(self):
        before_o = set(bpy.data.objects)
        before_a = set(bpy.data.actions)
        base = os.path.join(SOURCES, "quaternius")
        for f in ("Universal Animation Library[Standard]/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb",
                  "Universal Animation Library 2[Standard]/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb"):
            bpy.ops.import_scene.gltf(filepath=os.path.join(base, f))
        new = [o for o in bpy.data.objects if o not in before_o]
        arms = [o for o in new if o.type == "ARMATURE"]
        self.arm = arms[0]
        keep = self.arm.name
        doomed = [o.name for o in new if o.name != keep and o.type in ("ARMATURE", "MESH")]
        for n in doomed:
            if n in bpy.data.objects:
                bpy.data.objects.remove(bpy.data.objects[n], do_unlink=True)
        self.arm = bpy.data.objects[keep]
        coll = collection("clip_rig")
        for c in self.arm.users_collection:
            c.objects.unlink(self.arm)
        coll.objects.link(self.arm)
        self.arm.hide_render = True
        self.actions = {a.name.split(".")[0]: a for a in bpy.data.actions if a not in before_a}
        if not self.arm.animation_data:
            self.arm.animation_data_create()
        self.rest = {b.name: b.matrix_local.copy() for b in self.arm.data.bones}

    def length(self, name):
        a = self.actions[name]
        return (a.frame_range[1] - a.frame_range[0]) / FPS

    def sample(self, name, t, loop=True):
        """{bone: (armature-space rotation delta from rest, armature-space head position)} at clip time t."""
        a = self.actions[name]
        f0, f1 = a.frame_range
        f = f0 + t * FPS
        if loop:
            f = f0 + ((t * FPS) % max(1e-6, f1 - f0))
        else:
            f = min(f1, max(f0, f))
        ad = self.arm.animation_data
        ad.action = a
        if hasattr(ad, "action_slot") and a.slots:
            ad.action_slot = a.slots[0]
        sc = bpy.context.scene
        fi = int(math.floor(f))
        sc.frame_set(fi, subframe=f - fi)
        out = {}
        for pb in self.arm.pose.bones:
            if pb.name not in VRM_MAP:
                continue
            rest = self.rest[pb.name]
            q = pb.matrix.to_quaternion() @ rest.to_quaternion().inverted()
            out[pb.name] = (q, pb.matrix.translation.copy())
        return out

    def ground_speed(self, name):
        """Speed of the planted foot (m/s) over one loop of an in-place locomotion clip."""
        n = 48
        L = self.length(name)
        pos = {"ball_l": [], "ball_r": []}
        for i in range(n + 1):
            t = L * i / n
            self.sample(name, t)
            for k in pos:
                pos[k].append(self.arm.pose.bones[k].matrix.translation.copy())
        speeds = []
        for k, P in pos.items():
            zmin = min(p.z for p in P)
            for i in range(n):
                if P[i].z < zmin + 0.03 and P[i + 1].z < zmin + 0.03:
                    speeds.append((P[i + 1].xy - P[i].xy).length / (L / n))
        speeds.sort()
        return speeds[len(speeds) // 2] if speeds else 0.0


def blend_samples(a, b, k):
    if k <= 0:
        return a
    if k >= 1:
        return b
    out = {}
    for name, (qa, pa) in a.items():
        qb, pb_ = b.get(name, (qa, pa))
        out[name] = (qa.slerp(qb, k), pa.lerp(pb_, k))
    return out


class Retarget:
    """Writes a sampled Quaternius pose onto the VRM rig as local bone rotations."""

    def __init__(self, src_arm, dst_arm):
        self.dst = dst_arm
        self.src_rest = {b.name: b.matrix_local.copy() for b in src_arm.data.bones}
        inv = {v: k for k, v in VRM_MAP.items()}
        self.order = []
        for b in dst_arm.data.bones:
            depth = 0
            p = b.parent
            while p:
                depth += 1
                p = p.parent
            self.order.append((depth, b.name))
        self.order.sort()
        self.inv = inv
        self.rest = {b.name: b.matrix_local.to_quaternion() for b in dst_arm.data.bones}
        self.src_pelvis_z = self.src_rest["pelvis"].translation.z
        hips = dst_arm.data.bones["J_Bip_C_Hips"]
        self.hips_rest = hips.matrix_local.translation.copy()
        self.scale = self.hips_rest.z / self.src_pelvis_z
        for pb in dst_arm.pose.bones:
            pb.rotation_mode = "QUATERNION"

    def apply(self, sample, frame, extra=None, keep_xy=False):
        """extra: {vrm bone: armature-space rotation applied on top of the retargeted delta}."""
        dst = self.dst
        delta = {}
        bones = dst.data.bones
        for _, name in self.order:
            b = bones[name]
            parent_delta = delta.get(b.parent.name, Quaternion()) if b.parent else Quaternion()
            src = self.inv.get(name)
            if src and src in sample:
                d = sample[src][0]
            else:
                d = parent_delta
            if extra and name in extra:
                d = extra[name] @ d
            delta[name] = d
            if not name.startswith("J_Bip"):
                continue
            rest = self.rest[name]
            q_local = rest.inverted() @ parent_delta.inverted() @ d @ rest
            pb = dst.pose.bones[name]
            pb.rotation_quaternion = q_local
            pb.keyframe_insert("rotation_quaternion", frame=frame)
        # hips translation: the clip's pelvis offset from its rest, scaled to her
        pel = sample["pelvis"][1]
        off = (pel - self.src_rest["pelvis"].translation) * self.scale
        if not keep_xy:
            off.x = 0.0
            off.y = 0.0
        hips = dst.pose.bones["J_Bip_C_Hips"]
        rest_rot = self.rest["J_Bip_C_Hips"]
        hips.location = rest_rot.inverted() @ off
        hips.keyframe_insert("location", frame=frame)
        return delta


# --------------------------------------------------------------- hair springs

class VrmSprings:
    """Her ponytail, hair and holster straps, simulated by the VRM add-on's own VRMC_springBone-1.0
    solver (with the model's colliders, so strands don't pass through her head and shoulders), stepped
    by hand after each body frame and baked to keyframes. This is the same spring model three-vrm runs
    in the game, so the look carries over."""

    def __init__(self, arm):
        import importlib
        mod = None
        for name in list(sys.modules):
            if name.endswith("editor.spring_bone1.handler"):
                mod = sys.modules[name]
        if mod is None:
            mod = importlib.import_module("bl_ext.user_default.vrm.editor.spring_bone1.handler")
        self.mod = mod
        self.arm = arm
        ext = arm.data.vrm_addon_extension
        ext.spring_bone1.enable_animation = True
        # step it ourselves: remove the add-on's frame-change stepping
        for h in list(bpy.app.handlers.frame_change_pre):
            if getattr(h, "__name__", "") == "frame_change_pre" and "spring_bone1" in getattr(h, "__module__", ""):
                bpy.app.handlers.frame_change_pre.remove(h)
        self.bones = [pb for pb in arm.pose.bones if pb.name.startswith("J_Sec")]
        for pb in self.bones:
            pb.rotation_mode = "QUATERNION"
        self.baked = {}
        print(f"[hero] spring bones: {len(self.bones)}, springs {len(ext.spring_bone1.springs)}")

    def step(self, frame, substeps=3):
        for _ in range(substeps):
            self.mod.update_pose_bone_rotations(bpy.context, 1.0 / (FPS * substeps))
        self.baked[frame] = {pb.name: pb.rotation_quaternion.copy() for pb in self.bones}

    def write(self):
        for frame, rots in self.baked.items():
            for name, q in rots.items():
                pb = self.arm.pose.bones[name]
                pb.rotation_quaternion = q
                pb.keyframe_insert("rotation_quaternion", frame=frame)
