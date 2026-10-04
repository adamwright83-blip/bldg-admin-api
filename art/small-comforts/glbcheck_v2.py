import bpy, math, sys
from mathutils import Vector
out="/tmp/claude-0/blender/v2final"
bpy.ops.wm.read_factory_settings(use_empty=True)
sc=bpy.context.scene
def imp(n):
    before=set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f"{out}/glb_v2/sc_{n}_v2.glb")
    return [o for o in bpy.data.objects if o not in before]
# game units -> blender: x=gx, y=-gz (glTF z -> -blender y), z up
S=imp("suitcase"); B=imp("bed"); L=imp("lamp")
def place(objs,gx,gz):
    for o in objs:
        if o.parent is None: o.location=(gx,-gz,0)
place(S,0,0); place(B,-1.5,0); place(L,2.5,-0.5)
# pillow end: where is bed's highest vertex cluster in glTF z? report mean y of top verts
bo=[o for o in B if o.type=='MESH'][0]
vs=sorted(((bo.matrix_world@v.co) for v in bo.data.vertices), key=lambda p:-p.z)[:200]
print("BED top-200 verts mean blender y:", sum(v.y for v in vs)/200, "(game z =", -sum(v.y for v in vs)/200+0,")")
# render top-down check
w=bpy.data.worlds.new("w"); sc.world=w; w.use_nodes=True; w.node_tree.nodes["Background"].inputs[0].default_value=(.6,.6,.6,1)
sun=bpy.data.lights.new("s","SUN"); sun.energy=4; so=bpy.data.objects.new("s",sun); sc.collection.objects.link(so); so.rotation_euler=(0.5,0.2,0.3)
cam=bpy.data.cameras.new("c"); cam.type='ORTHO'; cam.ortho_scale=7.5
co=bpy.data.objects.new("c",cam); sc.collection.objects.link(co); co.location=(0,0,20); co.rotation_euler=(0,0,0); sc.camera=co
sc.render.engine="CYCLES"; sc.cycles.samples=24; sc.cycles.device="CPU"; sc.render.resolution_x=1000; sc.render.resolution_y=700
# hide suitcase front wall? lid would cover: hide meshes above y> via render clip
cam.clip_end=20-0.0; cam.clip_start=0.1
sc.render.filepath=f"{out}/grid_check_top.png"; bpy.ops.render.render(write_still=True)
