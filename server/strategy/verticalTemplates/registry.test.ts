import { describe, expect, it } from "vitest";
import { ServerVerticalRegistry } from "./registry";
import type { VerticalTemplate } from "./types";

const fixture: VerticalTemplate = {
  verticalKey: "fixture",
  displayName: "Fixture",
  metricCatalog: [{ metricKey: "paid_orders", authoritativeReaderId: "fixture.paid_orders.v1" }],
  opportunityKinds: ["lead"],
  campaignSeeds: [],
  obligationKinds: ["follow_up"],
  outcomeDefinitions: [{ outcomeDefinitionId: "purchase", authoritativeTransitionId: "fixture.purchase.v1" }],
  workFamilies: ["outreach"],
  executionIntelligenceDoctrineFamilies: ["sales"],
  expectedSourceCapabilities: ["orders"],
  presentationDefaults: {},
};

describe("ServerVerticalRegistry", () => {
  it("fails closed on unknown templates, metrics, readers, outcomes and obligations", async () => {
    const registry = new ServerVerticalRegistry();
    registry.registerTemplate(fixture);
    expect(() => registry.get("missing")).toThrow(/Unknown vertical template/);
    expect(() => registry.resolveMetric("fixture", "missing")).toThrow(/Unknown metric key/);
    expect(() => registry.resolveMetric("fixture", "paid_orders")).toThrow(/Unknown authoritative reader/);
    expect(() => registry.assertOutcomeDefinition("fixture", "missing")).toThrow(/Unknown outcome definition/);
    expect(() => registry.assertObligationKind("fixture", "missing")).toThrow(/Unknown obligation kind/);

    registry.registerMetricReader("fixture.paid_orders.v1", async ({ tenantId }) => ({ tenantId, value: 1 }));
    const resolved = registry.resolveMetric("fixture", "paid_orders");
    await expect(resolved.reader({ tenantId: "tenant-a" })).resolves.toEqual({ tenantId: "tenant-a", value: 1 });
  });
});
