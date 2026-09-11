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

## The prompt

Written as prose rather than comma-separated tags, because Gemini reads prose
better. Lives at `ROOK_PROMPT.txt` for copy-paste. Every clause is load-bearing:
the sixty-degree turn exists so the beak reads, the wing gap exists so wings do
not fuse into the torso during reconstruction, and the flat background exists
because image-to-3D bakes busy backgrounds into geometry.

```
A full-body character design of Rook, an eccentric stylised cartoon corvid, a
scruffy black rook bird standing upright on two legs like a small person. Turned
about sixty degrees away from the camera so the head is seen in near-profile and
the long straight slate-grey beak is fully visible along its whole length,
projecting clearly forward into empty space and never overlapping the chest.

Build and silhouette: tall and noticeably narrow, the lankiest possible bird.
High hunched shoulders that sit up around the head giving a hard shoulder line, a
small head set low between them, a straight back, and a stiff wedge-shaped tail
angled down and back away from the body. Skinny amber-yellow legs with big
splayed three-toed feet. Wings folded but held slightly away from the torso so a
clear gap of background is visible between each wing and the body.

Character: a socially fearless messenger, permanently mid-errand, the sort who
will talk to anyone whether or not they want to be talked to. Unkempt and busy.
A few feathers stick up at the back of the head in a cowlick. A worn brown
leather messenger satchel with a brass buckle hangs on one hip, stuffed too full,
with three or four rolled paper message tubes and a couple of pens poking out of
it at odd angles. One extra pen is tucked behind the head. A single brass cuff on
one leg. The beak tip and one foot are stained with dark ink. Head tilted very
slightly, one eye a touch wider than the other, as though about to start talking.

Keep all the clutter zoned to the satchel hip. The chest, back and wings stay
clean and undetailed so the busy area reads against them.

Colour: ink-black and charcoal feathers with visible cool blue-grey in the light
areas, a slate-grey beak, warm brass hardware, amber-yellow legs and feet, and
one small teal accent on the satchel strap. Keep the bird genuinely dark. Rich
blacks, not washed-out grey.

Style: chunky stylised video-game character with clean readable shapes and bold
simple forms, the proportions and appeal of Super Mario 3D World, combined with
the gritty practical prop design and lived-in worn materials of Tomb Raider II
and Metal Gear Solid. Flat painterly shading with soft simple gradients, like
hand-painted game concept art. Not photorealistic, not anime, not a glossy
plastic mascot, not cute or babyish. Eccentric and characterful.

Presentation: one single character alone, nothing else in the frame. Completely
plain flat light grey background with no gradient, no vignette, no shadow, no
floor and no scenery. Whole body visible from the top of the head to the bottom
of the feet with generous empty margin on all four sides. Neutral standing pose,
weight evenly on both feet, arms and wings not touching the torso. Flat, even,
soft studio lighting from the front with no harsh shadows and no dramatic rim
light. Everything in sharp focus, no motion blur, no depth of field, no glow, no
lens flare. Square image.

Avoid: any background scenery or environment, more than one character, action or
flying poses, spread wings, cropped or cut-off feet, dramatic or moody lighting,
heavy shadows, motion blur, bokeh, glow, text, watermarks, logos, and anything
medieval, gothic, castle, crown, heraldic or vampire.
```

## Acceptance check before it goes into the pipeline

1. Does the whole body fit with margin on all four sides?
2. Is the background genuinely flat, with no gradient or vignette?
3. Do the wings and arms read as separate from the torso?
4. Is the beak clearly projecting, not merged into the head?
5. Reduce it to 48px and squint. Is it obviously a tall narrow bird, and obviously not
   the owl, the eagle or the raccoon?

Check five is the one that has already failed twice in scripted geometry. It is worth
doing on the concept image before spending generation time on it.
