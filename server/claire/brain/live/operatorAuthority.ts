/**
 * Who receives the newest Claire.
 *
 * Eligibility is an IDENTITY plus a VERIFIED MEMBERSHIP, never a tenant literal.
 * The operator must be one of the configured authorized operator identities
 * and must hold an active owner/admin/operator membership in the tenant the
 * conversation runs as. Tenant-level data authorization is untouched: every
 * reader still runs under the conversation's own tenant, so a Laundry Farm
 * session reads Laundry Farm data and a `default` session reads `default`.
 *
 * Identities come from `CLAIRE_BRAIN_V2_OPERATOR_IDS` (comma-separated
 * OpenIDs). Unset, they are the configured owner (`OWNER_OPEN_ID`) plus the
 * historical operator ids the previous gate accepted, so enabling this file
 * never removes the operator who already had V2.
 */

import { ENV } from "../../../_core/env";
import type { SaasTenantMemberRole } from "../../../../shared/saasTenant";

export type ClaireOperatorMembership = {
  tenantId: string;
  userOpenId: string;
  role: SaasTenantMemberRole;
};

export type ClaireOperatorAuthority =
  | { authorized: true; tenantId: string; operatorUserId: string; role: SaasTenantMemberRole; basis: "verified_membership" }
  | { authorized: false; reason: "identity_not_authorized" | "membership_unverified" | "role_not_authorized" | "membership_lookup_failed" };

const OPERATOR_ROLES: readonly SaasTenantMemberRole[] = ["owner", "admin", "operator"];
const HISTORICAL_OPERATOR_IDS = ["adam-admin", "adam"] as const;

export function authorizedClaireOperatorIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const configured = env.CLAIRE_BRAIN_V2_OPERATOR_IDS?.split(",").map(value => value.trim()).filter(Boolean);
  if (configured?.length) return new Set(configured);
  const owner = (env.OWNER_OPEN_ID ?? ENV.ownerOpenId ?? "").trim();
  return new Set([...(owner ? [owner] : []), ...HISTORICAL_OPERATOR_IDS]);
}

export function isAuthorizedClaireOperatorIdentity(operatorUserId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return authorizedClaireOperatorIds(env).has(operatorUserId.trim());
}

export type MembershipResolver = (input: {
  tenantId: string;
  operatorUserId: string;
}) => Promise<ClaireOperatorMembership | null>;

/** Production membership: the same resolver every tenant-scoped procedure uses. */
export const resolveOperatorMembership: MembershipResolver = async ({ tenantId, operatorUserId }) => {
  const [{ resolveLegacyDayforgeMembership }, { getUserByOpenId }] = await Promise.all([
    import("../../../saas/tenantAccess"),
    import("../../../db"),
  ]);
  const user = await getUserByOpenId(operatorUserId);
  if (!user) return null;
  const platformRole = user.role === "admin" || user.role === "driver" ? user.role : "user";
  return resolveLegacyDayforgeMembership({ tenantId, userOpenId: operatorUserId, platformRole });
};

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: ClaireOperatorAuthority }>();

export function clearClaireOperatorAuthorityCache(): void {
  cache.clear();
}

/**
 * Resolve once per turn. A membership already verified by the request's own
 * procedure middleware (Claire Desk) is used as-is; the phone path resolves it.
 */
export async function resolveClaireOperatorAuthority(
  input: {
    tenantId: string;
    operatorUserId: string;
    membership?: ClaireOperatorMembership | null;
  },
  deps: { resolveMembership?: MembershipResolver; env?: NodeJS.ProcessEnv; nowMs?: number } = {}
): Promise<ClaireOperatorAuthority> {
  const env = deps.env ?? process.env;
  if (!isAuthorizedClaireOperatorIdentity(input.operatorUserId, env)) {
    return { authorized: false, reason: "identity_not_authorized" };
  }
  const now = deps.nowMs ?? Date.now();
  const key = `${input.tenantId}\u0000${input.operatorUserId}`;
  const supplied = input.membership ?? null;
  if (!supplied && !deps.resolveMembership) {
    const hit = cache.get(key);
    if (hit && now - hit.at < CACHE_MS) return hit.value;
  }

  let membership: ClaireOperatorMembership | null;
  try {
    membership =
      supplied ??
      (await (deps.resolveMembership ?? resolveOperatorMembership)({
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
      }));
  } catch {
    return { authorized: false, reason: "membership_lookup_failed" };
  }

  let value: ClaireOperatorAuthority;
  if (!membership || membership.tenantId !== input.tenantId || membership.userOpenId !== input.operatorUserId) {
    value = { authorized: false, reason: "membership_unverified" };
  } else if (!OPERATOR_ROLES.includes(membership.role)) {
    value = { authorized: false, reason: "role_not_authorized" };
  } else {
    value = {
      authorized: true,
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      role: membership.role,
      basis: "verified_membership",
    };
  }
  if (!supplied && !deps.resolveMembership) cache.set(key, { at: now, value });
  return value;
}
