"""The game board in the sky over Lantern City (Blender 5.2, headless).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python scripts/assets/lantern-city-sky-board/build_sky_track.py -- [--render OUT.png]

A closed loop of frosted-glass slabs, the way the home's concept draws it: bevelled slabs with a gap between each, a
glowing inner rim, raised gold icons on every other slab (star, sprout, people, bars; a compass on tonight's tile),
and crystal pylons along the outside edge. Every slab is its own group (tile_00, tile_01, ...) in order around the loop,
so the browser can drop them in one at a time. Unit scale: the loop's long radius is 1; the browser sizes it to the city.

Blender is Z-up; the glTF export is Y-up. Output: client/public/assets/goldline/home/board/sky-track.glb
"""

import bmesh
import bpy
import math
import os
import sys

from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(REPO, "client", "public", "assets", "goldline", "home", "board", "sky-track.glb")
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
RENDER = ARGV[ARGV.index("--render") + 1] if "--render" in ARGV else None

N = 16                 # slabs around the loop
A, B = 1.0, 0.62       # the loop's radii (an ellipse reads as a ring in perspective)
WIDTH = 0.26           # across the track
THICK = 0.085
GAP = 0.022            # along the track, between slabs
BEVEL = 0.028
ICONS = ["compass", None, "sprout", None, "people", None, "bars", None, "star", None, "sprout", None,
         "people", None, "bars", None]
GOLD_TILE = 0          # tonight's tile


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)


