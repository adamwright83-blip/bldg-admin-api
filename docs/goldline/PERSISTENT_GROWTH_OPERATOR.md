# Persistent Growth Operator

Status: Phase 0 / PR 1 implementation contract. Later slices remain unimplemented unless this document says otherwise.

This document records the Phase 0 architecture for JOYSTICK's persistent growth operator. Current production/main and the binding repository contracts outrank this document.

## Baseline dependency

Phase 0 is stacked on PR #327, `chatgpt/claire-monday-challenge-repair`.

PR #327 repairs two contracts that Phase 0 must not silently absorb:

- Claire's Monday / first-call Weekly Mission Readiness handoff;
- Objective execution-type persistence for Mission / Challenge / Hybrid Objective.

Phase 0 must not merge independently of that prerequisite. The stacked base is intentional.

## Authority boundary

Phase 0 does not create a new decision authority.

- Brain V2 Executive Function remains the decision/grant authority.
- The existing agent runtime remains the execution permission and approval boundary.
- WeeklyIntent remains operator-owned and is never automatically locked, rewritten, or replaced.
- Mission Director and the existing candidate architecture remain the deterministic work-selection systems.
- Phase 0 adds contracts that later persistent-cycle slices can consume. It does not run a background cycle, mint a background grant, send a message, spend money, create a new Objective, or change Lantern City.

## Reuse matrix

| Existing primitive | Phase 0 treatment | Why |
|---|---|---|
| Brain V2 Executive Function | keep | One decision authority; non-conversational authority is Slice C. |
| Agent tool registry / permissions / human approval | keep | Existing execution boundary; action policy is Slice D. |
| Mission Director + Weekly Growth Candidates | keep | Existing deterministic candidate selection. |
| Weekly Mission Readiness / WeeklyIntent | keep | Operator owns strategic weekly commitment. |
| `VerticalTemplate` | extend | Existing seam was too shallow and mixed scenario estimates with vertical declaration. |
| StrategyEngine laundry play templates | keep behind explicit compatibility seam | Existing surface still depends on them; guessed costs/stops are not persistent-operator truth. |
| `OrderCustomerImportProvider` + `runTenantImport` | keep + compose | Batch imports still work; a broader source-adapter contract now surrounds them. |
| source coverage / source bindings | keep | They remain the only coverage/freshness clock. |
| Sales Intel teaching corpus | extend by strict read | Provider #1 for Execution Intelligence; no rebuild. |
| Armory usages/outcomes | extend | Add lineage and repair outcome aggregation without replacing the ledger. |
| SaaS entitlements | extend | Persistent-operator access must be persisted, not an in-memory flag. |
| Procurement durable worker | keep | Generalization belongs to Slice B, not Phase 0. |
| communication receipts / `agent_events` | keep | Receipt lineage is Slice G. |
| commercial domain / canonical revenue | keep | Outcome/economic observation is Slice I. |
| Behavioral Ledger / MRT fields | keep | Adaptive policy is Slice J; Phase 0 preserves stable lineage. |

Replacement is intentionally absent.

## Phase 0 contracts

### 1. Vertical Registry

Generic persistent-operator code depends on the `VerticalRegistry` interface.

Concrete vertical imports are isolated to the registry composition root. The registry fails closed for an unknown:

- vertical template;
- metric key;
- authoritative metric reader;
- outcome definition;
- obligation kind.

A template declares:

- stable metric keys mapped to server-side reader IDs;
- opportunity kinds;
- Campaign Library seed references;
- registered obligation kinds;
- outcome-definition IDs mapped to authoritative transitions;
- work families;
- allowed Execution Intelligence doctrine families;
- expected source capabilities;
- presentation defaults.

Executable readers are server-owned. Shared/client template data contains no callbacks.

The current `laundry_fluff_fold` StrategyEngine scenario remains available under `legacyStrategy` so existing behavior is not broken. Its guessed initiation cost, stop count, spend, geography and confidence fields are compatibility/scenario inputs only. The new persistent-operator core must not treat them as authoritative economics or execution policy.

### 2. Source Adapter super-contract

`TenantSourceAdapterManifest` describes a source by:

- stable provider key and adapter version;
- entity capabilities;
- connection modes;
- canonical identity keys;
- coverage bases;
- provenance;
- Goldline evidence class.

Coverage semantics point to the existing source-coverage system. Freshness points to the existing source-binding clock. There is no second freshness subsystem.

`OrderCustomerImportProvider` composes this contract while retaining `importBatch()`. `runTenantImport` remains the batch path.

CleanCloud CSV is exposed through the new manifest without changing the batch import behavior. Its declared entity capabilities are deliberately limited to the entities the current provider actually normalizes: customers and orders. The existing canonical-revenue and source-coverage test suites are included in the Phase 0 CI regression lane so the adapter refactor cannot silently redefine economic truth.

