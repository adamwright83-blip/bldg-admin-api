# Daphne V2 Execution Record

Baseline: `origin/main@1bed5fbc9bf0e2c614d968ba760fadafd098ee0b`.
Execution date: October 9, 2026 (America/Los_Angeles).

## Verdict

NO: full Daphne V2 completion is not yet certified. File-presence tests and
read-only policy previews do not establish a complete live learning system.

## Confirmed Repairs

| Defect | Root Cause | Repair | Evidence |
| --- | --- | --- | --- |
| Corrected knowledge survives on cards | Person compilation bypassed supersession; user corrections were excluded from hypotheses | Resolve scoped append-only dispositions before compilation; project corrected statements with their own provenance | Current-knowledge unit suite and real MySQL certification |
| Correction withheld from Claire | Historical supersession link counted as counter-evidence against the new statement | Preserve stored link but exclude it from current correction scoring | MySQL correction, prompt retrieval and rejection |
| Temporary state persists indefinitely | Recompilation renewed expiry using all historical observations | Apply evidence-age TTL and verification gates to State and Context | Expiry and disputed-evidence tests |
| Agent knowledge can cross boundaries | Card and policy-preview claims/interventions were not agent-filtered | Filter agent-scoped evidence before compilation and preview | Scoped claim tests; durable agent/operator isolation |
| Revoked adaptation becomes enabled | Card omitted revoked control, restoring adapter default | Keep revoked adaptation disabled in the compiled control | Unit and independent MySQL read |
| Response estimates learn invalid evidence | Unfiltered outcomes; repeated writes counted as independent samples | Verify scope, time window, evidence class and status; one sample per intervention; abstain on conflicting measurements | ResponseModel negative tests |
| Response provenance incomplete | Card omitted response sources and hypothesis claims | Include contributing claim, observation and outcome identifiers | Compiled evidence chain |
| Canary launders unsafe metadata | Planner replaced supplied risk/authority properties with safe defaults | Retain input safeguards for existing eligibility filters | High-risk action denied by planner |
| CI omits broad V2 coverage | Workflow ran only correction-focused suites | Run all Daphne units, Narrative boundary and four durable integration suites | Expanded acceptance workflow |

## Verification Record

Baseline: 34 suites / 94 tests passed. After repairs: 35 suites / 121 tests
passed locally. Real disposable MySQL 8.0: all repository migrations applied;
12 existing acceptance tests and 3 new certification tests passed. TypeScript
and all four architecture ratchets passed. Model-generation integration tests
exercise the real routing and prompt path with a controlled model boundary;
they do not certify external model quality or phone behavior.

## Runtime Inventory And Remaining Contracts

| Subsystem | Established Evidence | Remaining Contract |
| --- | --- | --- |
| Observation/claim stores | Durable append-only APIs | General Claire conversation ingestion beyond explicit preferences is not connected |
| MetaPreferences | Durable readback; independent-call style and reversal | Concurrent-write certification and full historical export |
| Person/State/Context | Pure derivation and corrected scoped card compilation | Broad longitudinal dataset acceptance |
| Goals | Durable API | Goal lifecycle and supersession certification |
| Relationship | Agent-specific structured event derivation | Actual Claire rupture/repair ingestion and revoked-event handling |
| Hypotheses | Competing/uncertain results | Longitudinal re-evaluation through a durable execution path |
| Consolidation | Planner plus current-claim projection on card reads | Durable consolidation execution, retries and scheduling |
| ResponseModel | Verified outcome associations and sample gates | Actual executed-intervention/outcome ingestion |
| LearnedPolicy | Durable authenticated preview | Receipt-backed subsequent runtime behavior change |
| Causal estimator/canary | Offline estimator and gated planner | No live experimental authority inferred from a plan |
| Claire | Preference loading, generated prompt, deterministic concise board; receipt-before-Stage-3B behavior | Live phone acceptance |
| Narrative OS | Read-only relationship bridge, existing boundary regression | Live disclosure-denial acceptance |
| User controls/privacy | Existing scoped correction, rejection, export and erasure APIs | Export currently bounds history at 500 and omits inactive goal/preference history |

The only established behavioral target remains
`pattern:explicit_deferral_dismissal`, with `ask_instead`. The existing canary's
broader action names are offline planning vocabulary, not production permission.
No new target or production experimental flag has been enabled.

## Production Baseline

Railway project `293ee4d1-ee4f-4701-8a56-18ad120009a2`, production service
`9d63863a-2626-47a0-bd65-c3ba8db54258`: deployment
`4e15e58c-ab10-4dbe-b145-b06e2989881b`, SUCCESS, main SHA `1bed5fbc...`.
`DAPHNE_V2_CLAIRE_ENABLED=true`. Startup logs verify required columns in the
seven Daphne stores. This confirms startup schema checks, not a live learning
loop. No standalone Daphne consolidation worker was found in the inspected
runtime. Deployment status of the repairs is recorded after merge.
`CLAIRE_OPERATOR_CONTEXT_ADAPTATION_ENABLED`, `DAPHNE_V2_CAUSAL_CANARY_ENABLED`
and its tenant allowlist are unset: their existing gates therefore remain off.

## Human Phone Acceptance

BLOCKED - REQUIRES HUMAN LIVE CALL. Use the same authenticated operator on
independent calls; record call/conversation IDs and correlate durable receipts.

