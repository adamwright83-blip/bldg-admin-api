"""Hero set dressing on the harbour shore road: everything the chase touches, at hero detail.

All positions are authored in chase distance d (metres from the quay along the shore road) plus an
offset across the road, so the dressing follows the game's geography. The land side (houses) is +L,
the sea side is -L.
"""

import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

import env
from common import POLYHAVEN, SUN_DIR, Shore, collection, link

rng = random.Random(23)


class Level:
    """Ray queries against the level's visible geometry (roof edges, road height)."""

    def __init__(self):
        dg = bpy.context.evaluated_depsgraph_get()
        bm = bmesh.new()
        for o in bpy.data.objects:
            if o.type == "MESH" and o.name.startswith("VIS_") and not o.name.startswith("VIS_cloth"):
                me = o.evaluated_get(dg).to_mesh()
                me.transform(o.matrix_world)
                bm.from_mesh(me)
                o.evaluated_get(dg).to_mesh_clear()
        self.tree = BVHTree.FromBMesh(bm)
        bm.free()

    def down(self, x, y, z_from=80.0):
        hit = self.tree.ray_cast(Vector((x, y, z_from)), Vector((0, 0, -1)), 200.0)
        return hit[0]

    def toward(self, origin, direction, dist=50.0):
        hit = self.tree.ray_cast(Vector(origin), Vector(direction).normalized(), dist)
        return hit[0]


def mesh_obj(name, bm, mat=None, coll=None, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    link(ob, coll)
    if mat:
        me.materials.append(mat)
    return ob


def box(bm, center, size, rot=None):
    m = Matrix.Translation(center)
    if rot is not None:
        m = m @ rot.to_4x4()
    m = m @ Matrix.Diagonal((size[0], size[1], size[2], 1.0))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)


def frame_at(sh, d, across=0.0, up=0.0):
    """World point and a road-aligned frame at chase distance d."""
    p, tq, land, w = sh.at(d)
    q = p + land * across + Vector((0, 0, up))
    return q, tq, land, w


def rot_frame(tq, land):
    """Rotation whose X runs along the road toward the quay, Y toward the land, Z up."""
    return Matrix((tq, land, Vector((0, 0, 1)))).transposed()


# ---------------------------------------------------------------- the promenade

def build_promenade(sh, d0=1.0, d1=118.0, step=0.5):
    """A laid quay promenade over the bare shore ledge: cobbles, a dressed stone kerb on the sea
    side dropping to the water, and a gutter line along the house fronts."""
    coll = collection("hero_set")
    cob = env.pbr_material("hero_prom_cobble", "cobblestone_floor_04", scale=0.55, bump=1.2, tint=None, world_box=True)
    kerb_mat = env.pbr_material("hero_kerb", "monastery_stone_floor", scale=0.9, bump=0.9, tint=None, world_box=True)
    wall_mat = env.pbr_material("hero_quay_wall", "rock_face_03", scale=0.5, bump=1.0, tint=None, world_box=True, darken=0.75)
    bm = bmesh.new()
    rows = []
    d = d0
    while d <= d1:
        p, tq, land, w = sh.at(d)
        z = p.z + 0.03
        a = p - land * (w / 2 - 0.45)
        b = p + land * (w / 2 + 0.6)
        rows.append((bm.verts.new((a.x, a.y, z)), bm.verts.new((b.x, b.y, z))))
        d += step
    for (a0, b0), (a1, b1) in zip(rows, rows[1:]):
        bm.faces.new((a0, b0, b1, a1))
    mesh_obj("hero_promenade", bm, cob, coll)
    # kerb: dressed blocks along the sea edge, each a little different
    bm = bmesh.new()
    d = d0
    while d <= d1:
        p, tq, land, w = sh.at(d)
        L = 0.9 + rng.random() * 0.5
        R = rot_frame(tq, land).to_3x3()
        c = p - land * (w / 2 - 0.22) + Vector((0, 0, 0.1 + rng.random() * 0.02))
        box(bm, c, (L - 0.035, 0.46, 0.3), R)
        # the quay wall face below the kerb, down into the water
        wc = p - land * (w / 2 - 0.05)
        wc.z = (p.z - 0.05) / 2 - 0.4          # from under the water up to just below the kerb
        box(bm, wc, (L, 0.3, p.z + 0.75), R)
        d += L
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.025, segments=2, affect="EDGES", clamp_overlap=True)
    kerb = mesh_obj("hero_kerb", bm, kerb_mat, coll)
    return kerb


