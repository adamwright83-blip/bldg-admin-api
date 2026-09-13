"""
Project the concept art onto an image-to-3D mesh, then render the turntable.

TRELLIS.2 builds the mesh FROM one concept image, so there is a view in which
the mesh lines up with that image. Its own baked texture is poor on this machine
(fallback baker, thousands of tiny UV islands at 1024px): the green body and
red-spotted face came out as dark camouflage and the white mouth was lost. From
the registered view, the concept itself is the best possible texture, so:

  1. Map every vertex into the concept through the registered view. The mesh's
     projected bounding box is aligned to the concept's alpha bounding box,
     which is exactly how the view was found (silhouette IoU after bbox-to-
     square normalisation).
  2. Ray-cast each vertex toward the view. Occluded surfaces (the far leg behind
     the near leg) must not inherit the colour of whatever is in front of them.
  3. Weight by how squarely the surface faces the view, times the concept's own
     alpha. Sides and back fall back to the generated texture, calmed toward the
     concept's mean body colour so the seam is not bright-meets-mud.

Renders straight from that material through the shared rig. No texture bake:
frames are what ship, and a Cycles bake would be the riskiest step here.

    blender --background --factory-startup --python project_concept.py -- \
      --glb rook.glb --concept rook-cutout.png --out frames --id rook \
      --yaw 38 --elev 14 --rotate-x -90
"""
import bpy, sys, os, json, math, argparse
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rig import build_rig, normalize, TARGET_HEIGHT, AZIMUTH
from glb_to_frames import import_glb, bake_state


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def project(obj, concept_path, yaw, elev):
    mesh = obj.data
    n = len(mesh.vertices)
    co = np.empty(n * 3, dtype=np.float64); mesh.vertices.foreach_get("co", co); co = co.reshape(n, 3)
    nm = np.empty(n * 3, dtype=np.float64); mesh.vertices.foreach_get("normal", nm); nm = nm.reshape(n, 3)
    mw = np.array(obj.matrix_world)
    co = co @ mw[:3, :3].T + mw[:3, 3]

    lo, hi = co.min(0), co.max(0)
    ctr = (lo + hi) / 2
    a, e = math.radians(yaw), math.radians(elev)
    to_cam = np.array([math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)])
    f = -to_cam                                   # camera forward
    up_hint = np.array([0.0, 0.0, 1.0])
    right = np.cross(f, up_hint); right /= np.linalg.norm(right)
    up = np.cross(right, f)

    rel = co - ctr
    px = rel @ right                              # image x, rightward
    row = -(rel @ up)                             # image y, downward

    img = bpy.data.images.load(concept_path)
    W, H = img.size
    rgba = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)[::-1]   # top row first
    alpha = rgba[..., 3]
    ys, xs = np.nonzero(alpha > 0.5)
    cx0, cx1, cy0, cy1 = xs.min(), xs.max(), ys.min(), ys.max()
    mx0, mx1, my0, my1 = px.min(), px.max(), row.min(), row.max()
    k = max(cx1 - cx0, cy1 - cy0) / max(mx1 - mx0, my1 - my0)
    u_px = (cx0 + cx1) / 2 + (px - (mx0 + mx1) / 2) * k
    v_px = (cy0 + cy1) / 2 + (row - (my0 + my1) / 2) * k

    inside = (u_px >= 0) & (u_px < W - 1) & (v_px >= 0) & (v_px < H - 1)
    ui = np.clip(u_px.astype(int), 0, W - 1); vi = np.clip(v_px.astype(int), 0, H - 1)
    a_samp = np.where(inside, alpha[vi, ui], 0.0)

    facing = smoothstep(0.12, 0.45, nm @ to_cam)

    # visibility: parallel rays toward the orthographic view
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(obj, dg)
    diag = float(np.linalg.norm(hi - lo))
    eps = diag * 5e-4
    d = Vector(to_cam.tolist())
    visible = np.ones(n, dtype=np.float32)
    candidates = np.nonzero((facing > 0) & (a_samp > 0))[0]
    for i in candidates:
        hit = bvh.ray_cast(Vector((co[i] + to_cam * eps).tolist()), d, diag * 2)
        if hit[0] is not None:
            visible[i] = 0.0

    weight = (facing * visible * a_samp).astype(np.float32)

    # concept's mean colour over its opaque body, for calming the fallback
    body = rgba[alpha > 0.5][:, :3]
    mean_body = body.mean(0)

    # write per-vertex attributes the shader reads
    for name, data, dtype in (("proj_uv", np.stack([u_px / W, 1 - v_px / H], 1).ravel(), "FLOAT2"),
                              ("proj_w", weight, "FLOAT")):
        if name in mesh.attributes: mesh.attributes.remove(mesh.attributes[name])
        at = mesh.attributes.new(name, dtype, "POINT")
        at.data.foreach_set("vector" if dtype == "FLOAT2" else "value", np.asarray(data, dtype=np.float32))
    mesh.update()
    return img, mean_body, float((weight > 0.5).mean())


