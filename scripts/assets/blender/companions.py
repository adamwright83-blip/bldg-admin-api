"""
GOLDLINE COMPANION PIPELINE — seven animal sidekicks, one rig.

Presentation-layer only. Names, personalities and the may/may-not contracts in
docs/goldline/REALITY_BRIDGE.md and server/companions/seedCompanions.ts are
untouched by this file; only visual form is decided here.

The whole point is that all seven come out of ONE camera, ONE light rig, ONE
palette and ONE pivot convention, so they read as a set. Species differ only in
their body plan. Silhouette is the design target: these appear in a HUD roster at
48px where shape is the only thing that survives.

Pivot: feet sit on z=0 and the camera frames a fixed box, so every render is
center_bottom in the same art space. That matches the registry convention taken
from buildingArt.ts.

    blender --background --factory-startup --python companions.py -- --out DIR [--only rook]
"""
import bpy, sys, os, math, argparse
from mathutils import Vector

# ----------------------------------------------------------------- palette
# Warm brass and teal, per the Goldline direction. No medieval/gothic anything.
P = {
    "brass":      (0.62, 0.44, 0.16, 1),
    "brass_dark": (0.34, 0.23, 0.09, 1),
    "teal":       (0.10, 0.34, 0.31, 1),
    "teal_light": (0.24, 0.55, 0.50, 1),
    "cream":      (0.93, 0.88, 0.74, 1),
    "charcoal":   (0.11, 0.11, 0.13, 1),
    "slate":      (0.28, 0.30, 0.34, 1),
    "rust":       (0.55, 0.24, 0.12, 1),
    "tan":        (0.72, 0.55, 0.33, 1),
    "bone":       (0.86, 0.80, 0.66, 1),
    "amber":      (0.90, 0.62, 0.13, 1),
    "ink":        (0.07, 0.08, 0.11, 1),
    "grey":       (0.45, 0.46, 0.48, 1),
    "white":      (0.88, 0.88, 0.86, 1),
    "brown":      (0.35, 0.22, 0.13, 1),
    "brown_light":(0.52, 0.35, 0.20, 1),
}

_mats = {}
def mat(name, rough=0.62, spec=0.3):
    """One material per palette colour, shared across every companion."""
    if name in _mats: return _mats[name]
    m = bpy.data.materials.new("gl_" + name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = P[name]
    b.inputs["Roughness"].default_value = rough
    if "Specular IOR Level" in b.inputs: b.inputs["Specular IOR Level"].default_value = spec
    _mats[name] = m
    return m

# ----------------------------------------------------------------- primitives
def _finish(o, color, smooth=True, subsurf=1):
    o.data.materials.append(mat(color))
    if subsurf:
        m = o.modifiers.new("s", "SUBSURF"); m.levels = subsurf; m.render_levels = subsurf
    if smooth:
        for p in o.data.polygons: p.use_smooth = True
    return o

def ball(loc, scale, color, smooth=True, subsurf=1):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=14, location=loc)
    o = bpy.context.active_object
    o.scale = scale
    return _finish(o, color, smooth, subsurf)

def box(loc, scale, color, rot=(0,0,0), subsurf=1, smooth=True):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = scale
    return _finish(o, color, smooth, subsurf)

def cone(loc, r, depth, color, rot=(0,0,0), r2=0.0):
    bpy.ops.mesh.primitive_cone_add(vertices=18, radius1=r, radius2=r2, depth=depth,
                                    location=loc, rotation=rot)
    return _finish(bpy.context.active_object, color, True, 0)

