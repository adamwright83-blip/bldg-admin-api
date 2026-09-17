**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# SLICE 4 HANDOFF — Barrier → Intervention → Fiction Selection

**Status: implementation on branch; CI not yet green.**
**Branch:** `cursor/barrier-intervention-fiction-723a`
**PR:** #157
**Base:** `main` @ `49f372de` (Slice 3 merged via PR #156)
**Exact latest commit SHA:** *set after this push*
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
```

Selection is **not** learning. No causal claims. `operator_avoidance` stays disabled.

---

## Architecture chosen

Pure shared selector plus a thin server reader:

1. `assembleBehavioralEvidence` — tenant/operator/task isolation; counts only named ledger events; DEFERRED is never inferred from NOT_COMPLETED.
2. Barrier hypothesis — `possible opportunity/time friction` from operator-declared `time` **or** ≥2 explicit DEFERRED. Never motivation/avoidance.
3. Mapping — in-code `ENABLEMENT_TIME_FRICTION` (`annotationStatus: proposed`). Existing `intervention_definitions` table is **not** written this slice (annotations stay out of the ledger).
4. Selection — `eligibleTemplates()` from `shared/fictionTemplate.ts`. Ineligible templates cannot be assigned. Insufficient evidence → `preferredTemplateId: null` → existing hash fallback in Fiction Director.
5. When ≥2 eligible fictions and behavior-observed deferrals: equal-probability pick via FNV of decisionPoint/task+counts; `assignmentProbability = 1/n`. Not true RNG (replay-stable). Honest: not an MRT yet.
6. Provenance on the returned decision object. Selector **does not write** ledger rows.

Existing hook: `selectFictionForMission({ preferredTemplateId })` already refuses ineligible preferred ids.

---

## Existing systems reused

- `shared/behavioralLedger.ts` event names
- `server/behavioralLedger/behavioralLedger.ts` (new list-by-operator-source read)
- `shared/fictionTemplate.ts` `eligibleTemplates` / `deriveFictionAssignment`
- `client/src/game/fiction/fictionDirector.ts` preferred-id bind (unchanged)
- `drizzle` `intervention_definitions` (schema already existed; unused as a write path here)

---

## Evidence model

Classes kept separate: `operator-declared`, `behavior-observed`, `claire-inference`, `historical-model-inference`.

This slice **produces** declared + observed. It does not auto-generate Claire or model inferences.

Counts: DELIVERED, VIEWABLE, ENGAGED, ACCEPTED, STARTED, COMPLETED, VERIFIED, DEFERRED, DISMISSED, EXPIRED.

---

## Barrier hypothesis model

- none / insufficient
- possible opportunity/time friction (COM-B opportunity, TDF environmental_context_and_resources)
  - `declared` if operator said time
  - `possible` if deferred ≥ 2
- uncertainty text states this is not a motivational trait
- operator declaration outranks inferred deferral (standard/plain presentation)

---

## COM-B/TDF → BCW/BCT mapping

`ENABLEMENT_TIME_FRICTION`: enablement; proposed BCT 1.4 action planning, 8.7 graded tasks. `annotationStatus: proposed`. Foundation §2: we do not claim templates deliver these BCTs.

---

## Template eligibility rules

`isTemplateEligible` unchanged. Unsafe driving+timer templates stay out. `STANDARD_PRESENTATION` is always in `eligibleOptions`. `preferredTemplateId` null means Director uses hash assignment.

---

## Provenance structure

`FictionSelectionDecision`: evidence, hypothesis, intervention record, eligibleOptions, assignedOption, assignmentProbability, policy/definition versions, selectionReason, claireSafeExplanation.

Claire may say: “This has come up N times and you deferred it M times…” or “You said time is the constraint…”. May not diagnose.

---

## Files changed

- `shared/behavioralEvidence.ts`
- `shared/behavioralInterventionMapping.ts`
- `shared/behavioralFictionSelection.ts`
- `shared/behavioralFictionSelection.test.ts`
- `server/behavioralLedger/behavioralLedger.ts`
- `server/behavioralLedger/behavioralLedger.test.ts`
- `server/behavioralSelection/selectPreferredFiction.ts`
- `server/behavioralSelection/selectPreferredFiction.test.ts`
- `.github/workflows/goldline-fast-smoke.yml`
- `docs/GOLDLINE-TASKS.md`
- this file

---

## What is complete

- Selector + 10 required tests
- Server read path (no history rewrite)
- Smoke workflow includes the new unit tests
- Typecheck error on `assignedOption` fixed

## What remains

- Fast Goldline smoke / DayForge / mobile CI on this PR
- Optional: Driver wiring of `preferredFictionTemplateId` from this selector (out of slice: no Dayplay redesign)
- Optional: persist decision-point fields onto the next DELIVERED event
- True randomization for MRT (next learning slice)

## Unresolved design questions

- Whether Driver should call the server selector this week or keep campaign `fictionTemplateId` until the mission-map surface exists
- When to start writing `intervention_definitions` rows vs keeping the in-code proposed registry

## Tests

`shared/behavioralFictionSelection.test.ts` (10), `server/behavioralSelection/selectPreferredFiction.test.ts` (1), ledger list isolation.

## Next step

Push, wait for CI, read failing logs if any. Do not merge without instruction.
