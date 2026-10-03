"""
Small Comforts: Blender vertical slice (Blender 4.x / 5.x).

One suitcase, one desk, the furniture the game actually has, lit like the trailer shot.
Dimensions follow the game grid: 6 x 4 cells, CELL = 0.15 units, so every piece in the render is
the same size as its collision proxy in the Three.js game (logic/grid.ts).
Anatomy follows logic/container.ts: brass latch, satin lid pocket, elastic straps, fabric lining,
brass corner brackets.

Run in Blender's Scripting tab, or headless:
  python build_scene.py [--out DIR] [--samples N] [--res W H] [--no-render] [--no-export]
(with `pip install bpy` for the headless route).
"""
import math, os, sys
import bpy, bmesh
from mathutils import Vector

CELL = 0.15
COLS, ROWS = 6, 4
GRID_W, GRID_D = COLS * CELL, ROWS * CELL          # 0.90 x 0.60 playable floor
WALL, LINING = 0.06, 0.01
OUT_W, OUT_D = GRID_W + 2 * (WALL + LINING) - 0.0, GRID_D + 2 * (WALL + LINING)   # 1.04 x 0.74
BASE_H, FLOOR_T = 0.20, 0.05
LID_H, LID_TOP = 0.12, 0.04
FLOOR_Z = FLOOR_T + LINING                          # top of the lining: where furniture stands


def cell_xy(cx, cz):
    """grid cell -> world x,y (game z grows toward camera = -Y)"""
    return ((cx - (COLS - 1) / 2) * CELL, -(cz - (ROWS - 1) / 2) * CELL)


# ---------------------------------------------------------------- scene plumbing
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


COL = {}
def col(name):
    if name not in COL:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
        COL[name] = c
    return COL[name]


def put(obj, collection):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col(collection).objects.link(obj)
    return obj


def smooth(obj):
    if obj.type == "MESH":
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj


