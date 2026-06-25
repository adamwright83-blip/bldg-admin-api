import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./agentMailVendorEmailProvider", async () => {
  const actual = await vi.importActual<typeof import("./agentMailVendorEmailProvider")>("./agentMailVendorEmailProvider");
  return { ...actual, sendVendorEmailViaAgentMail: vi.fn() };
});

const { sendVendorEmailViaAgentMail, SUPERVISED_CANARY_CONFIRMATION_TEXT } = await import("./agentMailVendorEmailProvider");
const { createVendorAcquisitionMissionRouter } = await import("./vendorAcquisitionMissionRouter");

function context(user: { role: string } | null) {
  return { user, tenantId: "default", req: {}, res: {}, vendorSession: null } as never;
}

function makeMockStore(overrides?: Record<string, unknown>) {
  return {
    createMission: vi.fn().mockResolvedValue("mission-1"),
    activateMission: vi.fn().mockResolvedValue(undefined),
    listMissions: vi.fn().mockResolvedValue([]),
    getMission: vi.fn(),
    completeMission: vi.fn(),
    cancelMission: vi.fn(),
    ...overrides,
  };
}

function validInput(overrides?: Record<string, unknown>) {
  return {
    category: "dog_grooming",
    geographyLabel: "90027 (5 mi radius)",
    targetQuantity: 10,
    qualityGates: { minGoogleRating: 4.7, minYelpRating: 4.7 },
    outreachMode: "draft_only" as const,
    activateImmediately: true,
    ...overrides,
  };
}

describe("vendorAcquisitionMissionRouter -- createMission", () => {
  it("rejects unauthenticated and non-admin callers", async () => {
    const store = makeMockStore();
    const router = createVendorAcquisitionMissionRouter(store as never);
    await expect(router.createCaller(context(null)).createMission(validInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(router.createCaller(context({ role: "user" })).createMission(validInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(store.createMission).not.toHaveBeenCalled();
  });

  it("creates a real mission row and activates it when activateImmediately is true", async () => {
    const store = makeMockStore();
    const router = createVendorAcquisitionMissionRouter(store as never);
    const result = await router.createCaller(context({ role: "admin" })).createMission(validInput());

    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error("expected allowed");
    expect(typeof result.missionId).toBe("string");
    expect(result.status).toBe("active");
    expect(store.createMission).toHaveBeenCalledOnce();
    expect(store.createMission).toHaveBeenCalledWith(expect.objectContaining({
      id: result.missionId, tenantId: "default", category: "dog_grooming",
    }));
    expect(store.activateMission).toHaveBeenCalledWith("default", result.missionId);
  });

  it("creates a draft-only mission when activateImmediately is false", async () => {
    const store = makeMockStore();
    const router = createVendorAcquisitionMissionRouter(store as never);
    const result = await router.createCaller(context({ role: "admin" })).createMission(validInput({ activateImmediately: false }));

    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error("expected allowed");
    expect(result.status).toBe("draft");
    expect(store.activateMission).not.toHaveBeenCalled();
  });

  it("surfaces the policy's auto_send refusal as a blocked result rather than throwing", async () => {
    // auto_send is a registered enum value (so it passes input shape validation),
    // but canCreateMission() inside the real store always denies it -- mirrored
    // here by having the mocked store reject exactly as the real one would.
    const store = makeMockStore({
      createMission: vi.fn().mockRejectedValue(new Error("Vendor acquisition mission denied: auto_send_not_yet_enabled")),
    });
    const router = createVendorAcquisitionMissionRouter(store as never);
    const result = await router.createCaller(context({ role: "admin" })).createMission(validInput({ outreachMode: "auto_send" }));

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("auto_send_not_yet_enabled");
    expect(store.activateMission).not.toHaveBeenCalled();
  });

  it("surfaces policy denial reasons without throwing when the store rejects the definition", async () => {
    const store = makeMockStore({
      createMission: vi.fn().mockRejectedValue(new Error("Vendor acquisition mission denied: missing_quality_gate")),
    });
    const router = createVendorAcquisitionMissionRouter(store as never);
    const result = await router.createCaller(context({ role: "admin" })).createMission(validInput({ qualityGates: {} }));

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("missing_quality_gate");
    expect(result.missionId).toBeNull();
  });

  it("never invokes any sourcing/discovery/outreach adapter -- the store interface has only mission lifecycle methods", async () => {
    const store = makeMockStore();
    const router = createVendorAcquisitionMissionRouter(store as never);
    await router.createCaller(context({ role: "admin" })).createMission(validInput());
    expect(Object.keys(store).sort()).toEqual(["activateMission", "cancelMission", "completeMission", "createMission", "getMission", "listMissions"]);
  });
});

function makeMockMission(overrides?: Record<string, unknown>) {
  return {
    id: "mission-1", tenantId: "default", category: "dog_grooming",
    geographyLabel: "90027 (5 mi radius)", targetQuantity: 10,
    qualityGates: { minGoogleRating: 4.7, minYelpRating: 4.7 },
    outreachMode: "draft_only", status: "active", deadlineAt: null,
    createdBy: "admin", createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

function makeMockSourcingStore(overrides?: Record<string, unknown>) {
  return {
    findCandidateBySourceReference: vi.fn().mockResolvedValue(null),
    createCandidate: vi.fn().mockResolvedValue("candidate-1"),
    getCandidate: vi.fn(),
    listCandidates: vi.fn(),
    listCandidatesForReview: vi.fn().mockResolvedValue([]),
    listSourceRegistry: vi.fn(),
    getSourceRegistry: vi.fn(),
    ...overrides,
  };
}

const MOCK_PLACE_CANDIDATE = {
  provider: "google_places" as const, placeId: "place_1", businessName: "Paw Spa LA",
  rating: 4.9, reviewCount: 220, address: "123 Main St", website: null, phone: null,
  coordinates: { lat: 34.1, lng: -118.3 }, sourceUrl: "https://www.google.com/maps/place/?q=place_id:place_1",
};

function makeMockMatchStore(overrides?: Record<string, unknown>) {
  return {
    upsertMatch: vi.fn().mockResolvedValue({}),
    listMissionMatches: vi.fn().mockResolvedValue([]),
    countMissionMatches: vi.fn().mockResolvedValue({ total: 0, shortlisted: 0 }),
    ...overrides,
  };
}

describe("vendorAcquisitionMissionRouter -- runDiscovery", () => {
  it("rejects unauthenticated and non-admin callers", async () => {
    const missionStore = makeMockStore();
    const router = createVendorAcquisitionMissionRouter(missionStore as never);
    await expect(router.createCaller(context(null)).runDiscovery({ missionId: "mission-1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns mission_not_found when the mission does not exist, without calling the discovery connector", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(null) });
    const discoveryFn = vi.fn();
    const router = createVendorAcquisitionMissionRouter(missionStore as never, makeMockSourcingStore() as never, discoveryFn);
    const result = await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "missing" });
    expect(result).toEqual({ status: "mission_not_found" });
    expect(discoveryFn).not.toHaveBeenCalled();
  });

  it("surfaces needs_provider_config from the connector without persisting anything", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "needs_provider_config", missingEnvVar: "GOOGLE_PLACES_API_KEY" });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, makeMockMatchStore() as never);
    const result = await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(result).toEqual({ status: "needs_provider_config", missingEnvVar: "GOOGLE_PLACES_API_KEY" });
    expect(sourcingStore.createCandidate).not.toHaveBeenCalled();
  });

  it("surfaces a provider_error without persisting anything", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "provider_error", reason: "REQUEST_DENIED" });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, makeMockMatchStore() as never);
    const result = await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(result).toEqual({ status: "provider_error", reason: "REQUEST_DENIED" });
    expect(sourcingStore.createCandidate).not.toHaveBeenCalled();
  });

  it("builds the discovery query from real mission fields via the query planner (category, geography, target count, rating)", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [] });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, makeMockMatchStore() as never);
    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(discoveryFn).toHaveBeenCalledWith({
      searchText: "Dog Grooming near 90027",
      minRating: 4.7,
      maxResults: 10,
    });
  });

  it("persists newly discovered candidates into the real vendor_sourcing_candidates store as permitted_public_fetch", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [MOCK_PLACE_CANDIDATE] });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, makeMockMatchStore() as never);
    const result = await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.foundCount).toBe(1);
    expect(result.persistedCount).toBe(1);
    expect(result.alreadyDiscoveredCount).toBe(0);
    expect(sourcingStore.createCandidate).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: "permitted_public_fetch", sourceReference: "place_1", businessName: "Paw Spa LA",
      category: "dog_grooming", createdBy: "google_places_discovery",
    }));
  });

  it("is idempotent: a place id already discovered for this tenant is not persisted again", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore({
      findCandidateBySourceReference: vi.fn().mockResolvedValue({ id: "existing-candidate", sourceReference: "place_1" }),
    });
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [MOCK_PLACE_CANDIDATE] });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, makeMockMatchStore() as never);
    const result = await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.persistedCount).toBe(0);
    expect(result.alreadyDiscoveredCount).toBe(1);
    expect(sourcingStore.createCandidate).not.toHaveBeenCalled();
  });

  it("returns an honest zero-result state when discovery finds nothing", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [] });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, makeMockMatchStore() as never);
    const result = await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(result).toEqual({
      status: "ok", foundCount: 0, persistedCount: 0, alreadyDiscoveredCount: 0, shortlistedCount: 0, overflowCount: 0, candidates: [],
      queryPlannerSource: "deterministic_fallback", queryPlannerFallbackReason: "invalid_output",
    });
  });

  it("never invokes any outreach/send capability -- the sourcing store interface has no send method", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [MOCK_PLACE_CANDIDATE] });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, makeMockMatchStore() as never);
    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(Object.keys(sourcingStore).sort()).toEqual([
      "createCandidate", "findCandidateBySourceReference", "getCandidate", "getSourceRegistry",
      "listCandidates", "listCandidatesForReview", "listSourceRegistry",
    ]);
  });

  it("uses the query planner to drive multiple Google Places query variants when mission text signals a service mode", async () => {
    const missionStore = makeMockStore({
      getMission: vi.fn().mockResolvedValue(makeMockMission({
        qualityGates: { minGoogleRating: 4.7, missionText: "Find me 10 mobile dog groomers near 90027 who can service luxury high-rise residents at their buildings." },
      })),
    });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [] });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, makeMockMatchStore() as never);
    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(discoveryFn.mock.calls.length).toBeGreaterThan(1);
    expect(discoveryFn.mock.calls.some(([query]) => /mobile/i.test(query.searchText))).toBe(true);
  });

  it("dedupes candidates with the same place id returned by multiple query variants", async () => {
    const missionStore = makeMockStore({
      getMission: vi.fn().mockResolvedValue(makeMockMission({
        qualityGates: { minGoogleRating: 4.7, missionText: "Find me 10 mobile dog groomers near 90027 at their buildings." },
      })),
    });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [MOCK_PLACE_CANDIDATE] });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, makeMockMatchStore() as never);
    const result = await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(discoveryFn.mock.calls.length).toBeGreaterThan(1);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.foundCount).toBe(1);
    expect(sourcingStore.createCandidate).toHaveBeenCalledOnce();
  });

  it("persists matchedQuery, missionText, queryIntent, and serviceMode in candidate evidence", async () => {
    const missionStore = makeMockStore({
      getMission: vi.fn().mockResolvedValue(makeMockMission({
        qualityGates: { minGoogleRating: 4.7, missionText: "Find me 10 mobile dog groomers near 90027 at their buildings." },
      })),
    });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [MOCK_PLACE_CANDIDATE] });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, makeMockMatchStore() as never);
    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(sourcingStore.createCandidate).toHaveBeenCalledWith(expect.objectContaining({
      evidence: expect.objectContaining({
        matchedQuery: expect.stringMatching(/mobile/i),
        missionText: "Find me 10 mobile dog groomers near 90027 at their buildings.",
        serviceMode: "mobile_required",
        queryIntent: expect.stringContaining("mobile_required"),
      }),
    }));
  });

  it("caps query variants and stops early once enough distinct candidates are found for the target count", async () => {
    const missionStore = makeMockStore({
      getMission: vi.fn().mockResolvedValue(makeMockMission({
        targetQuantity: 1,
        qualityGates: { minGoogleRating: 4.7, missionText: "Find me mobile dog groomers near 90027 at their high-rise buildings, mobile at-home house call on-site." },
      })),
    });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [MOCK_PLACE_CANDIDATE] });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, makeMockMatchStore() as never);
    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    // targetQuantity is 1, and the first query variant already returns a
    // candidate -- no further variants should be queried.
    expect(discoveryFn.mock.calls.length).toBe(1);
  });

  it("continues to the next query variant on a per-variant provider_error rather than failing the whole run", async () => {
    const missionStore = makeMockStore({
      getMission: vi.fn().mockResolvedValue(makeMockMission({
        qualityGates: { minGoogleRating: 4.7, missionText: "Find me 10 mobile dog groomers near 90027 at their buildings." },
      })),
    });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn()
      .mockResolvedValueOnce({ status: "provider_error", reason: "UNKNOWN_ERROR" })
      .mockResolvedValue({ status: "ok", candidates: [MOCK_PLACE_CANDIDATE] });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, makeMockMatchStore() as never);
    const result = await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.foundCount).toBe(1);
  });
});

