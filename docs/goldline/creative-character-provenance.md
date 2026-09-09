# Character production provenance — spoilers

Generated 2026-09-09 using the built-in `image_gen` tool only, in the same session as the mechanism/effects atlases (docs/goldline/creative-mechanism-provenance.md) and using the same approved style reference. Credits ran out before this document could be written at the time of generation; it is reconstructed after the fact by matching the three accepted files in the repo against their exact source files by SHA-256 hash, since no prompt-text log survived. **The exact prompt wording used for these three generations is not recoverable and is recorded here as UNKNOWN rather than reconstructed or guessed.**

All three files are **1536×1024**, three columns × two rows, six 512×512 cells, RGB with no alpha (same white-background-for-multiply-compositing convention as the mechanism atlases, confirmed by `sips -g hasAlpha` → no on all three).

## Accepted files

- `client/public/assets/goldline/chapters/the-last-valet/characters/inez-atlas.png`
  - Generation id: `exec-ea3527ea-bc4a-4df7-9e10-42532c020dc4`
  - Source: `/Users/adamwrightpfi/.codex/generated_images/01a086b2-b408-74e1-b634-0d39b556dfe1/exec-ea3527ea-bc4a-4df7-9e10-42532c020dc4.png` (verified by SHA-256 match)
  - Frame mapping in use (`ChapterScene.ts`): frame 0 idle, frames 1–2 walk cycle, frame 3 echo/ghost pose, frame 4 unused, frame 5 near-weight pose.
  - Exact prompt: UNKNOWN — not recorded before the session ended.

- `client/public/assets/goldline/chapters/the-last-valet/characters/perrin-atlas.png`
  - Generation id: `exec-c0b0f17a-5f78-4100-84f3-0228cca51a48`
  - Source: `/Users/adamwrightpfi/.codex/generated_images/01a086b2-b408-74e1-b634-0d39b556dfe1/exec-c0b0f17a-5f78-4100-84f3-0228cca51a48.png` (verified by SHA-256 match)
  - Frame mapping in use: frame 4 used when the player's "break" choice was taken, frame 5 used for the "preserve" choice — the same character, two reaction poses.
  - Exact prompt: UNKNOWN — not recorded before the session ended.

- `client/public/assets/goldline/chapters/the-last-valet/characters/bellwether-atlas.png`
  - Generation id: `exec-4b7d42c2-9bc0-4539-84fe-2b92dbcbffcc`
  - Source: `/Users/adamwrightpfi/.codex/generated_images/01a086b2-b408-74e1-b634-0d39b556dfe1/exec-4b7d42c2-9bc0-4539-84fe-2b92dbcbffcc.png` (verified by SHA-256 match)
  - Frame mapping in use: frame 0 idle/tell, frame 3 charge, frame 4 recover (the "opening" the player can exploit), frame 5 down.
  - Exact prompt: UNKNOWN — not recorded before the session ended.

## Rejected generations (same session, same source directory)

Three other files exist in the same source directory and were not carried into the repo (disposition and exact rejection reason are unrecorded, consistent with mid-session credit exhaustion): `exec-23b65a89-ff34-4c44-afaa-2eb18a34d7bb.png`, `exec-beec82a6-b555-4dbd-a03a-eed496ed0907.png`, `exec-ec843142-3757-472c-8e21-91fcf5cca6e9.png`.

## Regeneration guidance

If any of the three accepted atlases needs regeneration, treat it as a fresh generation using the same conventions as the mechanism/effects atlases: 1536×1024, three columns × two rows of 512×512 cells, solid white background for runtime multiply compositing (transparent-alpha requests failed reliably in this tool during this session), fixed high oblique three-quarter camera, warm ivory/brass/deep-teal material palette matching `references/approved-art-direction.png`, consistent character scale/anchor across all six cells. Do not invent a different frame count or layout — `ChapterScene.ts`'s `sprite()` helper assumes exactly six 512×512 cells in a 3×2 grid for every character atlas.
