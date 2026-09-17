import {
  CLAIRE_CONSCIOUSNESS_FORBIDDEN_PATTERNS,
  containsForbiddenHistoryClaim,
  type ClaireAssembledRelationshipHistory,
  type ClaireHistoryItem,
} from "../../../shared/claireRelationshipHistory";

export type ClaireRelationshipClosing = {
  kind: "relationship_closing";
  tenantId: string;
  operatorUserId: string;
  mutatesBusinessRecords: false;
  relationshipContinuity: "stopped";
  businessRecords: "preserved";
  eligibleHistoryIds: string[];
  closingMessage: string;
};

const ELIGIBLE_CLOSING_CLASSES = new Set(["verified-shared", "operator-declared"]);

function eligibleClosingItems(history: ClaireAssembledRelationshipHistory): ClaireHistoryItem[] {
  return history.items.filter(
    item =>
      ELIGIBLE_CLOSING_CLASSES.has(item.epistemicClass) &&
      item.temporalFrame !== "current_unverified" &&
      !containsForbiddenHistoryClaim(item.statement)
  );
}

/**
 * Deliberate relationship-ending artifact. Summarizes eligible verified
 * shared history and operator-declared statements only. Does not invent
 * feelings, consciousness, or diagnosis, and does not delete or mutate
 * business records.
 */
export function composeClaireRelationshipClosing(input: {
  tenantId: string;
  operatorUserId: string;
  history: ClaireAssembledRelationshipHistory;
}): ClaireRelationshipClosing {
  const eligible = eligibleClosingItems(input.history);
  const lines = eligible.slice(0, 5).map(item => item.statement);
  const body = lines.length
    ? `Here is a closing record of what we actually shared: ${lines.join(" ")} Relationship-specific continuity stops here. Authoritative business records are unchanged.`
    : "There is no eligible verified or operator-declared shared history to recap. Relationship-specific continuity stops here. Authoritative business records are unchanged.";
  if (
    CLAIRE_CONSCIOUSNESS_FORBIDDEN_PATTERNS.some(pattern => pattern.test(body)) ||
    containsForbiddenHistoryClaim(body)
  ) {
    return {
      kind: "relationship_closing",
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      mutatesBusinessRecords: false,
      relationshipContinuity: "stopped",
      businessRecords: "preserved",
      eligibleHistoryIds: [],
      closingMessage:
        "Relationship-specific continuity stops here. Authoritative business records are unchanged.",
    };
  }
  return {
    kind: "relationship_closing",
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    mutatesBusinessRecords: false,
    relationshipContinuity: "stopped",
    businessRecords: "preserved",
    eligibleHistoryIds: eligible.map(item => item.id),
    closingMessage: body,
  };
}
