# Corridor Authoring Guide

How to add a new corridor pack (e.g. `corridor_02`) to Goldline. This
describes the *contract* a corridor must satisfy — it does not itself add
corridor_02. Slice 26 intentionally ships this documentation plus a
validator and schema, not a second corridor's final art.

A corridor is a directory under `client/public/assets/goldline/<corridor_id>/`
containing layered background art, gameplay metadata, and a manifest
declaring all of it. `corridor_01` is the reference implementation — copy
its structure, not its content.

## 1. Required files

| File | Purpose |
|---|---|
| `manifest.json` | Declares every asset/data file below. Validated by `scripts/validateCorridorManifest.mjs`. |
| `mid.webp` | The mid-ground layer (L1). The only asset that is **required** — everything else may be `null` in the manifest if the corridor doesn't use it. |
| `far.webp` | Background/sky layer (L0), slow parallax. |
| `foreground.webp` | Near layer (L3) that occludes the avatar at points along the route. |
| `effects.webp` | Ambient particle/effects sprite sheet (L4). |
| `portal_coldcall.webp` | The physical Cold Call portal art, placed at the corridor's cold-call anchor. |
| `stronghold.webp` | The Anchor/Stronghold destination art at the end of the corridor. |
| `traversal.json` | Interaction anchor + occlusion zone metadata (see `client/src/game/world/corridorAnchors.ts`). |
| `occlusion.json` | Foreground occlusion zone definitions. |
| `gold_route.json` | The authored gold path (see Section 4). |

Video (`waterfallVideo`) is optional — corridor_01 ships without one; set it
to `null` in the manifest if unused.

## 2. Art dimensions and aspect

- Author each layer at a consistent canvas width so parallax layers line up;
  corridor_01's layers share a common width with per-layer height sized to
  their content (sky layers taller, foreground layers shorter).
- Export as WebP. Compress with Python/PIL (quality 78-88, cap max dimension
  around 2400px) — corridor_01's full six-layer set compresses from ~20MB of
  source PNGs to under 1.5MB. Keep raw originals in a local `_originals/`
  subdirectory (gitignored) rather than committing them.
- All layers except `far` need a transparent background (alpha channel) so
  lower layers show through. `far` is opaque — it's the backdrop.

## 3. Transparent layers and occlusion

`foreground.webp` and `effects.webp` must be authored with real alpha, not a
solid-color matte — the avatar needs to visually pass behind foreground
elements (pillars, arches, foliage) at the x-ranges declared in
`occlusion.json`. Each occlusion zone is a horizontal band (start/end
progress) plus a z-order hint; get the zone boundaries from the actual pixel
extents of the foreground art, not guesswork.

## 4. Gold-path tracing methodology

The gold route is not authored freehand — it's traced from the actual
painted art so the visual gold line and the gameplay corridor agree. The
process used for corridor_01's `gold_route.json`:

1. Load `mid.webp` (the layer carrying the painted gold path) in PIL.
2. Build a gold-pixel mask by color threshold: `R > 150, G < R, B < G - 10, R - B > 60`.
3. Band the image into ~24 horizontal strips top-to-bottom.
4. For each strip, compute the centroid x of masked pixels — that's one
   `{ progress, lateral }` control point (`progress` = normalized strip
   position, `lateral` = normalized x, 0.5 = center).
5. Where the trace loses fidelity (ambient gold background art rather than
   the actual path, usually near a destination/gate), extrapolate the
   remaining points toward the known gate position instead of trusting the
   mask.
6. Sort by `progress`, dedupe, save as `gold_route.json`. Runtime
   interpolation is piecewise-linear (`client/src/game/world/goldRoute.ts`) —
   it does not need many points, just enough to track visible curvature.

Do not hand-place gold route points against a mental estimate of the art —
re-run the pixel trace. A hand-guessed route is exactly the kind of
mismatch the Visual Quality Gate exists to catch.

## 5. Landmarks

Physical mission landmarks (Gatekeeper/Ghost/Staller/Watchtower/Scout, plus
the Anchor/Stronghold) are drawn procedurally as vector Graphics in
`GoldlineGame.ts` (`drawLandmark`) — they are not separate art assets, so a
new corridor does not need landmark sprites. If a corridor wants a distinct
landmark *position*, that's driven by the corridor's own anchor data in
`traversal.json`, not by new files here.

## 6. Testing a new corridor

1. Run `node scripts/validateCorridorManifest.mjs <corridor_id>` — confirms
   the manifest is schema-valid and every referenced file exists on disk.
2. Add/extend a unit test analogous to `shared/corridorManifest.test.ts` and
   `client/src/game/world/goldRoute.test.ts` for the new route data.
3. Run the browser verification harness
   (`node scripts/verifyPlayableGoldline.mjs`) against the new corridor once
   it's wired into a selectable route, checking each world state renders
   without console errors.
4. Take real screenshots and grade them against the Visual Consistency
   Contract below before calling the corridor done — a schema-valid manifest
   proves the files exist, not that the corridor looks right.

## 7. Performance budget

Stay within the existing bundle budget gate
(`scripts/checkGoldlineBundleBudget.mjs`): new corridor *code* must not push
the main bundle over its budget. Corridor art is loaded at runtime as static
assets, not bundled into JS, so image weight doesn't count against that
budget directly — but keep total per-corridor art weight in the same
ballpark as corridor_01 (~1.5MB) so load time on mobile stays reasonable.

## Visual Consistency Contract

A new corridor must read as the same game as corridor_01, not a different
art style bolted on. Concretely:

- **Palette**: bright tropical/coastal language — white/cream stone,
  turquoise water and sky, warm gold accents. Avoid desaturated or dark
  palettes; Goldline's world is meant to feel sun-lit and inviting.
- **The gold route** is always rendered as a warm gold line/glow, dimmed
  (not hidden) during `contested`/`recovery_active` world states — never a
  different color per corridor.
- **Semantic landmark colors** are fixed across all corridors: Gatekeeper
  reads as a checkpoint/bar in a challenge color, Ghost as a slow pulsing
  beacon, Staller as a clockwork/ticking ring, Anchor/Stronghold as the
  warm destination structure. A player who has played corridor_01 should
  recognize a Gatekeeper in corridor_02 on sight.
- **Character scale**: the avatar's authored proportions
  (`client/public/assets/goldline/characters/trailblazer/`) are shared
  across all corridors — never stretch or resize the character sprite to
  fit a corridor's art; scale the *art* to match the character's established
  ground-contact size instead.
- **HUD restraint**: no new HUD chrome per corridor. Corridor-specific
  information (route guidance, landmark labels) uses the same restrained
  world-space label system as corridor_01, not additional screen-space UI.
- **One coherent scene**: per the Visual Quality Gate, an expensive
  background paired with a cheap/vector-only foreground element is a FAIL.
  If a corridor's background art is fully painted, any new foreground
  element (portal, landmark accent) must match that fidelity or be reduced
  to a restrained glow/effect rather than a competing vector shape — the
  same call made for corridor_01's Cold Call portal treatment.
