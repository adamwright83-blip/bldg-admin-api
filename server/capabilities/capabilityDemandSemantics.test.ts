import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("capability demand semantics", () => {
  it("does not label mutable order quotes as revenue or invent default tenant authority", () => {
    const source = readFileSync(new URL("./capabilityEvaluationService.ts", import.meta.url), "utf8");
    expect(source).toContain("trailingDemandQuotedCents");
    expect(source).toContain("quoted demand");
    expect(source).toContain("eq(orders.tenantId, input.tenantId)");
    expect(source).not.toContain("trailingDemandRevenueCents");
    expect(source).not.toContain("COALESCE(${orders.tenantId}, 'default')");
  });
});
