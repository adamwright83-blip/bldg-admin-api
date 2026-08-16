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

## Fourth audit round (A-Z) — status

A, B, C, D, F, H, I done and verified. E, G, J(partial), K-Z NOT done.

**DONE, verified this round:**

A. Real character freeze, not just coordinates. `effectiveInput = {0,0}`
   while terminal; facing/rotation/avatarState all read it. Route
   commitment (`tryChooseRoute`) gated on `expeditionCanMove`. Verified
   live: held continuous diagonal input while down for 1.5s — rotation
   stayed exactly 0, facing never changed, avatarState settled to "idle".
B. Joystick releases stale input via a `useEffect` keyed on `disabled`.
   Verified live with real PointerEvents: held forward, forced down without
   releasing the finger, input snapped to {0,0}; Redeploy with the finger
   still "down" did not move the player.
C. `GoldlineGameHome.performAction()` also checks `activeExpedition`.
D. Expedition Gold Line no longer inherits commercial-mission
   worldState/worldSignal color — forced to the adventure treatment
   whenever `this.expedition` is set.
F. `activeClimaxBarrier()` is the ONE predicate both
   `getGameplayForwardCeiling` and `isClimaxBarrierUp` read — previously
   two independently-maintained checks that could disagree if a plan were
   missing the barrier fixture.
H. Double-recoil fixed. Sprite root always gets the true world position;
   only the child body applies recoil, once. `lineTargetScreenPoint`
   follows that same single offset. Verified live: read the actual Pixi
   objects one frame after setting recoil directly on a real hunter — root
   x stayed at 195 (stable), body.x read 8 (the one offset).
I. `ExpeditionSnapshot` exported once from `expeditionState.ts`; the
   duplicated inline type in GoldlineGameHome (with the wrong `relic:
   string | null` shape) is gone.

**NOT DONE:**

E. Climax seal (`gSeal`) still lives in `ExpeditionLayer.container`, which
   is the high-z gameplay overlay — it does NOT depth-sort with world
   actors yet. A civilian or Trailblazer standing in front of it will not
   correctly occlude it. Needs the same `HostileVisual`-style root-in-
   `hostFor()` treatment the guardians/props already got.
G. No release animation when the barrier drops — it disappears in one
   frame instead of a ~250-400ms fracture. Movement already opens
   immediately on the state change (correct), just no visual transition.
J. Foundation gates (tests/tsc/build/bundle) re-run and green after every
   change this round — that part of J is continuously true. The specific
   9-point live-sanity checklist in J was only partially executed (1, 2
   done; 3-9 not individually re-verified this round beyond what A/D/F/H
   cover).

K-Z: Relic verbs (echo_thread, sunstep, clashEnded caller), relic plinths,
physical fork rendering, guardian scale tuning, destination world actor,
authoritative evidence queries (listByStatus x4), pinned
restorationBefore, HUD terminal states, SECURE CARGO handler,
authoritative reconciliation ("reality wins"), Stronghold physical payoff,
finishExpeditionAtStronghold wiring, CDP touch smoke test, full regression
matrix, visual review, and shipping (PR/CI/merge/deploy) — NONE of this is
started. This is not a small remainder: it is roughly the entire Phase E
business-integration chain plus all of Phase D's world presentation.

## Why this has taken this many rounds — stated plainly

Every round this session found REAL bugs in code from the previous round
that had been reported as done. The pattern each time: a fix was correct
at the layer I tested (a helper, a single code path, a unit test) but a
sibling path I hadn't traced still bypassed it. Locomotion position was
fixed before locomotion pose. The movement ceiling was fixed before the
thing rendering it. Recoil was fixed at the position level while still
being computed twice. None of these were guessed at by the auditor — they
were found by reading the actual diff, which is exactly what I should have
done more exhaustively before calling something finished. The fixes
landing now are real and mostly live-verified, not just unit-tested. The
remaining scope (K-Z) is large enough that attempting it in the time
remaining without the same discipline would very likely repeat the
pattern rather than break it.

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

---

# SHIPPING SESSION — the heartbeat closed

Three staged rounds against base `b1931a7`, each implemented, tested, live
verified, committed and pushed. PR #70.

## What changed

