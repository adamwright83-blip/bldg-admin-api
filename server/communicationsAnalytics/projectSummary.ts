import {
  BUSINESS_OUTCOMES_NOT_IMPLIED_BY_COMMUNICATIONS,
  type TwilioCommunicationReceipt,
} from "@shared/twilioPlatform";
import {
  COMMUNICATIONS_BUSINESS_SOURCES,
  INTERNAL_OPERATOR_CLAIRE_PARTY_CLASSES,
  PROVEN_EXTERNAL_PARTY_CLASSES,
  observedAverage,
  observedMedian,
  observedRate,
  type CommunicationPartyClass,
  type CommunicationsChannelMetrics,
  type CommunicationsDataQuality,
  type CommunicationsDownstreamAssociation,
  type CommunicationsEvidenceSummary,
  type CommunicationsLinkageSummary,
  type CommunicationsMessagingMetrics,
  type CommunicationsObservationWindow,
  type CommunicationsPartyClassification,
  type CommunicationsVoiceMetrics,
} from "@shared/communicationsAnalytics";
import { groupCallSessions, type CallSessionGroup } from "./callSessionGrouping";
import { instantInObservationWindow } from "./observationWindow";
import type {
  ClaireSessionLinkRecord,
  CommercialAcquisitionRecord,
  CommercialOrderAttributionRecord,
  CommunicationContextLinkRecord,
  CommunicationsProjectionFacts,
  OrderMoneyRecord,
  OrderPaymentProjectionRecord,
} from "./records";

const CALL_EVENTS = new Set<TwilioCommunicationReceipt["eventType"]>([
  "CALL_ATTEMPTED",
  "CALL_RINGING",
  "CALL_CONNECTED",
  "CALL_COMPLETED",
  "CALL_NO_ANSWER",
  "CALL_BUSY",
  "CALL_FAILED",
  "VOICEMAIL_DETECTED",
]);

const MESSAGE_EVENTS = new Set<TwilioCommunicationReceipt["eventType"]>([
  "MESSAGE_SENT",
  "MESSAGE_DELIVERED",
  "MESSAGE_FAILED",
]);

const INTERNAL_SET = new Set<string>(INTERNAL_OPERATOR_CLAIRE_PARTY_CLASSES);
const EXTERNAL_SET = new Set<string>(PROVEN_EXTERNAL_PARTY_CLASSES);
const TERMINAL_CALL = new Set([
  "CALL_COMPLETED",
  "CALL_NO_ANSWER",
  "CALL_BUSY",
  "CALL_FAILED",
]);

export type InvestorBucket = "all" | "internalOperatorClaire" | "provenExternal" | "unknown";

type ResourceKind = "call" | "message";

type LinkedOrderRef = {
  orderId: number;
  associatedAt: string;
  communicationObservedAt: string;
};

type ProjectedResource = {
  resourceKey: string;
  kind: ResourceKind;
  receipts: TwilioCommunicationReceipt[];
  callSids: string[];
  messageSid: string | null;
  partyClass: CommunicationPartyClass;
  investorBucket: Exclude<InvestorBucket, "all">;
  sessionLinked: boolean;
  missionLinked: boolean;
  actionLinked: boolean;
  campaignLinked: boolean;
  orderLinked: boolean;
  goldlineLinked: boolean;
  claireConversationId: string | null;
  missionId: number | null;
  relatedActionIds: string[];
  observedAt: string;
  collapsedLegCount: number;
  missingTerminalState: boolean;
  missingDuration: boolean;
  awaitingMessageTerminal: boolean;
  linkedOrders: LinkedOrderRef[];
};

