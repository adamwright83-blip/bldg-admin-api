"""Silver Lake cozy hero: the male adventurer (Blender 5.2, headless).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python scripts/assets/silver-lake/build_cozy_hero.py -- [--kits DIR] [--render OUT_DIR]

Built on the CC0 KayKit Adventurers "Ranger" (Rig_Medium) and animated with the CC0 KayKit Character
Animations on the same rig, so no retargeting. Restyled toward the 2026-10-19 hero mockup:

- green scarf (was blue), no cape, no quiver
- worn brown jacket over an olive shirt (was a cream tunic), brass buckles
- darker chestnut hair, no moustache or goatee
- dark brown trousers with a patch on the left thigh, dark boots
- crossbody leather strap from his LEFT shoulder to a satchel on his RIGHT hip

Lantern City is a cozy game: nothing here comes from the Coastal Market proof's art.
The character faces -Y in Blender (+Z in three.js); his right is -X.

Output: client/public/assets/goldline/silver-lake-3d/hero/adventurer.glb (+ the atlas embedded).
"""

import bmesh
import bpy
import math
import os
import sys

from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT_DIR = os.path.join(REPO, "client", "public", "assets", "goldline", "silver-lake-3d", "hero")
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default


KITS = os.path.expanduser(arg("--kits", "~/Desktop/lantern-city-commercial-game/lantern-kit-sources"))
RENDER = arg("--render")
ADV = os.path.join(KITS, "kaykit_adventurers", "KayKit_Adventurers_2.0_FREE")
ANIMS = os.path.join(KITS, "kaykit_character_animations", "KayKit_Character_Animations_1.1", "Animations", "gltf", "Rig_Medium")

CLIPS = {
    "Rig_Medium_MovementBasic.glb": ["Walking_A", "Walking_B", "Running_A", "Jump_Start", "Jump_Idle", "Jump_Land", "Jump_Full_Short"],
    "Rig_Medium_General.glb": ["Idle_A", "Idle_B", "Interact", "PickUp", "Use_Item"],
    "Rig_Medium_Simulation.glb": ["Waving", "Cheering", "Sit_Chair_Down", "Sit_Chair_Idle", "Sit_Chair_StandUp", "Sit_Floor_Idle"],
}

# ---------------------------------------------------------------- palette
# The atlas is 8 x 4 swatches (128 x 256 px), each a vertical light-to-dark gradient.
# (col, row) with row 0 at the TOP of the image. Row 3 is free once the helper sphere is gone.
SW = 8, 4


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


REPAINT = {
    (0, 1): "#7f9a5a",  # scarf: sage green
    (6, 0): "#b08452",  # jacket: worn tan leather (sleeves share this swatch)
    (5, 0): "#b08452",  # jacket
    (7, 0): "#5c3b25",  # belt, shoulder leather: dark
    (7, 2): "#6b4630",  # bracers
    (7, 1): "#4f4a3a",  # trousers: dark olive brown
    (3, 2): "#3f2a1d",  # boots
    (1, 0): "#4a2c1b",  # hair: dark chestnut
    (3, 0): "#d2a75a",  # buckles: brass
}
NEW = {
    "shirt": ((1, 3), "#6c7f47"),
    "satchel": ((0, 3), "#8f5d33"),
    "patch": ((2, 3), "#8a7a52"),
    "strap": ((3, 3), "#6a4428"),
}


def paint_atlas(src_path, dst_path):
    img = bpy.data.images.load(src_path)
    w, h = img.size
    px = list(img.pixels)
    sw, sh = w // SW[0], h // SW[1]

    def fill(col, row, rgb):
        y0 = h - sh * (row + 1)  # blender images start at the bottom
        for y in range(y0, y0 + sh):
            t = (y - y0) / (sh - 1)  # 0 bottom .. 1 top
            k = 0.70 + 0.45 * t
            c = [min(1.0, ch * k) for ch in rgb]
            for x in range(col * sw, (col + 1) * sw):
                i = (y * w + x) * 4
                px[i:i + 3] = c
                px[i + 3] = 1.0

    for (c, r), hx in REPAINT.items():
        fill(c, r, hexrgb(hx))
    for (c, r), hx in NEW.values():
        fill(c, r, hexrgb(hx))
    out = bpy.data.images.new("adventurer_atlas", w, h)
    out.pixels = px
    out.filepath_raw = dst_path
    out.file_format = "PNG"
    out.save()
    return out


