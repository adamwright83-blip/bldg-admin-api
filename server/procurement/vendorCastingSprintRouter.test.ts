import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ listRequestJobCardSourceRecords: vi.fn() }));

const { listRequestJobCardSourceRecords } = await import("../db");
const { vendorCastingSprintRouter, createVendorCastingSprintRouter } = await import("./vendorCastingSprintRouter");

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

  describe("runContactAttempt", () => {
    const realVendorFacts = {
      businessName: "Westside Mobile Pet Spa",
      phone: "555-010-2002",
      sourceType: "manual_operator_list" as const,
      sourceReference: "Adam called and confirmed via Google Maps listing",
      serviceArea: "cpe-south",
      qualificationNotes: "Verified by Adam directly; services boxers, mobile van, available weekdays.",
    };

    it("rejects unauthenticated and non-admin callers", async () => {
      await expect(vendorCastingSprintRouter.createCaller(context(null)).runContactAttempt({
        sourceKey: "service_request:155", leadId: "x", channel: "email", vendorFacts: realVendorFacts,
      })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("runs a no-op attempt and never invokes a live outbound provider", async () => {
      vi.mocked(listRequestJobCardSourceRecords).mockResolvedValue(readyServiceRequestSource);
      const mission = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).mission({ sourceKey: "service_request:155" });
      const winnerLeadId = mission.mission!.winner!.leadId;
      const result = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).runContactAttempt({
        sourceKey: "service_request:155", leadId: winnerLeadId, channel: "email", vendorFacts: realVendorFacts,
      });
      expect(result.allowed).toBe(true);
      if (!result.allowed) throw new Error("expected allowed");
      expect(result.providerResult.liveProviderInvoked).toBe(false);
      expect(["sent_noop", "queued_noop"]).toContain(result.providerResult.status);
      expect(result.attempt.status).toBe("response_pending");
      expect(result.attempt.gatePassed).toBe(true);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/"providerAccepted":true/);
      expect(serialized).not.toMatch(/"bookingConfirmed":true/);
      expect(serialized).not.toMatch(/"paymentAuthorized":true/);
      expect(serialized).not.toMatch(/"dispatched":true/);
    });

    it("blocks the attempt when required vendor facts are missing", async () => {
      vi.mocked(listRequestJobCardSourceRecords).mockResolvedValue(readyServiceRequestSource);
      const mission = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).mission({ sourceKey: "service_request:155" });
      const winnerLeadId = mission.mission!.winner!.leadId;
      const result = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).runContactAttempt({
        sourceKey: "service_request:155", leadId: winnerLeadId, channel: "email",
        vendorFacts: { ...realVendorFacts, businessName: "", phone: null },
      });
      expect(result.allowed).toBe(false);
      expect(result.blockedReasons).toContain("business_name_required");
    });
  });

  describe("simulateVendorReply", () => {
    it("rejects unauthenticated and non-admin callers", async () => {
      await expect(vendorCastingSprintRouter.createCaller(context(null)).simulateVendorReply({
        sourceKey: "service_request:155", attemptId: "attempt_1", channel: "email", rawReplyText: "We're available, $110.",
      })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("accepts a simulated reply, interprets it, and builds a response terms packet without booking/payment/dispatch", async () => {
      const result = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).simulateVendorReply({
        sourceKey: "service_request:155", attemptId: "attempt_1", candidateId: "candidate_1", channel: "email",
        rawReplyText: "We have an opening that day and can do it, $110.",
      });
      expect(result.allowed).toBe(true);
      expect(result.packet?.inboundProvider).toBe("noop_test");
      expect(result.interpretedReply?.classification).toBe("available");
      expect(result.termsPacket?.inquiryOnlyNotBooking).toBe(true);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/"providerAccepted":true/);
      expect(serialized).not.toMatch(/"bookingConfirmed":true/);
      expect(serialized).not.toMatch(/"residentProposalReady":true/);
    });

    it("never fabricates a response: a forbidden-claim reply produces no terms packet", async () => {
      const result = await vendorCastingSprintRouter.createCaller(context({ role: "admin" })).simulateVendorReply({
        sourceKey: "service_request:155", attemptId: "attempt_1", channel: "email",
        rawReplyText: "It is booked and accepted.",
      });
      expect(result.allowed).toBe(true);
      expect(result.interpretedReply?.blocked).toBe(true);
      expect(result.termsPacket).toBeNull();
    });
  });
});

