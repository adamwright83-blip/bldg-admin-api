import { describe, expect, it } from "vitest";
import { resolveMonthlyTabName } from "./sheets";
import {
  buildTruePnlCockpitSummary,
  parseTruePnlMonth,
  resolveTruePnlCloudLevel,
} from "./truePnlCockpit";

function juneValues(): unknown[][] {
  return [
    ["", "2026-06-01", "2026-06-02", "2026-07-01"],
    ["CleanCloud Revenue", "4000.00", "4420.00", "9999.00"],
    ["Store Labor", "900.00", "980.00", ""],
    ["Driver / Operator Pay", "1600.00", "1600.00", ""],
    ["Other Expenses", "200.00", "212.00", ""],
    ["Car Insurance", "260.00", "", ""],
    ["Other Vehicle Cost", "50.00", "68.00", ""],
    ["LB Cost of Dry Cleaning", "370.00", "370.00", ""],
  ];
}

describe("True P&L Cockpit", () => {
  it("resolves JUN 26 and JUNE 26 monthly tabs through the shared Sheet aliases", () => {
    expect(resolveMonthlyTabName(["JUN 26"], "JUN 26")).toBe("JUN 26");
    expect(resolveMonthlyTabName(["JUNE 26"], "JUN 26")).toBe("JUNE 26");
    expect(resolveMonthlyTabName(["JUNE 26", "JUN 26"], "JUN 26")).toBe(
      "JUN 26"
    );
  });

  it("matches aliases and sums only date columns inside the selected month", () => {
    const summary = buildTruePnlCockpitSummary({
      monthDate: parseTruePnlMonth("2026-06"),
      current: { tabName: "JUN 26", values: juneValues() },
      generatedAt: new Date("2026-06-15T12:00:00.000Z"),
    });

    expect(summary.dateColumnCount).toBe(2);
    expect(summary.grossRevenueCents).toBe(842000);
    expect(summary.totalExpenseCents).toBe(661000);
    expect(summary.trueNetCents).toBe(181000);
    expect(summary.cloudLevel).toBe("cloud2");
    expect(
      summary.lines.find(line => line.key === "gasFuel")?.matchedLabels
    ).toEqual(["Other Expenses"]);
    expect(
      summary.lines.find(line => line.key === "vehicleInsurance")?.matchedLabels
    ).toEqual(["Car Insurance"]);
  });

  it("computes true net from gross revenue minus the required expense groups", () => {
    const summary = buildTruePnlCockpitSummary({
      monthDate: parseTruePnlMonth("2026-06"),
      current: { tabName: "JUN 26", values: juneValues() },
    });

    expect(summary.lines.map(line => line.label)).toContain(
      "CleanCloud / gross revenue"
    );
    expect(summary.grossRevenueCents - summary.totalExpenseCents).toBe(
      summary.trueNetCents
    );
    expect(summary.marginPct).toBeCloseTo(21.496, 2);
    expect(summary.expensePressurePct).toBeCloseTo(78.503, 2);
  });

  it("uses both true-net dollars and margin for cloud levels", () => {
    expect(
      resolveTruePnlCloudLevel({
        grossRevenueCents: 100000,
        trueNetCents: -1,
        trusted: true,
      })
    ).toBe("cliff");
    expect(
      resolveTruePnlCloudLevel({
        grossRevenueCents: 1000000,
        trueNetCents: 40000,
        trusted: true,
      })
    ).toBe("hover");
    expect(
      resolveTruePnlCloudLevel({
        grossRevenueCents: 1000000,
        trueNetCents: 50000,
        trusted: true,
      })
    ).toBe("cloud1");
    expect(
      resolveTruePnlCloudLevel({
        grossRevenueCents: 1000000,
        trueNetCents: 150000,
        trusted: true,
      })
    ).toBe("cloud2");
    expect(
      resolveTruePnlCloudLevel({
        grossRevenueCents: 1200000,
        trueNetCents: 300000,
        trusted: true,
      })
    ).toBe("cloud3");
    expect(
      resolveTruePnlCloudLevel({
        grossRevenueCents: 100000,
        trueNetCents: 30000,
        trusted: true,
      })
    ).toBe("hover");
  });

  it("counts missing optional expense rows as zero and warns", () => {
    const summary = buildTruePnlCockpitSummary({
      monthDate: parseTruePnlMonth("2026-06"),
      current: {
        tabName: "JUN 26",
        values: [
          ["", "2026-06-01"],
          ["Pickup & Delivery Revenue", "1000.00"],
          ["Store Labor", "100.00"],
        ],
      },
    });

    expect(summary.grossRevenueCents).toBe(100000);
    expect(summary.totalExpenseCents).toBe(10000);
    expect(
      summary.warnings.some(
        warning => warning.code === "missing_optional_expense_rows"
      )
    ).toBe(true);
  });

  it("marks the cockpit untrusted when core revenue rows are missing", () => {
    const summary = buildTruePnlCockpitSummary({
      monthDate: parseTruePnlMonth("2026-06"),
      current: {
        tabName: "JUN 26",
        values: [
          ["", "2026-06-01"],
          ["Store Labor", "100.00"],
        ],
      },
    });

    expect(summary.trusted).toBe(false);
    expect(summary.cloudLevel).toBe("setup_needed");
    expect(
      summary.warnings.some(
        warning => warning.code === "missing_core_revenue_rows"
      )
    ).toBe(true);
  });

  it("does not require a previous-month tab", () => {
    const summary = buildTruePnlCockpitSummary({
      monthDate: parseTruePnlMonth("2026-06"),
      current: { tabName: "JUN 26", values: juneValues() },
      previous: null,
    });

    expect(summary.previousMonth).toBeNull();
  });

  it("slices today / week / month from the daily date columns", () => {
    // 8 days of June: $100 revenue and $10 store labor each day.
    const header = ["", ...Array.from({ length: 8 }, (_, i) => `2026-06-0${i + 1}`)];
    const values: unknown[][] = [
      header,
      ["CleanCloud Revenue", ...Array(8).fill("100.00")],
      ["Store Labor", ...Array(8).fill("10.00")],
    ];
    const base = {
      monthDate: parseTruePnlMonth("2026-06"),
      current: { tabName: "JUN 26", values },
    } as const;

    const month = buildTruePnlCockpitSummary({ ...base, period: "month" });
    const week = buildTruePnlCockpitSummary({ ...base, period: "week" });
    const today = buildTruePnlCockpitSummary({ ...base, period: "today" });

    // month = all 8 days; week = last 7; today = last 1 — real different numbers.
    expect(month.grossRevenueCents).toBe(80000);
    expect(month.trueNetCents).toBe(72000);
    expect(week.grossRevenueCents).toBe(70000);
    expect(week.trueNetCents).toBe(63000);
    expect(today.grossRevenueCents).toBe(10000);
    expect(today.trueNetCents).toBe(9000);

    expect(month.period).toBe("month");
    expect(today.period).toBe("today");
    // today compares against yesterday from the same sheet
    expect(today.previousMonth?.trueNetCents).toBe(9000);
    expect(today.previousMonth?.monthLabel).toBe("Yesterday");
  });

  it("warns when revenue is recorded but expenses are not entered", () => {
    const summary = buildTruePnlCockpitSummary({
      monthDate: parseTruePnlMonth("2026-06"),
      current: {
        tabName: "JUN 26",
        values: [
          ["", "2026-06-01"],
          ["CleanCloud Revenue", "500.00"],
        ],
      },
    });

    expect(summary.grossRevenueCents).toBe(50000);
    expect(summary.totalExpenseCents).toBe(0);
    expect(
      summary.warnings.some(w => w.code === "expenses_not_entered")
    ).toBe(true);
  });
});
