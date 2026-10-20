# High-Rise: one building, two vibes — Build Brief (Slice 1)

Status: **brief, not started.** Written 2026-10-20 after Adam played Beverly Hills.

## Why

Lantern City's levels are both the product and its marketing. Every new level should look like a different genre
in a 10-second clip (landing page "pick your game" row, posts on X) and end on the same punchline: **the game turns
into a real customer and a real action.** That turn is the differentiator; without it the clips read as a random
indie game.

| Level | Genre | Business job | State |
| --- | --- | --- | --- |
| Silver Lake | cozy village | warm outreach to quiet customers | live |
| Beverly Hills | glam comedy | cold outreach to commercial prospects | live |
| **High-rise** | **cozy *or* zombie (player's choice)** | **tenant service** | this brief |

Town levels cover LA neighbourhoods **except Koreatown and Century Park East**: those are where our towers are
(OPUS LA, 3545 Wilshire / 3650 W 6th; 2160 and 2170 Century Park East), and they get this high-rise game instead.

What made Beverly Hills fun was the three tasks, not the graphics. Keep that: **a short list of concrete errands,
each one funny, each one ending in something real.**

## The game

You're the building manager. The concierge is gone, the residents need things, and you're the one who has to sort
it out. The same building, the same residents and the same real needs come in **two vibes, picked by the player
and remembered**:

| | Cozy high-rise | Zombie invasion |
| --- | --- | --- |
| The concierge | on vacation; left a chaotic sticky-note handover | barricaded in the mailroom; rescued at the end of the floor |
| What's in your way | a runaway robot vacuum, a neighbour who won't stop talking, the elevator stuck playing smooth jazz | slow, dumb, comedic zombies you sneak past, distract (a laundry basket, the dryer's ding) or outrun |
| Feel | warm lamps, rain on the glass, a lullaby | flickering lights, distant sirens, tension music with a wink |
| Getting caught | the neighbour corners you for one more story (you drop the item back where you found it) | a zombie hugs you (same: the item goes back) |
| Ending | the resident's need is solved → the real action | same |

Tone rules: the zombie mode stays funny, never gory. No blood, no deaths shown, no resident is ever a zombie. A
real building's real concierge is never killed: in Adam's buildings they're real people and a referral channel.

## Slice 1 scope — one floor, both vibes, one real need

- **Entry:** the existing tower cutaway (`LanternCityIslands/TowerFloors.tsx` + `towerRooms.ts`: residents are placed
  by real unit, a lit window means a customer lives there, and clicking a window flies in). Add a **Play this floor**
  action on a floor that has a real need. A floor with no real need says so plainly and offers no game.
- **One playable floor interior:** a corridor of unit doors, the elevator lobby, the mail/package room and the laundry
  room. Built once (Blender headless, like `scripts/assets/beverly-hills/`), dressed twice (lighting, props, music,
  obstacles).
- **Vibe toggle** on the level HUD and on the floor's entry card; saved per player and remembered. A cozy player never
  sees a zombie, not even in a loading screen.
- **Three errands on the floor**, each from a real resident record (below). Same pattern as Beverly Hills: a checklist,
  a gatekeeper line, a payoff.

## Where the real needs come from (read-only in Slice 1)

In priority order, for residents whose address and unit place them on that floor (`towerStack.ts`):

1. **Open resident service requests:** `resident_coordinated_requests` rows for the building and unit with an open
   status (`pending_operator_review`, `pending_provider_confirmation`). The category picks the errand's object:

   | `serviceCategory` | Errand object | Cozy beat | Zombie beat |
   | --- | --- | --- | --- |
   | `dog_grooming` | the dog's leash (and the dog) | the dog is sunbathing on the amenity deck | the dog is hiding in the dog spa, very proud of itself |
   | `airport_transport` | the suitcase | the suitcase rode the elevator alone, twice | the suitcase is jammed in the lobby barricade |
   | `dry_cleaning` | the garment bag | it's in the laundry room, wrapped around the robot vacuum | a zombie is wearing it |
   | `apartment_cleaning` | the robot vacuum | the obstacle *is* the errand: catch it | the vacuum is the only thing the zombies fear |
   | `car_detail` | the car keys | in the mailroom's lost-and-found | in the concierge's barricade |
   | `other` | a generic parcel | n/a | n/a |

   **The real action** opens that request in the existing operator review surface. Slice 1 writes **no** status. The
   truth rule from `CLAUDE.md` §1 stands: a coordinated request is never shown or set as `confirmed` until a provider
   has actually confirmed it.
2. **Quiet residents:** tower residents who used to order and have gone quiet (the Silver Lake rule: 60+ days,
   reachable, consent intact, `evaluatePersonalOutreach`). The real action is the Silver Lake Letter Desk (draft →
   schedule or send from Adam's own phone), reused as-is.
3. Nothing else. No invented residents, needs or numbers. If a floor has fewer than three real needs, it gets fewer
   errands rather than filler.

**The fiction never enters the real thing:** no leash, zombie or vacuum ever appears in a message, a request, a note or
a status.

## Hard constraints

- **Resident app:** the resident app (`Cursor_residentapp`, live at `app.bldg.chat`) calls this repo in production. Slice
  1 does not touch the eight S2S agent tools, their input or response shapes, `permissions.ts`, `s2sEndpoint.ts`, or
  `resident_coordinated_requests` writes. Reads only.
- **Tenant boundary:** reads use the active tenant (`ctx.tenantId`), like Silver Lake and Beverly Hills.
- **No sending from the game:** Letter Desk rules apply unchanged; nothing is sent or scheduled by a test.

## Build notes

- **Runtime:** follow `client/src/pages/goldline/beverlyHills3d/beverlyHillsRuntime.ts`:
  - PBR with an HDR environment;
  - collision boxes, circles and rings;
  - the shared character skeleton and animation library;
  - the software-WebGL tier, which caps the frame at about 0.4 megapixels (needed for CI);
  - the test hook `window.__highRise`.
- **Characters:** reuse the Beverly Hills pipeline (`build_cast.py`) for the manager, the residents and the concierge.
  Zombies need a CC0 source. Quaternius likely has one, but check the licence before downloading. Shuffle and stagger
  animations are in the Universal Animation Library.
- **Server:** one read-only query, e.g. `goldlineWorld.highRiseFloorNeeds({ buildingId, floor })`. It returns the
  errands with their real source record IDs and a `readable` flag. As in Beverly Hills, an unreadable book is not the
  same as an empty one.
- **Vibe setting:** saved per operator. A client setting is acceptable for Slice 1, provided the zombie vibe is never
  the default.
- **Music:** two generative Web Audio scores, like `cozyMusic.ts` and `loungeMusic.ts`.

## Acceptance (Slice 1)

1. From Lantern City, open OPUS LA, click a lit window on a floor with a real need, choose **Play this floor**, and the
   floor loads.
2. The vibe toggle switches cozy ↔ zombie without reloading the floor's data. The choice survives a reload. The
   default is cozy.
3. Every errand comes from a real record. The e2e asserts each errand's source ID exists in the proof world, and that
   a floor with no needs shows no game.
4. Completing an errand opens the real action (the request in operator review, or the Letter Desk). The e2e asserts
   **zero tRPC writes** for the whole floor.
5. Frame rate: about 60 fps at phone size and at least 30 on desktop (M1, Metal). Software WebGL stays responsive.
6. Two capture-ready clips, each 10 to 15 seconds and filmed on the Metal GPU: one cozy, one zombie. Each ends on the
   real-action screen with names blurred, ready for the landing page and X.

## Open questions for Adam

- **First building: OPUS LA or Century Park East?** I'd suggest whichever has more open requests and quiet residents.
  Count them in prod before building.
- **Should a quiet resident count as an errand** on a floor with no open request (warm outreach inside the tower), or
  should the tower be service-only?
- **What sits behind the window in the cozy vibe when the floor is empty:** an honest "everyone's sorted" scene, or no
  entry at all?

## Separate track (not this slice)

Beverly Hills should get a **rope per prospect**: each prospect brings its own gatekeeper and three errands, so the
town replays instead of repeating the same juice, pug and shades. Do this before cloning the town kit to more
neighbourhoods.
