"""Coastal Market proof: Rook runtime GLB (approved mesh, no redesign).

    ROOK_GLB=~/Desktop/goldline-local-archive/.../rook.glb \
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python scripts/assets/coastal-proof/build_rook_runtime.py -- [--tris 36000] [--tex 2048] [--preview out_prefix]

Why this exists. Phase 2 shipped `rook-runtime.glb` straight from `rook_rig.py --export-static-glb`.
The approved look is the concept projected onto the TRELLIS mesh through two per-vertex attributes
(`proj_uv`, `proj_w`) wired in a node tree; glTF cannot carry that tree, so the export fell back to
TRELLIS's own baked texture (the "dark camouflage" the pipeline notes warn about) at 630k triangles.

This builds the runtime version of the SAME approved mesh:

  1. load it exactly as `rook_rig.load_rook()` does (import fix, concept projection, normalise);
  2. a decimated copy (LOD only: silhouette kept, nothing re-sculpted or regenerated);
  3. Cycles bakes the projected material (and the full-resolution surface detail as a normal map)
     from the original onto the copy's own UVs, so the approved colours survive glTF;
  4. Rook's existing rig (`rook_rig.compute_weights` / `build_armature` / its pose vocabulary) is
     evaluated at a few authored key poses and each is stored as a morph target. The skinned export
     fragments in three.js; morph targets are plain vertex positions, so the deformation three.js
     plays is exactly the deformation Blender computed with his own rig: no fake hop, flight or
     transform trick.

Outputs, next to the proof's other assets:
  rook-runtime.glb   mesh + baked texture + morph targets (names = pose keys)
  rook-runtime.json  per key: the left wing-tip position (three coords, metres at scale 1) so the
                     runtime can hang the dispatch satchel from the wing that holds it
"""

import bpy
import json
import math
import os
import sys

import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "scripts", "assets", "blender"))
import rook_rig as RR  # noqa: E402

OUT_DIR = os.path.join(REPO, "client", "public", "assets", "goldline", "coastal-market-three-proof")
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
TRIS = int(argv[argv.index("--tris") + 1]) if "--tris" in argv else 42000
TEX = int(argv[argv.index("--tex") + 1]) if "--tex" in argv else 2048
PREVIEW = argv[argv.index("--preview") + 1] if "--preview" in argv else None
SAMPLES = 4
VOXEL = float(argv[argv.index("--voxel") + 1]) if "--voxel" in argv else 0.004
LOD = argv[argv.index("--lod") + 1] if "--lod" in argv else "shell"
SMOOTH_ITER = int(argv[argv.index("--smooth") + 1]) if "--smooth" in argv else 12


# ---------------------------------------------------------------- key poses
# Rook rests facing -Y (three +Z). His left wing (wing.L, +X) takes the satchel off a hook
# above and forward of his left shoulder, draws it in against his chest, and he turns his head to
# whoever is at the cage door. Degrees, rook_rig.rot conventions (x = flex, y = roll, z = yaw).

def k_breathe_in(arm):
    RR.pose_idle(arm, 0.25)


def k_breathe_out(arm):
    RR.pose_idle(arm, 0.75)


# The hook hangs in front of his left shoulder (three -X side of him, at about his head height),
# inside the cage wall. He looks at it, puts the wing out to it (the range `pose_letter` and
# `pose_point` already use), takes the strap, draws it in, and turns his head to the door.

def k_look(arm):
    RR.rot(arm, "chest", x=-3, z=6)
    RR.rot(arm, "neck", x=-2, z=8)
    RR.rot(arm, "head", x=-8, z=12)


def k_reach(arm):
    RR.move(arm, "hips", dz=0.015)
    RR.rot(arm, "chest", x=-6, z=12)
    RR.rot(arm, "neck", x=-3, z=8)
    RR.rot(arm, "head", x=-12, z=12)
    RR.rot(arm, "wing.L", x=-96, y=-22, z=12)
    RR.rot(arm, "tail1", x=-4)


def k_lift(arm):
    # strap off the hook: the wing draws back toward his chest, the weight sits him back
    RR.move(arm, "hips", dz=-0.01)
    RR.rot(arm, "chest", x=-2, z=8)
    RR.rot(arm, "neck", z=4)
    RR.rot(arm, "head", x=-6, z=4)
    RR.rot(arm, "wing.L", x=-70, y=-40, z=10)
    RR.rot(arm, "tail1", x=-6, z=4)


