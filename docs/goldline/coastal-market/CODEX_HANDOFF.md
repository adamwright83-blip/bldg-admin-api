# Coastal Market: handoff to Codex (2026-09-24)

Everything needed to take over the Coastal Market Rook Hunt. Read this first.

## Where the work is

| What | Where | State |
|---|---|---|
| Phase 1 proof (three.js route, graybox to Stage 4, Trailblazer, townsfolk, audio, harness) | branch `claude/coastal-market-three-proof`, head `ee9e5de` | Pushed. Not merged. No PR yet. |
| Phase 1 perf-metric edits (`runtime/perf.ts`, `runtime/CoastalProofRuntime.ts`, `scripts/coastal-proof/proofHarness.mjs`) | **Uncommitted, only in the Mac worktree** `~/Desktop/bldg-admin-api-coastal-proof` | Inspect, then commit and push if correct. |
| Phase 1 progress log and run commands | `client/src/pages/goldline/coastalMarketProof/PROGRESS.md` (on the Phase 1 branch) | Current to Stage 4. |
| Asset provenance | `client/src/pages/goldline/coastalMarketProof/PROVENANCE.md` | Current. |
| Raw CC0 sources (Quaternius, Poly Haven) | Mac only: `~/Desktop/coastal-proof-sources/` | Not in git. |
| Approved Rook mesh (TRELLIS, 10.8 MB, no rig) | Mac only: `~/Desktop/goldline-local-archive/from-cargo-payment-badge-worktree/rook/3d-trellis-source/rook.glb` | Not in git. |
| Original Phase 1 handover | Mac only: `~/Desktop/coastal-proof-refs/COASTAL-PROOF-HANDOVER.md` | Not in git. |
| Earlier Phase 2 treatment | branch `claude/gallant-franklin-uoh3te`: `docs/goldline/coastal-market/PHASE_2_TREATMENT.md` | Superseded by the brief below wherever they conflict. Its tension rule and asset-reuse list are still useful. |
| Phase 1 playable build (private artifact) | https://claude.ai/artifact/79myfaLbhpA3jkJdgdNUdz | Version 2 (Stage 4). |

Read these on the branch: `git fetch origin claude/gallant-franklin-uoh3te && git show origin/claude/gallant-franklin-uoh3te:docs/goldline/coastal-market/CODEX_HANDOFF.md`.

## Phase 1 status (measured, emulation only, never a real phone)

- Autowalk, 4x CPU throttle, 390x844 DPR 3, Metal Chromium on the Mac:
  - route ~174 m in 79-82 s;
  - 60 fps median;
  - ~5 ms mean / 8 ms p95 main-thread per frame;
  - <=68 draws, <=217k tris.
- Bundle gate: GoldlineGameHome 71.3 KB gzip, the same before and after. three.js is only in the lazy proof chunk (~204 KB gzip). `pnpm goldline:bundle:budget` passes.
- Typecheck is clean. The full unit suite passes: 804 files, 8,410 tests, 7 skipped.
- **Not done:**
  - the 6x throttle, desktop and unthrottled phone perf passes (a flag-quoting bug made all three runs identical; the flags need splitting);
  - the Phase 1 draft PR (open it as a baseline and never merge it);
  - the final report.

## Phase 1 verdict (Adam, 2026-09-23): graphics unacceptable, gameplay is slow walking

**Graphics root causes:**
- All architecture is procedural boxes from `scripts/assets/coastal-proof/build_level.py`.
- World-space box UVs.
- Lighting is baked AO plus sun visibility only: no bounce and no post-processing.
- Characters use flat vertex colours.
- Trailblazer has no contact shadow, so she floats.
- The sky is pale near the sun.

**Slow-walking root causes:**
- `WALK_SPEED` is 2.1 m/s (`runtime/controller.ts`).
- No gravity or vertical velocity.
- Step-up is capped at 0.42 m.
- Ribbon collision walls make the world a corridor.

**Reusable for Phase 2:**
- **CC0 clips already downloaded but not exported:**
  - UAL1: `Jog_Fwd_Loop` (~5.3 m/s), `Sprint_Loop` (~8.25), `Jump_Start`, `Jump_Loop`, `Jump_Land`, `Roll`.
  - UAL2: `ClimbUp_1m`, `NinjaJump_*`, `Slide_*`.
  - Add them to `CLIPS_A` / `CLIPS_B` in `build_characters.py`. They share Trailblazer's skeleton, so no retargeting is needed.
- **Runtime pieces:**
  - the IK stride derivation in `character.ts`;
  - the BVH colliders and the spring camera;
  - touch and keyboard input;
  - the harness (autowalk, sightlines, framing, gate, film);
  - the artifact staging;
  - the secondary-motion springs;
  - water, the waterfall, boats and the NPC palettes;
  - synthesized audio.

**Rook in 3D:**
- `scripts/assets/blender/rook_rig.py` fits an armature and renders these states: walk, idle, talk, confide, wait, letter, dangle, shrug, brace, point.
- It exports sprites only today. It needs a decimated, rigged GLB export for three.js.
- His back and far side are unpainted, so stage his painted side toward the camera.

## Phase 2 brief (Adam, verbatim intent)

**Coastal Market is the Rook Hunt.** At the end of the Colosseum, Trailblazer has already heard Rook through the Republic's hacked clock network. `client/src/pages/goldline/aftermathScript.ts` ends:

- TRAILBLAZER: "Anything else I should know?"
- ROOK: "Yes."

