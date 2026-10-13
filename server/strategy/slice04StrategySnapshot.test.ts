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
import { scoreStrategyPlay, type PlayCandidateInput } from "./decisionPolicy";

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
    expect(snapshot.schemaVersion).toBe(2);
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
    expect(provenance["goal.currentValue"].source).toBe("unavailable");
    expect(provenance["goal.currentValue"].computedAt).toBeDefined();

    expect(provenance["goal.newPayingCustomers"]).toBeDefined();
    expect(provenance["goal.newPayingCustomers"].window).toBe("last_30_days");

    expect(provenance["growthMetrics.activeCustomerCount"]).toBeDefined();
    expect(provenance["growthMetrics.activeCustomerCount"].queryOrDefinition).toContain("paid order");

    expect(provenance["playgroundRules.monthlySpendCeilingCents"]).toBeDefined();
    expect(provenance["capacity.availablePounds"]).toBeDefined();
    expect(provenance["customers.dormantEligible"]).toBeDefined();
    expect(provenance["repeatPipeline"]).toBeDefined();
    expect(provenance["accounts"]?.source).toBe("omitted");

    // Test endpoint helper
    const prov = await getSnapshotProvenance(tenantA, snapshot.id, "goal.newPayingCustomers");
    expect(prov).toBeDefined();
    expect(prov?.source).toBe("growthMetrics.newPayingCustomers");
  });

  it("does not manufacture a 50-customer target when no operator goal is registered", async () => {
    const snapshot = await buildStrategySnapshot("tenant_goal_not_set", {
      now: new Date("2026-09-16T12:00:00Z"),
      customerAggregates: [],
    });
    expect(snapshot.payload.goal.target).toBeNull();
    expect(snapshot.payload.goal.targetValue).toBeNull();
    expect(snapshot.payload.goal.gap).toBeNull();
    expect(snapshot.payload.growthPlan.unitsRemaining).toBeNull();
    expect(snapshot.payload.growthPlan.unitsNeededPerWeek).toBeNull();
    expect(snapshot.payload.unresolved.some(item => item.source === "macroGoalService")).toBe(true);
    expect(snapshot.provenance["goal.currentValue"].source).toBe("unavailable");
  });

  it("does not reward a phantom operator goal in the play ranking", async () => {
    const snapshot = await buildStrategySnapshot("tenant_no_goal_rank", {
      now: new Date("2026-09-16T12:00:00Z"),
      customerAggregates: [],
    });
    const candidate: PlayCandidateInput = {
      templateKey: "property_expansion",
      businessName: "Verified property outreach",
      worldName: "The Gate",
      hypothesis: "Field visits could win property access",
      primaryMetric: "active_customers",
      geography: "silverlake",
      stopsCount: 2,
      isClustered: true,
      estimatedInitiationCost: 40,
      estimatedSpendCents: 0,
      spendCategory: "other",
      confidence: "medium",
    };
    expect(snapshot.payload.goal.target).toBeNull();
    const unknownGoalScore = scoreStrategyPlay(candidate, snapshot);
    expect(unknownGoalScore.urgencyAndSpeed).toBe(15);
    snapshot.payload.goal.target = 35;
    const verifiedGoalScore = scoreStrategyPlay(candidate, snapshot);
    expect(verifiedGoalScore.urgencyAndSpeed).toBe(25);
  });

  it("guardrail.G12.net_active_change_and_acquisition_side_by_side", async () => {
    const snapshot = await buildStrategySnapshot(tenantA);
    const { goal } = snapshot.payload;

    // Both metrics must be returned together so churn cannot hide behind new signups
    expect(goal.newPayingCustomers).toBeDefined();
    expect(goal.netActiveChange).toBeDefined();
  });

  it("guardrail.G12.stale_data_and_uncertainties_surfaced_in_unresolved", async () => {
    // Inject the canonical coverage decision; Strategy must not invent a local clock.
    const snapshot = await buildStrategySnapshot(tenantA, {
      sourceCoverageOverride: {
        checkedAt: "2026-09-24T18:00:00.000Z",
        sources: [
          {
            sourceId: "cleancloud",
            includedInCombinedBook: true,
            status: "stale",
            lastSuccessfulAssimilationAt: "2026-09-22T18:00:00.000Z",
            reason: "Gumball checkpoint is overdue",
          },
        ],
      } as any,
    });

    expect(snapshot.staleness["cleanCloud"]).toBeDefined();
    expect(snapshot.staleness["cleanCloud"].isStale).toBe(true);
    expect(snapshot.staleness["cleanCloud"].warning).toContain(
      "Canonical CleanCloud coverage is stale"
    );

    // Unresolved section must reflect canonical stale coverage.
    const staleIssue = snapshot.payload.unresolved.find(u => u.source === "CleanCloud POS");
    expect(staleIssue).toBeDefined();
    expect(staleIssue?.issue).toContain("stale");
  });

  it("enforces size bounds with deterministic truncation", async () => {
    // Set a very tight token budget of 200 tokens to trigger truncation
    const tightBudget = 200;
    const snapshot = await buildStrategySnapshot(tenantA, { tokenBudget: tightBudget });

    expect(snapshot.isTruncated).toBe(true);
    expect(snapshot.truncationDetails).toContain("Token budget exceeded, but no optional list rows can safely be truncated.");
    expect(snapshot.estimatedTokens).toBeGreaterThan(tightBudget);

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

  it("does not fabricate an opportunity or no-next-action gap when the commercial feed is unavailable", async () => {
    const snapshot = await buildStrategySnapshot(tenantA);
    expect(snapshot.payload.opportunities).toEqual([]);
    expect(snapshot.payload.detectedGaps.some(g => g.type === "no_next_action")).toBe(false);
    expect(snapshot.payload.unresolved.some(u => u.source === "strategySnapshot.operationalCoverage")).toBe(true);
  });

  it("does not manufacture property activations, capacity, commitments, or outcomes", async () => {
    const snapshot = await buildStrategySnapshot(tenantA, { now: new Date("2026-09-16T12:00:00Z") });
    const { payload, provenance } = snapshot;
    expect(payload.activation).toEqual([]);
    expect(payload.capacity).toEqual({
      weeklyCapacityPounds: null,
      reservedPounds: null,
      availablePounds: null,
      utilizationPercent: null,
    });
    expect(payload.campaigns).toEqual([]);
    expect(payload.commitments.today).toEqual([]);
    expect(payload.commitments.history14Days).toEqual({ kept: null, missed: null, total: null });
    expect(payload.recentOutcomes).toEqual([]);
    expect(payload.constraints).toEqual([]);
    expect(provenance["capacity.availablePounds"].source).toBe("unavailable");
    expect(JSON.stringify(payload)).not.toMatch(/Wilshire Grand|Broadway Lofts|Marcus K\./);
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
