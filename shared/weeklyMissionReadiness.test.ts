import { describe, expect, it } from "vitest";
import {
  proposalItemExecutionWindow,
  capReadiness,
  defaultReadiness,
  deriveWeekStatus,
  emptyDraft,
  isWeeklyLockBind,
  isWeeklyRejection,
  parseDayMove,
  previousBusinessDay,
  proactiveWeeklyLine,
  remainingWeekHorizon,
  strategicPlanningHorizon,
  actionableDates,
  weeklySessionKey,
} from "./weeklyMissionReadiness";

describe("remaining week horizon", () => {
  it("keeps Monday at 15:10 as a remnant plus Tuesday through Friday", () => {
    const horizon = remainingWeekHorizon({ businessDate: "2026-09-21", localTime: "15:10" });
    expect(horizon.weekday).toBe("Monday");
    expect(horizon.todayIsRemnant).toBe(true);
    expect(horizon.localMinutes).toBe(15 * 60 + 10);
    expect(horizon.remainingDates).toEqual([
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
    ]);
    expect(horizon.weekStart).toBe("2026-09-21");
  });

  it("does not drop Monday because of the hour", () => {
    const morning = remainingWeekHorizon({ businessDate: "2026-09-21", localTime: "08:00" });
    const afternoon = remainingWeekHorizon({ businessDate: "2026-09-21", localTime: "15:10" });
    expect(afternoon.remainingDates).toEqual(morning.remainingDates);
  });

  it("Friday is only Friday, and the weekend has no remaining weekdays", () => {
    expect(remainingWeekHorizon({ businessDate: "2026-09-25", localTime: "09:00" }).remainingDates).toEqual([
      "2026-09-25",
    ]);
    expect(remainingWeekHorizon({ businessDate: "2026-09-26", localTime: "10:00" }).remainingDates).toEqual([]);
    expect(remainingWeekHorizon({ businessDate: "2026-09-27", localTime: "10:00" }).todayIsRemnant).toBe(false);
  });
});

describe("week status and readiness defaults", () => {
  it("derives status from an active session before a prior lock", () => {
    expect(deriveWeekStatus({ activeSession: false, lockedIntent: false })).toBe("UNPLANNED");
    expect(deriveWeekStatus({ activeSession: true, lockedIntent: false })).toBe("IN_PROGRESS");
    expect(deriveWeekStatus({ activeSession: false, lockedIntent: true })).toBe("LOCKED");
    expect(deriveWeekStatus({ activeSession: true, lockedIntent: true })).toBe("IN_PROGRESS");
  });

  it("caps readiness at four and defaults due-by to the previous business day", () => {
    expect(previousBusinessDay("2026-09-22")).toBe("2026-09-21");
    expect(previousBusinessDay("2026-09-21")).toBe("2026-09-18");
    const items = ["jacket", "gas", "packets", "map", "fifth"].map(text =>
      defaultReadiness({ text, neededForDate: "2026-09-22" })
    );
    expect(capReadiness(items)).toHaveLength(4);
    expect(items[0]).toMatchObject({
      kind: "physical",
      neededForDate: "2026-09-22",
      completeByDate: "2026-09-21",
      status: "open",
    });
    expect(defaultReadiness({ text: "print six packets", neededForDate: "2026-09-22" }).kind).toBe("document");
    expect(defaultReadiness({ text: "get approval", neededForDate: "2026-09-22" }).kind).toBe("approval");
  });

  it("keys the session by tenant, operator, and week start", () => {
    expect(weeklySessionKey("default", "adam", "2026-09-21")).toBe(
      "weekly-planning:default:adam:2026-09-21"
    );
  });
});

describe("bind and revise language", () => {
  it("treats an explicit lock as a bind and a refusal as not a bind", () => {
    expect(isWeeklyLockBind("Lock it.")).toBe(true);
    expect(isWeeklyLockBind("That's the week.")).toBe(true);
    expect(isWeeklyLockBind("Looks good")).toBe(true);
    expect(isWeeklyLockBind("No, Tuesday won't work. Thursday.")).toBe(false);
    expect(isWeeklyRejection("No.")).toBe(true);
  });

  it("reads a day move without treating it as a new obligation", () => {
    expect(parseDayMove("Thursday, not Tuesday")).toEqual({ from: "Tuesday", to: "Thursday" });
    expect(parseDayMove("No, Tuesday won't work. Thursday.")).toEqual({ from: "Tuesday", to: "Thursday" });
  });

  it("speaks a remnant line without removing the day from the horizon", () => {
    const horizon = remainingWeekHorizon({ businessDate: "2026-09-21", localTime: "15:10" });
    expect(proactiveWeeklyLine(horizon)).toMatch(/mostly gone/);
    expect(emptyDraft(horizon, []).days).toHaveLength(5);
    expect(proactiveWeeklyLine(remainingWeekHorizon({ businessDate: "2026-09-21", localTime: "08:05" }))).toMatch(
      /still open/
    );
  });
});


describe("strategic preparation and readers share a horizon", () => {
  it.each([
    ["2026-10-16", "16:59", "2026-10-12", "2026-10-16"],
    ["2026-10-16", "17:00", "2026-10-19", "2026-10-19"],
    ["2026-10-17", "09:00", "2026-10-19", "2026-10-19"],
    ["2026-10-18", "09:00", "2026-10-19", "2026-10-19"],
    ["2026-10-19", "09:00", "2026-10-19", "2026-10-19"],
    ["2026-10-15", "18:00", "2026-10-12", "2026-10-16"],
  ])("%s at %s prepares and reads week %s", (businessDate, localTime, weekStart, firstDate) => {
    const horizon = strategicPlanningHorizon({ businessDate, localTime });
    expect(horizon.weekStart).toBe(weekStart);
    expect(actionableDates(horizon)[0]).toBe(firstDate);
  });
});

describe("proposal item execution window (after the 5 PM cutoff)", () => {
  const today = "2026-10-14";
  const at = (localTime: string) => ({ businessDate: today, localTime });
  it("today's work is approvable until the cutoff and expired after it", () => {
    expect(proposalItemExecutionWindow({ businessDate: today }, at("16:59"))).toBe("open");
    expect(proposalItemExecutionWindow({ businessDate: today }, at("17:00"))).toBe("expired");
    expect(proposalItemExecutionWindow({ businessDate: today, timeWindow: { window: "evening" } as any }, at("18:00"))).toBe("expired");
  });
  it("an explicit later time keeps today's work approvable after the cutoff until it passes", () => {
    const meeting = { businessDate: today, timeWindow: { time: "19:00" } };
    expect(proposalItemExecutionWindow(meeting, at("18:30"))).toBe("open");
    expect(proposalItemExecutionWindow(meeting, at("19:00"))).toBe("open");
    expect(proposalItemExecutionWindow(meeting, at("19:01"))).toBe("expired");
  });
  it("an explicit time does not shorten the normal day", () => {
    expect(proposalItemExecutionWindow({ businessDate: today, timeWindow: { time: "09:00" } }, at("12:00"))).toBe("open");
  });
  it("later days are open and earlier days expired regardless of time", () => {
    expect(proposalItemExecutionWindow({ businessDate: "2026-10-15" }, at("23:00"))).toBe("open");
    expect(proposalItemExecutionWindow({ businessDate: "2026-10-13", timeWindow: { time: "23:00" } }, at("08:00"))).toBe("expired");
  });
});
