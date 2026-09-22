import { randomUUID } from "node:crypto";
import { redactEndpointForLog } from "@shared/twilioPlatform";
import {
  VERIFY_ACTION_CLASSES,
  VERIFY_DOES_NOT_EXECUTE,
  VERIFY_GRANT_TTL_MS,
  type ClaireTurnVerifyPolicy,
  type VerifyActionClass,
  type VerifyActionGrant,
  type VerifyDoesNotExecute,
} from "@shared/twilioFuture";
import { evaluateTwilioCapability } from "../capabilities";
import { safeFutureLog } from "./safeLog";

export type VerifyProviderStatus = "approved" | "pending" | "canceled" | "denied";

export type VerifyGrantResult =
  | { ok: true; grant: VerifyActionGrant; log: string }
  | { ok: false; grant: null; state: string; reason: string; log: string };

function isActionClass(value: string): value is VerifyActionClass {
  return (VERIFY_ACTION_CLASSES as readonly string[]).includes(value);
}

/**
 * Ordinary Claire conversation is not an OTP prompt.
 * A known authorized operator id (the result of resolveClaireOperatorIdForPhone)
 * keeps ordinary Claire. An action class requires a separate grant.
 */
export function conversationVerifyPolicy(input: {
  knownAuthorizedOperatorId: string | null;
  requestedActionClass: VerifyActionClass | null;
}): ClaireTurnVerifyPolicy {
  const actionGrantRequired = input.requestedActionClass != null;
  return {
    conversationOtpRequired: false,
    actionGrantRequired,
    keepsOrdinaryClaire: Boolean(input.knownAuthorizedOperatorId) && !actionGrantRequired,
  };
}

/**
 * Issues authorization evidence only. Does not call Verify, send a code,
 * or perform the action the grant names.
 */
export function issueVerifyActionGrant(input: {
  env?: NodeJS.ProcessEnv;
  tenantId: string;
  operatorUserId: string;
  actionClass: VerifyActionClass;
  providerStatus: VerifyProviderStatus;
  nowMs: number;
  ttlMs?: number;
  phone?: string | null;
  verificationCode?: string | null;
}): VerifyGrantResult {
  const env = input.env ?? process.env;
  const capability = evaluateTwilioCapability("verify", env);
  const code = input.verificationCode ?? "";
  const log = safeFutureLog(
    {
      capabilityState: capability.state,
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      actionClass: input.actionClass,
      providerStatus: input.providerStatus,
      phone: redactEndpointForLog(input.phone),
      verificationCode: code,
    },
    env,
    code ? [code] : []
  );

  if (capability.state !== "CONFIGURED" && capability.state !== "LIVE") {
    return {
      ok: false,
      grant: null,
      state: capability.state,
      reason: capability.reason ?? "verify_unavailable",
      log,
    };
  }
  const tenantId = input.tenantId.trim();
  const operatorUserId = input.operatorUserId.trim();
  if (!tenantId || !operatorUserId || !isActionClass(input.actionClass)) {
    return { ok: false, grant: null, state: capability.state, reason: "invalid_scope", log };
  }
  if (input.providerStatus !== "approved") {
    return { ok: false, grant: null, state: capability.state, reason: "not_approved", log };
  }
  const ttlMs = input.ttlMs ?? VERIFY_GRANT_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    return { ok: false, grant: null, state: capability.state, reason: "invalid_ttl", log };
  }
  const grant: VerifyActionGrant = {
    kind: "verify_action_grant",
    grantId: randomUUID(),
    tenantId,
    operatorUserId,
    actionClass: input.actionClass,
    issuedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + ttlMs,
    evidenceOnly: true,
    executesBusinessAction: false,
  };
  return { ok: true, grant, log };
}

export function verifyGrantCovers(
  grant: VerifyActionGrant,
  demand: {
    tenantId: string;
    operatorUserId: string;
    actionClass: VerifyActionClass;
    nowMs: number;
  }
): boolean {
  if (demand.nowMs >= grant.expiresAtMs) return false;
  if (demand.tenantId !== grant.tenantId) return false;
  if (demand.operatorUserId !== grant.operatorUserId) return false;
  if (demand.actionClass !== grant.actionClass) return false;
  return true;
}

export function verifyGrantExecutes(_action: VerifyDoesNotExecute): false {
  return false;
}

export function verifyGrantBusinessEffects(): readonly VerifyDoesNotExecute[] {
  return [];
}
