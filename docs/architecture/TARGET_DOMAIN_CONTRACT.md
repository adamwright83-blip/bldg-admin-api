# JOYSTICK target domain contract

This is the **target ownership contract**. It does not claim that future folders already exist.

The physical repository moves later. Current paths are documented separately in `CURRENT_CODEBASE_FINDER.md`.

## Core rule

For every important fact or action:

**one owning domain → one legal write path → explicit read surface → explicit evidence/provenance → explicit downstream consumers**

Strengthen existing mechanisms before creating new ones.

## Approved ownership direction

| Domain concept | Existing implementation to strengthen | Owns |
|---|---|---|
| Platform | `server/_core/`, `server/db.ts`, `server/durableExecution/` | request/principal context, shared infrastructure |
| Laundry | current order/intake/ops code | order lifecycle and laundry operations |
| Money | `server/money/`, `server/authority/paymentAdmission.ts`, `server/analytics/canonicalRevenue.ts` | admitted payment truth and economic reads |
| Geography | `server/geography/geographicTruthService.ts` | canonical geographic entity/location/territory answers |
| Commercial | `server/commercialMissions/`, `server/commercialPipeline/` | accounts, visits, outcomes, pipeline, attribution |
| Planning | Mission Director + Day Director + Day Line | work candidates, deterministic ranking, commitments, Day Line projection |
| Operator | `server/persistentOperator/` | goals, decisions, outcomes, learning; proposes work but does not become a second ranker |
| Actions | existing agent tool registry + Brain V2 authority/gateway | one eventual authority/execution contract without breaking resident tool compatibility |
| Claire | `server/claire/` | conversations and agent-specific state; consumes domain ports instead of inventing business truth |
| Game | existing Goldline/Lantern/Narrator systems | fiction/progression/projections from admitted business truth |
| SaaS | `server/saas/`, `tenantIdentity.ts` | tenants, membership, entitlements |
| HELD | `server/procurement/` | bounded procurement context |
| Company | `server/president/`, `server/mitch/` | founder/company automation, not customer business truth |

## Locked architecture decisions

1. `authority_receipts` remains the proof ledger. Do not create another receipt ledger.
2. `default` remains a legitimate Laundry Farm tenant id until deliberately migrated. New implicit fallback to it is forbidden.
3. Mission Director remains the sole deterministic ranker. Persistent Operator may propose candidates.
4. Business domains decide truth. An event/outbox mechanism may transport admitted facts later; it may not become a second truth authority.
5. Game and Operator are downstream consumers of admitted business facts. Producers should not grow new inline dependencies on them.
6. Claire moves toward explicit read ports. New raw DB/schema coupling is forbidden.
7. Resident agent tool names/response shapes are an external production contract.
8. Geography work starts from `geographicTruthService.ts`; Money work starts from existing Money/analytics/authority code.
9. Physical folder movement is a late cleanup step, not the mechanism by which ownership is created.
10. Every architecture PR must say which existing file/mechanism it strengthens.

## Initial ratchet

`docs/architecture/domain-boundaries.json` and `scripts/check-domain-boundaries.mjs` enforce **no new** high-risk import-direction violations.

Existing debt is intentionally tolerated until a later PR removes it. The ratchet must not be weakened merely to land a feature; an exception requires an explicit architecture-contract change.
