import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, lt, lte, or } from "drizzle-orm";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import {
  scheduledOutreachMessages,
  scheduledOutreachRevisions,
  type ScheduledOutreachMessageRow,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import { isMysqlDuplicateKeyError } from "../../mysqlErrors";
import { checkCommunicationPermission } from "../../strategy/communicationPermissionService";
import { normalizeSmsPhone } from "../../_core/sms";

export interface ScheduledOutreachDraftInput {
  tenantId: string;
  operatorId: string;
  customerId: string;
  customerName: string;
  recipientPhone: string;
  originalSuggestedDraft: string;
  messageBody: string;
  scheduledFor: Date | string;
  timezone?: string;
  dstAmbiguityChoice?: "first" | "second";
  slotId?: string;
  territoryId?: string;
  senderPhone?: string;
  allowImmediate?: boolean;
  idempotencyKey?: string;
  deliveryIntent?: "immediate" | "scheduled";
  status?: "pending" | "awaiting_sender_setup";
  now?: Date;
}

export interface EditScheduledOutreachInput {
  tenantId: string;
  operatorId: string;
  messageId: string;
  newMessageBody: string;
  expectedRevisionCount?: number;
  reason?: string;
  now?: Date;
}

export interface RescheduleOutreachInput {
  tenantId: string;
  operatorId: string;
  messageId: string;
  newScheduledFor: Date | string;
  timezone?: string;
  dstAmbiguityChoice?: "first" | "second";
  reason?: string;
  now?: Date;
}

export interface CancelScheduledOutreachInput {
  tenantId: string;
  operatorId: string;
  messageId: string;
  reason: string;
  now?: Date;
}

export interface ClaimDueOutreachLeaseInput {
  leaseHolder: string;
  leaseDurationMs?: number;
  now?: Date;
  limit?: number;
}

export interface OutboundTestSenderAdapter {
  send: (params: {
    to: string;
    body: string;
    messageId: string;
  }) => Promise<{ externalMessageId: string; evidenceName?: string }>;
}

export interface SendEarlyOutreachInput {
  tenantId: string;
  operatorId: string;
  messageId: string;
  leaseHolder: string;
  testSenderAdapter?: OutboundTestSenderAdapter;
  now?: Date;
}

/**
 * Standard affectedRows reader matching server codebase conventions.
 */
function affectedRows(result: unknown): number {
  return Number(
    (result as { affectedRows?: number; [0]?: { affectedRows?: number } })
      ?.affectedRows ??
      (result as { [0]?: { affectedRows?: number } })?.[0]?.affectedRows ??
      0
  );
}

// In-memory test store used ONLY during unit test execution when database is intentionally unset
const testMemoryMessages = new Map<string, ScheduledOutreachMessageRow>();
const testMemoryRevisions = new Map<
  string,
  Array<{
    id: string;
    outreachMessageId: string;
    tenantId: string;
    revisionNumber: number;
    messageBody: string;
    editedBy: string;
    reason: string | null;
    createdAt: Date;
  }>
>();

async function requireDb() {
  const db = await getDb();
  if (!db) {
    if (process.env.NODE_ENV === "test" && !process.env.DATABASE_URL) {
      return null;
    }
    throw new Error("Database not available: scheduled outreach requires durable MySQL persistence");
  }
  return db;
}

/**
 * Validates and converts scheduled dispatch time safely across timezones and Daylight Saving Time.
 * Rejects nonexistent spring-forward gap times and handles ambiguous fall-back times.
 */
export function normalizeScheduledForUtc(
  inputTime: Date | string,
  timezone: string = "America/Los_Angeles",
  dstAmbiguityChoice?: "first" | "second"
): Date {
  if (inputTime instanceof Date) {
    if (isNaN(inputTime.getTime())) {
      throw new Error(`Invalid scheduled date object: ${String(inputTime)}`);
    }
    return inputTime;
  }

  const str = String(inputTime).trim();
  if (!str) {
    throw new Error("Scheduled send time cannot be empty");
  }

  // If provided with an explicit UTC or timezone offset (e.g. 2026-10-25T14:30:00Z or +07:00)
  if (str.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(str)) {
    const parsed = new Date(str);
    if (isNaN(parsed.getTime())) {
      throw new Error(`Invalid scheduled timestamp string: ${str}`);
    }
    return parsed;
  }

  // Wall-clock input without offset (e.g. "2027-03-14T02:30:00" or "2027-03-14 02:30")
  const normalizedStr = str.replace(" ", "T");
  const utcDate = fromZonedTime(normalizedStr, timezone);
  if (isNaN(utcDate.getTime())) {
    throw new Error(`Could not parse wall time "${str}" in timezone "${timezone}"`);
  }

  // DST non-existent spring-forward gap verification using formatInTimeZone
  const formattedBack = formatInTimeZone(utcDate, timezone, "yyyy-MM-dd'T'HH:mm");
  const requestedPrefix = normalizedStr.slice(0, 16);
  if (formattedBack !== requestedPrefix) {
    throw new Error(
      `Invalid scheduled time: "${str}" does not exist in timezone "${timezone}" due to Daylight Saving Time transition.`
    );
  }

  // Fall-back DST ambiguity detection (e.g. 1:30 AM occurs twice on fall-back transition day)
  const laterUtc = new Date(utcDate.getTime() + 3600_000);
  const laterWall = formatInTimeZone(laterUtc, timezone, "yyyy-MM-dd'T'HH:mm");
  const earlierUtc = new Date(utcDate.getTime() - 3600_000);
  const earlierWall = formatInTimeZone(earlierUtc, timezone, "yyyy-MM-dd'T'HH:mm");

  const isAmbiguous = laterWall === requestedPrefix || earlierWall === requestedPrefix;
  if (isAmbiguous) {
    if (!dstAmbiguityChoice) {
      throw new Error(
        `Scheduled time "${str}" is ambiguous in timezone "${timezone}" because clocks turn back (occurs twice). Please specify dstAmbiguityChoice: "first" (earlier) or "second" (later).`
      );
    }
    if (dstAmbiguityChoice === "second" && laterWall === requestedPrefix) {
      return laterUtc;
    }
    if (dstAmbiguityChoice === "first" && earlierWall === requestedPrefix) {
      return earlierUtc;
    }
  }

  return utcDate;
}

/**
 * Creates a validated, scheduled customer outreach message.
 * Enforces future scheduled date, minimum content, phone format, and G14 communication consent.
 * Durable MySQL persistence: transactional insert of message row and initial revision.
 */
export async function createScheduledOutreachDraft(
  input: ScheduledOutreachDraftInput
): Promise<ScheduledOutreachMessageRow> {
  const now = input.now ?? new Date();
  const timezone = input.timezone ?? "America/Los_Angeles";
  const trimmedBody = input.messageBody.trim();

  if (!trimmedBody) {
    throw new Error("Message body cannot be empty");
  }

  const scheduledFor = normalizeScheduledForUtc(
    input.scheduledFor,
    timezone,
    input.dstAmbiguityChoice
  );

  if (!input.allowImmediate && scheduledFor.getTime() <= now.getTime()) {
    throw new Error("Scheduled send time must be in the future");
  }

  const normalizedPhone = normalizeSmsPhone(input.recipientPhone);
  if (!normalizedPhone || normalizedPhone.length < 10) {
    throw new Error(`Invalid recipient phone number: ${input.recipientPhone}`);
  }

  // Pre-validate G14 binding consent and frequency limits
  const consent = await checkCommunicationPermission({
    tenantId: input.tenantId,
    subjectType: "customer",
    subjectId: input.customerId,
    channel: "sms",
    now,
  });

  if (!consent.allowed) {
    throw new Error(
      `Outreach blocked by customer permission: ${consent.reason ?? "Opted out or frequency cap exceeded"}`
    );
  }

  const db = await requireDb();

  // 1. Durable idempotency: if an idempotencyKey is provided, check if a message with this key already exists
  if (input.idempotencyKey) {
    if (db) {
      const [existing] = await db
        .select()
        .from(scheduledOutreachMessages)
        .where(
          and(
            eq(scheduledOutreachMessages.tenantId, input.tenantId),
            eq(scheduledOutreachMessages.idempotencyKey, input.idempotencyKey)
          )
        )
        .limit(1);
      if (existing) {
        return existing;
      }
    } else {
      const memExisting = Array.from(testMemoryMessages.values()).find(
        (m) => m.tenantId === input.tenantId && m.idempotencyKey === input.idempotencyKey
      );
      if (memExisting) {
        return memExisting;
      }
    }
  }

  const initialStatus = input.status ?? "pending";
  const deliveryIntent =
    input.deliveryIntent ??
    (initialStatus === "awaiting_sender_setup" ? "immediate" : "scheduled");

  const messageId = `som_${randomUUID()}`;
  const row: ScheduledOutreachMessageRow = {
    id: messageId,
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    customerId: input.customerId,
    customerName: input.customerName,
    recipientPhone: normalizedPhone,
    senderPhone: input.senderPhone ?? null,
    originalSuggestedDraft: input.originalSuggestedDraft.trim(),
    currentMessageBody: trimmedBody,
    revisionCount: 1,
    scheduledFor,
    timezone,
    status: initialStatus,
    idempotencyKey: input.idempotencyKey ?? null,
    deliveryIntent,
    leaseHolder: null,
    leasedUntil: null,
    dispatchAttemptedAt: null,
    dispatchedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    failureReason: null,
    externalMessageId: null,
    slotId: input.slotId ?? null,
    territoryId: input.territoryId ?? null,
    createdAt: now,
    updatedAt: now,
  };

  if (db) {
    try {
      return await db.transaction(async (tx) => {
        await tx.insert(scheduledOutreachMessages).values(row);
        await tx.insert(scheduledOutreachRevisions).values({
          id: `sor_${randomUUID()}`,
          outreachMessageId: messageId,
          tenantId: input.tenantId,
          revisionNumber: 1,
          messageBody: trimmedBody,
          editedBy: input.operatorId,
          reason: "Initial scheduled draft",
          createdAt: now,
        });
        return row;
      });
    } catch (err: any) {
      if (input.idempotencyKey && isMysqlDuplicateKeyError(err)) {
        const [existing] = await db
          .select()
          .from(scheduledOutreachMessages)
          .where(
            and(
              eq(scheduledOutreachMessages.tenantId, input.tenantId),
              eq(scheduledOutreachMessages.idempotencyKey, input.idempotencyKey)
            )
          )
          .limit(1);
        if (existing) return existing;
      }
      throw err;
    }
  }

  // Unit-test in-memory mode only
  testMemoryMessages.set(messageId, row);
  testMemoryRevisions.set(messageId, [
    {
      id: `sor_${randomUUID()}`,
      outreachMessageId: messageId,
      tenantId: input.tenantId,
      revisionNumber: 1,
      messageBody: trimmedBody,
      editedBy: input.operatorId,
      reason: "Initial scheduled draft",
      createdAt: now,
    },
  ]);

  return row;
}

/**
 * In-place edit of a pending scheduled outreach draft.
 * Concurrency-safe: atomically updates only if status is still 'pending' and unleased.
 * Enforces compare-and-set optimistic concurrency control when expectedRevisionCount is provided.
 * Transactional: updates draft and appends revision history atomically.
 */
export async function editScheduledOutreachDraft(
  input: EditScheduledOutreachInput
): Promise<ScheduledOutreachMessageRow> {
  const now = input.now ?? new Date();
  const trimmedBody = input.newMessageBody.trim();

  if (!trimmedBody) {
    throw new Error("Message body cannot be empty");
  }

  const db = await requireDb();
  if (db) {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(scheduledOutreachMessages)
        .where(
          and(
            eq(scheduledOutreachMessages.id, input.messageId),
            eq(scheduledOutreachMessages.tenantId, input.tenantId),
            eq(scheduledOutreachMessages.operatorId, input.operatorId)
          )
        )
        .for("update");

      if (!existing) {
        throw new Error(
          `Scheduled message not found or unauthorized for operator: ${input.messageId}`
        );
      }

      if (existing.status !== "pending" && existing.status !== "awaiting_sender_setup") {
        throw new Error(
          `Cannot edit message with status "${existing.status}". Only pending or awaiting sender setup drafts can be edited.`
        );
      }

      if (existing.leasedUntil && existing.leasedUntil.getTime() > now.getTime()) {
        throw new Error("Cannot edit message while actively leased by worker");
      }

      if (
        input.expectedRevisionCount !== undefined &&
        existing.revisionCount !== input.expectedRevisionCount
      ) {
        throw new Error(
          `Revision conflict: draft has been modified by another operator (expected revision ${input.expectedRevisionCount}, current is ${existing.revisionCount})`
        );
      }

      const nextRevision = existing.revisionCount + 1;

      const result = await tx
        .update(scheduledOutreachMessages)
        .set({
          currentMessageBody: trimmedBody,
          revisionCount: nextRevision,
          updatedAt: now,
        })
        .where(
          and(
            eq(scheduledOutreachMessages.id, input.messageId),
            eq(scheduledOutreachMessages.tenantId, input.tenantId),
            eq(scheduledOutreachMessages.operatorId, input.operatorId),
            eq(scheduledOutreachMessages.revisionCount, existing.revisionCount),
            or(
              eq(scheduledOutreachMessages.status, "pending"),
              eq(scheduledOutreachMessages.status, "awaiting_sender_setup")
            )
          )
        );

      if (affectedRows(result) === 0) {
        throw new Error("Concurrent edit detected: revision was modified by another operation");
      }

      await tx.insert(scheduledOutreachRevisions).values({
        id: `sor_${randomUUID()}`,
        outreachMessageId: input.messageId,
        tenantId: input.tenantId,
        revisionNumber: nextRevision,
        messageBody: trimmedBody,
        editedBy: input.operatorId,
        reason: input.reason ?? "Operator draft edit",
        createdAt: now,
      });

      return {
        ...existing,
        currentMessageBody: trimmedBody,
        revisionCount: nextRevision,
        updatedAt: now,
      };
    });
  }

  // Unit-test in-memory mode only
  const mem = testMemoryMessages.get(input.messageId);
  if (!mem || mem.tenantId !== input.tenantId || mem.operatorId !== input.operatorId) {
    throw new Error(
      `Scheduled message not found or unauthorized for operator: ${input.messageId}`
    );
  }

  if (mem.status !== "pending" && mem.status !== "awaiting_sender_setup") {
    throw new Error(`Cannot edit message with status "${mem.status}". Only pending or awaiting sender setup drafts can be edited.`);
  }

  if (
    input.expectedRevisionCount !== undefined &&
    mem.revisionCount !== input.expectedRevisionCount
  ) {
    throw new Error(
      `Revision conflict: draft has been modified by another operator (expected revision ${input.expectedRevisionCount}, current is ${mem.revisionCount})`
    );
  }

  const nextRevision = mem.revisionCount + 1;
  const updated: ScheduledOutreachMessageRow = {
    ...mem,
    currentMessageBody: trimmedBody,
    revisionCount: nextRevision,
    updatedAt: now,
  };
  testMemoryMessages.set(input.messageId, updated);

  const revs = testMemoryRevisions.get(input.messageId) ?? [];
  revs.push({
    id: `sor_${randomUUID()}`,
    outreachMessageId: input.messageId,
    tenantId: input.tenantId,
    revisionNumber: nextRevision,
    messageBody: trimmedBody,
    editedBy: input.operatorId,
    reason: input.reason ?? "Operator draft edit",
    createdAt: now,
  });
  testMemoryRevisions.set(input.messageId, revs);

  return updated;
}

