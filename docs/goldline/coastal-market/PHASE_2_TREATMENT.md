# Coastal Market Phase 2: the Rook Hunt (treatment)

**Status:** proposed 2026-09-24, waiting for Adam to reply **KEEP** or **CHANGE**. No Phase 2 gameplay code
exists or will be written before that reply.

**Scope:** an isolated proof on the three.js route built in Phase 1 (`claude/coastal-market-three-proof`).
Do not merge. Do not deploy.

---

## 0. What Phase 1 left us (audited)

- **Geography:** `build_level.py` lays the coast east to west with the sea to the north and the sun low at
  azimuth 168°. Phase 1 walked downhill: overlook, market lane, arch, stairs, bridge over the waterfall gorge,
  boardwalk, stairs, quay, pier.
- **Why it looked like blockout:** every building is a procedural box with world-space box UVs. Lighting is
  baked AO plus sun visibility only, with no bounce and no post-processing. Trailblazer floats: one sun ray
  and no contact shadow.
- **Why it played slow:** walk only, at 2.1 m/s. There is no gravity or vertical velocity, and ribbon collision
  walls turn the world into a corridor.
- **Canon this treatment relies on:**
  - WORLD_BIBLE §12: *"Rook is rumored captured but is operating an illegal communications network."*
  - WORLD_BIBLE §11: *"whenever Rook attempts a direct lie, his voice simply fails."*
  - WORLD_BIBLE §23: the Linehook is a core verb.
  - GOLDLINE-TASKS resolved decisions: "Hold the Line" is approved. Fouled casts recoil and clean casts bite.
  - ROOK_CONCEPT_SPEC: he walks upright and never hops or flies. His wings are his hands. His back is
    unpainted, so stage his painted side.
  - WORLD_BIBLE §26: *"Gold Line catches Trailblazer."*

## 1. Route (~250 m, ~2.5 min, uphill, away from the sun)

Phase 1 ran downhill toward the sun. Phase 2 runs the other way: up from the water, with the city lit from the
front by the sunset behind her. The coastline, cliff, gorge and waterfall stay where they are. Only the corridor
is rebuilt.

| # | Zone | What happens | Movement |
|---|---|---|---|
| 1 | Pier and quay (start) | Fishermen, carts, a crane working. The cage passes overhead. | jog, sprint |
| 2 | Harbor crane tower | Shutdown horn. **Tension use 1: RIDE.** | hook, ride |
| 3 | Upper terrace | **Hero vista.** | stop, look |
| 4 | Market lane | Shutters slam, freight drops, people run. | sprint, jump, mantle, vault |
| 5 | Gorge | Bridge lifted. **Tension use 2: RELEASE.** Run across the swung jib. | hook, sprint |
| 6 | Rooftops | Gap jumps and chimney mantles. The cableway's cargo hooks cycle overhead. | sprint, jump, mantle |
| 7 | Open cove gap | **Tension use 3: TRANSFER** onto a passing cargo hook. Let go at the apex. | hook, swing, land |
| 8 | The cage | Door open. The reveal. | walk in |

## 2. Cage sighting

The cage is a brass-and-timber cargo cage hung from a **high ropeway cable**. The cable runs from the harbor crane
tower at the quay, over the cove and the market, up to the Harbor Authority's customs tower on the cliff top.

- **At 0:05 on the pier:** a heavy clank overhead. The cage's shadow sweeps across the planks. The camera eases
  upward and frames the cage against the sunset. This is a soft look-at assist; the player can override it at
  any moment. It is not a cutscene.
- **Readable from far away:** the cage is moving, and there is a **signal lamp inside it blinking in shuttered
  bursts**. Moving object plus blinking light reads at any distance. No waypoint.
- **Middle distance:** sealed letters flutter down from it along the route, which tells you a messenger is in
  there. She never opens one.
- **Close:** a bucket-hat silhouette, a long tail through the bars, wings working a lamp key.
- **"I need to get up there"** comes from the cage being high, moving, and heading somewhere.

## 3. The shutdown (one authored event)

**The trigger:** the Harbor Authority spots the cage's blinking lamp. That is an illegal line. They lock the
market down to catch the signal. The shutdown exists *because* of Rook, which sets up the reveal.

