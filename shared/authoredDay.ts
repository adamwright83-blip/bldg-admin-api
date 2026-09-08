/** Presentation-only authored day. Never mutates business truth. */

export type AuthoredDayProvenance = {
  entityType:
    | "order"
    | "external_order"
    | "commercial_follow_up"
    | "commercial_mission"
    | "field_item"
    | "obligation"
    | "territory"
    | "operation"
    | "campaign_chapter"
    | "physical_entity"
    | "customer";
  entityId: string;
  sourceReference: string;
};

export type AuthoredDayLineKind =
  | "pickup"
  | "delivery"
  | "follow_up"
  | "recovery"
  | "commercial"
  | "obligation"
  | "emphasis"
  | "operation";

export type AuthoredDayLine = {
  id: string;
  title: string;
  narrative: string;
  kind: AuthoredDayLineKind;
  emphasis: "primary" | "secondary" | "background";
  provenance: AuthoredDayProvenance[];
};

export type AuthoredDayIntelligence =
  | "anthropic"
  | "deterministic_fallback"
  | "unavailable";

export type AuthoredDayStatus = "draft" | "committed";

export type AuthoredDayRecord = {
  id: string;
  tenantId: string;
  operatorId: string;
  businessDate: string;
  stableKey: string;
  status: AuthoredDayStatus;
  headline: string;
  framing: string;
  lines: AuthoredDayLine[];
  intelligence: AuthoredDayIntelligence;
  linkedOperationStableKey: string | null;
  inputFingerprint: string;
  createdAt: string;
  committedAt: string | null;
};

export type AuthoredDayAllowlist = {
  customerIds: Set<string>;
  physicalEntityIds: Set<string>;
  fieldItemIds: Set<string>;
  obligationIds: Set<string>;
  territoryIds: Set<string>;
  operationStableKeys: Set<string>;
  campaignChapterIds: Set<string>;
  orderIds: Set<string>;
  followUpIds: Set<string>;
  externalOrderIds: Set<string>;
  missionIds: Set<string>;
};

/** LLM may only choose among canonical candidates; it cannot rewrite line facts. */
export type NightShiftSelectionPlan = {
  headline: string;
  framing: string;
  selections: Array<{
    candidateId: string;
    emphasis: AuthoredDayLine["emphasis"];
  }>;
};

const BUSYWORK_PATTERNS = [
  /\breview\s+dashboard\b/i,
  /\bupdate\s+crm\b/i,
  /\binspect\s+analytics\b/i,
  /\bclean\s+contacts\b/i,
  /\borganize\s+pipeline\b/i,
  /\bread\s+report\b/i,
  /\bfill\s+fields?\b/i,
  /\bcheck\s+metrics\b/i,
];

export function isBusyworkMission(text: string): boolean {
  return BUSYWORK_PATTERNS.some(pattern => pattern.test(text));
}

const UNSUPPORTED_FACT_PATTERNS = [
  /\bconfirmed meeting\b/i,
  /\bconfirmed a meeting\b/i,
  /\bmeeting with\b/i,
  /\bmeeting at\b/i,
  /\bsigned the deal\b/i,
  /\bclose to signing\b/i,
  /\bagreed to weekly\b/i,
  /\bweekly pickup\b/i,
  /\bweekly service\b/i,
  /\brevenue booked\b/i,
  /\bclosed revenue\b/i,
  /\bdeal happened\b/i,
  /\bcustomer agreed\b/i,
  /\bagreed to weekly pickup\b/i,
  /\bdeal closed\b/i,
  /\bpromised to call\b/i,
  /\bmanager promised\b/i,
  /\bis waiting for pricing\b/i,
  /\bare ready to return\b/i,
  /\b\d+\s+customers?\b/i,
  /\bat \d{1,2}(:\d{2})?\s*(am|pm)\b/i,
  /\b\d{1,2}\s*pm\b/i,
  /\b\d{1,2}\s*am\b/i,
];

/** Presentation copy must not introduce business facts unsupported by evidence. */
export function introducesUnsupportedFactualClaim(text: string): boolean {
  return UNSUPPORTED_FACT_PATTERNS.some(pattern => pattern.test(text));
}

export function validatePresentationCopy(
  text: string
): { ok: true } | { ok: false; reason: string } {
  if (!text?.trim()) return { ok: false, reason: "presentation copy required" };
  if (introducesUnsupportedFactualClaim(text)) {
    return { ok: false, reason: "presentation copy introduces unsupported factual claim" };
  }
  if (isBusyworkMission(text)) {
    return { ok: false, reason: "busywork missions are not allowed" };
  }
  return { ok: true };
}

export function reconstructAuthoredLinesFromCandidates(
  candidates: AuthoredDayLine[],
  plan: Pick<NightShiftSelectionPlan, "selections">
): { ok: true; lines: AuthoredDayLine[] } | { ok: false; reason: string } {
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
  if (!plan.selections.length) {
    return { ok: false, reason: "night shift must select at least one candidate" };
  }
  const seen = new Set<string>();
  const lines: AuthoredDayLine[] = [];
  for (const selection of plan.selections) {
    if (seen.has(selection.candidateId)) {
      return { ok: false, reason: "duplicate candidate selection" };
    }
    seen.add(selection.candidateId);
    const candidate = byId.get(selection.candidateId);
    if (!candidate) {
      return { ok: false, reason: `unknown candidate id ${selection.candidateId}` };
    }
    lines.push({
      ...candidate,
      emphasis: selection.emphasis,
    });
  }
  return { ok: true, lines };
}

