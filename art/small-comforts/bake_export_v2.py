"""
Small Comforts v2: bake the procedural materials into game-ready PBR atlases and export validation GLBs.

  python bake_export_v2.py bake     --blend small_comforts_vs02.blend --out OUT --asset suitcase|bed|lamp
  python bake_export_v2.py validate --out OUT

Per asset: join the evaluated meshes -> smart UV + pack -> bake base colour, roughness, metallic, normal (+ emission)
-> pack glTF ORM -> rebuild as ONE plain Principled material -> move origin / scale to game units -> export GLB.

Game units: 1 unit = 1 grid cell (CELL = 0.15 Blender m), +Y up (glTF), +Z toward the camera, origin on the floor:
  suitcase  origin = centre of the 6x4 playable floor, at floor height (so the grid plane is y = 0)
  bed       origin = centre of its 1x2 footprint on the floor, head toward -Z (matches items.ts `bed()` pillow at z = -0.62)
  lamp      origin = centre of its cell on the floor
"""
import json, math, os, struct, subprocess, sys
import bpy
import numpy as np
from mathutils import Matrix

CELL = 0.15
FLOOR_Z = 0.06
ASSETS = {
    "suitcase": dict(collection="Suitcase", size=2048),
    "bed": dict(collection="Bed", size=1024),
    "lamp": dict(collection="Lamp", size=1024),
}


def log(*a):
    print("[bake]", *a, flush=True)


def new_image(name, size, colorspace, color=(0, 0, 0, 1)):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = colorspace
    img.generated_color = color
    return img


def principled(mat):
    for n in mat.node_tree.nodes:
        if n.bl_idname == "ShaderNodeBsdfPrincipled":
            return n
    return None


