**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# Goldline runtime inventory

## Already exists

| Primitive | Production owner | Current behavior | Wayward reuse |
|---|---|---|---|
| Points, polygon surfaces, corridors, materials | `client/src/pages/goldline/overworld/types.ts` | Versioned physical-world schema | Reused directly by `futureStages.ts` |
| Collision and edge sliding | `overworld/navigation.ts` — `isWalkable`, `moveWithCollision` | Radius-aware polygon/corridor collision | Reused directly |
| Corridor assist | `overworld/navigation.ts` — `applyCorridorAssist` | Keeps narrow bridges playable on touch | Reused for tether bridge |
| Invalid-position recovery | `overworld/navigation.ts` — `nearestValidPoint` | Returns a grounded authored point | Reused by injected maps |
| Perspective | `overworld/OverworldRuntime.ts` — `updatePlayerPresentation` | Screen-depth character scaling and ground contact | Extended with optional authored depth curve |
| Camera | `overworld/OverworldRuntime.ts` — `updateCamera` | Bounded cover camera, damping and velocity look-ahead | Extended with per-stage zoom/look-ahead |
| Occlusion | `overworld/OverworldRuntime.ts` — `buildOccluders` | Polygon masks a copy of the aligned world plate above the avatar | Reused for near rigging/crates |
| Input | `GoldlineOverworld.tsx` — `DynamicJoystick`; `overworld/movement.ts` | Touch/keyboard analog movement with acceleration | Movement integrator reused; touch surface is Wayward-local (see below) |
| Trailblazer | `OverworldRuntime.ts` plus `public/assets/goldline/characters/trailblazer/directional/` | Directional idle/walk frames | Reused unchanged |
| Destinations and traversal | `overworld/types.ts`, `OverworldRuntime.performContextAction` | Proximity, entry and authored path traversal | Superseded in the Wayward by the voyage's own beats (see below) |
| Checkpoint | `overworld/checkpoint.ts` | Identity-scoped positional continuity | Global overworld unchanged; Wayward consequence state is separately fantasy-only |
| Mobile resize | `OverworldRuntime.initialize/resize/destroy` | ResizeObserver, visualViewport, orientation and teardown | Reused unchanged |
| Navigation debug/test fixture | `OverworldRuntime.installTestApi`, `Driver.tsx` | Compile-time harness and geometry inspection | Wayward fixture uses the same harness gate |
| Colosseum combat/finale | `ColosseumBossGate.tsx`, `colosseumCombat.ts` | Directional movement, shield, projectiles, boss-resolution callback | Preserved; callback unlocks fantasy only |

## Wayward gaps addressed

- The runtime hard-coded one map. `GoldlineOverworldRuntime.create` now accepts an optional existing `OverworldMapDefinition`.
- Camera and perspective constants could not be authored per environment. Minimal optional presentation values now tune the same runtime.
- The runtime had no small live-stage actor list or route seam. Optional actor sprites and a gold route use the existing Pixi world and ticker.
- Persistent fantasy consequences had no Wayward-specific record. `waywardProgress.ts` stores only fictional unlock/visit/guardian/cache/tether/relic state, scoped by player identity.

## The Wayward voyage (2026-09-23)

The Wayward became the first Road Encounter (`client/src/pages/goldline/wayward/`). It needed
things the Overworld runtime cannot do from outside — scene changes (deck → side-on span →
under sail), frame-animated companions and NPCs, a physics swing, camera shake/roll and a
colour-drained RECOIL — and `OverworldRuntime.ts` was not editable while the Overworld
progression branch (#237) was open. So it is an isolated Wayward-local Pixi scene, and says
exactly what it reuses and what it does not:

| Reused unchanged | Wayward-local, deliberately (reconcile after #237 lands) |
|---|---|
| `overworld/navigation.ts` — `isWalkable`, `moveWithCollision`, `pointInPolygon` (the voyage's ground is `OverworldMapDefinition`s in `waywardMaps.ts`) | Camera (framing per beat, shake, punch, roll) |
| `overworld/movement.ts` — `remapAnalogInput`, `stepVelocity` | Trailblazer/Rook/inspector sprite presenters (`actors.ts`, `inspectors.ts`) |
| `overworld/types.ts` — the physical-world schema | Touch: drag-anywhere to move and tap-anywhere to act, handled without a React render per move (one-handed; `DynamicJoystick` has no tap-to-act) |
| `AudioManager` — every cue is a synthesized one-shot in the shared table | The Linehook swing (`holdTheLine.ts`), which is a physical question, not a canned path |
| Trailblazer's directional frames and action poses, unchanged | Resize/visibility lifecycle |

The duplication in the right-hand column is the price of not touching an active branch. When
the Overworld runtime is free again, the camera and the character presenters are the first
candidates to become shared — the voyage is the second real stage, which is what proves them.

## Do not duplicate

Do not create another collision system, joystick, movement integrator, directional-character renderer, camera loop, checkpoint schema, destination/proximity system, traversal runner, resize lifecycle or Colosseum campaign projection. New stages compose the production overworld primitives. Crystal Chasm may extend live combat/effect capabilities later, but must not replace the physical-world contract.

## Known art limitation

The Wayward proof uses a compressed native-dimension derivative of the supplied flattened concept. Foreground occlusion masks select credible rigging/crate regions from the aligned plate; final production should replace those selections with clean transparent authored exports. The concept is never described as final layered art.
