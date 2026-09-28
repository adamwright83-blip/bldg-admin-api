import { beforeEach, describe, expect, it, vi } from "vitest";

const day1 = vi.hoisted(() => ({
  getDay1TenDoorsMissionReadOnly: vi.fn(),
  getOrCreateDay1TenDoorsMission: vi.fn(),
}));
const kingdoms = vi.hoisted(() => ({
  getKingdom: vi.fn(),
  listKingdoms: vi.fn(),
  setKingdomStatus: vi.fn(),
}));
const binding = vi.hoisted(() => ({ colosseumKingdomBindingSatisfied: vi.fn() }));

vi.mock("../openChannel/day1TenDoorsService", () => day1);
vi.mock("./kingdomService", () => kingdoms);
vi.mock("../goldlineProgression/colosseumKingdomBinding", () => binding);

import { deriveKingdomStatuses } from "./kingdomUnlocks";

const K1 = { kingdomId: "kingdom-1-colosseum", lanternCityStatus: "active" };
const K2 = { kingdomId: "kingdom-2-the-last-valet", lanternCityStatus: "locked" };

describe("deriveKingdomStatuses", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    kingdoms.getKingdom.mockImplementation(async ({ kingdomId }: { kingdomId: string }) =>
      kingdomId === K1.kingdomId ? { ...K1 } : { ...K2 }
    );
    kingdoms.listKingdoms.mockResolvedValue([]);
  });

  it("reads the Day 1 mission under the operator key it was given, read-only", async () => {
    day1.getDay1TenDoorsMissionReadOnly.mockResolvedValue({ outcomes: {} });
    binding.colosseumKingdomBindingSatisfied.mockReturnValue(false);
    await deriveKingdomStatuses({ tenantId: "t1", operatorId: "open-id-abc" });
    expect(day1.getDay1TenDoorsMissionReadOnly).toHaveBeenCalledWith({ tenantId: "t1", driverId: "open-id-abc" });
    // listing Kingdoms must never create a mission row
    expect(day1.getOrCreateDay1TenDoorsMission).not.toHaveBeenCalled();
    expect(kingdoms.setKingdomStatus).not.toHaveBeenCalled();
  });

  it("opens Kingdom Two when the five Colosseum outcomes are recorded", async () => {
    day1.getDay1TenDoorsMissionReadOnly.mockResolvedValue({ outcomes: { any: "recorded" } });
    binding.colosseumKingdomBindingSatisfied.mockReturnValue(true);
    await deriveKingdomStatuses({ tenantId: "t1", operatorId: "open-id-abc" });
    expect(kingdoms.setKingdomStatus).toHaveBeenCalledWith({ tenantId: "t1", kingdomId: K1.kingdomId, lanternCityStatus: "complete" });
    expect(kingdoms.setKingdomStatus).toHaveBeenCalledWith({ tenantId: "t1", kingdomId: K2.kingdomId, lanternCityStatus: "active" });
  });

  it("changes nothing when the operator has no Day 1 mission yet", async () => {
    day1.getDay1TenDoorsMissionReadOnly.mockResolvedValue(null);
    await deriveKingdomStatuses({ tenantId: "t1", operatorId: "open-id-abc" });
    expect(binding.colosseumKingdomBindingSatisfied).not.toHaveBeenCalled();
    expect(kingdoms.setKingdomStatus).not.toHaveBeenCalled();
  });

  it("fails closed when the mission cannot be read", async () => {
    day1.getDay1TenDoorsMissionReadOnly.mockRejectedValue(new Error("db down"));
    await expect(deriveKingdomStatuses({ tenantId: "t1", operatorId: "open-id-abc" })).resolves.toEqual([]);
    expect(kingdoms.setKingdomStatus).not.toHaveBeenCalled();
  });
});

describe("kingdomRouter.list", () => {
  it("keys the unlock by openId, the key Day 1 outcomes are recorded under", async () => {
    const src = await import("node:fs").then(fs => fs.readFileSync(new URL("./kingdomRouter.ts", import.meta.url), "utf8"));
    const list = src.slice(src.indexOf("list:"), src.indexOf("get:"));
    expect(list).toContain("operatorId: ctx.user.openId");
    expect(src).not.toContain("dayDirectorActorId");
  });
});
