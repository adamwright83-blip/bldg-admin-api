# Slice 0: Inventory and Verification Report

**Repository:** `adamwright83-blip/bldg-admin-api`  
**Base Commit:** `7661076 Merge Goldline campaign runs and fiction packs`  
**Branch:** `codex/claire-strategy-s00-inventory`  
**Date:** 2026-09-16  

---

## 1. Inventory & Verification of Master Plan Assumptions

Each assumption from Section 0.4 of `claire-strategyengine-codex-prompt.md` is classified as `VERIFIED`, `PARTIAL MATCH`, `NOT FOUND`, or `UNKNOWN`, grounded in concrete repository evidence.

| Item | Classification | Repository Evidence (Files, Symbols, Tests) | Findings & Notes |
|---|---|---|---|
| **Claire Router & Voice Core** | `VERIFIED` | `server/claire/claireRouter.ts`<br>`server/claire/claireTwilio.ts`<br>`server/claire/claireToken.ts`<br>`server/claire/contextAssembler.ts`<br>`server/claire/preDriveConversation.ts`<br>`server/claire/reasoning.ts`<br>Tests: `server/claire/*.test.ts` (37 files, 328 tests) | Present, active, fully tested on `origin/main`. Router mounts tRPC routes at `system.claire`. |
| **Canonical Active Customer Metric** | `VERIFIED` | `server/claire/activeCustomerMetric.ts:18-19`<br>`ACTIVE_CUSTOMER_DEFINITION`<br>`getActiveCustomerMetric`<br>`activeCustomerPopulation` in `server/analytics/businessMetrics.ts`<br>Tests: `activeCustomerMetric.test.ts` | Definition: Distinct customer identity with ≥1 paid order on current day or preceding 29 days. Matches 0.4 verbatim. |
| **Macro Goal Service** | `VERIFIED` | `server/claire/macroGoalService.ts`<br>`loadCurrentMacroGoal`<br>`saveMacroGoal`<br>Table: `claire_macro_goals` in `drizzle/schema.ts:6344`<br>Tests: `macroGoalService.test.ts` | Present. Has `targetValue`, optional `targetDate`, source `operator_attested \| admin`. **No spending ceiling. No approval categories.** |
| **LLM Core Abstraction** | `VERIFIED` | `server/_core/llm.ts:182` (`invokeLLM`)<br>`server/_core/llm.ts:462` (`invokeTextLLM`)<br>Tests: `server/_core/llm.test.ts` | `invokeLLM` requires `outputSchema` (structured). `invokeTextLLM` returns string (unstructured text). Both call Anthropic and track AI spend with `assertAiSpendAvailable`. |
| **Claire Runtime Repair** | `VERIFIED` (Deploy Status: `UNKNOWN`) | Merged via PR #132 (commit `5a59ed7054c0d5f552f39d82257144686cddd3e1`).<br>`invokeTextLLM` wired in `preDriveConversation.ts:1`, `reasoning.ts:2`.<br>Telemetry: `server/claire/generationTelemetry.ts`.<br>`claire.previewPreDrive` in `claireRouter.ts:158`. | Merged into `origin/main`. Deployed state cannot be verified from authoritative deployment API in this environment; recorded as `UNKNOWN`. |
| **`extractClaireDebrief`** | `VERIFIED` | `server/claire/reasoning.ts:347`<br>Caller: `server/claire/claireTwilio.ts:864` | Present, structured via `invokeLLM`, working. Must not be modified in behavior. |
| **Voice Commitment Loop** | `VERIFIED` | `server/claire/voiceCommitmentLoop.ts:38`<br>`handleVoiceCommitmentTurn`<br>`acceptCommitmentProposal`<br>Tests: `voiceCommitmentLoop.test.ts` (38 tests) | Proposes, reads back, and accepts Day Director commitments into `dayDirectorCommitments`. |
| **Workday Plan Service** | `VERIFIED` | `server/claire/workdayPlanService.ts`<br>`shared/claireWorkday.ts`<br>`assembleTomorrowCandidates`<br>`diffWorkdayPlans`<br>`speakMorningDelta`<br>`speakEveningPlan`<br>Tests: `workdayPlanService.test.ts` | Assembles morning delta and evening plan, stored as snapshot in `dayDirectorCommitments`. |
| **PR #148: Claire Watches Board** | `VERIFIED` | Merged via PR #148 (commit `5da6629`).<br>`server/claire/proactive/boardService.ts`<br>`shared/claireProactive.ts`<br>Table: `claire_operator_doctrine`<br>Table: `claire_proactive_obligations`<br>Tests: `shared/claireProactive.test.ts` (22 tests) | Detailed in Section 2 below. Currently non-spending, but creates growth commitments on Day Line autonomously based on doctrine. |
| **Character System (Tiers/Warmth)** | `VERIFIED` | `server/claire/character/`<br>`relationshipEmitters.ts`<br>`relationshipState.ts`<br>`tierEngine.ts`<br>`types.ts`<br>Table: `claire_relationship_events`<br>Tests: `relationshipE2E.test.ts`, `tierEngine.test.ts` | Emitters append to append-only event ledger and recompute 4 dimensions and disclosure tier. Allowlist needed for G1. |
| **Lantern City Overview Service** | `VERIFIED` | `server/goldlineWorld/lanternCityOverviewService.ts`<br>`getLanternCityOverview`<br>`projectLanternCityOverview`<br>Caller: `goldlineWorldRouter.ts:38` (`goldlineWorld.overview`) | Derives `featuredOperation` autonomously from operation/chapter/dossier. Must be refactored in Slice 5 to read StrategyEngine. |
| **Scoreboard Provenance Pattern** | `VERIFIED` | `lanternCityOverviewService.ts:489,494`<br>`shared/businessGame.ts:23-28` (`ProvenancedValue<T>`) | Structure: `{ value, provenance, sourceReference, confidence }` or scoreboard fields with `{ numerator, denominator, provenance }`. |
| **Human Approval Boundary** | `VERIFIED` | `server/agents/humanApproval.ts`<br>`approvalRequiredToolNames`<br>`evaluateHumanApproval` | Controls 6 sensitive tools: `sendCustomerReminderTool`, `requestVendorConfirmationTool`, `requestVendorBookingConfirmationTool`, `chargeCardTool`, `refundCardTool`, `cancelOrderTool`. |
| **`businessWorld` and `campaignLibrary`** | `VERIFIED` | `server/campaignLibrary/`<br>`server/businessWorld/`<br>Tables: `growth_campaigns` | `campaignLibrary` holds campaign templates (`GrowthCampaign`). `businessWorld` holds projections of world points, signals, and assets. |
| **"Sent" Bug Site** | `VERIFIED` | `shared/claireProactive.ts:85,286,293`<br>`server/claire/proactive/boardService.ts:254`<br>`client/src/pages/goldline/Day1FieldMission.tsx:159` | PR #148 added `draft: { message, sent: false }` to avoid false completions, but speech generation lacked an authoritative verified fact inventory verifying state changes before generation. |
| **Day Line & Chronicle** | `VERIFIED` | `server/goldline/dayline/`<br>`dayDirectorCommitments`<br>`server/goldlineWorld/worldEventStore.ts`<br>`goldlineWorldEvents` | Day Line renders commitments. Chronicle renders world events from `goldline_world_events`. |

