# Trailblazer character assets

Source: an 8-image supplied art pack (idle portrait + a 5×4 action sheet).
Originals kept locally at `_originals/` (~20MB, not committed — see repo
`.gitignore`); this directory ships only the compressed WebP exports actually
used at runtime.

## Frame mapping — honest accounting

| State | Asset | Kind |
|---|---|---|
| `idle` / `interact` / `encounter_locked` | `idle.webp` | Single authored pose (dedicated idle art) |
| `run` / `walk` | `run_01`–`run_05.webp` | **True 5-frame sequential animation** — cropped from one continuous run cycle on the action sheet, stepped by a frame timer |
| `jump_start` | `jump_start.webp` | Single authored pose (crouch/anticipation) |
| `jump_air` | `jump_air.webp` | Single authored pose (reach) |
| `land` | `land.webp` | Single authored pose (low crouch, hands near ground) |
| `vault` | `vault.webp` | Single authored pose (forward lunge/reach) |
| `climb` | `climb_a.webp` / `climb_b.webp` alternating | **Pose-alternation, not true climb animation** — two knee-raise poses from slightly different angles, swapped on a timer to fake climbing rhythm |

Only `run` is genuine frame-by-frame animation. Every other non-idle state is
a single held pose (or, for climb, a two-pose alternation) swapped in when
that `AvatarState` becomes active — there is no interpolation between poses,
and none is implied.

## Cleanup performed

The action sheet's 5×4 grid was auto-sliced into 307×256 cells. Several cells
contained visible fragments bleeding in from the adjacent cell (a stray boot,
a partial limb) — a known ChatGPT sprite-sheet artifact. Fixed via connected-
component filtering (kept the single largest opaque blob per frame, zeroed
alpha on everything else). This removed 5–37% of each affected frame's opaque
pixel count depending on the frame; verified visually afterward that no real
limb was cut in the process.

## Consistency

Braid, backpack, and outfit read consistently across the selected frames.
Minor lighting/contrast variance exists between the dedicated idle render and
the action-sheet frames (different generation passes) — visible as a slight
tonal shift when the character transitions from idle to a movement pose. Not
corrected in this pass; flagged as a known weakness in the Visual Gate report
rather than papered over.
