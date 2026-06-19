import { evaluateAuthority, type AuthorityAction, type AuthorityGrantPolicyView } from "./authorityPolicy";
import { hasProviderAcceptance, hasVerifiedBooking, isAcceptanceCurrent, paymentCaptureTruthCheck,
  type ProviderAcceptancePolicyView } from "./providerAcceptancePolicy";
import { canUseSignedVendorAgreement, type VendorAgreementPolicyView } from "./vendorAgreementPolicy";
import type { LegalDocumentPolicyView } from "./legalTemplatePolicy";
import type { AuthorizationState } from "../marketplacePayments/marketplacePaymentPolicy";

export type ErrandPurchasePathStatus =
  | "ready_for_operator_execution_review"
  | "blocked_missing_authority"
  | "blocked_missing_vendor_agreement"
  | "blocked_missing_provider_acceptance"
  | "blocked_payment_not_authorized"
  | "requires_operator_confirmation"
  | "unsupported"
  | "infeasible";

export type ErrandPurchasePathInput = {
  pathType: "errand" | "purchase" | "service" | "unsupported";
  authority: AuthorityGrantPolicyView | null;
  action: AuthorityAction;
  planItem: {
    feasibilityClassification: "feasible" | "feasible_with_risk" | "infeasible" | "unsupported";
    itemState: "proposed" | "rejected" | "needs_resident_approval" | "needs_operator_review"
      | "sourcing_required" | "unavailable" | "cancelled";
    riskCategory: "low" | "medium" | "high" | "unknown";
    operatorReviewRequired: boolean;
    residentApprovalRequired: boolean;
  };
  residentApprovalGranted: boolean;
  providerAcceptanceRequired: boolean;
  providerAcceptance: ProviderAcceptancePolicyView | null;
  vendorInvolved: boolean;
  vendorAgreement: VendorAgreementPolicyView | null;
  legalDocument: LegalDocumentPolicyView | null;
  paymentRequired: boolean;
  authorizationState: AuthorizationState;
  operatorConfirmationGranted: boolean;
  now?: Date;
};

export type ErrandPurchasePathDecision = {
  status: ErrandPurchasePathStatus;
  reviewReady: boolean;
  executionReady: false;
  dispatchReady: false;
  paymentReady: false;
  reasons: string[];
};

function decision(status: ErrandPurchasePathStatus, reasons: string[]): ErrandPurchasePathDecision {
  return {
    status,
    reviewReady: status === "ready_for_operator_execution_review",
    executionReady: false,
    dispatchReady: false,
    paymentReady: false,
    reasons: Array.from(new Set(reasons)),
  };
}

export function evaluateErrandPurchasePath(input: ErrandPurchasePathInput): ErrandPurchasePathDecision {
  const now = input.now ?? new Date();
  const item = input.planItem;

  if (input.pathType === "unsupported" || item.feasibilityClassification === "unsupported"
    || item.riskCategory === "unknown") {
    return decision("unsupported", ["path_not_supported"]);
  }
  if (item.feasibilityClassification === "infeasible"
    || item.itemState === "unavailable" || item.itemState === "rejected"
    || item.itemState === "cancelled") {
    return decision("infeasible", ["guest_readiness_item_infeasible"]);
  }
  if (!input.authority) return decision("blocked_missing_authority", ["authority_required"]);

  const authority = evaluateAuthority(input.authority, input.action, now);
  const nonRiskAuthorityReasons = authority.reasons.filter(reason =>
    !["high_risk_excluded", "risk_category_not_allowed"].includes(reason));
  if (nonRiskAuthorityReasons.length > 0) {
    return decision("blocked_missing_authority", nonRiskAuthorityReasons);
  }

  if (input.vendorInvolved) {
    if (!input.vendorAgreement || !input.legalDocument) {
      return decision("blocked_missing_vendor_agreement", ["signed_vendor_agreement_required"]);
    }
    const agreement = canUseSignedVendorAgreement({
      agreement: input.vendorAgreement,
      legalDocument: input.legalDocument,
      now,
    });
    if (!agreement.usable) return decision("blocked_missing_vendor_agreement", agreement.reasons);
  }

  if (input.providerAcceptanceRequired) {
    const acceptance = input.providerAcceptance;
    if (!acceptance || !isAcceptanceCurrent(acceptance, now)
      || !(hasProviderAcceptance(acceptance) || hasVerifiedBooking(acceptance))) {
      return decision("blocked_missing_provider_acceptance", ["provider_acceptance_or_verified_booking_required"]);
    }
    const truth = paymentCaptureTruthCheck({ acceptance, budgetCapCents: input.authority.budgetCapCents,
      planDeadlineAt: input.authority.deadlineAt, now });
    if (!truth.allowed) return decision("blocked_missing_provider_acceptance", truth.reasons);
  }

  if (input.paymentRequired && input.authorizationState !== "authorized") {
    return decision("blocked_payment_not_authorized", ["payment_authorization_required"]);
  }

  const confirmationReasons: string[] = [];
  if (item.riskCategory === "high") confirmationReasons.push("high_risk_operator_confirmation_required");
  if (item.operatorReviewRequired || item.itemState === "needs_operator_review") {
    confirmationReasons.push("operator_review_required");
  }
  if ((item.residentApprovalRequired || item.itemState === "needs_resident_approval")
    && !input.residentApprovalGranted) confirmationReasons.push("resident_approval_required");
  if (authority.residentApprovalRequired && !input.residentApprovalGranted) {
    confirmationReasons.push("resident_approval_required");
  }
  if (item.feasibilityClassification === "feasible_with_risk") {
    confirmationReasons.push("feasible_with_risk_confirmation_required");
  }
  if (confirmationReasons.includes("resident_approval_required")
    || (confirmationReasons.length > 0 && !input.operatorConfirmationGranted)) {
    return decision("requires_operator_confirmation", confirmationReasons);
  }

  return decision("ready_for_operator_execution_review", ["all_review_preconditions_satisfied"]);
}
