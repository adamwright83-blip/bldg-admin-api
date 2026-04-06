import { describe, expect, it } from "vitest";
import type { Order } from "../drizzle/schema";
import {
  issueForOrder,
  tacticalClusterItemsAfterApex,
  type IssueLabel,
  type ScoredInterventionCandidate,
} from "./revenueIntervention";

function minimalOrder(overrides: Partial<Order> & Pick<Order, "id" | "status" | "paid">): Order {
  return {
    tenantId: "default",
    serviceType: "wash_fold",
    pickupDate: "2026-01-01",
    pickupTimeWindow: "morning",
    address: "x",
    firstName: "A",
    lastName: "B",
    phone: "555",
    createdAt: new Date(),
    updatedAt: new Date(),
    manualRiskFlag: false,
    isFirstPaidOrder: false,
    portalJwt: null,
    deliveryDate: null,
    deliveryTimeWindow: null,
    unit: null,
    specialInstructions: null,
    email: null,
    bldgUserId: null,
    stripeCustomerId: null,
    stripePaymentMethodId: null,
    stripePaymentIntentId: null,
    weightLbs: null,
    bagCount: 1,
    garmentCount: null,
    subtotal: "10",
    discountPercent: "0",
    total: "10",
    upchargesJson: null,
    drycleanItemsJson: null,
    paidAt: null,
    buildingSlug: null,
    vendorId: null,
    vendorNameSnapshot: null,
    routingPrioritySnapshot: null,
    platformFeeCents: null,
    vendorPayoutCents: null,
    stripeConnectedAccountIdSnapshot: null,
    ...overrides,
  } as Order;
}

describe("issueForOrder", () => {
  const businessYmd = "2026-04-06";

  it("returns null for paid orders (excluded from awaiting-payment pipeline)", () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    const stale48 = new Date(now.getTime() - 48 * 3600 * 1000);
    const stale24 = new Date(now.getTime() - 24 * 3600 * 1000);
    const row = minimalOrder({
      id: 1,
      status: "ready",
      paid: true,
      updatedAt: new Date(now.getTime() - 30 * 3600 * 1000),
    });
    expect(issueForOrder(row, now, stale48, stale24, businessYmd)).toBeNull();
  });

  it("still scores unpaid ready orders that are stale vs 24h cutoff", () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    const stale48 = new Date(now.getTime() - 48 * 3600 * 1000);
    const stale24 = new Date(now.getTime() - 24 * 3600 * 1000);
    const row = minimalOrder({
      id: 2,
      status: "ready",
      paid: false,
      updatedAt: new Date(now.getTime() - 30 * 3600 * 1000),
    });
    const label = issueForOrder(row, now, stale48, stale24, businessYmd);
    expect(label).toBe("ready_unpaid_24h");
  });
});

describe("tacticalClusterItemsAfterApex", () => {
  function fakeCandidate(id: number, issue: IssueLabel): ScoredInterventionCandidate {
    const order = minimalOrder({
      id,
      status: "ready",
      paid: false,
      updatedAt: new Date("2020-01-01"),
    });
    return {
      order,
      issueLabel: issue,
      dollarValueCents: 1000,
      score: 100,
    };
  }

  it("never includes the apex (first) order id", () => {
    const filtered = [
      fakeCandidate(10, "ready_unpaid_24h"),
      fakeCandidate(20, "ready_unpaid_24h"),
      fakeCandidate(30, "ready_unpaid_24h"),
      fakeCandidate(40, "ready_unpaid_24h"),
    ];
    const l2 = tacticalClusterItemsAfterApex(filtered);
    expect(l2.map((c) => c.order.id)).toEqual([20, 30, 40]);
    expect(l2.some((c) => c.order.id === 10)).toBe(false);
  });

  it("returns at most three items after apex", () => {
    const filtered = Array.from({ length: 8 }, (_, i) =>
      fakeCandidate(100 + i, "ready_unpaid_24h")
    );
    expect(tacticalClusterItemsAfterApex(filtered)).toHaveLength(3);
  });
});
