# DayForge PR #10 feature inventory

## Archive record

- Source PR: `#10` (`gpt56/dayforge-mission-foundation`)
- Source remote HEAD verified immediately before archival: `ba9bf444819a6be00702d5e38f791a0f29ece507`
- Permanent archival branch: `archive/dayforge-pr10-foundation-2026-07-12`
- Archived remote commit: `ba9bf444819a6be00702d5e38f791a0f29ece507`
- Archive verification: `git ls-remote --heads origin archive/dayforge-pr10-foundation-2026-07-12` returned the same SHA as the source branch.

The archive is the complete preservation copy. Production extraction branches intentionally carry only reviewed production-bound code. The locked landing-page implementation was not changed by PR #10 and must not be deleted or overwritten during extraction.

## Classification legend

- **Production-bound**: extract after adapting it to persisted, tenant-scoped production data.
- **Reusable experimental IP**: retain in the archive and reuse selectively; do not ship as authoritative production behavior.
- **Superseded**: the implementation approach is replaced, while the concept and history remain archived.
- **Standalone candidate**: plausible product IP that could become a separate module or SaaS offering.

## Complete file inventory

| PR #10 file                                                                     | Contents and feature coverage                                                                   | Classification                                                                                     | Extraction destination                           |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `.github/workflows/dayforge-foundation.yml`                                     | Focused DayForge typecheck, tests, build, and diagnostic artifacts                              | Reusable experimental IP; superseded by extraction-specific CI                                     | PR A-F CI as applicable                          |
| `client/src/App.tsx`                                                            | Routes for territory preview, phone mission, proposal, and public previews                      | Reusable experimental IP; route additions superseded until authenticated production surfaces exist | PRs B, D, E                                      |
| `client/src/components/boreslay-rally/ProductionBoreslayMissionAdapter.ts`      | Async mission load/start/complete/abandon/unlock adapter contract                               | Production-bound after server idempotency and Rally integration                                    | PR C                                             |
| `client/src/components/boreslay-rally/ProductionBoreslayMissionAdapter.test.ts` | Client adapter concurrency and completion tests                                                 | Production-bound test IP                                                                           | PR C                                             |
| `client/src/components/boreslay-rally/TrpcBoreslayMissionTransport.ts`          | Transport facade from BORESLAY to mission queries/transitions                                   | Production-bound after it uses canonical mission IDs and server-derived game authority             | PR C                                             |
| `client/src/components/boreslay-rally/TrpcBoreslayMissionTransport.test.ts`     | Transport contract tests                                                                        | Production-bound test IP                                                                           | PR C                                             |
| `client/src/pages/TerritoryPreview.tsx`                                         | Address entry, scan state, ranked list, visual map, mission preview, phone handoff              | Reusable experimental IP; current demo/localStorage handoff superseded                             | PR B                                             |
| `client/src/pages/territory-preview.css`                                        | Territory preview visual language and responsive layout                                         | Reusable experimental IP                                                                           | PR B                                             |
| `client/src/pages/CommercialSalesMission.tsx`                                   | Briefing, preparation, print stop, destination, talk track, notes, outcomes                     | Reusable experimental IP; localStorage state and forced transitions superseded                     | PR D                                             |
| `client/src/pages/commercial-sales-mission.css`                                 | Phone-shell and field-mission presentation                                                      | Reusable experimental IP                                                                           | PR D                                             |
| `client/src/pages/CommercialProposalPrint.tsx`                                  | Print-ready proposal view with browser Print/Save PDF                                           | Production-bound UI concept; hard-coded operator and localStorage inputs superseded                | PR E                                             |
| `client/src/pages/commercial-proposal-print.css`                                | Print and proposal layout                                                                       | Reusable experimental IP                                                                           | PR E                                             |
| `server/_core/systemRouter.ts`                                                  | Registers commercial mission and Churn Radar routers                                            | Production-bound only with extracted, authorized routers                                           | PRs A, F                                         |
| `server/commercialMissions/commercialMissionRouter.ts`                          | Demo preview plus admin mission CRUD/transition transport                                       | Superseded by normalized mission APIs; useful input/response concepts retained                     | PR A, then PR B                                  |
| `server/commercialMissions/opsTaskCommercialMissionStore.ts`                    | Encodes full mission into `ops_tasks.metadataJson` and records task events                      | Superseded as authoritative persistence; ops-task bridge remains production-bound                  | PR A                                             |
| `server/commercialMissions/opsTaskCommercialMissionStore.test.ts`               | Metadata encoding and task-status mapping tests                                                 | Reusable experimental test IP                                                                      | PR A bridge tests                                |
| `server/territory/territoryDiscovery.ts`                                        | Provider interfaces, geocoding/search pipeline, normalization, deduplication, distance, ranking | Production-bound                                                                                   | PR B                                             |
| `server/territory/territoryDiscovery.test.ts`                                   | Provider pipeline and deduplication tests                                                       | Production-bound test IP                                                                           | PR B                                             |
| `server/territory/demoTerritoryProvider.ts`                                     | Deterministic Westview/Harbor/Glow/Iron Tide provider                                           | Reusable experimental IP; never a production provider                                              | Archive and explicit demo fixtures in PR B tests |
| `server/territory/scoreLaundryOpportunity.ts`                                   | Laundry demand, capacity, route, contactability, confidence, value, reasons, and risks scoring  | Production-bound after real tenant inputs and evidence provenance                                  | PR B                                             |
| `server/territory/scoreLaundryOpportunity.test.ts`                              | Scoring and explanation tests                                                                   | Production-bound test IP                                                                           | PR B                                             |
| `server/churnRadar/scoreCustomerChurn.ts`                                       | Cadence, lateness, value, volume decline, history, and unresolved-issue risk scoring            | Production-bound after real order/customer adapters                                                | PR F                                             |
| `server/churnRadar/scoreCustomerChurn.test.ts`                                  | Churn-risk threshold tests                                                                      | Production-bound test IP                                                                           | PR F                                             |
| `server/churnRadar/buildWinBackDraft.ts`                                        | Fact-grounded, human-approval-required win-back draft builder                                   | Production-bound after existing outreach approval integration                                      | PR F                                             |
| `server/churnRadar/buildWinBackDraft.test.ts`                                   | Grounding and no-invented-discount tests                                                        | Production-bound test IP                                                                           | PR F                                             |
| `server/churnRadar/churnRadarRouter.ts`                                         | Input-driven score and draft endpoints                                                          | Superseded by tenant-data-backed intervention APIs                                                 | PR F                                             |
| `shared/commercialMission.ts`                                                   | Mission statuses, canonical Mission 042 fixture, opportunity fixture, continuity surface        | Production-bound contract; demo fixtures remain experimental                                       | PR A                                             |
| `shared/commercialMission.test.ts`                                              | Code formatting and cross-surface continuity tests                                              | Production-bound invariant tests                                                                   | PR A                                             |
| `shared/commercialMissionFactory.ts`                                            | Opportunity-to-mission conversion                                                               | Production-bound after persisted opportunity/account inputs replace fabricated IDs/details         | PRs A, B                                         |
| `shared/commercialMissionLifecycle.ts`                                          | Allowed transitions and lifecycle event mapping                                                 | Production-bound                                                                                   | PR A                                             |
| `shared/commercialMissionLifecycle.test.ts`                                     | Transition and event tests                                                                      | Production-bound                                                                                   | PR A                                             |
| `shared/commercialProposal.ts`                                                  | Tenant/store profile plus commercial proposal generation model                                  | Production-bound                                                                                   | PR E                                             |
| `shared/commercialProposal.test.ts`                                             | Proposal calculation and mission continuity tests                                               | Production-bound                                                                                   | PR E                                             |
| `tsconfig.dayforge.json`                                                        | Focused compilation surface                                                                     | Reusable experimental IP; cannot replace repository-wide validation                                | Extraction PR CI only if supplemental            |

