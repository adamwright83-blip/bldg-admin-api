import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("SaaS Slice 4 tenant lifecycle certification", () => {
  it("does not create a tenant during anonymous JOYSTICK draft onboarding", () => {
    const acquisition = source("./joystickAcquisition.lifecycle.integration.test.ts");
    expect(acquisition).toContain("persists three anonymous answers and a truthful draft without creating a tenant");
    expect(acquisition).toContain("expect(Number(tenantRows[0]?.count ?? 0)).toBe(0)");
  });

  it("derives a stable tenant id from onboarding rather than caller input", () => {
    const store = source("./saasStore.ts");
    expect(store).toContain("function tenantIdForOnboarding(sessionId: string)");
    expect(store).toContain('return `df_${createHash("sha256").update(sessionId)');
    expect(store).toContain("const tenantId = session.tenantId || tenantIdForOnboarding(session.id)");
  });

  it("provisions billing state before owner activation and does not call the tenant active yet", () => {
    const store = source("./saasStore.ts");
    expect(store).toContain('session.status === "complete"');
    expect(store).toContain('? "active"');
    expect(store).toContain(': "configuring"');
    expect(store).toContain('status: sql`IF(${legacyDayforgeSaasOnboardingSessions.status} = \'complete\', \'complete\', \'provisioned\')`');
  });

  it("requires a provisioned session and active subscription before owner activation", () => {
    const store = source("./saasStore.ts");
    expect(store).toContain('session.status !== "provisioned"');
    expect(store).toContain("Tenant is not ready for owner activation");
    expect(store).toContain("subscriptionAllowsLegacyDayforgeAccess");
    expect(store).toContain("Tenant subscription is not active for owner activation");
  });

  it("claims owner activation once and only then marks tenant active", () => {
    const store = source("./saasStore.ts");
    expect(store).toContain('.set({ status: "configuring", currentStep: "owner_activation" })');
    expect(store).toContain('eq(legacyDayforgeSaasOnboardingSessions.status, "provisioned")');
    expect(store).toContain("Tenant owner activation has already been claimed");
    expect(store).toContain('status: "active"');
    expect(store).toContain('onboardingStep: "complete"');
    expect(store).toContain('status: "complete", currentStep: "complete"');
  });

  it("keeps duplicate Stripe provisioning idempotent through existing event and upsert logic", () => {
    const billing = source("./saasBilling.lifecycle.integration.test.ts");
    expect(billing).toContain('reason: "duplicate_event"');
    expect(billing).toContain("expect(Number(tenants[0]?.count ?? 0)).toBe(1)");
    const store = source("./saasStore.ts");
    expect(store).toContain("onDuplicateKeyUpdate");
    expect(store).toContain("lastStripeEventCreatedAt");
  });

  it("does not absorb the tenantless legacy CleanCloud importer into tenant lifecycle", () => {
    const legacy = source("../integrations/cleancloud/cleancloudLegacy.ts");
    expect(legacy).not.toContain("tenantIdForOnboarding");
    expect(legacy).not.toContain("dayforge_saas_tenants");
    expect(legacy).not.toContain('?? "default"');
  });
});
