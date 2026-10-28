import { describe, expect, it } from "vitest";
import { leadRequest, reliefRequest } from "./leadRequest";
import { buildLeadPlan } from "../executive/leadPlan";
import type { EvidenceItem } from "../contracts/evidence";

describe("relief request perception (2026-10-27 evening call)", () => {
  it.each([
    "I'm, like, overwhelmed right now. And I feel, like, mentally drained. So my hope is that you will tell me what to do.",
    "I'm overwhelmed.",
    "I feel so drained tonight.",
    "It's all too much, just pick one.",
    "You decide.",
    "Just tell me the one thing.",
    "I can't think straight, what should I do?",
  ])("reads relief: %s", text => {
    expect(reliefRequest(text)).toBe(true);
    const lead = leadRequest(text);
    expect(lead).not.toBeNull();
    expect(lead!.relief).toBe(true);
  });

  it.each([
    "What do you have for me tomorrow?",
    "Tell me what to do.",
    "Where do I start?",
  ])("an ordinary lead request is not relief: %s", text => {
    expect(reliefRequest(text)).toBe(false);
    expect(leadRequest(text)?.relief).toBe(false);
  });

  it.each([
    "Dana is overwhelmed with the move, I'll follow up Friday.",
    "The dryer at The Louise is spent, we need a new one.",
    "How did the Opus drop go?",
  ])(
    "does not read relief into a report about someone or something else: %s",
    text => {
      expect(leadRequest(text)?.relief ?? false).toBe(false);
    }
  );
});

function evidence(open: string[]): EvidenceItem[] {
  return [
    {
      id: "goal-1",
      type: "goal_progress",
      authoritativeFor: ["current_business_truth"],
      payload: {
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
    } as never,
    {
      id: "ops-1",
      type: "operations",
      authoritativeFor: ["current_business_truth"],
      payload: {
        businessDate: "2026-10-27",
        open: open.map((title, index) => ({
          id: `dl-${index}`,
          title,
          status: "open",
          source: "day_line",
          timing: null,
          completedAt: null,
        })),
        completed: [],
        routeAvailable: true,
      },
    } as never,
  ];
}

describe("relief lead plan", () => {
  it("is one move, no goal recital, no second suggestion, no Day Line offer", () => {
    const plan = buildLeadPlan({
      evidence: evidence([
        "Follow up with Dana at The Louise",
        "Pitch Wilshire Vermont in person",
        "Visit sageLA",
      ]),
      horizon: "today",
      today: "2026-10-27",
      relief: true,
    });
    expect(plan.text).toBe(
      "One thing tonight: follow up with Dana at The Louise. That's it; the rest can wait."
    );
    expect(plan.text).not.toMatch(
      /After that|Wilshire|sageLA|50 active customers|\?/
    );
    expect(plan.dayLineMove).toBeNull();
    expect(plan.firstAction).toBe("follow up with Dana at The Louise");
  });

  it("without relief the same evidence still produces the full plan", () => {
    const plan = buildLeadPlan({
      evidence: evidence([
        "Follow up with Dana at The Louise",
        "Pitch Wilshire Vermont in person",
      ]),
      horizon: "today",
      today: "2026-10-27",
    });
    expect(plan.text).toMatch(/50 active customers/);
    expect(plan.text).toMatch(/After that: pitch Wilshire Vermont in person\./);
  });

  it("with nothing open, relief means stop", () => {
    const plan = buildLeadPlan({
      evidence: evidence([]),
      horizon: "today",
      today: "2026-10-27",
      relief: true,
    });
    expect(plan.text).toBe(
      "Nothing is open on the line tonight, so the one thing is to stop for the night."
    );
    expect(plan.dayLineMove).toBeNull();
  });
});