### 3. Execution Intelligence

`selectExecutionIntelligence({ tenantId, objectiveRef, context, limit })` is the generic interface.

Rules:

- `limit` is 0–3;
- stable technique identity is `teachingKey`, not the version-row ID;
- version is persisted separately;
- source artifact + exact transcript identity and transcript range remain attached;
- doctrine family is explicit;
- applicability preserves `whenToUse` and `whenNotToUse`;
- deterministic applicability may return zero, one, two or three items;
- no filler is invented;
- this interface does not generate candidates, select an Objective, or grant authority.

Sales Intel is provider #1. Its execution-eligible read requires accepted + active + not-superseded teaching, exact transcript/source linkage, and an extracted source artifact.

Sales Intel remains platform-global in the current schema. Phase 0 does not infer that every teaching is safe for every tenant. Tenant ownership/source-classification hardening remains Slice U work.

### 4. Tenant learning governance

Feature access and cross-tenant evidence use are different concepts.

`tenant_learning_governance` records:

- tenant;
- scope;
- immutable version;
- terms version;
- policy version;
- whether aggregation use is permitted;
- authorizing user;
- effective time;
- revocation time.

Phase 0 does not enable pooled learning. A future pooling path must require an active affirmative governance record in addition to any applicable product entitlement.

### 5. Armory J0

Armory usage now may preserve:

- `decisionPointId`;
- encounter reference.

Outcome associations preserve an explicit strength:

- `decision_point`;
- `encounter`;
- `mission_window_legacy`.

Existing historical broad-window rows read as `mission_window_legacy`.

Business outcome aggregation now uses distinct stable outcome reference semantics:

- one account win associated with eight usages = one business win;
- the eight usage↔outcome rows remain eight associations;
- usage count remains separately visible.

This repairs the fan-out defect without erasing historical association evidence.

### 6. Tenant correctness

The future persistent-operator lane has an explicit `tenantId + operatorUserId` scope contract. Missing identity fails closed; no new lane may substitute `default`.

The persisted SaaS capability key is:

`persistent_operator`

It is intentionally default-off. Existing legacy SaaS defaults do not implicitly enable it, including for the historical founder/default tenants. A plan or manual persisted entitlement must opt a tenant in.

CI includes:

- a default-tenant fallback ratchet: matching implicit tenant→`default` fallbacks may decrease but the net count may not increase;
- a vertical dependency check over generic persistent-operator modules: no direct concrete-template import or concrete vertical-ID branch.

The ratchet does not pretend the old fallbacks are gone. Existing examples remain, including the CleanCloud paid-order import seam.

## Migration

Phase 0 uses:

`drizzle/0101_persistent_growth_phase0.sql`

The schema change lands through all three required paths:

1. SQL migration file;
2. `drizzle/schema.ts`;
3. idempotent production path in `scripts/migrate.mjs`.

It adds:

- `armory_weapon_usages.decisionPointId`;
- `armory_weapon_usages.encounterReference`;
- `armory_weapon_outcomes.associationStrength`;
- `tenant_learning_governance`.

The service-level contracts continue to fail closed when a database is unavailable where required.

## Evidence and precision

Phase 0 does not redefine Goldline evidence classes. Existing values remain:

- `authoritative_external`;
- `operator_attested`;
- `derived`;
- `game_projection`.

Evidence proves only itself. Source-adapter evidence class does not by itself prove complete coverage.

Phase 0 does not redefine canonical economic precision. Existing source coverage and canonical-revenue semantics remain authoritative. Missing is not zero, incomplete is not exact, and a platform-reported value is not silently promoted to paid economic truth.

## Risk matrix

| Risk | Phase 0 control | Remaining owner |
|---|---|---|
| Core imports launch vertical directly | VerticalRegistry + CI dependency guard | later vertical additions must register at composition root |
| Adapter invents a new freshness clock | manifest points to existing source binding/coverage | Slice N real adapters |
| Sales Intel row is stale/orphaned | strict accepted/active/not-superseded + exact joins | Slice U tenant sharing classification |
| One outcome counted N times | distinct stable outcome aggregation | Slice J learning uses corrected counts |
| Feature entitlement mistaken for consent | separate learning-governance record | Slice Q |
| Founder/default fallback spreads | diff ratchet | later hardening reduces existing count |
| Persistent operator silently enabled | persisted entitlement is default-off | Slice C/B activation |
| Background lane lacks tenant identity | explicit tenant/operator scope contract | Slice C grant minting |
| Money or communications execute | no execution lane exists in Phase 0 | Slice D/P |
| Production recovery is insufficient | no infrastructure mutation in this PR | human production ops gate |

