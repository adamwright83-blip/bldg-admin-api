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
