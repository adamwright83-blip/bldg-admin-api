# Trailblazer character assets

## Current canon gate

The PR #55 visual handoff locks a newer adult female Trailblazer appearance in
`01_trailblazer_locked_turnaround.png`. That image is a labeled, opaque
turnaround reference, not a runtime sprite source. Its companion action image
is also a set of unrelated poses rather than the required sequential state
family. The current files below therefore remain the internally consistent
legacy runtime set; they have **not** been mixed with the new reference, and
the Trailblazer premium visual gate remains blocked until a complete,
transparent, canon-consistent idle/run/jump/vault/climb/land source set is
supplied.

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

## Transitions and preload (Slice 22)

State-to-state pose swaps (idle↔run, run→jump_start, jump_air→land,
climb_a↔climb_b, ...) now cross-fade over 90ms via a ghost sprite holding the
outgoing texture, so a state change never pops. Run-cycle frame steps
(run_01→run_02→...) are deliberately excluded from the crossfade — that
stepping *is* the animation, and blending consecutive run frames would read
as motion blur rather than a run.

All 12 pose textures are preloaded together in `GoldlineGame.start()` rather
than lazily loaded per imminent state. This is a deliberate deviation from
"preload only what's imminent": every pose file is 9-32KB (≈174KB total),
small enough that preloading all of them costs nothing meaningful, and lazy
mid-jump loading would risk the texture not being ready exactly when a jump
begins — visibly worse than the current small fixed cost paid once at
corridor load.
