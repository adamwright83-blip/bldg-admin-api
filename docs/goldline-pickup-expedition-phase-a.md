# Goldline — Pickup Expedition Heartbeat: Phase A Inventory

Internal implementation note. Written before any gameplay code, per the
assignment's Phase A gate.

## Base

- `origin/main` at inventory time: **f21d1860ce1f90bbb88e27d3780265a8717bdb50**
  — exactly the SHA named in the assignment; verified by fetch, not trusted
  blindly. The local checkout was 13 commits stale (PRs #68/#69 had landed)
  and was fast-forwarded, not rebased.
- Open PRs to protect: **#47** (`feature/goldline-instagram-share-capture`)
  and **#49** (`feature/goldline-instagram-durable-jobs`), both DRAFT, both
  Instagram/Sales Intel. Untouched by this work — no shared files.
- Migration 0057 reserved by #49. **No migration in this slice.** Never
  `pnpm db:push`.

## Real pickup truth source

The expedition binds to a genuine `orders` row. There is no new truth.

- **Objective selection already exists**: `GoldlineGameHome.tsx`'s
  `nextOrderObjective` (~line 742) picks from the real `props.pickups` /
  `props.deliveries` — the same `admin.listByDate` rows the route panel
  renders, pickups before deliveries.
- **World embodiment already exists**: `populationProjection.ts`'s
  `bindOrderToPopulation` → `PopulationSystem.setOrder` turns that order
  into a real Pixi world marker on an authored corridor anchor, and
  completion is already gated on Trailblazer's real proximity
  (`stagingRadius` / `isOrderApproachable`).

So the expedition consumes an existing canonical objective descriptor. It
does not need — and must not add — an objective concept of its own.

## Canonical pickup mutation (the ONLY completion path)

`orders.updateStatus({ orderId, status: "collected" })` in
`server/routers.ts:2723`. That procedure:

1. calls `attemptOrderPickupCollection(orderId)` (`server/db.ts:733`) — a
   **single conditional UPDATE**, `SET status='collected' WHERE id=? AND
   status IN ('new','intake-pending')`. Not read-then-write, so concurrent
   requests / retries / duplicate tabs cannot both win. `transitioned` is
   true only for the request that actually changed a row.
2. on a genuine transition only, calls
   `ensurePickupCompletedOperationsEventForOrder` → writes an
   `operations_events` row with `sourceEventType: 'pickup_completed'`.
3. records a war action and sends the pickup SMS — once, never on retry.

This is already atomic, already idempotent, already emits durable evidence.
The expedition wires its RETRIEVE / SECURE CARGO action straight to it and
adds nothing. `CARGO SECURED` renders only after this mutation resolves
successfully — never optimistically.

## Stronghold payoff evidence (no new ledger)

`operations_events` rows with `sourceEventType = 'pickup_completed'` are the
authoritative, already-persisted evidence of real collection. They are
already aggregated by `server/operationsEventsDashboard.ts:207,249`
(`pickupCount`), and already consumed by `openChannelService.ts:494` and
`unloadService.ts:53`.

Restoration state derives from that count. This satisfies §37/§39 with
**no Marks table, no Marks migration, no new persistence**. Reload
preserves the payoff because the evidence is a DB row, not a client flag.
Truthfully, production history already contains qualifying pickups — the
production Stronghold will legitimately render at its derived state rather
than at zero. Test fixtures start at zero and perform one.

## Substrate to reuse (not rebuild)

| Need | Existing |
|---|---|
| Renderer | PixiJS via `runtime/GoldlineGame.ts` (1860 LOC) |
| Camera | `runtime/CameraController.ts` |
| Movement feel | `runtime/movementFeel.ts`, `avatar/facing.ts`, `avatar/AvatarStateMachine.ts` |
| Corridor geometry | `world/RouteCorridor.ts`, `world/corridorAnchors.ts`, `world/corridorPack.ts`, `shared/corridorManifest.ts` |
| Gold Line visuals | `world/goldRoute.ts` |
| Civilians | `world/PopulationSystem.ts` (683 LOC) |
| Audio / haptics | `audio/AudioManager.ts`, `audio/haptics.ts` |
| Checkpoint / resume | `session/checkpointStorage.ts` |
| Action surface | `actions/GoldlineActionSurface.tsx` |
| Determinism | `encounters/deterministicMode.ts` |
| Reduced motion | `runtime/adaptiveQuality.ts` |

## Target ontology — structural safety

The assignment's §17 requirement is enforceable here because civilians and
business entities are already separate concepts: `PopulationSystem` models
ambient civilians, and order embodiment is a distinct `setOrder` slot.
Neither will implement the Linehook target shape. The new discriminated
union (`HostileLineTarget | EnvironmentLineTarget`) will be the *only*
input type the targeting function accepts, so a civilian or an order marker
is a compile error, not a runtime `if`.

## Test harness

- Fixture entry point already exists: `/driver?goldlineFixture=NEUTRALIZE`
  (`GoldlineFictionHarness.tsx`), which authors real pickup/delivery orders
  with zero commercial missions — the right shape to extend.
- E2E patterns established in `e2e/goldline/pickupDeliveryWorldObjective.spec.ts`:
  driver login via `/api/auth/login`, checkpoint pre-seed via
  `addInitScript`, onboarding suppression.
- **Viewport gap**: `playwright.goldline.config.ts` runs 412×923 @ DPR
  2.625. The assignment requires 393×852 @ DPR 3 as primary proof. These
  are *not* technically equivalent, so a dedicated 393×852 DPR3 project is
  needed for the required screenshots rather than reusing the existing
  profile.

## Art limitation (honest)

There are no existing hostile/guardian sprites in `client/src/assets/goldline`
— the world art is a painted Mediterranean corridor. Ruinbound will be built
as restrained procedural Pixi geometry inside the existing visual language
(limestone / brass / Line-fracture), which is acceptable per §22 but is the
most likely source of a visual caveat. If it reads as debug geometry pasted
onto premium art, that gets reported as a blocker rather than self-certified.

## Explicitly NOT built

No migration. No Marks table. No second completion path. No Open Channel
changes. No adaptive Director. No new renderer. No Three.js/WebGPU.
