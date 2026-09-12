# Why Goldline looks amateur, and the plan

Written 2026-09-11 against measured state, after Adam supplied deep research on
2.5D sprite integration, visual identity, and the PixiJS performance ceiling.

**This document constrains future Goldline work.**

---

## 1. The diagnosis

It is not six problems. It is one, and it has produced six symptoms.

**Goldline has no spatial contract.** Not a missing style guide — a style guide
exists (Tomb Raider II, Twisted Metal 2, Metal Gear Solid, Super Mario 3D World,
with medieval/castle/crown/gothic/vampire banned). What is missing is the layer
*underneath* style: a shared agreement about what space is. Where the camera
sits. Where light comes from. How tall a person is. What the ground is.

Each surface was shipped as a feature slice, with art generated per-slice by a
different tool, and each invented its own answer or none:

| Surface | Spatial contract | State |
|---|---|---|
| Tower Wars | 800×1200 art space, `center bottom` pivot | Real, documented, correct |
| Expedition | `ScreenProjection → {x, y, scale}` | Real, depth-aware |
| Lantern City | `SCENE_ART` per-territory atlas | Different again |
| **The chapter** | **none** | **The flagship surface had no answer** |

Three contracts and one void, never reconciled. That is the root cause.

### Why that produces "amateur" specifically

The eye reads spatial consistency *before* it reads art quality. A crude terrace
with a correctly scaled figure beats a beautifully painted one with a fixed-size
figure. The supplied research quantifies it: ground-plane projection with depth
scaling is roughly **40%** of whether a sprite reads as inhabiting a painting,
dual-layer contact shadows a further **30%**, foreground occluders **15%**.
Together, 85%.

Goldline's flagship chapter had **zero of the three**. Measured, before today:

- Every actor rendered at a fixed pixel size — the heroine was `58×86` whether
  she stood at the balustrade or at the camera, on a floor painted in perspective.
- One contact shadow: a 25px ellipse at a flat 22% alpha, same size at every depth.
- No foreground occluders at all — while `corridor_01/occlusion-accents/` has
  had `left-frame.webp` and `right-frame.webp` for another surface the whole time.

So the most expensive thing in the project — hand-painted backgrounds — was being
undermined by the cheapest thing to fix.

### The second-order cause

Art was generated **to fill screens**, not **to fit a world**. 652 images across
two asset roots, 740 MB, sourced from ChatGPT, Meta and Codex sessions in
mismatched styles. There was never a world-bible step, so there was nothing for
new art to conform to, so each new batch drifted further.

---

## 2. Where I went wrong

I treated every finding as a ticket. Walk cycle, then hitstop, then depth scale —
each individually correct, none of them adding to a plan, because I never asked
"what is *the* thing wrong with this game." I also proposed layered 2D and Blender
character work without noticing that both add more sprites to a scene whose
problem is that sprites do not sit in it. Fixing collision before establishing the
ground plane was the same error in miniature.

---

## 3. The identity, decided

From the research synthesis, the four references converge on something coherent
once stripped of narrative skin: **fixed, legible cameras and readable toy
materials, with an operational intelligence layer over a real city.**

- **Twisted Metal 2** gives the structure: real city topography *is* the level.
  Los Angeles territories are not a map skin over a game, they are the game board.
- **Metal Gear Solid** gives the interface: a CODEC operational layer. Phosphor
  green on near-black, thick double-border frames, monospace, scanline. This is
  what turns real customer orders into missions and kills the admin-widget read.
- **Tomb Raider II** gives the light: expedition lighting, flickering warm key
  against teal shade, orange/teal contrast.
- **Super Mario 3D World** gives the camera and the materials: a parallel camera
  holding a set distance and direction, never orbiting; saturated-but-restrained
  toy surfaces that stay readable at small size.

**Two decisions define the look**, and everything else is downstream:

1. **Parallel fixed camera plus grounded contact shadow.** If the camera feels
   like a game and the actor's shadow anchors it, imperfect art survives.
2. **CODEC operational layer over LA topography.** The city is the level structure.

**Deliberately excluded:** free-orbit cameras and tank-control nostalgia,
photoreal LA and PBR materials, full diegetic-UI purism, and — beyond the ban —
medieval anything, which is *structurally* wrong here: it implies vertical stone
hierarchy, and this business is horizontal, flat-roofed, van-based Los Angeles.

---

## 4. The plan, in dependency order

### Phase 1 — The world contract (keystone, cheap, does not exist)
One module every surface reads: camera pitch, unit scale (1 unit = 1 m, adult
= 1.75), key light direction and colour temperature, per-room ground plane,
palette tokens. Today's `groundPlane.ts` is the chapter's shard of this; promote
it to a shared contract and make Tower Wars, Expedition and Lantern City
reference the same source rather than three private ones.

### Phase 2 — Make the chapter obey it (the 85%)
- Ground-plane depth scaling — **done**
- Dual-layer contact shadows — **done**
- **Foreground occluders — not done, 15%, the largest remaining single win.**
  Author pillars, planters and the balustrade as cutouts from the painted
  background, inpaint behind them, render after actors. This is what converts a
  flat composite into a space you can be inside.
- Light and colour matching — sprite tint and `ColorMatrixFilter` to the room's
  key direction and temperature. Cheap, ~8%.

### Phase 3 — Kill the admin-widget read
The chapter currently renders as a bordered canvas in a document, with a page
title above and flat rectangular Dodge/Strike/Use buttons below. Apply the CODEC
layer: full-bleed canvas, operational HUD, monospace numerics, no page chrome
during play.

### Phase 4 — Cull the art that cannot obey
The registry now knows every one of the 652 images and which pipeline owns it.
Retire what predates the contract rather than carrying it. Immediate free win
already identified: 61 territory plates ship as 116 MB of PNG while a complete
29 MB WebP conversion of the same pictures sits unused.

### Phase 5 — Only now, new characters
Blender companions come *after* the world they stand in is coherent. Seven new
sprites in a scene that cannot ground sprites is seven more stickers.

---

## 5. Performance budget

From the PixiJS research, ranked by perceived quality per millisecond, the
cheapest wins are the ones this plan leans on: baked AO plus contact blob shadow
(0.05 ms, highest ratio in the entire stack), single atlas with batching and
culling, and `cacheAsTexture` for static complexity. Full deferred normal-mapped
lighting costs 2.5–4 ms and breaks the 16.6 ms frame budget — excluded.
