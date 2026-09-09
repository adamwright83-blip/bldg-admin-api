# First chapter art provenance — spoilers

## Status (updated 2026-09-09)
The first chapter's production art set is now complete. There are no remaining image-generation blockers.

The final missing runtime asset, `characters/heroine-actions.png`, was generated in ChatGPT from the existing brief and committed to `main` in `854aed823b36b46a2d168723470f2e1d5fca1155`. It supplies the three transient Trailblazer action poses already wired by `ChapterScene.ts`: attack, dodge, and hurt.

The scenery gap was already closed in `d4350c6b743b0df0db7aa97ca87f83e52dab9661`: a ChatGPT-generated Mediterranean Art Deco rooftop source sheet was deterministically cropped/repacked into `mechanisms/scenery-atlas.png`. The separate golden/teal VFX source sheet remains reference-only because the existing `fx/impact-atlas.png` already covers every live gameplay effect state and the sheet's floating UI icons conflict with the chapter's physical/environmental interaction language.

## Approved direction reference
Asset: `client/public/assets/goldline/chapters/the-last-valet/references/approved-art-direction.png`
Status: accepted STYLE REFERENCE, not playable production art.
Generation id: `exec-45c8988e-1d89-4c5a-b5c3-bd7c0c574481`.
Registration: do not crop this into a playable level. Production art extends its bright ivory stone, teal/cyan water, California foliage, warm brass, fixed oblique view, legible shadows, and no-dark-mode direction.

## Integrated and DONE
- Backgrounds: `backgrounds/arrival-court.png`, `backgrounds/turntable-garden.png`, `backgrounds/departure-gallery.png`.
- Fictional characters: `characters/inez-atlas.png`, `characters/perrin-atlas.png`, `characters/bellwether-atlas.png`.
- Trailblazer actions: `characters/heroine-actions.png`.
- Mechanisms/props/effects: `mechanisms/machinery-atlas.png`, `mechanisms/props-atlas.png`, `mechanisms/scenery-atlas.png`, `fx/impact-atlas.png`.

The mechanism/props/fx atlases use a solid white background for runtime multiply-compositing. `scenery-atlas.png` uses genuine RGBA transparency and is composited normally. `heroine-actions.png` also uses a white background and the existing action-sprite multiply path in `ChapterScene.ts`.

## Heroine action atlas — accepted 2026-09-09
Runtime path: `client/public/assets/goldline/chapters/the-last-valet/characters/heroine-actions.png`
Purpose: frame 0 attack/strike lunge, frame 1 dodge-roll/crouch, frame 2 hurt/flinch recoil.
Runtime layout: 3 columns × 1 row. The committed strip is 576×192 (three 192×192 cells); `ChapterScene.ts` slices by actual texture dimensions, so the frames remain square and are rendered at 99×99 in-scene without distortion.
Source generation: ChatGPT image generation in the 2026-09-09 continuation session. Generation id was not exposed to the repository-writing tool, so it is recorded as unavailable rather than invented.
Source output: 1536×1024 RGB on white. The useful top 512px contained all three centered action poses. That region was cropped to a true 3×1 square-cell strip, then downsampled per cell to 192×192 and palette-optimized for the runtime asset. The character feet remain centered near each cell's lower edge, matching the sprite anchor convention.
SHA-256 of the committed runtime bytes before GitHub upload: `19b8d2d30135fcb8f1e5e6a4a6b2d251710feef031b8e95d8f517d04f2650432`.
Git blob: `3329a21c6c615ca5ba86bcf52078b21549b021bb`.
Status: ACCEPTED for the first playable chapter. The existing directional-idle fallback remains in code, so a failed asset load still cannot break movement or combat presentation.

Exact generation brief used as authority:

> Use case: stylized-concept. Production action-game character sprite strip, premium painterly 2.5D adventure GOLDLINE. 1536x1024 PNG, THREE equal columns ONE row, three 512px square cells. Solid PURE WHITE #FFFFFF background, no scenery, no shadows outside the character, no text/grid/labels. Adult female pulp adventurer, practical teal vest and tan trousers, brown boots, dark hair tied back, fixed high oblique three-quarter camera matching the existing idle directional rig's proportions and scale. Cell 1 (left): forward attack lunge with a short decisive gesture, weight forward. Cell 2 (middle): low dodge-roll crouch pose with implied motion. Cell 3 (right): hurt recoil flinch, weight thrown backward. Same character, same scale and anchor point (feet at cell bottom-center) across all three cells.

## Detailed provenance for the rest of the art
- `docs/goldline/creative-environment-provenance.md` — three background plates.
- `docs/goldline/creative-mechanism-provenance.md` — machinery, props, effects, and scenery.
- `docs/goldline/creative-character-provenance.md` — Inez, Perrin, and Bellwether atlases.

No additional first-chapter art generation is required before live integration testing.