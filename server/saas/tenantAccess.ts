/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { and, eq } from "drizzle-orm";
import {
  legacyLegacyDayforgeSaasEntitlements,
  legacyLegacyDayforgeSaasMemberships,
  legacyLegacyDayforgeSaasSubscriptions,
} from "../../drizzle/schema";
import {
  subscriptionAllowsLegacyDayforgeAccess,
  type LegacyDayforgeEntitlement,
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

export async function resolveLegacyDayforgeMembership(input: {
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
      tenantId: legacyLegacyDayforgeSaasMemberships.tenantId,
      userOpenId: legacyLegacyDayforgeSaasMemberships.userOpenId,
      role: legacyLegacyDayforgeSaasMemberships.role,
    })
    .from(legacyLegacyDayforgeSaasMemberships)
    .where(
      and(
        eq(legacyLegacyDayforgeSaasMemberships.tenantId, input.tenantId),
        eq(legacyLegacyDayforgeSaasMemberships.userOpenId, input.userOpenId),
        eq(legacyLegacyDayforgeSaasMemberships.active, true)
      )
    )
    .limit(1);
  return membership ?? null;
}

export async function hasLegacyDayforgeEntitlement(input: {
  tenantId: string;
  entitlement: LegacyDayforgeEntitlement;
  now?: Date;
}): Promise<boolean> {
  if (legacyTenantIds().has(input.tenantId)) return true;
  const db = await getDb();
  if (!db) return false;

  const [subscription] = await db
    .select()
    .from(legacyLegacyDayforgeSaasSubscriptions)
    .where(eq(legacyLegacyDayforgeSaasSubscriptions.tenantId, input.tenantId))
    .limit(1);
  if (
    !subscription ||
    !subscriptionAllowsLegacyDayforgeAccess({
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
    .from(legacyLegacyDayforgeSaasEntitlements)
    .where(
      and(
        eq(legacyLegacyDayforgeSaasEntitlements.tenantId, input.tenantId),
        eq(legacyLegacyDayforgeSaasEntitlements.entitlementKey, input.entitlement)
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
