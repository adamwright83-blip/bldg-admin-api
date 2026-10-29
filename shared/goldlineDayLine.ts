export const GOLDLINE_DAYLINE_OVERLAY_KEY = "goldlineDayLine";

export const DAYLINE_SOURCE_TYPES = [
  "day_director_commitment",
  "commercial_mission",
  "commercial_follow_up",
  "commercial_dispatch",
  "order",
  "external",
  "open_channel",
  "living_world",
] as const;

export type DayLineSourceType = (typeof DAYLINE_SOURCE_TYPES)[number];

export type DayLineCapabilityId = "dayline.edit" | "dayline.cancel" | "dayline.complete";

export type GoldlineDayLineOverlay = {
  actionTitleOverride?: string | null;
  originalTitle?: string | null;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  cancelledReason?: string | null;
  notPursuing?: boolean;
  /**
   * Taken off one day's line by the operator ("remove the sales stops from tomorrow").
   * The row stops showing on the Day Line; the opportunity behind it is NOT abandoned:
   * notPursuing stays false and no follow-up is cancelled. (2026-10-28 call)
   */
  removedFromDay?: DayLineRemovedFromDay | null;
  /** Overdue and still open. Evidence of unresolved work, never proof of a skip. */
  unresolved?: DayLineUnresolvedWork | null;
};

export type DayLineUnresolvedWork = {
  observedAt: string;
  observationId: string;
  status: "awaiting_explanation" | "explained";
  explanationObservationId?: string | null;
  reason?: string | null;
};

export type DayLineRemovedFromDay = {
  businessDate: string;
  removedAt: string;
  removedBy: string;
  reason?: string | null;
};

export type DayLineItemRef = {
  sourceType: DayLineSourceType;
  sourceId: string;
  displayTitle: string;
  accountId?: string | null;
  accountName?: string | null;
  actionId?: string | null;
  missionId?: number | null;
  followupId?: string | null;
  pipelineId?: number | null;
  editableCapabilities: DayLineCapabilityId[];
  status: "active" | "completed" | "cancelled";
  assignedTo?: string | null;
};

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readDayLineOverlay(source: unknown): GoldlineDayLineOverlay {
  const record = asRecord(source);
  const nested = asRecord(record[GOLDLINE_DAYLINE_OVERLAY_KEY] ?? source);
  return {
    actionTitleOverride:
      typeof nested.actionTitleOverride === "string" ? nested.actionTitleOverride : null,
    originalTitle: typeof nested.originalTitle === "string" ? nested.originalTitle : null,
    cancelledAt: typeof nested.cancelledAt === "string" ? nested.cancelledAt : null,
    cancelledBy: typeof nested.cancelledBy === "string" ? nested.cancelledBy : null,
    cancelledReason:
      typeof nested.cancelledReason === "string" ? nested.cancelledReason : null,
    notPursuing: nested.notPursuing === true,
    removedFromDay: readRemovedFromDay(nested.removedFromDay),
    unresolved: readUnresolved(nested.unresolved),
  };
}

function readRemovedFromDay(value: unknown): DayLineRemovedFromDay | null {
  const v = asRecord(value);
  if (typeof v.businessDate !== "string" || typeof v.removedAt !== "string" || typeof v.removedBy !== "string") return null;
  return {
    businessDate: v.businessDate,
    removedAt: v.removedAt,
    removedBy: v.removedBy,
    reason: typeof v.reason === "string" ? v.reason : null,
  };
}

function readUnresolved(value: unknown): DayLineUnresolvedWork | null {
  const v = asRecord(value);
  if (typeof v.observedAt !== "string" || typeof v.observationId !== "string") return null;
  return {
    observedAt: v.observedAt,
    observationId: v.observationId,
    status: v.status === "explained" ? "explained" : "awaiting_explanation",
    explanationObservationId:
      typeof v.explanationObservationId === "string" ? v.explanationObservationId : null,
    reason: typeof v.reason === "string" ? v.reason : null,
  };
}