def build_bollards(sh, ds, lv):
    coll = collection("hero_set")
    iron = env.simple_material("hero_bollard", (0.035, 0.03, 0.028, 1), rough=0.38, metal=0.85)
    bm = bmesh.new()
    spots = []
    for d in ds:
        p, tq, land, w = sh.at(d)
        c = p - land * (w / 2 - 0.35)
        spots.append(c.copy())
        bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.17, radius2=0.14, depth=0.55,
                              matrix=Matrix.Translation(c + Vector((0, 0, 0.35))))
        bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.24, radius2=0.2, depth=0.08,
                              matrix=Matrix.Translation(c + Vector((0, 0, 0.66))))
    ob = mesh_obj("hero_bollards", bm, iron, coll, smooth=True)
    ob.modifiers.new("bevel", "BEVEL").width = 0.01
    return spots


# ---------------------------------------------------------------- awnings (cloth)

AWNING_COLORS = [
    ((0.55, 0.09, 0.06, 1), (0.88, 0.80, 0.64, 1)),   # oxblood / cream
    ((0.62, 0.36, 0.08, 1), (0.88, 0.80, 0.64, 1)),   # ochre / cream
    ((0.07, 0.25, 0.26, 1), (0.86, 0.80, 0.66, 1)),   # teal / cream
    ((0.55, 0.09, 0.06, 1), (0.88, 0.80, 0.64, 1)),
]


