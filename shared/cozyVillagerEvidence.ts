/**
 * Evidence contract for Lantern City cozy outreach and the Day Line card
 * that reads the same mission.
 *
 * Durable facts live on scheduled_outreach_messages and the operator's
 * existing Daphne goal. Pose frames are a projection of those facts.
 * This module does not send, schedule, or invent customers.
 */
import {
  COZY_SLOT_ANCHORS,
  COZY_SLOT_IDS,
  type CozyCustomerTarget,
  type CozyEncounterMission,
  type CozySlotId,
  type VillagerAnimationState,
  type VillagerVariant,
} from "./cozyVillagerOutreach";
import {
  describeMissionAdjustment,
  type DaphneMissionAdjustment,
} from "./daphneMissionPresentation";
import {
  projectSilverLakeOutreachStatus,
  type SilverLakeHandoffEvent,
  type SilverLakeOutreachSnapshot,
  type SilverLakeTrustedSend,
} from "./silverLakeOutreachStatus";

export const COZY_VILLAGER_EVIDENCE_CONTRACT = {
  draftPrepared:
    "No outbox row. The composer shows the server-prepared suggestion from the win-back read (customer name and days since last order). An edit is not durable until Send Now or Schedule writes scheduled_outreach_messages.",
  scheduledAck:
    "scheduled_outreach_messages.status is pending and deliveryIntent is scheduled. Pose is wave. Scheduled is not sent.",
  awaitingSender:
    "status awaiting_sender_setup. Pose is wave. Awaiting a sender is not sent.",
  claimed:
    "status claimed. Pose is wave. A lease is not a send observation.",
  sendAck:
    "status dispatched with both dispatchedAt and externalMessageId. The acknowledged pose is used only for this state.",
  failed:
    "status failed. Pose stays idle. Failed is not sent.",
  reply:
    "Unavailable. The personal-number outbox stores no inbound reply. Spirit-human inbound SMS is a different rail and is not read as a reply.",
  paidOrder:
    "Unavailable unless an admitted paid-order reference includes an authority receipt and a positive amount. An order id alone is not verified revenue. A message is not a paid order and does not cause one.",
  world:
    "This projection does not append recovery_outreach_completed or customer_recovered. Those world events are written from customer-recovery interventions, not from the cozy outbox.",
  objective:
    "The Day Line card id is the existing Daphne goal id from the objective-area read. A send observation may complete that message's outreach action. It does not complete the recovery objective.",
  animation:
    "Acknowledged and wave poses come from durable communication state. Selecting or hovering a resting villager may show the selected frame while the pointer is there, and that frame is not stored.",
  transport:
    "An externalMessageId prefixed simulated: is labeled simulated. Any other stored reference is provider_reference and is not a carrier-delivery claim.",
  identity:
    "customerId is the win-back identity id. Display name is never the identity. Tenant id and operator id scope every outbox row.",
} as const;

export const COZY_COMMUNICATION_STATES = [
  "draft_prepared",
  "scheduled",
  "awaiting_sender",
  "claimed",
  "send_observed",
  "send_not_observed",
  "failed",
  "consent_blocked",
] as const;

export type CozyCommunicationState = (typeof COZY_COMMUNICATION_STATES)[number];

export const COZY_COMMUNICATION_LABELS: Record<CozyCommunicationState, string> = {
  draft_prepared: "Draft Prepared",
  scheduled: "Scheduled",
  awaiting_sender: "Awaiting Sender",
  claimed: "Claimed — send not observed",
  send_observed: "Send Observed",
  send_not_observed: "Send not observed",
  failed: "Failed — not sent",
  consent_blocked: "Consent blocked",
};

export type CozyTransportLabel = "simulated" | "provider_reference";

export type CozyOutreachEvidenceRow = {
  id: string;
  tenantId: string;
  operatorId: string;
  customerId: string;
  currentMessageBody: string;
  originalSuggestedDraft: string;
  status:
    | "pending"
    | "claimed"
    | "dispatched"
    | "cancelled"
    | "failed"
    | "awaiting_sender_setup";
  deliveryIntent: "immediate" | "scheduled";
  scheduledFor: string;
  timezone: string;
  slotId: string | null;
  territoryId: string | null;
  dispatchedAt: string | null;
  externalMessageId: string | null;
  failureReason: string | null;
  revisionCount?: number;
  dispatchAttemptedAt?: string | null;
  cancelledAt?: string | null;
};

export type CozyPaidOrderEvidence = {
  customerId: string;
  orderId: string;
  paidAt: string;
  cents?: number | null;
  authorityReceiptId?: string | null;
};

export type CozyObjectiveRef = {
  id: string;
  statement: string;
  areaLabel: string;
};

