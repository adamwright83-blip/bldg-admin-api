# Program E5 — classified physical ownership

## Entry gate

E0–E4 recovery passed on verified main `53fe3b0b5218ff5a836f47948d0a17f6ed62fac8`, merged repair/audit PR #514. Its tree matches validated head `a96c65fe`; final hosted run 37872555538 passes fast contracts and reproduces precisely the seven pre-E world-browser failures. The protected 20 Claire assertions, CSV assertion, bundle-budget failure, four Program D fixtures and separately disclosed authority/Planning/Operator fixtures remain baseline exceptions. Unrun dependent browser cases remain unavailable. Recovery tags were reverified after merge. E8 has not run.

## E5a — Driver Orders application boundary

Source inspected before movement. These files belong to Orders, with Driver membership/context admission. They are not Driver game progression. Public field router names and inputs remain unchanged.

| Source under `server/joystick/` | Responsibility / writes | Evidence and dependencies | Consumers / final owner | Required tests |
|---|---|---|---|---|
| `driverOrderService.ts` | Membership-scoped listing and Driver lifecycle requests; delegates all native transitions to `transitionNativeOrderStatus` | Explicit signed-in tenant, canonical Orders transition, matching Payment admission at delivery fence | Field router; `server/domains/orders/driver/` | Driver procedure; real MySQL Orders convergence |
| `driverOrderStore.ts` | Read-only status/date/order queries; no native mutation | Orders rows and established legacy NULL/blank visibility compatibility | Driver application service; Orders driver adapter | Procedure filters; convergence rejects cross-tenant/native authority bypass |
| `driverOrderTenant.ts` | Legacy visibility helper; does not create ownership or admit Payment | Existing compatibility mapping is unchanged; historical native admission still uses canonical tenant fence | Driver store/service/effects; Orders adapter | Procedure tenant isolation |
| `driverOrderEffects.ts` | Post-transition operational events, optional pickup SMS and derived war action | Owning transition already succeeded; event dedupe and explicit caller tenant | Driver application service; Orders adapter | Effects + procedure idempotency + MySQL race |
| `driverOrderRouter.ts` | Membership/role/session admission and tRPC wiring | Authenticated membership, shared-password SaaS fence; request cannot supply tenant | `server/field/fieldRouter.ts`; Orders application interface | Procedure public route assertions |
| `driverOrderEffects.test.ts` | Post-transition effect/tenant contract | Fake SMS/war/DB, no live provider | Colocated Orders adapter contract | Exact existing two assertions |
| `driverOrderProcedure.test.ts` | Public caller and isolation contract | Existing admission mocks, canonical lifecycle seam | Colocated Orders adapter contract | Exact existing assertions + appRouter calls |

Old → new mapping: every listed filename moves from `server/joystick/` to `server/domains/orders/driver/`. No module duplication or persisted contract rename. External consumers are the field router, Orders convergence integration and SaaS actor-authority source assertion. No active protected implementation/test file intersects this slice; protected router/schema registrations are untouched. Historical Program A/D evidence retains its original paths.

## Next mixed-source findings (not a completed migration)

- VERIFIED: `driverGameWorld/missionMutationService.ts` inserts only `missionMutations`, derived from world evidence; it does not create customers, orders, Payment or Commercial conversion. This is Experience interpretation.
- VERIFIED: `businessWorld/businessWorldService.ts` performs reads and composes canonical revenue, customer assets, memberships, territory signals and capabilities. This is a downstream business overview projection, not a second business authority.
- VERIFIED: `worldForge/officialPropertyResearch.ts` fetches bounded public official-site evidence with DNS/private-target protection and source excerpts. Separate integration ownership from artwork/builder orchestration.
- UNKNOWN: final placement of remaining mixed files requires their own source/dependency/write classification before movement. Directory naming alone does not establish ownership.
