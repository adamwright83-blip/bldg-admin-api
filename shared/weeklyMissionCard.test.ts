import { describe, expect, it } from "vitest";
import { PLAN_WEEK_CTA, RESUME_WEEK_CTA, buildWeeklyMissionCard } from "./weeklyMissionCard";
import { remainingWeekHorizon, type WeeklyIntentDay } from "./weeklyMissionReadiness";

const MORNING = remainingWeekHorizon({ businessDate: "2026-09-21", localTime: "09:10" });
const AFTERNOON = remainingWeekHorizon({ businessDate: "2026-09-21", localTime: "15:10" });
const SATURDAY = remainingWeekHorizon({ businessDate: "2026-09-26", localTime: "10:00" });

function lockedDay(text: string, extra = 0): WeeklyIntentDay {
  return {
    businessDate: "2026-09-21",
    weekday: "Monday",
    disposition: "primary",
    primary: { text, source: "operator_stated", commitmentId: "c1" },
    fixedConstraints: [
      { sourceRef: "jetro", title: "JETRO", businessDate: "2026-09-21", scheduleLabel: "14:00" },
    ],
    readinessRequirements: Array.from({ length: 4 + extra }, (_, index) => ({
      text: `item ${index + 1}`,
      kind: "physical" as const,
      neededForDate: "2026-09-21",
      completeByDate: "2026-09-18",
      status: "open" as const,
    })),
  };
}

describe("weekly mission card", () => {
  it("shows one unplanned pitch and a remnant line after noon", () => {
    const morning = buildWeeklyMissionCard({
      status: "UNPLANNED",
      weekStart: MORNING.weekStart,
      horizon: MORNING,
      declined: false,
      days: [],
    });
    const afternoon = buildWeeklyMissionCard({
      status: "UNPLANNED",
      weekStart: AFTERNOON.weekStart,
      horizon: AFTERNOON,
      declined: false,
      days: [],
    });
    expect(morning.showCard).toBe(true);
    expect(morning.cta).toBe("plan");
    expect(morning.proactiveLine).toContain("The week is still open");
    expect(afternoon.proactiveLine).toContain("mostly gone");
    expect(PLAN_WEEK_CTA).toBe("Plan the week with Claire.");
  });

  it("stays unplanned and silent after decline", () => {
    const card = buildWeeklyMissionCard({
      status: "UNPLANNED",
      weekStart: MORNING.weekStart,
      horizon: MORNING,
      declined: true,
      days: [],
    });
    expect(card.status).toBe("UNPLANNED");
    expect(card.showCard).toBe(false);
    expect(card.proactiveLine).toBeNull();
    expect(card.canBegin).toBe(false);
  });

  it("resumes an open interview instead of starting over", () => {
    const card = buildWeeklyMissionCard({
      status: "IN_PROGRESS",
      weekStart: MORNING.weekStart,
      horizon: MORNING,
      declined: true,
      days: [],
    });
    expect(card.cta).toBe("resume");
    expect(card.canBegin).toBe(false);
    expect(card.showCard).toBe(true);
    expect(RESUME_WEEK_CTA).toBe("Resume");
  });

  it("renders locked days with at most four readiness lines and today's start", () => {
    const card = buildWeeklyMissionCard({
      status: "LOCKED",
      weekStart: MORNING.weekStart,
      horizon: MORNING,
      declined: false,
      days: [lockedDay("Russell", 2)],
    });
    expect(card.days).toHaveLength(1);
    expect(card.days[0]?.primary).toBe("Russell");
    expect(card.days[0]?.fixedConstraints).toEqual(["JETRO 14:00"]);
    expect(card.days[0]?.readiness).toHaveLength(4);
    expect(card.days[0]?.isToday).toBe(true);
    expect(card.emphasizeTodayStart).toBe(true);
    expect(card.cta).toBe("adjust");
  });

  it("does not pitch a weekend with no remaining weekdays", () => {
    const card = buildWeeklyMissionCard({
      status: "UNPLANNED",
      weekStart: SATURDAY.weekStart,
      horizon: SATURDAY,
      declined: false,
      days: [],
    });
    expect(card.showCard).toBe(false);
    expect(card.canBegin).toBe(false);
  });
});
