import { describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { actionableDates, remainingWeekHorizon } from "./weeklyMissionReadiness";
import { resolveRelativeInstruction } from "./relativeInstruction";
import { withUtcTimezone } from "../server/db";

const LA = "America/Los_Angeles";
const horizonAt = (instant: string) => {
  const now = new Date(instant);
  return remainingWeekHorizon({
    businessDate: formatInTimeZone(now, LA, "yyyy-MM-dd"),
    localTime: formatInTimeZone(now, LA, "HH:mm"),
  });
};

describe("late-evening mission dating", () => {
  it("9:35 PM Pacific on Tuesday plans from Wednesday (the production case)", () => {
    // 2026-10-14T04:35Z is Tue Oct 13, 9:35 PM PDT.
    expect(actionableDates(horizonAt("2026-10-14T04:35:44Z"))[0]).toBe("2026-10-14");
  });
  it("mid-afternoon still includes today", () => {
    expect(actionableDates(horizonAt("2026-10-13T21:00:00Z"))[0]).toBe("2026-10-13");
  });
  it("just after local midnight, the new day is actionable", () => {
    // Oct 14, 00:05 PDT.
    expect(actionableDates(horizonAt("2026-10-14T07:05:00Z"))[0]).toBe("2026-10-14");
  });
  it("Friday evening leaves nothing this week, so preparation rolls to next week", () => {
    expect(actionableDates(horizonAt("2026-10-17T03:00:00Z"))).toEqual([]); // Fri Oct 16, 8 PM
  });
  it("daylight-saving start and end use local wall-clock time, not a fixed offset", () => {
    // Mon Mar 9 2026 (PDT, UTC-7): 23:30Z is 4:30 PM, still actionable.
    expect(actionableDates(horizonAt("2026-03-09T23:30:00Z"))[0]).toBe("2026-03-09");
    // Mon Nov 2 2026 (PST, UTC-8): 01:30Z on Nov 3 is 5:30 PM Nov 2, closed.
    expect(actionableDates(horizonAt("2026-11-03T01:30:00Z"))[0]).toBe("2026-11-03");
  });
});

describe("stale relative deadlines", () => {
  it("uses the recorded due time instead of re-reading 'in 3 hours' now", () => {
    const r = resolveRelativeInstruction({
      text: "Email Dana in 3 hours",
      referenceAt: new Date("2026-08-07T18:50:14Z"),
      dueAt: new Date("2026-08-07T22:00:00Z"),
      timeZone: LA,
    });
    expect(r.text).toBe("Email Dana (due Aug 7, 3:00 PM)");
    expect(r.resolvedAt?.toISOString()).toBe("2026-08-07T22:00:00.000Z");
  });
  it("resolves against when it was written when no due time exists", () => {
    const r = resolveRelativeInstruction({ text: "Call Andrew in 2 hours", referenceAt: new Date("2026-10-01T16:00:00Z"), timeZone: LA });
    expect(r.text).toBe("Call Andrew (due Oct 1, 11:00 AM)");
  });
  it("marks timing unresolved rather than guessing when the reference is missing", () => {
    expect(resolveRelativeInstruction({ text: "Text Yeran tomorrow", referenceAt: null, timeZone: LA })).toMatchObject({
      text: "Text Yeran tomorrow (timing unresolved)",
      unresolved: true,
    });
  });
  it("leaves instructions without relative timing untouched", () => {
    expect(resolveRelativeInstruction({ text: "Visit The Louise", referenceAt: new Date(), timeZone: LA }).text).toBe("Visit The Louise");
  });
});

describe("database client timezone", () => {
  it("pins the MySQL client to UTC without overriding an explicit setting", () => {
    expect(withUtcTimezone("mysql://u:p@h:3306/db")).toBe("mysql://u:p@h:3306/db?timezone=Z");
    expect(withUtcTimezone("mysql://u:p@h:3306/db?timezone=local")).toContain("timezone=local");
  });
});

describe("day-precision references", () => {
  it("a copied obligation resolves to its original date without inventing a time", () => {
    const r = resolveRelativeInstruction({ text: "Email Dana in 3 hours", referenceAt: new Date("2026-08-07T19:00:00Z"), referencePrecision: "day", timeZone: LA });
    expect(r.text).toBe("Email Dana (due Aug 7)");
  });
});
