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

## October 9 Runtime Completion Execution

This section supersedes the earlier remaining-contract inventory where stated;
the earlier repair/verification history above is retained. Main was fetched
again and remains `1bed5fbc9bf0e2c614d968ba760fadafd098ee0b`. PRs #541/#542
remain OPEN at their recorded heads. PR #535 and unrelated work were untouched.
Working branch: `codex/daphne-v2-runtime-completion`, based on the preserved
combined verification commit `9347fd99129fd99a435eea2761dc3d91a2f3bdd0`.

### Implemented Contracts

| Contract | Implementation And Durable Proof | Release Status |
| --- | --- | --- |
| A Ordinary conversation ingestion | Completed Claire turns resolve existing canonical identity, classify bounded explicit statements, append minimal scoped observations, and materialize facts/goals/context/relationship evidence. Actual independent turn A/B/C/D tests prove laundromat recall, bakery correction, and fresh retrieval through controlled model output. Signed Gather event IDs deduplicate retries; unconfirmed/unfinished input, hypothetical/quoted text, missing identity and storage failure do not create memory. | VERIFIED END TO END locally; unmerged, not deployed |
| B Durable consolidation | Existing immutable observations are work items; existing derived claims are completion receipts, not a second memory or queue. Startup registers a scheduled executor. Transactional bounded batches use SKIP LOCKED, operator serialization, atomic derived writes/receipt, durable 30-second failure backoff and five-attempt dead-letter metrics. Restart, connection crash, concurrent executors, late old evidence, revoked processing, feature-gate pause and erasure overlap are exercised against MySQL. | VERIFIED END TO END locally; production worker startup cannot be certified until release |
| C Outcome-informed learning | Actual authorized Stage 3B clarification selection appends an execution observation and InterventionLedger entry linked to the original authorization/use receipt. Independently verified scoped system measurements feed atomic OutcomeLedger and ResponseModel updates; the scheduler consumes eligible observations automatically. Subsequent actual Claire decisions load evidence before the receipted branch and retain it in the intervention decision record. | Permissible plumbing VERIFIED END TO END locally; changed live selection BLOCKED - OPERATOR APPROVAL |

Outcome tests supply explicit independent system measurements. They are not real
customer successes or live phone acceptance. `branch_selected` means the runtime
selected clarification, not that speech was delivered/heard or that work started.
Only the existing explicit `ask_instead` directive controls that branch. Learned
scores/recommendations cannot turn it off or authorize another action. Exam 5's
live behavioral effect is therefore NOT passed by the recommendation test.

### Additional Repairs And Scope

- Transaction-aware writes reuse existing stores so consolidation/outcome
  materialization cannot leave partial results after rollback.
- Concurrent preference versions retry unique-key collisions and return their
  actual value. Explicit source retries cannot overwrite a newer correction;
  durable latest-source readback still governs success acknowledgment.
- Explicit one-question preference uses the existing correction/readback path.
  Completed Brain V2-owned voice results also capture preference declarations
  and replace unsupported success acknowledgments with durable-readback results.
- Duplicate direct facts coalesce only in the current projection with combined
  provenance; raw claims stay immutable. Explicit corrections outrank conflicting
  inference. A late older observation cannot restore superseded ownership.
- Relationship repair is chronological: an earlier repair cannot erase a later
  rupture. Actual Claire relationship ingestion and another-agent exclusion pass.
- Worker completion claims are filtered in SQL before the bounded card retrieval
  limit. No model runs in the scheduled worker; card reads remain bounded.
- Verified burden measurements now participate in policy evidence. Agent prose,
  unverified/wrong-agent evidence, wrong operator/tenant, undefined measurements
  and out-of-window evidence are rejected. Outcome storage failure is retry-safe.
- Erasure locks source observations before derived deletes. Worker failure
  telemetry also locks/checks the surviving source, preventing delayed failure
  bookkeeping from resurrecting erased operator data.

Files added: `conversationIngestion.ts`, its unit suite,
`consolidationWorker.ts`, its MySQL scheduled-executor suite, and
`stage3bLearning.ts`, under `server/agents/daphne/`. Existing Daphne stores,
adapter/projection/metrics/privacy modules, authorized Claire turn/voice
integration, Stage 3B loader/test, and Daphne acceptance workflow are updated.
No schema, commercial records, tenant authority, payment authority, migration
runner, President, Mitch, or new behavioral target was changed.

