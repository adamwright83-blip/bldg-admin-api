# Coastal Market three.js proof: progress

Resume here if a session is cut off. Branch `claude/coastal-market-three-proof`, worktree
`~/Desktop/bldg-admin-api-coastal-proof`. Brief: the Phase 1 prompt +
`~/Desktop/coastal-proof-refs/COASTAL-PROOF-HANDOVER.md` (handover wins).

## Stage

**Phase 1 baseline complete**: route + camera, water + light, wind + boats + waterfall, six townspeople, synthesized audio, and dressed Trailblazer. Final emulation profiles and main-thread work metrics are recorded below. Draft PR is the immutable baseline for Phase 2; do not merge it.

## Measured

Every number is emulation, never a phone.

| When | What | Environment | Result |
| --- | --- | --- | --- |
| 2026-09-23 | Bundle budget | `pnpm build && pnpm goldline:bundle:budget` | GoldlineGameHome 71.3 KB gzip before and after; three.js only in `CoastalMarketProofPage-*.js` (191.9 KB gzip, proof-only). Negative control: importing three into GoldlineGameHome fails the gate. |
| 2026-09-23 | Autowalk, graybox | Playwright Chromium headless `--use-angle=metal` (Apple M1), 390x844 DPR 3 mobile+touch, CPU 1x, render DPR 1.6 | Full route 213.3 m walked end to end in 99.2 s at 2.1 m/s; fps median 60 (vsync), min 55; p95 frame 18.3 ms; 28-33 draws; ~84k tris. |
| 2026-09-23 | Autowalk, Stage 2 (textures, baked AO + sun shadow, water, sky) | same, **CPU throttle 4x** | Route 173.8 m in 83.8 s; fps median 60, min 31.5 (one sample); p95 worst 18.2 ms; <=32 draws; ~79k tris; planted-foot slip median 0.17 m/s at 2.1 m/s. |
| 2026-09-23 | Autowalk, Stages 3+4 (plants, 5 boats, waterfall, glows, 6 NPCs, dressed Trailblazer) | same, CPU throttle 4x | 81.5 s; fps median 60, min 54; p95 worst 18.1 ms; <=68 draws; <=217k tris. |
| 2026-09-24 | Final autowalk, phone profile | Playwright Chromium headless `--use-angle=metal` (Apple M1), 390x844 DPR 3 mobile+touch, **CPU throttle 6x** | Route 173.8 m completed in 81.5 s; fps median 60, min 59.8; app-frame CPU 5.66 ms mean / 10.2 ms worst p95; p95 frame interval worst 18.5 ms; <=69 draws; <=222k tris; no page errors. |
| 2026-09-24 | Final autowalk, phone profile | Same phone emulation, **CPU throttle 1x** | Route completed in 79.6 s; fps median 60, min 59; app-frame CPU 2.94 ms mean / 4.0 ms worst p95; p95 frame interval worst 17.9 ms; <=68 draws; <=222k tris; no page errors. |
| 2026-09-24 | Final autowalk, desktop profile | Playwright Chromium headless `--use-angle=metal` (Apple M1), 1280x800 DPR 1, **CPU throttle 1x** | Route completed in 79.6 s; fps median 60, min 59.9; app-frame CPU 2.94 ms mean / 4.0 ms worst p95; p95 frame interval worst 18.0 ms; <=69 draws; <=222k tris; no page errors. |

These are Mac-hosted Chromium emulation measurements, not measurements from a real phone.

## Published

- Stage 1 graybox artifact: https://claude.ai/artifact/79myfaLbhpA3jkJdgdNUdz (private). Artifacts do not serve
  `.glb`; `stageArtifact.mjs` wraps each GLB as base64 JSON. Not verified inside the claude.ai frame (the built-in
  browser is not signed in); the same bundle boots and walks under the local harness.

## Next

Phase 2 follows `docs/goldline/coastal-market/CODEX_HANDOFF.md` on branch
`claude/gallant-franklin-uoh3te`. Preserve this branch and its draft PR as the Phase 1 baseline.

## Phase 2 candidate (2026-09-24)

Branch `codex/coastal-market-phase2`, cut from the Phase 1 baseline. The runtime reverses the
existing geography so Trailblazer starts at the waterfront and climbs toward the cage. The
representative harness line completes in 62.8 s.

### Implemented

- Jog (5.3 m/s), sprint (8.25 m/s), gravity, jump and automatic mantle up to 1.15 m;
  exported `Jog_Fwd_Loop`, `Sprint_Loop`, jump, roll and `ClimbUp_1m` from the CC0 packs.
- One data-driven tension rule with three uses: RIDE pulls her up the loaded crane line,
  RELEASE swings the guyed jib, and TRANSFER carries her on the ropeway while preserving momentum.
- One shutdown timeline drives the ropeway chase, shutter wave, counterweight and gorge jib.
- A corridor-focused terracotta/teal façade kit, deep eaves, balconies, brass/timber crane,
  ropeway cage/workshop, dispatches, market dressing, AgX tone mapping and Trailblazer contact shadow.
- Option A reveal: the cage door is open; dispatches, signal lamp, map and satchel show a workshop,
  not a prison. The four-line exchange is “That's not yours.” / “It isn't theirs either.” /
  “Leave it.” / “I am leaving with it.” Rook's painted side faces the camera.

### Final measurement

Mac-hosted Playwright Chromium headless `--use-angle=metal` (Apple M1), 390x844 DPR 3
mobile+touch, CPU throttle 4x: route 173.8 m, 62.8 s, 60 fps median / 59.2 min,
3.91 ms mean app-frame CPU / 10.2 ms worst rolling p95, 18.2 ms worst p95 frame interval,
<=80 draws, <=630k triangles, zero page errors. **This is emulation, not a real phone.**

The triangle increase is the intact approved Rook mesh. Static architecture is batched and the
lazy-proof bundle gate still passes; GoldlineGameHome remains 71.3 KB gzip and three.js remains
reachable only through the proof chunk.

### Known limitations

- The fitted Rook rig renders correctly inside Blender, but both decimated and full skinned GLB
  exports fragmented after import into three.js. The candidate therefore uses the intact,
  normalized approved mesh as a static runtime GLB and sells Option A with the open workshop,
  removed satchel, dispatches, painted-side staging and timing. A deforming Rook animation remains
  an art/export dependency; it is not replaced with a fake hop, flight, mirrored model or transform trick.
- Performance was measured only in Mac Chromium emulation. No real-phone pass was performed.
- The current production continuity issue remains deliberately untouched: main shows Rook joined
  immediately after the Colosseum, while this proof physically introduces him in Coastal Market.
- This is an isolated proof. Do not merge or deploy it as production progression.

## How to run

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/assets/coastal-proof/build_level.py -- --bake   # ~1.5-3.5 min
python3 scripts/assets/coastal-proof/prep_textures.py
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/assets/coastal-proof/build_characters.py
npx vite build --config vite.coastal-proof-preview.config.ts
node scripts/coastal-proof/proofHarness.mjs shots          # tmp/coastal-proof-captures/*.png
node scripts/coastal-proof/proofHarness.mjs autowalk --verbose --throttle 4
```
