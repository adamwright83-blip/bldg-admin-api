# Beverly Hills 2D: The Lost Creek. Build brief

Written 2026-10-25 after ChatGPT Astra's review of The Other Rodeo and a line-by-line check of the code. This brief
constrains the rebuild of the Beverly Hills 2D story. It replaces the fixed courtyard, pasture, distortion, home
sequence in `client/src/pages/goldline/beverlyHills2d/adventure.ts` with one persistent two-era place. It does not
touch the Round-Up (`herd.ts`, `herdPaint.ts`, `HerdRound.tsx`), the art, the journal, or the business rules.

## 1. What is true today

VERIFIED in source on `main` at `181531b7` (2026-10-25):

| Claim | Where |
|---|---|
| The story is a fixed sequence of five flags (`stairs`, `gate`, `water`, `tether`, `rescued`); every chapter gate is a flag check. | `adventure.ts` `flags`, `movePlayer` blocks at x 1470 / 1395 / 900 / 1250 |
| "Time travel" is a chapter switch plus a paper tear. Nothing persists across eras; `placeForChapter` resets `water` on entry to `distortion`. | `goTo`, `placeForChapter` |
| Throws land a fixed 420 px ahead. Every other verb is a proximity prompt within 90–170 px. | `throwToy`, `prompt` |
| The creek only slows her (130 vs 250 px/s) and the sluice flips one boolean. | `movePlayer`, `interact` case `sluice` |
| Meeting the calf fires three portraits at once; the rescue fires three more and a 6 s countdown to the ending. | `interact` cases `meet`, `rescue` |
| The coyote walks to a fixed spot at 55 px/s. It never attacks; nothing is lost. | `moveCoyote` |
| The ending is a painting you cannot walk in: `tick` returns before movement when `chapter === "home"`. | `tick`, `paint` home branch |
| One sound cue for every action. | `sound.ts` `cue()`, `BeverlyHills2D.tsx` `act()` |
| The Round-Up is the title's primary button. | `BeverlyHills2D.tsx` `start-round-up` |
| `plotsFromOrders` counted one plot per report, matched on pickup date, so one order satisfied several reports at the same address. **Fixed in this PR**: one plot per address, matched on the order's creation date in Los Angeles time. | `shared/beverlyHillsOutreach.ts` |

Unused drawings already on the approved sheets (pixel boxes on the 1536×1024 alpha PNGs, measured from connected
alpha; verify by eye before use, the way `cells.ts` was built):

| Sheet | Drawing | Rect |
|---|---|---|
| `07-courtyard-near-alpha` | garden hose, coiled with brass nozzle | `[1233, 477, 285, 210]` |
| `07-courtyard-near-alpha` | blue sedan | `[824, 134, 695, 214]` |
| `10-ranch-near-alpha` | wooden water trough, full | `[918, 52, 588, 246]` |
| `10-ranch-near-alpha` | hay bale | `[18, 354, 464, 236]` |
| `10-ranch-near-alpha` | fallen oak limb with leaves | `[25, 624, 509, 303]` |
| `10-ranch-near-alpha` | milk can | `[1288, 615, 191, 190]` |

The 09 ranch painting has a creek running from the back middle to the front right. The 06 courtyard painting has no
pool, so the modern water is the **fountain** (already a prop). The 13 overlap painting shows cows drinking at a pool,
an elevator opening onto bean rows, and the three animals asleep under the oak: that is the ending, and it becomes a
place you walk in.

INFERRED: Round-Up is fun because positioning changes animal behaviour (Adam has not played it yet). UNKNOWN: no
stranger has played either mode.

## 2. Decisions

1. **Rejected**: Claude's six-screen plan (six habits, nothing repeats, twelve new paintings). Astra's structure is
   adopted: repeat the rules, change the situation.
2. **Rejected**: opening screens only after real building visits. The story completes with no business gate.
   Verified outreach keeps doing what it does: restored plots bloom beans in the meadow and add cows to the Round-Up.
3. **One place, two eras, always both present.** The world is 3800 wide: the courtyard painting at x 0–1900 (2026),
   a static torn-paper seam at x 1900, the ranch painting at x 1900–3800 (1890s). She walks through the seam freely.
   The camera is continuous. The chapter card reads "Two times, one courtyard" the first time she crosses.
4. **One rule the player discovers**: water that leaves 2026 arrives in the 1890s, and it comes back if you let it.
   Taught by observation (the ball, the fountain, the culvert), never by text.
