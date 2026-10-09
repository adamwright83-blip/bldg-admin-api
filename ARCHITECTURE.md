> **LEGACY DAYFORGE COMPATIBILITY:** Retained historical literals in this file are compatibility/history only; they are not current architecture. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md.

# JOYSTICK Architecture Guide

## 1. What JOYSTICK Is

**JOYSTICK is a playable operating system for real business.**

It merges real operational business execution with a gamified progression interface. In JOYSTICK:
- **The business is real:** real customer laundry and dry-cleaning orders, real Stripe transactions, real commercial outreach visits, and real driver operations.
- **The game makes real work engaging and visible:** completing real work advances chapter progression, unlocks visual landmarks in Lantern City, triggers Goldline companion dialogue, and earns game progression.
- **The core rule of authority (The Reality Bridge):**
  $$\text{Real Evidence} \longrightarrow \text{Domain Admission} \longrightarrow \text{Canonical Business Fact} \longrightarrow \text{Canonical Read/Projection} \longrightarrow \text{Game Consequence}$$
  **The game never manufactures business facts.** A game event cannot create a customer, record an admitted payment, invent captured dollars, mark a commercial conversion, or confirm an order delivery.

---

## 2. Product Value Proposition

JOYSTICK transforms daily enterprise operations into a coherent, high-velocity mission loop:
- **For the Operator / Founder:** Claire serves as an intelligent chief of staff, synthesizing the day's critical tasks, customer recoveries, and follow-ups into a concise **Day Line**. Strategic improvements are modeled by President.
- **For the Driver / Field Team:** The Driver interface provides route planning, stop-by-stop execution, and customer check-ins, turning routine field logistics into mission gameplay with clear objectives.
- **For the Enterprise Customer:** Fast, reliable residential laundry/dry-cleaning service coordinated across building partnerships (OPUS, CPE) and retail facilities.

---

## 3. Major Systems Map

| System | Role & Purpose | Current Primary Location |
|---|---|---|
| **Orders** | Native order lifecycle authority, state transitions, resident intake, and canonical order history. | `server/domains/orders/`, `server/residentIntake.ts`, `server/domains/orders/driver/` |
| **Payment** | Native payment admission, durable Stripe capture evidence, receipt verification, and canonical revenue reads. | `server/domains/payment/`, `server/analytics/canonicalRevenue.ts` |
| **Commercial** | Commercial B2B accounts, proposals, campaign pipeline, visit attestation, and conversion (`won`). | `server/domains/commercial/`, `server/commercialMissions/`, `server/commercialProposals/` |
| **Platform Tenancy** | Multi-tenant identity, tenant resolution, and data isolation. Missing tenant is held unresolved, never defaulted. | `server/platform/tenancy/`, `server/saas/` |
| **Platform Authority & Execution** | Durable outbox, action execution gates, leases, retries, and authority receipts. | `server/platform/authority/`, `server/platform/execution/` |
| **Integrations** | External provider transport: CleanCloud (operational evidence), Stripe (card processing), Twilio (SMS/voice). | `server/integrations/cleancloud/`, `server/twilioPlatform/` |
| **Claire** | Operator-facing conversational intelligence, chief-of-staff briefing, call handling, and prompt generation. | `server/claire/` |
| **Daphne** | Operator preference learning, explicit correction ledger, causal model, and consent evidence. | `server/daphne/` |
| **President** | Autonomous executive improvement, source-backed reasoning, and project proposals. Reports to Adam. | `server/president/` |
| **Mitch** | Autonomous game producer and game development agent. Managed directly by Adam (President does not manage Mitch). | `server/mitch/` |
| **Day Line** | Operator's prioritized daily schedule, commitments, and active work agenda. | `server/dayDirector/`, `server/goldline/dayline/` |
| **Mission Director** | Sole deterministic ranker for candidate operational work and sales missions. | `server/missionDirector/` |
| **Experience / Goldline** | Game world state, chapter progression, fiction packs, driver game progression, and companion interactions. | `server/goldlineWorld/`, `server/driverGameWorld/`, `server/companions/` |
| **Lantern City** | Visual interactive city map composing authoritative business projections onto 2.5D visual landmarks. | `server/lanternCity/`, `server/goldlineWorld/lanternCityOverviewService.ts` |
| **Tower Wars** | Game mode where towers represent economic activity, consuming canonical admitted payment facts. | `server/towerWars/` |
| **Legacy Quarantine** | Quarantined historical compatibility code and database migration fixtures from DayForge. | `server/legacyDayforge*` |