### Current Capability Matrix

| Capability | Current Evidence | Remaining Boundary |
| --- | --- | --- |
| Ordinary facts and correction | Real Claire ingestion, independent durable recall, immutable supersession | Bounded explicit grammar deliberately abstains outside supported syntax; no arbitrary transcript inference |
| Person | Existing multi-context distribution and evidence gates preserved | No sensitive hidden trait inference or automatic personality experiment added |
| State/Context | Actual conversation context plus TTL/disputed-evidence tests | Human live quality acceptance pending |
| Goals | Actual operator-authored goal capture/current card/future prompt; supersession in executor | Does not create or alter business-domain goals |
| MetaPreferences | Actual style reversal, one-question guidance, concurrent writes, readback and revocation | Human fresh-call acceptance pending |
| Hypotheses | Competing/uncertain hypotheses retained; explicit correction precedence | Unknown is allowed, not an invented stable identity |
| Relationship | Actual scoped rupture/repair capture, chronological current projection | Evidence-only; no Narrative disclosure authority |
| Privacy/controls | Existing scoped inspect/correct/reject APIs, complete export, transactional erase and worker overlap | No destructive production acceptance performed |
| Learning | Executed branch linkage, scheduled verified outcomes, provenance, atomic estimates, later decision evidence | Only observational association; expanded live choice requires approval |
| Operations | Automatic startup registration; bounded batches, crash/retry/denial receipts and private failure metrics | Large-scale load benchmark and deployed worker telemetry not yet certified |

### Verification And Release Classification

Local focused verification: 40 suites / 189 unit/runtime-boundary tests PASS.
Final six-file MySQL run: 32 PASS, including six actual-executor tests and
worker gate/erasure-overlap coverage. The later recall-revocation tightening
also passed the 12-test authenticated Stage 3B/runtime suite again.
CI results are recorded below after completion.
TypeScript and nomenclature/domain/tenant/vertical ratchets PASS. Model boundary
is controlled in generated-answer tests; no external model-quality claim follows.

Broad Claire/Operator Representative: 159 suites, 2058 PASS, 20 FAIL. The exact
same 20 failures reproduced again on untouched main in the same nine suites
(205 PASS / 20 FAIL in that nine-suite baseline invocation). These are proven
preexisting failures, not reasons to weaken identity/customer-truth guards.
Existing PR #476 owns a separate fixture-repair workstream; it was not taken over.

World baseline was built from untouched main in an isolated managed worktree,
using disposable MySQL, the repository's release migrations, deterministic proof
seed/server, CI environment and the exact three-spec Playwright command. Results:
16 PASS, seven failures, seven skips and 12 not run due to serial-suite failures.
Four missing `.lc-lantern` failures, missing `.gl-world-title`, and mobile composed
city geometry all reproduce. Desktop mount initially hit server-start ECONNREFUSED;
rerunning that exact desktop test after readiness reproduced the same composed
city geometry failure as CI. The initial startup error is environmental; the
seven established browser assertion failures are proven preexisting on main.
Operator Representative's six desktop/mobile browser checks passed on main.
No world implementation or release assertion was altered.

Release checks for #541 and #542 still fail `release-journey` and
`fast-smoke-world`; Daphne-specific CI passes. No force merge, administrative
bypass, unapproved production flag change or direct deployment was performed.

### Current Fourteen Exams

