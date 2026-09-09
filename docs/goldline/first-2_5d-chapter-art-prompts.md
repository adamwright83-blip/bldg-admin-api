# First chapter art provenance — spoilers

## Status
Slice 9 (premium 2.5D art pass) is BLOCKED on image generation: no image-generation tool is available in this Claude Code session. Per the execution contract's own fallback instruction (section 21), this pass instead delivers the complete asset contract, the loading hooks, and this production-ready prompt manifest — every entry below is PENDING (not generated) until a session with image generation runs it. `client/src/game/chapters/firstChapter/artManifest.ts` declares the exact repo path, purpose, and dimensions for each asset; `FirstChapter.tsx` already tries to load every path and falls back to the current vector graybox per-element when a file is missing (verified: with zero art files present, rendering and behavior are unchanged — see the Slice 9 commit for browser verification). Dropping a real file at any listed path activates it immediately, one asset at a time, with no code changes needed.

## Approved direction reference
Asset: client/public/assets/goldline/chapters/the-last-valet/references/approved-art-direction.png
Status: accepted STYLE REFERENCE, not playable production art.
Generation id: exec-45c8988e-1d89-4c5a-b5c3-bd7c0c574481 (built-in image generator).
Source: parent task image approved by Adam. No reference image inputs.
Effective prompt: A landscape GOLDLINE proposed 2.5D art-direction board with two large gameplay viewports, CITY SCALE and ADVENTURE SCALE. Same sunny luxury LA rooftop courtyard from high oblique and closer fixed three-quarter cameras. Ivory tower, palms, cyan fountain, brass mechanisms. Full-body adult female pulp adventurer about 12% frame height, practical teal/tan outfit. Rich hand-painted pre-rendered adventure backgrounds, strong foreground/midground/background separation, sprite-compatible character, grounded shadow, playable paving terraces/stairs/occluding rail. Premium saturated daylight, no photorealistic over-shoulder AAA camera, no spoilers, villains, secrets, fake business facts or named real-property claims. Footer: Concept art • staged cameras • layered scenery • animated characters.
Registration: do not crop this into a playable level; author registered separate layers. All prompts below extend this established palette/style (bright ivory stone, teal/cyan water, California foliage, warm brass, fixed oblique view, legible shadows, no dark mode).

## Backgrounds (960×640, far background + architecture layer)
All PENDING. Common style suffix for every background prompt below: "Hand-painted 2.5D adventure-game background, bright warm California daylight, ivory stone architecture, teal/cyan water accents, brass machinery details, fixed oblique three-quarter camera, strong midground/background depth separation, no characters, no UI, no text, no spoiler dialogue, matches the approved GOLDLINE style reference."

- `backgrounds/arrival-court.webp` — Prompt: "A sunlit lower terrace of a luxury tower's service courtyard, ivory stone paving, a low foreground rail at the bottom edge, one raised machinery housing mid-frame, a glimpse of a locked brass inspection balcony in the upper-left corner, an open gate visible upper-right." + style suffix.
- `backgrounds/turntable-garden.webp` — Prompt: "A rooftop machinery garden one level up, brass turntable mechanisms and rail tracks embedded in ivory stone, a raised central housing, glimpses of a redirect mechanism and a bridge structure toward the upper right, warm brass fittings throughout." + style suffix.
- `backgrounds/departure-gallery.webp` — Prompt: "An upper ceremonial departure hall, tall arched openings, a large brass departure mechanism as the room's centerpiece, cover islands scattered through the space, a return exit visible lower-left, dramatic warm late-afternoon light." + style suffix.

## Foregrounds (960×160 strips, occluding rail layer)
All PENDING. Common suffix: "A foreground occluding rail strip for a 2.5D adventure game, transparent background (alpha), warm ivory stone and brass railing with light foliage, designed to sit in front of character sprites at the bottom of the screen, matches the approved GOLDLINE style reference."

- `foregrounds/arrival-rail.webp`, `foregrounds/garden-rail.webp`, `foregrounds/gallery-rail.webp` — each: "[room-appropriate] low rail with potted California foliage, occasional brass fitting." + style suffix.

## Characters (transparent background, existing Trailblazer proportions: ~64×94 idle/action frames unless noted)
All PENDING. The existing `client/public/assets/goldline/characters/trailblazer/directional/idle-*.webp` set is REUSED as-is for idle/movement in graybox and should stay the base rig; only the frames below are new.

- `characters/heroine-dodge.webp` — "Action-game dodge-roll sprite frame set for an adult female pulp adventurer in a practical teal/tan outfit, low-crouch roll pose with motion blur, transparent background, matches the existing Trailblazer directional idle set's proportions and palette."
- `characters/heroine-attack.webp` — "Melee strike swing frame set, same character, forward lunge with a short-reach weapon/gesture, transparent background, matches existing rig proportions."
- `characters/heroine-hurt.webp` — "Hit-reaction flinch frame, same character, recoil pose, transparent background, matches existing rig proportions."
- `characters/inez-vale.webp` (companion, 64×94) — "A fictional restorer of impossible machines, practical work clothes, warm brass tool belt, dry confident stance, transparent background, matches GOLDLINE character style." (No further identity details — spoiler content stays in this doc only.)
- `characters/bellwether.webp` (adversary, 96×140) — "An immaculate mechanical maître d' character, tall formal silhouette with brass/clockwork details, courteous posture, transparent background, matches GOLDLINE character style."
- `characters/perrin.webp` (supporting character, 64×94) — "A fictional gallery custodian, practical formal attire, protective stance near ceremonial machinery, transparent background, matches GOLDLINE character style."

## Mechanisms (transparent background, sprite-sheet states)
All PENDING. Common suffix: "2.5D game mechanism sprite, warm brass and ivory-stone materials, clearly readable silhouette communicating its function at a glance, transparent background, matches the approved GOLDLINE style reference."

- `mechanisms/launcher-states.webp` — "A small brass launching mechanism, three states in one sheet: dormant (idle, cool tones), active (player nearby, warm glow), launching (motion streak)." + style suffix.
- `mechanisms/redirector-states.webp` — "A brass redirector dial mechanism, three states: dormant, active with a visible heading indicator needle, redirecting with a brief motion flash." + style suffix.
- `mechanisms/weight.webp` — "A single small brass-trimmed trolley weight/ball, one clean readable silhouette, no state variants needed." + style suffix.
- `mechanisms/manual-latch.webp` — "A brass manual handle/latch, two states: closed (down position) and open (thrown, up position)." + style suffix.
- `mechanisms/balcony.webp` — "A brass-railed inspection balcony alcove, two states: locked (dim, shadowed, faint outline) and unlocked (fully lit, warm inviting glow)." + style suffix.

## FX (transparent background, small sprite/particle sheets)
All PENDING.
- `fx/hit-spark.webp` — "A small bright impact flash/spark burst for a combat hit, warm ivory-gold palette, transparent background."
- `fx/telegraph-line.webp` — "A thin repeating dashed-line texture tile for an enemy attack telegraph trajectory, warm red-orange, transparent background."
- `fx/secret-discovery.webp` — "A soft one-shot particle burst for a discovery/reveal moment, warm golden sparkle, transparent background."

## Recording future accepted/rejected assets
When image generation becomes available, for every asset actually produced, append a dated entry here with: path, purpose, dimensions, exact prompt used, generation reference/id, accepted or rejected (and why), and regeneration notes if rejected. Do not overwrite this pending-prompt catalog — extend it.
