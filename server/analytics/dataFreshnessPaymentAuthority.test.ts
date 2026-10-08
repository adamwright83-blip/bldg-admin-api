import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("native data freshness payment truth", () => {
  it("uses exact tenant-scoped Payment facts and never mutable order dollars/time", () => {
    const source = readFileSync(new URL("./dataFreshness.ts", import.meta.url), "utf8");
    expect(source).toContain("readNativePaymentFacts(nativeCandidates)");
    expect(source).toContain("eq(orders.tenantId, input.tenantId)");
    expect(source).toContain("cents: native.fact.capturedAmountCents");
    expect(source).toContain("paidAt: native.fact.occurredAt");
    expect(source).not.toContain("COALESCE(" + "${orders.tenantId}" + ", 'default')");
    expect(source).not.toContain("cents: Math.round(Number(native.total");
    expect(source).not.toContain("paidAt: iso(native.paidAt)");
  });
});
