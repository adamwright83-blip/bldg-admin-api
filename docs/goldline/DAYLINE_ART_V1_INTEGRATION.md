# GOLDLINE Day Line art v1 — integration status

Branch: `feat/goldline-dayline-world-compositor`  
Source asset package: `goldline_dayline_antigravity_handoff_FINAL.zip`  
Prepared runtime package: `goldline_dayline_runtime_assets.zip` (provided separately in the associated ChatGPT conversation).

## Exact runtime path mapping

Install the contents of the runtime package's `public/` directory at the repo root under `public/goldline/dayline-v1/`. Runtime URLs begin `/goldline/dayline-v1/`.

| Code label | Runtime path | Source size/state |
|---|---|---|
| WORLD_CLEAN | `background/world-clean.png` | 941×1672 RGB; NO avatar, route nodes or water slide |
| PICKUP_DUFFEL | `objects/pickup.png` | 1448×1086 RGBA, blue side view |
| DROPOFF_CHEST | `objects/dropoff.png` | 1448×1086 RGBA; **oblique, NOT approved strict overhead** |
| SALES_WATERSLIDE | `objects/sales.png` | 1448×1086 RGBA, steep red-gold slide |
| GROWTH_LEAF | `objects/growth.png` | 1448×1086 RGBA |
| MARKETING_TEMPLE | `objects/marketing.png` | 1448×1086 RGBA |
| AVATAR_IDLE | `avatar/idle.png` | 400×512 RGBA, anchored bottom |
| AVATAR_WALK | `avatar/walk-00.png` through `walk-04.png` | 400×512 RGBA, five atlas crops: **continuity unverified** |
| ACTION_SLOT_STATES | `states/<kind>-closed.png`, `states/<kind>-open.png` | 887×887 RGBA, split from 1774×887 atlases |
| FOREGROUND_CUTOUTS | `scenery/foreground-cutouts-atlas.png` | 2172×724 RGBA; overlapping cutouts still need separation |
| CHAPTER_STATES | `chapter/chapter-locked.png`, `chapter-unlocked.png` | 887×887 RGBA; generic door, **not Small Comforts proof** |

The obsolete world reference containing permanent Action Slots and a glowing path must not be shipped.

## Implementation in this branch

- `daylineWorldComposition.ts`: deterministic display-only object kind mapping, slot scale, trail geometry, avatar perspective, state gates.
- `DaylineWorldCompositor.tsx`: read-only objects, gold route overlay, HTML business labels, local-only open-state, guarded animation.
- `dayline-world-compositor.css`: scene composition and contrast.
- `GoldlineDayPlan.tsx`: gated integration, collapse leaked header list, preserve route and commitment handlers.
- `daylineWorldComposition.test.ts`: 1/2/3/5/8/10 cases and safety checks.

**The opt-in environment flag `VITE_GOLDLINE_DAYLINE_ART_V1=1` must stay OFF** until runtime images are installed and actual mobile screenshots pass user approval. Default state preserves existing UI with the verbose current-day list collapsed.

## Unresolved before release

1. Upload runtime art PNGs into `public/goldline/dayline-v1`. The GitHub connector in the original implementation session supports text files, but did not have a direct binary upload path from the local asset sandbox. The supplied runtime ZIP contains the PNG files.
2. The dropoff art is oblique; the product requires strict overhead with handle and lock on the lid. Do not silently approve.
3. 941×1672 world is **not Retina**; inspect a 3× crop and replace if visibly soft.
4. The extracted walker frames are a preview, not a certified seamless animation. The driving state must be explicitly supplied and `allowWalkingAnimation` enabled for motion; otherwise, no automatic walk. Verify source pose continuity and alignment first.
5. Typed `DayPlanStopKind` does not yet include `marketing`; generic prep/processing stops must not be relabeled as marketing by guessing from title text. Correct classification must come from an existing authoritative typed projection.
6. Existing Goldline chapter/Kingdom unlock is separate from Small Comforts. Do not attach chapter art to an invented game gate.
7. Preserve existing stops/mission writes and working routes. Avoid Claire/Daphne/protected architecture files.
8. Screenshot the actual built UI at 390×844, 430×932 and 3×; confirm no collisions with 1,3,5,8,10 slots, adjacent pickups, same-address distinct IDs, and missing optional data.
9. Capture verified-only climb and reduced-motion/driving safeguards. No automatic work completions, money, XP, streaks, or fabricated travel times.
10. Run `pnpm check`, `pnpm exec vitest run client/src/pages/goldline/daylineWorldComposition.test.ts client/src/pages/driver/goldlineDayPlanModel.test.ts`, `pnpm build`, and relevant Goldline smoke checks.

No merge or deployment until user visual approval.
