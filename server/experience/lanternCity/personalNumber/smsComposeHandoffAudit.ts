/**
 * Durable operator-action audit for an SMS compose handoff.
 * Scoped to tenant, operator, message, and revision. The approved body is stored
 * only as a fingerprint, so a later edit does not inherit the earlier handoff.
 * This module does not update the outreach outbox and does not transmit.
 */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { smsComposeHandoffAudits } from "../../../../drizzle/schema";
import { getDb } from "../../../db";
import { ANDROID_DEVICE_SENDER } from "./androidDeviceSender";
import {
  SMS_COMPOSE_APPROVAL_CONFIRMATION,
  SMS_COMPOSE_REPORTED_SENT_CONFIRMATION,
  approvedBodyDigest,
  buildSmsComposeUri,
  composeHandoffLeavesOutboxUndispatched,
  handoffCoversRevision,
  projectHandoffForRevision,
  type OutboxDispatchSnapshot,
  type SmsComposeClientKind,
  type SmsComposeHandoffEvent,
  type SmsComposeHandoffProjection,
  type SmsComposeSurface,
  type SmsComposeUriResult,
} from "./smsComposeHandoff";

const memory = new Map<string, SmsComposeHandoffEvent[]>();

function scopeKey(tenantId: string, operatorId: string): string {
  return `${tenantId}\u0000${operatorId}`;
}

export function _resetSmsComposeHandoffAudit(): void {
  memory.clear();
}

export type OpenSmsComposeHandoffInput = {
  tenantId: string;
  operatorId: string;
  messageId: string;
  revisionCount: number;
  approvedBody: string;
  recipientPhone: string;
  confirmation: string;
  clientKind: SmsComposeClientKind;
  surface: SmsComposeSurface;
  pageUrl?: string;
  origin?: string;
  outbox?: OutboxDispatchSnapshot | null;
};

export type OpenSmsComposeHandoffResult = SmsComposeUriResult & {
  state: SmsComposeHandoffProjection["state"];
  label: string;
  covers: boolean;
  verifiedSent: false;
  pose: "idle" | "wave";
  authorizedToTransmit: false;
  carrierReceipt: false;
  androidUnattendedStatus: typeof ANDROID_DEVICE_SENDER.status;
  outboxEffect: {
    dispatchedAt: null;
    externalMessageId: null;
    markedDispatched: false;
    statusWritten: null;
  };
};

function assertScope(input: { tenantId: string; operatorId: string; messageId: string; revisionCount: number }) {
  if (!input.tenantId.trim() || !input.operatorId.trim() || !input.messageId.trim()) {
    throw new Error("Tenant, operator, and message are required for an SMS compose handoff.");
  }
  if (!Number.isInteger(input.revisionCount) || input.revisionCount < 1) {
    throw new Error("A message revision is required for an SMS compose handoff.");
  }
}

function outboxEffectFor(row: OutboxDispatchSnapshot | null | undefined) {
  const snapshot = row ?? {
    status: "untouched",
    dispatchedAt: null,
    externalMessageId: null,
  };
  const effect = composeHandoffLeavesOutboxUndispatched(snapshot);
  return {
    dispatchedAt: effect.dispatchedAt,
    externalMessageId: effect.externalMessageId,
    markedDispatched: effect.markedDispatched,
    statusWritten: effect.statusWritten,
  };
}

async function listEvents(tenantId: string, operatorId: string): Promise<SmsComposeHandoffEvent[]> {
  const stored = await readDb(tenantId, operatorId);
  const local = memory.get(scopeKey(tenantId, operatorId)) ?? [];
  const byId = new Map<string, SmsComposeHandoffEvent>();
  for (const event of [...stored, ...local]) byId.set(event.id, event);
  return [...byId.values()];
}

export async function openApprovedSmsCompose(
  input: OpenSmsComposeHandoffInput
): Promise<OpenSmsComposeHandoffResult> {
  if (input.confirmation !== SMS_COMPOSE_APPROVAL_CONFIRMATION) {
    throw new Error("The exact message must be approved before the SMS app is opened.");
  }
  assertScope(input);
  const approvedBody = input.approvedBody.trim();
  if (!approvedBody) throw new Error("An approved message body is required.");
  if (approvedBody.length > 500) throw new Error("The approved message is too long to open in SMS.");

  const uri = buildSmsComposeUri({
    recipientPhone: input.recipientPhone,
    body: approvedBody,
    clientKind: input.clientKind,
    pageUrl: input.pageUrl,
    origin: input.origin,
  });
  const bodyDigest = approvedBodyDigest(approvedBody);
  const existing = await listEvents(input.tenantId, input.operatorId);
  const before = projectHandoffForRevision(existing, {
    messageId: input.messageId,
    revisionCount: input.revisionCount,
    bodyDigest,
  });
  const invokedAt = new Date().toISOString();
  if (before.state === "draft") {
    await append({
      id: `sch_${randomUUID()}`,
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      messageId: input.messageId,
      revisionCount: input.revisionCount,
      bodyDigest,
      handoffState: "approved",
      surface: input.surface,
      invokedAt,
    });
  }
  await append({
    id: `sch_${randomUUID()}`,
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    messageId: input.messageId,
    revisionCount: input.revisionCount,
    bodyDigest,
    handoffState: "compose_opened",
    surface: input.surface,
    invokedAt,
  });
  const after = projectHandoffForRevision(await listEvents(input.tenantId, input.operatorId), {
    messageId: input.messageId,
    revisionCount: input.revisionCount,
    bodyDigest,
  });
  return {
    ...uri,
    state: after.state,
    label: after.label,
    covers: after.covers,
    verifiedSent: false,
    pose: after.pose,
    authorizedToTransmit: false,
    carrierReceipt: false,
    androidUnattendedStatus: ANDROID_DEVICE_SENDER.status,
    outboxEffect: outboxEffectFor(input.outbox),
  };
}