---

## 2. End-to-End Trace of PR #148

PR #148 ("Let Claire watch the board and create authorized growth work") merged into `origin/main` (commit `5da6629`):

### Triggers
1. **Live Call / Claire Turn:** `handleClaireTurn` in `server/claire/turn/claireTurn.ts` invokes `ensureAdamBoard({ tenantId, operatorUserId, actorId })`.
2. **Day Line Mutation:** `server/goldline/dayline/dayLineMutationService.ts` calls `ensureAdamBoard` upon day line updates.
3. Debounced by `SWEEP_MS = 60_000` (1 minute throttle).

### Reads
- `claireOperatorDoctrine` table for tenant & operator rules (`maxRecoveriesPerWeek`, `skipSalesUntil`, etc.).
- `loadPaidOrderLedger`: Full paid order history from 2020-01-01 to present to compute days since last paid and expected cadence.
- `claireProactiveObligations`: Existing open or scheduled recovery and sales obligations.
- `commercialFollowUps`: Open commercial follow-up records.
- `loadDataFreshness`: Ingestion latency for CleanCloud and Gumballpals.

### Writes
- Inserts/updates `claire_proactive_obligations` with `kind: "dormant_recovery" | "sales_follow_up" | "data_health"`, status `"draft_prepared" | "scheduled" | "awaiting_result" | "superseded"`.
- Inserts into `dayDirectorCommitments` with `kind: "growth"`, `idempotencyKey: "claire-proactive:<id>"`, `metadataJson: { claireProactive: true, detailState: "COMPLETE", missingDetails: [] }`.

