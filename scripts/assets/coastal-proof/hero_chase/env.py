"""The Coastal Market level, relit and re-materialed for the hero sequence.

The level geometry is the game's own (level.glb). What changes here is everything the phone runtime
can't afford: 2k Poly Haven PBR sets (albedo, AO/rough/metal, normal, height-as-bump) on every stone,
plaster, roof and wood surface; cloth that glows when the sun is behind it; a real sunset HDRI turned
so its sun sits exactly where the game's sun is; an ocean with foam; and aerial haze with volumetric
light so the harbour reads as enormous.
"""

import math
import os

import bpy
import numpy as np
from mathutils import Vector

from common import ASSETS, POLYHAVEN, SUN_DIR, collection, link

SUN_COLOR = (1.0, 0.58, 0.32)


# ---------------------------------------------------------------- materials

def tex_path(name, kind):
    return os.path.join(POLYHAVEN, "textures", name, f"{name}_{kind}_2k.jpg")


def img(path, non_color=False):
    im = bpy.data.images.load(path, check_existing=True)
    if non_color:
        im.colorspace_settings.name = "Non-Color"
    return im


class M:
    """A tiny node-graph builder."""

    def __init__(self, name):
        self.mat = bpy.data.materials.new(name)
        self.mat.use_nodes = True
        self.nt = self.mat.node_tree
        self.nt.nodes.clear()
        self.out = self.node("ShaderNodeOutputMaterial", (900, 0))

    def node(self, t, loc=(0, 0), **kw):
        n = self.nt.nodes.new(t)
        n.location = loc
        for k, v in kw.items():
            setattr(n, k, v)
        return n

    def link(self, a, b):
        self.nt.links.new(a, b)

    def val(self, v, loc=(0, 0)):
        n = self.node("ShaderNodeValue", loc)
        n.outputs[0].default_value = v
        return n.outputs[0]