/**
 * Reschedule a pending outreach draft to a new future time.
 * Concurrency-safe: atomically updates only if status is still 'pending' and unleased.
 */
export async function rescheduleOutreachDraft(
  input: RescheduleOutreachInput
): Promise<ScheduledOutreachMessageRow> {
  const now = input.now ?? new Date();

  const db = await requireDb();
  if (db) {
    const [existing] = await db
      .select()
      .from(scheduledOutreachMessages)
      .where(
        and(
          eq(scheduledOutreachMessages.id, input.messageId),
          eq(scheduledOutreachMessages.tenantId, input.tenantId),
          eq(scheduledOutreachMessages.operatorId, input.operatorId)
        )
      );

    if (!existing) {
      throw new Error(
        `Scheduled message not found or unauthorized for operator: ${input.messageId}`
      );
    }

    if (existing.status !== "pending" && existing.status !== "awaiting_sender_setup") {
      throw new Error(
        `Cannot reschedule message with status "${existing.status}". Only pending or awaiting sender setup drafts can be rescheduled.`
      );
    }

    const targetTz = input.timezone ?? existing.timezone;
    const newScheduledFor = normalizeScheduledForUtc(
      input.newScheduledFor,
      targetTz,
      input.dstAmbiguityChoice
    );

    if (newScheduledFor.getTime() <= now.getTime()) {
      throw new Error("New scheduled send time must be in the future");
    }

    const result = await db
      .update(scheduledOutreachMessages)
      .set({
        scheduledFor: newScheduledFor,
        timezone: targetTz,
        status: "pending",
        deliveryIntent: "scheduled",
        updatedAt: now,
      })
      .where(
        and(
          eq(scheduledOutreachMessages.id, input.messageId),
          eq(scheduledOutreachMessages.tenantId, input.tenantId),
          eq(scheduledOutreachMessages.operatorId, input.operatorId),
          or(
            eq(scheduledOutreachMessages.status, "pending"),
            eq(scheduledOutreachMessages.status, "awaiting_sender_setup")
          ),
          or(
            isNull(scheduledOutreachMessages.leasedUntil),
            lt(scheduledOutreachMessages.leasedUntil, now)
          )
        )
      );

    if (affectedRows(result) === 0) {
      throw new Error("Failed to reschedule draft: message is currently leased or was already dispatched");
    }

    return {
      ...existing,
      scheduledFor: newScheduledFor,
      timezone: targetTz,
      status: "pending",
      deliveryIntent: "scheduled",
      updatedAt: now,
    };
  }

  // Unit-test in-memory mode only
  const mem = testMemoryMessages.get(input.messageId);
  if (!mem || mem.tenantId !== input.tenantId || mem.operatorId !== input.operatorId) {
    throw new Error(
      `Scheduled message not found or unauthorized for operator: ${input.messageId}`
    );
  }

  if (mem.status !== "pending" && mem.status !== "awaiting_sender_setup") {
    throw new Error(`Cannot reschedule message with status "${mem.status}". Only pending or awaiting sender setup drafts can be rescheduled.`);
  }

  const targetTz = input.timezone ?? mem.timezone;
  const newScheduledFor = normalizeScheduledForUtc(
    input.newScheduledFor,
    targetTz,
    input.dstAmbiguityChoice
  );
  if (newScheduledFor.getTime() <= now.getTime()) {
    throw new Error("New scheduled send time must be in the future");
  }

  const updated: ScheduledOutreachMessageRow = {
    ...mem,
    scheduledFor: newScheduledFor,
    timezone: targetTz,
    status: "pending",
    deliveryIntent: "scheduled",
    updatedAt: now,
  };
  testMemoryMessages.set(input.messageId, updated);
  return updated;
}

