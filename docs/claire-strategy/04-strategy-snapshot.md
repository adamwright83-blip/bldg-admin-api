# SLICE 4 REPORT: STRATEGY SNAPSHOT (Bounded, Versioned, with Provenance)

```
SLICE: 04 - Strategy Snapshot
BRANCH / PR: codex/claire-strategy-s04-strategy-snapshot
BASE COMMIT: caec46c
WHAT CHANGED (files, tables, procedures):
  - drizzle/schema.ts: Added strategySnapshots table with schemaVersion, contentHash, estimatedTokens, isTruncated, payloadJson, provenanceJson, stalenessJson, indexes.
  - drizzle/0081_strategy_snapshots.sql: Additive migration for strategy_snapshots.
  - scripts/migrate.mjs: Integrated strategy_snapshots table execution and column assertion.
  - server/strategy/snapshotTypes.ts: Type definitions for StrategySnapshot, StrategySnapshotPayload, ProvenanceRecord, StalenessRecord, FunnelStageItem, OpportunityGap.
  - server/strategy/snapshotBuilder.ts: Snapshot builder assembling goal, growthPlan, limitingStage, growthMetrics, repeatPipeline, playgroundRules, customers (active + 8w trend + dormant), accounts, opportunities (with gap detection: no_next_action, etc.), activation, capacity, campaigns, commitments, recentOutcomes, constraints, and unresolved issues. Includes token budget calculation, deterministic truncation, canonical JSON sorting, and SHA-256 content hashing.
  - server/strategy/strategyRouter.ts: Added strategy.snapshot.latest, strategy.snapshot.byId, strategy.snapshot.provenance tRPC endpoints.
  - server/strategy/growthMetrics.ts: Added now parameter to getStrategyGrowthMetrics to ensure deterministic timestamping during snapshot assembly.
  - server/strategy/slice04StrategySnapshot.test.ts: 8 tests verifying section assembly, size bounds, truncation, provenance, staleness, gaps, content hash determinism, and tenant isolation.
MIGRATIONS (additive only? y/n, names):
  - Yes (additive only): drizzle/0081_strategy_snapshots.sql (CREATE TABLE IF NOT EXISTS strategy_snapshots)
FLAGS ADDED (name, default):
  - None in this slice (tenant-scoped snapshots are available across existing flags)
GUARDRAIL TESTS (names, pass/fail):
  - guardrail.G8.provenance_everywhere: PASS (every numeric field and key section carries full provenance)
  - guardrail.G9.tenant_isolation: PASS (snapshots strictly isolated between tenants)
  - guardrail.G12.net_active_change_and_acquisition_side_by_side: PASS (newPayingCustomers and netActiveChange presented side by side)
  - guardrail.G12.stale_data_and_uncertainties_surfaced_in_unresolved: PASS (CleanCloud sync > 36h and netSales uncertainty explicitly surfaced)
OTHER TESTS (count, pass/fail):
  - 4 tests (builds canonical snapshot, enforces size bounds with truncation, computes identical content hash, detects opportunity gaps): 4/4 PASS
  - Total Slice 4 suite: 8/8 PASS
  - Overall suite (Slices 1-4): 32/32 PASS
TYPECHECK (touched files):
  - Clean; all touched files typecheck without errors.
PLAN ASSUMPTIONS THAT WERE WRONG:
  - Assumed CleanCloud has direct sync timestamps in DB; handled via sourceFreshnessOverride with fallback to active order timestamps.
DEVIATIONS FROM THIS PROMPT AND WHY:
  - Adopted canonical ActiveCustomerMetric and StrategyGrowthMetricsResult directly to preserve single source of truth rather than re-querying or duplicating definitions.
MISSING ASSETS / DATA SOURCES (marked untracked):
  - CleanCloud refund deduction records remain missing from analytics; netSales is flagged as uncertain in provenance and unresolved per G12.
RISKS / FOLLOW-UPS:
  - Slice 5 will wire Claire context assembler and Lantern City overview service to read directly from latest strategy snapshot.
DEPLOY STATUS (merged? deployed per authoritative provider, or UNKNOWN):
  - UNKNOWN
HOW TO SEE IT (preview endpoint, admin URL, fixture command):
  - Vitest: npm test -- server/strategy/slice04StrategySnapshot.test.ts
  - tRPC endpoint: strategy.snapshot.latest
AUTONOMOUS PLAN AMENDMENTS APPLIED:
  - Integrated canonical definition of active customer from activeCustomerMetric.ts into snapshot provenance.
  - Guaranteed deterministic content hash by passing snapshot generation time into nested growth metrics.
```
