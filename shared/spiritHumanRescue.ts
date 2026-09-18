/**
 * JOYSTICK Spirit Human rescue — reality/fantasy contract.
 *
 * REALITY determines what happened. THE GAME may invent why it happened.
 *
 * Sending approved outreach can rescue the fantasy villager.
 * Sending cannot mean the customer replied, reactivated, or ordered.
 *
 * The fantasy captive is a recurring JOYSTICK villager. The dormant customer
 * is that villager's Spirit Human — never the person shown in the cage.
 */

export const SPIRIT_HUMAN_RESCUE_KIND = "spirit_human_rescue" as const;

export const MISSION_LIFECYCLE_STATES = [
  "locked",
  "available",
  "active",
  "completed",
  "problem",
  "skipped",
  "superseded",
] as const;

export type MissionLifecycleState = (typeof MISSION_LIFECYCLE_STATES)[number];

export const SEND_STATES = [
  "draft_ready",
  "awaiting_approval",
  "sending",
  "sent",
  "send_failed",
  "send_outcome_unknown",
  "cancelled",
] as const;

export type RescueSendState = (typeof SEND_STATES)[number];

export const CLAIMABLE_SEND_STATES = [
  "draft_ready",
  "awaiting_approval",
  "send_failed",
] as const satisfies readonly RescueSendState[];

export const AMBIGUOUS_SEND_STATES = ["sending", "send_outcome_unknown"] as const satisfies readonly RescueSendState[];

export const SEND_CLAIMABLE_LIFECYCLES = ["available", "active", "problem"] as const satisfies readonly MissionLifecycleState[];

/** What a successful Twilio create actually proves. Not delivered. Not read. */
export const SEND_EVIDENCE_NAME = "provider_accepted" as const;

export const SEND_FAILURE_EVIDENCE = [
  "permission_denied",
  "contact_unresolved",
  "provider_unconfigured",
  "provider_rejected",
  "send_outcome_unknown",
  "no_longer_dormant",
] as const;

export type RescueSendEvidenceName =
  | typeof SEND_EVIDENCE_NAME
  | (typeof SEND_FAILURE_EVIDENCE)[number];

export const CONSEQUENCE_KINDS = [
  "customer_replied",
  "customer_ordered",
] as const;

export type RescueConsequenceKind = (typeof CONSEQUENCE_KINDS)[number];

export type SpiritHumanVillager = {
  id: string;
  displayName: string;
  role: string;
};

/**
 * Recurring JOYSTICK world characters. Selection is independent of the
 * real customer's name, race, gender, or biography.
 */
export const SPIRIT_HUMAN_VILLAGERS: readonly SpiritHumanVillager[] = [
  { id: "tallow", displayName: "Tallow", role: "lantern keeper" },
  { id: "nim", displayName: "Nim", role: "dock runner" },
  { id: "vesper", displayName: "Vesper", role: "map scribe" },
  { id: "bracken", displayName: "Bracken", role: "mill hand" },
  { id: "pell", displayName: "Pell", role: "signal runner" },
  { id: "wren", displayName: "Wren", role: "kite maker" },
  { id: "hale", displayName: "Hale", role: "gate steward" },
];

export type FrozenRescueFacts = {
  snapshotCustomerId: string;
  firstName: string;
  buildingName?: string;
  lastOrderAt: string;
  daysSinceLastOrder: number;
  paidOrderCount?: number;
  historicalSpendCents?: number;
};

export type RescueSendRecord = {
  status: RescueSendState;
  idempotencyKey: string;
  approvedByUserId: string | null;
  attemptedAt: string | null;
  acceptedAt: string | null;
  failedAt: string | null;
  providerMessageId: string | null;
  providerStatus: string | null;
  evidenceName: RescueSendEvidenceName | null;
  failureReason: string | null;
};

export type RescueConsequenceRecord = {
  kind: RescueConsequenceKind;
  observedAt: string;
  evidenceId: string;
};