1. Call A: "Keep your answers shorter from now on." Require a successful
   durable readback before Claire confirms it.
2. End A. Call B: "What's happening today?" Require a fresh preference load,
   concise board selection, preserved critical warnings, and no unsolicited
   long enumeration of customer names.
3. Call C: "Give me more detail from now on." End C. Call D: request the same
   briefing and verify the active value is 0.85 and detail increases.
4. Disable adaptation through authenticated controls. On another call verify
   the saved style is not applied. Restore only through an explicit control.
5. For Stage 3B, exercise an authorized ambiguous pending continuation, inspect
   the durable use receipt, revoke the directive and verify future non-use.

## Ownership

No changes to `scripts/migrate.mjs`, payment/capture authority, tenant identity
or authorization, PR #535, President, Mitch or unrelated workstreams.

## Git And Gate Record

- PR #541: `793f9fbe`, current-knowledge/outcome-evidence repairs. Daphne durable
  acceptance CI succeeded in run `38013082293`.
- PR #542: `ebe99f48` plus `72ce36eb`, complete privacy history and transactional
  erasure, including a real MySQL failure/rollback test. Daphne acceptance CI
  succeeded in run `38013465629`; other release checks remain pending at publication.
- Neither PR is merged or deployed. Main remains `1bed5fbc...`.
- Combined local verification branch: `codex/daphne-v2-combined-verification`.
  The workflow additions were combined explicitly; no test was removed.
- Release gate run `38013082323` failed: 20 failures, 2335 passes. All 20 failures
  reproduced on untouched `origin/main` in the same nine Claire suites. Broad
  local Claire/Operator Representative run: 2058 passed, 20 failed. These include
  missing deterministic DB mocks, synthetic dialing fixtures rejected by real
  identity guards, customer-truth/progression fixtures and pending-proposal tests.
  No identity guard or business authority was weakened to accommodate fixtures.
- World smoke run `38013082358` failed with seven browser failures involving
  absent `.lc-lantern` elements and world mount/chrome expectations. Those logs
  were inspected; this run was not reproduced locally, so baseline equivalence
  for browser failures is not certified. No frontend file changed in these PRs.
- Merge/deployment is held while release checks are red. A passing Daphne job
  does not substitute for release readiness.

## Integrated Exam Accounting

| Exam | Status | Limit |
| --- | --- | --- |
| 1 Remember | TESTED IN ISOLATION | Durable statement/claim/card path; general Claire fact capture not connected |
| 2 Correct | VERIFIED END TO END locally through card/prompt | Historical fact retained; actual phone output pending |
| 3 Change style | VERIFIED END TO END in MySQL runtime tests | Controlled generator boundary; human phone pending |
| 4 Reverse style | VERIFIED END TO END in MySQL runtime tests | Human phone pending |
| 5 Learn from outcomes | TESTED IN ISOLATION | Durable preview changes; subsequent live behavior loop not implemented |
| 6 Unsupported inference | TESTED IN ISOLATION | Competing/uncertain hypotheses and ineligible outcomes abstain |
| 7 Consolidate history | TESTED IN ISOLATION | Current correction projection and expiry; no durable Dreamer execution |
| 8 Relationship repair | TESTED IN ISOLATION | Structured derivation exists; actual repair ingestion unverified |
| 9 Consent | VERIFIED END TO END in MySQL runtime tests | Stage 3B revocation and fresh revoked-control read; not live accepted |
| 10 Isolation | VERIFIED END TO END in MySQL tests | Tenant/operator/directive isolation plus agent-specific card checks |
| 11 Authority | TESTED IN ISOLATION | Existing Narrative/business boundary and Stage 3B rejection tests |
| 12 Recover | VERIFIED END TO END for tested storage failures | Preference failures and transactional erasure rollback; Dreamer failure path absent |
| 13 Production configuration | DEPLOYED baseline inspected | Running SHA/flag/startup schema verified; repairs not deployed |
| 14 Real Claire | BLOCKED | REQUIRES HUMAN LIVE CALL |

## Privacy Slice

PR #542 adds `canonicalHistory`, a complete transactional snapshot of all seven
Daphne-owned stores, while retaining the older client read model with explicit
limits. Two real MySQL tests verify 505 observations, preference history,
completed goals, operator isolation, successful erasure and rollback after a
later deletion fails. No business or Narrative store is part of erasure.
Combined local verification passed: 121 unit tests, 17 real-MySQL tests,
TypeScript, and the four architecture ratchets. All local test/compile sessions
completed. No production flags were changed and no phone call was placed.

## Learning Authority Boundary

The present live directive chooses `ask_instead`; it does not authorize the
offline canary's `brief_response` or `offer_next_step` behaviors. There is no
certified production assignment/outcome pipeline with comparable alternatives.
That is an implementation gap as well as an authority constraint, not a passed
learning exam disguised as a preview.

Before any experimental expansion, prepare operator review for a bounded
comparison on `pattern:explicit_deferral_dismissal` only: existing `ask_instead`
versus existing baseline/no adaptation, under active directive and explicit
experimentation consent. Specify the predeclared proximal measure/window,
execution evidence, propensity logs, minimum independent samples and causal
eligibility gates. Preserve receipt-before-behavior, disabled/revoked controls,
tenant/operator scope, warning preservation and all denial cases. Do not apply
that proposed comparison merely because it is written here. This is not a new
approval system or an authorization receipt.
