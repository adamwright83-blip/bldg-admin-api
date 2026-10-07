# Daphne V2 — Full Slice Implementation Map

This map tracks the corrected Daphne V2 program. It does not rename Daphne to V3.

## Product invariant

Daphne V2 is a closed-loop adaptive user-intelligence system. It continuously separates:

- Person — slow, distributed, context-conditioned tendencies;
- State — fast, expiring operational estimates;
- Context — structured situation/regime;
- Goals — explicit current and longer-horizon objectives;
- Relationship — agent/user dyadic history;
- MetaPreferences — explicit user controls over adaptation;
- HypothesisSet — competing explanations with uncertainty;
- InterventionLedger — complete action-selection record;
- ResponseModel — conditional learned response estimates;
- OutcomeLedger — proximal, distal, burden, and relationship outcomes.

The Operator Card is compiled and noncanonical.

## Slice implementation map

| Slice | Capability | Primary implementation |
| --- | --- | --- |
| 0 | repository audit / boundary contract | `docs/goldline/DAPHNE_V2_ARCHITECTURE.md` |
| 1 | immutable observation ledger | `server/daphne/observationStore.ts`, `drizzle/0124_daphne_v2_observations.sql` |
| 2 | typed epistemic ledger | `server/daphne/epistemicStore.ts`, `drizzle/0125_daphne_v2_epistemic_claims.sql` |
| 3 | fast expiring State | `server/daphne/stateModel.ts` |
| 4 | Context / regime model | `server/daphne/contextModel.ts` |
| 5 | Person distributions / if-then signatures | `server/daphne/personModel.ts` |
| 6 | Goals + MetaPreferences | `server/daphne/goalsPreferences.ts` |
| 7 | dyadic Relationship | `server/daphne/relationshipModel.ts` |
| 8 | competing HypothesisSet + decomposed uncertainty | `server/daphne/hypothesisSet.ts` |
| 9 | compiled Operator Card | `server/daphne/operatorCard.ts` |
| 10 | InterventionLedger | `server/daphne/interventionLedger.ts` |
| 11 | OutcomeLedger | `server/daphne/outcomeLedger.ts` |
| 12 | conditional ResponseModel | `server/daphne/responseModel.ts` |
| 13 | propensity/randomization-aware causal estimation | `server/daphne/causalEstimator.ts` |
| 14 | bounded safe active learning | `server/daphne/activeLearning.ts` |
| 15 | multi-objective adaptation policy | `server/daphne/policyEngine.ts` |
| 16 | agent-caused-change attribution gate | `server/daphne/agentChangeAttribution.ts` |
| 17 | evidence-preserving consolidation/dreaming | `server/daphne/consolidation.ts` |
| 18 | authenticated standalone query/evidence API | `server/daphne/engine.ts`, `server/daphne/router.ts` |
| 19 | broad Claire V2 adapter | `server/daphne/claireAdapter.ts` + bounded Claire prompt seam |
| 20 | Narrator OS relationship bridge | `server/narratorOs/daphneRelationshipContext.ts` |
| 21 | rupture/repair intelligence | `server/daphne/repairEngine.ts` |
| 22 | inspector + correction/rejection controls | `server/daphne/userControls.ts`, Daphne router |
| 23 | privacy / scope / export / erasure | `server/daphne/privacy.ts`, Daphne router |
| 24 | scientific evaluation harness | `server/daphne/scientificEvaluation.ts` |
| 25 | opt-in low-risk production causal canary | `server/daphne/causalCanary.ts` |
| 26 | privacy-gated hierarchical cold-start priors | `server/daphne/hierarchicalPrior.ts` |
| 27 | portable standalone product boundary | `server/daphne/productBoundary.ts` |
| 28 | durable moat/evidence-flywheel instrumentation | `server/daphne/metrics.ts` |

Slices 6, 10, 11, and 28 use the canonical persistence added by `drizzle/0126_daphne_v2_canonical_learning.sql`.

## Permanent truth and scientific gates

1. Observations never silently become interpretations.
2. Associations never silently become treatment effects.
3. A temporary State never silently becomes Person.
4. Person estimates require repeated evidence across contexts.
5. Clinical/diagnostic labels are not inferred by Daphne.
6. User corrections supersede derived hypotheses without rewriting evidence history.
7. Relationship state is agent-scoped by default.
8. Business truth remains owned by authoritative business domains.
9. Narrator occurrence/knowledge/disclosure authority remains in Narrator OS.
10. Randomized/propensity learning requires an explicit acceptable action set and logged selection probability.
11. `no_intervention` is a legitimate policy action.
12. Burden and relationship risk are optimization objectives, not afterthoughts.
13. Production experimentation is off by default and also requires explicit user `safe_experimentation` permission.
14. Cross-user cold-start learning requires explicit `cross_user_learning` permission and sufficiently large aggregate cohorts.
15. Privacy erasure deletes Daphne-owned representation/learning data only; it never reaches into payment/order/business or Narrator authority records.

## Runtime rollout

Daphne V2 Claire guidance is fail-closed and disabled unless `DAPHNE_V2_CLAIRE_ENABLED` is true or the tenant appears in `DAPHNE_V2_CLAIRE_TENANTS`. The existing Stage 3B bounded adaptation remains present; V2 does not remove its receipt chain.

The causal canary is separately disabled unless `DAPHNE_V2_CAUSAL_CANARY_ENABLED` is true or the tenant appears in `DAPHNE_V2_CAUSAL_CANARY_TENANTS`, and the user's current `safe_experimentation` preference is explicitly true.

## Completion criterion

Code-complete means all slice surfaces above exist, the schema migration path is green, Daphne unit/contract tests are green, Claire and Narrator authority boundaries remain green, and the exact tested head is merged to `main`. Production scientific claims still depend on real observations and experimental evidence; code completion does not fabricate those results.
