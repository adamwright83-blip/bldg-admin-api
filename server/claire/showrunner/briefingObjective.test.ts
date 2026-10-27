import { describe, expect, it } from "vitest";
import { briefingObjective, showrunnerOpening, type ShowrunnerBriefing } from "./showrunnerBriefing";
import { buildWeeklyProductionPlan } from "../../strategy/strategicPreparation";
import { weeklyHeadlineObjective } from "../../../shared/strategicHeadline";
import type { StrategicPlanningProposal } from "../../../shared/strategicIntelligence";

type Diagnosis = StrategicPlanningProposal["diagnosis"];
const MACRO = "Get to 50 active customers";
const DAPHNE_GOAL = "maximize sales in Silver Lake";

function diagnosis(over: Partial<Diagnosis> = {}): Diagnosis {
  return {
    goal: { statement: MACRO, metricKey: "active_customers", target: 50, current: null, evidenceRef: "operator_macro_goals:mg1" },
    objective: { statement: DAPHNE_GOAL, area: "Silver Lake", confirmation: "confirmed" },
    mandate: { leadingOutcomeId: "operator_macro_goals:mg1" } as Diagnosis["mandate"],
    options: [],
    selectedOptionId: "",
    actions: [],
    successMeasures: [],
    currentCondition: "",
    diagnosis: "",
    uncertainty: [],
    ...over,
  } as Diagnosis;
}

const opening = (objective: string | null): string =>
  showrunnerOpening({
    purpose: "morning_readiness",
    businessDate: "2026-10-21",
    weekday: "Wednesday",
    objective,
    weekPlan: null,
    today: [],
    tomorrow: [],
    developments: [],
    pendingDecision: null,
    adaptations: [],
    uncertain: [],
    weekToDate: { reportedOutcomes: [], planChanges: [] },
    driverDayLine: null,
  } as ShowrunnerBriefing);

describe("one goal: the macro goal heads the week (D18)", () => {
  it("the weekly plan names the macro goal when a Daphne-declared goal is the confirmed focus", () => {
    const plan = buildWeeklyProductionPlan({ diagnosis: diagnosis(), items: [], planDates: [], constraints: [], adaptations: [] });
    expect(plan.objective).toBe(`${MACRO}, focused on Silver Lake`);
    expect(plan.objective).not.toContain(DAPHNE_GOAL);
  });

  it("the morning opening names the macro goal when both exist, even from a proposal stored before this rule", () => {
    const stored = { diagnosis: diagnosis(), weeklyPlan: { objective: DAPHNE_GOAL } } as StrategicPlanningProposal;
    const spoken = opening(briefingObjective(stored));
    expect(spoken).toContain(`This week is about: ${MACRO}, focused on Silver Lake.`);
    expect(spoken).not.toContain(DAPHNE_GOAL);
  });

  it("an only-mentioned focus is a qualifier, never the headline", () => {
    expect(weeklyHeadlineObjective(diagnosis({ objective: { statement: DAPHNE_GOAL, area: "Silver Lake", confirmation: "inferred" } }))).toBe(
      `${MACRO} (starting in Silver Lake)`
    );
    expect(weeklyHeadlineObjective(diagnosis({ objective: undefined }))).toBe(MACRO);
  });

  it("without a leading macro goal the stored wording stands", () => {
    const noGoal = diagnosis({ goal: { statement: "Clarify the operator's goal", metricKey: "unavailable", target: 0, current: null, evidenceRef: "goal_unavailable:x" } });
    expect(weeklyHeadlineObjective(noGoal)).toBeNull();
    expect(briefingObjective({ diagnosis: noGoal, weeklyPlan: { objective: DAPHNE_GOAL } } as StrategicPlanningProposal)).toBe(DAPHNE_GOAL);
    const unprioritized = diagnosis({ mandate: { leadingOutcomeId: null } as Diagnosis["mandate"] });
    expect(weeklyHeadlineObjective(unprioritized)).toBeNull();
  });
});
