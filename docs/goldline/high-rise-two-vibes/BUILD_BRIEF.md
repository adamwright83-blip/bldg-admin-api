# High-Rise: one building, two vibes — Build Brief (Slice 1)

Status: **brief, not started.** Written 2026-10-20 after Adam played Beverly Hills; decisions from Adam folded in the
same day.

## Decisions (Adam, 2026-10-20)

- **Building: Century Park East** (2160 and 2170 Century Park East).
- **The job: get Adam to text Century Park East residents who used to order and haven't in more than 45 days.**
  Real action: the Silver Lake Letter Desk (a personal text from Adam's own phone, drafted, scheduled or sent by him).
- **20 residents in the level: 8 need something, 12 are quiet, non-needy residents.**
- **The finale must be worth reposting on X.** No boring empty state.

## Why

Lantern City's levels are both the product and its marketing. Every new level should look like a different genre
in a 10-second clip (landing page "pick your game" row, posts on X) and end on the same punchline: **the game turns
into a real customer and a real action.** That turn is the differentiator; without it the clips read as a random
indie game.

| Level | Genre | Business job | State |
| --- | --- | --- | --- |
| Silver Lake | cozy village | warm outreach to quiet customers | live |
| Beverly Hills | glam comedy | cold outreach to commercial prospects | live |
| **Century Park East** | **cozy *or* zombie (player's choice)** | **text residents quiet 45+ days** | this brief |

Town levels cover LA neighbourhoods **except Koreatown and Century Park East**; those are our towers (OPUS LA,
Century Park East) and get this high-rise game instead. OPUS LA follows once Century Park East ships.

What made Beverly Hills fun was the three tasks, not the graphics. Keep that: **concrete errands, each one funny,
each one ending in something real.**

## The game

You're the building manager. The concierge is gone and the residents need things. Same building, same residents,
same real outcomes, in **two vibes, picked by the player and remembered (cozy by default)**:

| | Cozy high-rise | Zombie invasion |
| --- | --- | --- |
| The concierge | on vacation; left a chaotic sticky-note handover | barricaded in the mailroom; rescued in the finale |
| What's in your way | a runaway robot vacuum, a neighbour who won't stop talking, the elevator stuck playing smooth jazz | slow, dumb, comedic zombies you sneak past, distract (a laundry basket, the dryer's ding) or outrun |
| Feel | warm lamps, rain on the glass, a lullaby | flickering lights, distant sirens, tension music with a wink |
| Getting caught | the neighbour corners you for one more story (the item goes back where you found it) | a zombie hugs you (same) |

Tone rules: zombie mode is funny, never gory. No blood, no deaths shown, no resident is ever a zombie, and the real
building's concierge is never killed (they're a real person and a referral channel).

### Where it takes place

Century Park East has 12 units a floor, so 20 residents don't fit one corridor. The level is the building's **shared
spaces**: the lobby, the mail and package room, the laundry room, the gym, and the pool deck. That's where 20
residents plausibly gather in either vibe: hanging out (cozy) or sheltering (zombie). It's also the most cinematic
set for clips. It's built once (Blender headless, like `scripts/assets/beverly-hills/`) and dressed twice (lighting,
props, music, obstacles).

Entry: the existing tower cutaway (`LanternCityIslands/TowerFloors.tsx` + `towerRooms.ts`) gets a **Play the building**
action, and the Lantern City board's Century Park East tower opens it.

## The 20 residents

### The 8 who need something: real customers

- **Who:** real Century Park East customers on the active tenant's book. The match is by street address
  (`TOWER_BUILDINGS` in `towerStack.ts`, 2160/2170 Century Park East).
- **Rules:** their last order is **more than 45 days ago**; they're reachable; consent is intact; and
  `evaluatePersonalOutreach` allows a personal text.
  - The book's canonical dormant line is 30 days (`DORMANT_INACTIVITY_DAYS` in
    `server/strategy/snapshotDormantCustomers.ts`). The tower filters more strictly on top of it. **Don't change the
    canonical constant, and don't change Silver Lake's rule.**
