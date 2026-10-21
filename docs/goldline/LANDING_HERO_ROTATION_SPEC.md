# JOYSTICK landing hero — rotating-persona spec (2026-10-20)

**Status:** decided. Written by Claude (Fable 5.1) after comparing Adam's concept renders (TJ / Daisy) with town.com's
hero. An executing designer or session implements this; the copy and rules below are not reopened without Adam.
Binding inputs: `docs/goldline/JOYSTICK_BRAND_CANON.md` (tagline `REAL WORK. PLAYABLE.` is locked), the banned/approved
line list in memory `feedback-marketing-lines-banned-and-loved` (never "save file", never "monsters are fake", never
"adventure", "gamify", or military/tactical language in ads; never name Town in ads).

## 1. Why town.com's hero works, mechanically

Their page is **one sentence the layout reads out loud**: "Learns how you work, [a real person] … then gets to work."
Everything else is subordinate to that sentence. The constant line ("The unusually helpful AI work assistant") and the
single CTA never move. Only four things rotate, and they rotate **together** every ~7 s: the person's photo, the accent
colour (backdrop, highlight, composer ring, mascot name), the mascot illustration + name, and the composer's example task.
The product is never explained; it is **demonstrated** by the composer examples ("Summarize the Q3 board deck",
"Renegotiate Snowflake contract renewal"). Word count in the hero: nine.

Why it reads "NYT illustrator + real designer" instead of AI:

- **Real photography** of real people on a flat seamless backdrop (one colour, soft shadow). No scene, no props.
- **Deliberately crude line illustration** (sharpie weight, two flat colours, a hand-lettered name). Imperfection is the
  signal of a human hand. Photoreal renders signal a model.
- **One typographic system**: a heavy serif display for the sentence, one grotesk for UI, nothing else.
- **Silence**: the middle third of the page is empty. The eye has one path: headline → person → tagline → CTA → composer
  → mascot → "then gets to work."

## 2. Why the concept renders read as AI, specifically

1. **No constant promise.** "Meet TJ." and "The AI that catches you up with dormant customers, cozy style" are different
   headlines. The visitor never learns what the product is; they learn about TJ. Town rotates the person, never the promise.
2. **Six concepts per screen.** Headline + three-line story + MISSION CONTROL label + kicker + a mockup full of UI +
   composer. Town has one sentence and a composer.
3. **Photoreal AI people in AI scenes.** The Beverly Hills street, the woman in bed with a tablet: over-lit, over-detailed,
   stock-fantasy lighting. That is the look readers now file as "generated".
4. **The mockup UI is the banned register.** CAUTION, biohazard, "HOTSPOT DETECTED", a 00:10 timer, "TOXIN DETECTING DOOR
   HANGERS SECURED", "bioweapons" in the headline. Tactical/military language is banned for the launch audience, and on a
   $49 small-business tool it reads as a joke the reader was not let in on.
5. **Copy that hedges or memes.** "cozy style" is a hedge; "Don't threaten him with a good time" is a meme. Neither is a
   claim. The one genuinely great line on either render is **"She loved cozy games. Not follow-through."** That is the
   door problem in six words, in a human voice. Keep that pattern; it is the template for every persona (§5).
6. **Format is a poster per persona, not a sentence.** Nothing on the page continues across the rotation.

## 3. The JOYSTICK sentence (the hero, constant structure)

Top-left, heavy serif, split around the photo exactly as Town does:

> **Knows your business,**  [photo]  **… then gets you out the door.**

Constant tagline, centred, with the highlighted phrase in the persona's accent colour:

> The AI chief of staff that makes real work **playable.**

(`REAL WORK. PLAYABLE.` is the locked brand tagline; this sentence is its spoken form. The highlight word is always
"playable".)

Single CTA, centred, black:

> **Preview my first game →**

This is JOYSTICK's "Meet your Townie" magic, and it is stronger than a mascot: the thing generated for the visitor is a
**playable preview built from three questions, before an account**. The CTA must deliver that in under a minute or it
is a lie; see §7.

Composer, centred under the CTA, persona-accented ring, label "Ask **Claire** anything" (Claire's name in the accent
colour; her name never changes, which is the point: one chief of staff, many games):

> `Who should I visit before noon?`

