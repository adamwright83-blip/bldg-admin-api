/**
 * Daily Command consumption seam.
 * Imports the stable read contract only. Does not project recurrence,
 * create a primary, or write locked weekly history.
 * Locked WeeklyIntent owns discretionary primary intent.
 * Readiness due today is a read-model field, not a Day Director task.
 */

import {
  loadDailyCommand,
  type DailyCommand,
  type DailyCommandItem,
  type LoadDailyCommandInput,
} from "../dailyCommandContract";
import type { WeeklyExecutionType, WeeklyIntentDay } from "../../../shared/weeklyMissionReadiness";
import { latestWeeklyIntent } from "./intentStore";

export type WeeklyIntentReadinessItem = {
  text: string;
  kind: WeeklyIntentDay["readinessRequirements"][number]["kind"];
  neededForDate: string;
  completeByDate: string;
  status: "open" | "ready" | "blocked";
  missionTitle: string;
  provenance: "weekly_intent_readiness";
};

export type WeeklyIntentOverride = {
  code: "operator_replaced_weekly_primary" | "hard_blocker" | "fixed_external_obligation";
  reason: string;
  evidenceQuote: string;
  intentPrimaryId: string | null;
  commandPrimaryId: string | null;
};

/**
 * Explicit operator replacement. "Daily Command is running X" is not a reason.
 * source is set only for an explicit operator mission command stored on the
 * Day Director commitment. Title drift alone must not construct this object.
 */
export type WeeklyPrimaryDisplacement = {
  allowed: true;
  reason: string;
  evidenceQuote: string;
  source?: "explicit_operator_mission_command";
  sourceCommandRef?: string;
  businessDate?: string;
};

export type DailyCommandWithIntent = DailyCommand & {
  weeklyIntentReadiness?: WeeklyIntentReadinessItem[];
  weeklyIntentOverride?: WeeklyIntentOverride | null;
  /**
   * Execution type of today's locked weekly primary.
   * Null is unknown. Not a ranking input. Mission Director still orders today.
   */
  weeklyPrimaryExecutionType?: WeeklyExecutionType | null;
};

export function applyWeeklyIntentToCommand(
  command: DailyCommand,
  intentDays: readonly WeeklyIntentDay[] | WeeklyIntentDay | null,
  displacement?: WeeklyPrimaryDisplacement | null
): DailyCommandWithIntent {
  const days: WeeklyIntentDay[] = !intentDays ? [] : Array.isArray(intentDays) ? [...intentDays] : [intentDays];
  if (!days.length) return command;
  const today = days.find(day => day.businessDate === command.businessDate) ?? null;
  const readiness = days.flatMap(day =>
    day.readinessRequirements
      .filter(item => item.completeByDate === command.businessDate)
      .map(item => ({
        text: item.text,
        kind: item.kind,
        neededForDate: item.neededForDate,
        completeByDate: item.completeByDate,
        status: item.status,
        missionTitle: day.primary?.text ?? day.weekday,
        provenance: "weekly_intent_readiness" as const,
      }))
  );
  let primary = command.primary;
  let constraints = command.constraints;
  let epistemic = command.epistemic;
  let override: WeeklyIntentOverride | null = null;
  const intentPrimary = today?.primary && today.disposition !== "stand_down" ? today.primary : null;
  const intentId = intentPrimary?.commitmentId ?? null;
  const commandId = command.primary?.id ?? null;
  const samePrimary = Boolean(
    intentPrimary &&
      command.primary &&
      (command.primary.title === intentPrimary.text ||
        (intentId && commandId && (commandId === intentId || commandId.endsWith(intentId))))
  );
  const authority = commandPrimaryAuthority(command);
  if (intentPrimary && command.primary && !samePrimary && displacementIsEvidenced(displacement, command)) {
    override = {
      code: "operator_replaced_weekly_primary",
      reason: displacement!.reason.trim(),
      evidenceQuote: displacement!.evidenceQuote.trim(),
      intentPrimaryId: intentId,
      commandPrimaryId: commandId,
    };
  } else if (intentPrimary && command.primary && !samePrimary && authority) {
    override = {
      code: authority,
      reason: command.primary.title,
      evidenceQuote: command.primary.provenance.quote ?? command.primary.title,
      intentPrimaryId: intentId,
      commandPrimaryId: commandId,
    };
  } else if (intentPrimary && !samePrimary) {
    primary = intentPrimaryItem(command.businessDate, today!);
    constraints = {
      ...command.constraints,
      protectDiscretionary: true,
      primaryOpen: true,
    };
    epistemic = {
      ...command.epistemic,
      executiveJudgment: {
        ...command.epistemic.executiveJudgment,
        discretionaryOwnerId: primary.id,
      },
    };
  }
  return {
    ...command,
    primary,
    constraints,
    epistemic,
    weeklyIntentReadiness: readiness,
    weeklyIntentOverride: override,
    ...(intentPrimary ? { weeklyPrimaryExecutionType: intentPrimary.executionType ?? null } : {}),
  };
}

