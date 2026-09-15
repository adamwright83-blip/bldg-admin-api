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