/**
 * Cancel a pending scheduled outreach draft, reliably preventing unclaimed workers from sending it.
 * Concurrency-safe: prohibits cancelling actively claimed, attempted, or dispatched messages.
 */
export async function cancelScheduledOutreachDraft(
  input: CancelScheduledOutreachInput
): Promise<ScheduledOutreachMessageRow> {
  const now = input.now ?? new Date();

  const db = await requireDb();
  if (db) {
    const [existing] = await db
      .select()
      .from(scheduledOutreachMessages)
      .where(
        and(
          eq(scheduledOutreachMessages.id, input.messageId),
          eq(scheduledOutreachMessages.tenantId, input.tenantId),
          eq(scheduledOutreachMessages.operatorId, input.operatorId)
        )
      );

    if (!existing) {
      throw new Error(
        `Scheduled message not found or unauthorized for operator: ${input.messageId}`
      );
    }

    if (existing.status === "dispatched") {
      throw new Error("Cannot cancel a message that has already been dispatched");
    }

    if (existing.dispatchAttemptedAt) {
      throw new Error("Cannot cancel message: an external dispatch attempt has already been initiated");
    }

    if (existing.status === "claimed" && existing.leasedUntil && existing.leasedUntil.getTime() > now.getTime()) {
      throw new Error("Cannot cancel message: draft is currently claimed by active dispatch worker");
    }

    const result = await db
      .update(scheduledOutreachMessages)
      .set({
        status: "cancelled",
        cancelledAt: now,
        cancellationReason: input.reason.trim(),
        leaseHolder: null,
        leasedUntil: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(scheduledOutreachMessages.id, input.messageId),
          eq(scheduledOutreachMessages.tenantId, input.tenantId),
          eq(scheduledOutreachMessages.operatorId, input.operatorId),
          isNull(scheduledOutreachMessages.dispatchAttemptedAt),
          or(
            eq(scheduledOutreachMessages.status, "pending"),
            eq(scheduledOutreachMessages.status, "awaiting_sender_setup"),
            and(
              eq(scheduledOutreachMessages.status, "claimed"),
              isNull(scheduledOutreachMessages.dispatchedAt),
              lt(scheduledOutreachMessages.leasedUntil, now)
            )
          ),
          or(
            isNull(scheduledOutreachMessages.leasedUntil),
            lt(scheduledOutreachMessages.leasedUntil, now)
          )
        )
      );

    if (affectedRows(result) === 0) {
      throw new Error(
        "Cannot cancel message: draft is not in pending state or is currently leased by an active worker"
      );
    }

    return {
      ...existing,
      status: "cancelled",
      cancelledAt: now,
      cancellationReason: input.reason.trim(),
      leaseHolder: null,
      leasedUntil: null,
      updatedAt: now,
    };
  }

  // Unit-test in-memory mode only
  const mem = testMemoryMessages.get(input.messageId);
  if (!mem || mem.tenantId !== input.tenantId || mem.operatorId !== input.operatorId) {
    throw new Error(
      `Scheduled message not found or unauthorized for operator: ${input.messageId}`
    );
  }

  if (mem.status === "dispatched") {
    throw new Error("Cannot cancel a message that has already been dispatched");
  }

  if (mem.dispatchAttemptedAt) {
    throw new Error("Cannot cancel message: an external dispatch attempt has already been initiated");
  }

  if (mem.status === "claimed" && mem.leasedUntil && mem.leasedUntil.getTime() > now.getTime()) {
    throw new Error("Cannot cancel message: draft is currently claimed by active dispatch worker");
  }

  const updated: ScheduledOutreachMessageRow = {
    ...mem,
    status: "cancelled",
    cancelledAt: now,
    cancellationReason: input.reason.trim(),
    leaseHolder: null,
    leasedUntil: null,
    updatedAt: now,
  };
  testMemoryMessages.set(input.messageId, updated);
  return updated;
}