| Exam | Status | Exact Evidence / Limit |
| --- | --- | --- |
| 1 Remember | VERIFIED END TO END locally | `daphneV2RuntimeCorrection.mysql.integration.test.ts`: actual ordinary Claire fact and independent controlled-model recall |
| 2 Correct | VERIFIED END TO END locally | Same runtime suite plus `certification.mysql.integration.test.ts`: corrected fact, immutable history, current projection and later retrieval |
| 3 Change style | VERIFIED END TO END locally | Durable readback, actual generated routing and deterministic concise-board path |
| 4 Reverse style | VERIFIED END TO END locally | Fresh-call 0.85 reversal; old detail preference loses authority |
| 5 Outcomes | BLOCKED - OPERATOR APPROVAL | `daphneStage3b.mysql.integration.test.ts`: actual permitted execution, verified outcome scheduling, atomic retry, later pre-branch evidence; no unauthorized learned behavior |
| 6 Abstain | TESTED IN ISOLATION plus durable negatives | Ineligible conversation parser, competing/high-uncertainty card, disputed/duplicate/conflicting outcome gates |
| 7 Consolidate | VERIFIED END TO END locally | `consolidationWorker.mysql.integration.test.ts`: actual scheduler, longitudinal history, correction/expiry/revocation, restart, concurrent workers, crash and failure retry |
| 8 Relationship repair | VERIFIED END TO END locally | Actual Claire rupture/repair turns, fresh card, other-agent exclusion; chronological rupture regression |
| 9 Consent/revocation | VERIFIED END TO END locally | Fresh disabled guidance, Stage 3B revoke/non-use, revoked worker denial, disabled gate preserves pending work |
| 10 Isolation | VERIFIED END TO END locally | Existing authenticated Stage 3B tenant/operator checks, canonical identity negatives, outcome and agent-scoped card tests |
| 11 Authority | TESTED IN ISOLATION / runtime gates | Narrative read-only boundary, no business writes, original receipt-before-branch, exact target restriction and expandedBehaviorEnabled=false |
| 12 Recovery | VERIFIED END TO END locally | Failed memory write has no memory success; preference readback failures; worker crash/backoff/rollback; outcome retry; atomic privacy failure and worker overlap |
| 13 Production | DEPLOYED baseline only | Actual Railway source remains main `1bed5fbc...`; new executor and repairs not deployed |
| 14 Real Claire | BLOCKED - HUMAN LIVE TEST | Script above plus fact/goal/repair tests below; requires safe release first |

### Exact Learning Approval Request (Not Authorization)

1. Target: only `pattern:explicit_deferral_dismissal`; one existing ambiguous
   pending-continuation selection dimension, not general Claire persuasion.
2. Behavior: bounded comparison of current `ask_instead` clarification versus
   unchanged baseline/no Daphne adaptation. No new phrasing/action class.
3. Missing authority: current directive explicitly mandates ask-instead. Neither
   observational scores nor a policy preview authorizes withholding that choice.
4. Consent: separately affirmative experimentation consent AND operator approval
   of this comparison; adaptation consent alone is insufficient.
5. Scope: named canonical operator and tenant allowlist, no global enable.
6. Safety: ordinary low-risk pending continuation only; no payment, identity,
   business-truth changes, essential-warning suppression or Narrative disclosure.
7. Receipts: approval/directive version, executed SHA, assignment/comparator,
   selection probability, source decision, original use receipt BEFORE behavior,
   execution stage and rollback result. Existing receipt mechanism remains owner.
8. Outcomes: predeclare measurement semantics/source before canary. Proposed
   proximal measure is resolution of the same pending ambiguity within 30 minutes;
   burden must be independently measured, not agent-generated praise or silence.
   Existing `started`/`burden` plumbing accepts only verified linked measurements;
   no live producer has been certified to supply these proposed semantics.
9. Causality: minimum independent samples, conflict abstention, missing outcomes
   unknown, comparator support and propensity checks. Association is not effect.
10. Rollback: revoke directive or disable tenant flag immediately; retain audit
    history, prevent later use, and honor separate memory/privacy controls.
11. Acceptance: same-target permitted difference, wrong scope/agent/target denied,
    revocation immediate, receipt/storage failure baseline-safe, no disclosure or
    commercial mutation, verified window/source and duplicate/conflict negatives.
12. Canary: only after approval and green release gates, one named operator/tenant,
    no global experiment; human phone validation and privacy-safe receipt review
    before considering any broader scope. This proposal has NOT been activated.

### Production And Remaining Human Tests