def build_awning(sh, lv, d, width, name, colors, depth=1.7, height=None, sim=True, frames=(1, 600)):
    """A canvas awning on the house front at d: a subdivided sheet pinned along the wall and along a
    front bar, with a slack belly and a free scalloped valance, simulated as cloth so it bellies in
    the wind and snaps when something lands on it."""
    coll = collection("hero_awnings")
    p, tq, land, w = sh.at(d)
    # find the house front: ray from the road centre toward the land
    hit = lv.toward(p + Vector((0, 0, 1.5)), land, 12.0)
    front = hit if hit is not None else p + land * (w / 2 + 0.3)
    base_z = p.z + (height if height is not None else 2.75)
    wall = Vector((front.x, front.y, base_z)) - land * 0.05
    cols, rows = 24, 12
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    grid = []
    pin = []
    for j in range(rows + 1):
        v = j / rows
        row = []
        for i in range(cols + 1):
            u = i / cols
            along = (u - 0.5) * width
            out = v * depth
            drop = 0.55 * v + 0.12 * math.sin(math.pi * v)   # slope down and a slack belly
            q = wall + tq * along - land * out - Vector((0, 0, drop))
            vert = bm.verts.new(q)
            row.append(vert)
            pin.append(1.0 if j == 0 or j == rows else 0.0)
        grid.append(row)
    # valance: a short free skirt hanging off the front bar
    vrows = 3
    for j in range(1, vrows + 1):
        row = []
        for i in range(cols + 1):
            u = i / cols
            base = grid[rows][i].co
            vert = bm.verts.new(base - Vector((0, 0, 0.11 * j)))
            row.append(vert)
            pin.append(0.0)
        grid.append(row)
    bm.verts.index_update()
    for j in range(len(grid) - 1):
        for i in range(cols):
            f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            for k, (ii, jj) in enumerate(((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                f.loops[k][uv].uv = (ii / cols, jj / (rows + vrows))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    link(ob, coll)
    ob["grid"] = (cols, rows, vrows)
    for poly in me.polygons:
        poly.use_smooth = True
    mat = env.cloth_material(name + "_mat", base=colors[0], stripes=True, stripe_col=colors[1])
    me.materials.append(mat)
    vg = ob.vertex_groups.new(name="pin")
    for i, wv in enumerate(pin):
        if wv > 0:
            vg.add([i], wv, "REPLACE")
    sol = ob.modifiers.new("thick", "SOLIDIFY")
    sol.thickness = 0.006
    if sim:
        cl = ob.modifiers.new("cloth", "CLOTH")
        s = cl.settings
        s.quality = 10
        s.mass = 0.25
        s.air_damping = 1.5
        s.tension_stiffness = 25
        s.compression_stiffness = 25
        s.shear_stiffness = 8
        s.bending_stiffness = 0.4
        s.vertex_group_mass = "pin"
        cl.collision_settings.use_collision = True
        cl.collision_settings.distance_min = 0.012
        cl.collision_settings.collision_quality = 3
        cl.point_cache.frame_start = frames[0]
        cl.point_cache.frame_end = frames[1]
        # the cloth modifier must run before the solidify
        bpy.context.view_layer.objects.active = ob
        with bpy.context.temp_override(object=ob):
            bpy.ops.object.modifier_move_to_index(modifier="cloth", index=0)
    # the frame: a wall rail, the front bar and two drop rods
    iron = bpy.data.materials.get("hero_iron") or env.simple_material("hero_iron", (0.05, 0.045, 0.04, 1), rough=0.45, metal=0.9)
    bm = bmesh.new()
    front_c = wall - land * depth - Vector((0, 0, 0.55))
    R = rot_frame(tq, land).to_3x3()
    box(bm, wall + land * 0.02, (width + 0.1, 0.06, 0.06), R)
    box(bm, front_c, (width + 0.06, 0.035, 0.035), R)
    for s_ in (-1, 1):
        a = wall + tq * (s_ * width / 2)
        b = front_c + tq * (s_ * width / 2)
        mid = (a + b) / 2
        L = (b - a).length
        dirv = (b - a).normalized()
        rot = dirv.to_track_quat("Z", "Y").to_matrix()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.015, radius2=0.015, depth=L,
                              matrix=Matrix.Translation(mid) @ rot.to_4x4())
    mesh_obj(name + "_frame", bm, iron, coll)
    return ob, wall, front_c


# ---------------------------------------------------------------- signs, lanterns, laundry

def pivot(name, loc, coll):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.2
    e.location = loc
    link(e, coll)
    return e


def build_sign(sh, lv, d, name, emblem_col, height=3.35, size=(0.78, 0.52), drop=0.52, arm_len=1.05):
    """A painted board swinging from a scrolled iron bracket; its pivot is keyed by fx.pendulums."""
    coll = collection("hero_signs")
    p, tq, land, w = sh.at(d)
    hit = lv.toward(p + Vector((0, 0, 1.5)), land, 12.0)
    front = hit if hit is not None else p + land * (w / 2 + 0.3)
    base = Vector((front.x, front.y, p.z + height)) - land * 0.02
    R = rot_frame(tq, land).to_3x3()
    iron = bpy.data.materials.get("hero_iron")
    bm = bmesh.new()
    box(bm, base - land * (arm_len / 2), (0.04, arm_len, 0.04), R)
    box(bm, base - land * 0.05 - Vector((0, 0, 0.18)), (0.05, 0.05, 0.4), R)
    # a diagonal strut
    a = base - Vector((0, 0, 0.36))
    b = base - land * (arm_len * 0.6)
    mid = (a + b) / 2
    rot = (b - a).normalized().to_track_quat("Z", "Y").to_matrix()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.014, radius2=0.014, depth=(b - a).length,
                          matrix=Matrix.Translation(mid) @ rot.to_4x4())
    mesh_obj(name + "_bracket", bm, iron, coll)
    piv = pivot(name + "_pivot", base - land * (arm_len * 0.62) - Vector((0, 0, 0.03)), coll)
    piv.rotation_mode = "QUATERNION"
    piv.rotation_quaternion = R.to_quaternion()
    # the board, in the pivot's local frame (x along the road, y toward land, z up)
    wood = env.pbr_material(name + "_wood", "weathered_brown_planks", scale=1.4, bump=0.6, tint=None, darken=0.9)
    bm = bmesh.new()
    box(bm, Vector((0, 0, -drop)), (0.05, size[0], size[1]))
    for s_ in (-1, 1):
        box(bm, Vector((0, s_ * size[0] * 0.38, -(drop - size[1] / 2) / 2)), (0.012, 0.012, drop - size[1] / 2))
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.012, segments=2, affect="EDGES", clamp_overlap=True)
    board = mesh_obj(name + "_board", bm, wood, coll)
    board.parent = piv
    # painted emblem on both faces
    em = env.simple_material(name + "_emblem", emblem_col, rough=0.55)
    bm = bmesh.new()
    for s_ in (-1, 1):
        bmesh.ops.create_circle(bm, cap_ends=True, segments=20, radius=size[1] * 0.33,
                                matrix=Matrix.Translation((s_ * 0.027, 0, -drop)) @ Matrix.Rotation(math.pi / 2, 4, "Y"))
    emb = mesh_obj(name + "_emblem", bm, em, coll)
    emb.parent = piv
    return piv


