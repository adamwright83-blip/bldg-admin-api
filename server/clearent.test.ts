import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  buildClearentRevenueSummaryFromDailyRows,
  buildClearentRevenueSummaryFromRows,
  clearentFallbackKey,
  normalizeClearentDailySummaryRow,
  normalizeClearentRow,
} from "./clearent";
import { parseTabularRows } from "./externalSystems/tabularIngestion";
import type { DashboardBusinessDayBounds } from "./revenueIntervention";

const bounds: DashboardBusinessDayBounds = {
  ymd: "2026-05-14",
  timeZone: "America/Los_Angeles",
  startUtc: new Date("2026-05-14T07:00:00.000Z"),
  endUtc: new Date("2026-05-15T07:00:00.000Z"),
};

function normalize(row: Record<string, string>, basis: "settled_date" | "entered_date" | "unknown" = "unknown") {
  return normalizeClearentRow(row, {
    sourceFileName: "clearent.csv",
    importBatchId: 1,
    sourceReportBasis: basis,
  }).normalized;
}

describe("Clearent / XplorPay import pipeline", () => {
  it("parses sample Clearent CSV export rows", () => {
    const rows = parseTabularRows({
      buffer: Buffer.from("Transaction ID,Entered Date,Amount,Card Type,Last 4\nabc123,05/14/2026 09:30 AM,$86.46,Visa,4242\n"),
      contentType: "text/csv",
    });
    expect(rows).toEqual([
      {
        "Transaction ID": "abc123",
        "Entered Date": "05/14/2026 09:30 AM",
        Amount: "$86.46",
        "Card Type": "Visa",
        "Last 4": "4242",
      },
    ]);
  });

  it("parses sample Clearent Excel export rows", () => {
    const sheet = XLSX.utils.json_to_sheet([
      {
        "Transaction ID": "xlsx-1",
        "Settled Date": "05/14/2026",
        Amount: "$120.00",
        "Card Type": "Mastercard",
        "Last 4": "1111",
      },
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Daily");
    const buffer = Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));

    const rows = parseTabularRows({
      buffer,
      fileName: "daily.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    expect(rows[0]).toMatchObject({
      "Transaction ID": "xlsx-1",
      Amount: "$120.00",
      "Card Type": "Mastercard",
    });
  });

  it("parses DepositDetails daily aggregate fixture rows after report title rows", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Deposit Details, May 2026"],
      [],
      ["Settle Date", "Total Sales", "Net Sales", "Total\nTransactions", "Interchange", "Discount", "Deposit Amount"],
      ["05/01/2026", "$304.51", "$304.51", "4", "$0.00", "($6.85)", "$297.66"],
      ["TOTAL", "$1,626.63", "$1,626.63", "22", "$0.00", "($36.60)", "$1,590.03"],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Deposit Details");
    const buffer = Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xls" }));
    const rows = parseTabularRows({ buffer, fileName: "DepositDetails_2026-May.xls" });

    expect(rows[0]).toMatchObject({
      "Settle Date": "05/01/2026",
      "Total Sales": "$304.51",
      "Total\nTransactions": "4",
      Discount: "($6.85)",
    });
  });

  it("parses DailyCardActivity daily aggregate fixture rows after report title rows", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Daily Card Activity, May 2026"],
      [],
      ["Transaction\nDate", "Total\nTransactions", "Sales", "", ""],
      ["05/12/2026", "3", "$172.92", "", ""],
      ["TOTAL", "20", "$1,540.38", "", ""],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Daily Card Activity");
    const buffer = Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xls" }));
    const rows = parseTabularRows({ buffer, fileName: "DailyCardActivity_2026-May.xls" });

    expect(rows[0]).toMatchObject({
      "Transaction\nDate": "05/12/2026",
      "Total\nTransactions": "3",
      Sales: "$172.92",
    });
  });

  it("normalizes DepositDetails rows as settled daily summaries", () => {
    const summary = normalizeClearentDailySummaryRow(
      {
        "Settle Date": "05/01/2026",
        "Total Sales": "$304.51",
        "Net Sales": "$304.51",
        "Total Transactions": "4",
        Interchange: "$0.00",
        Discount: "($6.85)",
        "Deposit Amount": "$297.66",
      },
      { sourceFileName: "DepositDetails_2026-May.xls", importBatchId: 10, sourceReportBasis: "settled_date" }
    );

    expect(summary).toMatchObject({
      sourceReportBasis: "settled_date",
      totalSalesCents: 30451,
      netSalesCents: 30451,
      totalTransactions: 4,
      interchangeCents: 0,
      discountCents: -685,
      depositAmountCents: 29766,
    });
  });

  it("normalizes DailyCardActivity rows as entered daily summaries", () => {
    const summary = normalizeClearentDailySummaryRow(
      {
        "Transaction Date": "05/12/2026",
        "Total Transactions": "3",
        Sales: "$172.92",
      },
      { sourceFileName: "DailyCardActivity_2026-May.xls", importBatchId: 11, sourceReportBasis: "entered_date" }
    );

    expect(summary).toMatchObject({
      sourceReportBasis: "entered_date",
      totalSalesCents: 17292,
      totalTransactions: 3,
      netSalesCents: null,
      depositAmountCents: null,
    });
  });

  it("skips TOTAL rows for daily summaries", () => {
    const summary = normalizeClearentDailySummaryRow(
      {
        "Transaction Date": "TOTAL",
        "Total Transactions": "20",
        Sales: "$1,540.38",
      },
      { sourceFileName: "DailyCardActivity_2026-May.xls", importBatchId: 11, sourceReportBasis: "entered_date" }
    );

    expect(summary).toBeNull();
  });

  it("uses daily aggregate rows for Clearent dashboard totals when transaction rows are unavailable", () => {
    const entered = normalizeClearentDailySummaryRow(
      {
        "Transaction Date": "05/14/2026",
        "Total Transactions": "1",
        Sales: "$149.97",
      },
      { sourceFileName: "DailyCardActivity_2026-May.xls", importBatchId: 11, sourceReportBasis: "entered_date" }
    )!;
    const settled = normalizeClearentDailySummaryRow(
      {
        "Settle Date": "05/14/2026",
        "Total Sales": "$149.97",
        "Net Sales": "$149.97",
        "Total Transactions": "1",
        Discount: "($3.37)",
        "Deposit Amount": "$146.60",
      },
      { sourceFileName: "DepositDetails_2026-May.xls", importBatchId: 10, sourceReportBasis: "settled_date" }
    )!;

    const summary = buildClearentRevenueSummaryFromDailyRows([entered, settled], bounds);
    expect(summary.collectedCents).toBe(14997);
    expect(summary.settledCents).toBe(14660);
  });

  it("daily aggregate rows carry summary metadata, not fake customer attribution", () => {
    const summary = normalizeClearentDailySummaryRow(
      {
        "Transaction Date": "05/12/2026",
        "Total Transactions": "3",
        Sales: "$172.92",
      },
      { sourceFileName: "DailyCardActivity_2026-May.xls", importBatchId: 11, sourceReportBasis: "entered_date" }
    )!;

    expect((summary.rawJson as any).dataType).toBe("daily_summary");
    expect("customerName" in summary).toBe(false);
  });

  it("handles settled_date report basis separately from entered_date", () => {
    const settled = normalize(
      {
        "Transaction ID": "settled-1",
        "Transaction Date": "05/14/2026",
        Amount: "$50.00",
        "Card Type": "Visa",
        "Last 4": "2222",
      },
      "settled_date"
    );
    const entered = normalize(
      {
        "Transaction ID": "entered-1",
        "Transaction Date": "05/14/2026",
        Amount: "$70.00",
        "Card Type": "Visa",
        "Last 4": "3333",
      },
      "entered_date"
    );

    expect(settled.sourceReportBasis).toBe("settled_date");
    expect(settled.settledDateUtc).toBeInstanceOf(Date);
    expect(entered.sourceReportBasis).toBe("entered_date");
    expect(entered.enteredDateUtc).toBeInstanceOf(Date);
  });

  it("uses stable fallback keys so duplicate uploads are idempotent", () => {
    const a = normalize({
      "Auth Code": "A1B2",
      Amount: "$86.46",
      "Card Type": "Visa",
      "Last 4": "4242",
      "Entered Date": "05/14/2026 09:00 AM",
    });
    const b = normalize({
      "Authorization Code": "A1B2",
      "Transaction Amount": "$86.46",
      Card: "Visa",
      "Card Last 4": "4242",
      "Date Entered": "05/14/2026 09:00 AM",
    });

    expect(clearentFallbackKey(a)).toBe(clearentFallbackKey(b));
  });

  it("does not double-count revenue when settled and entered views represent the same transaction", () => {
    const entered = normalize({
      "Auth Code": "MERGE1",
      Amount: "$86.46",
      "Card Type": "Visa",
      "Last 4": "4242",
      "Entered Date": "05/14/2026 09:00 AM",
    }, "entered_date");
    const settled = {
      ...entered,
      sourceReportBasis: "settled_date" as const,
      settledDateUtc: new Date("2026-05-15T19:00:00.000Z"),
    };

    const summary = buildClearentRevenueSummaryFromRows([settled], bounds);
    expect(summary.collectedCents).toBe(8646);
    expect(summary.settledCents).toBe(0);
  });

  it("puts an old order charged today under today's collected revenue", () => {
    const row = normalize({
      "Customer Name": "Old CleanCloud Customer",
      "Entered Date": "05/14/2026 04:05 PM",
      Amount: "$94.05",
      "Card Type": "Visa",
      "Last 4": "4242",
    }, "entered_date");

    const summary = buildClearentRevenueSummaryFromRows([row], bounds);
    expect(summary.collectedCents).toBe(9405);
  });

  it("keeps settled totals separate from collected totals", () => {
    const row = normalize({
      "Entered Date": "05/13/2026 04:05 PM",
      "Settled Date": "05/14/2026",
      Amount: "$100.00",
      "Net Amount": "$97.00",
      "Card Type": "Visa",
      "Last 4": "4242",
    }, "settled_date");

    const summary = buildClearentRevenueSummaryFromRows([row], bounds);
    expect(summary.collectedCents).toBe(0);
    expect(summary.settledCents).toBe(9700);
  });

  it("labels Clearent separately from Stripe and CleanCloud", () => {
    const row = normalize({
      "Transaction ID": "label-1",
      "Entered Date": "05/14/2026",
      Amount: "$10.00",
    });
    expect((row.rawJson as any).source).toBe("clearent_xplorpay");
    expect((row.rawJson as any).depositsPhase1Deferred).toContain("no export CTA");
  });

  it("surfaces unresolved building rows", () => {
    const result = normalizeClearentRow(
      {
        "Transaction ID": "unknown-building",
        "Entered Date": "05/14/2026",
        Amount: "$10.00",
        Notes: "Some unknown address",
      },
      { sourceFileName: "clearent.csv", importBatchId: 1, sourceReportBasis: "entered_date" }
    );
    expect(result.needsBuildingResolution).toBe(true);
    expect((result.normalized.rawJson as any).needsBuildingResolution).toBe(true);
  });
});
