"""
Validate sc_suitcase_v3.glb: node names, tri count, size, floor bounds, origin, hinge pivot, and PROVE lid rotation
by re-importing the GLB in Blender and rotating the lid node at closed / 45 deg / fully open.

  python validate_suitcase_v3.py --glb sc_suitcase_v3.glb --out OUT
Writes validation_v3.json + render/lid_proof_v3.png
"""
import json, math, os, struct, sys
import numpy as np
import bpy
from mathutils import Vector
from PIL import Image

CELL = 0.15
OPEN_DEG = 107.0
EXPECT_NODES = ["Suitcase", "Suitcase_Base", "Fabric_Lining", "Elastic_Straps", "Brass_Latch", "Brass_Corners", "Base_Hardware",
                "Suitcase_Lid", "Lid_Lining", "Lid_Pocket", "Lid_Hardware"]


def read_glb(path):
    b = open(path, "rb").read(); off = 12; js = bn = None
    while off < len(b):
        ln, tp = struct.unpack("<II", b[off:off + 8]); d = b[off + 8: off + 8 + ln]; off += 8 + ln
        if tp == 0x4E4F534A: js = json.loads(d)
        elif tp == 0x004E4942: bn = d
    return js, bn


def accessor(js, bn, idx):
    a = js["accessors"][idx]; bv = js["bufferViews"][a["bufferView"]]
    comp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
    dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32}[a["componentType"]]
    isz = np.dtype(dt).itemsize; stride = bv.get("byteStride", comp * isz)
    base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    raw = np.frombuffer(bn, dtype=np.uint8, count=stride * (a["count"] - 1) + comp * isz, offset=base)
    out = np.lib.stride_tricks.as_strided(raw, shape=(a["count"], comp * isz), strides=(stride, 1)).copy().view(dt).reshape(a["count"], comp)
    return out


def parse(path):
    js, bn = read_glb(path); nodes = js["nodes"]
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []): parent[c] = i
    info = {}; geo = {}
    for i, n in enumerate(nodes):
        name = n["name"]; row = dict(parent=nodes[parent[i]]["name"] if i in parent else None, translation=n.get("translation", [0, 0, 0]),
                                      rotation=n.get("rotation", [0, 0, 0, 1]), scale=n.get("scale", [1, 1, 1]))
        if "mesh" in n:
            t = 0; P = []
            for pr in js["meshes"][n["mesh"]]["primitives"]:
                t += accessor(js, bn, pr["indices"]).size // 3; P.append(accessor(js, bn, pr["attributes"]["POSITION"]))
            P = np.concatenate(P); row.update(tris=int(t), verts=int(len(P)), bbox_min=[round(float(x), 4) for x in P.min(0)], bbox_max=[round(float(x), 4) for x in P.max(0)])
            geo[name] = P
        info[name] = row
    return js, info, geo