export const COZY_MESSAGE_EVIDENCE_SOURCES = [
  "provider_webhook",
  "device_observed",
  "operator_reported",
] as const;

export type CozyMessageEvidenceSource = (typeof COZY_MESSAGE_EVIDENCE_SOURCES)[number];

export const COZY_MESSAGE_EVIDENCE_SOURCE_LABELS: Record<CozyMessageEvidenceSource, string> = {
  provider_webhook: "Provider webhook",
  device_observed: "Device observed",
  operator_reported: "Operator fallback",
};

export const COZY_MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;

export type CozyMessageDirection = (typeof COZY_MESSAGE_DIRECTIONS)[number];

export const COZY_REPLY_CLASSIFICATIONS = [
  "pickup_interest",
  "question",
  "not_now",
  "complaint",
  "opt_out",
  "outbound_sent",
] as const;

export type CozyReplyClassification = (typeof COZY_REPLY_CLASSIFICATIONS)[number];

export const COZY_REPLY_CLASSIFICATION_LABELS: Record<CozyReplyClassification, string> = {
  pickup_interest: "Pickup / Booking Interest",
  question: "Customer Question",
  not_now: "Not Right Now",
  complaint: "Service Issue / Complaint",
  opt_out: "Opt-Out / Stop",
  outbound_sent: "Outbound Send Observed",
};

export const COZY_REPLY_NEXT_STEP_KINDS = [
  "prepare_pickup_follow_up",
  "draft_answer_reply",
  "respect_deferral",
  "operator_service_recovery",
  "opt_out_recorded",
  "outbound_send_observed",
] as const;

export type CozyReplyNextStepKind = (typeof COZY_REPLY_NEXT_STEP_KINDS)[number];

export type CozyPersonalReplyEvidence = {
  id: string;
  tenantId: string;
  operatorId: string;
  customerId: string | null;
  customerName: string;
  rawPhone?: string | null;
  direction?: CozyMessageDirection;
  source?: CozyMessageEvidenceSource;
  providerMessageId?: string | null;
  messageId: string | null;
  territoryId: string | null;
  replyText: string;
  body?: string;
  classification: CozyReplyClassification;
  nextStepKind: CozyReplyNextStepKind;
  nextAction: string;
  preparedFollowUpDraft: string | null;
  permissionEffect: "none" | "opted_out";
  provenance: CozyMessageEvidenceSource;
  surface: string;
  reportedAt: string;
  observedAt?: string;
};

export type CozyMessageEventEvidence = CozyPersonalReplyEvidence;

export type CozyReplyProjection =
  | {
      status: "unavailable";
      reason: string;
    }
  | {
      status: CozyMessageEvidenceSource;
      source: CozyMessageEvidenceSource;
      sourceLabel: string;
      direction: "inbound";
      replyId: string;
      customerId: string;
      rawPhone: string | null;
      providerMessageId: string | null;
      messageId: string | null;
      replyText: string;
      classification: CozyReplyClassification;
      classificationLabel: string;
      nextStepKind: CozyReplyNextStepKind;
      nextAction: string;
      preparedFollowUpDraft: string | null;
      permissionEffect: "none" | "opted_out";
      provenance: CozyMessageEvidenceSource;
      observedAt: string;
      reportedAt: string;
      reason: string;
    };

export type CozyPaidOrderProjection =
  | { status: "unavailable"; reason: string }
  | { status: "verified"; orderId: string; paidAt: string };

export type CozyWorldProjection = {
  recoveryState: "none";
  worldEventAppended: false;
  note: string;
};

export type CozyProjectedTarget = CozyCustomerTarget & {
  communicationState: CozyCommunicationState;
  communicationLabel: string;
  pose: VillagerAnimationState;
  poseFrameAvailable: boolean;
  preparedMessage: string;
  verifiedAddress: null;
  messageId: string | null;
  transport: CozyTransportLabel | null;
  reply: CozyReplyProjection;
  paidOrder: CozyPaidOrderProjection;
  outreachActionComplete: boolean;
  /** The recovery objective is never completed by this projection. */
  objectiveComplete: false;
  silverLakeStatus: SilverLakeOutreachSnapshot;
};

export type CozyRecoveryDayLineCard = {
  objectiveId: string;
  objectiveStatement: string;
  missionTitle: string;
  missionType: "customer_recovery";
  customerId: string | null;
  customerDisplayName: string | null;
  nextAction: string;
  nextActionId: string | null;
  messageId: string | null;
  messageBody: string | null;
  timeWindow: string | null;
  communicationState: CozyCommunicationState | null;
  communicationLabel: string | null;
  transport: CozyTransportLabel | null;
  evidenceToComplete: string;
  outreachActionComplete: boolean;
  objectiveComplete: false;
  presentationNote: string | null;
  openHref: string;
  reply: CozyReplyProjection;
  paidOrder: CozyPaidOrderProjection;
  world: CozyWorldProjection;
  silverLakeStatus: SilverLakeOutreachSnapshot;
};