export type SpiritHumanRescueMission = {
  missionId: string;
  tenantId: string;
  operatorUserId: string;
  kind: typeof SPIRIT_HUMAN_RESCUE_KIND;
  lifecycle: MissionLifecycleState;
  villager: SpiritHumanVillager;
  spiritHuman: FrozenRescueFacts;
  draft: string | null;
  send: RescueSendRecord;
  consequences: RescueConsequenceRecord[];
  opsTaskId: number | null;
  deferredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicRescueMission = Omit<SpiritHumanRescueMission, never>;

const PHONE_LEAK = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/;

export function selectVillagerIndependentOfCustomer(
  missionId: string,
  roster: readonly SpiritHumanVillager[] = SPIRIT_HUMAN_VILLAGERS
): SpiritHumanVillager {
  let hash = 2166136261;
  for (let i = 0; i < missionId.length; i += 1) {
    hash ^= missionId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const index = Math.abs(hash) % roster.length;
  return roster[index]!;
}

export function emptySendRecord(missionId: string): RescueSendRecord {
  return {
    status: "awaiting_approval",
    idempotencyKey: `spirit-human-send:${missionId}`,
    approvedByUserId: null,
    attemptedAt: null,
    acceptedAt: null,
    failedAt: null,
    providerMessageId: null,
    providerStatus: null,
    evidenceName: null,
    failureReason: null,
  };
}

export function missionLifecycleFromSend(input: {
  entered: boolean;
  sendStatus: RescueSendState;
  deferred: boolean;
  superseded: boolean;
}): MissionLifecycleState {
  if (input.superseded) return "superseded";
  if (input.sendStatus === "sent") return "completed";
  if (input.sendStatus === "cancelled") return "skipped";
  if (input.sendStatus === "send_failed" || input.sendStatus === "send_outcome_unknown") return "problem";
  if (input.sendStatus === "sending") return "active";
  if (input.entered) return "active";
  return "available";
}

/**
 * Rescue / mission completion is allowed only after an authoritative
 * provider-accepted send. Draft, preview, approval, and local CTA never qualify.
 */
export function canCompleteRescue(send: Pick<RescueSendRecord, "status" | "providerMessageId" | "evidenceName">): boolean {
  return (
    send.status === "sent" &&
    send.evidenceName === SEND_EVIDENCE_NAME &&
    typeof send.providerMessageId === "string" &&
    send.providerMessageId.length > 0
  );
}

export function canRetrySend(send: Pick<RescueSendRecord, "status">): boolean {
  return (CLAIMABLE_SEND_STATES as readonly RescueSendState[]).includes(send.status);
}

export function isDuplicateSendBlocked(send: Pick<RescueSendRecord, "status">): boolean {
  return send.status === "sent" || send.status === "sending" || send.status === "send_outcome_unknown";
}

export function isAmbiguousSend(send: Pick<RescueSendRecord, "status">): boolean {
  return send.status === "sending" || send.status === "send_outcome_unknown";
}

/** Once claimed, draft/defer/cancel/enter must not restore a retryable send. */
export function isSendClaimLocked(send: Pick<RescueSendRecord, "status">): boolean {
  return send.status === "sent" || send.status === "sending" || send.status === "send_outcome_unknown";
}

export function canClaimOutboundSend(mission: Pick<SpiritHumanRescueMission, "lifecycle" | "send">): boolean {
  return (
    canRetrySend(mission.send) &&
    (SEND_CLAIMABLE_LIFECYCLES as readonly MissionLifecycleState[]).includes(mission.lifecycle)
  );
}

export function applyLaterConsequence(
  mission: SpiritHumanRescueMission,
  consequence: RescueConsequenceRecord
): SpiritHumanRescueMission {
  const already = mission.consequences.some(
    item => item.kind === consequence.kind && item.evidenceId === consequence.evidenceId
  );
  if (already) return mission;
  return {
    ...mission,
    consequences: [...mission.consequences, consequence],
    updatedAt: consequence.observedAt,
  };
}

/** Completed send truth is immutable. Later reality cannot rewrite it. */
export function assertSendRecordImmutableAfterSuccess(
  before: RescueSendRecord,
  after: RescueSendRecord
): void {
  if (!canCompleteRescue(before)) return;
  if (
    before.status !== after.status ||
    before.providerMessageId !== after.providerMessageId ||
    before.acceptedAt !== after.acceptedAt ||
    before.evidenceName !== after.evidenceName
  ) {
    throw new Error("Completed rescue send records are immutable.");
  }
}

export function publicMissionHasNoPhone(mission: PublicRescueMission): boolean {
  return !PHONE_LEAK.test(JSON.stringify(mission));
}

export function composeReactivationDraft(facts: FrozenRescueFacts): string {
  const building = facts.buildingName ? ` at ${facts.buildingName}` : "";
  const last = formatLastOrderDay(facts.lastOrderAt);
  const lastBit = last ? ` We last helped on ${last}.` : "";
  return `${facts.firstName}, it's Laundry Butler.${lastBit} If you'd like us to set up a pickup${building}, just let us know.`;
}

function formatLastOrderDay(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function rescueActionGrammar(mission: Pick<SpiritHumanRescueMission, "missionId" | "opsTaskId">): {
  kind: "FOLLOW_UP_PERSON";
  businessActionId: string;
  occurrenceId: number | null;
  sourceType: "follow_up";
  count: 1;
  locations: [];
  channel: "phone";
  requiresTravel: false;
  requiresDriving: false;
  timerSafe: false;
  sensitiveConversation: true;
} {
  return {
    kind: "FOLLOW_UP_PERSON",
    businessActionId: `spirit_human_rescue:${mission.missionId}`,
    occurrenceId: mission.opsTaskId,
    sourceType: "follow_up",
    count: 1,
    locations: [],
    channel: "phone",
    requiresTravel: false,
    requiresDriving: false,
    timerSafe: false,
    sensitiveConversation: true,
  };
}

export const SPIRIT_HUMAN_RESCUE_TEMPLATE_ID = "spirit-human-rescue-v1";
export const SPIRIT_HUMAN_ART_STATUS = "final" as const;
