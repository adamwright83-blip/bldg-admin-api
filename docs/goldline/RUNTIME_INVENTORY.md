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
| Input | `GoldlineOverworld.tsx` — `DynamicJoystick`; `overworld/movement.ts` | Touch/keyboard analog movement with acceleration | Reused by Wayward |
| Trailblazer | `OverworldRuntime.ts` plus `public/assets/goldline/characters/trailblazer/directional/` | Directional idle/walk frames | Reused unchanged |
| Destinations and traversal | `overworld/types.ts`, `OverworldRuntime.performContextAction` | Proximity, entry and authored path traversal | Reused for guardian, cache, Linehook and barrier |
| Checkpoint | `overworld/checkpoint.ts` | Identity-scoped positional continuity | Global overworld unchanged; Wayward consequence state is separately fantasy-only |
| Mobile resize | `OverworldRuntime.initialize/resize/destroy` | ResizeObserver, visualViewport, orientation and teardown | Reused unchanged |
| Navigation debug/test fixture | `OverworldRuntime.installTestApi`, `Driver.tsx` | Compile-time harness and geometry inspection | Wayward fixture uses the same harness gate |
| Colosseum combat/finale | `ColosseumBossGate.tsx`, `colosseumCombat.ts` | Directional movement, shield, projectiles, boss-resolution callback | Preserved; callback unlocks fantasy only |

## Wayward gaps addressed

- The runtime hard-coded one map. `GoldlineOverworldRuntime.create` now accepts an optional existing `OverworldMapDefinition`.
- Camera and perspective constants could not be authored per environment. Minimal optional presentation values now tune the same runtime.
- The runtime had no small live-stage actor list or route seam. Optional actor sprites and a gold route use the existing Pixi world and ticker.
- Persistent fantasy consequences had no Wayward-specific record. `waywardProgress.ts` stores only fictional unlock/visit/guardian/cache/tether/relic state, scoped by player identity.

## Do not duplicate

Do not create another collision system, joystick, movement integrator, directional-character renderer, camera loop, checkpoint schema, destination/proximity system, traversal runner, resize lifecycle or Colosseum campaign projection. New stages compose the production overworld primitives. Crystal Chasm may extend live combat/effect capabilities later, but must not replace the physical-world contract.

## Known art limitation

The Wayward proof uses a compressed native-dimension derivative of the supplied flattened concept. Foreground occlusion masks select credible rigging/crate regions from the aligned plate; final production should replace those selections with clean transparent authored exports. The concept is never described as final layered art.