This is one timeline, fired once at the crane tower, with every beat keyed off it:

1. The customs horn sounds across the cove.
2. **The ropeway reverses.** It starts hauling the cage toward the customs tower. This is the chase.
3. The crane tower's **counterweight drops** down its shaft. This sets up RIDE.
4. The **gorge drawbridge lifts** and locks. The walking route closes.
5. **Shutters roll down** along the market lane in a wave. Awnings fold and carts are dragged in. Some shutters
   close in front of her.
6. A crane swings its load to the lock position, and a freight net drops onto the lane.
7. **Workers react.** They run, pull kids indoors, haul shutters down and point at the cage.

This is not six systems. It is one `ShutdownTimeline` of keyed animation states that drives authored props.

## 4. The tension system: one rule

> ### HOOK WHAT'S UNDER LOAD. THE LIGHTER SIDE GIVES.

- **Load is visible.** Any line or structure currently carrying real load shows a hair-thin **Gold seam** along its
  load path. This is the WORLD_BIBLE §7 "dormant" visual state. Slack means no seam. The Line cannot be lied to:
  it shows where force actually goes.
- **One input:** the Linehook button. Aim assist picks the best seamed anchor in her view cone.
  - **Hold** to stay coupled.
  - **Let go** to release. Her momentum is kept.
- **The Hold the Line rule carries over unchanged.** The cast needs a clear line: a fouled cast recoils, and a
  clean cast bites.
- **Once it bites, she and the anchor are joined by one rope constraint.** Mass decides what moves:
  - **If the anchor side is heavier and moving,** it moves her: she rides or swings.
  - **If she is heavier than whatever holds the load** (a pin, a latch, a trip line), she moves it. The load is
    released and does what it was straining to do.
- **Implementation:** one `TensionAnchor` data type: anchor transform, a load-vector provider, a mass class and
  on-bite state keys. One solver. One set of Trailblazer poses: cast, hang and swing, built from `Jump_Loop` plus
  arm IK to the rope. **No per-situation prompt, animation or success script.** Each use below is just
  different data.

## 5. The three uses on the route

| Use | Where | Anchor | Heavier side | Result |
|---|---|---|---|---|
| **1. RIDE** | Crane tower (zone 2) | The haul rope on the rising side of the dropping counterweight | The counterweight (≈ 2 t) | She is **yanked about 18 m straight up** to the market terrace. This is the cinematic beat. |
| **2. RELEASE / REDIRECT** | Gorge (zone 5) | The tie-back pin on a crane jib that is guyed back under load | She is (the pin is light) | The pin rips out. The jib swings across the gorge and slams into the far parapet. The jib is now her bridge. |
| **3. TRANSFER** | Cove gap (zone 7) | A cargo hook passing on the moving ropeway loop | The ropeway | She is carried across open air toward the cage. She lets go at the top of the swing and lands on the cage. |

The same button, rule, solver and poses produce three different consequences.

## 6. Threat

- **The shutdown is the enemy.** It shows up as:
  - shutters closing in her path;
  - swinging and dropping freight, which knocks her down (no damage);
  - the lifted bridge;
  - the cage being hauled toward the customs tower in plain view. That haul is the clock you can see.
- **Falls:** the Gold Line catches her (§26 in miniature). The filament snaps tight and returns her to her last
  stable ground a few seconds back.
- **Pace:** the haul is **rubber-banded**, so it always feels close and always lands. The proof has no hard fail
  timer.