### Meaning of "Authorized" in PR #148
"Authorized" in PR #148 means governed by standing rules stored in `claireOperatorDoctrine` (`rulesJson` column). If the operator sets `maxRecoveriesPerWeek: 3`, Claire automatically places up to 3 recovery tasks per week on the Day Line without asking.

### Safety Analysis (Spending & External Contact)
- **Spend:** Does NOT call Stripe, does not issue payments, and does not purchase ads or print collateral.
- **External Contact:** Prepares a Rook text message draft (`draft: { message, sent: false }`). Line 254 notes: `sourceText: "${obligation.why} Rook draft is prepared; sending still needs you."`.
- **Verdict:** PR #148 cannot commit money or auto-send SMS today. However, it lacks a spend clearance boundary (`requiresSpendClearance()`), and its growth work creation is decoupled from any spending ceiling. In Slice 1, spend clearance must be wired to enforce G6.

---

## 3. Lantern City Overview Service Trace

- **Location:** `server/goldlineWorld/lanternCityOverviewService.ts`
- **Entry Points:**
  - `getLanternCityOverview(input: { tenantId, operatorId, atlas, campaign, operationId?, now? })`
  - Exposed via tRPC in `server/goldlineWorld/goldlineWorldRouter.ts` as procedure `goldlineWorld.overview`.
- **Featured Operation Selection:**
  - `projectLanternCityOverview` constructs `featuredOperation` using:
    1. An active authored operation if supplied (`input.operation`).
    2. Else the current campaign chapter (`chapter.stableChapterId`).
    3. Else a recovery operation for a dimming territory dossier (`${businessDate}:recovery:${dossier.territoryId}`).
    4. Else an exploration fallback (`${businessDate}:explore`).
- **Consumers:**
  - Consumed by Lantern City client screens (`client/src/pages/goldline/overworld/`, `LanternCityHome.tsx`, `OverworldRuntime.ts`).
- **Violation of G7:** Lantern City currently derives its own featured operation independently of Claire. In Slice 5, `strategy.today.featured` becomes the single authority that both Claire and Lantern City consume.

---

## 4. Character System Trace (Warmth & Tiers)

- **Location:** `server/claire/character/`
- **Emitters:** In `relationshipEmitters.ts`:
  1. `recordQualifyingClaireInteraction`: fires `call_completed` on pre-drive call end.
  2. `recordClaireMissionOutcomeEvents`: fires `operator_follow_through`, and if won `shared_hard_win`, or if lost `shared_failure`.
  3. `recordClaireAttestedEvent`: fires `operator_owned_mistake`, `operator_respected_boundary`, `operator_ignored_boundary`, `claire_admitted_error`, `claire_disclosure`, `operator_handled_disclosure_well`, `operator_handled_disclosure_poorly`.
- **Dimension Impact:** In `tierEngine.ts`:
  - `operator_follow_through` increases `professionalRespect` (+3) and `reliability` (+2).
  - `shared_hard_win` increases `professionalRespect` (+5) and `familiarity` (+3).
  - All non-`call_completed` events increase `familiarity` (+0.5).
- **Risk Assessment for G1:** Currently, no emitter directly fires on path choice or mission acceptance. However, `recordClaireAttestedEvent` or ad-hoc calls could theoretically be called. In Slice 1, a central allowlist will reject any warmth emission not tied to verified completion of operator-committed work.

---

## 5. Voice Commitment Loop & Workday Plan Service Trace

- **Voice Commitment Loop:** `server/claire/voiceCommitmentLoop.ts`
  - Inspects user utterances during Claire phone calls using `detectCommitmentProposal` and `detectConfirmation`.
  - When confirmed, calls `acceptCommitmentProposal`, creating rows in `dayDirectorCommitments`.
