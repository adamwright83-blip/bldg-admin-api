import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { CleanCloudOrderRow } from "../../../analytics/paidOrderLedger";
import { deriveBusinessSourceCoverage } from "../../../analytics/sourceCoverage";
import { dashboardControlCoverageRange, UNKNOWN_EVIDENCE } from "../../../analytics/sourceBindings";
import {
  UNEVIDENCED_EVENT_TYPES,
  reconcileControlTotals,
  verifiedEventsFromReconciliation,
  type WitnessControl,
} from "./reconcileEconomics";

function row(over: Partial<CleanCloudOrderRow> = {}): CleanCloudOrderRow {
  return {
    cleancloudOrderId: "100",
    cleancloudCustomerId: null,
    sourceReportType: "orders_revenue",
    paymentDateUtc: null,
    paidDateUtc: new Date("2026-09-15T19:00:00.000Z"),
    paid: true,
    totalCents: 312632,
    customerName: null,
    customerPhone: null,
    customerEmail: null,
    ...over,
  };
}

function witness(over: Partial<WitnessControl> = {}): WitnessControl {
  return {
    id: "wit-sep",
    rangeFrom: "2026-09-01",
    rangeTo: "2026-09-30",
    revenueCents: 312632,
    comparisonFrom: null,
    comparisonTo: null,
    comparisonRevenueCents: null,
    ...over,
  };
}

describe("reconcileControlTotals", () => {
  it("reconciles when the dashboard, revenue report, and book are the same cents", () => {
    const result = reconcileControlTotals({
      periodFrom: "2026-09-01",
      periodTo: "2026-09-30",
      witness: witness(),
      rows: [row()],
      revenueReportCovered: true,
      orderCreatedCoverage: false,
    });
    expect(result.status).toBe("reconciled");
    expect(result.discrepancyCents).toBe(0);
    expect(result.dashboardRevenueCents).toBe(312632);
    expect(result.revenueReportCents).toBe(312632);
    expect(result.bookCents).toBe(312632);
    expect(result.coverage.paymentEventCoverage).toBe(true);
    expect(result.coverage.dashboardControlCoverage).toBe(true);
  });

  it("reports the gap and does not pick a winner when the book disagrees", () => {
    const result = reconcileControlTotals({
      periodFrom: "2026-09-01",
      periodTo: "2026-09-30",
      witness: witness(),
      rows: [
        row({ totalCents: 312632 }),
        row({
          sourceReportType: "orders_sales",
          totalCents: 298410,
          paymentDateUtc: new Date("2026-09-15T19:00:00.000Z"),
          paidDateUtc: null,
        }),
      ],
      revenueReportCovered: true,
      orderCreatedCoverage: true,
    });
    expect(result.status).toBe("mismatch");
    expect(result.dashboardRevenueCents).toBe(312632);
    expect(result.revenueReportCents).toBe(312632);
    expect(result.bookCents).toBe(298410);
    expect(result.discrepancyCents).toBe(14222);
  });

  it("does not certify non-empty revenue rows without an exact-period receipt", () => {
    const result = reconcileControlTotals({
      periodFrom: "2026-09-01",
      periodTo: "2026-09-30",
      witness: witness(),
      rows: [row()],
      revenueReportCovered: false,
      orderCreatedCoverage: true,
    });
    expect(result.status).toBe("insufficient_evidence");
    expect(result.revenueReportCents).toBeNull();
    expect(result.coverage.paymentEventCoverage).toBe(false);
    expect(result.dashboardRevenueCents).toBe(312632);
    expect(result.bookCents).toBe(312632);
  });

  it("does not treat a sales-only book as payment coverage", () => {
    const result = reconcileControlTotals({
      periodFrom: "2026-09-01",
      periodTo: "2026-09-30",
      witness: witness(),
      rows: [
        row({
          sourceReportType: "orders_sales",
          paymentDateUtc: new Date("2026-09-15T19:00:00.000Z"),
          paidDateUtc: null,
        }),
      ],
      revenueReportCovered: false,
      orderCreatedCoverage: true,
    });
    expect(result.status).toBe("insufficient_evidence");
    expect(result.discrepancyCents).toBeNull();
    expect(result.revenueReportCents).toBeNull();
    expect(result.coverage.paymentEventCoverage).toBe(false);
    expect(result.coverage.orderCreatedCoverage).toBe(true);
    expect(result.coverage.reconciliation).toBe("insufficient_evidence");
  });

  it("rejects a witness for a different period and an ambiguous revenue order", () => {
    const wrongPeriod = reconcileControlTotals({
      periodFrom: "2026-09-01",
      periodTo: "2026-09-30",
      witness: witness({ rangeFrom: "2026-08-01", rangeTo: "2026-08-31" }),
      rows: [row()],
      revenueReportCovered: true,
      orderCreatedCoverage: false,
    });
    expect(wrongPeriod.status).toBe("insufficient_evidence");
    expect(wrongPeriod.dashboardRevenueCents).toBeNull();

    const ambiguous = reconcileControlTotals({
      periodFrom: "2026-09-01",
      periodTo: "2026-09-30",
      witness: witness(),
      rows: [row({ totalCents: 100 }), row({ totalCents: 200 })],
      revenueReportCovered: true,
      orderCreatedCoverage: false,
    });
    expect(ambiguous.status).toBe("insufficient_evidence");
    expect(ambiguous.revenueReportCents).toBeNull();
  });
});

