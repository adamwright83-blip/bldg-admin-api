import { describe, expect, it } from "vitest";
import { strategyActionDate } from "./strategicPreparation";

describe("Claire's strategy action and the operator's sales hold", () => {
  const planDates = ["2026-10-19", "2026-10-20", "2026-10-21"];
  const heldToday = { until: "2026-10-19" };

  it("sales work held today is proposed for the first open day", () => {
    expect(strategyActionDate(planDates, "account_acquisition", heldToday)).toBe("2026-10-20");
  });
  it("is not proposed at all when every plan date is held", () => {
    expect(strategyActionDate(planDates, "account_acquisition", { until: "2026-10-21" })).toBeUndefined();
  });
  it("recovery and investigation keep the first plan date; so does sales work with no hold", () => {
    expect(strategyActionDate(planDates, "retention", heldToday)).toBe("2026-10-19");
    expect(strategyActionDate(planDates, "investigation", heldToday)).toBe("2026-10-19");
    expect(strategyActionDate(planDates, "account_acquisition", null)).toBe("2026-10-19");
  });
});
