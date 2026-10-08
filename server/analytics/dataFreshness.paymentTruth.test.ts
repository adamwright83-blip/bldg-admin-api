import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { projectLatestNativeSale } from "./dataFreshness";
import type { NativePaymentFact } from "../authority/nativePaymentReadService";

const rows = [
  {
    id: 1,
    firstName: "Older",
    lastName: "Customer",
    createdAt: new Date("2026-10-01T08:00:00Z"),
  },
  {
    id: 2,
    firstName: "Latest",
    lastName: "Customer",
    createdAt: new Date("2026-10-02T08:00:00Z"),
  },
];

function fact(
  orderId: number,
  occurredAt: string,
  capturedAmountCents: number | null
): NativePaymentFact {
  return {
    orderId,
    tenantId: "tenant-a",
    paymentIntentId: `pi_${orderId}`,
    authorityReceiptId: `auth-${orderId}`,
    occurredAt,
    capturedAmountCents,
  };
}

describe("native data freshness Payment truth", () => {
  it("orders native sales by admitted Payment occurrence and preserves unknown dollars", () => {
    const facts = new Map<number, NativePaymentFact>([
      [1, fact(1, "2026-10-06T12:00:00Z", 4200)],
      [2, fact(2, "2026-10-07T12:00:00Z", null)],
    ]);
    expect(projectLatestNativeSale(rows, facts)).toMatchObject({
      orderNumber: "2",
      customerName: "Latest Customer",
      cents: null,
      paidAt: "2026-10-07T12:00:00Z",
      paymentType: "Stripe",
    });
  });

  it("does not fabricate a native sale when no admitted occurrence exists", () => {
    expect(projectLatestNativeSale(rows, new Map())).toBeNull();
  });

  it("does not reconstruct native payment truth from raw Orders fields", () => {
    const source = readFileSync(new URL("./dataFreshness.ts", import.meta.url), "utf8");
    expect(source).toContain("readNativeCustomerHistory");
    expect(source).toContain("readNativePaymentFacts");
    expect(source).not.toContain("orders.total");
    expect(source).not.toContain("orders.paidAt");
    expect(source).not.toMatch(/COALESCE\([^\n]*orders\.tenantId[^\n]*default/);
  });
});
