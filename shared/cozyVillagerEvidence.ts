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
    "Unavailable unless an admitted paid-order reference is supplied for the same customer id. Dossier paid-order counts are history, not a new payment. A message is not a paid order.",
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
};

export type CozyPaidOrderEvidence = {
  customerId: string;
  orderId: string;
  paidAt: string;
};

export type CozyObjectiveRef = {
  id: string;
  statement: string;
  areaLabel: string;
};

export const COZY_REPLY_CLASSIFICATIONS = [
  "pickup_interest",
  "question",
  "not_now",
  "complaint",
  "opt_out",
] as const;

export type CozyReplyClassification = (typeof COZY_REPLY_CLASSIFICATIONS)[number];

export const COZY_REPLY_CLASSIFICATION_LABELS: Record<CozyReplyClassification, string> = {
  pickup_interest: "Pickup / Booking Interest",
  question: "Customer Question",
  not_now: "Not Right Now",
  complaint: "Service Issue / Complaint",
  opt_out: "Opt-Out / Stop",
};

export const COZY_REPLY_NEXT_STEP_KINDS = [
  "prepare_pickup_follow_up",
  "draft_answer_reply",
  "respect_deferral",
  "operator_service_recovery",
  "opt_out_recorded",
] as const;

export type CozyReplyNextStepKind = (typeof COZY_REPLY_NEXT_STEP_KINDS)[number];

export type CozyPersonalReplyEvidence = {
  id: string;
  tenantId: string;
  operatorId: string;
  customerId: string;
  customerName: string;
  messageId: string | null;
  territoryId: string | null;
  replyText: string;
  classification: CozyReplyClassification;
  nextStepKind: CozyReplyNextStepKind;
  nextAction: string;
  preparedFollowUpDraft: string | null;
  permissionEffect: "none" | "opted_out";
  provenance: "operator_reported";
  surface: string;
  reportedAt: string;
};