function emptyVoice(): CommunicationsVoiceMetrics {
  return {
    uniqueSessionsAttempted: 0,
    uniqueSessionsRinging: 0,
    uniqueSessionsConnected: 0,
    uniqueSessionsCompleted: 0,
    uniqueSessionsNoAnswer: 0,
    uniqueSessionsBusy: 0,
    uniqueSessionsFailed: 0,
    uniqueSessionsVoicemailDetected: 0,
    observedConnectedDurationSeconds: null,
    observedConnectedDurationMinutes: null,
    averageConnectedDurationSeconds: null,
    medianConnectedDurationSeconds: null,
    connectionRate: null,
    completionRate: null,
  };
}

function emptyMessaging(): CommunicationsMessagingMetrics {
  return {
    uniqueMessagesSent: 0,
    uniqueMessagesDelivered: 0,
    uniqueMessagesFailed: 0,
    deliveryRate: null,
  };
}

function emptyChannels(): CommunicationsChannelMetrics {
  return { voice: emptyVoice(), messaging: emptyMessaging() };
}

function hasEvent(
  receipts: readonly TwilioCommunicationReceipt[],
  eventType: TwilioCommunicationReceipt["eventType"]
): boolean {
  return receipts.some(receipt => receipt.eventType === eventType);
}

function connectedDurations(
  receipts: readonly TwilioCommunicationReceipt[]
): number[] {
  const values: number[] = [];
  for (const receipt of receipts) {
    if (
      (receipt.eventType === "CALL_CONNECTED" ||
        receipt.eventType === "CALL_COMPLETED") &&
      typeof receipt.durationSeconds === "number" &&
      Number.isFinite(receipt.durationSeconds) &&
      receipt.durationSeconds >= 0
    ) {
      values.push(receipt.durationSeconds);
    }
  }
  return values;
}

function resourceObservedAt(receipts: readonly TwilioCommunicationReceipt[]): string {
  const instants = receipts
    .map(receipt => receipt.startedAt ?? receipt.createdAt)
    .filter(Boolean)
    .sort();
  return instants[0] ?? receipts[0]?.createdAt ?? new Date(0).toISOString();
}

function sessionForCallSids(
  callSids: readonly string[],
  sessions: readonly ClaireSessionLinkRecord[]
): ClaireSessionLinkRecord | null {
  const sidSet = new Set(callSids);
  return (
    sessions.find(
      session =>
        session.providerCallSid != null &&
        sidSet.has(session.providerCallSid.trim())
    ) ?? null
  );
}

function linksForSids(
  sids: readonly string[],
  links: readonly CommunicationContextLinkRecord[]
): CommunicationContextLinkRecord[] {
  const sidSet = new Set(sids);
  return links.filter(link => sidSet.has(link.providerResourceSid));
}

function relatedActionIds(session: ClaireSessionLinkRecord | null): string[] {
  if (!session) return [];
  return session.relatedActionIds.map(id => id.trim()).filter(Boolean);
}

function parseActionsFromLinks(
  resourceLinks: readonly CommunicationContextLinkRecord[]
): string[] {
  return resourceLinks
    .filter(
      link =>
        link.source === "explicit_action_link" &&
        link.goldlineEntityKind === "action" &&
        link.goldlineEntityId
    )
    .map(link => link.goldlineEntityId!)
    .filter(Boolean);
}

function specificExternalClass(
  resourceLinks: readonly CommunicationContextLinkRecord[]
): CommunicationPartyClass | null {
  const kinds = new Set(
    resourceLinks
      .map(link => link.goldlineEntityKind)
      .filter((kind): kind is NonNullable<typeof kind> => Boolean(kind))
  );
  if (kinds.has("customer")) return "external_customer";
  if (kinds.has("property_contact")) return "external_property_contact";
  if (kinds.has("commercial_contact")) return "external_commercial_contact";
  return null;
}