def run(glb, out):
    js, info, geo = parse(glb)
    checks = []
    def ok(name, cond, detail=""): checks.append(dict(check=name, ok=bool(cond), detail=str(detail)))
    size = os.path.getsize(glb)
    total_tris = sum(r.get("tris", 0) for r in info.values())
    ok("all expected node names present", all(n in info for n in EXPECT_NODES), sorted(set(EXPECT_NODES) - set(info)))
    ok("file size < 4 MB (target < 3 MB)", size < 3_000_000, f"{size/1e6:.2f} MB")
    ok("single material, 3 embedded textures", len(js["materials"]) == 1 and len(js["images"]) == 3, f"{len(js['materials'])} material(s), {len(js['images'])} image(s)")
    ok("no collision / proxy geometry in the file", not any("collis" in n.lower() or "proxy" in n.lower() for n in info), "")
    root = info["Suitcase"]; ok("root origin (0,0,0), unit scale, no rotation", root["translation"] == [0, 0, 0] and root["scale"] == [1, 1, 1] and root["rotation"] == [0, 0, 0, 1], root["translation"])
    lid = info["Suitcase_Lid"]; hinge = lid["translation"]
    exp_hinge = [0.0, (0.2 - 0.06) / CELL, -0.37 / CELL]
    ok("lid node translation = real hinge line (back-top edge of base)", np.allclose(hinge, exp_hinge, atol=1e-3), f"{hinge} expected {[round(x,4) for x in exp_hinge]}")
    ok("lid node rotation is identity when closed", np.allclose(lid["rotation"], [0, 0, 0, 1], atol=1e-6), lid["rotation"])
    for c in ("Lid_Lining", "Lid_Pocket", "Lid_Hardware"):
        ok(f"{c} is a child of Suitcase_Lid with identity local transform", info[c]["parent"] == "Suitcase_Lid" and info[c]["translation"] == [0, 0, 0], info[c]["parent"])
    ok("base parts are children of the base/root, not the lid", all(info[c]["parent"] in ("Suitcase", "Suitcase_Base") for c in ("Suitcase_Base", "Fabric_Lining", "Elastic_Straps", "Brass_Latch", "Brass_Corners", "Base_Hardware")), "")
    # --- floor bounds (glTF Y-up, game units)
    F = geo["Fabric_Lining"]
    # lining is culled to its visible faces, so the floor is a few corner verts: floor top = highest verts below y = 0.2
    low = F[F[:, 1] < 0.2]; floor_y = float(low[:, 1].max()); fl = low[np.abs(low[:, 1] - floor_y) < 1e-3]
    fx = (float(fl[:, 0].min()), float(fl[:, 0].max())); fz = (float(fl[:, 2].min()), float(fl[:, 2].max()))
    walls = F[F[:, 1] > 0.5]
    wall_x = float(np.abs(walls[np.abs(walls[:, 0]) > 2.5][:, 0]).min()); wall_z = float(np.abs(walls[np.abs(walls[:, 2]) > 1.5][:, 2]).min())
    ok("playable floor plane at y = 0", abs(floor_y) < 1e-3, f"{floor_y:.4f}")
    ok("floor slab centred on origin", abs(sum(fx)) < 0.02 and abs(sum(fz)) < 0.02, f"x {fx[0]:.3f}..{fx[1]:.3f}  z {fz[0]:.3f}..{fz[1]:.3f}")
    ok("inner wall faces on the 6 x 4 grid edges (x = +-3.0, z = +-2.0)", abs(wall_x - 3.0) < 0.02 and abs(wall_z - 2.0) < 0.02, f"inner |x| {wall_x:.3f}, inner |z| {wall_z:.3f}")
    ok("floor slab no more than 0.07 cells beyond the grid", fx[1] <= 3.07 and fz[1] <= 2.07, "")
    pin = geo["Base_Hardware"]; pin_c = None
    # hinge pin = brass cylinder at hinge height; report nearest cluster centre
    near = pin[(np.abs(pin[:, 1] - exp_hinge[1]) < 0.15) & (np.abs(pin[:, 2] - exp_hinge[2]) < 0.15) & (np.abs(pin[:, 0]) < 3.2)]
    if len(near): pin_c = near.mean(0)
    hinge_pin = None if pin_c is None else dict(centre=[round(float(x), 4) for x in pin_c], offset_from_pivot_cells=round(float(np.linalg.norm(np.array(hinge)[1:] - pin_c[1:])), 4))
    ok("hinge pin sits on the pivot line (within 0.03 cell)", hinge_pin is not None and hinge_pin["offset_from_pivot_cells"] < 0.03, hinge_pin)
    ok("tri count (reported)", True, f"{total_tris} (v2 was 68228)")
    res = dict(file=os.path.basename(glb), bytes=size, triangles_total=total_tris, nodes=info, floor=dict(plane_y=floor_y, slab_x=fx, slab_z=fz, inner_wall_abs_x=wall_x, inner_wall_abs_z=wall_z),
               hinge_pivot_game_gltf=hinge, hinge_pin=hinge_pin, open_angle_deg_threejs_rotation_x=-OPEN_DEG,
               textures=[dict(name=i.get("name"), mime=i.get("mimeType")) for i in js["images"]])
    # --- Blender re-import + hinge rotation proof
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    O = {o.name.split(".")[0]: o for o in bpy.data.objects}
    lid_o = O["Suitcase_Lid"]; lid_o.rotation_mode = "XYZ"
    lid_tree = [lid_o] + [c for c in lid_o.children_recursive]
    base_o = O["Suitcase_Base"]
    Hw = lid_o.matrix_world.translation.copy()
    def world_verts(objs):
        pts = []
        for o in objs:
            if o.type == "MESH": M = o.matrix_world; pts += [M @ v.co for v in o.data.vertices]
        return np.array([[p.x, p.y, p.z] for p in pts])
    def pose(deg):
        lid_o.rotation_euler = (-math.radians(deg), 0, 0); bpy.context.view_layer.update()
    base_pts = world_verts([base_o] + [o for o in bpy.data.objects if o.parent and o.parent.name.startswith(("Suitcase_Base", "Suitcase")) and o not in lid_tree and o.type == "MESH"])
    base_top = float(np.sort(base_pts[:, 2])[-1])
    pose(0); closed = world_verts(lid_tree)
    shell0 = world_verts([lid_o])
    # vertices of the lid shell that sit on the hinge edge when closed
    axis_d0 = np.hypot(shell0[:, 1] - Hw.y, shell0[:, 2] - Hw.z)
    edge_idx = np.where(axis_d0 < 0.12)[0]
    proofs = []; sheets = []
    for deg in (0.0, 45.0, OPEN_DEG):
        pose(deg)
        pts = world_verts(lid_tree); sh = world_verts([lid_o])
        pv = lid_o.matrix_world.translation
        d_axis_edge = np.hypot(sh[edge_idx, 1] - Hw.y, sh[edge_idx, 2] - Hw.z)
        rigid = float(np.abs(np.hypot(pts[:, 1] - Hw.y, pts[:, 2] - Hw.z) - np.hypot(closed[:, 1] - Hw.y, closed[:, 2] - Hw.z)).max())
        front = closed[np.argmin(closed[:, 1])]            # farthest-from-hinge lid point (front of lid) in closed pose
        cf = np.array([front[1] - Hw.y, front[2] - Hw.z]); nf = np.array([pts[np.argmin(closed[:, 1])][1] - Hw.y, pts[np.argmin(closed[:, 1])][2] - Hw.z])
        ang = math.degrees(math.atan2(cf[0] * nf[1] - cf[1] * nf[0], cf @ nf))
        shell_ax = np.hypot(sh[:, 1] - Hw.y, sh[:, 2] - Hw.z)
        intr = int(((pts[:, 2] < Hw.z - 0.01) & (pts[:, 1] < Hw.y - 0.05) & (np.abs(pts[:, 0]) < 3.40)).sum())
        bad = pts[(pts[:, 2] < Hw.z - 0.01) & (pts[:, 1] < Hw.y - 0.05) & (np.abs(pts[:, 0]) < 3.40)]
        depth = round(float((Hw.z - bad[:, 2]).max()), 4) if len(bad) else 0.0
        pass
        proofs.append(dict(requested_deg=deg, max_intrusion_depth_cells=depth, lid_vertices_inside_base_volume=intr, lid_closest_vertex_to_axis=round(float(shell_ax.min()), 4), pivot_world=[round(float(c), 4) for c in pv], pivot_drift=round(float((pv - Hw).length), 6),
                           hinge_edge_distance_to_axis_min=round(float(d_axis_edge.min()), 4), hinge_edge_distance_to_axis_max=round(float(d_axis_edge.max()), 4),
                           rigid_rotation_max_error=round(rigid, 6), measured_rotation_deg=round(abs(ang), 3),
                           lid_min_z=round(float(sh[:, 2].min()), 4), base_rim_top_z=round(base_top, 4), lid_x_range=[round(float(sh[:, 0].min()), 3), round(float(sh[:, 0].max()), 3)]))
    p0, p45, p107 = proofs
    ok("pivot never moves while the lid rotates", all(p["pivot_drift"] < 1e-5 for p in proofs), [p["pivot_drift"] for p in proofs])
    ok("lid rotates rigidly about the hinge axis (max radial error < 1e-4)", all(p["rigid_rotation_max_error"] < 1e-4 for p in proofs), [p["rigid_rotation_max_error"] for p in proofs])
    ok("measured rotation matches requested (0 / 45 / 107 deg)", abs(p0["measured_rotation_deg"]) < 0.05 and abs(p45["measured_rotation_deg"] - 45) < 0.05 and abs(p107["measured_rotation_deg"] - OPEN_DEG) < 0.05, [p["measured_rotation_deg"] for p in proofs])
    ok("lid back edge stays on the hinge axis at every angle (radius <= 0.12 cell)", all(p["hinge_edge_distance_to_axis_max"] <= 0.12 for p in proofs), [p["hinge_edge_distance_to_axis_max"] for p in proofs])
    ok("closed: lid underside sits exactly on the base top plane (= hinge height)", abs(p0["lid_min_z"] - Hw.z) <= 0.01, f"lid min z {p0['lid_min_z']} vs hinge/base-top z {round(float(Hw.z),4)} (rim welt rises to {p0['base_rim_top_z']} into the lid recess)")
    ok("lid never penetrates the base volume at 0 / 45 / 107 deg", all(p["lid_vertices_inside_base_volume"] == 0 for p in proofs), [p["lid_vertices_inside_base_volume"] for p in proofs])
    ok("lid shell has geometry on the hinge axis (closest vertex <= 0.1 cell) at every angle", all(p["lid_closest_vertex_to_axis"] <= 0.1 for p in proofs), [p["lid_closest_vertex_to_axis"] for p in proofs])
    res["lid_rotation_proof"] = proofs
    res["threejs_usage"] = "scene.getObjectByName('Suitcase_Lid').rotation.x = THREE.MathUtils.degToRad(-angleDeg)  // 0 closed .. -107 fully open"
    # renders
    sc = bpy.context.scene; sc.render.engine = "BLENDER_WORKBENCH"; sc.display.shading.light = "STUDIO"; sc.display.shading.color_type = "TEXTURE"
    sc.render.resolution_x, sc.render.resolution_y = 700, 520
    sc.view_settings.view_transform = "Standard"
    sph = bpy.data.objects.new("hinge_marker", bpy.data.meshes.new("m")); bpy.context.scene.collection.objects.link(sph)
    import bmesh
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=0.09); bm.to_mesh(sph.data); bm.free()
    mm = bpy.data.materials.new("red"); mm.diffuse_color = (1, 0.05, 0.05, 1); sph.data.materials.append(mm); sph.location = Hw
    cam = bpy.data.cameras.new("c"); cam.type = "ORTHO"; cam.ortho_scale = 9.5
    co = bpy.data.objects.new("c", cam); bpy.context.scene.collection.objects.link(co); sc.camera = co
    co.location = (30, 0.4, 2.2); co.rotation_euler = (math.radians(90), 0, math.radians(90))
    os.makedirs(os.path.join(out, "render"), exist_ok=True); frames = []
    for deg in (0.0, 45.0, OPEN_DEG):
        pose(deg); p = os.path.join(out, f"_lid_{int(deg)}.png"); sc.render.filepath = p; bpy.ops.render.render(write_still=True); frames.append(Image.open(p).convert("RGB"))
    sheet = Image.new("RGB", (700 * 3, 520), (30, 30, 34))
    for i, f in enumerate(frames): sheet.paste(f, (i * 700, 0))
    sheet.save(os.path.join(out, "render", "lid_proof_v3.png"))
    for deg in (0, 45, int(OPEN_DEG)): os.remove(os.path.join(out, f"_lid_{deg}.png"))
    res["checks"] = checks; res["passed"] = all(c["ok"] for c in checks)
    json.dump(res, open(os.path.join(out, "validation_v3.json"), "w"), indent=2, default=float)
    for c in checks: print(("PASS " if c["ok"] else "FAIL ") + c["check"] + "  " + c["detail"])
    print("ALL PASS" if res["passed"] else "SOME FAILED")


if __name__ == "__main__":
    a = sys.argv[1:]; o = lambda f: a[a.index(f) + 1]
    run(o("--glb"), o("--out"))