- **Order:** sorted by the existing dormant ordering, so the most valuable come first. The 8 are capped. If fewer than
  8 qualify, **fewer residents need something**. Never pad with invented customers.
- **The loop for each one** (the Silver Lake reunion pattern, already proven):
  1. The resident's need is a found-object errand. The 8 errand templates are below.
  2. Bringing the object back triggers the payoff beat.
  3. That opens the Letter Desk with the pre-written personal text to that real customer.
  - The real numbers in the scene (days since last order, order count) come from the record.
  - **The fiction never enters the text.**
- **One at a time:** only the first undecided resident's errand is open. The next one opens on a **real decision**
  (scheduled, sent, or passed), never on finishing the puzzle. This is the same chain as `reunionQuests.ts`.
- **Name and face:**
  - On screen, a needy resident is introduced as a building character who *knows* the real customer. The real
    customer appears in the payoff ("…and there's {customerFirst} at the elevator"). It's the Silver Lake framing,
    so no real person is ever drawn as a cartoon or put in a zombie scene.
  - The Letter Desk shows the real name and number, as Silver Lake does.

| # | Errand object | Cozy beat | Zombie beat |
| --- | --- | --- | --- |
| 1 | a runaway robot vacuum | it's been "cleaning" the gym for six hours | the only thing the zombies are afraid of |
| 2 | a garment bag | wrapped around the laundry room's dryer drum | a zombie is wearing it, and looks great |
| 3 | a dog's leash (and the dog) | the dog is sunbathing on the pool deck | the dog is hiding in the dog spa, very proud of itself |
| 4 | a suitcase | it rode the elevator alone, twice | wedged in the lobby barricade |
| 5 | a package with the wrong unit number | buried in the package room avalanche | being used as a zombie step-stool |
| 6 | a yoga mat | rolled up inside the pool float | a zombie is attempting a downward dog |
| 7 | a cake for a birthday | on the concierge desk with a "DO NOT EAT" note | the zombies are guarding it like it's a brain |
| 8 | the building's spare key | inside the lost-and-found fishbowl | taped under the barricaded mailroom door |

### The 12 quiet residents: flavour only

They're building characters with lines and personalities and no errand: the gym bro, the retiree doing laps, the
person always on a work call, the tenant who reads in the lobby.

- They are **not drawn from the customer book**. They have no real names, no unit numbers, and no implication that
  they're customers.
- They exist to make the building feel lived in, and to give the zombie mode bystanders to hide behind.
- They also make the clips readable: 20 people in a lobby looks like a building; 8 looks like a waiting room.

Rule: no quiet resident ever opens the Letter Desk, and none is ever shown with a real name or number.

## The finale (the repostable clip)

When the last needy resident is decided, **the building throws a party**:
- The camera pulls out of the lobby to the full tower at dusk. Every lit window from the real cutaway lights up in
  sequence, floor by floor, to a beat.
- The rooftop turns into a party, with confetti off the pool deck.

**Cozy:** the concierge comes back from vacation mid-party, sees the sticky notes have all been ticked off, and cries
a little.

**Zombie:** the rescued concierge walks out of the mailroom. The zombies freeze, then join a line dance on the roof
(original choreography and original music; no real songs). The last shot is a zombie holding up a phone with a text
on screen that says "sent ✓". No real content is shown: placeholder text only.

The same finale plays when the level is opened with **zero** needy residents ("everyone's sorted"), so the empty
state is the best clip, not the most boring one. The HUD says plainly that nobody needs a text today.

Capture: a 12-second finale clip in each vibe, filmed on the Metal GPU, made to be posted on its own on X.

## Hard constraints

