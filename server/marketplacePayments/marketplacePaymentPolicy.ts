import {
  evaluateAuthority,
  type AuthorityAction,
  type AuthorityGrantPolicyView,
} from "../procurement/authorityPolicy";
import {
  paymentCaptureTruthCheck,
  type ProviderAcceptancePolicyView,
} from "../procurement/providerAcceptancePolicy";

export type AuthorizationState =
  | "no_payment_required" | "authorization_required" | "authorization_pending" | "authorized" | "cancelled";
export type CaptureState = "capture_pending" | "captured" | "capture_failed";
export type TransferState = "transfer_pending" | "transferred" | "transfer_failed" | "cancelled";
export type RefundState = "refund_pending" | "refunded" | "refund_failed";

export type MarketplaceAuthorizationGateInput = {
  authority: AuthorityGrantPolicyView;
  action: AuthorityAction;
  residentApprovalGranted: boolean;
  now?: Date;
};

export type MarketplaceAuthorizationGateDecision = {
  allowed: boolean;
  state: AuthorizationState;
  reasons: string[];
};

export function isKnownAmount(amountCents: number): boolean {
  return Number.isSafeInteger(amountCents) && amountCents >= 0;
}

export function classifyAuthorizationNeed(amountCents: number): "no_payment_required" | "authorization_required" {
  return isKnownAmount(amountCents) && amountCents > 0 ? "authorization_required" : "no_payment_required";
}

export function evaluateMarketplaceAuthorization(
  input: MarketplaceAuthorizationGateInput,
): MarketplaceAuthorizationGateDecision {
  const now = input.now ?? new Date();
  const reasons: string[] = [];

  if (!isKnownAmount(input.action.spendCents)) reasons.push("amount_unknown");

  const need = isKnownAmount(input.action.spendCents)
    ? classifyAuthorizationNeed(input.action.spendCents)
    : "authorization_required";
  if (need === "no_payment_required") {
    return { allowed: true, state: "no_payment_required", reasons: [] };
  }

  const authorityDecision = evaluateAuthority(input.authority, input.action, now);
  reasons.push(...authorityDecision.reasons);

  if (authorityDecision.residentApprovalRequired && !input.residentApprovalGranted) {
    reasons.push("resident_approval_required");
  }

  const allowed = reasons.length === 0;
  return {
    allowed,
    state: allowed ? "authorization_required" : "cancelled",
    reasons,
  };
}

export type MarketplaceCaptureGateInput = {
  authorizationState: AuthorizationState;
  acceptance: ProviderAcceptancePolicyView;
  budgetCapCents: number;
  planDeadlineAt: Date;
  now?: Date;
};

export type MarketplaceCaptureGateDecision = {
  allowed: boolean;
  reasons: string[];
};

export function evaluateMarketplaceCapture(input: MarketplaceCaptureGateInput): MarketplaceCaptureGateDecision {
  const reasons: string[] = [];
  if (input.authorizationState !== "authorized") {
    reasons.push("authorization_not_in_authorized_state");
  }
  const truthCheck = paymentCaptureTruthCheck({
    acceptance: input.acceptance,
    budgetCapCents: input.budgetCapCents,
    planDeadlineAt: input.planDeadlineAt,
    now: input.now,
  });
  for (const reason of truthCheck.reasons) {
    if (!reasons.includes(reason)) reasons.push(reason);
  }
  return { allowed: reasons.length === 0, reasons };
}
