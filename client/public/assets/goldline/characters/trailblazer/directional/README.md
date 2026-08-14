# Trailblazer directional idle/walk art

Extracted from `04-trailblazer-directional.png` (1254×1254 RGBA, genuine
per-pixel alpha — verified via forensic inspection, not baked
checkerboard) supplied 2026-08-14. Raw source preserved on the
`asset/goldline-art-v2-source-20260814` branch (source storage only,
never merged).

## What's here and what isn't

The idle row (8 cells, connected-component-verified as cleanly
separated) yields 6 genuinely distinct directions: front (×3 near-
duplicate takes), left, back, right, plus two diagonal back-left/
back-right poses. Only the four cardinal idle poses (front/back/left/
right) are shipped here — the diagonals had no matching walk-cycle
coverage, so adding them would have created an inconsistent facing set
(idle-only directions the walk cycle can never reach).

The walk-cycle body is a clean 5-column × 4-row grid per half (40 frames
total, verified via connected-component analysis at alpha threshold 200
after confirming the touching-frame appearance at lower thresholds was
soft boot-glow bridging, not real limb overlap). Of those 4 rows per
half, only 4 are genuinely non-redundant directions — front, left, back,
right, 5 frames each — the rest are alternate-take duplicates of the
same direction, not new directions, and were not shipped.

**No left/right walk cycle was invented by mirroring.** Each direction
here is a distinct image from the source sheet, used as delivered.

## Files

| File | Content |
| --- | --- |
| `idle-front.webp`, `idle-back.webp`, `idle-left.webp`, `idle-right.webp` | Stationary idle pose per direction |
| `walk-front-01..05.webp`, `walk-back-01..05.webp`, `walk-left-01..05.webp`, `walk-right-01..05.webp` | 5-frame walk cycle per direction |

## Runtime contract

Facing is a presentation-only dimension, never a new `AvatarState` (see
`client/src/game/avatar/facing.ts`'s `facingForInput` — deterministic
from the raw joystick vector, no randomness). `GoldlineGame.ts`'s
`resolveDirectionalPoseKey` looks up `idle-<facing>` / `walk-<facing>-0N`
only for the `idle`/`walk`/`run` states; jump/climb/vault/land always use
the original single canonical frame from `CHARACTER_POSE_FILES`,
regardless of facing — the source art never claimed directional coverage
for those actions, and the existing choreography for them is stronger.
A missing directional texture falls back to the non-directional base
pose, so a load failure can never leave the avatar untextured or break
movement.

The existing `input.x`-driven horizontal mirror-flip is suppressed
whenever a genuine directional texture is actually driving the current
frame, so the satchel/thigh-strap/compass side is never reversed by a
runtime mirror.