def swatch_of(u, v):
    return min(SW[0] - 1, int(u * SW[0])), min(SW[1] - 1, int((1 - v) * SW[1]))


def move_to_swatch(uvs, loop_indices, dst):
    """Shift a face's UVs into swatch `dst`, keeping its place on the gradient."""
    us = [uvs[i].uv[0] for i in loop_indices]
    vs = [uvs[i].uv[1] for i in loop_indices]
    src = swatch_of(sum(us) / len(us), sum(vs) / len(vs))
    du = (dst[0] - src[0]) / SW[0]
    dv = (src[1] - dst[1]) / SW[1]
    for i in loop_indices:
        uvs[i].uv = (uvs[i].uv[0] + du, uvs[i].uv[1] + dv)


def swatch_uv(col, row, t=0.5):
    """UV in the middle of a swatch; t = 0 bottom (dark) .. 1 top (light)."""
    return ((col + 0.5) / SW[0], 1 - (row + 1) / SW[1] + (0.06 + 0.88 * t) / SW[1])


# ---------------------------------------------------------------- helpers
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def world_verts(ob):
    m = ob.matrix_world
    return [m @ v.co for v in ob.data.vertices]


def build_skin_source(body):
    """KD tree over the body's rest-pose vertices, plus their weights by group name."""
    verts = world_verts(body)
    kd = KDTree(len(verts))
    for i, co in enumerate(verts):
        kd.insert(co, i)
    kd.balance()
    names = {g.index: g.name for g in body.vertex_groups}
    weights = [{names[g.group]: g.weight for g in v.groups if g.weight > 0} for v in body.data.vertices]
    return kd, weights


def skin_like(ob, arm, kd, weights, k=4, only=None):
    """Weights for a new mesh: inverse-distance blend of the k nearest body vertices."""
    for co_local in [v.co for v in ob.data.vertices]:
        pass
    groups = {}
    for v in ob.data.vertices:
        co = ob.matrix_world @ v.co
        acc = {}
        total = 0.0
        for (_, i, d) in kd.find_n(co, k):
            wgt = 1.0 / max(d, 1e-4)
            total += wgt
            for name, w in weights[i].items():
                if only and name not in only:
                    continue
                acc[name] = acc.get(name, 0.0) + w * wgt
        s = sum(acc.values()) or 1.0
        for name, w in acc.items():
            g = groups.get(name) or ob.vertex_groups.new(name=name)
            groups[name] = g
            g.add([v.index], w / s, "REPLACE")
    ob.parent = arm
    ob.matrix_parent_inverse = arm.matrix_world.inverted()
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = arm


def new_object(name, bm, mat, collection):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = False
    return ob


def set_uv(bm, uv_fn):
    layer = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for loop in f.loops:
            loop[layer].uv = uv_fn(loop.vert.co, f)


