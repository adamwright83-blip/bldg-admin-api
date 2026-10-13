import { describe, expect, it } from "vitest";
import { sequenceDailyMissions, getSequencedMissionsForDate } from "./missionSequencer";
import { buildStrategySnapshot } from "./snapshotBuilder";
import { checkCommunicationPermission, recordCommunicationPermission, recordOutreachAttempt } from "./communicationPermissionService";
import { buildPreparedSalesPrep } from "./missionSalesPrep";
import { chooseStrategicPath } from "./pathChoiceService";

describe("Legacy sequencing respects canonical exact-item approval", () => {
  const tenantId = "tenant_slice07_test";
  it.each(["growth outing", "print spend", "urgent support", "capacity restriction", "duplicate run"])("does not auto-commit %s after choosing a direction", async () => {
    const snapshot = await buildStrategySnapshot(tenantId);
    const result = await sequenceDailyMissions({ tenantId, actorId: "operator_adam", businessDate: "2026-10-13", snapshot });
    expect(result.growthMissions).toEqual([]);
    expect(result.supportMissions).toEqual([]);
    expect(result.receipt).toMatchObject({ queuedGrowthCount: 0, queuedSupportCount: 0, verifiedInStorage: false });
    expect(result.unresolvedIssues).toContain("Exact proposal-item approval is required. Review Claire's prepared recommendation before committing work.");
    expect(await getSequencedMissionsForDate(tenantId, "2026-10-13")).toEqual([]);
  });
  it("rejects stale ungrounded play IDs rather than manufacturing tenant-default plays", async () => {
    await expect(chooseStrategicPath({ tenantId, playId: "play_prop_expansion_01", surface: "map" })).rejects.toThrow("existing play belonging to the authorized tenant");
  });
  it("retains explicit opt-out restrictions", async () => {
    await recordCommunicationPermission({ tenantId, subjectType: "customer", subjectId: "opted-out", status: "opted_out" });
    expect(await checkCommunicationPermission({ tenantId, subjectType: "customer", subjectId: "opted-out" })).toMatchObject({ allowed: false, permissionStatus: "opted_out" });
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

});