def k_hold(arm):
    # satchel held against his chest; head turned toward the door
    RR.rot(arm, "chest", x=2, z=-8)
    RR.rot(arm, "neck", x=2, z=-12)
    RR.rot(arm, "head", x=-4, z=-20, y=5)
    RR.rot(arm, "wing.L", x=-48, y=-44, z=-6)
    RR.rot(arm, "tail1", z=-6)
    RR.rot(arm, "tail2", z=-6)


def k_lean_in(arm):
    # "It isn't theirs either." chest toward the door, the satchel kept back
    k_hold(arm)
    RR.move(arm, "hips", dz=-0.02)
    RR.rot(arm, "thigh.L", x=8)
    RR.rot(arm, "thigh.R", x=8)
    RR.rot(arm, "shin.L", x=-10)
    RR.rot(arm, "shin.R", x=-10)
    RR.rot(arm, "chest", x=12, z=-12)
    RR.rot(arm, "neck", x=5, z=-10)
    RR.rot(arm, "head", x=-6, z=-16, y=7)


def k_talk(arm):
    # layered on any pose by the runtime: the jaw alone
    RR.rot(arm, "jaw", x=-26)


KEYS = [
    ("breathe_in", k_breathe_in),
    ("look", k_look),
    ("reach", k_reach),
    ("lift", k_lift),
    ("hold", k_hold),
    ("lean_in", k_lean_in),
    ("talk", k_talk),
]