Line 33 of the same file is "Everyone says I was captured. I let them say it."

**Opening:**
- She enters at the waterfront and very early sees a large moving cargo cage high above the market.
- At long distance the CAGE reads, not a tiny bird. Closer, his hat, tail and movement confirm someone is inside.
- The player understands: *I need to get up there.*
- The playable sequence is **60-100 seconds**.

**The market fights back:**
- Rook runs an illegal communications network through the market's freight infrastructure, and the authorities shut it down.
- The cage is rerouted, a bridge rises, shutters close, freight moves and workers react. Her route changes in front of her.
- The shutdown is the pressure. No combat unless playtesting proves it is needed.

**One systemic verb:**
- She hooks something already under load and exploits its stored or moving force.
- Test three uses of ONE physical rule, not three scripted gimmicks:
  - **RIDE:** hook a moving counterweight or freight system and get violently pulled upward.
  - **RELEASE:** release something under load so the architecture physically changes and creates a route.
  - **TRANSFER:** catch moving rigging or crane freight, ride its momentum across a gap, and let go at the right moment.
- Plus locomotion that feels like a game: **sprint, jump, mantle/vault**.

**Visual target:**
- Do not rebuild the city. Make the playable corridor look substantially better: the waterfront/quay, the first cage sighting, the crane/tension traversal, the upper market, the major crossing and Rook's cage/workshop.
- Fix the box architecture, weak materials, muddy lighting, flat cliffs, empty market, weak silhouettes, and Trailblazer looking pasted on. She needs grounding and contact.
- **Get ONE representative gameplay frame genuinely good before propagating a new kit everywhere.**

**Rook's reveal (the payoff):**
- The cage door is open. It is not a prison; it is his moving illegal communications workshop: signal gear, letters, ink, maps and reappropriated hardware.
- She catches him doing something he shouldn't. The comedy is short and visual.
- Pick whichever option the rigs can sell. If neither can be sold, rewrite around actions they can sell.
  - **Option A:** Rook lifts a sealed dispatch satchel off a hook like it grew there and walks toward the door.
    - TRAILBLAZER: "That's not yours."
    - ROOK: "It isn't theirs either."
    - TRAILBLAZER: "Leave it."
    - ROOK: "I am leaving with it."
    - A clerk on the gantry yells "thief."
  - **Option B:** Rook has both hands in a crate of signal lamps, nests two in his coat, and offers her a third like a host.
    - TRAILBLAZER: "We're not looting the cage."
    - ROOK: "Correct. We're evacuating equipment."
    - TRAILBLAZER: "Put them back."
- The direct-lie constraint (WORLD_BIBLE §11: his voice fails on a direct lie) is optional here; the player already saw it in the Colosseum.
- The player should instantly get why "Everyone says I was captured. I let them say it." is such a Rook line.

**Done means one capture that makes sense with no explanation:**
1. waterfront;
2. the moving cage gives her a destination;
3. the market shuts down;
4. run/jump/mantle;
5. the tension mechanic used several ways;
6. one trailer-worthy movement beat;
7. the open cage;
8. Rook caught doing something funny and shady;
9. a short exchange lands.

**It is not done if:**
- the footage is mostly pushing forward through scenery;
- the mechanics feel like three scripted buttons;
- it still looks like Phase 1.

## Hard rules

- **Isolated proof.** Do not merge. Do not deploy. Keep three.js out of production chunks; the bundle budget gate must pass.
- **Do not touch:** production progression, CONTACT authority, Candy Bar, Claire, Twilio, business truth, or customer/order/revenue systems. See the repo-root `CLAUDE.md`.
- **Known continuity issue: document it, do not fix it.**
  - Current main shows Rook as already joined right after the Colosseum.
  - The intended experience is: Clockhead falls → Rook is heard → Coastal Market cage chase → physically meet Rook → the Wayward is their first real journey together.
- **Rook canon** (`docs/goldline/companions/ROOK_CONCEPT_SPEC.md`):
  - Use the approved mesh as-is. Never regenerate or redesign him.
  - He walks upright like a small person. No hopping, pecking or flying. His wings work as hands.
  - Missing animation is an art dependency to report, never faked.
- **Say plainly what was and was not verified.** Emulation numbers are not phone numbers.

## Suggested order

1. On the Mac worktree: inspect the perf edits, then commit and push them. Run the 6x, desktop and unthrottled passes (split the flags). Update `PROGRESS.md`. Open the Phase 1 draft PR.
2. Cut `coastal-market-phase2` (or similar) from the Phase 1 branch.
3. Controller: gravity, jog/sprint, jump, mantle. Export the new clips via `build_characters.py`.
4. The tension rule as one data-driven system, plus the three authored uses.
5. One gameplay frame at final quality (kit, materials, bounce lighting, post pass, Trailblazer contact). Show Adam before propagating.
6. Shutdown timeline, cage and ropeway, route (60-100 s).
7. Rook GLB export from `rook_rig.py`, the workshop set and the reveal scene.
8. Re-measure perf. Capture the clip. Republish the artifact. Report.

## Run commands (from PROGRESS.md; macOS paths)

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/assets/coastal-proof/build_level.py -- --bake
python3 scripts/assets/coastal-proof/prep_textures.py
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/assets/coastal-proof/build_characters.py
npx vite build --config vite.coastal-proof-preview.config.ts
node scripts/coastal-proof/proofHarness.mjs shots
node scripts/coastal-proof/proofHarness.mjs autowalk --verbose --throttle 4
```