export type CozyRecoverySurfaces = {
  mission: CozyEncounterMission & {
    objectiveId: string | null;
    targets: CozyProjectedTarget[];
    world: CozyWorldProjection;
  };
  dayLineCard: CozyRecoveryDayLineCard | null;
};

const REPLY_UNAVAILABLE: CozyReplyProjection = {
  status: "unavailable",
  reason: COZY_VILLAGER_EVIDENCE_CONTRACT.reply,
};

const PAID_ORDER_UNAVAILABLE: CozyPaidOrderProjection = {
  status: "unavailable",
  reason: COZY_VILLAGER_EVIDENCE_CONTRACT.paidOrder,
};

const WORLD_NONE: CozyWorldProjection = {
  recoveryState: "none",
  worldEventAppended: false,
  note: COZY_VILLAGER_EVIDENCE_CONTRACT.world,
};

const POSE_FRAMES: Record<VillagerVariant, Partial<Record<VillagerAnimationState, string>>> = {
  fox: {
    idle: "/assets/lantern-villager-outreach/villagers/animations/fox-idle.png",
    wave: "/assets/lantern-villager-outreach/villagers/animations/fox-wave.png",
    selected: "/assets/lantern-villager-outreach/villagers/animations/fox-selected.png",
    acknowledged: "/assets/lantern-villager-outreach/villagers/animations/fox-acknowledged.png",
  },
  bunny: {
    idle: "/assets/lantern-villager-outreach/villagers/animations/bunny-idle.png",
    wave: "/assets/lantern-villager-outreach/villagers/animations/bunny-wave.png",
    selected: "/assets/lantern-villager-outreach/villagers/animations/bunny-selected.png",
    acknowledged: "/assets/lantern-villager-outreach/villagers/animations/bunny-acknowledged.png",
  },
  badger: {
    idle: "/assets/lantern-villager-outreach/villagers/animations/badger-idle.png",
    wave: "/assets/lantern-villager-outreach/villagers/animations/badger-wave.png",
    selected: "/assets/lantern-villager-outreach/villagers/animations/badger-selected.png",
    acknowledged: "/assets/lantern-villager-outreach/villagers/animations/badger-acknowledged.png",
  },
  bear: {},
  otter: {},
  squirrel: {},
  hedgehog: {},
  cat: {},
};

const STATIC_SPRITE: Record<VillagerVariant, string> = {
  fox: "/assets/lantern-villager-outreach/villagers/villager-01.png",
  bear: "/assets/lantern-villager-outreach/villagers/villager-02.png",
  otter: "/assets/lantern-villager-outreach/villagers/villager-03.png",
  bunny: "/assets/lantern-villager-outreach/villagers/villager-04.png",
  squirrel: "/assets/lantern-villager-outreach/villagers/villager-05.png",
  badger: "/assets/lantern-villager-outreach/villagers/villager-06.png",
  hedgehog: "/assets/lantern-villager-outreach/villagers/villager-07.png",
  cat: "/assets/lantern-villager-outreach/villagers/villager-08.png",
};

const UNFINISHED_PRIORITY: Record<CozyCommunicationState, number> = {
  failed: 0,
  send_not_observed: 1,
  awaiting_sender: 2,
  claimed: 3,
  scheduled: 4,
  draft_prepared: 5,
  consent_blocked: 6,
  send_observed: 9,
};

export function transportLabelFromExternalId(
  externalMessageId: string | null | undefined
): CozyTransportLabel | null {
  if (!externalMessageId) return null;
  return /^simulated[:_]/i.test(externalMessageId) ? "simulated" : "provider_reference";
}

export function poseForCommunicationState(
  state: CozyCommunicationState
): VillagerAnimationState {
  if (state === "send_observed") return "acknowledged";
  if (state === "scheduled" || state === "awaiting_sender" || state === "claimed") return "wave";
  return "idle";
}

export function villagerSprite(input: {
  variant: VillagerVariant;
  communicationState: CozyCommunicationState;
  selected?: boolean;
  hovered?: boolean;
}): { src: string; pose: VillagerAnimationState; poseFrameAvailable: boolean } {
  const durable = poseForCommunicationState(input.communicationState);
  const pose: VillagerAnimationState =
    durable === "idle" && (input.selected || input.hovered) ? "selected" : durable;
  const frame = POSE_FRAMES[input.variant][pose];
  return {
    src: frame ?? STATIC_SPRITE[input.variant],
    pose,
    poseFrameAvailable: Boolean(frame),
  };
}

