"""
GLB -> registered sprite frames. The back half of the companion pipeline.

Takes whatever mesh the image-to-3D step produced and turns it into the frames the
game actually loads: fixed rig, fixed framing, transparent PNG, center_bottom pivot,
plus a sidecar JSON the asset registry consumes.

Route-independent on purpose. TRELLIS.2 locally, TRELLIS.2 on a rented GPU, or a
mesh from anywhere else — they all arrive here as a GLB and leave as the same frames.

    blender --background --factory-startup --python glb_to_frames.py -- \
        --glb rook.glb --out client/public/assets/goldline/companions/rook \
        --id rook --states idle,turn --res 512
"""
import bpy, bmesh, sys, os, json, math, argparse
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rig import build_rig, normalize, TARGET_HEIGHT, AZIMUTH
from toon import toon_material, toon_textured_material, add_outline


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path, rotate_x_deg=0.0):
    """
    Import a GLB and repair what image-to-3D output gets wrong.

    - Up axis. TRELLIS.2's to_glb writes height along what arrives in Blender
      as Y, so the character imports lying on its side. `rotate_x_deg` rotates
      the mesh DATA about X. It is applied to data rather than via
      transform_apply because that operator silently no-ops outside a proper
      context — the first fix attempt changed nothing and rendered identically
      at +90 and -90. For TRELLIS.2 Rook, -90 puts the feet on the ground.
    - Normals. Generated meshes carry inconsistently wound faces. With the
      importer's backface culling on, about half the faces vanish and the model
      reads as lace; under the cel shader each flipped face picks a random band
      and the surface speckles. Recalculate outward normals and disable culling.
    """
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before]
    for o in objs:
        if o.type != "MESH":
            continue
        if rotate_x_deg:
            o.data.transform(Matrix.Rotation(math.radians(rotate_x_deg), 4, "X"))
            o.data.update()
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(o.data); bm.free()
        for slot in o.material_slots:
            if slot.material:
                slot.material.use_backface_culling = False
    bpy.context.view_layer.update()
    return objs


def apply_toon(objects):
    """
    Replace whatever shading arrived with the flat cel treatment, then outline.

    Image-to-3D output ships PBR materials, and PBR is a defined failure here: the
    characters sit inside painted 2D backgrounds and glossy output makes them look
    pasted on. This is not optional polish, so it runs unconditionally.
    """
    for obj in [o for o in objects if o.type == "MESH"]:
        swapped = []
        for slot in obj.material_slots:
            m = slot.material
            if not m:
                continue
            rgba = (0.6, 0.6, 0.6, 1)
            image = None
            try:
                nodes = m.node_tree.nodes
                bsdf = nodes.get("Principled BSDF")
                if bsdf:
                    rgba = tuple(bsdf.inputs["Base Color"].default_value)
                    base = bsdf.inputs["Base Color"]
                    if base.is_linked and base.links[0].from_node.type == "TEX_IMAGE":
                        image = base.links[0].from_node.image
                if image is None:
                    # glTF import sometimes routes colour through an intermediate
                    # node; any colour image on the material is the albedo here.
                    for n in nodes:
                        if n.type == "TEX_IMAGE" and n.image and "normal" not in n.image.name.lower() \
                                and "rough" not in n.image.name.lower() and "metal" not in n.image.name.lower():
                            image = n.image
                            break
            except Exception:
                pass
            name = m.name.replace("gl_", "")
            swapped.append(toon_textured_material(name, image) if image else toon_material(name, rgba))
        if not swapped:
            swapped = [toon_material("default", (0.6, 0.6, 0.6, 1))]
        obj.data.materials.clear()
        for m in swapped:
            obj.data.materials.append(m)
        add_outline(obj)


def bake_state(objects, state, frames, out_dir, asset_id, res):
    """
    Render one named state. States are pure transforms of the imported mesh, so this
    works on a completely unrigged image-to-3D mesh. An armature, when one exists,
    replaces these transforms without changing anything downstream.
    """
    scn = bpy.context.scene
    scn.render.resolution_x = scn.render.resolution_y = res
    root = next(o for o in objects if o.parent is None and o.type == "EMPTY")
    base_z, base_scale = root.location.z, tuple(root.scale)
    written = []

    for i in range(frames):
        t = i / frames
        if state == "idle":
            # A breathing hold: slight vertical bob and a matching squash. A character
            # that breathes while standing still is the single cheapest thing that
            # makes a static PNG stop reading as a mockup.
            bob = math.sin(t * math.tau) * 0.012
            root.location.z = base_z + bob
            root.scale = (base_scale[0] * (1 - bob * 0.35),
                          base_scale[1] * (1 - bob * 0.35),
                          base_scale[2] * (1 + bob * 0.5))
            root.rotation_euler = (0, 0, 0)
        elif state == "turn":
            # A full turnaround, for the roster and for checking the mesh from behind.
            root.rotation_euler = (0, 0, t * math.tau)
            root.location.z, root.scale = base_z, base_scale
        else:
            raise SystemExit(f"unknown state: {state}")

        bpy.context.view_layer.update()
        path = os.path.join(out_dir, f"{asset_id}-{state}-{i + 1:02d}.png")
        scn.render.filepath = path
        bpy.ops.render.render(write_still=True)
        written.append(os.path.basename(path))

    root.location.z, root.scale = base_z, base_scale
    root.rotation_euler = (0, 0, 0)
    return written


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--glb", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--id", required=True, help="asset id stem, e.g. 'rook'")
    ap.add_argument("--states", default="idle,turn")
    ap.add_argument("--frames", type=int, default=8)
    ap.add_argument("--res", type=int, default=512)
    ap.add_argument("--rotate-x", type=float, default=0.0,
                    help="Rotate mesh data about X before framing. TRELLIS.2 output needs -90.")
    ap.add_argument("--shading", choices=["toon", "raw"], default="toon",
                    help="toon: cel bands + outline (scripted meshes). raw: the mesh's own baked "
                         "texture, no outline. On TRELLIS.2 Rook the outline smeared on a noisy "
                         "200K-face surface and banding amplified a mottled bake, so raw read cleaner.")
    a = ap.parse_args(argv)

    os.makedirs(a.out, exist_ok=True)
    clear()
    build_rig()
    imported = import_glb(a.glb, a.rotate_x)
    info = normalize(imported)
    if a.shading == "toon":
        apply_toon(imported)
    objects = list(bpy.data.objects)

    states = {}
    for state in [s.strip() for s in a.states.split(",") if s.strip()]:
        states[state] = bake_state(objects, state, a.frames, a.out, a.id, a.res)

    # Sidecar the registry reads, so a new companion is never an unregistered asset.
    meta = {
        "assetId": a.id,
        "source": os.path.basename(a.glb),
        "pivot": "center_bottom",
        "frameSize": {"width": a.res, "height": a.res},
        "targetHeightBlenderUnits": TARGET_HEIGHT,
        "normalization": info,
        "states": {k: {"frames": len(v), "files": v} for k, v in states.items()},
        "rig": "scripts/assets/blender/rig.py",
        "cameraAzimuth": AZIMUTH,
        "shading": a.shading,
        "rotateX": a.rotate_x,
    }
    with open(os.path.join(a.out, f"{a.id}.frames.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    print("FRAMES " + json.dumps({k: len(v) for k, v in states.items()}))


main()
