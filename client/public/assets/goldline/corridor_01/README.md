# Corridor 01 — asset contract

Updated: the final-art handoff pass. Six assets from a supplied 8-image art
pack now populate every previously-empty layer except L0's true sky-only
separation (see below). Originals kept locally at `_originals/` (~15MB, not
committed — see repo `.gitignore`); this directory ships only the compressed
WebP exports actually used at runtime.

| File | Layer | Role | Status |
|---|---|---|---|
| `far.webp` | L0 | Distant aerial coastline/citadel — provides atmospheric depth behind the mid plate | **Present** (from the supplied art pack) |
| `mid.webp` | L1 | The playable corridor — stairs, gold-inlaid path, waterfall, Stronghold/Comms visible in the distance | **Present**, replaces the Run-1 flat placeholder |
| `foreground.webp` | L3 | Jungle vines/pillars/leaf frame — real occlusion, not decoration | **Present**, positioned at both authored `occlusion.json` zones |
| `effects.webp` | L4 | God-ray + waterfall mist plate | **Present**, replaces the vector-drawn ray |
| `portal_coldcall.webp` | L2 (portal) | The Cold Call/Comms portal object | **Present**, replaces the drawn glow-only fallback when loaded |
| `stronghold.webp` | L2 (landmark) | Purple Stronghold structure | **Present**, layered behind the state-colored vector gate frame |
| `occlusion.json` | L3 | Authored occlusion zones (2, flanking the gate) | Present |
| `traversal.json` | L2 | Interaction anchors (Cold Call portal, Stronghold gate) with `labelRadius`/`interactionRadius` | Present |
| `waterfall_01.webm` | — | Animated waterfall video | **Still missing** — no video asset was supplied. `effects.webp`'s static mist plate stands in; the video-texture lifecycle utility (`VideoTexture.ts`) remains ready, unattached. |
| `landmarks.json` | L2 | Explicit placed-landmark metadata | **Still missing** — semantic landmark *mapping* exists in code (`shared/worldSemantics.ts`) and drives CSS treatment on mission-fork icons, but is not yet a placed-object list for this specific corridor's art. |

## What changed from the engineering-only pass (PR #34)

`far`/`mid` are two **separate** supplied images (an aerial coastal view and a
ground-level corridor), not one flat plate split in two — genuine parallax
depth now exists between them, at the documented L0 factor (0.1, within the
0.05–0.15 range).

The in-world portal indicator, previously a restrained glow-only fallback
(because no portal art existed and a drawn card looked like a debug
placeholder), now renders the actual supplied portal sprite when the texture
loads, sized and faded by proximity. The glow-only path is kept as a runtime
fallback if a texture fails to load — never a drawn card, per the original
finding that it read as a placeholder.

The Stronghold gets real art, layered **behind** the pre-existing vector gate
frame. The vector was not removed: its state-driven color (purple/gold/orange/
grey for available/captured/contested/closed) is a load-bearing business-truth
signal a static image cannot reproduce, so it now renders as a thin accent
frame around the art rather than a filled box.

Foreground occlusion is now real, not just a proven mechanism: the supplied
jungle/pillar art is placed at both authored zones and toggles visible as the
player's world position enters them, so the avatar genuinely passes behind
painted foliage/stonework at two points in the corridor.

Character rendering swaps texture by `AvatarState` using cropped frames from
the supplied action sheet — see
`client/public/assets/goldline/characters/trailblazer/README.md` for exactly
which states are true frame animation versus a single held pose.

## What is still honestly missing

1. **Animated waterfall.** `effects.webp` is a static mist/god-ray plate; no
   `.webm` was supplied.
2. **Placed landmark metadata** (`landmarks.json`) — the semantic *mapping*
   exists, but nothing yet places discrete landmark objects into this
   specific corridor's layered scene beyond the Stronghold/Comms portal pair
   already wired.
3. **Gold-route/painted-path alignment** is close but not pixel-tuned — the
   vector bezier route was authored against the old flat placeholder, not
   this specific `mid.webp`, so it visually approximates the staircase's
   painted gold inlay rather than tracing it exactly.
