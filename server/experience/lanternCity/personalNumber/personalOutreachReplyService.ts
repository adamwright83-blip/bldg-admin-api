/**
 * Transport-agnostic messaging-evidence engine for Lantern City outreach.
 *
 * Epistemic, authority & durability rules:
 * - Every message event carries `source` (`provider_webhook`, `device_observed`,
 *   or `operator_reported`), `direction` (`inbound` or `outbound`), `tenantId`,
 *   `operatorId`, matched `customerId`, `providerMessageId`, `observedAt`, and `body`.
 * - Each source's level of evidence stays strictly separate.
 * - Source authority (fail-closed):
 *   1. Public operator UI calls (`recordPersonalOutreachReply`) are strictly
 *      forced to `source = "operator_reported"`, `direction = "inbound"`, require
 *      a known `customerId`, never accept arbitrary unmatched personal numbers,
 *      and NEVER transition `scheduled_outreach_messages` to `dispatched`.
 *   2. Only trusted internal adapters with cryptographic/connector authority
 *      (`TRUSTED_MESSAGING_CONNECTOR_AUTHORITY`, verified signature/connector
 *      identity, and authorized sender number) may mint `provider_webhook` or
 *      `device_observed`. Because no live provider/device connector is active in
 *      production yet, trusted ingestion is refused in production unless an
 *      authenticated adapter is explicitly enabled.
 * - Outbound send observation (`dispatched`):
 *   Transitioning an outbox row to `status = "dispatched"` requires a verified
 *   trusted outbound event (`provider_webhook` or `device_observed`) matched to
 *   the exact outbox row (`messageId`), destination phone (`recipientPhone`),
 *   approved message content (`currentMessageBody` / `approvedBodyDigest`), and
 *   non-empty `providerMessageId`, with idempotent conflict-safe updates that
 *   reject stale or duplicate events.
 * - Fail-closed durable persistence: when a database connection is configured,
 *   every write must insert into `personal_outreach_replies` AND read the saved
 *   row back from MySQL before acknowledging success. Errors are never swallowed,
 *   and process-memory rows are never merged into database reads.
 * - Grounded drafting: prepared follow-up drafts make no unverified turnaround,
 *   pricing, or capacity promises.
 * - Recording an event never marks a paid order as verified and never completes
 *   the recovery objective.
 * - An inbound `STOP` / opt-out immediately records a binding `opted_out`
 *   status in `communicationPermissionService`.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  personalOutreachReplies,
  scheduledOutreachMessages,
  type PersonalOutreachReplyRow,
  type ScheduledOutreachMessageRow,
} from "../../../../drizzle/schema";
import {
  COZY_MESSAGE_EVIDENCE_SOURCES,
  COZY_MESSAGE_EVIDENCE_SOURCE_LABELS,
  COZY_REPLY_CLASSIFICATIONS,
  isTrustedMessageEvidenceSource,
  type CozyMessageDirection,
  type CozyMessageEvidenceSource,
  type CozyPersonalReplyEvidence,
  type CozyReplyClassification,
  type CozyReplyNextStepKind,
} from "../../../../shared/cozyVillagerEvidence";
import { normalizeSmsPhone } from "../../../_core/sms";
import { getDb } from "../../../db";
import { recordCommunicationPermission } from "../../../strategy/communicationPermissionService";
import { approvedBodyDigest } from "./smsComposeHandoff";

/**
 * Unforgeable internal authority symbol required to mint `provider_webhook` or
 * `device_observed` events. JSON/tRPC callers cannot construct or pass this symbol.
 */
export const TRUSTED_MESSAGING_CONNECTOR_AUTHORITY = Symbol(
  "TRUSTED_MESSAGING_CONNECTOR_AUTHORITY"
);

export type TrustedMessagingConnectorProof = {
  readonly authority: typeof TRUSTED_MESSAGING_CONNECTOR_AUTHORITY;
  readonly adapterId: "twilio_webhook_verified" | "android_handset_bridge_verified";
  readonly verifiedSignatureOrSessionId: string;
  readonly authorizedSenderPhone: string;
};

export function createTrustedMessagingConnectorProofForTest(input?: {
  adapterId?: "twilio_webhook_verified" | "android_handset_bridge_verified";
  verifiedSignatureOrSessionId?: string;
  authorizedSenderPhone?: string;
}): TrustedMessagingConnectorProof {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Test connector proof cannot be minted in production."
    );
  }
  return {
    authority: TRUSTED_MESSAGING_CONNECTOR_AUTHORITY,
    adapterId: input?.adapterId ?? "twilio_webhook_verified",
    verifiedSignatureOrSessionId:
      input?.verifiedSignatureOrSessionId ?? "sig_verified_test_adapter",
    authorizedSenderPhone: input?.authorizedSenderPhone ?? "+13105553785",
  };
}

