# Provenance and fit

**Source:** `achimala/TheLongSilence`, `.claude/skills/blender-hardsurface/`.
Vendored 2026-09-11, unmodified. MIT-family open source; see the upstream repo.

**Why it is here.** Goldline's first scripted-Blender companion pass failed by
stacking primitives, and that failure was mis-diagnosed as "Blender cannot author
character shapes". This skill opens by naming the real cause:

> primitive assembly has a hard ceiling, and no amount of lighting or framing
> gets you past it.

**What transfers to Goldline, fully:**

- Never stack primitives. Sweep a varying cross-section and bridge it into one
  continuous skin.
- Cut detail INTO the surface with `inset_region` and push it along the normal.
  Boxes glued to a surface always look glued on. Goldline's failed Rook satchel
  and Mara goggles were exactly this.
- Detail hierarchy with restraint. Three tiers, fine detail near 1/60 of length,
  and deliberately clean areas. Detail only registers against undetailed.
- Flat-shade the hull. Plate, not plastic. Agrees with Goldline's toon requirement.
- Derive the camera from the scene bounding box, never by hand.
- Render constantly and look. Iteration is about two seconds.
- The Blender 5.x API traps. This machine runs 5.2.1, so they apply directly.

**What does NOT transfer, and matters:**

- It is a HARD-SURFACE skill for spacecraft. Octagonal loft rings and panel bays
  make hulls, not a raccoon. Goldline's seven companions are organic animals.
  The principles above hold; the specific octagon-ring technique does not.
  The organic equivalents are the skin modifier on a vertex skeleton, metaballs,
  and swept curves with taper for tails and wings.
- Pointiness edge wear is Cycles-only. Goldline renders EEVEE for speed.
- It assumes the BlenderMCP GUI socket on localhost:9876. Goldline drives Blender
  headless from the command line instead, which is scriptable and needs no GUI.
  The modelling content is unaffected by that difference.

**Scope reminder.** Goldline's Blender pipeline is restricted to characters that
animate, per the scope constraint in `docs/goldline/BUILD_BRIEF_PRESENTATION.md`.
This skill does not widen that.
