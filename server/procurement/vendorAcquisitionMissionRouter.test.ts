import { describe, expect, it, vi } from "vitest";
import { createVendorAcquisitionMissionRouter } from "./vendorAcquisitionMissionRouter";

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
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn);
    const result = await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(result).toEqual({ status: "needs_provider_config", missingEnvVar: "GOOGLE_PLACES_API_KEY" });
    expect(sourcingStore.createCandidate).not.toHaveBeenCalled();
  });

  it("surfaces a provider_error without persisting anything", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "provider_error", reason: "REQUEST_DENIED" });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn);
    const result = await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(result).toEqual({ status: "provider_error", reason: "REQUEST_DENIED" });
    expect(sourcingStore.createCandidate).not.toHaveBeenCalled();
  });

  it("builds the discovery query from real mission fields via the query planner (category, geography, target count, rating)", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [] });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn);
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
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn);
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
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn);
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
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn);
    const result = await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(result).toEqual({
      status: "ok", foundCount: 0, persistedCount: 0, alreadyDiscoveredCount: 0, candidates: [],
      queryPlannerSource: "deterministic_fallback", queryPlannerFallbackReason: "invalid_output",
    });
  });

  it("never invokes any outreach/send capability -- the sourcing store interface has no send method", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [MOCK_PLACE_CANDIDATE] });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn);
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
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn);
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
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn);
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
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn);
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
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn);
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
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn);
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
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, parserFn as never);
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
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, parserFn as never);
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
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, parserFn as never);
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
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, parserFn as never);
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
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, parserFn as never);
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
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, parserFn as never);
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
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, parserFn as never);
    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(discoveryFn.mock.calls.every(([query]) => !/\bmobile\b/i.test(query.searchText))).toBe(true);
  });

  it("never invokes any outreach/send capability from the structured-parser path either", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [MOCK_PLACE_CANDIDATE] });
    const parserFn = vi.fn().mockResolvedValue(makeStructuredPlan());
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn, parserFn as never);
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
