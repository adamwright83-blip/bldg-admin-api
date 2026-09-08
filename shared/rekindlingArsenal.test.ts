import { describe, expect, it } from "vitest";
import {
  ARSENAL_TOOLS,
  cooldownVerdict,
  goldenSealCost,
  rekindlingStateFor,
  sentLine,
} from "./rekindlingArsenal";

describe("rekindling state follows the impact ladder", () => {
  it("attested effort is a spark and nothing more", () => {
    expect(rekindlingStateFor(null)).toBe("dark");
    expect(rekindlingStateFor("observation")).toBe("dark");
    expect(rekindlingStateFor("field_activity")).toBe("spark");
  });
  it("only a real reply makes an ember, only an order makes a flame", () => {
    expect(rekindlingStateFor("response")).toBe("ember");
    expect(rekindlingStateFor("opportunity")).toBe("ember");
    expect(rekindlingStateFor("customer_outcome")).toBe("flame");
    expect(rekindlingStateFor("economic_outcome")).toBe("flame");
  });
});

describe("cooldowns are real", () => {
  it("blocks a second flare inside seven business days", () => {
    expect(
      cooldownVerdict({ tool: "signal_flare", lastUsedBusinessDate: "2026-09-05", todayBusinessDate: "2026-09-08" })
    ).toEqual({ allowed: false, daysRemaining: 4, reason: "cooldown" });
  });
  it("allows once the window has passed, and always on first use", () => {
    expect(
      cooldownVerdict({ tool: "signal_flare", lastUsedBusinessDate: "2026-09-01", todayBusinessDate: "2026-09-08" })
    ).toEqual({ allowed: true });
    expect(cooldownVerdict({ tool: "golden_seal", lastUsedBusinessDate: null, todayBusinessDate: "2026-09-08" })).toEqual({ allowed: true });
  });
});

describe("truth classes and cost", () => {
  it("the only self-verifying tool is the offer", () => {
    const redeemable = Object.values(ARSENAL_TOOLS).filter(t => t.truthClass === "redeemable");
    expect(redeemable.map(t => t.id)).toEqual(["golden_seal"]);
  });
  it("tools that spend money say so", () => {
    expect(ARSENAL_TOOLS.golden_seal.costsMoney).toBe(true);
    expect(ARSENAL_TOOLS.signal_flare.costsMoney).toBe(false);
    expect(goldenSealCost({ discountPercent: 20, typicalOrderCents: 4500 })).toEqual({
      label: "20% off their next order, about $9.00 of real margin",
      estimatedCents: 900,
    });
    expect(goldenSealCost({ discountPercent: 20, typicalOrderCents: null }).estimatedCents).toBeNull();
  });
  it("copy never promises an answer", () => {
    for (const id of Object.keys(ARSENAL_TOOLS) as Array<keyof typeof ARSENAL_TOOLS>) {
      expect(sentLine(id).toLowerCase()).not.toMatch(/must answer|will answer|will return/);
    }
  });
});
