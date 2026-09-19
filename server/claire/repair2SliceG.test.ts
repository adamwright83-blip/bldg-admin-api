import { describe, expect, it } from "vitest";
import {
  CLAIRE_REPAIR2_G_MIN_TURNS,
  CLAIRE_REPAIR2_G_MIN_WINDOW_DAYS,
  arbitrateClaireRepair2,
} from "./repair2SliceG";

describe("Slice G — live arbiter", () => {
  it("refuses to arbitrate a short window even with many turns", () => {
    const result = arbitrateClaireRepair2({
      windowDays: CLAIRE_REPAIR2_G_MIN_WINDOW_DAYS - 1,
      totalTurns: 400,
      reachedFollowUpModelShare: 0.4,
      rendererProseShare: 0.3,
      fallbackShare: 0.1,
    });
    expect(result.status).toBe("insufficient_data");
    expect(result.readyToArbitrate).toBe(false);
  });

  it("refuses to arbitrate a week with too few turns", () => {
    const result = arbitrateClaireRepair2({
      windowDays: 7,
      totalTurns: CLAIRE_REPAIR2_G_MIN_TURNS - 1,
      reachedFollowUpModelShare: 0.4,
      rendererProseShare: 0.3,
      fallbackShare: 0.1,
    });
    expect(result.status).toBe("insufficient_data");
    expect(result.reason).toContain(String(CLAIRE_REPAIR2_G_MIN_TURNS - 1));
  });

  it("reports shares without declaring the program a success", () => {
    const result = arbitrateClaireRepair2({
      windowDays: 7,
      totalTurns: CLAIRE_REPAIR2_G_MIN_TURNS,
      reachedFollowUpModelShare: 0.22,
      rendererProseShare: 0.51,
      fallbackShare: 0.08,
    });
    expect(result.status).toBe("comparable");
    if (result.status !== "comparable") return;
    expect(result.readyToArbitrate).toBe(true);
    expect(result.shares.followUpModel).toBe(0.22);
    expect(result.observations.join(" ")).toMatch(/not a pass\/fail/i);
    expect(result.observations.join(" ")).toContain("does not declare the program a success");
  });
});