def load_gltf(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


_LANTERN = None


def lantern_prototype():
    """Poly Haven Lantern_01 (CC0), with a candle glow inside."""
    global _LANTERN
    if _LANTERN:
        return _LANTERN
    objs = load_gltf(os.path.join(POLYHAVEN, "models", "Lantern_01", "Lantern_01_1k.gltf"))
    meshes = [o for o in objs if o.type == "MESH"]
    coll = collection("hero_protos")
    for o in objs:
        for c in o.users_collection:
            c.objects.unlink(o)
        coll.objects.link(o)
    coll.hide_render = True
    coll.hide_viewport = True
    lo = min(v.co.z for o in meshes for v in o.data.vertices)
    hi = max(v.co.z for o in meshes for v in o.data.vertices)
    _LANTERN = (meshes, hi - lo, hi)
    return _LANTERN


def build_lantern(name, top, coll, scale=0.7):
    """A hanging lantern: a pivot at its hook, the Poly Haven lantern below it, a warm point light."""
    meshes, height, hi = lantern_prototype()
    piv = pivot(name + "_pivot", top, coll)
    piv.rotation_mode = "QUATERNION"
    for m in meshes:
        inst = bpy.data.objects.new(name + "_" + m.name, m.data)
        link(inst, coll)
        inst.parent = piv
        inst.location = (0, 0, -hi * scale - 0.05)
        inst.scale = (scale, scale, scale)
    glow = bpy.data.lights.new(name + "_light", "POINT")
    glow.energy = 22
    glow.color = (1.0, 0.55, 0.22)
    glow.shadow_soft_size = 0.05
    lo = bpy.data.objects.new(name + "_light", glow)
    link(lo, coll)
    lo.parent = piv
    lo.location = (0, 0, -height * scale * 0.55 - 0.05)
    return piv


def build_lantern_string(sh, lv, d, name, n=3, sag=0.35, height=4.35):
    """A rope strung from a house front across the road to a pole on the kerb, lanterns hanging off it."""
    coll = collection("hero_lanterns")
    p, tq, land, w = sh.at(d)
    hit = lv.toward(p + Vector((0, 0, 1.5)), land, 12.0)
    front = hit if hit is not None else p + land * (w / 2 + 0.3)
    a = Vector((front.x, front.y, p.z + height))
    pole = p - land * (w / 2 - 0.35)
    b = pole + Vector((0, 0, height - 0.15 - p.z + p.z))
    b.z = p.z + height - 0.15
    wood = bpy.data.materials.get("hero_wood_dark")
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.07, radius2=0.055, depth=height + 0.3,
                          matrix=Matrix.Translation(Vector((pole.x, pole.y, p.z + (height + 0.3) / 2 - 0.1))))
    mesh_obj(name + "_pole", bm, wood, coll)
    pts = [a.lerp(b, t) - Vector((0, 0, sag * 4 * t * (1 - t))) for t in [i / 24 for i in range(25)]]
    rope_ob = rope(name + "_rope", pts, 0.012, coll)
    pivs = []
    us = []
    for k in range(n):
        t = (k + 1) / (n + 1)
        top = a.lerp(b, t) - Vector((0, 0, sag * 4 * t * (1 - t)))
        pivs.append(build_lantern(f"{name}_{k}", top, coll, scale=0.55))
        us.append(t)
    return {"a": a, "b": b, "sag": sag, "rope": rope_ob, "pivots": pivs, "us": us, "d": d}


