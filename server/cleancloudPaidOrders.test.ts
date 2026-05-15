import { describe, expect, it } from "vitest";
import {
  normalizeCleanCloudPaidOrderRow,
  parseCleanCloudMoneyCents,
  parseCleanCloudPacificDate,
  sumCleanCloudClearentCandidates,
} from "./cleancloudPaidOrders";
import { parseCsv } from "./externalSystems/csvIngestion";

const may12SalesRows = [
  {
    "Order ID": "437",
    "Customer": "Amina Ford",
    "Customer ID": "71",
    "Email": "Amina.ford@kithtreats.com",
    "Phone": "3233040972",
    "Address": "262 North Rodeo Drive // Beverly Hills // CA 90210",
    "Payment Date": "12 May 2026 21:38",
    "Paid": "1",
    "Payment Type": "Card",
    "Card Payment Type": "Clearent Saved Card",
    "Total after Credit Used": "33.75",
    "Status": "collected",
  },
  {
    "Order ID": "438",
    "Customer": "Nicholas Marigliano",
    "Customer ID": "69",
    "Email": "mtmvcr8gx5@privaterelay.appleid.com",
    "Phone": "7327184796",
    "Address": "900 Tularosa Drive // Apt#Apt 1 // Los Angeles // CA 90026",
    "Payment Date": "12 May 2026 21:38",
    "Paid": "1",
    "Payment Type": "Card",
    "Card Payment Type": "Clearent Saved Card",
    "Total after Credit Used": "126.57",
    "Status": "collected",
  },
  {
    "Order ID": "439",
    "Customer": "Moj Salon",
    "Customer ID": "9",
    "Phone": "9086562608",
    "Address": "9449 Charleville Boulevard // Beverly Hills // CA 90212",
    "Payment Date": "12 May 2026 14:06",
    "Paid": "1",
    "Payment Type": "Card",
    "Card Payment Type": "Clearent Saved Card",
    "Total after Credit Used": "33.75",
    "Status": "collected",
  },
];

describe("CleanCloud paid order imports", () => {
  it("parses CleanCloud money formats", () => {
    expect(parseCleanCloudMoneyCents("33.75")).toBe(3375);
    expect(parseCleanCloudMoneyCents("$33.75")).toBe(3375);
    expect(parseCleanCloudMoneyCents("1,234.56")).toBe(123456);
    expect(parseCleanCloudMoneyCents("($6.85)")).toBe(-685);
    expect(parseCleanCloudMoneyCents("")).toBeNull();
  });

  it("parses CleanCloud local dates as UTC instants", () => {
    expect(parseCleanCloudPacificDate("12 May 2026 21:38")?.toISOString()).toBe("2026-05-13T04:38:00.000Z");
  });

  it("imports Orders Sales fields including Payment Date and Total after Credit Used", () => {
    const result = normalizeCleanCloudPaidOrderRow(may12SalesRows[0], {
      sourceReportType: "orders_sales",
      sourceFileName: "CC-Orders.csv",
      importBatchId: 1,
    });

    expect(result.candidateForClearent).toBe(true);
    expect(result.normalized).toMatchObject({
      cleancloudOrderId: "437",
      cleancloudCustomerId: "71",
      customerName: "Amina Ford",
      customerEmail: "Amina.ford@kithtreats.com",
      customerPhone: "3233040972",
      paid: true,
      paymentType: "Card",
      cardPaymentType: "Clearent Saved Card",
      totalCents: 3375,
      orderStatus: "collected",
    });
    expect(result.normalized?.paymentDateUtc?.toISOString()).toBe("2026-05-13T04:38:00.000Z");
  });

  it("imports Orders Revenue fields including Paid Date and Total", () => {
    const result = normalizeCleanCloudPaidOrderRow(
      {
        "Order ID": "439",
        "Customer": "Moj Salon",
        "Customer ID": "9",
        "Paid Date": "12 May 2026 14:06",
        "Paid": "1",
        "Payment Type": "Card",
        "Card Payment Type": "Clearent Saved Card",
        "Total": "33.75",
        "Subtotal": "31.25",
      },
      {
        sourceReportType: "orders_revenue",
        sourceFileName: "CC-Revenue.csv",
        importBatchId: 2,
      }
    );

    expect(result.candidateForClearent).toBe(true);
    expect(result.normalized).toMatchObject({
      sourceReportType: "orders_revenue",
      cleancloudOrderId: "439",
      customerName: "Moj Salon",
      totalCents: 3375,
      subtotalCents: 3125,
    });
    expect(result.normalized?.paidDateUtc?.toISOString()).toBe("2026-05-12T21:06:00.000Z");
  });

  it("does not crash on a Customers header-only export", () => {
    expect(parseCsv("Name,Email,Phone,Customer ID\n")).toEqual([]);
  });

  it("totals the May 12 CleanCloud Clearent candidates at 19407 cents", () => {
    const rows = may12SalesRows.map((row) =>
      normalizeCleanCloudPaidOrderRow(row, {
        sourceReportType: "orders_sales",
        sourceFileName: "CC-Orders.csv",
        importBatchId: 1,
      }).normalized!
    );

    expect(sumCleanCloudClearentCandidates(rows)).toBe(19407);
  });
});