def mesh_obj(name, bm, collection, mat=None, loc=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    if mat:
        me.materials.append(mat)
    put(ob, collection)
    return ob


def box(name, size, loc, collection, mat=None, bevel=0.0, seg=3, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]; v.co.y *= size[1]; v.co.z *= size[2]
    ob = mesh_obj(name, bm, collection, mat, loc)
    ob.rotation_euler = rot
    if bevel > 0:
        m = ob.modifiers.new("Bevel", "BEVEL")
        m.width = min(bevel, min(size) * 0.45); m.segments = seg; m.limit_method = "ANGLE"
    return smooth(ob)


def cyl(name, r, h, loc, collection, mat=None, rot=(0, 0, 0), verts=40, bevel=0.0, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=(r if r2 is None else r2), depth=h)
    ob = mesh_obj(name, bm, collection, mat, loc)
    ob.rotation_euler = rot
    if bevel > 0:
        m = ob.modifiers.new("Bevel", "BEVEL"); m.width = bevel; m.segments = 2; m.limit_method = "ANGLE"
    return smooth(ob)


def ball(name, r, loc, collection, mat=None, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=20, radius=r)
    ob = mesh_obj(name, bm, collection, mat, loc)
    ob.scale = scale
    return smooth(ob)


def torus(name, major, minor, loc, collection, mat=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=48, minor_segments=14, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    put(ob, collection)
    if mat:
        ob.data.materials.append(mat)
    return smooth(ob)


def apply_modifiers(ob):
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except RuntimeError:
            ob.modifiers.remove(m)


def boolean(ob, cutter, op="DIFFERENCE"):
    m = ob.modifiers.new("Bool", "BOOLEAN")
    m.operation = op; m.object = cutter; m.solver = "EXACT"
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


# ---------------------------------------------------------------- materials
def M(name, base, rough=0.6, metal=0.0, spec=0.5, coat=0.0, sheen=0.0, emit=None, emit_k=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = base
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Specular IOR Level"].default_value = spec
    b.inputs["Coat Weight"].default_value = coat
    if "Sheen Weight" in b.inputs:
        b.inputs["Sheen Weight"].default_value = sheen
    if emit:
        b.inputs["Emission Color"].default_value = emit
        b.inputs["Emission Strength"].default_value = emit_k
    return mat, b


def _n(nt, kind, loc, **kw):
    n = nt.nodes.new(kind); n.location = loc
    for k, v in kw.items():
        setattr(n, k, v)
    return n


def bump_from(mat, b, scale, detail, strength, rough_var=0.0, wear=None, coord="Object"):
    nt = mat.node_tree
    tc = _n(nt, "ShaderNodeTexCoord", (-900, 0))
    noise = _n(nt, "ShaderNodeTexNoise", (-650, 0))
    noise.inputs["Scale"].default_value = scale; noise.inputs["Detail"].default_value = detail
    bump = _n(nt, "ShaderNodeBump", (-350, -150))
    bump.inputs["Strength"].default_value = strength
    nt.links.new(tc.outputs[coord], noise.inputs["Vector"])
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    if rough_var:
        r = _n(nt, "ShaderNodeMapRange", (-350, 150))
        base_r = b.inputs["Roughness"].default_value
        r.inputs["To Min"].default_value = max(0, base_r - rough_var); r.inputs["To Max"].default_value = min(1, base_r + rough_var)
        nt.links.new(noise.outputs["Fac"], r.inputs["Value"])
        nt.links.new(r.outputs["Result"], b.inputs["Roughness"])
    return noise


def leather(name, color, wear_color):
    mat, b = M(name, color, rough=0.62, spec=0.5, coat=0.12)
    nt = mat.node_tree
    # fine grain + big mottling + lighter edge wear (bevel node)
    bump_from(mat, b, 160, 6, 0.28, rough_var=0.12)
    tc = _n(nt, "ShaderNodeTexCoord", (-1100, 300))
    mott = _n(nt, "ShaderNodeTexNoise", (-850, 300)); mott.inputs["Scale"].default_value = 5.0; mott.inputs["Detail"].default_value = 4
    ramp = _n(nt, "ShaderNodeValToRGB", (-600, 300))
    ramp.color_ramp.elements[0].color = (color[0] * 0.78, color[1] * 0.78, color[2] * 0.78, 1)
    ramp.color_ramp.elements[1].color = (min(1, color[0] * 1.18), min(1, color[1] * 1.18), min(1, color[2] * 1.18), 1)
    bev = _n(nt, "ShaderNodeBevel", (-850, 550)); bev.inputs["Radius"].default_value = 0.012
    geo = _n(nt, "ShaderNodeNewGeometry", (-850, 700))
    dot = _n(nt, "ShaderNodeVectorMath", (-600, 600), operation="DOT_PRODUCT")
    edge = _n(nt, "ShaderNodeMapRange", (-380, 600)); edge.inputs["From Min"].default_value = 0.93; edge.inputs["From Max"].default_value = 1.0
    edge.inputs["To Min"].default_value = 1.0; edge.inputs["To Max"].default_value = 0.0
    mix = _n(nt, "ShaderNodeMixRGB", (-200, 300))
    mix.inputs[2].default_value = wear_color
    nt.links.new(tc.outputs["Object"], mott.inputs["Vector"])
    nt.links.new(mott.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(bev.outputs["Normal"], dot.inputs[0]); nt.links.new(geo.outputs["Normal"], dot.inputs[1])
    nt.links.new(dot.outputs["Value"], edge.inputs["Value"])
    nt.links.new(edge.outputs["Result"], mix.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], mix.inputs[1])
    nt.links.new(mix.outputs["Color"], b.inputs["Base Color"])
    return mat


def brass(name="Brass", tarnish=0.45):
    mat, b = M(name, (0.80, 0.58, 0.22, 1), rough=0.3, metal=1.0, spec=0.6)
    nt = mat.node_tree
    n = bump_from(mat, b, 40, 10, 0.05, rough_var=0.2)
    ramp = _n(nt, "ShaderNodeValToRGB", (-400, 350))
    ramp.color_ramp.elements[0].color = (0.30, 0.20, 0.07, 1)   # tarnish
    ramp.color_ramp.elements[1].color = (0.86, 0.64, 0.25, 1)   # polished
    ramp.color_ramp.elements[0].position = tarnish
    nt.links.new(n.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    return mat


def weave(name, color, rough=0.95, scale=420, strength=0.5, sheen=0.4, stripe=None):
    mat, b = M(name, color, rough=rough, spec=0.15, sheen=sheen)
    nt = mat.node_tree
    tc = _n(nt, "ShaderNodeTexCoord", (-1100, 0))
    chk = _n(nt, "ShaderNodeTexChecker", (-800, 0)); chk.inputs["Scale"].default_value = scale
    nz = _n(nt, "ShaderNodeTexNoise", (-800, -250)); nz.inputs["Scale"].default_value = scale * 0.45; nz.inputs["Detail"].default_value = 3
    mixh = _n(nt, "ShaderNodeMixRGB", (-560, -100)); mixh.inputs[0].default_value = 0.5
    bump = _n(nt, "ShaderNodeBump", (-300, -100)); bump.inputs["Strength"].default_value = strength
    nt.links.new(tc.outputs["Object"], chk.inputs["Vector"]); nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    nt.links.new(chk.outputs["Fac"], mixh.inputs[1]); nt.links.new(nz.outputs["Fac"], mixh.inputs[2])
    nt.links.new(mixh.outputs["Color"], bump.inputs["Height"]); nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    if stripe:
        sx = _n(nt, "ShaderNodeSeparateXYZ", (-1000, 300))
        wv = _n(nt, "ShaderNodeTexWave", (-800, 300), wave_type="BANDS", bands_direction="X"); wv.inputs["Scale"].default_value = 28
        wv.inputs["Distortion"].default_value = 0.0
        ramp = _n(nt, "ShaderNodeValToRGB", (-560, 300))
        ramp.color_ramp.interpolation = "CONSTANT"
        ramp.color_ramp.elements[0].color = color; ramp.color_ramp.elements[1].color = stripe
        ramp.color_ramp.elements[1].position = 0.55
        nt.links.new(tc.outputs["Object"], wv.inputs["Vector"]); nt.links.new(wv.outputs["Fac"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    return mat


def felt(name, color):
    mat, b = M(name, color, rough=1.0, spec=0.1, sheen=0.8)
    bump_from(mat, b, 260, 4, 0.35)
    return mat


def paper(name, color):
    mat, b = M(name, color, rough=0.9, spec=0.15)
    bump_from(mat, b, 180, 3, 0.05)
    return mat


def satin(name, color):
    mat, b = M(name, color, rough=0.32, spec=0.7, sheen=0.6)
    if "Anisotropic" in b.inputs:
        b.inputs["Anisotropic"].default_value = 0.5
    bump_from(mat, b, 90, 2, 0.02)
    return mat


def wood(name, a, bcol, rough=0.55, scale=(5, 1.4, 1)):
    mat, b = M(name, a, rough=rough, spec=0.4, coat=0.1)
    nt = mat.node_tree
    tc = _n(nt, "ShaderNodeTexCoord", (-1200, 0)); mp = _n(nt, "ShaderNodeMapping", (-1000, 0))
    mp.inputs["Scale"].default_value = scale
    nz = _n(nt, "ShaderNodeTexNoise", (-780, 0)); nz.inputs["Scale"].default_value = 3.0; nz.inputs["Detail"].default_value = 8; nz.inputs["Distortion"].default_value = 0.8
    wv = _n(nt, "ShaderNodeTexWave", (-780, 250), wave_type="BANDS", bands_direction="X"); wv.inputs["Scale"].default_value = 14; wv.inputs["Distortion"].default_value = 6
    wv.inputs["Detail"].default_value = 3
    mx = _n(nt, "ShaderNodeMixRGB", (-540, 120), blend_type="MULTIPLY"); mx.inputs[0].default_value = 0.6
    ramp = _n(nt, "ShaderNodeValToRGB", (-320, 120))
    ramp.color_ramp.elements[0].color = bcol; ramp.color_ramp.elements[1].color = a
    bump = _n(nt, "ShaderNodeBump", (-300, -150)); bump.inputs["Strength"].default_value = 0.12
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"]); nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"]); nt.links.new(mp.outputs["Vector"], wv.inputs["Vector"])
    nt.links.new(nz.outputs["Fac"], mx.inputs[1]); nt.links.new(wv.outputs["Fac"], mx.inputs[2])
    nt.links.new(mx.outputs["Color"], ramp.inputs["Fac"]); nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(mx.outputs["Color"], bump.inputs["Height"]); nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return mat


def rug_mat():
    mat, b = M("RugWool", (0.55, 0.16, 0.2, 1), rough=1.0, spec=0.1, sheen=0.5)
    nt = mat.node_tree
    tc = _n(nt, "ShaderNodeTexCoord", (-1200, 0))
    sep = _n(nt, "ShaderNodeSeparateXYZ", (-1000, 0))
    ax = _n(nt, "ShaderNodeMath", (-800, 80), operation="ABSOLUTE"); ay = _n(nt, "ShaderNodeMath", (-800, -80), operation="ABSOLUTE")
    mxm = _n(nt, "ShaderNodeMath", (-600, 0), operation="MAXIMUM")
    sc = _n(nt, "ShaderNodeMath", (-420, 0), operation="MULTIPLY"); sc.inputs[1].default_value = 6.6   # object coords -0.5..0.5 -> 0..~3.3
    ramp = _n(nt, "ShaderNodeValToRGB", (-220, 0)); ramp.color_ramp.interpolation = "CONSTANT"
    cols = [(0.60, 0.17, 0.22, 1), (0.93, 0.85, 0.66, 1), (0.60, 0.17, 0.22, 1), (0.86, 0.62, 0.16, 1), (0.60, 0.17, 0.22, 1)]
    pos = [0.0, 0.52, 0.62, 0.74, 0.86]
    while len(ramp.color_ramp.elements) < len(cols):
        ramp.color_ramp.elements.new(0.5)
    for e, c, p in zip(ramp.color_ramp.elements, cols, pos):
        e.position = p; e.color = c
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    nt.links.new(sep.outputs["X"], ax.inputs[0]); nt.links.new(sep.outputs["Y"], ay.inputs[0])
    nt.links.new(ax.outputs[0], mxm.inputs[0]); nt.links.new(ay.outputs[0], mxm.inputs[1])
    nt.links.new(mxm.outputs[0], sc.inputs[0])
    # normalise: object-space |max| is 0..0.5, ramp wants 0..1
    nt.links.new(sc.outputs[0], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    bump_from(mat, b, 300, 4, 0.4)
    return mat


# ---------------------------------------------------------------- building blocks
def hollow_box(name, outer, wall, top_open, collection, mat, loc, bevel=0.025):
    """solid outer rounded box with a cavity cut from the top (top_open) or bottom (not top_open)"""
    ob = box(name, outer, loc, collection, mat, bevel=bevel, seg=4)
    apply_modifiers(ob)
    cav_h = outer[2] - (FLOOR_T if top_open else LID_TOP)
    cz = loc[2] + (outer[2] / 2 - cav_h / 2 + 0.0001) * (1 if top_open else -1) if False else None
    if top_open:
        z0 = loc[2] - outer[2] / 2 + FLOOR_T
        cutter = box("cut", (outer[0] - 2 * wall, outer[1] - 2 * wall, cav_h + 0.05), (loc[0], loc[1], z0 + (cav_h + 0.05) / 2), collection, None, bevel=0.012, seg=2)
    else:
        z1 = loc[2] + outer[2] / 2 - LID_TOP
        cutter = box("cut", (outer[0] - 2 * wall, outer[1] - 2 * wall, cav_h + 0.05), (loc[0], loc[1], z1 - (cav_h + 0.05) / 2), collection, None, bevel=0.012, seg=2)
    apply_modifiers(cutter)
    boolean(ob, cutter)
    return smooth(ob)


def corner_bracket(name, pos, sx, sy, sz, collection, mat, size=0.075):
    """brass L-bracket wrapped round a vertical corner edge"""
    t = 0.006
    a = box(name + "_a", (size, t, size), (pos[0] - sx * (size / 2 - t / 2 - 0.0), pos[1] + sy * t / 2, pos[2]), collection, mat, bevel=0.002, seg=2)
    b = box(name + "_b", (t, size, size), (pos[0] + sx * t / 2, pos[1] - sy * (size / 2 - t / 2), pos[2]), collection, mat, bevel=0.002, seg=2)
    for ob in (a, b):
        pass
    return a, b


def rivet(name, loc, collection, mat, r=0.006):
    return ball(name, r, loc, collection, mat, scale=(1, 1, 0.55))


# ---------------------------------------------------------------- the suitcase
def build_suitcase(m):
    C = "Suitcase"
    ox, oy = OUT_W, OUT_D
    # base shell (leather outside)
    base = hollow_box("Base_Shell", (ox, oy, BASE_H), WALL, True, C, m["leather"], (0, 0, BASE_H / 2))
    # lining: floor + 4 walls (fabric)
    iw, idp = ox - 2 * WALL, oy - 2 * WALL
    lin = []
    lin.append(box("Lining_Floor", (iw, idp, LINING), (0, 0, FLOOR_T + LINING / 2), C, m["lining"], bevel=0.002, seg=1))
    for nme, sz, loc in (
        ("Lining_Back", (iw, LINING, BASE_H - FLOOR_T), (0, idp / 2 - LINING / 2, FLOOR_T + (BASE_H - FLOOR_T) / 2)),
        ("Lining_Front", (iw, LINING, BASE_H - FLOOR_T), (0, -idp / 2 + LINING / 2, FLOOR_T + (BASE_H - FLOOR_T) / 2)),
        ("Lining_L", (LINING, idp, BASE_H - FLOOR_T), (-iw / 2 + LINING / 2, 0, FLOOR_T + (BASE_H - FLOOR_T) / 2)),
        ("Lining_R", (LINING, idp, BASE_H - FLOOR_T), (iw / 2 - LINING / 2, 0, FLOOR_T + (BASE_H - FLOOR_T) / 2)),
    ):
        lin.append(box(nme, sz, loc, C, m["lining"], bevel=0.001, seg=1))
    # rim piping + welt (leather lip + cream stitching line)
    rim = box("Rim_Welt", (ox - 0.006, oy - 0.006, 0.012), (0, 0, BASE_H - 0.004), C, m["leather_dark"], bevel=0.006, seg=3)
    apply_modifiers(rim)
    cutter = box("c", (iw - 0.004, idp - 0.004, 0.05), (0, 0, BASE_H), C, None); boolean(rim, cutter)
    smooth(rim)

    # brass corners (bottom 4 + top 4 of the base)
    for sx in (-1, 1):
        for sy in (-1, 1):
            corner_bracket(f"BaseCorner_{sx}{sy}", (sx * ox / 2, sy * oy / 2, 0.045), sx, sy, 1, C, m["brass"], size=0.085)
            corner_bracket(f"BaseCornerTop_{sx}{sy}", (sx * ox / 2, sy * oy / 2, BASE_H - 0.045), sx, sy, 1, C, m["brass"], size=0.085)
            rivet(f"rv_{sx}{sy}a", (sx * (ox / 2 + 0.0035), sy * (oy / 2 - 0.03), 0.045), C, m["brass"])

    # front hardware: two latches + leather handle
    for i, x in enumerate((-0.31, 0.31)):
        plate = box(f"LatchPlate_{i}", (0.085, 0.008, 0.085), (x, -oy / 2 - 0.003, BASE_H - 0.05), C, m["brass"], bevel=0.0035, seg=3)
        lock = box(f"LatchTurn_{i}", (0.05, 0.012, 0.038), (x, -oy / 2 - 0.011, BASE_H - 0.045), C, m["brass_dark"], bevel=0.005, seg=3)
        key = cyl(f"LatchKey_{i}", 0.011, 0.012, (x, -oy / 2 - 0.014, BASE_H - 0.045), C, m["brass"], rot=(math.radians(90), 0, 0), verts=24, bevel=0.002)
        rivet(f"LatchRv_{i}a", (x - 0.034, -oy / 2 - 0.009, BASE_H - 0.075), C, m["brass"]); rivet(f"LatchRv_{i}b", (x + 0.034, -oy / 2 - 0.009, BASE_H - 0.075), C, m["brass"])
    for sx in (-1, 1):
        box(f"HandleBkt_{sx}", (0.03, 0.012, 0.045), (sx * 0.16, -oy / 2 - 0.004, 0.105), C, m["brass"], bevel=0.004, seg=3)
    hp = box("Handle_Grip", (0.34, 0.022, 0.026), (0, -oy / 2 - 0.030, 0.094), C, m["leather_dark"], bevel=0.011, seg=5)
    for sx in (-1, 1):
        box(f"Handle_Leg_{sx}", (0.02, 0.022, 0.05), (sx * 0.16, -oy / 2 - 0.02, 0.11), C, m["leather_dark"], bevel=0.007, seg=4, rot=(math.radians(-18), 0, 0))
    # elastic garment straps on the back wall (cells x=1 and x=4, per container.ts)
    for cx in (1, 4):
        x, _ = cell_xy(cx, 1)
        box(f"Strap_{cx}", (0.036, 0.007, 0.12), (x, idp / 2 - LINING - 0.0045, FLOOR_T + LINING + 0.075), C, m["elastic"], bevel=0.002, seg=2)
        box(f"StrapBuckle_{cx}", (0.046, 0.011, 0.02), (x, idp / 2 - LINING - 0.008, FLOOR_T + LINING + 0.100), C, m["brass"], bevel=0.003, seg=3)
        box(f"StrapTab_{cx}", (0.03, 0.008, 0.028), (x, idp / 2 - LINING - 0.0075, FLOOR_T + LINING + 0.02), C, m["leather_dark"], bevel=0.003, seg=3)

    # ---- the lid, hinged on the back top edge, opened ~107 degrees
    hinge = bpy.data.objects.new("LidHinge", None)
    hinge.location = (0, oy / 2, BASE_H)
    put(hinge, C)
    lid_z0 = 0.0   # lid built in the closed pose relative to the hinge line (z=0 is the hinge height)
    lid = hollow_box("Lid_Shell", (ox, oy, LID_H), WALL, False, C, m["leather"], (0, -oy / 2, lid_z0 + LID_H / 2))
    parts = [lid]
    iz = lid_z0 + LID_H - LID_TOP          # underside of the lid ceiling (closed pose)
    parts.append(box("LidLining_Top", (iw, idp, LINING), (0, -oy / 2, iz - LINING / 2), C, m["lining"], bevel=0.001, seg=1))
    for nme, sz, loc in (
        ("LidLining_Back", (iw, LINING, LID_H - LID_TOP), (0, -WALL - LINING / 2, lid_z0 + (LID_H - LID_TOP) / 2)),
        ("LidLining_Front", (iw, LINING, LID_H - LID_TOP), (0, -oy + WALL + LINING / 2, lid_z0 + (LID_H - LID_TOP) / 2)),
        ("LidLining_L", (LINING, idp, LID_H - LID_TOP), (-iw / 2 + LINING / 2, -oy / 2, lid_z0 + (LID_H - LID_TOP) / 2)),
        ("LidLining_R", (LINING, idp, LID_H - LID_TOP), (iw / 2 - LINING / 2, -oy / 2, lid_z0 + (LID_H - LID_TOP) / 2)),
    ):
        parts.append(box(nme, sz, loc, C, m["lining"], bevel=0.001, seg=1))
    # satin lid pocket: a puffed panel, stitched on three sides, elastic across the top
    pw, ph = 0.62, 0.30
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=24, y_segments=14, size=0.5)
    for v in bm.verts:
        u, w = v.co.x * 2, v.co.y * 2   # -1..1
        v.co.x = u * pw / 2; v.co.y = w * ph / 2
        puff = (1 - u * u) ** 0.7 * (1 - w * w) ** 0.7
        v.co.z = 0.0 - 0.016 * puff * (0.55 + 0.45 * (1 - (w + 1) / 2))   # sags toward the bottom of the pocket
    pocket = mesh_obj("LidPocket", bm, C, m["satin"], (0, -oy / 2 - 0.02, iz - LINING - 0.0025))
    sol = pocket.modifiers.new("Solid", "SOLIDIFY"); sol.thickness = 0.003
    sub = pocket.modifiers.new("Sub", "SUBSURF"); sub.levels = 1
    smooth(pocket); parts.append(pocket)
    parts.append(box("Pocket_Elastic", (pw + 0.01, 0.012, 0.006), (0, -oy / 2 - 0.02 + ph / 2, iz - LINING - 0.0075), C, m["elastic"], bevel=0.0025, seg=2))
    parts.append(box("Pocket_Bind_L", (0.006, ph + 0.01, 0.006), (-pw / 2, -oy / 2 - 0.02, iz - LINING - 0.0075), C, m["leather_dark"], bevel=0.0025, seg=2))
    parts.append(box("Pocket_Bind_R", (0.006, ph + 0.01, 0.006), (pw / 2, -oy / 2 - 0.02, iz - LINING - 0.0075), C, m["leather_dark"], bevel=0.0025, seg=2))
    parts.append(box("Pocket_Bind_B", (pw + 0.01, 0.006, 0.006), (0, -oy / 2 - 0.02 - ph / 2, iz - LINING - 0.0075), C, m["leather_dark"], bevel=0.0025, seg=2))
    # a tiny folded note and a ticket in the pocket
    parts.append(box("PocketNote", (0.08, 0.1, 0.004), (-0.12, -oy / 2 - 0.005, iz - LINING - 0.0068 - 0.003), C, m["paper"], bevel=0.0012, seg=1, rot=(0, 0, math.radians(-6))))
    parts.append(box("PocketTicket", (0.05, 0.075, 0.003), (0.0, -oy / 2 + 0.005, iz - LINING - 0.0068 - 0.002), C, m["ticket"], bevel=0.001, seg=1, rot=(0, 0, math.radians(7))))
    # lid brass: corners, hasps matching the base latches
    for sx in (-1, 1):
        for sy in (0, 1):
            y = -sy * oy
            parts += list(corner_bracket(f"LidCorner_{sx}{sy}", (sx * ox / 2, y + (0.0 if sy == 0 else 0.0), lid_z0 + 0.045), sx, -1 if sy == 0 else 1, 1, C, m["brass"], size=0.085))
    for i, x in enumerate((-0.31, 0.31)):
        parts.append(box(f"Hasp_{i}", (0.05, 0.008, 0.06), (x, -oy - 0.001, lid_z0 + 0.035), C, m["brass"], bevel=0.003, seg=3))
    for ob in parts:
        ob.parent = hinge          # authored in hinge-local space (z=0 is the hinge line)
    hinge.rotation_euler = (math.radians(-107), 0, 0)
    # brass hinge barrel
    cyl("Hinge_Pin", 0.012, ox * 0.9, (0, oy / 2 + 0.002, BASE_H), C, m["brass"], rot=(0, math.radians(90), 0), verts=24)
    return hinge


# ---------------------------------------------------------------- furniture (one per game item, grid-sized)
def build_bed(m, cx, cz, rot=0):
    C = "Bed"
    x, y = cell_xy(cx, cz)
    y -= CELL * 0.5          # 1 x 2 cells, its centre sits between two cells
    root = bpy.data.objects.new("Bed_root", None); put(root, C); root.location = (x, y, FLOOR_Z)
    kw = dict(collection=C)
    parts = [
        box("Bed_Sleeve", (CELL * 0.84, CELL * 1.5, 0.036), (0, 0.03, 0.018), mat=m["matchbox"], bevel=0.003, seg=2, **kw),
        box("Bed_SleeveStripe", (CELL * 0.86, CELL * 0.5, 0.037), (0, 0.04, 0.0185), mat=m["matchbox_stripe"], bevel=0.003, seg=2, **kw),
        box("Bed_Tray", (CELL * 0.8, CELL * 1.85, 0.026), (0, -0.0, 0.026), mat=m["tray"], bevel=0.003, seg=2, **kw),
        box("Bed_Mattress", (CELL * 0.74, CELL * 1.7, 0.03), (0, 0.0, 0.056), mat=m["ticking"], bevel=0.011, seg=4, **kw),
        box("Bed_Pillow", (CELL * 0.6, CELL * 0.4, 0.024), (0, CELL * 0.62, 0.082), mat=m["pillow"], bevel=0.011, seg=4, **kw),
    ]
    for p in parts:
        p.parent = root; p.matrix_parent_inverse = root.matrix_world.inverted()
    root.rotation_euler[2] = rot * math.pi / 2
    return root


def build_blanket(m, cx, cz):
    C = "Blanket"
    x, y = cell_xy(cx, cz)
    y -= CELL * 0.5
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=40, y_segments=56, size=0.5)
    bw, bl = CELL * 0.82, CELL * 1.12
    for v in bm.verts:
        u, w = v.co.x * 2, v.co.y * 2
        v.co.x = u * bw / 2; v.co.y = w * bl / 2
        fold = 0.012 * math.sin(w * 5.5 + 0.8) * (1 - u * u * 0.6)
        drape = -0.028 * max(0.0, abs(u) - 0.55) ** 1.6 * 4          # sides droop over the mattress
        edge = -0.016 * max(0.0, w - 0.55) * 2.2                      # foot hangs down
        v.co.z = 0.004 + fold + drape + edge
    ob = mesh_obj("Blanket", bm, C, m["felt_mustard"], (x, y - CELL * 0.18, FLOOR_Z + 0.072))
    s = ob.modifiers.new("Solid", "SOLIDIFY"); s.thickness = 0.005
    sub = ob.modifiers.new("Sub", "SUBSURF"); sub.levels = 1
    smooth(ob)
    # whipstitch border
    for k in range(-5, 6):
        box(f"Blanket_Stitch_{k}", (0.002, 0.012, 0.0016), (x + k * bw / 11.0, y - CELL * 0.18 + bl / 2 - 0.004, FLOOR_Z + 0.072 - 0.004), C, m["thread"], bevel=0.0006, seg=1)
    return ob


def build_armchair(m, cx, cz, rot=2):
    C = "Armchair"
    x, y = cell_xy(cx, cz)
    root = bpy.data.objects.new("Armchair_root", None); put(root, C); root.location = (x, y, FLOOR_Z)
    kw = dict(collection=C)
    parts = [
        box("Chair_Seat", (CELL * 0.8, CELL * 0.78, 0.05), (0, 0.0, 0.044), mat=m["velvet"], bevel=0.016, seg=4, **kw),
        box("Chair_Cushion", (CELL * 0.6, CELL * 0.58, 0.02), (0, 0.006, 0.076), mat=m["velvet_light"], bevel=0.009, seg=4, **kw),
        box("Chair_Back", (CELL * 0.82, 0.026, 0.11), (0, -CELL * 0.37, 0.095), mat=m["velvet"], bevel=0.013, seg=4, rot=(math.radians(-8), 0, 0), **kw),
        box("Chair_ArmL", (0.03, CELL * 0.74, 0.07), (-CELL * 0.42, 0.0, 0.075), mat=m["velvet"], bevel=0.013, seg=4, **kw),
        box("Chair_ArmR", (0.03, CELL * 0.74, 0.07), (CELL * 0.42, 0.0, 0.075), mat=m["velvet"], bevel=0.013, seg=4, **kw),
    ]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(cyl(f"Chair_Foot_{sx}{sy}", 0.008, 0.02, (sx * CELL * 0.34, sy * CELL * 0.3, 0.01), C, m["brass"], r2=0.005, verts=20))
    for k in range(-3, 4):
        parts.append(ball(f"Chair_Button_{k}", 0.004, (k * 0.014, -CELL * 0.37 + 0.016, 0.115 + 0.0), C, m["brass"]))
    for p in parts:
        p.parent = root; p.matrix_parent_inverse = root.matrix_world.inverted()
    root.rotation_euler[2] = rot * math.pi / 2
    return root


def build_lamp(m, cx, cz):
    C = "Lamp"
    x, y = cell_xy(cx, cz)
    # a giant button for a base, a brass pin, a smaller button as the shade
    base = cyl("Lamp_ButtonBase", 0.056, 0.012, (x, y, FLOOR_Z + 0.006), C, m["button"], verts=64, bevel=0.003)
    rim = torus("Lamp_BaseRim", 0.048, 0.0045, (x, y, FLOOR_Z + 0.013), C, m["button"])
    for i, (hx, hy) in enumerate(((-0.014, -0.014), (0.014, -0.014), (-0.014, 0.014), (0.014, 0.014))):
        torus(f"Lamp_Hole_{i}", 0.0046, 0.0016, (x + hx, y + hy, FLOOR_Z + 0.0125), C, m["thread"])
    cyl("Lamp_Stem", 0.0055, 0.115, (x, y, FLOOR_Z + 0.07), C, m["brass"], verts=20)
    ball("Lamp_Collar", 0.011, (x, y, FLOOR_Z + 0.02), C, m["brass"], scale=(1, 1, 0.6))
    shade = cyl("Lamp_Shade", 0.052, 0.034, (x, y, FLOOR_Z + 0.145), C, m["shade"], verts=64, r2=0.03, bevel=0.002)
    ball("Lamp_Bulb", 0.016, (x, y, FLOOR_Z + 0.128), C, m["glow"])
    cyl("Lamp_Finial", 0.005, 0.014, (x, y, FLOOR_Z + 0.17), C, m["brass"], verts=16)
    return (x, y, FLOOR_Z + 0.13)


def build_table(m, cx, cz):
    C = "Table"
    x, y = cell_xy(cx, cz)
    z0 = FLOOR_Z
    cyl("Spool_Bottom", 0.062, 0.012, (x, y, z0 + 0.006), C, m["spool_wood"], verts=64, bevel=0.0025)
    cyl("Spool_Top", 0.062, 0.012, (x, y, z0 + 0.094), C, m["spool_wood"], verts=64, bevel=0.0025)
    core = cyl("Spool_Core", 0.02, 0.09, (x, y, z0 + 0.05), C, m["spool_wood"], verts=40)
    thread = cyl("Spool_Thread", 0.038, 0.074, (x, y, z0 + 0.05), C, m["thread_red"], verts=64)
    # the winding: ridged thread
    bump_mat = m["thread_red"]
    # needle stuck through the top, a thimble on it for a cup
    cyl("Spool_Needle", 0.0016, 0.07, (x + 0.02, y + 0.012, z0 + 0.128), C, m["steel"], rot=(math.radians(8), math.radians(-4), 0), verts=12)
    ball("Spool_Thimble", 0.014, (x - 0.025, y - 0.015, z0 + 0.108), C, m["steel"], scale=(1, 1, 0.9))
    return (x, y, z0 + 0.1)


def build_rug(m, cx, cz):
    C = "Rug"
    x, y = cell_xy(cx, cz)
    x += CELL * 0.5; y -= CELL * 0.5            # 2 x 2 cells
    ob = box("Rug", (CELL * 1.9, CELL * 1.9, 0.006), (x, y, FLOOR_Z + 0.003), C, m["rug"], bevel=0.0018, seg=2)
    for i in range(-9, 10):
        t = i * CELL * 1.9 / 19
        for sy in (-1, 1):
            box(f"Fringe_{i}_{sy}", (0.003, 0.018, 0.0026), (x + t, y + sy * (CELL * 0.95 + 0.007), FLOOR_Z + 0.0018), C, m["thread_cream"], bevel=0.0008, seg=1)
    return ob


# ---------------------------------------------------------------- desk + props
def build_desk(m):
    C = "Desk"
    d = box("Desk_Top", (3.4, 2.4, 0.08), (0, 0.1, -0.04), C, m["desk"], bevel=0.012, seg=3)
    # mug
    mx, my = 0.78, 0.46
    mug = cyl("Mug_Body", 0.062, 0.1, (mx, my, 0.05), C, m["ceramic"], verts=64, bevel=0.003)
    cut = cyl("c", 0.052, 0.1, (mx, my, 0.065), C, None, verts=64); boolean(mug, cut)
    cyl("Mug_Coffee", 0.052, 0.003, (mx, my, 0.084), C, m["coffee"], verts=64)
    torus("Mug_Handle", 0.03, 0.008, (mx + 0.072, my, 0.052), C, m["ceramic"], rot=(math.radians(90), 0, 0))
    # pencil (hex)
    pen = cyl("Pencil_Body", 0.0065, 0.34, (-0.74, 0.5, 0.0075), C, m["pencil"], rot=(0, math.radians(90), math.radians(14)), verts=6)
    cyl("Pencil_Wood", 0.0065, 0.03, (-0.565, 0.455, 0.0075), C, m["wood_light"], rot=(0, math.radians(90), math.radians(14)), verts=6, r2=0.0016)
    # loose brass keys/buttons for scale + story
    for i, (bx, by) in enumerate(((-0.62, -0.5), (-0.54, -0.56), (0.7, -0.48))):
        cyl(f"Button_{i}", 0.02, 0.005, (bx, by, 0.0025), C, m["button"] if i != 2 else m["brass"], verts=40, bevel=0.0012)
    # rain-streaked window frame hint behind (just the wooden sill)
    box("Sill", (3.4, 0.14, 0.05), (0, 1.25, 0.025), C, m["desk"], bevel=0.01, seg=2)


# ---------------------------------------------------------------- lights + camera
def lighting(scene, lamp_pos):
    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    wn = scene.world.node_tree
    wn.nodes["Background"].inputs[0].default_value = (0.03, 0.045, 0.075, 1)
    wn.nodes["Background"].inputs[1].default_value = 0.6
    def area(name, loc, rot, energy, color, size, size_y=None):
        d = bpy.data.lights.new(name, "AREA"); d.energy = energy; d.color = color; d.size = size
        if size_y:
            d.shape = "RECTANGLE"; d.size_y = size_y
        o = bpy.data.objects.new(name, d); o.location = loc; o.rotation_euler = rot
        put(o, "Lights"); return o
    area("Key_Warm", (-0.7, -1.1, 1.05), (math.radians(60), 0, math.radians(-32)), 85, (1.0, 0.72, 0.45), 1.0, 0.6)
    area("Fill_Cool", (1.6, -0.6, 0.9), (math.radians(70), 0, math.radians(58)), 28, (0.62, 0.74, 1.0), 1.4, 1.0)
    area("Rim_Window", (0.0, 1.9, 0.9), (math.radians(110), 0, 0), 90, (0.55, 0.68, 1.0), 2.4, 0.8)
    d = bpy.data.lights.new("LampGlow", "POINT"); d.energy = 7; d.color = (1.0, 0.66, 0.28); d.shadow_soft_size = 0.03
    o = bpy.data.objects.new("LampGlow", d); o.location = lamp_pos; put(o, "Lights")


def camera(scene, target=(0.0, 0.12, 0.3)):
    cam = bpy.data.cameras.new("Cam"); cam.lens = 46
    co = bpy.data.objects.new("Cam", cam); put(co, "Camera")
    co.location = (0.95, -2.35, 1.4)
    tgt = bpy.data.objects.new("CamTarget", None); tgt.location = target; put(tgt, "Camera")
    tr = co.constraints.new("TRACK_TO"); tr.target = tgt; tr.track_axis = "TRACK_NEGATIVE_Z"; tr.up_axis = "UP_Y"
    cam.dof.use_dof = True; cam.dof.focus_object = tgt; cam.dof.aperture_fstop = 4.5
    scene.camera = co


# ---------------------------------------------------------------- orchestration
def materials():
    m = {}
    m["leather"] = leather("PetrolLeather", (0.04, 0.14, 0.2, 1), (0.22, 0.36, 0.42, 1))
    m["leather_dark"] = leather("PetrolLeatherDark", (0.03, 0.08, 0.11, 1), (0.16, 0.24, 0.27, 1))
    m["brass"] = brass("Brass", 0.45)
    m["brass_dark"] = brass("BrassDark", 0.7)
    m["lining"] = weave("Lining", (0.48, 0.27, 0.12, 1), scale=520, strength=0.7)
    m["satin"] = satin("Satin", (0.58, 0.16, 0.2, 1))
    m["elastic"] = weave("Elastic", (0.55, 0.14, 0.18, 1), rough=0.8, scale=900, strength=0.9, sheen=0.2)
    m["paper"] = paper("Paper", (0.86, 0.78, 0.62, 1))
    m["ticket"] = paper("Ticket", (0.78, 0.55, 0.28, 1))
    m["matchbox"] = paper("Matchbox", (0.62, 0.47, 0.30, 1))
    m["matchbox_stripe"] = paper("MatchboxStripe", (0.55, 0.14, 0.18, 1))
    m["tray"] = wood("TrayWood", (0.72, 0.55, 0.32, 1), (0.5, 0.35, 0.18, 1), rough=0.6)
    m["ticking"] = weave("Ticking", (0.92, 0.88, 0.78, 1), scale=300, strength=0.5, sheen=0.3, stripe=(0.20, 0.36, 0.44, 1))
    m["pillow"] = weave("Pillow", (0.95, 0.93, 0.88, 1), scale=300, strength=0.5, sheen=0.5)
    m["felt_mustard"] = felt("MustardFelt", (0.72, 0.52, 0.12, 1))
    m["thread"] = felt("Thread", (0.9, 0.84, 0.7, 1))
    m["thread_cream"] = felt("ThreadCream", (0.93, 0.88, 0.76, 1))
    m["thread_red"] = weave("ThreadRed", (0.58, 0.12, 0.17, 1), rough=0.7, scale=1100, strength=1.0, sheen=0.6)
    m["velvet"] = felt("Velvet", (0.1, 0.3, 0.14, 1))
    m["velvet_light"] = felt("VelvetLight", (0.2, 0.44, 0.2, 1))
    m["button"] = paper("ButtonResin", (0.94, 0.9, 0.8, 1)); m["button"].node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.3
    m["shade"], b = M("ShadeButton", (0.98, 0.86, 0.55, 1), rough=0.5, emit=(1.0, 0.62, 0.2, 1), emit_k=1.6)
    m["glow"], b = M("Glow", (1.0, 0.8, 0.4, 1), rough=0.4, emit=(1.0, 0.6, 0.15, 1), emit_k=14.0)
    m["spool_wood"] = wood("SpoolWood", (0.68, 0.5, 0.28, 1), (0.45, 0.3, 0.15, 1))
    m["steel"], b = M("Steel", (0.7, 0.7, 0.72, 1), rough=0.25, metal=1.0)
    m["rug"] = rug_mat()
    m["desk"] = wood("DeskWalnut", (0.30, 0.16, 0.08, 1), (0.10, 0.05, 0.025, 1), rough=0.5)
    m["ceramic"], b = M("Ceramic", (0.88, 0.9, 0.9, 1), rough=0.18, spec=0.7, coat=0.4)
    m["coffee"], b = M("Coffee", (0.07, 0.035, 0.02, 1), rough=0.1, spec=0.8)
    m["pencil"], b = M("PencilPaint", (0.85, 0.65, 0.12, 1), rough=0.4, coat=0.3)
    m["wood_light"], b = M("WoodLight", (0.8, 0.62, 0.38, 1), rough=0.7)
    # M() returns (mat, bsdf); normalise
    for k, v in list(m.items()):
        if isinstance(v, tuple):
            m[k] = v[0]
    return m


def build(out_dir, render=True, export=True, samples=64, res=(1600, 900), hero_layout=True):
    scene = reset()
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = res
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    scene.view_settings.exposure = -0.6
    m = materials()
    build_desk(m)
    build_suitcase(m)
    # the hero layout is a believable furnished night-one room, on the game's real grid
    bed = build_bed(m, 1, 1)             # cells (1,1)-(1,2)
    blanket = build_blanket(m, 1, 1)
    chair = build_armchair(m, 4, 1, rot=2)
    build_rug(m, 3, 2)
    lamp_pos = build_lamp(m, 5, 1)
    build_table(m, 3, 0)
    lighting(scene, lamp_pos)
    camera(scene)
    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, "small_comforts_vs01.blend"))
    if render:
        scene.render.filepath = os.path.join(out_dir, "hero.png")
        bpy.ops.render.render(write_still=True)
    if export:
        export_glbs(out_dir)


def export_glbs(out_dir):
    gl = os.path.join(out_dir, "glb"); os.makedirs(gl, exist_ok=True)
    for name in ("Suitcase", "Bed", "Blanket", "Armchair", "Lamp", "Table", "Rug", "Desk"):
        c = bpy.data.collections.get(name)
        if not c:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for o in c.all_objects:
            o.select_set(True)
        bpy.context.view_layer.objects.active = next(iter(c.all_objects))
        bpy.ops.export_scene.gltf(filepath=os.path.join(gl, f"sc_{name.lower()}.glb"), export_format="GLB", use_selection=True, export_apply=True, export_yup=True)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    def opt(flag, default):
        return argv[argv.index(flag) + 1] if flag in argv else default
    out = opt("--out", os.path.join(os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else ".", "out"))
    samples = int(opt("--samples", 64))
    res = (int(argv[argv.index("--res") + 1]), int(argv[argv.index("--res") + 2])) if "--res" in argv else (1600, 900)
    build(out, render="--no-render" not in argv, export="--no-export" not in argv, samples=samples, res=res)
