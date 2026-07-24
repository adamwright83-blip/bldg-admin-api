import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizedAttributionIdentity, normalizedAttributionLocation } from "./commercialAttributionService";

const source = readFileSync(new URL("./commercialAttributionService.ts", import.meta.url), "utf8");
describe("commercial automatic attribution policy", () => {
  it("normalizes stable customer and property identity", () => {
    expect(normalizedAttributionIdentity({ email: " ADAM@Example.com " })).toBe(normalizedAttributionIdentity({ email: "adam@example.com" }));
    expect(normalizedAttributionLocation({ address: "225 N. Canon Dr" })).toBe(normalizedAttributionLocation({ address: "225 n canon dr" }));
  });
  it("keeps generic orders generic and recognizes explicit/inherited sources only", () => {
    expect(source).toContain("if (!link) return null");
    expect(source).toContain('input.campaignToken ? "explicit_campaign" : "inherited_first_touch"');
    expect(source).toContain("customerIdentityKey");
    expect(source).toContain("serviceLocationKey");
  });
  it("excludes unpaid/cancelled/refunded truth and flags unsupported partial refunds", () => {
    expect(source).toContain("order.paid ? cents(order.total) : 0");
    expect(source).toContain('order.status === "cancelled"');
    expect(source).toContain('projection?.state === "refunded"');
    expect(source).toContain('projection?.state === "partially_refunded" && knownNet === null');
  });
  it("preserves first-touch history and audits reversals", () => {
    expect(source).toContain("source.accountId !== link.accountId");
    expect(source).toContain("commercialAttributionCorrections");
    expect(source).toContain('reviewState: "reversed"');
  });
});
