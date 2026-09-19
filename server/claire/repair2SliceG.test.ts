import { describe, expect, it } from "vitest";
import {
  CLAIRE_REPAIR2_G_MIN_TURNS,
  CLAIRE_REPAIR2_G_MIN_WINDOW_DAYS,
  arbitrateClaireRepair2,
} from "./repair2SliceG";

describe("Slice G — live arbiter", () => {
  it("refuses to arbitrate a short window even with many turns", () => {
    const result = arbitrateClaireRepair2({
      observedSpanDays: CLAIRE_REPAIR2_G_MIN_WINDOW_DAYS - 1,
      telemetryEnabled: true,
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
      observedSpanDays: 7,
      telemetryEnabled: true,
      totalTurns: CLAIRE_REPAIR2_G_MIN_TURNS - 1,
      reachedFollowUpModelShare: 0.4,
      rendererProseShare: 0.3,
      fallbackShare: 0.1,
    });
    expect(result.status).toBe("insufficient_data");
    expect(result.reason).toContain(String(CLAIRE_REPAIR2_G_MIN_TURNS - 1));
  });

  it("refuses when routing telemetry is disabled even with enough history", () => {
    const result = arbitrateClaireRepair2({
      observedSpanDays: 30,
      telemetryEnabled: false,
      totalTurns: 900,
      reachedFollowUpModelShare: 0.4,
      rendererProseShare: 0.3,
      fallbackShare: 0.1,
    });
    expect(result.status).toBe("insufficient_data");
    expect(result.readyToArbitrate).toBe(false);
  });

  it("uses observed coverage, not a wide requested window (1 real day of a 90-day request)", () => {
    const result = arbitrateClaireRepair2({
      observedSpanDays: 1,
      telemetryEnabled: true,
      totalTurns: 500,
      reachedFollowUpModelShare: 0.4,
      rendererProseShare: 0.3,
      fallbackShare: 0.1,
    });
    expect(result.status).toBe("insufficient_data");
    if (result.status === "insufficient_data") expect(result.reason).toContain("observed 1");
  });

  it("reports shares without declaring the program a success", () => {
    const result = arbitrateClaireRepair2({
      observedSpanDays: 7,
      telemetryEnabled: true,
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

  it("seven distinct dates spanning under seven elapsed days is insufficient", () => {
    // e.g. 6 days 23h between first and last row can still touch 8 calendar dates.
    const result = arbitrateClaireRepair2({
      observedSpanDays: 6 + 23 / 24,
      telemetryEnabled: true,
      totalTurns: 400,
      reachedFollowUpModelShare: 0.3,
      rendererProseShare: 0.3,
      fallbackShare: 0.1,
    });
    expect(result.status).toBe("insufficient_data");
  });

  it("exactly seven elapsed days with enough turns and the flag on is comparable", () => {
    const result = arbitrateClaireRepair2({
      observedSpanDays: 7,
      telemetryEnabled: true,
      totalTurns: 50,
      reachedFollowUpModelShare: 0.3,
      rendererProseShare: 0.3,
      fallbackShare: 0.1,
    });
    expect(result.status).toBe("comparable");
  });
});
