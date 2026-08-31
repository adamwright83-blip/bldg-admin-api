/**
 * Goldline's truth-bound world contract.
 *
 * This module deliberately contains no persistence and no presentation state.
 * It classifies references to authoritative records and deterministically
 * projects what the world may say about a physical entity.
 */

export const GOLDLINE_EVENT_CLASSIFICATIONS = [
  "evidence",
  "action",
  "outcome",
  "derived_signal",
  "game_projection",
] as const;
export type GoldlineEventClassification =
  (typeof GOLDLINE_EVENT_CLASSIFICATIONS)[number];

export const GOLDLINE_PROVENANCE_CLASSES = [
  "operator_observed",
  "operator_reported",
  "device_location",
  "provider_verified",
  "official_property_source",
  "existing_business_record",
  "derived",
  "generated_game_fiction",
] as const;
export type GoldlineProvenanceClass =
  (typeof GOLDLINE_PROVENANCE_CLASSES)[number];

export const EPISTEMIC_STATES = [
  "confirmed",
  "conflicting",
  "unknown",
  "inferred",
  "forecast_pressure",
  "game_fiction",
] as const;
export type EpistemicState = (typeof EPISTEMIC_STATES)[number];

export type GoldlineWorldEvent = {
  id: string;
  tenantId: string;
  physicalEntityId: string | null;
  eventType: string;
  classification: GoldlineEventClassification;
  actorType: "system" | "operator" | "field" | "customer" | "provider" | "unknown";
  actorId: string | null;
  occurredAt: string;
  observedAt: string | null;
  sourceType: string;
  sourceId: string;
  sourceEvidenceReference: string;
  provenanceClass: GoldlineProvenanceClass;
  verificationClass: "VERIFIED" | "ATTESTED" | "CLAIMED";
  confidence: "high" | "medium" | "low" | "unknown";
  idempotencyKey: string;
  correlationId: string;
  metadata: Record<string, unknown>;
};

export type WorldHistoryMark =
  | "discovered"
  | "visited"
  | "contacted"
  | "proposal_sent"
  | "lost"
  | "won"
  | "customer_activity"
  | "recovery";

export type ProjectedPhysicalWorldState = {
  physicalEntityId: string;
  commercialState:
    | "none"
    | "discovered"
    | "pursued"
    | "won"
    | "lost";
  historyMarks: Array<{
    semantic: WorldHistoryMark;
    eventId: string;
    occurredAt: string;
    explanation: string;
    sourceEvidenceReference: string;
  }>;
  residentIntensity: number;
  illumination: "dark" | "dim" | "active";
  recoveryState: "none" | "attempted" | "recovered";
  epistemicState: EpistemicState;
  attentionReasons: AttentionReason[];
  canonicalTowerAssetId: string | null;
};

const ACTION_EVENT_TYPES = new Set([
  "call_completed",
  "text_sent",
  "email_sent",
  "visit_attempted",
  "visited",
  "collateral_delivered",
  "proposal_sent",
  "recovery_outreach_completed",
  "pickup_completed",
  "delivery_completed",
  "field_journal_saved",
]);

const OUTCOME_EVENT_TYPES = new Set([
  "account_won",
  "account_lost",
  "customer_recovered",
  "customer_became_dormant",
  "order_paid",
]);

/** Rejects semantic inflation at the contract boundary. */
export function eventClassificationForType(
  eventType: string
): GoldlineEventClassification | null {
  if (ACTION_EVENT_TYPES.has(eventType)) return "action";
  if (OUTCOME_EVENT_TYPES.has(eventType)) return "outcome";
  return null;
}

export function classificationIsTruthful(input: {
  eventType: string;
  classification: GoldlineEventClassification;
}): boolean {
  const required = eventClassificationForType(input.eventType);
  return required === null || required === input.classification;
}

export function markForWorldEvent(
  event: GoldlineWorldEvent
): WorldHistoryMark | null {
  switch (event.eventType) {
    case "prospect_discovered":
    case "tower_published":
      return "discovered";
    case "visit_attempted":
    case "visited":
      return "visited";
    case "call_completed":
    case "text_sent":
    case "email_sent":
    case "recovery_outreach_completed":
      return "contacted";
    case "proposal_sent":
      return "proposal_sent";
    case "account_lost":
      return "lost";
    case "account_won":
      return "won";
    case "resident_first_seen":
    case "resident_activity_changed":
      return "customer_activity";
    case "customer_recovered":
      return "recovery";
    default:
      return null;
  }
}