def mat(name, color, emit=None, strength=0.0, alpha=1.0, rough=0.2, transmission=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Alpha"].default_value = alpha
    if transmission:
        bsdf.inputs["Transmission Weight"].default_value = transmission
        bsdf.inputs["IOR"].default_value = 1.45
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    if alpha < 1.0:
        m.surface_render_method = "BLENDED"
    return m


def ellipse(t):
    return Vector((A * math.cos(t), B * math.sin(t), 0.0))


def tangent(t):
    return Vector((-A * math.sin(t), B * math.cos(t), 0.0)).normalized()


def normal(t):
    tg = tangent(t)
    return Vector((tg.y, -tg.x, 0.0))   # points outward


def arc_param(n=4000):
    """Parameter values that split the loop into N slabs of equal length."""
    ts = [2 * math.pi * k / n for k in range(n + 1)]
    lens = [0.0]
    for k in range(1, n + 1):
        lens.append(lens[-1] + (ellipse(ts[k]) - ellipse(ts[k - 1])).length)
    total = lens[-1]

    def at(frac):
        target = frac * total
        lo, hi = 0, n
        while lo < hi:
            mid = (lo + hi) // 2
            if lens[mid] < target:
                lo = mid + 1
            else:
                hi = mid
        return ts[lo]

    return at, total


def link(obj, coll):
    coll.objects.link(obj)
    return obj


def mesh_from_bm(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return bpy.data.objects.new(name, me)


def slab_outline(t0, t1, inset=0.0, steps=8):
    """The slab's top outline (outer edge forward, inner edge back), optionally inset."""
    pts_out, pts_in = [], []
    for i in range(steps + 1):
        t = t0 + (t1 - t0) * i / steps
        c, n = ellipse(t), normal(t)
        pts_out.append(c + n * (WIDTH / 2 - inset))
        pts_in.append(c - n * (WIDTH / 2 - inset))
    # pull the ends in along the track by the inset
    if inset:
        for pts in (pts_out, pts_in):
            pts[0] = pts[0] + tangent(t0) * inset
            pts[-1] = pts[-1] - tangent(t1) * inset
    return pts_out + list(reversed(pts_in))


def build_slab(name, t0, t1, centre):
    bm = bmesh.new()
    verts = [bm.verts.new(p - centre) for p in slab_outline(t0, t1)]
    face = bm.faces.new(verts)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    top = [v for v in ext["geom"] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=Vector((0, 0, THICK)), verts=top)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=BEVEL, segments=4, affect="EDGES", profile=0.55)
    return mesh_from_bm(name, bm)


def build_rim(name, t0, t1, centre, inset=0.034, band=0.005):
    """A thin glowing outline just above the slab's top face."""
    outer = slab_outline(t0, t1, inset=inset)
    inner = slab_outline(t0, t1, inset=inset + band)
    z = Vector((0, 0, THICK + 0.0015))
    bm = bmesh.new()
    vo = [bm.verts.new(p - centre + z) for p in outer]
    vi = [bm.verts.new(p - centre + z) for p in inner]
    n = len(vo)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([vo[i], vo[j], vi[j], vi[i]])
    return mesh_from_bm(name, bm)


def flat_shape(name, polys, height=0.009, holes=None):
    """Extrude one or more 2D polygons (lists of (x, y)) upward into a single mesh."""
    bm = bmesh.new()
    for poly in polys:
        vs = [bm.verts.new(Vector((x, y, 0))) for x, y in poly]
        f = bm.faces.new(vs)
        ext = bmesh.ops.extrude_face_region(bm, geom=[f])
        top = [v for v in ext["geom"] if isinstance(v, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, vec=Vector((0, 0, height)), verts=top)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bm(name, bm)


def circle(cx, cy, r, n=20):
    return [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def star_points(cx, cy, r_out, r_in, k=5, rot=math.pi / 2):
    pts = []
    for i in range(2 * k):
        r = r_out if i % 2 == 0 else r_in
        a = rot + math.pi * i / k
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def rect(cx, cy, w, h):
    return [(cx - w / 2, cy - h / 2), (cx + w / 2, cy - h / 2), (cx + w / 2, cy + h / 2), (cx - w / 2, cy + h / 2)]


def icon_polys(kind, s=0.05):
    if kind == "star":
        return [star_points(0, 0, s, s * 0.45)]
    if kind == "compass":
        ring_o, ring_i = circle(0, 0, s * 1.05, 32), circle(0, 0, s * 0.88, 32)
        return [star_points(0, 0, s * 0.8, s * 0.2, k=4, rot=0)], (ring_o, ring_i)
    if kind == "bars":
        return [rect(-s * 0.55, -s * 0.35, s * 0.32, s * 0.6), rect(0, -s * 0.15, s * 0.32, s), rect(s * 0.55, s * 0.1, s * 0.32, s * 1.5)]
    if kind == "people":
        out = []
        for dx, sc in ((-s * 0.62, 0.8), (0, 1.0), (s * 0.62, 0.8)):
            out.append(circle(dx, s * 0.32 * sc, s * 0.2 * sc, 16))
            body = [(dx + s * 0.32 * sc * math.cos(a), -s * 0.12 * sc + s * 0.32 * sc * math.sin(a)) for a in [math.pi * i / 12 for i in range(13)]]
            out.append(body + [(dx - s * 0.32 * sc, -s * 0.12 * sc)])
        return out
    if kind == "sprout":
        leaf_l = [(-s * 0.05, -s * 0.2)] + [(-s * 0.05 - s * 0.55 * math.sin(math.pi * i / 10), -s * 0.2 + s * 0.6 * i / 10) for i in range(11)]
        leaf_r = [(s * 0.05, -s * 0.05)] + [(s * 0.05 + s * 0.5 * math.sin(math.pi * i / 10), -s * 0.05 + s * 0.55 * i / 10) for i in range(11)]
        stem = rect(0, -s * 0.45, s * 0.1, s * 0.6)
        return [leaf_l, leaf_r, stem]
    return []


def ring_mesh(name, outer, inner, height=0.009):
    bm = bmesh.new()
    n = len(outer)
    vo = [bm.verts.new(Vector((x, y, 0))) for x, y in outer]
    vi = [bm.verts.new(Vector((x, y, 0))) for x, y in inner]
    faces = [bm.faces.new([vo[i], vo[(i + 1) % n], vi[(i + 1) % n], vi[i]]) for i in range(n)]
    ext = bmesh.ops.extrude_face_region(bm, geom=faces)
    top = [v for v in ext["geom"] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=Vector((0, 0, height)), verts=top)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bm(name, bm)


def crystal(name, size=0.026):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=0, radius=size)
    for v in bm.verts:
        v.co.z *= 2.6
    return mesh_from_bm(name, bm)


def build():
    reset()
    scene = bpy.context.scene
    coll = bpy.data.collections.new("SkyBoard")
    scene.collection.children.link(coll)

    glass = mat("glass", (0.78, 0.86, 1.0), emit=(0.55, 0.7, 1.0), strength=0.35, alpha=0.55, rough=0.18, transmission=0.6)
    gold_glass = mat("glass_gold", (1.0, 0.86, 0.55), emit=(1.0, 0.72, 0.3), strength=1.2, alpha=0.7, rough=0.2)
    rim = mat("rim", (0.85, 0.92, 1.0), emit=(0.7, 0.85, 1.0), strength=6.0)
    rim_gold = mat("rim_gold", (1.0, 0.9, 0.6), emit=(1.0, 0.78, 0.35), strength=8.0)
    icon = mat("icon", (1.0, 0.95, 0.86), emit=(1.0, 0.92, 0.75), strength=2.2, rough=0.3)
    crys = mat("crystal", (0.9, 0.95, 1.0), emit=(0.8, 0.9, 1.0), strength=3.0, alpha=0.75, rough=0.1)

    at, total = arc_param()
    gap_frac = GAP / total
    for i in range(N):
        f0 = i / N + gap_frac / 2
        f1 = (i + 1) / N - gap_frac / 2
        # start the loop at the front (the side nearest the viewer)
        t0, t1 = at(f0) - math.pi / 2, at(f1) - math.pi / 2
        tm = (t0 + t1) / 2
        centre = ellipse(tm)

        group = bpy.data.objects.new(f"tile_{i:02d}", None)
        group.location = centre
        link(group, coll)

        s = link(build_slab(f"slab_{i:02d}", t0, t1, centre), coll)
        s.parent = group
        s.data.materials.append(gold_glass if i == GOLD_TILE else glass)

        r = link(build_rim(f"rim_{i:02d}", t0, t1, centre), coll)
        r.parent = group
        r.data.materials.append(rim_gold if i == GOLD_TILE else rim)

        kind = ICONS[i % len(ICONS)]
        if kind:
            spec = icon_polys(kind, s=0.075 if kind != "compass" else 0.08)
            polys, ringpair = (spec if isinstance(spec, tuple) else (spec, None))
            ic = link(flat_shape(f"icon_{i:02d}_{kind}", polys), coll)
            ic.parent = group
            ic.location = Vector((0, 0, THICK + 0.001))
            # face the icon along the track
            ic.rotation_euler = (0, 0, math.atan2(tangent(tm).y, tangent(tm).x))
            ic.data.materials.append(icon)
            if ringpair:
                ring = link(ring_mesh(f"icon_{i:02d}_ring", *ringpair), coll)
                ring.parent = group
                ring.location = ic.location
                ring.data.materials.append(icon)

        if i % 2 == 1:
            c = link(crystal(f"crystal_{i:02d}"), coll)
            c.parent = group
            c.location = normal(tm) * (WIDTH / 2 + 0.05) + Vector((0, 0, 0.08))
            c.data.materials.append(crys)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_apply=True, export_extras=True)
    print(f"[sky-track] wrote {OUT} ({os.path.getsize(OUT) // 1024} KB, {N} tiles)")

    if RENDER:
        render_preview(scene, coll)


def render_preview(scene, coll):
    """A quick look in Blender (EEVEE): golden-hour sky, low camera. Not the product render, just a sanity check."""
    world = bpy.data.worlds.new("dusk")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.98, 0.72, 0.5, 1)
    bg.inputs["Strength"].default_value = 0.9
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.data.color = (1.0, 0.8, 0.6)
    sun.rotation_euler = (math.radians(60), 0, math.radians(-40))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 35
    cam.location = (0.2, -2.4, 0.75)
    direction = Vector((0, 0.1, 0)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1400, 700
    scene.render.filepath = RENDER
    bpy.ops.render.render(write_still=True)
    print(f"[sky-track] preview {RENDER}")


build()
