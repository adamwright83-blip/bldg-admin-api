# Goldline: Siege — first playable

## Where Siege sits in the world

Goldline is one world seen at three distances, and they are not interchangeable modes.

```
LANTERN CITY            the overworld / home screen
    | click a real tower (OPUS LA, Century Park East)
TOWER WARS              the automatic, real-sales-driven spectacle for that tower
    | optional PLAY SIEGE, offered only while the real war is quiet
GOLDLINE: SIEGE         the manually playable tower defense
    | back
TOWER WARS              the SAME building the player entered
    | back
LANTERN CITY
```

**Lantern City** is where the user lands at `admin.bldg.chat`. Clicking a tower is
the act of entering that building: `CityTowerButton` measures the tower, carries
its canonical id, and records where to return to, then navigates to
`/growth/tower-wars?building=<id>`.

**Tower Wars** is the arrival view for a tower — always, for either building.
It is the existing automated, sales-driven building-vs-building spectacle. Real
paid orders earn offensive power under the existing authoritative rules; the
player does not aim, place, or grind anything. It is exciting precisely because
it cannot be ground. Nothing in Siege can manufacture a Tower Wars event.

**Siege** is a different job: *when real-world sales are quiet, the game should
still be fun to open.* It is user-controlled, repeatable, runs with zero new
sales, and saves progression. It is entered deliberately from a quiet Tower
Wars — no mode selector, no trip back through the city — and leaving it returns
to the same building's Tower Wars, which keeps its own return to the city.

The `PLAY SIEGE` call to action renders only when there is no active or unseen
sales spectacle, no replay in progress and no historical date selected, so a
playable game never competes with the authoritative event it fills the gaps
between.

### The firewall

Siege reads the weekly Tower Wars ledger for difficulty and reflection only. It
writes no order, payment, sales ledger event, Tower Wars attack, business
promise, property fact, or campaign truth, and it never marks a Tower Wars event
seen — a sale that lands while the player is defending is still waiting, unseen
and unmodified, when they return to Tower Wars. An active Siege session is never
interrupted to present one.

### Entering play

The first meaningful action is choosing a pad and deploying a defense, and that
deployment *is* the opening move of wave 1: committing it starts combat. There
is no separate "Begin Siege" gate. Waves 2–5 keep the deliberate planning beat —
adjust the board, then send the wave.

## Building awareness and the current art limitation

The Siege shell is parameterised by canonical building: the feed filter, the
local save key, the world-transition arrival, the aria label and the header copy
all follow the resolved level rather than a hardcoded `century_park_east`. Save
keys carry the building segment (`goldline:siege:v1:<tenant>:<operator>:<building>`)
so two Strongholds can never overwrite one another's battle.

**KNOWN LIMITATION — Siege V1 is Century Park East only.** The supplied
`courtyard.png` is a painted Century Park East battlefield, and the pad and
Approach Route coordinates in `siegeStageGeometry.ts` are registered against
that painting. The protected tower is baked into the image; there is no separate
tower layer to swap. There is no OPUS Siege environment, and no art was
generated to invent one. `SIEGE_LEVELS` therefore contains one entry, and
`siegeLevelFor("opus_la")` returns null. A player entering from OPUS still lands
in OPUS's Tower Wars as normal; the Siege CTA truthfully names the Century Park
East Stronghold as the battlefield built so far rather than relabelling its
courtyard. Adding OPUS means adding OPUS artwork with its own registered
geometry.

`SiegeComeback.tsx` is unrelated: it is the commercial building-penetration
"engineer the comeback" business surface and is untouched by this game.

## Evidence and scope

The existing authoritative Tower Wars weekly ledger is read only. Its count of events for the resolved Stronghold maps to difficulty 0.30–0.80; missing evidence uses neutral 0.45 and makes no inactivity claim. The exact weekly count is kept as the factual reflection. Session inputs are snapshotted so incoming data cannot reset an active battle. No business mutation endpoint is used.

One abstract route is shown; no lobby, garage, or service entrance is asserted. No customer is an enemy. Siege barricades and lanterns do not alter Tower Wars scars or business records.

