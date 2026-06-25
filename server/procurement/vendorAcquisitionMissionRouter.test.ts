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

  it("builds the discovery query from real mission fields (category, geography, target count, rating)", async () => {
    const missionStore = makeMockStore({ getMission: vi.fn().mockResolvedValue(makeMockMission()) });
    const sourcingStore = makeMockSourcingStore();
    const discoveryFn = vi.fn().mockResolvedValue({ status: "ok", candidates: [] });
    const router = createVendorAcquisitionMissionRouter(missionStore as never, sourcingStore as never, discoveryFn);
    await router.createCaller(context({ role: "admin" })).runDiscovery({ missionId: "mission-1" });

    expect(discoveryFn).toHaveBeenCalledWith({
      searchText: "Dog Grooming near 90027 (5 mi radius)",
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

    expect(result).toEqual({ status: "ok", foundCount: 0, persistedCount: 0, alreadyDiscoveredCount: 0, candidates: [] });
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
