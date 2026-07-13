import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const churn = readFileSync(
  new URL("../churnRadar/customerChurnService.ts", import.meta.url),
  "utf8"
);
const saas = readFileSync(
  new URL("../saas/saasStore.ts", import.meta.url),
  "utf8"
);

describe("DayForge SaaS and Churn Radar event projection", () => {
  it.each([
    "churn_risk_detected",
    "win_back_prepared",
    "win_back_approved",
    "customer_returned",
    "recovered_revenue_realized",
  ])("projects %s from a persisted Churn Radar mutation", eventName => {
    expect(churn).toContain(`name: "${eventName}"`);
  });

  it("keeps outbound-delivery truth honest", () => {
    expect(churn).not.toContain('name: "win_back_sent"');
    expect(churn).toContain("No outreach sent.");
    expect(churn).toContain("paid_order_after_contact");
  });

  it("writes risk, preparation, approval, and recovery inside transactions", () => {
    expect(churn.match(/writeDayforgeEventWith\(tx/g)?.length).toBeGreaterThanOrEqual(5);
    expect(churn).toContain('actor: { type: "system", id: "dayforge-churn-radar" }');
    expect(churn).toContain('source: "churn_radar_attribution"');
  });

  it("projects signup start and completion without analytics PII", () => {
    expect(saas).toContain('name: "tenant_signup_started"');
    expect(saas).toContain('name: "tenant_signup_completed"');
    expect(saas.match(/writeDayforgeEventWith\(tx/g)).toHaveLength(2);
    expect(saas).toContain('sourcePlacement: "dayforge_onboarding"');

    const productBlocks = saas.match(/productEvent: \{[\s\S]*?\n\s+\},/g) ?? [];
    expect(productBlocks).toHaveLength(2);
    for (const block of productBlocks) {
      expect(block).not.toMatch(/ownerEmail|businessName|contact|phone|address/);
    }
  });
});
