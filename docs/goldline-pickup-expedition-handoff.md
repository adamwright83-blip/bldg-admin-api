# Goldline Pickup Expedition Heartbeat — Handoff

Continue on the EXISTING branch. Do not restart, do not branch, do not
redesign.

- **Branch:** `agent/goldline-pickup-expedition-heartbeat`
- **Head SHA:** see `git rev-parse HEAD` — ALWAYS verify live. A SHA written
  here is stale the moment the next commit lands; the doc commit itself
  advances it. Do not reset to any SHA quoted in this file.
- **Base:** `origin/main` = `f21d1860ce1f90bbb88e27d3780265a8717bdb50`
- **Commits ahead of main:** `git log --oneline origin/main..HEAD`. No PR yet.

## Gate status

| Gate | State |
|---|---|
| `client/src/game` vitest | 459 pass (56 files) |
| expedition unit+integration | 146 pass (10 files) |
| TypeScript | 28 errors — **exactly the pre-existing baseline**, none from this work |
| Production build | succeeds |
| Goldline bundle budget | PASS (~124KB gzip vs 150KB) |
| Migration | NONE. 0057 still reserved for PR #49 |
| PR #47 / #49 | untouched |

The 28 baseline errors are in `server/procurement/`, `server/routers.ts`,
`client/src/pages/Home.tsx`, `client/src/pages/goldline/GoldlineHome.tsx`
and similar. Verify with:
`npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "game/expedition"`

## Local verification environment (this is the unlock — reuse it)

Full in-browser verification works. Do not try to run vite alone (no API)
and do not point anything at production.

```bash
docker run -d --name goldline-verify-db -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=goldline_mobile_gate -p 3399:3306 mysql:8.0
```

Then migrations (this is `db:dayforge:release`, **never** `db:push`):

```bash
DATABASE_URL="mysql://root:root@127.0.0.1:3399/goldline_mobile_gate" DAYFORGE_RELEASE_DB=1 npx tsx server/dayforgeRelease/applyReleaseMigrations.ts
```

Build with the harness flag, then run the real server:

```bash
VITE_GOLDLINE_TEST_HARNESS=1 npx vite build && npx esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
```

```bash
NODE_ENV=ci PORT=4175 CI=true DATABASE_URL="mysql://root:root@127.0.0.1:3399/goldline_mobile_gate" DAYFORGE_RELEASE_DB=1 APP_SHARED_API_SECRET="goldline-mobile-app-secret-000000000000000000" JWT_SECRET="goldline-mobile-jwt-secret-000000000000000000" STRIPE_SECRET_KEY="goldline-mobile-placeholder-not-used" DRIVER_PASSWORD="goldline-mobile-driver-pass" DRIVER_OPEN_ID="goldline-mobile-driver" OAUTH_SERVER_URL="http://127.0.0.1:4175" node dist/index.js
```

Log in, then load the fixture at `393x852`:

- `POST /api/auth/login` with `{ password: "goldline-mobile-driver-pass", role: "driver" }`
- set `localStorage["goldline:onboarding:v1"] = '["first_entry_explained"]'`
- open `/driver?goldlineFixture=NEUTRALIZE`
- click `[data-testid="expedition-enter"]`

**Known tooling bug:** the browser `computer` click tool times out against
this page (the Pixi canvas appears to swallow synthetic pointer events).
DOM `.click()` and `dispatchEvent` work fine. Playwright's own tap/touch
should be used for E2E — verify early whether it drives the action pad,
because §3 requires E2E through the real touch surface.

## What is DONE

**Structural boundaries (proven, do not weaken):**
- `lineTargets.ts` — branded closed union; `@ts-expect-error` tests are
  load-bearing (an unused directive is itself a compile error).
- `lineCandidateRegistry.ts` — the semantic boundary. Candidates come only
  from explicit `registerHostile`/`registerEnvironment`. No bulk-add, no
  population filtering, no order/civilian adapter. A test asserts those
  method names stay absent.
- `expeditionClock.ts` — `authoritativeNowMs()` consults no field, proven
  exact under dilation + hit-stop + pause together.
- `strongholdRestoration.ts` — collected-order status is PRIMARY,
  `operations_events` supporting only (they are not one transaction).
  `restorationDelta` proves payoff from the expedition's own order against
  pre-existing history.

