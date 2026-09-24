"""Coastal Market proof: townspeople (Blender 5.2, headless).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python scripts/assets/coastal-proof/build_townsfolk.py -- [--sources ~/Desktop/coastal-proof-sources]

Two background figures (female, male) built on the CC0 Quaternius bases, each ONE skinned mesh of
about 5k triangles so a handful of them cost a handful of draw calls. Clothing is region copies of
the body like Trailblazer's, but colours are not baked: every vertex carries a palette slot in
`_SLOT` (0 skin, 1 top, 2 legs, 3 boots, 4 hair, 5 headwear, 6 apron/belt) and three.js gives each
person their own palette. Output: townsfolk_f.glb, townsfolk_m.glb next to level.glb.
"""

import bmesh
import bpy
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_trailblazer as tb  # noqa: E402  (shared region-extraction helpers)

from mathutils import Vector, noise  # noqa: E402

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
TARGET_TRIS = 5200

SLOT = {"skin": 0, "top": 1, "legs": 2, "boots": 3, "hair": 4, "head": 5, "apron": 6}


def slot_color(slot):
    # encode the slot in red so the preview still reads; the runtime uses _SLOT
    return (slot / 8.0, 0.0, 0.0)


def build(base_file, out_name, hair_file, headwear):
    tb.reset()
    bpy.ops.import_scene.gltf(filepath=os.path.join(tb.Q, "Base Characters", "Godot - UE", base_file))
    for ob in list(bpy.data.objects):
        if ob.type == "MESH" and ob.parent is None:
            bpy.data.objects.remove(ob)
    arm = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
    body = max((o for o in bpy.data.objects if o.type == "MESH"), key=lambda o: len(o.data.vertices))
    for ob in [o for o in bpy.data.objects if o.type == "MESH"]:
        me = ob.data
        keep = next((uv.name for uv in me.uv_layers if uv.active_render), None)
        for uv in list(me.uv_layers):
            if uv.name != keep:
                me.uv_layers.remove(uv)
        for ca in list(me.color_attributes):
            me.color_attributes.remove(ca)
    # eyes and brows are invisible at townsfolk distance
    for ob in list(bpy.data.objects):
        if ob.type == "MESH" and ob is not body:
            bpy.data.objects.remove(ob)
    info = tb.face_info(body)
    arms = tb.ARM_BONES

    def top(c, n, b):
        return 0.74 <= c.z <= 1.52 and b not in tb.HEAD_BONES and not tb.is_hand_or_finger(b) and not (b in ("lowerarm_l", "lowerarm_r") and abs(c.x) > 0.56)

    def legs(c, n, b):
        return 0.1 <= c.z < 0.9 and b and b.startswith(("thigh", "calf", "pelvis"))

    def boots(c, n, b):
        return c.z < 0.2 and b and b.startswith(("calf", "foot", "ball"))

    def head(c, n, b):
        # headscarf / cap: the skull above the brow line
        return b in ("Head",) and c.z > 1.66 and not (c.y < -0.06 and c.z < 1.72)

    def apron(c, n, b):
        return 0.72 <= c.z <= 1.08 and c.y < -0.02 and abs(c.x) < 0.16

    pieces = [
        tb.extract(body, "t_top", top, 0.012, lambda c, n, v: slot_color(SLOT["top"]), info),
        tb.extract(body, "t_legs", legs, 0.008, lambda c, n, v: slot_color(SLOT["legs"]), info),
        tb.extract(body, "t_boots", boots, 0.014, lambda c, n, v: slot_color(SLOT["boots"]), info),
        tb.extract(body, "t_apron", apron, 0.02, lambda c, n, v: slot_color(SLOT["apron"]), info),
    ]
    if headwear:
        pieces.append(tb.extract(body, "t_head", head, 0.016, lambda c, n, v: slot_color(SLOT["head"]), info))
    # the body itself becomes skin
    bm = bmesh.new()
    bm.from_mesh(body.data)
    for layer in list(bm.loops.layers.color.values()):
        bm.loops.layers.color.remove(layer)
    col = bm.loops.layers.color.new("Color")
    for f in bm.faces:
        for loop in f.loops:
            loop[col] = (*slot_color(SLOT["skin"]), 1.0)
    bm.to_mesh(body.data)
    bm.free()
    obs = [body] + pieces
    if hair_file and not headwear:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(tb.Q, "Hairstyles", "Rigged to Head Bone", "glTF (Godot -Unreal)", hair_file))
        new = [o for o in bpy.data.objects if o not in before]
        hair = [o for o in new if o.type == "MESH" and o.name.startswith("Hair")][0]
        world = hair.matrix_world.copy()
        hair.parent = None
        hair.matrix_world = world
        for o in new:
            if o is not hair:
                bpy.data.objects.remove(o)
        for uv in list(hair.data.uv_layers)[1:]:
            hair.data.uv_layers.remove(uv)
        for g in list(hair.vertex_groups):
            hair.vertex_groups.remove(g)
        hair.parent = arm
        hg = hair.vertex_groups.new(name="Head")
        hg.add([v.index for v in hair.data.vertices], 1.0, "REPLACE")
        mod = hair.modifiers.get("Armature") or hair.modifiers.new("Armature", "ARMATURE")
        mod.object = arm
        hbm = bmesh.new()
        hbm.from_mesh(hair.data)
        for layer in list(hbm.loops.layers.color.values()):
            hbm.loops.layers.color.remove(layer)
        hc = hbm.loops.layers.color.new("Color")
        for f in hbm.faces:
            for loop in f.loops:
                loop[hc] = (*slot_color(SLOT["hair"]), 1.0)
        hbm.to_mesh(hair.data)
        hbm.free()
        obs.append(hair)
    # one mesh, one material
    mat = bpy.data.materials.new("TOWN_Clothes")
    for ob in obs:
        ob.data.materials.clear()
        ob.data.materials.append(mat)
    for o in bpy.data.objects:
        o.select_set(False)
    for ob in obs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    me = body.data
    # decimate while keeping skin weights
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    mod = body.modifiers.new("dec", "DECIMATE")
    mod.ratio = min(1.0, TARGET_TRIS / tris)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_move_to_index(modifier="dec", index=0)
    bpy.ops.object.modifier_apply(modifier="dec")
    # slot attribute from the red channel
    ca = me.color_attributes.get("Color")
    slots = [0.0] * len(me.vertices)
    for poly in me.polygons:
        for li in poly.loop_indices:
            # the byte colour layer stores sRGB; read it back in the space it was written
            slots[me.loops[li].vertex_index] = round(ca.data[li].color_srgb[0] * 8.0)
    hist = {}
    for v in slots:
        hist[v] = hist.get(v, 0) + 1
    raw = sorted({round(ca.data[li].color[0], 3) for li in range(0, len(ca.data), 97)})
    print(f"[townsfolk] {out_name} slot histogram {dict(sorted(hist.items()))} raw red samples {raw[:12]}")
    attr = me.attributes.new("_SLOT", "FLOAT", "POINT")
    attr.data.foreach_set("value", slots)
    me.color_attributes.remove(ca)
    body.name = "TOWN_Body"
    out = os.path.join(tb.OUT_DIR, out_name)
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", export_yup=True, export_animations=False, export_skins=True,
        export_materials="EXPORT", export_attributes=True, export_vertex_color="NONE",
        export_meshopt_compression_enable=True, export_cameras=False, export_lights=False,
    )
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    print(f"[townsfolk] wrote {out_name} ({os.path.getsize(out) // 1024} KB, {tris} tris)")


build("Superhero_Female_FullBody.gltf", "townsfolk_f.glb", None, headwear=True)
build("Superhero_Male_FullBody.gltf", "townsfolk_m.glb", "Hair_SimpleParted.gltf", headwear=False)
