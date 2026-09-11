# ROOK — concept image spec

**Status:** input spec for the image-to-3D pipeline. Written 2026-09-11.
**Scope:** presentation only. Rook's name, personality and the protected may/may-not
contract in `docs/goldline/REALITY_BRIDGE.md` and `server/companions/seedCompanions.ts`
are unchanged by this document. Only visual form is decided here.

Rook is the proving case for the whole companion pipeline because Rook is Kingdom 2's
unlock and the only companion with an engine already behind it (`draftCustomerMessageTool`).

---

## What this image is for

It is **not** the shipped asset. It is the single input to image-to-3D generation, which
produces a GLB, which then goes through the Blender rig to become the shipped frames.
That changes what a good image looks like. A gorgeous painterly illustration with a
dramatic background makes a *worse* 3D model than a plain, evenly-lit, front-facing one.

Pipeline position:

    THIS IMAGE -> TRELLIS.2 -> textured GLB -> Blender rig -> PNG frames -> asset registry -> HUD

---

## Hard requirements for the generator

These exist because image-to-3D fails in specific, predictable ways.

| Requirement | Why |
|---|---|
| Single character, nothing else in frame | Extra objects get fused into the mesh |
| Plain flat background, white or mid grey | Busy backgrounds bleed into geometry |
| Full body, head to feet, nothing cropped | Anything out of frame is invented badly |
| Three-quarter front view, camera at chest height | Gives the model both front and side information |
| Even, soft, neutral lighting | Hard shadows get baked in as geometry |
| Arms and wings held clear of the body | Touching limbs fuse into the torso |
| Neutral standing pose, weight on both feet | Dynamic poses bake in and cannot be animated out |
| No motion blur, no depth of field, no glow | All of it is read as surface detail |
| Square image, 1024x1024 or larger | Matches the pipeline's working resolution |

The pose rule is the one most often broken. An action pose looks better as an image and
is useless as a base mesh, because the rig has to drive the pose afterwards.

---

## Character direction

Rook is a corvid. Outreach and drafting. Socially fearless messenger, the one sent in
to talk to strangers. Rook is unified with the shipped Dayforge coach persona and that
unification stands.

**Read:** eccentric, silly, characterful. Super Mario 3D World build with Tomb Raider II
and Metal Gear Solid grit in the props and palette. Not photoreal, not anime, not a
soft generic mascot.

**Silhouette, which is the thing that actually matters.** Rook appears in a HUD roster at
48px where shape is all that survives. Rook's job in the set of seven is to be the
**tallest and narrowest**. Build that in deliberately:

- Upright, standing tall, noticeably slimmer than a rounded bird
- Hunched shoulders sitting high, giving a hard shoulder line
- Long straight beak projecting clearly forward, clear of the chest
- A hard wedge tail angled down and back, breaking the body outline
- A messenger satchel on one hip, the only large prop, reading as a distinct block

**Palette.** Ink and charcoal body, slate beak, warm brass hardware on the satchel,
amber legs and feet. Teal is available as a single accent. Keep values dark enough that
Rook stays dark. A previous render pass bleached the blacks to beige and destroyed
the character.

**Must not compete with Trailblazer**, the heroine. Rook is a sidekick. Keep the
silhouette busy-free and the palette below the heroine's in contrast.

**Banned**, per the visual reference guide in `docs/GOLDLINE-TASKS.md`: medieval, castle,
crown, gothic, vampire. No crown badge, no heraldry, not even as a satchel buckle.

---

## Prompt starting point

Adjust freely, but keep every clause from the hard requirements table.

> Full body character design of a stylised cartoon rook, a black corvid bird, standing
> upright and facing three-quarters toward camera. Tall narrow build, high hunched
> shoulders, long straight slate-grey beak pointing forward, hard wedge-shaped tail
> angled down and back. Wearing a brass-buckled leather messenger satchel on one hip.
> Ink-black and charcoal feathers, amber legs and feet. Eccentric and characterful,
> chunky stylised game character, Super Mario 3D World proportions with a gritty
> practical prop design. Neutral standing pose, wings folded but held slightly clear of
> the body, arms not touching the torso. Even soft neutral studio lighting, no harsh
> shadows. Plain flat light grey background. Full body visible head to feet, nothing
> cropped. Sharp focus throughout, no motion blur, no depth of field, no glow.
> Square image.

**Negative / avoid:** background scenery, multiple characters, action pose, flying,
wings spread, cropped feet, dramatic rim lighting, heavy shadow, motion blur, bokeh,
text, watermark, crown, castle, medieval, gothic.

---

## Acceptance check before it goes into the pipeline

1. Does the whole body fit with margin on all four sides?
2. Is the background genuinely flat, with no gradient or vignette?
3. Do the wings and arms read as separate from the torso?
4. Is the beak clearly projecting, not merged into the head?
5. Reduce it to 48px and squint. Is it obviously a tall narrow bird, and obviously not
   the owl, the eagle or the raccoon?

Check five is the one that has already failed twice in scripted geometry. It is worth
doing on the concept image before spending generation time on it.
