import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("vendor Payment read authority", () => {
  it("does not reconstruct vendor gross or payout history from mutable order fields", () => {
    const routers = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
    const vendorStart = routers.indexOf("vendor: router({");
    const customerStart = routers.indexOf("/* ===== CUSTOMER-FACING ORDERS", vendorStart);
    const vendor = routers.slice(vendorStart, customerStart);
    expect(vendor).toContain("readNativePaymentFacts(orders)");
    expect(vendor).toContain("capturedAmountCents");
    expect(vendor).toContain("paymentDataStatus");
    expect(vendor).not.toContain("parseFloat(String(o.total))");
    expect(vendor).not.toContain("o.updatedAt");
    expect(vendor).not.toContain("return getVendorPayouts");

    const db = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
    expect(db).not.toContain("export async function getVendorPayouts");

    const ui = readFileSync(new URL("../client/src/pages/VendorPortal.tsx", import.meta.url), "utf8");
    expect(ui).toContain("paymentFact.capturedAmountCents");
    expect(ui).toContain('? "Unknown"');
    expect(ui).not.toContain("const gross = o.total");
    expect(ui).not.toContain("const date = o.updatedAt");
  });
});
