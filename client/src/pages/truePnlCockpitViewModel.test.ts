import { describe, expect, it } from "vitest";
import {
  addTenOrdersWhatIf,
  cockpitLevelCopy,
  generateCockpitMissions,
  moneyFromCents,
  percentLabel,
  sceneFromCloudLevel,
  warningBorderClass,
} from "./truePnlCockpitViewModel";

describe("true P&L cockpit view model", () => {
  it("formats operator-readable money and percentages", () => {
    expect(moneyFromCents(181000)).toBe("$1,810");
    expect(moneyFromCents(-19000)).toBe("-$190");
    expect(percentLabel(21.496)).toBe("21.5%");
    expect(percentLabel(null)).toBe("Setup needed");
  });

  it("labels core visual states clearly", () => {
    expect(cockpitLevelCopy("cliff")).toMatchObject({
      label: "Cliff",
      subtitle: "Loss zone",
      sentence: "Losing money. Pull up now.",
    });
    expect(cockpitLevelCopy("hover")).toMatchObject({
      label: "Hover",
      subtitle: "Barely profitable / fragile",
    });
    expect(cockpitLevelCopy("cloud3")).toMatchObject({
      label: "Cloud 3",
      subtitle: "Elite",
    });
    expect(cockpitLevelCopy("setup_needed")).toMatchObject({
      label: "Setup Needed",
      subtitle: "Revenue rows are missing",
    });
  });

  it("keeps warning states visually distinct", () => {
    expect(warningBorderClass("critical")).toContain("red");
    expect(warningBorderClass("warning")).toContain("amber");
    expect(warningBorderClass("info")).toContain("sky");
  });

  it("maps cloud levels to replaceable scene states", () => {
    expect(sceneFromCloudLevel("cliff")).toBe("cliff");
    expect(sceneFromCloudLevel("hover")).toBe("hover");
    expect(sceneFromCloudLevel("cloud1")).toBe("cloud1");
    expect(sceneFromCloudLevel("cloud2")).toBe("cloud2");
    expect(sceneFromCloudLevel("cloud3")).toBe("cloud3");
    expect(sceneFromCloudLevel("setup_needed")).toBe("hover");
  });

  it("generates missions from true P&L state without fake impact dollars", () => {
    expect(
      generateCockpitMissions({
        cloudLevel: "cliff",
        trueNetCents: -12_000,
        grossRevenueCents: 92_000,
        expensePressurePct: 113,
      }).map(mission => mission.title)
    ).toEqual([
      "Recover the period",
      "Reduce biggest drag",
      "Add profitable orders",
    ]);

    expect(
      generateCockpitMissions({
        cloudLevel: "cloud2",
        trueNetCents: 181_000,
        grossRevenueCents: 842_000,
        expensePressurePct: 78.5,
      }).map(mission => mission.title)
    ).toEqual(["Reduce biggest drag", "Scale carefully"]);
  });

  it("keeps the add-ten-orders what-if unavailable without average order value", () => {
    expect(addTenOrdersWhatIf({ trueNetCents: 72_00 })).toMatchObject({
      available: false,
    });
    expect(
      addTenOrdersWhatIf({ trueNetCents: 72_00, averageOrderValueCents: 4_600 })
    ).toMatchObject({
      available: true,
      projectedRevenueCents: 46_000,
      projectedTrueNetCents: 53_200,
    });
  });
});
