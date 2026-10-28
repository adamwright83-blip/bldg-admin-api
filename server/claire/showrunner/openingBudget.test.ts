import { describe, expect, it } from "vitest";
import {
  OPENING_SPOKEN_BUDGET_CHARS,
  fitOpeningToBudget,
  showrunnerOpening,
  type ShowrunnerBriefing,
} from "./showrunnerBriefing";
import type { DriverDayLineCallFacts } from "./driverDayLineCall";

function stop(id: string, title: string) {
  return {
    id,
    title,
    executable: true,
    completion: "open",
    needsApproval: false,
    quietOnWeekend: false,
  } as never;
}

/** An evening like 2026-10-27: a long Day Line, a goal, a game move, and a 60-day-old carried item. */
function longEvening(): ShowrunnerBriefing {
  const dayLine = {
    read: "read",
    businessDate: "2026-10-27",
    stops: [
      stop("a", "Follow up with Dana at The Louise"),
      stop("b", "Pitch Wilshire Vermont in person"),
      stop("c", "Visit sageLA"),
      stop("d", "Visit Argyle House"),
      stop("e", "Los Feliz Towers follow-up"),
    ],
    designatedMission: { title: "Day 1 — Ten Doors" },
    fieldBlockers: [],
    pendingApproval: [],
    omissions: [],
  } as unknown as DriverDayLineCallFacts;
  return {
    purpose: "evening_debrief",
    businessDate: "2026-10-27",
    weekday: "Tuesday",
    objective: "maximize sales in Silver Lake",
    weekPlan: null,
    today: [],
    tomorrow: [],
    developments: [],
    pendingDecision: null,
    adaptations: [],
    uncertain: [],
    weekToDate: { reportedOutcomes: [], planChanges: [] },
    driverDayLine: dayLine,
    gameState: null,
    goal: {
      goalId: "goal-50",
      objective: "Get to 50 active customers",
      metricKey: "active_customers",
      unit: "customers",
      targetValue: 50,
      targetDate: null,
      baselineValue: 23,
      currentValue: null,
      currentNote: "partial",
    },
    carriedOpen: [
      {
        title: "Hang Stella's dresses",
        ageDays: 60,
        ids: ["x1"],
        question: "Did Stella's dresses get hung?",
      },
    ],
  } as unknown as ShowrunnerBriefing;
}

describe("opening budget", () => {
  it("sheds optional sections in order until the opening fits, never a required one", () => {
    const sections = [
      "Greeting.",
      "A".repeat(200) + ".",
      "Encouragement line.",
      "Since yesterday: a thing.",
      "Closer?",
    ];
    const fitted = fitOpeningToBudget(sections, [3, 2], 230);
    expect(fitted).toBe(
      ["Greeting.", "A".repeat(200) + ".", "Closer?"].join(" ")
    );
    // Required sections alone may still exceed the budget; nothing else is cut.
    expect(fitOpeningToBudget(["X".repeat(500) + "."], [], 100)).toHaveLength(
      501
    );
  });

  it("a long evening opening keeps goal and Day Line and drops the carried-item question", () => {
    const opening = showrunnerOpening(longEvening());
    expect(opening).toMatch(/50 active customers/);
    expect(opening).toMatch(/Still open: Follow up with Dana at The Louise/);
    expect(opening).not.toMatch(/Stella/);
    expect(opening).toMatch(/How did it go\?$/);
    expect((opening.match(/\?/g) ?? []).length).toBe(1);
  });

  it("a short evening opening still asks its carried yes/no", () => {
    const brief = {
      ...longEvening(),
      driverDayLine: null,
      goal: null,
      objective: null,
    } as ShowrunnerBriefing;
    const opening = showrunnerOpening(brief);
    expect(opening.length).toBeLessThanOrEqual(OPENING_SPOKEN_BUDGET_CHARS);
    expect(opening).toMatch(/Did Stella's dresses get hung\?$/);
  });
});
