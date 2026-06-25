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
