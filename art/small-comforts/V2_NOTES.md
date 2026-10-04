# Small Comforts visual slice v2 (branch art/small-comforts-blender-vs01 — not integrated, no PR)

Deliverables: `render/hero_v2.png`, `small_comforts_vs02.blend`, `textures_v2/{suitcase,bed,lamp}/` (basecolor, roughness, metallic, normal, ORM, lamp emissive),
`glb_v2/sc_{suitcase,bed,lamp}_v2.glb`, `validation_v2.json`, `render/grid_check_top_v2.png`.
Scripts: `build_scene_v2.py` (scene+hero), `bake_export_v2.py` (bake/export/validate), `glbcheck_v2.py` (re-imports GLBs at game cell positions).

## Before -> after
- Lid pocket: v1 flat blown-out panel -> wine satin with pleat bump, 3 stitched compartments, elastic hem, bound edge, real stitch rows; key light no longer clips it.
- Suitcase: pastel teal -> dark petrol leather with grain, mottling, scuffs and edge wear; brass has tarnish and brushing; stitch rows on base and lid.
- Lining: quilted warm lining with AO-driven depth, contact shadows under bed/armchair/lamp, warm lamp glow as the miniature-scale light source.
- Camera/comp: 62mm, f/2.2, low 3/4 view, bokeh city behind, mug for scale.
- Bake: procedural -> one atlas + one plain Principled material per asset (2048 suitcase, 1024 bed/lamp). Metallic baked via emission probe, roughness+metallic packed as glTF ORM.

## Validation (pure-python GLB parse, `validation_v2.json`: ALL PASS)
Scale 1 unit = 1 cell, Y-up, origin on floor. Suitcase slab +-3.05 x +-2.05 centred, floor y=0. Bed 0.86 x 1.875 cells, centred, pillow at game z -0.62. Lamp 0.75 x 0.75, 1.18 high, centred.

## Remaining defects (honest)
- Leather still reads slightly grey-green under the warm key; not fully deep petrol. Needs a cooler/lower key or a darker base.
- Satin pleats show as vertical line banding; the pocket paper contents are flat.
- Suitcase GLB is 9.4 MB / 68k tris — too heavy for the web build as-is; needs decimation and texture downsizing.
- Baked object-space procedural textures shift slightly versus the render (noise phase after joining); atlas texel density is uneven.
- Suitcase GLB bakes lid, pocket, and props into one mesh: no separate hinge/lid node for animation, no raycast proxies.
- Bake uses 6 samples, no denoise: some noise in roughness/base maps. Normal maps are tangent-space from bump nodes, not checked in a game engine.
- Only Blender-side validation; not loaded in the three.js game (by instruction).