export function mergeDayLineOverlay(
  source: unknown,
  patch: Partial<GoldlineDayLineOverlay>
): Record<string, unknown> {
  const record = asRecord(source);
  const current = readDayLineOverlay(record);
  return {
    ...record,
    [GOLDLINE_DAYLINE_OVERLAY_KEY]: {
      ...current,
      ...patch,
    },
  };
}

export function dayLineDisplayTitle(
  overlay: GoldlineDayLineOverlay | null | undefined,
  fallback: string
): string {
  const override = overlay?.actionTitleOverride?.trim();
  return override || fallback;
}

export function isDayLineCancelled(
  overlay: GoldlineDayLineOverlay | null | undefined
): boolean {
  return Boolean(overlay?.notPursuing || overlay?.cancelledAt);
}

/**
 * Off the Day Line for any reason: abandoned (notPursuing / cancelled) or only taken off its day.
 * Readers that decide what the line SHOWS use this; readers that ask whether the operator
 * gave up on the work use isDayLineCancelled.
 */
export function isHiddenFromDayLine(
  overlay: GoldlineDayLineOverlay | null | undefined,
  /** The row's current business date. A removal hides the row only on the day it was removed from. */
  rowBusinessDate: string | null | undefined
): boolean {
  if (isDayLineCancelled(overlay)) return true;
  const removed = overlay?.removedFromDay;
  // Moved to another day afterwards, it shows there: off one day, never abandoned.
  return Boolean(removed && rowBusinessDate && removed.businessDate === rowBusinessDate);
}

export function matchDayLineItem(item: DayLineItemRef, utterance: string): boolean {
  const text = utterance.toLowerCase();
  const haystacks = [item.displayTitle, item.accountName ?? ""]
    .join(" ")
    .toLowerCase();
  const tokens = haystacks
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 3);
  if (!tokens.length) {
    const compact = haystacks.replace(/[^a-z0-9]+/g, " ").trim();
    return compact.length > 0 && text.includes(compact);
  }
  const hits = tokens.filter(token => text.includes(token)).length;
  return hits >= Math.min(2, tokens.length);
}

export function extractRequestedActionTitle(utterance: string): string | null {
  const quoted = utterance.match(/['“”‘’"]([^'“”‘’"]+)['“”‘’"]/);
  if (quoted?.[1]?.trim()) return quoted[1].replace(/[.,]+$/, "").trim().slice(0, 255);
  const toMatch = utterance.match(
    /\b(?:change|rename|make|edit)\b[\s\S]*?\b(?:to|say)\s+(.+)$/i
  );
  if (toMatch?.[1]) {
    return toMatch[1]
      .replace(/^['“”‘’"]+|['“”‘’"]+$/g, "")
      .replace(/[.,]+$/, "")
      .trim()
      .slice(0, 255);
  }
  return null;
}

export function extractCancellationReason(utterance: string): string | null {
  const trimmed = utterance.trim();
  if (!trimmed) return null;
  if (
    /\b(liab|damage|expensive|high-value|not pursu|don't want|do not want|off the hook)\b/i.test(
      trimmed
    )
  ) {
    return trimmed.slice(0, 500);
  }
  const because = trimmed.match(/\bbecause\s+(.+)$/i);
  if (because?.[1]) return because[1].slice(0, 500);
  return trimmed.length > 40 ? trimmed.slice(0, 500) : null;
}

export function looksLikeCancelRequest(utterance: string): boolean {
  return /\b(remove|take .{0,80} off|take (?:it |them |that )?(?:off|out)|get rid|not pursuing|don't want to (?:move forward|pursue)|do not want to (?:move forward|pursue)|off my day|cancel)\b/i.test(
    utterance
  );
}

export function looksLikeEditRequest(utterance: string): boolean {
  if (/\b(change when|reschedule|push (?:it|them)|not tonight)\b/i.test(utterance)) {
    return false;
  }
  return /\b(change|rename|edit|make (?:it|that|the .{1,40}) say)\b/i.test(utterance);
}

export function looksLikeCompleteRequest(utterance: string): boolean {
  return /\b(mark (?:it |that )?(?:done|complete)|completed|finished that)\b/i.test(
    utterance
  );
}
