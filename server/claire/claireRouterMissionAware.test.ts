import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCommercialMission: vi.fn(),
  assertDriverCanReadMission: vi.fn(),
  startClairePreDriveCall: vi.fn(),
}));

vi.mock("../commercialMissions/commercialMissionStore", async importOriginal => {
  const actual = await importOriginal<typeof import("../commercialMissions/commercialMissionStore")>();
  return { ...actual, getCommercialMission: mocks.getCommercialMission };
});
vi.mock("../commercialMissions/commercialMissionAuthorization", async importOriginal => {
  const actual = await importOriginal<typeof import("../commercialMissions/commercialMissionAuthorization")>();
  return { ...actual, assertDriverCanReadMission: mocks.assertDriverCanReadMission };
});
vi.mock("./claireTwilio", async importOriginal => {
  const actual = await importOriginal<typeof import("./claireTwilio")>();
  return { ...actual, startClairePreDriveCall: mocks.startClairePreDriveCall };
});

import { assertClaireMissionAccess } from "./claireRouter";

describe("mission-aware callBeforeDrive authorization gate", () => {
  it("throws NOT_FOUND for a mission id that doesn't exist, before any generation could occur", async () => {
    mocks.getCommercialMission.mockResolvedValue(null);
    await expect(
      assertClaireMissionAccess({
        tenantId: "tenant-1",
        missionId: 9999,
        userId: "operator-1",
        isAdmin: false,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.startClairePreDriveCall).not.toHaveBeenCalled();
  });

  it("rejects a mission the caller isn't authorized to read, before any generation could occur", async () => {
    mocks.getCommercialMission.mockResolvedValue({ id: 8, assignedTo: "someone-else" });
    mocks.assertDriverCanReadMission.mockImplementation(() => {
      throw new Error("not your mission");
    });
    await expect(
      assertClaireMissionAccess({
        tenantId: "tenant-1",
        missionId: 8,
        userId: "operator-1",
        isAdmin: false,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.startClairePreDriveCall).not.toHaveBeenCalled();
  });

  it("passes for an authorized, existing mission", async () => {
    mocks.getCommercialMission.mockResolvedValue({ id: 8, assignedTo: "operator-1" });
    mocks.assertDriverCanReadMission.mockImplementation(() => undefined);
    await expect(
      assertClaireMissionAccess({
        tenantId: "tenant-1",
        missionId: 8,
        userId: "operator-1",
        isAdmin: false,
      })
    ).resolves.toBeUndefined();
  });
});
