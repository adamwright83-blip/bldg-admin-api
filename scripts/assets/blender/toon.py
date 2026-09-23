"""
TOON SHADING — the requirement, not the polish.

Character renders have to sit inside painted 2D backgrounds. Default Principled
PBR output reads as glossy plastic and makes the animals look pasted onto the
world, which is a failure even when the geometry is right. The first companion
pass proved that the hard way.

The shader is deliberately dumb: light the surface with a plain diffuse lobe,
convert that to a number, then quantise it into a few flat bands and tint by the
base colour. No speculars, no roughness variation, no reflections. Flat bands are
what match painted art.

`Shader to RGB` is EEVEE-only, which is fine — the whole pipeline renders in EEVEE.
"""
import bpy

# Band positions and multipliers. Three flat steps reads as painted; five reads
# as a render with banding artefacts.
#
# The first pass used 0.55/0.80/1.00 and two things went wrong: the steps were too
# close together to read as flat, and the 0.55 floor LIFTED every dark value, so
# Rook's ink black came out grey-blue. A wide spread with a genuinely dark floor
# fixes both. The shadow band must be dark enough to keep black characters black.
BANDS = ((0.00, 0.30), (0.34, 0.68), (0.66, 1.00))


def toon_material(name, rgba, outline=False):
    """A flat cel material. `rgba` is the base colour; lighting only picks a band."""
    key = f"toon_{name}" + ("_outline" if outline else "")
    if key in bpy.data.materials:
        return bpy.data.materials[key]

    mat = bpy.data.materials.new(key)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (700, 0)

    if outline:
        # Pure black, unlit. Used by the inverted hull so the edge never picks up
        # scene light and never shifts between companions.
        emit = nt.nodes.new("ShaderNodeEmission")
        emit.inputs["Color"].default_value = (0.02, 0.02, 0.03, 1)
        emit.location = (450, 0)
        nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
        # The shell's normals are flipped, so its near side becomes back-facing and
        # is culled; what survives is the far side peeking past the silhouette.
        mat.use_backface_culling = True
        # Emission alone still gets tonemapped; keep the shell fully unlit and
        # opaque so the line weight is identical on every companion.
        mat.blend_method = "OPAQUE" if hasattr(mat, "blend_method") else mat.blend_method
        return mat

    diffuse = nt.nodes.new("ShaderNodeBsdfDiffuse")
    diffuse.inputs["Color"].default_value = (1, 1, 1, 1)
    diffuse.location = (-300, 0)

    to_rgb = nt.nodes.new("ShaderNodeShaderToRGB")   # EEVEE only
    to_rgb.location = (-100, 0)
    nt.links.new(diffuse.outputs["BSDF"], to_rgb.inputs["Shader"])

    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.location = (100, 0)
    ramp.color_ramp.interpolation = "CONSTANT"       # hard steps, no gradient
    els = ramp.color_ramp.elements
    while len(els) > 1:
        els.remove(els[-1])
    els[0].position, els[0].color = BANDS[0][0], (BANDS[0][1],) * 3 + (1,)
    for pos, val in BANDS[1:]:
        e = els.new(pos)
        e.color = (val,) * 3 + (1,)
    nt.links.new(to_rgb.outputs["Color"], ramp.inputs["Fac"])

    # Multiplying the band value by the base colour cannot work on a dark palette:
    # 0.30, 0.68 and 1.00 times near-black are all near-black, so Rook showed no
    # banding at all. Instead the bands select between an explicitly cooled shadow
    # and an explicitly warmed light, both derived from the base. That keeps
    # separation visible on black characters, which is most of this cast.
    r, g, b, _ = rgba
    shadow = (max(r * 0.42, 0.020) + 0.010, max(g * 0.42, 0.020) + 0.014, max(b * 0.42, 0.028) + 0.030, 1)
    mid = (r, g, b, 1)
    light = (min(r * 1.30 + 0.075, 1), min(g * 1.26 + 0.068, 1), min(b * 1.16 + 0.050, 1), 1)
    els[0].color, els[1].color, els[2].color = shadow, mid, light

    tint = nt.nodes.new("ShaderNodeMixRGB")
    tint.blend_type = "MIX"
    tint.inputs["Fac"].default_value = 0.0      # bands already carry the colour
    tint.inputs["Color2"].default_value = rgba
    tint.location = (400, 0)
    nt.links.new(ramp.outputs["Color"], tint.inputs["Color1"])

    emit = nt.nodes.new("ShaderNodeEmission")
    emit.location = (550, 0)
    nt.links.new(tint.outputs["Color"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


def add_outline(obj, thickness=0.022):
    """
    Inverted hull. Pushes a flipped shell just outside the mesh and paints it
    black, so every companion carries the same weight of line regardless of what
    the light is doing. This is what stops a 3D character reading as a render.
    """
    if obj.type != "MESH":
        return
    outline = toon_material("edge", (0, 0, 0, 1), outline=True)
    obj.data.materials.append(outline)
    mod = obj.modifiers.new("outline", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = 1
    mod.use_flip_normals = True
    mod.use_rim = False
    mod.material_offset = len(obj.data.materials) - 1
    mod.material_offset_rim = len(obj.data.materials) - 1


def toon_textured_material(name, image):
    """
    Cel shading that keeps a baked colour texture.

    Image-to-3D output carries its colour in a baked texture, not a flat base
    colour. The flat-colour path reads Principled Base Color's default value,
    which is meaningless when a texture is linked into it, so a green-and-red
    Rook would come out uniform grey. Here the bands only decide light level and
    the texture decides colour: grey bands MULTIPLY the texture. Multiplying is
    safe in this path because the colour lives in the texture, not in a
    near-black base value.
    """
    key = f"toon_tex_{name}"
    if key in bpy.data.materials:
        return bpy.data.materials[key]
    mat = bpy.data.materials.new(key)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (800, 0)

    diffuse = nt.nodes.new("ShaderNodeBsdfDiffuse"); diffuse.location = (-300, 0)
    diffuse.inputs["Color"].default_value = (1, 1, 1, 1)
    to_rgb = nt.nodes.new("ShaderNodeShaderToRGB"); to_rgb.location = (-100, 0)
    nt.links.new(diffuse.outputs["BSDF"], to_rgb.inputs["Shader"])

    ramp = nt.nodes.new("ShaderNodeValToRGB"); ramp.location = (100, 0)
    ramp.color_ramp.interpolation = "CONSTANT"
    els = ramp.color_ramp.elements
    while len(els) > 1:
        els.remove(els[-1])
    els[0].position, els[0].color = 0.00, (0.56, 0.58, 0.64, 1)   # cool shadow band
    e = els.new(0.34); e.color = (0.86, 0.86, 0.86, 1)
    e = els.new(0.66); e.color = (1.06, 1.03, 0.97, 1)           # warm lit band
    nt.links.new(to_rgb.outputs["Color"], ramp.inputs["Fac"])

    tex = nt.nodes.new("ShaderNodeTexImage"); tex.location = (100, -260)
    tex.image = image
    mix = nt.nodes.new("ShaderNodeMixRGB"); mix.location = (400, 0)
    mix.blend_type = "MULTIPLY"
    mix.inputs["Fac"].default_value = 1.0
    nt.links.new(ramp.outputs["Color"], mix.inputs["Color1"])
    nt.links.new(tex.outputs["Color"], mix.inputs["Color2"])

    emit = nt.nodes.new("ShaderNodeEmission"); emit.location = (600, 0)
    nt.links.new(mix.outputs["Color"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat
