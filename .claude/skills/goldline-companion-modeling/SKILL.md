---
name: goldline-companion-modeling
description: Model, shade and bake Goldline's seven animal companions in Blender so they read at 48px and sit inside painted 2D backgrounds. Load before building, re-rendering or baking any Goldline character, before touching scripts/assets/blender, and before proposing new character art. Encodes the rig contract, the silhouette roles, the scope boundary, and the specific failures already made on this project.
---

# Goldline companion modelling

Goldline's problem is that it is not shareable. Every rule here exists because
something specific went wrong, and most of them cost a working afternoon.

**Read `docs/goldline/BUILD_BRIEF_PRESENTATION.md` first.** Its scope constraint
section is binding and this skill does not widen it.

## The scope boundary — check this before modelling anything

Blender is for **characters that animate and need many consistent frames of the
same subject**. The seven companions, Trailblazer, later Bellwether and Clockhead.
Roughly ten characters out of 652 images.

Never put these through Blender: canonical building art (approved, has a working
pivot contract in `buildingArt.ts`, and buildings do not animate), UI chrome,
painted chapter backgrounds, lantern and territory art, or any marketing asset.
`registry.test.ts` fails if you try; `BLENDER_ELIGIBLE_GROUPS` is the allowlist.

**Never re-render, replace or "upgrade" an existing approved asset.** New character
art is produced one character at a time with explicit approval, never batched.

## The method — the ceiling that was hit here

The first companion pass built each animal from ~30 stacked, separately
subdivided primitives. Seven rendered in ten seconds and four were unusable. The
conclusion drawn was "Blender cannot author character shapes". That was wrong.

Measured against a CC0 Red Junglefowl, which is a bird and so directly comparable
to Rook:

| | Junglefowl | Goldline Rook, first pass |
|---|---|---|
| Mesh objects | 1 | ~30 |
| Vertices | 767 | subdivided spheres, far more |
| Topology | 199 quads, 44 tris | separate primitive shells |
| Rig | one armature with an action | none |

**One continuous quad skin, driven by an armature.** That is the target. No
amount of lighting, camera work or toon shading closes the gap to a pile of
spheres — that was tried, in that order, and it did not.

Concretely:

- **Never stack primitives.** Sweep a varying cross-section and bridge it into
  one skin (`blender-hardsurface`), or skin a vertex skeleton with the Skin
  modifier, or build from metaballs, or sweep tapered curves. For organic animals
  the skeleton-and-muscle-mass route in `creature-artist` is the default.
- **Cut detail in, never glue it on.** `bmesh.ops.inset_region` then translate
  along the face normal. Rook's satchel and Mara's goggles were glued-on boxes
  and read as glued-on boxes.
- **Extended appendages need swept curves, not stacked balls.** Mara's spread
  wings became flat planks and Luma's ringed tail became a string of loose beads.
  Both were sphere-and-box chains. Wings, tails, rudders and fins are curves with
  a bevel profile and a taper.
- **Detail hierarchy with restraint.** Leave clean areas. Detail only registers
  against something undetailed.

## The rig contract — shared, not per-companion

`scripts/assets/blender/rig.py` is the single camera, light rig and normalization
every companion is shot through. That sharing is the only reason the set looks
like a set. **Do not fork it for one character.**

| | |
|---|---|
| Camera azimuth | 60 degrees |
| Elevation | 21 degrees |
| Projection | orthographic, ortho_scale 2.95 |
| Target height | 1.75 blender units, feet on z=0 |
| Pivot | `center_bottom` |
| Output | transparent RGBA PNG |
| Engine | EEVEE |

**Why azimuth 60 and not 30.5.** At 30.5 a forward-pointing feature aims almost
straight down the lens and collapses into the body. Rook's beak, its single
strongest silhouette cue, did not appear until frame 3 of a turnaround. A study
at 30.5/45/60/75/90 settled it: 60 to 75 reads the beak and keeps three-quarter
appeal, 90 flattens the body into a profile card.

## Shading — a requirement, not polish

