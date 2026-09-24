/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const access = vi.hoisted(() => ({ resolveMembership: vi.fn() }));
const mocks = vi.hoisted(() => ({
  readMission: vi.fn(),
  isCompanionEarned: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("../saas/tenantAccess", () => ({
  resolveDayforgeMembership: access.resolveMembership,
  hasDayforgeEntitlement: vi.fn(),
  roleAllows: (actual: string, allowed: readonly string[]) => allowed.includes(actual),
}));
vi.mock("../openChannel/day1TenDoorsService", () => ({
  getDay1TenDoorsMissionReadOnly: mocks.readMission,
}));
vi.mock("../companions/companionService", () => ({
  isCompanionEarned: mocks.isCompanionEarned,
}));
vi.mock("../db", () => ({ getDb: mocks.getDb }));

import { progressionRouter } from "./progressionRouter";

function context(tenantId: string, userId: number): TrpcContext {
  return {
    req: { headers: {} } as never,
    res: undefined as never,
    vendorSession: null,
    tenantId,
    user: {
      id: userId,
      tenantId,
      openId: `open-${userId}`,
      name: "Operator",
      email: "operator@example.test",
      loginMethod: "test",
      role: "operator",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
  };
}

describe("goldlineProgression router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    access.resolveMembership.mockResolvedValue({
      tenantId: "tenant-a",
      userOpenId: "open-7",
      role: "operator",
    });
    mocks.getDb.mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [] }),
        }),
      }),
    });
    mocks.isCompanionEarned.mockResolvedValue(true);
    mocks.readMission.mockResolvedValue({ outcomes: {} });
  });

  it("exposes a read and the authored-finale acknowledgement, and takes the operator from the session", async () => {
    expect(Object.keys(progressionRouter._def.procedures)).toEqual([
      "get",
      "acknowledgeColosseumFinale",
    ]);
    const caller = progressionRouter.createCaller(context("tenant-a", 7));
    const read = await caller.get({});
    expect(read.tenantId).toBe("tenant-a");
    expect(read.operatorId).toBe("open-7");
    expect(read.companionRookOwned.value).toBe(false);
    expect(read.kingdomBrassRepublicCompleted.value).toBe(false);
    expect(mocks.readMission).toHaveBeenCalledWith({ tenantId: "tenant-a", driverId: "open-7" });
    expect(mocks.isCompanionEarned).not.toHaveBeenCalled();
    expect(read.capabilityRookContact).toMatchObject({
      granted: false,
      readable: true,
      status: "ungranted",
    });
  });

  it("does not treat a companion unlock as capability.rook.contact", async () => {
    mocks.isCompanionEarned.mockResolvedValue(true);
    const caller = progressionRouter.createCaller(context("tenant-a", 7));
    const read = await caller.get({});
    expect(read.operatorId).toBe("open-7");
    expect(mocks.isCompanionEarned).not.toHaveBeenCalled();
    expect(read.capabilityRookContact).toMatchObject({
      granted: false,
      readable: true,
      status: "ungranted",
    });
  });

  it("rejects a client payload that tries to forge resolution, Rook, or kingdom completion", async () => {
    const caller = progressionRouter.createCaller(context("tenant-a", 7));
    await expect(caller.get({ resolved: true } as never)).rejects.toThrow();
    await expect(caller.get({ rookOwned: true } as never)).rejects.toThrow();
    await expect(caller.get({ kingdomComplete: true } as never)).rejects.toThrow();
    expect(mocks.readMission).not.toHaveBeenCalled();
  });

  it("rejects rookOwned and any consequence other than the authored finale", async () => {
    const caller = progressionRouter.createCaller(context("tenant-a", 7));
    await expect(caller.acknowledgeColosseumFinale({ rookOwned: true } as never)).rejects.toThrow();
    await expect(
      caller.acknowledgeColosseumFinale({ authoredConsequence: "rookOwned" } as never)
    ).rejects.toThrow();
    await expect(caller.acknowledgeColosseumFinale({} as never)).rejects.toThrow();
    await expect(
      caller.acknowledgeColosseumFinale({
        authoredConsequence: "clockhead_finale.rook_joined_the_party",
        tenantId: "tenant-b",
        operatorId: "open-8",
      } as never)
    ).rejects.toThrow();
    expect(mocks.readMission).not.toHaveBeenCalled();
  });
});