/**
 * Acquire concurrency-safe leases on due scheduled messages.
 * Only messages whose scheduledFor <= now AND dispatchedAt IS NULL can be claimed:
 * - Pending messages with no active lease
 * - Recoverable claimed messages whose previous worker lease expired before dispatch AND no dispatch attempt was ever initiated
 *
 * CRITICAL SAFETY FENCE:
 * If a worker crashed after initiating an external attempt (dispatchAttemptedAt IS NOT NULL),
 * that row's outcome is ambiguous. It MUST NEVER be automatically re-claimed by a worker,
 * preventing duplicate text messages to customers.
 */
export async function claimDueOutreachLeases(
  input: ClaimDueOutreachLeaseInput
): Promise<ScheduledOutreachMessageRow[]> {
  const now = input.now ?? new Date();
  const leaseDurationMs = input.leaseDurationMs ?? 60_000;
  const leasedUntil = new Date(now.getTime() + leaseDurationMs);
  const limit = input.limit ?? 10;

  const db = await requireDb();
  if (db) {
    const candidates = await db
      .select()
      .from(scheduledOutreachMessages)
      .where(
        and(
          lte(scheduledOutreachMessages.scheduledFor, now),
          isNull(scheduledOutreachMessages.dispatchedAt),
          isNull(scheduledOutreachMessages.cancelledAt),
          isNull(scheduledOutreachMessages.dispatchAttemptedAt), // Never reclaim if attempt initiated!
          or(
            and(
              eq(scheduledOutreachMessages.status, "pending"),
              or(
                isNull(scheduledOutreachMessages.leasedUntil),
                lt(scheduledOutreachMessages.leasedUntil, now)
              )
            ),
            and(
              eq(scheduledOutreachMessages.status, "claimed"),
              lt(scheduledOutreachMessages.leasedUntil, now)
            )
          )
        )
      )
      .limit(limit);

    const claimed: ScheduledOutreachMessageRow[] = [];

    for (const candidate of candidates) {
      const result = await db
        .update(scheduledOutreachMessages)
        .set({
          status: "claimed",
          leaseHolder: input.leaseHolder,
          leasedUntil,
          updatedAt: now,
        })
        .where(
          and(
            eq(scheduledOutreachMessages.id, candidate.id),
            lte(scheduledOutreachMessages.scheduledFor, now),
            isNull(scheduledOutreachMessages.dispatchedAt),
            isNull(scheduledOutreachMessages.cancelledAt),
            isNull(scheduledOutreachMessages.dispatchAttemptedAt),
            or(
              and(
                eq(scheduledOutreachMessages.status, "pending"),
                or(
                  isNull(scheduledOutreachMessages.leasedUntil),
                  lt(scheduledOutreachMessages.leasedUntil, now)
                )
              ),
              and(
                eq(scheduledOutreachMessages.status, "claimed"),
                lt(scheduledOutreachMessages.leasedUntil, now)
              )
            )
          )
        );

      if (affectedRows(result) > 0) {
        claimed.push({
          ...candidate,
          status: "claimed",
          leaseHolder: input.leaseHolder,
          leasedUntil,
          dispatchAttemptedAt: null,
          updatedAt: now,
        });
      }
    }

    return claimed;
  }

  // Unit-test in-memory mode only
  const claimed: ScheduledOutreachMessageRow[] = [];
  for (const [id, msg] of testMemoryMessages.entries()) {
    const isDue = msg.scheduledFor.getTime() <= now.getTime();
    const isNotDispatched = !msg.dispatchedAt;
    const isNotCancelled = !msg.cancelledAt;
    const isNoAttempt = !msg.dispatchAttemptedAt;
    const isPendingUnleased =
      msg.status === "pending" && (!msg.leasedUntil || msg.leasedUntil.getTime() < now.getTime());
    const isClaimedExpired =
      msg.status === "claimed" && msg.leasedUntil && msg.leasedUntil.getTime() < now.getTime();

    if (isDue && isNotDispatched && isNotCancelled && isNoAttempt && (isPendingUnleased || isClaimedExpired)) {
      const updated: ScheduledOutreachMessageRow = {
        ...msg,
        status: "claimed",
        leaseHolder: input.leaseHolder,
        leasedUntil,
        updatedAt: now,
      };
      testMemoryMessages.set(id, updated);
      claimed.push(updated);
      if (claimed.length >= limit) break;
    }
  }

  return claimed;
}

