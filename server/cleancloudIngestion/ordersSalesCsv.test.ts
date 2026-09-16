import { describe, expect, it } from "vitest";
import {
  parseOrdersSalesCsv,
  validateOrdersSalesExportUrl,
  validateOrdersSalesRange,
} from "./ordersSalesCsv";

const header = [
  "Order ID",
  "Placed",
  "Customer",
  "Customer ID",
  "Address",
  "Paid",
  "Payment Date",
  "Total",
].join(",");

describe("Orders (Sales) canonical parser", () => {
  it("parses quoted commas without losing source columns", () => {
    const rows = parseOrdersSalesCsv(
      `${header}\n123,2026-09-15 10:00:00,"Smith, Jane",77,"2170 Century Park E, Los Angeles",yes,2026-09-15 10:05:00,$42.50\n`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.Customer).toBe("Smith, Jane");
    expect(rows[0]?.["Order ID"]).toBe("123");
  });

  it("accepts a UTF-8 BOM without changing the CSV business content", () => {
    const rows = parseOrdersSalesCsv(
      `\uFEFF${header}\n123,2026-09-15 10:00:00,Jane,77,LA,yes,2026-09-15 10:05:00,$42.50\n`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["Order ID"]).toBe("123");
  });

  it("rejects html/login responses", () => {
    expect(() => parseOrdersSalesCsv("<html>sign in</html>")).toThrow(/page instead of CSV/i);
  });

  it("rejects duplicate source order ids", () => {
    const row = "123,2026-09-15,Jane,77,LA,yes,2026-09-15,$10";
    expect(() => parseOrdersSalesCsv(`${header}\n${row}\n${row}\n`)).toThrow(/duplicate order ID/i);
  });

  it("keeps the 32-day source-window invariant", () => {
    expect(validateOrdersSalesRange("2026-08-15", "2026-09-15", "2026-09-15")).toEqual({
      from: "2026-08-15",
      to: "2026-09-15",
    });
    expect(() => validateOrdersSalesRange("2026-08-14", "2026-09-15", "2026-09-15")).toThrow(/32 calendar days/i);
  });

  it("validates the normal single-store CleanCloud export url", () => {
    const url =
      "https://cleancloudapp.com/include/data-export-endpoint.php?type=1&d1=15&m1=09&y1=2026&d2=15&m2=09&y2=2026&stores=%5B123%5D&group=";
    expect(validateOrdersSalesExportUrl(url, { from: "2026-09-15", to: "2026-09-15" }).storeId).toBe("123");
  });
});
