import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dbSource = fs.readFileSync(path.join(root, "server/db.ts"), "utf8");
const routerSource = fs.readFileSync(
  path.join(root, "server/routers.ts"),
  "utf8"
);
const schemaSource = fs.readFileSync(
  path.join(root, "drizzle/schema.ts"),
  "utf8"
);
const uiSource = fs.readFileSync(
  path.join(root, "client/src/pages/Admin.tsx"),
  "utf8"
);

function outsideRouterBlock() {
  return routerSource.slice(
    routerSource.indexOf("recordOutsidePayment: protectedProcedure"),
    routerSource.indexOf("chargeCard: protectedProcedure")
  );
}

describe("outside payment contract", () => {
  it("records Zelle without calling Stripe", () => {
    expect(outsideRouterBlock()).toContain('customerMethod: z.enum(["zelle"');
    expect(outsideRouterBlock()).not.toMatch(
      /getStripe|paymentIntents|notifyCardCharged|transfer_data/
    );
  });

  it("accepts and persists cash, check, and other", () => {
    expect(outsideRouterBlock()).toContain('"zelle", "cash", "check", "other"');
    expect(dbSource).toContain("method: input.customerMethod");
  });

  it("keeps customer and vendor payment records separate", () => {
    expect(schemaSource).toContain('mysqlTable("customer_payments"');
    expect(schemaSource).toContain('mysqlTable("vendor_payments"');
    expect(dbSource).toContain("tx.insert(customerPayments)");
    expect(dbSource).toContain("tx.insert(vendorPayments)");
  });

  it("prevents retry and multi-tab duplicates", () => {
    expect(dbSource).toContain('.for("update")');
    expect(schemaSource).toContain('uniqueIndex("uq_customer_payments_order")');
  });

  it("rejects an already-paid order", () => {
    expect(dbSource).toContain("if (order.paid) throw new Error");
  });

  it("leaves no Stripe PaymentIntent truth on an outside payment", () => {
    expect(dbSource).toContain("stripePaymentIntentId: null");
    expect(outsideRouterBlock()).not.toContain("paymentIntentId");
  });

  it("does not send card-charge SMS", () => {
    expect(outsideRouterBlock()).not.toMatch(/notifyCardCharged|sendSMS/);
  });

  it("writes customer revenue once", () => {
    expect(outsideRouterBlock().match(/writeOrderToSheet/g)).toHaveLength(1);
  });

  it("does not count vendor payment as customer revenue", () => {
    expect(outsideRouterBlock()).toContain("input.customerAmountCents");
    expect(outsideRouterBlock()).not.toMatch(/writeOrderToSheet\([^)]*vendor/);
  });

  it("preserves the existing card path and requires explicit confirmation in UI", () => {
    expect(routerSource).toContain("chargeCard: protectedProcedure");
    expect(routerSource).toContain("stripe.paymentIntents.create");
    expect(uiSource).toContain(
      "I confirm these payment details are accurate and no card should be charged."
    );
    expect(uiSource).toContain("Confirm and Mark Paid");
  });
});
