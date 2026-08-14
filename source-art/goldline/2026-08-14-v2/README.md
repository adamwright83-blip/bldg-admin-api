# Goldline art V2 — raw source (2026-08-14)

**This branch is SOURCE STORAGE ONLY.** These are raw AI-assisted
production-art candidates, preserved here so they're accessible on GitHub
without bloating `main`'s history with large original renders. They
require forensic approval before promotion to runtime production assets
— see the implementation PR that used them for the full forensic
writeup and rationale.

Do not merge this branch into `main`.

## Files

| File | Dimensions | Mode | Alpha behavior | Intended use |
| --- | --- | --- | --- | --- |
| `00-environment-anchor.png` | 1672×941 | RGB | none (opaque) | cohesive scene/geometry reference only |
| `01-parallax-far.png` | 1672×941 | RGB | none (opaque) | far-background parallax candidate |
| `02-midground-reference.png` | 1672×941 | RGB | none (opaque) | midground/gameplay-scene visual reference only — not authored against current corridor geometry |
| `03-foreground-occlusion.png` | 1536×1024 | RGBA | genuine per-pixel alpha (36.75% fully transparent, 0% fully opaque, 63.25% partial/antialiased — real cutout art, not a haze blob) | foreground occlusion cutout set |
| `04-trailblazer-directional.png` | 1254×1254 | RGBA | genuine per-pixel alpha (36.46% fully transparent, 63.43% partial, real anti-aliasing) | directional Trailblazer idle/walk source |

## Forensic summary

- **00, 01, 02** are fully opaque RGB with zero alpha channel — usable only
  as flat background plates or references, never as occlusion/cutout
  layers.
- **03** was verified to contain genuine transparent gaps (not baked
  scenery, not fake checkerboard) via direct pixel sampling. Connected-
  component analysis found two large coherent edge-framing clusters (left
  and right, full height) plus a bottom-center railing/balustrade cluster,
  a plants/pottery cluster, and one isolated hanging-lantern piece — a
  genuine picture-frame-style occlusion kit, not a single flat overlay.
- **04** was verified via connected-component analysis at multiple alpha
  thresholds. The idle row (8 cells) yields 6 genuinely distinct
  directions (front ×3 variants, left, back, right, plus two diagonal
  back-left/back-right poses). The walk-cycle body is a clean 5×4 grid per
  half (40 frames total) that separates into exactly 4 genuine, clean,
  non-redundant directional walk cycles (front, back, left, right — 5
  frames each), with several rows being alternate-take duplicates of the
  same direction rather than new directions.

Full annotated contact sheets and the Python forensics scripts used to
produce these findings are not committed here (they were working files
under the repo's gitignored `tmp/`); the summary above reflects their
output.