Bottom-right: the **persona's game vignette** as a crude line illustration (not a screenshot, not a render) with the
game's name hand-lettered beside it, and the back half of the sentence: **then gets you out the door.**

Small caption under the photo (the human line, §5): `TJ loved shooters. Not door hangers.`

Nothing else above the fold. No kicker, no MISSION CONTROL label, no mockup, no three-line story. Game screenshots and
real gameplay video live below the fold under "The games".

## 4. Rotation rules

- Period 7 s; 400 ms crossfade; all four elements change on the same tick: photo, accent colour, composer task, vignette
  + game name + caption. Pause on hover/focus; respect `prefers-reduced-motion` (show one persona, no rotation).
- The headline halves, the tagline, the CTA, and "Ask Claire anything" **never change**.
- Accent colour = photo backdrop = tagline highlight = composer ring = hand-lettered game name. One colour per persona.
- Order: Adam (suspense), Daisy (cozy), Shawn (creative), TJ (field), Hazel-style (cozy mystery) if a fifth exists.

## 5. Personas (copy locked unless Adam edits)

| Persona | Accent | Composer task (business-concrete, no game words) | Caption (loved X. Not Y.) | Vignette + name |
|---|---|---|---|---|
| Adam | amber | `Who should I visit before noon?` | Adam loved Tomb Raider. Not walking into buildings. | Clockhead, line-drawn · **The Colosseum** |
| Daisy | rose | `Which customers went quiet this month?` | Daisy loved cozy games. Not follow-through. | the Silver Lake fountain · **Silver Lake** |
| Shawn | teal | `Draft this week's Instagram ad` | Shawn loved making videos. Not making ads. | the clay TV camera · **CHANNEL 382** |
| TJ | violet | `Plan 24 doors in the flats` | TJ loved shooters. Not door hangers. | a door hanger on a brass knocker · **Beverly Hills** |

Composer tasks are the sales copy. They must be things a laundry, cleaning, trades, or property operator would type, and
each must be something Claire actually answers today (the first three are live capabilities; the fourth is the
Beverly Hills door-hanger run). No task may mention a game, a villain, a mission, or a kingdom.

Captions are the only place personality lives above the fold. Rule: **"<Name> loved <a real game or pastime>. Not
<the work they avoided>."** Eight words or fewer. Never "cozy style", never a meme, never a threat.

## 6. Art direction (binding)

- **Photos:** real people, shot or sourced as straight portraits on a seamless paper backdrop in the persona colour, soft
  front light, no props, no scene. If a persona is not a real person yet, use a real stand-in with consent, never an AI
  face. Crop square, same scale as Town's.
- **Vignettes:** one illustrator (human, or a single consistent hand-drawn model prompt locked by Adam), sharpie-weight
  black line, one or two flat fills, slightly off-register, hand-lettered name. No gradients, no shading, no photoreal.
  The vignette is the game's icon, not its screenshot.
- **Type:** one heavy serif display (the editorial landing already uses one), one grotesk for UI and the composer.
- **Colour:** paper-white page, black type, one persona accent at a time. No dark hero.
- **Density:** the middle third stays empty. If a stakeholder asks to "add a line explaining the game", the answer is the
  composer task and the caption already do.

## 7. The CTA must be real

"Preview my first game" opens a three-question flow (what do you do, what do you avoid, what did you love playing) and
returns a playable preview on the same page: the persona vignette becomes the visitor's own, with Claire's first line
grounded in their answers. No account until after the preview. If the preview cannot be generated in under a minute,
the CTA reads "See the games" and links below the fold; do not ship a magic button that is not magic.

## 8. Below the fold (unchanged from the editorial landing)

"The games" row with real gameplay media; "How it works" in three steps (Claire reads your books → picks the next move →
the game gets you out the door); pricing; sign in. Keep Claire's secret (earned rapport, her story) out of the funnel.

## 9. Acceptance

- Hero word count ≤ 20 excluding the composer and captions.
- A visitor who sees exactly one persona (reduced motion) still reads a complete sentence and a constant promise.
- No banned word appears anywhere in the hero (grep: save file, monsters, adventure, gamify, mission control, caution,
  biohazard, toxin, hotspot, tactical, weapon).
- Every composer task is answerable by production Claire today, verified by typing it into Claire Desk.
