# corridor_02 — AUTHORING STAGE (not production-playable)

This corridor exists as a complete **engineering contract**. Its structural
data is real and validated. Its **final production art does not exist yet**,
and nothing here pretends otherwise.

`manifest.json` declares `"stage": "authoring"`, which means:

- `scripts/validateCorridorManifest.mjs corridor_02` validates it,
- the runtime **refuses** to serve it as the live world
  (`CorridorNotPlayableError`),
- `corridorRegistry.ts` lists it with `playable: false`, so the reality-driven
  projection can never route a player into it.

## What is real here

| File              | Status                             | Notes                                             |
| ----------------- | ---------------------------------- | ------------------------------------------------- |
| `manifest.json`   | REAL                               | Declares stage, parallax, landmarks, capabilities |
| `traversal.json`  | REAL                               | Authored interaction anchors                      |
| `occlusion.json`  | REAL                               | Authored z-order zones                            |
| `gold_route.json` | REAL, but **placeholder geometry** | See below                                         |

The manifest also contains six presentation-only ambient spatial records and
three mission anchor slots. They contain no mission, contact, account, or
outcome truth. Runtime mission projection may bind a real mission to one slot;
the manifest itself cannot create one.

`gold_route.json` is an _authored_ centreline, not a _trace_. corridor_01's
route was traced from actual gold-inlay pixels in its `mid.webp`; corridor_02
has no mid plate to trace. The route must be re-traced from the final art
before this corridor is promoted.

## What is missing (all of it art)

- `far.webp` — L0
- `mid.webp` — L1 (**required** for `stage: "playable"`)
- `foreground.webp` — L3 occlusion plate
- `effects.webp` — L4
- `portal_coldcall.webp` — only if this corridor should host a Cold Call portal
- `stronghold.webp` — only if this corridor should host a Stronghold
- a compact final human WebP atlas — the current population is explicitly
  `engineering_placeholder`, not production character art

No substitute or placeholder art has been generated for these. A low-quality
stand-in shipped as production art would be worse than an honest absence.

## PR #55 visual-handoff audit (2026-08-12)

The supplied `goldline_pr55_visual_handoff.zip` was reviewed in full. It
contains nine PNG **references**, not clean production plates or runtime
atlases. None were copied into this directory:

| Supplied reference                           | Runtime disposition                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `01_trailblazer_locked_turnaround.png`       | Character canon only; labeled three-view on an opaque background                    |
| `02_trailblazer_action_reference.png`        | Body-language reference only; not a sequential run/state sheet                      |
| `03_trailblazer_field_kit.png`               | Prop-language reference only; labeled inventory board                               |
| `04_trailblazer_cliff_mood.png`              | Mood reference only; flattened scene with baked heroine                             |
| `05_corridor02_market_reference.png`         | Market art direction only; portrait composition, baked people, and production label |
| `06_corridor02_cliff_approach_reference.png` | Cliff art direction only; flattened portrait scene, not an aligned plate            |
| `07_corridor02_broken_way_reference.png`     | Broken-way direction only; flattened scene with production title                    |
| `08_corridor02_new_ground_reference.png`     | New-ground direction only; flattened scene with production plaque                   |
| `09_line_visual_states_reference.png`        | Renderer vocabulary reference only; labeled design sheet                            |

The handoff's remaining-asset briefs confirm that the clean aligned C02 plate
set, transparent six-role population atlas, and complete canonical
Trailblazer state sheet still need to be produced. Therefore C02 remains
`authoring`, its registry entry remains non-playable, its route remains
placeholder geometry, and `visualReview` remains pending.

## Promoting corridor_02 to playable

1. Drop the final art into this directory.
2. Fill in the corresponding `assets.*` entries in `manifest.json`.
3. Re-trace `gold_route.json` from the real `mid.webp`.
4. Set `capabilities.coldCallPortal` / `capabilities.stronghold` to `true`
   **only** if the matching art is present — the schema enforces this.
5. Replace the engineering population placeholder with the approved atlas and
   set `population.assetStage` to `production`.
6. Record explicit human review in `visualReview`; the schema rejects a
   playable corridor whose review remains pending.
7. Change `"stage"` to `"playable"`.
8. Set `playable: true` for `corridor_02` in
   `client/src/game/world/corridorRegistry.ts`.
9. Run `node scripts/validateCorridorManifest.mjs corridor_02`.
10. Run the visual pass — engineering PASS does not imply visual PASS.

See `docs/goldline-corridor-authoring.md` for the full authoring guide.