- **At most one enemy, and only if the first playable capture feels like a museum tour.** If added, it would be
  the **Latch Warden**, a customs worker who runs to re-lock a mechanism she needs. He does not fight. He is
  lighter than her, so the *same rule* applies: hook him and he is yanked off the latch (WORLD_BIBLE §25,
  Sailmaker's Knot). He serves the tension system and is not a combat game.

## 7. The Rook reveal

1. She lands on the cage's roof rail and drops to the door platform. **The door is swinging open.** It was never
   locked.
2. **Inside is a workshop, not a cell:**
   - a signal lamp with a clacking shutter key;
   - a brass wind-up transmitter;
   - pigeonholes stuffed with letters;
   - ink pots and a pinned coastal chart;
   - a kettle on a tiny stove.
3. Rook is at the lamp with his **painted side toward the camera**. The reveal uses one authored camera, about
   8 s long.
4. The exchange:
   - **TRAILBLAZER:** "Were you trapped in here?"
   - **ROOK:** "Yes—"
     - His voice fails on the direct lie (WORLD_BIBLE §11).
     - The subtitle breaks off mid-word.
     - The audio cuts to a dry click and silence, while his jaw keeps moving for a half-beat.
     - The wind-up key on his hat stops turning.
   - *Beat.*
   - **ROOK:** "...No."
5. **Truth note:** the only thing Rook actually *says* is "...No.", which is true. "Yes—" is a failed attempt and
   is never voiced as a sentence. The failure is the joke. It shows the rule working; it does not break it.
   Every line goes in a line table with a `truth` note, the same pattern as `waywardLines.ts`. A test asserts
   that no Rook line reads as a false statement.
6. **Optional closing beat (cut first if time runs short):** he flips a brake, and the cage stops dead short of
   the customs tower. He was in control the whole time.

## 8. Exact art areas to improve (the corridor only)

**The root fix is a modelled modular kit with real UVs and trim sheets, replacing every box on the corridor.**
Before building the rest, I would show Adam stills of the quay built from the kit. That is a cheap art gate.

1. **Pier and quay:**
   - dressed stone quay blocks with bevelled courses;
   - bollards, mooring rings and water stairs;
   - wet-edge material.
2. **Harbor crane tower (hero landmark):**
   - timber lattice with brass fittings;
   - the sheave wheel;
   - the counterweight shaft.
3. **Upper terrace (hero vista):** a parapet with a worn lip. The composition: the cove below, and the cage on its
   cable crossing the sun.
4. **Market lane:**
   - façade kit: stone ground floor, plaster uppers, timber jetties, balconies, shutters, tiled roofs with real
     overhang and ridge;
   - stall kit: timber frames, sagging cloth awnings, produce, crates and baskets;
   - hanging signs and lanterns.
5. **Gorge:** the drawbridge, the guyed crane jib, and the existing waterfall.
6. **Rooftops:** tiles, chimneys, ridge beams and cloth lines.
7. **The cage and ropeway:** the hero prop, the cable, and the circulating cargo hooks.
8. **Cage interior:** the workshop set.

**Lighting and rendering, for the corridor:**

- Bake full diffuse GI (irradiance with bounce) into lightmaps instead of AO plus sun visibility. Texel density is
  set per kit chunk, and tiny props use vertex AO instead of wasting atlas space.
- A baked SH light-probe grid along the corridor, so Trailblazer, NPCs and moving machinery pick up warm bounce.
- **Trailblazer contact:**
  - probe lighting;
  - a contact shadow (a blob decal plus short-range capsule occlusion);
  - a sun rim;
  - a roughness and normal pass on her clothes, replacing flat vertex colour.
- **One post pass:** half-res bloom, AgX tone mapping, a grade LUT, a vignette and SMAA. A low tier drops bloom.
- **Sky:** fix the pale area near the sun.
- **Traversal readability without paint:**
  - pale worn stone lips and rope-wrapped timber edges mean you can mantle;
  - a Gold seam means the thing is under load.
- **Market activity near the route:** more townsfolk instances (still two base meshes plus palettes), all wired
  to shutdown reactions.

## 9. Assets and animations reused

- **CC0 clips already downloaded, newly exported:**
  - UAL1: `Jog_Fwd_Loop` (~5.3 m/s), `Sprint_Loop` (~8.25 m/s), `Jump_Start`, `Jump_Loop`, `Jump_Land`, `Roll`
    (for hard landings);
  - UAL2: `ClimbUp_1m` (mantle), plus `NinjaJump_*` if it reads as a vault.
  - They share Trailblazer's skeleton, so no retargeting is needed. The IK stride derivation from `character.ts`
    keeps the jog-to-sprint blend skate-free.
- **Trailblazer:** her Phase 1 dressed model and secondary-motion springs.
- **Townsfolk:** the two base meshes, the palettes, the NPC LOD and the push system.
- **Rook:**
  - the approved TRELLIS mesh, unchanged, through `rook_rig.py`'s armature and existing state actions (idle,
    talk, wait, point, shrug);
  - one new flag exports a **decimated, rigged GLB** (~20k tris, concept projection baked to a texture).