5. **The boxer's habits stay the puzzle grammar**, now situational: he takes what she carries; he chases what is
   thrown and *settles where he catches it*; he will not put a paw in deep water. The fourth habit (naps across the
   way until something is more interesting) becomes "he naps wherever he last settled", which is what lets the
   player position him.
6. **The terrier is useful on her own**: she wades, hops, throws with aim, and earns the calf's trust by behaviour
   (Solution B). She is never only a delivery service.
7. **Two supported solutions**, both complete, both discoverable, and a failed attempt is always recoverable (shut the
   hose and the water goes home).
8. **The ending is a place**: the three walk into the overlap painting, drink with the cows, ride the elevator light,
   and lie down. Then the Round-Up is offered.
9. **No new art.** Every prop above is already painted. No generated images.
10. What this level could be mistaken for, and why it cannot: Silver Lake is a cel-shaded 3D village with a reunion
    quest; Century Park East is a brochure print and a CCTV wall. Beverly Hills 2D is the only painted diorama, the
    only level where you never command the character who solves the puzzle, and the only one with a time seam.
    Prior art named: The Last Guardian (instinct over obedience), Day of the Tentacle (change one era, affect the
    other), Animal Well (one tool, many uses), Untitled Goose Game (legible routines, player-made comedy).

## 3. The place

World x, depth d ∈ [0, 1] (0 back, 1 front), as today. Ranch-local `rx = x - 1900`.

Ground bands: courtyard `[608, 776]`, ranch `[556, 772]`; lerp the band across x 1840–1960 so the seam has no step.
Far layers: draw 05 behind x < 1900 and 08 behind x ≥ 1900 with the same 0.12 parallax, clipped at the seam.
The seam itself is the existing `tear()` edge drawn static at world x 1900 (fibres animate slowly, `t` instead of
`tear.t`), in front of the far layers and behind the animals.

**2026, courtyard (x 0–1900)**

| Thing | x, d | Role |
|---|---|---|
| ball | 470, 0.62 | the toy, as today |
| fountain | 850, 0.30 | the modern water. Level `F` ∈ [0,1], starts 1. Its basin shows a faint rippling calf head (`CALF.heads.curious`, alpha 0.25) when `F > 0.3` |
| hose valve | 960, 0.46 | prop `hose` at the fountain's foot. Prompt "Open the hose" / "Shut the hose" |
| storm drain | 1500, 0.50 | a dark puddle painted in code (ellipse, feathered). A ball landing within 60 px of it vanishes and pops out of the culvert 0.6 s later, `wet` |
| hedge, pots, stairs | as today | dressing; the stairs no longer gate anything |
| boxer | sleeps at 1600, 0.58 | wakes to a thrown ball, as today |

**1890s, ranch (x 1900–3800)**

