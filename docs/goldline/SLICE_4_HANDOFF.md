**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# SLICE 4 HANDOFF — Barrier → Intervention → Fiction Selection

**Status: started. Branch created off latest main. Implementation not yet complete.**
**Branch:** `cursor/barrier-intervention-fiction-723a`
**Base:** `main` @ `49f372de` (Slice 3 merged via PR #156)
**Exact latest commit SHA:** *updated after each push*
**CI status:** not started

---

## ⚠️ Naming collision

This is **behavioral-science roadmap Slice 4** (barrier → intervention → fiction/`preferredTemplateId`).

It is **not** BUILD_BRIEF “Slice 4 — Mission Director,” and not the mobile mission-map system in `docs/goldline/DAYPLAY_DRIVER_MISSION_MAP_SYSTEM.md`.

---

## Exact objective

Connect **real behavioral evidence** (ledger / resistance signals / operator-declared barriers) to the **existing** fiction-template selector so a legitimate real-world task can be presented differently without changing the business action.

Governing chain (foundation §3):

```
observed evidence
  → possible barrier (TDF, not diagnosis)
  → COM-B
  → BCW intervention function
  → BCT annotation (proposed)
  → eligible fiction/template (safety/eligibility first)
  → preferredTemplateId
```

Selection is **not** learning. No causal claims. No n=1 “this works better.” `operator_avoidance` stays disabled.

---

## Architecture chosen

*(Filled after inspecting production. Placeholder until first implementation commit.)*

Likely shape, pending inspection:

1. Evidence assembler (tenant/operator/task scoped; four epistemic classes kept separate)
2. Barrier hypothesis layer (uncertain, sourced, never diagnostic)
3. Versioned mapping through COM-B/TDF → BCW → BCT (`annotationStatus: proposed`)
4. Filter existing templates; set `preferredTemplateId`
5. Provenance at the decision point (MRT-ready fields if the ledger already has them)

Reuse existing StrategyEngine / fiction / behavioral-ledger interfaces. Do not build a parallel intervention system.

---

## Existing systems reused

*To be listed after inspection.* Candidates: `server/behavioralLedger/`, fiction templates, `preferredTemplateId`, StrategyEngine decision policy, `assertFictionSafety` / timer safety.

---

## Evidence model

Preserve as **separate classes**, never one user trait:

- `operator-declared`
- `behavior-observed`
- `Claire inference`
- `historical/model inference`

Counts of DELIVERED / ENGAGED / DEFERRED / STARTED / COMPLETED. DEFERRED only from an explicit operator act. No `IGNORED`, no `EXPOSED`.

---

## Barrier hypothesis model

Possible TDF domain + COM-B component + evidence strength + source type + supporting observations + explicit uncertainty. Insufficient evidence → no fabricated barrier; conservative/standard presentation.

---

## COM-B/TDF → BCW/BCT mapping

Hypotheses with provenance. Registry version recorded. Nothing `expert_reviewed` or `empirically_supported` in this slice.

---

## Template eligibility rules

Safety and business eligibility **outrank** behavioral preference. Ineligible/unsafe templates cannot be selected. `STANDARD_PRESENTATION` remains in the option set when safe.

---

## Provenance structure

Must explain: evidence considered, observed vs inferred, barrier hypothesis, intervention function / BCT mapping, eligible templates, why chosen, policy/version. Assignment probability when ≥2 eligible templates (foundation §5).

---

## What is complete

- Branch off `49f372de`
- This handoff file
- Draft PR (this commit)

## What remains

- Inspect production selector / ledger / templates
- Implement assembler, hypothesis, mapping, selection, provenance
- Focused tests (10 required cases)
- Typecheck + existing strategy/Claire tests
- Green Fast Goldline smoke, DayForge, mobile gates
- Final handoff SHA + CI status

## Unresolved design questions

- Which existing selector owns `preferredTemplateId` in production (not prose)
- Whether intervention_definition registry already exists
- How operator-declared barriers are stored today

## Tests

Not written yet.

## Next step

Inspect production code for `preferredTemplateId`, fiction templates, behavioral ledger, resistance signals; then implement against those interfaces.