- **Resident app:** the resident app (`Cursor_residentapp`, `app.bldg.chat`) calls this repo in production. Slice 1
  doesn't touch any of these:
  - the eight S2S agent tools, or their input and response shapes;
  - `permissions.ts` or `s2sEndpoint.ts`;
  - `resident_coordinated_requests`.

  Coordinated service requests (dog grooming, airport rides, and so on) are a later slice. When that slice comes, a
  request is never shown or set as `confirmed` before a provider confirms it.
- **Tenant boundary:** reads use the active tenant (`ctx.tenantId`).
- **No sending from the game:** Letter Desk rules apply unchanged. Nothing is sent or scheduled by tests. Personal
  texts go from Adam's phone, with no opt-out-line requirement (#669). A recorded opt-out still blocks.

## Build notes

- **Runtime:** follow `client/src/pages/goldline/beverlyHills3d/beverlyHillsRuntime.ts`:
  - PBR with an HDR environment;
  - collision boxes, circles and rings;
  - the shared character skeleton and animation clips;
  - the software-WebGL tier, which caps the frame at about 0.4 megapixels (needed for CI);
  - the test hook `window.__highRise`.
- **Characters:** reuse the cast pipeline (`build_cast.py`) for the manager (selectable look), 20 residents (varied
  outfits from one base) and the concierge. Zombies need a CC0 source; check the licence before downloading.
  Shuffle and stagger moves come from the Universal Animation Library.
- **Errands and the chain:** generalise `reunionQuests.ts` rather than fork it. Templates per level, the same
  eligibility and decision chain, a different dormancy threshold per level (45 days here).
- **Server:** one read-only query, e.g. `goldlineWorld.centuryParkEastResidents()`. It returns up to 8 eligible
  customers with the fields the Letter Desk needs, plus a `readable` flag (an unreadable book is not an empty one).
  Reuse the cozy villager mission and outreach service for drafting, scheduling and sending, with the operator ID
  passed as in #666.
- **Vibe setting:** saved per operator. A client setting is acceptable for Slice 1. Cozy is the default.
- **Music:** two generative Web Audio scores (`cozyMusic.ts` / `loungeMusic.ts` pattern) plus one finale track per
  vibe.

## Acceptance (Slice 1)

1. **Getting in:** Lantern City → Century Park East (the tower, or **Play the building** in the cutaway) loads the
   level in the remembered vibe (cozy the first time).
2. **The toggle:** it switches cozy ↔ zombie without reloading the data and survives a reload.
3. **The needy residents:**
   - The e2e asserts that each one maps to a real customer at 2160 or 2170 Century Park East whose last order is
     more than 45 days ago, that there are never more than 8, and that a book with fewer gives fewer.
   - Exactly 20 residents are on screen when 8 qualify. Quiet residents are fixed fictional characters with no real
     data.
4. **One errand at a time:** a full errand opens the Letter Desk for that real customer with the real draft, and the
   next errand stays locked until a real decision. The e2e asserts **zero tRPC writes** apart from what the operator
   deliberately does at the Letter Desk (the tests don't do that).
5. **The finale** plays after the last decision, and also on an empty book.
6. **Frame rate:** about 60 fps at phone size and at least 30 on desktop (M1, Metal). Software WebGL stays responsive.
7. **Clips:** four, each made on the Metal GPU: errand to Letter Desk (cozy), errand to Letter Desk (zombie), and the
   finale in each vibe. Real names and numbers are blurred.

## Open items (resolve during the build, not blockers)

- Count real Century Park East customers quiet 45+ days in prod (read-only) before the build, so the level opens with
  a real number.
- **Find out whether the Century Park East customers are on `laundry_farm` or `default`.** Adam logs in as `default`,
  and Silver Lake's real data was on `laundry_farm`.

## Separate track (not this slice)

Beverly Hills should get a **rope per prospect**: each prospect brings its own gatekeeper and three errands, so the
town replays instead of repeating the same juice, pug and shades. Do this before cloning the town kit to more
neighbourhoods.
