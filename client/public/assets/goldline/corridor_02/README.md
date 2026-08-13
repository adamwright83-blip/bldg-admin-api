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

| File | Status | Notes |
| --- | --- | --- |
| `manifest.json` | REAL | Declares stage, parallax, landmarks, capabilities |
| `traversal.json` | REAL | Authored interaction anchors |
| `occlusion.json` | REAL | Authored z-order zones |
| `gold_route.json` | REAL, but **placeholder geometry** | See below |

`gold_route.json` is an *authored* centreline, not a *trace*. corridor_01's
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

No substitute or placeholder art has been generated for these. A low-quality
stand-in shipped as production art would be worse than an honest absence.

## Promoting corridor_02 to playable

1. Drop the final art into this directory.
2. Fill in the corresponding `assets.*` entries in `manifest.json`.
3. Re-trace `gold_route.json` from the real `mid.webp`.
4. Set `capabilities.coldCallPortal` / `capabilities.stronghold` to `true`
   **only** if the matching art is present — the schema enforces this.
5. Change `"stage"` to `"playable"`.
6. Set `playable: true` for `corridor_02` in
   `client/src/game/world/corridorRegistry.ts`.
7. Run `node scripts/validateCorridorManifest.mjs corridor_02`.
8. Run the visual pass — engineering PASS does not imply visual PASS.

See `docs/goldline-corridor-authoring.md` for the full authoring guide.
