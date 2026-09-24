"""Coastal Market proof: boats + plants (Blender 5.2, headless).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python scripts/assets/coastal-proof/build_props.py -- [--sources ~/Desktop/coastal-proof-sources]

Output: client/public/assets/goldline/coastal-market-three-proof/props.glb with one root node per prop:

    ship      Poly Haven ship_pinnace (CC0), decimated hard for a distant silhouette in the glitter path
    skiff     a 5 m rowing boat built here
    sailboat  a 9 m single-mast lateen boat built here (sail carries _WIND for flutter)
    fern      Poly Haven fern_02 (CC0), decimated
    shrub     Poly Haven shrub_sorrel_01 (CC0), decimated
    grass     Poly Haven grass_bermuda_01 (CC0)

Every prop sits with its origin at its base / waterline, +Y forward in three (Blender -Y).
"""

import bmesh
import bpy
import math
import os
import sys

from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT_DIR = os.path.join(REPO, "client", "public", "assets", "goldline", "coastal-market-three-proof")
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SRC = os.path.expanduser(argv[argv.index("--sources") + 1]) if "--sources" in argv else os.path.expanduser("~/Desktop/coastal-proof-sources")
PH = os.path.join(SRC, "polyhaven", "models")


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_ph(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(PH, name, f"{name}_1k.gltf"))
    return [o for o in bpy.data.objects if o not in before]


def join_under(name, obs):
    others = [o.name for o in obs if o.type != "MESH"]
    meshes = [o for o in obs if o.type == "MESH"]
    for o in bpy.data.objects:
        o.select_set(False)
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    # bake parent transforms into the meshes, then join
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    for other in others:
        if other in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[other])
    return ob


def decimate(ob, ratio):
    mod = ob.modifiers.new("dec", "DECIMATE")
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)


def ground(ob, z_to=0.0):
    zmin = min((ob.matrix_world @ v.co).z for v in ob.data.vertices)
    ob.location.z += z_to - zmin
    bpy.context.view_layer.objects.active = ob
    for o in bpy.data.objects:
        o.select_set(o is ob)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def color_material(name, rgb, rough=0.85):
    m = bpy.data.materials.new(name)
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = rough
    return m


def loft(bm, sections):
    """sections: list of rings (lists of Vector); consecutive rings are joined with quads."""
    rings = [[bm.verts.new(p) for p in ring] for ring in sections]
    for a, b in zip(rings, rings[1:]):
        for i in range(len(a) - 1):
            bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    return rings


def hull(length, beam, depth, sheer=0.25, n=14):
    """Clinker-ish open hull: U cross-sections along X (bow at +X), waterline z=0."""
    bm = bmesh.new()
    sections = []
    for i in range(n + 1):
        t = i / n
        x = (t - 0.5) * length
        # beam: full amidships, fine at both ends (the bow finer)
        w = beam * 0.5 * (math.sin(math.pi * t) ** (0.55 if t > 0.5 else 0.8))
        w = max(w, 0.02)
        top = depth * 0.75 + sheer * (2 * abs(t - 0.5)) ** 2
        keel = -depth * 0.25 * (math.sin(math.pi * t) ** 0.4)
        ring = []
        for k in range(9):
            a = math.pi * k / 8  # 0 = port gunwale, pi = starboard gunwale
            y = -math.cos(a) * w
            z = top - (top - keel) * math.sin(a) ** 1.3
            ring.append(Vector((x, y, z)))
        sections.append(ring)
    loft(bm, sections)
    return bm


def mesh_from_bm(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = False
    return ob


def box(bm, center, size):
    res = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=res["verts"])
    bmesh.ops.translate(bm, vec=Vector(center), verts=res["verts"])


def cyl(bm, base, radius, height, seg=6, tilt=None):
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=radius, radius2=radius * 0.8, depth=height)
    bmesh.ops.translate(bm, vec=Vector((0, 0, height / 2)), verts=res["verts"])
    if tilt is not None:
        bmesh.ops.rotate(bm, cent=Vector((0, 0, 0)), matrix=tilt, verts=res["verts"])
    bmesh.ops.translate(bm, vec=Vector(base), verts=res["verts"])


def build_skiff():
    wood = color_material("boat_wood", (0.36, 0.22, 0.12))
    dark = color_material("boat_dark", (0.12, 0.08, 0.05))
    hb = hull(5.0, 1.55, 0.75)
    h = mesh_from_bm("skiff_hull", hb, wood)
    bm = bmesh.new()
    for x in (-1.0, 0.2, 1.3):
        box(bm, (x, 0, 0.32), (0.25, 1.35, 0.06))
    box(bm, (0, 0, -0.1), (4.2, 0.9, 0.04))  # floorboards
    # oars resting across the thwarts
    for side in (-1, 1):
        cyl(bm, (-1.8, side * 0.45, 0.4), 0.03, 3.4, tilt=Matrix.Rotation(math.radians(88), 3, "Y") @ Matrix.Rotation(math.radians(side * 4), 3, "Z"))
    d = mesh_from_bm("skiff_parts", bm, dark)
    return join_under("skiff", [h, d])


