"""Beverly Hills level: the cast and their animations (Blender 5.2, headless).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python scripts/assets/beverly-hills/build_cast.py -- \
        --sources ~/Desktop/lantern-city-commercial-game/coastal-proof-sources [--render OUT_DIR]

Everyone is built on the CC0 Quaternius Universal Base Characters (one 65-bone skeleton shared with the Universal
Animation Library, so every clip plays on every person without retargeting). Clothes are copies of body regions
pushed out along the normals (they keep the body's skin weights and deform with it), coloured per vertex.
The region-extraction helpers come from scripts/assets/coastal-proof/build_trailblazer.py (code only; none of the
Coastal Market art is used). (The pug is built in the runtime.)

Outputs in client/public/assets/goldline/beverly-hills-3d/cast/:
  heroine.glb    teal jacket over a cream tee, charcoal trousers, brown boots, round tortoiseshell glasses, a big
                 tan backpack, dark hair in a high bun. SUNGLASSES is a separate mesh the game reveals.
  sterling.glb   the doorman: navy frock coat with gold buttons, white gloves, top hat.
  influencer_a/b/c.glb, barista.glb   background cast (about 7k triangles each).
  anims.glb      the clips the level uses.
"""

import bmesh
import bpy
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "coastal-proof"))
import build_trailblazer as tb  # noqa: E402  (region-extraction helpers; reads --sources from argv)

from mathutils import Matrix, Vector, noise  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(REPO, "client", "public", "assets", "goldline", "beverly-hills-3d", "cast")
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
RENDER = ARGV[ARGV.index("--render") + 1] if "--render" in ARGV else None
BASE_DIR = os.path.join(tb.Q, "Base Characters", "Godot - UE")
HAIR_DIR = os.path.join(tb.Q, "Hairstyles", "Rigged to Head Bone", "glTF (Godot -Unreal)")
QROOT = os.path.join(tb.SRC, "quaternius")
UAL1 = os.path.join(QROOT, "Universal Animation Library[Standard]", "Universal Animation Library[Standard]", "Unreal-Godot", "UAL1_Standard.glb")
UAL2 = os.path.join(QROOT, "Universal Animation Library 2[Standard]", "Universal Animation Library 2[Standard]", "Unreal-Godot", "UAL2_Standard.glb")
PUG = os.path.expanduser("~/Desktop/lantern-city-commercial-game/beverly-hills-sources/quaternius_farm-animals/extracted/Farm Animals by @Quaternius/FBX/Pug.fbx")

CLIPS_1 = ["Idle_Loop", "Walk_Loop", "Walk_Formal_Loop", "Jog_Fwd_Loop", "Sprint_Loop", "Jump_Start", "Jump_Loop", "Jump_Land",
           "Idle_Talking_Loop", "Dance_Loop", "Interact", "PickUp_Table"]
CLIPS_2 = ["Idle_FoldArms_Loop", "Idle_No_Loop", "Idle_TalkingPhone_Loop", "Yes", "Consume", "Hit_Knockback", "ClimbUp_1m"]


def lin(h):
    h = h.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)


def shaded(hexc, amount=0.06, scale=11.0):
    base = lin(hexc)

    def fn(c, n, v):
        k = 1.0 + amount * noise.noise(Vector(v) * scale)
        # a little ambient darkening low on the body and in creases (reads as cloth, not plastic)
        k *= 0.94 + 0.06 * max(0.0, min(1.0, v.z / 1.6))
        return tuple(max(0.0, min(1.0, x * k)) for x in base)
    return fn


def paint(ob, fn):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for layer in list(bm.loops.layers.color.values()):
        bm.loops.layers.color.remove(layer)
    col = bm.loops.layers.color.new("Color")
    for f in bm.faces:
        c = f.calc_center_median()
        for loop in f.loops:
            rgb = fn(c, f.normal, loop.vert.co)
            loop[col] = (rgb[0], rgb[1], rgb[2], 1.0)
    bm.to_mesh(ob.data)
    bm.free()


