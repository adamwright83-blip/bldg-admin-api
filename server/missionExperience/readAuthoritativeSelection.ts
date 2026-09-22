import type { MissionPlanOutcome, MissionSelection } from "../../shared/missionDirector";
import type { WeeklyIntentDay } from "../../shared/weeklyMissionReadiness";
import type { SelectedWorkRef, UnreadinessObservation } from "../../shared/missionExperience";
import { replacementDependsOnMissingPrep } from "../../shared/missionExperience";
import { weeklyIntentPrimaryCommandId } from "../claire/weeklyMission/dailyCommandIntent";

const UNDECLARED_GATE = {
  realGateKind: "FOLLOW_UP_LOGGED" as const,
  gateProducer: null,
  playShape: "compact" as const,
};

/**
 * Reads an already-built Daily Command picture and an already-persisted
 * Mission Director plan. Does not order campaigns or ask for a new plan.
 */
export function readAuthoritativeSelection(input: {
  businessDate: string;
  intentDay: WeeklyIntentDay | null;
  commandPrimary: { id: string; title: string } | null;
  weeklyIntentOverride: { commandPrimaryId: string | null } | null;
  plan: { id: string; outcome: MissionPlanOutcome } | null;
}): { original: SelectedWorkRef | null; unreadiness: UnreadinessObservation } {
  const intentPrimary =
    input.intentDay?.primary && input.intentDay.disposition !== "stand_down"
      ? input.intentDay.primary
      : null;
  const missingPrepTexts = (input.intentDay?.readinessRequirements ?? [])
    .filter(item => item.status !== "ready")
    .map(item => item.text);
  const notReady = Boolean(intentPrimary) && missingPrepTexts.length > 0;

  const original = intentPrimary
    ? weeklyOriginal(input.businessDate, intentPrimary.text, intentPrimary.commitmentId)
    : input.commandPrimary
      ? commandRef(input.commandPrimary)
      : planSelectionRef(input.plan);

  const existingFallback = notReady
    ? observeFallback({
        originalCommandId: original?.dailyCommandItemId ?? null,
        commandPrimary: input.commandPrimary,
        weeklyIntentOverride: input.weeklyIntentOverride,
        plan: input.plan,
        missingPrepTexts,
      })
    : null;

  return {
    original,
    unreadiness: { notReady, missingPrepTexts, existingFallback },
  };
}

function weeklyOriginal(businessDate: string, text: string, commitmentId: string | null): SelectedWorkRef {
  return {
    source: "weekly_intent",
    title: text,
    realObjective: text,
    dailyCommandItemId: weeklyIntentPrimaryCommandId(businessDate, commitmentId),
    ...UNDECLARED_GATE,
  };
}

function commandRef(item: { id: string; title: string }): SelectedWorkRef {
  return {
    source: "daily_command",
    title: item.title,
    realObjective: item.title,
    dailyCommandItemId: item.id,
    ...UNDECLARED_GATE,
  };
}

function planSelectionRef(plan: { id: string; outcome: MissionPlanOutcome } | null): SelectedWorkRef | null {
  const selected = selectedPlanWork(plan);
  if (!plan || !selected) return null;
  return selectionRef(plan.id, selected.selection, selected.item);
}

function selectedPlanWork(
  plan: { id: string; outcome: MissionPlanOutcome } | null
): { selection: "primary" | "fallback"; item: MissionSelection } | null {
  if (!plan) return null;
  if (plan.outcome.status === "fallback_only") {
    return { selection: "fallback", item: plan.outcome.fallback };
  }
  if (plan.outcome.status === "planned") {
    return { selection: "primary", item: plan.outcome.primary };
  }
  return null;
}

function selectionRef(
  planId: string,
  selection: "primary" | "fallback",
  item: MissionSelection
): SelectedWorkRef {
  return {
    source: "mission_director",
    title: item.title,
    realObjective: item.objective,
    missionDirectorPlanId: planId,
    missionDirectorSelection: selection,
    dailyCommandItemId: null,
    ...UNDECLARED_GATE,
  };
}

function observeFallback(input: {
  originalCommandId: string | null;
  commandPrimary: { id: string; title: string } | null;
  weeklyIntentOverride: { commandPrimaryId: string | null } | null;
  plan: { id: string; outcome: MissionPlanOutcome } | null;
  missingPrepTexts: readonly string[];
}): SelectedWorkRef | null {
  const overrideId = input.weeklyIntentOverride?.commandPrimaryId ?? null;
  if (
    input.commandPrimary &&
    overrideId &&
    input.commandPrimary.id === overrideId &&
    input.commandPrimary.id !== input.originalCommandId
  ) {
    const ref = commandRef(input.commandPrimary);
    if (!replacementDependsOnMissingPrep(ref, input.missingPrepTexts)) return ref;
  }
  if (input.plan?.outcome.status === "fallback_only") {
    const ref = selectionRef(input.plan.id, "fallback", input.plan.outcome.fallback);
    if (!replacementDependsOnMissingPrep(ref, input.missingPrepTexts)) return ref;
  }
  return null;
}