function classifyParty(input: {
  receipts: readonly TwilioCommunicationReceipt[];
  session: ClaireSessionLinkRecord | null;
  resourceLinks: readonly CommunicationContextLinkRecord[];
}): CommunicationPartyClass {
  const provenFromLinks = [
    ...new Set(
      input.resourceLinks
        .map(link => link.partyClass)
        .filter((value): value is CommunicationPartyClass => Boolean(value))
    ),
  ];
  const specific = specificExternalClass(input.resourceLinks);
  if (specific) return specific;
  if (provenFromLinks.length === 1) return provenFromLinks[0]!;
  if (provenFromLinks.length > 1) return "unknown";
  const hasExternalEntity = input.resourceLinks.some(link =>
    link.goldlineEntityKind === "customer" ||
    link.goldlineEntityKind === "property_contact" ||
    link.goldlineEntityKind === "commercial_contact" ||
    link.source === "explicit_order_link" ||
    link.source === "explicit_campaign_link"
  );
  const directions = new Set(
    input.receipts
      .map(receipt => receipt.direction)
      .filter((value): value is "inbound" | "outbound" => Boolean(value))
  );

  if (input.session) {
    if (directions.has("inbound") && !directions.has("outbound")) {
      return "operator_to_claire";
    }
    if (directions.has("outbound") && !directions.has("inbound")) {
      return "claire_to_operator";
    }
    if (directions.has("inbound") && directions.has("outbound")) {
      return "claire_to_operator";
    }
    return "unknown";
  }

  if (hasExternalEntity) {
    if (specific) return specific;
    if (directions.has("inbound") && !directions.has("outbound")) {
      return "external_to_operator";
    }
    const system = input.receipts.every(receipt => !receipt.operatorUserId);
    if (directions.has("outbound")) {
      return system ? "system_to_external" : "operator_to_external";
    }
    return "unknown";
  }

  return "unknown";
}

function investorBucketFor(
  partyClass: CommunicationPartyClass,
  sessionLinked: boolean
): Exclude<InvestorBucket, "all"> {
  if (INTERNAL_SET.has(partyClass)) return "internalOperatorClaire";
  if (EXTERNAL_SET.has(partyClass)) return "provenExternal";
  if (sessionLinked) return "internalOperatorClaire";
  return "unknown";
}

function emptyParty(): CommunicationsPartyClassification {
  return {
    operator_to_claire: 0,
    claire_to_operator: 0,
    system_to_operator: 0,
    operator_to_external: 0,
    system_to_external: 0,
    external_to_operator: 0,
    external_customer: 0,
    external_property_contact: 0,
    external_commercial_contact: 0,
    unknown: 0,
  };
}

function voiceMetrics(resources: readonly ProjectedResource[]): CommunicationsVoiceMetrics {
  const calls = resources.filter(resource => resource.kind === "call");
  const attempted = calls.filter(resource =>
    hasEvent(resource.receipts, "CALL_ATTEMPTED")
  ).length;
  const connected = calls.filter(resource =>
    hasEvent(resource.receipts, "CALL_CONNECTED")
  ).length;
  const completed = calls.filter(resource =>
    hasEvent(resource.receipts, "CALL_COMPLETED")
  ).length;
  const durations = calls.flatMap(resource => {
    const values = connectedDurations(resource.receipts);
    if (values.length === 0) return [];
    return [Math.max(...values)];
  });
  const totalDuration = durations.length === 0 ? null : durations.reduce((a, b) => a + b, 0);
  return {
    uniqueSessionsAttempted: attempted,
    uniqueSessionsRinging: calls.filter(resource =>
      hasEvent(resource.receipts, "CALL_RINGING")
    ).length,
    uniqueSessionsConnected: connected,
    uniqueSessionsCompleted: completed,
    uniqueSessionsNoAnswer: calls.filter(resource =>
      hasEvent(resource.receipts, "CALL_NO_ANSWER")
    ).length,
    uniqueSessionsBusy: calls.filter(resource =>
      hasEvent(resource.receipts, "CALL_BUSY")
    ).length,
    uniqueSessionsFailed: calls.filter(resource =>
      hasEvent(resource.receipts, "CALL_FAILED")
    ).length,
    uniqueSessionsVoicemailDetected: calls.filter(resource =>
      hasEvent(resource.receipts, "VOICEMAIL_DETECTED")
    ).length,
    observedConnectedDurationSeconds: totalDuration,
    observedConnectedDurationMinutes:
      totalDuration == null ? null : totalDuration / 60,
    averageConnectedDurationSeconds: observedAverage(durations),
    medianConnectedDurationSeconds: observedMedian(durations),
    connectionRate: observedRate(connected, attempted),
    completionRate: observedRate(completed, attempted),
  };
}

