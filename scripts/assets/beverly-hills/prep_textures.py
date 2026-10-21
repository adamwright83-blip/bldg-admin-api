"""Beverly Hills level: CC0 Poly Haven textures and sky, sized for the web (Blender 5.2, headless).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/assets/beverly-hills/prep_textures.py

Writes client/public/assets/goldline/beverly-hills-3d/tex/: 1k WebP diffuse + normal maps for plaster, terracotta roof
tile and limestone paving; sky.webp (2k, tone-mapped backdrop) and env.hdr (512x256, image-based lighting) from
Poly Haven's belfast_sunset_puresky. Sources: ~/Desktop/lantern-city-commercial-game/coastal-proof-sources/polyhaven.
"""
import bpy, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "..", "client", "public", "assets", "goldline", "beverly-hills-3d", "tex"))
P = os.path.expanduser("~/Desktop/lantern-city-commercial-game/coastal-proof-sources/polyhaven")
os.makedirs(OUT, exist_ok=True)
sc = bpy.context.scene


def save(img, path, fmt, quality=82, size=None, colorspace=None):
    if colorspace:
        img.colorspace_settings.name = colorspace
    if size:
        img.scale(*size)
    s = sc.render.image_settings
    s.file_format = fmt
    if fmt == "WEBP":
        s.quality = quality
        s.color_mode = "RGB"
    img.save_render(path, scene=sc)
    print("wrote", path, os.path.getsize(path) // 1024, "KB")


sc.view_settings.view_transform = "Standard"
for name, short in (("painted_plaster_wall", "plaster"), ("ceramic_roof_01", "roof"), ("monastery_stone_floor", "paving")):
    d = bpy.data.images.load(os.path.join(P, "textures", name, f"{name}_diff_2k.jpg"))
    save(d, os.path.join(OUT, f"{short}_diff.webp"), "WEBP", size=(1024, 1024))
    n = bpy.data.images.load(os.path.join(P, "textures", name, f"{name}_nor_gl_2k.jpg"))
    n.colorspace_settings.name = "Non-Color"
    save(n, os.path.join(OUT, f"{short}_nor.webp"), "WEBP", quality=88, size=(1024, 1024))

hdr = bpy.data.images.load(os.path.join(P, "hdri", "belfast_sunset_puresky_2k.hdr"))
sc.view_settings.view_transform = "AgX"
save(hdr, os.path.join(OUT, "sky.webp"), "WEBP", quality=80)
sc.view_settings.view_transform = "Standard"
hdr2 = bpy.data.images.load(os.path.join(P, "hdri", "belfast_sunset_puresky_2k.hdr"))
hdr2.scale(512, 256)
s = sc.render.image_settings
s.file_format = "HDR"
s.color_mode = "RGB"
hdr2.save_render(os.path.join(OUT, "env.hdr"), scene=sc)
print("wrote env.hdr", os.path.getsize(os.path.join(OUT, "env.hdr")) // 1024, "KB")