def rope(name, pts, radius, coll, mat=None):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 3
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for i, q in enumerate(pts):
        sp.points[i].co = (q.x, q.y, q.z, 1)
    ob = bpy.data.objects.new(name, cu)
    link(ob, coll)
    cu.materials.append(mat or bpy.data.materials.get("hero_rope") or env.rope_material("hero_rope"))
    return ob


def build_laundry(sh, lv, d, name, sheets, height=3.35, sim=True, frames=(1, 600)):
    """A line across the road with sheets pegged to it; the sheets are cloth (the camera bursts
    through the first one)."""
    coll = collection("hero_laundry")
    p, tq, land, w = sh.at(d)
    hit = lv.toward(p + Vector((0, 0, 1.5)), land, 12.0)
    front = hit if hit is not None else p + land * (w / 2 + 0.3)
    a = Vector((front.x, front.y, p.z + height))
    pole = p - land * (w / 2 - 0.3)
    b = Vector((pole.x, pole.y, p.z + height - 0.3))
    wood = bpy.data.materials.get("hero_wood_dark")
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.06, radius2=0.05, depth=height + 0.2,
                          matrix=Matrix.Translation(Vector((pole.x, pole.y, p.z + (height + 0.2) / 2 - 0.1))))
    mesh_obj(name + "_pole", bm, wood, coll)
    sag = 0.25
    line = [a.lerp(b, t) - Vector((0, 0, sag * 4 * t * (1 - t))) for t in [i / 24 for i in range(25)]]
    line_ob = rope(name + "_line", line, 0.008, coll)
    out = []
    for k, (t0, t1, drop, col) in enumerate(sheets):
        cols, rows = 10, 14
        bm = bmesh.new()
        grid = []
        pin = []
        for j in range(rows + 1):
            row = []
            for i in range(cols + 1):
                t = t0 + (t1 - t0) * i / cols
                top = a.lerp(b, t) - Vector((0, 0, sag * 4 * t * (1 - t)))
                row.append(bm.verts.new(top - Vector((0, 0, drop * j / rows))))
                pin.append(1.0 if j == 0 else 0.0)
            grid.append(row)
        for j in range(rows):
            for i in range(cols):
                bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
        me = bpy.data.meshes.new(f"{name}_sheet{k}")
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(me.name, me)
        link(ob, coll)
        for poly in me.polygons:
            poly.use_smooth = True
        me.materials.append(env.cloth_material(f"{name}_sheet{k}_mat", base=col, translucent=0.55))
        vg = ob.vertex_groups.new(name="pin")
        for i, wv in enumerate(pin):
            if wv > 0:
                vg.add([i], wv, "REPLACE")
        if sim:
            cl = ob.modifiers.new("cloth", "CLOTH")
            s = cl.settings
            s.quality = 8
            s.mass = 0.15
            s.air_damping = 1.2
            s.bending_stiffness = 0.05
            s.vertex_group_mass = "pin"
            cl.collision_settings.use_collision = True
            cl.collision_settings.distance_min = 0.01
            cl.point_cache.frame_start = frames[0]
            cl.point_cache.frame_end = frames[1]
        ob.modifiers.new("thick", "SOLIDIFY").thickness = 0.004
        out.append(ob)
    return {"a": a, "b": b, "sag": sag, "rope": line_ob, "sheets": out,
            "spans": [(t0, t1) for (t0, t1, _, _) in sheets], "d": d}


# ---------------------------------------------------------------- market, barrels, crates

def instance_model(folder, name, loc, rot_z=0.0, scale=1.0, coll=None):
    objs = load_gltf(os.path.join(POLYHAVEN, "models", folder, f"{folder}_1k.gltf"))
    coll = coll or collection("hero_props")
    root = pivot(name, loc, coll)
    root.rotation_euler = (0, 0, rot_z)
    root.scale = (scale, scale, scale)
    for o in objs:
        for c in o.users_collection:
            c.objects.unlink(o)
        coll.objects.link(o)
        if o.parent is None:
            o.parent = root
    return root, objs


def build_fruit_stall(sh, lv, d, name):
    """A trestle table under the awning heaped with fruit in crates: the fruit is rigid-body (fx)."""
    coll = collection("hero_market")
    p, tq, land, w = sh.at(d)
    c = p + land * (w / 2 - 0.9)
    z = p.z
    R = rot_frame(tq, land).to_3x3()
    wood = bpy.data.materials.get("hero_wood")
    bm = bmesh.new()
    box(bm, c + Vector((0, 0, 0.84)), (1.9, 0.8, 0.06), R)
    for sx in (-0.85, 0.85):
        for sy in (-0.32, 0.32):
            box(bm, c + tq * sx + land * sy + Vector((0, 0, 0.41)), (0.06, 0.06, 0.82), R)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.008, segments=1, affect="EDGES", clamp_overlap=True)
    table = mesh_obj(name + "_table", bm, wood, coll)
    crates = []
    fruit = []
    palette = [((0.95, 0.42, 0.04, 1), 0.045), ((0.93, 0.78, 0.12, 1), 0.04), ((0.62, 0.05, 0.05, 1), 0.043),
               ((0.35, 0.55, 0.08, 1), 0.042)]
    for k, sx in enumerate((-0.6, 0.0, 0.6)):
        cc = c + tq * sx + Vector((0, 0, 0.87 + 0.11))
        bm = bmesh.new()
        # an open crate: floor and four walls
        for (off, size) in (((0, 0, -0.1), (0.52, 0.66, 0.02)), ((0.25, 0, 0), (0.02, 0.66, 0.22)), ((-0.25, 0, 0), (0.02, 0.66, 0.22)),
                            ((0, 0.32, 0), (0.52, 0.02, 0.22)), ((0, -0.32, 0), (0.52, 0.02, 0.22))):
            box(bm, cc + R @ Vector(off), size, R)
        crate = mesh_obj(f"{name}_crate{k}", bm, wood, coll)
        crates.append(crate)
        col, r = palette[k % len(palette)]
        mat = env.simple_material(f"{name}_fruit{k}_mat", col, rough=0.32, coat=0.5)
        for i in range(14):
            q = cc + R @ Vector(((rng.random() - 0.5) * 0.36, (rng.random() - 0.5) * 0.5, 0.02 + rng.random() * 0.12))
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=r * (0.9 + rng.random() * 0.2))
            ob = mesh_obj(f"{name}_f{k}_{i}", bm, mat, coll, smooth=True)
            ob.location = q
            fruit.append(ob)
    return table, crates, fruit


def build_barrels(sh, d, name, lv):
    coll = collection("hero_props")
    p, tq, land, w = sh.at(d)
    R = rot_frame(tq, land).to_3x3()
    items = []
    spots = [(0.0, w / 2 - 0.7, 0.0), (0.75, w / 2 - 0.6, 0.0), (0.35, w / 2 - 0.65, 0.95)]
    for k, (a, b, h) in enumerate(spots):
        q = p + tq * a + land * b + Vector((0, 0, h))
        root, _ = instance_model("Barrel_01", f"{name}_b{k}", q, rot_z=rng.random() * 6.28, coll=coll)
        items.append(root)
    for k, (a, b) in enumerate(((-0.9, w / 2 - 0.55), (-1.6, w / 2 - 0.6))):
        q = p + tq * a + land * b
        root, _ = instance_model("wooden_crate_01", f"{name}_c{k}", q, rot_z=math.atan2(tq.y, tq.x) + rng.random() * 0.4, coll=coll)
        items.append(root)
    return items


