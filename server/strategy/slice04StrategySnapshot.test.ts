import { beforeEach, describe, expect, it } from "vitest";
import {
  _clearSnapshotStore,
  buildStrategySnapshot,
  canonicalJsonStringify,
  computeContentHash,
  DEFAULT_TOKEN_BUDGET,
  estimateTokenCount,
  getLatestStrategySnapshot,
  getSnapshotProvenance,
  getStrategySnapshotById,
} from "./snapshotBuilder";
import { setPlaygroundRules } from "./playgroundRulesService";

describe("Slice 4: Strategy Snapshot (Bounded, Versioned, with Provenance)", () => {
  const tenantA = "tenant_slice04_a";
  const tenantB = "tenant_slice04_b";

  beforeEach(() => {
    _clearSnapshotStore();
  });

  it("builds a canonical strategy snapshot with all required sections", async () => {
    const snapshot = await buildStrategySnapshot(tenantA);

    expect(snapshot.id).toMatch(/^snap_/);
    expect(snapshot.tenantId).toBe(tenantA);
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.contentHash).toBeDefined();
    expect(snapshot.estimatedTokens).toBeGreaterThan(0);
    expect(snapshot.payload).toBeDefined();

    // Verify required sections exist
    const { payload } = snapshot;
    expect(payload.goal).toBeDefined();
    expect(payload.growthPlan).toBeDefined();
    expect(payload.growthMetrics).toBeDefined();
    expect(payload.repeatPipeline).toBeDefined();
    expect(payload.playgroundRules).toBeDefined();
    expect(payload.customers).toBeDefined();
    expect(payload.accounts).toBeDefined();
    expect(payload.opportunities).toBeDefined();
    expect(payload.detectedGaps).toBeDefined();
    expect(payload.activation).toBeDefined();
    expect(payload.capacity).toBeDefined();
    expect(payload.campaigns).toBeDefined();
    expect(payload.commitments).toBeDefined();
    expect(payload.recentOutcomes).toBeDefined();
    expect(payload.constraints).toBeDefined();
    expect(payload.unresolved).toBeDefined();
    expect(payload.activePath).toBeDefined();
    expect(payload.recovery).toBeDefined();
  });

  it("guardrail.G8.provenance_everywhere: every numeric field and key section carries provenance", async () => {
    const snapshot = await buildStrategySnapshot(tenantA);
    const { provenance } = snapshot;

    expect(provenance["goal.currentValue"]).toBeDefined();
    expect(provenance["goal.currentValue"].source).toBe("macroGoalService");
    expect(provenance["goal.currentValue"].computedAt).toBeDefined();

    expect(provenance["goal.newPayingCustomers"]).toBeDefined();
    expect(provenance["goal.newPayingCustomers"].window).toBe("last_30_days");

    expect(provenance["growthMetrics.activeCustomerCount"]).toBeDefined();
    expect(provenance["growthMetrics.activeCustomerCount"].queryOrDefinition).toContain("paid order");

    expect(provenance["playgroundRules.monthlySpendCeilingCents"]).toBeDefined();
    expect(provenance["capacity.availablePounds"]).toBeDefined();

    // Test endpoint helper
    const prov = await getSnapshotProvenance(tenantA, snapshot.id, "goal.newPayingCustomers");
    expect(prov).toBeDefined();
    expect(prov?.source).toBe("growthMetrics.newPayingCustomers");
  });

  it("guardrail.G12.net_active_change_and_acquisition_side_by_side", async () => {
    const snapshot = await buildStrategySnapshot(tenantA);
    const { goal } = snapshot.payload;

    // Both metrics must be returned together so churn cannot hide behind new signups
    expect(goal.newPayingCustomers).toBeDefined();
    expect(goal.netActiveChange).toBeDefined();
  });

  it("guardrail.G12.stale_data_and_uncertainties_surfaced_in_unresolved", async () => {
    // Inject a stale CleanCloud sync (e.g. 48h old > 36h threshold)
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 3600000).toISOString();
    const snapshot = await buildStrategySnapshot(tenantA, {
      sourceFreshnessOverride: {
        cleanCloudLastSyncIso: fortyEightHoursAgo,
      },
    });

    expect(snapshot.staleness["cleanCloud"]).toBeDefined();
    expect(snapshot.staleness["cleanCloud"].isStale).toBe(true);
    expect(snapshot.staleness["cleanCloud"].warning).toContain("threshold");

    // Unresolved section must reflect the stale sync
    const staleIssue = snapshot.payload.unresolved.find(u => u.source === "CleanCloud POS");
    expect(staleIssue).toBeDefined();
    expect(staleIssue?.issue).toContain("stale");
  });

  it("enforces size bounds with deterministic truncation", async () => {
    // Set a very tight token budget of 200 tokens to trigger truncation
    const tightBudget = 200;
    const snapshot = await buildStrategySnapshot(tenantA, { tokenBudget: tightBudget });

    expect(snapshot.isTruncated).toBe(true);
    expect(snapshot.truncationDetails).toBeDefined();
    expect(snapshot.truncationDetails?.length).toBeGreaterThan(0);

    // High priority sections must remain preserved
    expect(snapshot.payload.goal).toBeDefined();
    expect(snapshot.payload.playgroundRules).toBeDefined();
    expect(snapshot.payload.growthMetrics).toBeDefined();
  });

  it("computes identical content hash for identical inputs", async () => {
    const fixedNow = new Date("2026-09-16T12:00:00Z");
    const snapshot1 = await buildStrategySnapshot(tenantA, { now: fixedNow });
    const snapshot2 = await buildStrategySnapshot(tenantA, { now: fixedNow });

    expect(snapshot1.contentHash).toBe(snapshot2.contentHash);
    expect(snapshot1.contentHash).toBe(computeContentHash(snapshot1.payload));
  });

  it("detects pipeline gaps including no-next-action on live opportunities", async () => {
    const snapshot = await buildStrategySnapshot(tenantA);
    const gaps = snapshot.payload.detectedGaps;

    expect(gaps.length).toBeGreaterThan(0);
    const noNextActionGap = gaps.find(g => g.type === "no_next_action");
    expect(noNextActionGap).toBeDefined();
    expect(noNextActionGap?.description).toContain("no next action scheduled");
  });

  it("guardrail.G9.tenant_isolation: snapshots are strictly isolated across tenants", async () => {
    const snapshotA = await buildStrategySnapshot(tenantA);
    const snapshotB = await buildStrategySnapshot(tenantB);

    // Tenant B cannot fetch Tenant A's snapshot
    const fetchedByB = await getStrategySnapshotById(tenantB, snapshotA.id);
    expect(fetchedByB).toBeNull();

    // Latest snapshot for B is snapshotB, not snapshotA
    const latestB = await getLatestStrategySnapshot(tenantB);
    expect(latestB?.id).toBe(snapshotB.id);
    expect(latestB?.tenantId).toBe(tenantB);
  });
});
