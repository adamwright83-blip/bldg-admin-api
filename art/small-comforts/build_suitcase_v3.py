"""
Small Comforts suitcase v3 — runtime-ready GLB.

  python build_suitcase_v3.py --blend small_comforts_vs02.blend --out OUT

* splits the suitcase into stable named nodes, lid pivots on the real hinge line
* culls hidden/internal faces, collapses stitch + rivet geometry, flattens the satin pocket
* re-bakes ONE shared atlas (same procedural materials as v2) then compresses it (JPEG/PNG) for the web
* exports in game units: 1 unit = 1 grid cell, +Y up, origin = centre of the 6x4 playable floor at floor height, lid CLOSED (rotation 0)
No collision geometry. Three.js primitives stay the collision/layout proxies.
"""
import io, json, math, os, sys
import bpy, bmesh
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_export_v2 as b2            # reuse bake helpers (no side effects on import)
from PIL import Image

CELL, FLOOR_Z = 0.15, 0.06
ATLAS = 2048
BASE_TEX, ORM_TEX, NORMAL_TEX = 2048, 1024, 1024      # delivered sizes
JPG_Q_BASE, JPG_Q_ORM, JPG_Q_NORMAL = 88, 90, 92

LID_GROUPS = ["Suitcase_Lid", "Lid_Lining", "Lid_Pocket", "Lid_Hardware"]
GROUPS = ["Suitcase_Base", "Fabric_Lining", "Elastic_Straps", "Brass_Latch", "Brass_Corners", "Base_Hardware"] + LID_GROUPS


def group_of(n):
    if n.startswith("LidLining_"): return "Lid_Lining"
    if n.startswith("Lining_"): return "Fabric_Lining"
    if n in ("Lid_Shell",) or n.startswith("LidStitch_"): return "Suitcase_Lid"
    if n in ("LidPocket",) or n.startswith("Pocket"): return "Lid_Pocket"
    if n.startswith("LidCorner_") or n.startswith("Hasp_"): return "Lid_Hardware"
    if n.startswith("Strap"): return "Elastic_Straps"
    if n.startswith("Latch"): return "Brass_Latch"
    if n.startswith("BaseCorner") or n.startswith("rv_"): return "Brass_Corners"
    if n.startswith("Handle") or n == "Hinge_Pin": return "Base_Hardware"
    if n in ("Base_Shell", "Rim_Welt") or n.startswith("Stitch_"): return "Suitcase_Base"
    raise KeyError(n)


def log(*a): print("[v3]", *a, flush=True)


def tris(me): return sum(len(p.vertices) - 2 for p in me.polygons)


def eval_mesh(ob, dg):
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), depsgraph=dg)
    me.transform(ob.matrix_world)
    return me


def decimated(me, ratio, col):
    ob = bpy.data.objects.new("tmp_dec", me); col.objects.link(ob)
    md = ob.modifiers.new("d", "DECIMATE"); md.ratio = ratio
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    out = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), depsgraph=dg)
    bpy.data.objects.remove(ob); return out


def solid_bvh(mes):
    bm = bmesh.new()
    for m in mes: bm.from_mesh(m)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bvh = BVHTree.FromBMesh(bm); bm.free(); return bvh


def cull_inside(me, bvh):
    """delete faces whose just-outside point lies INSIDE the other solid (= pressed against it, never visible)"""
    bm = bmesh.new(); bm.from_mesh(me); dead = []
    for f in bm.faces:
        c, n = f.calc_center_median(), f.normal
        hit = bvh.ray_cast(c + n * 0.0003, n)
        if hit[0] is not None and hit[1].dot(n) > 0:
            dead.append(f)
    bmesh.ops.delete(bm, geom=dead, context="FACES"); bm.to_mesh(me); bm.free(); return len(dead)


def stitch_top_only(me, shell_center, bvh=None, max_d=0.0025):
    bm = bmesh.new(); bm.from_mesh(me); bm.normal_update()
    if not bm.faces: bm.free(); return
    n0 = max(bm.faces, key=lambda f: f.calc_area()).normal.copy()
    A = [f for f in bm.faces if f.normal.dot(n0) > 0.95]; B = [f for f in bm.faces if f.normal.dot(n0) < -0.95]
    sa = np.mean([(f.calc_center_median() - shell_center).dot(n0) for f in A]) if A else -9
    sb = np.mean([(f.calc_center_median() - shell_center).dot(-n0) for f in B]) if B else -9
    keep = set(A if sa >= sb else B)
    if bvh is not None:      # drop stitches that float off the surface (rows overshoot the rounded corners)
        keep = {f for f in keep if (lambda r: r[0] is not None and r[3] <= max_d)(bvh.find_nearest(f.calc_center_median()))}
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in keep], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(me); bm.free()


