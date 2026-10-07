import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("SaaS Slice 7 privacy and connected-channel certification", () => {
  it("scopes tenant export and deletion by authoritative tenant id", () => {
    const lifecycle = source("./tenantLifecycle.ts");
    expect(lifecycle).toContain("WHERE ${safeIdentifier(binding.tenantColumn)} = ?");
    expect(lifecycle).toContain("DELETE FROM ${safeIdentifier(binding.tableName)}");
    expect(lifecycle).toContain("Tenant deletion confirmation must exactly match tenant id");
    expect(lifecycle).toContain("Tenant deletion plan changed");
  });

  it("redacts persisted credential material from tenant exports", () => {
    const lifecycle = source("./tenantLifecycle.ts");
    for (const field of [
      "passwordHash",
      "tokenHash",
      "credentialReference",
      "portalJwt",
      "encryptedRefreshToken",
      "encryptedAccessToken",
    ]) {
      expect(lifecycle).toContain(field);
    }
    expect(lifecycle).toContain('"[REDACTED]"');
  });

  it("keeps import connection and completion state tenant-bound", () => {
    const store = source("./saasStore.ts");
    expect(store).toContain("legacyDayforgeSaasImportConnections.tenantId");
    expect(store).toContain("legacyDayforgeSaasImportRuns.tenantId");
    expect(store).toContain("eq(legacyDayforgeSaasImportConnections.tenantId, input.tenantId)");
    expect(store).toContain("eq(legacyDayforgeSaasImportRuns.tenantId, input.tenantId)");
  });

  it("keeps SaaS Stripe customer selection tenant-bound", () => {
    const store = source("./saasStore.ts");
    expect(store).toContain("getStripeCustomerForTenant");
    expect(store).toContain("eq(legacyDayforgeSaasSubscriptions.tenantId, tenantId)");
  });

  it("retains transcript privacy in the tenant-boundary release gate without editing Claire", () => {
    const workflow = source("../../.github/workflows/saas-tenant-boundary.yml");
    expect(workflow).toContain("server/claire/conversation/transcriptLog.test.ts");
  });

  it("does not tenant-bind, deduplicate, or default the known legacy CleanCloud importer", () => {
    const legacy = source("../cleancloudLegacy.ts");
    expect(legacy).not.toContain("tenantId");
    expect(legacy).not.toContain('?? "default"');
    expect(legacy).not.toContain("onDuplicateKeyUpdate");
  });
});
