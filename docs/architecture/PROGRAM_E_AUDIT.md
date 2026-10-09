> **LEGACY DAYFORGE COMPATIBILITY:** Retained historical literals in this file are compatibility/history only; they are not current architecture. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md.

# Program E — LLM Legibility, Physical Repository Reorganization, and Cold-Model Certification Audit

## 1. Executive Summary and Starting Checkpoint

- **Project:** JOYSTICK / Goldline Architecture Convergence — Program E
- **Starting Main SHA:** `7ba7310df76a142c053c9c2c857b750e207cb221` (Merged PR #499)
- **Preceding Milestone:** Program D Certified (`docs/architecture/PROGRAM_D_CERTIFICATION.md`) on production authority checkpoint `85415cb7292e6803092cb5fe835f4f0325f7907c`.
- **Target Invariant:** One owning domain → one legal write path → explicit evidence/admission → canonical reads → downstream consumers.
- **Core Mission:** Restructure the physical repository and its documentation so that a competent model encountering this repository cold immediately understands:
  1. What JOYSTICK is and why its major systems exist.
  2. Which system owns each concept and where to make changes.
  3. The clear distinction between verified code, inferred assumptions, and uninspected areas (epistemic honesty).
  4. The reality bridge: real business facts affect game state, but game state cannot manufacture business truth.

---

## 2. Baseline Status and Known Fixture Disclosures

The repository baseline was validated on commit `7ba7310df76a142c053c9c2c857b750e207cb221`:
- **TypeScript Check (`pnpm check`):** PASS (Clean zero errors).
- **Architecture Gates:**
  - `pnpm check:nomenclature`: PASS (Clean).
  - `pnpm check:tenant-ratchet`: PASS (+0 / -0 / delta 0).
  - `pnpm check:vertical-dependencies`: PASS (32 generic core files verified).
  - `pnpm check:domain-boundaries`: PASS (5 current-path rules verified).
- **Four Known Baseline Fixture Failures (inherited from Program D baseline, not regressed):**
  1. `server/geography/gumballCustomerTruth.test.ts`: payload digest fixture expects `51079...`, actual `59612...`.
  2. `server/money/moneyProjectionService.test.ts`: missing-native-proof fixture expects zero but its admitted external CleanCloud evidence yields 73,739 recorded cents.
  3. `server/towerWars/towerWarsDayDirector.test.ts`: arms the promise in authenticated user's visible Day Director state (actor/commitment identity fixture).
  4. `server/towerWars/towerWarsDayDirector.test.ts`: fulfills originating promise when its Day Director work completes.

---

## 3. Protected Concurrent Work Register

Before planning file movements, live open pull requests were audited to enforce non-collision guarantees:

| PR ID | Workstream / Owner | Branch Name | Protection Status | Scope & File Restraints |
|---|---|---|---|---|
| **#495** | Daphne / Operator Prefs | `fix/daphne-v2-durable-ack-concise-board` | **STRICT PROTECTION** | **ABSOLUTE MOVE BAN:** The 8 actively edited files (`server/claire/proactive/boardService.test.ts`, `server/claire/proactive/boardService.ts`, `server/claire/turn/claireTurn.ts`, `server/claire/turn/daphneV2RuntimeCorrection.mysql.integration.test.ts`, `server/claire/turn/daphneV2RuntimeCorrection.test.ts`, `server/daphne/claireAdapter.ts`, `server/daphne/explicitPreferenceCorrection.test.ts`, `server/daphne/explicitPreferenceCorrection.ts`) **MUST NOT** be moved, modified, or relocated while #495 is open. Defer those moves. |
| **#476** | Claire / Legacy Fixtures | `fix/claire-legacy-regression-fixtures` | **PROTECTED** | Claire legacy test repairs (`server/claire/*.test.ts`). Do not modify, rebase, or erase Claire tests or runtime guards. |
| **#411** | President / Autonomous Cycle | `chatgpt/president-autonomous-execution-gpt` | **PROTECTED** | Independent President execution fabric. Independent router registrations in `server/routers.ts` preserved. |
| **#375** | President / Executive OS B | `feat/president-executive-intelligence` | **PROTECTED** | Independent President intelligence store & schemas. Preserve. |
| **#374** | President / OS A Evidence | `feat/president-operating-system` | **PROTECTED** | Independent President foundation. Preserve. |
| **#359** | President / Stage 1 Selection | `feat/president-stage1-evidence-selection` | **PROTECTED** | Independent project selection. Preserve. |
| **#361** | Mitch / Runtime Coding Agent | `feat/mitch-autonomous-runtime-coding-agent-provider` | **PROTECTED** | Independent Mitch game producer coding agent provider. Do not alter or expand. |

---

## 4. Current Repository Taxonomy vs. Target Taxonomy

### Current Taxonomy Flaws (Starting `server/` Root)
Currently, `server/` contains over 100 top-level files and directories acting as flat peers:
- Business authority is scattered: `orders/`, `authority/`, `commercialPipeline/`, `commercialMissions/`, `customerAssets/`, `money/`, and loose files like `residentIntake.ts`, `dryCleanReceiptIntake.ts`.
- Generic pseudo-names confuse models: `joystick/` is a miscellaneous folder inside a repo named `bldg-admin-api` (JOYSTICK), housing driver orders and tenant identity; `businessWorld/` sounds like business truth but is a downstream projection; `goldlineWorld/` and `driverGameWorld/` mix game progression, world state, and operational writes.
- Provider integrations are mixed into business domains: `cleancloudBrowserSync/` sits at top level, loose `clearent.ts` sits at root.
- Legacy DayForge code is scattered across multiple top-level directories: `legacyDayforgeCoaching/`, `legacyDayforgeDemo/`, `legacyDayforgeEvents/`, `legacyDayforgeProof/`, `legacyDayforgeRelease/`, `legacyDayforgeRetention/`, `legacyDayforgeSecurity/`, `legacyDayforgeToday/`.

### Target Top-Level Taxonomy
```
server/
├── domains/              # Authoritative business domains (Orders, Payment, Commercial)
│   ├── orders/           # Native order lifecycle authority, intake, history read
│   ├── payment/          # Native payment admission, capture proof, canonical revenue reads
│   └── commercial/       # Account conversion, pipeline, commercial decisions
├── platform/             # Generic infrastructure, tenancy, neutral action execution
│   ├── authority/        # Cross-domain admission infrastructure, action execution gates, receipts
│   ├── tenancy/          # Tenant identity, resolution, multi-tenant isolation context
│   └── execution/        # Durable execution, workers, outbox, leasing
├── integrations/         # External third-party system transport & synchronization
│   ├── cleancloud/       # CleanCloud browser sync, raw ingestion, external evidence
│   ├── stripe/           # Stripe transport/SDK boundary
│   └── twilio/           # Twilio messaging & voice transport
├── agents/               # Distinct agent roles (Claire, Daphne, President, Mitch)
│   ├── claire/           # Operator-facing chief of staff / conversation
│   ├── daphne/           # Operator preference, correction, consent evidence
│   ├── president/        # Executive improvement & strategic advisor
│   └── mitch/            # Game producer & game dev agent
├── planning/             # Prioritization, work scheduling, mission ranking
│   ├── dayLine/          # Operator-facing day plan projection & commitments
│   └── missionDirector/  # Deterministic ranker & mission selection
├── experience/           # Game state, world progression, visual surfaces, projections
│   ├── goldline/         # Chapter state, world events, driver game progression, builder
│   ├── lanternCity/      # Operator city map view & business projection composition
│   └── towerWars/        # Tower Wars mode gameplay & economic consumption
└── legacy/               # Explicit historical compatibility code
    └── dayforge/         # Quarantined historical DayForge compatibility code
```

---

## 5. Architectural Classification & Migration Plan

### 5.1 Business Domains (`server/domains/`)
- **Orders (`server/domains/orders/`)**:
  - *Current Source:* `server/orders/**`, `server/residentIntake.ts`, `server/dryCleanReceiptIntake.ts`, `server/joystick/driverOrder*` (authoritative order mutations).
  - *Owns:* Order lifecycle (`pending_intake`, `scheduled`, `in_service`, `completed`, `cancelled`), driver order status transitions, resident order creation/reuse, order history reads.
  - *Legal Write Path:* `transitionNativeOrderStatus`, `createOrReuseResidentOrder`.
  - *Canonical Read Path:* `orderHistoryReadService.ts`, `unpaidOrderReadService.ts`.
  - *Forbidden:* Mutating Payment status directly; manufacturing paid dollars.
- **Payment (`server/domains/payment/`)**:
  - *Current Source:* `server/authority/paymentAdmission.ts`, `server/authority/nativePaymentReadService.ts`, `server/analytics/canonicalRevenue.ts`, `server/paymentReconciliation.ts`.
  - *Owns:* Native payment admission, provider capture proof, historical amount verification, canonical revenue reads.
  - *Legal Write Path:* `paymentAdmission.ts` (`admitNativePayment`, `recordAuthorityReceipt`).
  - *Canonical Read Path:* `nativePaymentReadService.ts`, `canonicalRevenue.ts`.
  - *Forbidden:* Inferring dollars from current editable order price; inferring payment from order status flags.
- **Commercial (`server/domains/commercial/`)**:
  - *Current Source:* `server/commercialPipeline/**`, `server/commercialMissions/**`, `server/commercialProposals/**`, `server/commercialCampaigns/**`.
  - *Owns:* Account conversion (`won`), commercial outreach, pipeline stages, visit attestation.
  - *Legal Write Path:* `commercialPipelineService.ts`.
  - *Canonical Read Path:* `commercialAccountReadService.ts`, `commercialFollowUpReadService.ts`.
  - *Forbidden:* `won` does not mean paid; cannot admit payment or capture dollars.

### 5.2 Platform (`server/platform/`)
- **Platform Authority (`server/platform/authority/`)**:
  - *Source:* `server/authority/actionExecutionGate.ts`, `server/authority/authorityReceipt.ts`, `server/authority/actionCompletionAdmission.ts`.
  - *Role:* Generic durable receipts, execution gates, cross-domain admission validation.
- **Platform Tenancy (`server/platform/tenancy/`)**:
  - *Source:* `server/joystick/tenantIdentity.ts`, tenant resolution helpers from `server/saas/`.
  - *Role:* Explicit tenant context. Missing tenant is held as unresolved/unknown, never defaulted.
- **Platform Execution (`server/platform/execution/`)**:
  - *Source:* `server/durableExecution/**`, `server/persistentOperator/actionExecution.ts`.
  - *Role:* Durable workers, outbox, claim, lease, retries.

### 5.3 Integrations (`server/integrations/`)
- **CleanCloud (`server/integrations/cleancloud/`)**:
  - *Source:* `server/cleancloudBrowserSync/**`, `server/cleancloudPaidEvidence.ts`, `server/cleancloudLegacy.ts`, `server/cleancloudCsvSheetSync.ts`.
  - *Role:* External operational evidence provider. CleanCloud observations must be explicitly admitted before affecting downstream state.
- **Stripe (`server/integrations/stripe/`)**:
  - *Source:* Stripe webhook and SDK transport handlers (distinguished from Payment domain admission).
- **Twilio (`server/integrations/twilio/`)**:
  - *Source:* `server/twilioPlatform/**`, `server/level4Twilio.ts`.
  - *Role:* SMS/Voice transport. Conversational policy remains in Claire.

### 5.4 Agents (`server/agents/`)
- **Claire (`server/agents/claire/`)**: Operator-facing conversational intelligence and chief of staff.
  - *Note on Protection:* 8 files touched by Daphne PR #495 must NOT be moved until #495 merges. Retain path stability.
- **Daphne (`server/agents/daphne/`)**: Operator preference learning, correction ledger, and consent evidence.
  - *Note on Protection:* Subject to PR #495 active work.
- **President (`server/agents/president/`)**: Executive improvement and source-backed reasoning. Reports to Adam. Does not manage Mitch.
  - *Note on Protection:* PRs #411, #375, #374, #359 active.
- **Mitch (`server/agents/mitch/`)**: Game producer and autonomous development agent. Direct management by Adam.
  - *Note on Protection:* PR #361 active.

### 5.5 Planning (`server/planning/`)
- **Day Line (`server/planning/dayLine/`)**: Operator-facing projection of today's prioritized work and commitments.
- **Mission Director (`server/planning/missionDirector/`)**: Sole deterministic ranker and mission selection system.

### 5.6 Experience & Game (`server/experience/`)
- **Goldline World (`server/experience/goldline/world/`)**: Chapter state, territory progression, world events.
- **Driver Game (`server/experience/goldline/driver/`)**: Driver game progression and presentation.
- **Tower Wars (`server/experience/towerWars/`)**: Mode gameplay rules, consuming admitted payment evidence.
- **Lantern City (`server/experience/lanternCity/`)**: Map view and visual composition of business projections.
- **World Forge (`server/experience/builder/`)**: World generation tools and image asset pipelines.

### 5.7 Legacy Quarantine (`server/legacy/`)
- **DayForge (`server/legacy/dayforge/`)**: Consolidated historical DayForge compatibility code (`legacyDayforge*`). Database tables and persistent contracts remain unchanged.

---

## 6. Sliced Execution Roadmap

1. **E0 — Classification and Migration Plan (Current PR):**
   - Publish `PROGRAM_E_AUDIT.md`.
   - Establish classification, protected file holds, and migration maps.
2. **E1 — Canonical Repository Narrative:**
   - Create root `ARCHITECTURE.md`.
   - Update `CLAUDE.md` to point cleanly to `ARCHITECTURE.md`.
   - Update `docs/architecture/domain-boundaries.json` and short subsystem contracts.
3. **E2 — Core Business Domains:**
   - Relocate Orders, Payment, Commercial into `server/domains/`.
   - Update references, guards, and test paths.
4. **E3 — Platform & Integrations:**
   - Relocate Tenancy, Authority, Execution into `server/platform/`.
   - Relocate CleanCloud and third-party adapters into `server/integrations/`.
5. **E4 — Agents & Planning:**
   - Structure `server/agents/` and `server/planning/`.
   - Strictly honor PR #495, PR #476, PR #411/#375/#374/#359, PR #361 protections.
6. **E5 — Experience and Game Decomposition:**
   - Split mixed folders (`goldlineWorld`, `driverGameWorld`, `worldForge`, `businessWorld`, `joystick`).
   - Relocate game state to `server/experience/`.
7. **E6 — Legacy Quarantine & Router Thinning:**
   - Consolidate `legacyDayforge*` into `server/legacy/dayforge/`.
   - Clean composition entrypoints (`server/routers.ts`, `server/_core/index.ts`).
8. **E7 — Final Legibility & Import Audit:**
   - Run repo-wide scan for obsolete directory references and eliminate dead aliases.
   - Synchronize all architecture docs to final paths.
---

## 7. Execution Ledger & Merged Slices

| Slice | PR | Branch / Head | Scope & Verification | Status |
|---|---|---|---|---|
| **E0** | #501 | `program-e/slice-0-classification-audit` | Initialized Program E classification audit, protected PR registers, and target taxonomy. All 4 architecture gates passed. | **MERGED** (`b48df520`) |
| **E1** | #502 | `program-e/slice-1-canonical-narrative` | Root `ARCHITECTURE.md`, `CLAUDE.md` model onboarding bootloader, machine-readable `conceptOwnershipMap` in `domain-boundaries.json`, and 5 subsystem contracts. All 4 gates passed. | **MERGED** (`99347208`) |
| **E2a** | #505 | `program-e/slice-2a-payment-domain` | Established `server/domains/payment/`. Relocated payment admission, native read services, and payment authority tests from `server/authority/`. Updated 22 consumer files and tests. `pnpm check` (zero errors), 4 architecture gates clean, 49 unit/contract tests passed. | **MERGED** (`b7ff10df`) |
| **E2b** | #506 | `program-e/slice-2b-orders-domain` | Established `server/domains/orders/`. Relocated order lifecycle, ownership, read services, and order architecture tests from `server/orders/`. Updated all consumers, tests, CI workflows, and architecture documents. Zero TS errors, all gates clean. | **MERGED** (`af89b95c`) |
| **E3a** | #507 | `program-e/slice-3a-platform-authority` | Established `server/platform/authority/`. Relocated execution gates, authority receipts, and admission validators from `server/authority/`. Updated 35 files across analytics, operators, tests, and workflows. Zero TS errors, all 4 gates clean. | **MERGED** (`cc2c1a36`) |
| **E2c** | #508 | `program-e/slice-2c-commercial-domain` | Established `server/domains/commercial/`. Relocated commercial pipeline, account/follow-up read services, payment authority mismatch reports, and tests from `server/commercialPipeline/`. Updated 40 files across Claire, system router, tests, and workflows. Zero TS errors, 118 tests passed. | **MERGED** (`b2be6c5c`) |
| **E3b** | #509 | `program-e/slice-3b-platform-tenancy-execution` | Established `server/platform/tenancy/` and `server/platform/execution/`. Relocated `tenantIdentity` from `server/joystick/` and `worker.ts` from `server/durableExecution/`. Removed empty `server/durableExecution`. Added subsystem contracts. Updated all consumers and workflows. | **MERGED** (`db46a9bf`) |
| **E3c** | #510 | `program-e/slice-3c-integrations-cleancloud` | Established `server/integrations/cleancloud/`. Relocated `server/cleancloudBrowserSync/` and 10 loose cleancloud files to `server/integrations/cleancloud/`. Added subsystem contract `server/integrations/cleancloud/README.md`. Updated all consumers, tests, CI workflows, and documentation. Deferral preserved for Twilio due to protected PR #476. | **MERGED** (`e67f1bfa`) |
| **E4a** | #511 | `program-e/slice-4a-planning-subsystem` | Established `server/planning/` hierarchy. Relocated `dayDirector/`, `dayline/`, and `missionDirector/` into `server/planning/`. Updated 141 files, contracts, tests, CI workflows, and documentation. Zero TS errors, all architecture gates clean. | **MERGED** (`02b9e288`) |
| **E4b** | #512 | `program-e/slice-4b-agents-subsystem` | Relocated `daphne/` to `server/agents/daphne/`, `persistentOperator/` to `server/agents/persistentOperator/`, and `operatorRepresentative/` to `server/agents/operatorRepresentative/`. Strictly respected protected boundaries (Claire PR #476, President PRs #411/#375/#374/#359, Mitch PR #361). | **MERGED** (`6f90f533`) |
| **E0-E4 Rec** | #514 | `codex/program-e-e0-e4-regression-recovery` | Restored uncommitted recovery state, fixed nomenclature marker checks, verified zero TS errors, verified 4 architecture gates pass. | **MERGED** (`53fe3b0b`) |
| **E5a** | #515 | `codex/program-e-e5a-driver-orders` | Relocated `server/joystick/driverOrder*.ts` into `server/domains/orders/`. Updated all consumers, routes, contracts. Zero TS errors, architecture gates pass. | **MERGED** (`d602fa60`) |
| **E5b** | #516 | `codex/program-e-e5b-world-split` | Relocated driver game world state into `server/experience/driverGameWorld/` and business projections into `server/experience/lanternCity/`. Preserved reality bridge. Zero TS errors, architecture gates pass. | **MERGED** (`69aa6777`) |
| **E5c** | #517 | `codex/program-e-e5c-geo-planning-split` | Relocated geography projections, world forge assets, and planning helpers. Updated all consumers and documentation. Zero TS errors, architecture gates pass. | **MERGED** (`76fd4e60`) |
| **E5d** | #518 | `codex/program-e-e5-world-owners` | Completed E5 world relocation: field targeting and journal relocated to `server/field/`, Tower Wars game mode relocated to `server/experience/goldline/modes/towerWars/`, and bootstrap initialization cleaned up. 104 files updated. Zero TS errors, architecture gates pass. | **MERGED** (`526b290d`) |
| **E6a** | #519 | `program-e/slice-6a-legacy-dayforge-quarantine` | Consolidated 8 `server/legacyDayforge*` roots (49 files) into quarantined directory `server/legacy/dayforge/`. Added president compatibility re-export to keep PRs #411/#375/#374/#359 100% untouched. Updated CI workflows, scripts, and build configs. Zero TS errors, all architecture gates pass. | **MERGED** (`835200c2`) |
| **E7** | #520 | `program-e/slice-7-architecture-audit` | Repo-wide architecture documentation synchronization, domain-boundaries.json path audits, CURRENT_CODEBASE_FINDER verification update, and legibility validation. | **IN PROGRESS** |

