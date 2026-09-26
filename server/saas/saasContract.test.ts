/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
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
      ["../territory/territoryRouter.ts", "legacyDayforgeTerritoryProcedure"],
      [
        "../commercialMissions/commercialMissionRouter.ts",
        "legacyDayforgeMissionFieldProcedure",
      ],
      [
        "../commercialProposals/commercialProposalRouter.ts",
        "legacyDayforgeProposalFieldProcedure",
      ],
      [
        "../commercialPipeline/commercialPipelineRouter.ts",
        "legacyDayforgePipelineProcedure",
      ],
      ["../churnRadar/churnRadarRouter.ts", "legacyDayforgeChurnProcedure"],
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
      index.indexOf("registerLegacyDayforgeBillingWebhookRoute(app)")
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

  it("keeps required SaaS schema on the production boot path", () => {
    const migration = source("../../scripts/migrate.mjs");
    expect(migration).toContain("0042_dayforge_saas_onboarding_billing.sql");
    expect(migration).toContain("0058_impact_signals.sql");
    expect(migration).toContain('"debriefMissionId"');
    expect(migration).toContain("ensureRequiredColumn");
    expect(migration).toContain("ensureRequiredIndex");

    const workflow = source("../../.github/workflows/saas-schema-release.yml");
    expect(workflow).toContain("node scripts/schema-drift-fixture.mjs");
    expect(workflow).toContain("pnpm saas:schema:release-exam");
    expect(workflow).toContain("pnpm start");
  });

  it("keeps the customer product quarantined from legacy operations", () => {
    const shell = source("../../client/src/product/ProductShell.tsx");
    const app = source("../../client/src/App.tsx");
    const strategy = source("../strategy/strategyRouter.ts");
    const transcriptLog = source("../claire/conversation/transcriptLog.ts");
    const claireTwilio = source("../claire/claireTwilio.ts");

    expect(shell).not.toContain("Legacy operations");
    expect(shell).not.toContain('href="/admin"');
    expect(app).toContain("isSaasCustomerPath");
    expect(app).toContain('<Redirect to="/product" />');
    expect(strategy).toContain("legacyDayforgeTenantOperatorProcedure");
    expect(strategy).not.toContain("adminProcedure");
    expect(transcriptLog).not.toContain("text: redactClaireTranscriptText(turn.text)");
    expect(transcriptLog).toContain("textLength: turn.text.length");
    expect(transcriptLog).toContain("claire_post_call_transcript_metadata");
    expect(claireTwilio).not.toContain("Hey Adam. What's up?");
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