def flatten_pocket(me):
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(2.0), verts=bm.verts, edges=bm.edges)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.normal_update()
    bad = [e for e in bm.edges if len(e.link_faces) == 2 and e.link_faces[0].normal.angle(e.link_faces[1].normal) > math.radians(12)]
    bmesh.ops.split_edges(bm, edges=bad)
    bm.to_mesh(me); bm.free()



def widen_thin_islands(objs, min_cells=0.09):
    """slivers (e.g. the 0.02-cell rim top strips) rasterise into <2 texels and pick up neighbouring islands (polka dots).
    Stretch every UV island whose thin side is narrower than `min_cells` of 3D size so it covers >= ~8 texels."""
    ratios = []
    for o in objs:
        me = o.data; uvl = me.uv_layers.active.data
        for p_ in me.polygons:
            pts = [uvl[l].uv for l in p_.loop_indices]
            a2 = 0.5 * abs(sum(pts[i].x * pts[(i + 1) % len(pts)].y - pts[(i + 1) % len(pts)].x * pts[i].y for i in range(len(pts))))
            if p_.area > 1e-6 and a2 > 0: ratios.append(math.sqrt(a2 / p_.area))
    sc_ = float(np.median(ratios)); thr = min_cells * CELL * sc_
    fixed = 0
    for o in objs:
        bm = bmesh.new(); bm.from_mesh(o.data); uv = bm.loops.layers.uv.active; bm.faces.ensure_lookup_table()
        par = list(range(len(bm.faces)))
        def find(a):
            while par[a] != a: par[a] = par[par[a]]; a = par[a]
            return a
        for e in bm.edges:
            if len(e.link_faces) != 2: continue
            f1, f2 = e.link_faces
            uv1 = {l.vert.index: l[uv].uv for l in f1.loops}; uv2 = {l.vert.index: l[uv].uv for l in f2.loops}
            if all((uv1[v.index] - uv2[v.index]).length < 1e-5 for v in e.verts): par[find(f1.index)] = find(f2.index)
        groups = {}
        for f in bm.faces: groups.setdefault(find(f.index), []).append(f)
        for fs in groups.values():
            us = [l[uv].uv.copy() for f in fs for l in f.loops]
            lo = Vector((min(u.x for u in us), min(u.y for u in us))); hi = Vector((max(u.x for u in us), max(u.y for u in us)))
            w, h = hi.x - lo.x, hi.y - lo.y; ax = 0 if w < h else 1; th = (w, h)[ax]
            if th < thr and max(w, h) > thr * 3:
                k = thr / max(th, 1e-9); c = (lo[ax] + hi[ax]) / 2
                for f in fs:
                    for l in f.loops:
                        u = l[uv].uv; u[ax] = c + (u[ax] - c) * k
                fixed += 1
        bm.to_mesh(o.data); bm.free()
    return fixed

