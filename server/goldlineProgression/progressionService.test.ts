import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readMission: vi.fn(),
  isCompanionEarned: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("../openChannel/day1TenDoorsService", () => ({
  getDay1TenDoorsMissionReadOnly: mocks.readMission,
}));
vi.mock("../companions/companionService", () => ({
  isCompanionEarned: mocks.isCompanionEarned,
}));
vi.mock("../db", () => ({ getDb: mocks.getDb }));

import { colosseumLeadHuntDefinition } from "./colosseumKingdomBinding";
import { readGoldlineProgression } from "./progressionService";

const TARGETS = [...(colosseumLeadHuntDefinition()?.targetIds ?? [])];

describe("readGoldlineProgression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockResolvedValue({});
    mocks.isCompanionEarned.mockResolvedValue(false);
  });

  it("scopes the outcome read to the requested tenant and operator", async () => {
    mocks.readMission.mockImplementation(async ({ tenantId, driverId }: { tenantId: string; driverId: string }) => {
      if (tenantId === "tenant-a" && driverId === "op-a") {
        return { outcomes: Object.fromEntries(TARGETS.map(id => [id, "pitched"])) };
      }
      if (tenantId === "tenant-b" && driverId === "op-b") return { outcomes: {} };
      throw new Error(`unexpected identity ${tenantId}/${driverId}`);
    });

    const tenantA = await readGoldlineProgression({ tenantId: "tenant-a", operatorId: "op-a" });
    const tenantB = await readGoldlineProgression({ tenantId: "tenant-b", operatorId: "op-b" });

    expect(tenantA.kingdomBinding.status).toBe("satisfied");
    expect(tenantA.levelColosseumResolved.value).toBe(false);
    expect(tenantA.kingdomBrassRepublicCompleted.value).toBe(false);
    expect(tenantA.companionRookOwned.value).toBe(false);
    expect(tenantB.kingdomBinding.status).toBe("unsatisfied");
    expect(tenantB.companionRookOwned.value).toBe(false);
    expect(mocks.readMission).toHaveBeenCalledWith({ tenantId: "tenant-a", driverId: "op-a" });
    expect(mocks.readMission).toHaveBeenCalledWith({ tenantId: "tenant-b", driverId: "op-b" });
  });

  it("does not promote a capability unlock into Rook ownership", async () => {
    mocks.readMission.mockResolvedValue({ outcomes: {} });
    mocks.isCompanionEarned.mockResolvedValue(true);
    const read = await readGoldlineProgression({ tenantId: "tenant-a", operatorId: "op-a" });
    expect(read.capabilityRookContact.granted).toBe(true);
    expect(read.companionRookOwned.value).toBe(false);
    expect(mocks.isCompanionEarned).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      operatorId: "op-a",
      companionId: "rook",
    });
  });

  it("fails closed when the outcome source is unavailable", async () => {
    mocks.readMission.mockRejectedValue(new Error("database unavailable"));
    const read = await readGoldlineProgression({ tenantId: "tenant-a", operatorId: "op-a" });
    expect(read.kingdomBinding.status).toBe("uncertain");
    expect(read.levelColosseumResolved.value).toBe(false);
    expect(read.companionRookOwned.value).toBe(false);
    expect(read.kingdomBrassRepublicCompleted.value).toBe(false);
  });

  it("does not treat an unreadable capability table as ownership", async () => {
    mocks.readMission.mockResolvedValue(null);
    mocks.getDb.mockResolvedValue(null);
    const read = await readGoldlineProgression({ tenantId: "tenant-a", operatorId: "op-a" });
    expect(read.capabilityRookContact.readable).toBe(false);
    expect(read.capabilityRookContact.granted).toBe(false);
    expect(read.companionRookOwned.value).toBe(false);
    expect(mocks.isCompanionEarned).not.toHaveBeenCalled();
  });
});
