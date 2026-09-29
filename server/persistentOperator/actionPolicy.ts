import { and, eq, isNull } from "drizzle-orm";
import { tenantStandingAuthorizations } from "../../drizzle/schema";
import { PERSISTENT_OPERATOR_ENTITLEMENT } from "../../shared/saasTenant";
import { getDb } from "../db";
import { hasTenantEntitlement, roleAllows } from "../saas/tenantAccess";
import {
  mintActionGrant,
} from "../claire/brain/executive/grants";
import {
  actionGrantSourceIsBackground,
  type ActionAuthorityBasis,
  type ActionClass,
  type ActionGrantSource,
  type ExecutiveActionGrant,
} from "../claire/brain/contracts/grants";
import type { CanonicalOperatorIdentity } from "./identity";

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

export async function mintPersistentOperatorActionGrant(input: {
  identity: CanonicalOperatorIdentity;
  actionClass: ActionClass;
  authorityBasis: ActionAuthorityBasis;
  source: Exclude<ActionGrantSource, { type: "operator_turn" }>;
  riskClass: ToolRiskClass;
  exactAction: string;
  standingAuthorizationId?: string | null;
  approvedByUserId?: string | null;
  expiresAtMs: number;
  scope?: ExecutiveActionGrant["scope"];
}): Promise<ExecutiveActionGrant> {
  if (!actionGrantSourceIsBackground(input.source)) {
    throw new Error("Persistent operator grant requires a non-conversational source");
  }
  if (
    input.source.tenantId !== input.identity.tenantId ||
    input.source.canonicalOperatorId !== input.identity.canonicalOperatorId
  ) {
    throw new Error("Persistent operator grant source identity mismatch");
  }

  const entitled = await hasTenantEntitlement({
    tenantId: input.identity.tenantId,
    entitlement: PERSISTENT_OPERATOR_ENTITLEMENT,
  });
  if (!entitled) {
    throw new Error("Persistent operator entitlement is not active for this tenant");
  }
  if (
    !roleAllows(input.identity.membership.canonical, [
      "owner",
      "admin",
      "operator",
    ])
  ) {
    throw new Error("Tenant membership role cannot execute persistent operator work");
  }

  const policy = await evaluatePersistentActionPolicy({
    tenantId: input.identity.tenantId,
    canonicalOperatorId: input.identity.canonicalOperatorId,
    operatorUserId: input.identity.canonicalOpenId,
    exactAction: input.exactAction,
    riskClass: input.riskClass,
    standingAuthorizationId: input.standingAuthorizationId,
    approvedByUserId: input.approvedByUserId,
  });
  if (!policy.allowed) {
    throw new Error(`Persistent action policy denied: ${policy.reason}`);
  }

  return mintActionGrant({
    actionClass: input.actionClass,
    scope: input.scope ?? { identity: input.identity.canonicalOpenId },
    authorityBasis: input.authorityBasis,
    sourceTurnAssembledText: "",
    source: input.source,
    tenantId: input.identity.tenantId,
    canonicalOperatorId: input.identity.canonicalOperatorId,
    expiresAtMs: input.expiresAtMs,
    constraints: {
      mutationAllowed: true,
      shadowOnly: false,
    },
  });
}