function messagingMetrics(
  resources: readonly ProjectedResource[]
): CommunicationsMessagingMetrics {
  const messages = resources.filter(resource => resource.kind === "message");
  const sent = messages.filter(resource =>
    hasEvent(resource.receipts, "MESSAGE_SENT")
  ).length;
  const delivered = messages.filter(resource =>
    hasEvent(resource.receipts, "MESSAGE_DELIVERED")
  ).length;
  return {
    uniqueMessagesSent: sent,
    uniqueMessagesDelivered: delivered,
    uniqueMessagesFailed: messages.filter(resource =>
      hasEvent(resource.receipts, "MESSAGE_FAILED")
    ).length,
    deliveryRate: observedRate(delivered, sent),
  };
}

function channelMetrics(
  resources: readonly ProjectedResource[]
): CommunicationsChannelMetrics {
  return {
    voice: voiceMetrics(resources),
    messaging: messagingMetrics(resources),
  };
}

function canonicalNetPaid(input: {
  orderId: number;
  attributions: readonly CommercialOrderAttributionRecord[];
  payments: readonly OrderPaymentProjectionRecord[];
  orders: readonly OrderMoneyRecord[];
}): {
  netPaidCents: number | null;
  financialReview: boolean;
  unknown: boolean;
  conflict: boolean;
} {
  const attribution = input.attributions.find(row => row.orderId === input.orderId);
  const payment = input.payments.find(row => row.orderId === input.orderId);
  const order = input.orders.find(row => row.orderId === input.orderId);
  const financialReview =
    attribution?.status === "financial_review" ||
    payment?.state === "review_required" ||
    (payment?.state === "partially_refunded" && payment.netPaidCents == null);
  if (financialReview) {
    return { netPaidCents: null, financialReview: true, unknown: true, conflict: false };
  }
  const reversed =
    attribution?.status === "reversed" ||
    payment?.state === "refunded" ||
    payment?.state === "cancelled" ||
    order?.status === "cancelled";
  if (reversed) {
    const orderTotalConflict =
      order?.totalCents != null && order.totalCents !== 0;
    return {
      netPaidCents: 0,
      financialReview: false,
      unknown: false,
      conflict: orderTotalConflict,
    };
  }
  const paymentNet = payment?.netPaidCents ?? null;
  const attributionNet = attribution?.netPaidCents ?? null;
  let conflict = false;
  if (paymentNet != null && attributionNet != null && paymentNet !== attributionNet) {
    conflict = true;
  }
  const canonical = paymentNet ?? attributionNet;
  if (canonical == null) {
    return { netPaidCents: null, financialReview: false, unknown: true, conflict };
  }
  if (order?.totalCents != null && order.totalCents !== canonical) {
    conflict = true;
  }
  return {
    netPaidCents: canonical,
    financialReview: false,
    unknown: false,
    conflict,
  };
}

function orderAssociatedAt(input: {
  acquisition: CommercialAcquisitionRecord | undefined;
  order: OrderMoneyRecord | undefined;
}): string {
  return (
    input.acquisition?.conversionAt ??
    input.order?.paidAt ??
    input.order?.createdAt ??
    input.acquisition?.createdAt ??
    new Date(0).toISOString()
  );
}

