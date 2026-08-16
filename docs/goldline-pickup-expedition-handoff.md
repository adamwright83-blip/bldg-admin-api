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

## Third audit round — items 1-12 done, 13-27 outstanding

This numbering follows the third prescriptive prompt exactly (superseded
the earlier scorecard).

**DONE, this round:**

1. Real GoldlineGame locomotion now freezes on down/arrived — not just the
   ceiling. `expeditionCanMove` zeroes velocity/dodge/expeditionDrivingMovement
   and gates the whole movement block. Verified live: 3s of real
   backward+lateral input while down produces byte-identical progress/lateral.
2. `performAction()` returns false immediately when `this.expedition` is set.
3. `suspendBaseObjectiveSignalsForExpedition()` fires at expedition start.
4. `branchPaceFor` neutralized to 1x during an expedition.
5. Press On preserves `this.env` exactly — no more re-arming spent hazards
   or dropping Upper's grapple architecture.
6. `lineTargetScreenPoint()` is the one definition for registry/fire/reticle.
7. Tether inherits real incoming screen-space velocity via
   `previousPlayerScreen`, cleared on every discontinuity.
8. `drawClimaxSeal()` — a real physical barrier, gated by the exact
   `isClimaxBarrierUp()` predicate the movement ceiling uses. Verified live
   via screenshot: visible posts + span across Trailblazer's path.
9. Landmark/portals/camera-lookahead/recoveryPath suppressed during expedition.
10-11. `activeExpedition` is the one lifecycle truth (removed
   `expeditionEntered`). Full typed `ExpeditionSnapshot` polled, reset on
   ENTER. Joystick `disabled` wired to terminal outcome — verified live.
12. Action pad refuses a second pointer mid-hold.

**NOT DONE — still exactly as prescribed, in priority order:**

13. **Relics.** `echo_thread` (chain lash) and `sunstep` (once-per-dodge
    burst) have no real implementation yet — only `brass_guard` exists, and
    `clashEnded()` still has no caller so "first blow of each clash" is
    false after the first absorption. Do NOT build plinths (13D) before 13A-C
    pass tests.
14. **Physical Safe/Upper fork presentation.** `tryChooseRoute` works
    mechanically; nothing renders the fork as world decoration yet.
15. **Guardian role-specific scale** (130/116/146 vs the flat 150 constant).
16. **Destination cache as a dedicated world actor**, explicitly NOT a Line
    target. `getDestinationProgress()` exists; no visual, no registry
    exclusion needed since it was never registered.
17-18. **Authoritative pickup evidence + pinned restorationBefore.** No
    `admin.listByStatus` queries mounted yet. `activeExpedition` needs a
    `restorationBefore: StrongholdRestoration` field, captured at ENTER using
    the existing `projectStrongholdRestoration()`.
19. **HUD terminal states** (DOWN/ARRIVED presentation, REDEPLOY/PRESS ON/
    SECURE CARGO buttons). `expeditionRedeploy()`/`expeditionPressOn()` exist
    and are tested; HUD doesn't call them yet.
20-21. **SECURE CARGO handler + authoritative reconciliation.** Must call
    ONLY `actionServices.resolveOrder`, never show CARGO SECURED from the
    boolean, reconcile from evidence matching `activeExpedition.orderId`,
    and — critically — reconcile even if an EXTERNAL surface collects the
    order first ("reality wins").
22. **Stronghold physical payoff** (lanterns/conduit) rendered from
    `projectStrongholdRestoration()`.
23. **`finishExpeditionAtStronghold()` wired to reconciliation** — the
    method exists (added two sessions ago) but nothing calls it yet.
24. **Playwright CDP touch smoke test**, before the large journey.
25. **Regression matrix** — most items above still need their own test.
26-27. **Visual gate, shipping.**

## Correction recorded for future sessions

`Graphics.children.length` is NOT how to verify a Pixi Graphics draw call
landed — `.fill()`/`.stroke()` calls are internal geometry instructions, not
child Containers, so that check always reads 0 regardless of whether
anything was drawn. Verify Graphics rendering with a screenshot, not a
children-count assertion.

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
