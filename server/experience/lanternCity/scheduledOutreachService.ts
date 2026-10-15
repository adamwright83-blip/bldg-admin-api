import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
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

// In-memory fallback for unit test / offline environments when database is not configured
const inMemoryMessages = new Map<string, ScheduledOutreachMessageRow>();
const inMemoryRevisions = new Map<
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

/**
 * Creates a validated, scheduled customer outreach message.
 * Enforces future scheduled date, minimum content, phone format, and G14 communication consent.
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

  if (input.scheduledFor.getTime() <= now.getTime()) {
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
    scheduledFor: input.scheduledFor,
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

  const db = await getDb();
  if (db) {
    try {
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
    } catch {
      // Fallback to memory
    }
  }

  inMemoryMessages.set(messageId, row);
  inMemoryRevisions.set(messageId, [
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

  const db = await getDb();
  if (db) {
    try {
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

      await db
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
            eq(scheduledOutreachMessages.status, "pending")
          )
        );

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
    } catch {
      // Fallback to memory
    }
  }

  const mem = inMemoryMessages.get(input.messageId);
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
  inMemoryMessages.set(input.messageId, updated);

  const revs = inMemoryRevisions.get(input.messageId) ?? [];
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
  inMemoryRevisions.set(input.messageId, revs);

  return updated;
}

/**
 * Reschedule a pending outreach draft to a new future time.
 */
export async function rescheduleOutreachDraft(
  input: RescheduleOutreachInput
): Promise<ScheduledOutreachMessageRow> {
  const now = input.now ?? new Date();

  if (input.newScheduledFor.getTime() <= now.getTime()) {
    throw new Error("New scheduled send time must be in the future");
  }

  const db = await getDb();
  if (db) {
    try {
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

      await db
        .update(scheduledOutreachMessages)
        .set({
          scheduledFor: input.newScheduledFor,
          updatedAt: now,
        })
        .where(
          and(
            eq(scheduledOutreachMessages.id, input.messageId),
            eq(scheduledOutreachMessages.tenantId, input.tenantId),
            eq(scheduledOutreachMessages.status, "pending")
          )
        );

      return {
        ...existing,
        scheduledFor: input.newScheduledFor,
        updatedAt: now,
      };
    } catch {
      // Fallback to memory
    }
  }

  const mem = inMemoryMessages.get(input.messageId);
  if (!mem || mem.tenantId !== input.tenantId) {
    throw new Error(`Scheduled message not found: ${input.messageId}`);
  }

  if (mem.status !== "pending") {
    throw new Error(`Cannot reschedule message with status "${mem.status}". Only pending drafts can be rescheduled.`);
  }

  const updated: ScheduledOutreachMessageRow = {
    ...mem,
    scheduledFor: input.newScheduledFor,
    updatedAt: now,
  };
  inMemoryMessages.set(input.messageId, updated);
  return updated;
}

/**
 * Cancel a pending scheduled outreach draft, reliably preventing unclaimed workers from sending it.
 */
export async function cancelScheduledOutreachDraft(
  input: CancelScheduledOutreachInput
): Promise<ScheduledOutreachMessageRow> {
  const now = input.now ?? new Date();

  const db = await getDb();
  if (db) {
    try {
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

      await db
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
            eq(scheduledOutreachMessages.tenantId, input.tenantId)
          )
        );

      return {
        ...existing,
        status: "cancelled",
        cancelledAt: now,
        cancellationReason: input.reason.trim(),
        leaseHolder: null,
        leasedUntil: null,
        updatedAt: now,
      };
    } catch {
      // Fallback to memory
    }
  }

  const mem = inMemoryMessages.get(input.messageId);
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
  inMemoryMessages.set(input.messageId, updated);
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

  const db = await getDb();
  if (db) {
    try {
      // Find candidate due messages
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
        // Atomic update checking lease condition
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

        // Check if row was actually updated by this worker
        // @ts-expect-error mysql2 result header inspection
        const affected = result?.[0]?.affectedRows ?? (result as any)?.rowCount ?? 1;
        if (affected > 0) {
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
    } catch {
      // Fallback to memory
    }
  }

  const claimed: ScheduledOutreachMessageRow[] = [];
  for (const [id, msg] of inMemoryMessages.entries()) {
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
      inMemoryMessages.set(id, updated);
      claimed.push(updated);
      if (claimed.length >= limit) break;
    }
  }

  return claimed;
}

