import { describe, expect, it } from "vitest";
import {
  assertOrderResidentAuthority,
  assertOrderTenantAuthority,
  assertOrderVendorAuthority,
  canonicalOrderTenantId,
} from "./orderOwnership";

describe("order ownership authority", () => {
  it("normalizes only persisted blank legacy tenants to default", () => {
    expect(canonicalOrderTenantId(null)).toBe("default");
    expect(canonicalOrderTenantId("  ")).toBe("default");
    expect(canonicalOrderTenantId("tenant-a")).toBe("tenant-a");
  });

  it("rejects a default-tenant actor against another tenant instead of treating default as wildcard", () => {
    expect(() =>
      assertOrderTenantAuthority({
        order: { tenantId: "tenant-b" },
        tenantId: "default",
      })
    ).toThrow("Order does not belong to tenant");
  });

  it("allows an explicitly authorized cross-tenant platform path", () => {
    expect(
      assertOrderTenantAuthority({
        order: { tenantId: "tenant-b" },
        tenantId: "default",
        allowCrossTenant: true,
      })
    ).toBe("default");
  });

  it("preserves path-specific vendor policy rather than inventing a global unassigned rule", () => {
    expect(() =>
      assertOrderVendorAuthority({
        order: { vendorId: null },
        vendorId: 7,
        allowUnassigned: false,
      })
    ).toThrow("Order is not assigned to vendor");

    expect(() =>
      assertOrderVendorAuthority({
        order: { vendorId: null },
        vendorId: 7,
        allowUnassigned: true,
      })
    ).not.toThrow();
  });

  it("requires exact resident ownership and never phone or email identity", () => {
    expect(
      assertOrderResidentAuthority({
        order: { bldgUserId: 41 },
        residentId: 41,
      })
    ).toBe(41);
    expect(() =>
      assertOrderResidentAuthority({
        order: { bldgUserId: 41 },
        residentId: 42,
      })
    ).toThrow("Order does not belong to resident");
  });
});
