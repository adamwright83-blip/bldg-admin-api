"""Coastal Market proof: character + animation export (Blender 5.2, headless).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python scripts/assets/coastal-proof/build_characters.py -- --sources ~/Desktop/coastal-proof-sources

Inputs are CC0 Quaternius packs (see PROVENANCE.md). Outputs, next to level.glb:

    anims_a.glb       UAL1 clips: Idle_Loop, Walk_Loop, Idle_Talking_Loop, Fixing_Kneeling
    anims_b.glb       UAL2 clips: Idle_Rail_Loop, Walk_Carry_Loop, Idle_FoldArms_Loop

All clips share the base skeleton's bone names, so three.js binds them to
Trailblazer (build_trailblazer.py) and the townspeople (build_townsfolk.py)
without retargeting.
"""

import bpy
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT_DIR = os.path.join(REPO, "client", "public", "assets", "goldline", "coastal-market-three-proof")

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SRC = os.path.expanduser(argv[argv.index("--sources") + 1]) if "--sources" in argv else os.path.expanduser("~/Desktop/coastal-proof-sources")
Q = os.path.join(SRC, "quaternius")
UAL1 = os.path.join(Q, "Universal Animation Library[Standard]", "Universal Animation Library[Standard]", "Unreal-Godot", "UAL1_Standard.glb")
UAL2 = os.path.join(Q, "Universal Animation Library 2[Standard]", "Universal Animation Library 2[Standard]", "Unreal-Godot", "UAL2_Standard.glb")

CLIPS_A = [
    "Idle_Loop", "Walk_Loop", "Idle_Talking_Loop", "Fixing_Kneeling",
    "Jog_Fwd_Loop", "Sprint_Loop", "Jump_Start", "Jump_Loop", "Jump_Land", "Roll",
]
CLIPS_B = [
    "Idle_Rail_Loop", "Walk_Carry_Loop", "Idle_FoldArms_Loop",
    "ClimbUp_1m", "NinjaJump_Start", "NinjaJump_Idle_Loop", "NinjaJump_Land",
]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def export(path, animations):
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", export_yup=True, export_animations=animations,
        export_animation_mode="ACTIONS", export_skins=True, export_morph=False, export_materials="EXPORT",
        export_image_format="WEBP", export_image_quality=82, export_meshopt_compression_enable=not animations,
        export_cameras=False, export_lights=False, export_apply=False, export_force_sampling=True,
        export_optimize_animation_size=True, export_def_bones=False, export_leaf_bone=False,
    )
    print(f"[characters] wrote {os.path.relpath(path, REPO)} ({os.path.getsize(path) / 1024:.0f} KB)")


def export_clips(src, keep, out_name):
    reset()
    bpy.ops.import_scene.gltf(filepath=src)
    for ob in list(bpy.data.objects):
        if ob.type != "ARMATURE":
            bpy.data.objects.remove(ob)
    for action in list(bpy.data.actions):
        if action.name not in keep:
            bpy.data.actions.remove(action)
    missing = [k for k in keep if k not in bpy.data.actions]
    if missing:
        raise SystemExit(f"missing clips {missing} in {src}")
    for action in bpy.data.actions:
        action.use_fake_user = True
    export(os.path.join(OUT_DIR, out_name), animations=True)


os.makedirs(OUT_DIR, exist_ok=True)
export_clips(UAL1, CLIPS_A, "anims_a.glb")
export_clips(UAL2, CLIPS_B, "anims_b.glb")