/**
 * Hard blocker, or a fixed-time / external obligation that is itself the primary.
 * A different discretionary title is not an override.
 */
function commandPrimaryAuthority(
  command: DailyCommand
): "hard_blocker" | "fixed_external_obligation" | null {
  const primary = command.primary;
  if (!primary) return null;
  if (primary.importanceRank === 0) return "hard_blocker";
  if (primary.chronology.axis === "fixed_window" || primary.promisedTo) return "fixed_external_obligation";
  return null;
}

export function displacementIsEvidenced(
  displacement: WeeklyPrimaryDisplacement | null | undefined,
  command: DailyCommand
): displacement is WeeklyPrimaryDisplacement {
  if (!displacement?.allowed) return false;
  const reason = displacement.reason.trim();
  const quote = displacement.evidenceQuote.trim();
  if (!reason || !quote) return false;
  if (/daily command is running/i.test(reason)) return false;
  if (displacement.source !== undefined && displacement.source !== "explicit_operator_mission_command") {
    return false;
  }
  if (displacement.businessDate && displacement.businessDate !== command.businessDate) return false;
  if (displacement.source === "explicit_operator_mission_command" && !displacement.sourceCommandRef?.trim()) {
    return false;
  }
  if (!reason.toLowerCase().includes(quote.toLowerCase())) return false;
  const evidence = `${command.primary?.provenance.quote ?? ""}`.toLowerCase();
  return evidence.includes(quote.toLowerCase());
}

/**
 * Builds today-only displacement from the primary commitment's stored command.
 * Returns null when that provenance is absent. Callers must not invent this
 * from "Daily Command is now running a different title."
 */
export function explicitOperatorMissionDisplacement(
  command: DailyCommand
): WeeklyPrimaryDisplacement | null {
  const evidence = command.explicitOperatorMission;
  if (!evidence?.weeklyIntentDisplacement) return null;
  if (evidence.source !== "operator_explicit" || evidence.scope !== "today_only") return null;
  if (evidence.businessDate !== command.businessDate) return null;
  const quote = evidence.evidenceQuote.trim();
  const ref = evidence.sourceCommandRef.trim();
  if (!quote || !ref) return null;
  const provenance = command.primary?.provenance.quote ?? "";
  if (!provenance.toLowerCase().includes(quote.toLowerCase())) return null;
  return {
    allowed: true,
    source: "explicit_operator_mission_command",
    sourceCommandRef: ref,
    businessDate: evidence.businessDate,
    evidenceQuote: quote,
    reason: `Explicit operator mission command: ${quote}`,
  };
}

function intentPrimaryItem(businessDate: string, day: WeeklyIntentDay): DailyCommandItem {
  const id = day.primary?.commitmentId ? `day-director:${day.primary.commitmentId}` : `weekly-intent:${businessDate}`;
  return {
    id,
    title: day.primary?.text ?? day.weekday,
    category: "primary",
    dayDirectorKind: "growth",
    status: "open",
    importanceRank: 2,
    chronology: { axis: "unscheduled_discretionary", windowStart: null, windowEnd: null, label: null },
    promisedTo: null,
    identityUnknown: false,
    cargoLink: null,
    recurrenceRuleId: null,
    detailState: "COMPLETE",
    provenance: {
      reader: "weekly_intent",
      sourceType: "day_director",
      sourceIds: day.primary?.commitmentId ? [day.primary.commitmentId] : [],
      quote: day.primary?.text ?? null,
    },
  };
}

/** Today's command is what can be played. A draft title is not playable. */
export function playableToday(input: {
  command: Pick<DailyCommand, "primary">;
  draftTitle: string | null;
}): { title: string | null; source: "daily_command" } {
  void input.draftTitle;
  return { title: input.command.primary?.title ?? null, source: "daily_command" };
}

/**
 * Read the daily command, then apply the locked week.
 * Does not write WeeklyIntent and does not call a recurrence materializer.
 */
export async function loadDailyCommandWithWeeklyIntent(
  input: LoadDailyCommandInput & { weekStart: string },
  deps: {
    loadCommand?: typeof loadDailyCommand;
    latestIntent?: typeof latestWeeklyIntent;
    displacement?: WeeklyPrimaryDisplacement | null;
  } = {}
): Promise<DailyCommandWithIntent> {
  const load = deps.loadCommand ?? loadDailyCommand;
  const command = await load(input);
  const intent = await (deps.latestIntent ?? latestWeeklyIntent)({
    tenantId: input.tenantId,
    operatorId: input.operatorUserId,
    weekStart: input.weekStart,
  });
  return applyWeeklyIntentToCommand(command, intent?.days ?? null, deps.displacement ?? null);
}