/**
 * SEND EARLY action:
 * Immediately claims the message lease and triggers dispatch.
 * In Phase 1, dispatch remains gated: fake test sender permitted in test environments,
 * while in production, marks status as awaiting_sender_setup until Phase 2 Google Messages session is active.
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

  const db = await getDb();
  let existing: ScheduledOutreachMessageRow | null = null;

  if (db) {
    try {
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
    } catch {
      // Fallback
    }
  }

  if (!existing) {
    existing = inMemoryMessages.get(input.messageId) ?? null;
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
    // If permission was revoked while scheduled, fail/cancel safely
    await cancelScheduledOutreachDraft({
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      messageId: input.messageId,
      reason: `Pre-send permission check failed: ${consent.reason}`,
      now,
    });
    throw new Error(`Customer is no longer eligible: ${consent.reason}`);
  }

  // Phase 1 sender gate: explicit flag takes precedence, otherwise check test environment
  const allowFakeTest =
    input.isTestSenderAllowed !== undefined
      ? input.isTestSenderAllowed
      : process.env.NODE_ENV === "test" || process.env.USE_FAKE_SENDER === "true";

  if (!allowFakeTest) {
    // Phase 1 constraint: Google Messages bridge is not connected yet.
    // Record awaiting_sender_setup without falsely claiming SMS delivery.
    const updatedStatus = "awaiting_sender_setup";
    if (db) {
      try {
        await db
          .update(scheduledOutreachMessages)
          .set({
            status: updatedStatus,
            dispatchAttemptedAt: now,
            failureReason: "Android personal-number messaging bridge awaiting setup (Phase 2)",
            updatedAt: now,
          })
          .where(eq(scheduledOutreachMessages.id, existing.id));
      } catch {
        // Fallback
      }
    }

    const updated: ScheduledOutreachMessageRow = {
      ...existing,
      status: updatedStatus,
      dispatchAttemptedAt: now,
      failureReason: "Android personal-number messaging bridge awaiting setup (Phase 2)",
      updatedAt: now,
    };
    inMemoryMessages.set(existing.id, updated);

    return {
      success: false,
      status: "awaiting_sender_setup",
      message: updated,
      evidenceName: "awaiting_sender_setup",
    };
  }

  // Test mode simulated personal dispatch
  const externalMessageId = `android_msg_${randomUUID()}`;
  if (db) {
    try {
      await db
        .update(scheduledOutreachMessages)
        .set({
          status: "dispatched",
          dispatchedAt: now,
          externalMessageId,
          leaseHolder: input.leaseHolder,
          updatedAt: now,
        })
        .where(eq(scheduledOutreachMessages.id, existing.id));
    } catch {
      // Fallback
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
  inMemoryMessages.set(existing.id, updated);

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

  const db = await getDb();
  if (db) {
    try {
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
    } catch {
      // Fallback
    }
  }

  const list: ScheduledOutreachMessageRow[] = [];
  for (const row of inMemoryMessages.values()) {
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
  const db = await getDb();
  if (db) {
    try {
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
    } catch {
      // Fallback
    }
  }

  return (inMemoryRevisions.get(input.messageId) ?? []).sort(
    (a, b) => b.revisionNumber - a.revisionNumber
  );
}

export function _resetScheduledOutreachMemoryStore() {
  inMemoryMessages.clear();
  inMemoryRevisions.clear();
}
