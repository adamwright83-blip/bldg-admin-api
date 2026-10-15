import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { customerContactPermissions } from "../../drizzle/schema";
import { getDb } from "../db";
import { DEFAULT_DOCTRINE } from "../../shared/claireProactive";
import type { CustomerTruthDisposition } from "../analytics/sourceCoverage";
import {
  readCustomerRecoveryInterventions,
  readRecentOutboundCommunications,
} from "../domains/recovery/customerRecoveryReadService";

/**
 * Dormant outreach eligibility. A phone number on an order is identity, not
 * SMS consent. Current CleanCloud evidence is required before a person is
 * named for outreach.
 */
export const WIN_BACK_COOLDOWN_DAYS = DEFAULT_DOCTRINE.outreachCooldownDays;

export type SmsPermissionState = "opted_in" | "opted_out" | "expired" | "unknown";

export type DormantOutreachBlock =
  | "tenant_missing"
  | "freshness_not_current"
  | "unmatched_identity"
  | "outside_territory"
  | "no_paid_history"
  | "unknown_last_order"
  | "not_dormant"
  | "recent_order"
  | "phone_missing"
  | "sms_consent_absent"
  | "opted_out"
  | "outreach_frequency"
  | "permission_unreadable";

export type DormantOutreachDecision = {
  eligible: boolean;
  blocks: DormantOutreachBlock[];
};

export type SmsPermissionRecord = {
  state: SmsPermissionState;
  sourceReference: string | null;
  capturedAt: string | null;
};

function addDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

export function hashIdentityKey(tenantId: string, key: string): string {
  return createHash("sha256").update(`${tenantId}:${key}`).digest("hex");
}

export function evaluateDormantOutreach(input: {
  tenantId: string;
  freshness: CustomerTruthDisposition;
  matched: boolean;
  inTerritory: boolean;
  paidOrders: number;
  capturedCents: number;
  lastOrderDate: string | null;
  dormant: boolean;
  contradictingRecentOrder: boolean;
  phoneDigits: string | null;
  permission: SmsPermissionState;
  permissionReadable: boolean;
  lastOutreachOn: string | null;
  today: string;
  cooldownDays?: number;
}): DormantOutreachDecision {
  const blocks: DormantOutreachBlock[] = [];
  if (!input.tenantId.trim()) blocks.push("tenant_missing");
  if (input.freshness !== "current") blocks.push("freshness_not_current");
  if (!input.matched) blocks.push("unmatched_identity");
  if (!input.inTerritory) blocks.push("outside_territory");
  if (input.paidOrders < 1 || input.capturedCents <= 0) blocks.push("no_paid_history");
  if (!input.lastOrderDate) blocks.push("unknown_last_order");
  if (!input.dormant) blocks.push("not_dormant");
  if (input.contradictingRecentOrder) blocks.push("recent_order");
  if (!input.phoneDigits || input.phoneDigits.length !== 10) blocks.push("phone_missing");
  if (!input.permissionReadable) blocks.push("permission_unreadable");
  else if (input.permission === "opted_out") blocks.push("opted_out");
  else if (input.permission !== "opted_in") blocks.push("sms_consent_absent");
  if (input.lastOutreachOn) {
    const cooldownUntil = addDays(
      input.lastOutreachOn.slice(0, 10),
      input.cooldownDays ?? WIN_BACK_COOLDOWN_DAYS
    );
    if (cooldownUntil > input.today) blocks.push("outreach_frequency");
  }
  return { eligible: blocks.length === 0, blocks };
}

export type DormantContactFacts = {
  readable: boolean;
  permissionByHash: Map<string, SmsPermissionRecord>;
  lastOutreachByPhone: Map<string, string>;
  lastOutreachByHash: Map<string, string>;
};

export async function loadDormantContactFacts(input: {
  tenantId: string;
  now: Date;
  cooldownDays?: number;
}): Promise<DormantContactFacts> {
  const empty: DormantContactFacts = {
    readable: false,
    permissionByHash: new Map(),
    lastOutreachByPhone: new Map(),
    lastOutreachByHash: new Map(),
  };
  if (!input.tenantId.trim()) return empty;
  const db = await getDb().catch(() => null);
  if (!db) return empty;
  const since = new Date(
    input.now.getTime() - Math.max(1, input.cooldownDays ?? WIN_BACK_COOLDOWN_DAYS) * 86_400_000
  );
  try {
    const [permissions, recoveries, communications] = await Promise.all([
      db
        .select()
        .from(customerContactPermissions)
        .where(
          and(
            eq(customerContactPermissions.tenantId, input.tenantId),
            eq(customerContactPermissions.channel, "sms"),
            eq(customerContactPermissions.purpose, "win_back_marketing")
          )
        ),
      readCustomerRecoveryInterventions(input.tenantId),
      readRecentOutboundCommunications(input.tenantId, since),
    ]);
    if (!recoveries || !communications) return empty;
    const permissionByHash = new Map<string, SmsPermissionRecord>();
    for (const row of permissions) {
      const expired = row.expiresAt !== null && row.expiresAt.getTime() <= input.now.getTime();
      const state: SmsPermissionState =
        row.status === "opted_out" ? "opted_out" : expired ? "expired" : row.status === "opted_in" ? "opted_in" : "unknown";
      permissionByHash.set(row.customerKeyHash, {
        state,
        sourceReference: row.sourceReference,
        capturedAt: row.capturedAt.toISOString(),
      });
    }
    const lastOutreachByHash = new Map<string, string>();
    for (const row of recoveries) {
      if (!row.contactedAt) continue;
      const iso = row.contactedAt.toISOString();
      const prior = lastOutreachByHash.get(row.customerKeyHash);
      if (!prior || iso > prior) lastOutreachByHash.set(row.customerKeyHash, iso);
    }
    const lastOutreachByPhone = new Map<string, string>();
    for (const row of communications) {
      if (row.direction !== "outbound") continue;
      if (!["sent", "delivered", "completed"].includes(row.status ?? "")) continue;
      const digits = String(row.toNumber ?? "").replace(/\D/g, "");
      const phone = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
      if (phone.length !== 10) continue;
      const iso = row.createdAt.toISOString();
      const prior = lastOutreachByPhone.get(phone);
      if (!prior || iso > prior) lastOutreachByPhone.set(phone, iso);
    }
    return { readable: true, permissionByHash, lastOutreachByPhone, lastOutreachByHash };
  } catch (error) {
    console.warn(
      "[DormantOutreach] contact facts unavailable",
      error instanceof Error ? error.message : error
    );
    return empty;
  }
}

export function permissionForKeys(
  facts: DormantContactFacts,
  tenantId: string,
  keys: readonly string[]
): SmsPermissionRecord {
  for (const key of keys) {
    const found = facts.permissionByHash.get(hashIdentityKey(tenantId, key));
    if (found) return found;
  }
  return { state: "unknown", sourceReference: null, capturedAt: null };
}

export function lastOutreachForKeys(
  facts: DormantContactFacts,
  tenantId: string,
  keys: readonly string[],
  phoneDigits: string | null
): string | null {
  const stamps = [
    phoneDigits ? facts.lastOutreachByPhone.get(phoneDigits) ?? null : null,
    ...keys.map(key => facts.lastOutreachByHash.get(hashIdentityKey(tenantId, key)) ?? null),
  ].filter((value): value is string => Boolean(value));
  return stamps.sort().at(-1) ?? null;
}