/**
 * SEND EARLY action:
 * In Phase 1, the Google Messages paired session bridge is not yet connected.
 * Unless a testSenderAdapter is explicitly injected in automated tests, this function
 * ALWAYS returns { success: false, status: "awaiting_sender_setup" } without mutating
 * the database row away from 'pending'.
 *
 * When a testSenderAdapter is present:
 * 1. Transactionally acquire the lease claim FIRST with atomic CAS and record attempt intent.
 * 2. Only invoke the test adapter AFTER the row is durable fenced against competing workers.
 * 3. Commit terminal dispatched state upon success, or failed state upon error.
 */
export async function sendEarlyOutreachDraft(
  input: SendEarlyOutreachInput
): Promise<{
  success: boolean;
  status: "dispatched" | "awaiting_sender_setup";
  message: ScheduledOutreachMessageRow;
  evidenceName: string;
}> {
  const now = input.now ?? new Date();
  const db = await requireDb();

  let existing: ScheduledOutreachMessageRow | null = null;

  if (db) {
    const [row] = await db
      .select()
      .from(scheduledOutreachMessages)
      .where(
        and(
          eq(scheduledOutreachMessages.id, input.messageId),
          eq(scheduledOutreachMessages.tenantId, input.tenantId),
          eq(scheduledOutreachMessages.operatorId, input.operatorId)
        )
      );
    existing = row ?? null;
  } else {
    existing = testMemoryMessages.get(input.messageId) ?? null;
  }

  if (
    !existing ||
    existing.tenantId !== input.tenantId ||
    existing.operatorId !== input.operatorId
  ) {
    throw new Error(
      `Scheduled message not found or unauthorized for operator: ${input.messageId}`
    );
  }

  if (existing.status !== "pending") {
    throw new Error(
      `Cannot send early: message status is "${existing.status}". Only pending messages can be sent early.`
    );
  }

  // Final G14 pre-dispatch re-validation: re-resolve customer permissions
  const consent = await checkCommunicationPermission({
    tenantId: input.tenantId,
    subjectType: "customer",
    subjectId: existing.customerId,
    channel: "sms",
    now,
  });

  if (!consent.allowed) {
    await cancelScheduledOutreachDraft({
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      messageId: input.messageId,
      reason: `Pre-send permission check failed: ${consent.reason}`,
      now,
    });
    throw new Error(`Customer is no longer eligible: ${consent.reason}`);
  }

  // If a test adapter is injected (automated test only), simulate verified dispatch
  if (input.testSenderAdapter) {
    const leaseDurationMs = 60_000;
    const leasedUntil = new Date(now.getTime() + leaseDurationMs);

    // 1. Transactionally acquire lease claim and mark attempt initiation BEFORE calling adapter
    if (db) {
      const claimResult = await db
        .update(scheduledOutreachMessages)
        .set({
          status: "claimed",
          leaseHolder: input.leaseHolder,
          leasedUntil,
          dispatchAttemptedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(scheduledOutreachMessages.id, existing.id),
            eq(scheduledOutreachMessages.tenantId, input.tenantId),
            eq(scheduledOutreachMessages.operatorId, input.operatorId),
            eq(scheduledOutreachMessages.status, "pending"),
            isNull(scheduledOutreachMessages.dispatchedAt),
            isNull(scheduledOutreachMessages.dispatchAttemptedAt),
            or(
              isNull(scheduledOutreachMessages.leasedUntil),
              lt(scheduledOutreachMessages.leasedUntil, now)
            )
          )
        );

      if (affectedRows(claimResult) === 0) {
        throw new Error(
          "Send Early failed: draft was claimed, dispatched, or already attempted by another worker"
        );
      }
    } else {
      if (existing.status !== "pending" || existing.dispatchAttemptedAt) {
        throw new Error(
          "Send Early failed: draft was claimed, dispatched, or already attempted by another worker"
        );
      }
      existing.status = "claimed";
      existing.leaseHolder = input.leaseHolder;
      existing.leasedUntil = leasedUntil;
      existing.dispatchAttemptedAt = now;
    }

    // 2. Invoke the external test adapter with lease securely held
    let sendResult: { externalMessageId: string; evidenceName?: string };
    try {
      sendResult = await input.testSenderAdapter.send({
        to: existing.recipientPhone,
        body: existing.currentMessageBody,
        messageId: existing.id,
      });
    } catch (err) {
      const failureReason = err instanceof Error ? err.message : String(err);
      if (db) {
        await db
          .update(scheduledOutreachMessages)
          .set({
            status: "failed",
            failureReason,
            updatedAt: now,
          })
          .where(eq(scheduledOutreachMessages.id, existing.id));
      } else {
        existing.status = "failed";
        existing.failureReason = failureReason;
      }
      throw err;
    }

    // 3. Mark terminal dispatched state
    if (db) {
      await db
        .update(scheduledOutreachMessages)
        .set({
          status: "dispatched",
          dispatchedAt: now,
          externalMessageId: sendResult.externalMessageId,
          updatedAt: now,
        })
        .where(
          and(
            eq(scheduledOutreachMessages.id, existing.id),
            eq(scheduledOutreachMessages.leaseHolder, input.leaseHolder)
          )
        );
    }

    const updated: ScheduledOutreachMessageRow = {
      ...existing,
      status: "dispatched",
      dispatchedAt: now,
      externalMessageId: sendResult.externalMessageId,
      leaseHolder: input.leaseHolder,
      dispatchAttemptedAt: now,
      updatedAt: now,
    };

    if (!db) {
      testMemoryMessages.set(existing.id, updated);
    }

    return {
      success: true,
      status: "dispatched",
      message: updated,
      evidenceName: sendResult.evidenceName ?? "personal_android_dispatched",
    };
  }

  // Phase 1 production path: No paired phone yet.
  // Non-destructive: message remains pending and editable in outbox!
  return {
    success: false,
    status: "awaiting_sender_setup",
    message: existing,
    evidenceName: "awaiting_sender_setup",
  };
}

