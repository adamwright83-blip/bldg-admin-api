"""
THE SHARED RIG — the invariant half of the companion pipeline.

Every companion, whatever produced its geometry, is shot through this one camera,
these three lights and this framing. That is the entire mechanism behind the "they
must look like one set, produced by one pipeline" rule. If a companion needs a
different rig, the answer is to fix the model, not to fork the rig.

Imported by both companions.py (scripted geometry) and glb_to_frames.py
(image-to-3D output), so those two paths cannot drift apart.
"""
import bpy, math

# Feet sit on z=0 and the camera frames a fixed box, so every render lands on the
# registry's center_bottom pivot convention without per-asset tuning.
TARGET_HEIGHT = 1.75   # blender units, tallest point of a standing companion
ORTHO_SCALE = 2.95

# Camera azimuth, in degrees around the character. 0 is dead front.
#
# This was 30.5 and it was wrong. At 30.5 a forward-pointing feature aims almost
# straight down the lens and collapses into the body: Rook's beak, its single
# strongest silhouette cue, did not appear until frame 3 of a turnaround. A study
# at 30.5 / 45 / 60 / 75 / 90 showed 60 to 75 read the beak clearly while keeping
# three-quarter appeal; 90 flattens the body into a profile card.
#
# Settling this BEFORE the other six animals are made is what stops all seven
# being remade. Do not change it per-companion — the set is shot on one camera.
AZIMUTH = 60.0
ELEVATION = 21.0
DISTANCE = 5.6
TARGET = (0.0, 0.0, 0.88)


def build_rig():
    """Camera and lights. Call on an empty scene, before adding geometry."""
    scn = bpy.context.scene

    bpy.ops.object.empty_add(location=TARGET)
    target = bpy.context.active_object
    target.name = "rig_target"
    a, e = math.radians(AZIMUTH), math.radians(ELEVATION)
    bpy.ops.object.camera_add(location=(
        TARGET[0] + DISTANCE * math.cos(e) * math.sin(a),
        TARGET[1] - DISTANCE * math.cos(e) * math.cos(a),
        TARGET[2] + DISTANCE * math.sin(e)))
    cam = bpy.context.active_object
    track = cam.constraints.new("TRACK_TO")
    track.target = target
    track.track_axis, track.up_axis = "TRACK_NEGATIVE_Z", "UP_Y"
    cam.data.type = "ORTHO"          # ortho keeps scale comparable between species
    cam.data.ortho_scale = ORTHO_SCALE
    scn.camera = cam

    # Energies are deliberately low. An early pass ran hot and bleached every dark
    # value to beige, which destroyed Rook specifically.
    bpy.ops.object.light_add(type="AREA", location=(-2.6, -3.4, 4.2))
    k = bpy.context.active_object
    k.data.energy, k.data.size, k.data.color = 260, 4.0, (1.0, 0.95, 0.88)
    k.rotation_euler = (math.radians(38), math.radians(-22), math.radians(-32))

    bpy.ops.object.light_add(type="AREA", location=(4.0, -2.2, 1.7))
    f = bpy.context.active_object
    f.data.energy, f.data.size, f.data.color = 70, 5.0, (0.70, 0.84, 1.0)
    f.rotation_euler = (math.radians(76), 0, math.radians(66))

    # Rim from behind. This is what separates the character from any background.
    bpy.ops.object.light_add(type="AREA", location=(-1.4, 3.6, 3.0))
    r = bpy.context.active_object
    r.data.energy, r.data.size, r.data.color = 190, 3.0, (1.0, 0.78, 0.46)
    r.rotation_euler = (math.radians(120), 0, math.radians(-160))

    scn.render.engine = "BLENDER_EEVEE"
    scn.render.film_transparent = True              # every asset ships on transparency
    scn.render.image_settings.file_format = "PNG"
    scn.render.image_settings.color_mode = "RGBA"
    scn.view_settings.view_transform = "Standard"   # no filmic wash on flat game art
    try:
        scn.eevee.taa_render_samples = 64
        scn.eevee.use_raytracing = True
    except Exception:
        pass
    return cam


def normalize(objects):
    """
    Put arbitrary imported geometry into the pipeline's coordinate contract:
    centred on X and Y, feet on z=0, scaled so the tallest point is TARGET_HEIGHT.

    Image-to-3D output arrives at an arbitrary scale, offset and rotation. Without
    this, two companions generated on different days would not be the same size —
    which is exactly the inconsistency the registry's art-space contract forbids.
    """
    meshes = [o for o in objects if o.type == "MESH"]
    if not meshes:
        raise SystemExit("normalize: no mesh objects to place")

    bpy.context.view_layer.update()
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for o in meshes:
        for corner in o.bound_box:
            w = o.matrix_world @ __import__("mathutils").Vector(corner)
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])

    height = hi[2] - lo[2]
    if height <= 0:
        raise SystemExit("normalize: geometry has no height")
    scale = TARGET_HEIGHT / height
    cx, cy = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2

    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.empty_add(location=(0, 0, 0))
    pivot = bpy.context.active_object
    for o in meshes:
        o.parent = pivot
    pivot.scale = (scale, scale, scale)
    pivot.location = (-cx * scale, -cy * scale, -lo[2] * scale)
    bpy.context.view_layer.update()
    return {"source_height": height, "applied_scale": scale}
