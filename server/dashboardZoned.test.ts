import { describe, expect, it } from "vitest";
import { getBusinessDayWindow, zonedNextDayYmd } from "./dashboardZoned";

const LA = "America/Los_Angeles";

describe("Goldline business-day window", () => {
  it("advances local calendar labels without fixed-duration arithmetic", () => {
    expect(zonedNextDayYmd("2026-03-08", LA)).toBe("2026-03-09");
    expect(zonedNextDayYmd("2026-11-01", LA)).toBe("2026-11-02");
    expect(zonedNextDayYmd("2026-12-31", LA)).toBe("2027-01-01");
  });

  it("uses a 23-hour window across spring forward", () => {
    const window = getBusinessDayWindow(new Date("2026-03-08T18:00:00Z"), LA);
    expect(window.businessDate).toBe("2026-03-08");
    expect(window.startUtc.toISOString()).toBe("2026-03-08T08:00:00.000Z");
    expect(window.endExclusiveUtc.toISOString()).toBe(
      "2026-03-09T07:00:00.000Z"
    );
  });

  it("uses a 25-hour window across fall back", () => {
    const window = getBusinessDayWindow(new Date("2026-11-01T18:00:00Z"), LA);
    expect(window.businessDate).toBe("2026-11-01");
    expect(window.startUtc.toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(window.endExclusiveUtc.toISOString()).toBe(
      "2026-11-02T08:00:00.000Z"
    );
  });

  it("uses an ordinary 24-hour window", () => {
    const window = getBusinessDayWindow(new Date("2026-08-30T18:00:00Z"), LA);
    expect(window.endExclusiveUtc.getTime() - window.startUtc.getTime()).toBe(
      24 * 60 * 60 * 1000
    );
  });
});
