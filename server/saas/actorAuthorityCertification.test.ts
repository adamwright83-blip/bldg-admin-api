/* LEGACY DAYFORGE COMPATIBILITY: retained historical literals only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isLegacySharedPasswordOpenId,
  isPlatformAdministrator,
  tenantForAuthenticatedUser,
} from "../platform/tenancy/tenantIdentity";
import { roleAllows } from "./tenantAccess";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("SaaS Slice 3 role and actor authority certification", () => {
  it("keeps platform authority distinct from legacy shared-password and SaaS membership identity", () => {
    expect(
      isPlatformAdministrator({ openId: "oauth-platform-admin", role: "admin" })
    ).toBe(true);
    expect(
      isPlatformAdministrator({ openId: "admin-owner", role: "admin" })
    ).toBe(false);
    expect(isLegacySharedPasswordOpenId("admin-owner")).toBe(true);
    expect(
      isPlatformAdministrator({ openId: "goldline-demo:tenant-a", role: "admin" })
    ).toBe(false);
  });

  it("keeps tenant membership role policy explicit rather than generic RBAC", () => {
    expect(roleAllows("owner", ["owner", "admin"])).toBe(true);
    expect(roleAllows("admin", ["owner", "admin"])).toBe(true);
    expect(roleAllows("operator", ["owner", "admin"])).toBe(false);
    expect(roleAllows("field", ["owner", "admin", "operator", "field"])).toBe(true);
  });

  it("does not let caller-selected tenant broaden a SaaS member actor", () => {
    expect(
      tenantForAuthenticatedUser({
        user: {
          openId: "dayforge:member-a",
          role: "user",
          tenantId: "tenant-a",
        },
        hostTenantId: "default",
        requestedTenantId: "tenant-b",
      })
    ).toEqual({
      tenantId: "tenant-a",
      authority: "membership",
      denial: "cross_tenant",
    });
  });

  it("keeps driver and vendor authentication as separate actor gates", () => {
    const trpc = source("../_core/trpc.ts");
    expect(trpc).toContain("export const adminOrDriverProcedure");
    expect(trpc).toContain("const requireVendorSession");
    expect(trpc).toContain("export const vendorProcedure");
    expect(trpc).toContain("export const platformOrVendorProcedure");
    expect(trpc).not.toMatch(/const requireVendorSession[\s\S]{0,500}role === "driver"/);
  });

  it("preserves the established platform-vs-legacy authority contract", () => {
    const platformContract = source("../_core/platformAuthority.test.ts");
    expect(platformContract).toContain(
      "rejects the legacy shared admin from platform-only procedures"
    );
    expect(platformContract).toContain(
      "preserves the shared Admin's historical local Admin access"
    );
    expect(platformContract).toContain(
      "still permits a non-shared authenticated platform administrator"
    );
  });

  it("keeps SaaS users on tenant membership instead of platform admin or driver roles", () => {
    const store = source("./saasStore.ts");
    const auth = source("./saasAuthRoute.ts");
    expect(store).toContain('role: "user"');
    expect(auth).toContain('role: "user"');
    expect(auth).not.toMatch(/role:\s*platformRole/);
  });

  it("keeps lifecycle ownership rules below the SaaS actor layer rather than reinventing vendor or driver policy", () => {
    const ownership = source("../domains/orders/orderOwnership.ts");
    const driver = source("../domains/orders/driver/driverOrderService.ts");
    expect(ownership).toContain("assertOrderVendorAuthority");
    expect(driver).toContain("tenantId");
    expect(source("../_core/trpc.ts")).not.toContain("GlobalAuthorizationService");
    expect(source("../_core/trpc.ts")).not.toContain("BusinessOwnershipService");
  });
});
