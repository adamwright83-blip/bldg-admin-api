import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("staff receipt payment truth", () => {
  it("uses admitted Payment facts rather than mutable order price/update time", () => {
    const source = readFileSync(
      new URL("./DigitalReceiptPage.tsx", import.meta.url),
      "utf8"
    );
    expect(source).toContain("order.paymentFact");
    expect(source).toContain("capturedAmountCents");
    expect(source).toContain("paymentFact.occurredAt");
    expect(source).not.toContain("order.paid && order.updatedAt");
    expect(source).not.toContain("<span>Payment</span>\n                <span>${total.toFixed(2)}</span>");
  });
});