---

## 4. Business Ownership & Authority Matrix

| Business Concept | Owning Domain | Legal Write Path | Canonical Read Path | Downstream Consumers | Forbidden Owners |
|---|---|---|---|---|---|
| **Order Lifecycle** | Orders | `transitionNativeOrderStatus`, `createOrReuseResidentOrder` | `server/domains/orders/orderHistoryReadService.ts`, `unpaidOrderReadService.ts` | Driver UI, Admin UI, Day Line, Lantern City | Driver, Game, Workers, Lantern City |
| **Payment Admission** | Payment | `admitNativePayment`, `recordAuthorityReceipt` | `server/domains/payment/nativePaymentReadService.ts`, `canonicalRevenue.ts` | Orders delivery fence, Revenue charts, Tower Wars | Orders status, Stripe webhook without receipt, UI checkmarks |
| **Captured Dollars** | Payment | Durable Stripe `amount_received` + receipt persistence | `server/domains/payment/nativePaymentReadService.ts`, `loadPaidOrderLedger` | Financial summaries, Tower Wars bank, True PnL | Mutable order price (`orders.total`), intake quotes |
| **Commercial Conversion** | Commercial | `server/domains/commercial/commercialPipelineService.ts` (`won` status) | `server/domains/commercial/commercialAccountReadService.ts`, `commercialFollowUpReadService.ts` | Day Line, Claire briefing, Lantern City unlocks | Payment, Orders, Game actions |
| **CleanCloud Evidence** | CleanCloud Integration | `assimilateCustomerTruth.ts`, `cleancloudPaidEvidence.ts` | `cleancloudPaidOrders.ts` | Order correlation, External reconciliation | Native Payment, Native Orders |
| **Tenant Identity** | Platform Tenancy | Explicit tenant resolver (`server/platform/tenancy/tenantIdentity.ts`) | `requireTenantId`, `getTenantScope` | All domain services | `COALESCE(..., 'default')` fallbacks |
| **Operator Preferences** | Daphne | `explicitPreferenceCorrection.ts` | `claireAdapter.ts`, `operatorCard.ts` | Claire prompt assembler | Direct unconsented profile edits |
| **Mission Ranking** | Mission Director | `missionDirectorService.ts`, `rankRankableWork` | `missionDirectorRouter.ts` | Day Line, Operator briefing | Persistent Operator, Claire, Experience |

---

## 5. Frozen Architectural Invariants

1. **One Domain $\to$ One Legal Write Path:**
   - Only `Orders` changes native order status. A driver requesting delivery calls the Orders boundary.
   - Only `Payment` admits payment receipts. A raw boolean `orders.paid = true` is NOT authority.
   - Commercial `won` represents an accepted verbal agreement or account commitment; it is NOT paid cash.
2. **Payment Occurrence vs. Captured Dollars:**
   - An admitted payment receipt proves that a payment *occurred*.
   - The *dollar amount* is authoritative ONLY when verified against immutable provider capture evidence (`amount_received`).
   - Current editable order prices (`orders.total`) or intake quotes must NEVER be substituted for historical captured dollars.
3. **The Reality Bridge:**
   - Business truth flows strictly downstream into the game.
   - Game actions (clearing a territory, completing a chapter, defeating a tower) cannot create real customers, forge payments, or confirm deliveries.
4. **Tenant Isolation:**
   - Missing tenant on historical records is unknown, not `"default"`.
   - Never introduce `COALESCE(tenant_id, 'default')` to manufacture tenant authority.
5. **Distinct Agent Jurisdictions:**
   - **Claire:** Operator conversation and operational chief of staff.
   - **Daphne:** Learned operator preferences and explicit correction consent.
   - **President:** Executive strategy and company self-improvement (reports to Adam).
   - **Mitch:** Game producer (reports to Adam; President does not manage Mitch).

---