# ---------------------------------------------------------------- build
def build():
    reset()
    bpy.ops.import_scene.gltf(filepath=os.path.join(ADV, "Characters", "gltf", "Ranger.glb"))
    for name in ("Icosphere", "Ranger_Cape", "Ranger_Quiver"):
        if name in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[name])
    arm = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
    arm.name = "Adventurer"
    meshes = {o.name: o for o in bpy.data.objects if o.type == "MESH"}
    body, head = meshes["Ranger_Body"], meshes["Ranger_Head"]
    mat = body.data.materials[0]
    mat.name = "adventurer"

    atlas_path = os.path.join(OUT_DIR, "adventurer_atlas.png")
    os.makedirs(OUT_DIR, exist_ok=True)
    atlas = paint_atlas(os.path.join(ADV, "Textures", "ranger_texture.png"), atlas_path)
    for node in mat.node_tree.nodes:
        if node.type == "TEX_IMAGE":
            node.image = atlas

    report = {}

    # -- torso: an olive shirt shows down the open front of the jacket
    uvs = body.data.uv_layers.active.data
    mw = body.matrix_world
    n_shirt = 0
    for p in body.data.polygons:
        u = sum(uvs[i].uv[0] for i in p.loop_indices) / p.loop_total
        v = sum(uvs[i].uv[1] for i in p.loop_indices) / p.loop_total
        if swatch_of(u, v) not in ((5, 0), (6, 0)):
            continue
        c = mw @ p.center
        if c.y < -0.05 and abs(c.x) < 0.16 and 0.68 < c.z < 1.22:
            move_to_swatch(uvs, p.loop_indices, NEW["shirt"][0])
            n_shirt += 1
    report["shirt_faces"] = n_shirt

    # -- a patch on the left thigh (his left is +X)
    leg = meshes["Ranger_LegLeft"]
    luv = leg.data.uv_layers.active.data
    n_patch = 0
    for p in leg.data.polygons:
        c = leg.matrix_world @ p.center
        u = sum(luv[i].uv[0] for i in p.loop_indices) / p.loop_total
        v = sum(luv[i].uv[1] for i in p.loop_indices) / p.loop_total
        if swatch_of(u, v) == (7, 1) and c.y < -0.04 and 0.36 < c.z < 0.47:
            move_to_swatch(luv, p.loop_indices, NEW["patch"][0])
            n_patch += 1
    report["patch_faces"] = n_patch

    # -- clean-shaven: remove hair-swatch islands below the nose on the front of the face
    bm = bmesh.new()
    bm.from_mesh(head.data)
    uvl = bm.loops.layers.uv.active
    hm = head.matrix_world

    def is_hair(f):
        u = sum(l[uvl].uv[0] for l in f.loops) / len(f.loops)
        v = sum(l[uvl].uv[1] for l in f.loops) / len(f.loops)
        return swatch_of(u, v) == (1, 0)

    hair = {f for f in bm.faces if is_hair(f)}
    seen, islands = set(), []
    for f in hair:
        if f in seen:
            continue
        stack, isl = [f], []
        seen.add(f)
        while stack:
            g = stack.pop()
            isl.append(g)
            for e in g.edges:
                for n in e.link_faces:
                    if n in hair and n not in seen:
                        seen.add(n)
                        stack.append(n)
        islands.append(isl)
    removed_faces, recoloured = 0, 0
    kill = []
    cut = []
    for isl in islands:
        cen = sum((hm @ f.calc_center_median() for f in isl), Vector()) / len(isl)
        zmax = max((hm @ v.co).z for f in isl for v in f.verts)
        if cen.y < -0.3 and abs(cen.x) < 0.3 and zmax < 1.6:
            shell = {v for f in isl for v in f.verts}
            closed = all(all(lf in isl for lf in v.link_faces) for v in shell)
            if closed:
                kill.extend(isl)
                removed_faces += len(isl)
            else:
                isl_set = set(isl)
                rim = {e for f in isl for e in f.edges if any(lf not in isl_set for lf in e.link_faces)}
                cut.append((isl, rim))
                recoloured += len(isl)
    # kinder brows: level each brow so its inner end no longer dips toward the nose
    hinv = hm.inverted()
    brows = 0
    for isl in islands:
        if any(f in kill for f in isl):
            continue
        pts = [hm @ v.co for f in isl for v in f.verts]
        cen = sum(pts, Vector()) / len(pts)
        if not (cen.y < -0.3 and 1.6 < cen.z < 1.9 and 0.04 < abs(cen.x) < 0.42 and len(isl) < 120):
            continue
        inner_pt = min(pts, key=lambda q: abs(q.x))
        outer_pt = max(pts, key=lambda q: abs(q.x))
        dx = abs(outer_pt.x) - abs(inner_pt.x)
        if dx < 1e-3:
            continue
        cur = math.atan2(inner_pt.z - outer_pt.z, dx)  # negative = inner end lower (angry)
        target = math.radians(6)
        ang = target - cur
        side = 1 if cen.x > 0 else -1
        rot = Matrix.Rotation(side * ang, 4, "Y")
        for v in {v for f in isl for v in f.verts}:
            w = hm @ v.co
            v.co = hinv @ (cen + rot @ (w - cen))
        brows += 1
    report["brows_levelled"] = brows
    for isl, rim in cut:
        bmesh.ops.delete(bm, geom=list(set(isl)), context="FACES_ONLY")
        rim = [e for e in rim if e.is_valid]
        filled = bmesh.ops.holes_fill(bm, edges=rim, sides=0)["faces"]
        bmesh.ops.recalc_face_normals(bm, faces=filled)
        u0, v0 = swatch_uv(0, 0, 0.55)
        for f in filled:
            for l in f.loops:
                l[uvl].uv = (u0, v0)
        loose = [e for e in bm.edges if not e.link_faces]
        bmesh.ops.delete(bm, geom=loose, context="EDGES")
    if kill:
        bmesh.ops.delete(bm, geom=list(set(kill)), context="FACES")
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(head.data)
    bm.free()
    report["beard_faces_removed"] = removed_faces
    report["beard_faces_recoloured"] = recoloured

    # -- crossbody strap: a band hugging the torso from his left shoulder to his right hip
    kd, weights = build_skin_source(body)
    bvh = BVHTree.FromPolygons(world_verts(body), [tuple(p.vertices) for p in body.data.polygons])
    bverts = world_verts(body)
    hip_band = [co for co in bverts if 0.45 < co.z < 0.62 and co.x < 0]
    hip_x = min(co.x for co in hip_band)
    shoulder = Vector((0.26, 0.0, 1.30))
    hip = Vector((hip_x + 0.06, -0.02, 0.56))
    centre = (shoulder + hip) / 2
    ua = (shoulder - hip)
    a = ua.length / 2
    ua.normalize()
    va = Vector((0, 1, 0))
    ring = []
    N = 48
    for i in range(N):
        t = 2 * math.pi * i / N
        p = centre + ua * (a * 1.05 * math.cos(t)) + va * (0.55 * math.sin(t))
        loc, nrm, _, _ = bvh.find_nearest(p)
        ring.append((loc + nrm * 0.028, nrm.normalized()))
    bm = bmesh.new()
    rows = []
    W, T = 0.075, 0.022
    for i, (p, n) in enumerate(ring):
        tan = (ring[(i + 1) % N][0] - ring[i - 1][0]).normalized()
        side = tan.cross(n).normalized()
        quad = [p + side * W / 2, p - side * W / 2, p - side * W / 2 - n * T, p + side * W / 2 - n * T]
        rows.append([bm.verts.new(q) for q in quad])
    for i in range(N):
        r0, r1 = rows[i], rows[(i + 1) % N]
        for j in range(4):
            bm.faces.new((r0[j], r1[j], r1[(j + 1) % 4], r0[(j + 1) % 4]))
    sc, sr = NEW["strap"][0]
    set_uv(bm, lambda co, f: swatch_uv(sc, sr, 0.55))
    strap = new_object("Adventurer_Strap", bm, mat, body.users_collection[0])
    skin_like(strap, arm, kd, weights)

    # -- satchel on his right hip, rigid with the hips
    bm = bmesh.new()
    bag_w, bag_d, bag_h = 0.17, 0.42, 0.36
    back_y = max(co.y for co in bverts if 0.45 < co.z < 0.62)
    cx = hip_x + 0.20
    cy, cz = back_y + 0.07, 0.56
    geom = bmesh.ops.create_cube(bm, size=1.0)["verts"]
    bmesh.ops.scale(bm, vec=(bag_d, bag_w, bag_h), verts=geom)
    bmesh.ops.translate(bm, vec=(cx, cy, cz), verts=geom)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.035, segments=3, affect="EDGES", profile=0.5)
    flap = bmesh.ops.create_cube(bm, size=1.0)["verts"]
    bmesh.ops.scale(bm, vec=(bag_d * 1.04, bag_w * 0.5, bag_h * 0.52), verts=flap)
    bmesh.ops.translate(bm, vec=(cx, cy + bag_w * 0.32, cz + bag_h * 0.26), verts=flap)
    buckle = bmesh.ops.create_cube(bm, size=1.0)["verts"]
    bmesh.ops.scale(bm, vec=(0.07, 0.02, 0.06), verts=buckle)
    bmesh.ops.translate(bm, vec=(cx, cy + bag_w * 0.58 + 0.005, cz + 0.01), verts=buckle)
    flap_set, buckle_set = set(flap), set(buckle)
    sat = NEW["satchel"][0]
    zlo, zhi = cz - bag_h / 2, cz + bag_h / 2

    def bag_uv(co, f):
        if all(v in buckle_set for v in f.verts):
            return swatch_uv(3, 0, 0.6)
        t = (co.z - zlo) / (zhi - zlo)
        if all(v in flap_set for v in f.verts):
            return swatch_uv(sc, sr, 0.35 + 0.5 * t)
        return swatch_uv(sat[0], sat[1], 0.25 + 0.6 * t)

    set_uv(bm, bag_uv)
    bag = new_object("Adventurer_Satchel", bm, mat, body.users_collection[0])
    skin_like(bag, arm, kd, weights, only={"hips"})
    if not bag.vertex_groups:
        g = bag.vertex_groups.new(name="hips")
        g.add([v.index for v in bag.data.vertices], 1.0, "REPLACE")

    for o in list(meshes.values()):
        o.name = o.name.replace("Ranger_", "Adventurer_")

    # -- animations: same Rig_Medium bone names, so actions bind without retargeting
    keep = []
    for f, names in CLIPS.items():
        before = set(bpy.data.objects)
        before_actions = set(bpy.data.actions)
        bpy.ops.import_scene.gltf(filepath=os.path.join(ANIMS, f))
        for act in set(bpy.data.actions) - before_actions:
            if act.name in names:
                act.use_fake_user = True
                keep.append(act)
            else:
                bpy.data.actions.remove(act)
        for o in set(bpy.data.objects) - before:
            bpy.data.objects.remove(o)
    ad = arm.animation_data or arm.animation_data_create()
    for act in sorted(keep, key=lambda a: a.name):
        track = ad.nla_tracks.new()
        track.name = act.name
        strip = track.strips.new(act.name, int(act.frame_range[0]), act)
        if hasattr(strip, "action_slot") and len(getattr(act, "slots", [])):
            strip.action_slot = act.slots[0]
        track.mute = True
    ad.action = None
    report["clips"] = [a.name for a in keep]
    report["hip_x"] = round(hip_x, 3)
    return arm, report


