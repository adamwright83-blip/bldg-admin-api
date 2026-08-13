# corridor_02 — PLAYABLE

This corridor now has production-source environment plates, a canonical
Trailblazer sheet, and a static six-role population atlas integrated as review
candidates. The product owner approved the final Pixel/mobile runtime review on
2026-08-13, including continuity through the market, cliff approach, broken
way, and new-ground beats.

`manifest.json` declares `"stage": "playable"`, which means:

- `scripts/validateCorridorManifest.mjs corridor_02` validates it,
- the runtime may serve it through the normal corridor-transition path,
- `corridorRegistry.ts` lists it with `playable: true`.

## What is real here

| File              | Status                          | Notes                                             |
| ----------------- | ------------------------------- | ------------------------------------------------- |
| `manifest.json`   | REAL                            | Declares stage, parallax, landmarks, capabilities |
| `traversal.json`  | REAL                            | Authored interaction anchors                      |
| `occlusion.json`  | REAL                            | Authored z-order zones                            |
| `gold_route.json` | REAL, re-traced from `mid.webp` | See below                                         |
| `far.webp`        | PRODUCTION CANDIDATE            | 800×1200 coastal depth plate                      |
| `mid.webp`        | PRODUCTION CANDIDATE            | 933×1400 market passage and embedded Line         |
| `foreground.webp` | PRODUCTION CANDIDATE            | 800×1200 real-alpha near stone/foliage frame      |
| `effects.webp`    | PRODUCTION CANDIDATE            | 1000×666 real-alpha non-semantic light/haze       |

The manifest also contains six presentation-only ambient spatial records and
three mission anchor slots. They contain no mission, contact, account, or
outcome truth. Runtime mission projection may bind a real mission to one slot;
the manifest itself cannot create one.

`gold_route.json` was re-traced from the final `mid.webp` on 2026-08-13. Its 14
points follow the visual centre between the paired brass rails from the entry
medallion through the market, stair, cliff, and ruined-arch approach. Source
pixels were converted through the Pixel portrait fit-cover crop into runtime
lateral coordinates, and a saved inspection overlay was used to verify the
route against the plate.

## What remains missing or intentionally absent

- `portal_coldcall.webp` — only if this corridor should host a Cold Call portal
- `stronghold.webp` — only if this corridor should host a Stronghold
- final environmental audio/video assets remain separate production needs
- corridor-specific premium environmental audio/video remains a separate need

The portal and Stronghold capabilities remain `false`; no missing optional art
is being implied by the runtime.

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

Those references remain excluded. Six later production-source PNGs supplied on
2026-08-13 were processed deterministically without generative repainting:

- coastal vista → `far.webp`
- market passage → `mid.webp`
- real-alpha floral/stone frame → `foreground.webp`
- only the non-semantic upper haze/light crop → `effects.webp`
- six adult roles → shared `../population/coastal_roles.webp`
- complete canonical action sheet → the 12 Trailblazer runtime states

The lower fractured-Line portion of the effects source was deliberately not
exported: baking a strained semantic state into L4 would violate the
authoritative presentation boundary. The extra airborne Trailblazer pose was
also left unused rather than mislabeled as a runtime state. The population
lineup contains touching neighboring figures; its six cells use clean vertical
seams without invented/inpainted anatomy and require edge-quality review.

Four replacement Corridor 02 production-source PNGs supplied later on
2026-08-13 supersede only the environment candidates above: a distant coastal
vista supplies L0, one continuous market-to-ruins world supplies L1, a
real-alpha coastal frame supplies L3, and a real-alpha sunlight/mist plate
supplies L4. The new effects source is entirely non-semantic, so no fractured
Line material is present. The Trailblazer and population exports were preserved
unchanged. The product owner approved the resulting runtime journey on
2026-08-13; the manifest records that approval rather than a tool-generated
visual decision.

## Promotion record

The deterministic Pixel/mobile journey was approved by the product owner at
`2026-08-13T16:00:46.000Z`. Portal and Stronghold capabilities remain `false`
because no matching C02 art was supplied. Production promotion is validated
with `node scripts/validateCorridorManifest.mjs corridor_02` and the corridor
contract suite.

See `docs/goldline-corridor-authoring.md` for the full authoring guide.
