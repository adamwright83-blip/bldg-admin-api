# GOLDLINE V1 WAVE — CURSOR HANDOFF

Practical resume file. No chat history required.

## 1. AUTHORITATIVE MAIN SHA
`875631fb8ead2a558d6c22a3c983dea374625373`

PR #115 merged into `main` at merge commit:
`bd9220158d15390640481a8bf4c55b01a4ca2c7c`

The post-merge direct-to-main safety fix is:
`875631fb8ead2a558d6c22a3c983dea374625373`

## 2. BRANCH POLICY
Adam explicitly ended normal feature-branch development for now.

**WORK DIRECTLY ON `main` unless Adam explicitly reverses this policy.**

Do not create a new `claude/*`, `fix/*`, `feature/*`, or other development branch merely because that is the usual workflow.

## 3. CURRENT PHASE + SLICE
The 30-slice Goldline v1 One World wave is merged.

PR #115 exact verified head before merge:
`e15ccc18f6950a882d5a1d63befc386b807b48d4`

Final exact-head release gates on that head:
- Fast Goldline smoke — PASS
- DayForge release gates — PASS
- Goldline mobile regression / pixel-class-layout — PASS
- Vercel preview — PASS

## 4. WHAT WAS JUST COMPLETED
Full v1 wave pass. Highlights:
- Slice 0: upstream table ownership traced; committed dev harness; DB dropped and rebuilt from scripts alone.
- Blank Lantern City and Tower Wars React #310 route crashes were found, fixed, and permanently browser-gated.
- Lantern City became world-first rather than report-first.
- Tower Wars gained anticipation, impact, hit-stop, camera reaction and settle.
- Guardian readability, territory pressure, Gold Line hierarchy, campaign continuity, recovery/follow-up truth and Driver→Admin continuity were proven or implemented.
- Regeneration now exists and is driven only by legitimate real-work evidence.
- Lantern City map now uses a permanent dark strategic grade; the map is substrate, not the star.
- Same physical place no longer renders competing building + lantern primaries.
- Guardian is a compact readable atlas token that grows on notice/encounter.
- Product UI now says `ONE PHYSICAL PLACE`, not `ONE SAVE FILE`.
- Atmosphere badge is `LA WORLD · LIVE · {temperature}`; literal day/night no longer contradicts the permanent strategic ground treatment.
- A deterministic seeded Lantern City mount gate now runs in the correct seeded fast-smoke suite and is falsified against the prior blank-city export regression.
- Wayward CI timing failures were traced to real test/runtime construction issues and the final exact head passed all three release gates.

## 5. WHAT IS BEING WORKED ON RIGHT NOW
**FIELD READINESS, not another feature wave.**

The highest-priority real production blocker is CleanCloud screenshot import on Driver.

Adam reproduced this on his actual phone on 2026-09-02:

1. Driver main surface did not show an obvious day-start CleanCloud import CTA.
2. He found it under Field Utilities → CLEAN CLOUD WORK → IMPORT CLEAN CLOUD DAY.
3. He selected a real CleanCloud screenshot.
4. Goldline returned:

   `No jobs could be read from those screenshots. Add one by hand instead.`

Manual retyping is NOT an acceptable substitute for the normal daily route-import workflow.

## 6. CLEAN CLOUD WORK ALREADY PUSHED — DO NOT LOSE IT
PR #115 contains the beginning of the CleanCloud image-quality repair:

- `client/src/components/driver/screenshotTiling.ts`
- `client/src/components/driver/screenshotTiling.test.ts`

The helper preserves native screenshot text by cutting tall phone screenshots into overlapping horizontal bands below the vision provider's long-edge resize threshold.

Important: this work was **not yet wired into `AddExternalWorkSheet.tsx`** when #115 merged.

The current importer still calls `readAsDataUrl` and sends the original data URLs directly to `props.onExtract`.

Therefore the tiling helper being present on main does NOT mean the production CleanCloud importer is fixed.

Also account for overlap: the same CleanCloud row may appear in adjacent bands. The final import path must prevent duplicate operational jobs from the overlapping tiles while preserving the operator review step.

## 7. CLEAN CLOUD REQUIRED NEXT ACTIONS
Work directly on `main`.

