import { beforeEach, describe, expect, it, vi } from "vitest";

const day1 = vi.hoisted(() => ({
  getDay1TenDoorsMissionReadOnly: vi.fn(),
}));

const kingdoms = vi.hoisted(() => ({
  getKingdom: vi.fn(),
  listKingdoms: vi.fn(),
  setKingdomStatus: vi.fn(),
}));

const binding = vi.hoisted(() => ({
  colosseumKingdomBindingSatisfied: vi.fn(),
}));

vi.mock("../openChannel/day1TenDoorsService", () => day1);
vi.mock("./kingdomService", () => kingdoms);
vi.mock("../goldlineProgression/colosseumKingdomBinding", () => binding);

import { deriveKingdomStatuses } from "./kingdomUnlocks";

const K1 = {
  kingdomId: "kingdom-1-colosseum",
  lanternCityStatus: "active",
};

const K2 = {
  kingdomId: "kingdom-2-the-last-valet",
  lanternCityStatus: "locked",
};

describe("deriveKingdomStatuses", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    kingdoms.getKingdom.mockImplementation(
      async ({ kingdomId }: { kingdomId: string }) =>
        kingdomId === K1.kingdomId ? { ...K1 } : { ...K2 }
    );
    kingdoms.listKingdoms.mockResolvedValue([]);
  });

  it("reads Day 1 evidence under the supplied openId without creating a mission", async () => {
    day1.getDay1TenDoorsMissionReadOnly.mockResolvedValue({ outcomes: {} });
    binding.colosseumKingdomBindingSatisfied.mockReturnValue(false);

    await deriveKingdomStatuses({
      tenantId: "tenant-1",
      operatorId: "openid-abc",
    });

    expect(day1.getDay1TenDoorsMissionReadOnly).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      driverId: "openid-abc",
    });
    expect(kingdoms.setKingdomStatus).not.toHaveBeenCalled();
  });

  it("unlocks Kingdom Two when the real Day 1 evidence satisfies the binding", async () => {
    day1.getDay1TenDoorsMissionReadOnly.mockResolvedValue({
      outcomes: { target: "pitched" },
    });
    binding.colosseumKingdomBindingSatisfied.mockReturnValue(true);

    await deriveKingdomStatuses({
      tenantId: "tenant-1",
      operatorId: "openid-abc",
    });

    expect(kingdoms.setKingdomStatus).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      kingdomId: "kingdom-1-colosseum",
      lanternCityStatus: "complete",
    });
    expect(kingdoms.setKingdomStatus).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      kingdomId: "kingdom-2-the-last-valet",
      lanternCityStatus: "active",
    });
  });

  it("does not mutate Kingdom state when no Day 1 mission exists", async () => {
    day1.getDay1TenDoorsMissionReadOnly.mockResolvedValue(null);

    await deriveKingdomStatuses({
      tenantId: "tenant-1",
      operatorId: "openid-abc",
    });

    expect(binding.colosseumKingdomBindingSatisfied).not.toHaveBeenCalled();
    expect(kingdoms.setKingdomStatus).not.toHaveBeenCalled();
  });

  it("fails closed when the Day 1 evidence lookup fails", async () => {
    day1.getDay1TenDoorsMissionReadOnly.mockRejectedValue(
      new Error("database unavailable")
    );

    await expect(
      deriveKingdomStatuses({
        tenantId: "tenant-1",
        operatorId: "openid-abc",
      })
    ).resolves.toEqual([]);

    expect(kingdoms.setKingdomStatus).not.toHaveBeenCalled();
  });
});

describe("Kingdom identity and read-side-effect contract", () => {
  it("uses openId in the router and never imports the Day 1 get-or-create writer", async () => {
    const fs = await import("node:fs");
    const routerSource = fs.readFileSync(
      new URL("./kingdomRouter.ts", import.meta.url),
      "utf8"
    );
    const unlockSource = fs.readFileSync(
      new URL("./kingdomUnlocks.ts", import.meta.url),
      "utf8"
    );

    expect(routerSource).toContain("operatorId: ctx.user.openId");
    expect(routerSource).not.toContain("dayDirectorActorId");
    expect(unlockSource).toContain("getDay1TenDoorsMissionReadOnly");
    expect(unlockSource).not.toContain("getOrCreateDay1TenDoorsMission");
  });
});