def pbr_material(name, tex, *, scale=1.0, tint="Color", tint_amount=1.0, rough_mul=1.0, bump=0.35,
                 world_box=False, translucent=0.0, sheen=0.0, spec=0.5, darken=1.0, hue_warm=0.0):
    """Poly Haven PBR set on the mesh's first UV map (or world box projection), tinted by the level's
    per-face vertex colour (the palettes that make one plaster wall ochre and the next rose)."""
    m = M(name)
    bsdf = m.node("ShaderNodeBsdfPrincipled", (500, 0))
    if world_box:
        tc = m.node("ShaderNodeTexCoord", (-900, 0))
        mp = m.node("ShaderNodeMapping", (-700, 0))
        mp.inputs["Scale"].default_value = (1 / scale, 1 / scale, 1 / scale)
        m.link(tc.outputs["Object"], mp.inputs["Vector"])
        vec = mp.outputs["Vector"]
    else:
        uv = m.node("ShaderNodeUVMap", (-900, 0))
        mp = m.node("ShaderNodeMapping", (-700, 0))
        mp.inputs["Scale"].default_value = (scale, scale, scale)
        m.link(uv.outputs["UV"], mp.inputs["Vector"])
        vec = mp.outputs["Vector"]

    def texnode(kind, y, non_color):
        t = m.node("ShaderNodeTexImage", (-450, y))
        t.image = img(tex_path(tex, kind), non_color)
        if world_box:
            t.projection = "BOX"
            t.projection_blend = 0.25
        m.link(vec, t.inputs["Vector"])
        return t

    diff = texnode("diff", 300, False)
    arm = texnode("arm", 0, True)
    nor = texnode("nor_gl", -300, True)
    disp = texnode("disp", -600, True)
    col = diff.outputs["Color"]
    if tint:
        attr = m.node("ShaderNodeAttribute", (-450, 550))
        attr.attribute_name = tint
        # tint toward the palette colour, keeping the texture's value detail
        mix = m.node("ShaderNodeMix", (-150, 400))
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = tint_amount
        m.link(col, mix.inputs["A"])
        # palettes were authored for flat colour; lift them so multiply doesn't go muddy
        lift = m.node("ShaderNodeMix", (-300, 550))
        lift.data_type = "RGBA"
        lift.inputs["Factor"].default_value = 0.35
        m.link(attr.outputs["Color"], lift.inputs["A"])
        lift.inputs["B"].default_value = (1, 1, 1, 1)
        m.link(lift.outputs["Result"], mix.inputs["B"])
        col = mix.outputs["Result"]
    if darken != 1.0 or hue_warm:
        hsv = m.node("ShaderNodeHueSaturation", (100, 400))
        hsv.inputs["Value"].default_value = darken
        hsv.inputs["Saturation"].default_value = 1.0 + hue_warm
        m.link(col, hsv.inputs["Color"])
        col = hsv.outputs["Color"]
    sep = m.node("ShaderNodeSeparateColor", (-150, 0))
    m.link(arm.outputs["Color"], sep.inputs["Color"])
    # AO darkens the albedo in the crevices (EEVEE's own AO is screen-space and coarse)
    ao = m.node("ShaderNodeMix", (250, 250))
    ao.data_type = "RGBA"
    ao.blend_type = "MULTIPLY"
    ao.inputs["Factor"].default_value = 0.8
    m.link(col, ao.inputs["A"])
    aoc = m.node("ShaderNodeCombineColor", (100, 150))
    for i in range(3):
        m.link(sep.outputs["Red"], aoc.inputs[i])
    m.link(aoc.outputs["Color"], ao.inputs["B"])
    m.link(ao.outputs["Result"], bsdf.inputs["Base Color"])
    rough = m.node("ShaderNodeMath", (150, 0), operation="MULTIPLY")
    m.link(sep.outputs["Green"], rough.inputs[0])
    rough.inputs[1].default_value = rough_mul
    m.link(rough.outputs["Value"], bsdf.inputs["Roughness"])
    m.link(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    nm = m.node("ShaderNodeNormalMap", (150, -300))
    m.link(nor.outputs["Color"], nm.inputs["Color"])
    bp = m.node("ShaderNodeBump", (320, -400))
    bp.inputs["Strength"].default_value = bump
    bp.inputs["Distance"].default_value = 0.02
    m.link(disp.outputs["Color"], bp.inputs["Height"])
    m.link(nm.outputs["Normal"], bp.inputs["Normal"])
    m.link(bp.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Specular IOR Level"].default_value = spec
    if sheen:
        bsdf.inputs["Sheen Weight"].default_value = sheen
    shader = bsdf.outputs["BSDF"]
    if translucent:
        tr = m.node("ShaderNodeBsdfTranslucent", (500, -350))
        m.link(ao.outputs["Result"], tr.inputs["Color"])
        mixs = m.node("ShaderNodeMixShader", (720, 0))
        mixs.inputs["Fac"].default_value = translucent
        m.link(shader, mixs.inputs[1])
        m.link(tr.outputs["BSDF"], mixs.inputs[2])
        shader = mixs.outputs["Shader"]
    m.link(shader, m.out.inputs["Surface"])
    return m.mat


def cloth_material(name, *, tint="Color", base=None, stripes=False, stripe_col=(0.85, 0.78, 0.64, 1), translucent=0.45):
    """Woven canvas: fine weave bump, sheen, and light through it when the sun is behind (awnings
    and banners should glow at sunset)."""
    m = M(name)
    bsdf = m.node("ShaderNodeBsdfPrincipled", (500, 0))
    tc = m.node("ShaderNodeTexCoord", (-900, 0))
    if base is not None:
        col = m.node("ShaderNodeRGB", (-450, 400))
        col.outputs[0].default_value = base
        c = col.outputs[0]
    else:
        attr = m.node("ShaderNodeAttribute", (-450, 400))
        attr.attribute_name = tint
        c = attr.outputs["Color"]
    if stripes:
        # stripes across the awning's width (UV u)
        sep = m.node("ShaderNodeSeparateXYZ", (-700, 200))
        m.link(tc.outputs["UV"], sep.inputs[0])
        wave = m.node("ShaderNodeTexWave", (-500, 200))
        wave.wave_type = "BANDS"
        wave.bands_direction = "X"
        wave.inputs["Scale"].default_value = 3.2
        wave.inputs["Distortion"].default_value = 0.0
        m.link(tc.outputs["UV"], wave.inputs["Vector"])
        ramp = m.node("ShaderNodeValToRGB", (-300, 200))
        ramp.color_ramp.interpolation = "CONSTANT"
        ramp.color_ramp.elements[0].position = 0.0
        ramp.color_ramp.elements[1].position = 0.5
        m.link(wave.outputs["Fac"], ramp.inputs["Fac"])
        mix = m.node("ShaderNodeMix", (-100, 300))
        mix.data_type = "RGBA"
        m.link(ramp.outputs["Color"], mix.inputs["Factor"])
        m.link(c, mix.inputs["A"])
        mix.inputs["B"].default_value = stripe_col
        c = mix.outputs["Result"]
    # weathering: sun-bleached, dirt toward the lower edge
    noi = m.node("ShaderNodeTexNoise", (-500, -100))
    noi.inputs["Scale"].default_value = 14
    noi.inputs["Detail"].default_value = 6
    m.link(tc.outputs["Object"], noi.inputs["Vector"])
    dirt = m.node("ShaderNodeMix", (100, 300))
    dirt.data_type = "RGBA"
    dirt.blend_type = "MULTIPLY"
    dirt.inputs["Factor"].default_value = 0.35
    m.link(c, dirt.inputs["A"])
    m.link(noi.outputs["Color"], dirt.inputs["B"])
    m.link(dirt.outputs["Result"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Sheen Weight"].default_value = 0.5
    bsdf.inputs["Sheen Roughness"].default_value = 0.4
    # weave
    weave = m.node("ShaderNodeTexWave", (-500, -350))
    weave.inputs["Scale"].default_value = 180
    m.link(tc.outputs["Object"], weave.inputs["Vector"])
    bp = m.node("ShaderNodeBump", (250, -350))
    bp.inputs["Strength"].default_value = 0.15
    m.link(weave.outputs["Fac"], bp.inputs["Height"])
    m.link(bp.outputs["Normal"], bsdf.inputs["Normal"])
    tr = m.node("ShaderNodeBsdfTranslucent", (500, -300))
    m.link(dirt.outputs["Result"], tr.inputs["Color"])
    mixs = m.node("ShaderNodeMixShader", (720, 0))
    mixs.inputs["Fac"].default_value = translucent
    m.link(bsdf.outputs["BSDF"], mixs.inputs[1])
    m.link(tr.outputs["BSDF"], mixs.inputs[2])
    m.link(mixs.outputs["Shader"], m.out.inputs["Surface"])
    m.mat.use_backface_culling = False
    return m.mat


def simple_material(name, color, rough=0.5, metal=0.0, emission=None, strength=0.0, tint=None, coat=0.0):
    m = M(name)
    bsdf = m.node("ShaderNodeBsdfPrincipled", (500, 0))
    if tint:
        attr = m.node("ShaderNodeAttribute", (200, 200))
        attr.attribute_name = tint
        m.link(attr.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if coat:
        bsdf.inputs["Coat Weight"].default_value = coat
    if emission:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = strength
    m.link(bsdf.outputs["BSDF"], m.out.inputs["Surface"])
    return m.mat


def rope_material(name="hero_rope"):
    m = M(name)
    bsdf = m.node("ShaderNodeBsdfPrincipled", (500, 0))
    tc = m.node("ShaderNodeTexCoord", (-700, 0))
    wave = m.node("ShaderNodeTexWave", (-450, 0))
    wave.wave_type = "RINGS"
    wave.inputs["Scale"].default_value = 40
    wave.inputs["Distortion"].default_value = 6
    m.link(tc.outputs["Object"], wave.inputs["Vector"])
    ramp = m.node("ShaderNodeValToRGB", (-200, 100))
    ramp.color_ramp.elements[0].color = (0.22, 0.16, 0.10, 1)
    ramp.color_ramp.elements[1].color = (0.62, 0.50, 0.33, 1)
    m.link(wave.outputs["Fac"], ramp.inputs["Fac"])
    m.link(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9
    bp = m.node("ShaderNodeBump", (250, -250))
    bp.inputs["Strength"].default_value = 0.6
    m.link(wave.outputs["Fac"], bp.inputs["Height"])
    m.link(bp.outputs["Normal"], bsdf.inputs["Normal"])
    m.link(bsdf.outputs["BSDF"], m.out.inputs["Surface"])
    return m.mat


def level_materials():
    return {
        "VIS_plaster": pbr_material("hero_plaster", "painted_plaster_wall", scale=0.9, bump=0.5),
        "VIS_plaster_warm": pbr_material("hero_plaster_warm", "painted_plaster_wall", scale=0.9, bump=0.5, hue_warm=0.1),
        "VIS_mortar": pbr_material("hero_mortar", "monastery_stone_floor", scale=0.8, bump=0.6, tint_amount=0.7),
        "VIS_cobble": pbr_material("hero_cobble", "cobblestone_floor_04", scale=0.9, bump=0.9, tint_amount=0.5),
        "VIS_quay": pbr_material("hero_quay", "monastery_stone_floor", scale=0.8, bump=0.8, tint_amount=0.5),
        "VIS_step": pbr_material("hero_step", "monastery_stone_floor", scale=1.0, bump=0.6, tint_amount=0.5),
        "VIS_rock": pbr_material("hero_rock", "rock_face_03", scale=0.35, bump=1.0, tint_amount=0.8),
        "VIS_roof": pbr_material("hero_roof", "ceramic_roof_01", scale=1.0, bump=0.8, tint_amount=0.6),
        "VIS_wood": pbr_material("hero_wood", "wood_planks_dirt", scale=1.0, bump=0.5, tint_amount=0.6),
        "VIS_wood_dark": pbr_material("hero_wood_dark", "weathered_brown_planks", scale=1.0, bump=0.5, tint_amount=0.6, darken=0.8),
        "VIS_paint": pbr_material("hero_paint", "weathered_brown_planks", scale=1.2, bump=0.3, tint_amount=1.0, rough_mul=0.9),
        "VIS_sand": pbr_material("hero_sand", "coast_sand_01", scale=0.5, bump=0.8, tint_amount=0.3),
        "VIS_cloth_red": cloth_material("hero_cloth_red"),
        "VIS_cloth_cream": cloth_material("hero_cloth_cream"),
        "VIS_cloth_blue": cloth_material("hero_cloth_blue"),
        "VIS_rope": rope_material("hero_level_rope"),
        "VIS_iron": simple_material("hero_iron", (0.05, 0.045, 0.04, 1), rough=0.45, metal=0.9),
        "VIS_brass": simple_material("hero_brass", (0.75, 0.52, 0.22, 1), rough=0.3, metal=1.0),
        "VIS_glow": simple_material("hero_glow", (1, 0.7, 0.4, 1), emission=(1.0, 0.62, 0.30, 1), strength=6.0),
        "VIS_window": simple_material("hero_window", (0.02, 0.018, 0.016, 1), rough=0.08, coat=1.0),
        "VIS_produce": simple_material("hero_produce", None, rough=0.35, tint="Color", coat=0.4),
        "VIS_foliage": simple_material("hero_foliage", None, rough=0.7, tint="Color"),
        "VIS_leather": simple_material("hero_leather", (0.28, 0.15, 0.07, 1), rough=0.6),
    }


# ---------------------------------------------------------------- level

def import_level():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ASSETS, "level.glb"))
    objs = [o for o in bpy.data.objects if o not in before]
    lvl = collection("level")
    for o in objs:
        for c in o.users_collection:
            c.objects.unlink(o)
        lvl.objects.link(o)
        if o.name.startswith("COL_"):
            o.hide_render = True
            o.hide_viewport = True
    mats = level_materials()
    far = simple_material("hero_far", None, rough=0.9, tint="Color")
    for o in objs:
        if o.type != "MESH":
            continue
        if o.name in mats:
            o.data.materials.clear()
            o.data.materials.append(mats[o.name])
        elif o.name.startswith("FAR_"):
            key = "VIS_" + o.name[4:]
            o.data.materials.clear()
            o.data.materials.append(mats.get(key, far) if key != "VIS_far" else far)
    return objs


# ---------------------------------------------------------------- sky, sun, sea, air

def hdri_sun_azimuth(image):
    """Azimuth (radians, equirect u) of the brightest point of an HDRI."""
    w, h = image.size
    px = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(px)
    lum = px.reshape(h, w, 4)[..., :3].sum(axis=2)
    y, x = np.unravel_index(np.argmax(lum), lum.shape)
    return (x / w) * 2 * math.pi, y / h


def build_world(hdri="industrial_sunset_02_puresky_4k.hdr", strength=0.45):
    sc = bpy.context.scene
    w = bpy.data.worlds.new("hero_world")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(os.path.join(POLYHAVEN, "hdri", hdri), check_existing=True)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    # turn the HDRI so its sun lands on the game's sun azimuth
    u, _ = hdri_sun_azimuth(env.image)
    # blender's equirect lookup: u = atan2(d.y, -d.x) / 2pi + 0.5, so a pixel at u sits at azimuth
    # pi - (u - 0.5) * 2pi. The mapping rotates the view vector before the lookup, so rotating by
    # (hdri azimuth - game azimuth) puts the HDRI's sun in the game's sun direction.
    phi = (u / (2 * math.pi) - 0.5) * 2 * math.pi
    hdri_az = math.pi - phi
    game_az = math.atan2(SUN_DIR.y, SUN_DIR.x)
    mp.inputs["Rotation"].default_value = (0, 0, hdri_az - game_az)
    nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], env.inputs["Vector"])
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = strength
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    # the HDRI's sun is not a light; the sun lamp below carries the shadows
    if hasattr(w, "sun_threshold"):
        w.sun_threshold = 1000.0
    return w


def build_haze(center=(-80.0, -15.0), size=(700.0, 700.0, 160.0), density=0.0022, falloff=0.018):
    """Aerial haze as a volume box (a world volume renders black in headless EEVEE here): warm,
    forward-scattering (so the low sun blooms through it), thinning with height so the town and
    cliff tops stay crisp against the sky while the sea horizon melts."""
    m = M("hero_haze")
    m.nt.nodes.remove(m.out)
    out = m.node("ShaderNodeOutputMaterial", (700, 0))
    vol = m.node("ShaderNodeVolumePrincipled", (400, 0))
    vol.inputs["Color"].default_value = (1.0, 0.84, 0.70, 1)
    vol.inputs["Anisotropy"].default_value = 0.7
    # density falls off with height: exp(-z * falloff)
    tc = m.node("ShaderNodeTexCoord", (-400, 0))
    sep = m.node("ShaderNodeSeparateXYZ", (-200, 0))
    m.link(tc.outputs["Object"], sep.inputs[0])
    mul = m.node("ShaderNodeMath", (0, 0), operation="MULTIPLY")
    mul.inputs[1].default_value = -falloff * size[2] / 2
    m.link(sep.outputs["Z"], mul.inputs[0])
    ex = m.node("ShaderNodeMath", (150, 0), operation="EXPONENT")
    m.link(mul.outputs["Value"], ex.inputs[0])
    d = m.node("ShaderNodeMath", (300, -150), operation="MULTIPLY")
    d.inputs[1].default_value = density
    m.link(ex.outputs["Value"], d.inputs[0])
    m.link(d.outputs["Value"], vol.inputs["Density"])
    m.link(vol.outputs["Volume"], out.inputs["Volume"])
    bpy.ops.mesh.primitive_cube_add(size=1, location=(center[0], center[1], size[2] / 2 - 2))
    box = bpy.context.object
    box.name = "hero_haze"
    box.scale = size
    box.data.materials.append(m.mat)
    box.display_type = "WIRE"
    return box


def build_sun(energy=5.5):
    sun = bpy.data.objects.new("hero_sun", bpy.data.lights.new("hero_sun", "SUN"))
    link(sun)
    sun.data.energy = energy
    sun.data.color = SUN_COLOR
    sun.data.angle = math.radians(1.2)
    sun.rotation_euler = (-SUN_DIR).to_track_quat("-Z", "Y").to_euler()
    return sun


def water_material():
    m = M("hero_water")
    bsdf = m.node("ShaderNodeBsdfPrincipled", (500, 0))
    bsdf.inputs["Base Color"].default_value = (0.006, 0.035, 0.045, 1)
    bsdf.inputs["Roughness"].default_value = 0.035
    bsdf.inputs["IOR"].default_value = 1.33
    bsdf.inputs["Specular IOR Level"].default_value = 0.6
    # foam from the ocean modifier's foam layer
    attr = m.node("ShaderNodeAttribute", (-400, 300))
    attr.attribute_name = "foam"
    ramp = m.node("ShaderNodeValToRGB", (-200, 300))
    ramp.color_ramp.elements[0].position = 0.25
    ramp.color_ramp.elements[1].position = 0.75
    m.link(attr.outputs["Fac"], ramp.inputs["Fac"])
    foam = m.node("ShaderNodeBsdfPrincipled", (500, 400))
    foam.inputs["Base Color"].default_value = (0.85, 0.85, 0.82, 1)
    foam.inputs["Roughness"].default_value = 0.6
    mix = m.node("ShaderNodeMixShader", (750, 0))
    m.link(ramp.outputs["Color"], mix.inputs["Fac"])
    m.link(bsdf.outputs["BSDF"], mix.inputs[1])
    m.link(foam.outputs["BSDF"], mix.inputs[2])
    # fine ripples on top of the ocean displacement
    tc = m.node("ShaderNodeTexCoord", (-900, -300))
    noi = m.node("ShaderNodeTexNoise", (-600, -300))
    noi.inputs["Scale"].default_value = 1.6
    noi.inputs["Detail"].default_value = 8
    m.link(tc.outputs["Object"], noi.inputs["Vector"])
    bp = m.node("ShaderNodeBump", (250, -300))
    bp.inputs["Strength"].default_value = 0.12
    m.link(noi.outputs["Fac"], bp.inputs["Height"])
    m.link(bp.outputs["Normal"], bsdf.inputs["Normal"])
    m.link(mix.outputs["Shader"], m.out.inputs["Surface"])
    return m.mat


def build_sea(center=(-80.0, -10.0)):
    mat = water_material()
    coll = collection("sea")
    # near: a real ocean surface with foam, around the harbour
    bpy.ops.mesh.primitive_plane_add(size=2, location=(center[0], center[1], 0.0))
    near = bpy.context.object
    for c in near.users_collection:
        c.objects.unlink(near)
    coll.objects.link(near)
    near.name = "hero_sea_near"
    oc = near.modifiers.new("ocean", "OCEAN")
    oc.geometry_mode = "GENERATE"
    oc.size = 1.0
    oc.spatial_size = 60
    oc.repeat_x = 4
    oc.repeat_y = 4
    oc.resolution = 12
    oc.wave_scale = 0.35
    oc.choppiness = 1.1
    oc.wind_velocity = 7.0
    oc.wave_alignment = 0.4
    oc.wave_direction = math.atan2(SUN_DIR.y, SUN_DIR.x)
    oc.use_foam = True
    oc.foam_layer_name = "foam"
    oc.foam_coverage = 0.15
    near.location = (center[0] - 120, center[1] - 120, 0.0)
    near.data.materials.append(mat)
    fc = oc.driver_add("time")
    fc.driver.expression = "frame / 24"
    # far: a flat plane to the horizon
    bpy.ops.mesh.primitive_plane_add(size=6000, location=(center[0], center[1], -0.05))
    far = bpy.context.object
    for c in far.users_collection:
        c.objects.unlink(far)
    coll.objects.link(far)
    far.name = "hero_sea_far"
    far.data.materials.append(mat)
    return near, far


def render_settings(res=(1080, 1920), samples=32, preview=False):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.fps = 24
    e = sc.eevee
    for k, v in {
        "taa_render_samples": samples,
        "use_raytracing": not preview,
        "use_shadows": True,
        "shadow_ray_count": 2 if not preview else 1,
        "shadow_step_count": 8 if not preview else 4,
        "volumetric_start": 0.5,
        "volumetric_end": 420.0,
        "volumetric_tile_size": "4" if not preview else "8",
        "volumetric_samples": 64 if not preview else 32,
        "use_volumetric_shadows": True,
        "volumetric_shadow_samples": 16,
        "use_gtao": True,
        "gtao_distance": 1.2,
        "fast_gi_method": "GLOBAL_ILLUMINATION",
        "use_fast_gi": True,
    }.items():
        if hasattr(e, k):
            try:
                setattr(e, k, v)
            except Exception as err:  # enum names drift between versions
                print("[hero] eevee", k, err)
    if hasattr(e, "ray_tracing_options"):
        o = e.ray_tracing_options
        for k, v in {"resolution_scale": "2", "trace_max_roughness": 0.5, "use_denoise": True}.items():
            if hasattr(o, k):
                try:
                    setattr(o, k, v)
                except Exception as err:
                    print("[hero] rt", k, err)
    vs = sc.view_settings
    vs.view_transform = "AgX"
    try:
        vs.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    vs.exposure = 0.0
    sc.render.film_transparent = False
    sc.render.use_motion_blur = not preview
    if hasattr(sc.render, "motion_blur_shutter"):
        sc.render.motion_blur_shutter = 0.5


def compositor(bloom=0.5, vignette=0.3):
    """Bloom on the sun-lit highlights and a soft vignette (the lens's own falloff). The node group is
    attached to the scene only once it is complete (a half-built one renders black)."""
    sc = bpy.context.scene
    ng = bpy.data.node_groups.new("hero_comp", "CompositorNodeTree")
    try:
        ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        rl = ng.nodes.new("CompositorNodeRLayers")
        out = ng.nodes.new("NodeGroupOutput")
        gl = ng.nodes.new("CompositorNodeGlare")
        gl.inputs["Type"].default_value = "Bloom"
        gl.inputs["Quality"].default_value = "High"
        gl.inputs["Threshold"].default_value = 1.0
        gl.inputs["Strength"].default_value = bloom
        gl.inputs["Size"].default_value = 0.7
        ng.links.new(rl.outputs["Image"], gl.inputs["Image"])
        mask = ng.nodes.new("CompositorNodeEllipseMask")
        mask.inputs["Size"].default_value = (1.05, 1.05)
        blur = ng.nodes.new("CompositorNodeBlur")
        blur.inputs["Size"].default_value = (260, 260)
        ng.links.new(mask.outputs["Mask"], blur.inputs["Image"])
        v = ng.nodes.new("ShaderNodeMath")
        v.operation = "MULTIPLY_ADD"
        ng.links.new(blur.outputs["Image"], v.inputs[0])
        v.inputs[1].default_value = vignette
        v.inputs[2].default_value = 1.0 - vignette
        comb = ng.nodes.new("CompositorNodeCombineColor")
        for i in range(3):
            ng.links.new(v.outputs["Value"], comb.inputs[i])
        mix = ng.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        ng.links.new(gl.outputs["Image"], mix.inputs["A"])
        ng.links.new(comb.outputs["Image"], mix.inputs["B"])
        ng.links.new(mix.outputs["Result"], out.inputs[0])
        sc.compositing_node_group = ng
        print("[hero] compositor on")
    except Exception as err:
        bpy.data.node_groups.remove(ng)
        print("[hero] compositor skipped:", err)
