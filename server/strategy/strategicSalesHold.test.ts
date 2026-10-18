import { describe, expect, it } from "vitest";
import { SALES_HOLD_SCOPES } from "../../shared/claireProactive";
import { strategyActionDate } from "./strategicPreparation";

describe("Claire's strategy action and the operator's sales hold", () => {
  const planDates = ["2026-10-19", "2026-10-20", "2026-10-21"];
  const heldToday = { until: "2026-10-19", scope: [...SALES_HOLD_SCOPES] };

  it("held sales work, win-backs included, is proposed for the first open day", () => {
    expect(strategyActionDate(planDates, "account_acquisition", heldToday)).toBe("2026-10-20");
    expect(strategyActionDate(planDates, "retention", heldToday)).toBe("2026-10-20");
  });
  it("is not proposed at all when every plan date is held", () => {
    expect(strategyActionDate(planDates, "account_acquisition", { ...heldToday, until: "2026-10-21" })).toBeUndefined();
  });
  it("a narrower hold moves only what it names; investigation and no hold keep the first plan date", () => {
    const acquisitionOnly = { until: "2026-10-19", scope: ["acquisition" as const] };
    expect(strategyActionDate(planDates, "account_acquisition", acquisitionOnly)).toBe("2026-10-20");
    expect(strategyActionDate(planDates, "retention", acquisitionOnly)).toBe("2026-10-19");
    expect(strategyActionDate(planDates, "investigation", heldToday)).toBe("2026-10-19");
    expect(strategyActionDate(planDates, "account_acquisition", null)).toBe("2026-10-19");
  });
});
