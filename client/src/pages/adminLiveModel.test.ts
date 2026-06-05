import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Order } from "@shared/types";
import {
  groupLikelyDuplicateLiveOrders,
  liveDateLabel,
  liveOrderSource,
  nextLiveActionLabel,
  nextLiveStatus,
  pickOneThingRightNow,
  syncSelectedOrder,
} from "./adminLiveModel";

function order(overrides: Partial<Order> = {}): Order {
  const now = new Date("2026-05-15T04:00:00.000Z");
  return {
    id: 1,
    tenantId: "default",
    serviceType: "wash_fold",
    pickupDate: "2026-05-15",
    pickupTimeWindow: "7:00am-9:00am",
    deliveryDate: "2026-05-16",
    deliveryTimeWindow: "7:00pm-9:00pm",
    address: "3545 Wilshire Blvd",
    unit: "1201",
    specialInstructions: null,
    heldRawRequestText: null,
    heldCleanedRequestText: null,
    heldServiceSummary: null,
    heldRequestedPickupWindow: null,
    heldRequestedReturnBy: null,
    heldSource: null,
    heldMetadataJson: null,
    firstName: "Adam",
    lastName: "Carlin",
    phone: "3235550101",
    email: "adam@example.com",
    bldgUserId: null,
    stripeCustomerId: "cus_123",
    stripePaymentMethodId: "pm_123",
    stripePaymentIntentId: null,
    status: "new",
    weightLbs: null,
    bagCount: 1,
    garmentCount: null,
    subtotal: "0",
    discountPercent: "0",
    total: "29.16",
    upchargesJson: null,
    drycleanItemsJson: null,
    paid: false,
    paidAt: null,
    isFirstPaidOrder: false,
    portalJwt: null,
    buildingSlug: "opusla",
    vendorId: null,
    vendorNameSnapshot: null,
    routingPrioritySnapshot: null,
    platformFeeCents: null,
    vendorPayoutCents: null,
    stripeConnectedAccountIdSnapshot: null,
    manualRiskFlag: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("admin live model", () => {
  it("maps repo statuses to the legal next live action", () => {
    expect(nextLiveStatus(order({ status: "new" }))).toBeNull();
    expect(nextLiveActionLabel(order({ status: "new" }))).toBe("Dispatch Driver");
    expect(nextLiveStatus(order({ status: "collected" }))).toBe("processing");
    expect(nextLiveActionLabel(order({ status: "collected" }))).toBe("Process");
    expect(nextLiveStatus(order({ status: "processing" }))).toBe("ready");
    expect(nextLiveActionLabel(order({ status: "processing" }))).toBe("Ready");
    expect(nextLiveStatus(order({ status: "ready" }))).toBe("delivered");
    expect(nextLiveActionLabel(order({ status: "ready" }))).toBe("Deliver");
    expect(nextLiveStatus(order({ status: "delivered" }))).toBeNull();
  });

  it("keeps selected order in sync with refreshed live rows", () => {
    expect(syncSelectedOrder(2, [order({ id: 1 }), order({ id: 2, status: "processing" })])).toMatchObject({
      id: 2,
      status: "processing",
    });
    expect(syncSelectedOrder(2, [order({ id: 1 })])).toBeNull();
    expect(syncSelectedOrder(null, [order({ id: 1 })])).toBeNull();
  });

  it("keeps compact live cards focused on the order dates operators need first", () => {
    expect(liveDateLabel("2026-05-15")).toBe("2026-05-15");
    expect(liveDateLabel(null)).toBe("not set");
    expect(liveDateLabel(undefined)).toBe("not set");
  });

  it("groups likely duplicate live order rows while preserving every real order id", () => {
    const groups = groupLikelyDuplicateLiveOrders([
      order({ id: 1248, firstName: "Lila", lastName: "Barkhordarian", phone: "(323) 555-0000", pickupDate: "2026-06-04", deliveryDate: null, heldCleanedRequestText: "Pick up laundry Thursday." }),
      order({ id: 1247, firstName: "LILA", lastName: "BARKHORDARIAN", phone: "+1 323 555 0000", pickupDate: "2026-06-04", deliveryDate: null, heldCleanedRequestText: "Pick up laundry Thursday." }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].isLikelyDuplicate).toBe(true);
    expect(groups[0].representative.id).toBe(1248);
    expect(groups[0].orders.map((o) => o.id)).toEqual([1248, 1247]);
  });

  it("does not group the same customer when the pickup date differs", () => {
    const groups = groupLikelyDuplicateLiveOrders([
      order({ id: 1, firstName: "Lila", lastName: "Barkhordarian", phone: "3235550000", pickupDate: "2026-06-04" }),
      order({ id: 2, firstName: "Lila", lastName: "Barkhordarian", phone: "3235550000", pickupDate: "2026-06-05" }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.every((group) => !group.isLikelyDuplicate)).toBe(true);
  });

  it("labels HELD-sourced rows from order metadata", () => {
    expect(liveOrderSource(order({ heldSource: "resident_app" }))).toBe("HELD");
    expect(liveOrderSource(order({ status: "collected" }))).toBe("driver");
  });

  it("prioritizes one thing right now from real live order state", () => {
    const unpaidDelivered = order({ id: 5, status: "delivered", paid: false });
    const readyDue = order({ id: 4, status: "ready" });
    const newOrder = order({ id: 3, status: "new" });
    const stale = order({ id: 2, status: "processing" });
    const blocked = order({ id: 1, status: "delivered" });

    expect(pickOneThingRightNow({ unpaidDelivered: [unpaidDelivered], readyDueToday: [readyDue], newOrders: [newOrder], staleCollectedOrProcessing: [stale], blocked: [blocked] })?.id).toBe(5);
    expect(pickOneThingRightNow({ unpaidDelivered: [], readyDueToday: [readyDue], newOrders: [newOrder], staleCollectedOrProcessing: [stale], blocked: [blocked] })?.id).toBe(4);
    expect(pickOneThingRightNow({ unpaidDelivered: [], readyDueToday: [], newOrders: [newOrder], staleCollectedOrProcessing: [stale], blocked: [blocked] })?.id).toBe(3);
  });

  it("AdminLive uses the shared updateStatus path and invalidates live board data", () => {
    const source = readFileSync(new URL("./AdminLive.tsx", import.meta.url), "utf8");
    expect(source).toContain("trpc.admin.updateStatus.useMutation()");
    expect(source).not.toContain("operationsEvents");
    expect(source).not.toContain("insert(operationsEvents");
    expect(source).toContain('utils.admin.listByStatus.invalidate({ status: "new" })');
    expect(source).toContain('utils.admin.listByStatus.invalidate({ status: "delivered" })');
    expect(source).toContain("utils.admin.dashboardSummary.invalidate()");
    expect(source).toContain("onNavigate(`/intake?orderId=${order.id}`)");
    expect(source).toContain("Open order");
  });

  it("New Intake dispatch is separate from explicit pickup completion", () => {
    const modelSource = readFileSync(new URL("./adminLiveModel.ts", import.meta.url), "utf8");
    const liveSource = readFileSync(new URL("./AdminLive.tsx", import.meta.url), "utf8");
    expect(modelSource).toContain('{ title: "NEW INTAKE", status: "new", rail: "bg-emerald-600" }');
    expect(modelSource).not.toContain('status: "new", rail: "bg-emerald-600", next: "collected"');
    expect(liveSource).toContain("async function dispatchDriver(order: Order)");
    expect(liveSource).toContain("async function completePickup(order: Order)");
    expect(liveSource).toContain('toast.success(`#LB-${order.id} remains queued for driver pickup.`)');
    expect(liveSource).toContain('await moveOrder(order, "collected");');
    expect(liveSource).toContain("Dispatch Driver");
    expect(liveSource).toContain("Pickup Complete");
  });

  it("admin dispatch queue does not mark pickup orders collected before the driver app resolves them", () => {
    const source = readFileSync(new URL("./Admin.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("dispatchMutation");
    expect(source).not.toContain('status: "collected" });\n    queueQuery.refetch();');
    expect(source).toContain("Order is queued for the driver pickup app.");
    expect(source).toContain("pickupDate: localYmd()");
  });
});
