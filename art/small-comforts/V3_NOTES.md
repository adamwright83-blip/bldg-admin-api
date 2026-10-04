# Small Comforts suitcase v3 — runtime-ready (branch art/small-comforts-blender-vs01; not integrated)

`glb_v3/sc_suitcase_v3.glb` — **1.45 MB, 19,150 tris** (v2: 9.4 MB, 68,228 tris). Validation: `validation_v3.json` (all checks pass).
Proof renders: `render/lid_proof_v3.png` (closed / 45 / 107 deg, hinge marked), `render/v2_vs_v3_appearance.png` (v2 left, v3 right).
Rebuild: `build_suitcase_v3.py` (from `small_comforts_vs02.blend`), `validate_suitcase_v3.py`. Blend of the build: `small_comforts_vs03_suitcase.blend`.

## Units / origin
1 unit = 1 grid cell, Y-up, +Z toward camera. Root `Suitcase` at (0,0,0): centre of the 6x4 playable floor, floor plane y = 0. Lid exported **closed**.
Floor slab is x +-3.053, z +-2.053; inner wall faces at exactly |x| = 3.000, |z| = 2.000. Unchanged from the validated v2 geometry.

## Node tree (all share ONE material: basecolor + ORM + normal)
```
Suitcase (root)
  Suitcase_Base      shell, rim welt, base stitching
    Fabric_Lining    visible lining faces only (floor + walls)        -> container tag fabric_lining
    Elastic_Straps   straps, tabs, buckles                            -> elastic_straps
    Brass_Latch      latch plates, turn-locks, keys, rivets           -> brass_latch
    Brass_Corners    base corner brackets + rivets                    -> brass_corners
    Base_Hardware    handle, brackets, hinge pin
  Suitcase_Lid       PIVOT NODE at the hinge line; lid shell + stitching
    Lid_Lining
    Lid_Pocket       satin pocket, hem, binding, stitching, note/ticket/card   -> lid_pocket
    Lid_Hardware     lid corners, hasps
```
Pivot: `Suitcase_Lid.position = (0, 0.9333, -2.4667)` = back/top edge of the base (the real hinge; hinge pin centre is 0.013 cell off it).
All lid children have identity local transforms, their vertices are in hinge-local space.
Three.js: `lid.rotation.x = THREE.MathUtils.degToRad(-angleDeg)`; 0 = closed, -107 = fully open (the open angle from v2).
Proven by re-importing the GLB in Blender: pivot drift 0, rigid-rotation error < 1e-4, measured 0 / 45 / 107 deg, no lid vertex enters the base volume.

## Weight reduction
- 12 rivets 1520 -> ~60 tris each; stitches reduced to their visible top face (2 tris/stitch) and any floating off-surface stitch dropped.
- Satin pocket 32k -> 8.9k (flat regions dissolved; pleats live in the normal map).
- Lining faces pressed against the shell removed (226 faces).
- Textures: base colour 2048 JPEG (q88, 4:4:4), ORM 1024 JPEG, normal 1024 JPEG. Together ~0.8 MB. No Draco/meshopt, so a plain GLTFLoader reads it.
- Atlas is re-baked from the same procedural materials as v2 (same colours, wear, brass tarnish, satin).

## Known issues
- Fully open, the lid's brass corner tips touch the plane of the base back corners (x = +-3.467, ~0.13 cell from the back face). Visually fine; there is no real collision.
- Lining and quilted-lining detail is a bit softer than v2 (normal map is 1024, was 2048).
- Normal/ORM are JPEG: slight blockiness is possible on close zoom. Swap to PNG (+~1.5 MB) if it shows.
- Pocket is still 8.9k tris, the heaviest node. Can drop further if needed.
- Hidden stitch/rim thin-strip UV bug (white dots along rim) found and fixed in this pass by stretching sliver islands before packing.
- Not loaded in the actual three.js game; verified only in Blender and by parsing the GLB.
- No collision geometry in the file, per brief. Bed and lamp v2 GLBs unchanged.