| Thing | rx, d | Role |
|---|---|---|
| culvert | 130, 0.20 | prop `tunnel`. The lost creek comes out of it when `F` is falling; the ball pops out here |
| ford (painted creek bed) | band `rx ∈ (1090 + 600d, 1270 + 600d)` | the herd's `CREEK` diagonal; the only crossing |
| old channel | band `rx ∈ (1560, 1700)`, only for `d < 0.45` | dry until the sluice opens; a feathered flood strip like `floodLayer` |
| the hole | 1620, 0.18 | prop `hole` (11-distortion), ~520 px wide; the strip of pasture that fell into the garage |
| ledge | 1620, 0.18, 92 px up | the calf stands here from the start, facing whichever dog is nearer |
| trough | 1620, 0.18, floor of the hole | prop `trough`; floats up with the hole's water; level with the ledge at `hw ≥ 0.85` |
| landing | 1800, 0.30 | dry meadow right of the hole; where the calf must arrive |
| sluice | 1790, 0.42 | prop `sluice`. Prompt "Open the sluice" / "Close the sluice" |
| lying cow | 1240, 0.04 | as today |
| beans | 300 + 80i, 0.08 | restored plots (moved out of the hole's way) |
| hay bale, milk can | 480, 0.62 and 1420, 0.70 | dressing she can hop onto (hay) and knock (can, one thunk, rolls 30 px) |

## 4. Rules, with numbers

**Water** (all levels 0–1, per second rates):

- Hose open: `F -= 0.12·dt` (full to empty in ~8 s). Hose shut: `F += 0.08·dt` (the fountain's own pump).
- Creek `C` follows `1 - F` at 2.0/s (a half-second lag that reads as flow).
- Sluice closed: `ford = C`, `channel → 0` at 0.3/s. Sluice open: `ford = 0.35·C`, `channel = C`.
- Hole water `hw` follows `channel` at 0.25/s. Trough lift `= 92·hw` px. Steppable when `hw ≥ 0.85`.
- Deep means `> 0.35`. The boxer refuses to enter deep water (ford or channel), stops at the bank, `confused`
  portrait once per refusal. The terrier always wades at 130 px/s and gets `wet`.
- Glints flow the way the water moves: fountain to drain while `F` falls, culvert to ford, sluice to channel to hole.
  Reverse the drift when `F` rises.

**Throw**: hold F to charge `power` 0→1 over 0.9 s (a small arc meter above her head); release throws
`160 + 520·power` px with a 0.7 s parabolic flight (lift drawn, shadow stays on the ground), then a 40 px roll. A tap
(power < 0.15) is a short toss. Thrown into deep water the ball drifts to the nearest bank over 3 s (she can wade for
it). Thrown into the drain it comes out of the culvert. The boxer chases any thrown ball he can reach without deep
water; if he cannot, he goes to the bank and refuses.

**The boxer's settle**: when he catches or takes the ball he trots 120–260 px on, lies down, chews 2.2 s, drops it,
and naps where he is (`rest` becomes the place, not a fixed `restX`). He wakes for a thrown ball, for her running from
the coyote-free world's nothing (no coyote in this chapter), or when she comes within 60 px and hops twice. This is
how the player positions him at the landing: throw to the landing while the water is low, or carry the ball there
and let him take it.

**The calf on the ledge** (`trust` 0–3, never shown as a meter; portraits only):

- Terrier arrives at > 200 px/s within 220 px: `scared` portrait, calf backs 40 px along the ledge, trust −1 (min 0).
- Hop within 220 px: `startled`.
- Stand still within 160 px for 2.5 s without hopping: `curious`, then trust +1 (max 3) with a soft chime.
- Carrying the ball still within 160 px: `delighted`, trust +1 (once).
- Boxer within 260 px of the landing: calf faces him and moos (reuse the Round-Up's moo), as before: it chose him.
- The calf comes down when the trough is steppable AND (boxer within 260 px of the landing OR trust = 3 with the
  terrier within 200 px of the landing). It steps ledge → trough (0.8 s) → rim → landing, `trusting` portrait,
  distinct rescue chord. `flags.rescued = true`.

**Recoverable failure**: drain with the boxer on the wrong bank → he refuses at the ford; shut the hose → water goes
home, ford clears, trough sinks; walk him over; try again. Nothing resets, nothing is lost.

**After the rescue** (beats 6 and 7):

- The courtyard has changed: the oak limb (prop `branch`) lies across the doorway at (930, 0.35, 320 wide), bean
  rows and grass tufts spill from the seam onto the plaza, the fountain stays creek-blue with the calf's reflection
  permanent. Chapter card: "Beverly Hills · something followed you back".
- The calf follows the terrier now (+70 px), not the boxer.
- `boxer.yields = true`: the next time she carries the ball within 95 px of him he does not take it. First time this
  happens: `tender` (boxer), `delighted` (terrier), and he lies down without it. That is the friendship, shown.
- Walking the three through the seam toward the courtyard with `rescued` set → the existing paper-tear transition
  into `home`.

**Home, explorable**: ground `[700, 760]`, x 0–1900 on the 13 painting (drawn at world scale, scrolling). Calf at
+70, boxer at −110 follow. Prompts: at the pool (x ≈ 330) "Drink with the cows" (she laps 2 s, the painted cows get a
moo); at the elevator (x ≈ 1560) "Ride down to the beans" (the door light flickers, a card "the beans are coming up");
at the oak (x ≈ 640) "Lie down with them": the three settle into the painted lie poses, petals, then the end card with
"Round up the herd →" and "Open Claire's field notes ↗". `tick` moves her in `home`; nothing else changes.

## 5. Sound

Replace the single `cue()` with named cues on `createSound`, synthesised the way `herdSounds.ts` does (tone and
noise helpers; factor them into `synth.ts` and have both use it): `splash`, `pop` (culvert), `hose` (1.2 s gurgle),
`fill` (rising tone while `F` climbs), `creak` (sluice), `knock` (trough reaching the ledge, wood), `moo` (reuse),
`huff` (boxer refusal), `sigh` (settle), `chime` (trust), `chord` (rescue), `rustle` (seam crossing), `lap` (drinking).
Every verb in the table above has its own sound. The score stays.

## 6. UI and persistence

- Title: primary button is the story ("Follow your nose" / "Continue the afternoon"); "Round up the herd" is
  secondary but keeps `data-testid="start-round-up"`.
- HUD: keep the action dock, the throw button becomes press-and-hold (pointer down charges, up throws).
- Save key `joystick.other-rodeo.fiction.v3`; `restoreAdventure` restores `chapter`, `F`, hose, sluice, `trust`,
  `rescued`, `yielded`, player x/d, boxer x/d/state; anything else (including v2) starts fresh.
- Root `data-*` for tests: `chapter` (`creek` | `home`), `side` (`now` | `then`), `fountain` (0–100), `ford`,
  `channel`, `trough` (0–100), `hose`, `sluice`, `trust`, `rescued`, `yielded`, `item`, `boxer`, `player-x`,
  `boxer-x`, `calf-ledge`.
- Reduced motion: no arc meter animation, no glint drift, water levels still change.

## 7. Tests that define done

Unit (`adventure.test.ts`, pure sim, `tick` at 60 Hz):

1. Hose open lowers `F`, creek rises after it; shut reverses both; sluice open routes it to the channel and the hole.
2. A ball into the drain comes out of the culvert, wet, 0.6 s later.
3. The boxer refuses a deep ford and a flowing channel; crosses when shallow; settles and naps where he catches a ball.
4. **Solution A**: park him at the landing, open the sluice, open the hose → trough steppable → calf down → rescued.
5. **Solution B**: trust reaches 3 by stillness and the ball, no boxer across → rescued.
6. **Recoverable**: drain with him on the wrong bank → refused; shut hose → ford clears → he follows across.
7. After the rescue he yields the ball once with the right portraits; the calf follows her.
8. Home: she walks; "Lie down with them" ends it; `tick` is a no-op after.
9. v3 round-trips through `restoreAdventure`; a v2 save starts fresh.
10. Charged throw range scales with hold time; a throw never lands outside the world.

E2E (`e2e/beverly-hills-2d/`, real keys only, no state injection):

- `playthrough.ts` keeps its export name `playOtherRodeo` (the goldline smoke spec imports it) and plays Solution A:
  ball, throw to the landing with a held F, through the seam, sluice, back through, hose, wait for `data-rescued`,
  walk to the seam, home, lie down, journal button visible.
- `adventure.spec.ts` journal test seeds a **v3** home save.
- `round-up.spec.ts` unchanged.
- Both specs still assert zero `POST /api/trpc/` and zero page errors on desktop and Pixel 7.

CI: `.github/workflows/beverly-hills-2d.yml` as is. Also run `pnpm check`, `pnpm check:nomenclature`, and the
touched vitest files before opening the PR.

## 8. Playtest bar (after merge, five strangers, no coaching)

At least four say what they are trying to save. At least four find the water link unprompted. Everyone tries more
than one plausible thing. A failed try teaches something rather than looking broken. At least three replay or explore
after the rescue. Each can name a funny thing they caused and a moment their feeling toward an animal changed.

## 9. File map

| File | Change |
|---|---|
| `adventure.ts` | the new sim (`Adventure` v3: `F`, `hose`, `sluice`, `channel`, `hw`, `trust`, `yields`, throw charge, settle place); keep the exports the renderer uses |
| `paint.ts` | one world, two paintings, seam, water glints, channel and hole water, trough, arc meter, after-rescue dressing, explorable home |
| `cells.ts` | add `hose`, `trough`, `hay`, `branch`, `can` to `PROPS` with the rects above |
| `sound.ts`, new `synth.ts` | named cues; `herdSounds.ts` imports the shared helpers |
| `BeverlyHills2D.tsx` | v3 save key, `data-*`, hold-to-throw, title button order, home prompts |
| `adventure.test.ts`, `e2e/beverly-hills-2d/*` | per §7 |
| `other-rodeo.module.css` | only if a new element needs it (arc meter is canvas) |

Not in scope: new art, the Round-Up, the journal, the coyote (returns in a later chapter), any business write.
