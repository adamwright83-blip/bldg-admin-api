import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../drizzle/0040_customer_churn_recovery.sql", import.meta.url),
  "utf8"
);
const service = readFileSync(
  new URL("./customerChurnService.ts", import.meta.url),
  "utf8"
);
const router = readFileSync(
  new URL("./churnRadarRouter.ts", import.meta.url),
  "utf8"
);
const client = readFileSync(
  new URL("../../client/src/pages/ChurnRadarPage.tsx", import.meta.url),
  "utf8"
);

describe("Churn Radar production contract", () => {
  it("persists scans, evidence, recovery missions, drafts, permission, and events", () => {
    for (const table of [
      "tenant_customer_recovery_profiles",
      "customer_churn_scans",
      "customer_churn_snapshots",
      "customer_contact_permissions",
      "customer_recovery_interventions",
      "customer_recovery_drafts",
      "customer_recovery_events",
    ])
      expect(migration).toContain(`CREATE TABLE \`${table}\``);
    expect(migration).toContain(
      "uq_customer_recovery_events_tenant_idempotency"
    );
    expect(migration).toContain(
      "uq_customer_recovery_interventions_tenant_active_customer"
    );
  });

  it("scores tenant order history and labels unavailable evidence", () => {
    expect(service).toContain(".from(orders)");
    expect(service).toContain(
      "COALESCE(${orders.tenantId}, 'default') = ${input.tenantId}"
    );
    expect(service).toContain("evidenceForScore");
    expect(service).toContain(
      "No structured unresolved-issue source is configured"
    );
    expect(service).toContain("activeOrderCount");
  });

  it("creates an existing stale-customer ops mission rather than a detached alert", () => {
    expect(service).toContain('taskType: "stale_customer"');
    expect(service).toContain(
      "activeCustomerKeyHash: snapshot.customerKeyHash"
    );
    expect(service).toContain("dayforgeRecoveryInterventionId");
    expect(service).toContain("opsTaskEvents");
    expect(service).toContain('eventName: "recovery_mission_created"');
  });

  it("requires exact-message approval and current recorded consent", () => {
    expect(router).toContain("I reviewed this exact message");
    expect(router).toContain("I manually sent this exact approved message");
    expect(service).toContain(
      "Recorded, current SMS win-back consent is required"
    );
    expect(service).toContain("readManualContactReadyWith");
    expect(service).toContain('.for("update")');
    expect(service).toContain("affectedRows(transition) !== 1");
    expect(service).toContain("validated 10-digit US customer phone number");
    expect(service).toContain('eventName: "manual_sms_composer_opened"');
    expect(service).toContain("outreachSent: false");
    expect(service).not.toContain("sendSMS(");
    expect(service).toContain("assertGroundedWinBackMessage(input.message)");
    expect(client).toContain(
      "DayForge opens your SMS composer. It never auto-sends"
    );
  });

  it("attributes only a later paid order as recovered revenue", () => {
    expect(service).toContain("refreshCustomerRecoveryAttribution");
    expect(service).toContain("eq(orders.paid, true)");
    expect(service).toContain('eventName: "revenue_recovered"');
    expect(service).toContain("recoveredRevenueCents");
  });

  it("derives every tenant and actor from the admin session", () => {
    expect(router).toContain("adminProcedure");
    expect(router).toContain("tenantId: ctx.tenantId");
    expect(router).toContain("actorId: ctx.user.openId");
    expect(router).not.toContain("actorId: input.actorId");
    expect(client).not.toContain("localStorage");
  });
});
