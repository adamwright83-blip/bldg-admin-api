import { describe, expect, it } from "vitest";
import { salesLevelFromRecentWins, scoreWalkInForLevel } from "./adaptiveSalesMeter";

describe("adaptive sales meter", () => {
  it("makes a real Level 1 Louise-style visit move roughly a third of the bar", () => {
    const points = scoreWalkInForLevel({
      conversationNotes: "Spoke with general manager Dana. He agreed to post the collateral in the mail room.",
      visitResult: "follow_up",
      nextAction: "Email Dana the flyer today",
      collateralDelivered: false,
      quoteRequested: false,
      pilotRequested: false,
    }, 1);
    expect(points).toBeGreaterThanOrEqual(36);
    expect(points / 120).toBeGreaterThanOrEqual(0.3);
  });

  it("makes the exact same basic visit worth much less after the driver levels up", () => {
    const visit = {
      conversationNotes: "Spoke with general manager Dana. He agreed to post the collateral in the mail room.",
      visitResult: "follow_up",
      nextAction: "Email Dana the flyer today",
    };
    const level1 = scoreWalkInForLevel(visit, 1);
    const level4 = scoreWalkInForLevel(visit, 4);
    expect(level4).toBeLessThan(level1 / 3);
  });

  it("raises the level based on recent closed wins", () => {
    expect(salesLevelFromRecentWins(0)).toBe(1);
    expect(salesLevelFromRecentWins(1)).toBe(2);
    expect(salesLevelFromRecentWins(3)).toBe(3);
    expect(salesLevelFromRecentWins(6)).toBe(4);
  });
});
