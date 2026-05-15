import { describe, expect, it } from "vitest";
import {
  chooseCleanCloudCandidatesForDate,
  reconcileClearentDailySummaryWithCleanCloudCandidates,
  reconciledCustomerRevenueCents,
  type CleanCloudCandidateOrder,
} from "./paymentReconciliation";

function candidate(overrides: Partial<CleanCloudCandidateOrder>): CleanCloudCandidateOrder {
  return {
    id: 1,
    tenantId: "default",
    sourceReportType: "orders_sales",
    cleancloudOrderId: "437",
    cleancloudCustomerId: "71",
    customerName: "Amina Ford",
    customerEmail: "Amina.ford@kithtreats.com",
    customerPhone: "3233040972",
    buildingName: null,
    buildingSlug: null,
    tower: null,
    unit: null,
    paymentDateUtc: new Date("2026-05-13T04:38:00.000Z"),
    paidDateUtc: null,
    paid: true,
    paymentType: "Card",
    cardPaymentType: "Clearent Saved Card",
    totalCents: 3375,
    ...overrides,
  };
}

const may12Candidates = [
  candidate({ id: 1, cleancloudOrderId: "437", customerName: "Amina Ford", totalCents: 3375 }),
  candidate({ id: 2, cleancloudOrderId: "438", customerName: "Nicholas Marigliano", totalCents: 12657 }),
  candidate({ id: 3, cleancloudOrderId: "439", customerName: "Moj Salon", totalCents: 3375, paymentDateUtc: new Date("2026-05-12T21:06:00.000Z") }),
];

describe("Clearent / CleanCloud reconciliation", () => {
  it("prefers Orders Sales candidates for the same Los Angeles business date", () => {
    const chosen = chooseCleanCloudCandidatesForDate("2026-05-12", [
      ...may12Candidates,
      candidate({
        id: 4,
        sourceReportType: "orders_revenue",
        cleancloudOrderId: "437",
        paidDateUtc: new Date("2026-05-13T04:38:00.000Z"),
      }),
    ]);

    expect(chosen).toHaveLength(3);
    expect(chosen.every((row) => row.sourceReportType === "orders_sales")).toBe(true);
  });

  it("keeps the May 12 mismatch in needs_review with Clearent minus CleanCloud delta", () => {
    const result = reconcileClearentDailySummaryWithCleanCloudCandidates(
      {
        reportDateUtc: new Date("2026-05-12T07:00:00.000Z"),
        totalSalesCents: 17292,
      },
      may12Candidates
    );

    expect(result.status).toBe("needs_review");
    expect(result.cleancloudCandidateOrderCents).toBe(19407);
    expect(result.unresolvedDeltaCents).toBe(-2115);
  });

  it("creates exact date-total matches when Clearent equals CleanCloud candidates", () => {
    const result = reconcileClearentDailySummaryWithCleanCloudCandidates(
      {
        reportDateUtc: new Date("2026-05-12T07:00:00.000Z"),
        totalSalesCents: 19407,
      },
      may12Candidates
    );

    expect(result.status).toBe("date_total_match");
    expect(result.confidence).toBe("medium");
    expect(result.unresolvedDeltaCents).toBe(0);
  });

  it("only matched reconciliation rows feed customer ranking revenue", () => {
    const revenue = reconciledCustomerRevenueCents([
      { matchStatus: "date_total_match", matchedAmountCents: 3375 },
      { matchStatus: "customer_match", matchedAmountCents: 12657 },
      { matchStatus: "needs_review", matchedAmountCents: 99999 },
      { matchStatus: "unmatched", matchedAmountCents: 99999 },
    ]);

    expect(revenue).toBe(16032);
  });

  it("does not treat raw Clearent daily summary dollars as customer revenue", () => {
    const result = reconcileClearentDailySummaryWithCleanCloudCandidates(
      { reportDateUtc: new Date("2026-05-12T07:00:00.000Z"), totalSalesCents: 17292 },
      may12Candidates
    );

    expect(reconciledCustomerRevenueCents([{ matchStatus: result.status, matchedAmountCents: 17292 }])).toBe(0);
  });
});