- **Phase 1 runtime kept:**
  - the BVH colliders and the spring camera with floor and cliff collision;
  - touch and keyboard input;
  - the water, waterfall, boats and wind uniform;
  - the synthesized audio (adding a horn, ratchets and clanks);
  - the perf meter, the harness (autowalk, sightlines, framing, gate, film), artifact staging, the bundle
    isolation gate and the SHA stamp.
- **Replaced:**
  - the box architecture on the corridor;
  - ribbon collision, which becomes real kit collision;
  - the walk-only controller, which gains gravity, jump, mantle, vault and a hook state.

**Controls:**

- **Phone:**
  - left stick to jog, auto-sprint after about 1 s of full tilt on open ground;
  - right-thumb Jump button;
  - contextual Linehook button;
  - mantle is automatic when running into a ledge up to ~1.1 m; for taller ledges, jump near the ledge.
- **Keyboard:** WASD, Shift, Space, E.

## 10. What I will deliberately NOT build

- Combat, the Lineblade, health, a boss, more than one enemy archetype (and that one only behind the gate
  above).
- Wall-run, free climbing, ledge shimmy, slide, swimming, or a generic traversal framework.
- A rope or cloth physics sandbox. The rope is one distance constraint; everything else is visual.
- More than one shutdown system, or a hard fail timer.
- Background streets, a complete city, or decorating anything the player cannot reach.
- A HUD beyond one contextual prompt. No save, progression or server calls.
- New keyframed animation clips. Where a pose cannot be built from existing clips plus IK, it is reported as an
  art dependency, never faked with a hop or a transform trick.
- Repainting Rook's back, or voice acting.

## 11. Production boundary

- **Isolated proof route only.** The bundle gate must still show three.js only in the lazy proof chunk and
  GoldlineGameHome unchanged.
- **Nothing touches:** production progression, CONTACT authority, Candy Bar, Claire, Twilio, business truth, or
  customer, order or revenue systems.
- **Known continuity issue, documented and not solved here:** main already stages Rook's reveal at Colosseum level
  resolution (the §12 illegal communications network in the Republic's clocks), and shows him in the party right
  after. This proof re-stages a "rumored captured" reveal in Coastal Market. Reconciling the two is a later
  decision for Adam.
- **Do not merge. Do not deploy.**

## 12. Acceptance clip mapping

| Clip requirement | Where |
|---|---|
| 1. An inhabited market | zones 1 and 4, with workers reacting to the shutdown |
| 2. Trailblazer on the waterfront | 0:00, on the pier |
| 3. She looks up and the moving cage gives her a destination | 0:05 |
| 4. The shutdown changes her route | from 0:20: bridge lifted, shutters closed |
| 5. She sprints, jumps and mantles | zones 1, 4 and 6 |
| 6. The same tension system used in several ways | uses 1, 2 and 3 |
| 7. A surprising, cinematic movement beat | RIDE (the 18 m yank) and TRANSFER (letting go at the apex) |
| 8. She reaches the cage | about 2:05 |
| 9. The cage is a workshop, not a prison | the interior reveal |
| 10. "Yes— / ...No." lands | the closing beat |

## 13. Before Phase 2 starts (housekeeping, needs Adam's Mac)

- Commit and push the uncommitted perf-metric edits in the Phase 1 worktree (`perf.ts`, `CoastalProofRuntime.ts`,
  `proofHarness.mjs`).
- **Recommended:** open Phase 1 as a draft PR, as a baseline that is never merged. Run Phase 2 on a new branch cut
  from it, so the diff between the two phases stays readable.
- **Budget, re-measured after the kit and post pass:**
  - ≤ 8 ms p95 main thread at 4× throttle;
  - ≤ 250k triangles;
  - ≤ 90 draws;
  - plus a `#perf` screenshot from a real phone.
- **Phase 2 work has to run on the Mac.** Blender, the CC0 source packs in `~/Desktop/coastal-proof-sources`, and
  the approved `rook.glb` all live there, not in the repo.