/**
 * Lists scheduled outreach messages for a tenant, optionally filtered by status or operator.
 */
export async function listScheduledOutreachMessages(input: {
  tenantId: string;
  operatorId?: string;
  status?: string;
  limit?: number;
}): Promise<ScheduledOutreachMessageRow[]> {
  const limit = input.limit ?? 50;
  const db = await requireDb();

  if (db) {
    const conditions = [eq(scheduledOutreachMessages.tenantId, input.tenantId)];
    if (input.status) {
      conditions.push(eq(scheduledOutreachMessages.status, input.status as any));
    }
    if (input.operatorId) {
      conditions.push(eq(scheduledOutreachMessages.operatorId, input.operatorId));
    }

    const query = db
      .select()
      .from(scheduledOutreachMessages)
      .where(and(...conditions))
      .orderBy(desc(scheduledOutreachMessages.scheduledFor))
      .limit(limit);

    return await query;
  }

  // Unit-test in-memory mode only
  const list: ScheduledOutreachMessageRow[] = [];
  for (const row of testMemoryMessages.values()) {
    if (row.tenantId === input.tenantId) {
      if (input.status && row.status !== input.status) continue;
      if (input.operatorId && row.operatorId !== input.operatorId) continue;
      list.push(row);
    }
  }

  return list
    .sort((a, b) => b.scheduledFor.getTime() - a.scheduledFor.getTime())
    .slice(0, limit);
}

