import { describe, expect, it } from "vitest";
import { scoreCustomerChurn } from "./scoreCustomerChurn";

describe("scoreCustomerChurn", () => {
  it("flags a valuable regular who has gone far beyond normal cadence", () => {
    const result = scoreCustomerChurn({
      customerKey: "sarah",
      customerName: "Sarah Johnson",
      orderDates: [
        "2026-01-01",
        "2026-01-15",
        "2026-01-29",
        "2026-02-12",
        "2026-02-26",
        "2026-03-12",
        "2026-03-26",
        "2026-04-09",
      ],
      orderValuesCents: [8600, 9100, 8800, 9300, 8700, 9200, 8900, 9400],
      orderWeightsLbs: [32, 34, 33, 35, 34, 30, 25, 20],
      now: new Date("2026-07-12T12:00:00.000Z"),
    });

    expect(result.grade).toBe("high");
    expect(result.recommendedAction).toBe("contact_now");
    expect(result.daysSinceLastOrder).toBeGreaterThan(80);
    expect(result.reasons.join(" ")).toMatch(/normal gap|cadence/i);
  });

  it("keeps an on-cadence customer in watch mode", () => {
    const result = scoreCustomerChurn({
      customerKey: "active",
      customerName: "Active Customer",
      orderDates: ["2026-06-01", "2026-06-15", "2026-06-29"],
      orderValuesCents: [4200, 4500, 4400],
      now: new Date("2026-07-10T12:00:00.000Z"),
    });

    expect(result.grade).toBe("low");
    expect(result.recommendedAction).toBe("watch");
  });

  it("increases risk when an unresolved issue accompanies the decline", () => {
    const base = {
      customerKey: "issue",
      customerName: "Issue Customer",
      orderDates: ["2026-04-01", "2026-04-15", "2026-04-29"],
      orderValuesCents: [6000, 6200, 6100],
      now: new Date("2026-06-10T12:00:00.000Z"),
    };
    const withoutIssue = scoreCustomerChurn(base);
    const withIssue = scoreCustomerChurn({ ...base, unresolvedIssue: true });

    expect(withIssue.score).toBeGreaterThan(withoutIssue.score);
    expect(withIssue.reasons.join(" ")).toMatch(/unresolved issue/i);
  });
});
