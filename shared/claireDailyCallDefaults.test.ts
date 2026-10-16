import { describe, expect, it } from "vitest";
import { CLAIRE_DAILY_CALL_DEFAULTS, matchesClaireDailyCallDefaults } from "./claireDailyCallDefaults";

describe("Claire daily call defaults", () => {
  it("recommends 7:30 AM and 6:30 PM Pacific business-local starts every day", () => {
    const morning = CLAIRE_DAILY_CALL_DEFAULTS.morning_readiness;
    const evening = CLAIRE_DAILY_CALL_DEFAULTS.evening_debrief;
    expect(morning).toMatchObject({ start: "07:30", end: "08:00", weekdays: [1, 2, 3, 4, 5, 6, 7] });
    expect(evening).toMatchObject({ start: "18:30", end: "19:00", weekdays: [1, 2, 3, 4, 5, 6, 7] });
  });

  it("flags existing wider or Monday-Saturday grants for an explicit operator update", () => {
    expect(matchesClaireDailyCallDefaults("morning_readiness", {
      weekdays: [1, 2, 3, 4, 5, 6, 7], localStart: "07:30", localEnd: "09:00",
    })).toBe(false);
    expect(matchesClaireDailyCallDefaults("evening_debrief", {
      weekdays: [1, 2, 3, 4, 5, 6], localStart: "17:30", localEnd: "19:00",
    })).toBe(false);
  });

  it("accepts only the exact canonical schedule; weekday order does not matter", () => {
    expect(matchesClaireDailyCallDefaults("evening_debrief", {
      weekdays: [7, 6, 5, 4, 3, 2, 1], localStart: "18:30", localEnd: "19:00",
    })).toBe(true);
    expect(matchesClaireDailyCallDefaults("morning_readiness", {
      weekdays: [1, 2, 3, 4, 5, 6, 7], localStart: "07:30", localEnd: "08:00",
    })).toBe(true);
    expect(matchesClaireDailyCallDefaults("morning_readiness", null)).toBe(false);
  });
});