def import_base(male):
    tb.reset()
    bpy.ops.import_scene.gltf(filepath=os.path.join(BASE_DIR, "Superhero_Male_FullBody.gltf" if male else "Superhero_Female_FullBody.gltf"))
    for ob in list(bpy.data.objects):
        if ob.type == "MESH" and ob.parent is None:
            bpy.data.objects.remove(ob)
    arm = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
    body = max((o for o in bpy.data.objects if o.type == "MESH"), key=lambda o: len(o.data.vertices))
    face_parts = [o for o in bpy.data.objects if o.type == "MESH" and o is not body]
    for ob in [body]:
        me = ob.data
        keep = next((uv.name for uv in me.uv_layers if uv.active_render), None)
        for uv in list(me.uv_layers):
            if uv.name != keep:
                me.uv_layers.remove(uv)
    return arm, body, face_parts


def import_hair(arm, hair_file, colour):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(HAIR_DIR, hair_file))
    new = [o for o in bpy.data.objects if o not in before]
    hair = [o for o in new if o.type == "MESH"][0]
    world = hair.matrix_world.copy()
    hair.parent = None
    hair.matrix_world = world
    for o in new:
        if o is not hair:
            bpy.data.objects.remove(o)
    for uv in list(hair.data.uv_layers)[1:]:
        hair.data.uv_layers.remove(uv)
    for g in list(hair.vertex_groups):
        hair.vertex_groups.remove(g)
    hair.parent = arm
    hg = hair.vertex_groups.new(name="Head")
    hg.add([v.index for v in hair.data.vertices], 1.0, "REPLACE")
    mod = hair.modifiers.get("Armature") or hair.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    paint(hair, shaded(colour, 0.12, 40.0))
    return hair


def extract(body, name, pred, inflate, color_fn, info, hems=None, fronts=None):
    """tb.extract, plus: weld UV-seam duplicates first (so pushing out along the normals opens no cracks), and snap
    open edges onto straight hems (z levels) and a straight front opening (|x| levels)."""
    me = body.data.copy()
    ob = body.copy()
    ob.data = me
    ob.name = name
    bpy.context.scene.collection.objects.link(ob)
    keep = set(i for i, (c, n, b) in enumerate(info) if pred(c, n, b))
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context="FACES")
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    for v in bm.verts:
        if not any(e.is_boundary for e in v.link_edges):
            continue
        if fronts:
            for fx in fronts:
                if abs(abs(v.co.x) - fx) < 0.03 and v.co.y < 0:
                    v.co.x = math.copysign(fx, v.co.x)
        if hems:
            for hz in hems:
                if abs(v.co.z - hz) < 0.1:
                    v.co.z = hz
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * inflate
    for layer in list(bm.loops.layers.color.values()):
        bm.loops.layers.color.remove(layer)
    col = bm.loops.layers.color.new("Color")
    for f in bm.faces:
        c = f.calc_center_median()
        for loop in f.loops:
            rgb = color_fn(c, f.normal, loop.vert.co)
            loop[col] = (rgb[0], rgb[1], rgb[2], 1.0)
    bm.to_mesh(me)
    bm.free()
    me.materials.clear()
    return ob


def shoe_builder(body, side_bones, palette):
    """A rounded shoe around each foot (the body's own foot surface pushed out kept its toes)."""
    me = body.data
    gi = {g.name: g.index for g in body.vertex_groups}

    def build(bm):
        for bones in side_bones:
            idx = {gi[b] for b in bones if b in gi}
            pts = [v.co for v in me.vertices if any(g.group in idx and g.weight > 0.4 for g in v.groups) and v.co.z < 0.16]
            if not pts:
                continue
            lo = Vector((min(p.x for p in pts), min(p.y for p in pts), 0.0))
            hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
            c = (lo + hi) / 2
            size = Vector((hi.x - lo.x + 0.03, hi.y - lo.y + 0.035, hi.z + 0.03))
            before = set(bm.verts)
            tb.cube((c.x, c.y, size.z / 2), tuple(size), bevel=min(size.x, size.z) * 0.45)(bm)
            for v in [v for v in bm.verts if v not in before]:
                # toe rounder and lower than the heel
                t = (v.co.y - lo.y) / max(1e-3, (hi.y - lo.y))
                if t < 0.35 and v.co.z > 0.05:
                    v.co.z -= (0.35 - t) * 0.12
    return build