/**
 * Retrieves the complete revision history for a scheduled outreach draft.
 * Verifies that the draft belongs to the requesting tenant and (when provided) operator.
 */
export async function getScheduledOutreachRevisions(input: {
  tenantId: string;
  messageId: string;
  operatorId?: string;
}) {
  const db = await requireDb();
  if (db) {
    if (input.operatorId) {
      const [msg] = await db
        .select({ id: scheduledOutreachMessages.id })
        .from(scheduledOutreachMessages)
        .where(
          and(
            eq(scheduledOutreachMessages.id, input.messageId),
            eq(scheduledOutreachMessages.tenantId, input.tenantId),
            eq(scheduledOutreachMessages.operatorId, input.operatorId)
          )
        );
      if (!msg) {
        throw new Error(
          `Scheduled message not found or unauthorized for operator: ${input.messageId}`
        );
      }
    }

    return await db
      .select()
      .from(scheduledOutreachRevisions)
      .where(
        and(
          eq(scheduledOutreachRevisions.outreachMessageId, input.messageId),
          eq(scheduledOutreachRevisions.tenantId, input.tenantId)
        )
      )
      .orderBy(desc(scheduledOutreachRevisions.revisionNumber));
  }

  // Unit-test in-memory mode only
  if (input.operatorId) {
    const msg = testMemoryMessages.get(input.messageId);
    if (!msg || msg.tenantId !== input.tenantId || msg.operatorId !== input.operatorId) {
      throw new Error(
        `Scheduled message not found or unauthorized for operator: ${input.messageId}`
      );
    }
  }

  return (testMemoryRevisions.get(input.messageId) ?? []).sort(
    (a, b) => b.revisionNumber - a.revisionNumber
  );
}

export function _resetScheduledOutreachMemoryStore() {
  testMemoryMessages.clear();
  testMemoryRevisions.clear();
}