# ---------------------------------------------------------------- helpers
def select_only(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def load_runtime_mesh():
    """rook_rig.load_rook() for a runtime LOD of the same surface.

    The generated shell is a triangle soup (~46k loose pieces, ~49k non-manifold edges after
    welding), which collapse-decimation cannot reduce. So: a fine voxel retopology of the SAME
    surface (VOXEL mm below the smallest detail the camera can see), the source UVs transferred
    across (they feed the projection's fallback colour), then collapse to the runtime budget. The
    concept projection is computed on the LOD's own vertices; it is linear in position, so exact
    across every triangle.
    """
    from mathutils import Matrix
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objs = RR.import_glb(RR.GLB, -90)
    src = next(o for o in objs if o.type == "MESH")
    src_tris = tri_count(src)
    obj = src.copy()
    obj.data = src.data.copy()
    obj.name = "rook_runtime"
    bpy.context.scene.collection.objects.link(obj)
    select_only(obj)
    if LOD == "shell":
        # decimate the approved shell as it is: no retopology (a voxel pass turns its thin
        # double layers into lace). Each loose piece collapses on its own; the silhouette holds.
        mod = obj.modifiers.new("decimate", "DECIMATE")
        mod.ratio = min(1.0, TRIS / max(1, src_tris))
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
        for p in obj.data.polygons:
            p.use_smooth = False
        return finish_load(obj, src, src_tris)
    obj.data.remesh_voxel_size = VOXEL
    obj.data.remesh_voxel_adaptivity = 0.0
    bpy.ops.object.voxel_remesh()
    print(f"[rook] voxel {VOXEL} -> {tri_count(obj)} tris")
    # the generated shell is several overlapping layers; its level set comes out crumpled at the
    # voxel scale. A volume-preserving Laplacian smooth takes that crinkle out and keeps the silhouette.
    sm = obj.modifiers.new("smooth", "LAPLACIANSMOOTH")
    sm.iterations = SMOOTH_ITER
    sm.lambda_factor = 0.9
    sm.use_volume_preserve = True
    sm.use_normalized = True
    bpy.ops.object.modifier_apply(modifier=sm.name)
    # Where the concept cannot see (his far side and back) the approved look is the concept's own
    # feather green, exactly as project_concept.py falls back; the generated texture is not used.
    obj.data.materials.clear()
    for _ in range(4):
        if tri_count(obj) <= TRIS * 1.08:
            break
        mod = obj.modifiers.new("decimate", "DECIMATE")
        mod.ratio = min(1.0, TRIS / max(1, tri_count(obj)))
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in obj.data.polygons:
        p.use_smooth = True
    return finish_load(obj, src, src_tris)


def finish_load(obj, src, src_tris):
    from mathutils import Matrix
    print(f"[rook] approved mesh {src_tris} tris -> runtime LOD {tri_count(obj)} tris, {len(obj.data.vertices)} verts")
    img, mean_body, covered = RR.project(obj, RR.CONCEPT, 38, 14)
    # projection_material reads the generated texture from the first material slot
    RR.projection_material(obj, img, mean_body)
    print(f"[rook] concept covers {covered:.2f} of vertices")
    parent = src.parent
    bpy.data.objects.remove(src, do_unlink=True)
    obj.parent = parent
    RR.normalize([obj] + [o for o in bpy.data.objects if o.type == "EMPTY"])
    bpy.context.view_layer.update()
    mw = obj.matrix_world.copy()
    obj.parent = None
    obj.data.transform(mw)
    obj.matrix_world = Matrix.Identity(4)
    for o in list(bpy.data.objects):
        if o.type == "EMPTY":
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.update()
    print(f"[rook] normalised height {obj.dimensions.z:.3f}")
    return obj


# The concept's own paint (display sRGB, sampled by eye from rook-concept-v1.png).
PALETTE = [
    ("feather", (0.34, 0.49, 0.15)),
    ("feather_dark", (0.23, 0.35, 0.10)),
    ("beak_red", (0.80, 0.23, 0.15)),
    ("white", (0.93, 0.90, 0.85)),
    ("hat_tan", (0.74, 0.69, 0.50)),
    ("hat_olive", (0.47, 0.52, 0.30)),
    ("leather", (0.40, 0.26, 0.15)),
    ("satchel", (0.77, 0.55, 0.33)),
    ("brass", (0.80, 0.63, 0.26)),
    ("leg", (0.40, 0.45, 0.20)),
    ("claw", (0.82, 0.50, 0.18)),
    ("glass", (0.20, 0.24, 0.23)),
]
P = {name: i for i, (name, _) in enumerate(PALETTE)}


def classify(rgb, region):
    """Name the concept's paint at one vertex from its hue, within what that body region can be."""
    import colorsys
    h, sat, val = colorsys.rgb_to_hsv(*[float(x) for x in rgb])
    hue = h * 360
    if region == "leg":
        return P["claw"] if (15 <= hue <= 45 and sat > 0.45 and val > 0.45) else P["leg"]
    red = (hue < 18 or hue > 340) and sat > 0.4
    white = sat < 0.2 and val > 0.72
    brown = 15 <= hue <= 48 and sat > 0.3
    if region == "bag":
        if 40 <= hue <= 58 and sat > 0.5 and val > 0.55:
            return P["brass"]
        return P["leather"] if val < 0.4 else P["satchel"]
    if region == "head":
        if red:
            return P["beak_red"]
        if white:
            return P["white"]
        if val < 0.2:
            return P["glass"]
        if 40 <= hue <= 58 and sat > 0.5 and val > 0.55:
            return P["brass"]
        if 30 <= hue <= 75 and sat < 0.45:
            return P["hat_tan"] if val > 0.55 else P["hat_olive"]
        if brown:
            return P["leather"]
        return P["feather"]
    # body, wings, tail: feathers, with the strap and satchel where the concept is leather
    if region == "bib" and (red or white):
        return P["beak_red"] if red else P["white"]
    if brown:
        return P["satchel"] if val > 0.5 else P["leather"]
    return P["feather_dark"] if val < 0.24 else P["feather"]


def paint_regions(co, concept, w, fallback):
    """Clean painted regions instead of per-vertex concept samples.

    The generated shell is a triangle soup, so neighbouring vertices pick up different concept pixels
    and different visibility; sampled straight, the colour speckles like camouflage. Each seen vertex
    is named by the concept's hue within what its body region can be (the head can be beak, lips,
    hat, goggles; the body feathers, strap or satchel; the legs leg or claw); a neighbourhood vote
    removes the speckle; unseen vertices take the paint of the nearest seen surface in their region;
    and a smoothed tone from the concept keeps its painted light and shade."""
    from mathutils.kdtree import KDTree
    n = len(co)
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    region = np.full(n, "body", dtype=object)
    region[(z > 1.08) & (y < -0.02) & (z <= 1.3)] = "bib"
    region[z > 1.3] = "head"
    region[(z < 0.5) & (y < 0.12)] = "leg"
    # the hip bags (the same volumes rook_rig.py gives the satchel bones)
    region[(np.abs(x) > 0.2) & (z > 0.4) & (z < 0.76) & (y < 0.3)] = "bag"
    pal = np.array([c for _, c in PALETTE], dtype=np.float32)
    seen = w > 0.5
    label = np.zeros(n, np.int32)
    for i in np.nonzero(seen)[0]:
        label[i] = classify(concept[i], region[i])
    for i in np.nonzero(~seen)[0]:
        label[i] = P["leg"] if region[i] == "leg" else P["satchel"] if region[i] == "bag" else P["feather"]
    lum = np.array([0.3, 0.55, 0.15], np.float32)
    tone = np.where(seen, (concept @ lum) / np.maximum(1e-3, pal[label] @ lum), 1.0)
    idx_seen = np.nonzero(seen)[0]
    kd_seen = KDTree(len(idx_seen))
    for j, i in enumerate(idx_seen):
        kd_seen.insert(co[i], j)
    kd_seen.balance()
    # unseen: the nearest seen surface's paint within the same region (the beak's far side is beak)
    for i in np.nonzero(~seen)[0]:
        if region[i] == "body":
            continue
        for (_, j, dist) in kd_seen.find_n(co[i], 3):
            k = idx_seen[j]
            if dist < 0.08 and region[k] == region[i]:
                label[i] = label[k]
                break
    kd = KDTree(n)
    for i, p in enumerate(co):
        kd.insert(p, i)
    kd.balance()
    new_label = label.copy()
    new_tone = np.ones(n, np.float32)
    for i in range(n):
        # the head's paints are big flat areas in the concept (beak, lips, hat): vote wider there
        nb = [j for (_, j, _) in kd.find_range(co[i], 0.034 if region[i] == "head" else 0.02)]
        if not nb:
            continue
        new_label[i] = np.bincount(label[nb], minlength=len(PALETTE)).argmax()
        new_tone[i] = float(np.clip(np.median(tone[nb]), 0.9, 1.1))
    # a painter's gradient on the feathers: lighter breast, darker back and crown
    feathers = np.isin(new_label, [P["feather"], P["feather_dark"]])
    grad = np.clip(1.0 + (-y) * 0.3 - np.maximum(z - 1.0, 0) * 0.15, 0.85, 1.12)
    new_tone = np.where(feathers, new_tone * grad, new_tone)
    out = pal[new_label] * new_tone[:, None]
    counts = {name: int((new_label == k).sum()) for k, (name, _) in enumerate(PALETTE)}
    print("[rook] painted regions", counts)
    return np.clip(out, 0, 1)


def bake_projection(obj):
    """The approved material, carried as data glTF can hold: the concept image as the texture, the
    projection (`proj_uv`) as the UV set, and the projection weight as a vertex attribute `_PROJW`.
    The runtime blends concept and feather green per pixel exactly as project_concept.py's node
    tree does, so Rook in the game is the approved Rook, not a re-painting of him."""
    me = obj.data
    mat = me.materials[0]
    img = next(nd.image for nd in mat.node_tree.nodes if nd.type == "TEX_IMAGE" and nd.image and nd.image.size[0] > 0)
    calm = next(nd for nd in mat.node_tree.nodes if nd.type == "RGB").outputs[0].default_value
    n = len(me.vertices)
    uv = np.empty(n * 2, dtype=np.float32)
    me.attributes["proj_uv"].data.foreach_get("vector", uv)
    uv = uv.reshape(n, 2)
    w = np.empty(n, dtype=np.float32)
    me.attributes["proj_w"].data.foreach_get("value", w)
    # The shell is loose fragments, so the per-vertex visibility flips fragment by fragment and the
    # feather-green fallback sprinkles over the painted face. Average the weight over each small
    # neighbourhood (the painted/unpainted boundary is a region, not a fragment) and firm it up.
    from mathutils.kdtree import KDTree
    co = np.empty(n * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(n, 3)
    kd = KDTree(n)
    for i, p_ in enumerate(co):
        kd.insert(p_, i)
    kd.balance()
    ws = np.empty(n, dtype=np.float32)
    for i in range(n):
        nb = [j for (_, j, _) in kd.find_range(co[i], 0.022)]
        ws[i] = float(w[nb].mean()) if nb else w[i]
    t = np.clip((ws - 0.18) / (0.5 - 0.18), 0, 1)
    w = (t * t * (3 - 2 * t)).astype(np.float32)
    for uvl in list(me.uv_layers):
        me.uv_layers.remove(uvl)
    layer = me.uv_layers.new(name="UVMap")
    loop_v = np.empty(len(me.loops), dtype=np.int32)
    me.loops.foreach_get("vertex_index", loop_v)
    layer.data.foreach_set("uv", uv[loop_v].ravel())
    pw = me.attributes.new("_PROJW", "FLOAT", "POINT")
    pw.data.foreach_set("value", w)
    for name in ("proj_uv", "proj_w"):
        if name in me.attributes:
            me.attributes.remove(me.attributes[name])
    for ca in list(me.color_attributes):
        me.color_attributes.remove(ca)
    m = bpy.data.materials.new("rook_runtime")
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.8
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.25
    tex = m.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.extension = "EXTEND"
    m.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    m.use_backface_culling = False
    me.materials.clear()
    me.materials.append(m)
    globals()["FALLBACK_SRGB"] = [round(float(c), 4) for c in calm[:3]]
    print(f"[rook] approved projection carried as UV + _PROJW on {n} vertices ({(w > 0.5).mean():.2f} from the concept)")


def evaluated_coords(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    ev.to_mesh_clear()
    return co


def to_three(p):
    return [round(p[0], 4), round(p[2], 4), round(-p[1], 4)]


def bake_morphs(low):
    W = RR.compute_weights(low)
    arm = RR.build_armature(low, W)
    rest = evaluated_coords(low)
    shapes = {}
    tips = {}
    for name, fn in KEYS:
        RR.reset(arm)
        fn(arm)
        bpy.context.view_layer.update()
        shapes[name] = evaluated_coords(low)
        pb = arm.pose.bones["wing.L"]
        tips[name] = to_three(arm.matrix_world @ pb.tail)
        print(f"[rook] key {name}: max offset {np.abs(shapes[name] - rest).max():.3f} m")
    RR.reset(arm)
    bpy.context.view_layer.update()
    tips["rest"] = to_three(arm.matrix_world @ arm.pose.bones["wing.L"].tail)
    # the jaw key is only the jaw: subtract anything else so it layers on any pose
    # (it already is only the jaw, since each key starts from reset)
    # drop the rig: shape keys carry the deformation
    for mod in list(low.modifiers):
        low.modifiers.remove(mod)
    low.parent = None
    for vg in list(low.vertex_groups):
        low.vertex_groups.remove(vg)
    bpy.data.objects.remove(arm, do_unlink=True)
    low.shape_key_add(name="Basis", from_mix=False)
    for name, _ in KEYS:
        sk = low.shape_key_add(name=name, from_mix=False)
        sk.data.foreach_set("co", shapes[name])
        sk.value = 0.0
    return tips


def preview(low, prefix):
    """Review renders of the key poses (EEVEE), so a look at the files precedes any claim."""
    scene = bpy.context.scene
    RR.build_scene(640)
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("w")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.5, 0.48, 0.45, 1)
    cam = scene.camera
    cam.data.type = "PERSP"
    cam.data.lens = 55
    for label, yaw in (("front", 0), ("three-quarter", 38), ("door", 70)):
        a = math.radians(yaw)
        cam.location = Vector((math.sin(a) * 4.2, -math.cos(a) * 4.2, 1.3))
        cam.rotation_euler = (Vector((0, 0, 0.9)) - cam.location).to_track_quat("-Z", "Y").to_euler()
        for name in ["rest"] + [k for k, _ in KEYS]:
            for sk in low.data.shape_keys.key_blocks[1:]:
                sk.value = 1.0 if sk.name == name else 0.0
            scene.render.filepath = f"{prefix}_{label}_{name}.png"
            bpy.ops.render.render(write_still=True)
    for sk in low.data.shape_keys.key_blocks[1:]:
        sk.value = 0.0


def main():
    low = load_runtime_mesh()
    bake_projection(low)
    tips = bake_morphs(low)
    if PREVIEW:
        preview(low, PREVIEW)
    select_only(low)
    out = os.path.join(OUT_DIR, "rook-runtime.glb")
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", use_selection=True, export_yup=True,
        export_animations=False, export_skins=False, export_morph=True, export_morph_normal=False,
        export_materials="EXPORT", export_attributes=True, export_image_format="WEBP", export_image_quality=90,
        export_meshopt_compression_enable=True, export_cameras=False, export_lights=False,
        export_apply=False,
    )
    meta = {
        "generator": "scripts/assets/coastal-proof/build_rook_runtime.py",
        "source": "approved TRELLIS.2 Rook mesh + rook-concept-v1 projection (unchanged), decimated LOD",
        "tris": tri_count(low),
        "height": round(low.dimensions.z, 4),
        "keys": [k for k, _ in KEYS],
        "wingTip": tips,
        # the projection's fallback (the concept's feather green, display sRGB) for unseen surfaces
        "fallback": globals().get("FALLBACK_SRGB"),
    }
    with open(os.path.join(OUT_DIR, "rook-runtime.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(f"[rook] wrote {os.path.relpath(out, REPO)} ({os.path.getsize(out) // 1024} KB), {meta['tris']} tris")


main()
