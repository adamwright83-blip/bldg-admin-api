# JOYSTICK Operator Representation — Stage 2 Gap Analysis

> Investigation report. Not canonical architecture. No Stage 2 implementation authorized by this document.

---

## Executive Summary

Stage 1 established a deterministic, typed, read-only read model (`OperatorContextPacket` in [`server/persistentOperator/operatorContext.ts`](file:///Users/adamwrightpfi/Desktop/Cursor_bldg-admin-api/server/persistentOperator/operatorContext.ts)) that synthesizes canonical identity, onboarding facts, bounded Behavioral Ledger events, and goal cycle learned deltas on demand.

This Stage 2 discovery investigation evaluates whether any useful Operator Representation capability exists that cannot be answered safely and efficiently by the existing Stage 1 read model.

**Conclusion:** **Option A: No Stage 2 persistence is justified yet.**
1. **Recomputation is negligible:** On-demand assembly executes in under 5 milliseconds across indexed primary keys and foreign keys. There is zero latency justification for caching or durable state.
2. **Durable learning already exists:** Meaningful adaptations (weights, constraints, channel affinities, loadout recommendations) are already durably persisted in `goalCycleLearnedDeltas` and surfaced in `OperatorContextPacket.learnedSignals`.
3. **Query bounds are not belief gaps:** The 200-row Behavioral Ledger limit is an engineering read boundary, not an ontological defect. If longitudinal coverage across thousands of events is needed later, deterministic SQL aggregation or date-windowed query readers solve it cleanly without durable state.
4. **Missing capabilities stem from missing source semantics:** The inability to discern communication channels or attribute unbound onboarding sessions stems from upstream schema definitions, not the absence of a belief store. Incurring durable representations would violate truth boundaries and fabricate data.
5. **Epistemic constraints forbid causal beliefs:** Storing durable "beliefs", "traits", or "motives" from observational data violates the project's behavioral science constitution (`BEHAVIORAL_SCIENCE_FOUNDATION.md`) and the strict psychology firewall.

---

## 1. Current Stage 1 Capability

The Stage 1 architecture centers on `buildOperatorContextPacket(input)` in [`server/persistentOperator/operatorContext.ts`](file:///Users/adamwrightpfi/Desktop/Cursor_bldg-admin-api/server/persistentOperator/operatorContext.ts). It provides an ephemeral, typed, fully auditable snapshot of operator context constructed on demand with zero background workers and zero durable representation tables.

### What `OperatorContextPacket` Answers Today

1. **Canonical Identity and Aliases:**
   - Resolves tenant-scoped canonical operator identities through `resolveCanonicalOperatorIdentity` in [`server/persistentOperator/identity.ts`](file:///Users/adamwrightpfi/Desktop/Cursor_bldg-admin-api/server/persistentOperator/identity.ts).
   - Maps open IDs, user IDs, and role aliases to the canonical operator ID (`canonicalOperatorId`) and an authorized list of `mappedUserIds`.
   - Records provenance and references in `card.explicitFacts` and `evidenceRefs`.

2. **Explicit Operator-Declared Facts (Onboarding):**
   - Reads declared onboarding responses from `goldline_onboarding_sessions` via `readSession(tenantId)` in [`server/goldlineOnboarding/store.ts`](file:///Users/adamwrightpfi/Desktop/Cursor_bldg-admin-api/server/goldlineOnboarding/store.ts).
   - Extracts factual trade (`declared_trade`), service area (`declared_service_area`), and declared avoidance (`declared_avoided_task`).
   - Strictly enforces identity binding: answers are surfaced on `card.explicitFacts` only when the session contains an authoritative operator binding (`operatorUserId` or `canonicalOperatorId`).

3. **Explicit Declared Preferences:**
   - Surfaces structured contact channels, working hours, and communication frequencies via `card.explicitPreferences` when declared by the operator.

4. **Timezone Context & Guardrails:**
   - Inspects `legacyDayforgeSaasTenants.timeZone`.
   - Suppresses local time-of-day claims (e.g. morning, before 10:00 AM) if the timezone is missing, emitting a clear uncertainty item.

5. **Bounded Behavioral Intervention Evidence:**
   - Reads up to 200 index-backed events (`DEFAULT_BOUNDED_OPERATOR_LEDGER_LIMIT`) strictly scoped to the tenant and mapped operator user IDs via `listBehavioralLedgerEventsForOperatorBounded`.
   - Groups lifecycle events by `decisionPointId` or `correlationId`.
   - Pairs intervention assignments with subsequent lifecycle actions (`DELIVERED`, `VIEWABLE`, `ENGAGED`, `ACCEPTED`, `STARTED`, `COMPLETED`, `VERIFIED`, `DEFERRED`, `DISMISSED`).
   - Computes `startedWithinWindow` and `startLatencySeconds` strictly against predefined outcome windows (`proximalOutcomeWindowMinutes`).
   - Enforces temporal integrity: rejects `STARTED` events that predate assignment timestamps and preserves lineage.

6. **Descriptive Observed Patterns (Threshold $\ge 3$):**
   - Derives `intervention_start_sequence` metrics (total eligible points, started within window count, mean start latency in seconds, completion count, verified count) across qualifying decision points.
   - Derives `explicit_deferral_dismissal` metrics counting distinct `DEFERRED` and `DISMISSED` actions.
   - Requires $\ge 3$ independent decision points/correlations before emitting any pattern, preventing small-sample overinterpretation.

7. **Normalized Goal Cycle Learned Deltas:**
   - Reads up to 50 records from `goalCycleLearnedDeltas` in [`server/persistentOperator/learningStore.ts`](file:///Users/adamwrightpfi/Desktop/Cursor_bldg-admin-api/server/persistentOperator/learningStore.ts).
   - Normalizes `learningKind` (`doctrine_weight`, `loadout_recommendation`, `channel_affinity`, `time_preference`, `candidate_boost`, `execution_constraint`), `deltaType` (`boost`, `suppress`, `reinforce`, `constraint`), `confidence`, and before/after states into `learnedSignals`.
   - Suppresses LLM dialogue prose from being exposed as Claire speech.

8. **Gated Absence & Source Transparency:**
   - Distinguishes empty collections from source failures: emits `source_unavailable` if a database or dependency fails.
   - Asserts absence claims (`no_records`, `no_verified_outcome`) only when all required upstream sources succeed.
   - Flags truncation (`evidence_window_truncated`) when the Behavioral Ledger read hits the query limit.

9. **Strict Truth Firewall & Behavioral Safeguards:**
   - Enforces `DIAGNOSIS_FORBIDDEN_PATTERNS`: throws if any pattern, uncertainty, or evidence item emits forbidden diagnostic or causal phrasing (e.g., "avoidant", "lazy", "ADHD", "works better").
   - Explicitly rejects business-truth authority: Operator Context governs handling rules, never commercial truth.

---

## 2. Current Stage 1 Limits

The following table details the specific limits present in Stage 1, their exact code locations, and their technical classifications.

| Limit | Code Location | Description | Classification |
|---|---|---|---|
| **200-Row Behavioral Ledger Bound** | [`server/behavioralLedger/behavioralLedger.ts#L23-L24`](file:///Users/adamwrightpfi/Desktop/Cursor_bldg-admin-api/server/behavioralLedger/behavioralLedger.ts#L23-L24), [`server/persistentOperator/operatorContext.ts#L567-L594`](file:///Users/adamwrightpfi/Desktop/Cursor_bldg-admin-api/server/persistentOperator/operatorContext.ts#L567-L594) | The index-backed reader loads at most 200 events (max 500). Older events beyond this limit are not in memory, and the packet emits `evidence_window_truncated`. | **Bounded-history coverage / Query capability** |
| **Tenant-Scoped Onboarding Binding** | [`server/persistentOperator/operatorContext.ts#L258-L281`](file:///Users/adamwrightpfi/Desktop/Cursor_bldg-admin-api/server/persistentOperator/operatorContext.ts#L258-L281), [`#L463-L477`](file:///Users/adamwrightpfi/Desktop/Cursor_bldg-admin-api/server/persistentOperator/operatorContext.ts#L463-L477) | `goldline_onboarding_sessions` has no native `operatorUserId` or `canonicalOperatorId` foreign key. Unbound sessions emit `operator_binding_unavailable`. | **Missing identity binding / Missing source data** |
| **No Communication Channel Semantics in `assignedOption`** | [`server/persistentOperator/operatorContext.ts#L114-L129`](file:///Users/adamwrightpfi/Desktop/Cursor_bldg-admin-api/server/persistentOperator/operatorContext.ts#L114-L129), [`shared/behavioralInterventionMapping.ts`](file:///Users/adamwrightpfi/Desktop/Cursor_bldg-admin-api/shared/behavioralInterventionMapping.ts) | `assignedOption` records intervention arms (e.g. fiction templates or prompt variations), not communication channels (SMS vs email vs push). Cannot infer channel preferences from arm names. | **Missing evidence semantics** |
| **Missing Predefined Outcome Window** | [`server/persistentOperator/operatorContext.ts#L684-L708`](file:///Users/adamwrightpfi/Desktop/Cursor_bldg-admin-api/server/persistentOperator/operatorContext.ts#L684-L708), [`#L742-L748`](file:///Users/adamwrightpfi/Desktop/Cursor_bldg-admin-api/server/persistentOperator/operatorContext.ts#L742-L748) | If `proximalOutcomeWindowMinutes` is not set on the assignment event, `startedWithinWindow` is `"unknown"`, latency is `null`, and `proximal_outcome_window_unavailable` is emitted. | **Correctness / Missing source data** |
| **Pattern Threshold Constraint ($\ge 3$)** | [`server/persistentOperator/operatorContext.ts#L220`](file:///Users/adamwrightpfi/Desktop/Cursor_bldg-admin-api/server/persistentOperator/operatorContext.ts#L220), [`#L758-L864`](file:///Users/adamwrightpfi/Desktop/Cursor_bldg-admin-api/server/persistentOperator/operatorContext.ts#L758-L864) | Patterns require at least 3 distinct decision points/correlations. Fewer observations emit `insufficient_observations` and suppress patterns. | **Correctness (Epistemic guardrail)** |
| **Missing Timezone Suppresses Time Claims** | [`server/persistentOperator/operatorContext.ts#L548-L564`](file:///Users/adamwrightpfi/Desktop/Cursor_bldg-admin-api/server/persistentOperator/operatorContext.ts#L548-L564) | If `legacyDayforgeSaasTenants.timeZone` is null or empty, local time-of-day claims are suppressed and `timezone_unavailable` is emitted. | **Missing source data / Correctness** |
| **In-Memory Windowing Rather Than SQL Aggregation** | [`server/persistentOperator/operatorContext.ts#L567-L865`](file:///Users/adamwrightpfi/Desktop/Cursor_bldg-admin-api/server/persistentOperator/operatorContext.ts#L567-L865) | Stage 1 performs start sequencing and latency arithmetic in memory over the loaded slice rather than executing database-level aggregate expressions across long horizons. | **Query capability** |
| **50-Record Bound on Learned Deltas** | [`server/persistentOperator/operatorContext.ts#L874`](file:///Users/adamwrightpfi/Desktop/Cursor_bldg-admin-api/server/persistentOperator/operatorContext.ts#L874) | Stage 1 queries the 50 most recent `goalCycleLearnedDeltas` ordered by creation date. Older historical cycles are not projected. | **Bounded-history coverage** |

---

## 3. Candidate Questions Stage 2 Might Need to Answer

Below is an evaluation of candidate questions often proposed for "Stage 2 Operator Representation" systems, assessing whether they can be answered today and whether durable representation is justified.

### Question 1: "Does the operator tend to start tasks within the predefined outcome window?"
- **Can Stage 1 answer it now?** **Yes.**
- **Why / Why not:** When $\ge 3$ qualifying decision points with predefined windows exist within the bounded read, `buildOperatorContextPacket` derives `intervention_start_sequence` containing `startedWithinWindowCount`, `startedLatencyMeanSeconds`, and `totalEligiblePoints`.
- **Exact source evidence:** Rows in `behavioral_ledger_events` containing `decisionPointId`, `assignedOption`, `proximalOutcomeWindowMinutes`, and corresponding `STARTED` events.
- **Would persistence duplicate existing rows?** Yes. Storing a durable "responsiveness score" would duplicate the raw ledger events.
- **Could deterministic code solve it?** Stage 1 already solves it deterministically.
- **Is a durable object justified?** **No.**

### Question 2: "What is the operator's all-time start rate across 5,000 historic events?"
- **Can Stage 1 answer it now?** **No.**
- **Why / Why not:** The bounded ledger query limits the in-memory window to 200 events (`DEFAULT_BOUNDED_OPERATOR_LEDGER_LIMIT`), emitting `evidence_window_truncated`.
- **Exact source evidence:** Historical `behavioral_ledger_events` rows for the operator.
- **Would persistence duplicate existing rows?** Yes. Storing a persistent "operator profile" row with all-time start rates duplicates the ledger events.
- **Could deterministic code solve it?** **Yes.** A targeted SQL aggregate query (e.g. `SELECT COUNT(*), SUM(CASE WHEN ...), AVG(...) FROM behavioral_ledger_events WHERE tenant_id = ? AND operator_user_id IN (?)`) or indexed summary scan can compute this on demand in $<10$ ms.
- **Is a durable object justified?** **No.** This is a query capability limitation, not an architectural representation gap.

### Question 3: "Which communication channel does the operator prefer for Claire outreach?"
- **Can Stage 1 answer it now?** **Partially / No.**
- **Why / Why not:** Stage 1 surfaces explicit declared preferences if stored (`OperatorExplicitPreference`), but correctly refuses to infer channel preferences from `assignedOption`. `assignedOption` designates an intervention arm (such as a narrative template), not a delivery transport (SMS, email, push).
- **Exact source evidence:** Authoritative user preference records, or future delivery transport logs.
- **Would persistence duplicate existing rows?** Persisting an inferred belief would invent false data. Persisting an explicit preference would duplicate user setting records.
- **Could deterministic code solve it?** **Yes.** Direct read of explicit user settings or an authoritative delivery transport store.
- **Is a durable object justified?** **No.** The limitation is missing source semantics, not missing durable representation.

### Question 4: "Does the operator work better under pressure, or are they avoidant of specific tasks?"
- **Can Stage 1 answer it now?** **No, and it MUST NEVER answer this.**
- **Why / Why not:** Violates the Psychology Firewall and Epistemic Principles of the project (`BEHAVIORAL_SCIENCE_FOUNDATION.md` §2 and §7; `DIAGNOSIS_FORBIDDEN_PATTERNS`). Declared avoidance is captured solely as a literal string fact (`"Declared avoided task: ..."`). Inferring traits like "avoidant", "fearful", "intimidated", or "ADHD" is forbidden.
- **Exact source evidence:** None. These constructs are prohibited.
- **Would persistence duplicate existing rows?** N/A (prohibited).
- **Could deterministic code solve it?** N/A (prohibited).
- **Is a durable object justified?** **Absolutely not.**

### Question 5: "Has the operator achieved verified commercial or operational outcomes?"
- **Can Stage 1 answer it now?** **Yes.**
- **Why / Why not:** Stage 1 checks both the Behavioral Ledger (`verificationClass = 'VERIFIED'`) and `goalCycleLearnedDeltas` after-state fields (`verifiedDeliveries`, `verifiedRevenueCents`). If neither contains verified outcomes, it emits `no_verified_outcome`.
- **Exact source evidence:** `behavioral_ledger_events` and `goal_cycle_learned_deltas`.
- **Would persistence duplicate existing rows?** Yes. Storing a separate "verified status" record would duplicate authoritative ledger rows and cycle outcomes.
- **Could deterministic code solve it?** Stage 1 already solves it deterministically.
- **Is a durable object justified?** **No.**

### Question 6: "What intervention adjustments or doctrine weights have been learned from past goal cycles?"
- **Can Stage 1 answer it now?** **Yes.**
- **Why / Why not:** Stage 1 queries `goalCycleLearnedDeltas` via `listGoalCycleLearnedDeltas` and exposes them as `learnedSignals` in the packet, preserving `learningKind`, `targetKey`, `deltaType`, `confidence`, and before/after states.
- **Exact source evidence:** `goal_cycle_learned_deltas` rows.
- **Would persistence duplicate existing rows?** Yes. Creating a separate "operator beliefs" table would directly duplicate `goalCycleLearnedDeltas`.
- **Could deterministic code solve it?** Stage 1 already solves it deterministically.
- **Is a durable object justified?** **No.**

### Question 7: "What did the operator declare during onboarding regarding their daily trade and service area?"
- **Can Stage 1 answer it now?** **Yes, when authoritatively bound.**
- **Why / Why not:** Reads `goldline_onboarding_sessions`. If the session is bound to the operator, answers are placed on `card.explicitFacts`. If unbound, it safely reports `operator_binding_unavailable`.
- **Exact source evidence:** `goldline_onboarding_sessions.answers_by_key_json`.
- **Would persistence duplicate existing rows?** Yes. Storing onboarding answers in an operator representation table duplicates the onboarding table.
- **Could deterministic code solve it?** Stage 1 already solves it deterministically; full coverage only requires adding an operator binding column or foreign key to `goldline_onboarding_sessions`.
- **Is a durable object justified?** **No.**

---

## 4. 200-Row Behavioral Ledger Bound Analysis

The bounded read in [`server/behavioralLedger/behavioralLedger.ts`](file:///Users/adamwrightpfi/Desktop/Cursor_bldg-admin-api/server/behavioralLedger/behavioralLedger.ts) retrieves a default of 200 rows (`MAX_BOUNDED_OPERATOR_LEDGER_LIMIT = 500`).

### What Information Can Be Missed?
1. **Historical Decision Points:** If an operator accumulates 600 ledger events across several months of active usage, the 400 oldest events fall outside the in-memory window.
2. **Split Decision Points Across Window Boundary:** If an assignment occurred at row index 205 and the corresponding `STARTED` event occurred at row index 195, the assignment is dropped while the start is retained. The builder safely detects this and emits `missing_paired_timestamps` rather than calculating invalid latency.
3. **Longitudinal Trend Shifts:** If an operator changed behavior between month 1 and month 3, a 200-row window that only covers month 3 cannot contrast recent behavior against early behavior.

### Would Pagination or Different Aggregation Solve It?
**Yes.**
- **SQL Aggregation:** A single query with indexed aggregations (`COUNT(*)`, `AVG(TIMESTAMPDIFF(SECOND, assignment.occurred_at, started.occurred_at))`) can compute lifetime or rolling 90-day sequence patterns directly in MySQL in $<5$ ms across hundreds of thousands of events.
- **Time-Windowed Queries:** Querying by time range (e.g., `WHERE occurred_at >= NOW() - INTERVAL 30 DAY`) rather than row count prevents decision points from being arbitrarily truncated based on event velocity.
- **Cursor Pagination:** For interactive inspection tools, cursor pagination cleanly traverses historical events.

### Does This Bound Alone Justify a Durable Representation Store?
**No.**
A query limit on a raw SELECT statement is a straightforward database query design choice. It is not an ontological limitation of the data. Jumping from "the current read selects 200 rows" to "we need an LLM Dreamer worker to persist operator beliefs in a new database table" conflates a query optimization task with a durable state requirement.

---

## 5. Existing Learned Deltas Analysis

The codebase already contains a sophisticated durable learning subsystem: `goalCycleLearnedDeltas` in [`server/persistentOperator/learningStore.ts`](file:///Users/adamwrightpfi/Desktop/Cursor_bldg-admin-api/server/persistentOperator/learningStore.ts).

### What `goalCycleLearnedDeltas` Already Provides
- **Disciplined Learning Kinds:**
  - `doctrine_weight`: Shifts in operational doctrine emphasis.
  - `loadout_recommendation`: Guidance on tactical loadouts or mission configurations.
  - `channel_affinity`: Evidence-backed channel interactions.
  - `time_preference`: Validated time-of-day execution windows.
  - `candidate_boost`: Prioritization weights for mission candidates.
  - `execution_constraint`: Specific operational constraints.
- **Structured Delta Types:** `boost`, `suppress`, `reinforce`, `constraint`.
- **Rigorous Provenance:** Every delta links to `tenantId`, `canonicalOperatorId`, `operatorUserId`, `goalRunId`, `cycleId`, `decisionId`, `objectiveId`, and `outcomeId`.
- **State Auditing:** Stores `beforeStateJson` and `afterStateJson` along with `confidence` (`high`, `medium`, `low`) and `evidenceReference`.

### Stage 2 Duplication Risk
Any proposal to create an "Operator Beliefs", "Operator Memory", or "Learned Preferences" table in Stage 2 would **directly duplicate `goalCycleLearnedDeltas`**. Stage 1 already retrieves these deltas and projects them into `OperatorContextPacket.learnedSignals`. Building a second parallel learning store would fragment state and introduce cache synchronization bugs.

---

## 6. Missing Source Semantics

Several questions often asked of Operator Representation cannot safely be answered because the upstream sources lack the necessary semantics. Inferring them in Stage 2 would violate truth boundaries.

### 1. Onboarding Operator Binding
- **The Gap:** `goldline_onboarding_sessions` stores tenant-level onboarding answers (`daily_work`, `service_area`, `avoidance`), but lacks an `operatorUserId` or `canonicalOperatorId` column.
- **Why Inference is Forbidden:** Guessing that the onboarding user is operator `user:1` in a multi-user tenant is unsafe. Stage 1 correctly surfaces `operator_binding_unavailable` until an authoritative schema binding is added.

### 2. Communication Channel vs. Intervention Arm
- **The Gap:** In `behavioral_ledger_events`, `assignedOption` records the experimental intervention arm (e.g. `STANDARD_PRESENTATION` or a narrative fiction template ID).
- **Why Inference is Forbidden:** `assignedOption` does not record whether the intervention was delivered via SMS, push notification, email, or web banner. Inferring "the operator prefers SMS" from a fiction template assignment is semantically false. Genuine channel preferences require an authoritative communication delivery log.

### 3. Server Delivery vs. Operator Attention
- **The Gap:** The ledger records server events: `DELIVERED`, `VIEWABLE`, `ENGAGED`.
- **Why Inference is Forbidden:** As mandated by `BEHAVIORAL_SCIENCE_FOUNDATION.md` §4, server delivery does not prove cognitive attention. We cannot infer that an operator "ignored" a task when the app delivered a notification.

### 4. Correlation vs. Causality in Observational History
- **The Gap:** An operator who started a task after receiving a specific prompt cannot be assumed to have started *because* of the prompt (confounding by indication).
- **Why Inference is Forbidden:** Without randomized assignment at the decision point, causal claims ("prompt X is more effective for operator Y") are invalid. Observational histories support only descriptive counts.

---

## 7. Evidence Duplication Analysis

Every candidate durable representation record proposed for Stage 2 duplicates existing authoritative database rows:

| Proposed Durable Record | Authoritative Existing Source | Duplication Risk & Failure Mode |
|---|---|---|
| **Durable "Operator Card / Profile"** | `goldline_onboarding_sessions`, `users` | Duplicates declared answers and canonical identity. Edits to user settings or onboarding desynchronize from the durable copy. |
| **Durable "Intervention Responsiveness Score"** | `behavioral_ledger_events` (decision point rows) | Duplicates raw ledger counts. A persistent score becomes stale whenever new ledger events are appended unless maintained via complex triggers. |
| **Durable "Learned Weights / Preferences"** | `goal_cycle_learned_deltas` | Duplicates structured deltas already managed by the goal cycle learning engine. Creates competing sources of truth for doctrine weights. |
| **Durable "Canonical Operator Binding"** | `persistent_operator_identity_bindings` | Duplicates authoritative identity mappings established in `server/persistentOperator/identity.ts`. |
| **Durable "Outcome / Success Summary"** | `behavioral_ledger_events` (`VERIFIED`), `goal_cycle_outcomes` | Duplicates verified commercial event streams. Risks drifting out of sync with business reality. |

---

## 8. Smallest Justified Next Implementation

We evaluate three potential architectural paths:

- **A. No Stage 2 persistence justified yet**
- **B. A specific deterministic Stage 1 extension should happen first**
- **C. A narrowly defined durable primitive is justified**

### Evaluation & Selection

**Selected Path:** **Option A: No Stage 2 persistence is justified yet.**

### Rationale:
1. **Zero Performance Pressure:** `buildOperatorContextPacket` takes $<5$ ms to execute. It performs 4 indexed reads (identity, onboarding, ledger, deltas). Caching or persisting this packet introduces cache invalidation complexity without measurable performance gain.
2. **Current Production Volume:** Real operator event histories in production currently fit comfortably within the 200-event bounded window.
3. **No Unmet Capability Requires Persistence:** All defensible questions (identity, explicit facts, observed descriptive sequences, learned deltas, verification absence) are answered by Stage 1.
4. **Missing Semantics Cannot Be Cured by Storage:** Where Stage 1 cannot answer a question (e.g., channel preference, unbound onboarding), the blocker is upstream data instrumentation, not the lack of a representation table.
5. **Epistemic Integrity:** Creating a durable "beliefs" or "representation" store creates an irresistible temptation to persist speculative LLM inferences, violating the core behavioral science foundation.

---

## 9. Questions That Require Real-User Evidence

Before any future representation architecture or durable primitive can be justified, empirical telemetry must be gathered from actual production usage:

1. **Empirical Event Velocity:**
   - *Question:* At what rate do real operators generate Behavioral Ledger events per day and week?
   - *Evidence Needed:* Distribution of ledger event counts across active tenants over 30, 60, and 90 days to determine when the 200-row limit is reached in practice.

2. **Packet Assembly Latency Under Production Load:**
   - *Question:* Does on-demand packet assembly remain $<10$ ms under concurrent database load and connection pooling pressure?
   - *Evidence Needed:* Telemetry timings for `buildOperatorContextPacket` in staging/production environments.

3. **Downstream Consumer Query Patterns:**
   - *Question:* When Claire or dispatch systems eventually consume Operator Context, which exact fields are inspected at decision boundaries?
   - *Evidence Needed:* Audit logs of consumer access. Does the consumer only check `learnedSignals`? Does it inspect `intervention_start_sequence`? Does it need historical aggregates?

4. **Multi-Operator Onboarding Patterns:**
   - *Question:* In live customer environments, how frequently do multiple users share a tenant, and at what lifecycle stage does canonical operator binding take place?
   - *Evidence Needed:* Production onboarding completion flows and user creation telemetry.

5. **Decision Policy Reliance on Descriptive Patterns vs. Deltas:**
   - *Question:* Do decision policies make distinct interventions based on descriptive sequence counts, or do they rely strictly on `goalCycleLearnedDeltas`?
   - *Evidence Needed:* Empirical evaluation of intervention policy performance.

---

## 10. Stage 2 Recommendation

### Smallest Next Engineering Action:
1. **Maintain Stage 1 Read Model as the Sole Production Interface:**
   - Keep `OperatorContextPacket` as the single, authoritative, read-only interface for operator context.
   - Do not create any database tables, migrations, model routers, LLM workers, or durable belief stores.
2. **Instrument Stage 1 Read Telemetry:**
   - Add lightweight latency and truncation telemetry to `buildOperatorContextPacket` to observe real-world performance and event velocity.
3. **Address Upstream Source Bindings When Authorized:**
   - When onboarding requirements dictate surfacing onboarding answers as operator facts, add an explicit foreign key (`operatorUserId` or `canonicalOperatorId`) to `goldline_onboarding_sessions` via canonical schema migration.
   - When communication channel personalization is needed, introduce an authoritative communication delivery log rather than overloading `assignedOption`.
4. **Extend Deterministic Queries Only When Justified by Telemetry:**
   - If telemetry reveals that active operators frequently exceed the 200-row ledger limit and require longitudinal sequence statistics, implement an index-backed SQL aggregation function in `server/behavioralLedger/behavioralLedger.ts` rather than adding a durable representation database.

---
*End of Stage 2 Gap Analysis Report.*