def export(arm):
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    for o in arm.children:
        o.select_set(True)
    path = os.path.join(OUT_DIR, "adventurer.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_apply=False,
        export_yup=True,
    )
    return path


# ---------------------------------------------------------------- render
def pose(arm, clip, frame):
    ad = arm.animation_data
    for t in ad.nla_tracks:
        t.mute = t.name != clip
    bpy.context.scene.frame_set(frame)


def render_views(arm, out_dir):
    sc = bpy.context.scene
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            sc.render.engine = eng
            break
        except TypeError:
            continue
    sc.render.resolution_x, sc.render.resolution_y = 900, 1100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Base Contrast" if "AgX - Base Contrast" in [i.identifier for i in sc.view_settings.bl_rna.properties["look"].enum_items] else "None"
    w = bpy.data.worlds.new("cozy")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.98, 0.90, 0.78, 1)
    bg.inputs[1].default_value = 0.9
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.2
    sun.data.color = (1.0, 0.92, 0.80)
    sun.data.angle = math.radians(12)
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    sc.collection.objects.link(sun)
    fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "SUN"))
    fill.data.energy = 0.9
    fill.data.color = (0.80, 0.88, 1.0)
    fill.rotation_euler = (math.radians(70), 0, math.radians(150))
    sc.collection.objects.link(fill)
    ground = bpy.data.meshes.new("ground")
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, radius=2.2, segments=48)
    bm.to_mesh(ground)
    bm.free()
    gm = bpy.data.materials.new("ground")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.62, 0.74, 0.42, 1)
    gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
    ground.materials.append(gm)
    sc.collection.objects.link(bpy.data.objects.new("ground", ground))
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 70
    sc.collection.objects.link(cam)
    sc.camera = cam
    target = Vector((0, 0, 1.12))
    shots = [("front", 0), ("three-quarter", 35), ("side", 90), ("back", 180), ("game-camera", 160)]
    files = []
    for clip, frame, tag in (("Idle_A", 6, "idle"), ("Walking_A", 8, "walk")):
        pose(arm, clip, frame)
        for label, yaw in shots:
            if tag == "walk" and label not in ("three-quarter", "game-camera"):
                continue
            r = math.radians(yaw)
            cam.location = target + Vector((math.sin(r) * -6.4 * -1, -math.cos(r) * 6.4, 0.55))
            d = target - cam.location
            cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
            sc.render.filepath = os.path.join(out_dir, f"hero-{tag}-{label}.png")
            bpy.ops.render.render(write_still=True)
            files.append(sc.render.filepath)
    return files


if __name__ == "__main__":
    arm, report = build()
    path = export(arm)
    report["glb"] = path
    report["glb_bytes"] = os.path.getsize(path)
    if RENDER:
        os.makedirs(RENDER, exist_ok=True)
        report["renders"] = render_views(arm, RENDER)
    import json
    print("HERO_REPORT " + json.dumps(report))
