**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# SLICE 4 HANDOFF — Barrier → Intervention → Fiction Selection

**Status: merge-ready on PR #157. Not merged.**
**Branch:** `cursor/barrier-intervention-fiction-723a`
**PR:** https://github.com/adamwright83-blip/bldg-admin-api/pull/157
**Base:** `main` @ `49f372de` (Slice 3 merged via PR #156)
**Exact verified head SHA:** `a6b06ff6`
**CI on `a6b06ff6`:** 22/22 green (not the superseded `40aebd65` run)

---

## ⚠️ Naming collision

This is **behavioral-science roadmap Slice 4** (barrier → intervention → `preferredTemplateId`).

It is **not** BUILD_BRIEF “Slice 4 — Mission Director,” and not `docs/goldline/DAYPLAY_DRIVER_MISSION_MAP_SYSTEM.md`.

---

## Exact objective

Connect real behavioral evidence to the existing fiction-template selector so a legitimate real-world task can be presented differently **without changing the business action**.

```
observed evidence
  → possible barrier (TDF taxonomy, not diagnosis)
  → COM-B
  → BCW intervention function
  → BCT annotation (proposed)
  → eligible fiction/template (safety first)
  → preferredTemplateId
  → existing Fiction Director (`selectFictionForMission`)
```

Selection is **not** learning. No causal claims. `operator_avoidance` stays disabled.

Production wiring is **required** and is in this PR.

---

## Production wiring path

```
GoldlineDriverController
  → behavioralSubjectFromGrammar(campaign chapter grammar)
  → trpc.system.goldlineWorld.behavioralEventsForSubject({ correlationId })
  → GoldlineGameHome
  → preferredTemplateIdForDirector({ events, campaignPreferredTemplateId, registry })
  → selectFictionForMission({ preferredTemplateId })
```

- No Driver UI redesign.
- No second fiction system.
- `ActionGrammar` is read-only; presentation can change while the grammar stays the same.
- No useful history → `preferredTemplateId` is campaign preferred or `null` → existing Director hash fallback.
- Eligibility still outranks preference inside `selectFictionForMission`.

---

## Stable history identity

Slice 1 ops-task mirror is unchanged:

* `correlationId = ops_task:<taskId>` — **stable behavioral subject / history key**
* `sourceEntityId = <ops_task_event.id>` — **immutable source-event identity** (unique per lifecycle event)

History is assembled with `listBehavioralLedgerEventsForOperatorCorrelation(tenantId, operatorUserId, correlationId)`.

Do not assemble by `sourceEntityId`. That cannot accumulate multiple events for one task.

Other producers (`strategy_path_offer`, `commercial_mission`, etc.) are typed in `LEDGER_SOURCE_SYSTEMS` but have **no production writers yet**. Correlation is sufficient for the only live producer (ops tasks). `shared/behavioralSubject.ts` maps numeric/ops grammar ids to `ops_task:<id>` so non-ops grammars do not collide with ops-task rows.

Tenant + operator isolation remains on every read.

---

## Assignment mechanism

Replay-stable FNV among already-eligible templates is:

* `assignmentMechanism: "deterministic_policy"`
* `assignmentProbability: null`

A hash pick is not an MRT and must not be recorded as `1/N`.

True randomization / exploration is **Slice 5 (learning/experimentation)**. Not this PR.

---

## Barrier hypothesis model

- none / insufficient
- **possible scheduling/opportunity friction** (COM-B opportunity, TDF environmental_context_and_resources) when ≥2 **explicit DEFERRED** rows. Behavior-only evidence does **not** name “time”.
- **declared time constraint** when the operator declared `time`. Declaration outranks inferred deferral (standard/plain presentation).
- Not avoidance, motivation deficit, fear, laziness, ADHD, or personality.
- no diagnosis; no “works better”

---

## Authoritative DEFERRED production

**There is currently no production DEFERRED producer.** That is acceptable for Slice 4.

`server/opsTasks.ts` `mirrorOpsTaskEventToBehavioralLedger` maps:

* accepted → ACCEPTED
* started → STARTED
* completed → COMPLETED
* dismissed → DISMISSED
* expired → EXPIRED

Ops task statuses are `open | accepted | in_progress | completed | dismissed | expired`. There is **no explicit defer action** and no `deferred` status.

The selector **counts DEFERRED only when a ledger row with `eventType: "DEFERRED"` is present**. It does **not** infer DEFERRED from silence, NOT_COMPLETED, DISMISSED, EXPIRED, lack of click, no start, or repeated delivery.

Until an explicit operator defer action exists, the deferral-driven path stays **dormant in production**. Tests inject realistic DEFERRED rows (distinct `sourceEntityId`, shared `ops_task:<id>` correlation) to prove the selector and Director bind. No fake producer was added.

---

## COM-B/TDF → BCW/BCT mapping

`ENABLEMENT_TIME_FRICTION` (in-code key; proposed BCT 1.4 / 8.7). `annotationStatus: proposed`. Foundation §2: we do not claim templates deliver these BCTs.

---

## Local tests on `a6b06ff6`

`pnpm vitest run` — 54 passed / 5 files:

- `shared/behavioralFictionSelection.test.ts` (11)
- `client/src/game/fiction/fictionDirector.test.ts` (15)
- `server/behavioralLedger/behavioralLedger.test.ts` (11)
- `server/behavioralSelection/selectPreferredFiction.test.ts` (1)
- `server/opsTasks.behavioralLedger.test.ts` (16)

`pnpm check` (`tsc --noEmit`) clean on this head.

Proofs covered: distinct source event IDs under shared `ops_task` correlation; no cross-task bleed; no cross-tenant/operator bleed; grammar unchanged while presentation can change; empty history preserves fallback; ineligible templates cannot win; `assignmentProbability` null; operator-declared time outranks inferred deferral; NOT_COMPLETED/DISMISSED/EXPIRED do not manufacture DEFERRED; no causal “works better” claim.

---

## CI on `a6b06ff6` (22/22)

- Fast Goldline smoke: **pass** (`fast-goldline-smoke`, 6m41s)
- DayForge release gates: **pass** (`mobile-dayforge-release`, 1m31s)
- Goldline mobile regression: **pass** (all `mobile-*` jobs on the Goldline mobile workflow, including inhabited adventure, real-touch, visit-route, armory, driver shell)
- Also green: `release-journey`, Vercel preview

Superseded `40aebd65` 22-green does **not** count.

---

## Known non-blocking limitation

No production DEFERRED producer yet, so the deferral-driven preferred-template path will not activate on live ops tasks until an explicit operator defer action exists. Delivery/accept/start/complete/dismiss/expire mirroring still works.

Also not this slice: persist decision-point fields onto a future DELIVERED event; MRT randomization.

---

## Exact next roadmap slice

**Behavioral-science Slice 5 — learning / experimentation (MRT).** Randomized assignment with a real `assignmentProbability`, not deterministic 1/N theater.

Do not start Slice 5 from this PR. Do not build Dayplay mission-map, Spirit Human crusher, or a Driver UI redesign.

Optional adjacent work (not Slice 5): an explicit operator defer action that writes `DEFERRED` with a new `ops_task_event.id` and the existing `ops_task:<taskId>` correlation.

---

## Next step

Merge PR #157 when instructed. Do not merge from this agent unless asked.