def projection_material(obj, concept_img, mean_body, calm=0.45):
    old = obj.material_slots[0].material if obj.material_slots else None
    gen_img = None
    if old and old.use_nodes:
        gen_img = next((nd.image for nd in old.node_tree.nodes if nd.type == "TEX_IMAGE" and nd.image), None)
    m = bpy.data.materials.new("rook_projected"); m.use_nodes = True
    m.use_backface_culling = False
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.82
    if "Specular IOR Level" in bsdf.inputs: bsdf.inputs["Specular IOR Level"].default_value = 0.2
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    uv_attr = nt.nodes.new("ShaderNodeAttribute"); uv_attr.attribute_name = "proj_uv"
    w_attr = nt.nodes.new("ShaderNodeAttribute"); w_attr.attribute_name = "proj_w"
    concept = nt.nodes.new("ShaderNodeTexImage"); concept.image = concept_img; concept.extension = "CLIP"
    nt.links.new(uv_attr.outputs["Vector"], concept.inputs["Vector"])

    calm_col = nt.nodes.new("ShaderNodeRGB")
    calm_col.outputs[0].default_value = (float(mean_body[0]), float(mean_body[1]), float(mean_body[2]), 1)
    fallback = nt.nodes.new("ShaderNodeMix"); fallback.data_type = "RGBA"
    fallback.inputs[0].default_value = calm
    if gen_img:
        gen = nt.nodes.new("ShaderNodeTexImage"); gen.image = gen_img
        nt.links.new(gen.outputs["Color"], fallback.inputs[6])
    else:
        fallback.inputs[6].default_value = (float(mean_body[0]), float(mean_body[1]), float(mean_body[2]), 1)
    nt.links.new(calm_col.outputs[0], fallback.inputs[7])

    final = nt.nodes.new("ShaderNodeMix"); final.data_type = "RGBA"
    nt.links.new(w_attr.outputs["Fac"], final.inputs[0])
    nt.links.new(fallback.outputs[2], final.inputs[6])
    nt.links.new(concept.outputs["Color"], final.inputs[7])
    nt.links.new(final.outputs[2], bsdf.inputs["Base Color"])

    obj.data.materials.clear(); obj.data.materials.append(m)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--glb", required=True); ap.add_argument("--concept", required=True)
    ap.add_argument("--out", required=True); ap.add_argument("--id", required=True)
    ap.add_argument("--yaw", type=float, required=True); ap.add_argument("--elev", type=float, required=True)
    ap.add_argument("--rotate-x", type=float, default=0.0)
    ap.add_argument("--frames", type=int, default=24); ap.add_argument("--res", type=int, default=512)
    ap.add_argument("--states", default="turn,idle")
    ap.add_argument("--light-scale", type=float, default=2.2,
                    help="Rig lights were tuned for a black scripted bird; a bright projected texture needs more.")
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_rig()
    for L in [o for o in bpy.data.objects if o.type == "LIGHT"]:
        L.data.energy *= a.light_scale
    imported = import_glb(a.glb, a.rotate_x)
    obj = next(o for o in imported if o.type == "MESH")
    concept_img, mean_body, covered = project(obj, os.path.abspath(a.concept), a.yaw, a.elev)
    projection_material(obj, concept_img, mean_body)
    info = normalize(imported)
    objects = list(bpy.data.objects)

    states = {}
    for st in [x.strip() for x in a.states.split(",") if x.strip()]:
        states[st] = bake_state(objects, st, a.frames, a.out, a.id, a.res)
    meta = {"assetId": a.id, "source": os.path.basename(a.glb), "concept": os.path.basename(a.concept),
            "pivot": "center_bottom", "frameSize": {"width": a.res, "height": a.res},
            "targetHeightBlenderUnits": TARGET_HEIGHT, "normalization": info,
            "shading": "concept-projection", "registeredView": {"yaw": a.yaw, "elev": a.elev},
            "rotateX": a.rotate_x, "cameraAzimuth": AZIMUTH, "projectedVertexShare": covered,
            "states": {k: {"frames": len(v), "files": v} for k, v in states.items()},
            "rig": "scripts/assets/blender/rig.py"}
    json.dump(meta, open(os.path.join(a.out, f"{a.id}.frames.json"), "w"), indent=1)
    print("PROJECTED share=%.3f frames=%s" % (covered, {k: len(v) for k, v in states.items()}))


if __name__ == "__main__":
    main()