describe("verified economic events", () => {
  const sep = witness({
    comparisonFrom: "2026-08-01",
    comparisonTo: "2026-08-31",
    comparisonRevenueCents: 301302,
  });
  const current = reconcileControlTotals({
    periodFrom: "2026-09-01",
    periodTo: "2026-09-30",
    witness: sep,
    rows: [row()],
    revenueReportCovered: true,
    orderCreatedCoverage: false,
  });
  const prior = {
    id: "rec-aug",
    rangeFrom: "2026-08-01",
    rangeTo: "2026-08-31",
    status: "reconciled" as const,
    dashboardRevenueCents: 301302,
    evidenceIds: ["witness:wit-aug", "revenue-report:aug", "book:aug"],
  };

  it("emits one gain from reconciled periods and the same key on a re-read", () => {
    const first = verifiedEventsFromReconciliation({
      tenantId: "tenant-a",
      current,
      witness: sep,
      prior: [prior],
    });
    const second = verifiedEventsFromReconciliation({
      tenantId: "tenant-a",
      current,
      witness: sep,
      prior: [prior],
    });
    expect(first.map(event => event.eventType)).toEqual([
      "economic.mom_revenue_gain_verified",
      "economic.monthly_revenue_record_verified",
    ]);
    expect(first[0]).toMatchObject({
      deltaCents: 11330,
      currentRevenueCents: 312632,
      comparisonRevenueCents: 301302,
      comparisonFrom: "2026-08-01",
      comparisonTo: "2026-08-31",
    });
    expect(first[0]!.idempotencyKey).toBe(second[0]!.idempotencyKey);
    expect(first[1]!.idempotencyKey).toBe(second[1]!.idempotencyKey);
    expect(first[0]!.evidenceIds).toEqual(
      expect.arrayContaining(["witness:wit-sep", "witness:wit-aug"])
    );
    for (const blocked of UNEVIDENCED_EVENT_TYPES) {
      expect(first.map(event => event.eventType)).not.toContain(blocked);
    }
  });

  it("emits nothing when the current period is a mismatch or the comparison is unreconciled", () => {
    const mismatch = reconcileControlTotals({
      periodFrom: "2026-09-01",
      periodTo: "2026-09-30",
      witness: sep,
      rows: [
        row(),
        row({
          sourceReportType: "orders_sales",
          totalCents: 1,
          paymentDateUtc: new Date("2026-09-15T19:00:00.000Z"),
        }),
      ],
      revenueReportCovered: true,
      orderCreatedCoverage: true,
    });
    expect(
      verifiedEventsFromReconciliation({
        tenantId: "tenant-a",
        current: mismatch,
        witness: sep,
        prior: [prior],
      })
    ).toEqual([]);
    expect(
      verifiedEventsFromReconciliation({
        tenantId: "tenant-a",
        current,
        witness: sep,
        prior: [{ ...prior, status: "insufficient_evidence" }],
      })
    ).toEqual([]);
  });

  it("does not call one month a record when the previous month is missing", () => {
    const events = verifiedEventsFromReconciliation({
      tenantId: "tenant-a",
      current,
      witness: sep,
      prior: [
        {
          ...prior,
          rangeFrom: "2026-07-01",
          rangeTo: "2026-07-31",
          dashboardRevenueCents: 100,
        },
      ],
    });
    expect(events.map(event => event.eventType)).not.toContain(
      "economic.monthly_revenue_record_verified"
    );
  });
});