Fresh Railway read confirms service `9d63863a-2626-47a0-bd65-c3ba8db54258`,
environment `330bff45-7d21-4cdf-be04-b38cea76fcfb`, deployment
`4e15e58c-ab10-4dbe-b145-b06e2989881b` SUCCESS at main `1bed5fbc...`.
Current flag read: `DAPHNE_V2_CLAIRE_ENABLED=true`; tenant allowlist unset;
Stage 3B adaptation flag and causal-canary flag/allowlist unset. No new worker
can be described as production-running from this old SHA.

After safe deployment, execute the preference A-F phone script above. Additionally,
say "I own a laundromat"; end the call; on an independent call ask for relevant
business context, then correct ownership and verify fresh-call corrected recall.
Declare the stated customer goal and deliveries-today context; verify current
card/source and eventual State expiration. State "You misunderstood me" then
"That's what I meant, thanks"; inspect only the Claire relationship. Record
deployed SHA, call/conversation IDs, immutable observations, preferences/current
versions, consolidation completion claims, card evidence, and Stage 3B original
use/intervention/outcome IDs. Fail on false save acknowledgment, old preference
reuse, cross-scope data, stale correction, lost warnings or unauthorized behavior.
Never label these pending human interactions LIVE ACCEPTED.

## October 9 Scoped Inspector Follow-up (PR #544)

This is a stacked follow-up to PR #543, whose published head is
`2a2d57a65bfbc03cc177570e6e3907c102bfd390`.
The separate branch `fix/daphne-v2-scoped-inspection-controls` preserves the
Codex pushed work without overwriting any uncommitted local editor changes.

- Claim inspection/correction/rejection now uses an exact tenant/operator-scoped
  claim-ID lookup instead of searching only the newest 500 claims.
- Linked source observations are retrieved through tenant/operator-scoped ID
  batches rather than the 500-row recent-history window.
- Inspector disposition and control API observations now use unique event keys,
  avoiding collisions between distinct same-millisecond operator actions.
- A new disposable-MySQL regression case inserts 505 newer claims and evidence
  records, then asserts historical inspection, correction and cross-operator denial.
- This follow-up makes no changes to the original Stage 3B intervention target,
  learning authority, payment, tenant authorization, schema, or unrelated work.

No live phone call, merge, production rollout, new intervention target or
experimental consent was performed. The final status remains dependent on the
fresh PR #544 CI results, legal merge/release gates, and actual deployment.

## October 9 — Rebasing and Release Hold (after PR #544)

**Current certification verdict: CODE COMPLETE / NOT DEPLOYED.**
This is the code/integration candidate, **not** a claim of live acceptance.
Outstanding user-approved expansion of learned behavior remains disabled;
Exam 5's experimental/live-selection portion is BLOCKED — OPERATOR APPROVAL.
Human phone acceptance is BLOCKED until this complete stack is deployed and
real independent calls produce corroborating durable receipts.

Fetched and confirmed `main@1bed5fbc9bf0e2c614d968ba760fadafd098ee0b`.
All four original PRs were retained. The stack has explicit ancestry:

| PR | Branch | Rebased commit before this documentation update | Base |
| --- | --- | --- | --- |
| #541 | `codex/daphne-v2-certification` | `793f9fbe4e4bb0fc74dd716b5315fc0772eeeea4` | `main` |
| #542 | `codex/daphne-v2-privacy-history` | `469afa6f21533436996941a1c7a1aa15088e49cd` | #541 |
| #543 | `codex/daphne-v2-runtime-completion` | `7c402aea9210beb15ca77b097bafce23b27ea71d` | #542 |
| #544 | `fix/daphne-v2-scoped-inspection-controls` | `4326c5e01da1c165cfaff006316c68587290ad9b` | #543 |

All original source-tree snapshots from #543 and #544 were preserved exactly.
#542 was reconstructed as the existing verified combined tree containing
#541's changes plus the full #542 privacy implementation; the #542 privacy
source/test blobs matched the original PR. Its workflow retains both suites.
Original pre-rebase heads remain recoverable via:

- `backup/daphne-v2-pr542-pre-rebase-20261009` — `72ce36eb777a77d3031e1959dacaf7796111fa83`
- `backup/daphne-v2-pr543-pre-rebase-20261009` — `2a2d57a65bfbc03cc177570e6e3907c102bfd390`
- `backup/daphne-v2-pr544-pre-rebase-20261009` — `babb5af58f9ac16f9b16108d271861d80af9f752`