# ------------------------------------------------------------------ build
def build(blend, out):
    bpy.ops.wm.open_mainfile(filepath=blend)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"; scene.cycles.device = "CPU"; scene.cycles.samples = 6; scene.cycles.use_denoising = False
    hinge = bpy.data.objects["LidHinge"]
    H = hinge.matrix_world.translation.copy()
    rot_open = hinge.matrix_world.to_euler()
    open_deg = math.degrees(rot_open.x)
    log("hinge", tuple(H), "open pose deg", open_deg)
    dg = bpy.context.evaluated_depsgraph_get()
    col = bpy.data.collections.new("V3"); scene.collection.children.link(col)
    meshes = {g: [] for g in GROUPS}
    stats = dict(before=0, after=0)
    suit = [o for o in bpy.data.collections["Suitcase"].all_objects if o.type == "MESH" and o.data.polygons]
    ev = {o.name: eval_mesh(o, dg) for o in suit}
    stats["before"] = sum(tris(m) for m in ev.values())
    shell_base = ev["Base_Shell"]; shell_lid = ev["Lid_Shell"]
    bb = lambda m: sum((Vector(v.co) for v in m.vertices), Vector()) / len(m.vertices)
    c_base, c_lid = bb(shell_base), bb(shell_lid)
    bvh_base = solid_bvh([shell_base]); bvh_lid = solid_bvh([shell_lid])
    culled = 0
    for name, me in ev.items():
        g = group_of(name)
        if name.startswith(("Stitch_", "LidStitch_", "PocketStitch_")):
            if name.startswith("PocketStitch_"): stitch_top_only(me, c_lid)
            elif name.startswith("LidStitch_"): stitch_top_only(me, c_lid, bvh_lid)
            else: stitch_top_only(me, c_base, bvh_base)
        elif name.startswith(("rv_", "LatchRv_")):
            me = decimated(me, 0.045, col)
        elif name.startswith("Lining_"):
            culled += cull_inside(me, bvh_base)
        elif name.startswith("LidLining_"):
            culled += cull_inside(me, bvh_lid)
        elif name == "LidPocket":
            lid_lin = solid_bvh([ev[n] for n in ev if n.startswith("LidLining_")])
            culled += cull_inside(me, lid_lin)
            flatten_pocket(me)
        if len(me.polygons) == 0: continue
        meshes[g].append((name, me))
    log("culled hidden faces", culled)
    # --- one object per group (world / open-lid pose), shared atlas
    objs = {}
    for g in GROUPS:
        bm = bmesh.new()
        mats = []
        for name, me in meshes[g]:
            slot_map = []
            for m in me.materials:
                if m not in mats: mats.append(m)
                slot_map.append(mats.index(m))
            off = len(bm.faces)
            bm.from_mesh(me)
            for f in list(bm.faces)[off:]:
                f.material_index = slot_map[f.material_index] if f.material_index < len(slot_map) else 0
        me = bpy.data.meshes.new(g); bm.to_mesh(me); bm.free()
        for m in mats: me.materials.append(m)
        for p in me.polygons: p.use_smooth = True
        ob = bpy.data.objects.new(g, me); col.objects.link(ob); objs[g] = ob
        log(g, "tris", tris(me), "mats", len(mats))
    stats["after"] = sum(tris(o.data) for o in objs.values())
    for o in bpy.data.objects:
        if o not in objs.values(): o.hide_render = True; o.hide_set(True)
    # --- UV + atlas
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs.values(): o.select_set(True)
    bpy.context.view_layer.objects.active = objs["Suitcase_Base"]
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.002, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode="OBJECT")
    log("widened thin UV islands:", widen_thin_islands(list(objs.values())))
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(margin=0.002)
    bpy.ops.object.mode_set(mode="OBJECT")
    mats = []
    for o in objs.values():
        for m in o.data.materials:
            if m and m not in mats: mats.append(m)
    work = os.path.join(out, "work_v3"); os.makedirs(work, exist_ok=True)
    img_rough = b2.new_image("sc3_rough", ATLAS, "Non-Color"); b2.set_target(mats, img_rough); log("bake rough"); b2.bake("ROUGHNESS")
    img_norm = b2.new_image("sc3_norm", ATLAS, "Non-Color", (0.5, 0.5, 1, 1)); b2.set_target(mats, img_norm); log("bake normal"); b2.bake("NORMAL", normal_space="TANGENT")
    img_base = b2.new_image("sc3_base", ATLAS, "sRGB"); b2.set_target(mats, img_base); b2.emission_probe(mats, "color"); log("bake base"); b2.bake("EMIT")
    for m in mats:
        nt = m.node_tree; nt.nodes.remove(nt.nodes["PROBE"]); nt.links.new(b2.principled(m).outputs["BSDF"], b2.output_node(m).inputs["Surface"])
    img_metal = b2.new_image("sc3_metal", ATLAS, "Non-Color"); b2.set_target(mats, img_metal); b2.emission_probe(mats, "metal"); log("bake metal"); b2.bake("EMIT")
    # --- compress for the web with Pillow
    def arr(img): return b2.pixels(img)
    def to_u8(a): return (np.clip(a, 0, 1) * 255.0 + 0.5).astype(np.uint8)
    def save_base():
        # Blender float buffer of an sRGB byte image is already display-referred -> store as-is
        p = arr(img_base).reshape(ATLAS, ATLAS, 4)[:, :, :3]
        im = Image.fromarray(np.flipud(to_u8(p)))
        im = im.resize((BASE_TEX, BASE_TEX), Image.LANCZOS) if BASE_TEX != ATLAS else im
        path = os.path.join(out, "suitcase_v3_basecolor.jpg"); im.save(path, quality=JPG_Q_BASE, optimize=True, progressive=True, subsampling="4:4:4"); return path
    def save_orm():
        r = arr(img_rough)[:, 0]; mt = arr(img_metal)[:, 0]
        o = np.ones((ATLAS * ATLAS, 3), np.float32); o[:, 0] = 1.0; o[:, 1] = r; o[:, 2] = mt
        im = Image.fromarray(np.flipud(to_u8(o.reshape(ATLAS, ATLAS, 3)))).resize((ORM_TEX, ORM_TEX), Image.LANCZOS)
        path = os.path.join(out, "suitcase_v3_orm.jpg"); im.save(path, quality=JPG_Q_ORM, optimize=True, subsampling="4:4:4"); return path
    def save_normal():
        p = arr(img_norm).reshape(ATLAS, ATLAS, 4)[:, :, :3]
        im = Image.fromarray(np.flipud(to_u8(p))).resize((NORMAL_TEX, NORMAL_TEX), Image.LANCZOS)
        path = os.path.join(out, "suitcase_v3_normal.jpg"); im.save(path, quality=JPG_Q_NORMAL, optimize=True, subsampling="4:4:4"); return path
    files = dict(basecolor=save_base(), orm=save_orm(), normal=save_normal())
    log("textures", {k: os.path.getsize(v) for k, v in files.items()})
    # --- one PBR material from the compressed files
    mat = bpy.data.materials.new("SC_suitcase_PBR"); mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    outn = nt.nodes.new("ShaderNodeOutputMaterial"); pb = nt.nodes.new("ShaderNodeBsdfPrincipled"); nt.links.new(pb.outputs["BSDF"], outn.inputs["Surface"])
    def tex(path, cs):
        n = nt.nodes.new("ShaderNodeTexImage"); n.image = bpy.data.images.load(path, check_existing=False); n.image.colorspace_settings.name = cs; return n
    tb = tex(files["basecolor"], "sRGB"); nt.links.new(tb.outputs["Color"], pb.inputs["Base Color"])
    to = tex(files["orm"], "Non-Color"); sep = nt.nodes.new("ShaderNodeSeparateColor"); nt.links.new(to.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], pb.inputs["Roughness"]); nt.links.new(sep.outputs["Blue"], pb.inputs["Metallic"])
    tn = tex(files["normal"], "Non-Color"); nm = nt.nodes.new("ShaderNodeNormalMap"); nt.links.new(tn.outputs["Color"], nm.inputs["Color"]); nt.links.new(nm.outputs["Normal"], pb.inputs["Normal"])
    # --- game space + hierarchy
    S = Matrix.Scale(1.0 / CELL, 4)
    to_game = S @ Matrix.Translation((0, 0, -FLOOR_Z))
    Rinv = Matrix.Rotation(-rot_open.x, 4, "X")        # open pose -> closed pose, about the hinge line
    Hg = Vector((H.x / CELL, H.y / CELL, (H.z - FLOOR_Z) / CELL))
    root = bpy.data.objects.new("Suitcase", None); col.objects.link(root)
    final = {}
    for g in GROUPS:
        ob = objs[g]; me = ob.data
        if g in LID_GROUPS: me.transform(S @ Matrix.Translation(-H) if False else S @ Rinv @ Matrix.Translation(-H))
        else: me.transform(to_game)
        me.materials.clear(); me.materials.append(mat)
        for p in me.polygons: p.material_index = 0
        final[g] = ob
    lid = final["Suitcase_Lid"]
    for g, ob in final.items():
        ob.hide_set(False); ob.hide_render = False
        if g == "Suitcase_Base" or (g not in LID_GROUPS and g != "Suitcase_Base"): ob.parent = root if g == "Suitcase_Base" else final["Suitcase_Base"]
    lid.parent = root; lid.location = Hg
    for g in ("Lid_Lining", "Lid_Pocket", "Lid_Hardware"): final[g].parent = lid     # identity local transform: same pivot
    for o in (root, *final.values()): o.select_set(True)
    glb_dir = os.path.join(out, "glb_v3"); os.makedirs(glb_dir, exist_ok=True)
    path = os.path.join(glb_dir, "sc_suitcase_v3.glb")
    bpy.ops.object.select_all(action="DESELECT")
    for o in (root, *final.values()): o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
                              export_image_format="AUTO", export_materials="EXPORT", export_cameras=False, export_lights=False)
    info = dict(glb=path, bytes=os.path.getsize(path), tris_before=stats["before"], tris_after=sum(tris(o.data) for o in final.values()),
                per_node_tris={g: tris(o.data) for g, o in final.items()}, hinge_blender=list(H), hinge_game_blender_axes=list(Hg),
                open_angle_deg_blender_x=open_deg, texture_bytes={k: os.path.getsize(v) for k, v in files.items()})
    json.dump(info, open(os.path.join(out, "build_v3_info.json"), "w"), indent=2)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "small_comforts_vs03_suitcase.blend"))
    log("DONE", info["bytes"], "bytes", info["tris_before"], "->", info["tris_after"], "tris")


if __name__ == "__main__":
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    o = lambda f, d=None: a[a.index(f) + 1] if f in a else d
    build(o("--blend"), o("--out"))
