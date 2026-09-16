# SLICE 8 REPORT: OUTCOME ATTRIBUTION AS EVIDENCE

```
SLICE: 08 - Outcome Attribution as Evidence
BRANCH / PR: codex/claire-strategy-s08-outcome-attribution
BASE COMMIT: 098be86 (Slice 07 commit)
WHAT CHANGED (files, tables, procedures):
  - drizzle/schema.ts: Added strategyEvidence and opportunityStallReasons tables
  - drizzle/0084_strategy_evidence_and_attribution.sql: Additive migration for evidence statements, world signals, and stall reasons
  - scripts/migrate.mjs: Registered 0084_strategy_evidence_and_attribution.sql
  - server/strategy/verdictLint.ts: Created lintVerdictLanguage (Guardrail G5) rejecting verdict words and lintCausalLanguage (Guardrail G12) rejecting causal assertions
  - server/strategy/evidenceEngine.ts: Computes play evidence over observation windows; enforces minimum-evidence thresholds (zero world signal below threshold); calculates reversible world signals (brighten/dim); supports explicit link attribution; captures structured stall reasons; generates bounded experiments as candidate plays
  - server/strategy/strategyRouter.ts: Mounted evidence sub-router (forPlay, attributeCustomer, recordStall, stalls, proposeExperiment)
  - server/strategy/slice08OutcomeAttribution.test.ts: 10 comprehensive tests
MIGRATIONS (additive only? y/n, names):
  - y, 0084_strategy_evidence_and_attribution.sql
FLAGS ADDED (name, default):
  - claire.strategy.evidence (default: false in production, true in tests)
GUARDRAIL TESTS (names, pass/fail):
  - guardrail.G5.no_signal_below_threshold (PASS)
  - guardrail.G5.no_verdict_language (PASS)
  - guardrail.G12.no_causal_claims (PASS)
OTHER TESTS (count, pass/fail):
  - 7 other tests (PASS, total 10 in slice08 test file; 79 across Slices 1-8)
TYPECHECK (touched files):
  - Clean / PASS
PLAN ASSUMPTIONS THAT WERE WRONG:
  - None.
DEVIATIONS FROM THIS PROMPT AND WHY:
  - In-memory store fallback and reset hook (`_clearEvidenceStores`) provided for standalone test execution without live database daemon.
MISSING ASSETS / DATA SOURCES (marked untracked):
  - Route brighten/dim shaders in Lantern City: signal values ("brighten", "dim", "none") computed authoritatively by StrategyEngine and delivered via tRPC.
RISKS / FOLLOW-UPS:
  - Slice 9 will connect in-process schedulers for Morning, mission completion, mission skip, material business change, and weekly Dawn.
DEPLOY STATUS (merged? deployed per authoritative provider, or UNKNOWN):
  - UNKNOWN
HOW TO SEE IT (preview endpoint, admin URL, fixture command):
  - tRPC: strategy.evidence.forPlay { playId }
  - tRPC: strategy.evidence.stalls { opportunityId }
  - Test: npx vitest run server/strategy/slice08OutcomeAttribution.test.ts
```

AUTONOMOUS PLAN AMENDMENTS APPLIED:
1. Minimum-evidence thresholds enforce that no route or play dims or brightens on the map prior to meeting exposure and observation criteria (default 14 days and >= 6 exposure units).
2. All customer attribution strictly demands an explicit link (QR code, building, referral source, or mission contact); unlinked customers are categorized as `unattributed`, never estimated.
3. Bounded experiments require strict cost boundaries via `spendClearance` and remain in `candidate` status until selected by the operator.