function markExplanation(mark: WorldHistoryMark, event: GoldlineWorldEvent) {
  const date = event.occurredAt.slice(0, 10);
  const labels: Record<WorldHistoryMark, string> = {
    discovered: "Discovered",
    visited: "Real visit recorded",
    contacted: "Contact attempted",
    proposal_sent: "Proposal delivered",
    lost: "Commercial account lost",
    won: "Commercial relationship won",
    customer_activity: "Resident activity changed",
    recovery: "Customer recovered by authoritative activity",
  };
  return `${labels[mark]} · ${date}`;
}

export type AttentionReason = {
  code:
    | "customer_cadence_risk"
    | "overdue_follow_up"
    | "revenue_concentration"
    | "resident_penetration"
    | "commercial_momentum"
    | "geographic_opportunity"
    | "unresolved_evidence"
    | "recent_field_signal";
  weight: number;
  explanation: string;
  sourceEvidenceReference: string;
};

export function deriveAttentionReasons(input: {
  cadenceRisk?: { daysLate: number; source: string } | null;
  overdueFollowUp?: { dueAt: string; source: string } | null;
  revenueShare?: { fraction: number; source: string } | null;
  residentCount?: { count: number; source: string } | null;
  commercialMomentum?: { eventAt: string; source: string } | null;
  nearbyObjectiveCount?: { count: number; source: string } | null;
  unresolvedEvidence?: { count: number; source: string } | null;
  recentFieldSignal?: { occurredAt: string; source: string } | null;
}): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  if (input.cadenceRisk && input.cadenceRisk.daysLate > 0)
    reasons.push({
      code: "customer_cadence_risk",
      weight: Math.min(1, input.cadenceRisk.daysLate / 30),
      explanation: `${input.cadenceRisk.daysLate} days beyond observed cadence`,
      sourceEvidenceReference: input.cadenceRisk.source,
    });
  if (input.overdueFollowUp)
    reasons.push({
      code: "overdue_follow_up",
      weight: 1,
      explanation: `Follow-up was due ${input.overdueFollowUp.dueAt}`,
      sourceEvidenceReference: input.overdueFollowUp.source,
    });
  if (input.revenueShare && input.revenueShare.fraction >= 0.25)
    reasons.push({
      code: "revenue_concentration",
      weight: Math.min(1, input.revenueShare.fraction),
      explanation: `${Math.round(input.revenueShare.fraction * 100)}% of observed revenue is concentrated here`,
      sourceEvidenceReference: input.revenueShare.source,
    });
  if (input.residentCount && input.residentCount.count > 1)
    reasons.push({
      code: "resident_penetration",
      weight: Math.min(1, input.residentCount.count / 10),
      explanation: `${input.residentCount.count} real resident customers share this property`,
      sourceEvidenceReference: input.residentCount.source,
    });
  if (input.commercialMomentum)
    reasons.push({
      code: "commercial_momentum",
      weight: 0.65,
      explanation: `Commercial relationship moved on ${input.commercialMomentum.eventAt.slice(0, 10)}`,
      sourceEvidenceReference: input.commercialMomentum.source,
    });
  if (input.nearbyObjectiveCount && input.nearbyObjectiveCount.count > 1)
    reasons.push({
      code: "geographic_opportunity",
      weight: Math.min(0.8, input.nearbyObjectiveCount.count / 10),
      explanation: `${input.nearbyObjectiveCount.count} real objectives are geographically nearby`,
      sourceEvidenceReference: input.nearbyObjectiveCount.source,
    });
  if (input.unresolvedEvidence && input.unresolvedEvidence.count > 0)
    reasons.push({
      code: "unresolved_evidence",
      weight: 0.7,
      explanation: `${input.unresolvedEvidence.count} important evidence conflict${input.unresolvedEvidence.count === 1 ? "" : "s"} remain`,
      sourceEvidenceReference: input.unresolvedEvidence.source,
    });
  if (input.recentFieldSignal)
    reasons.push({
      code: "recent_field_signal",
      weight: 0.55,
      explanation: `Field intelligence arrived ${input.recentFieldSignal.occurredAt.slice(0, 10)}`,
      sourceEvidenceReference: input.recentFieldSignal.source,
    });
  return reasons.sort((a, b) => b.weight - a.weight || a.code.localeCompare(b.code));
}