export type CozyReplyProjection =
  | {
      status: "unavailable";
      reason: string;
    }
  | {
      status: "operator_reported";
      replyId: string;
      customerId: string;
      messageId: string | null;
      replyText: string;
      classification: CozyReplyClassification;
      classificationLabel: string;
      nextStepKind: CozyReplyNextStepKind;
      nextAction: string;
      preparedFollowUpDraft: string | null;
      permissionEffect: "none" | "opted_out";
      provenance: "operator_reported";
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

function scopedReplies(
  replies: readonly CozyPersonalReplyEvidence[],
  tenantId: string,
  operatorId: string
): CozyPersonalReplyEvidence[] {
  return replies.filter(
    reply =>
      reply.tenantId === tenantId &&
      reply.operatorId === operatorId &&
      reply.provenance === "operator_reported" &&
      Boolean(reply.replyText.trim())
  );
}

function byLatestReply(a: CozyPersonalReplyEvidence, b: CozyPersonalReplyEvidence): number {
  return b.reportedAt.localeCompare(a.reportedAt) || b.id.localeCompare(a.id);
}

export function chooseReplyEvidence(
  replies: readonly CozyPersonalReplyEvidence[]
): CozyPersonalReplyEvidence | null {
  if (!replies.length) return null;
  return [...replies].sort(byLatestReply)[0]!;
}

function replyFor(
  customerId: string,
  replies: readonly CozyPersonalReplyEvidence[]
): CozyReplyProjection {
  const match = chooseReplyEvidence(replies.filter(item => item.customerId === customerId));
  if (!match) return REPLY_UNAVAILABLE;
  return {
    status: "operator_reported",
    replyId: match.id,
    customerId: match.customerId,
    messageId: match.messageId,
    replyText: match.replyText,
    classification: match.classification,
    classificationLabel: COZY_REPLY_CLASSIFICATION_LABELS[match.classification],
    nextStepKind: match.nextStepKind,
    nextAction: match.nextAction,
    preparedFollowUpDraft: match.preparedFollowUpDraft,
    permissionEffect: match.permissionEffect,
    provenance: "operator_reported",
    reportedAt: match.reportedAt,
    reason:
      "Operator-reported reply from the personal SMS thread. Not a carrier webhook receipt and not a verified paid order.",
  };
}

function replyHasOpenFollowUp(reply: CozyReplyProjection): boolean {
  if (reply.status !== "operator_reported") return false;
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
  replies: readonly CozyPersonalReplyEvidence[]
): CozyProjectedTarget {
  const row = chooseOutreachEvidence(rows.filter(item => item.customerId === target.customerId));
  const reply = replyFor(target.customerId, replies);
  const replyOptedOut =
    reply.status === "operator_reported" &&
    (reply.classification === "opt_out" || reply.permissionEffect === "opted_out");
  const consentBlocked =
    replyOptedOut ||
    target.status === "consent_blocked" ||
    target.consentStatus === "blocked_opt_out" ||
    target.consentStatus === "missing_phone";
  const communicationState = replyOptedOut
    ? "consent_blocked"
    : communicationStateForRow(row, consentBlocked);
  const pose = poseForCommunicationState(communicationState);
  const frame = POSE_FRAMES[target.villagerVariant][pose];
  const paidOrder = paidOrderFor(target.customerId, paidOrders);
  const preparedMessage =
    reply.status === "operator_reported" && reply.preparedFollowUpDraft
      ? reply.preparedFollowUpDraft
      : row?.currentMessageBody || target.suggestedMessage;
  const transport = row ? transportLabelFromExternalId(row.externalMessageId) : null;
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
    messageId: row?.id ?? null,
    transport,
    reply,
    paidOrder,
    outreachActionComplete,
    objectiveComplete: false,
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
      communicationState === "send_observed" && row
        ? {
            messageSid: row.externalMessageId ?? row.id,
            status: "dispatched",
            sentAt: row.dispatchedAt ?? row.scheduledFor,
            evidenceName: transport === "simulated" ? "simulated_transport" : "provider_reference",
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

function nextActionCopy(state: CozyCommunicationState, windowPassed: boolean): string {
  switch (state) {
    case "draft_prepared":
      return "Review the prepared draft, then Send Now or Schedule. Nothing has been sent.";
    case "scheduled":
      return windowPassed
        ? "The scheduled window has passed and the message is still unsent."
        : "Scheduled. This is not a send.";
    case "awaiting_sender":
      return "Awaiting sender. This is not a send.";
    case "claimed":
      return "Claimed for send. No send has been observed.";
    case "failed":
      return "The send failed. It is not sent.";
    case "send_not_observed":
      return "A dispatch was recorded without a send observation.";
    case "consent_blocked":
      return "Consent or a verified phone is missing. Do not send.";
    case "send_observed":
      return "This outreach action has a send observation. The recovery objective is still open.";
  }
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
  now?: Date;
  timeZone?: string;
}): CozyRecoverySurfaces {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? "America/Los_Angeles";
  const rows = scopedRows(input.messages, input.tenantId, input.operatorId);
  const replies = scopedReplies(input.replies ?? [], input.tenantId, input.operatorId);
  const paid = input.paidOrderEvidence ?? [];
  const slotted = assignHouseSlots(input.mission.targets, rows);
  const targets = slotted.map(target => {
    const anchor = COZY_SLOT_ANCHORS[target.slotId];
    return projectOne(
      { ...target, villagerVariant: anchor?.defaultVariant ?? target.villagerVariant },
      rows,
      paid,
      replies
    );
  });
  const repliedWithOpenFollowUp = [...targets]
    .filter(target => replyHasOpenFollowUp(target.reply))
    .sort((a, b) => {
      const aAt = a.reply.status === "operator_reported" ? a.reply.reportedAt : "";
      const bAt = b.reply.status === "operator_reported" ? b.reply.reportedAt : "";
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
          focusReply.status === "operator_reported"
            ? focusReply.nextAction
            : focus
              ? nextActionCopy(focus.communicationState, windowPassed)
              : "No unfinished outreach action. The recovery objective stays open until a paid order is admitted.",
        nextActionId:
          focusReply.status === "operator_reported" && focus
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
          focusReply.status === "operator_reported"
            ? "Reply is operator-reported from the personal SMS thread. A paid order is separate and is not verified here."
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