**Playability (all six ChatGPT findings resolved):**
1. Linehook moves the REAL Trailblazer. `corridorCoupling.ts` holds the
   projection and its exact inverse, both imported by the live runtime;
   `linehookIntegration.test.ts` drives that genuine path. One movement
   truth — the layer holds velocity only, position is always re-derived.
2. Latch resolves automatically on the connecting frame, exactly once.
3. `ExpeditionHud.tsx` is the real two-zone control surface, wired to real
   `GoldlineGame` methods.
4. Contextual basic lash runs (stationary, 0.55s cadence).
5. Hit-stop → fictional clock only; camera shake → existing
   `CameraController.impulse` / `setLookahead`.
6. Explicit `EXPEDITION READY / ENTER THE LINE` threshold. Combat never
   auto-starts.
7. Art pass done (dark basalt, rim light, two-part grounding, depth scale).
8. Chrome suppressed via `[data-expedition-state="active"]` with selectors
   read off the live DOM.

## What REMAINS

### RESOLVED since last handoff

- **Ruinbound unit-space bug (was the real cause of instant damage).**
  `RUINBOUND_TUNING` was authored in pixels but compared against corridor
  progress (0..1), so every guardian aggroed from anywhere. Now in progress
  units with `LATERAL_TO_PROGRESS`. `safeOpening.test.ts` is the acceptance
  test, and it is NOT global invulnerability — walking onto the Hunter at
  0.18 still hurts.
- **Expedition start position.** `startExpedition` snapshots the
  non-expedition corridor position and places the player at
  `EXPEDITION_START_PROGRESS` (0.06); `endExpedition` restores it. Verified
  live: 0.780 -> 0.060 on entry, HP 100% at 1s and 12s.
- **Asset pack installed** at `client/src/assets/goldline/heartbeat/`,
  alpha-verified and downscaled 19.1MB -> 1.9MB. **Not yet wired into the
  renderer** — the Ruinbound are still procedural.

**Known issues — fix these first:**

1. **Purple card still overlays the world.** `portalPresentation.ts` now
   forces corridor portals to an ambient glow during an expedition, and its
   regression tests pass — but the card is STILL visible at 393px with a
   fresh expedition running. So it is **not** the `comms_portal` sprite.
   Identify the real object before changing more code: candidates are the
   landmark `Graphics` (`drawLandmark`), the stronghold sprite
   (`updateStronghold`), or a corridor-transition overlay. Keep the portal
   rule — it is correct and covered — but find the actual culprit.

2. **Sprites not wired.** The corrected asset pack is committed and sized,
   but `ExpeditionLayer.drawHunter/drawSlinger/drawShieldbearer` still draw
   procedural polygons. Swapping to `Sprite` is the highest-value visual
   work left. Anchor at the feet — solid-content bottom is ~0.98 of texture
   height for the guardians. Keep runtime behaviour (depth scale, contact
   shadow, facing mirror, telegraph transform, hit flash, recoil).

3. **Corridor auto-transition is not yet blocked during an expedition.**
   The observed `corridor_02` means ordinary transition still runs. It no
   longer corrupts start position, but it can still drop the layer
   mid-expedition. Guard it.

4. Art is **not §53-certified** at 393×852 DPR3.

5. Vitals poll on a 120ms interval — fine for bars, replace if it costs
   frames.

**Phase D** — Relic choice (three plinths at `plan.relicPlinths` 0.42),
physical Safe/Upper fork (`plan.fork` 0.46–0.72, call
`expedition.setRoute()`), hazard already renders and resolves, Shieldbearer
climax exists, Waystones (`waystoneFor()`), death UI, Redeploy, Press On →
Scarred Route. **All the state logic already exists and is tested** in
`expeditionState.ts` / `expeditionPlan.ts` — Phase D is mostly presentation
plus calling those methods.

**Phase E** — Bind destination (`plan.destination` 0.96); arrival must
leave the order pending; Retrieve/Secure Cargo calls ONLY
`orders.updateStatus({ orderId, status: "collected" })`
(`server/routers.ts:2723` → `attemptOrderPickupCollection`,
`server/db.ts:733`); `CARGO SECURED` only after server confirmation; feed
collected orders into `projectStrongholdRestoration`.

**Phase F** — 393×852 DPR3 Playwright project (existing profile is
412×923 @ 2.625 and is NOT equivalent), the 35-assertion E2E through real
touch, 14 screenshots, regressions, PR, merge, deploy verification.

## REVIEW METHOD — read this before claiming any invariant holds

This branch has now shipped the same class of mistake three times: a helper
exists, unit tests pass, the commit message explains the intent, and the
actual player path bypasses it.

