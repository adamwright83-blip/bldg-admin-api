# Trailblazer character assets

## Current canonical production candidate

The 2026-08-13 production-source sheet matches the locked adult female
Trailblazer canon and supplies the complete existing runtime state family. Its
RGBA source was split deterministically, each cell was reduced to its largest
connected alpha component, normalized into a 512×512 transparent canvas, and
exported as WebP. No older/intermediate heroine was mixed into this set.

The source included one extra airborne pose. It is intentionally unused rather
than inventing a state name or pretending it extends the run cycle.

## Frame mapping — honest accounting

| State                                    | Asset                                       | Kind                                                                                                                                             |
| ---------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `idle` / `interact` / `encounter_locked` | `idle.webp`                                 | Single authored pose (dedicated idle art)                                                                                                        |
| `run` / `walk`                           | `run_01`–`run_05.webp`                      | **True 5-frame sequential animation** — cropped from one continuous run cycle on the action sheet, stepped by a frame timer                      |
| `jump_start`                             | `jump_start.webp`                           | Single authored pose (crouch/anticipation)                                                                                                       |
| `jump_air`                               | `jump_air.webp`                             | Single authored pose (reach)                                                                                                                     |
| `land`                                   | `land.webp`                                 | Single authored pose (low crouch, hands near ground)                                                                                             |
| `vault`                                  | `vault.webp`                                | Single authored pose (forward lunge/reach)                                                                                                       |
| `climb`                                  | `climb_a.webp` / `climb_b.webp` alternating | **Pose-alternation, not true climb animation** — two knee-raise poses from slightly different angles, swapped on a timer to fake climbing rhythm |

Only `run` is genuine frame-by-frame animation. Every other non-idle state is
a single held pose (or, for climb, a two-pose alternation) swapped in when
that `AvatarState` becomes active — there is no interpolation between poses,
and none is implied.

## Cleanup performed

Every crop retained only its largest alpha-connected subject before resizing,
preventing neighboring-frame fragments from entering the exported state.
Contact-sheet inspection confirmed all twelve bodies remained complete.

## Consistency

Face, ponytail, olive tank, short explorer shorts, boots, satchel/pouches,
thigh strap, compass, and scarf remain consistent across the selected frames.
Human visual approval is still required in actual runtime motion; integration
does not approve its own character transitions.

## Transitions and preload (Slice 22)

State-to-state pose swaps (idle↔run, run→jump_start, jump_air→land,
climb_a↔climb_b, ...) now cross-fade over 90ms via a ghost sprite holding the
outgoing texture, so a state change never pops. Run-cycle frame steps
(run_01→run_02→...) are deliberately excluded from the crossfade — that
stepping _is_ the animation, and blending consecutive run frames would read
as motion blur rather than a run.

All 12 pose textures are preloaded together in `GoldlineGame.start()` rather
than lazily loaded mid-action. The production candidates total about 521KB,
still external to the JS bundle and small enough to avoid a visible first-jump
or first-climb fetch.
