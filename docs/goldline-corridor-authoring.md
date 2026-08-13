# Goldline corridor authoring guide

The goal of this document is that **corridor_03, corridor_04 and corridor_05
are content additions, not engineering projects.** Adding a corridor should be:
drop a directory in, validate it, promote it. No renderer changes.

If you find yourself needing to edit `GoldlineGame.ts` to add a corridor,
something in this contract is missing — fix the contract rather than
special-casing the corridor.

---

## 1. Directory layout

Every corridor is one directory under `client/public/assets/goldline/`:

```
client/public/assets/goldline/corridor_NN/
  manifest.json      # REQUIRED — the contract itself
  traversal.json     # REQUIRED — interaction anchors
  occlusion.json     # REQUIRED — z-order zones
  gold_route.json    # REQUIRED — the authored centreline
  README.md          # REQUIRED — what is present, what is missing
  far.webp           # optional art (L0)
  mid.webp           # art (L1) — required to be *playable*
  foreground.webp    # optional art (L3)
  effects.webp       # optional art (L4)
  portal_coldcall.webp   # optional art — only if hosting a Cold Call portal
  stronghold.webp        # optional art — only if hosting a Stronghold
  waterfall_01.webm      # optional environmental video
```

The corridor is addressed **by id** at runtime:

```ts
const pack = await loadCorridorPack("corridor_02");
```

No caller ever names an individual asset URL. `corridorGameAssets(pack, …)`
turns the validated manifest into the renderer's arguments.

---

## 2. REQUIRED STRUCTURAL DATA vs OPTIONAL FINAL ART

This distinction is the heart of the contract.

|                                                                        | Makes the corridor… | Missing means…                            |
| ---------------------------------------------------------------------- | ------------------- | ----------------------------------------- |
| `traversal.json`, `occlusion.json`, `gold_route.json`, `manifest.json` | **coherent**        | the corridor is broken; validation fails  |
| `mid.webp`                                                             | **playable**        | corridor must stay `stage: "authoring"`   |
| `far`, `foreground`, `effects`, `portal`, `stronghold`, video          | **finished**        | corridor still playable, visually thinner |

A corridor whose art is unfinished is **not broken** — it is an _authoring_
corridor. Declare that honestly with `"stage": "authoring"` and the runtime
will refuse to serve it while validation still checks its structure.

**Never** generate substitute art to make a corridor look complete. An honest
absence beats a low-quality stand-in shipped as production.

---

## 3. `manifest.json` schema

Defined and enforced in `shared/corridorManifest.ts`.

```jsonc
{
  "id": "corridor_02", // MUST match the directory name
  "version": 1,
  "stage": "authoring", // "playable" | "authoring" (default "playable")

  "assets": {
    // every value nullable; null = not supplied
    "far": null,
    "mid": null, // non-null REQUIRED when stage is "playable"
    "foreground": null,
    "effects": null,
    "portal": null,
    "stronghold": null,
    "waterfallVideo": null,
  },

  "data": {
    // all three REQUIRED at every stage
    "traversal": "traversal.json",
    "occlusion": "occlusion.json",
    "goldRoute": "gold_route.json",
  },

  "parallax": {
    "far": 0.08, // 0.05–0.15, schema-enforced
    "mid": 0.4, // 0.3–0.6, optional
  },

  "qualityVariants": [
    // at least one
    { "id": "premium" },
    { "id": "reduced" },
  ],

  "landmarks": [
    // semantic landmarks the world can stage against
    {
      "id": "stronghold_gate", // MUST match a traversal.json anchor id
      "archetype": "ANCHOR", // ANCHOR|GATEKEEPER|GHOST|STALLER, or null
      "position": { "progress": 0.83, "lateral": 0 },
    },
  ],

  "capabilities": {
    // what this corridor can physically host
    "coldCallPortal": false, // requires assets.portal — schema-enforced
    "stronghold": false, // requires assets.stronghold — schema-enforced
    "missionSources": [], // field | cold_call | recovery | scout
  },

  "loadPriority": {
    "critical": ["mid"], // must resolve before the corridor presents
    "deferred": ["far", "effects"],
  },
}
```

### Rules the schema enforces for you

- `stage: "playable"` **requires** `assets.mid`.
- `capabilities.coldCallPortal` **requires** `assets.portal`.
- `capabilities.stronghold` **requires** `assets.stronghold`.
- Landmark ids must be unique.
- Parallax stays inside the authored depth ranges.
- Manifest `id` must equal the directory it loaded from (checked at runtime).

A corridor **cannot silently become production-playable.** Claiming
playability is a claim the schema checks.

---

## 4. Coordinate system

One system everywhere, so anchors, occlusion, route and landmarks agree:

- **`progress`** — `0..1` along the corridor. `0` is the entry, `1` the far end.
- **`lateral`** — `-1..1` across it. `0` is the centreline, negative is left.