describe("vendorAcquisitionMissionRouter -- runDiscovery (Slice 77b structured parser)", () => {
  function makeStructuredPlan(overrides?: Partial<{
    serviceMode: "mobile_required" | "building_service_required" | "storefront_ok" | "unknown";
    searchQueries: string[];
  }>) {
    return {
      status: "ok" as const,
      plan: {
        primaryIntent: "mobile_required:dog_grooming",
        serviceCategory: "dog_grooming",
        locationText: "90027",
        searchQueries: overrides?.searchQueries ?? ["mobile dog groomers near 90027", "dog grooming that comes to you near 90027"],
        requiredTerms: ["mobile"],
        preferredTerms: [],
        excludedTerms: [],
        serviceMode: overrides?.serviceMode ?? "mobile_required",
        confidence: "high" as const,
        notes: ["Mission text describes building/mobile service."],
      },
    };
  }

  it("uses the structured Claude parser as the primary query-planning path when it succeeds", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [] });
    const parserFn = vi.fn().mockResolvedValue(makeStructuredPlan());
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, parserFn as never, undefined, undefined, makeMockMatchStore() as never);
    const result = await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(parserFn).toHaveBeenCalledOnce();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.queryPlannerSource).toBe("anthropic_structured");
    expect(discoveryFn).toHaveBeenCalledWith(expect.objectContaining({ searchText: "mobile dog groomers near 90027" }));
  });

  it("falls back to the deterministic planner when the structured parser fails or is unavailable", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [] });
    const parserFn = vi.fn().mockResolvedValue({ status: "needs_provider_config", missingEnvVar: "ANTHROPIC_API_KEY" });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, parserFn as never, undefined, undefined, makeMockMatchStore() as never);
    const result = await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.queryPlannerSource).toBe("deterministic_fallback");
    expect(result.queryPlannerFallbackReason).toBe("needs_provider_config");
  });

  it("falls back to the deterministic planner when the parser throws rather than failing the whole discovery run", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [] });
    const parserFn = vi.fn().mockRejectedValue(new Error("unexpected parser crash"));
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, parserFn as never, undefined, undefined, makeMockMatchStore() as never);
    const result = await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.queryPlannerSource).toBe("deterministic_fallback");
  });

  it("records the planner source (anthropic_structured or deterministic_fallback) in persisted candidate evidence", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [MOCK_PLACE_CANDIDATE] });
    const parserFn = vi.fn().mockResolvedValue(makeStructuredPlan());
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, parserFn as never, undefined, undefined, makeMockMatchStore() as never);
    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(sourcingStore.createCandidate).toHaveBeenCalledWith(expect.objectContaining({
      evidence: expect.objectContaining({ queryPlannerSource: "anthropic_structured" }),
    }));
  });

  it("passes the parser's generated search queries through to the Google Places connector", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [] });
    const parserFn = vi.fn().mockResolvedValue(makeStructuredPlan({ searchQueries: ["a custom claude-generated query"] }));
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, parserFn as never, undefined, undefined, makeMockMatchStore() as never);
    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(discoveryFn).toHaveBeenCalledWith(expect.objectContaining({ searchText: "a custom claude-generated query" }));
  });

  it("integration plumbing: building-service phrasing without the literal word 'mobile' flows through correctly when the parser (Claude) recognizes it", async () => {
    // This proves the router correctly uses whatever serviceMode/queries
    // the parser returns -- it does not prove the live Claude model
    // would classify this phrasing correctly. That property depends on
    // Claude's actual language understanding and cannot be asserted by
    // a mocked unit test; it is the entire reason this slice exists.
    const missionStore = makeMockStore({
      getMission: vi.fn().mockResolvedValue(makeMockMission({
        qualityGates: { missionText: "Find groomers who will come to the building so residents won't have to leave the property." },
      })),
    });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [] });
    const parserFn = vi.fn().mockResolvedValue(makeStructuredPlan({
      serviceMode: "building_service_required",
      searchQueries: ["dog groomers for apartment buildings near 90027", "mobile dog groomer building service 90027"],
    }));
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, parserFn as never, undefined, undefined, makeMockMatchStore() as never);
    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(discoveryFn).toHaveBeenCalledWith(expect.objectContaining({ searchText: "dog groomers for apartment buildings near 90027" }));
  });

  it("integration plumbing: storefront/drive-to phrasing flows through as storefront_ok without forcing mobile queries", async () => {
    const missionStore = makeMockStore({
      getMission: vi.fn().mockResolvedValue(makeMockMission({
        qualityGates: { missionText: "Find me 10 dog groomers residents can drive to near Century Park East." },
      })),
    });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [] });
    const parserFn = vi.fn().mockResolvedValue(makeStructuredPlan({
      serviceMode: "storefront_ok",
      searchQueries: ["dog groomers near Century Park East", "dog grooming salon near Century Park East"],
    }));
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, parserFn as never, undefined, undefined, makeMockMatchStore() as never);
    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(discoveryFn.mock.calls.every(([query]) => !/\bmobile\b/i.test(query.searchText))).toBe(true);
  });

  it("never invokes any outreach/send capability from the structured-parser path either", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [MOCK_PLACE_CANDIDATE] });
    const parserFn = vi.fn().mockResolvedValue(makeStructuredPlan());
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, parserFn as never, undefined, undefined, makeMockMatchStore() as never);
    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(Object.keys(sourcingStore).sort()).toEqual([
      "createCandidate", "findCandidateBySourceReference", "getCandidate", "getSourceRegistry",
      "listCandidates", "listCandidatesForReview", "listSourceRegistry",
    ]);
  });
});