function isSendObserved(row: CozyOutreachEvidenceRow): boolean {
  return row.status === "dispatched" && Boolean(row.dispatchedAt) && Boolean(row.externalMessageId);
}

function byLatestEvidence(a: CozyOutreachEvidenceRow, b: CozyOutreachEvidenceRow): number {
  return b.scheduledFor.localeCompare(a.scheduledFor) || b.id.localeCompare(a.id);
}

/** One outcome per customer. A later failure does not erase a verified send. */
export function chooseOutreachEvidence(
  rows: readonly CozyOutreachEvidenceRow[]
): CozyOutreachEvidenceRow | null {
  const active = rows.filter(row => row.status !== "cancelled");
  if (!active.length) return null;
  const observed = active.filter(isSendObserved).sort(byLatestEvidence);
  if (observed.length) return observed[0]!;
  return [...active].sort(byLatestEvidence)[0]!;
}

export function communicationStateForRow(
  row: CozyOutreachEvidenceRow | null,
  consentBlocked: boolean
): CozyCommunicationState {
  if (!row) return consentBlocked ? "consent_blocked" : "draft_prepared";
  if (isSendObserved(row)) return "send_observed";
  if (row.status === "failed") return "failed";
  if (row.status === "awaiting_sender_setup") {
    return row.deliveryIntent === "scheduled" ? "scheduled" : "awaiting_sender";
  }
  if (row.status === "claimed") return "claimed";
  if (row.status === "pending") {
    return row.deliveryIntent === "immediate" ? "awaiting_sender" : "scheduled";
  }
  if (row.status === "dispatched") return "send_not_observed";
  return consentBlocked ? "consent_blocked" : "draft_prepared";
}

function paidOrderFor(
  customerId: string,
  evidence: readonly CozyPaidOrderEvidence[]
): CozyPaidOrderProjection {
  const match = evidence.find(item => item.customerId === customerId && item.orderId && item.paidAt);
  if (!match) return PAID_ORDER_UNAVAILABLE;
  const cents = match.cents;
  if (!match.authorityReceiptId?.trim() || typeof cents !== "number" || !Number.isFinite(cents) || cents <= 0) {
    return {
      status: "unavailable",
      reason: "An order reference without an admitted payment receipt is not verified revenue.",
    };
  }
  return { status: "verified", orderId: match.orderId, paidAt: match.paidAt };
}

function isCozySlot(value: string | null | undefined): value is CozySlotId {
  return COZY_SLOT_IDS.includes(value as CozySlotId);
}

export function assignHouseSlots<T extends { customerId: string; slotId: CozySlotId }>(
  targets: readonly T[],
  rows: readonly CozyOutreachEvidenceRow[]
): T[] {
  const claimed = new Map<CozySlotId, string>();
  const placed: T[] = [];
  const pending: T[] = [];
  for (const target of targets) {
    const row = chooseOutreachEvidence(rows.filter(item => item.customerId === target.customerId));
    const slot = row && isCozySlot(row.slotId) ? row.slotId : null;
    if (slot && !claimed.has(slot)) {
      claimed.set(slot, target.customerId);
      placed.push({ ...target, slotId: slot });
    } else {
      pending.push(target);
    }
  }
  for (const target of pending) {
    const free = COZY_SLOT_IDS.find(id => !claimed.has(id));
    if (!free) continue;
    claimed.set(free, target.customerId);
    placed.push({ ...target, slotId: free });
  }
  return placed.sort(
    (a, b) => COZY_SLOT_IDS.indexOf(a.slotId) - COZY_SLOT_IDS.indexOf(b.slotId)
  );
}

export function formatPacificWindow(iso: string, timeZone = "America/Los_Angeles"): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function territorySlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "silver-lake";
}

function scopedRows(
  rows: readonly CozyOutreachEvidenceRow[],
  tenantId: string,
  operatorId: string
): CozyOutreachEvidenceRow[] {
  return rows.filter(row => row.tenantId === tenantId && row.operatorId === operatorId);
}

function normalizeDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length >= 10 ? digits : null;
}

function eventSourceOf(event: CozyPersonalReplyEvidence): CozyMessageEvidenceSource {
  const candidate = event.source ?? event.provenance;
  if (
    candidate === "provider_webhook" ||
    candidate === "device_observed" ||
    candidate === "operator_reported"
  ) {
    return candidate;
  }
  return "operator_reported";
}

function eventDirectionOf(event: CozyPersonalReplyEvidence): CozyMessageDirection {
  return event.direction === "outbound" ? "outbound" : "inbound";
}

function eventBodyOf(event: CozyPersonalReplyEvidence): string {
  return (event.body ?? event.replyText ?? "").trim();
}