describe("dashboard coverage is not payment coverage", () => {
  it("leaves paymentEventsProven false when the only added span is a dashboard witness", () => {
    const completedAt = new Date("2026-09-20T01:00:00.000Z");
    const now = new Date("2026-09-20T18:00:00.000Z");
    const sales = {
      from: "2026-09-01",
      to: "2026-09-19",
      completedAt,
      basis: "orders_created" as const,
      provenance: "browser_sync_receipt" as const,
    };
    const result = deriveBusinessSourceCoverage({
      tenantId: "tenant-a",
      now,
      evidence: {
        ...UNKNOWN_EVIDENCE,
        laundry_butler: {
          ...UNKNOWN_EVIDENCE.laundry_butler,
          state: "bound",
          lastSuccessAt: now,
          isSystemOfRecord: true,
        },
        cleancloud: {
          state: "bound",
          lastSuccessAt: now,
          isSystemOfRecord: false,
          latestAttempt: null,
          coverageRanges: [
            sales,
            dashboardControlCoverageRange({
              rangeFrom: "2026-09-01",
              rangeTo: "2026-09-19",
              observedAt: completedAt,
            }),
          ],
        },
      },
      cleancloudReceipts: [
        {
          from: "2026-09-01",
          to: "2026-09-19",
          completedAt: completedAt.toISOString(),
          customerTruth: "refreshed",
          basis: "orders_created",
          provenance: "browser_sync_receipt",
        },
      ],
    });
    expect(result.book.paymentEventsProven).toBe(false);
    expect(result.book.scope.cleancloudEconomicEvents).toBeNull();
  });
});

describe("reconcilePeriod stays on the session tenant", () => {
  it("does not accept a tenant from the caller and does not return order rows", () => {
    const router = readFileSync(new URL("./router.ts", import.meta.url), "utf8");
    const fn = router.slice(router.indexOf("reconcilePeriod:"), router.indexOf("latestVerifiedGain:"));
    expect(fn).toContain("eq(cleancloudPaidOrders.tenantId, ctx.tenantId)");
    expect(fn).toContain("eq(dashboardWitnesses.tenantId, ctx.tenantId)");
    expect(fn).toContain("eq(economicReconciliations.storeId, binding.storeId)");
    expect(fn).toContain("orderBy(desc(economicReconciliations.createdAt))");
    expect(fn).toContain("latestPriorRows.has(key)");
    expect(fn).toContain("Verified-event race did not resolve to a stored event");
    expect(fn).toContain("publicEconomicEvent(winner)");
    expect(fn).not.toContain("input.tenantId");
    expect(fn).not.toContain("cleancloudPaidOrders.customerName");
    expect(fn).not.toContain("cleancloudPaidOrders.customerPhone");
  });
});
