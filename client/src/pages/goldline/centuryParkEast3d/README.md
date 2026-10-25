# Lantern City — Century Park East (the building as a game)

The tower's shared floors opened like a dollhouse: three storeys cut open at the front, dusk through the back windows,
the city behind. Eight building characters each need something found; bringing it back opens the Letter Desk for a
real resident quiet 45+ days (the Silver Lake rails, scoped to 2160/2170 Century Park East). Cozy night or zombie
night is the player's choice and is remembered. Entry: the tower view's **Play the building**, or
`/growth/lantern-city?level=century-park-east`.

## Code map

| File | Role |
| --- | --- |
| `CenturyParkEast3D.tsx` | HUD, dialogue, the errand chain, the Letter Desk mount; knows the customers |
| `cpeRuntime.ts` | the game: input, collisions, zombies, dogs, ropes, items, camera, post, test hook `window.__centuryParkEast` |
| `cpeLayout.ts` | the building's measurements and room plan, shared by the runtime and the set |
| `cpeSet.ts` | what the building looks like: the cut shell, every room's furniture, the street, the parallax city |
| `cpeTextures.ts` | every surface, painted on canvas when the level opens (wallpaper, floors, mailboxes, skyline…) |
| `zombieLoungeMusic.ts` | the zombie-night score (the cozy one is Silver Lake's) |
| `e2e/goldline-smoke/centuryParkEast.spec.ts` | CI: errand → Letter Desk, closet trap, dog tower, paper bite, ropes, nothing written |

The runtime owns gameplay and declares every collider; the set draws furniture on exactly those footprints, so the
look can change without touching the game. No external model or texture files: the cast comes from Beverly Hills
(`/assets/goldline/beverly-hills-3d/cast/`), everything else is procedural.

## Rendering

Physically based materials with painted detail maps, a soft studio environment, a key light with real shadows that
follows the player's floor (so one shadow map covers one storey and stays sharp), room point lights, bloom on the
lamps and the sign, a warm or cool grade with a vignette. Corner and under-furniture occlusion is painted into the set
(`ao|edge`, `ao|blob`) instead of a screen-space pass: GTAO cost more than the rest of the frame on an M1.

Static geometry is merged into one mesh per material (`Kit` in `cpeSet.ts`), about 40 draw calls for the whole
building. Skinned people are only drawn and animated when the camera can see them, and only the ones on the player's
floor cast shadows; the party shows everyone.

Three tiers, picked from the device (override with `?cpeTier=phone|flat` for measurement):

| Tier | When | Shadows | Shadow map | Bloom |
| --- | --- | --- | --- | --- |
| desktop | real GPU, mouse | yes | 2048 | yes |
| phone | real GPU, touch | yes | 1024 | yes |
| flat | software WebGL (CI) | no | — | no |

Measured headless on an M1 (Metal) with `scripts/goldline-capture/cpe-perf.mjs`, which runs about half the speed of a
real browser window: desktop 32–38 fps, phone 46–53 fps; Beverly Hills measures 12–17 on the same harness.

Capture every room: `node scripts/goldline-capture/cpe-shot.mjs <outDir>` (desktop) or `cpe-phone.mjs <outDir>` against
the `goldline-verify-visual` server on port 5178. Pictures from the quality pass sit in
`artifacts/century-park-east/quality-pass/`.
