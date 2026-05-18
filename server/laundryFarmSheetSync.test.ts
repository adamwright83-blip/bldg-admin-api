import { describe, expect, it } from "vitest";
import type { CleancloudPaidOrder } from "../drizzle/schema";
import {
  buildLaundryFarmSheetSyncPlan,
  classifyCleanCloudService,
} from "./laundryFarmSheetSync";
import { findDayColumn, findRowByLabel, getMonthlyTabName } from "./sheets";

function order(overrides: Partial<CleancloudPaidOrder>): CleancloudPaidOrder {
  return {
    id: 1,
    tenantId: "default",
    sourceReportType: "orders_sales",
    sourceFileName: "orders.csv",
    importBatchId: 1,
    cleancloudOrderId: "100",
    cleancloudCustomerId: "9",
    customerName: "Moj Salon",
    customerEmail: null,
    customerPhone: "9086562608",
    address: null,
    placedAtUtc: null,
    paymentDateUtc: new Date("2026-05-12T20:00:00.000Z"),
    paidDateUtc: null,
    readyByDateUtc: null,
    collectedAtUtc: null,
    cleanedAtUtc: null,
    orderStatus: "collected",
    paid: true,
    paymentType: "Card",
    cardPaymentType: "Clearent Saved Card",
    totalCents: 3375,
    subtotalCents: null,
    discountCents: null,
    creditCents: null,
    totalWeightLbs: null,
    summaryText: "Wash & Fold laundry 10 lbs",
    buildingName: null,
    buildingSlug: null,
    tower: null,
    unit: null,
    buildingResolutionStatus: "unresolved_needs_mapping",
    rawJson: {},
    createdAt: new Date("2026-05-12T20:00:00.000Z"),
    updatedAt: new Date("2026-05-12T20:00:00.000Z"),
    ...overrides,
  };
}

describe("Laundry Farm revenue sheet sync", () => {
  it("finds the MAY 26 tab and the correct date column from row 1", () => {
    expect(getMonthlyTabName(new Date(2026, 4, 12))).toBe("MAY 26");
    const header = ["", "5/1/2026", "5/2/2026", "5/12/2026"];
    expect(findDayColumn(header, new Date(2026, 4, 12))).toBe(3);
  });

  it("targets LF Laundry Rev row 3 and LF Dry Clean Rev row 4 by label", () => {
    const columnA = ["", "", "LF Laundry Rev", "LF Dry Clean Rev", "LF Cost of Dry Cleaning"];
    expect(findRowByLabel(columnA, "LF Laundry Rev")).toBe(2);
    expect(findRowByLabel(columnA, "LF Dry Clean Rev")).toBe(3);
  });

  it("classifies laundry and dry cleaning from CleanCloud service text", () => {
    expect(classifyCleanCloudService(order({ summaryText: "Wash & Fold laundry per lb" }))).toBe("laundry");
    expect(classifyCleanCloudService(order({ summaryText: "Dry cleaning pressed shirts" }))).toBe("dry_cleaning");
  });

  it("classifies Laundry Farm laundry catalog items as laundry", () => {
    expect(classifyCleanCloudService(order({ summaryText: "All Comforters x 3<br>  17.20lb<br><br>Discount: $27.59" }))).toBe("laundry");
    expect(classifyCleanCloudService(order({ summaryText: "Comforter x 1" }))).toBe("laundry");
    expect(classifyCleanCloudService(order({ summaryText: "Bedding & Rugs x 1" }))).toBe("laundry");
    expect(classifyCleanCloudService(order({ summaryText: "Wash, Fold & Dry x 12" }))).toBe("laundry");
  });

  it("does not treat dry by itself as dry cleaning", () => {
    expect(classifyCleanCloudService(order({ summaryText: "Dry" }))).toBe("unknown_needs_review");
    expect(classifyCleanCloudService(order({ summaryText: "Wash, Fold & Dry x 22" }))).toBe("laundry");
  });

  it("classifies non-catalog items as dry cleaning and mixed catalog/non-catalog orders as review", () => {
    expect(classifyCleanCloudService(order({ summaryText: "Retail item" }))).toBe("dry_cleaning");
    expect(classifyCleanCloudService(order({ summaryText: "Fluff & Fold x 10<br>Dress Shirt (1) (D) x 2" }))).toBe("mixed_needs_review");
  });

  it("keeps Thomas Hartmann-style All Comforters orders in laundry", () => {
    expect(classifyCleanCloudService(order({
      cleancloudOrderId: "406",
      customerName: "Thomas Hartmann",
      totalCents: 11037,
      summaryText: "All Comforters x 3<br>  17.20lb<br><br>Discount: $27.59",
    }))).toBe("laundry");
  });

  it("builds row 3 and row 4 values without touching other sheet rows", () => {
    const plan = buildLaundryFarmSheetSyncPlan({
      date: "2026-05-12",
      tabName: "MAY 26",
      columnIndex0: 12,
      columnLetter: "M",
      clearentEnteredTotalCents: 5500,
      cleancloudOrders: [
        order({ cleancloudOrderId: "1", totalCents: 3375, summaryText: "Wash & Fold laundry" }),
        order({ cleancloudOrderId: "2", totalCents: 2125, summaryText: "Dry cleaning" }),
      ],
    });

    expect(plan.laundryRow).toBe(3);
    expect(plan.dryCleanRow).toBe(4);
    expect(plan.laundryRevenueCents).toBe(3375);
    expect(plan.dryCleanRevenueCents).toBe(2125);
    expect(plan.cleancloudCandidateTotalCents).toBe(5500);
    expect(plan.reconciliationStatus).toBe("matched");
  });

  it("warns on Clearent mismatch and keeps unknown/mixed out of row totals", () => {
    const plan = buildLaundryFarmSheetSyncPlan({
      date: "2026-05-12",
      clearentEnteredTotalCents: 10000,
      cleancloudOrders: [
        order({ cleancloudOrderId: "1", totalCents: 3375, summaryText: "Wash & Fold laundry" }),
        order({ cleancloudOrderId: "2", totalCents: 2125, summaryText: "Dry cleaning" }),
        order({ cleancloudOrderId: "3", totalCents: 500, summaryText: "Retail item" }),
        order({ cleancloudOrderId: "4", totalCents: 1000, summaryText: "Fluff & Fold x 8<br>Dress Shirt (1) (D) x 1" }),
      ],
    });

    expect(plan.laundryRevenueCents).toBe(3375);
    expect(plan.dryCleanRevenueCents).toBe(2625);
    expect(plan.unknownCents).toBe(0);
    expect(plan.mixedCents).toBe(1000);
    expect(plan.warnings).toContain("clearent_cleancloud_mismatch");
    expect(plan.warnings).toContain("mixed_classification");
  });

  it("fails safely when source data is missing", () => {
    const noClearent = buildLaundryFarmSheetSyncPlan({
      date: "2026-05-12",
      clearentEnteredTotalCents: null,
      cleancloudOrders: [order({})],
    });
    const noCleanCloud = buildLaundryFarmSheetSyncPlan({
      date: "2026-05-12",
      clearentEnteredTotalCents: 3375,
      cleancloudOrders: [],
    });

    expect(noClearent.reconciliationStatus).toBe("missing_clearent");
    expect(noClearent.warnings).toContain("missing_clearent_daily_summary");
    expect(noCleanCloud.reconciliationStatus).toBe("missing_cleancloud");
    expect(noCleanCloud.warnings).toContain("missing_cleancloud_paid_orders");
  });
});
