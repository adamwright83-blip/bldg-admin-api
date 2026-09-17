**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# SLICE 6 HANDOFF — Claire relationship / safe longitudinal history

**Status: handoff scaffold; implementation not started.**
**Branch:** `cursor/behavioral-slice-6-claire-history-723a`
**PR:** *(filled after draft PR opens)*
**Base:** `main` @ `28a02e00` (Slice 5 merged via PR #158 / `6251551c`, plus post-merge handoff)
**Exact latest commit SHA:** *(filled after first push)*
**CI status:** not started

---

## ⚠️ Naming collision

This is **behavioral-science roadmap Slice 6** (Claire relationship / safe longitudinal history).

It is **not** BUILD_BRIEF Slice 6, not Echo follow-up Slice 6, not StrategyEngine plays Slice 6, not laundry vertical Slice 6.

Binding: `docs/goldline/BEHAVIORAL_SCIENCE_FOUNDATION.md` §9.

---

## Exact objective

Make Claire capable of using longitudinal history as genuine relationship knowledge while preserving epistemic boundaries.

```
REAL observed history
+ operator-declared information
+ verified shared experiences
+ bounded relationship state
+ relevant past behavioral/experiment context
  → safely retrieved relationship context
  → Claire can remember relevant shared history
  → no diagnosis, rewritten history, false causal learning, or manipulative intimacy
```

Claire may remember: "This came up three times and you deferred it twice."
Claire may not transform that into: "You avoid outreach."

---

## Preexisting infrastructure reused (do not rebuild)

- `server/claire/character/relationshipEmitters.ts` — G1 warmth allowlist; model cannot self-award
- `relationshipEvents.ts` / `relationshipState.ts` / `tierEngine.ts` / `compiler.ts` / `types.ts`
- Slice 3 assertion-guard / verified fact inventory
- Slice 1 behavioral ledger
- Slice 4 selector + Slice 5 experiment history
- `server/agents/humanApproval.ts` / `permissions.ts`

No new memory table. No second Claire.

---

## Files changed

*(filled after implementation)*

---

## History sources consumed

- Claire relationship events (tenant + operator + character scoped)
- Claire relationship state / disclosure tier
- Optional operator-declared preferences/barriers (caller-supplied; no new store)
- Optional observed ledger patterns (caller-supplied counts; observational language only)
- Optional Slice 5 experiment observations (caller-supplied; descriptive only)

---

## Epistemic classes

Kept distinct; never collapsed into generic "memory":

- `operator-declared`
- `behavior-observed`
- `verified-shared`
- `claire-inference`
- `historical-model-inference`
- `experiment-observation`

---

## Retrieval / ranking / budget

*(filled after implementation)*

---

## Relationship-state / emission rules

Existing dimensions unchanged. G1 remains binding. `operator_avoidance` stays OFF. Acceptance/CTA/path-choice never increases warmth.

---

## Production generation paths

Must wire the same assembler/compiler into:

- pre-drive brief (`writeClairePreDriveBrief`)
- pre-drive follow-up (`answerClairePreDriveFollowUp`)
- post-stop opening
- outcome confirmation

Inspected, not dumped into:

- business interrogation (numbers-only)
- encyclopedia (knowledge-seeking)

---

## Assertion-guard interaction

Current verified business truth outranks relationship memory. Historical framing when inventory no longer supports a current-state claim.

---

## Slice 5 experiment-history interaction

Neutral descriptive context only. No "works better" / trait inference from small randomized history.

---

## Module-permission rules

Foundation §8: executive-function / CBT / recovery language never auto-enables from observed behavior. Explicit operator permission only.

---

## Disclosure behavior

Existing tier/canon system. Fail closed on unresolved identity / missing DB. History is not a reward for compliance.

---

## Offboarding contract

Server/domain contract + tests. No UI redesign this slice. Closing uses only eligible verified/declared history. Does not delete business records. Remaining UI task recorded in `GOLDLINE-TASKS.md`.

---

## Privacy / retention

Reuse existing stores. No transcript-dump memory table. No cross-tenant/operator fallback.

---

## Migrations

None planned.

---

## Tests

25 required proofs (see overnight Slice 6 spec). Existing assertion-guard tests must remain green.

---

## Real DB integration status

*(filled after implementation)* — this environment has no production MySQL. Relationship loop tests use the existing in-memory store.

---

## CI status

not started

---

## Known limitations

*(filled after implementation)*

---

## Next roadmap work

Do not start Slice 7 in this run.