export function deriveEpistemicState(input: {
  hasConfirmedEvidence: boolean;
  hasConflict: boolean;
  hasInference: boolean;
  hasForecastPressure: boolean;
  isGameFiction?: boolean;
}): EpistemicState {
  if (input.isGameFiction) return "game_fiction";
  if (input.hasConflict) return "conflicting";
  if (input.hasConfirmedEvidence) return "confirmed";
  if (input.hasInference) return "inferred";
  if (input.hasForecastPressure) return "forecast_pressure";
  return "unknown";
}

export function projectPhysicalWorldState(input: {
  physicalEntityId: string;
  events: GoldlineWorldEvent[];
  residentCount: number;
  activeResidentCount: number;
  epistemicState: EpistemicState;
  attentionReasons?: AttentionReason[];
  canonicalTowerAssetId?: string | null;
}): ProjectedPhysicalWorldState {
  const ordered = [...input.events].sort(
    (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.id.localeCompare(b.id)
  );
  let commercialState: ProjectedPhysicalWorldState["commercialState"] = "none";
  let recoveryState: ProjectedPhysicalWorldState["recoveryState"] = "none";
  const historyMarks: ProjectedPhysicalWorldState["historyMarks"] = [];
  for (const event of ordered) {
    if (!classificationIsTruthful(event)) continue;
    if (event.eventType === "prospect_discovered") commercialState = "discovered";
    if (["visited", "visit_attempted", "proposal_sent"].includes(event.eventType) && commercialState !== "won" && commercialState !== "lost") commercialState = "pursued";
    if (event.eventType === "account_won" && event.classification === "outcome") commercialState = "won";
    if (event.eventType === "account_lost" && event.classification === "outcome") commercialState = "lost";
    if (event.eventType === "recovery_outreach_completed" && event.classification === "action" && recoveryState !== "recovered") recoveryState = "attempted";
    if (event.eventType === "customer_recovered" && event.classification === "outcome") recoveryState = "recovered";
    const semantic = markForWorldEvent(event);
    if (semantic) historyMarks.push({
      semantic,
      eventId: event.id,
      occurredAt: event.occurredAt,
      explanation: markExplanation(semantic, event),
      sourceEvidenceReference: event.sourceEvidenceReference,
    });
  }
  return {
    physicalEntityId: input.physicalEntityId,
    commercialState,
    historyMarks,
    residentIntensity: Math.max(0, input.residentCount),
    illumination: input.activeResidentCount > 0 ? "active" : input.residentCount > 0 ? "dim" : "dark",
    recoveryState,
    epistemicState: input.epistemicState,
    attentionReasons: input.attentionReasons ?? [],
    canonicalTowerAssetId: input.canonicalTowerAssetId ?? null,
  };
}

export type CelebrationDescriptor = {
  eventId: string;
  label: string;
  magnitude: "whisper" | "murmur" | "beat" | "surge" | "detonation";
  cue: "field_intel" | "call" | "follow_up" | "visit" | "proposal" | "recovery" | "tower" | "outcome";
};

export function celebrationForEvent(
  event: GoldlineWorldEvent
): CelebrationDescriptor | null {
  if (event.classification !== "action" && event.classification !== "outcome" && event.eventType !== "tower_review_ready") return null;
  const map: Record<string, Omit<CelebrationDescriptor, "eventId">> = {
    field_journal_saved: { label: "FIELD INTEL SECURED", magnitude: "beat", cue: "field_intel" },
    call_completed: { label: "CALL MADE", magnitude: "beat", cue: "call" },
    text_sent: { label: "FOLLOW-UP SENT", magnitude: "beat", cue: "follow_up" },
    email_sent: { label: "FOLLOW-UP SENT", magnitude: "beat", cue: "follow_up" },
    visited: { label: "YOU SHOWED UP", magnitude: "surge", cue: "visit" },
    visit_attempted: { label: "YOU SHOWED UP", magnitude: "beat", cue: "visit" },
    proposal_sent: { label: "PROPOSAL DELIVERED", magnitude: "surge", cue: "proposal" },
    recovery_outreach_completed: { label: "SIGNAL SENT", magnitude: "beat", cue: "recovery" },
    tower_review_ready: { label: "NEW TOWER DISCOVERED", magnitude: "surge", cue: "tower" },
    customer_recovered: { label: "LANTERN RELIT", magnitude: "detonation", cue: "outcome" },
    account_won: { label: "RELATIONSHIP WON", magnitude: "detonation", cue: "outcome" },
  };
  const descriptor = map[event.eventType];
  return descriptor ? { eventId: event.id, ...descriptor } : null;
}
