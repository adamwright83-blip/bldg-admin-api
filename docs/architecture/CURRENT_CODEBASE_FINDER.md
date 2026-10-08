# JOYSTICK current codebase finder

This file is a **finder for the repository as it exists today**. It is not a future architecture plan.

Verified against `main@5ec1357a7ec13c341047e8ef056abce333a669fa` on 2026-10-05 after Gate A (#395) merged. Code paths below reflect that current main.

Code wins if this file becomes stale.

## Core locations

| Concept | Current implementation |
|---|---|
| Platform HTTP/tRPC/auth | `server/_core/`, `server/routers.ts` |
| Main DB access | `server/db.ts`, `drizzle/schema.ts` |
| Authority receipts | `server/platform/authority/authorityReceipt.ts` |
| Native payment admission | `server/domains/payment/paymentAdmission.ts` |
| CleanCloud integration | `server/integrations/cleancloud/` |
| Canonical revenue reconciliation | `server/analytics/canonicalRevenue.ts`, `server/analytics/paidOrderLedger.ts` |
| Money projection | `server/money/moneyProjectionService.ts` |
| Geography truth | `server/geography/geographicTruthService.ts` |
| Customer/order geographic truth | `server/geography/customerOrderTruth.ts` |
| Commercial pipeline | `server/domains/commercial/` |
| Commercial missions | `server/commercialMissions/` |
| Mission Director | `server/planning/missionDirector/` |
| Day Director | `server/planning/dayDirector/` |
| Current Day Line | `server/planning/dayline/` |
| Weekly planning | `server/claire/weeklyMission/` |
| Persistent Operator | `server/agents/persistentOperator/` |
| Operator Representative | `server/agents/operatorRepresentative/` |
| Daphne | `server/agents/daphne/` |
| Agent tools/runtime | `server/agents/` |
| Claire | `server/claire/` |
| Brain V2 action gateway | `server/claire/brain/actions/gateway.ts` |
| Brain V2 authority grants | `server/claire/brain/executive/grants.ts` |
| Goldline world | `server/goldlineWorld/` |
| Lantern City server reads | `server/lanternCity/` |
| Live Lantern City client default | `client/src/components/admin/control-room/LanternCityIslands/` |
| SaaS tenancy | `server/saas/`, `server/platform/tenancy/tenantIdentity.ts` |
| HELD procurement | `server/procurement/` |
| President | `server/president/` |
| Mitch | `server/mitch/` |
| Shared durable worker | `server/platform/execution/worker.ts` |
| Production migration bootstrap | `scripts/migrate.mjs` |
| Existing architecture checks | `scripts/check-*.mjs`, `.github/workflows/` |

## Important current-reality warnings

- `default` is the real Laundry Farm tenant id in current production semantics. The bug class is **implicit fallback to default**, not the existence of that tenant.
- `legacyDayforge*` names are not proof that code is dead. Several live tenancy and today-work paths still use those names.
- `CLAUDE.md` is stale about Lantern City. The default admin Lantern City scene is Islands; V6 is selected only by `?scene=v6`.
- `authority_receipts` already exists. Do not create a second receipt ledger.
- `server/money/` already exists. Strengthen it rather than creating another Money implementation.
- `server/geography/geographicTruthService.ts` already exists. Strengthen it rather than creating another Places implementation.
- The resident app is an external consumer of named tools in `server/agents/`; tool names and response shapes are a compatibility contract.

## How to use this file

When asked to change a concept, start at the current implementation above. Then read `TARGET_DOMAIN_CONTRACT.md` for the intended ownership rule.

Do not infer a target folder from the target contract. The target contract describes ownership and legal dependencies; this file describes where the code actually is.
