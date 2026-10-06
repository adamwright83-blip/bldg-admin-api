import { describe, expect, it } from "vitest";
import type { PaidOrderEvent } from "../analytics/paidOrderLedger";
import {
  buildAuthoritativeChurnHistory,
  isActiveChurnOrder,
  type ChurnDropoffEvidence,
  type ChurnNativeOrder,
  type ChurnPaymentProjection,
} from "./authoritativeHistory";

const baseCreatedAt = new Date("2026-08-01T20:00:00.000Z");
const orders: ChurnNativeOrder[] = [
  {
    id: 1,
    status: "delivered",
    serviceType: "wash_fold",
    heldMetadataJson: null,
    residentClientRequestId: null,
    createdAt: baseCreatedAt,
  },
  {
    id: 2,
    status: "ready",
    serviceType: "wash_fold",
    heldMetadataJson: null,
    residentClientRequestId: null,
    createdAt: baseCreatedAt,
  },
  {
    id: 3,
    status: "cancelled",
    serviceType: "dry_cleaning",
    heldMetadataJson: null,
    residentClientRequestId: null,
    createdAt: baseCreatedAt,
  },
];

function dropoff(
  orderId: number,
  overrides: Partial<ChurnDropoffEvidence> = {}
): ChurnDropoffEvidence {
  return {
    id: orderId * 10,
    orderId,
    sourceEventType: "dropoff_completed",
    eventStatus: "completed",
    actualEventTimestamp: new Date(`2026-09-0${orderId}T18:00:00.000Z`),
    updatedAt: new Date(`2026-09-0${orderId}T18:01:00.000Z`),
    weightLbs: "12.50",
    ...overrides,
  };
}

function projection(
  orderId: number,
  state: ChurnPaymentProjection["state"] = "paid",
  netPaidCents: number | null = 4321
): ChurnPaymentProjection {
  return { orderId, state, netPaidCents };
}

function paid(orderId: number, cents: number): PaidOrderEvent {
  return {
    source: "laundry_butler",
    eventKey: `order:${orderId}`,
    occurredAt: new Date("2026-09-01T20:00:00.000Z"),
    businessDate: "2026-09-01",
    cents,
    serviceType: "wash_fold",
    customerName: "Customer",
    identity: { phone: "3105550100" },
    authorityReceiptId: `receipt-${orderId}`,
  };
}