const testMemoryEvents = new Map<string, CozyPersonalReplyEvidence[]>();
let forceFailNextPersistenceForTest = false;

function scopeKey(tenantId: string, operatorId: string): string {
  return `${tenantId}::${operatorId}`;
}

export function resetPersonalOutreachReplyMemoryForTest(): void {
  testMemoryEvents.clear();
  forceFailNextPersistenceForTest = false;
}

export function setForceFailNextReplyPersistenceForTest(fail: boolean): void {
  forceFailNextPersistenceForTest = fail;
}

function firstName(displayName: string): string {
  const token = displayName.trim().split(/\s+/)[0];
  return token || "there";
}

const OPT_OUT_PATTERNS = [
  /^\s*(?:stop|stopall|unsubscribe|cancel|end|quit)\s*[.!]*\s*$/i,
  /\b(?:stop\s+texting|don'?t\s+text|do\s+not\s+text|remove\s+me|take\s+me\s+off|opt\s*out|unsubscribe|wrong\s+number|leave\s+me\s+alone)\b/i,
];

const COMPLAINT_PATTERNS = [
  /\b(?:ruined|shrunk|damaged|lost\s+my|missing\s+shirt|missing\s+items?|missing\s+clothes|stained|late\s+delivery|terrible|upset|angry|overcharged|refund|never\s+again|bad\s+service|complaint|broken)\b/i,
];

const NOT_NOW_PATTERNS = [
  /\b(?:not\s+right\s+now|not\s+now|out\s+of\s+town|traveling|travelling|away\s+right\s+now|next\s+month|maybe\s+later|all\s+set|good\s+for\s+now|no\s+thanks|no\s+thank\s+you|moved\s+away|don'?t\s+need)\b/i,
];

const PICKUP_INTEREST_PATTERNS = [
  /\b(?:pick\s*up|pickup|schedule|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|this\s+week|morning|afternoon|evening|swing\s+by|come\s+by|ready|2\s*bags?|two\s+bags?|three\s+bags?|have\s+a\s+bag|laundry\s+bag|yes\s+please|sounds\s+good|let'?s\s+do)\b/i,
];

const QUESTION_PATTERNS = [
  /\?/,
  /\b(?:how\s+much|what\s+time|when\s+do|do\s+you|can\s+you|price|pricing|per\s+pound|turnaround|dry\s+clean|comforter|minimum|hours|deliver)\b/i,
];

/**
 * Deterministic, zero-LLM classifier for an inbound customer message.
 * Priority order ensures safety and epistemic honesty:
 * 1. `opt_out` (highest priority — blocks future outreach)
 * 2. `complaint` (service issue — never treated as a positive buying signal)
 * 3. `not_now` (explicit deferral)
 * 4. `pickup_interest` (booking / pickup request)
 * 5. `question` (general inquiry or fallback)
 */
export function classifyPersonalOutreachReply(
  replyText: string,
  overrideClassification?: CozyReplyClassification
): CozyReplyClassification {
  const normalized = replyText.trim();
  if (OPT_OUT_PATTERNS.some(rx => rx.test(normalized))) {
    return "opt_out";
  }
  if (
    overrideClassification &&
    overrideClassification !== "outbound_sent" &&
    COZY_REPLY_CLASSIFICATIONS.includes(overrideClassification)
  ) {
    return overrideClassification;
  }
  if (COMPLAINT_PATTERNS.some(rx => rx.test(normalized))) {
    return "complaint";
  }
  if (NOT_NOW_PATTERNS.some(rx => rx.test(normalized))) {
    return "not_now";
  }
  if (PICKUP_INTEREST_PATTERNS.some(rx => rx.test(normalized))) {
    return "pickup_interest";
  }
  if (QUESTION_PATTERNS.some(rx => rx.test(normalized))) {
    return "question";
  }
  return "question";
}

function sourceNote(source: CozyMessageEvidenceSource): string {
  return COZY_MESSAGE_EVIDENCE_SOURCE_LABELS[source].toLowerCase();
}

/**
 * Grounded follow-up preparation. Makes no unverified promises about turnaround,
 * pricing, or capacity—acknowledges the customer's message and asks for or
 * confirms only the concrete details needed.
 */
export function prepareNextStepFromPersonalReply(input: {
  customerName: string;
  replyText: string;
  classification: CozyReplyClassification;
  source?: CozyMessageEvidenceSource;
}): {
  nextStepKind: CozyReplyNextStepKind;
  nextAction: string;
  preparedFollowUpDraft: string | null;
  permissionEffect: "none" | "opted_out";
} {
  const name = firstName(input.customerName);
  const srcLabel = sourceNote(input.source ?? "operator_reported");
  switch (input.classification) {
    case "pickup_interest":
      return {
        nextStepKind: "prepare_pickup_follow_up",
        nextAction: `${input.customerName} replied with pickup interest (${srcLabel}). Review and approve the follow-up draft before sending.`,
        preparedFollowUpDraft: `Thanks ${name}! I'd be glad to coordinate a pickup—what day and time window works best for you, and are there any gate or pickup notes I should have ready?`,
        permissionEffect: "none",
      };
    case "question":
      return {
        nextStepKind: "draft_answer_reply",
        nextAction: `${input.customerName} replied with a question (${srcLabel}). Fill in your verified details and approve the answer draft before sending.`,
        preparedFollowUpDraft: `Hi ${name}, thanks for reaching out! Let me check the exact details on your question and confirm what works best for your items—what day were you hoping to have them picked up?`,
        permissionEffect: "none",
      };
    case "complaint":
      return {
        nextStepKind: "operator_service_recovery",
        nextAction: `${input.customerName} reported a service concern (${srcLabel}). Do not pitch a win-back offer; review the service-recovery response first.`,
        preparedFollowUpDraft: `Hi ${name}, thank you for telling me directly—I'm really sorry about that experience and want to review what happened personally. What is the best time for me to follow up with you today?`,
        permissionEffect: "none",
      };
    case "not_now":
      return {
        nextStepKind: "respect_deferral",
        nextAction: `${input.customerName} asked to hold off for now (${srcLabel}). Pause outreach and wait for a later cycle.`,
        preparedFollowUpDraft: null,
        permissionEffect: "none",
      };
    case "opt_out":
      return {
        nextStepKind: "opt_out_recorded",
        nextAction: `${input.customerName} opted out (${srcLabel}). Communication permission is now blocked; do not send further outreach.`,
        preparedFollowUpDraft: null,
        permissionEffect: "opted_out",
      };
    case "outbound_sent":
      return {
        nextStepKind: "outbound_send_observed",
        nextAction: `Outbound send observed (${srcLabel}). The recovery objective stays open until a paid order is admitted.`,
        preparedFollowUpDraft: null,
        permissionEffect: "none",
      };
  }
}

function deterministicEventId(input: {
  tenantId: string;
  operatorId: string;
  direction: CozyMessageDirection;
  source: CozyMessageEvidenceSource;
  customerId: string | null;
  rawPhone: string | null;
  providerMessageId: string | null;
  body: string;
  observedAtIso: string;
}): string {
  const identityPart = input.providerMessageId
    ? `pmid:${input.providerMessageId}`
    : `${input.customerId ?? ""}|${input.rawPhone ?? ""}|${input.body.trim()}|${input.observedAtIso}`;
  const digest = createHash("sha256")
    .update(
      `${input.tenantId}|${input.operatorId}|${input.direction}|${input.source}|${identityPart}`
    )
    .digest("hex")
    .slice(0, 28);
  return `por_${digest}`;
}

function mapRowToEvidence(row: PersonalOutreachReplyRow): CozyPersonalReplyEvidence {
  const source: CozyMessageEvidenceSource = COZY_MESSAGE_EVIDENCE_SOURCES.includes(
    row.source as CozyMessageEvidenceSource
  )
    ? (row.source as CozyMessageEvidenceSource)
    : COZY_MESSAGE_EVIDENCE_SOURCES.includes(row.provenance as CozyMessageEvidenceSource)
      ? (row.provenance as CozyMessageEvidenceSource)
      : "operator_reported";
  const direction: CozyMessageDirection =
    row.direction === "outbound" ? "outbound" : "inbound";
  const observedAt =
    row.reportedAt instanceof Date
      ? row.reportedAt.toISOString()
      : new Date(String(row.reportedAt)).toISOString();
  const classification: CozyReplyClassification = COZY_REPLY_CLASSIFICATIONS.includes(
    row.classification as CozyReplyClassification
  )
    ? (row.classification as CozyReplyClassification)
    : direction === "outbound"
      ? "outbound_sent"
      : "question";

  return {
    id: row.id,
    tenantId: row.tenantId,
    operatorId: row.operatorId,
    customerId: row.customerId ?? null,
    customerName: row.customerName,
    rawPhone: row.rawPhone ?? null,
    direction,
    source,
    providerMessageId: row.providerMessageId ?? null,
    messageId: row.messageId ?? null,
    territoryId: row.territoryId ?? null,
    replyText: row.replyText,
    body: row.replyText,
    classification,
    nextStepKind: row.nextStepKind as CozyReplyNextStepKind,
    nextAction: row.nextAction,
    preparedFollowUpDraft: row.preparedFollowUpDraft ?? null,
    permissionEffect: row.permissionEffect === "opted_out" ? "opted_out" : "none",
    provenance: source,
    surface: row.surface,
    reportedAt: observedAt,
    observedAt,
  };
}

function assertTrustedConnectorAuthority(input: {
  source: CozyMessageEvidenceSource;
  direction: CozyMessageDirection;
  trustedConnector?: TrustedMessagingConnectorProof;
}): void {
  if (input.direction === "outbound" && !isTrustedMessageEvidenceSource(input.source)) {
    throw new Error(
      "Authority violation: outbound send evidence cannot be recorded from operator_reported input; only verified provider_webhook or device_observed connectors may record outbound sends."
    );
  }
  if (!isTrustedMessageEvidenceSource(input.source)) {
    return;
  }
  if (
    !input.trustedConnector ||
    input.trustedConnector.authority !== TRUSTED_MESSAGING_CONNECTOR_AUTHORITY
  ) {
    throw new Error(
      `Authority violation: source "${input.source}" requires a verified internal connector proof and cannot be submitted by an unverified client.`
    );
  }
  if (!input.trustedConnector.verifiedSignatureOrSessionId?.trim()) {
    throw new Error(
      `Authority violation: source "${input.source}" requires a non-empty verifiedSignatureOrSessionId.`
    );
  }
  const normalizedSender = normalizeSmsPhone(input.trustedConnector.authorizedSenderPhone);
  if (!normalizedSender) {
    throw new Error(
      `Authority violation: source "${input.source}" requires a valid E.164 authorizedSenderPhone.`
    );
  }
  // No live provider webhook or handset bridge is enabled in production yet
  if (
    process.env.NODE_ENV === "production" &&
    process.env.JOYSTICK_ENABLE_TRUSTED_MESSAGING_CONNECTOR !== "true"
  ) {
    throw new Error(
      `Trusted messaging connector ingestion (${input.source}) is inert in production until a verified connector is enabled.`
    );
  }
}

export type VerifiedOutboundDispatchMatch =
  | {
      matched: true;
      outboxRow: ScheduledOutreachMessageRow;
      alreadyDispatchedIdempotent: boolean;
    }
  | {
      matched: false;
      reason:
        | "missing_message_id"
        | "missing_provider_message_id"
        | "missing_recipient_phone"
        | "outbox_not_found"
        | "customer_mismatch"
        | "phone_mismatch"
        | "body_mismatch"
        | "stale_event_before_draft"
        | "invalid_outbox_status"
        | "conflicting_external_message_id";
    };

/**
 * Verifies whether a trusted outbound event (`provider_webhook` or `device_observed`)
 * is authorized to transition a `scheduled_outreach_messages` row to `dispatched`.
 *
 * Requires:
 * 1. Exact `messageId` match in the same `(tenantId, operatorId)` scope
 * 2. Non-empty `providerMessageId`
 * 3. Exact normalized destination phone match (`rawPhone === outboxRow.recipientPhone`)
 * 4. Exact approved message body digest match (`approvedBodyDigest(body) === approvedBodyDigest(outboxRow.currentMessageBody)`)
 * 5. Non-stale timestamp (`observedDate >= outboxRow.createdAt`)
 * 6. Idempotent conflict-safe status check (`pending`, `awaiting_sender_setup`, `claimed`, or already `dispatched` with the same `externalMessageId`)
 */
export function verifyOutboundOutboxMatch(input: {
  outboxRow: ScheduledOutreachMessageRow | null | undefined;
  messageId: string | null;
  customerId: string | null;
  normalizedRecipientPhone: string | null;
  trimmedBody: string;
  providerMessageId: string | null;
  observedDate: Date;
}): VerifiedOutboundDispatchMatch {
  if (!input.messageId) {
    return { matched: false, reason: "missing_message_id" };
  }
  if (!input.providerMessageId) {
    return { matched: false, reason: "missing_provider_message_id" };
  }
  if (!input.normalizedRecipientPhone) {
    return { matched: false, reason: "missing_recipient_phone" };
  }
  const row = input.outboxRow;
  if (!row || row.id !== input.messageId) {
    return { matched: false, reason: "outbox_not_found" };
  }
  if (input.customerId && row.customerId !== input.customerId) {
    return { matched: false, reason: "customer_mismatch" };
  }
  const outboxPhone = normalizeSmsPhone(row.recipientPhone) ?? row.recipientPhone.trim();
  if (!outboxPhone || outboxPhone !== input.normalizedRecipientPhone) {
    return { matched: false, reason: "phone_mismatch" };
  }
  if (approvedBodyDigest(input.trimmedBody) !== approvedBodyDigest(row.currentMessageBody)) {
    return { matched: false, reason: "body_mismatch" };
  }
  const draftCreatedAtMs =
    row.createdAt instanceof Date
      ? row.createdAt.getTime()
      : new Date(String(row.createdAt)).getTime();
  if (
    Number.isFinite(draftCreatedAtMs) &&
    input.observedDate.getTime() + 1000 < draftCreatedAtMs
  ) {
    return { matched: false, reason: "stale_event_before_draft" };
  }
  if (row.status === "dispatched") {
    if (row.externalMessageId === input.providerMessageId) {
      return { matched: true, outboxRow: row, alreadyDispatchedIdempotent: true };
    }
    return { matched: false, reason: "conflicting_external_message_id" };
  }
  if (
    row.status !== "pending" &&
    row.status !== "awaiting_sender_setup" &&
    row.status !== "claimed"
  ) {
    return { matched: false, reason: "invalid_outbox_status" };
  }
  return { matched: true, outboxRow: row, alreadyDispatchedIdempotent: false };
}

export async function recordMessagingEvidenceEvent(input: {
  tenantId: string;
  operatorId: string;
  source: CozyMessageEvidenceSource;
  direction: CozyMessageDirection;
  body: string;
  customerId?: string | null;
  customerName?: string | null;
  rawPhone?: string | null;
  providerMessageId?: string | null;
  messageId?: string | null;
  territoryId?: string | null;
  classification?: CozyReplyClassification;
  surface?: "cozy_composer" | "day_line" | "device_connector" | "provider_webhook";
  observedAt?: Date | string;
  trustedConnector?: TrustedMessagingConnectorProof;
}): Promise<CozyPersonalReplyEvidence> {
  if (!input.tenantId?.trim() || !input.operatorId?.trim()) {
    throw new Error("tenantId and operatorId are required to record messaging evidence.");
  }
  assertTrustedConnectorAuthority({
    source: input.source,
    direction: input.direction,
    trustedConnector: input.trustedConnector,
  });

  const trimmedBody = input.body.trim();
  if (!trimmedBody) {
    throw new Error("Message body is required to record messaging evidence.");
  }
  const normalizedPhone = input.rawPhone
    ? normalizeSmsPhone(input.rawPhone) ?? null
    : null;
  if (input.rawPhone && !normalizedPhone) {
    throw new Error("Invalid phone number format for messaging evidence event.");
  }

  let resolvedCustomerId = input.customerId?.trim() || null;
  let resolvedCustomerName = input.customerName?.trim() || "";
  let resolvedMessageId = input.messageId?.trim() || null;
  let resolvedTerritoryId = input.territoryId?.trim() || null;
  const trimmedProviderMessageId = input.providerMessageId?.trim() || null;

  // Data minimization & scoping: operator_reported UI fallback requires an explicit customerId
  // and must never persist arbitrary raw phone numbers.
  if (input.source === "operator_reported") {
    if (!resolvedCustomerId) {
      throw new Error(
        "Operator-reported fallback requires a known customerId; arbitrary unmatched phone numbers cannot be logged."
      );
    }
    if (input.rawPhone) {
      throw new Error(
        "Operator-reported fallback does not accept rawPhone input; customer identity is scoped by customerId."
      );
    }
  }

  // Outbound send observations require explicit messageId, providerMessageId, and recipient phone
  if (input.direction === "outbound") {
    if (!resolvedMessageId) {
      throw new Error(
        "Outbound send observation requires an explicit outbox messageId."
      );
    }
    if (!trimmedProviderMessageId) {
      throw new Error(
        "Outbound send observation requires a non-empty providerMessageId."
      );
    }
    if (!normalizedPhone) {
      throw new Error(
        "Outbound send observation requires the destination phone number (rawPhone) for verification."
      );
    }
  }

  const observedDate =
    input.observedAt instanceof Date
      ? input.observedAt
      : input.observedAt
        ? new Date(input.observedAt)
        : new Date();
  if (Number.isNaN(observedDate.getTime())) {
    throw new Error("Invalid observedAt timestamp for messaging evidence event.");
  }
  const observedAtIso = observedDate.toISOString();

  if (forceFailNextPersistenceForTest) {
    forceFailNextPersistenceForTest = false;
    throw new Error("Simulated durable persistence failure: message evidence was not saved.");
  }

  const db = await getDb();

  // For trusted connectors, correlate phone against existing tenant+operator outbox records
  if (db && (!resolvedCustomerId || !resolvedMessageId) && normalizedPhone) {
    const outboxMatches = await db
      .select()
      .from(scheduledOutreachMessages)
      .where(
        and(
          eq(scheduledOutreachMessages.tenantId, input.tenantId),
          eq(scheduledOutreachMessages.operatorId, input.operatorId),
          eq(scheduledOutreachMessages.recipientPhone, normalizedPhone)
        )
      )
      .orderBy(desc(scheduledOutreachMessages.createdAt))
      .limit(5);
    const activeMatch =
      outboxMatches.find(row => row.status !== "cancelled") ?? outboxMatches[0];
    if (activeMatch) {
      resolvedCustomerId = resolvedCustomerId ?? activeMatch.customerId;
      resolvedCustomerName = resolvedCustomerName || activeMatch.customerName;
      resolvedMessageId = resolvedMessageId ?? activeMatch.id;
      resolvedTerritoryId = resolvedTerritoryId ?? activeMatch.territoryId ?? null;
    }
  }

  if (!resolvedCustomerId && !normalizedPhone) {
    throw new Error(
      "Messaging evidence requires a scoped customerId or a verified connector phone number."
    );
  }
  if (!resolvedCustomerName) {
    resolvedCustomerName = normalizedPhone ? `Unmatched (${normalizedPhone})` : "Customer";
  }

  // If this is a trusted outbound event and DB is active, verify outbox match BEFORE persisting dispatch
  let verifiedOutboundRow: ScheduledOutreachMessageRow | null = null;
  let outboundAlreadyDispatched = false;
  if (db && input.direction === "outbound") {
    const [outboxCandidate] = await db
      .select()
      .from(scheduledOutreachMessages)
      .where(
        and(
          eq(scheduledOutreachMessages.id, resolvedMessageId!),
          eq(scheduledOutreachMessages.tenantId, input.tenantId),
          eq(scheduledOutreachMessages.operatorId, input.operatorId)
        )
      )
      .limit(1);

    const verification = verifyOutboundOutboxMatch({
      outboxRow: outboxCandidate,
      messageId: resolvedMessageId,
      customerId: resolvedCustomerId,
      normalizedRecipientPhone: normalizedPhone,
      trimmedBody,
      providerMessageId: trimmedProviderMessageId,
      observedDate,
    });
    if (!verification.matched) {
      throw new Error(
        `Outbound send verification failed (${verification.reason}): refusing to mark outbox draft as dispatched.`
      );
    }
    verifiedOutboundRow = verification.outboxRow;
    outboundAlreadyDispatched = verification.alreadyDispatchedIdempotent;
    resolvedCustomerId = verifiedOutboundRow.customerId;
    resolvedCustomerName = verifiedOutboundRow.customerName;
    resolvedTerritoryId = resolvedTerritoryId ?? verifiedOutboundRow.territoryId ?? null;
  }

  const classification: CozyReplyClassification =
    input.direction === "outbound"
      ? "outbound_sent"
      : classifyPersonalOutreachReply(trimmedBody, input.classification);

  const prepared = prepareNextStepFromPersonalReply({
    customerName: resolvedCustomerName,
    replyText: trimmedBody,
    classification,
    source: input.source,
  });

  const eventId = deterministicEventId({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    direction: input.direction,
    source: input.source,
    customerId: resolvedCustomerId,
    rawPhone: normalizedPhone,
    providerMessageId: trimmedProviderMessageId,
    body: trimmedBody,
    observedAtIso,
  });

  if (db) {
    await db
      .insert(personalOutreachReplies)
      .values({
        id: eventId,
        tenantId: input.tenantId,
        operatorId: input.operatorId,
        customerId: resolvedCustomerId,
        customerName: resolvedCustomerName,
        rawPhone: normalizedPhone,
        direction: input.direction,
        source: input.source,
        providerMessageId: trimmedProviderMessageId,
        messageId: resolvedMessageId,
        territoryId: resolvedTerritoryId,
        replyText: trimmedBody,
        classification,
        nextStepKind: prepared.nextStepKind,
        nextAction: prepared.nextAction,
        preparedFollowUpDraft: prepared.preparedFollowUpDraft,
        permissionEffect: prepared.permissionEffect,
        provenance: input.source,
        surface: input.surface ?? "cozy_composer",
        reportedAt: observedDate,
      })
      .onDuplicateKeyUpdate({
        set: {
          replyText: trimmedBody,
          classification,
          nextStepKind: prepared.nextStepKind,
          nextAction: prepared.nextAction,
          preparedFollowUpDraft: prepared.preparedFollowUpDraft,
          permissionEffect: prepared.permissionEffect,
          source: input.source,
          provenance: input.source,
          reportedAt: observedDate,
        },
      });

    // Fail-closed read-back verification before acknowledging "saved"
    const [readBack] = await db
      .select()
      .from(personalOutreachReplies)
      .where(
        and(
          eq(personalOutreachReplies.id, eventId),
          eq(personalOutreachReplies.tenantId, input.tenantId),
          eq(personalOutreachReplies.operatorId, input.operatorId)
        )
      )
      .limit(1);

    if (!readBack || readBack.id !== eventId || readBack.replyText !== trimmedBody) {
      throw new Error(
        `Durable read-back verification failed for messaging evidence event ${eventId}.`
      );
    }

    // Conflict-safe idempotent transition to `dispatched` only when verifiedOutboundRow is present
    if (
      input.direction === "outbound" &&
      verifiedOutboundRow &&
      !outboundAlreadyDispatched &&
      trimmedProviderMessageId
    ) {
      await db
        .update(scheduledOutreachMessages)
        .set({
          status: "dispatched",
          dispatchedAt: observedDate,
          externalMessageId: trimmedProviderMessageId,
        })
        .where(
          and(
            eq(scheduledOutreachMessages.id, verifiedOutboundRow.id),
            eq(scheduledOutreachMessages.tenantId, input.tenantId),
            eq(scheduledOutreachMessages.operatorId, input.operatorId),
            eq(scheduledOutreachMessages.recipientPhone, verifiedOutboundRow.recipientPhone),
            eq(
              scheduledOutreachMessages.currentMessageBody,
              verifiedOutboundRow.currentMessageBody
            ),
            inArray(scheduledOutreachMessages.status, [
              "pending",
              "awaiting_sender_setup",
              "claimed",
            ])
          )
        );
    }

    if (prepared.permissionEffect === "opted_out") {
      const subjectIds = [
        resolvedCustomerId,
        normalizedPhone ? `phone:${normalizedPhone.replace(/\D/g, "").slice(-10)}` : null,
      ].filter((id): id is string => Boolean(id));
      for (const subjectId of subjectIds) {
        await recordCommunicationPermission({
          tenantId: input.tenantId,
          subjectType: "customer",
          subjectId,
          channel: "sms",
          status: "opted_out",
          reason: `Observed SMS opt-out (${input.source}): "${trimmedBody.slice(0, 120)}"`,
        });
        await recordCommunicationPermission({
          tenantId: input.tenantId,
          subjectType: "customer",
          subjectId,
          channel: "any",
          status: "opted_out",
          reason: `Observed SMS opt-out (${input.source}): "${trimmedBody.slice(0, 120)}"`,
        });
      }
    }

    return mapRowToEvidence(readBack);
  }

  // Test-only isolated memory store when DATABASE_URL / getDb() is not configured
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Database connection is unavailable in production; refusing to acknowledge unsaved messaging evidence."
    );
  }

  if (prepared.permissionEffect === "opted_out") {
    const subjectIds = [
      resolvedCustomerId,
      normalizedPhone ? `phone:${normalizedPhone.replace(/\D/g, "").slice(-10)}` : null,
    ].filter((id): id is string => Boolean(id));
    for (const subjectId of subjectIds) {
      await recordCommunicationPermission({
        tenantId: input.tenantId,
        subjectType: "customer",
        subjectId,
        channel: "sms",
        status: "opted_out",
        reason: `Observed SMS opt-out (${input.source}): "${trimmedBody.slice(0, 120)}"`,
      });
      await recordCommunicationPermission({
        tenantId: input.tenantId,
        subjectType: "customer",
        subjectId,
        channel: "any",
        status: "opted_out",
        reason: `Observed SMS opt-out (${input.source}): "${trimmedBody.slice(0, 120)}"`,
      });
    }
  }

  const record: CozyPersonalReplyEvidence = {
    id: eventId,
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    customerId: resolvedCustomerId,
    customerName: resolvedCustomerName,
    rawPhone: normalizedPhone,
    direction: input.direction,
    source: input.source,
    providerMessageId: trimmedProviderMessageId,
    messageId: resolvedMessageId,
    territoryId: resolvedTerritoryId,
    replyText: trimmedBody,
    body: trimmedBody,
    classification,
    nextStepKind: prepared.nextStepKind,
    nextAction: prepared.nextAction,
    preparedFollowUpDraft: prepared.preparedFollowUpDraft,
    permissionEffect: prepared.permissionEffect,
    provenance: input.source,
    surface: input.surface ?? "cozy_composer",
    reportedAt: observedAtIso,
    observedAt: observedAtIso,
  };

  const key = scopeKey(input.tenantId, input.operatorId);
  const existing = testMemoryEvents.get(key) ?? [];
  testMemoryEvents.set(key, [record, ...existing.filter(item => item.id !== record.id)]);

  const readBackMem = (testMemoryEvents.get(key) ?? []).find(item => item.id === eventId);
  if (!readBackMem) {
    throw new Error(`Read-back verification failed for messaging evidence event ${eventId}.`);
  }
  return readBackMem;
}

/**
 * Operator fallback procedure for recording an inbound customer reply when
 * automatic observation is unavailable.
 *
 * Security & Authority Invariant:
 * - Always forces `source = "operator_reported"` and `direction = "inbound"`.
 * - Requires a known `customerId` (does not accept arbitrary unmatched numbers).
 * - Never transitions `scheduled_outreach_messages` to `dispatched`.
 */
export async function recordPersonalOutreachReply(input: {
  tenantId: string;
  operatorId: string;
  customerId: string;
  customerName?: string;
  replyText: string;
  classification?: Exclude<CozyReplyClassification, "outbound_sent">;
  messageId?: string | null;
  territoryId?: string | null;
  surface?: "cozy_composer" | "day_line";
  now?: Date;
}): Promise<CozyPersonalReplyEvidence> {
  if (!input.customerId?.trim()) {
    throw new Error("customerId is required to record an operator-reported customer reply.");
  }
  return recordMessagingEvidenceEvent({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    source: "operator_reported",
    direction: "inbound",
    body: input.replyText,
    customerId: input.customerId.trim(),
    customerName: input.customerName ?? null,
    rawPhone: null,
    providerMessageId: null,
    messageId: input.messageId ?? null,
    territoryId: input.territoryId ?? null,
    classification: input.classification,
    surface: input.surface ?? "cozy_composer",
    observedAt: input.now,
  });
}

export async function listPersonalOutreachReplies(input: {
  tenantId: string;
  operatorId: string;
  customerId?: string;
  direction?: CozyMessageDirection;
  source?: CozyMessageEvidenceSource;
}): Promise<CozyPersonalReplyEvidence[]> {
  const db = await getDb();
  if (db) {
    const conditions = [
      eq(personalOutreachReplies.tenantId, input.tenantId),
      eq(personalOutreachReplies.operatorId, input.operatorId),
    ];
    if (input.customerId) {
      conditions.push(eq(personalOutreachReplies.customerId, input.customerId));
    }
    if (input.direction) {
      conditions.push(eq(personalOutreachReplies.direction, input.direction));
    }
    if (input.source) {
      conditions.push(eq(personalOutreachReplies.source, input.source));
    }
    const rows = await db
      .select()
      .from(personalOutreachReplies)
      .where(and(...conditions))
      .orderBy(desc(personalOutreachReplies.reportedAt));

    return rows.map(mapRowToEvidence);
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Database connection is unavailable in production.");
  }

  const key = scopeKey(input.tenantId, input.operatorId);
  const mem = testMemoryEvents.get(key) ?? [];
  return mem
    .filter(item => {
      if (input.customerId && item.customerId !== input.customerId) return false;
      if (input.direction && (item.direction ?? "inbound") !== input.direction) return false;
      if (input.source && (item.source ?? item.provenance) !== input.source) return false;
      return true;
    })
    .sort((a, b) => (b.observedAt ?? b.reportedAt).localeCompare(a.observedAt ?? a.reportedAt));
}