export function applyAuthoredDayPlan(input: {
  candidateLines: AuthoredDayLine[];
  allowlist: AuthoredDayAllowlist;
  headlineSeed: string;
  framingSeed: string;
  plan: NightShiftSelectionPlan;
}):
  | {
      ok: true;
      headline: string;
      framing: string;
      lines: AuthoredDayLine[];
    }
  | { ok: false; reason: string } {
  const headline = validatePresentationCopy(input.plan.headline).ok
    ? input.plan.headline.trim().slice(0, 255)
    : input.headlineSeed;
  const framing = validatePresentationCopy(input.plan.framing).ok
    ? input.plan.framing.trim().slice(0, 512)
    : input.framingSeed;
  const reconstructed = reconstructAuthoredLinesFromCandidates(
    input.candidateLines,
    input.plan
  );
  if (!reconstructed.ok) return reconstructed;
  const validated = validateAuthoredDayLines(reconstructed.lines, input.allowlist);
  if (!validated.ok) return validated;
  return { ok: true, headline, framing, lines: reconstructed.lines };
}

export function deterministicNightShiftPlan(
  candidateLines: AuthoredDayLine[]
): NightShiftSelectionPlan {
  return {
    headline: "",
    framing: "",
    selections: [...candidateLines]
      .sort((a, b) => {
        const rank = { primary: 0, secondary: 1, background: 2 };
        return rank[a.emphasis] - rank[b.emphasis] || a.id.localeCompare(b.id);
      })
      .map(candidate => ({
        candidateId: candidate.id,
        emphasis: candidate.emphasis,
      })),
  };
}

export function authoredDayStableKey(businessDate: string): string {
  return `night-shift:${businessDate}`;
}

export function validateAuthoredDayLines(
  lines: AuthoredDayLine[],
  allowlist: AuthoredDayAllowlist
): { ok: true } | { ok: false; reason: string } {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { ok: false, reason: "authored day must contain at least one line" };
  }
  for (const line of lines) {
    if (!line.id || !line.title?.trim() || !line.narrative?.trim()) {
      return { ok: false, reason: "each line requires id, title, and narrative" };
    }
    if (isBusyworkMission(`${line.title} ${line.narrative}`)) {
      return { ok: false, reason: "busywork missions are not allowed" };
    }
    if (!Array.isArray(line.provenance) || line.provenance.length === 0) {
      return { ok: false, reason: "each line requires provenance" };
    }
    for (const ref of line.provenance) {
      if (!ref.entityType || !ref.entityId?.trim() || !ref.sourceReference?.trim()) {
        return { ok: false, reason: "provenance entries must be complete" };
      }
      if (!provenanceAllowed(ref, allowlist)) {
        return {
          ok: false,
          reason: `unknown ${ref.entityType} id ${ref.entityId}`,
        };
      }
    }
  }
  return { ok: true };
}

export function applyAuthoredDayOrdering<T extends { id: string }>(
  stops: T[],
  lines: AuthoredDayLine[]
): T[] {
  const rank = new Map<string, number>();
  lines.forEach((line, index) => {
    for (const ref of line.provenance) {
      if (ref.entityType !== "field_item") continue;
      const stopId = ref.entityId.startsWith("pickup:")
        ? `native-pickup-${ref.entityId.slice("pickup:".length)}`
        : ref.entityId.startsWith("delivery:")
          ? `native-dropoff-${ref.entityId.slice("delivery:".length)}`
          : ref.entityId.startsWith("payment-blocker:")
            ? `native-dropoff-${ref.entityId.slice("payment-blocker:".length)}`
            : `living-world-${ref.entityId}`;
      if (!rank.has(stopId)) rank.set(stopId, index);
    }
  });
  return [...stops].sort(
    (a, b) =>
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
      a.id.localeCompare(b.id)
  );
}

function provenanceAllowed(
  ref: AuthoredDayProvenance,
  allowlist: AuthoredDayAllowlist
): boolean {
  switch (ref.entityType) {
    case "customer":
      return allowlist.customerIds.has(ref.entityId);
    case "physical_entity":
      return allowlist.physicalEntityIds.has(ref.entityId);
    case "field_item":
      return allowlist.fieldItemIds.has(ref.entityId);
    case "obligation":
      return allowlist.obligationIds.has(ref.entityId);
    case "territory":
      return allowlist.territoryIds.has(ref.entityId);
    case "operation":
      return allowlist.operationStableKeys.has(ref.entityId);
    case "campaign_chapter":
      return allowlist.campaignChapterIds.has(ref.entityId);
    case "order":
      return allowlist.orderIds.has(ref.entityId);
    case "external_order":
      return allowlist.externalOrderIds.has(ref.entityId);
    case "commercial_follow_up":
      return allowlist.followUpIds.has(ref.entityId);
    case "commercial_mission":
      return allowlist.missionIds.has(ref.entityId);
    default:
      return false;
  }
}
