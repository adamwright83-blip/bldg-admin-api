import { describe, expect, it } from "vitest";
import {
  cockpitLevelCopy,
  moneyFromCents,
  percentLabel,
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
});
