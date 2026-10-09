# Program E: Slice E6 Classification — Legacy DayForge Quarantine

This document classifies the eight historical `legacyDayforge*` roots in `server/` before consolidation into `server/legacy/dayforge/`.

## 1. Architectural Role and Non-Authority Invariants
- The canonical product is **JOYSTICK** and today's execution surface is **Day Line**.
- Legacy DayForge code is **quarantined compatibility only**. It has no authority over canonical business facts:
  - Cannot create or modify Orders lifecycle state (owned by `server/domains/orders/`).
  - Cannot admit Payments (owned by `server/domains/payment/`).
  - Cannot manufacture Commercial truth (owned by `server/domains/commercial/`).
  - Cannot alter live Planning or Agent state.
- All deployed database tables (`legacy_dayforge_*`, etc.), column names, environment variable names (`DAYFORGE_*`), and API routes are strictly preserved for backward compatibility.

## 2. Classification of Modules

| Legacy Module | Original Location | Target Location | Description & Invariants |
|---|---|---|---|
| Coaching | `server/legacyDayforgeCoaching/` | `server/legacy/dayforge/coaching/` | Historical coaching policy, artifacts, store, and runtime. Purely advisory; no native business mutations. |
| Demo | `server/legacyDayforgeDemo/` | `server/legacy/dayforge/demo/` | Disposable demo tenant fixtures, seeding, reset, and verification. Narrow architectural exemptions for disposable test data only. |
| Events | `server/legacyDayforgeEvents/` | `server/legacy/dayforge/events/` | Historical product event store and timeline projection (`legacyDayforgeProductEvents`, `legacyDayforgeAuditEvents`). Appended for legacy audit/timeline telemetry; not canonical financial state. |
| Proof | `server/legacyDayforgeProof/` | `server/legacy/dayforge/proof/` | Legacy proof dashboard metrics and conversions projection router. Read-only projection. |
| Release | `server/legacyDayforgeRelease/` | `server/legacy/dayforge/release/` | Historical DayForge release migration applicator (`applyReleaseMigrations.ts`), release harness, and journey integration test suites. |
| Retention | `server/legacyDayforgeRetention/` | `server/legacy/dayforge/retention/` | Legacy customer retention evaluation rules and router. |
| Security | `server/legacyDayforgeSecurity/` | `server/legacy/dayforge/security/` | Legacy TRPC origin/CSRF security assertion guard (`assertTrpcMutationOrigin`). |
| Today | `server/legacyDayforgeToday/` | `server/legacy/dayforge/today/` | Legacy driver day items list and sort service/router (`listLegacyDayforgeToday`). |

## 3. Preserved External Contracts
1. **Database Schema:** Tables `legacy_dayforge_product_events`, `legacy_dayforge_audit_events`, `legacy_dayforge_saas_tenants`, etc., remain untouched in `drizzle/schema.ts`.
2. **Environment Variables:** `DAYFORGE_RELEASE_DB`, `DAYFORGE_ALLOWED_ORIGINS`, `DAYFORGE_DEMO_ENABLED`, etc., remain unchanged.
3. **Public TRPC Procedures:** Procedure names (`legacyDayforgeTenantMemberProcedure`, etc.) in `server/_core/trpc.ts` remain unchanged.
4. **Tooling & CI Scripts:** Scripts in `package.json` (`test:legacy-dayforge:release`, `db:legacy-dayforge:release`, etc.), `tsconfig.legacy-dayforge-release.json`, and `.github/workflows/` updated to reference new physical paths.
