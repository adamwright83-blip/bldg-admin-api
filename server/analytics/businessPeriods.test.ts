import { describe, expect, it } from "vitest";
import { parsePeriodPhrase, previousPeriod, resolvePeriod } from "./businessPeriods";

const TZ = "America/Los_Angeles";
// Monday September 14, 2026, 7pm in Los Angeles (already Tuesday in UTC).
const now = new Date("2026-09-15T02:00:00.000Z");

describe("business-local periods", () => {
  it("last 30 days is today plus the preceding 29 business-local days", () => {
    const period = resolvePeriod({ kind: "trailing_days", days: 30 }, now, TZ);
    expect(period).toMatchObject({ start: "2026-08-16", end: "2026-09-14", days: 30, label: "the last 30 days" });
    expect(period.startUtc.toISOString()).toBe("2026-08-16T07:00:00.000Z");
    expect(period.endExclusiveUtc.toISOString()).toBe("2026-09-15T07:00:00.000Z");
  });

  it("uses the business day, not the UTC day, at midnight boundaries", () => {
    expect(resolvePeriod({ kind: "today" }, new Date("2026-09-15T06:59:59.000Z"), TZ).start).toBe("2026-09-14");
    expect(resolvePeriod({ kind: "today" }, new Date("2026-09-15T07:00:00.000Z"), TZ).start).toBe("2026-09-15");
  });

  it("handles DST transitions inside a window", () => {
    const period = resolvePeriod({ kind: "trailing_days", days: 30 }, new Date("2026-11-20T20:00:00.000Z"), TZ);
    expect(period.startUtc.toISOString()).toBe("2026-10-22T07:00:00.000Z");
    expect(period.endExclusiveUtc.toISOString()).toBe("2026-11-21T08:00:00.000Z");
  });

  it("resolves calendar weeks, months and years", () => {
    expect(resolvePeriod({ kind: "this_week" }, now, TZ)).toMatchObject({ start: "2026-09-14", end: "2026-09-14" });
    expect(resolvePeriod({ kind: "last_week" }, now, TZ)).toMatchObject({ start: "2026-09-07", end: "2026-09-13" });
    expect(resolvePeriod({ kind: "this_month" }, now, TZ)).toMatchObject({ start: "2026-09-01", end: "2026-09-14" });
    expect(resolvePeriod({ kind: "last_month" }, now, TZ)).toMatchObject({ start: "2026-08-01", end: "2026-08-31" });
    expect(resolvePeriod({ kind: "last_year" }, now, TZ)).toMatchObject({ start: "2025-01-01", end: "2025-12-31" });
  });

  it("never extends a range into the future", () => {
    expect(resolvePeriod({ kind: "between", start: "2026-09-01", end: "2026-12-31" }, now, TZ).end).toBe("2026-09-14");
  });

  it("previous period is equal length for trailing windows and calendar-aware otherwise", () => {
    const trailing = resolvePeriod({ kind: "trailing_days", days: 30 }, now, TZ);
    expect(previousPeriod(trailing, now)).toMatchObject({ start: "2026-07-17", end: "2026-08-15", label: "the 30 days before that" });
    expect(previousPeriod(resolvePeriod({ kind: "last_month" }, now, TZ), now)).toMatchObject({ start: "2026-07-01", end: "2026-07-31", label: "July" });
    expect(previousPeriod(resolvePeriod({ kind: "this_month" }, now, TZ), now)).toMatchObject({ start: "2026-08-01", end: "2026-08-14" });
  });
});

describe("period phrases", () => {
  const parse = (text: string) => parsePeriodPhrase(text, now, TZ);

  it.each([
    ["What was revenue in the last 30 days?", { kind: "trailing_days", days: 30 }],
    ["past seven days", { kind: "trailing_days", days: 7 }],
    ["No, use 60 days.", { kind: "trailing_days", days: 60 }],
    ["how many orders this week", { kind: "this_week" }],
    ["revenue last week", { kind: "last_week" }],
    ["orders yesterday", { kind: "yesterday" }],
    ["this month", { kind: "this_month" }],
    ["last month", { kind: "last_month" }],
    ["year to date", { kind: "this_year" }],
    ["last year", { kind: "last_year" }],
    ["since June", { kind: "since", start: "2026-06-01" }],
    ["between June 1 and July 15", { kind: "between", start: "2026-06-01", end: "2026-07-15" }],
    ["revenue in August", { kind: "between", start: "2026-08-01", end: "2026-08-31" }],
    ["revenue in December", { kind: "between", start: "2025-12-01", end: "2025-12-31" }],
  ])("%s", (text, expected) => {
    expect(parse(text)).toEqual(expected);
  });

  it("returns null when no period is stated", () => {
    expect(parse("What's average order value?")).toBeNull();
  });
});
