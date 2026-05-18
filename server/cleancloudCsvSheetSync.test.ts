import { describe, expect, it } from "vitest";
import {
  assertCleanCloudCsvPlanWritable,
  buildCleanCloudCsvSheetPlan,
  buildCleanCloudCsvSheetWrites,
} from "./cleancloudCsvSheetSync";

function planFromRows(rows: string[]) {
  return buildCleanCloudCsvSheetPlan({
    csvText: [
      "Order ID,Placed,Customer,Customer ID,Summary,Paid,Payment Type,Card Payment Type,Payment Date,Total,Total after Credit Used,Status",
      ...rows,
    ].join("\n"),
    sourceFileName: "CC-Orders.csv",
    sourceReportType: "orders_sales",
  });
}

const sheetValues = [
  ["", "5/1/2026", "5/2/2026"],
  ["Day", "Friday", "Saturday"],
  ["LF Laundry Rev", "", ""],
  ["LF Dry Clean Rev", "", ""],
];

describe("CleanCloud CSV sheet sync", () => {
  it("plans laundry-only days for LF Laundry Rev row 3", () => {
    const plan = planFromRows([
      "422,1 May 2026 10:00,Moj Salon,9,Fluff & Fold SAME DAY / DELIVERY x 10,1,Card,Clearent Saved Card,1 May 2026 12:00,33.75,33.75,collected",
    ]);

    expect(plan.dailyTotals).toEqual([
      expect.objectContaining({
        date: "2026-05-01",
        totalCents: 3375,
        laundryCents: 3375,
        dryCleanCents: 0,
        reviewCents: 0,
        orderIds: ["422"],
      }),
    ]);
    const writes = buildCleanCloudCsvSheetWrites({ tabName: "MAY 26", values: sheetValues, dailyTotals: plan.dailyTotals });
    expect(writes[0]).toMatchObject({
      date: "2026-05-01",
      laundryCell: "B3",
      laundryNextValue: 33.75,
      dryCleanCell: "B4",
      dryCleanNextValue: 0,
    });
  });

  it("plans dry-cleaning-only days for LF Dry Clean Rev row 4", () => {
    const plan = planFromRows([
      "423,1 May 2026 10:00,Raymond Ra,10,Blouse (1) (D) x 2<br>Dress Shirt (1) (D) x 4<br>Pants (1) (D) x 1,1,Card,Clearent Saved Card,1 May 2026 15:00,42.40,42.40,collected",
    ]);

    expect(plan.dailyTotals).toEqual([
      expect.objectContaining({
        date: "2026-05-01",
        totalCents: 4240,
        laundryCents: 0,
        dryCleanCents: 4240,
        reviewCents: 0,
      }),
    ]);
    const writes = buildCleanCloudCsvSheetWrites({ tabName: "MAY 26", values: sheetValues, dailyTotals: plan.dailyTotals });
    expect(writes[0]).toMatchObject({
      laundryCell: "B3",
      laundryNextValue: 0,
      dryCleanCell: "B4",
      dryCleanNextValue: 42.4,
    });
  });

  it("blocks mixed and unknown service rows by default", () => {
    const plan = planFromRows([
      "424,1 May 2026 10:00,Mixed Customer,11,Wash & Fold plus Dress Shirt (1) (D),1,Card,Clearent Saved Card,1 May 2026 16:00,50.00,50.00,collected",
      "425,1 May 2026 10:00,Retail Customer,12,Retail item,1,Card,Clearent Saved Card,1 May 2026 17:00,9.99,9.99,collected",
    ]);

    expect(plan.dailyTotals[0]).toMatchObject({
      laundryCents: 0,
      dryCleanCents: 0,
      reviewCents: 5999,
      reviewOrders: [
        expect.objectContaining({ cleancloudOrderId: "424", classification: "mixed_needs_review" }),
        expect.objectContaining({ cleancloudOrderId: "425", classification: "unknown_needs_review" }),
      ],
    });
    expect(() => assertCleanCloudCsvPlanWritable(plan)).toThrow(/sheet write blocked/i);
    expect(() => assertCleanCloudCsvPlanWritable(plan, true)).not.toThrow();
  });

  it("skips paid cash rows and unpaid rows", () => {
    const plan = planFromRows([
      "426,1 May 2026 10:00,Cash Customer,13,Fluff & Fold,1,Cash,,1 May 2026 18:00,99.00,99.00,collected",
      "427,1 May 2026 10:00,Unpaid Customer,14,Fluff & Fold,0,Card,Clearent Saved Card,1 May 2026 19:00,88.00,88.00,collected",
      "428,1 May 2026 10:00,Card Customer,15,Fluff & Fold,1,Card,Clearent Saved Card,1 May 2026 20:00,33.75,33.75,collected",
    ]);

    expect(plan.parsedRowCount).toBe(3);
    expect(plan.candidateRowCount).toBe(1);
    expect(plan.skippedRowCount).toBe(2);
    expect(plan.dailyTotals[0]?.orderIds).toEqual(["428"]);
    expect(plan.dailyTotals[0]?.laundryCents).toBe(3375);
  });

  it("plans both row targets for dry-run output", () => {
    const plan = planFromRows([
      "429,1 May 2026 10:00,Laundry Customer,16,Fluff & Fold,1,Card,Clearent Saved Card,1 May 2026 20:00,33.75,33.75,collected",
      "430,2 May 2026 10:00,Dry Customer,17,Dress Shirt (1) (D),1,Card,Clearent Saved Card,2 May 2026 20:00,12.00,12.00,collected",
    ]);
    const writes = buildCleanCloudCsvSheetWrites({ tabName: "MAY 26", values: sheetValues, dailyTotals: plan.dailyTotals });

    expect(writes).toEqual([
      expect.objectContaining({ date: "2026-05-01", laundryCell: "B3", dryCleanCell: "B4" }),
      expect.objectContaining({ date: "2026-05-02", laundryCell: "C3", dryCleanCell: "C4" }),
    ]);
  });
});