def bones_of(info_b, *prefixes):
    return info_b is not None and info_b.startswith(prefixes)


# ------------------------------------------------------------------ props (rigid, one bone)
def ring_frame(bm, center, r, thick, axis_rot):
    n = 18
    for i in range(n):
        a0, a1 = i / n * math.tau, (i + 1) / n * math.tau
        p0 = Vector((math.cos(a0) * r, 0, math.sin(a0) * r))
        p1 = Vector((math.cos(a1) * r, 0, math.sin(a1) * r))
        mid = (p0 + p1) / 2
        v = bmesh.ops.create_cube(bm, size=1.0)["verts"]
        bmesh.ops.scale(bm, vec=((p1 - p0).length + 0.002, thick, thick), verts=v)
        bmesh.ops.rotate(bm, verts=v, cent=(0, 0, 0), matrix=Matrix.Rotation(-(a0 + a1) / 2 + math.pi / 2, 3, "Y"))
        bmesh.ops.translate(bm, vec=mid + Vector(center), verts=v)


def glasses_builder(eye_z, front_y, r, lens_hex=None, frame=0.006, spread=0.034):
    def build(bm):
        for ex in (-spread, spread):
            ring_frame(bm, (ex, front_y, eye_z), r, frame, None)
            if lens_hex:
                c = bmesh.ops.create_circle(bm, cap_ends=True, segments=16, radius=r)["verts"]
                bmesh.ops.rotate(bm, verts=c, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "X"))
                bmesh.ops.translate(bm, vec=(ex, front_y + 0.002, eye_z), verts=c)
        v = bmesh.ops.create_cube(bm, size=1.0)["verts"]
        bmesh.ops.scale(bm, vec=(spread * 2 - r * 2 + 0.006, frame, frame), verts=v)
        bmesh.ops.translate(bm, vec=(0, front_y, eye_z + r * 0.35), verts=v)
        for ex in (-spread - r, spread + r):
            v = bmesh.ops.create_cube(bm, size=1.0)["verts"]
            bmesh.ops.scale(bm, vec=(frame, 0.11, frame), verts=v)
            bmesh.ops.translate(bm, vec=(ex, front_y + 0.055, eye_z + r * 0.3), verts=v)
    return build


def cyl_builder(center, r, depth, segs=20, r2=None, rot=None):
    def build(bm):
        v = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=depth)["verts"]
        if rot is not None:
            bmesh.ops.rotate(bm, verts=v, cent=(0, 0, 0), matrix=rot)
        bmesh.ops.translate(bm, vec=Vector(center), verts=v)
    return build


def head_front_y(tree, z):
    hit = tb.body_surface(tree, 0.0, z, (0, -1, 0))
    return hit.y if hit else -0.11