function eventObservedAtOf(event: CozyPersonalReplyEvidence): string {
  return event.observedAt ?? event.reportedAt;
}

function eventMatchesTarget(
  event: CozyPersonalReplyEvidence,
  target: CozyCustomerTarget
): boolean {
  if (event.customerId && event.customerId === target.customerId) {
    return true;
  }
  if (!event.customerId && event.rawPhone && target.phone) {
    const a = normalizeDigits(event.rawPhone);
    const b = normalizeDigits(target.phone);
    return Boolean(a && b && a === b);
  }
  return false;
}

function scopedMessageEvents(
  events: readonly CozyPersonalReplyEvidence[],
  tenantId: string,
  operatorId: string
): CozyPersonalReplyEvidence[] {
  return events.filter(
    event =>
      event.tenantId === tenantId &&
      event.operatorId === operatorId &&
      COZY_MESSAGE_EVIDENCE_SOURCES.includes(eventSourceOf(event)) &&
      Boolean(eventBodyOf(event))
  );
}

function byLatestEvent(a: CozyPersonalReplyEvidence, b: CozyPersonalReplyEvidence): number {
  return eventObservedAtOf(b).localeCompare(eventObservedAtOf(a)) || b.id.localeCompare(a.id);
}

export function chooseReplyEvidence(
  events: readonly CozyPersonalReplyEvidence[]
): CozyPersonalReplyEvidence | null {
  const inbound = events.filter(event => eventDirectionOf(event) === "inbound");
  if (!inbound.length) return null;
  return [...inbound].sort(byLatestEvent)[0]!;
}

export const COZY_TRUSTED_EVIDENCE_SOURCES: readonly CozyMessageEvidenceSource[] = [
  "provider_webhook",
  "device_observed",
] as const;

export function isTrustedMessageEvidenceSource(
  source: CozyMessageEvidenceSource | string | null | undefined
): source is "provider_webhook" | "device_observed" {
  return source === "provider_webhook" || source === "device_observed";
}

function normalizeBodyForMatch(body: string | null | undefined): string {
  return (body ?? "").trim().replace(/\s+/g, " ");
}

export function chooseOutboundEventEvidence(
  events: readonly CozyPersonalReplyEvidence[],
  options?: {
    outboxRow?: CozyOutreachEvidenceRow | null;
    recipientPhone?: string | null;
  }
): CozyPersonalReplyEvidence | null {
  const outbound = events.filter(event => {
    if (eventDirectionOf(event) !== "outbound") return false;
    // Operator-reported events can never transition a draft to send_observed
    if (!isTrustedMessageEvidenceSource(eventSourceOf(event))) return false;
    // Outbound send observation requires an existing approved outbox row
    const row = options?.outboxRow;
    if (!row || row.status === "cancelled") return false;
    if (event.messageId && event.messageId !== row.id) return false;
    // Exact approved body match (normalized whitespace)
    const eventBody = normalizeBodyForMatch(eventBodyOf(event));
    const approvedBody = normalizeBodyForMatch(row.currentMessageBody);
    if (!eventBody || !approvedBody || eventBody !== approvedBody) return false;
    // Recipient phone match when both are present
    const targetDigits = normalizeDigits(options?.recipientPhone);
    const eventDigits = normalizeDigits(event.rawPhone);
    if (targetDigits && eventDigits && targetDigits !== eventDigits) return false;
    return true;
  });
  if (!outbound.length) return null;
  return [...outbound].sort(byLatestEvent)[0]!;
}

function replyReasonForSource(source: CozyMessageEvidenceSource): string {
  switch (source) {
    case "provider_webhook":
      return "Inbound reply observed via provider webhook. Not a verified paid order.";
    case "device_observed":
      return "Inbound reply observed from the connected device thread. Not a carrier webhook receipt and not a verified paid order.";
    case "operator_reported":
      return "Fallback operator-recorded reply. Not an automated device/provider observation and not a verified paid order.";
  }
}

function replyForTarget(
  target: CozyCustomerTarget,
  events: readonly CozyPersonalReplyEvidence[]
): CozyReplyProjection {
  const match = chooseReplyEvidence(events.filter(item => eventMatchesTarget(item, target)));
  if (!match) return REPLY_UNAVAILABLE;
  const source = eventSourceOf(match);
  const observedAt = eventObservedAtOf(match);
  return {
    status: source,
    source,
    sourceLabel: COZY_MESSAGE_EVIDENCE_SOURCE_LABELS[source],
    direction: "inbound",
    replyId: match.id,
    customerId: match.customerId ?? target.customerId,
    rawPhone: match.rawPhone ?? null,
    providerMessageId: match.providerMessageId ?? null,
    messageId: match.messageId,
    replyText: eventBodyOf(match),
    classification: match.classification,
    classificationLabel: COZY_REPLY_CLASSIFICATION_LABELS[match.classification],
    nextStepKind: match.nextStepKind,
    nextAction: match.nextAction,
    preparedFollowUpDraft: match.preparedFollowUpDraft,
    permissionEffect: match.permissionEffect,
    provenance: source,
    observedAt,
    reportedAt: observedAt,
    reason: replyReasonForSource(source),
  };
}

