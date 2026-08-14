# corridor_01 foreground occlusion accents

Extracted from `03-foreground-occlusion.png` (1536×1024 RGBA, genuine
per-pixel alpha — 36.75% fully transparent, 0% fully opaque, 63.25%
partial/antialiased, confirmed via direct pixel sampling to be real
transparency rather than baked scenery or fake checkerboard) supplied
2026-08-14. Raw source preserved on the `asset/goldline-art-v2-source-20260814`
branch (source storage only, never merged).

## Selection rationale

Connected-component analysis found the sheet naturally decomposes into
two large, coherent, full-height edge clusters (bougainvillea, palm
fronds, hanging lanterns, draped fabric, architectural fragments —
genuinely picture-frame-shaped content, not a single flat overlay) plus
a smaller bottom-center railing/balustrade cluster, a plants/pottery
cluster, and one isolated hanging-lantern piece. Only the two large edge
clusters were promoted to runtime — they're the strongest, most
self-contained pieces and read immediately as "hanging in from the
world's edges" without needing careful per-piece placement against
existing corridor geometry.

## Files

| File | Source region |
| --- | --- |
| `left-frame.webp` | Left edge cluster (bougainvillea, palm, lanterns, blue awning) |
| `right-frame.webp` | Right edge cluster (bougainvillea, palm, arch fragment, lanterns, urns) |

## Runtime contract

Additive to the existing `foreground.webp` (which keeps covering the
full canvas exactly as before — these accents are not a replacement).
Pinned to the top-left/top-right viewport corners
(`GoldlineGame.ts`'s `positionOcclusionAccent`), scaled to a shared
target *height* (not width) — the left-frame source is a tall ~1:2
cluster and the right-frame source is closer to square, so an earlier
width-based scale left the right one almost entirely hidden behind the
FIELD LINK header bar (caught via direct in-browser verification, not
assumed correct from code alone). Width is separately capped at 42% of
viewport width so the joystick, bottom nav, and the bulk of the
playable world stay clear. corridor_01-specific: gated on
`anchorsBasePath` containing `"corridor_01"` rather than loaded
unconditionally, since this art was extracted specifically for this
corridor's composition.

`00-environment-anchor.png`, `01-parallax-far.png`, and
`02-midground-reference.png` from the same source package were **not**
promoted to runtime. The far/mid plates already shipping for
`corridor_01` are comparable in quality, and `gold_route.json`,
`occlusion.json`, `traversal.json`, and every authored
`CorridorMissionAnchorPoint` are hand-traced against the *current*
plates' exact pixel geometry — swapping them would require re-authoring
all of that with full regression proof, which was out of scope for this
change.