def build_sailboat():
    wood = color_material("boat_wood", (0.36, 0.22, 0.12))
    dark = color_material("boat_dark", (0.12, 0.08, 0.05))
    sail_m = color_material("sail", (0.78, 0.66, 0.5), rough=0.95)
    hb = hull(9.0, 2.6, 1.3, sheer=0.45, n=18)
    h = mesh_from_bm("sb_hull", hb, wood)
    bm = bmesh.new()
    box(bm, (0, 0, 0.5), (6.6, 2.1, 0.08))  # deck
    box(bm, (-2.8, 0, 0.9), (1.6, 1.4, 0.7))  # small aft cabin
    cyl(bm, (0.8, 0, 0.5), 0.1, 8.0, seg=8)  # mast
    # yard for the lateen sail, slanting fore-and-aft
    cyl(bm, (-2.4, 0, 3.0), 0.06, 7.5, seg=6, tilt=Matrix.Rotation(math.radians(-68), 3, "Y"))
    d = mesh_from_bm("sb_parts", bm, dark)
    # triangular lateen sail: yard edge from (-2.4, 3.0) to (4.5, 5.8), foot to the deck
    sm = bpy.data.meshes.new("sb_sail")
    sbm = bmesh.new()
    wind = sbm.verts.layers.float.new("_WIND")
    a, b, c = Vector((-2.2, 0.05, 3.1)), Vector((4.3, 0.05, 5.7)), Vector((0.9, 0.05, 0.95))
    rows = 6
    grid = []
    for r in range(rows + 1):
        t = r / rows
        n = rows - r + 1
        row = []
        for k in range(n):
            u = k / (n - 1) if n > 1 else 0.5
            p = a.lerp(b, u).lerp(c, t)
            belly = math.sin(math.pi * t) * math.sin(math.pi * u) * 0.5
            v = sbm.verts.new(p + Vector((0, belly, 0)))
            v[wind] = 0.15 + 0.85 * math.sin(math.pi * t) * (0.5 + 0.5 * math.sin(math.pi * u))
            row.append(v)
        grid.append(row)
    for r in range(rows):
        top, bot = grid[r], grid[r + 1]
        for k in range(len(top) - 1):
            sbm.faces.new((top[k], top[k + 1], bot[k]))
        for k in range(len(bot) - 1):
            sbm.faces.new((top[k + 1], bot[k + 1], bot[k]))
    sbm.to_mesh(sm)
    sbm.free()
    sm.materials.append(sail_m)
    s = bpy.data.objects.new("sb_sail", sm)
    bpy.context.scene.collection.objects.link(s)
    return [join_under("sailboat", [h, d]), s]


def build_ship():
    obs = import_ph("ship_pinnace")
    ship = join_under("ship", obs)
    before = tris(ship)
    decimate(ship, 5200 / before)
    # the pinnace model is ~40 m long along Y; point it along X like the other boats
    ship.rotation_euler = (0, 0, math.radians(90))
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    # sit the hull at the waterline: a quarter of its draught below zero
    zmin = min(v.co.z for v in ship.data.vertices)
    ship.location.z = -zmin - 2.2
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    print(f"[props] ship {before} -> {tris(ship)} tris")
    return ship


def build_plant(name, target_tris):
    obs = import_ph(name)
    ob = join_under(name.split("_")[0], obs)
    before = tris(ob)
    if before > target_tris:
        decimate(ob, target_tris / before)
    ground(ob)
    print(f"[props] {ob.name} {before} -> {tris(ob)} tris")
    return ob


def main():
    reset()
    roots = {}
    roots["skiff"] = [build_skiff()]
    roots["sailboat"] = build_sailboat()
    roots["ship"] = [build_ship()]
    roots["fern"] = [build_plant("fern_02", 1100)]
    roots["shrub"] = [build_plant("shrub_sorrel_01", 900)]
    roots["grass"] = [build_plant("grass_bermuda_01", 1000)]
    # one empty per prop, meshes parented under it, laid out apart so nothing overlaps
    for i, (name, obs) in enumerate(roots.items()):
        root = bpy.data.objects.new(f"PROP_{name}", None)
        bpy.context.scene.collection.objects.link(root)
        for ob in obs:
            ob.parent = root
    for img in bpy.data.images:
        if img.size[0] > 512:
            img.scale(512, 512)
    out = os.path.join(OUT_DIR, "props.glb")
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", export_yup=True, export_animations=False, export_materials="EXPORT",
        export_image_format="WEBP", export_image_quality=80, export_attributes=True,
        export_meshopt_compression_enable=True, export_cameras=False, export_lights=False,
    )
    print(f"[props] wrote {os.path.relpath(out, REPO)} ({os.path.getsize(out) // 1024} KB)")


main()
