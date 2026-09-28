import { describe, expect, it } from "vitest";
import { evidenceForScore } from "./customerChurnService";
import {
  describeCleanCloudChurnCustomer,
  groupCleanCloudChurnCustomers,
  partitionCleanCloudChurnOrders,
  provenCleanCloudServiceType,
  type CleanCloudChurnObservation,
  type CleanCloudChurnSourceRow,
} from "./cleanCloudChurnObservations";

function row(
  over: Partial<CleanCloudChurnSourceRow> &
    Pick<CleanCloudChurnSourceRow, "cleancloudOrderId" | "sourceReportType">
): CleanCloudChurnSourceRow {
  return {
    paid: true,
    customerPhone: null,
    customerEmail: null,
    cleancloudCustomerId: null,
    customerName: "Ada Lovelace",
    totalCents: 4200,
    totalWeightLbs: null,
    summaryText: null,
    paidDateUtc: null,
    paymentDateUtc: null,
    ...over,
  };
}

function observation(
  over: Partial<CleanCloudChurnObservation> &
    Pick<CleanCloudChurnObservation, "externalOrderId" | "customerName">
): CleanCloudChurnObservation {
  return {
    serviceAt: new Date("2026-01-15T00:00:00.000Z"),
    valueCents: 4200,
    weightLbs: null,
    serviceType: null,
    phone: null,
    email: null,
    cleancloudCustomerId: null,
    ...over,
  };
}