Characters sit inside painted 2D backgrounds. **Default PBR output is a defined
failure even when the geometry is correct**, because glossy characters look
pasted onto painted art. `glb_to_frames.py` retoons every imported mesh
unconditionally, since image-to-3D output ships PBR materials.

`scripts/assets/blender/toon.py`: flat cel bands plus an inverted-hull outline.
Three things went wrong building it, all worth not repeating:

- **Do not multiply band value by base colour.** On a near-black character 0.30,
  0.68 and 1.00 times black are all black, so the one character that most needed
  banding had none. Bands select between a cooled shadow and a warmed light
  derived from the base.
- **Watch the shadow floor.** A floor of 0.55 lifted every dark value and turned
  Rook's ink grey. Check the darkest opaque pixel; it should be near 38,38,47 for
  an ink character, not 90-plus.
- **A black outline on a black character over a dark background is invisible.**
  Two passes were spent "fixing" an outline that was rendering correctly the
  whole time. Always composite on cream before concluding the outline is broken.

## The seven, and their silhouette roles

Presentation only. Names, personalities and the may/may-not contracts in
`docs/goldline/REALITY_BRIDGE.md` and `server/companions/seedCompanions.ts` do
not change. Never rename. Never invent an eighth.

| Companion | Species | Silhouette role in the set |
|---|---|---|
| Rook | rook / corvid | Tallest and narrowest. Long straight beak, wedge tail. |
| Mara | eagle | Widest. Wings held spread, not folded. |
| Sable | hound | Low horizontal, head down to the ground, tail up. |
| Bront | bear | Squarest. Mass, small head sunk into shoulders. |
| Ilex | owl | Top-heavy. Head wider than body, sharp ear tufts. |
| Luma | raccoon | Small body under an enormous ringed tail arcing overhead. |
| Orren | otter | Longest. Low S-curve, flat rudder tail trailing behind. |

They appear in a HUD roster at 48px where **shape is the only thing that
survives**. The first pass differentiated with surface detail — masks, satchels,
goggles — and at 48px all seven collapsed into the same egg with bumps.
Differentiate with proportion and with parts that break the body outline.

Companions must not out-contrast Trailblazer, the heroine.

## Banned, per the visual reference guide

Medieval, castle, crown, gothic, vampire — including in UI chrome. No crown
badge, not even as a buckle. References are Tomb Raider II, Twisted Metal 2,
Metal Gear Solid, Super Mario 3D World. Not photoreal, not anime, not
cute-generic mascot.

## The verification loop — run it, do not assume it

Iteration is about two seconds. Render constantly and *look*.

1. Render the turnaround, not one hero frame.
2. **Composite on cream AND on a teal painted-background proxy.** A dark contact
   sheet hides outline and value problems by construction.
3. Reduce to 48px, alpha only. Can you name the species? Can you tell it from the
   other six?
4. Check the darkest opaque pixel actually held.
5. Only then look at colour and detail.

**Never claim a check you did not run.** There is no database locally and the
admin app is behind a password gate, so DB-backed screens cannot be exercised
here — say so rather than implying coverage. Chapter and Boreslay can be verified
in a browser via `.claude/launch.json`; do that and screenshot it.

A test that cannot fail is worse than no test. Both registry guards were verified
by deliberately breaking them, and that is how one of them was found to be
silently passing everything.

## Pipeline entry points

- `scripts/assets/blender/rig.py` — shared camera, lights, normalization.
- `scripts/assets/blender/toon.py` — cel bands and outline.
- `scripts/assets/blender/glb_to_frames.py` — any GLB to frames plus a registry
  sidecar. Route-independent: local TRELLIS.2, a rented GPU, or any other source.
- `scripts/assets/blender/companions.py` — the blockout body plans. **Blockout
  quality, not shippable.** Kept as scaffolding and as a record of what the
  primitive method produces.
- `npm run assets:scan` after adding any file under an asset root, or the
  registry test fails.

Blender runs **headless from the command line** here, which is scriptable and
needs no GUI. The BlenderMCP socket on `localhost:9876` needs Blender open with
the addon toggled on; skills that assume it still apply, the transport differs.

This machine runs Blender 5.2.1, so the 5.x API traps in `blender-hardsurface`
apply directly.