# ------------------------------------------------------------------ people
def person(name, male, palette, hair_file=None, coat_to=None, open_front=False, apron=False, gloves=False,
           glasses=None, hat=None, backpack=False, sunglasses=False, decimate=None, scale=1.0):
    arm, body, face_parts = import_base(male)
    info = tb.face_info(body)
    tree = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
    top_low = coat_to if coat_to is not None else 0.86
    k = 1.03 if male else 1.0  # the male base is a touch taller

    def top(c, n, b):
        if b in tb.HEAD_BONES or tb.is_hand_or_finger(b):
            return False
        if open_front and c.y < -0.02 and abs(c.x) < 0.07 and c.z < 1.46 * k:
            return False
        if c.z > 1.52 * k:
            return False
        if c.z >= top_low * k:
            return True
        # frock-coat tails: the back and sides of the thighs
        return coat_to is not None and c.z >= coat_to * k and bones_of(b, "thigh", "pelvis") and c.y > -0.05

    def tee(c, n, b):
        return open_front and c.y < -0.02 and abs(c.x) < 0.085 and 0.9 * k <= c.z <= 1.47 * k and b not in tb.HEAD_BONES

    def legs(c, n, b):
        return 0.14 <= c.z < 0.98 * k and bones_of(b, "thigh", "calf", "pelvis")

    def shoes(c, n, b):
        return c.z < 0.2 and bones_of(b, "calf", "foot", "ball")

    def hands(c, n, b):
        return tb.is_hand_or_finger(b)

    def apron_pred(c, n, b):
        return 0.55 * k <= c.z <= 1.32 * k and c.y < -0.03 and abs(c.x) < 0.17

    pieces = []
    if open_front:
        pieces.append(extract(body, "g_tee", tee, 0.007, shaded(palette["tee"]), info, hems=[0.9 * k]))
    pieces.append(extract(body, "g_top", top, 0.016 if coat_to else 0.012, shaded(palette["top"]), info,
                          hems=[top_low * k] if coat_to is None else [coat_to * k], fronts=[0.07] if open_front else None))
    pieces.append(extract(body, "g_legs", legs, 0.011, shaded(palette["legs"], 0.05), info, hems=[0.14]))
    if gloves:
        pieces.append(extract(body, "g_gloves", hands, 0.006, shaded(palette["gloves"], 0.02), info))
    if apron:
        pieces.append(extract(body, "g_apron", apron_pred, 0.024, shaded(palette["apron"]), info, hems=[0.55 * k], fronts=[0.17]))
    paint(body, shaded(palette["skin"], 0.035, 6.0))
    parts = [body] + pieces
    if hair_file:
        parts.append(import_hair(arm, hair_file, palette["hair"]))
    rigid = []
    eye_z = (1.665 if not male else 1.722)
    fy = head_front_y(tree, eye_z) - 0.012
    if glasses:
        rigid.append(tb.rigid_mesh("p_glasses", arm, [(glasses_builder(eye_z, fy, 0.027, None, 0.0055), lin(glasses) + (0,))], lambda co: {"Head": 1.0}))
    if hat == "tophat":
        hz = 1.775 if male else 1.72
        rigid.append(tb.rigid_mesh("p_hat", arm, [
            (cyl_builder((0, 0.02, hz + 0.17), 0.115, 0.32, 24, 0.12), lin("#141318") + (0,)),
            (cyl_builder((0, 0.02, hz + 0.05), 0.118, 0.05, 24), lin("#d4a548") + (0,)),
            (cyl_builder((0, 0.02, hz + 0.01), 0.2, 0.015, 28), lin("#141318") + (0,)),
        ], lambda co: {"Head": 1.0}))
    if coat_to is not None:
        # gold epaulettes and a white cravat: a grand-hotel doorman at a glance
        def regalia(bm):
            for side in (-1, 1):
                top_hit = tb.body_surface(tree, side * 0.2, 1.56, (0, 0, 1)) if False else None
                tb.cube((side * 0.2, 0.0, 1.535), (0.16, 0.13, 0.035), bevel=0.012)(bm)
                for f in range(5):
                    tb.cube((side * (0.15 + f * 0.024), -0.06, 1.505), (0.008, 0.008, 0.05))(bm)
            hit = tb.body_surface(tree, 0.0, 1.5, (0, -1, 0))
            y = (hit.y if hit else -0.1) - 0.02
            tb.cube((0.0, y, 1.49), (0.07, 0.03, 0.09), bevel=0.012)(bm)
        rigid.append(tb.rigid_mesh("p_regalia", arm, [(regalia, lin("#e2b24c") + (0,))], lambda co: {"spine_03": 1.0}))
        def cravat(bm):
            hit = tb.body_surface(tree, 0.0, 1.52, (0, -1, 0))
            y = (hit.y if hit else -0.1) - 0.028
            tb.cube((0.0, y, 1.515), (0.09, 0.03, 0.05), bevel=0.012)(bm)
            tb.cube((0.0, y - 0.005, 1.455), (0.05, 0.02, 0.08), bevel=0.01)(bm)
        rigid.append(tb.rigid_mesh("p_cravat", arm, [(cravat, lin("#f7f5ef") + (0,))], lambda co: {"spine_03": 1.0}))
        # two rows of gold buttons down the coat front
        def buttons(bm):
            for row in range(4):
                for side in (-0.06, 0.06):
                    z = (1.36 - row * 0.12) * k
                    hit = tb.body_surface(tree, side, z, (0, -1, 0))
                    y = (hit.y if hit else -0.13) - 0.022
                    cyl_builder((side, y, z), 0.014, 0.01, 10, rot=Matrix.Rotation(math.pi / 2, 3, "X"))(bm)
        rigid.append(tb.rigid_mesh("p_buttons", arm, [(buttons, lin("#e2b24c") + (0,))], lambda co: {"spine_02" if co.z < 1.28 else "spine_03": 1.0}))
    if backpack:
        back = tb.body_surface(tree, 0.0, 1.22, (0, 1, 0))
        by = (back.y if back else 0.12) + 0.1
        def pod(center, size, segs=4):
            # a rounded duffel shape: a cube bevelled hard, then pushed toward an ellipsoid
            def build(bm):
                before = set(bm.verts)
                tb.cube(center, size, bevel=min(size) * 0.42)(bm)
                c = Vector(center)
                half = Vector(size) / 2
                for v in [v for v in bm.verts if v not in before]:
                    d = v.co - c
                    e = Vector((d.x / half.x, d.y / half.y, d.z / half.z))
                    if e.length > 0:
                        k = 0.55 + 0.45 / max(1.0, e.length)
                        v.co = c + Vector((d.x * k + d.x * (1 - k) * 0.75, d.y * k + d.y * (1 - k) * 0.75, d.z * k + d.z * (1 - k) * 0.75))
            return build
        rigid.append(tb.rigid_mesh("p_backpack", arm, [
            (pod((0, by - 0.01, 1.17), (0.3, 0.17, 0.38)), lin(palette["pack"]) + (0,)),
            (pod((0, by + 0.0, 1.33), (0.31, 0.16, 0.1)), lin(palette["pack_dark"]) + (0,)),
            (pod((0, by + 0.085, 1.08), (0.22, 0.05, 0.16)), lin(palette["pack_dark"]) + (0,)),
            (tb.cube((0.0, by + 0.11, 1.12), (0.05, 0.01, 0.025)), lin("#d9a64a") + (0,)),
            (pod((-0.155, by - 0.0, 1.14), (0.05, 0.11, 0.18)), lin(palette["pack_dark"]) + (0,)),
            (pod((0.155, by - 0.0, 1.14), (0.05, 0.11, 0.18)), lin(palette["pack_dark"]) + (0,)),
        ], lambda co: {"spine_03": 1.0}))
        # shoulder straps over the jacket, front side
        def straps(bm):
            for side in (-0.1, 0.1):
                for z0, z1 in ((1.47, 1.3), (1.3, 1.12)):
                    zc = (z0 + z1) / 2
                    hit = tb.body_surface(tree, side, zc, (0, -1, 0))
                    y = (hit.y if hit else -0.12) - 0.022
                    tb.cube((side, y, zc), (0.045, 0.012, abs(z0 - z1) + 0.02))(bm)
        rigid.append(tb.rigid_mesh("p_straps", arm, [(straps, lin(palette["pack_dark"]) + (0,))], lambda co: {"spine_03": 1.0}))
    for side in ("l", "r"):
        rigid.append(tb.rigid_mesh(f"p_shoe_{side}", arm, [(shoe_builder(body, [(f"foot_{side}", f"ball_{side}")], palette), lin(palette["shoes"]) + (0,))],
                                   lambda co, s=side: {f"foot_{s}": 1.0}))
    for ob in rigid:
        if ob.name.startswith(("p_shoe", "p_backpack", "p_hat")):
            for poly in ob.data.polygons:
                poly.use_smooth = True
        bca = ob.data.color_attributes.get("Color")
        if bca:
            ob.data.color_attributes.active_color = bca
    # one skinned mesh, one vertex-coloured material (eyes and brows keep their own textured materials)
    m = bpy.data.materials.new(f"BH_CAST_{name}")
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.75
    vc = m.node_tree.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Color"
    m.node_tree.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    joined = parts + rigid
    for ob in joined:
        ob.data.materials.clear()
        ob.data.materials.append(m)
        for mod in ob.modifiers:
            if mod.type == "ARMATURE":
                mod.object = arm
    for o in bpy.data.objects:
        o.select_set(False)
    for ob in joined:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body.name = f"BH_{name}"
    ca = body.data.color_attributes.get("Color")
    if ca:
        body.data.color_attributes.active_color = ca
        body.data.color_attributes.render_color_index = body.data.color_attributes.active_color_index
    if decimate:
        tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
        mod = body.modifiers.new("dec", "DECIMATE")
        mod.ratio = min(1.0, decimate / tris)
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.modifier_move_to_index(modifier="dec", index=0)
        bpy.ops.object.modifier_apply(modifier="dec")
    if sunglasses:
        sg = tb.rigid_mesh("SUNGLASSES", arm, [(glasses_builder(eye_z, fy - 0.012, 0.034, "#101014", 0.008, 0.038), lin("#101014") + (0,))], lambda co: {"Head": 1.0})
        sm = bpy.data.materials.new("BH_SUNGLASSES")
        sm.use_nodes = True
        p = sm.node_tree.nodes["Principled BSDF"]
        p.inputs["Base Color"].default_value = (0.01, 0.01, 0.012, 1)
        p.inputs["Roughness"].default_value = 0.08
        sg.data.materials.append(sm)
    tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == "MESH" for p in o.data.polygons)
    # only the eyes and brows keep textures; drop every image no material still uses and keep the rest small
    used = set()
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        for mt in ob.data.materials:
            if mt and mt.node_tree:
                for nd in mt.node_tree.nodes:
                    if nd.type == "TEX_IMAGE" and nd.image:
                        used.add(nd.image.name)
    for img in list(bpy.data.images):
        if img.name not in used:
            bpy.data.images.remove(img)
        elif img.size[0] > 512:
            img.scale(512, max(1, int(512 * img.size[1] / img.size[0])))
    # exactly one colour layer per mesh: the painted "Color" (the base body also carries a white one the exporter
    # would write first as COLOR_0, which three.js uses)
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        me = ob.data
        for ca in list(me.color_attributes):
            if ca.name != "Color":
                me.color_attributes.remove(ca)
        keep = me.color_attributes.get("Color")
        if keep:
            me.color_attributes.active_color = keep
            me.color_attributes.render_color_index = me.color_attributes.active_color_index
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, f"{name}.glb")
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", export_yup=True, export_animations=False, export_skins=True,
        export_morph=False, export_materials="EXPORT", export_image_format="AUTO",
        export_vertex_color="ACTIVE", export_meshopt_compression_enable=False, export_def_bones=False,
        export_cameras=False, export_lights=False,
    )
    print(f"[cast] wrote {name}.glb ({os.path.getsize(out) // 1024} KB, {tris} tris)")
    if RENDER:
        render_preview(arm, name)
    return out


