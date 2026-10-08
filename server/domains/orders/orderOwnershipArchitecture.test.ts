import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("order ownership architecture", () => {
  it("does not restore the default-tenant wildcard in canonical order transitions", () => {
    const lifecycle = source("./orderLifecycleService.ts");
    expect(lifecycle).toContain("assertOrderTenantAuthority");
    expect(lifecycle).not.toContain('requestedTenant !== "default"');
  });

  it("keeps ownership decisions outside Claire and inside native order/admin surfaces", () => {
    const routers = source("../../routers.ts");
    const cancel = source("../../agents/tools/cancelResidentOrderTool.ts");
    const status = source("../../agents/tools/updateOrderStatusTool.ts");

    expect(routers).toContain("assertPlatformOrVendorOrderAuthority");
    expect(routers).toContain("allowCrossTenant: isPlatformAdministrator(ctx.user)");
    expect(routers).toContain("tenantId: isPlatformAdministrator(ctx.user)");
    expect(cancel).toContain("assertOrderResidentAuthority");
    expect(status).toContain("assertOrderTenantAuthority");
  });

  it("tenant-scopes phone-based building attribution instead of treating phone as authority", () => {
    const db = source("../../db.ts");
    expect(db).toContain("updateOrderBuildingSlugForCustomer(input");
    expect(db).toContain("tenantId?: string");
    expect(db).toContain("COALESCE(NULLIF(TRIM(${orders.tenantId}), ''), 'default')");
  });
});