describe("vendorAcquisitionMissionRouter -- listDiscoveredCandidates", () => {
  it("rejects unauthenticated and non-admin callers", async () => {
    const sourcingStore = makeMockSourcingStore();
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never, sourcingStore as never);
    await expect(router.createCaller(context(null)).listDiscoveredCandidates({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(sourcingStore.listCandidatesForReview).not.toHaveBeenCalled();
  });

  it("returns whatever the store reports, with no fabricated rows", async () => {
    const sourcingStore = makeMockSourcingStore({
      listCandidatesForReview: vi.fn().mockResolvedValue([{ id: "candidate-1", businessName: "Paw Spa LA" }]),
    });
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never, sourcingStore as never);
    const candidates = await router.createCaller(context({ role: "admin" })).listDiscoveredCandidates({});
    expect(candidates).toEqual([{ id: "candidate-1", businessName: "Paw Spa LA" }]);
  });

  it("passes the category filter and tenant through to the store, never mission id (no such column exists)", async () => {
    const sourcingStore = makeMockSourcingStore();
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never, sourcingStore as never);
    await router.createCaller(context({ role: "admin" })).listDiscoveredCandidates({ category: "dog_grooming", limit: 20 });
    expect(sourcingStore.listCandidatesForReview).toHaveBeenCalledWith({ tenantId: "default", category: "dog_grooming", limit: 20 });
  });

  it("returns an empty list honestly when no candidates exist, rather than seeding demo rows", async () => {
    const sourcingStore = makeMockSourcingStore();
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never, sourcingStore as never);
    const candidates = await router.createCaller(context({ role: "admin" })).listDiscoveredCandidates({});
    expect(candidates).toEqual([]);
  });
});

describe("vendorAcquisitionMissionRouter -- listMissions", () => {
  it("rejects unauthenticated and non-admin callers", async () => {
    const store = makeMockStore();
    const router = createVendorAcquisitionMissionRouter(store as never);
    await expect(router.createCaller(context(null)).listMissions({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns whatever the store reports, with no fabricated rows", async () => {
    const store = makeMockStore({ listMissions: vi.fn().mockResolvedValue([{ id: "mission-1", status: "active" }]) });
    const router = createVendorAcquisitionMissionRouter(store as never);
    const missions = await router.createCaller(context({ role: "admin" })).listMissions({});
    expect(missions).toEqual([{ id: "mission-1", status: "active" }]);
    expect(store.listMissions).toHaveBeenCalledWith({ tenantId: "default", status: undefined, limit: 50 });
  });

  it("returns an empty list honestly when no missions exist, rather than seeding demo rows", async () => {
    const store = makeMockStore({ listMissions: vi.fn().mockResolvedValue([]) });
    const router = createVendorAcquisitionMissionRouter(store as never);
    const missions = await router.createCaller(context({ role: "admin" })).listMissions({});
    expect(missions).toEqual([]);
  });
});

describe("vendorAcquisitionMissionRouter -- previewQueryPlan", () => {
  it("rejects unauthenticated and non-admin callers", async () => {
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never);
    await expect(
      router.createCaller(context(null)).previewQueryPlan({ category: "dog_grooming", geographyLabel: "90027", targetQuantity: 10 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns a real deterministic plan derived from the given mission text, with no I/O", async () => {
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never);
    const plan = await router.createCaller(context({ role: "admin" })).previewQueryPlan({
      missionText: "Find me 10 mobile dog groomers near 90027 at their buildings.",
      category: "dog_grooming", geographyLabel: "90027 (5 mi radius)", ratingThreshold: 4.7, targetQuantity: 10,
    });
    expect(plan.serviceMode).toBe("mobile_required");
    expect(plan.searchQueries.length).toBeGreaterThan(0);
  });
});

function makeMockCandidate(overrides?: Record<string, unknown>) {
  return {
    id: "candidate-1", tenantId: "default", buildingSlug: null, sourceType: "permitted_public_fetch",
    sourceReference: "place_1", category: "dog_grooming", businessName: "Sunset Mobile Grooming",
    sourcingStatus: "discovered", createdBy: "google_places_discovery", createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

function makeMockContactAttemptStore(overrides?: Record<string, unknown>) {
  return {
    createOrReuseAttempt: vi.fn().mockResolvedValue({
      attempt: {
        id: "attempt-1", draftSubject: "subject", draftBodySnapshot: "body",
        status: "draft_ready", providerResponded: false, providerAccepted: false,
        bookingConfirmed: false, paymentAuthorized: false, dispatched: false,
      },
      reused: false,
    }),
    ...overrides,
  };
}

describe("vendorAcquisitionMissionRouter -- approveCandidateForDraftOutreach (Slice 78a)", () => {
  it("rejects unauthenticated and non-admin callers", async () => {
    const sourcingStore = makeMockSourcingStore();
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never, sourcingStore as never);
    await expect(
      router.createCaller(context(null)).approveCandidateForDraftOutreach({ candidateId: "candidate-1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns candidate_not_found honestly when the candidate does not exist, without creating any attempt", async () => {
    const sourcingStore = makeMockSourcingStore({ getCandidate: vi.fn().mockResolvedValue(null) });
    const contactAttemptStore = makeMockContactAttemptStore();
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never, sourcingStore as never, undefined, undefined, contactAttemptStore as never);
    const result = await router.createCaller(context({ role: "admin" })).approveCandidateForDraftOutreach({ candidateId: "missing" });
    expect(result).toEqual({ status: "candidate_not_found" });
    expect(contactAttemptStore.createOrReuseAttempt).not.toHaveBeenCalled();
  });

  it("creates a draft-only, no-send contact attempt for a real candidate", async () => {
    const sourcingStore = makeMockSourcingStore({ getCandidate: vi.fn().mockResolvedValue(makeMockCandidate()) });
    const contactAttemptStore = makeMockContactAttemptStore();
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never, sourcingStore as never, undefined, undefined, contactAttemptStore as never);
    const result = await router.createCaller(context({ role: "admin" })).approveCandidateForDraftOutreach({ candidateId: "candidate-1" });

    expect(result.status).toBe("ok");
    expect(contactAttemptStore.createOrReuseAttempt).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "default",
      sourceKey: "sourcing_candidate:candidate-1",
      candidateId: "candidate-1",
      automationMode: "manual_fallback",
      status: "draft_ready",
    }));
  });

  it("the draft body passed to the store is deterministic and never claims booking/dispatch/payment", async () => {
    const sourcingStore = makeMockSourcingStore({ getCandidate: vi.fn().mockResolvedValue(makeMockCandidate()) });
    const contactAttemptStore = makeMockContactAttemptStore();
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never, sourcingStore as never, undefined, undefined, contactAttemptStore as never);
    await router.createCaller(context({ role: "admin" })).approveCandidateForDraftOutreach({ candidateId: "candidate-1" });

    const call = contactAttemptStore.createOrReuseAttempt.mock.calls[0][0];
    expect(call.draftBodySnapshot).toContain("Adam Wright");
    expect(call.draftBodySnapshot).not.toMatch(/booked|confirmed|dispatch|payment ready/i);
  });

  it("is idempotent: approving the same candidate twice reuses the existing draft (reused: true)", async () => {
    const sourcingStore = makeMockSourcingStore({ getCandidate: vi.fn().mockResolvedValue(makeMockCandidate()) });
    const contactAttemptStore = makeMockContactAttemptStore({
      createOrReuseAttempt: vi.fn().mockResolvedValue({
        attempt: { id: "attempt-1", draftSubject: "subject", draftBodySnapshot: "body" },
        reused: true,
      }),
    });
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never, sourcingStore as never, undefined, undefined, contactAttemptStore as never);
    const result = await router.createCaller(context({ role: "admin" })).approveCandidateForDraftOutreach({ candidateId: "candidate-1" });

    expect(result).toMatchObject({ status: "ok", alreadyQueued: true });
  });

  it("never invokes any outreach/send capability -- the contact attempt store interface has no send method exposed here", async () => {
    const sourcingStore = makeMockSourcingStore({ getCandidate: vi.fn().mockResolvedValue(makeMockCandidate()) });
    const contactAttemptStore = makeMockContactAttemptStore();
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never, sourcingStore as never, undefined, undefined, contactAttemptStore as never);
    await router.createCaller(context({ role: "admin" })).approveCandidateForDraftOutreach({ candidateId: "candidate-1" });

    expect(Object.keys(contactAttemptStore)).toEqual(["createOrReuseAttempt"]);
  });

  it("never sets provider_responded/provider_accepted/booking_confirmed/payment_authorized/dispatched truth", async () => {
    const sourcingStore = makeMockSourcingStore({ getCandidate: vi.fn().mockResolvedValue(makeMockCandidate()) });
    const contactAttemptStore = makeMockContactAttemptStore();
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never, sourcingStore as never, undefined, undefined, contactAttemptStore as never);
    await router.createCaller(context({ role: "admin" })).approveCandidateForDraftOutreach({ candidateId: "candidate-1" });

    const call = contactAttemptStore.createOrReuseAttempt.mock.calls[0][0];
    expect(call).not.toHaveProperty("providerResponded", true);
    expect(call).not.toHaveProperty("providerAccepted", true);
    expect(call).not.toHaveProperty("bookingConfirmed", true);
    expect(call).not.toHaveProperty("paymentAuthorized", true);
    expect(call).not.toHaveProperty("dispatched", true);
  });
});