## 6. Where to Make Changes (Developer & Model Change Guide)

| To change this behavior... | Change it in this location... | Important constraint / boundary |
|---|---|---|
| Native order status progression or delivery rules | `server/domains/orders/orderLifecycleService.ts` | Delivery requires matching Payment admission receipt. |
| Resident order intake logic | `server/residentIntake.ts` / `server/domains/orders/orderOwnership.ts` | S2S contracts with external `Cursor_residentapp` must remain stable. |
| Native payment admission or receipt policy | `server/domains/payment/paymentAdmission.ts` | Always persist provider evidence; never trust raw client flags. |
| Canonical revenue calculations or dollar reporting | `server/domains/payment/nativePaymentReadService.ts`, `server/analytics/canonicalRevenue.ts` | Use immutable captured cents; do not borrow editable `orders.total`. |
| Stripe webhook ingestion | `server/intake-stripe.ts` | Provider transport only; domain admission must cross Payment boundary. |
| CleanCloud sync or customer assimilation | `server/integrations/cleancloud/` | CleanCloud is external evidence; do not treat as native payment. |
| Commercial account conversion or pipeline stages | `server/domains/commercial/` | Commercial `won` is NOT paid revenue. |
| Deterministic daily mission ranking | `server/missionDirector/` | Sole deterministic ranker; Persistent Operator proposes, Mission Director ranks. |
| Claire conversation rules or prompts | `server/claire/turn/`, `server/claire/proactive/` | Check PR #495 holds before modifying active files! Claire must not bypass domain ports. |
| Daphne preference learning or correction store | `server/daphne/` | Check PR #495 holds before modifying active files! Daphne cannot fabricate business truth. |
| President executive proposals | `server/president/` | Preserve approval gates; President does not direct Mitch. |
| Mitch game producer logic | `server/mitch/` | Managed directly by Adam; do not conflate with shared builder tools. |
| Lantern City visual map & building display | `server/lanternCity/`, `server/goldlineWorld/lanternCityOverviewService.ts` | Composes projections; does not create native business facts. |
| Tower Wars gameplay mechanics | `server/towerWars/` | Consumes admitted payment evidence; cannot admit payments. |
| Action execution, retry, or worker leasing | `server/platform/execution/worker.ts`, `server/platform/authority/actionExecutionGate.ts` | Workers orchestrate domain commands; they do not invent business policy. |

---

## 7. Epistemic Coverage Disclosure Convention

When any AI coding agent or engineer conducts an architecture review or reports conclusions, they MUST clearly distinguish their epistemic basis:

- **`VERIFIED`**: Exact files, lines, and documents directly inspected and executed tests observed.
  - *Example:* "Verified via `server/domains/payment/paymentAdmission.ts#L42-L78` that `admitNativePayment` writes to `authority_receipts`."
- **`INFERRED`**: Logical conclusions supported indirectly by patterns or naming, but not yet verified in live source code.
  - *Example:* "Inferred that `server/dryCleanReceiptIntake.ts` routes through `Orders` because it returns an `orderId`."
- **`UNKNOWN`**: Uninspected subsystems, unverified assumptions, or missing evidence.
  - *Example:* "Unknown whether external CleanCloud sync handles multi-tenant store IDs without testing live credentials."

**Rule:** A model inspecting 15% of the codebase must never present itself as having understood 100%. Acknowledge what is unknown.

---

## 8. Relationship to Key Documents

- **`ARCHITECTURE.md` (This file):** Permanent canonical architecture entrypoint for human engineers and coding models.
- **`CLAUDE.md`:** Thin model bootloader pointing to `ARCHITECTURE.md` and listing critical runtime traps (external repo dependencies, agent permission gates).
- **`GOLDLINE_CANON.md`:** Narrative, story, and world canon. Contains fictional lore and companion rules.
- **`docs/architecture/ARCHITECTURE_CONVERGENCE_STATUS.md`:** Project history and convergence milestone tracking.
- **`docs/architecture/domain-boundaries.json`:** Canonical machine-readable ownership manifest and import ratchet rules.
- **`docs/architecture/PROGRAM_D_CERTIFICATION.md`:** Certified semantic convergence proof for Programs A–D.
