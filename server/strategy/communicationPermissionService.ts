import { and, eq } from "drizzle-orm";
import { communicationPermissions } from "../../drizzle/schema";
import { getDb } from "../db";

export type PermissionSubjectType = "lead" | "contact" | "customer" | "property";
export type CommunicationChannel = "sms" | "email" | "call" | "visit" | "any";
export type PermissionStatus = "opted_in" | "opted_out" | "refused" | "unspecified";

export interface PermissionCheckResult {
  allowed: boolean;
  permissionStatus: PermissionStatus;
  reason?: string;
  canContactAt?: Date;
}

// In-memory store for offline/test environments
const memoryPermissions = new Map<string, {
  id: string;
  tenantId: string;
  subjectType: PermissionSubjectType;
  subjectId: string;
  channel: CommunicationChannel;
  status: PermissionStatus;
  reason: string | null;
  lastOutreachAt: Date | null;
  frequencyCapDays: number;
}>();

function memoryKey(tenantId: string, subjectType: string, subjectId: string, channel: string): string {
  return `${tenantId}:${subjectType}:${subjectId}:${channel}`;
}

/**
 * Check if communicating with a subject is permitted under Guardrail G14.
 * Opt-outs and refusals are strictly binding.
 * Frequency limits prevent over-contacting.
 */
export async function checkCommunicationPermission(input: {
  tenantId: string;
  subjectType: PermissionSubjectType;
  subjectId: string;
  channel?: CommunicationChannel;
  now?: Date;
}): Promise<PermissionCheckResult> {
  const channel = input.channel ?? "any";
  const now = input.now ?? new Date();

  const db = await getDb();
  let permission: {
    status: PermissionStatus;
    lastOutreachAt: Date | null;
    frequencyCapDays: number;
    reason: string | null;
  } | null = null;

  if (db) {
    try {
      // Check channel-specific first, then 'any'
      const rows = await db
        .select()
        .from(communicationPermissions)
        .where(
          and(
            eq(communicationPermissions.tenantId, input.tenantId),
            eq(communicationPermissions.subjectType, input.subjectType),
            eq(communicationPermissions.subjectId, input.subjectId)
          )
        );
      const match = rows.find(r => r.channel === channel) ?? rows.find(r => r.channel === "any");
      if (match) {
        permission = {
          status: match.status as PermissionStatus,
          lastOutreachAt: match.lastOutreachAt ? new Date(match.lastOutreachAt) : null,
          frequencyCapDays: match.frequencyCapDays,
          reason: match.reason,
        };
      }
    } catch {
      // Fallback to memory store
    }
  }

  if (!permission) {
    const mem = memoryPermissions.get(memoryKey(input.tenantId, input.subjectType, input.subjectId, channel))
      ?? memoryPermissions.get(memoryKey(input.tenantId, input.subjectType, input.subjectId, "any"));
    if (mem) {
      permission = {
        status: mem.status,
        lastOutreachAt: mem.lastOutreachAt,
        frequencyCapDays: mem.frequencyCapDays,
        reason: mem.reason,
      };
    }
  }

  // If no record, default is 'unspecified'
  if (!permission) {
    return {
      allowed: true,
      permissionStatus: "unspecified",
    };
  }

  // 1. Check binding opt-out or refusal (Guardrail G14)
  if (permission.status === "opted_out" || permission.status === "refused") {
    return {
      allowed: false,
      permissionStatus: permission.status,
      reason: `Recipient has explicitly ${permission.status === "opted_out" ? "opted out of" : "refused"} contact: ${permission.reason ?? "binding refusal under G14"}`,
    };
  }

  // 2. Check frequency limits
  if (permission.lastOutreachAt) {
    const elapsedDays = (now.getTime() - permission.lastOutreachAt.getTime()) / (1000 * 60 * 60 * 24);
    if (elapsedDays < permission.frequencyCapDays) {
      const remainingDays = Math.ceil(permission.frequencyCapDays - elapsedDays);
      const canContactAt = new Date(permission.lastOutreachAt.getTime() + permission.frequencyCapDays * 24 * 60 * 60 * 1000);
      return {
        allowed: false,
        permissionStatus: permission.status,
        reason: `Frequency limit: contacted ${Math.floor(elapsedDays)} days ago. Minimum wait is ${permission.frequencyCapDays} days (${remainingDays} days remaining).`,
        canContactAt,
      };
    }
  }

  return {
    allowed: true,
    permissionStatus: permission.status,
  };
}

/**
 * Record or update a communication permission.
 */
export async function recordCommunicationPermission(input: {
  tenantId: string;
  subjectType: PermissionSubjectType;
  subjectId: string;
  channel?: CommunicationChannel;
  status: PermissionStatus;
  reason?: string;
  frequencyCapDays?: number;
}): Promise<void> {
  const channel = input.channel ?? "any";
  const frequencyCapDays = input.frequencyCapDays ?? 7;
  const id = `perm_${input.tenantId}_${input.subjectType}_${input.subjectId}_${channel}`;

  // Store in memory
  memoryPermissions.set(memoryKey(input.tenantId, input.subjectType, input.subjectId, channel), {
    id,
    tenantId: input.tenantId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    channel,
    status: input.status,
    reason: input.reason ?? null,
    lastOutreachAt: null,
    frequencyCapDays,
  });

  const db = await getDb();
  if (!db) return;
  try {
    await db
      .insert(communicationPermissions)
      .values({
        id,
        tenantId: input.tenantId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        channel,
        status: input.status,
        reason: input.reason ?? null,
        frequencyCapDays,
      })
      .onDuplicateKeyUpdate({
        set: {
          status: input.status,
          reason: input.reason ?? null,
          frequencyCapDays,
        },
      });
  } catch {
    // optional
  }
}

/**
 * Record that outreach occurred, advancing the frequency cap timer.
 */
export async function recordOutreachAttempt(input: {
  tenantId: string;
  subjectType: PermissionSubjectType;
  subjectId: string;
  channel?: CommunicationChannel;
  at?: Date;
}): Promise<void> {
  const channel = input.channel ?? "any";
  const at = input.at ?? new Date();

  const key = memoryKey(input.tenantId, input.subjectType, input.subjectId, channel);
  const mem = memoryPermissions.get(key);
  if (mem) {
    mem.lastOutreachAt = at;
  } else {
    memoryPermissions.set(key, {
      id: `perm_${input.tenantId}_${input.subjectType}_${input.subjectId}_${channel}`,
      tenantId: input.tenantId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      channel,
      status: "unspecified",
      reason: null,
      lastOutreachAt: at,
      frequencyCapDays: 7,
    });
  }

  const db = await getDb();
  if (!db) return;
  try {
    await db
      .update(communicationPermissions)
      .set({ lastOutreachAt: at })
      .where(
        and(
          eq(communicationPermissions.tenantId, input.tenantId),
          eq(communicationPermissions.subjectType, input.subjectType),
          eq(communicationPermissions.subjectId, input.subjectId),
          eq(communicationPermissions.channel, channel)
        )
      );
  } catch {
    // optional
  }
}
