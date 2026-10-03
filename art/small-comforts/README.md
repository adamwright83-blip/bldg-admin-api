# Small Comforts: Blender vertical slice

`build_scene.py` builds the whole scene procedurally (Blender 4.x/5.x) and exports one GLB per game item.
Dimensions follow the game grid (6x4 cells, CELL = 0.15) and anatomy follows `logic/container.ts`.

    # inside Blender: Scripting tab > open build_scene.py > Run Script
    # headless:       pip install bpy && python build_scene.py --out out --samples 80 --res 1600 900

Known limits (v1):
- GLBs carry flat base colour, roughness and metallic only. The leather, weave, felt and wood are procedural
  nodes and are NOT baked yet, so they look plainer in the game than in the render.
- The lid pocket is overlit and has no stitching; the lining is flat. Both are next-pass fixes.
- The Three.js primitives stay as collision/layout proxies; these GLBs are the visible layer once wired in.
