**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# SLICE 4 HANDOFF — Barrier → Intervention → Fiction Selection

**Status: production-truth pass on PR; not merge-ready until CI is green.**
**Branch:** `cursor/barrier-intervention-fiction-723a`
**PR:** #157
**Base:** `main` @ `49f372de` (Slice 3 merged via PR #156)
**Exact latest commit SHA:** `850fa1d1`
**CI status:** pending after this commit

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

Production wiring is **required** for this slice (not optional).

---

## Stable history identity

Slice 1 ops-task mirror is unchanged:

* `correlationId = ops_task:<taskId>` — **stable behavioral subject / history key**
* `sourceEntityId = <ops_task_event.id>` — **immutable source-event identity** (unique per lifecycle event)

History is assembled with `listBehavioralLedgerEventsForOperatorCorrelation(tenantId, operatorUserId, correlationId)`.

Do not assemble by `sourceEntityId`. That cannot accumulate multiple events for one task.

Other producers (`strategy_path_offer`, `commercial_mission`, etc.) are typed in `LEDGER_SOURCE_SYSTEMS` but have **no production writers yet**. Correlation is sufficient for the only live producer (ops tasks). A typed subject helper exists in `shared/behavioralSubject.ts` (`opsTaskBehavioralSubject` / `behavioralSubjectFromGrammar`) so non-ops grammars do not collide with ops-task rows.

Tenant + operator isolation remains on every read.

---

## Authoritative DEFERRED production

**There is currently no production DEFERRED producer.**

`server/opsTasks.ts` `mirrorOpsTaskEventToBehavioralLedger` maps:

* accepted → ACCEPTED
* started → STARTED
* completed → COMPLETED
* dismissed → DISMISSED
* expired → EXPIRED

Ops task statuses are `open | accepted | in_progress | completed | dismissed | expired`. There is **no explicit defer action** and no `deferred` status.

The selector **counts DEFERRED only when a ledger row with `eventType: "DEFERRED"` is present**. It does **not** infer DEFERRED from silence, NOT_COMPLETED, DISMISSED, EXPIRED, or lack of click.

Until an explicit operator defer action exists, the deferral-driven path stays dormant in production. Tests may inject realistic DEFERRED rows (distinct `sourceEntityId`, shared `ops_task:<id>` correlation) to prove the selector and Director bind.

---

## Production wiring path

1. `GoldlineDriverController` derives campaign chapter `ActionGrammar` (existing; no Driver UI redesign).
2. Subject = `behavioralSubjectFromGrammar(grammar)` (ops numeric ids → `ops_task:<id>`).
3. `trpc.system.goldlineWorld.behavioralEventsForSubject` loads tenant/operator-scoped ledger rows for that correlation.
4. `GoldlineGameHome` passes those events + campaign `fictionTemplateId` into `selectFictionForMission`.
5. `preferredTemplateIdForDirector` runs `selectPreferredFictionPresentation`.
   * behavior-supported eligible preferred id → that id
   * no evidence / insufficient → campaign preferred or `null`
6. Existing Director eligibility check still outranks preference, then `deriveFictionAssignment` hash fallback.

No second fiction system. `ActionGrammar` is read-only.

---

## Assignment mechanism

Replay-stable FNV among already-eligible templates is **`assignmentMechanism: "deterministic_policy"`**.

`assignmentProbability` is **`null`**. A hash pick is not an MRT and must not be recorded as `1/N`.

True randomization / exploration belongs in a later learning/experimentation slice.

---

## Barrier hypothesis model

- none / insufficient
- **possible scheduling/opportunity friction** (COM-B opportunity, TDF environmental_context_and_resources) when ≥2 **explicit DEFERRED** rows. Behavior-only evidence does **not** name “time”.
- **declared time constraint** when the operator declared `time`. Declaration outranks inferred deferral (standard/plain presentation).
- uncertainty text states this is not a motivational trait
- no diagnosis; no “works better”

---

## COM-B/TDF → BCW/BCT mapping

`ENABLEMENT_TIME_FRICTION` (in-code key; proposed BCT 1.4 / 8.7). `annotationStatus: proposed`. Foundation §2: we do not claim templates deliver these BCTs.

---

## Files changed (this pass)

- `shared/behavioralSubject.ts`
- `shared/behavioralEvidence.ts` (assemble by correlationId)
- `shared/behavioralFictionSelection.ts` (+ tests)
- `shared/behavioralInterventionMapping.ts`
- `server/behavioralLedger/behavioralLedger.ts` (+ tests)
- `server/behavioralSelection/selectPreferredFiction.ts` (+ tests)
- `client/src/game/fiction/fictionDirector.ts` (+ tests)
- `client/src/game/GoldlineGameHome.tsx`
- `client/src/pages/driver/GoldlineDriverController.tsx`
- `server/goldlineWorld/goldlineWorldRouter.ts`
- `.github/workflows/goldline-fast-smoke.yml`
- this file

---

## What remains

- Fast Goldline smoke / DayForge / mobile CI on this PR
- Persist decision-point fields onto a future DELIVERED event (out of slice)
- True randomization for MRT (next learning slice)
- Explicit operator defer action (not invented here)

Do not mark ready or merge until CI is green and the ten proofs pass.

## Tests

See `shared/behavioralFictionSelection.test.ts`, `server/behavioralSelection/selectPreferredFiction.test.ts`, `client/src/game/fiction/fictionDirector.test.ts`, ledger correlation aggregation.

## Next step

Push, wait for CI, read failing logs if any. Do not merge without instruction.