function makeMockAvailabilityIntakeStore(overrides?: Record<string, unknown>) {
  return {
    getByCandidateId: vi.fn().mockResolvedValue(null),
    upsertForCandidate: vi.fn().mockResolvedValue({
      id: "intake-1", tenantId: "default", candidateId: "candidate-1", mobileServiceConfirmed: "yes",
      serviceAreas: ["90027"], recurringAvailability: null, minimumNoticeHours: 24,
      appointmentDurationMinutes: 60, travelBufferMinutes: 30, bookingUrl: "https://example.com/book",
      calendarMethod: "booking_url", preferredContactChannel: "phone", blackoutNotes: null, onboardingNotes: null,
      createdBy: "admin", createdAt: new Date(), updatedAt: new Date(),
    }),
    ...overrides,
  };
}

describe("vendorAcquisitionMissionRouter -- getCandidateAvailabilityIntake (Slice 78b)", () => {
  it("rejects unauthenticated and non-admin callers", async () => {
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never, makeMockSourcingStore() as never);
    await expect(
      router.createCaller(context(null)).getCandidateAvailabilityIntake({ candidateId: "candidate-1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns candidate_not_found when the candidate does not belong to this tenant", async () => {
    const sourcingStore = makeMockSourcingStore({ getCandidate: vi.fn().mockResolvedValue(null) });
    const intakeStore = makeMockAvailabilityIntakeStore();
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never, sourcingStore as never, undefined, undefined, undefined, intakeStore as never);
    const result = await router.createCaller(context({ role: "admin" })).getCandidateAvailabilityIntake({ candidateId: "missing" });
    expect(result).toEqual({ status: "candidate_not_found" });
    expect(intakeStore.getByCandidateId).not.toHaveBeenCalled();
  });

  it("returns null intake honestly when none exists yet, rather than fabricating one", async () => {
    const sourcingStore = makeMockSourcingStore({ getCandidate: vi.fn().mockResolvedValue(makeMockCandidate()) });
    const intakeStore = makeMockAvailabilityIntakeStore({ getByCandidateId: vi.fn().mockResolvedValue(null) });
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never, sourcingStore as never, undefined, undefined, undefined, intakeStore as never);
    const result = await router.createCaller(context({ role: "admin" })).getCandidateAvailabilityIntake({ candidateId: "candidate-1" });
    expect(result).toEqual({ status: "ok", intake: null });
  });
});

describe("vendorAcquisitionMissionRouter -- saveCandidateAvailabilityIntake (Slice 78b)", () => {
  it("rejects unauthenticated and non-admin callers", async () => {
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never, makeMockSourcingStore() as never);
    await expect(
      router.createCaller(context(null)).saveCandidateAvailabilityIntake({ candidateId: "candidate-1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("persists availability intake for a real candidate (booking URL, recurring availability, service area, notice/duration/buffer, calendar method, contact channel)", async () => {
    const sourcingStore = makeMockSourcingStore({ getCandidate: vi.fn().mockResolvedValue(makeMockCandidate()) });
    const intakeStore = makeMockAvailabilityIntakeStore();
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never, sourcingStore as never, undefined, undefined, undefined, intakeStore as never);
    const result = await router.createCaller(context({ role: "admin" })).saveCandidateAvailabilityIntake({
      candidateId: "candidate-1",
      mobileServiceConfirmed: "yes",
      serviceAreas: ["90027"],
      recurringAvailability: [{ days: ["Tuesday"], startTime: "10:00", endTime: "13:00" }],
      minimumNoticeHours: 24,
      appointmentDurationMinutes: 60,
      travelBufferMinutes: 30,
      bookingUrl: "https://example.com/book",
      calendarMethod: "booking_url",
      preferredContactChannel: "phone",
    });
    expect(result.status).toBe("ok");
    expect(intakeStore.upsertForCandidate).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "default", candidateId: "candidate-1", mobileServiceConfirmed: "yes", bookingUrl: "https://example.com/book",
    }));
  });

  it("is idempotent: saving twice for the same candidate calls upsert both times without creating a new candidate", async () => {
    const sourcingStore = makeMockSourcingStore({ getCandidate: vi.fn().mockResolvedValue(makeMockCandidate()) });
    const intakeStore = makeMockAvailabilityIntakeStore();
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never, sourcingStore as never, undefined, undefined, undefined, intakeStore as never);
    await router.createCaller(context({ role: "admin" })).saveCandidateAvailabilityIntake({ candidateId: "candidate-1", mobileServiceConfirmed: "yes" });
    await router.createCaller(context({ role: "admin" })).saveCandidateAvailabilityIntake({ candidateId: "candidate-1", mobileServiceConfirmed: "yes" });
    expect(intakeStore.upsertForCandidate).toHaveBeenCalledTimes(2);
    expect(sourcingStore.createCandidate).not.toHaveBeenCalled();
  });

  it("rejects an invalid booking URL", async () => {
    const sourcingStore = makeMockSourcingStore({ getCandidate: vi.fn().mockResolvedValue(makeMockCandidate()) });
    const intakeStore = makeMockAvailabilityIntakeStore();
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never, sourcingStore as never, undefined, undefined, undefined, intakeStore as never);
    await expect(
      router.createCaller(context({ role: "admin" })).saveCandidateAvailabilityIntake({ candidateId: "candidate-1", bookingUrl: "not-a-url" }),
    ).rejects.toBeTruthy();
  });

  it("rejects an invalid calendar method or preferred contact channel outside the controlled enum", async () => {
    const sourcingStore = makeMockSourcingStore({ getCandidate: vi.fn().mockResolvedValue(makeMockCandidate()) });
    const intakeStore = makeMockAvailabilityIntakeStore();
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never, sourcingStore as never, undefined, undefined, undefined, intakeStore as never);
    await expect(
      router.createCaller(context({ role: "admin" })).saveCandidateAvailabilityIntake({ candidateId: "candidate-1", calendarMethod: "anything_made_up" as never }),
    ).rejects.toBeTruthy();
  });

  it("clamps/rejects numeric values outside policy bounds (minimum notice 0-720h, duration 15-480min, buffer 0-240min)", async () => {
    const sourcingStore = makeMockSourcingStore({ getCandidate: vi.fn().mockResolvedValue(makeMockCandidate()) });
    const intakeStore = makeMockAvailabilityIntakeStore();
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never, sourcingStore as never, undefined, undefined, undefined, intakeStore as never);
    await expect(
      router.createCaller(context({ role: "admin" })).saveCandidateAvailabilityIntake({ candidateId: "candidate-1", minimumNoticeHours: 9999 }),
    ).rejects.toBeTruthy();
    await expect(
      router.createCaller(context({ role: "admin" })).saveCandidateAvailabilityIntake({ candidateId: "candidate-1", appointmentDurationMinutes: 5 }),
    ).rejects.toBeTruthy();
    await expect(
      router.createCaller(context({ role: "admin" })).saveCandidateAvailabilityIntake({ candidateId: "candidate-1", travelBufferMinutes: 9999 }),
    ).rejects.toBeTruthy();
  });

  it("never invokes any outreach/send/booking/calendar-OAuth capability -- this mutation has no contact-attempt store access at all", async () => {
    const sourcingStore = makeMockSourcingStore({ getCandidate: vi.fn().mockResolvedValue(makeMockCandidate()) });
    const intakeStore = makeMockAvailabilityIntakeStore();
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never, sourcingStore as never, undefined, undefined, undefined, intakeStore as never);
    await router.createCaller(context({ role: "admin" })).saveCandidateAvailabilityIntake({ candidateId: "candidate-1", mobileServiceConfirmed: "yes" });
    expect(Object.keys(intakeStore).sort()).toEqual(["getByCandidateId", "upsertForCandidate"]);
  });
});

