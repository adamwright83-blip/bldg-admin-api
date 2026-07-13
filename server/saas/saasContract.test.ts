import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { roleAllows } from "./tenantAccess";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("DayForge SaaS production contract", () => {
  it("binds authenticated context to the persisted user tenant", () => {
    const context = source("../_core/context.ts");
    expect(context).toContain("user?.tenantId?.trim()");
    expect(context).toContain('user?.openId.startsWith("dayforge:")');
    expect(context).toContain('"__invalid_saas_session__"');
  });

  it("requires membership and entitlement procedures on every DayForge domain", () => {
    const files = [
      ["../territory/territoryRouter.ts", "dayforgeTerritoryProcedure"],
      [
        "../commercialMissions/commercialMissionRouter.ts",
        "dayforgeMissionFieldProcedure",
      ],
      [
        "../commercialProposals/commercialProposalRouter.ts",
        "dayforgeProposalFieldProcedure",
      ],
      [
        "../commercialPipeline/commercialPipelineRouter.ts",
        "dayforgePipelineProcedure",
      ],
      ["../churnRadar/churnRadarRouter.ts", "dayforgeChurnProcedure"],
    ] as const;
    for (const [path, procedure] of files) {
      const router = source(path);
      expect(router).toContain(procedure);
      expect(router).not.toMatch(/\badminProcedure\b/);
      expect(router).not.toMatch(/\bprotectedProcedure\b/);
    }
  });

  it("keeps Stripe subscription billing namespaced from laundry payments", () => {
    const billing = source("./saasBilling.ts");
    expect(billing).toContain("DAYFORGE_BILLING_STRIPE_SECRET_KEY");
    expect(billing).toContain("DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET");
    expect(billing).not.toContain("STRIPE_SECRET_KEY_OVERRIDE");
    expect(billing).toContain("getStripeCustomerForTenant(input.tenantId)");
    expect(billing).not.toMatch(/customerId:\s*input\./);
    expect(billing).not.toMatch(/price(Id)?:\s*input\./);
    expect(source("./saasStore.ts")).toContain(
      "lastStripeEventCreatedAt} <= ${input.eventCreatedAt}"
    );
  });

  it("registers the raw Stripe webhook before the global JSON parser", () => {
    const index = source("../_core/index.ts");
    expect(
      index.indexOf("registerDayforgeBillingWebhookRoute(app)")
    ).toBeLessThan(index.indexOf('app.use(express.json({ limit: "50mb" }))'));
  });

  it("migrates resumable onboarding, ordered webhooks, scoped audit, and tenant-safe imports", () => {
    const migration = readFileSync(
      new URL(
        "../../drizzle/0042_dayforge_saas_onboarding_billing.sql",
        import.meta.url
      ),
      "utf8"
    );
    expect(migration).toContain("`version` int NOT NULL DEFAULT 1");
    expect(migration).toContain(
      "`lastStripeEventCreatedAt` timestamp NOT NULL"
    );
    expect(migration).toContain("UNIQUE (`scopeKey`,`idempotencyKey`)");
    expect(migration).toContain(
      "UNIQUE (`tenantId`,`cleancloudOrderId`,`sourceReportType`)"
    );
    expect(migration).toContain("CREATE TABLE `dayforge_saas_tenant_invites`");
    expect(migration).toContain(
      "CREATE TABLE `dayforge_saas_checkout_sessions`"
    );
    expect(source("./saasStore.ts")).toContain("claimedSubscriptions} + 1");
  });

  it("enforces the tenant role matrix", () => {
    expect(roleAllows("owner", ["owner", "admin"])).toBe(true);
    expect(roleAllows("operator", ["owner", "admin"])).toBe(false);
    expect(roleAllows("field", ["owner", "admin", "operator", "field"])).toBe(
      true
    );
  });

  it("does not grant SaaS members the platform admin or driver role", () => {
    const store = source("./saasStore.ts");
    const auth = source("./saasAuthRoute.ts");
    expect(store).toContain('role: "user"');
    expect(auth).toContain('role: "user"');
    expect(auth).not.toMatch(/role:\s*platformRole/);
  });
});