The remote GitHub branches were updated with expected-head SHA leases.
A local Codex worktree on the operator's Mac is **not accessible** from this
environment. No claim is made that its uncommitted changes were copied or
backed up. Do not reset that local worktree; preserve any remaining local edits
to `backup/daphne-v2-post-limit-20261009` from that machine.

**Release hold:** Historical `release-journey` Claire failures (20) and
`fast-smoke-world` browser failures (seven) were reproduced on untouched
main by the previous Codex execution, documented above. Do not weaken
these tests or bypass red required gates. A separate CleanCloud CSV sales-truth
failure on PR #543 was observed and not yet independently baseline-classified.
No merge through red gates, production deployment, authorization change,
PR #535 modification or phone call occurred as part of this rebase.

Fresh Daphne CI and real disposable-MySQL suite execution are required on the
**final #544 head**. Record actual run URLs and conclusions before further
release actions. The latest #544 head after this documentation commit is
available in the PR and must be used rather than the snapshot SHA above.

## Post-Rebase Acceptance Timing Remediation

Fresh CI on the first stacked rebase produced:

- #542 Daphne/real-MySQL workflow **PASS**: run
  [38027005502](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/38027005502).
- #543 fresh MySQL acceptance initially **FAIL**: run
  [38027010634](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/38027010634),
  one of 32 cases exceeded Vitest's 5-second *test harness* default.
- #544 initial rebased MySQL acceptance also **FAIL**: run
  [38027039329](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/38027039329),
  same 5-second harness timeout; 32 tests passed, one timed out.

The failing scheduled-worker test polls for an observable durable result with
a 10-second `until()` bound and checks worker concurrency, longitudinal
correction/expiry, revocation and idempotency. An inherited 5-second global
Vitest timeout contradicted that bounded test contract on shared CI.
The integration test now has an explicit 25-second outer timeout; its
assertions and production worker implementation are unchanged. No legacy,
world-smoke, tenant/security, billing or payment gate was modified.
This test correction is **not** evidence of a passing new run until GitHub CI
reports success.

Updated stack heads after the test correction, *before this final documentation
commit*:

- #541 `793f9fbe4e4bb0fc74dd716b5315fc0772eeeea4` on main
- #542 `469afa6f21533436996941a1c7a1aa15088e49cd` on #541
- #543 `fdafd6e8e5e2fc8a988bb8a509df78124d4f20d4` on #542
- #544 `38b41b472b5de347bfcf6f409d88cfe9180a2174` on #543

#544's seven original commits were replayed with the #543 test fix
preserved through each resulting tree. The initial rebased #544 head was
additionally preserved as
`backup/daphne-v2-pr544-before-worker-timeout-20261009`.
Use the latest PR #544 head SHA after the documentation commit for final CI.

**Release verdict remains CODE COMPLETE / NOT DEPLOYED.**
Never mark LIVE ACCEPTED. Production remains on main until all applicable
release protections allow a safe merge, and phone acceptance remains blocked
until real conversations yield matching durable receipts. Outcome-informed
experimental selection outside the established `ask_instead` authority remains
approval-blocked.

## Daphne Release-Safety Addendum — PR #545

**Verdict: CODE COMPLETE / NOT DEPLOYED.** Stacked after #544
`a2f56bb319e2407ed1bd7b60106e98fb76e821c8`. PR #545 remains OPEN.
This change deliberately DOES NOT merge or deploy any PR, adjust release
protections, authorize new learning targets, alter PR #535, payment admission,
tenant identity/authorization, President, or Mitch.

**Independent default-OFF activation controls:**

- `DAPHNE_V2_CONVERSATION_INGESTION_ENABLED=true` activates eligible
  operator-authored ordinary-memory capture. Optional
  `DAPHNE_V2_CONVERSATION_INGESTION_TENANTS=tenant-a,tenant-b` restricts
  the enabled path to that explicit subset. With the enable flag absent,
  no ordinary-conversation observation is captured.