// Slice 81a. A deterministic stub for the service-area verifier so
// these runDiscovery tests never attempt the real verifier's live
// website fetch (place_1 below carries a website URL) -- the verifier
// itself has its own full test suite in
// vendorCandidateServiceAreaVerifier.test.ts.
const STUB_VERIFY_SERVICE_AREA_FN = vi.fn().mockResolvedValue({
  serviceAreaStatus: "unverified", serviceAreaReasons: [], targetZipMatched: false, targetBuildingMatched: false,
  candidateAddressZip: null, distanceMilesToTarget: null, websiteChecked: false, websiteServiceAreas: [],
  websiteMentionsTargetZip: false, websiteMentionsTargetBuilding: false, contactRoute: "unknown",
  emailAddressesFound: [], contactFormDetected: false, phoneFound: false, outreachReadiness: "not_outreach_ready",
  verificationSource: "not_checked", verificationConfidence: "low",
});

const FOUR_CANDIDATES = [
  { provider: "google_places" as const, placeId: "place_1", businessName: "Sunset Mobile Grooming", rating: 4.9, reviewCount: 220, address: "1 Main St", website: "https://a.example", phone: "111", coordinates: null, sourceUrl: "https://maps/1" },
  { provider: "google_places" as const, placeId: "place_2", businessName: "Pawhamas Resort", rating: 4.7, reviewCount: 80, address: "2 Main St", website: null, phone: null, coordinates: null, sourceUrl: "https://maps/2" },
  { provider: "google_places" as const, placeId: "place_3", businessName: "Pet Purrspective", rating: 4.5, reviewCount: 30, address: "3 Main St", website: null, phone: null, coordinates: null, sourceUrl: "https://maps/3" },
  { provider: "google_places" as const, placeId: "place_4", businessName: "K-9 Tubs", rating: 4.2, reviewCount: 10, address: "4 Main St", website: null, phone: null, coordinates: null, sourceUrl: "https://maps/4" },
];

describe("vendorAcquisitionMissionRouter -- runDiscovery mission-scoped shortlist (Slice 79a)", () => {
  it("upserts a mission match row for every resolved candidate, shortlisting only the top targetQuantity", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission({ targetQuantity: 2 })) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: FOUR_CANDIDATES });
    const matchStore = makeMockMatchStore();
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, matchStore as never, STUB_VERIFY_SERVICE_AREA_FN as never);
    const result = await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.shortlistedCount).toBe(2);
    expect(result.overflowCount).toBe(2);
    expect(matchStore.upsertMatch).toHaveBeenCalledTimes(4);
    const shortlistedCalls = matchStore.upsertMatch.mock.calls.filter(([call]) => call.isShortlisted === true);
    const overflowCalls = matchStore.upsertMatch.mock.calls.filter(([call]) => call.isShortlisted === false);
    expect(shortlistedCalls).toHaveLength(2);
    expect(overflowCalls).toHaveLength(2);
  });

  it("ranks the highest-rated candidate first and assigns sequential rank positions", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission({ targetQuantity: 2 })) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: FOUR_CANDIDATES });
    const matchStore = makeMockMatchStore();
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, matchStore as never, STUB_VERIFY_SERVICE_AREA_FN as never);
    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    const firstCall = matchStore.upsertMatch.mock.calls.find(([call]) => call.rankPosition === 1)?.[0];
    expect(firstCall.matchEvidence.businessName).toBe("Sunset Mobile Grooming");
    expect(firstCall.isShortlisted).toBe(true);
  });

  it("rerunning discovery for the same mission/candidate updates the match row via upsert, never duplicating", async () => {
    // Simulates a rerun where the candidate was already persisted by a
    // prior run (findCandidateBySourceReference returns the same
    // existing candidate both times) -- the match store's own
    // upsertMatch (backed by the table's UNIQUE KEY) is what makes this
    // idempotent, not a different candidate id per call.
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission({ targetQuantity: 10 })) });
    const sourcingStore = makeMockSourcingStore({
      findCandidateBySourceReference: vi.fn().mockResolvedValue({ id: "candidate-1", sourceReference: "place_1" }),
    });
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [FOUR_CANDIDATES[0]] });
    const matchStore = makeMockMatchStore();
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, matchStore as never, STUB_VERIFY_SERVICE_AREA_FN as never);

    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });
    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(matchStore.upsertMatch).toHaveBeenCalledTimes(2);
    expect(matchStore.upsertMatch.mock.calls[0][0].candidateId).toBe("candidate-1");
    expect(matchStore.upsertMatch.mock.calls[1][0].candidateId).toBe("candidate-1");
  });

  it("never invokes any outreach/send capability from the match store -- its interface has only match lifecycle methods", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission({ targetQuantity: 2 })) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: FOUR_CANDIDATES });
    const matchStore = makeMockMatchStore();
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, matchStore as never, STUB_VERIFY_SERVICE_AREA_FN as never);
    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(Object.keys(matchStore).sort()).toEqual(["countMissionMatches", "listMissionMatches", "upsertMatch"]);
  });
});

function verification(overrides?: Partial<Record<string, unknown>>) {
  return {
    serviceAreaStatus: "unverified", serviceAreaReasons: [], targetZipMatched: false, targetBuildingMatched: false,
    candidateAddressZip: null, distanceMilesToTarget: null, websiteChecked: false, websiteTextSnippet: "", websiteServiceAreas: [],
    websiteMentionsTargetZip: false, websiteMentionsTargetBuilding: false, contactRoute: "unknown",
    emailAddressesFound: [], contactFormDetected: false, phoneFound: false, outreachReadiness: "not_outreach_ready",
    verificationSource: "not_checked", verificationConfidence: "low",
    ...overrides,
  };
}

function interpretation(overrides?: Partial<Record<string, unknown>>) {
  return {
    serviceAreaStatus: "verified_serves_target", serviceAreaReasons: ["Website explicitly mentions the target ZIP"],
    targetZipSupported: true, targetBuildingSupported: false, targetNeighborhoodSupported: false,
    serviceAreaTextSummary: "Site confirms target ZIP coverage.",
    contactRoute: "email_available", outreachReadiness: "email_ready", confidence: "high", requiresHumanReview: false,
    ...overrides,
  };
}

describe("vendorAcquisitionMissionRouter -- runDiscovery service-area verification integration (Slice 81a)", () => {
  it("calls the verifier for every resolved candidate and saves the result into match_evidence_json", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission({ targetQuantity: 2 })) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [FOUR_CANDIDATES[0]] });
    const matchStore = makeMockMatchStore();
    const verifyFn = vi.fn().mockResolvedValue(verification({ serviceAreaStatus: "verified_serves_target" }));
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, matchStore as never, verifyFn as never);
    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(verifyFn).toHaveBeenCalledOnce();
    const upsertCall = matchStore.upsertMatch.mock.calls[0][0];
    expect(upsertCall.matchEvidence.serviceAreaVerification.serviceAreaStatus).toBe("verified_serves_target");
  });

  it("ranks verified candidates above unverified candidates regardless of rating", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission({ targetQuantity: 2 })) });
    const sourcingStore = makeMockSourcingStore();
    // place_1 (Sunset, rating 4.9) is the highest-rated but will be
    // classified likely_out_of_area; place_4 (K-9 Tubs, rating 4.2,
    // lowest-rated) will be classified verified -- verified must still
    // rank first despite the lower rating.
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: FOUR_CANDIDATES });
    const matchStore = makeMockMatchStore();
    const verifyFn = vi.fn().mockImplementation(async (input: { candidate: { address: string | null } }) => {
      if (input.candidate.address === "4 Main St") return verification({ serviceAreaStatus: "verified_serves_target" });
      if (input.candidate.address === "1 Main St") return verification({ serviceAreaStatus: "likely_out_of_area" });
      return verification({ serviceAreaStatus: "unverified" });
    });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, matchStore as never, verifyFn as never);
    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    const firstRanked = matchStore.upsertMatch.mock.calls.find(([call]) => call.rankPosition === 1)?.[0];
    expect(firstRanked.matchEvidence.businessName).toBe("K-9 Tubs");
    expect(firstRanked.isShortlisted).toBe(true);
  });

  it("excludes likely_out_of_area/out_of_area candidates from the primary shortlist when enough in-area alternatives exist", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission({ targetQuantity: 2 })) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: FOUR_CANDIDATES });
    const matchStore = makeMockMatchStore();
    // place_1 out-of-area; the other three unverified (in-area pool of 3, target is 2).
    const verifyFn = vi.fn().mockImplementation(async (input: { candidate: { address: string | null } }) => {
      if (input.candidate.address === "1 Main St") return verification({ serviceAreaStatus: "likely_out_of_area" });
      return verification({ serviceAreaStatus: "unverified" });
    });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, matchStore as never, verifyFn as never);
    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    const sunsetCall = matchStore.upsertMatch.mock.calls.find(([call]) => call.matchEvidence.businessName === "Sunset Mobile Grooming")?.[0];
    expect(sunsetCall.isShortlisted).toBe(false);
  });

  it("does not fill the mission target count with out-of-area candidates when fewer in-area alternatives exist than the target", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission({ targetQuantity: 3 })) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: FOUR_CANDIDATES });
    const matchStore = makeMockMatchStore();
    // Only place_4 is in-area (pool of 1); the other three are
    // out-of-area. Target is 3, but only 1 real alternative exists --
    // it is better to show 1 verified candidate than to pretend 3 are
    // qualified, so the out-of-area pool fills the remaining 2 slots
    // (per the brief's explicit "fewer alternatives" fallback) while
    // still being honestly labeled out-of-area in their own evidence.
    const verifyFn = vi.fn().mockImplementation(async (input: { candidate: { address: string | null } }) => {
      if (input.candidate.address === "4 Main St") return verification({ serviceAreaStatus: "unverified" });
      return verification({ serviceAreaStatus: "likely_out_of_area" });
    });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, matchStore as never, verifyFn as never);
    const result = await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    if (result.status !== "ok") throw new Error("expected ok");
    const k9Call = matchStore.upsertMatch.mock.calls.find(([call]) => call.matchEvidence.businessName === "K-9 Tubs")?.[0];
    expect(k9Call.rankPosition).toBe(1);
    expect(k9Call.isShortlisted).toBe(true);
  });
});