describe("CleanCloud churn observations", () => {
  it("keeps one observation per order and does not add sales to revenue", () => {
    const revenuePaid = new Date("2026-03-02T00:00:00.000Z");
    const salesPaid = new Date("2026-03-01T00:00:00.000Z");
    const observations = partitionCleanCloudChurnOrders([
      row({
        cleancloudOrderId: "9",
        sourceReportType: "orders_sales",
        paymentDateUtc: salesPaid,
        paidDateUtc: new Date("2026-02-01T00:00:00.000Z"),
        totalCents: 1000,
        customerPhone: "3105550100",
        summaryText: "Retail item",
      }),
      row({
        cleancloudOrderId: "9",
        sourceReportType: "orders_revenue",
        paidDateUtc: revenuePaid,
        totalCents: 2500,
        customerPhone: null,
        summaryText: "Wash & Fold",
        totalWeightLbs: "12.5",
      }),
      row({
        cleancloudOrderId: "10",
        sourceReportType: "orders_sales",
        paid: false,
        paymentDateUtc: salesPaid,
        totalCents: 9999,
      }),
    ]);

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      externalOrderId: "9",
      serviceAt: revenuePaid,
      valueCents: 2500,
      weightLbs: 12.5,
      serviceType: "wash_fold",
      phone: "3105550100",
    });
    expect(observations[0]?.valueCents).not.toBe(3500);
  });

  it("uses the sales payment date only when no revenue row exists", () => {
    const paymentDateUtc = new Date("2026-04-04T00:00:00.000Z");
    const paidDateUtc = new Date("2026-04-02T00:00:00.000Z");
    const [withPayment] = partitionCleanCloudChurnOrders([
      row({
        cleancloudOrderId: "sales-1",
        sourceReportType: "orders_sales",
        paymentDateUtc,
        paidDateUtc,
      }),
    ]);
    const [fallback] = partitionCleanCloudChurnOrders([
      row({
        cleancloudOrderId: "sales-2",
        sourceReportType: "orders_sales",
        paymentDateUtc: null,
        paidDateUtc,
      }),
    ]);
    expect(withPayment?.serviceAt).toEqual(paymentDateUtc);
    expect(fallback?.serviceAt).toEqual(paidDateUtc);
  });

  it("does not map unknown summary text to dry cleaning", () => {
    expect(provenCleanCloudServiceType("Retail item")).toBeNull();
    expect(provenCleanCloudServiceType("Dress Shirt (1) (D) x 2")).toBeNull();
    expect(provenCleanCloudServiceType(null)).toBeNull();
    expect(provenCleanCloudServiceType("Dry")).toBeNull();
    expect(provenCleanCloudServiceType("Wash & Fold")).toBe("wash_fold");
    expect(provenCleanCloudServiceType("Dry cleaning pressed shirts")).toBe(
      "dry_cleaning"
    );
  });

  it("does not merge two different names that share no phone, email, or CleanCloud id", () => {
    const groups = groupCleanCloudChurnCustomers("tenant-a", [
      observation({
        externalOrderId: "a1",
        customerName: "Sam Lee",
        serviceAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
      observation({
        externalOrderId: "a2",
        customerName: "Sam Lee",
        serviceAt: new Date("2026-02-01T00:00:00.000Z"),
      }),
      observation({
        externalOrderId: "b1",
        customerName: "Jordan Blake",
        serviceAt: new Date("2026-01-05T00:00:00.000Z"),
      }),
      observation({
        externalOrderId: "b2",
        customerName: "Jordan Blake",
        serviceAt: new Date("2026-02-05T00:00:00.000Z"),
      }),
    ]);
    expect(groups).toEqual([]);
  });

  it("keeps different CleanCloud customer ids apart even when nothing else is shared", () => {
    const groups = groupCleanCloudChurnCustomers("tenant-a", [
      observation({
        externalOrderId: "a1",
        customerName: "Sam Lee",
        cleancloudCustomerId: "cc-sam",
      }),
      observation({
        externalOrderId: "b1",
        customerName: "Jordan Blake",
        cleancloudCustomerId: "cc-jordan",
      }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map(group => group.records.map(row => row.customerName)).sort()).toEqual(
      [["Jordan Blake"], ["Sam Lee"]]
    );
  });

  it("scores a CleanCloud-only history without a fake order id, weight, or dry-cleaning label", () => {
    const described = describeCleanCloudChurnCustomer({
      customerKey: "hash",
      now: new Date("2026-08-01T00:00:00.000Z"),
      observations: [
        observation({
          externalOrderId: "cc-100",
          customerName: "Ada Lovelace",
          email: "ada@example.com",
          serviceAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
        observation({
          externalOrderId: "cc-200",
          customerName: "Ada Lovelace",
          email: "ada@example.com",
          serviceAt: new Date("2026-03-01T00:00:00.000Z"),
        }),
        observation({
          externalOrderId: "cc-300",
          customerName: "Ada Lovelace",
          email: "ada@example.com",
          serviceAt: new Date("2026-05-01T00:00:00.000Z"),
        }),
      ],
    });
    expect(described).not.toBeNull();
    expect(described).toMatchObject({
      lastOrderId: null,
      externalOrderRef: "cc-300",
      orderSource: "cleancloud",
      customerPhone: null,
      lastServiceLabel: "service not proven",
    });
    expect(described?.score.confidence).toBe("low");
    expect(described?.score.reasons.join(" ")).not.toMatch(/dry cleaning/i);
    expect(described?.lastServiceLabel).not.toMatch(/dry cleaning/i);
    expect(described?.history.every(item => item.orderId === null)).toBe(true);
    expect(described?.history.every(item => item.weightLbs === null)).toBe(true);

    const evidence = evidenceForScore(described!.score, described!.history);
    const historyEvidence = evidence.find(
      item => item.label === "Completed order history"
    );
    const lastEvidence = evidence.find(
      item => item.label === "Last completed service"
    );
    expect(historyEvidence?.sourceIds).toEqual(["cc-100", "cc-200", "cc-300"]);
    expect(lastEvidence?.sourceIds).toEqual(["cc-300"]);
    expect(
      evidence.every(item => item.sourceIds.every(id => typeof id !== "number" || id > 0))
    ).toBe(true);
    expect(evidence.some(item => item.sourceIds.includes(0))).toBe(false);
  });
});