1. Reproduce/trace the real path:
   file selection → data URL → image preparation → `system.externalOrders.extractFromScreenshots` → tenant context → `extractExternalDayFromScreenshots` → `invokeLLM` → provider response → JSON/schema parsing → normalized jobs → review sheet.
2. Wire `prepareScreenshotsForExtraction` into `AddExternalWorkSheet` BEFORE calling `onExtract`.
3. Confirm or reject the long-edge/downscale hypothesis using a real provider call. Do not promote the hypothesis to root cause merely because the geometry is plausible.
4. Distinguish technical extraction failure from genuinely unreadable/empty screenshots. Do NOT tell the operator a screenshot contained no jobs if the model/provider/parser actually failed.
5. Keep manual entry as a separate legitimate path for phone/text/DM work, not as the normal fallback for a broken screenshot importer.
6. Restore a prominent Driver/day-start doorway such as `IMPORT TODAY'S CLEAN CLOUD ROUTE`; Field Console may remain a secondary doorway.
7. Prove realistic PNG/JPEG/high-resolution phone screenshots become reviewable jobs end-to-end.
8. Prove overlap does not create duplicate jobs after confirmation/retry/reload.
9. Commit and push the fix DIRECTLY TO `main`.
10. Verify the normal production deployment path picked up the exact main SHA.

## 8. KNOWN REVIEW DEBT FROM PR #115
Five inline review findings remained unresolved when #115 merged. Treat them as real debt, especially the P1s; do not simply resolve the GitHub threads without correcting the code.

### P1 — canonical building identity for regeneration evidence
`server/canonicalBuilding/canonicalBuildingService.ts`

`loadDatedPickupEvidence` currently groups by raw `operationsEvents.buildingSlug`. It must instead use the same canonical physical-building identity contract used elsewhere, taking the joined order address into account so aliases/stale slugs cannot heal the wrong building or omit legitimate healing.

### P1 — business-timezone pickup date
`client/src/components/admin/control-room/facadeRegeneration.ts`

`datedCollectedOrders` currently does `actualEventTimestamp.slice(0, 10)`, which is UTC date. Convert the real pickup instant into the configured business/dashboard timezone (`America/Los_Angeles` default) before comparing against settlement business dates. Same-business-day work must not heal that same day's scar.

### P2 — compressed patina must visibly regenerate
`client/src/components/admin/control-room/FacadeScarLayer.tsx`

Regeneration is spent oldest-first, but compressed old history currently renders patina without applying the corresponding closure. Propagate regeneration into patina so old healing is not spent invisibly.

### P2 — territory interaction targets real DOM
`client/src/components/goldline/goldline-territories.css`

The `.gl-territory-shape` interaction styles target no rendered element. Wire hover/focus/selected ground feedback to the actual territory representation without placing a giant pointer-blocking layer over the city's real objects. Pointer and keyboard notice should share the same state.

### P2 — localhost fixture guard
`scripts/goldline-admin-dev-setup.ts`

FIXED DIRECTLY ON MAIN in `875631fb8ead2a558d6c22a3c983dea374625373`.

The guard now parses `DATABASE_URL` and permits only exact `localhost`, `127.0.0.1`, or `::1` hostnames instead of substring matching.

## 9. IMPORTANT FILES CURRENTLY IN PLAY
- `client/src/components/driver/AddExternalWorkSheet.tsx`
- `client/src/components/driver/screenshotTiling.ts`
- `client/src/components/driver/screenshotTiling.test.ts`
- `server/externalOrders/externalOrderExtraction.ts`
- `server/externalOrders/externalOrderRouter.ts`
- `client/src/components/admin/control-room/LanternCityAtlas.tsx`
- `client/src/components/admin/control-room/FacadeScarLayer.tsx`
- `client/src/components/admin/control-room/facadeRegeneration.ts`
- `client/src/components/goldline/TerritoryWorldLayer.tsx`
- `server/canonicalBuilding/canonicalBuildingService.ts`

