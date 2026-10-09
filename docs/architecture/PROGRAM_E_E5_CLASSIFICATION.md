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

## E5b — Driver projection versus real field execution

Prerequisite E5a merged as #515, verified main `d602fa6058969ca7ee7a28d7e2202b9b09531eb9`; all four gates, TypeScript, 57 Orders/SaaS assertions and matched 4/4 real-MySQL assertions passed. Hosted fast contracts passed; world, legacy and mobile retain exactly the recovery baseline failure identities.

Classified source and source-contract tests before relocation. The per-file map in `evidence/program-e-e5b-files.json` records responsibilities, writes, dependencies and test coverage. The three different lanes are deliberately separate:

- Experience Driver owns only visual nodes, progression reads and `missionMutations` interpretation. `verifiedAt` remains NULL for visual recovery intent. `missionMutationService` never mutates native Orders, Payment or Commercial outcomes.
- Field outreach owns real operator-first phone workflows, pinned contacts, membership, verified outgoing caller ID, provider legs and CAS/recovery. It calls the existing Commercial outcome service. No provider call was executed during validation.
- Field Scout is an application orchestrator, not game authority: provider discovery → persisted territory scan → canonical Commercial mission creation → derived Scout/node publication. Real mission authority remains in `commercialMissionStore`. Existing atomicity and every persisted identifier stay unchanged.
- Composition owns the existing mixed public router. Procedure names/input/auth scopes remain byte-equivalent after import resolution; no new router or endpoint is invented.
- Lantern City's business overview reads owning-domain/customer/financial projections. Its collected-revenue contract remains canonical admitted economics, and unavailable is UNKNOWN rather than zero. Public `businessWorld` API and response symbols remain compatibility contracts; the source directory/files now identify it as overview composition.

No protected implementation/test file is a consumer requiring edits in this slice. Old API/event/table names are preserved. The mobile workflow selector must follow the split lanes so future field/game changes keep their coverage. Pre-move broader selection: 32 files, 188 passes, exactly two known Tower Wars baseline failures.

E5b local validation on committed source: all four architecture gates pass, 200 assertions pass across 34 files with the same two Tower Wars baseline failures (expanded selection adds schema-path and Commercial reader contracts). Real MySQL mission-interpretation persistence is 4/4 on exact clean pre-E and 4/4 after relocation. An initial pre-move invocation overlapped edits and is excluded; it is not used as baseline evidence. Broad baseline 188/2 and expanded repair 200/2 are distinct selections, not an identical full-suite comparison. The rule destinations include Experience so future moves cannot evade Commercial/Money/Geography downstream restrictions.

## E5c — physical evidence, promise authority and artwork split

Prerequisite #516 merged at verified main `69aa6777bc912fbe259b5dd2d3cf166a78dbc986`; its tree equals the validated PR head. Every hosted check passed except the exact previously reproduced world seven, protected legacy twenty and identical bundle failure. No new regression was folded into baseline.

| Actual source responsibility | Final owner / files | Reads, writes and authority |
|---|---|---|
| Physical identity matching and alias normalization | Geography `physicalIdentityResolver.ts` + existing test | Pure identity resolution from source clues; no native customer/payment mutation |
| Physical identity/alias/binding/evidence persistence | Geography `physicalEntityApplication.ts` | Exact existing forge helper bodies; writes only physical entities, aliases, bindings and source-evidence items; source labels/identity rules unchanged |
| Provisional display entity materialization | Geography `provisionalPropertyEntities.ts` | Exact existing city helper body; unique normalized alias transaction/race recovery retained; existing geocoded customers are inputs, not newly created customers |
| Official property-site evidence transport | Integrations `propertyResearch/officialPropertyResearch.ts` + test | Same bounded HTML extraction, DNS/private-target rejection and source excerpts; does not admit native business truth |
| Evidence schema / pure tower contract / prompt | Shared `propertyEvidence.ts`, `towerForgeContracts.ts`, `towerGenerationPrompt.ts` | Read-only pure kernels consumed by Field and Experience; no dependency on a server business implementation, no duplicated schema/model or compatibility re-export |
| Artwork provider and existing contract assertions | Experience `goldline/builder/towerImageProvider.ts`, `towerForgeContracts.test.ts` | Same configured/unconfigured/proof-only provider selection and production rejection; tests retain every original expectation |
| Journal property discovery + forge application | Field `propertyDiscovery/towerForgeWorkflow.ts` | Orchestrates owned Geography persistence, canonical Commercial mission creation, shared artwork kernel/provider and derived publication. No native Orders/Payment mutation or replacement Commercial conversion owner |
| Real permission-backed promises and activation | Planning `dayDirector/towerWarsPromiseService.ts` + existing promise tests | Exact four existing function bodies; Day Director commitment insert lives with Planning. Returns `createdRevenue:false`, `attackCreated:false`; game service consumes the promise read and router calls the real application |

The game Tower Wars calculation no longer contains raw promise/Day Director writes. The city read composition no longer contains physical entity/alias writes. Forge orchestration no longer owns raw physical identity/alias/binding/evidence persistence. Existing runtime call order, DB predicates/transactions, error paths, state transitions, source classifications, API shapes, idempotency keys and production provider guards are retained. No production provider operation was executed.

Baseline before extraction: Phase A real journal → city projection and captured-payment → Tower Wars integration pass 14/14 on two files with `TZ=UTC`, disposable MySQL and explicit `GOLDLINE_PROOF_MODE=1`. Without that required proof adapter, journal extraction honestly returns empty fallback and the Phase A fixture does not establish its claims; that unsupported invocation is not used as baseline evidence.

This slice prioritizes authority splits. Remaining Goldline world, Lantern City and Tower Wars mechanical relocation is still pending and must be listed in the continuation handoff; E5/E8 are not certified.