describe("vendor casting sprint admin router -- durable contact attempt store wiring", () => {
  const realVendorFacts = {
    businessName: "Westside Mobile Pet Spa",
    phone: "555-010-2002",
    sourceType: "manual_operator_list" as const,
    sourceReference: "Adam called and confirmed via Google Maps listing",
    serviceArea: "cpe-south",
    qualificationNotes: "Verified by Adam directly; services boxers, mobile van, available weekdays.",
  };

  function makeDurableDraft(overrides?: Record<string, unknown>) {
    return {
      id: "durable-draft-1",
      tenantId: "default",
      sourceKey: "service_request:155",
      candidateId: null,
      leadId: "lead-1",
      lane: "maps_producer",
      channel: "email",
      recipientSnapshot: "555-010-2002",
      subjectRendered: "Availability check",
      bodyRendered: "Hi vendor",
      bodyHash: "a".repeat(64),
      templateKey: "vendor_availability_request_v0",
      templateVersion: null,
      founderEscalationPresent: true,
      forbiddenClaimsScanJson: {},
      draftStatus: "draft_ready",
      createdBy: "admin",
      createdAt: new Date("2026-06-24T00:00:00.000Z"),
      updatedAt: new Date("2026-06-24T00:00:00.000Z"),
      ...overrides,
    };
  }

  function makeDurableAttempt(overrides?: Record<string, unknown>) {
    return {
      id: "durable-attempt-1",
      tenantId: "default",
      outreachDraftId: "durable-draft-1",
      sourceKey: "service_request:155",
      serviceRequestId: null,
      candidateId: null,
      leadId: "lead-1",
      lane: "maps_producer",
      channel: "email",
      recipientSnapshot: "555-010-2002",
      draftSubject: "Availability check",
      draftBodySnapshot: "Hi vendor",
      draftBodyHash: "a".repeat(64),
      templateKey: "vendor_availability_request_v0",
      templateVersion: null,
      founderEscalationPresent: true,
      forbiddenClaimsScanJson: {},
      sendGateResultJson: { allowed: true, reasons: [] },
      automationMode: "noop_provider",
      providerAdapter: "noop_email",
      providerAttemptId: "attempt_xyz",
      status: "response_pending",
      statusHistoryJson: [{ status: "draft_ready", at: "2026-06-24T00:00:00.000Z", actor: "HELD" }, { status: "response_pending", at: "2026-06-24T00:00:01.000Z", actor: "HELD" }],
      latestReplyJson: null,
      latestTermsPacketJson: null,
      liveProviderInvoked: false,
      outreachSentByHeld: false,
      providerResponded: false,
      providerAccepted: false,
      bookingConfirmed: false,
      paymentAuthorized: false,
      dispatched: false,
      idempotencyKey: "fixed-key",
      occurredAt: null,
      sentAt: null,
      createdBy: "admin",
      createdAt: new Date("2026-06-24T00:00:00.000Z"),
      updatedAt: new Date("2026-06-24T00:00:00.000Z"),
      ...overrides,
    };
  }

  function makeMockStore(overrides?: Partial<Record<string, unknown>>) {
    return {
      createDraft: vi.fn().mockResolvedValue(makeDurableDraft()),
      createOrReuseAttempt: vi.fn().mockResolvedValue({ attempt: makeDurableAttempt(), reused: false }),
      recordReplyAndTerms: vi.fn().mockResolvedValue(makeDurableAttempt({
        status: "interpreted",
        providerResponded: true,
        latestReplyJson: { classification: "available" },
        latestTermsPacketJson: { availabilityStatus: "available" },
        statusHistoryJson: [
          { status: "draft_ready", at: "2026-06-24T00:00:00.000Z", actor: "HELD" },
          { status: "response_pending", at: "2026-06-24T00:00:01.000Z", actor: "HELD" },
          { status: "interpreted", at: "2026-06-24T00:00:02.000Z", actor: "HELD" },
        ],
      })),
      getAttemptById: vi.fn().mockResolvedValue(makeDurableAttempt()),
      listAttemptsBySourceKey: vi.fn().mockResolvedValue([makeDurableAttempt()]),
      listAttemptsByCandidateId: vi.fn().mockResolvedValue([makeDurableAttempt({ candidateId: "candidate-1" })]),
      listRecentAttempts: vi.fn().mockResolvedValue({ attempts: [makeDurableAttempt()], nextCursor: null }),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.mocked(listRequestJobCardSourceRecords).mockResolvedValue(readyServiceRequestSource);
  });

  it("generateOutreachDraft returns a durableDraftId from the injected store", async () => {
    const store = makeMockStore();
    const router = createVendorCastingSprintRouter(store as any);
    const mission = await router.createCaller(context({ role: "admin" })).mission({ sourceKey: "service_request:155" });
    const winnerLeadId = mission.mission!.winner!.leadId;

    const result = await router.createCaller(context({ role: "admin" })).generateOutreachDraft({
      sourceKey: "service_request:155", leadId: winnerLeadId, vendorFacts: realVendorFacts,
    });

    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error("expected allowed");
    expect(result.durableDraftId).toBe("durable-draft-1");
    expect(result.persisted).toBe(true);
    expect(result.bodyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.createDraft).toHaveBeenCalledOnce();
  });

  it("runContactAttempt returns a durableAttemptId and persists response_pending state", async () => {
    const store = makeMockStore();
    const router = createVendorCastingSprintRouter(store as any);
    const mission = await router.createCaller(context({ role: "admin" })).mission({ sourceKey: "service_request:155" });
    const winnerLeadId = mission.mission!.winner!.leadId;

    const result = await router.createCaller(context({ role: "admin" })).runContactAttempt({
      sourceKey: "service_request:155", leadId: winnerLeadId, channel: "email", vendorFacts: realVendorFacts,
    });

    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error("expected allowed");
    expect(result.durableAttemptId).toBe("durable-attempt-1");
    expect(result.persisted).toBe(true);
    expect(result.auditFeedSummary?.status).toBe("response_pending");
    expect(store.createOrReuseAttempt).toHaveBeenCalledOnce();
    const callArgs = store.createOrReuseAttempt.mock.calls[0][0];
    expect(callArgs.sendGateResultJson).toEqual({ allowed: true, reasons: [] });
    expect(callArgs.automationMode).toBe("noop_provider");
  });

  it("simulateVendorReply persists the latest reply and terms packet onto the same durable attempt", async () => {
    const store = makeMockStore();
    const router = createVendorCastingSprintRouter(store as any);

    const result = await router.createCaller(context({ role: "admin" })).simulateVendorReply({
      sourceKey: "service_request:155",
      attemptId: "attempt_local",
      durableAttemptId: "durable-attempt-1",
      channel: "email",
      rawReplyText: "We have an opening that day and can do it, $110.",
    });

    expect(result.allowed).toBe(true);
    expect(result.persisted).toBe(true);
    expect(result.durableAttemptId).toBe("durable-attempt-1");
    expect(result.updatedStatus).toBe("interpreted");
    expect(result.statusHistory).toHaveLength(3);
    expect(store.recordReplyAndTerms).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "default",
      attemptId: "durable-attempt-1",
      nextStatus: "interpreted",
    }));
  });

  it("never invokes a live provider, never marks outreachSentByHeld, and never marks provider acceptance/booking/payment/dispatch", async () => {
    const store = makeMockStore();
    const router = createVendorCastingSprintRouter(store as any);
    const mission = await router.createCaller(context({ role: "admin" })).mission({ sourceKey: "service_request:155" });
    const winnerLeadId = mission.mission!.winner!.leadId;

    const result = await router.createCaller(context({ role: "admin" })).runContactAttempt({
      sourceKey: "service_request:155", leadId: winnerLeadId, channel: "email", vendorFacts: realVendorFacts,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/"liveProviderInvoked":true/);
    expect(serialized).not.toMatch(/"outreachSentByHeld":true/);
    expect(serialized).not.toMatch(/"providerAccepted":true/);
    expect(serialized).not.toMatch(/"bookingConfirmed":true/);
    expect(serialized).not.toMatch(/"paymentAuthorized":true/);
    expect(serialized).not.toMatch(/"dispatched":true/);
  });

  it("contactAttemptsBySourceKey returns the durable attempt via the audit feed", async () => {
    const store = makeMockStore();
    const router = createVendorCastingSprintRouter(store as any);

    const attempts = await router.createCaller(context({ role: "admin" })).contactAttemptsBySourceKey({ sourceKey: "service_request:155" });

    expect(attempts).toHaveLength(1);
    expect(attempts[0].attemptId).toBe("durable-attempt-1");
    expect(store.listAttemptsBySourceKey).toHaveBeenCalledWith("default", "service_request:155", 50);
  });

  it("contactAttemptsByCandidateId returns the durable attempt via the audit feed", async () => {
    const store = makeMockStore();
    const router = createVendorCastingSprintRouter(store as any);

    const attempts = await router.createCaller(context({ role: "admin" })).contactAttemptsByCandidateId({ candidateId: "candidate-1" });

    expect(attempts).toHaveLength(1);
    expect(attempts[0].candidateId).toBe("candidate-1");
  });

  it("contactAttemptById returns a single durable attempt", async () => {
    const store = makeMockStore();
    const router = createVendorCastingSprintRouter(store as any);

    const attempt = await router.createCaller(context({ role: "admin" })).contactAttemptById({ attemptId: "durable-attempt-1" });

    expect(attempt?.attemptId).toBe("durable-attempt-1");
  });

  it("recentContactAttempts paginates and is admin-only", async () => {
    const store = makeMockStore();
    const router = createVendorCastingSprintRouter(store as any);

    await expect(router.createCaller(context(null)).recentContactAttempts({})).rejects.toMatchObject({ code: "FORBIDDEN" });

    const page = await router.createCaller(context({ role: "admin" })).recentContactAttempts({});
    expect(page.attempts).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });
});