- **Workday Plan Service:** `server/claire/workdayPlanService.ts` & `shared/claireWorkday.ts`
  - `assembleTomorrowCandidates`: extracts candidate work items from `ClaireDriveContext`.
  - `confirmWorkdayPlan`: writes an immutable snapshot to `dayDirectorCommitments` with `hiddenFromDayPlan: true`.
  - `diffWorkdayPlans`: compares confirmed plan against current morning reality to compute `ADDED`, `REMOVED`, `MODIFIED` deltas.
  - Generates speech: `speakMorningDelta` and `speakEveningPlan`.

---

## 6. Scoreboard Provenance Pattern

Located across `server/goldlineWorld/lanternCityOverviewService.ts` and `shared/businessGame.ts`:
```typescript
export type ProvenancedValue<T> = {
  value: T | null;
  provenance: "SOURCED_FACT" | "OPERATOR_INPUT" | "DETERMINISTIC_ESTIMATE" | "AI_INFERENCE" | "UNKNOWN";
  sourceReference: string | null;
  confidence: "high" | "medium" | "low" | "unknown";
};

// Section / score provenance shape in scoreboard:
export type ScoreboardMetricProvenance = {
  sourceService: string;
  queryOrDefinition: string;
  window: string;
  computedAt: string;
};
```
Every StrategyEngine snapshot section and growth metric will carry this structured provenance.

---

## 7. `humanApproval.ts` Action List & API

- **Location:** `server/agents/humanApproval.ts`
- **Actions Requiring Approval:**
  - `sendCustomerReminderTool`
  - `requestVendorConfirmationTool`
  - `requestVendorBookingConfirmationTool`
  - `chargeCardTool`
  - `refundCardTool`
  - `cancelOrderTool`
- **API:**
  - `evaluateHumanApproval(ctx: AgentContext, toolName: string): ApprovalDecision`
  - Returns: `{ allowed: boolean; requiresHumanApproval: boolean; approvedByUserId?: string | null }`

---

## 8. The "Sent" Bug Trace & Analysis

- **Observation:** In previous iterations, agents or prompts could say "I've sent the text" or "I queued the visit" when an action was merely drafted or pending.
- **Current State:** PR #148 marked drafts explicitly with `draft: { message, sent: false }` and `sourceText: "... Rook draft is prepared; sending still needs you."`.
- **Root Cause:** Claire's generation prompts lacked an authoritative epistemic filter. Generation relied on text prompting rather than a strict verified fact inventory.
- **Remedy in Slice 1:**
  - Create `server/claire/assertionGuard.ts`.
  - Build `VerifiedFactInventory`: each fact carries `claimId`, `statement`, `entityRef`, `status: "verified" | "pending" | "unknown"`, `provenance`.
  - Supply only `verified` state-change facts to Claire for factual assertions; instruct non-committal language for `pending`/`unknown`.
  - Add regression test `guardrail.G4.sent_bug_regression`.

---

## 9. `businessWorld` & `campaignLibrary` Mapping

- `server/campaignLibrary/`: Defines `GrowthCampaign` templates with fields `campaignId`, `objective`, `completionCondition`, `pocketKind`, `missionCategory`.
- `server/businessWorld/`: Defines high-level world points (`hq`, `customer`, `commercial`, `territory_signal`) and projections.
- **Architectural Decision on `strategy_plays`:**
  - `strategy_plays` must **reference** campaign templates and vertical play templates, NOT extend them in place.
  - *Justification:* Campaign library items are static blueprints. Strategy plays are dynamic runtime objects with lifecycle states (`candidate | offered | chosen | active | paused | retired`), scoring breakdowns, evidence accumulation, spend reservations, and tenant isolation. Keeping `strategy_plays` as a dedicated runtime table referencing template identifiers cleanly separates static definitions from dynamic business execution.

---

## 10. Scheduling Mechanism

- The codebase uses in-process Node.js timers (`setInterval` with `timer.unref()`) initialized during server boot in `server/_core/index.ts`:
  - `startAutomaticGeographicReconciliation()`
  - `startNightShiftScheduler()`
  - `startEconomicOutboxDrainer()`
- All jobs verify business-local date roll (via `dashboardZoned.ts`) and maintain idempotency.
- Slice 9's triggers will follow this established in-process pattern, augmented with deduplication keys in `strategy_trigger_runs`.

