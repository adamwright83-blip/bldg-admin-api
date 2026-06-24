import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ listRequestJobCardSourceRecords: vi.fn() }));

const { listRequestJobCardSourceRecords } = await import("../db");
const { vendorCastingSprintRouter } = await import("./vendorCastingSprintRouter");

function context(user: { role: string } | null) {
  return { user, tenantId: "default", req: {}, res: {}, vendorSession: null } as never;
}

const emptySources = { serviceRequests: [], coordinatedRequests: [], residentPlans: [] };

const readyServiceRequestSource = {
  serviceRequests: [
    {
      record: {
        id: 155,
        bldgUserId: "resident_1",
        serviceType: "dog_grooming",
        status: "ready_for_admin_review",
        requestSummary: "Dog grooming for Butterscotch",
        requestJson: {
          notes: "Dog name: Butterscotch. Breed/size: Boxer / medium / 78 lbs. Temperament: friendly, no special handling needs. Budget: up to $125 before tip. Requested date: 2026-06-23. Requested window: 11:00 AM to 1:00 PM.",
        },
        scheduledDate: "2026-06-23",
        scheduledWindow: "11:00 AM to 1:00 PM",
        createdAt: new Date("2026-06-22T00:00:00.000Z"),
      },
      residentContext: { bldgUserId: "resident_1", residentName: "A. Resident", buildingSlug: "cpe-south", unit: "4B" },
    },
  ],
  coordinatedRequests: [],
  residentPlans: [],
};

