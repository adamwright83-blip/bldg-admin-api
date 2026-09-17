**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# SLICE 5 HANDOFF — Randomized learning / MRT decision points

**Status: implementation on PR; CI pending on latest push.**
**Branch:** `cursor/behavioral-slice-5-mrt-learning-723a`
**PR:** https://github.com/adamwright83-blip/bldg-admin-api/pull/158
**Base:** `main` @ `287e7dd53fa20ac6cd3da1a5c4accc07b12fc73e`
**Exact latest commit SHA:** *(updated after push)*
**CI status:** pending

---

## ⚠️ Naming collision

This is **behavioral-science roadmap Slice 5** (randomized assignment / MRT decision points).

It is **not** BUILD_BRIEF Slice 5, not Mission Director, not Dayplay, not Spirit Human crusher.

Binding: `docs/goldline/BEHAVIORAL_SCIENCE_FOUNDATION.md`.

---

## Exact objective

Eligible decision point → frozen option set → genuine randomized assignment → logged `assignmentProbability` → observed ledger events → predefined proximal characterization → descriptive comparison. **No automatic causal/product claim.**

Shipping this infrastructure does **not** earn a “works better” claim.

---

## Deterministic Slice 4 vs randomized Slice 5

| Mode | Mechanism | Probability |
|---|---|---|
| A — Slice 4 default | `deterministic_policy` | `null` |
| B — this slice | `randomized_assignment` | actual P(assigned \| frozen set, policy, DP) |

Never blurred. FNV/hash remains Slice 4 only.

---

## Production wiring

```
GoldlineDriverController
  → behavioralEventsForSubject (Slice 4)
  → experimentalPresentationAssignment (this slice; no-op unless policy enabled)
  → GoldlineGameHome
  → if experiment active: preferredTemplateId from server assignment
  → else: preferredTemplateIdForDirector (Slice 4)
  → selectFictionForMission({ preferredTemplateId })
```

Fiction Director eligibility remains the final veto. `ActionGrammar` is unchanged. Client cannot send arm or probability (those fields are not on the tRPC input).

---

## Decision-point identity

- **Behavioral subject:** `ops_task:<taskId>` (Slice 4 history).
- **Decision point:** `presentationDecisionPointId` = `{correlationId}:offer:{occasionId}` (max 128).
- Production occasion: campaign `stableChapterId` (authoritative chapter identity, not a wall-clock).
- One DP → at most one assignment (`idempotencyKey = mrt_assignment:{decisionPointId}`).
- Same subject, different occasionIds → different DPs.

---

## Experiment policy

`shared/behavioralExperimentPolicy.ts` — `presentation_mrt_v1` / version `1`.

- `enabled`: **false** unless `GOLDLINE_BEHAVIORAL_MRT=1`
- `includeStandardPresentation`: true
- equal weights
- `proximalOutcomeWindowMinutes`: 120
- min 2 options
- driving and emergency excluded
- inspectable/testable; LLM does not author weights

---

## Randomization method

Node `crypto.randomInt` (CSPRNG). Tests inject `randomInt`. Equal arms record real `1/N`. Validate `0 < p <= 1` and frozen probabilities sum to 1.

---

## Baseline arm

`STANDARD_PRESENTATION` is first in the frozen set. Assigned STANDARD → `preferredTemplateId: null` (Director existing hash/plain path). Same real `ActionGrammar`.

---

## Persistence / idempotency

**No migration.** Reuses Slice 1 `behavioral_ledger_events` decision-point columns.

Assignment is a `DELIVERED` row with DP fields populated, persisted **before** later STARTED/COMPLETED. First insert wins; reload returns it.

---

## Proximal outcomes

Window frozen at assignment. Assembler uses events with `occurredAt >= assignedAt`. `startedWithinWindow` true/false/unknown. No `IGNORED`. Window is not rewritten after seeing results.

---

## Burden / DEFERRED

**No production DEFERRED producer** (Slice 4). Defer metrics are labeled `unavailable`. Do not infer defer from silence, dismiss, expire, no start, or no click. No fake producer added.

---

## Reporting / learning

`describeRandomizedOutcomes`: `observed_randomized_outcomes_by_arm`, `insufficient_evidence_for_a_causal_product_claim` when n < `minSamplePerArmForCausalClaim` (20). Forbidden diagnostic/causal phrases throw.

**No adaptive bandit.**

**No causal efficacy claim has been earned merely by shipping Slice 5.**

---

## Files changed

- `shared/behavioralExperimentPolicy.ts` (+ test)
- `shared/behavioralExperimentAssignment.ts`
- `shared/fictionEligibilityCatalog.ts`
- `server/behavioralExperiment/assignPresentation.ts` (+ unit + mysql integration tests)
- `server/behavioralExperiment/proximalOutcome.ts`
- `server/behavioralExperiment/experimentReport.ts`
- `server/behavioralLedger/behavioralLedger.ts` (`listByDecisionPoint`)
- `server/goldlineWorld/goldlineWorldRouter.ts`
- `client/src/pages/driver/GoldlineDriverController.tsx`
- `client/src/game/GoldlineGameHome.tsx`
- `client/src/game/fiction/fictionDirector.test.ts`
- `.github/workflows/goldline-fast-smoke.yml`
- `docs/GOLDLINE-TASKS.md`
- this file

---

## Migrations

None. Slice 1 already stored decision-point / probability / window columns.

---

## Tests (local)

`pnpm vitest run` focused Slice 4+5 files: **65 passed**. `pnpm check` clean.

MySQL integration: `assignPresentation.mysql.integration.test.ts` is wired into Fast Goldline smoke’s real-MySQL step (not the default unit run).

---

## Whether randomized assignments can occur in production

**Not unless `GOLDLINE_BEHAVIORAL_MRT=1`.** Default policy `enabled: false` preserves Slice 4 deterministic behavior.

When enabled, eligibility still requires ≥2 safe options including STANDARD, non-driving, non-emergency, valid grammar, and a server occasion id.

---

## Unresolved questions

- When to turn `GOLDLINE_BEHAVIORAL_MRT=1` on in a live tenant.
- Explicit operator defer action remains out of scope (still no DEFERRED producer).

---

## Exact next roadmap slice

Foundation §9: **Slice 6 — relationship layer.** Not started.

---

## Next step

Push, wait for Fast Goldline / DayForge / mobile CI on this head. Do not merge without instruction.
