# Goldline Procedural World Kit v1

Code-ready compositing kit for the Goldline onboarding/world-generation system.

## Production assets
1. `01-background-water-sky.png` — universal environment layer
2. `02-territory-island-generic.png` — unlabeled generic city/territory tile, exterior water removed
3. `03-bridge-ne-sw.png`
4. `04-bridge-sw-ne.png` — exact 180° counterpart
5. `05-bridge-nw-se.png`
6. `06-bridge-se-nw.png` — exact 180° counterpart
7. `07-coastline-glow-overlay.png` — place beneath/around island
8. `08-cloud-fog-overlay.png` — fog-of-war / atmosphere
9. `09-water-reflection-overlay.png` — optional water detail
10. `10-sun-glow-overlay.png` — optional lighting accent

## Important
- PNG RGBA throughout.
- Product assets contain no town/city labels.
- Island and overlays are separate so the same town art can be reused over different world backgrounds.
- Bridge placement data and canonical island anchors are in `projection.json`.
- Territory/island/bridge geometry is game projection. Do not interpret fantasy geometry as literal geography or business evidence.
- Dynamic labels belong in HTML/canvas/Pixi, never baked into these images.