describe("authoritative churn history", () => {
  it("does not treat delivered or paid flags as service-completion evidence", () => {
    const history = buildAuthoritativeChurnHistory({
      orders,
      dropoffEvents: [],
      paidEvents: [paid(1, 6500)],
      paymentProjections: [],
    });
    expect(history).toEqual([]);
  });


  it("accepts only the explicit historical cadence-import contract as non-live service evidence", () => {
    const imported: ChurnNativeOrder = {
      id: 4,
      status: "delivered",
      serviceType: "wash_fold",
      residentClientRequestId: "goldline:cadence:cc-44:2026-07-10",
      heldMetadataJson: {
        cleancloudCustomerId: "cc-44",
        importSource: "goldline_customer_order_history",
        cadenceEvidenceOnly: true,
      },
      createdAt: new Date("2026-07-10T20:00:00.000Z"),
    };
    const history = buildAuthoritativeChurnHistory({
      orders: [...orders, imported],
      dropoffEvents: [],
      paidEvents: [],
      paymentProjections: [],
    });
    expect(history).toMatchObject([
      {
        orderId: 4,
        valueCents: null,
        serviceEvidenceKind: "historical_cadence_import",
        serviceEvidenceRef: "orders:4:goldline_customer_order_history",
      },
    ]);
  });

  it("rejects a lookalike delivered row that lacks the explicit cadence-import provenance", () => {
    const lookalike: ChurnNativeOrder = {
      id: 5,
      status: "delivered",
      serviceType: "wash_fold",
      residentClientRequestId: "goldline:cadence:cc-55:2026-07-11",
      heldMetadataJson: { cadenceEvidenceOnly: true },
      createdAt: new Date("2026-07-11T20:00:00.000Z"),
    };
    const history = buildAuthoritativeChurnHistory({
      orders: [lookalike],
      dropoffEvents: [],
      paidEvents: [],
      paymentProjections: [],
    });
    expect(history).toEqual([]);
  });

  it("keeps delivered-but-unpaid service history while leaving value unavailable", () => {
    const history = buildAuthoritativeChurnHistory({
      orders,
      dropoffEvents: [dropoff(1)],
      paidEvents: [],
      paymentProjections: [],
    });
    expect(history).toMatchObject([
      {
        orderId: 1,
        valueCents: null,
        serviceEvidenceKind: "dropoff_event",
        serviceEvidenceRef: "operations_events:10",
        paymentAuthorityReceiptId: null,
      },
    ]);
  });

  it("does not let paid-but-not-delivered work become completed history", () => {
    const history = buildAuthoritativeChurnHistory({
      orders,
      dropoffEvents: [],
      paidEvents: [paid(2, 7200)],
      paymentProjections: [projection(2, "paid", 7200)],
    });
    expect(history).toHaveLength(0);
    expect(isActiveChurnOrder(orders[1]!)).toBe(true);
  });

  it("uses the admitted payment plus canonical net projection, never gross/order total", () => {
    const history = buildAuthoritativeChurnHistory({
      orders,
      dropoffEvents: [dropoff(1)],
      paidEvents: [paid(1, 9000)],
      paymentProjections: [projection(1, "paid", 4321)],
    });
    expect(history[0]).toMatchObject({
      orderId: 1,
      valueCents: 4321,
      paymentAuthorityReceiptId: "receipt-1",
    });
  });

  it("uses remaining net value for a partially refunded payment", () => {
    const history = buildAuthoritativeChurnHistory({
      orders,
      dropoffEvents: [dropoff(1)],
      paidEvents: [paid(1, 9000)],
      paymentProjections: [projection(1, "partially_refunded", 6100)],
    });
    expect(history[0]?.valueCents).toBe(6100);
  });

  it("records zero realized value for reversed payments even with stale positive net", () => {
    for (const state of ["refunded", "cancelled"] as const) {
      const history = buildAuthoritativeChurnHistory({
        orders,
        dropoffEvents: [dropoff(1)],
        paidEvents: [paid(1, 9000)],
        paymentProjections: [projection(1, state, 7777)],
      });
      expect(history[0]?.valueCents).toBe(0);
      expect(history[0]?.paymentAuthorityReceiptId).toBe("receipt-1");
    }
  });

  it("records zero realized value when the order itself was cancelled after completed service", () => {
    const history = buildAuthoritativeChurnHistory({
      orders,
      dropoffEvents: [dropoff(3)],
      paidEvents: [paid(3, 5000)],
      paymentProjections: [projection(3, "paid", 5000)],
    });
    expect(history[0]?.valueCents).toBe(0);
    expect(history[0]?.paymentAuthorityReceiptId).toBe("receipt-3");
  });

  it("withholds monetary value for review-required or missing net projections", () => {
    for (const paymentProjections of [
      [projection(1, "review_required", null)],
      [],
    ]) {
      const history = buildAuthoritativeChurnHistory({
        orders,
        dropoffEvents: [dropoff(1)],
        paidEvents: [paid(1, 9000)],
        paymentProjections,
      });
      expect(history[0]?.valueCents).toBeNull();
      expect(history[0]?.paymentAuthorityReceiptId).toBeNull();
    }
  });

  it("lets the latest voided evidence invalidate an earlier completion", () => {
    const history = buildAuthoritativeChurnHistory({
      orders,
      dropoffEvents: [
        dropoff(1),
        dropoff(1, {
          id: 11,
          eventStatus: "voided",
          updatedAt: new Date("2026-09-02T18:01:00.000Z"),
        }),
        dropoff(3, { eventStatus: "corrected" }),
      ],
      paidEvents: [],
      paymentProjections: [],
    });
    expect(history.map(item => item.orderId)).toEqual([3]);
  });

  it("does not erase a completed service merely because the order was later cancelled", () => {
    const history = buildAuthoritativeChurnHistory({
      orders,
      dropoffEvents: [dropoff(3)],
      paidEvents: [],
      paymentProjections: [],
    });
    expect(history.map(item => item.orderId)).toEqual([3]);
    expect(isActiveChurnOrder(orders[2]!)).toBe(false);
  });

  it("prefers the latest corrected evidence for the same order", () => {
    const corrected = dropoff(1, {
      id: 99,
      eventStatus: "corrected",
      actualEventTimestamp: new Date("2026-09-02T20:00:00.000Z"),
      updatedAt: new Date("2026-09-03T20:00:00.000Z"),
      weightLbs: "15.00",
    });
    const history = buildAuthoritativeChurnHistory({
      orders,
      dropoffEvents: [dropoff(1), corrected],
      paidEvents: [],
      paymentProjections: [],
    });
    expect(history[0]).toMatchObject({
      serviceEvidenceRef: "operations_events:99",
      weightLbs: 15,
    });
    expect(new Date(history[0]!.serviceAt).toISOString()).toBe(
      "2026-09-02T20:00:00.000Z"
    );
  });
});
