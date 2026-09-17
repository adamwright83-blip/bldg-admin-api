import { describe, expect, it, beforeEach } from "vitest";
import { sequenceDailyMissions, getSequencedMissionsForDate, _clearMemoryMissions } from "./missionSequencer";
import {
  checkCommunicationPermission,
  recordCommunicationPermission,
  recordOutreachAttempt,
} from "./communicationPermissionService";
import { buildPreparedSalesPrep } from "./missionSalesPrep";
import { setPlaygroundRules } from "./playgroundRulesService";
import { chooseStrategicPath } from "./pathChoiceService";
import type { StrategySnapshot } from "./snapshotTypes";

function createFixtureSnapshot(overrides?: Partial<StrategySnapshot>): StrategySnapshot {
  return {
    snapshotId: "snap_slice07_fixture",
    tenantId: "tenant_slice07_test",
    generatedAt: "2026-09-16T12:00:00Z",
    contentHash: "hash123",
    schemaVersion: 1,
    estimatedTokens: 2500,
    goal: {
      metricType: "active_customers",
      targetValue: 50,
      targetDate: "2026-10-31",
      currentValue: 27,
      gap: 23,
      newPayingCustomers: 5,
      netActiveChange: 2,
    },
    growthPlan: {
      unitsRemaining: 23,
      unitsNeededPerWeek: 4,
      genericFunnelStages: ["lead", "contacted", "first_order", "repeat_order"],
      limitingStage: "contacted",
      nextActions: ["Visit luxury properties"],
      observedConversionRates: [],
      planningScenarios: [],
    },
    growthMetrics: {
      newPayingCustomers: 5,
      uncertainNewCustomersCount: 0,
      uncertainReasons: [],
      reactivatedCustomers: 2,
      paidOrderCount: 45,
      netSalesCents: 157500,
      refundUncertaintyFlag: false,
      firstToSecondCohortRatio: 0.4,
      netActiveChange: 2,
    },
    repeatPipeline: [
      {
        identityId: "cust_ready_order",
        customerName: "Eleanor Vance",
        firstOrderDate: "2026-08-25",
        fulfillmentStatus: "completed",
        feedbackStatus: "positive",
        secondOrderOccurred: false,
        cohortAgeDays: 22,
        buildingName: "The Grandview",
      },
    ],
    playgroundRules: {
      monthlySpendCeilingCents: 15000, // $150
      monthToDateSpendCents: 0,
      remainingBudgetCents: 15000,
      approvalCategories: ["paid_ads", "print_order"],
    },
    customers: {
      activeCount: 27,
      trendWeeks: [],
      dormantRecoveryEligible: [],
    },
    accounts: [
      {
        id: 101,
        name: "Greystar Towers",
        status: "Contested",
        address: "100 Pine St",
        unitCount: 300,
      },
      {
        id: 102,
        name: "Pacific Heights Place",
        status: "Wait",
        address: "250 California St",
        unitCount: 150,
      },
    ],
    opportunities: [
      {
        id: 201,
        accountName: "The Harrison",
        stage: "access_granted",
        lastInteraction: "Property manager approved flyer distribution",
        nextAction: "", // No next action -> GAP!
      },
    ],
    activation: [],
    capacity: {
      date: "2026-09-17",
      maxDailyLoads: 20,
      scheduledDeliveries: 5,
      availableCapacityLoads: 15,
      constraintFlag: false,
    },
    campaigns: [],
    commitments: [],
    recentOutcomes: [],
    constraints: {
      availableFieldWindows: ["09:00-12:00"],
      deliveryObligations: ["14:00-18:00"],
    },
    unresolved: [],
    provenanceMap: {},
    stalenessMap: {},
    ...overrides,
  };
}

