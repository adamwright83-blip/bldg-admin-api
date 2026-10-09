# JOYSTICK Architecture Convergence — Living Status & Remaining Work

> **Purpose**
>
> This is the canonical living roadmap for the repository-wide architecture convergence campaign.
> Fresh ChatGPT / Claude / Codex sessions should read this file before reconstructing the program from chat history.
>
> This file records the intended architecture, completed major phases, remaining work, stop conditions, and the post-convergence repository-legibility program.
>
> **Important:** this is a roadmap, not a substitute for live repository inspection. Always fetch current `main`, list open PRs, and inspect the latest architecture audit docs before acting.

## Program A–D certification update — 2026-10-08

Programs A–D are certified on production source main `85415cb7292e6803092cb5fe835f4f0325f7907c`, after C20 (#498). The final documentation/test checkpoint records exact-head and post-merge proof. Read [Program D certification](./PROGRAM_D_CERTIFICATION.md) and its classified inventory for the actual scope, explicit historical ownership/amount holds, protected heads and four proven baseline test failures. This is architecture certification, not an all-tests-green or business-release claim.

## Program E execution update — 2026-10-08

Program E (LLM Legibility, Physical Repository Reorganization, and Cold-Model Certification) is actively executing:
- **E0 (Classification & Protected Work Register):** MERGED (#501)
- **E1 (Canonical Root Narrative ARCHITECTURE.md & Subsystem Contracts):** MERGED (#502)
- **E2 (Core Business Domains: Payment, Orders, Commercial):** MERGED (#505, #506, #508)
- **E3 (Platform Authority, Tenancy, Execution, Integrations):** MERGED (#507, #509, #510)
- **E4 (Planning & Agents Subsystems):** MERGED (#511, #512, #514)
- **E5 (Experience & Game Relocation: Orders, World Split, Geography/Planning, Modes):** MERGED (#515, #516, #517, #518)
- **E6 (Legacy DayForge Quarantine Consolidation into `server/legacy/dayforge/`):** MERGED (#519)
- **E7 (Architecture Documentation Audit & Ratchet Synchronization):** IN PROGRESS (#520)
- **E8 (Independent Cold-Model Certification):** PENDING

Current verified main: `835200c2aae3d729c13b30fe9d9dcfd6e15d862d` (post-PR #519).

Primary supporting audit docs:

- `docs/architecture/PROGRAM_A_SLICE_5.md`
- `docs/architecture/PROGRAM_B_AUDIT.md`
- `docs/architecture/PROGRAM_C_AUDIT.md`
- `docs/architecture/TARGET_DOMAIN_CONTRACT.md`
- `docs/architecture/domain-boundaries.json`

---

# 1. Architecture North Star

The repository is converging around:

**one owning domain → one legal write path → explicit evidence/admission → explicit canonical read surface → downstream consumers**

A subsystem is not authoritative merely because it can write a table.

A consumer must not reconstruct business authority from weak fields when an owning domain already exists.

Workers must not become a second business-logic layer.

External evidence must not impersonate native truth.

Read models must not silently become write authority.

Game/world projections may consume real business truth; they may not invent it.

Missing tenant authority must not silently become normal `"default"` SaaS authority.

---

# 2. Frozen Business Rules

These rules are architecture constraints, not suggestions.

## Orders

Native order lifecycle belongs to Orders.

Normal production creation and lifecycle mutation must cross canonical Orders application authority.

## Payment

A status transition must not establish `paid = true`.

Native payment truth belongs to canonical Payment admission/evidence.

A payment receipt proves admission. A historical dollar amount remains unknown unless durable provider/capture evidence establishes the amount.

Editable order price must not become historical paid-dollar truth.

## Commercial

Commercial `won` means verbal yes / accepted commercial conversion.

`won` is not payment.

## CleanCloud

CleanCloud is external evidence.

It is not native JOYSTICK payment truth.

The historical tenantless `cleancloud_legacy_orders` importer remains an explicit legacy/data-policy exception. Do not assign its unknown tenant rows to `"default"`.

## Driver

Driver is not Vendor.

Driver may authorize/translate Driver interactions but must not own native order lifecycle.

## Game / Reality Bridge

A real verified business outcome may change the game.

The game may not create the customer, payment, dollar amount, visit, delivery, or commercial win.

Fiction may reinterpret presentation; it may not rewrite reality.

---

# 3. Completed Foundation

The following architecture domains have been substantially converged and should not be casually reopened:

- Orders authority
- Fulfillment authority
- Payment / revenue authority
- Ownership
- Commercial lifecycle
- CleanCloud / external-evidence boundary
- SaaS / tenant production certification
- tenant / actor authority separation
- platform authority containment
- Authority Receipt / admission patterns
- planning authority
- action / execution authority
- Claire domain-port convergence

---

# 4. Program A — Workers / Outbox / Execution Convergence

## Status: effectively certified

Merged work includes:

- **#456 — Slice 1:** Worker Admission & Execution Context
- **#459 — Slice 2:** Outbox Correctness / Durable Publication
- **#460 — Slice 3:** Retry / Claim / Lease / Recovery
- **#461 — Slice 4:** Shared Action Execution Gate
- **#465 — Slice 5:** Laundry Order Write-Path Convergence

Program A established:

- durable job identity and tenant/actor/source/idempotency context
- domain-port delegation rather than worker-owned business truth
- durable outbox claim/lease/publication behavior
- retry/recovery and stale-worker fencing
- a neutral final action-execution gate
- canonical Orders/Payment production mutation ownership
- Orders architecture guards
- observable execution state through existing tenant/actor/job/attempt/lease/error/health witnesses

Do not add an observability dashboard merely to satisfy an old roadmap label if the real execution state is already durable and diagnosable.

Program A should be reopened only if a later hostile scan proves an actual surviving bypass.

---

# 5. Program B — Reality Bridge + Game Downstream Integrity

## Status: advanced, final certification still required

Goal:

**authoritative business truth → canonical reader/projection → Reality Bridge → game/world consequence**

Never:

**game/world state → invented business truth**

Merged slices include at least:

- **#466 — B1:** Recovery Intent Truth Boundary
- **#467 — B2:** Payment-Admitted Customer and Game Truth
- **#468 — B3:** Commercial-Owned World Facts
- **#469 — B4:** Admitted Payment History
- **#473 — B5:** Tower Wars Economic Reality Boundary

Program B has already removed multiple reverse-authority paths, including:

- game recovery intent being treated as verified real recovery
- weak paid flags / PaymentIntent strings being treated as sufficient payment truth
- game/world services reconstructing Commercial facts themselves
- customer payment history asserting unadmitted payment occurrences
- Tower Wars reading weak economic evidence and mutable order prices as authoritative dollars

## Remaining Program B work

Before certifying B, perform a live hostile scan of every business-dependent game/world surface and classify whether it:

1. consumes canonical truth;
2. consumes a canonical projection;
3. is fiction-only / presentation-only;
4. reconstructs truth from weak fields;
5. can write/invent real business state;
6. can duplicate downstream consequences on replay.

Likely surfaces include, where still applicable:

- Lantern City
- world/geography surfaces
- territory projections
- progression
- Tower Wars
- Kingdom-related business-dependent unlocks
- Rook/CONTACT business-dependent consequences
- Money / Business World
- customer/account projections
- verified field outcome projections

Pure art/rendering should not be rewritten as part of architecture convergence.

Program B is complete only when no game/world system can manufacture business truth and every business-dependent game fact traces to an owning-domain reader/projection.

---

# 6. Program C — System-wide Read-Model / Legacy-Boundary Cleanup

## Status: in progress

Goal:

**owning domain → canonical reader / explicit projection → consumer**

Avoid:

**consumer → raw weak field → reconstructed authority**

Merged slices include at least:

- **#470 — C1:** Orders Customer-History Reader
- **#471 — C2:** Admitted Reminder-Conversion Truth
- **#472 — C3:** Immutable Native Paid-Dollar Evidence

C3 established the explicit money rule:

> A Payment receipt proves payment admission. Historical amount is unknown unless durable provider/capture evidence establishes it. Current editable order price must never become canonical historical paid dollars, customer value, or game/business truth.

## Known remaining Program C audit targets

The latest C audit identified remaining independent raw monetary/read consumers that still require classification and, where necessary, migration. Known examples include:

- Level 4 referral selection
- native freshness calculations
- vendor dashboard
- capability/order statistics

The broader C scan must also inspect:

- raw cross-domain reads
- duplicated projections
- legacy/compatibility readers
- stale helper functions
- admin/dashboard aggregates
- customer history
- payment/revenue history
- delivered/won/paid reconstruction
- geography/customer aggregate readers
- strategy/planning consumers
- Claire or agent consumers that bypass canonical read surfaces
- read models that also mutate truth

Classify each read as:

1. canonical domain reader
2. canonical projection
3. legitimate analytics reader
4. explicit compatibility read
5. stale duplicate projection
6. illegal raw cross-domain authority reconstruction
7. unresolved historical/data-policy boundary

Do not build a giant `GlobalReadService`.

Prefer domain-specific readers and explicit composition.

If a historical row lacks tenant identity, document the exception rather than assigning `"default"`.

Program C is complete when authoritative business facts are consumed through owning readers/projections and stale shadow authority is eliminated or explicitly quarantined.

---

# 7. Program D — Final Architecture Integrity / Completion Certification

## Status: not yet complete

Program D is a hostile final scan, not a new product build.

After B and C are complete, scan current main for:

- raw native `orders` writes
- raw native paid writes
- alternate lifecycle helpers
- cross-domain business writes
- game code writing/inventing business truth
- workers reconstructing business truth
- Commercial win mutation outside Commercial authority
- consumers reconstructing `paid`, `won`, or `delivered` from weak fields
- missing tenant → `"default"` fallbacks
- read models with mutation side effects
- duplicate authoritative projections
- consequential fire-and-forget effects without durable witness
- stale architecture PRs that could reintroduce superseded authority rules

Run current equivalents of:

- `pnpm check`
- `pnpm check:nomenclature`
- `pnpm check:tenant-ratchet`
- `pnpm check:vertical-dependencies`

Plus relevant established domain, SaaS, worker, outbox, Reality Bridge, read-model, MySQL, and migration certification suites.

A failure may be called baseline only after proving it also fails on the relevant starting main.

## Program D completion rule

Say **ARCHITECTURE CONVERGENCE CERTIFIED** only if the final repository proves:

1. one legal Orders write path;
2. one legal native Payment authority path;
3. no unauthorized production lifecycle writes;
4. no unauthorized paid-state writes;
5. workers do not recreate business authority;
6. game/world code cannot manufacture business truth;
7. canonical read surfaces replace shadow authority reconstruction;
8. missing tenant authority does not become new `"default"` authority;
9. deliberate historical exceptions are explicitly isolated/documented;
10. protected concurrent work has not reintroduced superseded architecture.

If one genuine bypass remains, architecture convergence is not certified.

---

# 8. Program E — LLM Legibility & Physical Repository Reorganization

## Status: planned; DO NOT begin before Program D certification

Program E exists because semantic correctness and repository comprehensibility are different goals.

The repository can have correct ownership while still forcing a cold LLM to reconstruct the product from dozens of peer folders and overlapping names.

The objective is:

> **Make partial understanding visibly partial, and make complete understanding cheap.**

A competent LLM encountering the repository cold should quickly understand:

- what JOYSTICK is and its value proposition
- what the major product surfaces are
- what Claire, Daphne, President, and Mitch each own
- what Day Line / planning does
- who owns Orders
- who owns Payment
- what Commercial `won` means
- what CleanCloud represents
- what Lantern City / game/world systems are allowed to do
- where to make a change
- which code is legacy
- which facts it has verified versus inferred

## Why Program E must wait

Do not perform broad folder moves while Programs B/C/D are still changing semantic ownership and read boundaries.

Moving files before ownership is stable creates:

- unnecessary merge conflicts
- stale branch hazards
- prettier but still conceptually wrong folders
- accidental reintroduction of old authority paths

First finish truth convergence. Then make the filesystem visibly express that truth.

## Program E intended work

After Program D:

### A. One canonical start-here architecture document

Create a root-level `ARCHITECTURE.md` or equivalent that explains in a few minutes:

- JOYSTICK value proposition
- major product/agent surfaces
- business domains
- ownership map
- write/read authority
- Reality Bridge
- integrations
- legacy boundaries
- where to change common behaviors

### B. Machine-readable ownership map

Maintain:

**concept → owning domain → legal write API → canonical read API/projection → downstream consumers**

### C. Physical repository taxonomy

Evaluate restructuring the current broad `server/` root into a small obvious taxonomy, for example:

- `domains/`
- `agents/`
- `experience/`
- `integrations/`
- `platform/`
- `legacy/`

Exact names must follow the actual post-D architecture rather than being imposed prematurely.

### D. Resolve ambiguous peer names

Reduce or document ambiguity among areas such as:

- `goldline`
- `goldlineWorld`
- `businessWorld`
- `driverGameWorld`
- `lanternCity`
- `worldForge`

A cold model should not have to guess which one owns business truth versus projection versus rendering.

### E. Quarantine legacy architecture

Move or clearly isolate legacy naming/surfaces where safe.

Historical compatibility must remain functional but visibly non-canonical.

### F. Break up catch-all composition files

Where justified, reduce giant composition surfaces such as:

- `server/routers.ts`
- `server/_core/index.ts`

so they primarily compose modules instead of hiding domain behavior.

### G. Major subsystem contracts

Each major subsystem should have a short machine-readable/human-readable contract describing:

- owns
- reads
- writes
- legal entrypoints
- downstream consumers
- must never own

Avoid long prose duplicated across source files.

### H. Archive / label stale design material

A fresh LLM should not mistake old handoffs or rejected design branches for current product truth.

### I. Cold-model comprehension test

Program E is not complete merely because folders look cleaner.

Acceptance should include independent cold-model tests using no chat history.

Ask a fresh model questions such as:

1. What is JOYSTICK?
2. What are its primary value propositions?
3. What do Claire, Daphne, President, and Mitch each own?
4. What system owns order lifecycle?
5. What system owns payment truth?
6. What does Commercial `won` mean?
7. What is Lantern City?
8. Can game state create a customer/payment/win?
9. Where would you change a Driver delivery rule?
10. Where would you change Claire's learned communication preferences?
11. Which directories are legacy?
12. Which claims in your answer are verified from code/docs versus inferred?

Require file evidence for major answers.

A model that inspected only part of the repository must identify those gaps as UNKNOWN rather than silently extrapolating.

## Program E completion rule

Program E is complete when multiple competent cold models can independently and correctly reconstruct the system's major value propositions, ownership boundaries, and change locations with minimal browsing and explicit evidence.

Once that criterion is met, stop reorganizing. Do not pursue aesthetic perfection.

---

# 9. Fresh-Chat Startup Protocol

A new architecture conversation should begin:

1. fetch current `main`;
2. read this file;
3. read the latest Program B/C audit docs if those programs are not yet certified;
4. inspect open PRs, especially Daphne / President / Mitch and other architecture work;
5. compare this roadmap's snapshot against live repository state;
6. continue from the first incomplete program/slice;
7. never assume a chat summary is newer than `main`.

When this document and live repository disagree, live repository facts win and this document should be updated.

---

# 10. Current Execution Order

At this snapshot:

**finish Program B certification / remaining truth boundaries  
→ finish Program C read-side convergence  
→ Program D hostile final certification  
→ Program E LLM legibility & physical repository reorganization**

Do not begin Program E early simply because the current tree is visually messy.

Do not stop after every PR waiting for Adam when the next architecture slice is already clear.

Use separate coherent branches/PRs for rollback and proof, but continue automatically unless there is a genuine semantic collision, unresolved tenant/data policy, or authority ambiguity.
