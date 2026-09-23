/**
 * plan.day_line for today.
 *
 * system.mission_director is the only ranker. This module projects that
 * order. It does not score, sort, or plan. Execution type comes from the
 * work's completion contract, not from an identifier that contains "mission".
 *
 * "make this today's mission" stays compatibility language. The phrase does
 * not set the execution type.
 */

export const CURRENT_DAY_LINE_ORDERING_AUTHORITY = "system.mission_director" as const;

export const CURRENT_DAY_LINE_EXECUTION_RULE = "execution_contract" as const;

export const CURRENT_DAY_LINE_COMPATIBILITY =
  "todays_mission_phrase_does_not_set_execution_type" as const;

export type ObjectiveExecutionType = "mission" | "challenge" | "hybrid_objective";

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
};

const FIELD_PATTERNS = [
  /\bvisits?\b/i,
  /\bvisiting\b/i,
  /\bpick[\s-]?ups?\b/i,
  /\bpick up\b/i,
  /\bdeliver(?:s|ed|ing|y|ies)?\b/i,
  /\bdrop[\s-]?offs?\b/i,
  /\bdrop off\b/i,
  /\bdoor[\s-]?hangers?\b/i,
  /\bin[\s-]person\b/i,
  /\bphysical pitch\b/i,
];

const REMOTE_PATTERNS = [
  /\bcalls?\b/i,
  /\bcalling\b/i,
  /\bphones?\b/i,
  /\bphoning\b/i,
  /\bsms\b/i,
  /\btexts?\b/i,
  /\btexting\b/i,
  /\be-?mails?\b/i,
  /\bemailing\b/i,
  /\bbrowser\b/i,
  /\bin admin\b/i,
  /\badmin console\b/i,
  /\bmessages?\b/i,
  /\bmessaging\b/i,
  /\bpublish(?:ed|ing)?\b/i,
];

const TRANSPORT_DELIVERY = /\bdeliver(?:s|ed|ing|y|ies)?\b/i;

function scrubTransportDelivery(text: string): string {
  return text.replace(
    /\b((?:e-?mail|message|text|sms|post)(?:\s+\w+){0,3}\s+)deliver(?:s|ed|ing|y|ies)?\b/gi,
    "$1"
  );
}

function hasField(text: string): boolean {
  const scrubbed = scrubTransportDelivery(text);
  if (!FIELD_PATTERNS.some(pattern => pattern.test(scrubbed))) return false;
  // "Deliver the email" is a remote send. A visit, pickup, or other field
  // signal still counts when it is present beside that send.
  if (!TRANSPORT_DELIVERY.test(scrubbed) || !hasRemote(scrubbed)) return true;
  const withoutDelivery = scrubbed.replace(/\bdeliver(?:s|ed|ing|y|ies)?\b/gi, " ");
  return FIELD_PATTERNS.some(pattern => pattern.test(withoutDelivery));
}

function hasRemote(text: string): boolean {
  return REMOTE_PATTERNS.some(pattern => pattern.test(text));
}

function eitherMode(text: string): boolean {
  const parts = text.split(/\bor\b/i);
  if (parts.length < 2) return false;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const left = parts[index] ?? "";
    const right = parts[index + 1] ?? "";
    const leftField = hasField(left) && !hasRemote(left);
    const leftRemote = hasRemote(left) && !hasField(left);
    const rightField = hasField(right) && !hasRemote(right);
    const rightRemote = hasRemote(right) && !hasField(right);
    if ((leftField && rightRemote) || (leftRemote && rightField)) return true;
  }
  return false;
}

export function executionContractFromWork(input: {
  title?: string | null;
  objective?: string | null;
  completionCondition?: string | null;
}): ExecutionContract {
  const completion = input.completionCondition?.trim() ?? "";
  const text =
    hasField(completion) || hasRemote(completion)
      ? completion
      : [input.title, input.objective].filter(part => part && part.trim()).join("\n");
  if (eitherMode(text)) {
    return { fieldRequired: false, remoteRequired: false, eitherAcceptable: true };
  }
  const fieldRequired = hasField(text);
  const remoteRequired = hasRemote(text);
  return { fieldRequired, remoteRequired, eitherAcceptable: false };
}

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
  const executionContract = executionContractFromWork({
    title: work.title,
    objective: work.objective,
    completionCondition: work.completionCondition,
  });
  return {
    id: work.id,
    title: work.title,
    position,
    executionType: stampExecutionType(executionContract),
    executionContract,
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