export async function reportSmsComposeOperatorSent(input: {
  tenantId: string;
  operatorId: string;
  messageId: string;
  revisionCount: number;
  approvedBody: string;
  confirmation: string;
  surface: SmsComposeSurface;
  outbox?: OutboxDispatchSnapshot | null;
}): Promise<OpenSmsComposeHandoffResult> {
  if (input.confirmation !== SMS_COMPOSE_REPORTED_SENT_CONFIRMATION) {
    throw new Error("An operator report must confirm this exact approved message.");
  }
  assertScope(input);
  const approvedBody = input.approvedBody.trim();
  if (!approvedBody) throw new Error("An approved message body is required.");
  const bodyDigest = approvedBodyDigest(approvedBody);
  const query = {
    messageId: input.messageId,
    revisionCount: input.revisionCount,
    bodyDigest,
  };
  const current = projectHandoffForRevision(await listEvents(input.tenantId, input.operatorId), query);
  if (current.state !== "compose_opened" && current.state !== "operator_reported_sent") {
    throw new Error("This revision has no compose handoff to report against.");
  }
  if (current.state === "compose_opened") {
    await append({
      id: `sch_${randomUUID()}`,
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      messageId: input.messageId,
      revisionCount: input.revisionCount,
      bodyDigest,
      handoffState: "operator_reported_sent",
      surface: input.surface,
      invokedAt: new Date().toISOString(),
    });
  }
  const after = projectHandoffForRevision(await listEvents(input.tenantId, input.operatorId), query);
  return {
    kind: "operator_report",
    uri: null,
    fallbackUri: null,
    bodyPrefillClaimed: false,
    prefillClaim: "not_prefilled",
    copyBody: null,
    copyLabel: null,
    continuationHref: null,
    continuationLabel: null,
    actionSendto: false,
    messagesPackage: null,
    state: after.state,
    label: after.label,
    covers: after.covers,
    verifiedSent: false,
    pose: after.pose,
    authorizedToTransmit: false,
    carrierReceipt: false,
    androidUnattendedStatus: ANDROID_DEVICE_SENDER.status,
    outboxEffect: outboxEffectFor(input.outbox),
  };
}

export async function smsComposeHandoffSnapshot(input: {
  tenantId: string;
  operatorId: string;
  items: Array<{ messageId: string; revisionCount: number; approvedBody: string }>;
}): Promise<SmsComposeHandoffProjection[]> {
  const events = await listEvents(input.tenantId, input.operatorId);
  return input.items.map((item) =>
    projectHandoffForRevision(events, {
      messageId: item.messageId,
      revisionCount: item.revisionCount,
      bodyDigest: approvedBodyDigest(item.approvedBody.trim()),
    })
  );
}

export async function smsComposeHandoffEventsForOperator(input: {
  tenantId: string;
  operatorId: string;
}): Promise<SmsComposeHandoffEvent[]> {
  return listEvents(input.tenantId, input.operatorId);
}

export { handoffCoversRevision };

async function append(event: SmsComposeHandoffEvent): Promise<void> {
  const key = scopeKey(event.tenantId, event.operatorId);
  const list = memory.get(key) ?? [];
  list.push(event);
  memory.set(key, list);
  try {
    await persist(event);
  } catch (error) {
    list.pop();
    if (list.length === 0) memory.delete(key);
    throw error;
  }
}

async function persist(event: SmsComposeHandoffEvent): Promise<void> {
  if (process.env.NODE_ENV === "test" && !process.env.ALLOW_TEST_DB) return;
  const db = await getDb();
  if (!db) throw new Error("Compose handoff audit store is unavailable.");
  try {
    await db.insert(smsComposeHandoffAudits).values({
      id: event.id,
      tenantId: event.tenantId,
      operatorId: event.operatorId,
      messageId: event.messageId,
      revisionCount: event.revisionCount,
      bodyDigest: event.bodyDigest,
      handoffState: event.handoffState,
      surface: event.surface,
      invokedAt: new Date(event.invokedAt),
    });
  } catch {
    console.error("[smsComposeHandoff] audit row was not stored");
    throw new Error("Compose handoff audit store failed.");
  }
}

async function readDb(tenantId: string, operatorId: string): Promise<SmsComposeHandoffEvent[]> {
  if (process.env.NODE_ENV === "test" && !process.env.ALLOW_TEST_DB) return [];
  const db = await getDb();
  if (!db) {
    if (process.env.NODE_ENV === "test") return [];
    throw new Error("Compose handoff audit store is unavailable.");
  }
  const rows = await db
    .select()
    .from(smsComposeHandoffAudits)
    .where(
      and(eq(smsComposeHandoffAudits.tenantId, tenantId), eq(smsComposeHandoffAudits.operatorId, operatorId))
    );
  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenantId,
    operatorId: row.operatorId,
    messageId: row.messageId,
    revisionCount: row.revisionCount,
    bodyDigest: row.bodyDigest,
    handoffState: row.handoffState as SmsComposeHandoffEvent["handoffState"],
    surface: row.surface as SmsComposeSurface,
    invokedAt: row.invokedAt.toISOString(),
  }));
}