# ---------------------------------------------------------------- the ship at the quay

def build_ship(sh, d=14.0, off=4.9):
    """Poly Haven ship_pinnace (CC0) moored alongside the quay, bow toward the harbour mouth; Rook
    ends up in its rigging. The model's length runs along its local Y."""
    coll = collection("hero_ship")
    p, tq, land, w = sh.at(d)
    loc = p - land * (w / 2 + off)
    loc.z = 0.0
    root, objs = instance_model("ship_pinnace", "hero_ship", loc, rot_z=math.atan2(tq.y, tq.x) - math.pi / 2, coll=coll)
    meshes = [o for o in objs if o.type == "MESH"]
    # sailcloth glows with the low sun behind it: mix the model's own sail shader with light through it
    for o in meshes:
        if "sail" not in o.name.lower():
            continue
        for slot in o.material_slots:
            m = slot.material
            if not m or m.get("hero_translucent"):
                continue
            nt = m.node_tree
            outn = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
            src = outn.inputs["Surface"].links[0].from_socket
            bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
            tr = nt.nodes.new("ShaderNodeBsdfTranslucent")
            if bsdf and bsdf.inputs["Base Color"].links:
                nt.links.new(bsdf.inputs["Base Color"].links[0].from_socket, tr.inputs["Color"])
            else:
                tr.inputs["Color"].default_value = (0.85, 0.78, 0.64, 1)
            mix = nt.nodes.new("ShaderNodeMixShader")
            mix.inputs["Fac"].default_value = 0.5
            nt.links.new(src, mix.inputs[1])
            nt.links.new(tr.outputs["BSDF"], mix.inputs[2])
            # the cheat every game uses for backlit canvas: a warm glow from the sail's own colour
            em = nt.nodes.new("ShaderNodeEmission")
            em.inputs["Strength"].default_value = 0.55
            if bsdf and bsdf.inputs["Base Color"].links:
                warm = nt.nodes.new("ShaderNodeMix")
                warm.data_type = "RGBA"
                warm.blend_type = "MULTIPLY"
                warm.inputs["Factor"].default_value = 1.0
                nt.links.new(bsdf.inputs["Base Color"].links[0].from_socket, warm.inputs["A"])
                warm.inputs["B"].default_value = (1.6, 1.15, 0.72, 1)
                nt.links.new(warm.outputs["Result"], em.inputs["Color"])
            add = nt.nodes.new("ShaderNodeAddShader")
            nt.links.new(mix.outputs["Shader"], add.inputs[0])
            nt.links.new(em.outputs["Emission"], add.inputs[1])
            nt.links.new(add.outputs["Shader"], outn.inputs["Surface"])
            if hasattr(m, "thickness_mode"):
                m.thickness_mode = "SLAB"
            m.use_backface_culling = False
            m["hero_translucent"] = True
    bpy.context.view_layer.update()
    yaw = root.rotation_euler.z
    ax = Vector((-math.sin(yaw), math.cos(yaw), 0))
    for o in meshes:
        if "sail" in o.name.lower():
            bm = bmesh.new()
            bm.from_mesh(o.data)
            mw = o.matrix_world
            doomed = [f for f in bm.faces if (mw @ f.calc_center_median() - root.location).dot(ax) > 6.5]
            bmesh.ops.delete(bm, geom=doomed, context="FACES")
            bm.to_mesh(o.data)
            bm.free()
    pts = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
    top = max(pts, key=lambda v: v.z)
    lo = min(v.z for v in pts)
    print(f"[hero] ship: {len(meshes)} meshes, height {top.z - lo:.1f} m, mast top {tuple(round(x, 2) for x in top)}")
    return root, meshes, top