function linkedOrdersForResource(input: {
  missionId: number | null;
  resourceLinks: readonly CommunicationContextLinkRecord[];
  observedAt: string;
  acquisitions: readonly CommercialAcquisitionRecord[];
  orders: readonly OrderMoneyRecord[];
}): LinkedOrderRef[] {
  const orderIds = new Set<number>();
  if (input.missionId != null) {
    for (const acquisition of input.acquisitions) {
      if (acquisition.missionId === input.missionId) orderIds.add(acquisition.orderId);
    }
  }
  for (const link of input.resourceLinks) {
    if (link.source !== "explicit_order_link" || link.goldlineEntityKind !== "order") {
      continue;
    }
    const parsed = Number(link.goldlineEntityId);
    if (Number.isInteger(parsed) && parsed > 0) orderIds.add(parsed);
  }
  const refs: LinkedOrderRef[] = [];
  for (const orderId of orderIds) {
    const acquisition = input.acquisitions.find(row => row.orderId === orderId);
    const order = input.orders.find(row => row.orderId === orderId);
    refs.push({
      orderId,
      associatedAt: orderAssociatedAt({ acquisition, order }),
      communicationObservedAt: input.observedAt,
    });
  }
  return refs;
}

function isDownstream(ref: LinkedOrderRef): boolean {
  return new Date(ref.associatedAt).getTime() >= new Date(ref.communicationObservedAt).getTime();
}

function projectCallResource(input: {
  group: CallSessionGroup;
  receipts: readonly TwilioCommunicationReceipt[];
  facts: CommunicationsProjectionFacts;
}): ProjectedResource {
  const receipts = input.receipts.filter(receipt =>
    receipt.callSid != null && input.group.callSids.includes(receipt.callSid)
  );
  const session = sessionForCallSids(input.group.callSids, input.facts.claireSessions);
  const resourceLinks = linksForSids(input.group.callSids, input.facts.contextLinks);
  const actionIds = [
    ...new Set([
      ...relatedActionIds(session),
      ...parseActionsFromLinks(resourceLinks),
    ]),
  ];
  const missionId =
    session?.missionId ??
    (resourceLinks.find(
      link =>
        link.source === "explicit_mission_link" &&
        link.goldlineEntityKind === "mission" &&
        link.goldlineEntityId
    )
      ? Number(
          resourceLinks.find(
            link =>
              link.source === "explicit_mission_link" &&
              link.goldlineEntityKind === "mission"
          )?.goldlineEntityId
        )
      : null);
  const missionLinked = missionId != null && Number.isInteger(missionId);
  const sessionLinked = Boolean(session) || Boolean(input.group.claireConversationId);
  const campaignLinked = resourceLinks.some(
    link =>
      link.source === "explicit_campaign_link" &&
      link.goldlineEntityKind === "campaign"
  );
  const observedAt = resourceObservedAt(receipts);
  const linkedOrders = linkedOrdersForResource({
    missionId: missionLinked ? missionId : null,
    resourceLinks,
    observedAt,
    acquisitions: input.facts.acquisitions,
    orders: input.facts.orders,
  });
  const orderLinked = linkedOrders.length > 0;
  const partyClass = classifyParty({ receipts, session, resourceLinks });
  const events = new Set(receipts.map(receipt => receipt.eventType));
  const hasProgress =
    events.has("CALL_ATTEMPTED") ||
    events.has("CALL_RINGING") ||
    events.has("CALL_CONNECTED");
  const hasTerminal = [...events].some(event => TERMINAL_CALL.has(event));
  const connected = events.has("CALL_CONNECTED") || events.has("CALL_COMPLETED");
  return {
    resourceKey: input.group.callSessionKey,
    kind: "call",
    receipts,
    callSids: input.group.callSids,
    messageSid: null,
    partyClass,
    investorBucket: investorBucketFor(partyClass, sessionLinked),
    sessionLinked,
    missionLinked,
    actionLinked: actionIds.length > 0,
    campaignLinked,
    orderLinked,
    goldlineLinked:
      sessionLinked ||
      missionLinked ||
      actionIds.length > 0 ||
      campaignLinked ||
      orderLinked ||
      resourceLinks.length > 0,
    claireConversationId: input.group.claireConversationId,
    missionId: missionLinked ? missionId : null,
    relatedActionIds: actionIds,
    observedAt,
    collapsedLegCount: input.group.collapsedLegCount,
    missingTerminalState: hasProgress && !hasTerminal,
    missingDuration: connected && connectedDurations(receipts).length === 0,
    awaitingMessageTerminal: false,
    linkedOrders,
  };
}