`gold_route.json` is the exception worth knowing: its `lateral` values are a
`0..1` fraction of **screen width** (the route's own centreline), because the
player's joystick deviation is added on top of the route rather than replacing
it. See `client/src/game/world/goldRoute.ts`.

Landmark positions in `manifest.json` **must** match the corresponding
`traversal.json` anchor. `shared/corridorContract.test.ts` asserts this for
every shipped corridor — a manifest that describes a corridor which does not
exist fails the build.

---

## 5. Authoring each data file

### `traversal.json` — interaction anchors

```jsonc
{
  "version": 1,
  "anchors": [
    {
      "id": "stronghold_gate",
      "type": "stronghold", // "comms_portal" | "stronghold"
      "position": { "progress": 0.83, "lateral": 0 },
      "labelRadius": 0.18, // distance at which the label fades in
      "interactionRadius": 0.06, // tighter radius where ENGAGE appears
      "missionBinding": "active_mission_encounter",
    },
  ],
}
```

`labelRadius` must be larger than `interactionRadius`, or the player will
never see what they are about to engage.

### `occlusion.json` — z-order zones

```jsonc
{
  "version": 1,
  "zones": [
    {
      "id": "gate_pillar_left",
      "bounds": {
        "progressMin": 0.78,
        "progressMax": 0.86,
        "lateralMin": -0.5,
        "lateralMax": -0.14,
      },
      "occluderZIndex": 5,
    },
  ],
}
```

When the avatar's world position enters a zone, the L3 foreground draws over
it. Zones should follow the actual foreground art silhouette.

### `gold_route.json` — the authored centreline

```jsonc
{
  "version": 1,
  "points": [
    { "progress": 0.0, "lateral": 0.5 },
    { "progress": 0.83, "lateral": 0.52 },
  ],
}
```

**Trace this from the real art, not by eye.** corridor_01's points were
produced by scanning `mid.webp` for gold-inlay pixels
(`R>150, G<R, B<G-10, R-B>60`) in horizontal bands and taking each band's
centroid. A corridor authored before its art exists may ship a placeholder
centreline, but it **must be re-traced before promotion** — note that clearly
in the corridor README.

Points are interpolated piecewise-linearly and clamped at both ends.

---

## 6. Art expectations

- **Format:** WebP for stills, WebM for video.
- **Transparency:** `foreground.webp` and `portal_*.webp` **must** have real
  alpha — they occlude, so a baked-in background defeats the layer.
- **Reference dimensions:** match corridor_01's plates so parallax maths and
  camera framing behave consistently.
- **Size:** keep each plate in the same order of magnitude as corridor_01's
  (~90–380 KB). Textures stay **external assets** — never inline them into JS,
  which would blow the Goldline bundle budget.
- **Quality variants:** `reduced` may drop particles, ambient effects and
  environmental video. It must **keep** world composition, Trailblazer, mission
  landmarks, the gold route, and readability of both route and interactions.
  `reduced` is a lighter world, never a blank canvas with a HUD.

---

## 7. Population and mission-space authoring

`population.ambient` is presentation-only. It may describe a stable id,
generic sprite role, authored position/path, depth, facing, idle activity,
visibility radius, and occlusion behavior. It must never contain a mission,
contact, account, candidate, opportunity, or outcome field; the strict schema
rejects those additions.

`population.missionAnchorPoints` are empty spatial slots. They provide only
position, facing, staging radius, camera framing, capacity, and nearby ambient
compatibility. Live authoritative mission projection chooses a slot at
runtime. No mission binding is written back into the manifest or checkpoint.

An engineering pack may use `assetStage: "engineering_placeholder"` with a
null atlas. Production promotion requires a compact final human WebP atlas,
`assetStage: "production"`, and explicit human review metadata. A validator
pass cannot grant visual approval.

## 8. Validate

```bash
node scripts/validateCorridorManifest.mjs corridor_02
```

This checks the schema **and** that every referenced file exists on disk, then
reports stage, engineering completeness, machine-checkable production
blockers, optional absent art, route-retrace state, and human-review state
separately:

```
  STAGE: authoring
  ENGINEERING: complete (structural data valid)
  PRODUCTION CLOSURE: BLOCKED — assets.mid, population.assetStage, population.atlas, visualReview
  OPTIONAL ART ABSENT: far, foreground, effects, portal, stronghold, waterfallVideo
  GOLD ROUTE: RETRACE BLOCKED — final assets.mid is required before tracing
  HUMAN VISUAL: PENDING — approval must come from an actual reviewer after screenshots
  VISUAL: BLOCKED BY REQUIRED PRODUCTION ASSETS / REVIEW
  NOTE: this corridor is NOT production-playable; the runtime will refuse to serve it.
```

Also run the contract tests:

```bash
npx vitest run shared/corridorContract.test.ts
```

---

## 9. Promotion checklist

1. Final art in the corridor directory.
2. `assets.*` filled in for everything supplied.
3. `gold_route.json` **re-traced** from the real `mid.webp`.
4. `capabilities.*` set only where backing art exists.
5. Capture the deterministic mobile journey and obtain explicit human visual
   approval; record the real reviewer and timestamp in `visualReview`.
6. `"stage": "playable"`.
7. `playable: true` for the corridor in
   `client/src/game/world/corridorRegistry.ts`.
8. `node scripts/validateCorridorManifest.mjs corridor_NN` passes with no
   production-closure blockers.
9. `npx vitest run shared/corridorContract.test.ts` passes.

---

## 10. Engineering PASS is not Visual PASS

They are reported separately and neither implies the other.

**Engineering PASS** — architecture works, business truth preserved, tests
pass, lifecycle clean, performance gates green, no regression. Fully
determinable in CI.

**Visual PASS** — the supplied production art actually looks correct: route
alignment reads, transitions feel intentional, encounter staging is
game-native, no clipping/pop/black flash, foreground occlusion sits right.
**Requires a human looking at it on a real device.** CI cannot grant it.

A corridor with `stage: "playable"` and a green build is engineering-complete.
It is not visually approved until someone has looked.

---

## 11. Reality-driven placement

Corridors are **not** levels and are never picked at random. Which corridor the
player is in is a deterministic projection of authoritative business state —
see `shared/corridorProjection.ts`.

`capabilities.missionSources` and `capabilities.stronghold` are how a corridor
tells the projection what it can stage. The projection will never route a
mission into a corridor that did not declare it can host it, and never selects
a corridor whose registry entry is `playable: false`.

There is no XP curve, no level counter, and no "unlock". If a corridor should
be reachable, it needs the capability and the registry flag — not a threshold.
