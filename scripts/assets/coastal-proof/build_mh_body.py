"""Coastal Market proof: Trailblazer's body, head, eyes, brows and lashes from MakeHuman (CC0).

    # needs the MPFB2 extension installed in this Blender (not --factory-startup):
    /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/assets/coastal-proof/build_mh_body.py \
        -- [--sources ~/Desktop/coastal-proof-sources]

Why: the Quaternius base is a low-poly stylised mannequin with a painted face; no shader makes it read as a
real woman. MakeHuman (via MPFB2) generates a realistic body and head with a CC0 young East Asian skin,
real eyes, brows and lashes (makehuman_system_assets_cc0).

What stays the same: her SKELETON. Everything is fitted to the existing Quaternius armature (its T-pose rest,
its bone names), so the animation library, the controller and the runtime bindings do not change:

  1. generate the MakeHuman female (asian, 25, athletic), with MPFB's "game_engine" rig and its weights
     (the same Unreal-style bone names);
  2. pose that rig onto the Quaternius skeleton bone by bone: each bone's head moved onto the Quaternius
     joint, its direction turned onto the Quaternius bone, its length scaled to match;
  3. bake the pose into the meshes, drop the MakeHuman rig, and bind the meshes to the Quaternius armature
     with MakeHuman's own weights.

Output: <sources>/mpfb/trailblazer_mh_body.blend (the fitted meshes, bound to the Quaternius armature),
read by build_trailblazer.py.
"""

import bpy
import math
import os
import sys
import zipfile

from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SRC = os.path.expanduser(argv[argv.index("--sources") + 1]) if "--sources" in argv else os.path.expanduser("~/Desktop/coastal-proof-sources")
Q = os.path.join(SRC, "quaternius", "Universal Base Characters[Standard]", "Universal Base Characters[Standard]",
                 "Base Characters", "Godot - UE", "Superhero_Female_FullBody.gltf")
PACK = os.path.join(SRC, "mpfb", "makehuman_system_assets_cc0.zip")
OUT = os.path.join(SRC, "mpfb", "trailblazer_mh_body.blend")

from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.user_default.mpfb.services.targetservice import TargetService  # noqa: E402
from bl_ext.user_default.mpfb.services.locationservice import LocationService  # noqa: E402

NAME_TO_Q = {"head": "Head", "Root": "root"}
KEEP_LENGTH = {"head", "neck_01"}


def ensure_assets():
    data = LocationService.get_user_data()
    if not os.path.exists(os.path.join(data, "skins", "young_asian_female")):
        with zipfile.ZipFile(PACK) as z:
            z.extractall(data)
    return data


def import_quaternius():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=Q)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE")
    for o in new:
        if o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    arm.name = "TB_Armature"
    return arm


def q_height(arm):
    head = arm.data.bones["Head"]
    return (arm.matrix_world @ head.head_local).z


def make_human(data, qarm):
    macro = TargetService.get_default_macro_info_dict()
    macro.update({"gender": 0.0, "age": 0.5, "muscle": 0.62, "weight": 0.45, "height": 0.5, "proportions": 0.65, "cupsize": 0.5, "firmness": 0.6})
    macro["race"] = {"african": 0.0, "asian": 1.0, "caucasian": 0.0}
    # first pass at the default scale to measure, then the real one sized to her skeleton's head height
    probe = HumanService.create_human(scale=0.1, macro_detail_dict=macro)
    HumanService.add_builtin_rig(probe, "game_engine", import_weights=False)
    prig = probe.parent
    mh_head_z = (prig.matrix_world @ prig.data.bones["head"].head_local).z
    k = q_height(qarm) / mh_head_z
    for o in [probe, prig]:
        bpy.data.objects.remove(o, do_unlink=True)
    body = HumanService.create_human(scale=0.1 * k, macro_detail_dict=macro)
    HumanService.add_builtin_rig(body, "game_engine", import_weights=True)
    for part, rel in (("eyes", "high-poly/high-poly.mhclo"), ("eyebrows", "eyebrow001/eyebrow001.mhclo"),
                      ("eyelashes", "eyelashes01/eyelashes01.mhclo")):
        HumanService.add_mhclo_asset(os.path.join(data, part, rel), body, asset_type=part, subdiv_levels=0, material_type="MAKESKIN")
    print(f"[mh] human at scale {0.1 * k:.4f}")
    return body, body.parent