describe("vendorAcquisitionMissionRouter -- runDiscovery structured service-area interpretation (Slice 81b)", () => {
  it("calls the structured interpreter after deterministic website evidence extraction when meaningful text exists", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission({ targetQuantity: 2 })) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [FOUR_CANDIDATES[0]] });
    const matchStore = makeMockMatchStore();
    const verifyFn = vi.fn().mockResolvedValue(verification({ websiteChecked: true, websiteTextSnippet: "We serve 90027. Email hello@example.com." }));
    const interpretFn = vi.fn().mockResolvedValue({ status: "ok", interpretation: interpretation() });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, matchStore as never, verifyFn as never, interpretFn as never);
    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(interpretFn).toHaveBeenCalledOnce();
    const upsertCall = matchStore.upsertMatch.mock.calls[0][0];
    expect(upsertCall.matchEvidence.serviceAreaEffectiveEvidence.serviceAreaInterpreterSource).toBe("anthropic_structured");
    expect(upsertCall.matchEvidence.serviceAreaEffectiveEvidence.serviceAreaStatus).toBe("verified_serves_target");
  });

  it("does not call the structured interpreter when there is no meaningful website text", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission({ targetQuantity: 2 })) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [FOUR_CANDIDATES[0]] });
    const matchStore = makeMockMatchStore();
    const verifyFn = vi.fn().mockResolvedValue(verification({ websiteChecked: false }));
    const interpretFn = vi.fn();
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, matchStore as never, verifyFn as never, interpretFn as never);
    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(interpretFn).not.toHaveBeenCalled();
    const upsertCall = matchStore.upsertMatch.mock.calls[0][0];
    expect(upsertCall.matchEvidence.serviceAreaEffectiveEvidence.serviceAreaInterpreterSource).toBe("deterministic_fallback");
    expect(upsertCall.matchEvidence.serviceAreaEffectiveEvidence.serviceAreaFallbackReason).toBe("no_website_text");
  });

  it("falls back to the deterministic result when the interpreter returns a non-ok status, recording the fallback reason", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission({ targetQuantity: 2 })) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [FOUR_CANDIDATES[0]] });
    const matchStore = makeMockMatchStore();
    const verifyFn = vi.fn().mockResolvedValue(verification({ serviceAreaStatus: "likely_out_of_area", websiteChecked: true, websiteTextSnippet: "We serve the valley." }));
    const interpretFn = vi.fn().mockResolvedValue({ status: "invalid_output", reason: "schema_validation_failed" });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, matchStore as never, verifyFn as never, interpretFn as never);
    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    const upsertCall = matchStore.upsertMatch.mock.calls[0][0];
    expect(upsertCall.matchEvidence.serviceAreaEffectiveEvidence.serviceAreaInterpreterSource).toBe("deterministic_fallback");
    expect(upsertCall.matchEvidence.serviceAreaEffectiveEvidence.serviceAreaFallbackReason).toBe("invalid_output");
    expect(upsertCall.matchEvidence.serviceAreaEffectiveEvidence.serviceAreaStatus).toBe("likely_out_of_area");
  });

  it("falls back to the deterministic result (never throwing) when the interpreter call rejects", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission({ targetQuantity: 2 })) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [FOUR_CANDIDATES[0]] });
    const matchStore = makeMockMatchStore();
    const verifyFn = vi.fn().mockResolvedValue(verification({ websiteChecked: true, websiteTextSnippet: "We serve the valley." }));
    const interpretFn = vi.fn().mockRejectedValue(new Error("upstream 503"));
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, matchStore as never, verifyFn as never, interpretFn as never);
    const result = await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(result.status).toBe("ok");
    const upsertCall = matchStore.upsertMatch.mock.calls[0][0];
    expect(upsertCall.matchEvidence.serviceAreaEffectiveEvidence.serviceAreaInterpreterSource).toBe("deterministic_fallback");
  });

  it("ranks by the structured (effective) service-area status, not the raw deterministic status, when the interpreter overrides it", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission({ targetQuantity: 2 })) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: FOUR_CANDIDATES });
    const matchStore = makeMockMatchStore();
    // Deterministically place_1 (Sunset) looks "unverified", but the
    // structured interpreter actually classifies it likely_out_of_area
    // after reading the explicit service-area text -- ranking must
    // follow the interpreter's classification, not the raw deterministic one.
    const verifyFn = vi.fn().mockImplementation(async (input: { candidate: { address: string | null } }) => {
      if (input.candidate.address === "1 Main St") return verification({ websiteChecked: true, websiteTextSnippet: "We serve the San Fernando Valley only." });
      return verification();
    });
    const interpretFn = vi.fn().mockImplementation(async (input: { candidateAddress: string | null }) => {
      if (input.candidateAddress === "1 Main St") {
        return { status: "ok", interpretation: interpretation({ serviceAreaStatus: "likely_out_of_area", outreachReadiness: "form_required", contactRoute: "contact_form_available", requiresHumanReview: true }) };
      }
      return { status: "skipped_no_text" };
    });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, undefined, undefined, undefined, matchStore as never, verifyFn as never, interpretFn as never);
    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    const sunsetCall = matchStore.upsertMatch.mock.calls.find(([call]) => call.matchEvidence.businessName === "Sunset Mobile Grooming")?.[0];
    expect(sunsetCall.isShortlisted).toBe(false);
    expect(sunsetCall.matchEvidence.serviceAreaEffectiveEvidence.serviceAreaStatus).toBe("likely_out_of_area");
  });
});