The worst example: `forwardCeiling()` was computed correctly and then
discarded one line later by `Math.min(blocked ? ceiling : 0.82, next)`,
because `blocked` is false during ordinary movement. Dodge and the tether
respected the ceiling; the joystick — the path players use constantly — did
not. The tests passed because they asserted the helper, not the path.

**Before declaring a cross-system invariant fixed:**

1. `grep` EVERY production assignment to the state in question. For player
   progress that is: joystick, dodge, Linehook impulse, traversal action
   (`performAction`), checkpoint restore, expedition entry, corridor reveal,
   initial `start()`. Auditing this list is how the second bypass
   (`performAction` hardcoding 0.78) was found.
2. Ask "can the player reach this state through another path?"
3. Test the PATH, not the helper. Drive the real per-frame decision with
   realistic input over enough frames to overrun.
4. Verify in the live runtime where possible. `window.__goldlineGame` is
   exposed under the harness flag: `setInput(0,-1)`, sample `progress` over
   seconds, assert the bound. That is what finally proved the ceiling.

## DEPENDENCY ORDER

1-7. **DONE** — reachability, transition ownership, purple card, sprites,
   safe opening, world actor depth, route/waystone correctness.
8. **DONE** — population ownership lifecycle, death/arrival gate combat,
   Shieldbearer climax barrier, two-clock fix, Line origin unification,
   duplicate shadow removed, HUD pointer cleanup, expedition identity
   pinning. See commits `03a237a` and `6297303`.
9. **NEXT — see "Outstanding" below.**

## What ChatGPT's second review found and where each landed

All confirmed as real bugs by direct code inspection before fixing:

| # | Bug | Status |
|---|---|---|
| 0 | PopulationSystem ownership breaks after `attachActorHost` reparenting | **Fixed** — explicit `addOwnedActor`/`destroyOwnedActor`, `capabilityGraphics` array. 7 tests. |
| 1 | `setRoute` respawns already-defeated `route:"both"` hostiles | **Fixed** — `addChosenRouteContent` is additive-only; `rebuildRouteContent` only runs at load and for Scarred. |
| 2 | Redeploy rebuilds the whole run, not from the waystone; waystone can regress | **Fixed** — `resetFromWaystone`, monotonic `setWaystone`. |
| 3/4 | Death/arrival don't stop combat simulation or locomotion | **Fixed** — `outcome === "running"` gates in `ExpeditionLayer.update` and `GoldlineGame.expeditionCanAct()`. |
| 5 | Aim dilation slows enemies but not Trailblazer (two-clock violation) | **Fixed** — `gameplayDelta` scales locomotion/dodge/lash while an expedition is active. |
| 6 | Line targeting origin (feet) disagrees with visible cone/cable origin (`body.y-40`) | **Fixed** — `lineOrigin()` is the one definition; `Linehook.fire` gained `visualOrigin`. |
| 7 | Tether doesn't inherit the player's screen-space velocity before latch | **NOT DONE** |
| 8 | Guardian sprites draw both a local AND a global overlay shadow | **Fixed** — global shadow only in the procedural-fallback branch. |
| 9 | Ordinary mission/order presentation competes with the expedition | **Fixed** — `setExpeditionPresentation`. |
| 10 | Base mission/order proximity/INTERACT still runs during combat | **Fixed** — both nulled while `this.expedition` is set. |
| 11 | Gold Line objective points at the wrong thing during an expedition | **Fixed** — `getDestinationProgress()` takes priority. |
| 12 | Unrelated base-world presentation not suppressed (landmark/portal/camera lookahead) | **NOT DONE** |
| 13 | Ordinary checkpoint saves expedition coordinates | **Fixed**. |
| 14 | Pre-expedition snapshot didn't include `branch` | **Fixed**. |
| 15 | Base `branchForLateralPosition` fires during the expedition, interferes with the fork | **Fixed** — `tryChooseRoute` owns fork commitment; base branch logic skipped entirely while `this.expedition`. |
| 16-17 | Redeploy/Press On wrappers | **Fixed** — `expeditionRedeploy`/`expeditionPressOn` on GoldlineGame, Press On has a hard throw if progress ever moves. |
| 18 | Shieldbearer must gate forward progress, not just be skippable | **Fixed** — `getGameplayForwardCeiling`, verified live (25s hold-forward stops at 0.6464, short of destination 0.7128). |
| 19 | Destination cache should not be a Line target | **NOT DONE** — `getDestinationProgress()` exists; no visual actor or registry-exclusion yet. |
| 20 | Arrival | **Fixed** — `ExpeditionRun.arrive()`, `maybeArrive()` requires climax cleared or Scarred. |
| 21 | Relics: only `brass_guard` has real behavior; no clash-boundary caller; no plinths | **NOT DONE** |
| 22 | HUD pointer listener leak / stuck aim on unmount mid-hold | **Fixed** — one `cleanupPointer` path, pointer-id tracked. |
| 23 | `expeditionOrderId` re-derived live; SECURE CARGO would tear down its own climax | **Fixed** — `activeExpedition` pinned on ENTER. Verified live. |
| 24-29 | Authoritative collected-order evidence, reconciliation, SECURE CARGO via `actionServices.resolveOrder`, Stronghold payoff, `finishExpeditionAtStronghold` on canonical completion | **NOT DONE** — `finishExpeditionAtStronghold()` exists on GoldlineGame but nothing calls it yet. |
| 30 | HUD terminal states (down/arrived/verifying/confirmed) | **NOT DONE** — `getSnapshot()` exists; HUD doesn't consume `outcome` yet. |
| 31 | Physical Safe/Upper fork presentation (world decoration, not UI) | **NOT DONE** — `tryChooseRoute` works mechanically; nothing renders the fork visually yet. |
| 32 | Guardian scale/clustering tuning | **NOT DONE** |
| 33 | Playwright CDP touch helper for hold/drag | **NOT DONE** — confirmed correct that `Touchscreen` is tap-only; CDP `Input.dispatchTouchEvent` is the right approach, not yet built. |
| 34 | Full regression matrix | **Partial** — A, C, D, E(waystone), G, H, I, J, M done. B, F, K, L, N-V not done. |
| 35-37 | Visual gate, shipping | **NOT DONE** |

