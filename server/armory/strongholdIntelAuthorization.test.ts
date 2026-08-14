import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const access = vi.hoisted(() => ({
  resolveMembership: vi.fn(),
  hasEntitlement: vi.fn(),
  readIntel: vi.fn(),
}));

vi.mock("../saas/tenantAccess", () => ({
  resolveDayforgeMembership: access.resolveMembership,
  hasDayforgeEntitlement: access.hasEntitlement,
  roleAllows: (actual: string, allowed: readonly string[]) =>
    allowed.includes(actual),
}));

vi.mock("../salesIntel/driverSafeSalesIntelService", () => ({
  getDriverSafeSalesIntel: access.readIntel,
}));

import { armoryRouter } from "./armoryRouter";
import { salesIntelRouter } from "../salesIntel/salesIntelRouter";

function context(
  input: {
    openId?: string;
    tenantId?: string;
    authenticated?: boolean;
  } = {}
): TrpcContext {
  const tenantId = input.tenantId ?? "tenant-a";
  const openId = input.openId ?? "driver-a";
  return {
    req: undefined as never,
    res: undefined as never,
    vendorSession: null,
    tenantId,
    user:
      input.authenticated === false
        ? null
        : {
            id: 1,
            tenantId,
            openId,
            name: "Driver",
            email: "driver@example.test",
            loginMethod: "test",
            role: "driver",
            createdAt: new Date(),
            updatedAt: new Date(),
            lastSignedIn: new Date(),
          },
  };
}

describe("Stronghold driver-safe Sales Intel authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    access.resolveMembership.mockImplementation(
      async ({ tenantId, userOpenId }) =>
        tenantId === "tenant-a" && userOpenId === "driver-a"
          ? { tenantId, userOpenId, role: "field" }
          : null
    );
    access.hasEntitlement.mockImplementation(
      async ({ tenantId }) => tenantId === "tenant-a"
    );
    access.readIntel.mockResolvedValue({
      acceptedTeachingCount: 2,
      byCategory: [{ category: "discovery", count: 2 }],
    });
  });

  it("rejects an unauthenticated caller before reading Sales Intel", async () => {
    await expect(
      armoryRouter
        .createCaller(context({ authenticated: false }))
        .strongholdIntel()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(access.readIntel).not.toHaveBeenCalled();
  });

  it("allows an authenticated operator with current membership and field entitlement", async () => {
    await expect(
      armoryRouter.createCaller(context()).strongholdIntel()
    ).resolves.toEqual({
      acceptedTeachingCount: 2,
      byCategory: [{ category: "discovery", count: 2 }],
    });
    expect(access.resolveMembership).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      userOpenId: "driver-a",
      platformRole: "driver",
    });
    expect(access.readIntel).toHaveBeenCalledTimes(1);
  });

  it("fails closed for a foreign tenant or unrelated operator", async () => {
    await expect(
      armoryRouter
        .createCaller(context({ tenantId: "tenant-b" }))
        .strongholdIntel()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      armoryRouter
        .createCaller(context({ openId: "driver-b" }))
        .strongholdIntel()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(access.readIntel).not.toHaveBeenCalled();
  });

  it("fails closed when the current tenant lacks the field entitlement", async () => {
    access.hasEntitlement.mockResolvedValue(false);
    await expect(
      armoryRouter.createCaller(context()).strongholdIntel()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(access.readIntel).not.toHaveBeenCalled();
  });

  it("accepts no resource scope from the request", async () => {
    const result = await armoryRouter.createCaller(context()).strongholdIntel({
      tenantId: "tenant-b",
      intelId: "fabricated-intel-id",
      entityId: "fabricated-entity-id",
    } as never);
    expect(result.acceptedTeachingCount).toBe(2);
    expect(access.resolveMembership).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-a", userOpenId: "driver-a" })
    );
    expect(access.readIntel).toHaveBeenCalledWith();
  });

  it("does not let the same driver credential call the admin coverage endpoint", async () => {
    await expect(
      salesIntelRouter.createCaller(context()).teachings.coverage()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
