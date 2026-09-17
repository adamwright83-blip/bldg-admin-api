# Slice 2 Report: Growth Metrics

```
SLICE: 2 - Growth Metrics
BRANCH / PR: codex/claire-strategy-s02-growth-metrics
BASE COMMIT: d3554e3 feat(strategy): Slice 1 safety baseline (audit and lock)
WHAT CHANGED (files, tables, procedures):
  - server/strategy/growthMetrics.ts: Canonical growth metrics service calculating newPayingCustomers (with uncertain bucket for incomplete history), reactivatedCustomers (inactivity rule, never new), paidOrders, netSales (with uncertainty disclosure on unrecorded refunds), repeatConversion (first->second order cohort), and netActiveChange with full provenance.
  - server/strategy/strategyRouter.ts: Exposed tRPC queries strategy.activeCustomers and strategy.growthMetrics.
  - server/_core/systemRouter.ts: Mounted strategyRouter on system.strategy.
  - server/routers.ts: Mounted strategyRouter on appRouter.strategy.
  - server/analytics/analyticsQueries.ts: Added reference comment to canonical activeCustomerMetric.ts at line 291.
  - server/strategy/slice02GrowthMetrics.test.ts: Full test coverage for G12 invariants, trend calculation, cohorts, and tenant isolation.
MIGRATIONS (additive only? y/n, names): None (computes over existing paid_order_ledger and customer identity groups).
FLAGS ADDED (name, default):
  - claire.strategy.s02-growth-metrics (default: false, enabled in fixtures)
GUARDRAIL TESTS (names, pass/fail):
  - guardrail.G12.duplicate_identity_counts_once (PASS)
  - guardrail.G12.reactivation_not_new (PASS)
  - guardrail.G12.incomplete_history_is_uncertain (PASS)
OTHER TESTS (count, pass/fail):
  - uses canonical definition string (PASS)
  - trend weeks use business-local boundaries and length 8 (PASS)
  - marks netSales as uncertain because canonical accounting does not deduct refunds (PASS)
  - first and second paid orders land in correct cohort (PASS)
  - preserves tenant isolation (PASS)
  Total: 8 passed, 0 failed
TYPECHECK (touched files): Clean
PLAN ASSUMPTIONS THAT WERE WRONG: None.
DEVIATIONS FROM THIS PROMPT AND WHY:
  - As verified in Slice 0, canonical paid order ledger does not record refunds/cancellations for cleancloud orders; netSales is therefore explicitly flagged as uncertain with full provenance explanation as instructed.
MISSING ASSETS / DATA SOURCES (marked untracked):
  - Refund ledger for CleanCloud imports (marked uncertain in netSales).
RISKS / FOLLOW-UPS:
  - If a CleanCloud customer has no recorded orders prior to import start, their early orders may not be known; these are safely isolated in uncertainNewPayingCustomers.
DEPLOY STATUS (merged? deployed per authoritative provider, or UNKNOWN): UNKNOWN
HOW TO SEE IT (preview endpoint, admin URL, fixture command):
  - npx vitest run server/strategy/slice02GrowthMetrics.test.ts
  - tRPC endpoints: strategy.activeCustomers and strategy.growthMetrics
AUTONOMOUS PLAN AMENDMENTS APPLIED:
  - Mounted strategyRouter both at appRouter.strategy and system.strategy for maximum routing compatibility.
```
