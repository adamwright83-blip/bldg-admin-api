# Century Park East Siege — first playable

Tower Wars now opens into an active defense game. Rivalry remains a separate sales-powered view. Siege needs no new order, payment, or business reward to start or replay.

The player places a three-defense field kit on three fixed pads along one abstract Approach Route, spends regenerating Lumen, focuses targets, recalls defenses for 75% of their deployment cost, and times a free Repulse. Five authored waves introduce Dust, then a telegraphed Lapse that steals a fictional lantern and returns toward the entry. Beacon deals no damage; it accelerates adjacent emplacements. There is a readable hold/breach result and immediate rematch.

## Evidence and scope

The existing authoritative Tower Wars weekly ledger is read only. Its count of CPE events maps to difficulty 0.30–0.80; missing evidence uses neutral 0.45 and makes no inactivity claim. The exact weekly count is kept as the factual reflection. Session inputs are snapshotted so incoming data cannot reset an active battle. No business mutation endpoint is used.

One abstract route is shown; no lobby, garage, or service entrance is asserted. No customer is an enemy. Siege barricades and lanterns do not alter Rivalry scars or business records.

Saves and the last 20 completed outcomes are versioned local browser records, scoped by tenant, operator, and Stronghold. Reload resumes paused, hidden tabs pause, and no wall-clock time is simulated while away. A first new battle seven days after the last completed battle caps pressure at 0.55. Cross-device saves and backend Chronicle integration are not implemented. If tenant context is unavailable, play remains available for the current session, with an explicit save limitation.

## GOLDLINE DESIGN DECISION

Conflict: The bible names Valet Launch, Fountain Surge, and Beacon as the V1 kit, but this repository has no confirmed CPE amenity evidence. Reusing a weapon name is not amenity evidence. Locking damage/control behind a nonexistent evidence flow would block the intended first playable.

Business Truth affected? NO. Evidence tier involved: NONE for the fictional field kit; Tier 1 for weekly ledger input. Real person represented as enemy? NO. Invents business fact? NO. Removes permission to play? NO. Generic gamification? NO.

Player verbs: deploy, recall, focus, repulse, pause, resume, replay.

Resolution: The first playable supplies these three as an explicitly fictional field kit, stated in the Field guide. It does not unlock or confirm real amenities. The generic Approach Route remains dashed and labeled abstract. Future site-derived kit unlocks require provenance-backed operator observations.

Bible change required? YES: this is an explicit temporary V1 exception to amenity-gated defenses, not evidence promotion. No changes to the truth firewall. No specialization tree, new enemies, or monetization.

Files/systems: shared/towerSiege.ts, TowerSiege.tsx, TowerWars.tsx, towerSiege.css.

Date: 2026-09-05. Author: Codex.

## Validation and playtest

Run `npx vitest run shared/towerSiege.test.ts shared/towerWars.test.ts client/src/components/admin/control-room/TowerWars.test.ts`.

A full automated active-play run at maximum zero-order pressure holds all five waves in 5–8 simulated minutes. An undefended run loses with a route/enemy explanation. These checks establish playability, not proof that the game is fun; voluntary replay still needs user playtesting.

For isolated browser playtesting, run `npx vite --config vite.preview.config.ts --port 5193` and open `/siege.html`. This uses a labeled zero-order fixture and an isolated local save, never live business data. The normal admin entry remains `/growth/tower-wars`.

Verification on 2026-09-05: 20 focused tests passed. Vite production frontend build passed. Desktop and 390px portrait browser checks exercised deploy, start, Repulse, and paused reload/resume with no browser errors. Portrait combat capture: `artifacts/siege-v1/mobile-combat.png`. The repository-wide TypeScript command still reports pre-existing errors outside the changed Siege/Tower Wars files; no clean global type-check is claimed. A preparing feed also offers immediate session play without waiting for network or account context.

## Supplied-art 2D pass
The 2026-09-05 visual pass uses the user's courtyard and transparent enemy/defense sheets directly, with CSS atlas frames. No image generations, paid services, new engines, or 3D assets were used. Route and pad coordinates are registered to the painted courtyard. The scenery is fictional game projection. The combat, local saves, and five-wave loop remain unchanged. Blender/3D conversion is deferred by user request.