describe("vendorAcquisitionMissionRouter -- listMissionShortlist (Slice 79a)", () => {
  it("rejects unauthenticated and non-admin callers", async () => {
    const router = createVendorAcquisitionMissionRouter(makeMockStore() as never, makeMockSourcingStore() as never);
    await expect(
      router.createCaller(context(null)).listMissionShortlist({ missionId: "mission-1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns mission_not_found honestly when the mission does not exist", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(null) });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, makeMockSourcingStore() as never);
    const result = await router.createCaller(context({ role: "admin" })).listMissionShortlist({ missionId: "missing" });
    expect(result).toEqual({ status: "mission_not_found" });
  });

  it("returns only shortlisted matches by default, merged with real candidate data", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore({
      listCandidatesForReview: vi.fn().mockResolvedValue([{ id: "candidate-1", businessName: "Sunset Mobile Grooming", evidence: { rating: 4.9 } }]),
    });
    const matchStore = makeMockMatchStore({
      listMissionMatches: vi.fn().mockResolvedValue([{
        id: "match-1", tenantId: "default", missionId: "mission-1", candidateId: "candidate-1",
        matchedQuery: "mobile dog groomers near 90027", queryPlannerSource: "anthropic_structured",
        serviceMode: "mobile_required", rankScore: 9.5, rankPosition: 1, isShortlisted: true,
      }]),
      countMissionMatches: vi.fn().mockResolvedValue({ total: 4, shortlisted: 1 }),
    });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, undefined, undefined, undefined, undefined, matchStore as never);
    const result = await router.createCaller(context({ role: "admin" })).listMissionShortlist({ missionId: "mission-1" });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.totalFound).toBe(4);
    expect(result.shortlistedCount).toBe(1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].businessName).toBe("Sunset Mobile Grooming");
    expect(result.entries[0].matchedQuery).toBe("mobile dog groomers near 90027");
    expect(result.entries[0].queryPlannerSource).toBe("anthropic_structured");
    expect(matchStore.listMissionMatches).toHaveBeenCalledWith(expect.objectContaining({ includeOverflow: false }));
  });

  it("returns overflow matches too when includeOverflow is requested", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore({ listCandidatesForReview: vi.fn().mockResolvedValue([]) });
    const matchStore = makeMockMatchStore();
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, undefined, undefined, undefined, undefined, matchStore as never);
    await router.createCaller(context({ role: "admin" })).listMissionShortlist({ missionId: "mission-1", includeOverflow: true });
    expect(matchStore.listMissionMatches).toHaveBeenCalledWith(expect.objectContaining({ includeOverflow: true }));
  });

  it("never invokes any outreach/send capability", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore({ listCandidatesForReview: vi.fn().mockResolvedValue([]) });
    const matchStore = makeMockMatchStore();
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, undefined, undefined, undefined, undefined, matchStore as never);
    await router.createCaller(context({ role: "admin" })).listMissionShortlist({ missionId: "mission-1" });
    expect(Object.keys(matchStore).sort()).toEqual(["countMissionMatches", "listMissionMatches", "upsertMatch"]);
  });

  it("Slice 81a: exposes serviceAreaVerification from the match's own (fresh) evidence, never from the candidate's stale evidence blob", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore({
      listCandidatesForReview: vi.fn().mockResolvedValue([{
        id: "candidate-1", businessName: "Sunset Mobile Grooming",
        // Stale: candidate's own evidence was written at first
        // discovery and has no verification info (or an outdated one).
        evidence: { rating: 4.9 },
      }]),
    });
    const matchStore = makeMockMatchStore({
      listMissionMatches: vi.fn().mockResolvedValue([{
        id: "match-1", tenantId: "default", missionId: "mission-1", candidateId: "candidate-1",
        matchedQuery: "mobile dog groomers near 90027", queryPlannerSource: "anthropic_structured",
        serviceMode: "mobile_required", rankScore: 9.5, rankPosition: 1, isShortlisted: false,
        matchEvidence: { rating: 4.9, serviceAreaVerification: verification({ serviceAreaStatus: "likely_out_of_area", serviceAreaReasons: ["Business address ZIP 91306 is outside target area"] }) },
      }]),
      countMissionMatches: vi.fn().mockResolvedValue({ total: 1, shortlisted: 0 }),
    });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, undefined, undefined, undefined, undefined, matchStore as never);
    const result = await router.createCaller(context({ role: "admin" })).listMissionShortlist({ missionId: "mission-1", includeOverflow: true });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.entries[0].serviceAreaVerification?.serviceAreaStatus).toBe("likely_out_of_area");
    expect(result.entries[0].overflowReason).toBe("Business address ZIP 91306 is outside target area");
  });

  it("Slice 81b: exposes the structured (effective) evidence when present, and never calls the Claude interpreter or the network", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore({
      listCandidatesForReview: vi.fn().mockResolvedValue([{ id: "candidate-1", businessName: "Sunset Mobile Grooming", evidence: { rating: 4.9 } }]),
    });
    const matchStore = makeMockMatchStore({
      listMissionMatches: vi.fn().mockResolvedValue([{
        id: "match-1", tenantId: "default", missionId: "mission-1", candidateId: "candidate-1",
        matchedQuery: "mobile dog groomers near 90027", queryPlannerSource: "anthropic_structured",
        serviceMode: "mobile_required", rankScore: 9.5, rankPosition: 1, isShortlisted: false,
        matchEvidence: {
          rating: 4.9,
          serviceAreaVerification: verification({ serviceAreaStatus: "unverified" }),
          serviceAreaEffectiveEvidence: {
            serviceAreaStatus: "likely_out_of_area",
            serviceAreaReasons: ["Explicit service-area list excludes 90027 and OPUS LA"],
            contactRoute: "contact_form_available", outreachReadiness: "form_required",
            emailAddressesFound: [], requiresHumanReview: true,
            serviceAreaInterpreterSource: "anthropic_structured", serviceAreaFallbackReason: null,
          },
        },
      }]),
      countMissionMatches: vi.fn().mockResolvedValue({ total: 1, shortlisted: 0 }),
    });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, undefined, undefined, undefined, undefined, matchStore as never);
    const result = await router.createCaller(context({ role: "admin" })).listMissionShortlist({ missionId: "mission-1", includeOverflow: true });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    // The interpreter-derived status overrides the raw deterministic one.
    expect(result.entries[0].serviceAreaVerification?.serviceAreaStatus).toBe("likely_out_of_area");
    expect(result.entries[0].serviceAreaVerification?.contactRoute).toBe("contact_form_available");
    expect((result.entries[0].serviceAreaVerification as { requiresHumanReview?: boolean })?.requiresHumanReview).toBe(true);
    expect((result.entries[0].serviceAreaVerification as { serviceAreaInterpreterSource?: string })?.serviceAreaInterpreterSource).toBe("anthropic_structured");
  });
});

const READY_ENV = {
  HELD_VENDOR_EMAIL_PROVIDER: "agentmail",
  AGENTMAIL_API_KEY: "test-key",
  AGENTMAIL_VENDOR_INBOX_ID: "inbox-1",
  AGENTMAIL_VENDOR_INBOX_EMAIL: "vendors@held.test",
  HELD_VENDOR_EMAIL_CANARY_ENABLED: "true",
  HELD_VENDOR_EMAIL_SOURCE_ALLOWLIST: "sourcing_candidate:candidate-1",
  HELD_VENDOR_EMAIL_CATEGORY_ALLOWLIST: "dog_grooming",
};

function makeMockDraftAttempt(overrides?: Record<string, unknown>) {
  return {
    id: "attempt-1", sourceKey: "sourcing_candidate:candidate-1", candidateId: "candidate-1",
    draftSubject: "HELD preferred vendor list — mobile dog grooming near 90027",
    draftBodySnapshot: "Hi — I'm Adam with HELD...",
    founderEscalationPresent: true, forbiddenClaimsScanJson: { found: [] },
    outreachSentByHeld: false, providerAttemptId: null, sentAt: null, status: "draft_ready",
    ...overrides,
  };
}

function makeMockMatchEntry(overrides?: Record<string, unknown>) {
  return { id: "match-1", missionId: "mission-1", candidateId: "candidate-1", isShortlisted: true, ...overrides };
}