def render_preview(arm, name):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = 600, 900
    sc.view_settings.view_transform = "AgX"
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.75, 0.62, 0.52, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    sun = bpy.data.objects.new("s", bpy.data.lights.new("s", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(55), 0, math.radians(30))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("c", bpy.data.cameras.new("c"))
    cam.data.lens = 55
    sc.collection.objects.link(cam)
    sc.camera = cam
    for label, ang in (("front", 180), ("back", 0), ("three-quarter", 145)):
        a = math.radians(ang)
        pos = Vector((math.sin(a) * 4.0, math.cos(a) * 4.0, 1.25))
        cam.location = pos
        cam.rotation_euler = (Vector((0, 0, 1.0)) - pos).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = os.path.join(RENDER, f"{name}-{label}.png")
        bpy.ops.render.render(write_still=True)


def build_pug():
    tb.reset()
    bpy.ops.import_scene.fbx(filepath=PUG)
    arm = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
    # the pack's units are centimetre-ish; a handbag pug is about 30 cm tall
    h = max(o.dimensions.z for o in bpy.data.objects if o.type == "MESH")
    s = 0.34 / h
    arm.scale = (arm.scale.x * s, arm.scale.y * s, arm.scale.z * s)
    bpy.context.view_layer.update()
    for a in bpy.data.actions:
        a.name = a.name.split("|")[-1]
        a.use_fake_user = True
    for mname, hexc in (("Beige", "#d9b98a"), ("Brown", "#2a1f1a")):
        m = bpy.data.materials.get(mname)
        if m and m.node_tree:
            p = m.node_tree.nodes.get("Principled BSDF")
            p.inputs["Base Color"].default_value = (*lin(hexc), 1)
            p.inputs["Roughness"].default_value = 0.8
    out = os.path.join(OUT, "pug.glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_yup=True, export_animations=True,
                              export_animation_mode="ACTIONS", export_skins=True, export_apply=False,
                              export_force_sampling=True, export_cameras=False, export_lights=False)
    print(f"[cast] wrote pug.glb ({os.path.getsize(out) // 1024} KB) actions {[a.name for a in bpy.data.actions]}")


def build_anims():
    tb.reset()
    keep = set(CLIPS_1 + CLIPS_2)
    bpy.ops.import_scene.gltf(filepath=UAL1)
    arm1 = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
    for ob in list(bpy.data.objects):
        if ob.type != "ARMATURE":
            bpy.data.objects.remove(ob)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=UAL2)
    for ob in [o for o in bpy.data.objects if o not in before]:
        bpy.data.objects.remove(ob)
    for action in list(bpy.data.actions):
        if action.name not in keep:
            bpy.data.actions.remove(action)
    missing = sorted(keep - {a.name for a in bpy.data.actions})
    if missing:
        raise SystemExit(f"missing clips {missing}")
    for action in bpy.data.actions:
        action.use_fake_user = True
    out = os.path.join(OUT, "anims.glb")
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", export_yup=True, export_animations=True, export_animation_mode="ACTIONS",
        export_skins=True, export_morph=False, export_cameras=False, export_lights=False, export_apply=False,
        export_force_sampling=True, export_optimize_animation_size=True, export_def_bones=False, export_leaf_bone=False,
    )
    print(f"[cast] wrote anims.glb ({os.path.getsize(out) // 1024} KB) {sorted(a.name for a in bpy.data.actions)}")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    if RENDER:
        os.makedirs(RENDER, exist_ok=True)
    only = ARGV[ARGV.index("--only") + 1].split(",") if "--only" in ARGV else None

    def want(n):
        return only is None or n in only

    if want("heroine"):
        person("heroine", False, {"skin": "#d9a585", "top": "#2c7c84", "tee": "#efe5d2", "legs": "#3a3940", "shoes": "#6b4228",
                                  "hair": "#2a1a12", "pack": "#a87445", "pack_dark": "#6e4526"},
               hair_file="Hair_Buns.gltf", open_front=True, glasses="#4a2c1b", backpack=True, sunglasses=True)
    if want("sterling"):
        person("sterling", True, {"skin": "#e3b896", "top": "#2a3e6e", "legs": "#151419", "shoes": "#0d0c0f", "hair": "#8d8d93",
                                  "gloves": "#f7f5ef"},
               hair_file="Hair_SimpleParted.gltf", coat_to=0.58, gloves=True, hat="tophat")
    if want("influencer_a"):
        person("influencer_a", False, {"skin": "#f0c7a8", "top": "#f4a7c0", "legs": "#f4a7c0", "shoes": "#fbfbf8", "hair": "#efd7a0"},
               hair_file="Hair_Long.gltf", decimate=7000)
    if want("influencer_b"):
        person("influencer_b", True, {"skin": "#a8714f", "top": "#f7f4ec", "legs": "#d8c6a3", "shoes": "#6b4228", "hair": "#e9d39a"},
               hair_file="Hair_SimpleParted.gltf", decimate=7000)
    if want("influencer_c"):
        person("influencer_c", False, {"skin": "#8a5a3c", "top": "#b7e05a", "legs": "#b7e05a", "shoes": "#fbfbf8", "hair": "#1d1410"},
               hair_file="Hair_Long.gltf", decimate=7000)
    if want("barista"):
        person("barista", False, {"skin": "#d9a27e", "top": "#f2ead8", "legs": "#3d4d6b", "shoes": "#2c2a2a", "hair": "#6e3b22",
                                  "apron": "#e98aa5"},
               hair_file="Hair_Buns.gltf", apron=True, decimate=7000)
    # Biscotti the pug is built in the runtime (beverlyHillsRuntime.ts); the CC0 Farm Animals pug's FBX skin did
    # not survive the conversion. build_pug() is kept for reference and is not run.
    if want("anims"):
        build_anims()