def cyl(loc, r, depth, color, rot=(0,0,0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=18, radius=r, depth=depth,
                                        location=loc, rotation=rot)
    return _finish(bpy.context.active_object, color, True, 0)

def eyes(y, z, spread, size=0.075):
    """Two dark eyes plus a cream catchlight. Reads as a face even in silhouette-adjacent light."""
    out = []
    for sx in (-1, 1):
        out.append(ball((sx*spread, y, z), (size, size*0.85, size), "ink", subsurf=1))
        out.append(ball((sx*spread + sx*0.018, y-0.035, z+0.025), (size*0.34,)*3, "cream", subsurf=1))
    return out

# ----------------------------------------------------------------- body plans
# Silhouette is the design target. The first pass differentiated species with
# surface detail — masks, satchels, goggles — and at 48px they all collapsed into
# the same egg with bumps. Differentiation here comes from PROPORTION and from
# parts that break the body outline. Feet touch z=0; each faces -Y.

def rook():
    """ROOK — corvid. Outreach messenger.
    Outline: the TALLEST and NARROWEST of the seven. Upright, hunched, long
    straight beak forward and a hard wedge tail back."""
    o = []
    o += [ball((0, 0.02, 0.78), (0.215, 0.205, 0.50), "ink")]               # tall narrow body
    o += [ball((0, 0.0, 1.32), (0.255, 0.24, 0.19), "charcoal")]            # hunched shoulders
    o += [ball((0, -0.06, 1.56), (0.175, 0.17, 0.165), "ink")]              # small head, high
    o += [cone((0, -0.40, 1.55), 0.072, 0.46, "slate", rot=(math.radians(-90),0,0))]  # long beak
    o += eyes(-0.16, 1.60, 0.078, 0.055)
    for sx in (-1, 1):                                                      # tight folded wings
        o += [box((sx*0.215, 0.04, 0.86), (0.075, 0.34, 0.66), "charcoal",
                  rot=(0, math.radians(sx*6), 0), subsurf=2)]
    o += [box((0, 0.40, 0.44), (0.155, 0.62, 0.05), "ink",                  # long wedge tail, low
              rot=(math.radians(38), 0, 0), subsurf=2)]
    o += [box((0.235, -0.02, 0.60), (0.155, 0.13, 0.20), "brass", subsurf=2)]  # satchel
    for sx in (-1, 1):
        o += [cyl((sx*0.085, 0.02, 0.16), 0.038, 0.34, "amber")]
        o += [box((sx*0.085, -0.06, 0.03), (0.11, 0.21, 0.05), "amber", subsurf=1)]
    return o

def eagle():
    """MARA — eagle. Aerial scout.
    Outline: the WIDEST of the seven by a wide margin. Wings held SPREAD, not
    folded — nothing else in the set breaks its outline horizontally."""
    o = []
    o += [ball((0, 0, 0.72), (0.30, 0.27, 0.40), "brown")]
    o += [ball((0, -0.04, 1.20), (0.215, 0.21, 0.20), "bone")]
    o += [cone((0, -0.34, 1.15), 0.088, 0.28, "amber", rot=(math.radians(-90),0,0))]
    o += [ball((0, -0.42, 1.08), (0.06, 0.085, 0.06), "amber")]
    o += [ball((0, -0.11, 1.33), (0.205, 0.175, 0.085), "brass_dark")]      # goggle band
    for sx in (-1, 1):
        o += [cyl((sx*0.115, -0.17, 1.31), 0.070, 0.085, "teal_light", rot=(math.radians(90),0,0))]
    o += eyes(-0.16, 1.17, 0.085, 0.058)
    # spread wings: three tapering segments each, reaching well past the body
    for sx in (-1, 1):
        o += [box((sx*0.40, 0.05, 1.00), (0.42, 0.30, 0.075), "brown",
                  rot=(math.radians(sx*-16), 0, 0), subsurf=2)]
        o += [box((sx*0.80, 0.09, 1.10), (0.42, 0.245, 0.055), "brown_light",
                  rot=(math.radians(sx*-22), 0, 0), subsurf=2)]
        for i in range(4):                                                  # primary feathers
            o += [box((sx*(1.02 + i*0.045), 0.20 + i*0.11, 1.06 - i*0.05),
                      (0.30, 0.075, 0.035), "brown",
                      rot=(0, 0, math.radians(sx*(6 + i*7))), subsurf=1)]
    o += [box((0, 0.36, 0.50), (0.22, 0.38, 0.05), "brown_light", rot=(math.radians(22),0,0), subsurf=2)]
    for sx in (-1, 1):
        o += [cyl((sx*0.115, 0.02, 0.17), 0.045, 0.36, "amber")]
        o += [box((sx*0.115, -0.07, 0.03), (0.13, 0.24, 0.055), "amber", subsurf=1)]
    return o

def hound():
    """SABLE — hound. Cannot forget; tracks promises.
    Outline: LOW horizontal quadruped with the head pushed down to the ground and
    the tail straight up. The nose-to-tail diagonal is the whole read."""
    o = []
    o += [ball((0, 0.16, 0.60), (0.25, 0.42, 0.25), "brown")]
    o += [ball((0, 0.40, 0.66), (0.255, 0.21, 0.255), "brown")]             # raised haunch
    o += [ball((0, -0.26, 0.34), (0.175, 0.17, 0.165), "brown_light")]      # head, very low
    o += [cone((0, -0.54, 0.22), 0.095, 0.36, "tan", rot=(math.radians(-108),0,0))]  # muzzle to floor
    o += [ball((0, -0.70, 0.13), (0.058,)*3, "ink")]
    for sx in (-1, 1):
        o += [box((sx*0.175, -0.24, 0.26), (0.05, 0.15, 0.36), "brown",
                  rot=(math.radians(-16), math.radians(sx*6), 0), subsurf=2)]
    o += eyes(-0.38, 0.42, 0.078, 0.055)
    o += [cyl((0, 0.56, 0.96), 0.036, 0.56, "brown_light", rot=(math.radians(-14),0,0))]  # tail straight up
    o += [ball((0, 0.60, 1.22), (0.055,)*3, "tan")]
    for sx in (-1, 1):
        o += [cyl((sx*0.165, -0.06, 0.22), 0.05, 0.44, "brown_light")]
        o += [cyl((sx*0.165, 0.38, 0.22), 0.054, 0.44, "brown_light")]
        for fy in (-0.06, 0.38):
            o += [ball((sx*0.165, fy-0.03, 0.04), (0.075, 0.10, 0.04), "tan", subsurf=1)]
    o += [cyl((0, -0.12, 0.50), 0.125, 0.065, "rust", rot=(math.radians(72),0,0))]
    return o

def bear():
    """BRONT — bear. Exchange and value.
    Outline: a near-SQUARE block. Widest biped, no neck, small head sunk between
    huge shoulders. Reads as mass where the others read as shape."""
    o = []
    o += [box((0, 0, 0.66), (0.86, 0.62, 1.10), "brown", subsurf=2)]        # blocky torso
    o += [ball((0, -0.22, 0.58), (0.30, 0.14, 0.36), "tan")]
    o += [ball((0, -0.04, 1.26), (0.235, 0.22, 0.205), "brown")]            # small head, sunk
    o += [ball((0, -0.24, 1.20), (0.135, 0.125, 0.10), "tan")]
    o += [ball((0, -0.34, 1.22), (0.052,)*3, "ink")]
    for sx in (-1, 1):
        o += [ball((sx*0.20, 0.0, 1.42), (0.088, 0.048, 0.088), "brown")]
        o += [ball((sx*0.20, -0.04, 1.42), (0.05, 0.03, 0.05), "rust")]
    o += eyes(-0.20, 1.30, 0.095, 0.052)
    for sx in (-1, 1):                                                      # heavy square arms
        o += [box((sx*0.52, -0.02, 0.72), (0.26, 0.30, 0.72), "brown", subsurf=2)]
        o += [ball((sx*0.54, -0.08, 0.40), (0.145, 0.15, 0.135), "brown_light")]
        o += [box((sx*0.20, 0.0, 0.14), (0.30, 0.34, 0.28), "brown", subsurf=2)]
        o += [ball((sx*0.20, -0.07, 0.04), (0.155, 0.21, 0.055), "tan", subsurf=1)]
    o += [box((0, 0.40, 0.94), (0.56, 0.26, 0.52), "rust", subsurf=2)]      # supply pack
    o += [box((0, 0.27, 0.94), (0.58, 0.03, 0.17), "brass_dark", subsurf=1)]
    return o

def owl():
    """ILEX — owl. Perceives patterns others miss.
    Outline: TOP-HEAVY. The head is wider than the body and takes most of the
    height. A circle sitting on a much smaller circle, plus two sharp tufts."""
    o = []
    o += [ball((0, 0, 0.42), (0.245, 0.225, 0.36), "slate")]                # small body
    o += [ball((0, -0.02, 1.02), (0.44, 0.34, 0.40), "grey")]               # oversized head
    o += [cyl((0, -0.30, 1.02), 0.375, 0.10, "bone", rot=(math.radians(90),0,0))]  # facial disc
    o += [cone((0, -0.40, 0.98), 0.062, 0.16, "amber", rot=(math.radians(-90),0,0))]
    for sx in (-1, 1):
        o += [cone((sx*0.315, 0.02, 1.46), 0.085, 0.38, "slate",            # tall sharp tufts
                   rot=(0, math.radians(sx*14), 0))]
        o += [cyl((sx*0.175, -0.355, 1.06), 0.135, 0.035, "amber", rot=(math.radians(90),0,0))]
        o += [ball((sx*0.175, -0.385, 1.06), (0.092, 0.05, 0.092), "ink", subsurf=1)]
        o += [ball((sx*0.195, -0.415, 1.10), (0.032,)*3, "cream", subsurf=1)]
    for sx in (-1, 1):
        o += [box((sx*0.235, 0.04, 0.44), (0.075, 0.30, 0.42), "grey",
                  rot=(0, math.radians(sx*9), 0), subsurf=2)]
    for sx in (-1, 1):
        o += [cyl((sx*0.10, 0.02, 0.12), 0.044, 0.26, "amber")]
        o += [box((sx*0.10, -0.055, 0.03), (0.125, 0.20, 0.05), "amber", subsurf=1)]
    return o

def raccoon():
    """LUMA — raccoon. Compulsively makes things.
    Outline: a small body under an ENORMOUS ringed tail that arcs up and over the
    head. The tail is taller than the animal and is the entire silhouette cue."""
    o = []
    o += [ball((0, 0.02, 0.50), (0.235, 0.215, 0.34), "grey")]              # small body
    o += [ball((0, -0.04, 0.90), (0.215, 0.20, 0.19), "grey")]
    o += [box((0, -0.19, 0.92), (0.34, 0.085, 0.145), "ink", subsurf=2)]    # bandit mask
    o += [cone((0, -0.30, 0.85), 0.075, 0.22, "grey", rot=(math.radians(-92),0,0))]
    o += [ball((0, -0.39, 0.84), (0.045,)*3, "ink")]
    for sx in (-1, 1):
        o += [ball((sx*0.165, 0.0, 1.07), (0.075, 0.04, 0.075), "grey")]
        o += [ball((sx*0.165, -0.045, 1.07), (0.042, 0.026, 0.042), "cream")]
        o += [ball((sx*0.088, -0.235, 0.92), (0.042, 0.032, 0.042), "cream", subsurf=1)]
        o += [ball((sx*0.088, -0.265, 0.92), (0.028, 0.024, 0.028), "ink", subsurf=1)]
    # the tail: an arc of banded segments sweeping from behind the hips up over the head
    for i in range(9):
        t = i / 8.0
        ang = math.radians(-52 + t * 190)          # sweeps back, up and forward
        rad = 0.62
        y = 0.30 + math.cos(ang) * rad * 0.80
        z = 0.52 + math.sin(ang) * rad
        o += [ball((0, y, z), (0.135 - t*0.035,)*3, "ink" if i % 2 else "cream")]
    for sx in (-1, 1):                                                      # busy raised hands
        o += [cyl((sx*0.27, -0.16, 0.64), 0.052, 0.30, "grey",
                  rot=(math.radians(-30), math.radians(sx*16), 0))]
        o += [ball((sx*0.30, -0.27, 0.78), (0.072, 0.072, 0.062), "ink")]
        o += [cyl((sx*0.10, 0.02, 0.13), 0.047, 0.28, "grey")]
        o += [ball((sx*0.10, -0.055, 0.035), (0.078, 0.105, 0.042), "ink", subsurf=1)]
    o += [cyl((0, 0, 0.34), 0.245, 0.07, "brass_dark", rot=(math.radians(90),0,0))]
    for sx in (-1, 1):
        o += [box((sx*0.22, -0.13, 0.30), (0.06, 0.06, 0.19), "brass", subsurf=1)]
    return o

def otter():
    """ORREN — otter. Navigates changing reality, not static maps.
    Outline: a long low S — front half sitting up, body running back along the
    ground, flat rudder tail trailing out behind. The longest shape in the set."""
    o = []
    o += [ball((0, 0.34, 0.28), (0.215, 0.46, 0.21), "brown_light")]        # long low hindquarters
    o += [ball((0, -0.06, 0.44), (0.225, 0.30, 0.28), "brown_light")]       # chest, rising
    o += [ball((0, -0.30, 0.74), (0.185, 0.185, 0.175), "brown_light")]     # head up on top
    o += [ball((0, -0.40, 0.66), (0.125, 0.115, 0.095), "tan")]             # muzzle
    o += [ball((0, -0.49, 0.67), (0.045,)*3, "ink")]
    for sx in (-1, 1):
        o += [ball((sx*0.145, -0.24, 0.88), (0.05, 0.028, 0.05), "brown")]
    o += eyes(-0.42, 0.80, 0.078, 0.055)
    # flat rudder tail trailing far back and low
    o += [box((0, 0.74, 0.18), (0.24, 0.52, 0.075), "brown", rot=(math.radians(-6),0,0), subsurf=2)]
    o += [box((0, 1.06, 0.14), (0.17, 0.34, 0.05), "brown", rot=(math.radians(-4),0,0), subsurf=2)]
    for sx in (-1, 1):
        o += [ball((sx*0.20, -0.16, 0.30), (0.065, 0.10, 0.115), "brown")]
        o += [ball((sx*0.20, -0.22, 0.05), (0.085, 0.125, 0.045), "tan", subsurf=1)]
        o += [ball((sx*0.19, 0.36, 0.14), (0.065, 0.10, 0.085), "brown")]
        o += [ball((sx*0.19, 0.34, 0.04), (0.085, 0.115, 0.04), "tan", subsurf=1)]
    o += [ball((0, -0.24, 0.50), (0.10, 0.07, 0.09), "teal_light")]         # river stone, held
    return o

SPECIES = {
    "rook":    ("Rook",  "rook",    rook),
    "mara":    ("Mara",  "eagle",   eagle),
    "sable":   ("Sable", "hound",   hound),
    "bront":   ("Bront", "bear",    bear),
    "ilex":    ("Ilex",  "owl",     owl),
    "luma":    ("Luma",  "raccoon", raccoon),
    "orren":   ("Orren", "otter",   otter),
}

# ----------------------------------------------------------------- shared rig
def build_rig():
    """The invariant half of the pipeline. Every companion is shot through this."""
    scn = bpy.context.scene
    bpy.ops.object.camera_add(location=(2.55, -4.30, 2.32))
    cam = bpy.context.active_object
    cam.rotation_euler = (math.radians(69), 0, math.radians(30.5))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 2.95
    scn.camera = cam

    # Energies are deliberately low. The first pass ran hot and bleached every
    # dark value to beige, which destroyed the palette and the read on Rook.
    bpy.ops.object.light_add(type="AREA", location=(-2.6, -3.4, 4.2))
    k = bpy.context.active_object
    k.data.energy, k.data.size = 260, 4.0
    k.data.color = (1.0, 0.95, 0.88)
    k.rotation_euler = (math.radians(38), math.radians(-22), math.radians(-32))

    bpy.ops.object.light_add(type="AREA", location=(4.0, -2.2, 1.7))
    f = bpy.context.active_object
    f.data.energy, f.data.size = 70, 5.0
    f.data.color = (0.70, 0.84, 1.0)
    f.rotation_euler = (math.radians(76), 0, math.radians(66))

    bpy.ops.object.light_add(type="AREA", location=(-1.4, 3.6, 3.0))
    r = bpy.context.active_object
    r.data.energy, r.data.size = 190, 3.0
    r.data.color = (1.0, 0.78, 0.46)
    r.rotation_euler = (math.radians(120), 0, math.radians(-160))

    scn.render.engine = "BLENDER_EEVEE"
    scn.render.film_transparent = True
    scn.render.image_settings.file_format = "PNG"
    scn.render.image_settings.color_mode = "RGBA"
    try:
        scn.eevee.taa_render_samples = 64
        scn.eevee.use_raytracing = True
    except Exception:
        pass
    scn.view_settings.view_transform = "Standard"
    return cam

def frame_and_render(objs, out_png, res):
    scn = bpy.context.scene
    scn.render.resolution_x = scn.render.resolution_y = res
    scn.render.filepath = out_png
    bpy.ops.render.render(write_still=True)

def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)

# ----------------------------------------------------------------- entry
def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default=None)
    ap.add_argument("--res", type=int, default=512)
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    keys = [a.only] if a.only else list(SPECIES)
    for key in keys:
        name, species, build = SPECIES[key]
        clear(); _mats.clear()
        build_rig()
        build()
        path = os.path.join(a.out, f"{key}-{species}-idle-01.png")
        frame_and_render(None, path, a.res)
        print(f"COMPANION {key} {species} -> {path}")


# Guarded so other pipeline scripts can import the body plans without running the CLI.
if __name__ == "__main__":
    main()
