import { and, asc, eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { legacyDayforgeSaasMemberships, legacyDayforgeSaasTenants, users } from "../../drizzle/schema";
import { getSessionCookieOptions } from "../_core/cookies";
import { sdk } from "../_core/sdk";
import { getDb } from "../db";
import { decidePaidLogin, PAID_WORKSPACE_ENTITLEMENT } from "../saas/paidCustomerLifecycle";
import { hasTenantEntitlement } from "../saas/tenantAccess";

/**
 * Signing in with Google, once the person's journey has become a paid workspace: the workspace session for its owner,
 * with exactly the checks the password sign-in makes (server/saas/saasAuthRoute.ts): an active owner membership, a
 * workspace whose status and subscription allow it. The owner must have finished setting up (their password step
 * creates the membership); until then this opens nothing and the person goes back to their journey.
 */
export async function openWorkspaceForOwner(tenantId: string, req: Request, res: Response): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [owner] = await db
    .select({
      userOpenId: legacyDayforgeSaasMemberships.userOpenId,
      active: legacyDayforgeSaasMemberships.active,
      tenantStatus: legacyDayforgeSaasTenants.status,
      name: users.name,
    })
    .from(legacyDayforgeSaasMemberships)
    .innerJoin(legacyDayforgeSaasTenants, eq(legacyDayforgeSaasTenants.id, legacyDayforgeSaasMemberships.tenantId))
    // like the password sign-in: an owner with no users row opens nothing
    .innerJoin(users, eq(users.openId, legacyDayforgeSaasMemberships.userOpenId))
    .where(and(eq(legacyDayforgeSaasMemberships.tenantId, tenantId), eq(legacyDayforgeSaasMemberships.role, "owner")))
    .orderBy(asc(legacyDayforgeSaasMemberships.createdAt))
    .limit(1);
  if (!owner) return false;
  const entitled = await hasTenantEntitlement({ tenantId, entitlement: PAID_WORKSPACE_ENTITLEMENT });
  const decision = decidePaidLogin({ membershipActive: Boolean(owner.active), tenantStatus: owner.tenantStatus, entitlementAllows: entitled, priorSuccessfulLogin: false });
  if (!decision.allow) return false;
  const token = await sdk.createSessionToken(owner.userOpenId, { name: owner.name || "JOYSTICK operator", role: "user", expiresInMs: ONE_YEAR_MS });
  res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
  return true;
}
