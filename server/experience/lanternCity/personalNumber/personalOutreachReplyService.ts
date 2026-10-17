/**
 * Operator-reported reply intake and deterministic next-step preparation for
 * personal-number (Google Messages) outreach.
 *
 * Epistemic disclosures:
 * - A personal-number reply is always `provenance: "operator_reported"`
 *   (never a carrier webhook receipt).
 * - Recording a reply never marks a paid order as verified and never completes
 *   the recovery objective.
 * - A complaint (`classification: "complaint"`) or refusal (`opt_out` / `not_now`)
 *   is never treated as a positive buying signal.
 * - An opt-out reply immediately records a binding `opted_out` status in
 *   `communicationPermissionService` so future outreach to that customer is blocked.
 */
import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { personalOutreachReplies } from "../../../../drizzle/schema";
import {
  COZY_REPLY_CLASSIFICATIONS,
  type CozyPersonalReplyEvidence,
  type CozyReplyClassification,
  type CozyReplyNextStepKind,
} from "../../../../shared/cozyVillagerEvidence";
import { getDb } from "../../../db";
import { recordCommunicationPermission } from "../../../strategy/communicationPermissionService";

const memoryReplies = new Map<string, CozyPersonalReplyEvidence[]>();

function scopeKey(tenantId: string, operatorId: string): string {
  return `${tenantId}::${operatorId}`;
}

