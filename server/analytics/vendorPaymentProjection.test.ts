import { readFileSync } from "node:fs";
import { describe, expect, it, test } from "vitest";
import type { Order } from "../../drizzle/schema";
import type { NativePaymentFact } from "../domains/payment/nativePaymentReadService";
import {
  projectVendorPayments,
  sumKnownCents,
} from "./vendorPaymentProjection";

const order = {
  id: 41,
  tenantId: "tenant-a",
  vendorId: 7,
  stripeConnectedAccountIdSnapshot: "acct_vendor7",
  total: "150.00",
  paid: false,
  updatedAt: new Date("2026-10-08T12:00:00Z"),
  platformFeeCents: 420,
  vendorPayoutCents: 13500,
} as Order;

const fact: NativePaymentFact = {
  orderId: 41,
  tenantId: "tenant-a",
  paymentIntentId: "pi_41",
  authorityReceiptId: "auth-41",
  occurredAt: "2026-10-06T12:00:00Z",
  capturedAmountCents: 4200,
};

describe("vendor Payment projection", () => {
  it("uses immutable capture evidence instead of current order price or paid state", () => {
    const rows = projectVendorPayments(
      [order],
      new Map([[order.id, fact]]),
      "acct_vendor7"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      paymentOccurredAt: "2026-10-06T12:00:00Z",
      capturedAmountCents: 4200,
      platformFeeCents: 420,
      payoutCents: 3780,
      currentPaid: false,
    });
  });

  it("orders payout history by admitted payment occurrence", () => {
    const newerOrder = { ...order, id: 42, createdAt: new Date("2026-10-10T00:00:00Z") } as Order;
    const rows = projectVendorPayments(
      [newerOrder, order],
      new Map([
        [order.id, fact],
        [
          newerOrder.id,
          {
            ...fact,
            orderId: newerOrder.id,
            authorityReceiptId: "auth-42",
            paymentIntentId: "pi_42",
            occurredAt: "2026-10-05T12:00:00Z",
          },
        ],
      ])
    );
    expect(rows.map(row => row.order.id)).toEqual([41, 42]);
  });

  it("withholds vendor dollar fields when capture evidence is unknown", () => {
    const rows = projectVendorPayments(
      [order],
      new Map([[order.id, { ...fact, capturedAmountCents: null }]])
    );
    expect(rows[0]).toMatchObject({
      capturedAmountCents: null,
      platformFeeCents: null,
      payoutCents: null,
    });
    expect(sumKnownCents([4200, null])).toBeNull();
  });

  it("keeps vendor UI/router off mutable price and updatedAt payment truth", () => {
    const routerSource = readFileSync(new URL("../routers.ts", import.meta.url), "utf8");
    const clientSource = readFileSync(
      new URL("../../client/src/pages/VendorPortal.tsx", import.meta.url),
      "utf8"
    );
    const dashboard = routerSource.slice(
      routerSource.indexOf("dashboard: vendorProcedure"),
      routerSource.indexOf("listOrders: vendorProcedure")
    );
    const payouts = clientSource.slice(
      clientSource.indexOf("function VendorPayoutsTab"),
      clientSource.indexOf("function VendorSettingsTab")
    );
    expect(dashboard).toContain("loadVendorPaymentProjection");
    expect(dashboard).not.toContain("o.total");
    expect(dashboard).not.toContain("o.updatedAt");
    expect(payouts).toContain("capturedAmountCents");
    expect(payouts).toContain("paymentOccurredAt");
    expect(payouts).not.toContain("o.total");
    expect(payouts).not.toContain("o.updatedAt");
  });
});


test("withholds payout when reassignment does not establish the capture recipient", () => {
  expect(projectVendorPayments([order], new Map([[order.id, fact]]), "acct_other")[0]).toMatchObject({ capturedAmountCents: 4200, platformFeeCents: null, payoutCents: null });
});