- `DAPHNE_V2_CONSOLIDATION_WORKER_ENABLED=true` allows scheduled
  materialization of eligible observations. Optional
  `DAPHNE_V2_CONSOLIDATION_WORKER_TENANTS=tenant-a,tenant-b` restricts
  worker claims to that subset in SQL. With the enable flag absent,
  the server starts **no** Daphne consolidation worker and the batch
  processor returns zero before touching the database.
- The original `DAPHNE_V2_CLAIRE_ENABLED` and preexisting consent,
  identity, adaptation and tenant gates remain separate prerequisites.
  They **never implicitly switch on** either new capability.
- Each new enable flag set to true with no allowlist is explicit
  all-tenant activation: deploy with both unset/false; for the initial
  canary set both switches explicitly and both lists to one tenant ID.

**Voice latency boundary:** `claireTurn.ts` and `claireTwilio.ts` retain
awaited durable observation writes but no longer invoke or await
`runDaphneConsolidationBatch`. The independently scheduled worker handles
all derived materialization, and slow/failed batches cannot hold Claire's
11-second Twilio response budget. Fresh-call memory test sequencing now
executes the worker separately between independently initialized calls.

**Tests added/changed:** deterministic default-off and cross-tenant flag
checks; a worker SQL tenant allowlist real-MySQL test; a voice-response
regression prohibiting any synchronous consolidation call in the real
Claire/Twilio modules; and adjusted longitudinal MySQL tests with explicit
background processing. Disposable Daphne CI explicitly enables the new
features **only for the acceptance runner**; that does not modify Railway
configuration.

**Release hold:** Red legacy and world-smoke gates still block merge.
No release gates are weakened. Existing operator-consented
`pattern:explicit_deferral_dismissal` / `ask_instead` authority is unchanged.
Real phone acceptance remains BLOCKED until the complete stack reaches
production through a lawful release and human calls generate durable receipts.
Expanded learned behavioral selection is BLOCKED — OPERATOR APPROVAL REQUIRED.

## October 10, 2026 — Repaired Release Baseline and Daphne Stack Rebase

PR #549 (`fix(release): repair baseline Claire, world and CleanCloud checks`)
was merged into `main` with squash commit
`671e8514bec817581901deed1084dfee245ea376`.
The legacy-compatibility, Fast Goldline world smoke, Daphne acceptance,
CleanCloud sales-truth, and SaaS schema release workflows passed on that
baseline before the merge; the separate mobile regression suite was also
running at merge time and must be independently checked.

All five Daphne PR source trees were rebuilt on the repaired `main` without
altering their exact changed-file blobs, in original stack order:

| PR | Rebasing head before this docs update | Parent |
| --- | --- | --- |
| #541 | `b1fdf2688cc37b1e9341246c4e2744cb566a8aab` | main `671e8514` |
| #542 | `c9caa6cfcce5f024316943d42a6b7433655467a5` | #541 |
| #543 | `0f74e79c7dd8a6fe29888b49a47f45441d2d983e` | #542 |
| #544 | `ef993ba28a8a863b57ea794831ddbc5de797bc9f` | #543 |
| #545 | `1d352e9ecf8b1537ba1ae4d5fd87436fc7a7644e` | #544 |

The old Daphne #545 and new #545 full source trees were independently
compared across 5,178 tracked file blobs: the **only 16 differences** are
the precise files changed by merged PR #549. All Daphne source and test
blobs are preserved. The original branch heads were saved in
`backup/daphne-pr{541,542,543,544,545}-pre-baseline-20261010`
before ref updates. Original #535, payments admission, tenant authorization,
President, Mitch and `scripts/migrate.mjs` were not edited.

**Release safeguards**: the new ingestion and consolidation switches
(`DAPHNE_V2_CONVERSATION_INGESTION_ENABLED` and
`DAPHNE_V2_CONSOLIDATION_WORKER_ENABLED`) remain independently default-off.
Neither is configured in the Railway production service. The
`DAPHNE_V2_CLAIRE_ENABLED` flag does not activate either new path.

This entry records a **CODE COMPLETE / NOT DEPLOYED** pre-release
checkpoint, not LIVE ACCEPTED. Verify new CI on the rebased PR heads,
merge in order through all required checks, confirm the final production
SHA, and then run real phone calls with durable receipts.
