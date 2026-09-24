# Coastal Market three.js proof: progress

Resume here if a session is cut off. Branch `claude/coastal-market-three-proof`, worktree
`~/Desktop/bldg-admin-api-coastal-proof`. Brief: the Phase 1 prompt +
`~/Desktop/coastal-proof-refs/COASTAL-PROOF-HANDOVER.md` (handover wins).

## Stage

**Stage 1 (camera + route): in progress.**

## Measured

Every number is emulation, never a phone.

| When | What | Environment | Result |
| --- | --- | --- | --- |
| 2026-09-23 | Bundle budget | `pnpm build && pnpm goldline:bundle:budget` | GoldlineGameHome 71.3 KB gzip before and after; three.js only in `CoastalMarketProofPage-*.js` (191.9 KB gzip, proof-only). Negative control: importing three into GoldlineGameHome fails the gate. |
| 2026-09-23 | Autowalk, graybox | Playwright Chromium headless `--use-angle=metal` (Apple M1), 390x844 DPR 3 mobile+touch, CPU 1x, render DPR 1.6 | Full route 213.3 m walked end to end in 99.2 s at 2.1 m/s; fps median 60 (vsync), min 55; p95 frame 18.3 ms; 28-33 draws; ~84k tris. |

## Next

1. Shorten the route to 60-90 s at walking speed.
2. Camera framing: she is too large in portrait; put her in the lower third.
3. Sea stacks read as cooling towers: vary their shape and fix the floating headland boxes.
4. Publish the Stage 1 graybox as an artifact to catch iframe, touch and audio problems.

## How to run

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/assets/coastal-proof/build_level.py
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/assets/coastal-proof/build_characters.py
npx vite build --config vite.coastal-proof-preview.config.ts
node scripts/coastal-proof/proofHarness.mjs shots          # tmp/coastal-proof-captures/*.png
node scripts/coastal-proof/proofHarness.mjs autowalk --verbose --throttle 4
```
