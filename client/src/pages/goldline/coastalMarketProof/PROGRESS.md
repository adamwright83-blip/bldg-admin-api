# Coastal Market three.js proof: progress

Resume here if a session is cut off. Branch `claude/coastal-market-three-proof`, worktree
`~/Desktop/bldg-admin-api-coastal-proof`. Brief: the Phase 1 prompt +
`~/Desktop/coastal-proof-refs/COASTAL-PROOF-HANDOVER.md` (handover wins).

## Stage

**Stage 2 (water + lighting): first pass done.** Stage 1 route/camera accepted for now (83.8 s walk). Next: dress Trailblazer, then Stage 3 boats + waterfall.

## Measured

Every number is emulation, never a phone.

| When | What | Environment | Result |
| --- | --- | --- | --- |
| 2026-09-23 | Bundle budget | `pnpm build && pnpm goldline:bundle:budget` | GoldlineGameHome 71.3 KB gzip before and after; three.js only in `CoastalMarketProofPage-*.js` (191.9 KB gzip, proof-only). Negative control: importing three into GoldlineGameHome fails the gate. |
| 2026-09-23 | Autowalk, graybox | Playwright Chromium headless `--use-angle=metal` (Apple M1), 390x844 DPR 3 mobile+touch, CPU 1x, render DPR 1.6 | Full route 213.3 m walked end to end in 99.2 s at 2.1 m/s; fps median 60 (vsync), min 55; p95 frame 18.3 ms; 28-33 draws; ~84k tris. |
| 2026-09-23 | Autowalk, Stage 2 (textures, baked AO + sun shadow, water, sky) | same, **CPU throttle 4x** | Route 173.8 m in 83.8 s; fps median 60, min 31.5 (one sample); p95 worst 18.2 ms; <=32 draws; ~79k tris; planted-foot slip median 0.17 m/s at 2.1 m/s. |

## Published

- Stage 1 graybox artifact: https://claude.ai/artifact/79myfaLbhpA3jkJdgdNUdz (private). Artifacts do not serve
  `.glb`; `stageArtifact.mjs` wraps each GLB as base64 JSON. Not verified inside the claude.ai frame (the built-in
  browser is not signed in); the same bundle boots and walks under the local harness.

## Next

1. Dress Trailblazer (v2 sheet + bun + belt pouch), check from behind / behind-left / behind-right.
2. Stage 3: boats (bobbing, drifting), waterfall in the gorge; wind is already on cloth, bunting, ropes, plants.
3. Stage 4: a few townspeople.
4. Lane is dim in the cove shadow: more sky fill / warm bounce, lantern glow sprites.
5. Foot slip 0.17 m/s from the stride-scaled walk: IK-based stride derivation if time allows.

## How to run

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/assets/coastal-proof/build_level.py -- --bake   # ~1.5-3.5 min
python3 scripts/assets/coastal-proof/prep_textures.py
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/assets/coastal-proof/build_characters.py
npx vite build --config vite.coastal-proof-preview.config.ts
node scripts/coastal-proof/proofHarness.mjs shots          # tmp/coastal-proof-captures/*.png
node scripts/coastal-proof/proofHarness.mjs autowalk --verbose --throttle 4
```
