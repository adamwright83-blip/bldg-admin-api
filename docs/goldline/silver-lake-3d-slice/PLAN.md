# Silver Lake 3D slice: one cottage, one villager, one real action

Status (2026-10-19): first playable slice SHIPPED at the Silver Lake link (`/growth/lantern-city?cozy=1&territory=silver-lake`).
Code: `client/src/pages/goldline/silverLake3d/`; assets: `scripts/assets/silver-lake/` -> `client/public/assets/goldline/silver-lake-3d/`.
Every Silver Lake entry (Home, the golden messenger from #654, territory rooms, deep links) opens the 3D courtyard.
The painted 2D encounter is ARCHIVED and has no route. Its business wiring, including Phase 4 server memory (#656),
lives in `client/src/pages/goldline/silverLake3d/useSilverLakeOutreach.ts`.

## Art direction (binding)

Lantern City and Silver Lake are a **cozy game**. The 3D courtyard must look like the painted Silver Lake plate in
`client/public/assets/lantern-villager-outreach/environment/` brought to life: rounded cottages, flower boxes,
warm lanterns, soft clouds, chunky friendly characters, saturated warm palette, gentle light, foliage everywhere.

**Coastal Market's look is rejected.** Nothing visual carries over: not its Quaternius bodies, materials, cliffs,
sky, tone mapping or colour grade. Only its invisible code carries over (physics, camera, input, loaders).
Every render is checked against the painted plate before anyone sees it.

## The five minutes an investor plays

1. Lantern City shows the amber Silver Lake lantern (#654). One tap.
2. The camera drops into a small 3D courtyard: cobbles, a fountain, Barnaby's cottage, Bramble's cottage
   (exterior only), lanterns, trees moving. The player character stands at the courtyard edge.
3. The player walks or runs (keyboard, or the floating thumbstick on a phone), hops a low wall, and reaches Barnaby.
   Barnaby turns to face them. A small "Talk" prompt appears. His greeting depends on Phase 4 memory.
4. Talk moves the camera to his writing desk and opens the existing Letter Desk as an overlay.
   The player picks an approach, edits, approves, and opens Google Messages or schedules.
   Every state stays truthful: opening the composer is not a send.
5. The player places the reading bench. They leave, come back, and the bench is still there,
   and Barnaby greets them as a returning friend.

Demo data: the existing synthetic targets (`buildSyntheticSilverLakeTargets` in `shared/playableVillagers.ts`,
customer ids prefixed `synthetic:`) so a pitch never shows a real customer or implies a real send.

## What is reused, checked against the code

| Piece | File | Verdict | Why |
|---|---|---|---|
| Spring-arm camera | `coastalMarketProof/runtime/followCamera.ts` | As is | Takes only a camera, a `COL_cam` BVH and an optional floor BVH. No route. |
| Level splitter + BVH colliders | `runtime/level.ts` `splitLevel` | As is | Any glTF whose nodes are named `VIS_*`, `FAR_*`, `COL_walk`, `COL_wall`, `COL_cam` works. |
| Motion helpers | `runtime/motion.ts` | As is | Pure math. |
| Walk / jog / sprint / jump blending, foot planting | `runtime/character.ts` `Locomotion` | As is | Needs `idle` + `walk` clips minimum; the current rig ships them in `anims_a/b.glb`. |
| Player physics (capsule walls, floor ray, jump, mantle) | `runtime/controller.ts` | Small extraction | Physics never reads the route. The route is used only for chase progress, respawn (`lastSafeS`), footstep surface by segment kind, chase gates, and `placeAt`. Replace `Route` with a two-method interface: `surfaceAt(p)` and `respawnPoint()`. Keep Coastal Market working through an adapter. |
| Touch + keyboard input | `runtime/input.ts` | Small change | Generic thumbstick and look-drag, but it hard-creates JUMP and LINE buttons. Make the action buttons a constructor option (JUMP, TALK). |
| Townsfolk | `runtime/npcs.ts` | Leave | Placed by chase metres along the route. Pattern is useful; code is not. |
| Chase set, crane, ropeway, Rook | `runtime/phase2World.ts`, `autopilot.ts` | Leave | Entirely chase-specific. |
| Ocean / waterfall audio | `runtime/audio.ts` | Leave | Synth tuned to the harbour. Use `client/src/game/audio/AudioManager.ts` instead (already has cue ids, mute and unlock). |
| Bootstrap | `runtime/CoastalProofRuntime.ts` | Copy the skeleton | Renderer, loader, progress and dispose pattern are right; the 665 lines are wired to the chase. A new `SilverLakeRuntime.ts` copies the first ~140 lines and the dispose discipline. |
| Letter Desk, consent, send/schedule/SMS handoff | `LanternCitySceneV6/PlayableLetterDesk.tsx` (#656) | As is | Rendered as a React overlay above the canvas. No business logic moves. |
| World memory | `server/experience/lanternCity/neighborhoodMemoryService.ts` (#656) | As is | `getNeighborhoodMemory`, `saveNeighborhoodFeature`, `recordVillagerInteraction`, `saveUnfinishedLetterDraft` already exist as procedures. |

Entry point: `LanternCityScene.tsx` already opens `CozyNeighborhoodEncounter` for `?cozy=1&territory=silver-lake`.
Add `&walk=1` to mount the 3D encounter instead, keep the painted encounter as the fallback until the 3D one is
proven on a real phone.

## What is new

- **Hero (decided 2026-10-19: a new male adventurer, as in the ChatGPT mockup).** Built on a CC0 KayKit
  Adventurers body (chunky, cozy proportions, rigged) and restyled in Blender: messy brown hair, green scarf,
  olive shirt, worn brown jacket, satchel, patched trousers, boots. Animated with the CC0 KayKit Character
  Animations on the same rig (walk, run, jump, interact, wave, sit), so no retargeting.
- **Courtyard level glb.** Built and dressed in Blender to match the painted plate, using CC0 kits where they fit:
  Kenney Fantasy Town Kit (cottages, fences, lamps; glTF; CC0) and the Quaternius Stylized Nature MegaKit Standard
  tier (trees, flowers, rocks; glTF; CC0), recoloured to the plate's palette.
  Exported with the `VIS_/COL_` naming above so `splitLevel` loads it unchanged. One courtyard, roughly the
  footprint of the painted plate, not eight houses. Kenney describes the kit as fantasy/medieval town pieces:
  use cottages, fences and lamps only, no castle, knight or crown pieces.
- **Barnaby in 3D.** No clean CC0 animated glTF fox was found. Options, in order of risk:
  1. Khronos glTF sample Fox (CC0 mesh, CC-BY 4.0 animation: needs credit) restyled with Barnaby's colours,
     glasses and bow tie. Has Survey, Walk, Run. Fastest, plainest.
  2. Barnaby concept through the existing TRELLIS pipeline, then a Rigify rig. The Rook export taught that
     TRELLIS meshes need decimation and per-vertex colour; rigging one has not been done here yet.
  3. Commercial animated fox (glTF with rig) restyled. Costs money; licence must allow web redistribution.
  Spike option 1 first, so the slice is never blocked on the fox.
- **Interaction.** A proximity trigger around Barnaby, a TALK prompt, a camera move to the desk, and the overlay.
- **One persistent change.** The bench prop appears where `saveNeighborhoodFeature` says it is, on load and on return.
- **Audio.** A cozy ambience bed, footsteps on cobble and grass, a desk chime, ducked while the overlay is open.

## Order of work (each step ends playable, filmed, committed)

1. **Extract.** Route interface in the controller, configurable action buttons in input. Gate: the existing
   `node scripts/coastal-proof/proofHarness.mjs boot` still passes, so Coastal Market is unharmed.
2. **Graybox courtyard.** Boxes and a floor in Blender, the player walks, runs, hops the wall, camera never
   clips. Film it.
3. **Dressed courtyard.** Kit pieces, lighting, trees moving. Film it at desktop 1080p.
4. **Barnaby.** Fox in place, turns to face the player, TALK opens the existing Letter Desk on synthetic data.
5. **Memory.** Bench persists; return greeting comes from Phase 4 memory.
6. **Sound and polish.** Ambience, cues, transitions in and out of Lantern City.
7. **Playtest.** Five people who have not seen JOYSTICK play it cold. Record what they do, not what they say.

## Known limits

- No database locally (Railway MySQL is private-network only). Steps 1 to 4 run on synthetic targets;
  step 5 needs `railway run` or the deployed build to prove persistence.
- Frame rates measured on this Mac are Metal emulation, not a phone.
- The Vercel preview is behind SSO; share builds as a claude.ai artifact (mind the blob: CSP fix in the
  Coastal Market notes).

## Decisions only Adam can make

- ~~Avatar~~ Decided 2026-10-19: a new male adventurer.
- ~~Art style~~ Decided 2026-10-19: cozy, matching the painted Silver Lake plate; Coastal Market's look is out.
- **Barnaby source.** Option 1, 2 or 3 above, judged on whether he looks like he belongs beside the KayKit-based hero.
