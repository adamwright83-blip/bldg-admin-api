import { describe, expect, it } from "vitest";
import { buildCleanCloudCsvSheetPlan } from "./cleancloudCsvSheetSync";

describe("CleanCloud CSV sheet sync", () => {
  it("groups Orders Sales Clearent card rows by LA payment date", () => {
    const csv = [
      "Order ID,Placed,Customer,Customer ID,Summary,Paid,Payment Type,Card Payment Type,Payment Date,Total,Total after Credit Used,Status",
      "422,1 May 2026 10:00,Moj Salon,9,Fluff & Fold SAME DAY / DELIVERY x 10,1,Card,Clearent Saved Card,1 May 2026 12:00,33.75,33.75,collected",
      "423,5 May 2026 10:00,Raymond Ra,10,Blouse (1) (D) x 2<br>Dress Shirt (1) (D) x 4,1,Card,Clearent Saved Card,5 May 2026 15:00,42.40,42.40,collected",
      "424,5 May 2026 10:00,Cash Customer,11,Fluff & Fold,1,Cash,,5 May 2026 15:00,99.00,99.00,collected",
    ].join("\n");

    const plan = buildCleanCloudCsvSheetPlan({
      csvText: csv,
      sourceFileName: "CC-Orders.csv",
      sourceReportType: "orders_sales",
    });

    expect(plan.parsedRowCount).toBe(3);
    expect(plan.candidateRowCount).toBe(2);
    expect(plan.skippedRowCount).toBe(1);
    expect(plan.dailyTotals).toHaveLength(2);
    expect(plan.dailyTotals[0]).toMatchObject({
      date: "2026-05-01",
      totalCents: 3375,
      orderCount: 1,
      orderIds: ["422"],
    });
    expect(plan.dailyTotals[1]).toMatchObject({
      date: "2026-05-05",
      totalCents: 4240,
      orderCount: 1,
      orderIds: ["423"],
    });
    expect(plan.dailyTotals[1]?.classifications.unknown_needs_review).toBe(4240);
  });

  it("keeps unknown service classifications in the daily total", () => {
    const csv = [
      "Order ID,Customer,Summary,Paid,Payment Type,Card Payment Type,Payment Date,Total after Credit Used",
      "440,Miso Chon,All Comforters x 1<br>Discount: $15.75,1,Card,Clearent Saved Card,15 May 2026 14:00,29.25",
    ].join("\n");

    const plan = buildCleanCloudCsvSheetPlan({
      csvText: csv,
      sourceFileName: "CC-Orders.csv",
      sourceReportType: "orders_sales",
    });

    expect(plan.dailyTotals).toEqual([
      expect.objectContaining({
        date: "2026-05-15",
        totalCents: 2925,
        classifications: expect.objectContaining({
          unknown_needs_review: 2925,
        }),
      }),
    ]);
  });
});