## Outstanding, in priority order

1. **Part 21 — Relics.** Implement `echo_thread` (chain lash) and `sunstep`
   (evade-triggered burst, once-per-dodge via a consumed flag) before
   showing any plinth. Wire `run.clashEnded()` — it exists but nothing
   calls it. Then physical plinths at `plan.relicPlinths`.
2. **Part 31 — physical fork presentation.** `tryChooseRoute` already works
   mechanically (verified: `setRoute` fires from lateral commitment inside
   the mapped window). Needs world decoration under the actor layer, not UI.
3. **Part 30 — HUD terminal states.** Wire `getSnapshot().outcome` into
   `ExpeditionHud`: DOWN shows REDEPLOY/PRESS ON calling
   `expeditionRedeploy()`/`expeditionPressOn()` (both exist and are tested);
   ARRIVED shows the pinned `activeExpedition.customerLabel`/`.address`
   and a SECURE CARGO button.
4. **Parts 19, 24-29 — the SECURE CARGO chain.** Destination actor (texture
   already loaded, not registered as a Line target). Mount
   `admin.listByStatus` for collected/processing/ready/delivered. Handler
   calls ONLY `actionServices.resolveOrder({orderId, status:"collected"})` —
   do not open `GoldlineActionSurface`. Do NOT show CARGO SECURED from the
   mutation's boolean; reconcile from the authoritative evidence query
   matching `activeExpedition.orderId`, THEN call
   `finishExpeditionAtStronghold()` (already exists) and feed
   `projectStrongholdRestoration()` (already exists) into a render.
5. **Part 33 — Playwright CDP touch smoke test**, before the large journey.
6. **Part 32 — guardian scale tuning** at 393x852 (role-specific heights,
   not the single 150px constant).
7. **Part 34 remainder, 35-37** — full regression matrix, visual gate,
   shipping.

## Dev-only scene probe (keep)

`game.probeSceneRegion({x,y,width,height})` and `window.__goldlineGame`,
both gated behind `VITE_GOLDLINE_TEST_HARNESS`. Found the purple card in one
pass after two implemented-then-disproven guesses. Known limitation:
`setSceneNodeRenderable` builds paths differently from the probe, so set
properties directly instead.

## Also still open

- **Synthetic touch does not drive the joystick.** Phase F must prove
  Playwright's `touchscreen` API drives ENTER THE LINE, joystick, ACT tap,
  ACT hold, aim drag and release BEFORE the large journey is written.

**FUN GATE: PENDING ADAM REAL-DEVICE PLAYTEST.**
