import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..");
const read = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("Slice 4 production-safety invariants", () => {
  it("never registers marketplace step types in the existing procurement worker", () => {
    const workerSource = read("server/procurement/worker.ts");
    expect(workerSource).not.toMatch(/marketplace/i);
  });

  it("never starts a marketplace worker process from workerMain", () => {
    const workerMainSource = read("server/procurement/workerMain.ts");
    expect(workerMainSource).not.toMatch(/marketplace/i);
  });

  it("does not modify the legacy chargeCard / orders / Stripe destination-charge flow", () => {
    const routersSource = read("server/routers.ts");
    // Every laundry charge resolves a vendor, checks the connected account
    // live, and uses a destination charge. There must be no silent
    // platform-only fallback when routing is unavailable.
    expect(routersSource).toMatch(/await getVendorForOrder\(order\.buildingSlug, order\.serviceType\)/);
    expect(routersSource).toMatch(/stripe\.accounts\.retrieve\(\s*vendorAccountId\s*\)/);
    expect(routersSource).toMatch(/!connectedAccount\.charges_enabled\s*\|\|\s*!connectedAccount\.payouts_enabled/);
    expect(routersSource).toMatch(/transfer_data:\s*{\s*destination:\s*vendorAccountId!\s*}/);
    expect(routersSource).toMatch(/application_fee_amount:\s*platformFeeCents/);
    expect(routersSource).not.toContain("[ChargeCard] No payout routing applied");
  });

  it("does not alter the orders or vendors Drizzle schema", () => {
    const schemaSource = read("drizzle/schema.ts");
    expect(schemaSource).not.toMatch(/marketplace_payment/i);
  });

  it("getStripe() is reused unchanged, not redefined, by the marketplace policy/store layer", () => {
    const policySource = read("server/marketplacePayments/marketplacePaymentPolicy.ts");
    const storeSource = read("server/marketplacePayments/marketplacePaymentStore.ts");
    expect(policySource).not.toMatch(/getStripe|new Stripe\(/);
    expect(storeSource).not.toMatch(/getStripe|new Stripe\(/);
  });

  it("the store module contains no Stripe SDK calls of any kind", () => {
    const storeSource = read("server/marketplacePayments/marketplacePaymentStore.ts");
    expect(storeSource).not.toMatch(/stripe\.\w+\.(create|capture|retrieve)/);
  });
});