---

## 11. Commercial Data Inventory

| Domain | Status | Repository Truth & Location | Gaps & Treatment |
|---|---|---|---|
| **Identity Resolution** | Available | `server/analytics/customerIdentityResolution.ts`<br>Normalizes phone, email, bldgUserId, cleancloudCustomerId. | Grouping works across available records. If a customer has no phone or email, group is marked `matched: false`. |
| **Historical Purchase Completeness** | Partial | `server/analytics/paidOrderLedger.ts`<br>Native Stripe orders + CleanCloud paid orders. | CleanCloud imports older than sync windows or customers with missing early orders have incomplete history. Marked `uncertain` under G12. |
| **First/Second Order Detection** | Derivable | Not currently a unified service. Can be derived from chronologically sorted verified paid orders in `paidOrderLedger.ts`. | Built in Slice 2 `growthMetrics.ts`. |
| **Refunds & Cancellations** | Missing in Analytics | `paidOrderLedger.ts` has no refund deductions. Only `marketplacePayments` and `residentLaundryOrders` store `refundedCents`. | Marked `uncertain` in `netSales` under G12; documented in Slice 2. |
| **CRM Records (Leads/Opportunities)** | Partial | `commercialPipelineRecords` (`stage`, `lossReason`, `estimatedContractValueCents`, `nextFollowUpAt`) and `commercialFollowUps` (`status`, `dueAt`, `note`, `assignedTo`). | Missing unified owner, communication permissions, last interaction date. Extended in Slice 7. |
| **Communication Permissions** | Missing | No opt-out or refusal tables exist in schema. | Added in Slice 7 as `communication_permissions` / opportunity permission fields. Refusals & opt-outs binding under G14. |
| **Service Issues & Complaints** | Missing | No persistent ticket/issue table. | Represented as untracked in Slice 4/7 unless surfaced via debriefs or notes. Open issues block promotion/referral. |
| **Service Capacity** | Partial | `commercialServiceExpectations.capacityReservedPoundsPerWeek`<br>`territoryStore.availableWeeklyCapacityPounds`<br>`employeeOperatingProfiles.weeklyCapacityUnits`. | Unified in snapshot builder; never exceed available capacity. |
| **Pricing, Offers & Approved Terms** | Partial | `commercialServiceExpectations`<br>`retailPricing`. | Mission prep uses only confirmed pricing/terms. |
| **Property Access & Approvals** | Partial | `geographicTruthService.ts`<br>`commercialAgreements`. | Property approval ≠ customer acquisition (G12). Captured in laundry activation tracks. |
| **Variable Costs & Discounts** | Missing | Not recorded in database. | Marked `uncertain` / unknown; score neutral in decision policy under G12. |

---

## 12. Vertical Template Boundary (G13)

### Core StrategyEngine (Trade-Agnostic)
- Funnel: `opportunity -> conversation -> first paid sale -> repeat paid sale`.
- Goals: `new_paying_customers`, `active_customers`, `paid_orders_per_period`, `net_sales_per_period`.
- Engine primitives: `strategy_snapshots`, `playground_rules`, `strategy_spend_ledger`, `strategy_plays`, `strategy_path_offers`, `strategy_path_choices`, `strategy_mission_plan`, `strategy_evidence`, `recovery_items`.
- Decision policy: scoring by capacity, initiation cost, geography, urgency, confidence.
- Safeguards: G1–G14.

### Vertical Template: `laundry_fluff_fold`
- Stages: Property Discovery → Property Approval → Door Tag Launch → Resident First Order → Resident Repeat Order.
- Play Templates:
  1. `property_expansion`: commercial/multi-family manager outreach.
  2. `property_activation`: resident announcement, QR kits, lobby displays.
  3. `door_tag_acquisition`: residential door hanger routes.
  4. `dormant_recovery`: win-back for 30+ day inactive customers.
  5. `first_to_second_order`: service check-in after first paid order.
  6. `paid_digital_acquisition`: local targeted ads (requires spend clearance).
- Stall reasons: `timing | price | trust | pickup_convenience | existing_provider | access_restriction | service_issue | unknown`.

---

## 13. EXECUTION AMENDMENTS (Slices 1–10)

