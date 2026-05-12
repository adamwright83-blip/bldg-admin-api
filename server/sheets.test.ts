import { format } from "date-fns";
import { describe, expect, it } from "vitest";
import {
  normalizeMonthlyTabTitle,
  parseSheetTargetDate,
  resolveMonthlyTabName,
} from "./sheets";

describe("Google Sheets helpers", () => {
  it("resolves monthly tab names with case and whitespace differences", () => {
    expect(resolveMonthlyTabName(["JAN 26", "MAY 26 "], "MAY 26")).toBe("MAY 26 ");
    expect(resolveMonthlyTabName(["Jan 26", "may\u00a026"], "MAY 26")).toBe("may\u00a026");
    expect(normalizeMonthlyTabTitle(" may\u00a026 ")).toBe("MAY 26");
  });

  it("parses two digit receipt dates as the current century calendar date", () => {
    const date = parseSheetTargetDate("5/12/26 9:25", new Date(2026, 0, 1));
    expect(format(date, "yyyy-MM-dd")).toBe("2026-05-12");
  });

  it("falls back when receipt date is unreadable", () => {
    const fallback = new Date(2026, 4, 12);
    expect(parseSheetTargetDate("not a date", fallback)).toBe(fallback);
  });
});
