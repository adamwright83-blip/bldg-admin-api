import { and, eq, isNull } from "drizzle-orm";
import { tenantStandingAuthorizations } from "../../drizzle/schema";
import { PERSISTENT_OPERATOR_ENTITLEMENT } from "../../shared/saasTenant";
import { getDb } from "../db";
import { hasTenantEntitlement, roleAllows } from "../saas/tenantAccess";

export const TOOL_RISK_CLASSES = [
  "READ_ONLY",
  "INTERNAL_REVERSIBLE",
  "EXTERNAL_COMMUNICATION",
  "FINANCIAL_OR_CONTRACTUAL",
] as const;
export type ToolRiskClass = (typeof TOOL_RISK_CLASSES)[number];

export type PersistentActionPolicyInput = {
  tenantId: string;
  canonicalOperatorId: string;
  operatorUserId: string;
  exactAction: string;
  riskClass: ToolRiskClass;
  standingAuthorizationId?: string | null;
  approvedByUserId?: string | null;
  now?: Date;
};

export type PersistentActionPolicyDecision =
  | { allowed: true; authority: "automatic" | "standing_authorization" | "explicit_approval" }
  | {
      allowed: false;
      reason:
        | "missing_identity"
        | "identity_unresolved"
        | "entitlement_required"
        | "role_not_allowed"
        | "standing_authorization_required"
        | "standing_authorization_invalid"
        | "explicit_approval_required";
    };

function localHm(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}

function inLocalWindow(input: {
  now: Date;
  timeZone: string;
  start: string | null;
  end: string | null;
}): boolean {
  if (!input.start || !input.end) return true;
  const current = localHm(input.now, input.timeZone);
  if (input.start <= input.end) {
    return current >= input.start && current <= input.end;
  }
  return current >= input.start || current <= input.end;
}

export async function evaluatePersistentActionPolicy(
  input: PersistentActionPolicyInput
): Promise<PersistentActionPolicyDecision> {
  if (
    !input.tenantId.trim() ||
    !input.canonicalOperatorId.trim() ||
    !input.operatorUserId.trim()
  ) {
    return { allowed: false, reason: "missing_identity" };
  }

  const identity = await resolveCanonicalOperatorIdentity({
    tenantId: input.tenantId,
    source: { type: "open_id", value: input.operatorUserId },
    subsystem: "persistent_operator.action_policy",
  });
  if (
    !identity.ok ||
    identity.identity.canonicalOperatorId !== input.canonicalOperatorId
  ) {
    return { allowed: false, reason: "identity_unresolved" };
  }
  const entitled = await hasTenantEntitlement({
    tenantId: input.tenantId,
    entitlement: PERSISTENT_OPERATOR_ENTITLEMENT,
    now: input.now,
  });
  if (!entitled) {
    return { allowed: false, reason: "entitlement_required" };
  }
  if (
    !roleAllows(identity.identity.membership.canonical, [
      "owner",
      "admin",
      "operator",
    ])
  ) {
    return { allowed: false, reason: "role_not_allowed" };
  }

  if (input.riskClass === "READ_ONLY" || input.riskClass === "INTERNAL_REVERSIBLE") {
    return { allowed: true, authority: "automatic" };
  }

  if (input.riskClass === "FINANCIAL_OR_CONTRACTUAL") {
    return input.approvedByUserId?.trim()
      ? { allowed: true, authority: "explicit_approval" }
      : { allowed: false, reason: "explicit_approval_required" };
  }

  if (input.approvedByUserId?.trim()) {
    return { allowed: true, authority: "explicit_approval" };
  }
  if (!input.standingAuthorizationId?.trim()) {
    return { allowed: false, reason: "standing_authorization_required" };
  }

  const db = await getDb();
  if (!db) return { allowed: false, reason: "standing_authorization_invalid" };
  const [authorization] = await db
    .select()
    .from(tenantStandingAuthorizations)
    .where(
      and(
        eq(tenantStandingAuthorizations.id, input.standingAuthorizationId),
        eq(tenantStandingAuthorizations.tenantId, input.tenantId),
        eq(
          tenantStandingAuthorizations.canonicalOperatorId,
          input.canonicalOperatorId
        ),
        eq(tenantStandingAuthorizations.operatorUserId, input.operatorUserId),
        eq(tenantStandingAuthorizations.exactAction, input.exactAction),
        isNull(tenantStandingAuthorizations.revokedAt)
      )
    )
    .limit(1);
  if (!authorization) {
    return { allowed: false, reason: "standing_authorization_invalid" };
  }
  if (
    !inLocalWindow({
      now: input.now ?? new Date(),
      timeZone: authorization.timeZone,
      start: authorization.allowedLocalStart,
      end: authorization.allowedLocalEnd,
    })
  ) {
    return { allowed: false, reason: "standing_authorization_invalid" };
  }
  return { allowed: true, authority: "standing_authorization" };
}