function replyHasOpenFollowUp(reply: CozyReplyProjection): boolean {
  if (reply.status === "unavailable") return false;
  return (
    reply.nextStepKind === "prepare_pickup_follow_up" ||
    reply.nextStepKind === "draft_answer_reply" ||
    reply.nextStepKind === "operator_service_recovery"
  );
}

function projectOne(
  target: CozyCustomerTarget,
  rows: readonly CozyOutreachEvidenceRow[],
  paidOrders: readonly CozyPaidOrderEvidence[],
  events: readonly CozyPersonalReplyEvidence[],
  context: {
    tenantId: string;
    operatorId: string;
    handoffEvents: readonly SilverLakeHandoffEvent[];
    unsavedBody: string | null;
    now: Date;
  }
): CozyProjectedTarget {
  const row = chooseOutreachEvidence(rows.filter(item => item.customerId === target.customerId));
  const outboundEvent = chooseOutboundEventEvidence(
    events.filter(item => eventMatchesTarget(item, target)),
    {
      outboxRow: row,
      recipientPhone: target.phone ?? null,
    }
  );
  const reply = replyForTarget(target, events);
  const replyOptedOut =
    reply.status !== "unavailable" &&
    (reply.classification === "opt_out" || reply.permissionEffect === "opted_out");
  const consentBlocked =
    replyOptedOut ||
    target.status === "consent_blocked" ||
    target.consentStatus === "blocked_opt_out" ||
    target.consentStatus === "missing_phone";
  const baseCommunicationState = communicationStateForRow(row, consentBlocked);
  const communicationState: CozyCommunicationState = replyOptedOut
    ? "consent_blocked"
    : outboundEvent
      ? "send_observed"
      : baseCommunicationState;
  const pose = poseForCommunicationState(communicationState);
  const frame = POSE_FRAMES[target.villagerVariant][pose];
  const paidOrder = paidOrderFor(target.customerId, paidOrders);
  const paidMatch = paidOrders.find(item => item.customerId === target.customerId && item.orderId && item.paidAt) ?? null;
  const trustedSend: SilverLakeTrustedSend | null =
    outboundEvent && isTrustedMessageEvidenceSource(eventSourceOf(outboundEvent))
      ? {
          messageId: outboundEvent.messageId,
          body: eventBodyOf(outboundEvent),
          source: eventSourceOf(outboundEvent) as SilverLakeTrustedSend["source"],
        }
      : null;
  const silverLakeStatus = projectSilverLakeOutreachStatus({
    tenantId: context.tenantId,
    operatorId: context.operatorId,
    customerId: target.customerId,
    suggestedBody: target.suggestedMessage,
    unsavedBody: context.unsavedBody,
    row: row
      ? {
          id: row.id,
          tenantId: row.tenantId,
          operatorId: row.operatorId,
          customerId: row.customerId,
          currentMessageBody: row.currentMessageBody,
          status: row.status,
          deliveryIntent: row.deliveryIntent,
          scheduledFor: row.scheduledFor,
          timezone: row.timezone,
          revisionCount: row.revisionCount,
          dispatchedAt: row.dispatchedAt,
          externalMessageId: row.externalMessageId,
          failureReason: row.failureReason,
          dispatchAttemptedAt: row.dispatchAttemptedAt,
          cancelledAt: row.cancelledAt,
        }
      : null,
    handoffEvents: context.handoffEvents,
    trustedSend,
    replyObserved: reply.status !== "unavailable",
    order: paidMatch
      ? {
          orderId: paidMatch.orderId,
          paidAt: paidMatch.paidAt,
          cents: paidMatch.cents,
          authorityReceiptId: paidMatch.authorityReceiptId,
        }
      : null,
    now: context.now,
  });
  const preparedMessage =
    reply.status !== "unavailable" && reply.preparedFollowUpDraft
      ? reply.preparedFollowUpDraft
      : outboundEvent
        ? eventBodyOf(outboundEvent)
        : row?.currentMessageBody || target.suggestedMessage;
  const externalRef =
    row?.externalMessageId ??
    outboundEvent?.providerMessageId ??
    (outboundEvent ? `${eventSourceOf(outboundEvent)}:${outboundEvent.id}` : null);
  const transport = transportLabelFromExternalId(externalRef);
  const outreachActionComplete =
    communicationState === "send_observed" && !replyHasOpenFollowUp(reply);
  return {
    ...target,
    hasConsent: replyOptedOut ? false : target.hasConsent,
    consentStatus: replyOptedOut ? "blocked_opt_out" : target.consentStatus,
    address: target.territoryName,
    verifiedAddress: null,
    preparedMessage,
    communicationState,
    communicationLabel: COZY_COMMUNICATION_LABELS[communicationState],
    pose,
    poseFrameAvailable: Boolean(frame),
    messageId: row?.id ?? outboundEvent?.messageId ?? null,
    transport,
    reply,
    paidOrder,
    outreachActionComplete,
    objectiveComplete: false,
    silverLakeStatus,
    status:
      communicationState === "send_observed"
        ? "accepted"
        : communicationState === "scheduled" || communicationState === "claimed"
          ? "scheduled"
          : communicationState === "awaiting_sender" || communicationState === "send_not_observed"
            ? "awaiting_sender_setup"
            : communicationState === "consent_blocked"
              ? "consent_blocked"
              : communicationState === "failed"
                ? "failed"
                : "draft_ready",
    providerReceipt:
      communicationState === "send_observed" && (row || outboundEvent)
        ? {
            messageSid: externalRef ?? row?.id ?? outboundEvent!.id,
            status: "dispatched",
            sentAt:
              row?.dispatchedAt ??
              (outboundEvent ? eventObservedAtOf(outboundEvent) : row!.scheduledFor),
            evidenceName:
              transport === "simulated"
                ? "simulated_transport"
                : outboundEvent
                  ? eventSourceOf(outboundEvent)
                  : "provider_reference",
          }
        : undefined,
    scheduledDraft:
      row &&
      communicationState !== "send_observed" &&
      communicationState !== "failed" &&
      communicationState !== "draft_prepared" &&
      communicationState !== "consent_blocked"
        ? {
            messageId: row.id,
            scheduledFor: row.scheduledFor,
            timezone: row.timezone || "America/Los_Angeles",
            currentMessageBody: row.currentMessageBody,
          }
        : undefined,
  };
}

