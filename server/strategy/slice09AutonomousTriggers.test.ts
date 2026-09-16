import { describe, expect, it, beforeEach } from "vitest";
import {
  triggerMorning,
  triggerMissionCompletion,
  triggerMissionSkip,
  triggerBusinessChange,
  triggerWeeklyDawn,
  getTriggerRuns,
  _clearTriggerStores,
} from "./autonomousTriggersService";
import { lintVerdictLanguage } from "./verdictLint";
import { lintCeoLanguage } from "../claire/disappointmentLint";
import { chooseStrategicPath } from "./pathChoiceService";
import { setPlaygroundRules } from "./playgroundRulesService";

describe("Slice 9: Autonomous Triggers", () => {
  const tenantId = "tenant_slice09_test";
  const businessDate = "2026-09-17";

  beforeEach(async () => {
    _clearTriggerStores();

    await setPlaygroundRules({
      tenantId,
      monthlySpendCeilingCents: 15000,
      currency: "USD",
      approvalCategories: ["paid_ads"],
      source: "operator_attested",
    });

    await chooseStrategicPath({
      tenantId,
      playId: "play_prop_slice09",
      surface: "map",
    });
  });

  it("morning trigger runs idempotently: re-running for same date returns existing run", async () => {
    const run1 = await triggerMorning({
      tenantId,
      businessDate,
      actorId: "actor_adam",
    });

    expect(run1.snapshotId).toBeDefined();
    expect(run1.dedupeKey).toContain("morning:2026-09-17");

    const run2 = await triggerMorning({
      tenantId,
      businessDate,
      actorId: "actor_adam",
    });

    expect(run2.snapshotId).toBe(run1.snapshotId);
    expect(run2.dedupeKey).toBe(run1.dedupeKey);
    expect(run2.featuredOperationId).toBe(run1.featuredOperationId);
  });

  it("guardrail.completion_does_not_place_call: mission completion updates world but places zero calls", async () => {
    const result = await triggerMissionCompletion({
      tenantId,
      missionId: "mis_field_01",
      businessDate,
    });

    expect(result.worldUpdated).toBe(true);
    expect(result.placedOutboundCall).toBe(false); // STRICT GUARANTEE: Zero calls on completion!
    expect(result.warmthEventEmitted).toBe(true); // Allowlisted G1 warmth queued for next natural conversation
  });

  it("skip routes to reschedule and Recovery without push notification or call", async () => {
    const result = await triggerMissionSkip({
      tenantId,
      missionId: "mis_field_02",
      businessDate,
    });

    expect(result.routedToRecovery).toBe(true);
    expect(result.rescheduleProposed).toBe(true);
    expect(result.sentNotification).toBe(false); // NO judgment push notification
    expect(result.placedCall).toBe(false);        // NO phone call
  });

  it("debounce on business change: rapid triggers within debounce window are debounced", async () => {
    const firstChange = await triggerBusinessChange({
      tenantId,
      businessDate,
      eventType: "customer_count_changed",
    });

    expect(firstChange.executed).toBe(true);
    expect(firstChange.debounced).toBe(false);

    // Immediate second change
    const secondChange = await triggerBusinessChange({
      tenantId,
      businessDate,
      eventType: "large_order_arrived",
    });

    expect(secondChange.executed).toBe(false);
    expect(secondChange.debounced).toBe(true); // Debounced!
  });

  it("weekly Dawn contains world-language plus provenance links and no verdict or CEO language", async () => {
    const result = await triggerWeeklyDawn({
      tenantId,
      businessDate: "2026-09-20",
    });

    expect(result.placedCall).toBe(false); // NO dedicated phone call
    expect(result.dawn).toBeDefined();
    expect(result.dawn.headline).toContain("Dawn");
    expect(result.dawn.worldNarrative).toBeDefined();

    // Verify narrative obeys G5 (no verdict words)
    const vLint = lintVerdictLanguage(result.dawn.worldNarrative);
    expect(vLint.valid).toBe(true);

    // Verify narrative obeys CEO language prohibition
    const ceoLint = lintCeoLanguage(result.dawn.worldNarrative);
    expect(ceoLint.passes).toBe(true);

    // Verify provenance is attached
    expect(result.dawn.provenance.source).toContain("triggerWeeklyDawn");
    expect(result.dawn.provenance.computedAt).toBeDefined();
  });

  it("business-local date handling across daylight saving transitions", async () => {
    // Test pre and post DST dates
    const springDate = "2026-03-08";
    const fallDate = "2026-11-01";

    const springRun = await triggerMorning({
      tenantId,
      businessDate: springDate,
      actorId: "adam",
    });
    expect(springRun.dedupeKey).toContain(springDate);

    const fallRun = await triggerMorning({
      tenantId,
      businessDate: fallDate,
      actorId: "adam",
    });
    expect(fallRun.dedupeKey).toContain(fallDate);
  });

  it("tenant isolation: triggers and execution records are strictly tenant-isolated", async () => {
    await triggerMissionCompletion({
      tenantId: "tenant_trigger_A",
      missionId: "mis_A",
      businessDate,
    });

    const historyA = getTriggerRuns("tenant_trigger_A");
    expect(historyA.length).toBe(1);
    expect(historyA[0].tenantId).toBe("tenant_trigger_A");

    const historyB = getTriggerRuns("tenant_trigger_B");
    expect(historyB.length).toBe(0);
  });
});