export function resetPersonalOutreachReplyMemoryForTest(): void {
  memoryReplies.clear();
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
 * Deterministic, zero-LLM classifier for an operator-reported personal SMS reply.
 * Priority order ensures safety and epistemic honesty:
 * 1. `opt_out` (highest priority — blocks future outreach)
 * 2. `complaint` (service issue — never treated as a positive buying signal)
 * 3. `not_now` (explicit deferral)
 * 4. `pickup_interest` (booking / pickup request)
 * 5. `question` (general inquiry or fallback when operator did not specify)
 */
export function classifyPersonalOutreachReply(
  replyText: string,
  overrideClassification?: CozyReplyClassification
): CozyReplyClassification {
  const normalized = replyText.trim();
  // Always honor explicit STOP / opt-out language even if an override was passed.
  if (OPT_OUT_PATTERNS.some(rx => rx.test(normalized))) {
    return "opt_out";
  }
  if (
    overrideClassification &&
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

export function prepareNextStepFromPersonalReply(input: {
  customerName: string;
  replyText: string;
  classification: CozyReplyClassification;
}): {
  nextStepKind: CozyReplyNextStepKind;
  nextAction: string;
  preparedFollowUpDraft: string | null;
  permissionEffect: "none" | "opted_out";
} {
  const name = firstName(input.customerName);
  switch (input.classification) {
    case "pickup_interest":
      return {
        nextStepKind: "prepare_pickup_follow_up",
        nextAction: `${input.customerName} replied with pickup interest (operator-reported). Review and approve the pickup confirmation draft before opening Google Messages.`,
        preparedFollowUpDraft: `Awesome ${name}! I can lock in that pickup window for you—just let me know roughly how many bags and if there are any gate or porch notes.`,
        permissionEffect: "none",
      };
    case "question":
      return {
        nextStepKind: "draft_answer_reply",
        nextAction: `${input.customerName} replied with a question (operator-reported). Review and tailor the answer draft before opening Google Messages.`,
        preparedFollowUpDraft: `Hi ${name}! Happy to help—we do next-day turnaround on Wash & Fold and can coordinate whatever pickup window works best for you. Would you like me to pencil in a time?`,
        permissionEffect: "none",
      };
    case "complaint":
      return {
        nextStepKind: "operator_service_recovery",
        nextAction: `${input.customerName} reported a service concern (operator-reported). Do not pitch a win-back offer; review the service-recovery response first.`,
        preparedFollowUpDraft: `Hi ${name}, thank you for telling me directly—I'm really sorry about that experience and want to make it right personally. Can I give you a quick call today or check the order notes on my end?`,
        permissionEffect: "none",
      };
    case "not_now":
      return {
        nextStepKind: "respect_deferral",
        nextAction: `${input.customerName} asked to hold off for now (operator-reported). Pause outreach and wait for a later cycle.`,
        preparedFollowUpDraft: null,
        permissionEffect: "none",
      };
    case "opt_out":
      return {
        nextStepKind: "opt_out_recorded",
        nextAction: `${input.customerName} opted out (operator-reported). Communication permission is now blocked; do not send further outreach.`,
        preparedFollowUpDraft: null,
        permissionEffect: "opted_out",
      };
  }
}

function deterministicReplyId(input: {
  tenantId: string;
  operatorId: string;
  customerId: string;
  replyText: string;
  reportedAtIso: string;
}): string {
  const digest = createHash("sha256")
    .update(
      `${input.tenantId}|${input.operatorId}|${input.customerId}|${input.replyText.trim()}|${input.reportedAtIso}`
    )
    .digest("hex")
    .slice(0, 28);
  return `por_${digest}`;
}

export async function recordPersonalOutreachReply(input: {
  tenantId: string;
  operatorId: string;
  customerId: string;
  customerName: string;
  replyText: string;
  classification?: CozyReplyClassification;
  messageId?: string | null;
  territoryId?: string | null;
  surface?: "cozy_composer" | "day_line";
  now?: Date;
}): Promise<CozyPersonalReplyEvidence> {
  const trimmedText = input.replyText.trim();
  if (!trimmedText) {
    throw new Error("Reply text is required to record an operator-reported reply.");
  }
  const reportedAt = input.now ?? new Date();
  const reportedAtIso = reportedAt.toISOString();
  const classification = classifyPersonalOutreachReply(trimmedText, input.classification);
  const prepared = prepareNextStepFromPersonalReply({
    customerName: input.customerName.trim() || "Customer",
    replyText: trimmedText,
    classification,
  });

  if (prepared.permissionEffect === "opted_out") {
    await recordCommunicationPermission({
      tenantId: input.tenantId,
      subjectType: "customer",
      subjectId: input.customerId,
      channel: "sms",
      status: "opted_out",
      reason: `Operator-reported personal SMS opt-out: "${trimmedText.slice(0, 120)}"`,
    });
    await recordCommunicationPermission({
      tenantId: input.tenantId,
      subjectType: "customer",
      subjectId: input.customerId,
      channel: "any",
      status: "opted_out",
      reason: `Operator-reported personal SMS opt-out: "${trimmedText.slice(0, 120)}"`,
    });
  }

  const record: CozyPersonalReplyEvidence = {
    id: deterministicReplyId({
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      customerId: input.customerId,
      replyText: trimmedText,
      reportedAtIso,
    }),
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    customerId: input.customerId,
    customerName: input.customerName.trim() || "Customer",
    messageId: input.messageId ?? null,
    territoryId: input.territoryId ?? null,
    replyText: trimmedText,
    classification,
    nextStepKind: prepared.nextStepKind,
    nextAction: prepared.nextAction,
    preparedFollowUpDraft: prepared.preparedFollowUpDraft,
    permissionEffect: prepared.permissionEffect,
    provenance: "operator_reported",
    surface: input.surface ?? "cozy_composer",
    reportedAt: reportedAtIso,
  };

  const key = scopeKey(input.tenantId, input.operatorId);
  const existing = memoryReplies.get(key) ?? [];
  memoryReplies.set(key, [record, ...existing.filter(item => item.id !== record.id)]);

  const db = await getDb();
  if (db) {
    try {
      await db.insert(personalOutreachReplies).values({
        id: record.id,
        tenantId: record.tenantId,
        operatorId: record.operatorId,
        customerId: record.customerId,
        customerName: record.customerName,
        messageId: record.messageId,
        territoryId: record.territoryId,
        replyText: record.replyText,
        classification: record.classification,
        nextStepKind: record.nextStepKind,
        nextAction: record.nextAction,
        preparedFollowUpDraft: record.preparedFollowUpDraft,
        permissionEffect: record.permissionEffect,
        provenance: record.provenance,
        surface: record.surface,
        reportedAt,
      });
    } catch {
      // Fallback to in-memory store when table is unavailable in unit-test environments.
    }
  }

  return record;
}

export async function listPersonalOutreachReplies(input: {
  tenantId: string;
  operatorId: string;
  customerId?: string;
}): Promise<CozyPersonalReplyEvidence[]> {
  const key = scopeKey(input.tenantId, input.operatorId);
  const mem = memoryReplies.get(key) ?? [];

  const db = await getDb();
  if (!db) {
    return input.customerId
      ? mem.filter(item => item.customerId === input.customerId)
      : [...mem];
  }

  try {
    const conditions = [
      eq(personalOutreachReplies.tenantId, input.tenantId),
      eq(personalOutreachReplies.operatorId, input.operatorId),
    ];
    if (input.customerId) {
      conditions.push(eq(personalOutreachReplies.customerId, input.customerId));
    }
    const rows = await db
      .select()
      .from(personalOutreachReplies)
      .where(and(...conditions))
      .orderBy(desc(personalOutreachReplies.reportedAt));

    const mapped: CozyPersonalReplyEvidence[] = rows.map(row => ({
      id: row.id,
      tenantId: row.tenantId,
      operatorId: row.operatorId,
      customerId: row.customerId,
      customerName: row.customerName,
      messageId: row.messageId ?? null,
      territoryId: row.territoryId ?? null,
      replyText: row.replyText,
      classification: COZY_REPLY_CLASSIFICATIONS.includes(
        row.classification as CozyReplyClassification
      )
        ? (row.classification as CozyReplyClassification)
        : "question",
      nextStepKind: row.nextStepKind as CozyReplyNextStepKind,
      nextAction: row.nextAction,
      preparedFollowUpDraft: row.preparedFollowUpDraft ?? null,
      permissionEffect: row.permissionEffect === "opted_out" ? "opted_out" : "none",
      provenance: "operator_reported",
      surface: row.surface,
      reportedAt:
        row.reportedAt instanceof Date
          ? row.reportedAt.toISOString()
          : new Date(String(row.reportedAt)).toISOString(),
    }));

    const seen = new Set(mapped.map(item => item.id));
    const combined = [
      ...mapped,
      ...mem.filter(
        item =>
          !seen.has(item.id) &&
          (!input.customerId || item.customerId === input.customerId)
      ),
    ];
    return combined.sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
  } catch {
    return input.customerId
      ? mem.filter(item => item.customerId === input.customerId)
      : [...mem];
  }
}