1. **Slice 1 (Safety Baseline):**
   - Wire PR #148's `boardService.ts` actions to check `requiresSpendClearance()`. Before Slice 3, this always returns denied. Add flag `claire.strategy.legacyAutonomy` (default on for non-spend).
   - Create `server/claire/assertionGuard.ts` and `VerifiedFactInventory` builder. Wire regression test for "Sent" bug.
   - Guard `relationshipEmitters.ts` with an allowlist restricted to verified completion of committed work.
2. **Slice 2 (Growth Metrics):**
   - Derive `newPayingCustomers`, `reactivatedCustomers`, `paidOrders`, `netSales`, `repeatConversion`, and `netActiveChange` from `paidOrderLedger.ts` and `customerIdentityResolution.ts`.
   - Because canonical accounting does not track refunds for CleanCloud orders, return `netSales` with an explicit `uncertain` flag and provenance warning.
   - Customers with incomplete order history are counted in `uncertainNewPayingCustomers`.
3. **Slice 3 (Playground Rules):**
   - Extend `claire_macro_goals` schema and `macroGoalService.ts` to store `metricType` (`new_paying_customers | active_customers | paid_orders_per_period | net_sales_per_period`), confirmed `targetValue`, `targetDate`, and secondary targets.
   - Create `playground_rules` table (versioned, append-only) and `strategy_spend_ledger` with atomic, transaction-safe reservation logic in `spendClearance.ts`. Default ceiling = $0.
4. **Slice 4 (Strategy Snapshot):**
   - Build `server/strategy/snapshotBuilder.ts` aggregating goal, metrics, pipeline gaps, capacity, commitments, and provenance.
   - Enforce hard size budget (~6k tokens) with deterministic section truncation.
   - Stale data (e.g. CleanCloud > 36h) surfaced in `unresolved`.
5. **Slice 5 (Claire & Map Read Snapshot):**
   - Refactor `lanternCityOverviewService.ts` so `featuredOperation` is read directly from `strategy.today.featured` instead of being independently derived.
   - Claire's pre-drive brief selects the 1–2 most important points from the snapshot using `invokeTextLLM`.
   - Implement post-generation lint for disappointment framing (G2) and state assertions (G4).
6. **Slice 6 (Plays, Ranking & Path Offers):**
   - Implement `playGenerator.ts` using vertical template `laundry_fluff_fold`.
   - Deterministic ranking in `decisionPolicy.ts` modeling initiation cost (outing base cost + marginal stop cost), geographic bundling, and capacity limits.
   - Path offers render as a 2–3 route visible fork on Lantern City and in voice conversation.
7. **Slice 7 (Mission Sequencing & Sales Prep):**
   - Refactor PR #148's decision logic into `missionSequencer.ts`. Claire reads sequenced missions; does not create them.
   - Extend CRM records with communication permission state (`opted_in | opted_out | refused | unspecified`), next actions, and gap detection ("no next action").
   - Prepare sales prep (opening, request, approved pricing, objection handling) for each mission.
8. **Slice 8 (Outcome Attribution as Evidence):**
   - Record factual funnel progress in `strategy_evidence`.
   - Below minimum-evidence threshold (14 days and exposure floor), no world signals fire (G5).
   - Above threshold, reversible brighten/dim signals update Lantern City.
   - Capture structured stall reasons in `opportunity_stall_reasons`.
9. **Slice 9 (Autonomous Triggers):**
   - Morning delta, mission completion, mission skip, material business change, and weekly Dawn triggers.
   - Recorded in `strategy_trigger_runs`.
   - Completion updates world state; does not trigger outbound calls.
10. **Slice 10 (Recovery & Drop Patterns):**
    - `recovery_items`: exactly 0 or 1 `visible` at a time (kintsugi); others remain `queued` and counted (G3).
    - Resolution options: repair, reschedule, drop (with mandatory reason and read-back).
    - Drop pattern flags surface only at Dawn.
11. **End-to-End Acceptance:**
    - Test runner fixture simulating 3 business-local weeks, portability test with stub vertical, and G1–G14 guardrail test suite.

---

## 14. Slice 0 Completion Status

- Inventory complete and verified against `origin/main`.
- Plan verified and amended to match repository reality.
- Ready to proceed autonomously to Slice 1.
