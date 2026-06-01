import { format } from "date-fns";
import { describe, expect, it } from "vitest";
import {
  getMonthlyDateHeaderValues,
  getMonthlyTabAliases,
  getLosAngelesBusinessDate,
  isStaleDriverExpenseDate,
  normalizeMonthlyTabTitle,
  parseSheetTargetDate,
  resolveSafeReceiptSheetDate,
  resolveMonthlyTabName,
} from "./sheets";

describe("Google Sheets helpers", () => {
  it("resolves monthly tab names with case and whitespace differences", () => {
    expect(resolveMonthlyTabName(["JAN 26", "MAY 26 "], "MAY 26")).toBe(
      "MAY 26 "
    );
    expect(resolveMonthlyTabName(["Jan 26", "may\u00a026"], "MAY 26")).toBe(
      "may\u00a026"
    );
    expect(normalizeMonthlyTabTitle(" may\u00a026 ")).toBe("MAY 26");
  });

  it("resolves short and full monthly tab aliases", () => {
    expect(getMonthlyTabAliases(new Date(2026, 5, 1))).toEqual([
      "JUN 26",
      "JUNE 26",
    ]);
    expect(resolveMonthlyTabName(["JUN 26"], "JUN 26")).toBe("JUN 26");
    expect(resolveMonthlyTabName(["JUNE 26"], "JUN 26")).toBe("JUNE 26");
    expect(resolveMonthlyTabName(["SEP 26"], "SEP 26")).toBe("SEP 26");
    expect(resolveMonthlyTabName(["SEPTEMBER 26"], "SEP 26")).toBe(
      "SEPTEMBER 26"
    );
  });

  it("prefers the canonical short month tab when both aliases exist", () => {
    expect(resolveMonthlyTabName(["JUNE 26", "JUN 26"], "JUN 26")).toBe(
      "JUN 26"
    );
    expect(resolveMonthlyTabName(["SEPTEMBER 26", "SEP 26"], "SEP 26")).toBe(
      "SEP 26"
    );
  });

  it("returns null for missing months so callers can create the canonical short tab", () => {
    expect(resolveMonthlyTabName(["MAY 26", "JULY 26"], "JUN 26")).toBeNull();
  });

  it("builds monthly date headers for the exact target month", () => {
    const juneHeaders = getMonthlyDateHeaderValues(new Date(2026, 5, 1));
    expect(juneHeaders).toHaveLength(30);
    expect(juneHeaders[0]).toBe("2026-06-01");
    expect(juneHeaders[29]).toBe("2026-06-30");
  });

  it("parses two digit receipt dates as the current century calendar date", () => {
    const date = parseSheetTargetDate("5/12/26 9:25", new Date(2026, 0, 1));
    expect(format(date, "yyyy-MM-dd")).toBe("2026-05-12");
  });

  it("falls back when receipt date is unreadable", () => {
    const fallback = new Date(2026, 4, 12);
    expect(parseSheetTargetDate("not a date", fallback)).toBe(fallback);
  });

  it("falls back when OCR returns an impossible calendar date", () => {
    const fallback = new Date(2026, 5, 1);
    expect(parseSheetTargetDate("2/31/26", fallback)).toBe(fallback);
  });

  it("treats old OCR receipt years as stale for driver expenses", () => {
    const uploadDate = new Date(2026, 4, 12);
    expect(isStaleDriverExpenseDate(new Date(2020, 4, 12), uploadDate)).toBe(
      true
    );
    expect(isStaleDriverExpenseDate(new Date(2026, 4, 12), uploadDate)).toBe(
      false
    );
  });

  it("uses Los Angeles calendar date for late-day driver uploads on UTC servers", () => {
    const date = getLosAngelesBusinessDate(
      new Date("2026-05-13T01:14:00.000Z")
    );
    expect(format(date, "yyyy-MM-dd")).toBe("2026-05-12");
  });

  it("uses one safe receipt date resolver for missing and stale OCR dates", () => {
    const uploadNow = new Date("2026-06-01T17:00:00.000Z");

    const missing = resolveSafeReceiptSheetDate(null, uploadNow);
    expect(missing.basis).toBe("los_angeles_upload_date");
    expect(format(missing.date, "yyyy-MM-dd")).toBe("2026-06-01");

    const stale = resolveSafeReceiptSheetDate("2020-06-01", uploadNow);
    expect(stale.basis).toBe("los_angeles_upload_date");
    expect(stale.reason).toBe("receipt_date_stale_or_suspicious");
    expect(format(stale.date, "yyyy-MM-dd")).toBe("2026-06-01");
  });

  it("uses parsed receipt dates when they are valid and current", () => {
    const safeDate = resolveSafeReceiptSheetDate(
      "6/2/26",
      new Date("2026-06-01T17:00:00.000Z")
    );
    expect(safeDate.basis).toBe("parsed_receipt_date");
    expect(format(safeDate.date, "yyyy-MM-dd")).toBe("2026-06-02");
  });
});