All 34 files reported by `git diff --name-only origin/main...ba9bf444819a6be00702d5e38f791a0f29ece507` appear above.

## Feature and route inventory

| Feature or route                   | PR #10 state                                                   | Preservation decision                                                                                 |
| ---------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Canonical Mission 042 continuity   | Shared demo snapshot and runtime assertion                     | Extract the invariant; production surfaces read one normalized persisted mission in PR A onward       |
| Commercial mission lifecycle       | Deterministic in-memory transition map                         | Extract and enforce transactionally in PR A                                                           |
| Durable mission storage            | Full snapshot inside `ops_tasks.metadataJson`                  | Preserve bridge idea; replace authoritative storage with normalized commercial tables in PR A         |
| `/territory-preview`               | Public deterministic provider results and illustrative CSS map | Preserve experience and provider architecture; replace data, rate-limit, and persist evidence in PR B |
| Territory provider pipeline        | Pluggable geocode/search/dedupe/rank interfaces                | Extract in PR B                                                                                       |
| Laundry opportunity scoring        | Deterministic scoring with explanation reasons and risks       | Extract in PR B with real capacity, routes, evidence, timestamps, and fact/estimate/inference labels  |
| BORESLAY production adapter        | Unmounted client adapter and tRPC-shaped transport             | Extract and mount inside the existing Rally canvas in PR C                                            |
| `/driver/sales-mission/:missionId` | Public/localStorage phone simulation                           | Preserve UX; rebuild on authenticated persisted state in PR D                                         |
| `/commercial-proposal/:missionId`  | LocalStorage mission plus hard-coded demo store profile        | Preserve print UX and proposal model; rebuild from mission plus tenant configuration in PR E          |
| Browser Print/Save PDF             | Functional client print fallback                               | Retain as the first production fallback in PR E                                                       |
| Churn Radar scoring                | Pure input-driven engine                                       | Extract with tenant data adapters in PR F                                                             |
| Win-back SMS drafting              | Pure grounded draft builder requiring approval                 | Extract through existing approval/outreach infrastructure in PR F                                     |
| Focused DayForge CI                | Passing supplemental type/test/build workflow                  | Preserve diagnostics; require repository build and relevant regression suites per extraction PR       |

