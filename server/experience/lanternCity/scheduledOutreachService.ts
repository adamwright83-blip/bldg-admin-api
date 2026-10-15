import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { fromZonedTime } from "date-fns-tz";
import {
  scheduledOutreachMessages,
  scheduledOutreachRevisions,
  type ScheduledOutreachMessageRow,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
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
  scheduledFor: Date;
  timezone?: string;
  slotId?: string;
  territoryId?: string;
  senderPhone?: string;
  allowImmediate?: boolean;
  now?: Date;
}

export interface EditScheduledOutreachInput {
  tenantId: string;
  operatorId: string;
  messageId: string;
  newMessageBody: string;
  reason?: string;
  now?: Date;
}

export interface RescheduleOutreachInput {
  tenantId: string;
  operatorId: string;
  messageId: string;
  newScheduledFor: Date;
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

export interface SendEarlyOutreachInput {
  tenantId: string;
  operatorId: string;
  messageId: string;
  leaseHolder: string;
  isTestSenderAllowed?: boolean;
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
 */
export function normalizeScheduledForUtc(inputTime: Date | string, timezone: string = "America/Los_Angeles"): Date {
  const dateObj = typeof inputTime === "string" ? new Date(inputTime) : inputTime;
  if (isNaN(dateObj.getTime())) {
    throw new Error(`Invalid scheduled date time: ${String(inputTime)}`);
  }

  // If provided as a string without timezone offset (e.g. YYYY-MM-DDTHH:mm:ss), interpret in target timezone
  if (typeof inputTime === "string" && !inputTime.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(inputTime)) {
    return fromZonedTime(inputTime, timezone);
  }

  return dateObj;
}

/**
 * Creates a validated, scheduled customer outreach message.
 * Enforces future scheduled date, minimum content, phone format, and G14 communication consent.
 * Durable MySQL persistence: never silently falls back to memory in production.
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

  const scheduledFor = normalizeScheduledForUtc(input.scheduledFor, timezone);

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
    throw new Error(`Outreach blocked by customer permission: ${consent.reason ?? "Opted out or frequency cap exceeded"}`);
  }

  const messageId = `som_${randomUUID()}`;
  const row: ScheduledOutreachMessageRow = {
    id: messageId,
    tenantId: input.tenantId,
    customerId: input.customerId,
    customerName: input.customerName,
    recipientPhone: normalizedPhone,
    senderPhone: input.senderPhone ?? null,
    originalSuggestedDraft: input.originalSuggestedDraft.trim(),
    currentMessageBody: trimmedBody,
    revisionCount: 1,
    scheduledFor,
    timezone,
    status: "pending",
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

  const db = await requireDb();
  if (db) {
    await db.insert(scheduledOutreachMessages).values(row);
    await db.insert(scheduledOutreachRevisions).values({
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
 * Concurrency-safe: atomically updates only if status is still 'pending'.
 * Increments revision count, preserves audit history, and replaces the pending version before dispatch.
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
    const [existing] = await db
      .select()
      .from(scheduledOutreachMessages)
      .where(
        and(
          eq(scheduledOutreachMessages.id, input.messageId),
          eq(scheduledOutreachMessages.tenantId, input.tenantId)
        )
      );

    if (!existing) {
      throw new Error(`Scheduled message not found: ${input.messageId}`);
    }

    if (existing.status !== "pending") {
      throw new Error(
        `Cannot edit message with status "${existing.status}". Only pending drafts can be edited.`
      );
    }

    const nextRevision = (existing.revisionCount ?? 1) + 1;

    // Concurrency fence: ensure message is STILL pending and not leased
    const result = await db
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
          eq(scheduledOutreachMessages.status, "pending"),
          or(
            isNull(scheduledOutreachMessages.leasedUntil),
            lt(scheduledOutreachMessages.leasedUntil, now)
          )
        )
      );

    if (affectedRows(result) === 0) {
      throw new Error("Failed to edit draft: message is currently leased or was already dispatched");
    }

    await db.insert(scheduledOutreachRevisions).values({
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
  }

  // Unit-test in-memory mode only
  const mem = testMemoryMessages.get(input.messageId);
  if (!mem || mem.tenantId !== input.tenantId) {
    throw new Error(`Scheduled message not found: ${input.messageId}`);
  }

  if (mem.status !== "pending") {
    throw new Error(`Cannot edit message with status "${mem.status}". Only pending drafts can be edited.`);
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
          eq(scheduledOutreachMessages.tenantId, input.tenantId)
        )
      );

    if (!existing) {
      throw new Error(`Scheduled message not found: ${input.messageId}`);
    }

    if (existing.status !== "pending") {
      throw new Error(
        `Cannot reschedule message with status "${existing.status}". Only pending drafts can be rescheduled.`
      );
    }

    const newScheduledFor = normalizeScheduledForUtc(input.newScheduledFor, existing.timezone);

    if (newScheduledFor.getTime() <= now.getTime()) {
      throw new Error("New scheduled send time must be in the future");
    }

    const result = await db
      .update(scheduledOutreachMessages)
      .set({
        scheduledFor: newScheduledFor,
        updatedAt: now,
      })
      .where(
        and(
          eq(scheduledOutreachMessages.id, input.messageId),
          eq(scheduledOutreachMessages.tenantId, input.tenantId),
          eq(scheduledOutreachMessages.status, "pending"),
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
      updatedAt: now,
    };
  }

  // Unit-test in-memory mode only
  const mem = testMemoryMessages.get(input.messageId);
  if (!mem || mem.tenantId !== input.tenantId) {
    throw new Error(`Scheduled message not found: ${input.messageId}`);
  }

  if (mem.status !== "pending") {
    throw new Error(`Cannot reschedule message with status "${mem.status}". Only pending drafts can be rescheduled.`);
  }

  const newScheduledFor = normalizeScheduledForUtc(input.newScheduledFor, mem.timezone);
  if (newScheduledFor.getTime() <= now.getTime()) {
    throw new Error("New scheduled send time must be in the future");
  }

  const updated: ScheduledOutreachMessageRow = {
    ...mem,
    scheduledFor: newScheduledFor,
    updatedAt: now,
  };
  testMemoryMessages.set(input.messageId, updated);
  return updated;
}

/**
 * Cancel a pending scheduled outreach draft, reliably preventing unclaimed workers from sending it.
 * Concurrency-safe: atomically cancels message if not already dispatched.
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
          eq(scheduledOutreachMessages.tenantId, input.tenantId)
        )
      );

    if (!existing) {
      throw new Error(`Scheduled message not found: ${input.messageId}`);
    }

    if (existing.status === "dispatched") {
      throw new Error("Cannot cancel a message that has already been dispatched");
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
          or(
            eq(scheduledOutreachMessages.status, "pending"),
            eq(scheduledOutreachMessages.status, "claimed"),
            eq(scheduledOutreachMessages.status, "awaiting_sender_setup")
          )
        )
      );

    if (affectedRows(result) === 0) {
      throw new Error("Cannot cancel message: already dispatched or in non-cancellable state");
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
  if (!mem || mem.tenantId !== input.tenantId) {
    throw new Error(`Scheduled message not found: ${input.messageId}`);
  }

  if (mem.status === "dispatched") {
    throw new Error("Cannot cancel a message that has already been dispatched");
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
 * Only messages with status 'pending' whose scheduledFor <= now AND (leasedUntil IS NULL or expired) can be claimed.
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
          eq(scheduledOutreachMessages.status, "pending"),
          lt(scheduledOutreachMessages.scheduledFor, now),
          or(
            isNull(scheduledOutreachMessages.leasedUntil),
            lt(scheduledOutreachMessages.leasedUntil, now)
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
          dispatchAttemptedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(scheduledOutreachMessages.id, candidate.id),
            eq(scheduledOutreachMessages.status, "pending"),
            or(
              isNull(scheduledOutreachMessages.leasedUntil),
              lt(scheduledOutreachMessages.leasedUntil, now)
            )
          )
        );

      if (affectedRows(result) > 0) {
        claimed.push({
          ...candidate,
          status: "claimed",
          leaseHolder: input.leaseHolder,
          leasedUntil,
          dispatchAttemptedAt: now,
          updatedAt: now,
        });
      }
    }

    return claimed;
  }

  // Unit-test in-memory mode only
  const claimed: ScheduledOutreachMessageRow[] = [];
  for (const [id, msg] of testMemoryMessages.entries()) {
    if (
      msg.status === "pending" &&
      msg.scheduledFor.getTime() <= now.getTime() &&
      (!msg.leasedUntil || msg.leasedUntil.getTime() < now.getTime())
    ) {
      const updated: ScheduledOutreachMessageRow = {
        ...msg,
        status: "claimed",
        leaseHolder: input.leaseHolder,
        leasedUntil,
        dispatchAttemptedAt: now,
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
 * Attempts immediate dispatch through personal-number connection.
 * Critical bugfix: Does NOT permanently mutate pending draft to awaiting_sender_setup.
 * If verified sender is not yet connected (Phase 1 constraint), the draft remains editable and scheduled in status 'pending',
 * returning an informational awaiting_sender_setup response without losing the ability to edit or reschedule.
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
          eq(scheduledOutreachMessages.tenantId, input.tenantId)
        )
      );
    existing = row ?? null;
  } else {
    existing = testMemoryMessages.get(input.messageId) ?? null;
  }

  if (!existing || existing.tenantId !== input.tenantId) {
    throw new Error(`Scheduled message not found: ${input.messageId}`);
  }

  if (existing.status !== "pending") {
    throw new Error(
      `Cannot send early: message status is "${existing.status}". Only pending messages can be sent early.`
    );
  }

  // Final G14 pre-dispatch re-validation
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

  // Phase 1 sender gate
  const allowFakeTest =
    input.isTestSenderAllowed !== undefined
      ? input.isTestSenderAllowed
      : process.env.NODE_ENV === "test" || process.env.USE_FAKE_SENDER === "true";

  if (!allowFakeTest) {
    // Non-destructive check: Do NOT mutate status away from 'pending'.
    // Draft remains scheduled and editable.
    return {
      success: false,
      status: "awaiting_sender_setup",
      message: existing,
      evidenceName: "awaiting_sender_setup",
    };
  }

  // Test mode simulated personal dispatch
  const externalMessageId = `android_msg_${randomUUID()}`;
  if (db) {
    const result = await db
      .update(scheduledOutreachMessages)
      .set({
        status: "dispatched",
        dispatchedAt: now,
        externalMessageId,
        leaseHolder: input.leaseHolder,
        updatedAt: now,
      })
      .where(
        and(
          eq(scheduledOutreachMessages.id, existing.id),
          eq(scheduledOutreachMessages.status, "pending"),
          or(
            isNull(scheduledOutreachMessages.leasedUntil),
            lt(scheduledOutreachMessages.leasedUntil, now)
          )
        )
      );

    if (affectedRows(result) === 0) {
      throw new Error("Send Early failed: draft was claimed or modified by another worker");
    }
  }

  const updated: ScheduledOutreachMessageRow = {
    ...existing,
    status: "dispatched",
    dispatchedAt: now,
    externalMessageId,
    leaseHolder: input.leaseHolder,
    updatedAt: now,
  };

  if (!db) {
    testMemoryMessages.set(existing.id, updated);
  }

  return {
    success: true,
    status: "dispatched",
    message: updated,
    evidenceName: "personal_number_dispatched",
  };
}

/**
 * List scheduled outreach messages for admin outbox.
 */
export async function listScheduledOutreachMessages(input: {
  tenantId: string;
  status?: string;
  limit?: number;
}): Promise<ScheduledOutreachMessageRow[]> {
  const limit = input.limit ?? 50;
  const db = await requireDb();

  if (db) {
    const query = db
      .select()
      .from(scheduledOutreachMessages)
      .where(
        input.status
          ? and(
              eq(scheduledOutreachMessages.tenantId, input.tenantId),
              eq(scheduledOutreachMessages.status, input.status as any)
            )
          : eq(scheduledOutreachMessages.tenantId, input.tenantId)
      )
      .orderBy(desc(scheduledOutreachMessages.scheduledFor))
      .limit(limit);

    return await query;
  }

  // Unit-test in-memory mode only
  const list: ScheduledOutreachMessageRow[] = [];
  for (const row of testMemoryMessages.values()) {
    if (row.tenantId === input.tenantId) {
      if (!input.status || row.status === input.status) {
        list.push(row);
      }
    }
  }

  list.sort((a, b) => b.scheduledFor.getTime() - a.scheduledFor.getTime());
  return list.slice(0, limit);
}

/**
 * Get revision history for a scheduled outreach message.
 */
export async function getScheduledOutreachRevisions(input: {
  tenantId: string;
  messageId: string;
}) {
  const db = await requireDb();
  if (db) {
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
  return (testMemoryRevisions.get(input.messageId) ?? []).sort(
    (a, b) => b.revisionNumber - a.revisionNumber
  );
}

export function _resetScheduledOutreachMemoryStore() {
  testMemoryMessages.clear();
  testMemoryRevisions.clear();
}
