**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# SLICE 5 HANDOFF — Randomized learning / MRT decision points

**Status: handoff scaffold; implementation not started.**
**Branch:** `cursor/behavioral-slice-5-mrt-learning-723a`
**PR:** *(filled after draft PR opens)*
**Base:** `main` @ `287e7dd53fa20ac6cd3da1a5c4accc07b12fc73e` (Slice 4 merged via PR #157 / `6a160056`, plus post-merge handoff cleanup)
**Exact latest commit SHA:** *(filled after first push)*
**CI status:** not started

---

## ⚠️ Naming collision

This is **behavioral-science roadmap Slice 5** (randomized assignment / MRT-readiness).

It is **not** BUILD_BRIEF “Slice 5 — Lantern City,” not Mission Director, not Dayplay mission-map, and not the Spirit Human crusher.

Binding: `docs/goldline/BEHAVIORAL_SCIENCE_FOUNDATION.md`. Slice 4 production baseline: `docs/goldline/SLICE_4_HANDOFF.md`.

---

## Exact objective

Turn Slice 1–4 observational presentation selection into a system that can generate **legitimate randomized evidence** about presentation effects.

```
eligible decision point
  → frozen eligible option set
  → genuine randomized assignment
  → real logged assignmentProbability
  → delivered / viewable / engaged / start / complete / verified events
  → predefined proximal outcome characterization
  → descriptive randomized comparison
  → NO automatic causal / product claim
```

Shipping this infrastructure **does not** earn a “works better” claim.

---

## Deterministic Slice 4 vs randomized Slice 5

| Mode | Mechanism | Probability |
|---|---|---|
| Policy A — deterministic (Slice 4, default) | `assignmentMechanism: "deterministic_policy"` | `assignmentProbability: null` |
| Policy B — randomized experiment (this slice) | `assignmentMechanism: "randomized_assignment"` | actual P(assigned \| frozen set, policy, DP) |

Never blur the two. Do not hash and call it randomization. Do not populate probability on deterministic assignments.

---

## Production path (reuse Slice 4; do not fork)

```
GoldlineDriverController
  → behavioralEventsForSubject
  → GoldlineGameHome
  → preferredTemplateIdForDirector
  → selectFictionForMission({ preferredTemplateId })
```

Experimental assignment is a **server-authoritative layer** that may supply `preferredTemplateId` among already-eligible options. Fiction Director eligibility/safety remains the final veto. `ActionGrammar` stays unchanged. Client cannot choose arm, probability, or availability.

---

## Decision-point identity

- **Behavioral subject** (Slice 4): `ops_task:<taskId>` — history across many occasions.
- **Decision point** (this slice): one intervention occasion. One DP → at most one assignment.
- One subject may have many DPs over time.

Will use the strongest immutable production identity available (inspect `ops_task_events` / offer ids; do not invent timestamp-only keys if an authoritative source id exists). Document the chosen key in this file after inspection.

---

## Experiment policy

Versioned, inspectable, testable. LLM does not author the probability distribution. Experimentation is **opt-in / policy-gated**, not default because N templates exist.

Planned fields: policy id/version, enabled, grammar/task eligibility, min option count, `includeStandardPresentation`, weights, availability rules, proximal window minutes, safety exclusions.

v1 default: **disabled in production** unless policy explicitly enables a narrow safe category. When disabled, Slice 4 deterministic path is unchanged.

---

## Randomization method

Server-authoritative CSPRNG (not FNV). Equal weights → record real `1/N`. Unequal weights → record the selected option's actual probability. Validate `0 < p <= 1` and frozen distribution sums to 1 within tolerance.

---

## Baseline arm

At eligible experimental DPs, include `STANDARD_PRESENTATION` (Slice 4 constant) as a genuine baseline of the **same** real action. Do not only compare two fiction treatments.

---

## Persistence / idempotency

Reuse Slice 1 ledger decision-point columns. No migration unless inspection proves a required field is missing.

First valid persisted assignment for `(tenantId, decisionPointId)` wins. Reloads return it. Do not re-randomize.

---

## Proximal outcomes

Window frozen at assignment (`proximalOutcomeWindowMinutes`). v1 characterizes observed ledger events after the DP: delivered/viewable/engaged/accepted/started/completed/verified, `startedWithinWindow`, `startLatencySeconds`. Absence is unknown, not `IGNORED`. Window is never rewritten after seeing results.

---

## Burden signals

Preserve dismissal rate, intervention frequency, explicit defer **if and only if** DEFERRED rows exist. **No production DEFERRED producer** (Slice 4). Do not manufacture one. Do not infer defer from silence, dismiss, expire, no start, or no click. Label defer metrics unavailable where that is truthful.

---

## Reporting / learning semantics

Allowed: counts by arm, availability, assignment, delivery, start-within-window, latency summary, completion/verification descriptive rates, burden descriptive rates, insufficient-sample state.

Forbidden in v1 output: “works better”, “caused”, “lift”, “significant”, “optimal treatment”, “responds best”.

No adaptive bandit / Thompson / UCB / RL. Fixed randomized policy.

**No causal efficacy claim has been earned merely by shipping Slice 5.**

---

## Files changed (scaffold)

- this file
- `docs/GOLDLINE-TASKS.md`

---

## Migrations

None planned. Inspect Slice 1 `behavioral_ledger_events` first.

---

## Tests / CI / SHA

Not started.

---

## Unresolved questions (pre-implementation)

- Strongest immutable DP source id in current production entities.
- Narrowest safe category for `enabled: true` vs keep production disabled and prove the path in tests only.

---

## Exact next roadmap slice (after this one)

Foundation §9: **Slice 6 — relationship layer.** Not started here.

---

## Next step

Open draft PR, then implement policy + assignment service + outcome assembler + tests.