function applyPresentation(input: {
  statement: string;
  missionTitle: string;
  timeWindow: string | null;
  presentation: { adjustment: DaphneMissionAdjustment; note: string } | null;
  hasScheduledInstant: boolean;
}): { missionTitle: string; timeWindow: string | null; presentationNote: string | null } {
  const presentation = input.presentation;
  if (!presentation) {
    return { missionTitle: input.statement, timeWindow: input.timeWindow, presentationNote: null };
  }
  const note = presentation.note || describeMissionAdjustment(presentation.adjustment);
  if (presentation.adjustment.kind === "presentation_style") {
    return { missionTitle: input.statement, timeWindow: input.timeWindow, presentationNote: note };
  }
  if (presentation.adjustment.kind === "timing" && !input.hasScheduledInstant) {
    return {
      missionTitle: input.statement,
      timeWindow: `Suggested for the ${presentation.adjustment.window} · Pacific`,
      presentationNote: note,
    };
  }
  return { missionTitle: input.statement, timeWindow: input.timeWindow, presentationNote: note };
}

export function projectCozyRecoverySurfaces(input: {
  tenantId: string;
  operatorId: string;
  mission: CozyEncounterMission;
  messages: readonly CozyOutreachEvidenceRow[];
  objective: CozyObjectiveRef | null;
  presentation?: { adjustment: DaphneMissionAdjustment; note: string } | null;
  paidOrderEvidence?: readonly CozyPaidOrderEvidence[];
  replies?: readonly CozyPersonalReplyEvidence[];
  messageEvents?: readonly CozyPersonalReplyEvidence[];
  handoffEvents?: readonly SilverLakeHandoffEvent[];
  unsavedDrafts?: readonly { customerId: string; body: string }[];
  now?: Date;
  timeZone?: string;
}): CozyRecoverySurfaces {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? "America/Los_Angeles";
  const rows = scopedRows(input.messages, input.tenantId, input.operatorId);
  const events = scopedMessageEvents(
    input.messageEvents ?? input.replies ?? [],
    input.tenantId,
    input.operatorId
  );
  const paid = input.paidOrderEvidence ?? [];
  const slotted = assignHouseSlots(input.mission.targets, rows);
  const targets = slotted.map(target => {
    const anchor = COZY_SLOT_ANCHORS[target.slotId];
    const unsaved = input.unsavedDrafts?.find(item => item.customerId === target.customerId)?.body ?? null;
    return projectOne(
      { ...target, villagerVariant: anchor?.defaultVariant ?? target.villagerVariant },
      rows,
      paid,
      events,
      {
        tenantId: input.tenantId,
        operatorId: input.operatorId,
        handoffEvents: input.handoffEvents ?? [],
        unsavedBody: unsaved,
        now,
      }
    );
  });
  const repliedWithOpenFollowUp = [...targets]
    .filter(target => replyHasOpenFollowUp(target.reply))
    .sort((a, b) => {
      const aAt = a.reply.status !== "unavailable" ? a.reply.observedAt : "";
      const bAt = b.reply.status !== "unavailable" ? b.reply.observedAt : "";
      return bAt.localeCompare(aAt);
    });
  const unfinished = [...targets]
    .filter(target => target.communicationState !== "send_observed")
    .sort((a, b) => UNFINISHED_PRIORITY[a.communicationState] - UNFINISHED_PRIORITY[b.communicationState]);
  const focus = repliedWithOpenFollowUp[0] ?? unfinished[0] ?? null;
  const focusRow = focus
    ? chooseOutreachEvidence(rows.filter(row => row.customerId === focus.customerId))
    : null;
  const windowPassed = Boolean(
    focusRow &&
      focus &&
      focus.communicationState !== "send_observed" &&
      new Date(focusRow.scheduledFor).getTime() < now.getTime() &&
      (focus.communicationState === "scheduled" || focus.communicationState === "claimed")
  );
  const presented = applyPresentation({
    statement: input.objective?.statement ?? input.mission.objective,
    missionTitle: input.mission.title,
    timeWindow: focusRow ? formatPacificWindow(focusRow.scheduledFor, focusRow.timezone || timeZone) : null,
    presentation: input.presentation ?? null,
    hasScheduledInstant: Boolean(focusRow),
  });
  const timeWindow = presented.timeWindow
    ? windowPassed
      ? `${presented.timeWindow} · window passed — still open`
      : presented.timeWindow
    : null;
  const focusReply = focus?.reply ?? REPLY_UNAVAILABLE;
  const territoryParam = encodeURIComponent(territorySlug(input.objective?.areaLabel ?? input.mission.territoryName));
  const customerParam = focus?.customerId ? `&customer=${encodeURIComponent(focus.customerId)}` : "";
  const dayLineCard: CozyRecoveryDayLineCard | null = input.objective
    ? {
        objectiveId: input.objective.id,
        objectiveStatement: input.objective.statement,
        missionTitle: presented.missionTitle,
        missionType: "customer_recovery",
        customerId: focus?.customerId ?? null,
        customerDisplayName: focus?.displayName ?? null,
        nextAction:
          focusReply.status !== "unavailable"
            ? focusReply.nextAction
            : focus
              ? focus.silverLakeStatus.detail
              : "No unfinished outreach action. The recovery objective stays open until a paid order is admitted.",
        nextActionId:
          focusReply.status !== "unavailable" && focus
            ? `reply:${focusReply.replyId}:${focus.customerId}`
            : focus
              ? focus.messageId ?? `draft:${input.objective.id}:${focus.customerId}`
              : null,
        messageId: focus?.messageId ?? null,
        messageBody: focus?.preparedMessage ?? null,
        timeWindow,
        communicationState: focus?.communicationState ?? (targets.length ? "send_observed" : null),
        communicationLabel: focus
          ? focus.communicationLabel
          : targets.length
            ? COZY_COMMUNICATION_LABELS.send_observed
            : null,
        transport: focus?.transport ?? null,
        evidenceToComplete:
          focusReply.status !== "unavailable"
            ? `${focusReply.reason} A paid order is separate and is not verified here.`
            : focus
              ? "A dispatched row with dispatchedAt and a provider reference completes this outreach action only. Reply evidence is unavailable. A paid order is separate and is not verified here."
              : "The recovery objective is still open. Send observations do not admit payment or complete the goal.",
        outreachActionComplete: focus ? focus.outreachActionComplete : false,
        objectiveComplete: false,
        presentationNote: presented.presentationNote,
        openHref: `/growth/lantern-city?cozy=1&territory=${territoryParam}${customerParam}`,
        reply: focusReply,
        paidOrder: focus ? focus.paidOrder : PAID_ORDER_UNAVAILABLE,
        world: WORLD_NONE,
        silverLakeStatus: focus
          ? focus.silverLakeStatus
          : projectSilverLakeOutreachStatus({
              tenantId: input.tenantId,
              operatorId: input.operatorId,
              customerId: "",
              now,
            }),
      }
    : null;

  return {
    mission: {
      ...input.mission,
      objectiveId: input.objective?.id ?? null,
      targets,
      activeTargetCount: targets.length,
      world: WORLD_NONE,
    },
    dayLineCard,
  };
}
