/**
 * Communications analytics + explicit Goldline linkage contract.
 *
 * Provider receipts prove provider activity. Explicit Goldline links prove
 * Goldline context. Associated downstream records are associations, not
 * proof that a call or message caused a business outcome.
 */

export const COMMUNICATIONS_ANALYTICS_WINDOW_DAYS = [7, 30, 90] as const;
export type CommunicationsAnalyticsWindowDays =
  (typeof COMMUNICATIONS_ANALYTICS_WINDOW_DAYS)[number];

export const COMMUNICATION_CONTEXT_LINK_TABLE =
  "communication_context_links" as const;

export const COMMUNICATION_LINK_SOURCES = [
  "direct_provider_link",
  "claire_session_link",
  "explicit_mission_link",
  "explicit_action_link",
  "explicit_campaign_link",
  "explicit_order_link",
] as const;

export type CommunicationLinkSource = (typeof COMMUNICATION_LINK_SOURCES)[number];

export const COMMUNICATION_PARTY_CLASSES = [
  "operator_to_claire",
  "claire_to_operator",
  "system_to_operator",
  "operator_to_external",
  "system_to_external",
  "external_to_operator",
  "external_customer",
  "external_property_contact",
  "external_commercial_contact",
  "unknown",
] as const;

export type CommunicationPartyClass = (typeof COMMUNICATION_PARTY_CLASSES)[number];

export const INTERNAL_OPERATOR_CLAIRE_PARTY_CLASSES = [
  "operator_to_claire",
  "claire_to_operator",
  "system_to_operator",
] as const;

export const PROVEN_EXTERNAL_PARTY_CLASSES = [
  "operator_to_external",
  "system_to_external",
  "external_to_operator",
  "external_customer",
  "external_property_contact",
  "external_commercial_contact",
] as const;

export const COMMUNICATION_LINK_ENTITY_KINDS = [
  "session",
  "conversation",
  "mission",
  "action",
  "campaign",
  "order",
  "operator",
  "customer",
  "property_contact",
  "commercial_contact",
] as const;

export type CommunicationLinkEntityKind =
  (typeof COMMUNICATION_LINK_ENTITY_KINDS)[number];

/**
 * Exact call-session grouping rule. Analytics projection only.
 * Raw communication_receipts rows are never rewritten.
 */
export const CALL_SESSION_GROUPING_RULE =
  "A call session is the union of CallSids connected by receipt.parentCallSid (walk each child to its root parent) or by an explicit Claire conversation identity (claire_conversation_sessions.claireConversationId via providerCallSid, or a communication_context_links row with source claire_session_link and entity kind conversation). Independent CallSids with neither a parent relationship nor a shared Claire conversation remain separate sessions. Phone numbers, timestamps, transcripts, message text, names, geography, and LLM similarity never join sessions. Provider SIDs are never Goldline entity IDs. Raw receipts are preserved. The callSessionKey is an analytics projection only.";

export const COMMUNICATIONS_BANNED_UI_LABELS = [
  "Converted",
  "Conversions",
  "Generated revenue",
  "Revenue generated",
  "Influenced revenue",
  "Sourced revenue",
  "Attributed revenue",
  "Claire revenue",
  "Claire ROI",
  "Agent ROI",
] as const;

export const COMMUNICATIONS_UI_DISCLAIMER =
  "Communication receipts prove provider activity. Downstream figures are shown only when Goldline has an explicit authoritative link. These are observed associations, not proof that a call or message caused the business outcome.";

export type CommunicationsObservationWindow = {
  windowDays: CommunicationsAnalyticsWindowDays;
  timeZone: string;
  startUtc: string;
  endExclusiveUtc: string;
};

export type CommunicationsVoiceMetrics = {
  uniqueSessionsAttempted: number;
  uniqueSessionsRinging: number;
  uniqueSessionsConnected: number;
  uniqueSessionsCompleted: number;
  uniqueSessionsNoAnswer: number;
  uniqueSessionsBusy: number;
  uniqueSessionsFailed: number;
  uniqueSessionsVoicemailDetected: number;
  observedConnectedDurationSeconds: number | null;
  observedConnectedDurationMinutes: number | null;
  averageConnectedDurationSeconds: number | null;
  medianConnectedDurationSeconds: number | null;
  connectionRate: number | null;
  completionRate: number | null;
};

