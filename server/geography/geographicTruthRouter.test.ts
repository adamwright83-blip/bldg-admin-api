import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), membership: vi.fn(), report: vi.fn() }));
vi.mock("./geographicTruthService", () => ({
  getGeographicTruth: mocks.read,
  geocodePendingLocations: vi.fn(),
}));
vi.mock("./lanternTerritoryReportService", () => ({
  readLanternTerritoryReport: mocks.report,
}));
vi.mock("../saas/tenantAccess", async importOriginal => ({
  ...(await importOriginal<any>()),
  resolveLegacyDayforgeMembership: mocks.membership,
  hasLegacyDayforgeEntitlement: async () => true,
}));
import { geographicTruthRouter } from "./geographicTruthRouter";
function caller(
  tenantId: string,
  openId: string,
  role: "admin" | "user" = "admin"
) {
  return geographicTruthRouter.createCaller({
    req: {} as never,
    res: {} as never,
    user: { openId, role } as never,
    vendorSession: null,
    tenantId,
  });
}
beforeEach(() => {
  mocks.report.mockReset().mockImplementation(async ({ tenantId, windowDays }) => ({
    tenantId,
    windowDays,
    figuresAreLive: true,
    status: "ready",
  }));
  mocks.read
    .mockReset()
    .mockImplementation(async ({ tenantId }) => ({
      tenantId,
      customers: [{ identityKey: tenantId + ":customer" }],
    }));
  mocks.membership
    .mockReset()
    .mockImplementation(async ({ tenantId, userOpenId }) =>
      userOpenId === "member:" + tenantId ||
      (userOpenId === "admin-owner" && tenantId === "default")
        ? { tenantId, role: "owner" }
        : null
    );
});
describe("tenant atlas and platform support separation", () => {
  it("legacy/admin UI login reads its own world without platform authority", async () => {
    await expect(
      caller("default", "admin-owner").myAtlas()
    ).resolves.toMatchObject({ tenantId: "default" });
    expect(mocks.read).toHaveBeenCalledWith({ tenantId: "default" });
    await expect(
      caller("default", "admin-owner").atlas({ targetTenantId: "other" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("tenant member reads only its own authenticated context", async () => {
    await expect(
      caller("tenant-a", "member:tenant-a", "user").myAtlas()
    ).resolves.toMatchObject({
      customers: [{ identityKey: "tenant-a:customer" }],
    });
    await expect(
      caller("tenant-b", "member:tenant-a", "user").myAtlas()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller("tenant-a", "member:tenant-a", "user").atlas({
        targetTenantId: "tenant-b",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
  it("true platform admin retains the explicit support atlas", async () => {
    await expect(
      caller("default", "oauth-platform-admin").atlas({
        targetTenantId: "tenant-b",
      })
    ).resolves.toMatchObject({ tenantId: "tenant-b" });
  });
  it("territory report reads only the authenticated tenant and cannot target another", async () => {
    await expect(
      caller("tenant-a", "member:tenant-a", "user").territoryReport({ windowDays: 90 })
    ).resolves.toMatchObject({ tenantId: "tenant-a", windowDays: 90 });
    expect(mocks.report).toHaveBeenCalledWith({ tenantId: "tenant-a", windowDays: 90 });
    await expect(
      caller("tenant-b", "member:tenant-a", "user").territoryReport({ windowDays: 30 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.report).toHaveBeenCalledTimes(1);
  });
  it("propagates geographic read failure instead of returning an empty atlas", async () => {
    mocks.read.mockRejectedValue(new Error("geography unavailable"));
    await expect(caller("default", "admin-owner").myAtlas()).rejects.toThrow(
      "geography unavailable"
    );
  });
});
