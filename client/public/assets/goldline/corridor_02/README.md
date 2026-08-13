# corridor_02 — AUTHORING STAGE (not production-playable)

This corridor now has production-source environment plates, a canonical
Trailblazer sheet, and a static six-role population atlas integrated as review
candidates. It remains `authoring`: the required Pixel/mobile screenshots have
not received explicit human visual approval, and reviewers must specifically
judge whether this supplied plate set reads as one continuous corridor through
the market, cliff approach, broken way, and new-ground beats.

`manifest.json` declares `"stage": "authoring"`, which means:

- `scripts/validateCorridorManifest.mjs corridor_02` validates it,
- the runtime **refuses** to serve it as the live world
  (`CorridorNotPlayableError`),
- `corridorRegistry.ts` lists it with `playable: false`, so the reality-driven
  projection can never route a player into it.

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
- explicit human visual review metadata after the deterministic mobile journey

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
unchanged. Corridor 02 remains authoring-only pending human review of the new
runtime journey.

## Promoting corridor_02 to playable

1. Review the required deterministic Pixel/mobile screenshots on real device
   framing, including reduced-motion/reduced-quality proof.
2. Set `capabilities.coldCallPortal` / `capabilities.stronghold` to `true`
   **only** if the matching art is present — the schema enforces this.
3. Record explicit human review in `visualReview`; the schema rejects a
   playable corridor whose review remains pending.
4. Change `"stage"` to `"playable"`.
5. Set `playable: true` for `corridor_02` in
   `client/src/game/world/corridorRegistry.ts`.
6. Run `node scripts/validateCorridorManifest.mjs corridor_02`.

See `docs/goldline-corridor-authoring.md` for the full authoring guide.
