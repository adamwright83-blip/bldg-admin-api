# GOLDLINE V1 WAVE — CURSOR HANDOFF

Practical resume file. No chat history required.

## 1. AUTHORITATIVE MAIN SHA
`6ccc2037832cd2aaa27a2d7b18ea9adf1689c954` (after PR #111 + #112)

## 2. BRANCH
`claude/goldline-v1-one-world`

## 3. CURRENT PUSHED BRANCH SHA
See `git log -1 --format=%H` on the branch. Last known: `119f85d` + this commit.

## 4. CURRENT PHASE + SLICE
Slice 0 (auth + reproducible world + mount gates) COMPLETE.
PHASE A Slice 1 IN PROGRESS — lanterns/towers/pursued-buildings done;
territory + Guardian must join the grammar before Phase A closes.
Next: Slice 2 (OPUS LA tower loop — locked, do not re-audit).

## 5. WHAT WAS JUST COMPLETED
- Ownership trace for `bldg_users` / `service_requests` (see §9).
- `scripts/goldline-admin-dev-setup.ts` — committed, reproducible local harness.
- Fixed a self-inflicted blank Lantern City (default export clobbered, `119f85d`).
- Added a mount/module regression that FAILS on that exact breakage.

## 6. WHAT IS BEING WORKED ON RIGHT NOW
Phase A Slice 1: consistent hover / focus / selected language for towers,
lanterns, territories, Guardians.

## 7. EXACT NEXT 3–5 ACTIONS
1. Slice 1: idle/hover/selected states for the primary world objects.
2. Slice 2: one excellent OPUS LA tower loop (locked choice — do not re-audit).
3. Slice 3: Tower Wars game feel (OPUS driver anticipation → impact → recovery).
4. Slice 4: Guardians as world characters.
5. Keep ledger + this file current at each push.

## 8. IMPORTANT FILES CURRENTLY IN PLAY
- `client/src/components/admin/control-room/LanternCityAtlas.tsx`
- `client/src/components/admin/control-room/admin-control-room.css`
- `client/src/components/admin/control-room/TowerWars.tsx`
- `client/src/components/admin/control-room/CanonicalBuildingArt.tsx`
- `client/src/components/admin/control-room/facadeRegeneration.ts`
- `client/src/components/goldline/TerritoryWorldLayer.tsx`
- `server/canonicalBuilding/canonicalBuildingService.ts`

## 9. EXISTING SYSTEMS — REUSE, DO NOT REBUILD
Traced live (mount/import/runtime), all already wired:
- Territories + Guardians: `TerritoryWorldLayer` renders inside
  `LanternCityAtlas`; calls `trpc.system.goldlineWorld.territories` and
  `recordGuardianDefeat`; uses `@shared/goldlineGuardians`.
- Tower Wars: `TowerWars.tsx` uses `trpc.system.towerWars.*` + `@shared/towerWars`.
- Transitions: `WorldTransitionProvider` mounts in `AdminHostApp`, consumed by
  `CityTowerButton` and `TowerWars`.
- Recovery: `WorldEntityInspector` (inside the Atlas) uses
  `trpc.system.churnRadar.interventions`; deliberately has NO control that
  marks a customer recovered.
- OPUS weapon: fully wired via `buildingArt.ts` (geometry now sourced from
  `opusWeaponGeometry.ts`).

**TABLE OWNERSHIP (traced, do not "fix" by migrating):**
`bldg_users` and `service_requests` belong to the upstream resident app
(app.bldg.chat). `scripts/migrate.mjs` is the production bootstrap and never
references them; no `drizzle/*.sql` creates them (0015 creates the different
`vendor_peer_service_requests`); `service_requests` entered via "Add Requests
tab: coordinated requests from resident app"; `check-bldg-users-columns.mjs`
exists to INSPECT upstream shape. Production expects them to preexist.
Do NOT add them to the production migration runner.

## 10. TRUTH / FIREWALL INVARIANTS
- `gameState = f(gameplay, evidence)`; `businessTruth = f(evidence only)`.
- GPS proves position/proximity/arrival only — never conversation/sale/recovery.
- attempt != contact != recovery != win.
- Guardian defeat / Tower War victory cannot alter business truth.
- Regeneration needs BOTH: collected-or-beyond order status (proves it
  happened) AND a completed `pickup_completed.actualEventTimestamp` (proves
  WHEN). No trustworthy timestamp = no healing credit, though the collection
  remains legitimate business truth.

## 11. AUTH / LOCAL HARNESS METHOD
Disposable MySQL:
```
docker run -d --name goldline-mysql -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=goldline_mobile_gate -p 3306:3306 mysql:8
```
Env (same values CI uses):
```
CI=true DAYFORGE_RELEASE_DB=1
DATABASE_URL=mysql://root:root@127.0.0.1:3306/goldline_mobile_gate
APP_SHARED_API_SECRET=goldline-mobile-app-secret-000000000000000000
JWT_SECRET=goldline-mobile-jwt-secret-000000000000000000
STRIPE_SECRET_KEY=goldline-mobile-placeholder-not-used
DRIVER_PASSWORD=goldline-mobile-driver-pass
DRIVER_OPEN_ID=goldline-mobile-driver
```
Bootstrap (all committed — no ad-hoc SQL):
```
pnpm db:dayforge:release
GOLDLINE_ADMIN_DEV_SETUP=true pnpm goldline:admin:dev-setup
pnpm tsx scripts/goldline-living-world-proof-seed.ts
VITE_GOLDLINE_TEST_HARNESS=1 pnpm vite build
pnpm esbuild server/_core/index.ts --platform=node --packages=external \
  --bundle --format=esm --outdir=dist
NODE_ENV=ci PORT=4174 node dist/index.js
```
Admin login (legitimate dev path, NOT a bypass):
```
POST /api/auth/login  {"password": "<APP_SHARED_API_SECRET>", "role": "admin"}
```
Verified from a DROPPED database: Lantern City renders 2 lanterns / 2 towers
with deterministic phases (-6.79s, -1.35s).

## 12. FAST TEST COMMANDS
```
pnpm vitest run client/src/components/admin
pnpm vitest run client/src/components/admin/control-room/facadeRegeneration.test.ts
pnpm vitest run client/src/components/admin/control-room/lanternCityAtlasMount.test.ts
pnpm exec playwright test --config playwright.goldline.config.ts
pnpm exec playwright test --config playwright.goldline.config.ts e2e/goldline/lanternCityMount.spec.ts
```
The last one is the ROUTE-MOUNT GATE. It fails if Lantern City renders blank.
Falsified against the 612af8c export breakage: fails there, passes when fixed.

## 13. KNOWN BLOCKERS
None blocking. Admin auth is solved (§11).

## 14. DEFERRED RELEASE ISSUES
- `waywardStage.spec.ts:14` (guardian parry) fails on slow CI runners — timing
  sensitive, passes locally. Deferred to Phase F.
- `adminLiveModel.test.ts` asserts a source string; brittle. Deferred.

## 15. TEMPORARY DEV-ONLY STATE THAT MUST NOT SHIP
- `scripts/goldline-admin-dev-setup.ts` is DEV/TEST ONLY. It refuses to run
  without `GOLDLINE_ADMIN_DEV_SETUP=true` and refuses any non-localhost
  `DATABASE_URL`. It must never be added to the production start path.
- No secrets are committed; all credentials come from the environment.

## 16. VERIFICATION STANDARD (learned the hard way)
A build that compiles proves nothing about whether a component still mounts.
Source-text assertions are not mount proof — the ambient tests passed while
Lantern City was blank. Visual slices require BOTH mount proof (component
renders, expected DOM, no exception) AND behaviour/style proof.
