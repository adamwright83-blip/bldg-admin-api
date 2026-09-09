# First chapter art provenance — spoilers

## Status (updated 2026-09-09, after two source sheets closed the remaining art gaps)
The `props/scenery-atlas.png` gap is now CLOSED: extracted and repacked from a ChatGPT-generated source sheet (`references/mediterranean_art_deco_rooftop_asset_sheet.png`) into `mechanisms/scenery-atlas.png`, browser-verified in all three rooms and at mobile viewport. Full details in `docs/goldline/creative-mechanism-provenance.md`'s new "Scenery" section.

A second source sheet (`references/golden_teal_fantasy_vfx_asset_atlas.png`, intended as a VFX/interaction atlas, generation id `c2eeb69b-25e6-4974-895e-145ea0403250`) was reviewed and **not integrated**: every gameplay-state slot it could plausibly fill (hit/dodge/launch/redirect/stagger/discovery) is already covered by the existing, fully-wired `fx/impact-atlas.png` from the original creative pass. Forcing a second, redundant set of effects into those same six states would only be decorative duplication, not a real gap fill, and the integration brief explicitly warns against adding effects "simply because the sheet contains them." Its interaction-marker icons (!, ?, gear, hand, chat, search) were also deliberately not adopted — physical/environmental cues (motion, light, trajectory) are the established Goldline language here, and generic floating UI icons were the exact anti-pattern the recovered creative pass corrected away from. The source file is preserved under `references/` for a future pass if a genuinely new effect state is ever added.

**Both remaining art gaps from the previous session are now resolved.** The only asset still outstanding is `characters/heroine-actions.png` (attack/dodge/hurt frames), which was never part of either new source sheet and still has a safe fallback (plain directional idle sprite).

## Background
The premium art pass is substantially DONE. Codex's creative-pass session generated and integrated real production art for all three room backgrounds, all three fictional characters, and every mechanism/prop/effect the chapter currently uses. Detailed per-asset provenance (exact prompts where recorded, generation ids, source files, accept/reject history) lives in three separate documents rather than this one:
- `docs/goldline/creative-environment-provenance.md` — the three background plates.
- `docs/goldline/creative-mechanism-provenance.md` — the machinery/props/effects atlases.
- `docs/goldline/creative-character-provenance.md` — the three character atlases (reconstructed after the fact by SHA-256 match against Codex's local generation cache, since the doc wasn't written before credits ran out; exact prompt text for these three is recorded as UNKNOWN rather than guessed).

This file now tracks only what's still outstanding.

## Approved direction reference
Asset: `client/public/assets/goldline/chapters/the-last-valet/references/approved-art-direction.png`
Status: accepted STYLE REFERENCE, not playable production art.
Generation id: `exec-45c8988e-1d89-4c5a-b5c3-bd7c0c574481` (built-in image generator).
Source: parent task image approved by Adam. No reference image inputs.
Registration: do not crop this into a playable level. Every asset below extends its established palette (bright ivory stone, teal/cyan water, California foliage, warm brass, fixed oblique view, legible shadows, no dark mode).

## Integrated and DONE (no further generation needed)
- Backgrounds: `backgrounds/arrival-court.png`, `backgrounds/turntable-garden.png`, `backgrounds/departure-gallery.png` — all 1536×1024, wired into `ChapterScene.ts`'s `rooms` map, browser-verified rendering distinctly in each room.
- Characters: `characters/inez-atlas.png`, `characters/perrin-atlas.png`, `characters/bellwether-atlas.png` — all 1536×1024, 3×2 six-cell sprite sheets, wired into `ChapterScene.ts` and browser-verified visible in the playable scene (companion, adversary, and supporting character all have real visual presence now, not just dialogue).
- Mechanisms/props/effects: `mechanisms/machinery-atlas.png`, `mechanisms/props-atlas.png`, `mechanisms/scenery-atlas.png`, `fx/impact-atlas.png` — all 1536×1024, 3×2 six-cell sheets, wired and browser-verified (launcher, redirector, weight, manual latch, balcony, luggage-sentinel enemy placeholder, raised-island platform, foreground rail, gate, shortcut crate, decorative wheel, and all impact/dodge/launch/stagger/discovery FX frames).

The mechanism/props/fx atlases use a solid white background for runtime multiply-compositing (genuine alpha transparency requests to the built-in generator failed reliably in Codex's session). `scenery-atlas.png` is the one exception — its source sheet came with genuine RGBA transparency, so it's composited normally rather than multiply-blended (see `creative-mechanism-provenance.md`'s Scenery section for the extraction/cleanup details).

## Still BLOCKED on image generation
One asset is still outstanding: **`characters/heroine-actions.png`** (key `actions` in `ChapterScene.ts`) — a 3-column × 1-row, three-cell 512×512 strip: cell 0 attack/strike lunge, cell 1 dodge-roll, cell 2 hurt/flinch recoil. Same adult female pulp-adventurer character as the existing `trailblazer/directional/idle-*.webp` set, matching proportions and the teal/tan practical outfit. Exact prompt: *"Use case: stylized-concept. Production action-game character sprite strip, premium painterly 2.5D adventure GOLDLINE. 1536x1024 PNG, THREE equal columns ONE row, three 512px square cells. Solid PURE WHITE #FFFFFF background, no scenery, no shadows outside the character, no text/grid/labels. Adult female pulp adventurer, practical teal vest and tan trousers, brown boots, dark hair tied back, fixed high oblique three-quarter camera matching the existing idle directional rig's proportions and scale. Cell 1 (left): forward attack lunge with a short decisive gesture, weight forward. Cell 2 (middle): low dodge-roll crouch pose with implied motion. Cell 3 (right): hurt recoil flinch, weight thrown backward. Same character, same scale and anchor point (feet at cell bottom-center) across all three cells."* Until generated, `ChapterScene.ts` already falls back to the character's normal directional idle sprite for attack/dodge/hurt states (verified: no visual break, just less dynamic).

## Recording future accepted/rejected assets
When image generation becomes available for the asset above, append a dated entry to the relevant provenance doc (or a new one) with: path, purpose, dimensions, exact prompt used, generation reference/id, accepted or rejected (and why), and regeneration notes if rejected.
