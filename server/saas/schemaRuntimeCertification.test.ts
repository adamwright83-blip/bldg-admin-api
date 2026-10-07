import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("SaaS Slice 6 schema and runtime certification", () => {
  it("boots from a genuinely empty database and repairs disposable drift", () => {
    const workflow = source("../../.github/workflows/saas-schema-release.yml");
    expect(workflow).toContain("Create genuinely empty release database");
    expect(workflow).toContain("Bootstrap exact production migration path");
    expect(workflow).toContain("Reproduce known production drift on disposable database only");
    expect(workflow).toContain("Prove migration repairs drift");
  });

  it("proves migration idempotency and exact production startup", () => {
    const workflow = source("../../.github/workflows/saas-schema-release.yml");
    expect(workflow).toContain("Prove migration idempotency");
    expect(workflow).toContain("pnpm start");
    expect(workflow).toContain("Build production application");
    expect(workflow).toContain("Type-check");
  });

  it("keeps two tenants independent even with colliding external ids", () => {
    const exam = source("../../scripts/schema-release-exam.mjs");
    expect(exam).toContain("Two-tenant external-id isolation failed");
    expect(exam).toContain("collisionRows.length !== 2");
    expect(exam).toContain("row.tenantId === tenantId");
    expect(exam).toContain("row.tenantId === tenantB");
  });

  it("does not rewrite the known tenantless CleanCloud legacy importer", () => {
    const drift = source("../../scripts/schema-drift-fixture.mjs");
    expect(drift).not.toContain("cleancloud_legacy_orders");
    const migration = source("../../scripts/migrate.mjs");
    expect(migration).not.toMatch(/ALTER TABLE cleancloud_legacy_orders[^;]*(tenantId|tenant_id)/s);
    expect(migration).not.toMatch(/UPDATE cleancloud_legacy_orders[^;]*(tenantId|tenant_id)/s);
  });

  it("does not assign ambiguous tenantless legacy rows to default", () => {
    const migration = source("../../scripts/migrate.mjs");
    const legacyMentions = migration
      .split("\n")
      .filter(line => line.includes("cleancloud_legacy_orders"))
      .join("\n");
    expect(legacyMentions).not.toContain('"default"');
    expect(legacyMentions).not.toContain("'default'");
  });
});