Saves and the last 20 completed outcomes are versioned local browser records, scoped by tenant, operator, and building. Reload resumes paused, hidden tabs pause, and no wall-clock time is simulated while away. A first new battle seven days after the last completed battle caps pressure at 0.55. Cross-device saves and backend Chronicle integration are not implemented. If tenant context is unavailable, play remains available for the current session, with an explicit save limitation.

## GOLDLINE DESIGN DECISION

Conflict: The bible names Valet Launch, Fountain Surge, and Beacon as the V1 kit, but this repository has no confirmed CPE amenity evidence. Reusing a weapon name is not amenity evidence. Locking damage/control behind a nonexistent evidence flow would block the intended first playable.

Business Truth affected? NO. Evidence tier involved: NONE for the fictional field kit; Tier 1 for weekly ledger input. Real person represented as enemy? NO. Invents business fact? NO. Removes permission to play? NO. Generic gamification? NO.

Player verbs: deploy, recall, focus, repulse, pause, resume, replay.

Resolution: The first playable supplies these three as an explicitly fictional field kit, stated in the Field guide. It does not unlock or confirm real amenities. The generic Approach Route remains dashed and labeled abstract. Future site-derived kit unlocks require provenance-backed operator observations.

Bible change required? YES: this is an explicit temporary V1 exception to amenity-gated defenses, not evidence promotion. No changes to the truth firewall. No specialization tree, new enemies, or monetization.

Files/systems: shared/towerSiege.ts, TowerSiege.tsx, TowerWars.tsx, towerSiege.css.

Date: 2026-09-05. Author: Codex.

## Validation and playtest

Run `npx vitest run shared/towerSiege.test.ts shared/towerWars.test.ts client/src/components/admin/control-room/TowerWars.test.ts client/src/components/admin/control-room/siegeNavigation.test.ts client/src/components/admin/control-room/worldTransition.test.ts client/src/components/admin/control-room/spectacle.test.ts`.

A full automated active-play run at maximum zero-order pressure holds all five waves in 5–8 simulated minutes. An undefended run loses with a route/enemy explanation. These checks establish playability, not proof that the game is fun; voluntary replay still needs user playtesting.

For isolated browser playtesting, run `npx vite --config vite.preview.config.ts --port 5193` and open `/siege.html`. This uses a labeled zero-order fixture and an isolated local save, never live business data. The normal admin entry remains `/growth/tower-wars`.

Verification on 2026-09-05: 20 focused tests passed. Vite production frontend build passed. Desktop and 390px portrait browser checks exercised deploy, start, Repulse, and paused reload/resume with no browser errors. Portrait combat capture: `artifacts/siege-v1/mobile-combat.png`. The repository-wide TypeScript command still reports pre-existing errors outside the changed Siege/Tower Wars files; no clean global type-check is claimed. A preparing feed also offers immediate session play without waiting for network or account context.

## Supplied-art 2D pass
The 2026-09-05 visual pass uses the user's courtyard and transparent enemy/defense sheets directly, with CSS atlas frames. No image generations, paid services, new engines, or 3D assets were used. Route and pad coordinates are registered to the painted courtyard. The scenery is fictional game projection. The combat, local saves, and five-wave loop remain unchanged. Blender/3D conversion is deferred by user request.

## Information-architecture correction — 2026-09-05

The first integration presented Siege and the sales-driven view as two peer tabs
("Siege · Century Park East" / "Rivalry · Sales") and defaulted Century Park East
straight into Siege, so clicking CPE in Lantern City skipped Tower Wars
entirely. There is no product mode called "Rivalry · Sales"; the sales-driven
experience simply *is* Tower Wars. That model has been removed.

Corrected: Tower Wars is the arrival view for both buildings; Siege is entered
from it by an explicit `PLAY SIEGE` action and returns to it. Siege's own eyebrow
reads `GOLDLINE: SIEGE`, never `TOWER WARS / SIEGE`. Combat, balance, the
economic firewall and the Tower Wars ledger/attack/replay/spectacle
infrastructure are unchanged apart from the wave-1 entrance flow.

Covered by `client/src/components/admin/control-room/siegeNavigation.test.ts`.
