"""The traveller on tonight's tile of the sky board (Blender 5.2, headless).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python scripts/assets/lantern-city-sky-board/build_traveller.py -- [--render OUT.png]

A game piece, not a mascot: a small painted figurine on a brass base, the way a token sits on a board. A hooded
slate-blue travelling cloak, a faceless ivory head, a walking staff in one hand and a lit lantern held out in the other,
so that from behind (the board shows the traveller's back, looking over the city) the warm light still reads at the
side. Materials keep to the board's own palette: slate, brass, ivory, and amber light.

One animation, Idle_A: the lantern sways a little on its handle. Unit scale: about one unit tall; the browser sizes it
to the tile. Blender is Z-up and faces -Y; the glTF export is Y-up and faces +Z.

Output: client/public/assets/goldline/home/board/traveller.glb
"""

import bpy
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(REPO, "client", "public", "assets", "goldline", "home", "board", "traveller.glb")
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
RENDER = ARGV[ARGV.index("--render") + 1] if "--render" in ARGV else None
FPS = 24
SWAY_FRAMES = 72  # one full sway, three seconds
LANTERN_SCALE = 1.45  # read as a warm point from the board camera, high above


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS


def material(name, color, rough=0.6, metal=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


def srgb(hex_):
    """sRGB hex to linear, the way Blender stores colours."""
    out = []
    for i in (0, 2, 4):
        c = int(hex_[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def finish(obj, mat, smooth=True, bevel=0.0):
    obj.data.materials.append(mat)
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    if bevel:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
    return obj


def cylinder(name, r1, r2, depth, z, verts=32, x=0.0, y=0.0):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=(x, y, z))
    o = bpy.context.active_object
    o.name = name
    return o


def sphere(name, r, loc, scale=(1, 1, 1), segs=32):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=segs // 2, radius=r, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    return o


def build():
    slate = material("cloak", srgb("4d7684"), rough=0.68)
    slate_dark = material("cloak_lining", srgb("2a4550"), rough=0.8)
    ivory = material("ivory", srgb("e6d9c0"), rough=0.55)
    brass = material("brass", srgb("b48d4c"), rough=0.32, metal=0.85)
    wood = material("staff", srgb("6b4f33"), rough=0.6)
    wool = material("bedroll", srgb("a8876a"), rough=0.85)
    amber = material("lantern_light", srgb("ffd27e"), rough=0.4, emit=srgb("ffbb55"), strength=9.0)

    parts = []
    # the base: a brass token with a stepped rim
    parts.append(finish(cylinder("base", 0.30, 0.30, 0.05, 0.025, 48), brass, bevel=0.012))
    parts.append(finish(cylinder("base_top", 0.255, 0.245, 0.03, 0.065, 48), slate_dark, bevel=0.008))
    # the cloak: a long flared bell with a brass hem, then shoulders
    parts.append(finish(cylinder("hem", 0.226, 0.222, 0.025, 0.095, 40), brass))
    parts.append(finish(cylinder("cloak", 0.22, 0.135, 0.56, 0.36, 40), slate))
    parts.append(finish(sphere("shoulders", 0.15, (0, 0, 0.64), (1.0, 0.85, 0.55)), slate))
    # the head, and the hood behind and over it
    parts.append(finish(sphere("head", 0.085, (0, -0.015, 0.75)), ivory))
    hood = finish(sphere("hood", 0.108, (0, 0.022, 0.77), (1.0, 1.05, 1.08)), slate)
    parts.append(hood)
    # the hood falls in a soft drape down the back
    parts.append(finish(sphere("hood_drape", 0.09, (0, 0.085, 0.69), (0.95, 0.7, 1.15)), slate))
    # a rolled bedroll across the shoulders, strapped in brass: the side the board shows
    roll = finish(cylinder("bedroll", 0.05, 0.05, 0.26, 0.0, 24), wool)
    roll.location = (0, 0.125, 0.585)
    roll.rotation_euler = (0, math.pi / 2, 0)
    parts.append(roll)
    for x in (-0.075, 0.075):
        strap = finish(cylinder("bedroll_strap", 0.054, 0.054, 0.014, 0.0, 24), brass)
        strap.location = (x, 0.125, 0.585)
        strap.rotation_euler = (0, math.pi / 2, 0)
        parts.append(strap)
    # arms as short sleeves angled out to each hand
    for side, angle in ((1, -0.55), (-1, 0.5)):
        arm = finish(cylinder(f"sleeve_{'r' if side > 0 else 'l'}", 0.045, 0.035, 0.24, 0.0, 20), slate)
        arm.location = (side * 0.17, -0.02, 0.53)
        arm.rotation_euler = (0, angle, 0)
        parts.append(arm)
        hand = finish(sphere(f"hand_{'r' if side > 0 else 'l'}", 0.032, (side * 0.235, -0.03, 0.43)), ivory)
        parts.append(hand)
    # the staff in the left hand
    staff = finish(cylinder("staff", 0.016, 0.013, 0.98, 0.5, 12, x=-0.245, y=-0.03), wood)
    staff.rotation_euler = (0.05, -0.05, 0)
    parts.append(staff)
    parts.append(finish(sphere("staff_cap", 0.024, (-0.27, -0.055, 0.995)), brass))

    for p in parts:
        bpy.ops.object.select_all(action="DESELECT")
        p.select_set(True)
        bpy.context.view_layer.objects.active = p
        for mod in p.modifiers:
            bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    body = bpy.context.active_object
    body.name = "traveller"

    # the lantern hangs from the right hand on its own pivot, which carries the one animation
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0.245, -0.035, 0.42))
    pivot = bpy.context.active_object
    pivot.name = "lantern_pivot"
    pivot.parent = body
    lantern = []
    lantern.append(finish(cylinder("lantern_handle", 0.008, 0.008, 0.06, -0.03, 8), brass))
    lantern.append(finish(cylinder("lantern_cap", 0.045, 0.02, 0.03, -0.07, 16), brass))
    lantern.append(finish(cylinder("lantern_glass", 0.036, 0.036, 0.075, -0.122, 16), amber))
    lantern.append(finish(cylinder("lantern_foot", 0.04, 0.045, 0.018, -0.168, 16), brass))
    for i in range(4):
        a = i * math.pi / 2 + math.pi / 4
        lantern.append(finish(cylinder(f"lantern_bar_{i}", 0.005, 0.005, 0.08, -0.122, 6,
                                       x=math.cos(a) * 0.04, y=math.sin(a) * 0.04), brass, smooth=False))
    for p in lantern:
        p.scale = (LANTERN_SCALE,) * 3
        p.location = (p.location.x * LANTERN_SCALE + pivot.location.x, p.location.y * LANTERN_SCALE + pivot.location.y,
                      p.location.z * LANTERN_SCALE + pivot.location.z)
    bpy.ops.object.select_all(action="DESELECT")
    for p in lantern:
        p.select_set(True)
    bpy.context.view_layer.objects.active = lantern[0]
    bpy.ops.object.join()
    lamp = bpy.context.active_object
    lamp.name = "lantern"
    lamp.parent = pivot
    lamp.matrix_parent_inverse = pivot.matrix_world.inverted()

    # Idle_A: a slow sway on the handle
    action = bpy.data.actions.new("Idle_A")
    pivot.animation_data_create()
    pivot.animation_data.action = action
    for frame, angle in ((1, 0.0), (SWAY_FRAMES // 4 + 1, 0.11), (SWAY_FRAMES // 2 + 1, 0.0),
                         (3 * SWAY_FRAMES // 4 + 1, -0.11), (SWAY_FRAMES + 1, 0.0)):
        pivot.rotation_euler = (angle, angle * 0.4, 0)
        pivot.keyframe_insert("rotation_euler", frame=frame)
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = SWAY_FRAMES + 1
    return body


def export():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
    )
    print("wrote", OUT, os.path.getsize(OUT), "bytes")


def render(path):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("w")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (*srgb("14232d"), 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    bpy.ops.object.light_add(type="SUN", location=(0, 0, 3))
    sun = bpy.context.active_object
    sun.data.energy = 3.0
    sun.data.color = srgb("f0ca8b")
    sun.rotation_euler = (math.radians(50), 0, math.radians(-140))
    bpy.ops.object.light_add(type="AREA", location=(-1.5, -1.5, 1.5))
    fill = bpy.context.active_object
    fill.data.energy = 60
    fill.data.color = srgb("9fc0d0")
    fill.rotation_euler = (math.radians(60), 0, math.radians(-45))
    view = ARGV[ARGV.index("--view") + 1] if "--view" in ARGV else "back"
    bpy.ops.object.camera_add()
    cam = bpy.context.active_object
    scene.camera = cam
    cam.data.lens = 70
    y = 2.4 if view == "back" else -2.4
    cam.location = (0.9, y, 1.5)
    target = (0, 0, 0.48)
    d = [target[i] - cam.location[i] for i in range(3)]
    cam.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), -d[2]), 0, math.atan2(d[1], d[0]) - math.pi / 2)
    scene.frame_set(SWAY_FRAMES // 4 + 1)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("rendered", path)


reset()
build()
export()
if RENDER:
    render(RENDER)