def build_greenery(sh, lv, d0=4.0, d1=84.0):
    """Pots, shrubs and ferns at the house fronts (Poly Haven CC0 plants), and terracotta pots."""
    coll = collection("hero_green")
    protos = {}
    for folder in ("shrub_sorrel_01", "fern_02"):
        objs = load_gltf(os.path.join(POLYHAVEN, "models", folder, f"{folder}_1k.gltf"))
        pc = collection("hero_protos")
        for o in objs:
            for c in o.users_collection:
                c.objects.unlink(o)
            pc.objects.link(o)
        protos[folder] = [o for o in objs if o.type == "MESH"]
    pot_mat = bpy.data.materials.get("hero_roof")
    d = d0
    k = 0
    while d < d1:
        p, tq, land, w = sh.at(d)
        hit = lv.toward(p + Vector((0, 0, 1.2)), land, 12.0)
        if hit is not None:
            base = hit - land * 0.32
            base.z = p.z + 0.03
            big = rng.random() < 0.55
            if big:
                bm = bmesh.new()
                bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=0.2, radius2=0.28, depth=0.46,
                                      matrix=Matrix.Translation(base + Vector((0, 0, 0.23))))
                pot = mesh_obj(f"hero_pot{k}", bm, pot_mat, coll, smooth=True)
                top = base + Vector((0, 0, 0.44))
            else:
                top = base
            folder = "shrub_sorrel_01" if big or rng.random() < 0.4 else "fern_02"
            s_ = (0.9 + rng.random() * 0.6) * (1.0 if folder == "shrub_sorrel_01" else 1.4)
            for m in protos[folder]:
                inst = bpy.data.objects.new(f"hero_plant{k}_{m.name}", m.data)
                link(inst, coll)
                inst.location = top
                inst.rotation_euler = (0, 0, rng.random() * 6.28)
                inst.scale = (s_, s_, s_)
            k += 1
        d += 2.2 + rng.random() * 2.6
    print(f"[hero] greenery: {k} plantings")


def build_all(sh, lv, frames):
    env.rope_material("hero_rope")
    kerb = build_promenade(sh)
    bollards = build_bollards(sh, [4.0, 9.5, 16.0, 24.0, 31.5, 43.0, 55.0, 68.0, 82.0], lv)
    awn = {}
    specs = [("A1", 67.0, 3.4, 0), ("A2", 58.0, 3.0, 1), ("A3", 45.5, 3.6, 2), ("A4", 30.0, 3.2, 3)]
    for key, d, width, ci in specs:
        awn[key] = build_awning(sh, lv, d, width, f"hero_awning_{key}", AWNING_COLORS[ci], sim=False, frames=frames)
    signs = {
        "S1": build_sign(sh, lv, 51.8, "hero_sign_S1", (0.75, 0.55, 0.18, 1), height=2.5, size=(1.05, 0.62), drop=0.62, arm_len=2.9),
        "S2": build_sign(sh, lv, 38.5, "hero_sign_S2", (0.12, 0.28, 0.30, 1)),
    }
    lanterns = [build_lantern_string(sh, lv, 62.0, "hero_lstring1"), build_lantern_string(sh, lv, 38.0, "hero_lstring2"),
                build_lantern_string(sh, lv, 21.0, "hero_lstring3")]
    laundry1 = build_laundry(sh, lv, 76.0, "hero_laundry1", [(0.10, 0.33, 1.45, (0.86, 0.82, 0.72, 1)),
                                                             (0.36, 0.63, 1.7, (0.80, 0.62, 0.44, 1)),
                                                             (0.66, 0.90, 1.4, (0.52, 0.12, 0.09, 1))], frames=frames)
    stall = build_fruit_stall(sh, lv, 44.8, "hero_stall")
    barrels = build_barrels(sh, 27.0, "hero_barrels", lv)
    ship = build_ship(sh)
    build_greenery(sh, lv)
    return {"kerb": kerb, "bollards": bollards, "awnings": awn, "signs": signs, "lanterns": lanterns,
            "laundry": laundry1, "stall": stall, "barrels": barrels, "ship": ship}
