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
