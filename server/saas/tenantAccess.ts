import { and, eq } from "drizzle-orm";
import {
  dayforgeSaasEntitlements,
  dayforgeSaasMemberships,
  dayforgeSaasSubscriptions,
} from "../../drizzle/schema";
import {
  subscriptionAllowsDayforgeAccess,
  type DayforgeEntitlement,
  type SaasTenantMemberRole,
} from "../../shared/saasTenant";
import { getDb } from "../db";

export type ActiveTenantMembership = {
  tenantId: string;
  userOpenId: string;
  role: SaasTenantMemberRole;
};

export function isLegacyDayforgeTenant(tenantId: string): boolean {
  return legacyTenantIds().has(tenantId);
}

function legacyTenantIds(): Set<string> {
  return new Set(
    (process.env.DAYFORGE_LEGACY_TENANT_IDS ?? "default,laundry_farm")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean)
  );
}

export async function resolveDayforgeMembership(input: {
  tenantId: string;
  userOpenId: string;
  platformRole: "admin" | "driver" | "user";
}): Promise<ActiveTenantMembership | null> {
  const membership = await getActiveTenantMembership(input);
  if (membership) return membership;
  if (!isLegacyDayforgeTenant(input.tenantId)) return null;
  if (input.platformRole === "admin") {
    return { ...input, role: "owner" };
  }
  if (input.platformRole === "driver") {
    return { ...input, role: "field" };
  }
  return null;
}

export async function getActiveTenantMembership(input: {
  tenantId: string;
  userOpenId: string;
}): Promise<ActiveTenantMembership | null> {
  const db = await getDb();
  if (!db) return null;
  const [membership] = await db
    .select({
      tenantId: dayforgeSaasMemberships.tenantId,
      userOpenId: dayforgeSaasMemberships.userOpenId,
      role: dayforgeSaasMemberships.role,
    })
    .from(dayforgeSaasMemberships)
    .where(
      and(
        eq(dayforgeSaasMemberships.tenantId, input.tenantId),
        eq(dayforgeSaasMemberships.userOpenId, input.userOpenId),
        eq(dayforgeSaasMemberships.active, true)
      )
    )
    .limit(1);
  return membership ?? null;
}

export async function hasDayforgeEntitlement(input: {
  tenantId: string;
  entitlement: DayforgeEntitlement;
  now?: Date;
}): Promise<boolean> {
  if (legacyTenantIds().has(input.tenantId)) return true;
  const db = await getDb();
  if (!db) return false;

  const [subscription] = await db
    .select()
    .from(dayforgeSaasSubscriptions)
    .where(eq(dayforgeSaasSubscriptions.tenantId, input.tenantId))
    .limit(1);
  if (
    !subscription ||
    !subscriptionAllowsDayforgeAccess({
      status: subscription.status,
      now: input.now,
      graceEndsAt: subscription.graceEndsAt,
      accessEndsAt: subscription.accessEndsAt,
    })
  ) {
    return false;
  }

  const now = input.now ?? new Date();
  const rows = await db
    .select()
    .from(dayforgeSaasEntitlements)
    .where(
      and(
        eq(dayforgeSaasEntitlements.tenantId, input.tenantId),
        eq(dayforgeSaasEntitlements.entitlementKey, input.entitlement)
      )
    );

  const activeRows = rows.filter(
    row => !row.expiresAt || row.expiresAt.getTime() > now.getTime()
  );
  const manual = activeRows.find(row => row.source === "manual");
  if (manual) return manual.enabled;
  return activeRows.some(row => row.source === "plan" && row.enabled);
}

export function roleAllows(
  actual: SaasTenantMemberRole,
  allowed: readonly SaasTenantMemberRole[]
): boolean {
  return allowed.includes(actual);
}