## Founder-shaped seam inventory

Status after Phase 0:

| Seam | Status | Phase 0 result |
|---|---|---|
| F1 conversational Brain V2 founder/default constrained | deferred | conversational Claire is deliberately not broadened |
| F2 grants need stronger tenant identity | reduced | future persistent lane requires tenant/operator scope; grant implementation is Slice C |
| F3 obligation sweep is read-triggered | deferred | durable cycles are Slice B |
| F4 freshness vocabulary is provider-shaped | reduced | generic adapter manifest consumes existing freshness clock; legacy vocabulary remains |
| F5 Night Shift is founder/in-process shaped | deferred | durable trigger migration is Slice B |
| F6 economic source types are laundry-shaped | deferred | opened as adapter capability contract; economic registry change is Slice N |
| F7 imports do not automatically become canonical economics | deferred | preserved intentionally; Slice N owns explicit ledger loader |
| F8 macro-goal metric catalog is laundry-oriented | reduced | templates now declare stable metric/reader IDs; wider reader catalog comes with later vertical work |
| F9 some feature flags are in memory | fixed for persistent-operator capability | `persistent_operator` uses persisted SaaS entitlement; unrelated flags remain |
| F10 Twilio sender is deployment-level | deferred | Slice P |
| F11 Sales Intel lacks tenant ownership | deferred | Phase 0 strict read does not claim tenant-private sharing is solved |
| F12 implicit `default` fallbacks exist | reduced | CI ratchet prevents net growth; existing fallbacks remain |
| F13 VerticalTemplate is shallow/placeholder-shaped | reduced | declarative contract + registry added; legacy StrategyEngine scenario quarantined |
| F14 verified-outcome producer registry sparse | deferred | Slice I |
| F15 Armory fan-out inflates wins | fixed | distinct stable outcome counting + explicit association lineage |
| F16 backup/PITR/restore proof | deferred / human-owned | no Railway or production-data mutation performed |

## Security / privacy status

Phase 0 adds no plaintext-key encryption scheme.

Envelope encryption, tenant-private Sales Intel ownership, deletion/export hardening and broader tenant-owned-table registry enforcement remain Slice U work. If safe key-management infrastructure is absent, encryption stays deliberately deferred rather than cosmetic.

Resident-app production contracts are untouched.

## Feature defaults

- `persistent_operator`: persisted capability, default off.
- cross-tenant pooled learning: off / not implemented.
- autonomous external communication: not implemented.
- autonomous financial/contractual actions: not implemented.
- real provider sends in CI: not added.
- conversational Claire tenancy: unchanged.
- Lantern City: unchanged.

## Worker lifecycle

Not implemented in Phase 0.

Slice B must generalize the existing procurement lease/worker mechanics rather than create another scheduler. Until then there is no persistent goal-cycle worker, lease, retry, heartbeat, fairness or dead-letter claim from this PR.

## Authority lifecycle

Not implemented in Phase 0.

Slice C must introduce the typed non-conversational Executive Function source and bind it to explicit tenant identity and the persisted entitlement. A macro goal alone must never become execution authority.

## Acceptance procedure for Phase 0

Code review should prove:

1. PR #327 remains a separate stacked prerequisite.
2. Generic vertical registry tests fail closed for unknown identifiers.
3. CleanCloud batch-provider compatibility remains intact and canonical revenue/source coverage regressions remain green.
4. Execution Intelligence returns 0–3 source-backed items and rejects a limit above three.
5. Armory test proves eight associations to one stable win remain one business win.
6. migration/schema/production migrate path all contain the Phase 0 schema changes.
7. learning governance denies missing, false, future or revoked consent.
8. persistent-operator capability is stored but default-off.
9. tenant scope refuses missing tenant/operator identity.
10. default-tenant ratchet and vertical dependency checks pass.
11. existing resident S2S, nomenclature, SaaS, Goldline and tenant-boundary gates remain green.

No browser acceptance is required for these server contracts. No claim should be made that production data or Railway was mutated.

## Deferred proof surfaces

Receipt, Scoreboard and Loadout Delta do not exist in Phase 0.

- Receipt is Slice G/K work.
- Scoreboard is Slice K work.
- Loadout Delta is Slice J/K work.

Until those slices land, there is no valid exercise procedure for those three read models. Do not manufacture screenshots or prose substitutes.

## Production operations gate

Unchanged and human-owned:

- reliable MySQL backups;
- restore drill;
- deliberate production billing configuration;
- controlled Stripe canary;
- retention dry run;
- bounded live retention run;
- clean production logs;
- PITR posture reported accurately.

Phase 0 performs none of these infrastructure mutations.