describe("Slice 7: Mission Sequencing, Opportunity Follow-Through, and Sales Prep", () => {
  const tenantId = "tenant_slice07_test";
  const businessDate = "2026-09-17";

  beforeEach(async () => {
    _clearMemoryMissions();
    // Setup rules: $150 ceiling, print_order requires approval
    await setPlaygroundRules({
      tenantId,
      monthlySpendCeilingCents: 15000,
      currency: "USD",
      approvalCategories: ["paid_ads", "print_order"],
      source: "operator_attested",
    });
  });

  it("PR #148 parity: sequences growth outings under chosen active path", async () => {
    // Activate a property expansion play
    await chooseStrategicPath({
      tenantId,
      playId: "play_prop_expansion_01",
      surface: "map",
    });

    const snapshot = createFixtureSnapshot();
    const result = await sequenceDailyMissions({
      tenantId,
      actorId: "operator_adam",
      businessDate,
      snapshot,
    });

    expect(result.growthMissions.length).toBeGreaterThan(0);
    const mission = result.growthMissions[0];
    expect(mission.playId).toBe("play_prop_expansion_01");
    expect(mission.title).toContain("Property Expansion Outing");
    expect(mission.preparedSalesPrep.whoToApproach).toBeDefined();
    expect(mission.preparedSalesPrep.completionCondition).toContain("Confirm a launch date");
  });

  it("guardrail.G6.sequencer_respects_ceiling: spend-dependent mission over ceiling is blocked", async () => {
    // Set ceiling to $20
    await setPlaygroundRules({
      tenantId: "tenant_ceiling_test",
      monthlySpendCeilingCents: 2000,
      currency: "USD",
      approvalCategories: [],
      source: "operator_attested",
    });

    await chooseStrategicPath({
      tenantId: "tenant_ceiling_test",
      playId: "play_door_tags_expensive",
      surface: "map",
    });

    const snapshot = createFixtureSnapshot({
      tenantId: "tenant_ceiling_test",
      playgroundRules: {
        monthlySpendCeilingCents: 2000,
        monthToDateSpendCents: 0,
        remainingBudgetCents: 2000,
        approvalCategories: [],
      },
    });

    // The door tag play requires $75.00 spend, which exceeds the $20.00 ceiling
    const result = await sequenceDailyMissions({
      tenantId: "tenant_ceiling_test",
      actorId: "operator_adam",
      businessDate,
      snapshot,
    });

    expect(result.growthMissions.length).toBe(0);
    expect(result.unresolvedIssues.some(u => u.includes("exceeded spend ceiling"))).toBe(true);
  });

  it("guardrail.G6.approval_category_creates_wait_mission: mission requiring approval sits in wait_approval", async () => {
    // Ceiling is $150, but print_order is in approvalCategories
    await chooseStrategicPath({
      tenantId,
      playId: "play_door_tags_approval",
      surface: "map",
    });

    const snapshot = createFixtureSnapshot();
    const result = await sequenceDailyMissions({
      tenantId,
      actorId: "operator_adam",
      businessDate,
      snapshot,
    });

    const printMission = result.growthMissions.find(m => m.spendCategory === "print_order");
    expect(printMission).toBeDefined();
    expect(printMission?.status).toBe("wait_approval");
    expect(printMission?.spendReservationId).toBeDefined();
  });

  it("daily cap enforced: maximum 1 growth outing and 6 stops per outing", async () => {
    await chooseStrategicPath({
      tenantId,
      playId: "play_prop_expansion_01",
      surface: "map",
    });

    const snapshot = createFixtureSnapshot();
    const result = await sequenceDailyMissions({
      tenantId,
      actorId: "operator_adam",
      businessDate,
      snapshot,
      config: { maxGrowthOutingsPerDay: 1, maxStopsPerOuting: 4 },
    });

    expect(result.growthMissions.length).toBeLessThanOrEqual(1);
    for (const m of result.growthMissions) {
      expect(m.stopCount).toBeLessThanOrEqual(4);
    }
  });

  it("idempotency: re-running sequencer for same day and play creates nothing new", async () => {
    await chooseStrategicPath({
      tenantId,
      playId: "play_prop_expansion_01",
      surface: "map",
    });

    const snapshot = createFixtureSnapshot();
    const firstRun = await sequenceDailyMissions({
      tenantId,
      actorId: "operator_adam",
      businessDate,
      snapshot,
    });

    const secondRun = await sequenceDailyMissions({
      tenantId,
      actorId: "operator_adam",
      businessDate,
      snapshot,
    });

    expect(secondRun.growthMissions.length).toBe(firstRun.growthMissions.length);
    expect(secondRun.growthMissions[0].id).toBe(firstRun.growthMissions[0].id);
  });

  it("guardrail.G4.queued_claim_matches_written_missions: receipt reflects storage truth", async () => {
    await chooseStrategicPath({
      tenantId,
      playId: "play_prop_expansion_01",
      surface: "map",
    });

    const snapshot = createFixtureSnapshot();
    const result = await sequenceDailyMissions({
      tenantId,
      actorId: "operator_adam",
      businessDate,
      snapshot,
    });

    expect(result.receipt.verifiedInStorage).toBe(true);
    expect(result.receipt.queuedGrowthCount).toBe(result.growthMissions.length);

    // Verify post-write read returns identical records
    const stored = await getSequencedMissionsForDate(tenantId, businessDate);
    expect(stored.length).toBe(result.growthMissions.length + result.supportMissions.length);
  });

  it("guardrail.G14.opt_out_blocks_follow_up: opted-out or refused contacts receive zero follow-ups", async () => {
    // Record opt-out for customer Eleanor Vance
    await recordCommunicationPermission({
      tenantId,
      subjectType: "customer",
      subjectId: "cust_ready_order",
      status: "opted_out",
      reason: "Requested no further texts",
    });

    const check = await checkCommunicationPermission({
      tenantId,
      subjectType: "customer",
      subjectId: "cust_ready_order",
    });
    expect(check.allowed).toBe(false);
    expect(check.permissionStatus).toBe("opted_out");

    const snapshot = createFixtureSnapshot();
    const result = await sequenceDailyMissions({
      tenantId,
      actorId: "operator_adam",
      businessDate: "2026-09-18",
      snapshot,
    });

    // Eleanor Vance must be skipped due to opt-out
    const eleanorMission = result.supportMissions.find(m => m.title.includes("Eleanor Vance"));
    expect(eleanorMission).toBeUndefined();
    expect(result.unresolvedIssues.some(u => u.includes("opted out"))).toBe(true);
  });

  it("guardrail.G14.frequency_limit_respected: contact made within frequency cap blocks outreach", async () => {
    // Record outreach attempt 2 days ago with 7-day cap
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await recordCommunicationPermission({
      tenantId,
      subjectType: "customer",
      subjectId: "cust_freq_test",
      status: "opted_in",
      frequencyCapDays: 7,
    });
    await recordOutreachAttempt({
      tenantId,
      subjectType: "customer",
      subjectId: "cust_freq_test",
      at: twoDaysAgo,
    });

    const check = await checkCommunicationPermission({
      tenantId,
      subjectType: "customer",
      subjectId: "cust_freq_test",
    });
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("Frequency limit");
  });

  it("follow-up draft explicitly has sent: false and never falsely claims sent (G4/G14)", () => {
    const prep = buildPreparedSalesPrep({
      tenantId,
      playType: "property_expansion",
      accountName: "Luxury Tower",
      verifiedContext: {},
    });

    expect(prep.draftedFollowUp.sent).toBe(false);
    expect(prep.draftedFollowUp.needsHumanClearance).toBe(true);
    expect(prep.draftedFollowUp.message).toContain("Laundry Butler");
  });

  it("gap detector surfaces opportunities with no next action", async () => {
    const snapshot = createFixtureSnapshot();
    const result = await sequenceDailyMissions({
      tenantId,
      actorId: "operator_adam",
      businessDate,
      snapshot,
    });

    expect(result.gapsDetected.some(g => g.includes("The Harrison has no next action"))).toBe(true);
  });

  it("support allowance surfaces ready-to-order customers even when active play is unrelated", async () => {
    // Reset permission for Eleanor Vance to opted_in
    await recordCommunicationPermission({
      tenantId,
      subjectType: "customer",
      subjectId: "cust_ready_order",
      status: "opted_in",
    });

    // Active play is Door Tags, but Eleanor Vance is ready for second order
    await chooseStrategicPath({
      tenantId,
      playId: "play_door_tags_unrelated",
      surface: "map",
    });

    const snapshot = createFixtureSnapshot();
    const result = await sequenceDailyMissions({
      tenantId,
      actorId: "operator_adam",
      businessDate: "2026-09-19",
      snapshot,
    });

    const readyMission = result.supportMissions.find(m => m.title.includes("Eleanor Vance"));
    expect(readyMission).toBeDefined();
    expect(readyMission?.missionType).toBe("support");
  });

  it("open service issue blocks promotion/referral prep", () => {
    const prep = buildPreparedSalesPrep({
      tenantId,
      playType: "property_expansion",
      accountName: "Grandview 4B",
      contactName: "John Doe",
      openServiceIssues: ["Stained silk shirt on order #412"],
      verifiedContext: {},
    });

    expect(prep.serviceIssuesBlocking).toBeDefined();
    expect(prep.serviceIssuesBlocking).toContain("Stained silk shirt");
    expect(prep.approvedOffer.pricingSummary).toContain("No promotional offers while issue is open");
    expect(prep.whoToApproach.why).toContain("Address open service issue");
  });

  it("guardrail.G12.property_approval_not_customer: property approval is access, not acquired customers", () => {
    const prep = buildPreparedSalesPrep({
      tenantId,
      playType: "property_expansion",
      accountName: "The Harrison",
      verifiedContext: {
        units: 300,
        propertyManagerName: "Sarah Connor",
      },
    });

    // Specific request must be pilot launch / flyer distribution, never treating 300 residents as customers
    expect(prep.specificRequest).toContain("resident digital flyers");
    expect(prep.completionCondition).toContain("Confirm a launch date and resident announcement");
  });

  it("growth work respects capacity constraints", async () => {
    await chooseStrategicPath({
      tenantId,
      playId: "play_prop_expansion_01",
      surface: "map",
    });

    // Capacity is 100% full: 20 scheduled out of 20 max
    const snapshot = createFixtureSnapshot({
      capacity: {
        date: "2026-09-17",
        maxDailyLoads: 20,
        scheduledDeliveries: 20,
        availableCapacityLoads: 0,
        constraintFlag: true,
      },
    });

    const result = await sequenceDailyMissions({
      tenantId,
      actorId: "operator_adam",
      businessDate: "2026-09-20",
      snapshot,
    });

    expect(result.growthMissions.length).toBe(0);
    expect(result.unresolvedIssues.some(u => u.includes("Service capacity constrained"))).toBe(true);
  });

  it("tenant isolation: sequenced missions and permissions are strictly isolated", async () => {
    await chooseStrategicPath({
      tenantId: "tenant_isolation_A",
      playId: "play_A",
      surface: "map",
    });

    const snapshotA = createFixtureSnapshot({ tenantId: "tenant_isolation_A" });
    const resultA = await sequenceDailyMissions({
      tenantId: "tenant_isolation_A",
      actorId: "actor_A",
      businessDate,
      snapshot: snapshotA,
    });

    const missionsB = await getSequencedMissionsForDate("tenant_isolation_B", businessDate);
    expect(missionsB.length).toBe(0);
    expect(resultA.growthMissions.every(m => m.tenantId === "tenant_isolation_A")).toBe(true);
  });
});
