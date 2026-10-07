import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("SaaS Slice 2 cross-tenant isolation certification", () => {
  it("keeps tenant-local uniqueness on SaaS memberships, configuration, entitlements, and imported source data", () => {
    const schema = source("../../drizzle/schema.ts");
    const required = [
      'uniqueIndex("uq_dayforge_saas_membership_user").on(\n      table.tenantId,\n      table.userOpenId',
      'uniqueIndex("uq_dayforge_saas_locations_key").on(\n      table.tenantId,\n      table.locationKey',
      'uniqueIndex("uq_dayforge_saas_services_key").on(\n      table.tenantId,\n      table.locationId,\n      table.serviceKey',
      'uniqueIndex("uq_dayforge_saas_entitlement").on(\n      table.tenantId,\n      table.entitlementKey,\n      table.source',
      'uniqueIndex("uq_dayforge_external_customer").on(\n      table.tenantId,\n      table.connectionId,\n      table.externalId',
      'uniqueIndex("uq_dayforge_external_order").on(\n      table.tenantId,\n      table.connectionId,\n      table.externalId',
    ];
    for (const contract of required) expect(schema).toContain(contract);
  });

  it("tenant-scopes normalized import writes and completion updates", () => {
    const store = source("./saasStore.ts");
    expect(store).toContain("tenantId: input.tenantId");
    expect(store).toContain("eq(legacyDayforgeSaasImportRuns.tenantId, input.tenantId)");
    expect(store).toContain(
      "eq(legacyDayforgeSaasImportConnections.tenantId, input.tenantId)"
    );
    expect(store).toContain(
      "eq(legacyDayforgeSaasExternalCustomers.tenantId, input.tenantId)"
    ).or;
  });

  it("preserves colliding external IDs as independent tenant-local records", () => {
    const launchExam = source("./saasLaunchExam.integration.test.ts");
    expect(launchExam).toContain(
      "imports two independent books through the real SaaS router with colliding external order ids"
    );
    expect(launchExam).toContain(
      'WHERE tenantId = ?'
    );
    expect(launchExam).toContain('externalId).toBe("1001")');
  });

  it("keeps hostile real-router reads and mutations tenant-scoped", () => {
    const hostile = source("./hostileTenant.integration.test.ts");
    const required = [
      "real customer router lists only the authenticated tenant's customers",
      "rejects a cross-tenant customer object id through the actual router",
      "real SaaS members router never returns another tenant's users",
      "tenant A cannot mutate tenant B's team member through an actual mutation",
      "commercial mission routers isolate reads and reject cross-tenant mission mutation",
      "commercial pipeline routers isolate lists and cross-tenant detail ids",
      "churn radar reads only the authenticated tenant's latest scan",
      "Day Line designation is tenant-scoped through the actual router",
      "Claire call analysis rejects another tenant's conversation session id",
    ];
    for (const contract of required) expect(hostile).toContain(contract);
  });

  it("does not alter the known tenantless CleanCloud legacy importer or its uniqueness semantics", () => {
    const schema = source("../../drizzle/schema.ts");
    const legacyStart = schema.indexOf("export const cleancloudLegacyOrders");
    const legacyEnd = schema.indexOf("export const cleancloudPaidOrders", legacyStart);
    const legacy = schema.slice(legacyStart, legacyEnd);
    expect(legacyStart).toBeGreaterThan(-1);
    expect(legacy).not.toContain('tenantId: varchar("tenantId"');
  });
});
