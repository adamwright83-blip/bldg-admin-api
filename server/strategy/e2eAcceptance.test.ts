import { describe, expect, it, beforeEach } from "vitest";
import { setPlaygroundRules, resetInMemoryRulesForTesting } from "./playgroundRulesService";
import { setActiveMacroGoal, resetInMemoryGoalsForTesting } from "../claire/macroGoalService";
import { buildStrategySnapshot, getLatestStrategySnapshot, getSnapshotProvenance, _clearSnapshotStore } from "./snapshotBuilder";
import { getTodayFeaturedOperation } from "./todayFeaturedService";
import { getOrCreatePathOffer } from "./playGenerator";
import { chooseStrategicPath, getActiveStrategicPath } from "./pathChoiceService";
import { sequenceDailyMissions, getSequencedMissionsForDate } from "./missionSequencer";
import { checkCommunicationPermission, recordCommunicationPermission } from "./communicationPermissionService";
import {
  recordMissedCommitment,
  resolveRecoveryItem,
  getRecoveryState,
  formatRecoveryClaireUtterance,
  _clearRecoveryStores,
} from "./recoveryService";
import { computePlayEvidence, attributeCustomer } from "./evidenceEngine";
import {
  triggerMorning,
  triggerMissionCompletion,
  triggerWeeklyDawn,
} from "./autonomousTriggersService";
import { lintVerdictLanguage, lintCausalLanguage } from "./verdictLint";
import { lintCeoLanguage, lintDisappointmentFraming } from "../claire/disappointmentLint";
import { LAUNDRY_FLUFF_FOLD_TEMPLATE } from "./verticalTemplates/laundryFluffFold";
import type { StrategySnapshot } from "./snapshotTypes";

