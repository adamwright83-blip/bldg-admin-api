export type AcceptanceType = "provider_accepted" | "verified_existing_booking" | "operator_verified";
export type AcceptanceStatus =
  | "draft" | "offered" | "accepted" | "declined" | "countered"
  | "expired" | "cancelled" | "operator_verified";

export type ProviderAcceptancePolicyView = {
  acceptanceType: AcceptanceType;
  acceptanceStatus: AcceptanceStatus;
  expiresAt: Date | null;
  serviceWindowStart: Date | null;
  serviceWindowEnd: Date | null;
  acceptedPriceCents: number | null;
};

export type CaptureTruthCheckInput = {
  acceptance: ProviderAcceptancePolicyView;
  budgetCapCents: number;
  planDeadlineAt: Date;
  now?: Date;
};

export type CaptureTruthCheckDecision = {
  allowed: boolean;
  reasons: string[];
};

export function hasProviderAcceptance(view: ProviderAcceptancePolicyView): boolean {
  return view.acceptanceType === "provider_accepted" && view.acceptanceStatus === "accepted";
}

export function hasVerifiedBooking(view: ProviderAcceptancePolicyView): boolean {
  if (view.acceptanceStatus === "operator_verified") return true;
  return view.acceptanceType === "verified_existing_booking" && view.acceptanceStatus === "accepted";
}

export function isAcceptanceCurrent(view: ProviderAcceptancePolicyView, now = new Date()): boolean {
  if (view.acceptanceStatus === "expired") return false;
  if (!view.expiresAt) return true;
  return view.expiresAt.getTime() > now.getTime();
}

export function isAcceptedPriceKnown(view: ProviderAcceptancePolicyView): boolean {
  return Number.isSafeInteger(view.acceptedPriceCents) && (view.acceptedPriceCents as number) >= 0;
}

export function isAcceptedPriceWithinBudget(view: ProviderAcceptancePolicyView, budgetCapCents: number): boolean {
  if (!isAcceptedPriceKnown(view)) return false;
  return (view.acceptedPriceCents as number) <= budgetCapCents;
}

export function isServiceWindowWithinDeadline(view: ProviderAcceptancePolicyView, planDeadlineAt: Date): boolean {
  if (!view.serviceWindowEnd) return false;
  return view.serviceWindowEnd.getTime() <= planDeadlineAt.getTime();
}

export function isAcceptanceTerminalNegative(view: ProviderAcceptancePolicyView): boolean {
  return view.acceptanceStatus === "declined"
    || view.acceptanceStatus === "countered"
    || view.acceptanceStatus === "expired"
    || view.acceptanceStatus === "cancelled";
}

export function paymentCaptureTruthCheck(input: CaptureTruthCheckInput): CaptureTruthCheckDecision {
  const now = input.now ?? new Date();
  const { acceptance } = input;
  const reasons: string[] = [];

  const eligibleStatus = acceptance.acceptanceStatus === "accepted" || acceptance.acceptanceStatus === "operator_verified";
  if (!eligibleStatus) {
    if (acceptance.acceptanceStatus === "declined") reasons.push("acceptance_declined");
    else if (acceptance.acceptanceStatus === "countered") reasons.push("acceptance_countered");
    else if (acceptance.acceptanceStatus === "expired") reasons.push("acceptance_expired");
    else if (acceptance.acceptanceStatus === "cancelled") reasons.push("acceptance_cancelled");
    else reasons.push("acceptance_not_finalized");
  }

  if (!isAcceptanceCurrent(acceptance, now) && !reasons.includes("acceptance_expired")) {
    reasons.push("acceptance_expired");
  }

  if (!isAcceptedPriceKnown(acceptance)) {
    reasons.push("accepted_price_unknown");
  } else if (!isAcceptedPriceWithinBudget(acceptance, input.budgetCapCents)) {
    reasons.push("accepted_price_over_budget");
  }

  if (!isServiceWindowWithinDeadline(acceptance, input.planDeadlineAt)) {
    reasons.push("service_window_after_deadline");
  }

  if (!(hasProviderAcceptance(acceptance) || hasVerifiedBooking(acceptance))) {
    if (!reasons.includes("acceptance_not_finalized")) reasons.push("no_provider_acceptance_or_verified_booking");
  }

  return { allowed: reasons.length === 0, reasons };
}