**Stage 1 — the expedition's physical objects became world actors.** The
climax seal moved out of the `GAMEPLAY_OVERLAY` band into `hostFor()` at
`worldActorZ`, so a closer Trailblazer renders in front of it; the single
`activeClimaxBarrier()` predicate still drives both the visual and the
movement clamp, and the release is edge-detected in the simulation rather
than as a side effect of drawing a frame. All three relics gained real
mechanics — Echo Thread (one leap, never a chain, never past the
Shieldbearer's guard), Sunstep (one burst per dodge, armed on the i-frame
rising edge), Brass Guard (re-arms only at a real clash boundary; its
`clashEnded()` recharge had never been called by anything, so the guard
absorbed one blow per expedition and then silently stopped being a relic).
Three plinths, chosen by walking. The Safe/Upper fork got drawn. The
destination cache became a depth-sorted actor that is deliberately not an
environment node and not a Line candidate. Guardian heights split to
130/116/146.

**Stage 2 — the pickup is secured by server truth.** Four existing
`admin.listByStatus` queries unioned into one `{id, status}` evidence
collection. `activeExpedition` pins `restorationBefore` at ENTER and never
recomputes it. SECURE CARGO calls the one canonical service and shows
VERIFYING SERVER TRUTH; the local phase type has no `secured` member.
CARGO SECURED, the audio, and `finishExpeditionAtStronghold()` all fire
from `expeditionOrderCollected` — a condition that contains no check that
this client pressed the button, which is what makes another surface's
collection reconcile identically. Six lanterns and a brass conduit derived
purely from evidence, so a reload rebuilds them.

**Stage 3 — proved by thumb.** Real CDP `Input.dispatchTouchEvent`, not
synthetic events. The complete journey plus both recovery paths.

## The Phase F item above is now closed

Synthetic touch was never going to be adequate, and the note above was
right to block on it. The answer was not Playwright's `touchscreen` API but
CDP directly: `scripts/verifyGoldlineTrueTouch.mjs` dispatches real touch
through the browser's own input pipeline, so the events arrive as real
PointerEvents with real timestamps and real capture. That matters because
the control grammar is decided by real elapsed time (dodge vs aim) and a
continuous stream of touchmove points (heading and lock) — neither of which
a synthetic dispatch reproduces.

## Three verification scripts, all measuring rather than eyeballing

- `verifyGoldlineTrueTouch.mjs` — the six control proofs.
- `verifyGoldlineHeartbeat.mjs` — the full journey, 27 checks, by thumb.
- `verifyGoldlineStage1.mjs` — the visual pass. Fails if the ceiling does
  not open the instant the Shieldbearer dies, if Trailblazer does not sort
  in front of the seal, or if the payoff does not survive a reload.

All three run against a dev server started with
`VITE_GOLDLINE_TEST_HARNESS=1` at `/driver?goldlineFixture=NEUTRALIZE`,
with only `auth.me` intercepted — the fiction harness supplies the rest.

## Corrections recorded this session

**Pale limestone at low alpha does not read on this plate.** The seal, the
plinths and the fork branches were each implemented and each visually
broken the same way. This file's own comments had already recorded that
lesson twice — for the Ruinbound ("blank paper cut-outs") and the grapple
corbel ("a white rectangle pasted on the painting") — and the new objects
reintroduced it anyway. Anything new drawn into this world needs a dark
body with a limestone rim light and brass fittings, or a dark scrim under
gold. Check it in a zoomed crop, not a full-plate screenshot: the painting
is far too busy to judge one small object against.

**Redeploying at the climax respawns the Shieldbearer**, because
`resetFromWaystone` correctly restores every hostile at or ahead of the
checkpoint. Any test or script that kills the elite and *then* redeploys
walls the player in behind a resurrected barrier. Recover first, fight
second.

**A fixture standing in for a server has to persist like one.** The reload
check initially proved nothing, because the fiction harness kept its
evidence in React state and a reload wiped it. It now persists to
sessionStorage under `goldline-fixture:server-collected-orders` — that is
the stand-in DATABASE, not app state. The application still stores nothing
about restoration, which is exactly what the reload check verifies.

**The `DEPLOY` guard in `driverGameWorldContract` is substring-based.** A
comment containing the word REDEPLOY in `GoldlineGameHome.tsx` trips it.
The guard is not wrong — it keeps an old business-action button out of the
game shell — so reword rather than relax it.

## State at handoff

- Full suite fails only the same 5 tests `b1931a7` already failed, verified
  by running the base in a worktree rather than assuming.
- TypeScript baseline unchanged at 28 pre-existing errors.
- Production build succeeds; Goldline bundle budget 136.3KB gzip / 150KB.
- No migration. `db:push` never run. #47 and #49 untouched.

**FUN GATE: PENDING ADAM REAL-DEVICE PLAYTEST.**