export type CommunicationsMessagingMetrics = {
  uniqueMessagesSent: number;
  uniqueMessagesDelivered: number;
  uniqueMessagesFailed: number;
  deliveryRate: number | null;
};

export type CommunicationsChannelMetrics = {
  voice: CommunicationsVoiceMetrics;
  messaging: CommunicationsMessagingMetrics;
};

export type CommunicationsPartyClassification = {
  operator_to_claire: number;
  claire_to_operator: number;
  system_to_operator: number;
  operator_to_external: number;
  system_to_external: number;
  external_to_operator: number;
  external_customer: number;
  external_property_contact: number;
  external_commercial_contact: number;
  unknown: number;
};

export type CommunicationsLinkageSummary = {
  goldlineLinkedCount: number;
  unlinkedCount: number;
  sessionLinkedCount: number;
  missionLinkedCount: number;
  actionLinkedCount: number;
  campaignLinkedCount: number;
  orderLinkedCount: number;
  sessionLinkedButMissionUnlinkedCount: number;
};

export type CommunicationsDownstreamAssociation = {
  communicationOnlyCount: number;
  goldlineLinkedCount: number;
  downstreamOutcomeAssociatedCount: number;
  paidRevenueAssociatedCount: number;
  associatedPaidOrderCount: number;
  associatedNetPaidCents: number | null;
  associatedNetPaidUnknownOrderCount: number;
};

export type CommunicationsDataQuality = {
  unknownPartyClassCount: number;
  internalOperatorCommunicationCount: number;
  externalCommunicationCount: number;
  unlinkedCommunicationCount: number;
  sessionLinkedButMissionUnlinkedCount: number;
  callLegsCollapsedCount: number;
  callsMissingTerminalStateCount: number;
  callsMissingDurationCount: number;
  messagesAwaitingTerminalStateCount: number;
  financialReviewOrdersExcludedCount: number;
  financialConflictCount: number;
};

export type CommunicationsProvenance = {
  communicationSource: "communication_receipts";
  businessSources: readonly string[];
  causalClaim: false;
};

export const COMMUNICATIONS_BUSINESS_SOURCES = [
  "claire_conversation_sessions",
  "communication_context_links",
  "commercial_order_acquisition_attributions",
  "commercial_order_attributions",
  "commercial_customer_acquisition_sources",
  "order_payment_projections",
] as const;

export type CommunicationsEvidenceSummary = {
  observationWindow: CommunicationsObservationWindow;
  communications: {
    all: CommunicationsChannelMetrics;
    internalOperatorClaire: CommunicationsChannelMetrics;
    provenExternal: CommunicationsChannelMetrics;
    unknown: CommunicationsChannelMetrics;
  };
  partyClassification: CommunicationsPartyClassification;
  linkage: CommunicationsLinkageSummary;
  downstreamAssociation: CommunicationsDownstreamAssociation;
  dataQuality: CommunicationsDataQuality;
  provenance: CommunicationsProvenance;
};

export function isCommunicationsAnalyticsWindowDays(
  value: number
): value is CommunicationsAnalyticsWindowDays {
  return (COMMUNICATIONS_ANALYTICS_WINDOW_DAYS as readonly number[]).includes(
    value
  );
}

export function isCommunicationLinkSource(
  value: string
): value is CommunicationLinkSource {
  return (COMMUNICATION_LINK_SOURCES as readonly string[]).includes(value);
}

export function isCommunicationPartyClass(
  value: string
): value is CommunicationPartyClass {
  return (COMMUNICATION_PARTY_CLASSES as readonly string[]).includes(value);
}

/** Zero denominator is unknown, not 0% or 100%. Observed 0/n remains 0. */
export function observedRate(
  numerator: number,
  denominator: number
): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

export function observedMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function observedAverage(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function communicationContextLinkIdempotencyKey(input: {
  tenantId: string;
  providerResourceSid: string;
  source: CommunicationLinkSource;
  goldlineEntityKind: string | null;
  goldlineEntityId: string | null;
  partyClass: CommunicationPartyClass | null;
}): string {
  const tenantId = input.tenantId.trim();
  const sid = input.providerResourceSid.trim();
  if (!tenantId || !sid) {
    throw new Error("communication context link requires tenantId and provider SID");
  }
  return [
    tenantId,
    sid,
    input.source,
    input.goldlineEntityKind?.trim() || "_",
    input.goldlineEntityId?.trim() || "_",
    input.partyClass ?? "_",
  ].join(":");
}
