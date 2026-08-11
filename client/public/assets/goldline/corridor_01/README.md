# Corridor 01 — asset contract

The one-corridor visual evolution architecture expects the following file set.
This document is the source of truth for what exists today versus what is
still required to reach the approved north-star reference.

| File | Layer | Purpose | Status |
|---|---|---|---|
| `far.webp` | L0 | Sky / distant coastline / mountains, parallax 0.05–0.15 | **MISSING** |
| `mid.webp` | L1 | Main ruins / bridges / near waterfalls, parallax 0.3–0.6 | Substituted — see below |
| `near.webp` | L1/L2 backdrop detail | Closer structural detail behind the traversal plane | **MISSING** |
| `foreground.webp` | L3 | Leaves / pillars / arch edges authored to occlude the character in ≥2 zones | **MISSING** |
| `waterfall_01.webm` | L1, video texture | Looping muted waterfall detail | **MISSING** |
| `fog.webp` | L4 | Mist/haze plate for the effects layer | **MISSING** |
| `occlusion.json` | L3 | Authored occlusion zones (world-space rect + z-order) | Present — `occlusion.json`, describes zones derived from the existing fortress geometry only |
| `traversal.json` | L2 | Interaction anchors (portals, gates) with position + radii | Present — `traversal.json` |
| `landmarks.json` | L2 | Semantic landmark placement metadata | **MISSING** — semantic landmark mapping exists in code (`shared/worldSemantics.ts`) but is not yet expressed as placed world objects |

## What is actually running today

Two pieces of **real, approved production art** exist and are reused as-is:

- `client/src/assets/goldline/generated/goldline-world-empty.png` (862×1825) — a
  single flat plate, but a genuinely rich one: it already paints in a lit
  purple platform/figure, a blue chained-archway structure, cascading gold
  water, turquoise pools, and white-stone architecture consistent with the
  north-star reference. It is mounted whole as the **L1 (mid)** layer. Because
  it is one flat plate rather than separated layers, there is no independent
  sky/far plane to parallax against it (L0 does not exist as art — the
  engineering container for it is wired and inert), and no way to place a
  drawn UI element over it without it reading as a placeholder against
  professional-quality painted detail. This is why the in-world portal
  indicator was deliberately reduced to a soft light glow rather than a drawn
  card/icon — the painted art itself already carries the "portal" read.
- `client/src/assets/goldline/generated/trailblazer-operator.png` (1024×1536) —
  the character sprite. No sprite sheet, no Spine rig.

**No new art was generated for this pass.** This environment has no
image/video generation capability, and fabricating placeholder gradients or
stock-photo ruins to stand in for the north-star concept art is explicitly
against the brief. Where the architecture needs a visual it does not have, it
is either left absent (L0, L3 foreground, L4 fog plate, the waterfall video)
or built from vector primitives that are honestly part of the existing
approved style (the fortress/gate graphic, the gold route, a single restrained
god-ray).

## Exact assets still required to close the Visual Gate

1. `far.webp` — a distant sky/coastline/mountain plate, separated from the
   midground so true parallax depth reads.
2. `foreground.webp` (+ authored alpha) — pillars/leaves/arch edges positioned
   to occlude the character at at least two points in the corridor.
3. `waterfall_01.webm` — a short, muted, looping waterfall detail clip.
4. `fog.webp` — a soft haze/mist plate for the L4 effects layer.
5. Ideally, a proper layered re-composition of the corridor matching the
   supplied north-star reference (bright sunlit white stone, turquoise water,
   gold embedded path, purple Stronghold, teal Comms portal) — the current
   single background is serviceable but was not authored with layer
   separation in mind, so parallax against it reads as one flat plate moving,
   not real depth.

Until those exist, the Visual Gate is **BLOCKED — FINAL ART REQUIRED**, even
though the underlying engineering (layers, parallax, occlusion zones,
proximity portals, animation states, contact shadow) is real and tested.
