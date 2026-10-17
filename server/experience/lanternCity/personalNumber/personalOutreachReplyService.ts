/**
 * Transport-agnostic messaging-evidence engine for Lantern City outreach.
 *
 * Epistemic & durability rules:
 * - Every message event carries `source` (`provider_webhook`, `device_observed`,
 *   or `operator_reported`), `direction` (`inbound` or `outbound`), `tenantId`,
 *   `operatorId`, matched `customerId` (or `rawPhone` if unmatched),
 *   `providerMessageId`, `observedAt`, and `body`.
 * - Each source's level of evidence stays strictly separate.
 * - An outbound draft becomes "sent" (`send_observed`) only when a matching
 *   outbound event is observed; opening a compose window never counts.
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
import { and, desc, eq } from "drizzle-orm";
import {
  personalOutreachReplies,
  scheduledOutreachMessages,
  type PersonalOutreachReplyRow,
} from "../../../../drizzle/schema";
import {
  COZY_MESSAGE_EVIDENCE_SOURCES,
  COZY_MESSAGE_EVIDENCE_SOURCE_LABELS,
  COZY_REPLY_CLASSIFICATIONS,
  type CozyMessageDirection,
  type CozyMessageEvidenceSource,
  type CozyPersonalReplyEvidence,
  type CozyReplyClassification,
  type CozyReplyNextStepKind,
} from "../../../../shared/cozyVillagerEvidence";
import { normalizeSmsPhone } from "../../../_core/sms";
import { getDb } from "../../../db";
import { recordCommunicationPermission } from "../../../strategy/communicationPermissionService";

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
}): Promise<CozyPersonalReplyEvidence> {
  if (!input.tenantId?.trim() || !input.operatorId?.trim()) {
    throw new Error("tenantId and operatorId are required to record messaging evidence.");
  }
  const trimmedBody = input.body.trim();
  if (!trimmedBody) {
    throw new Error("Message body is required to record messaging evidence.");
  }
  const normalizedPhone = input.rawPhone
    ? normalizeSmsPhone(input.rawPhone) ?? input.rawPhone.trim()
    : null;
  let resolvedCustomerId = input.customerId?.trim() || null;
  let resolvedCustomerName = input.customerName?.trim() || "";
  let resolvedMessageId = input.messageId?.trim() || null;
  let resolvedTerritoryId = input.territoryId?.trim() || null;

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

  // If customerId or messageId is not explicitly supplied, attempt to match against the tenant+operator's outbox by phone
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
      "Messaging evidence requires either a matched customerId or a rawPhone."
    );
  }
  if (!resolvedCustomerName) {
    resolvedCustomerName = normalizedPhone ? `Unmatched (${normalizedPhone})` : "Customer";
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
    providerMessageId: input.providerMessageId?.trim() || null,
    body: trimmedBody,
    observedAtIso,
  });

  const externalRef =
    input.providerMessageId?.trim() || `${input.source}:${eventId}`;

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
        providerMessageId: input.providerMessageId?.trim() || null,
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

    // When an outbound send is observed, transition the matching outbox draft to dispatched
    if (input.direction === "outbound" && (resolvedMessageId || resolvedCustomerId)) {
      const targetOutboxRows = resolvedMessageId
        ? await db
            .select()
            .from(scheduledOutreachMessages)
            .where(
              and(
                eq(scheduledOutreachMessages.id, resolvedMessageId),
                eq(scheduledOutreachMessages.tenantId, input.tenantId),
                eq(scheduledOutreachMessages.operatorId, input.operatorId)
              )
            )
            .limit(1)
        : await db
            .select()
            .from(scheduledOutreachMessages)
            .where(
              and(
                eq(scheduledOutreachMessages.tenantId, input.tenantId),
                eq(scheduledOutreachMessages.operatorId, input.operatorId),
                eq(scheduledOutreachMessages.customerId, resolvedCustomerId!)
              )
            )
            .orderBy(desc(scheduledOutreachMessages.createdAt))
            .limit(5);

      const candidateDraft = targetOutboxRows.find(
        row =>
          row.status === "pending" ||
          row.status === "awaiting_sender_setup" ||
          row.status === "claimed"
      );
      if (candidateDraft) {
        await db
          .update(scheduledOutreachMessages)
          .set({
            status: "dispatched",
            dispatchedAt: observedDate,
            externalMessageId: externalRef,
          })
          .where(
            and(
              eq(scheduledOutreachMessages.id, candidateDraft.id),
              eq(scheduledOutreachMessages.tenantId, input.tenantId),
              eq(scheduledOutreachMessages.operatorId, input.operatorId)
            )
          );
      }
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
    providerMessageId: input.providerMessageId?.trim() || null,
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

export async function recordPersonalOutreachReply(input: {
  tenantId: string;
  operatorId: string;
  customerId?: string | null;
  customerName?: string;
  rawPhone?: string | null;
  replyText: string;
  direction?: CozyMessageDirection;
  source?: CozyMessageEvidenceSource;
  providerMessageId?: string | null;
  classification?: CozyReplyClassification;
  messageId?: string | null;
  territoryId?: string | null;
  surface?: "cozy_composer" | "day_line" | "device_connector" | "provider_webhook";
  now?: Date;
}): Promise<CozyPersonalReplyEvidence> {
  return recordMessagingEvidenceEvent({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    source: input.source ?? "operator_reported",
    direction: input.direction ?? "inbound",
    body: input.replyText,
    customerId: input.customerId ?? null,
    customerName: input.customerName ?? null,
    rawPhone: input.rawPhone ?? null,
    providerMessageId: input.providerMessageId ?? null,
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
