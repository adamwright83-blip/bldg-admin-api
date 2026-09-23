/**
 * plan.day_line for today.
 *
 * system.mission_director is the only ranker. This module projects that
 * order. It does not score, sort, or plan. Execution type comes from
 * shared/objectiveExecution.ts. Type is not a rank.
 *
 * "make this today's mission" stays compatibility language. The phrase does
 * not set the execution type.
 */

import { classifyObjectiveExecution, type ObjectiveExecutionType } from "./objectiveExecution";

export type { ObjectiveExecutionType };

export const CURRENT_DAY_LINE_ORDERING_AUTHORITY = "system.mission_director" as const;

export const CURRENT_DAY_LINE_EXECUTION_RULE = "execution_contract" as const;

export const CURRENT_DAY_LINE_COMPATIBILITY =
  "todays_mission_phrase_does_not_set_execution_type" as const;

export type ExecutionContract = {
  fieldRequired: boolean;
  remoteRequired: boolean;
  /** Field and remote each satisfy the work. That is not a Hybrid Objective. */
  eitherAcceptable: boolean;
};

export type CurrentDayLineItem = {
  id: string;
  title: string;
  /** Index in Mission Director order. Not a score. */
  position: number;
  executionType: ObjectiveExecutionType | null;
  executionContract: ExecutionContract;
  compatibilityPhrase: "todays_mission" | null;
};

export type CurrentDayLine = {
  scope: "today";
  businessDate: string;
  orderingAuthority: typeof CURRENT_DAY_LINE_ORDERING_AUTHORITY;
  rankingStatus: "ranked" | "no_plan" | "unavailable";
  items: CurrentDayLineItem[];
  /** Operator compatibility designation. It does not reorder `items`. */
  designated: CurrentDayLineItem | null;
  executionRule: typeof CURRENT_DAY_LINE_EXECUTION_RULE;
  compatibility: typeof CURRENT_DAY_LINE_COMPATIBILITY;
};

export type RankedDayWork = {
  id: string;
  title: string;
  objective?: string | null;
  completionCondition?: string | null;
  /**
   * Stored type. Null is unknown and is not re-derived.
   * Omit the property when the shared classifier may derive a type.
   */
  executionType?: ObjectiveExecutionType | null;
};

export function executionContractFromWork(input: {
  title?: string | null;
  objective?: string | null;
  completionCondition?: string | null;
  identifier?: string | null;
}): ExecutionContract {
  const decision = classifyObjectiveExecution({
    contract: input.completionCondition,
    title: input.title,
    objective: input.objective,
    identifier: input.identifier,
  });
  return {
    fieldRequired: decision.fieldRequired,
    remoteRequired: decision.remoteRequired,
    eitherAcceptable: decision.eitherAcceptable,
  };
}

/** Maps a contract already produced by the shared classifier. It does not read language. */
export function stampExecutionType(contract: ExecutionContract): ObjectiveExecutionType | null {
  if (contract.eitherAcceptable) return null;
  if (contract.fieldRequired && contract.remoteRequired) return "hybrid_objective";
  if (contract.fieldRequired) return "mission";
  if (contract.remoteRequired) return "challenge";
  return null;
}

export function executionTypeLabel(type: ObjectiveExecutionType | null): string {
  if (type === "mission") return "Mission";
  if (type === "challenge") return "Challenge";
  if (type === "hybrid_objective") return "Hybrid";
  return "Unspecified";
}

function stampItem(
  work: RankedDayWork,
  position: number,
  compatibilityPhrase: "todays_mission" | null
): CurrentDayLineItem {
  const decision = Object.prototype.hasOwnProperty.call(work, "executionType")
    ? classifyObjectiveExecution({ persistedType: work.executionType ?? null })
    : classifyObjectiveExecution({
        contract: work.completionCondition,
        title: work.title,
        objective: work.objective,
        identifier: work.id,
      });
  return {
    id: work.id,
    title: work.title,
    position,
    executionType: decision.executionType,
    executionContract: {
      fieldRequired: decision.fieldRequired,
      remoteRequired: decision.remoteRequired,
      eitherAcceptable: decision.eitherAcceptable,
    },
    compatibilityPhrase,
  };
}

/**
 * Project an already-ranked list. Callers pass Mission Director's order.
 * This function does not sort.
 */
export function projectCurrentDayLine(input: {
  businessDate: string;
  rankingStatus: CurrentDayLine["rankingStatus"];
  rankedWorks: readonly RankedDayWork[];
  designated?: (RankedDayWork & { compatibilityPhrase?: "todays_mission" | null }) | null;
}): CurrentDayLine {
  const designatedId = input.designated?.id ?? null;
  const items = input.rankedWorks.map((work, position) =>
    stampItem(work, position, work.id === designatedId ? "todays_mission" : null)
  );
  const alreadyRanked = designatedId
    ? items.find(item => item.id === designatedId) ?? null
    : null;
  const designated = alreadyRanked
    ? alreadyRanked
    : input.designated
      ? { ...stampItem(input.designated, -1, input.designated.compatibilityPhrase ?? "todays_mission"), position: -1 }
      : null;
  return {
    scope: "today",
    businessDate: input.businessDate,
    orderingAuthority: CURRENT_DAY_LINE_ORDERING_AUTHORITY,
    rankingStatus: input.rankingStatus,
    items,
    designated,
    executionRule: CURRENT_DAY_LINE_EXECUTION_RULE,
    compatibility: CURRENT_DAY_LINE_COMPATIBILITY,
  };
}

/** The ranked list, in authority order. Empty unless today was actually ranked. */
export function currentDayLineOrder(line: CurrentDayLine): string[] {
  return presentCurrentDayLine(line).items.map(item => item.id);
}

export const adminCurrentDayLineOrder = currentDayLineOrder;
export const driverCurrentDayLineOrder = currentDayLineOrder;
export const claireCurrentDayLineOrder = currentDayLineOrder;

export type CurrentDayLinePresentation = {
  businessDate: string;
  rankingStatus: CurrentDayLine["rankingStatus"];
  /** Empty unless Mission Director actually ranked today. */
  items: CurrentDayLineItem[];
  /** Compatibility designation that is not already a ranked row. */
  designated: CurrentDayLineItem | null;
  /** Null when the ranked list is the thing to show. */
  statusText: string | null;
};

/** Same words on Admin and Driver. An empty list is not a finished ranking. */
export function presentCurrentDayLine(line: CurrentDayLine): CurrentDayLinePresentation {
  const ranked = line.rankingStatus === "ranked" && line.items.length > 0;
  const rankingStatus = ranked
    ? "ranked"
    : line.rankingStatus === "ranked"
      ? "unavailable"
      : line.rankingStatus;
  const designated =
    line.designated && line.designated.position < 0 ? line.designated : null;
  return {
    businessDate: line.businessDate,
    rankingStatus,
    items: ranked ? line.items : [],
    designated,
    statusText:
      rankingStatus === "ranked"
        ? null
        : rankingStatus === "no_plan"
          ? "No ranked line for today."
          : "Today's ranking is unavailable.",
  };
}

/**
 * The day line is today's business date only. Another selected date must
 * not render it.
 */
export function dayLineForSelectedDate(
  line: CurrentDayLine | null | undefined,
  selectedDate: string
): CurrentDayLine | null {
  if (!line || line.scope !== "today" || line.businessDate !== selectedDate) return null;
  return line;
}

export function businessDateInZone(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
