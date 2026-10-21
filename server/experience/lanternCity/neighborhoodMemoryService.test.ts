import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetNeighborhoodTestStore,
  loadNeighborhoodWorldMemory,
  recordVillagerInteraction,
  saveNeighborhoodFeature,
  saveUnfinishedLetterDraft,
} from "./neighborhoodMemoryService";

describe("neighborhoodMemoryService (Phase 4 Durable World Memory)", () => {
  beforeEach(() => {
    _resetNeighborhoodTestStore();
  });

  it("loads fresh memory defaults for a new tenant without prior history", async () => {
    const memory = await loadNeighborhoodWorldMemory({
      tenantId: "laundry_farm",
      territoryId: "silver-lake",
      now: new Date("2026-10-19T10:00:00Z"),
    });

    expect(memory.featureChoice).toBeNull();
    expect(memory.visitCount).toBe(1);
    expect(memory.isReturnVisitTomorrowOrLater).toBe(false);
    expect(memory.encounterCounts).toEqual({});
    expect(memory.villagerMemories).toEqual({});
    expect(memory.unfinishedActivity).toBeNull();
  });

  it("persists courtyard feature and records milestone across reloads", async () => {
    const saved = await saveNeighborhoodFeature({
      tenantId: "laundry_farm",
      territoryId: "silver-lake",
      featureChoice: "tea_table",
      now: new Date("2026-10-19T10:15:00Z"),
    });

    expect(saved.featureChoice).toBe("tea_table");
    expect(saved.celebratedMilestones).toContain("milestone_placed_tea_table");

    // Reload from server
    const reloaded = await loadNeighborhoodWorldMemory({
      tenantId: "laundry_farm",
      territoryId: "silver-lake",
      now: new Date("2026-10-19T10:30:00Z"),
      touchVisit: false,
    });

    expect(reloaded.featureChoice).toBe("tea_table");
    expect(reloaded.courtyardPlacedAt).toBeDefined();
    expect(reloaded.celebratedMilestones).toContain("milestone_placed_tea_table");
  });

  it("records villager interaction and evolves relationship tier", async () => {
    // 1st encounter: new acquaintance
    const mem1 = await recordVillagerInteraction({
      tenantId: "laundry_farm",
      territoryId: "silver-lake",
      villagerVariant: "fox",
      customerName: "Mei Lin",
      approach: "helpful_detailed",
      now: new Date("2026-10-19T11:00:00Z"),
    });

    expect(mem1.encounterCounts.fox).toBe(1);
    expect(mem1.villagerMemories.fox.preferredApproach).toBe("helpful_detailed");
    expect(mem1.villagerMemories.fox.relationshipTier).toBe("familiar_friend");

    // Additional encounters progress to cherished partner
    await recordVillagerInteraction({
      tenantId: "laundry_farm",
      territoryId: "silver-lake",
      villagerVariant: "fox",
      customerName: "Barnaby Hayes",
      approach: "helpful_detailed",
    });
    const mem3 = await recordVillagerInteraction({
      tenantId: "laundry_farm",
      territoryId: "silver-lake",
      villagerVariant: "fox",
      customerName: "Chloe Bennett",
      approach: "helpful_detailed",
    });

    expect(mem3.villagerMemories.fox.relationshipTier).toBe("cherished_partner");
    expect(mem3.villagerMemories.fox.memorableMoments.length).toBeGreaterThan(0);
  });

  it("retains unfinished letter draft and clears it upon action commit", async () => {
    // Player starts a draft on Device A
    await saveUnfinishedLetterDraft({
      tenantId: "laundry_farm",
      territoryId: "silver-lake",
      customerId: "cust_mei_lin",
      customerName: "Mei Lin",
      villagerVariant: "badger",
      selectedApproach: "warm_brief",
      draftBody: "Hi Mei! Bramble here with a quick check-in...",
    });

    // Player opens on Device B: unfinished activity is recovered
    const onDeviceB = await loadNeighborhoodWorldMemory({
      tenantId: "laundry_farm",
      territoryId: "silver-lake",
      touchVisit: false,
    });

    expect(onDeviceB.unfinishedActivity).not.toBeNull();
    expect(onDeviceB.unfinishedActivity?.customerId).toBe("cust_mei_lin");
    expect(onDeviceB.unfinishedActivity?.selectedApproach).toBe("warm_brief");
    expect(onDeviceB.unfinishedActivity?.draftBody).toContain("Bramble here");

    // Player commits the letter (e.g. schedules it): unfinished activity clears
    const committed = await recordVillagerInteraction({
      tenantId: "laundry_farm",
      territoryId: "silver-lake",
      villagerVariant: "badger",
      customerId: "cust_mei_lin",
      actionType: "scheduled",
    });

    expect(committed.unfinishedActivity).toBeNull();
  });

  it("strictly distinguishes draft, scheduled, compose handoff, operator reported, and independently verified sent", async () => {
    // 1. Compose handoff opened: does NOT increment dispatched count or verified milestone
    const handoffMem = await recordVillagerInteraction({
      tenantId: "laundry_farm",
      territoryId: "silver-lake",
      villagerVariant: "fox",
      customerId: "cust_101",
      customerName: "Alex Rivera",
      actionType: "compose_handoff_opened",
    });

    expect(handoffMem.villagerMemories.fox.lettersHandoffOpenedCount).toBe(1);
    expect(handoffMem.villagerMemories.fox.lettersDispatchedCount).toBe(0);
    expect(handoffMem.celebratedMilestones).toContain("milestone_handoff_opened_cust_101");
    expect(handoffMem.celebratedMilestones).not.toContain("milestone_verified_sent_cust_101");

    // 2. Operator reported sent: does NOT increment dispatched count or verified milestone
    const reportedMem = await recordVillagerInteraction({
      tenantId: "laundry_farm",
      territoryId: "silver-lake",
      villagerVariant: "fox",
      customerId: "cust_101",
      customerName: "Alex Rivera",
      actionType: "operator_reported_sent",
    });

    expect(reportedMem.villagerMemories.fox.lettersOperatorReportedCount).toBe(1);
    expect(reportedMem.villagerMemories.fox.lettersDispatchedCount).toBe(0);
    expect(reportedMem.celebratedMilestones).not.toContain("milestone_verified_sent_cust_101");

    // 3. Scheduled: increments scheduled count and scheduled milestone, NOT dispatched count
    const schedMem = await recordVillagerInteraction({
      tenantId: "laundry_farm",
      territoryId: "silver-lake",
      villagerVariant: "badger",
      customerId: "cust_102",
      customerName: "Sam Taylor",
      actionType: "scheduled",
    });

    expect(schedMem.villagerMemories.badger.lettersScheduledCount).toBe(1);
    expect(schedMem.villagerMemories.badger.lettersDispatchedCount).toBe(0);
    expect(schedMem.celebratedMilestones).toContain("milestone_scheduled_cust_102");
    expect(schedMem.celebratedMilestones).not.toContain("milestone_verified_sent_cust_102");

    // 4. Independently verified sent: ONLY this increments lettersDispatchedCount and verified milestones
    const verifiedMem = await recordVillagerInteraction({
      tenantId: "laundry_farm",
      territoryId: "silver-lake",
      villagerVariant: "fox",
      customerId: "cust_103",
      customerName: "Jordan Lee",
      actionType: "independently_verified_sent",
    });

    expect(verifiedMem.villagerMemories.fox.lettersDispatchedCount).toBe(1);
    expect(verifiedMem.celebratedMilestones).toContain("milestone_verified_sent_cust_103");
    expect(verifiedMem.celebratedMilestones).toContain("milestone_first_verified_send");
  });

  it("fails visibly instead of silently falling back to in-memory store in non-test mode", async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";

      // Without a database connection in production, operations must throw visibly
      await expect(
        loadNeighborhoodWorldMemory({
          tenantId: "laundry_farm",
          territoryId: "silver-lake",
        })
      ).rejects.toThrow(/database connection unavailable|Failed to load/i);

      await expect(
        saveNeighborhoodFeature({
          tenantId: "laundry_farm",
          territoryId: "silver-lake",
          featureChoice: "reading_bench",
        })
      ).rejects.toThrow(/database connection unavailable|Failed to/i);

      await expect(
        recordVillagerInteraction({
          tenantId: "laundry_farm",
          territoryId: "silver-lake",
          villagerVariant: "fox",
          actionType: "scheduled",
        })
      ).rejects.toThrow(/database connection unavailable|Failed to/i);

      await expect(
        saveUnfinishedLetterDraft({
          tenantId: "laundry_farm",
          territoryId: "silver-lake",
          customerId: "cust_1",
          customerName: "Test",
          villagerVariant: "fox",
          selectedApproach: "warm_brief",
          draftBody: "Hello",
        })
      ).rejects.toThrow(/database connection unavailable|Failed to/i);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("strictly partitions memory by tenant without cross-tenant leakage", async () => {
    await saveNeighborhoodFeature({
      tenantId: "laundry_farm",
      territoryId: "silver-lake",
      featureChoice: "reading_bench",
    });

    const farmMemory = await loadNeighborhoodWorldMemory({
      tenantId: "laundry_farm",
      territoryId: "silver-lake",
      touchVisit: false,
    });
    const butlerMemory = await loadNeighborhoodWorldMemory({
      tenantId: "laundry_butler",
      territoryId: "silver-lake",
      touchVisit: false,
    });

    expect(farmMemory.featureChoice).toBe("reading_bench");
    expect(butlerMemory.featureChoice).toBeNull();
  });

  it("identifies return visits on subsequent calendar days", async () => {
    // Visit 1: Today morning
    await loadNeighborhoodWorldMemory({
      tenantId: "laundry_farm",
      territoryId: "silver-lake",
      now: new Date("2026-10-19T09:00:00-07:00"),
    });

    // Visit 2: Same day afternoon (should NOT be marked tomorrow or later)
    const sameDay = await loadNeighborhoodWorldMemory({
      tenantId: "laundry_farm",
      territoryId: "silver-lake",
      now: new Date("2026-10-19T16:00:00-07:00"),
    });
    expect(sameDay.isReturnVisitTomorrowOrLater).toBe(false);
    expect(sameDay.visitCount).toBe(2);

    // Visit 3: Next day morning (SHOULD be marked return visit tomorrow or later)
    const nextDay = await loadNeighborhoodWorldMemory({
      tenantId: "laundry_farm",
      territoryId: "silver-lake",
      now: new Date("2026-10-20T08:30:00-07:00"),
    });
    expect(nextDay.isReturnVisitTomorrowOrLater).toBe(true);
    expect(nextDay.visitCount).toBe(3);
  });
});