describe("vendor casting sprint admin router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listRequestJobCardSourceRecords).mockResolvedValue(emptySources);
  });

  it("rejects unauthenticated and non-admin callers before querying records", async () => {
    await expect(vendorCastingSprintRouter.createCaller(context(null)).mission({ sourceKey: "service_request:155" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(vendorCastingSprintRouter.createCaller(context({ role: "user" })).mission({ sourceKey: "service_request:155" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(listRequestJobCardSourceRecords).not.toHaveBeenCalled();
  });

  it("rejects a malformed source key without querying records", async () => {
    const result = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).mission({ sourceKey: "not_a_real_key" });
    expect(result).toMatchObject({ found: false, blockedReasons: ["source_key_format_invalid"], mission: null });
    expect(listRequestJobCardSourceRecords).not.toHaveBeenCalled();
  });

  it("reports not found when the source record does not exist", async () => {
    const result = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).mission({ sourceKey: "service_request:999" });
    expect(result).toMatchObject({ found: false, blockedReasons: ["source_job_card_not_found"], mission: null });
  });

  it("computes a no-send casting mission for a real ready job card", async () => {
    vi.mocked(listRequestJobCardSourceRecords).mockResolvedValue(readyServiceRequestSource);
    const result = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).mission({ sourceKey: "service_request:155" });

    expect(listRequestJobCardSourceRecords).toHaveBeenCalledWith({
      tenantId: "default", sources: ["service_request"], fetchCount: 1051,
    });
    expect(result.found).toBe(true);
    expect(result.blockedReasons).toEqual([]);
    expect(result.mission).not.toBeNull();
    expect(result.mission!.sourceJobCard.sourceKey).toBe("service_request:155");
    expect(result.mission!.sourceJobCard.budgetCeiling).toBe(125);
    expect(result.mission!.lanes).toHaveLength(3);
    expect(result.mission!.noSend).toBe(true);
  });

  it("never invokes any outbound provider, send, booking, payment, or LLM path", async () => {
    vi.mocked(listRequestJobCardSourceRecords).mockResolvedValue(readyServiceRequestSource);
    const result = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).mission({ sourceKey: "service_request:155" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/"booked":true/);
    expect(serialized).not.toMatch(/"accepted":true/);
    expect(serialized).not.toMatch(/"paid":true/);
    expect(serialized).not.toMatch(/"dispatched":true/);
    expect(serialized).not.toMatch(/"llmCalled":true/);
  });

  describe("bootstrapHandoff", () => {
    it("rejects unauthenticated and non-admin callers", async () => {
      await expect(vendorCastingSprintRouter.createCaller(context(null)).bootstrapHandoff({ sourceKey: "service_request:155" }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(vendorCastingSprintRouter.createCaller(context({ role: "user" })).bootstrapHandoff({ sourceKey: "service_request:155" }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("produces a handoff packet for the fastest eligible lead by default", async () => {
      vi.mocked(listRequestJobCardSourceRecords).mockResolvedValue(readyServiceRequestSource);
      const result = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).bootstrapHandoff({ sourceKey: "service_request:155" });
      expect(result.found).toBe(true);
      expect(result.allowed).toBe(true);
      expect(result.handoff).not.toBeNull();
      expect(result.handoff!.sourceJobCardKey).toBe("service_request:155");
      expect(result.handoff!.truthDisclaimers).toContain("No outreach has been sent.");
      expect(result.handoff!.truthDisclaimers).toContain("No vendor has responded.");
      expect(result.handoff!.truthDisclaimers).toContain("No provider has accepted.");
      expect(result.handoff!.truthDisclaimers).toContain("No booking is confirmed.");
      expect(result.handoff!.truthDisclaimers).toContain("This is a sourcing/candidate handoff only.");
    });

    it("never marks vendor responded/accepted/booked/resident-ready and invokes no outbound or LLM path", async () => {
      vi.mocked(listRequestJobCardSourceRecords).mockResolvedValue(readyServiceRequestSource);
      const result = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).bootstrapHandoff({ sourceKey: "service_request:155" });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/"vendorResponded":true/);
      expect(serialized).not.toMatch(/"providerAccepted":true/);
      expect(serialized).not.toMatch(/"booked":true/);
      expect(serialized).not.toMatch(/"paid":true/);
      expect(serialized).not.toMatch(/"dispatched":true/);
      expect(serialized).not.toMatch(/"residentReady":true/);
      expect(serialized).not.toMatch(/"sentByHeld":true/);
    });

    it("reports not found when the source job card is missing", async () => {
      const result = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).bootstrapHandoff({ sourceKey: "service_request:999" });
      expect(result).toMatchObject({ found: false, allowed: false, blockedReasons: ["source_job_card_not_found"], handoff: null });
    });
  });

  describe("generateOutreachDraft", () => {
    const realVendorFacts = {
      businessName: "Westside Mobile Pet Spa",
      phone: "555-010-2002",
      sourceType: "manual_operator_list" as const,
      sourceReference: "Adam called and confirmed via Google Maps listing",
      serviceArea: "cpe-south",
      qualificationNotes: "Verified by Adam directly; services boxers, mobile van, available weekdays.",
    };

    it("rejects unauthenticated and non-admin callers", async () => {
      await expect(vendorCastingSprintRouter.createCaller(context(null)).generateOutreachDraft({
        sourceKey: "service_request:155", leadId: "x", vendorFacts: realVendorFacts,
      })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("blocks draft generation when required vendor facts are missing", async () => {
      vi.mocked(listRequestJobCardSourceRecords).mockResolvedValue(readyServiceRequestSource);
      const mission = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).mission({ sourceKey: "service_request:155" });
      const winnerLeadId = mission.mission!.winner!.leadId;
      const result = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).generateOutreachDraft({
        sourceKey: "service_request:155",
        leadId: winnerLeadId,
        vendorFacts: { ...realVendorFacts, businessName: "", phone: null },
      });
      expect(result.allowed).toBe(false);
      expect(result.draft).toBeNull();
      expect(result.blockedReasons).toContain("business_name_required");
      expect(result.blockedReasons).toContain("at_least_one_contact_method_required");
    });

    it("blocks draft generation when the demo lead name is reused as real evidence", async () => {
      vi.mocked(listRequestJobCardSourceRecords).mockResolvedValue(readyServiceRequestSource);
      const mission = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).mission({ sourceKey: "service_request:155" });
      const winner = mission.mission!.winner!;
      const result = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).generateOutreachDraft({
        sourceKey: "service_request:155",
        leadId: winner.leadId,
        vendorFacts: { ...realVendorFacts, businessName: winner.businessName },
      });
      expect(result.allowed).toBe(false);
      expect(result.blockedReasons).toContain("demo_lead_business_name_reused_as_real");
    });

    it("generates a safe-to-copy draft with real vendor facts and never invokes a live provider", async () => {
      vi.mocked(listRequestJobCardSourceRecords).mockResolvedValue(readyServiceRequestSource);
      const mission = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).mission({ sourceKey: "service_request:155" });
      const winnerLeadId = mission.mission!.winner!.leadId;
      const result = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).generateOutreachDraft({
        sourceKey: "service_request:155",
        leadId: winnerLeadId,
        vendorFacts: realVendorFacts,
      });
      expect(result.allowed).toBe(true);
      expect(result.draft).not.toBeNull();
      expect(result.draft!.safeToCopy).toBe(true);
      expect(result.draft!.sentByHeld).toBe(false);
      expect(result.draft!.body).toContain("Butterscotch");
      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/"booked":true/);
      expect(serialized).not.toMatch(/"dispatched":true/);
    });
  });

  describe("candidateCreationPayload", () => {
    const realVendorFacts = {
      businessName: "Westside Mobile Pet Spa",
      phone: "555-010-2002",
      sourceType: "manual_operator_list" as const,
      sourceReference: "Adam called and confirmed via Google Maps listing",
      serviceArea: "cpe-south",
      qualificationNotes: "Verified by Adam directly; services boxers, mobile van, available weekdays.",
    };

    it("rejects unauthenticated and non-admin callers", async () => {
      await expect(vendorCastingSprintRouter.createCaller(context(null)).candidateCreationPayload({
        sourceKey: "service_request:155", leadId: "x", vendorFacts: realVendorFacts,
      })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("requires businessName", async () => {
      vi.mocked(listRequestJobCardSourceRecords).mockResolvedValue(readyServiceRequestSource);
      const mission = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).mission({ sourceKey: "service_request:155" });
      const winnerLeadId = mission.mission!.winner!.leadId;
      const result = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).candidateCreationPayload({
        sourceKey: "service_request:155", leadId: winnerLeadId, vendorFacts: { ...realVendorFacts, businessName: "" },
      });
      expect(result.allowed).toBe(false);
      expect(result.payload).toBeNull();
      expect(result.blockedReasons).toContain("business_name_required");
    });

    it("requires at least one contact method", async () => {
      vi.mocked(listRequestJobCardSourceRecords).mockResolvedValue(readyServiceRequestSource);
      const mission = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).mission({ sourceKey: "service_request:155" });
      const winnerLeadId = mission.mission!.winner!.leadId;
      const result = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).candidateCreationPayload({
        sourceKey: "service_request:155", leadId: winnerLeadId, vendorFacts: { ...realVendorFacts, phone: null },
      });
      expect(result.allowed).toBe(false);
      expect(result.blockedReasons).toContain("at_least_one_contact_method_required");
    });

    it("blocks demo-only lead data from being treated as real evidence", async () => {
      vi.mocked(listRequestJobCardSourceRecords).mockResolvedValue(readyServiceRequestSource);
      const mission = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).mission({ sourceKey: "service_request:155" });
      const winner = mission.mission!.winner!;
      const result = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).candidateCreationPayload({
        sourceKey: "service_request:155", leadId: winner.leadId, vendorFacts: { ...realVendorFacts, businessName: winner.businessName },
      });
      expect(result.allowed).toBe(false);
      expect(result.blockedReasons).toContain("demo_lead_business_name_reused_as_real");
    });

    it("builds a payload compatible with firstRealProposalBootstrap.createCandidate without writing anything itself", async () => {
      vi.mocked(listRequestJobCardSourceRecords).mockResolvedValue(readyServiceRequestSource);
      const mission = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).mission({ sourceKey: "service_request:155" });
      const winnerLeadId = mission.mission!.winner!.leadId;
      const result = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).candidateCreationPayload({
        sourceKey: "service_request:155", leadId: winnerLeadId, vendorFacts: realVendorFacts,
      });
      expect(result.allowed).toBe(true);
      expect(result.payload).toMatchObject({
        tenantId: "default",
        sourceType: "manual_operator_list",
        category: "dog_grooming",
        businessName: "Westside Mobile Pet Spa",
        phone: "555-010-2002",
        serviceArea: "cpe-south",
      });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/"booked":true/);
      expect(serialized).not.toMatch(/"accepted":true/);
      expect(serialized).not.toMatch(/"dispatched":true/);
      expect(serialized).not.toMatch(/rating/i);
    });
  });
});
