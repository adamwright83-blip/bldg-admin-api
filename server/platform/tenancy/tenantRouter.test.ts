import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { tenantRouter, resolveAccessibleTenantIdsForUser } from "./tenantRouter";
import { JOYSTICK_ACTIVE_TENANT_COOKIE, createContext } from "../../_core/context";
import { systemRouter } from "../../_core/systemRouter";
import { sdk } from "../../_core/sdk";

vi.mock("../../_core/sdk", () => ({
  sdk: {
    authenticateRequest: vi.fn(),
    authenticateSessionToken: vi.fn(),
  },
}));

vi.mock("../../saas/tenantAccess", async importOriginal => {
  const actual = await importOriginal<typeof import("../../saas/tenantAccess")>();
  return {
    ...actual,
    listActiveTenantMemberships: vi.fn(async (userOpenId: string) => {
      if (userOpenId === "adam-admin") {
        return [
          { tenantId: "default", userOpenId: "adam-admin", role: "owner" as const },
          { tenantId: "laundry_farm", userOpenId: "adam-admin", role: "owner" as const },
        ];
      }
      if (userOpenId === "multi-tenant-operator") {
        return [
          { tenantId: "default", userOpenId: "multi-tenant-operator", role: "admin" as const },
          { tenantId: "tenant-beta", userOpenId: "multi-tenant-operator", role: "admin" as const },
        ];
      }
      if (userOpenId === "regular-member") {
        return [
          { tenantId: "default", userOpenId: "regular-member", role: "field" as const },
        ];
      }
      return [];
    }),
  };
});

