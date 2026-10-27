# Lantern City — Century Park East (the building as a game)

The tower's shared floors opened like a dollhouse: three storeys cut open at the front, dusk through the back windows,
the city behind. Entry: the tower view's **Play the building**, or `/growth/lantern-city?level=century-park-east`.
The building has two nights, the player's choice, remembered:

- **Cozy night is printed.** The 1965 brochure: the frame is separated into four ink plates (mustard, terracotta,
  teal, umber), screened into halftone dots at their own angles, laid over cream paper with a little misregistration,
  grain and an ink line (`cpePrint.ts`). Eight building characters each need something found; bringing it back opens
  the Letter Desk for a real resident quiet 45+ days (the Silver Lake rails, scoped to 2160/2170 Century Park East).
- **Zombie night is watched from the concierge's monitors.** One security camera per room, a CRT tube, three live
  feeds along the bottom, a cut on every room change (`cpeCctv.ts`). The zombies are the dormant residents. Taze one
  (F) and it is down for thirty seconds; in that window **program the chipping shotgun** (E), which is the real
  outreach in four decisions, none of them "approve a draft": what you remember about them (a fact from the
  record), why they went quiet (a diagnosis, recorded as a prediction and scored when the record moves), what goes in
  the shell (an offer with a cost, three shells a night), and when it lands (a sight over the hour they used to
  order). Fire schedules the text for that hour through the same rails as Silver Lake; the chip takes and the zombie
  shuffles off to the laundry room to wreck a washer. Four washers down and every resident in the building needs the
  business (`shotgunMachine.ts`, `ShotgunDesk.tsx`, `cpeTrade.ts`). "Not now" wakes it; the fuse running out is a bite.
  The real name only ever appears on the gun, never on a zombie or in the HUD; nothing from the game may enter the
  text (`textIsClean`).

**The rope** is modelled on Jusant: each hand is a key (A and D, or two touch buttons), alternating pulls climb, the
same hand twice is a half pull, a press too early in a pull is queued once so mashing is not climbing, gripping costs
stamina and hanging still rests it back, a zombie at the ankle drops her to the last knot. The hand-over-hand clip is
scrubbed by metres climbed, the body swings with each pull, the camera comes in and up, and the top is a mantle onto
the floor with a landing squash and a thud (`climbMachine.ts`, `cpeSounds.ts`).

**Trade packs.** The room the zombies wreck, its devices, verbs and lines come from `cpeTrade.ts`; `ACTIVE_TRADE` is
the one line that re-skins the building for a plumber (toilets) or an electrician (outlets).

## Code map

| File | Role |
| --- | --- |
| `CenturyParkEast3D.tsx` | HUD, dialogue, the errand chain, the Letter Desk mount; knows the customers |
| `cpeRuntime.ts` | the game: input, collisions, zombies, dogs, ropes, items, camera, post, test hook `window.__centuryParkEast` |
| `cpeLayout.ts` | the building's measurements, room plan, ropes and every static collider, shared by the runtime, the set and the unit test |
| `cpeSet.ts` | what the building looks like: the cut shell, every room's furniture, the street, the parallax city |
| `cpeTextures.ts` | every surface, painted on canvas when the level opens (wallpaper, floors, mailboxes, skyline…) |
| `cpePrint.ts` | cozy night's brochure: four ink plates, halftone screens, paper |
| `cpeCctv.ts` | zombie night's monitor wall: a camera per room, the CRT tube, three live feeds |
| `climbMachine.ts` / `cpeSounds.ts` | the rope (pure, tested) and the body's sounds |
| `shotgunMachine.ts` / `ShotgunDesk.tsx` | the chipping shotgun: four decisions, the text, the fuse, shells, the chip ledger |
| `cpeTrade.ts` | the trade pack: what gets wrecked, and the one line to re-skin for another trade |
| `zombieLoungeMusic.ts` | the zombie-night score (the cozy one is Silver Lake's) |
| `e2e/goldline-smoke/centuryParkEast.spec.ts` | CI: errand → Letter Desk, closet trap, dog tower, paper bite, ropes, nothing written |

Colliders are pure data in `cpeLayout.ts`; the runtime blocks movement with them, the set draws furniture on exactly
those footprints, and `cpeLayout.test.ts` flood-fills them to prove every rope lands somewhere she can walk away from
(the roof pool once swallowed the laundry rope's landing). No external model or texture files: the cast comes from Beverly Hills
(`/assets/goldline/beverly-hills-3d/cast/`), everything else is procedural.

## Rendering

Physically based materials with painted detail maps, a soft studio environment, a key light with real shadows that
follows the player's floor (so one shadow map covers one storey and stays sharp), room point lights, bloom on the
lamps and the sign, a warm or cool grade with a vignette. Corner and under-furniture occlusion is painted into the set
(`ao|edge`, `ao|blob`) instead of a screen-space pass: GTAO cost more than the rest of the frame on an M1.

Static geometry is merged into one mesh per material (`Kit` in `cpeSet.ts`), about 40 draw calls for the whole
building. Skinned people are only drawn and animated when the camera can see them, and only the ones on the player's
floor cast shadows; the party shows everyone.

Three tiers, picked from the device (override with `?cpeTier=phone|flat` for measurement):

| Tier | When | Shadows | Shadow map | Bloom |
| --- | --- | --- | --- | --- |
| desktop | real GPU, mouse | yes | 2048 | yes |
| phone | real GPU, touch | yes | 1024 | yes |
| flat | software WebGL (CI) | no | — | no |

Measured headless on an M1 (Metal) with `scripts/goldline-capture/cpe-perf.mjs`, which runs about half the speed of a
real browser window: desktop 32–38 fps, phone 46–53 fps; Beverly Hills measures 12–17 on the same harness.

Capture every room: `node scripts/goldline-capture/cpe-shot.mjs <outDir>` (desktop) or `cpe-phone.mjs <outDir>` against
the `goldline-verify-visual` server on port 5178. Pictures from the quality pass sit in
`artifacts/century-park-east/quality-pass/`.