def fit_rig_to_quaternius(rig, qarm):
    """Pose the MakeHuman rig so every mapped bone lies on the Quaternius bone: head on head, along the same
    direction, the same length. Bones inherit no scale, so each length is set on its own."""
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for eb in rig.data.edit_bones:
        eb.inherit_scale = "NONE"
    bpy.ops.object.mode_set(mode="OBJECT")
    to_rig = rig.matrix_world.inverted() @ qarm.matrix_world

    def depth(b):
        d = 0
        while b.parent:
            d += 1
            b = b.parent
        return d
    fitted = 0
    for pb in sorted(rig.pose.bones, key=lambda p: depth(p.bone)):
        qb = qarm.data.bones.get(NAME_TO_Q.get(pb.name, pb.name))
        if not qb:
            continue
        qh = to_rig @ qb.head_local
        qt = to_rig @ qb.tail_local
        qdir = (qt - qh)
        if qdir.length < 1e-6:
            continue
        ratio = qdir.length / max(1e-6, pb.bone.length)
        if pb.name in KEEP_LENGTH:
            # the mannequin's head and neck bones are short (a stylised big head on a short neck):
            # matching their lengths squashed her real head to half height. Keep MakeHuman's
            # lengths; the neck ends on the mannequin's head joint so the head turns about it.
            ratio = 1.0
            if pb.name == "neck_01":
                qh = qt - qdir.normalized() * pb.bone.length
        rest = pb.bone.matrix_local.to_3x3()
        y_rest = (rest @ Vector((0, 1, 0))).normalized()
        rot = y_rest.rotation_difference(qdir.normalized()).to_matrix()
        m = Matrix.Translation(qh) @ (rot @ rest).to_4x4() @ Matrix.Diagonal((1.0, ratio, 1.0, 1.0))
        pb.matrix = m
        bpy.context.view_layer.update()
        fitted += 1
    print(f"[mh] fitted {fitted} bones onto the Quaternius skeleton")


def bake_and_rebind(rig, qarm):
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and (o.parent is rig or any(m.type == "ARMATURE" and m.object is rig for m in o.modifiers))]
    q_names = {b.name for b in qarm.data.bones}
    for ob in meshes:
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        # MakeHuman's shape (its macro targets) lives in shape keys: bake the current mix into the mesh
        if ob.data.shape_keys:
            bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
        for mod in list(ob.modifiers):
            if mod.type in ("MASK", "ARMATURE", "SUBSURF"):
                try:
                    bpy.ops.object.modifier_apply(modifier=mod.name)
                except RuntimeError as err:
                    print("[mh] could not apply", mod.name, err)
                    ob.modifiers.remove(mod)
            else:
                ob.modifiers.remove(mod)
        # keep only bone weights, under the Quaternius names
        for vg in list(ob.vertex_groups):
            name = NAME_TO_Q.get(vg.name, vg.name)
            if name not in q_names:
                ob.vertex_groups.remove(vg)
            elif name != vg.name:
                vg.name = name
        mw = ob.matrix_world.copy()
        ob.parent = None
        ob.matrix_world = mw
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        ob.parent = qarm
        ob.matrix_parent_inverse = qarm.matrix_world.inverted()
        mod = ob.modifiers.new("Armature", "ARMATURE")
        mod.object = qarm
        print(f"[mh] {ob.name}: {len(ob.data.vertices)} verts, {len(ob.vertex_groups)} groups")
    bpy.data.objects.remove(rig, do_unlink=True)
    return meshes


def main():
    bpy.ops.wm.read_homefile(use_empty=True)
    data = ensure_assets()
    qarm = import_quaternius()
    body, rig = make_human(data, qarm)
    # MPFB builds with shape keys and helper geometry; freeze the macro shape before posing
    fit_rig_to_quaternius(rig, qarm)
    meshes = bake_and_rebind(rig, qarm)
    names = {"high-poly": "TB_Eyes", "eyebrow": "TB_Brows", "eyelash": "TB_Lashes"}
    for ob in meshes:
        low = ob.name.lower()
        for key, nm in names.items():
            if key in low:
                ob.name = nm
    body.name = "TB_Body"
    bpy.ops.wm.save_as_mainfile(filepath=OUT)
    print(f"[mh] wrote {OUT}")


main()