## 10. EXISTING SYSTEMS — REUSE, DO NOT REBUILD
Traced live (mount/import/runtime), all already wired:
- Territories + Guardians: `TerritoryWorldLayer` renders inside `LanternCityAtlas`; calls `trpc.system.goldlineWorld.territories` and `recordGuardianDefeat`; uses `@shared/goldlineGuardians`.
- Tower Wars: `TowerWars.tsx` uses `trpc.system.towerWars.*` + `@shared/towerWars`.
- Transitions: `WorldTransitionProvider` mounts in `AdminHostApp`, consumed by `CityTowerButton` and `TowerWars`.
- Recovery: `WorldEntityInspector` (inside the Atlas) uses `trpc.system.churnRadar.interventions`; deliberately has NO control that marks a customer recovered.
- OPUS weapon: fully wired via `buildingArt.ts` (geometry sourced from `opusWeaponGeometry.ts`).

**TABLE OWNERSHIP (traced, do not "fix" by migrating):**
`bldg_users` and `service_requests` belong to the upstream resident app (app.bldg.chat). `scripts/migrate.mjs` is the production bootstrap and never references them; no `drizzle/*.sql` creates them (0015 creates the different `vendor_peer_service_requests`); `service_requests` entered via "Add Requests tab: coordinated requests from resident app"; `check-bldg-users-columns.mjs` exists to INSPECT upstream shape. Production expects them to preexist. Do NOT add them to the production migration runner.

## 11. TRUTH / FIREWALL INVARIANTS
- `gameState = f(gameplay, evidence)`; `businessTruth = f(evidence only)`.
- GPS proves position/proximity/arrival only — never conversation/sale/recovery.
- attempt != contact != recovery != win.
- Guardian defeat / Tower War victory cannot alter business truth.
- Regeneration needs BOTH: collected-or-beyond order status (proves it happened) AND a completed `pickup_completed.actualEventTimestamp` (proves WHEN). No trustworthy timestamp = no healing credit, though the collection remains legitimate business truth.

## 12. AUTH / LOCAL HARNESS METHOD
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
Bootstrap:
```
pnpm db:dayforge:release
GOLDLINE_ADMIN_DEV_SETUP=true pnpm goldline:admin:dev-setup
pnpm tsx scripts/goldline-living-world-proof-seed.ts
VITE_GOLDLINE_TEST_HARNESS=1 pnpm vite build
pnpm esbuild server/_core/index.ts --platform=node --packages=external \
  --bundle --format=esm --outdir=dist
NODE_ENV=ci PORT=4174 node dist/index.js
```
Admin login:
```
POST /api/auth/login  {"password": "<APP_SHARED_API_SECRET>", "role": "admin"}
```

## 13. FAST TEST COMMANDS
```
pnpm vitest run client/src/components/admin
pnpm vitest run client/src/components/admin/control-room/facadeRegeneration.test.ts
pnpm vitest run client/src/components/driver/screenshotTiling.test.ts
pnpm exec playwright test --config playwright.goldline.config.ts
pnpm exec playwright test --config playwright.goldline-smoke.config.ts e2e/goldline-smoke/lanternCityMount.spec.ts
```

## 14. HUMAN FIELD TEST STILL REQUIRED
After the CleanCloud route import is actually working in production, Adam should perform the real-world field test from his phone against production `main`.

Machine-observable timestamps should come from telemetry; Adam's manual notes should focus on subjective failures such as:
- why am I doing this?
- did it feel like a game or form filling?
- was arrival/consequence exciting and clear?
- did Driver and Admin unmistakably feel like the same world?
- where did the illusion break?
- did the end of day feel emotionally complete?
- did the next session remember what mattered?

Do not write the next broad correction wave until the real-world field evidence exists.

## 15. TEMPORARY DEV-ONLY STATE THAT MUST NOT SHIP
- `scripts/goldline-admin-dev-setup.ts` is DEV/TEST ONLY. It refuses to run without `GOLDLINE_ADMIN_DEV_SETUP=true` and now parses/validates the exact loopback database hostname. It must never be added to the production start path.
- No secrets are committed; all credentials come from the environment.

## 16. VERIFICATION STANDARD
A build that compiles proves nothing about whether a component still mounts.
Source-text assertions are not mount proof. Visual slices require BOTH mount proof (component renders, expected DOM, no exception) AND behaviour/style proof.

Current process law: repository reality beats memory. Trace assertion → state → fixture/input → implementation before claiming root cause.