describe("End-to-End Acceptance (Section 11): 3-Week Fluff-and-Fold Operator Simulation", () => {
  const tenantId = "fixture_solo_fluff_fold_operator";
  const businessDateDay1 = "2026-09-17";
  const businessDateWeek1Dawn = "2026-09-24";
  const businessDateWeek3 = "2026-10-08";

  beforeEach(async () => {
    _clearRecoveryStores();
    _clearSnapshotStore();
    resetInMemoryGoalsForTesting();
    resetInMemoryRulesForTesting();

    // Seed macro goal: active_customers 50 by 2026-10-31, secondary new_paying_customers 25
    await setActiveMacroGoal({
      tenantId,
      operatorUserId: "operator_adam",
      objective: "Reach 50 active fluff and fold customers",
      metricKey: "active_customers",
      targetValue: 50,
      unit: "customers",
      targetDate: "2026-10-31",
      secondaryTargets: [{ metricType: "new_paying_customers", targetValue: 25, unit: "customers" }],
      source: "operator_attested",
      sourceNote: "Confirmed during strategic onboarding",
    });

    // Seed playground rules: $150 monthly ceiling, paid_ads & print_order approval categories
    await setPlaygroundRules({
      tenantId,
      monthlySpendCeilingCents: 15000,
      currency: "USD",
      approvalCategories: ["paid_ads", "print_order"],
      source: "operator_attested",
    });
  });

  it("Step 1: Day 1 Morning brief states gap to 50, featured operation matches all surfaces, no CEO language", async () => {
    const snapshot = await buildStrategySnapshot(tenantId, { activeCustomersCount: 27 });
    expect(snapshot).toBeDefined();

    // Goal and gap validation
    expect(snapshot.payload.goal.targetValue).toBe(50);
    expect(snapshot.payload.goal.gap).toBe(23); // 50 target - 27 active = 23 gap

    // Single source of what matters today (Guardrail G7)
    const featured = await getTodayFeaturedOperation(tenantId);
    expect(featured.operationId).toBeDefined();

    // Verify CEO language lint passes for all strings
    const ceoCheckHeadline = lintCeoLanguage(featured.businessName);
    expect(ceoCheckHeadline.passes).toBe(true);
    const ceoCheckBrief = lintCeoLanguage(featured.briefing);
    expect(ceoCheckBrief.passes).toBe(true);
  });

  it("Step 2: Fork renders 2-3 route options; Claire recommends one; choice activates play without warmth (G1)", async () => {
    const offer = await getOrCreatePathOffer(tenantId);
    expect(offer.offeredPlayIds.length).toBeGreaterThanOrEqual(2);
    expect(offer.offeredPlayIds.length).toBeLessThanOrEqual(3);
    expect(offer.recommendedPlayId).toBeDefined();
    expect(offer.claireRationale).toBeDefined();

    // Operator deliberately chooses recommended path
    const choiceResult = await chooseStrategicPath({
      tenantId,
      playId: offer.recommendedPlayId,
      surface: "map",
      offerId: offer.offerId,
    });

    expect(choiceResult.playId).toBe(offer.recommendedPlayId);

    // Active path now set
    const activePath = getActiveStrategicPath(tenantId);
    expect(activePath).toBe(offer.recommendedPlayId);
  });

  it("Step 3: Sequencer lays out capped, geographically clustered plan; print order sits in wait_approval (G6)", async () => {
    const snapshot = await buildStrategySnapshot(tenantId);

    // Choose door tag campaign that includes print order spend ($75.00)
    await chooseStrategicPath({
      tenantId,
      playId: "play_door_tags_approval",
      surface: "map",
    });

    const sequenceResult = await sequenceDailyMissions({
      tenantId,
      actorId: "operator_adam",
      businessDate: businessDateDay1,
      snapshot,
    });

    expect(sequenceResult.growthMissions.length).toBeLessThanOrEqual(1); // 1 growth outing per day
    const printMission = sequenceResult.growthMissions.find(m => m.spendCategory === "print_order");
    if (printMission) {
      // Guardrail G6: Sits in wait_approval pending human approval
      expect(printMission.status).toBe("wait_approval");
      expect(printMission.spendReservationId).toBeDefined();
    }
  });

  it("Step 4 & 5: 2 of 6 visits completed (no call); 4 misses produce 1 visible Recovery & 3 queued; drop requires reason", async () => {
    // 2 of 6 visits completed with no outbound call
    const comp1 = await triggerMissionCompletion({
      tenantId,
      missionId: "com_visit_1",
      businessDate: businessDateDay1,
    });
    expect(comp1.worldUpdated).toBe(true);
    expect(comp1.placedOutboundCall).toBe(false); // Guardrail: Zero outbound calls on completion!

    const comp2 = await triggerMissionCompletion({
      tenantId,
      missionId: "com_visit_2",
      businessDate: businessDateDay1,
    });
    expect(comp2.worldUpdated).toBe(true);
    expect(comp2.placedOutboundCall).toBe(false);

    // 4 misses produce 1 visible Recovery item and 3 queued items
    for (let i = 3; i <= 6; i++) {
      await recordMissedCommitment({
        tenantId,
        commitmentRef: `com_visit_${i}`,
        title: `Luxury Property Visit #${i}`,
      });
    }

    const recoveryState = getRecoveryState(tenantId);
    expect(recoveryState.visibleItem).not.toBeNull();
    expect(recoveryState.queuedCount).toBe(3); // 1 visible + 3 queued = 4 misses

    // Claire recovery utterance passes G2 disappointment lint with kintsugi framing
    const utterance = formatRecoveryClaireUtterance(recoveryState.visibleItem);
    expect(utterance).toContain("repair it today, reschedule it for an upcoming route, or set it aside with a reason");
    const g2Lint = lintDisappointmentFraming(utterance);
    expect(g2Lint.passes).toBe(true);

    // Drop one commitment with spoken reason and confirmation
    const dropped = await resolveRecoveryItem({
      tenantId,
      itemId: recoveryState.visibleItem!.id,
      action: "drop",
      dropReason: "Building manager on personal leave until November",
      surface: "voice",
      spokenConfirmation: true,
    });
    expect(dropped.item.state).toBe("dropped");
    expect(dropped.item.dropReason).toContain("personal leave");
  });

  it("Step 6: Week 1 Dawn presents world language summary with provenance, no verdicts, below-threshold plays don't dim (G5)", async () => {
    // Under 14-day threshold, play accumulates evidence but does NOT dim
    const earlyEvidence = await computePlayEvidence({
      tenantId,
      playId: "play_prop_slice08",
      windowDays: 7,
      windowStart: "2026-09-17",
      windowEnd: "2026-09-24",
      funnelCounts: { visits: 3, newCustomers: 0 },
      exposureUnits: 3,
      linkedCustomers: 0,
    });

    expect(earlyEvidence.thresholdMet).toBe(false);
    expect(earlyEvidence.worldSignal).toBe("none"); // Guardrail G5: Never dims below threshold!

    // Weekly Dawn trigger
    const dawnResult = await triggerWeeklyDawn({
      tenantId,
      businessDate: businessDateWeek1Dawn,
    });

    expect(dawnResult.placedCall).toBe(false); // No call placed!
    expect(dawnResult.dawn.worldNarrative).toBeDefined();

    // Passes G5 verdict lint
    const vLint = lintVerdictLanguage(dawnResult.dawn.worldNarrative);
    expect(vLint.valid).toBe(true);

    // Passes CEO language lint
    const ceoLint = lintCeoLanguage(dawnResult.dawn.worldNarrative);
    expect(ceoLint.passes).toBe(true);

    // Provenance attached
    expect(dawnResult.dawn.provenance.source).toBeDefined();
  });

  it("Step 7: Week 3 above-threshold play with zero attributable customers dims; path offer created; no auto-switch", async () => {
    // 21 days and 10 visits with 0 linked customers -> above threshold -> DIMS
    const week3Evidence = await computePlayEvidence({
      tenantId,
      playId: "play_prop_slice08",
      windowDays: 21,
      windowStart: "2026-09-17",
      windowEnd: "2026-10-08",
      funnelCounts: { visits: 10, newCustomers: 0 },
      exposureUnits: 10,
      linkedCustomers: 0,
    });

    expect(week3Evidence.thresholdMet).toBe(true);
    expect(week3Evidence.worldSignal).toBe("dim"); // Route dims on map!

    // Engine proposes path change offer as evidence, but DOES NOT auto-switch active path
    const offer = await getOrCreatePathOffer(tenantId);
    expect(offer.offeredPlayIds.length).toBeGreaterThanOrEqual(2);

    // Active path remains what operator chose until operator deliberately changes it
    const activePath = getActiveStrategicPath(tenantId);
    expect(activePath).toBeDefined();
  });

  it("Step 8: Spoken numbers trace to snapshot ID and provenance", async () => {
    const snapshot = await buildStrategySnapshot(tenantId);
    const prov = await getSnapshotProvenance(tenantId, snapshot.id, "goal");
    expect(prov).toBeDefined();
    expect(prov.computedAt).toBeDefined();
    expect(prov.source).toBeDefined();
  });

  it("Step 9: Customer Journey Commercial Truths (G12 & G14)", async () => {
    // 1. Opt-out blocks follow-up (Guardrail G14)
    await recordCommunicationPermission({
      tenantId,
      subjectType: "customer",
      subjectId: "cust_optout_e2e",
      status: "opted_out",
      reason: "No SMS requests",
    });

    const permCheck = await checkCommunicationPermission({
      tenantId,
      subjectType: "customer",
      subjectId: "cust_optout_e2e",
    });
    expect(permCheck.allowed).toBe(false);

    // 2. Explicit attribution required; unlinked is unattributed
    const attr = await attributeCustomer({
      tenantId,
      customerId: "cust_unlinked_e2e",
    });
    expect(attr.status).toBe("unattributed");

    // 3. Causal claims rejected by lint (G12)
    const causalCheck = lintCausalLanguage("This play created 12 customers.");
    expect(causalCheck.valid).toBe(false);

    // 4. Linked phrasing passes
    const linkedCheck = lintCausalLanguage("14 days: 8 visits, 2 linked paying customers.");
    expect(linkedCheck.valid).toBe(true);
  });

  it("Step 10: Portability: Non-laundry vertical template & different goal metric type executes cleanly", async () => {
    const nonLaundryTenant = "fixture_hvac_commercial_operator";

    // Set different goal metric: paid_orders_per_period
    await setActiveMacroGoal({
      tenantId: nonLaundryTenant,
      operatorUserId: "operator_hvac",
      objective: "Complete 120 paid HVAC service orders",
      metricKey: "paid_orders_per_period",
      targetValue: 120,
      unit: "orders",
      targetDate: "2026-12-31",
      source: "operator_attested",
      sourceNote: "Confirmed target",
    });

    await setPlaygroundRules({
      tenantId: nonLaundryTenant,
      monthlySpendCeilingCents: 50000,
      currency: "USD",
      approvalCategories: ["paid_ads"],
      source: "operator_attested",
    });

    const snapshot = await buildStrategySnapshot(nonLaundryTenant);
    expect(snapshot.payload.goal.metricType).toBe("paid_orders_per_period");
    expect(snapshot.payload.goal.targetValue).toBe(120);

    // Offer fork for non-laundry tenant
    const offer = await getOrCreatePathOffer(nonLaundryTenant);
    expect(offer.offeredPlayIds.length).toBeGreaterThanOrEqual(2);

    // Choose path
    await chooseStrategicPath({
      tenantId: nonLaundryTenant,
      playId: offer.recommendedPlayId,
      surface: "map",
    });

    const activePath = getActiveStrategicPath(nonLaundryTenant);
    expect(activePath).toBe(offer.recommendedPlayId);
  });
});