describe("tenantRouter", () => {
  describe("resolveAccessibleTenantIdsForUser", () => {
    it("authorizes adam-admin for both default (Laundry Butler) and laundry_farm", async () => {
      const accessible = await resolveAccessibleTenantIdsForUser({
        openId: "adam-admin",
        role: "admin",
      });
      expect(accessible.has("default")).toBe(true);
      expect(accessible.has("laundry_farm")).toBe(true);
      expect(accessible.get("default")).toBe("owner");
      expect(accessible.get("laundry_farm")).toBe("owner");
    });

    it("restricts single-tenant member to only their membership tenant", async () => {
      const accessible = await resolveAccessibleTenantIdsForUser({
        openId: "regular-member",
        role: "user",
      });
      expect(accessible.has("default")).toBe(true);
      expect(accessible.has("laundry_farm")).toBe(false);
      expect(accessible.has("other-tenant")).toBe(false);
    });

    it("authorizes multi-tenant operator for their memberships", async () => {
      const accessible = await resolveAccessibleTenantIdsForUser({
        openId: "multi-tenant-operator",
        role: "user",
      });
      expect(accessible.has("default")).toBe(true);
      expect(accessible.has("tenant-beta")).toBe(true);
      expect(accessible.has("laundry_farm")).toBe(false);
    });
  });

  describe("getActiveTenant", () => {
    it("returns Laundry Butler brand details for default tenant", async () => {
      const caller = tenantRouter.createCaller({
        req: {} as any,
        res: {} as any,
        user: { openId: "adam-admin", role: "admin" } as any,
        vendorSession: null,
        tenantId: "default",
      });

      const active = await caller.getActiveTenant();
      expect(active.id).toBe("default");
      expect(active.businessName).toBe("Laundry Butler");
      expect(active.brandName).toBe("Laundry Butler");
      expect(active.primaryColor).toBe("#2563EB");
    });

    it("returns Laundry Farm brand details for laundry_farm tenant", async () => {
      const caller = tenantRouter.createCaller({
        req: {} as any,
        res: {} as any,
        user: { openId: "adam-admin", role: "admin" } as any,
        vendorSession: null,
        tenantId: "laundry_farm",
      });

      const active = await caller.getActiveTenant();
      expect(active.id).toBe("laundry_farm");
      expect(active.businessName).toBe("Laundry Farm");
      expect(active.brandName).toBe("Laundry Farm");
      expect(active.primaryColor).toBe("#1B4D3E");
    });
  });

  describe("listAccessibleTenants", () => {
    it("lists both Laundry Butler and Laundry Farm with current indicator for adam-admin", async () => {
      const caller = tenantRouter.createCaller({
        req: {} as any,
        res: {} as any,
        user: { openId: "adam-admin", role: "admin" } as any,
        vendorSession: null,
        tenantId: "laundry_farm",
      });

      const list = await caller.listAccessibleTenants();
      expect(list.length).toBeGreaterThanOrEqual(2);
      const butler = list.find(t => t.id === "default");
      const farm = list.find(t => t.id === "laundry_farm");

      expect(butler).toBeDefined();
      expect(farm).toBeDefined();
      expect(butler?.isCurrent).toBe(false);
      expect(farm?.isCurrent).toBe(true);
      expect(farm?.businessName).toBe("Laundry Farm");
    });
  });

  describe("switchActiveTenant", () => {
    it("allows authorized switch to laundry_farm and sets cookie", async () => {
      const mockCookie = vi.fn();
      const caller = tenantRouter.createCaller({
        req: { hostname: "admin.bldg.chat", protocol: "https", headers: {} } as any,
        res: { cookie: mockCookie } as any,
        user: { openId: "adam-admin", role: "admin" } as any,
        vendorSession: null,
        tenantId: "default",
      });

      const result = await caller.switchActiveTenant({ tenantId: "laundry_farm" });
      expect(result).toEqual({ success: true, activeTenantId: "laundry_farm" });
      expect(mockCookie).toHaveBeenCalledWith(
        JOYSTICK_ACTIVE_TENANT_COOKIE,
        "laundry_farm",
        expect.objectContaining({
          httpOnly: true,
          path: "/",
        })
      );
    });

    it("forbids switching to unauthorized tenant", async () => {
      const caller = tenantRouter.createCaller({
        req: {} as any,
        res: { cookie: vi.fn() } as any,
        user: { openId: "regular-member", role: "user" } as any,
        vendorSession: null,
        tenantId: "default",
      });

      await expect(
        caller.switchActiveTenant({ tenantId: "laundry_farm" })
      ).rejects.toThrow(TRPCError);
    });
  });

  describe("Fail-closed server context and spoofing prevention", () => {
    it("switches context tenant when authenticated user is authorized for requested tenant via header", async () => {
      vi.mocked(sdk.authenticateRequest).mockResolvedValue({
        id: 1,
        openId: "adam-admin",
        role: "admin",
      } as any);

      const ctx = await createContext({
        req: {
          headers: {
            host: "admin.bldg.chat",
            "x-tenant-id": "laundry_farm",
          },
          protocol: "https",
        } as any,
        res: {} as any,
      });

      expect(ctx.tenantId).toBe("laundry_farm");
    });

    it("switches context tenant when authenticated user is authorized for requested tenant via cookie", async () => {
      vi.mocked(sdk.authenticateRequest).mockResolvedValue({
        id: 1,
        openId: "adam-admin",
        role: "admin",
      } as any);

      const ctx = await createContext({
        req: {
          headers: {
            host: "admin.bldg.chat",
            cookie: `${JOYSTICK_ACTIVE_TENANT_COOKIE}=laundry_farm`,
          },
          protocol: "https",
        } as any,
        res: {} as any,
      });

      expect(ctx.tenantId).toBe("laundry_farm");
    });

    it("fails closed and ignores unauthorized tenant header spoofing", async () => {
      vi.mocked(sdk.authenticateRequest).mockResolvedValue({
        id: 2,
        openId: "regular-member",
        role: "user",
        tenantId: "default",
      } as any);

      const ctx = await createContext({
        req: {
          headers: {
            host: "admin.bldg.chat",
            "x-tenant-id": "malicious_spoofed_tenant",
          },
          protocol: "https",
        } as any,
        res: {} as any,
      });

      expect(ctx.tenantId).toBe("default");
      expect(ctx.tenantId).not.toBe("malicious_spoofed_tenant");
    });

    it("fails closed and ignores unauthorized tenant cookie spoofing", async () => {
      vi.mocked(sdk.authenticateRequest).mockResolvedValue({
        id: 2,
        openId: "regular-member",
        role: "user",
        tenantId: "default",
      } as any);

      const ctx = await createContext({
        req: {
          headers: {
            host: "admin.bldg.chat",
            cookie: `${JOYSTICK_ACTIVE_TENANT_COOKIE}=unauthorized_tenant`,
          },
          protocol: "https",
        } as any,
        res: {} as any,
      });

      expect(ctx.tenantId).toBe("default");
      expect(ctx.tenantId).not.toBe("unauthorized_tenant");
    });

    it("rejects protected procedure execution when tenantId is __unauthorized_tenant__", async () => {
      const caller = systemRouter.createCaller({
        req: {} as any,
        res: {} as any,
        user: { id: 2, openId: "regular-member", role: "user" } as any,
        vendorSession: null,
        tenantId: "__unauthorized_tenant__",
      });

      await expect(caller.tenant.getActiveTenant()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });
});
