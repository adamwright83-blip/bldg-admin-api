import { describe, expect, it } from "vitest";
import { periodMatches, requestedPeriod } from "../executive/requestedPeriod";

describe("requested period", () => {
  it("recognizes unambiguous periods", () => {
    expect(requestedPeriod("What were my sales last week?")?.kind).toBe("last_week");
    expect(requestedPeriod("how much did we make yesterday")?.kind).toBe("yesterday");
    expect(requestedPeriod("revenue for the last 30 days")).toMatchObject({ kind: "trailing_days", days: 30 });
    expect(requestedPeriod("orders this month")?.kind).toBe("this_month");
    expect(requestedPeriod("sales this past week")).toBeNull();
    expect(requestedPeriod("what were my last five sales")).toBeNull();
  });
  it("matches only the exact executed period", () => {
    const lastWeek = requestedPeriod("last week")!;
    expect(periodMatches(lastWeek, { kind: "last_week" })).toBe(true);
    expect(periodMatches(lastWeek, { kind: "trailing_days", days: 30 })).toBe(false);
    expect(periodMatches(requestedPeriod("last 7 days")!, { kind: "trailing_days", days: 30 })).toBe(false);
  });
});
