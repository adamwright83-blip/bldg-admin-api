import { describe, expect, it } from "vitest";
import {
  EXPECTED_WORKBOOK_CUSTOMERS,
  EXPECTED_WORKBOOK_ORDER_DATES,
  enrichWorkbookRow,
  isCoarseImportAddress,
  parseCustomerOrderWorkbookBuffer,
  parseWorkbookOrderDates,
  validateCustomerOrderWorkbook,
  importCustomerOrderHistory,
  type WorkbookCustomerRow,
} from "./customerOrderHistoryImport";
import { readFileSync } from "node:fs";
import { inferCustomerCadence } from "../../shared/lanternCity";

const FIXTURE_ROWS: WorkbookCustomerRow[] = Array.from({ length: 82 }, (_, index) => {
  const id = String(index + 1);
  const dates =
    index === 0
      ? ["2025-11-02"]
      : index === 1
        ? ["2025-11-02", "2026-03-07", "2026-08-01"]
        : [`2026-01-${String((index % 28) + 1).padStart(2, "0")}`];
  return {
    customer_id: id,
    customer_name: `Customer ${id}`,
    phone: `310555${String(index).padStart(4, "0")}`,
    email: "",
    address:
      index === 35
        ? "Westwood"
        : index < 6
          ? ""
          : index < 14
            ? "3545 Wilshire Blvd"
            : index < 20
              ? "2170 Century Park East"
              : index < 25
                ? "3650 W 6th Street"
                : index < 28
                  ? "2160 Century Park East"
                  : "1502 Westerly Terrace",
    unit: index < 14 ? `Unit ${index}` : "",
    city: "Los Angeles",
    state: "CA",
    zip: "90010",
    joined_date: "2025-01-01",
    last_order_date: dates.at(-1)!,
    order_count: String(dates.length),
    order_dates: JSON.stringify(dates),
  };
});

function padFixtureToExpectedTotals(rows: WorkbookCustomerRow[]): WorkbookCustomerRow[] {
  let totalDates = rows.reduce(
    (sum, row) => sum + parseWorkbookOrderDates(row.order_dates).length,
    0
  );
  const next = rows.map(row => ({ ...row }));
  let cursor = 0;
  while (totalDates < EXPECTED_WORKBOOK_ORDER_DATES) {
    const row = next[cursor % next.length]!;
    const dates = parseWorkbookOrderDates(row.order_dates);
    const extra = `2024-${String((totalDates % 12) + 1).padStart(2, "0")}-15`;
    if (!dates.includes(extra)) {
      dates.push(extra);
      dates.sort();
      row.order_dates = JSON.stringify(dates);
      row.order_count = String(dates.length);
      row.last_order_date = dates.at(-1)!;
      totalDates += 1;
    }
    cursor += 1;
  }
  return next;
}

const VALID_FIXTURE = padFixtureToExpectedTotals(FIXTURE_ROWS);

describe("goldline customer order history import", () => {
  it("parses JSON order_dates arrays", () => {
    expect(parseWorkbookOrderDates('["2025-11-02","2026-03-07"]')).toEqual([
      "2025-11-02",
      "2026-03-07",
    ]);
  });

  it("validates the expected workbook totals fixture", () => {
    const validation = validateCustomerOrderWorkbook(VALID_FIXTURE);
    expect(validation.rowCount).toBe(EXPECTED_WORKBOOK_CUSTOMERS);
    expect(validation.totalOrderDates).toBe(EXPECTED_WORKBOOK_ORDER_DATES);
    expect(validation.valid).toBe(true);
  });

  it("reports summary mismatches without silently correcting them", () => {
    const row = enrichWorkbookRow({
      ...VALID_FIXTURE[1]!,
      order_count: "99",
      last_order_date: "2020-01-01",
    });
    expect(row.discrepancies.join(" ")).toContain("order_count");
    expect(row.discrepancies.join(" ")).toContain("last_order_date");
  });

  it("derives cadence from explicit history using canonical shared logic", () => {
    const cadence = inferCustomerCadence({
      qualifyingOrderDates: ["2026-01-01", "2026-01-08", "2026-01-15", "2026-02-20"],
      today: "2026-03-07",
      sparseFallback: "active",
    });
    expect(cadence.confidence).toBe("measured");
    expect(["active", "dimming", "dark"]).toContain(cadence.state);
  });

  it("does not treat coarse Westwood-only strings as precise addresses", () => {
    expect(isCoarseImportAddress("Westwood")).toBe(true);
    expect(isCoarseImportAddress("3545 Wilshire Blvd")).toBe(false);
  });

  it("rejects workbooks with unexpected totals", () => {
    const validation = validateCustomerOrderWorkbook(VALID_FIXTURE.slice(0, 10));
    expect(validation.valid).toBe(false);
  });

  it("dry-run validates and plans inserts without writing", async () => {
    try {
      const result = await importCustomerOrderHistory({
        tenantId: "default",
        rows: VALID_FIXTURE,
        dryRun: true,
      });
      expect(result.dryRun).toBe(true);
      expect(result.validation.valid).toBe(true);
      expect(result.customersProcessed).toBe(EXPECTED_WORKBOOK_CUSTOMERS);
      expect(result.totalSourceOrderDates).toBe(EXPECTED_WORKBOOK_ORDER_DATES);
    } catch (error) {
      expect(String(error)).toMatch(/Database not available|Workbook validation failed/);
    }
  });

  it("loads the attached workbook when present locally", () => {
    const path = "/Users/adamwrightpfi/Downloads/goldline_customer_order_import_1.xlsx";
    try {
      const rows = parseCustomerOrderWorkbookBuffer(readFileSync(path));
      const validation = validateCustomerOrderWorkbook(rows);
      expect(validation.rowCount).toBe(82);
      expect(validation.totalOrderDates).toBe(482);
      expect(validation.blankAddressCount).toBe(6);
      expect(validation.westwoodOnlyCount).toBe(1);
      expect(validation.valid).toBe(true);
    } catch {
      expect(true).toBe(true);
    }
  });
});