function projectMessageResource(input: {
  messageSid: string;
  receipts: readonly TwilioCommunicationReceipt[];
  facts: CommunicationsProjectionFacts;
}): ProjectedResource {
  const receipts = input.receipts.filter(
    receipt => receipt.messageSid === input.messageSid
  );
  const resourceLinks = linksForSids([input.messageSid], input.facts.contextLinks);
  const conversationId =
    resourceLinks.find(
      link =>
        link.source === "claire_session_link" &&
        link.goldlineEntityKind === "conversation"
    )?.goldlineEntityId ?? null;
  const session = conversationId
    ? input.facts.claireSessions.find(
        row => row.claireConversationId === conversationId
      ) ?? null
    : null;
  const actionIds = [
    ...new Set([
      ...relatedActionIds(session),
      ...parseActionsFromLinks(resourceLinks),
    ]),
  ];
  const missionFromLink = resourceLinks.find(
    link =>
      link.source === "explicit_mission_link" &&
      link.goldlineEntityKind === "mission" &&
      link.goldlineEntityId
  );
  const missionId = session?.missionId ??
    (missionFromLink ? Number(missionFromLink.goldlineEntityId) : null);
  const missionLinked = missionId != null && Number.isInteger(missionId);
  const sessionLinked = Boolean(session) || Boolean(conversationId);
  const campaignLinked = resourceLinks.some(
    link =>
      link.source === "explicit_campaign_link" &&
      link.goldlineEntityKind === "campaign"
  );
  const observedAt = resourceObservedAt(receipts);
  const linkedOrders = linkedOrdersForResource({
    missionId: missionLinked ? missionId : null,
    resourceLinks,
    observedAt,
    acquisitions: input.facts.acquisitions,
    orders: input.facts.orders,
  });
  const partyClass = classifyParty({ receipts, session, resourceLinks });
  const events = new Set(receipts.map(receipt => receipt.eventType));
  return {
    resourceKey: `message:${input.messageSid}`,
    kind: "message",
    receipts,
    callSids: [],
    messageSid: input.messageSid,
    partyClass,
    investorBucket: investorBucketFor(partyClass, sessionLinked),
    sessionLinked,
    missionLinked,
    actionLinked: actionIds.length > 0,
    campaignLinked,
    orderLinked: linkedOrders.length > 0,
    goldlineLinked:
      sessionLinked ||
      missionLinked ||
      actionIds.length > 0 ||
      campaignLinked ||
      linkedOrders.length > 0 ||
      resourceLinks.length > 0,
    claireConversationId: conversationId,
    missionId: missionLinked ? missionId : null,
    relatedActionIds: actionIds,
    observedAt,
    collapsedLegCount: 0,
    missingTerminalState: false,
    missingDuration: false,
    awaitingMessageTerminal:
      events.has("MESSAGE_SENT") &&
      !events.has("MESSAGE_DELIVERED") &&
      !events.has("MESSAGE_FAILED"),
    linkedOrders,
  };
}

function assertNoBusinessOutcomes(summary: CommunicationsEvidenceSummary): void {
  const serialized = JSON.stringify(summary);
  for (const outcome of BUSINESS_OUTCOMES_NOT_IMPLIED_BY_COMMUNICATIONS) {
    if (serialized.includes(outcome)) {
      throw new Error(
        `communications analytics implied business outcome ${outcome}`
      );
    }
  }
}