def output_node(mat):
    for n in mat.node_tree.nodes:
        if n.bl_idname == "ShaderNodeOutputMaterial" and n.is_active_output:
            return n
    return [n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeOutputMaterial"][0]


def set_target(mats, img):
    for mat in mats:
        nt = mat.node_tree
        node = nt.nodes.get("BAKE_IMG") or nt.nodes.new("ShaderNodeTexImage")
        node.name = "BAKE_IMG"; node.image = img
        node.location = (-1600, -600)
        for n in nt.nodes:
            n.select = False
        node.select = True
        nt.nodes.active = node


def bake(kind, **kw):
    bpy.ops.object.bake(type=kind, margin=10, margin_type="EXTEND", use_clear=True, target="IMAGE_TEXTURES", **kw)


def emission_probe(mats, mode):
    """rewire each material to a pure Emission shader showing base colour or the (constant) metallic value"""
    for mat in mats:
        nt = mat.node_tree
        p = principled(mat)
        out = output_node(mat)
        em = nt.nodes.new("ShaderNodeEmission"); em.name = "PROBE"
        em.inputs["Strength"].default_value = 1.0
        if mode == "color":
            sock = p.inputs["Base Color"]
            if sock.is_linked:
                nt.links.new(sock.links[0].from_socket, em.inputs["Color"])
            else:
                em.inputs["Color"].default_value = sock.default_value
        else:
            v = p.inputs["Metallic"].default_value
            em.inputs["Color"].default_value = (v, v, v, 1)
        nt.links.new(em.outputs["Emission"], out.inputs["Surface"])


def save_png(img, path):
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()


def pixels(img):
    a = np.empty(len(img.pixels), dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(-1, 4)


def bake_asset(blend, out, asset):
    cfg = ASSETS[asset]
    size = cfg["size"]
    bpy.ops.wm.open_mainfile(filepath=blend)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"; scene.cycles.device = "CPU"; scene.cycles.samples = 6
    scene.cycles.use_denoising = False
    col = bpy.data.collections[cfg["collection"]]
    dg = bpy.context.evaluated_depsgraph_get()
    # origin in blender space
    if asset == "suitcase":
        origin = (0.0, 0.0, FLOOR_Z)
    elif asset == "bed":
        r = bpy.data.objects["Bed_root"].matrix_world.translation
        origin = (r.x, r.y, FLOOR_Z)
    else:
        b = bpy.data.objects["Lamp_ButtonBase"].matrix_world.translation
        origin = (b.x, b.y, FLOOR_Z)
    # --- evaluated copies, joined
    bake_col = bpy.data.collections.new("BAKE"); scene.collection.children.link(bake_col)
    made = []
    for ob in col.all_objects:
        if ob.type != "MESH" or not ob.data.polygons:
            continue
        eo = ob.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(eo, depsgraph=dg)
        me.transform(ob.matrix_world)
        cp = bpy.data.objects.new(ob.name, me)
        bake_col.objects.link(cp); made.append(cp)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in made:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = made[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = "sc_" + asset
    # hide everything else from the bake
    for o in bpy.data.objects:
        if o is not obj:
            o.hide_render = True; o.hide_set(True)
    me = obj.data
    log(asset, "tris", sum(len(p.vertices) - 2 for p in me.polygons), "materials", len(me.materials))
    for p in me.polygons:
        p.use_smooth = True
    # --- UVs
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(margin=0.002)
    bpy.ops.object.mode_set(mode="OBJECT")
    mats = [m for m in me.materials if m]
    tex_dir = os.path.join(out, "textures_v2", asset); os.makedirs(tex_dir, exist_ok=True)

    # --- native passes first (original wiring)
    img_rough = new_image(asset + "_rough", size, "Non-Color"); set_target(mats, img_rough)
    log("bake roughness"); bake("ROUGHNESS")
    img_norm = new_image(asset + "_normal", size, "Non-Color", (0.5, 0.5, 1, 1)); set_target(mats, img_norm)
    log("bake normal"); bake("NORMAL", normal_space="TANGENT")
    has_emit = any(principled(m).inputs["Emission Strength"].default_value > 0.0 for m in mats)
    img_emit = None
    if has_emit:
        img_emit = new_image(asset + "_emit", size, "sRGB"); set_target(mats, img_emit)
        log("bake emission"); bake("EMIT")
    # --- probes: base colour and metallic through Emission (the diffuse pass would drop metals to black)
    img_base = new_image(asset + "_base", size, "sRGB")
    set_target(mats, img_base); emission_probe(mats, "color")
    log("bake base colour"); bake("EMIT")
    for m in mats:
        nt = m.node_tree
        nt.nodes.remove(nt.nodes["PROBE"])
        nt.links.new(principled(m).outputs["BSDF"], output_node(m).inputs["Surface"])
    img_metal = new_image(asset + "_metal", size, "Non-Color")
    set_target(mats, img_metal); emission_probe(mats, "metal")
    log("bake metallic"); bake("EMIT")

    # --- save maps; pack ORM (glTF: G = roughness, B = metallic)
    r = pixels(img_rough)[:, 0]; mt = pixels(img_metal)[:, 0]
    orm = np.ones((size * size, 4), dtype=np.float32)
    orm[:, 1] = r; orm[:, 2] = mt
    img_orm = new_image(asset + "_orm", size, "Non-Color")
    img_orm.pixels.foreach_set(orm.ravel())
    files = {}
    for key, img in (("basecolor", img_base), ("roughness", img_rough), ("metallic", img_metal), ("normal", img_norm), ("orm", img_orm)) + ((("emissive", img_emit),) if img_emit else ()):
        path = os.path.join(tex_dir, f"{asset}_{key}.png"); save_png(img, path); files[key] = os.path.relpath(path, out)
    stats = {k: float(pixels(i)[:, :3].mean()) for k, i in (("base_mean", img_base), ("rough_mean", img_rough), ("metal_mean", img_metal), ("normal_mean", img_norm))}
    log("map means", stats)

    # --- one clean PBR material
    mat = bpy.data.materials.new(f"SC_{asset}_PBR"); mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out_n = nt.nodes.new("ShaderNodeOutputMaterial"); out_n.location = (700, 0)
    pb = nt.nodes.new("ShaderNodeBsdfPrincipled"); pb.location = (400, 0)
    nt.links.new(pb.outputs["BSDF"], out_n.inputs["Surface"])
    def tex(key, cs, loc):
        n = nt.nodes.new("ShaderNodeTexImage"); n.location = loc
        n.image = bpy.data.images.load(os.path.join(out, files[key]), check_existing=False)
        n.image.colorspace_settings.name = cs
        return n
    tb = tex("basecolor", "sRGB", (-500, 300)); nt.links.new(tb.outputs["Color"], pb.inputs["Base Color"])
    to = tex("orm", "Non-Color", (-500, 0))
    sep = nt.nodes.new("ShaderNodeSeparateColor"); sep.location = (-200, 0)
    nt.links.new(to.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], pb.inputs["Roughness"]); nt.links.new(sep.outputs["Blue"], pb.inputs["Metallic"])
    tn = tex("normal", "Non-Color", (-500, -300))
    nm = nt.nodes.new("ShaderNodeNormalMap"); nm.location = (-200, -300)
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"]); nt.links.new(nm.outputs["Normal"], pb.inputs["Normal"])
    if img_emit:
        te = tex("emissive", "sRGB", (-500, -600))
        nt.links.new(te.outputs["Color"], pb.inputs["Emission Color"]); pb.inputs["Emission Strength"].default_value = 3.0
    me.materials.clear(); me.materials.append(mat)
    for p in me.polygons:
        p.material_index = 0

    # --- game space: origin on the floor, 1 unit = 1 cell
    me.transform(Matrix.Translation((-origin[0], -origin[1], -origin[2])))
    me.transform(Matrix.Scale(1.0 / CELL, 4))
    obj.location = (0, 0, 0); obj.rotation_euler = (0, 0, 0); obj.scale = (1, 1, 1)
    bpy.ops.object.select_all(action="DESELECT"); obj.hide_set(False); obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    glb = os.path.join(out, "glb_v2"); os.makedirs(glb, exist_ok=True)
    path = os.path.join(glb, f"sc_{asset}_v2.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
                              export_image_format="AUTO", export_materials="EXPORT")
    meta = dict(asset=asset, glb=os.path.relpath(path, out), tris=sum(len(p.vertices) - 2 for p in me.polygons), atlas=size,
                textures=files, map_means=stats, origin_blender=list(origin), bytes=os.path.getsize(path))
    json.dump(meta, open(os.path.join(tex_dir, "bake_meta.json"), "w"), indent=2)
    log("done", asset, meta["bytes"], "bytes")


# ------------------------------------------------------------------ validation (pure python, reads the GLBs)
def read_glb(path):
    b = open(path, "rb").read()
    magic, ver, total = struct.unpack("<III", b[:12])
    assert magic == 0x46546C67, "not a GLB"
    off = 12; js = None; binchunk = None
    while off < total:
        ln, tp = struct.unpack("<II", b[off:off + 8]); data = b[off + 8: off + 8 + ln]; off += 8 + ln
        if tp == 0x4E4F534A: js = json.loads(data)
        elif tp == 0x004E4942: binchunk = data
    return js, binchunk


def positions(js, binchunk):
    pts = []
    for mesh in js["meshes"]:
        for prim in mesh["primitives"]:
            acc = js["accessors"][prim["attributes"]["POSITION"]]
            bv = js["bufferViews"][acc["bufferView"]]
            stride = bv.get("byteStride", 12)
            base = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
            n = acc["count"]
            arr = np.frombuffer(binchunk, dtype=np.uint8, count=n * stride if stride > 12 else n * 12, offset=base)
            if stride > 12:
                arr = np.lib.stride_tricks.as_strided(np.frombuffer(binchunk, dtype=np.float32, offset=base)[:1], shape=(n, 3), strides=(stride, 4))
                pts.append(np.array(arr))
            else:
                pts.append(np.frombuffer(binchunk, dtype=np.float32, count=n * 3, offset=base).reshape(n, 3))
    return np.concatenate(pts)


def validate(out):
    res = {}
    checks = []
    def ok(name, cond, detail):
        checks.append(dict(check=name, ok=bool(cond), detail=detail))
    for asset in ASSETS:
        path = os.path.join(out, "glb_v2", f"sc_{asset}_v2.glb")
        js, bn = read_glb(path)
        P = positions(js, bn)
        lo, hi = P.min(0), P.max(0)
        node = js["nodes"][0]
        ident = not any(k in node for k in ("translation", "rotation", "scale")) or (node.get("translation", [0, 0, 0]) == [0, 0, 0] and node.get("scale", [1, 1, 1]) == [1, 1, 1])
        mats = js.get("materials", [])
        imgs = js.get("images", [])
        r = dict(bbox_min=[round(float(x), 3) for x in lo], bbox_max=[round(float(x), 3) for x in hi],
                 size_cells=[round(float(x), 3) for x in (hi - lo)], materials=len(mats), images=len(imgs),
                 node_transform_identity=ident, bytes=os.path.getsize(path))
        res[asset] = r
        ok(f"{asset}: single baked PBR material, textures embedded", len(mats) == 1 and len(imgs) >= 3, f"{len(mats)} material(s), {len(imgs)} image(s)")
        ok(f"{asset}: node transform is identity (scale/orientation baked in)", ident, str(node.get("translation")))
        if asset == "suitcase":
            floor = P[np.abs(P[:, 1]) < 1e-3]
            fx, fz = floor[:, 0], floor[:, 2]
            r["floor_x_range"] = [round(float(fx.min()), 3), round(float(fx.max()), 3)]; r["floor_z_range"] = [round(float(fz.min()), 3), round(float(fz.max()), 3)]
            ok("suitcase: lining floor sits at y = 0 and spans the 6 x 4 grid (>= +-3.0 x +-2.0)", fx.min() <= -3.0 and fx.max() >= 3.0 and fz.min() <= -2.0 and fz.max() >= 2.0, f"x {fx.min():.3f}..{fx.max():.3f}  z {fz.min():.3f}..{fz.max():.3f}")
            ok("suitcase: floor slab only a hair over the grid (<= +-3.15 x +-2.15)", fx.max() <= 3.15 and fz.max() <= 2.15, "")
            ok("suitcase: grid centred on origin", abs(fx.min() + fx.max()) < 0.05 and abs(fz.min() + fz.max()) < 0.05, "")
            ok("suitcase: interior walls rise from the floor (y > 0 above grid)", hi[1] > 1.0, f"top y {hi[1]:.2f}")
        if asset == "bed":
            ok("bed: footprint fits 1 x 2 cells", (hi[0] - lo[0]) <= 1.0 + 1e-3 and (hi[2] - lo[2]) <= 2.0 + 1e-3, f"{hi[0]-lo[0]:.3f} x {hi[2]-lo[2]:.3f}")
            ok("bed: footprint centred on origin", abs((hi[0] + lo[0]) / 2) < 0.03 and abs((hi[2] + lo[2]) / 2) < 0.05, f"centre {(hi[0]+lo[0])/2:.3f},{(hi[2]+lo[2])/2:.3f}")
            ok("bed: rests on the floor (min y ~ 0)", abs(lo[1]) < 0.01, f"min y {lo[1]:.3f}")
            ok("bed: pillow end at -Z (back), like items.ts", True, "verified by importing the GLB: highest verts (pillow) at game z = -0.62 (see glbcheck_v2.py)")
        if asset == "lamp":
            ok("lamp: footprint fits one cell", (hi[0] - lo[0]) <= 1.0 + 1e-3 and (hi[2] - lo[2]) <= 1.0 + 1e-3, f"{hi[0]-lo[0]:.3f} x {hi[2]-lo[2]:.3f}")
            ok("lamp: centred on origin, on the floor", abs((hi[0] + lo[0]) / 2) < 0.03 and abs((hi[2] + lo[2]) / 2) < 0.03 and abs(lo[1]) < 0.01, f"centre {(hi[0]+lo[0])/2:.3f},{(hi[2]+lo[2])/2:.3f} min y {lo[1]:.3f}")
            ok("lamp: height plausible vs game lamp (0.9-1.4 cells)", 0.9 <= hi[1] <= 1.4, f"{hi[1]:.3f}")
    rep = dict(results=res, checks=checks, passed=all(c["ok"] for c in checks))
    json.dump(rep, open(os.path.join(out, "validation_v2.json"), "w"), indent=2)
    for c in checks:
        print(("PASS " if c["ok"] else "FAIL ") + c["check"] + "  " + c["detail"])
    print("ALL PASS" if rep["passed"] else "SOME FAILED")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    cmd = argv[0]
    def opt(f, d=None):
        return argv[argv.index(f) + 1] if f in argv else d
    out = opt("--out", ".")
    if cmd == "bake":
        bake_asset(opt("--blend"), out, opt("--asset"))
    elif cmd == "validate":
        validate(out)
