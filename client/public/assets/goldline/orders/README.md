# Goldline pickup/delivery marker art

Illustrated production textures for the pickup/delivery world objectives
introduced in PR #61. Extracted from two source sheets supplied on
2026-08-14 (`03-pickup-props.png`, `04-delivery-props.png`, both
1254×1254 RGBA with genuine per-pixel alpha, verified via forensic
inspection — not baked checkerboard). No generative repaint or inpainting
was used; each file below is a clean per-state crop of the original
artwork.

| File                  | Source cell                              | State                              |
| ---------------------- | ----------------------------------------- | ----------------------------------- |
| `pickup-idle.webp`     | pickup sheet, leather satchel (idle)      | pickup, out of interaction zone     |
| `pickup-active.webp`   | pickup sheet, leather satchel (glowing)   | pickup, within staging radius       |
| `pickup-completed.webp`| pickup sheet, satchel open/empty          | extracted, **not currently wired**  |
| `delivery-idle.webp`   | delivery sheet, Mediterranean doorway     | delivery, out of interaction zone   |
| `delivery-active.webp` | delivery sheet, doorway (glowing)         | delivery, within staging radius     |
| `delivery-blocked.webp`| delivery sheet, doorway (red chain/prohibition) | delivery, authoritative payment block active |
| `delivery-completed.webp` | delivery sheet, doorway (empty mat)    | extracted, **not currently wired**  |

## Why "completed" isn't wired

The order embodiment is destroyed outright when a pickup/delivery
resolves (see `PopulationSystem.setOrder(null)`, driven by
`GoldlineGameHome`'s `nextOrderObjective` effect) — the marker disappears
from the world entirely rather than lingering in an empty/resolved state.
There is no existing "linger after resolution" moment for the completed
art to occupy, so it was extracted and productionized but left unwired
rather than inventing new display behavior beyond this PR's scope.

## Selection rationale

Both the pickup sheet and the delivery sheet contained several complete,
production-quality state families (a stone plinth, a wooden crate, a
folded-textile pedestal, and the satchel for pickup; a receiving
fountain, a bench, a return-station/mailbox, and the doorway for
delivery — see the sheet forensics in PR history for the full inventory).
The satchel and doorway were chosen as the primary families because they
read unambiguously and distinctly at small in-world scale — "a bag to
retrieve" vs. "a door to hand off at" — without requiring an entire
architectural structure to be plausibly placed at an arbitrary corridor
position.

## Runtime contract

`PopulationSystem` receives these via an `OrderPropTextures` map (see
`GoldlineGame.ts`'s `ORDER_PROP_FILES`/`orderPropTexturesFrom`). Missing
or failed-to-load textures fall back to the original restrained vector
marker (`drawOrderMarker`'s Graphics branch) — a load failure can never
masquerade as loaded production art. Texture selection is driven
per-frame by real proximity (`isOrderApproachable`) and the authoritative
`blocked` flag on the order embodiment (mirrors the same payment gate
`admin.updateStatus` already enforces server-side) — never a second
truth source.