function redactProjection(summary: CommunicationsEvidenceSummary): CommunicationsEvidenceSummary {
  const serialized = JSON.stringify(summary);
  if (/\+\d{10,}/.test(serialized) || /E\.164|transcript|recordingSid/i.test(serialized)) {
    throw new Error("communications analytics projection contained raw PII");
  }
  return summary;
}

export function projectCommunicationsEffectiveness(input: {
  facts: CommunicationsProjectionFacts;
  observationWindow: CommunicationsObservationWindow;
}): CommunicationsEvidenceSummary {
  const tenantId = input.facts.tenantId.trim();
  const receipts = input.facts.receipts.filter(
    receipt =>
      receipt.tenantId === tenantId &&
      instantInObservationWindow(receipt.createdAt, input.observationWindow) &&
      (CALL_EVENTS.has(receipt.eventType) || MESSAGE_EVENTS.has(receipt.eventType))
  );
  const claireSessions = input.facts.claireSessions.filter(
    session => session.tenantId === tenantId
  );
  const contextLinks = input.facts.contextLinks.filter(
    link => link.tenantId === tenantId
  );
  const facts: CommunicationsProjectionFacts = {
    ...input.facts,
    tenantId,
    receipts,
    claireSessions,
    contextLinks,
    acquisitions: input.facts.acquisitions.filter(row => row.tenantId === tenantId),
    orderAttributions: input.facts.orderAttributions.filter(
      row => row.tenantId === tenantId
    ),
    paymentProjections: input.facts.paymentProjections.filter(
      row => row.tenantId === tenantId
    ),
    orders: input.facts.orders.filter(row => row.tenantId === tenantId),
  };

  const callReceipts = receipts.filter(receipt => receipt.callSid);
  const groups = groupCallSessions({
    receipts: callReceipts,
    sessions: claireSessions,
    contextLinks,
  });
  const callResources = groups
    .map(group => projectCallResource({ group, receipts: callReceipts, facts }))
    .filter(resource => resource.receipts.length > 0);

  const messageSids = [
    ...new Set(
      receipts
        .map(receipt => receipt.messageSid?.trim() ?? "")
        .filter(Boolean)
    ),
  ];
  const messageResources = messageSids.map(messageSid =>
    projectMessageResource({ messageSid, receipts, facts })
  );

  const resources = [...callResources, ...messageResources];
  const partyClassification = emptyParty();
  for (const resource of resources) {
    partyClassification[resource.partyClass] += 1;
  }

  const goldlineLinked = resources.filter(resource => resource.goldlineLinked);
  const sessionLinkedButMissionUnlinked = resources.filter(
    resource => resource.sessionLinked && !resource.missionLinked
  );

  const downstreamOrderIds = new Set<number>();
  const paidOrderIds = new Set<number>();
  const unknownNetOrderIds = new Set<number>();
  const financialReviewOrderIds = new Set<number>();
  const conflictOrderIds = new Set<number>();
  let associatedNetPaidCents: number | null = 0;
  let hasKnownNet = false;

  for (const resource of resources) {
    for (const ref of resource.linkedOrders) {
      if (!isDownstream(ref)) continue;
      downstreamOrderIds.add(ref.orderId);
      const money = canonicalNetPaid({
        orderId: ref.orderId,
        attributions: facts.orderAttributions,
        payments: facts.paymentProjections,
        orders: facts.orders,
      });
      if (money.conflict) conflictOrderIds.add(ref.orderId);
      if (money.financialReview) {
        financialReviewOrderIds.add(ref.orderId);
        continue;
      }
      if (money.unknown || money.netPaidCents == null) {
        unknownNetOrderIds.add(ref.orderId);
        continue;
      }
      paidOrderIds.add(ref.orderId);
    }
  }

  for (const orderId of paidOrderIds) {
    const money = canonicalNetPaid({
      orderId,
      attributions: facts.orderAttributions,
      payments: facts.paymentProjections,
      orders: facts.orders,
    });
    if (money.netPaidCents == null) continue;
    hasKnownNet = true;
    associatedNetPaidCents = (associatedNetPaidCents ?? 0) + money.netPaidCents;
  }
  if (!hasKnownNet) {
    associatedNetPaidCents = unknownNetOrderIds.size > 0 ? null : 0;
  } else if (unknownNetOrderIds.size > 0) {
    // Known nets are summed; unknown is not coerced to zero.
  }

  const paidResourceCount = resources.filter(resource =>
    resource.linkedOrders.some(
      ref => isDownstream(ref) && paidOrderIds.has(ref.orderId)
    )
  ).length;
  const downstreamResourceCount = resources.filter(resource =>
    resource.linkedOrders.some(ref => isDownstream(ref))
  ).length;

  const linkage: CommunicationsLinkageSummary = {
    goldlineLinkedCount: goldlineLinked.length,
    unlinkedCount: resources.filter(resource => !resource.goldlineLinked).length,
    sessionLinkedCount: resources.filter(resource => resource.sessionLinked).length,
    missionLinkedCount: resources.filter(resource => resource.missionLinked).length,
    actionLinkedCount: resources.filter(resource => resource.actionLinked).length,
    campaignLinkedCount: resources.filter(resource => resource.campaignLinked)
      .length,
    orderLinkedCount: resources.filter(resource => resource.orderLinked).length,
    sessionLinkedButMissionUnlinkedCount: sessionLinkedButMissionUnlinked.length,
  };

  const downstreamAssociation: CommunicationsDownstreamAssociation = {
    communicationOnlyCount: resources.filter(resource => !resource.goldlineLinked)
      .length,
    goldlineLinkedCount: goldlineLinked.length,
    downstreamOutcomeAssociatedCount: downstreamResourceCount,
    paidRevenueAssociatedCount: paidResourceCount,
    associatedPaidOrderCount: paidOrderIds.size,
    associatedNetPaidCents,
    associatedNetPaidUnknownOrderCount: unknownNetOrderIds.size,
  };

  const dataQuality: CommunicationsDataQuality = {
    unknownPartyClassCount: resources.filter(
      resource => resource.partyClass === "unknown"
    ).length,
    internalOperatorCommunicationCount: resources.filter(
      resource => resource.investorBucket === "internalOperatorClaire"
    ).length,
    externalCommunicationCount: resources.filter(
      resource => resource.investorBucket === "provenExternal"
    ).length,
    unlinkedCommunicationCount: linkage.unlinkedCount,
    sessionLinkedButMissionUnlinkedCount: sessionLinkedButMissionUnlinked.length,
    callLegsCollapsedCount: callResources.reduce(
      (sum, resource) => sum + resource.collapsedLegCount,
      0
    ),
    callsMissingTerminalStateCount: callResources.filter(
      resource => resource.missingTerminalState
    ).length,
    callsMissingDurationCount: callResources.filter(
      resource => resource.missingDuration
    ).length,
    messagesAwaitingTerminalStateCount: messageResources.filter(
      resource => resource.awaitingMessageTerminal
    ).length,
    financialReviewOrdersExcludedCount: financialReviewOrderIds.size,
    financialConflictCount: conflictOrderIds.size,
  };

  const summary: CommunicationsEvidenceSummary = {
    observationWindow: input.observationWindow,
    communications: {
      all: channelMetrics(resources),
      internalOperatorClaire: channelMetrics(
        resources.filter(resource => resource.investorBucket === "internalOperatorClaire")
      ),
      provenExternal: channelMetrics(
        resources.filter(resource => resource.investorBucket === "provenExternal")
      ),
      unknown: channelMetrics(
        resources.filter(resource => resource.investorBucket === "unknown")
      ),
    },
    partyClassification,
    linkage,
    downstreamAssociation,
    dataQuality,
    provenance: {
      communicationSource: "communication_receipts",
      businessSources: COMMUNICATIONS_BUSINESS_SOURCES,
      causalClaim: false,
    },
  };
  assertNoBusinessOutcomes(summary);
  return redactProjection(summary);
}