## Reusable experimental product IP and standalone candidates

- **Territory Intelligence API / laundromat lead intelligence**: provider normalization, business deduplication, evidence capture, vertical scoring, and territory-preview sessions could support a standalone prospecting product for service businesses.
- **BORESLAY mission engine**: the adapter boundary, replay telemetry, idempotent reward semantics, and real-world unlock can become a licensable game-driven workforce execution engine.
- **DayForge Field**: the guided briefing, preparation, navigation, talk track, proof, and outcome workflow could become a standalone field-sales enablement app.
- **Commercial proposal and print orchestration**: tenant-branded proposal generation, approval, versioning, PDF, and local-print fulfillment could become a standalone collateral service.
- **Churn Radar / customer recovery**: cadence-based risk detection, evidence explanations, controlled message drafting, and recovered-revenue attribution could become a standalone retention product.
- **Vertical opportunity scoring framework**: the provider and scoring contracts can be adapted for commercial cleaning, landscaping, property services, and other route-based operators while preserving vertical-specific evidence models.

## Extraction coverage gate

PR #10 must remain open until all of the following are true:

1. The archival branch resolves remotely to the archived SHA above.
2. Every changed PR #10 file is present in the complete file inventory.
3. Every route and product feature is mapped to an extraction PR or explicitly retained only as archived experimental IP.
4. PR A is open and establishes normalized persisted mission authority.
5. No extraction commit changes or deletes the locked landing-page implementation.

After these checks, PR #10 may be closed as **superseded by the archive plus PRs A-F**, never as discarded work.

## Production extraction progress

- **PR A / #11:** normalized canonical commercial mission, tenant-scoped lifecycle, authorization, idempotency, ops-task bridge, and admin visibility.
- **PR B / #12:** real server-only geocoding/business discovery, evidence provenance, laundry scoring, tenant operating profile, durable scans, and mission creation.
- **PR C / #13:** existing Rally integration with persisted mission HUD, multi-attempt history, immutable qualifying result, server-calculated reward, and exactly-once phone unlock. Experimental PR #10 adapters remain archived; the production integration deliberately wraps the existing deterministic engine instead of inserting network state into replay simulation.
- **PR D / #14:** authenticated driver role, assignment-enforced field APIs, one-time secure phone handoff, persisted tenant-configurable preparation, navigation and arrival evidence, visit notes, structured outcomes, cross-device resume, and an explicit distinction between estimated contract value and realized revenue. The archived localStorage simulation is not authoritative and evidence-file upload remains mapped to a later integration slice.
- **PR E / #15:** persisted tenant proposal profiles; immutable mission-derived proposal snapshots; administrator-only version generation and approval; tenant-scoped idempotency and audit events; approved-only driver access; draft watermarking; honest browser Print/Save PDF fallback; and a server-enforced requirement that current approved collateral exist before the Field checklist can claim it is ready. No hard-coded operator profile or localStorage handoff remains authoritative.
- **PR F:** tenant-order-backed cadence and value scoring; immutable evidence and confidence snapshots; active-order suppression; ops-task-backed recovery missions; exact-version human approval; separately recorded contact permission; a manual SMS composer that never auto-sends; provider-delivery-unverified contact reporting; and later-paid-order recovered-revenue attribution. The archived input-only scorer and draft builder are superseded by the production tenant-data workflow, while their deterministic scoring and grounding principles are preserved.