describe("vendorAcquisitionMissionRouter -- sendCandidateDraftOutreachCanary (Slice 80a)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    for (const [key, value] of Object.entries(READY_ENV)) vi.stubEnv(key, value);
    vi.mocked(sendVendorEmailViaAgentMail).mockReset();
  });

  function setup(overrides?: { missionStore?: object; sourcingStore?: object; matchStore?: object; contactAttemptStore?: object }) {
    const missionStore = overrides?.missionStore ?? makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = overrides?.sourcingStore ?? makeMockSourcingStore({ getCandidate: vi.fn().mockResolvedValue(makeMockCandidate()) });
    const matchStore = overrides?.matchStore ?? makeMockMatchStore({ listMissionMatches: vi.fn().mockResolvedValue([makeMockMatchEntry()]) });
    const contactAttemptStore = overrides?.contactAttemptStore ?? makeMockContactAttemptStore({
      listAttemptsByCandidateId: vi.fn().mockResolvedValue([makeMockDraftAttempt()]),
      recordLiveSendResult: vi.fn().mockResolvedValue({}),
    });
    const router = createVendorAcquisitionMissionRouter(
      missionStore as never, sourcingStore as never, undefined, undefined,
      contactAttemptStore as never, undefined, matchStore as never,
    );
    return { router, missionStore, sourcingStore, matchStore, contactAttemptStore };
  }

  function validInput(overrides?: Record<string, unknown>) {
    return {
      missionId: "mission-1", candidateId: "candidate-1", recipientEmail: "vendor@example.com",
      explicitConfirmation: true, adminConfirmationText: SUPERVISED_CANARY_CONFIRMATION_TEXT,
      ...overrides,
    };
  }

  it("rejects unauthenticated and non-admin callers", async () => {
    const { router } = setup();
    await expect(router.createCaller(context(null)).sendCandidateDraftOutreachCanary(validInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("cannot send without explicit confirmation, and never calls the provider", async () => {
    const { router } = setup();
    const result = await router.createCaller(context({ role: "admin" })).sendCandidateDraftOutreachCanary(validInput({ explicitConfirmation: false }));
    expect(result).toEqual({ status: "blocked", blockedReasons: ["explicit_confirmation_required"], attemptId: null, sendResult: null });
    expect(sendVendorEmailViaAgentMail).not.toHaveBeenCalled();
  });

  it("cannot send without a draft queued for the candidate", async () => {
    const { router } = setup({ contactAttemptStore: makeMockContactAttemptStore({ listAttemptsByCandidateId: vi.fn().mockResolvedValue([]) }) });
    const result = await router.createCaller(context({ role: "admin" })).sendCandidateDraftOutreachCanary(validInput());
    expect(result.status).toBe("draft_not_found");
    expect(sendVendorEmailViaAgentMail).not.toHaveBeenCalled();
  });

  it("cannot send for a candidate with no match row on this mission", async () => {
    const { router } = setup({ matchStore: makeMockMatchStore({ listMissionMatches: vi.fn().mockResolvedValue([]) }) });
    const result = await router.createCaller(context({ role: "admin" })).sendCandidateDraftOutreachCanary(validInput());
    expect(result.status).toBe("candidate_not_in_mission");
    expect(sendVendorEmailViaAgentMail).not.toHaveBeenCalled();
  });

  it("rejects an invalid recipient email via the existing gate, without calling the provider", async () => {
    const { router } = setup();
    const result = await router.createCaller(context({ role: "admin" })).sendCandidateDraftOutreachCanary(validInput({ recipientEmail: "not-an-email" }));
    expect(result.status).toBe("gate_blocked");
    expect(result.blockedReasons).toContain("recipient_email_invalid");
    expect(sendVendorEmailViaAgentMail).not.toHaveBeenCalled();
  });

  it("rejects a wrong admin confirmation phrase via the existing gate, without calling the provider", async () => {
    const { router } = setup();
    const result = await router.createCaller(context({ role: "admin" })).sendCandidateDraftOutreachCanary(validInput({ adminConfirmationText: "wrong phrase" }));
    expect(result.status).toBe("gate_blocked");
    expect(result.blockedReasons).toContain("admin_confirmation_text_mismatch");
    expect(sendVendorEmailViaAgentMail).not.toHaveBeenCalled();
  });

  it("returns gate_blocked with the exact reason when the canary flag is disabled, and never calls the provider", async () => {
    vi.stubEnv("HELD_VENDOR_EMAIL_CANARY_ENABLED", "false");
    const { router } = setup();
    const result = await router.createCaller(context({ role: "admin" })).sendCandidateDraftOutreachCanary(validInput());
    expect(result.status).toBe("gate_blocked");
    expect(result.blockedReasons).toContain("live_email_canary_disabled");
    expect(sendVendorEmailViaAgentMail).not.toHaveBeenCalled();
  });

  it("respects the source allowlist -- a candidate sourceKey outside the allowlist is blocked, never sent", async () => {
    vi.stubEnv("HELD_VENDOR_EMAIL_SOURCE_ALLOWLIST", "sourcing_candidate:some-other-candidate");
    const { router } = setup();
    const result = await router.createCaller(context({ role: "admin" })).sendCandidateDraftOutreachCanary(validInput());
    expect(result.status).toBe("gate_blocked");
    expect(result.blockedReasons).toContain("source_not_allowlisted");
    expect(sendVendorEmailViaAgentMail).not.toHaveBeenCalled();
  });

  it("respects the category allowlist -- an uncategorized/unlisted category is blocked, never sent", async () => {
    vi.stubEnv("HELD_VENDOR_EMAIL_CATEGORY_ALLOWLIST", "haircut");
    const { router } = setup();
    const result = await router.createCaller(context({ role: "admin" })).sendCandidateDraftOutreachCanary(validInput());
    expect(result.status).toBe("gate_blocked");
    expect(result.blockedReasons).toContain("category_not_allowlisted");
    expect(sendVendorEmailViaAgentMail).not.toHaveBeenCalled();
  });

  it("sends exactly one supervised email for one shortlisted candidate when every gate passes", async () => {
    vi.mocked(sendVendorEmailViaAgentMail).mockResolvedValue({
      providerName: "agentmail", providerAttemptId: "msg_1", threadId: "thread_1", inboxId: "inbox-1",
      inboxEmail: "vendors@held.test", status: "sent", liveProviderInvoked: true,
      rawProviderResponseJson: { messageId: "msg_1" }, sentAt: "2026-06-25T00:00:00.000Z", errorReason: null,
    });
    const { router, contactAttemptStore } = setup();
    const result = await router.createCaller(context({ role: "admin" })).sendCandidateDraftOutreachCanary(validInput());

    expect(result.status).toBe("sent");
    expect(sendVendorEmailViaAgentMail).toHaveBeenCalledOnce();
    expect(contactAttemptStore.recordLiveSendResult).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: "attempt-1", outreachSentByHeld: true, nextStatus: "response_pending",
    }));
  });

  it("provider success marks sent truth exactly once -- recordLiveSendResult is called exactly once", async () => {
    vi.mocked(sendVendorEmailViaAgentMail).mockResolvedValue({
      providerName: "agentmail", providerAttemptId: "msg_1", threadId: null, inboxId: "inbox-1",
      inboxEmail: "vendors@held.test", status: "sent", liveProviderInvoked: true,
      rawProviderResponseJson: null, sentAt: "2026-06-25T00:00:00.000Z", errorReason: null,
    });
    const { router, contactAttemptStore } = setup();
    await router.createCaller(context({ role: "admin" })).sendCandidateDraftOutreachCanary(validInput());
    expect(contactAttemptStore.recordLiveSendResult).toHaveBeenCalledOnce();
  });

  it("provider failure does not mark sent/contacted truth", async () => {
    vi.mocked(sendVendorEmailViaAgentMail).mockResolvedValue({
      providerName: "agentmail", providerAttemptId: null, threadId: null, inboxId: "inbox-1",
      inboxEmail: "vendors@held.test", status: "rejected", liveProviderInvoked: true,
      rawProviderResponseJson: null, sentAt: null, errorReason: "provider_rejected",
    });
    const { router, contactAttemptStore } = setup();
    const result = await router.createCaller(context({ role: "admin" })).sendCandidateDraftOutreachCanary(validInput());

    expect(result.status).toBe("send_failed");
    expect(contactAttemptStore.recordLiveSendResult).toHaveBeenCalledWith(expect.objectContaining({
      outreachSentByHeld: false, nextStatus: "blocked",
    }));
  });

  it("is idempotent: a duplicate send attempt for an already-sent draft returns already_sent and never calls the provider again", async () => {
    const { router } = setup({
      contactAttemptStore: makeMockContactAttemptStore({
        listAttemptsByCandidateId: vi.fn().mockResolvedValue([makeMockDraftAttempt({ outreachSentByHeld: true, providerAttemptId: "msg_1", sentAt: new Date("2026-06-25T00:00:00.000Z") })]),
        recordLiveSendResult: vi.fn(),
      }),
    });
    const result = await router.createCaller(context({ role: "admin" })).sendCandidateDraftOutreachCanary(validInput());
    expect(result.status).toBe("already_sent");
    expect(sendVendorEmailViaAgentMail).not.toHaveBeenCalled();
  });

  it("never invokes any SMS/Yelp/web-form/phone path -- only sendVendorEmailViaAgentMail is ever called for outreach", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(__dirname, "vendorAcquisitionMissionRouter.ts"), "utf8");
    expect(source).not.toMatch(/sendSms|sendYelpMessage|placeCall|\.submit\(\)/);
  });

  it("never sets provider_accepted/booking_confirmed/payment_authorized/dispatched -- those fields are not referenced by this mutation", async () => {
    vi.mocked(sendVendorEmailViaAgentMail).mockResolvedValue({
      providerName: "agentmail", providerAttemptId: "msg_1", threadId: null, inboxId: "inbox-1",
      inboxEmail: "vendors@held.test", status: "sent", liveProviderInvoked: true,
      rawProviderResponseJson: null, sentAt: "2026-06-25T00:00:00.000Z", errorReason: null,
    });
    const { router, contactAttemptStore } = setup();
    await router.createCaller(context({ role: "admin" })).sendCandidateDraftOutreachCanary(validInput());
    const call = contactAttemptStore.recordLiveSendResult.mock.calls[0][0];
    expect(call).not.toHaveProperty("providerAccepted");
    expect(call).not.toHaveProperty("bookingConfirmed");
    expect(call).not.toHaveProperty("paymentAuthorized");
    expect(call).not.toHaveProperty("dispatched");
  });

  it("never sends more than one email even if called -- no loop over multiple candidates exists in this mutation", async () => {
    vi.mocked(sendVendorEmailViaAgentMail).mockResolvedValue({
      providerName: "agentmail", providerAttemptId: "msg_1", threadId: null, inboxId: "inbox-1",
      inboxEmail: "vendors@held.test", status: "sent", liveProviderInvoked: true,
      rawProviderResponseJson: null, sentAt: "2026-06-25T00:00:00.000Z", errorReason: null,
    });
    const { router } = setup();
    await router.createCaller(context({ role: "admin" })).sendCandidateDraftOutreachCanary(validInput());
    expect(sendVendorEmailViaAgentMail).toHaveBeenCalledTimes(1);
  });
});
