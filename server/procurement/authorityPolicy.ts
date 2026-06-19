export const LOW_RISK_CATEGORIES = [
  "flowers",
  "retail_pickup",
  "package_pickup_return",
  "non_entry_errand",
  "dry_cleaning",
  "laundry",
] as const;

export const MEDIUM_RISK_CATEGORIES = [
  "dog_grooming",
  "car_detailing",
  "tailoring",
  "housekeeping",
] as const;

export const HIGH_RISK_CATEGORIES = [
  "unattended_home_access_provisional_vendor",
  "childcare",
  "elder_care",
  "medical_adjacent",
  "alcohol",
  "controlled_substances",
  "weapons",
  "adult_restricted_services",
  "regulated_service_without_full_onboarding",
] as const;

export type RiskLevel = "low" | "medium" | "high";
export type AuthorityStatus = "draft" | "signed" | "active" | "revoked" | "expired";
export type AccessPattern = "no_entry" | "resident_present" | "building_or_operator_approved" | "unattended_entry";

export type AuthorityGrantPolicyView = {
  authorityType: "guest_readiness";
  status: AuthorityStatus;
  budgetCapCents: number;
  deadlineAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  allowedRiskCategories: RiskLevel[];
  disallowedCategories: string[];
  accessConstraints: { allowedPatterns: AccessPattern[] };
};

export type AuthorityAction = {
  authorityType: "guest_readiness";
  category: string;
  spendCents: number;
  scheduledAt: Date;
  accessPattern: AccessPattern;
};

export type PolicyDecision = {
  allowed: boolean;
  denied: boolean;
  residentApprovalRequired: boolean;
  riskLevel: RiskLevel | null;
  reasons: string[];
};

const includes = (values: readonly string[], value: string) => values.includes(value);

export function riskLevelForCategory(category: string): RiskLevel | null {
  if (includes(LOW_RISK_CATEGORIES, category)) return "low";
  if (includes(MEDIUM_RISK_CATEGORIES, category)) return "medium";
  if (includes(HIGH_RISK_CATEGORIES, category)) return "high";
  return null;
}

export function isExpired(grant: AuthorityGrantPolicyView, now = new Date()) {
  return grant.status === "expired" || grant.expiresAt.getTime() <= now.getTime();
}

export function isRevoked(grant: AuthorityGrantPolicyView) {
  return grant.status === "revoked" || grant.revokedAt !== null;
}

export function isActive(grant: AuthorityGrantPolicyView, now = new Date()) {
  return grant.status === "active" && !isExpired(grant, now) && !isRevoked(grant);
}

export function evaluateAuthority(
  grant: AuthorityGrantPolicyView,
  action: AuthorityAction,
  now = new Date(),
): PolicyDecision {
  const reasons: string[] = [];
  const riskLevel = riskLevelForCategory(action.category);

  if (!isActive(grant, now)) reasons.push("authority_not_active");
  if (grant.authorityType !== action.authorityType) reasons.push("outside_authority_scope");
  if (!Number.isSafeInteger(action.spendCents) || action.spendCents < 0) reasons.push("invalid_spend");
  else if (action.spendCents > grant.budgetCapCents) reasons.push("budget_cap_exceeded");
  if (!(action.scheduledAt instanceof Date) || !Number.isFinite(action.scheduledAt.getTime())) {
    reasons.push("invalid_timing");
  } else if (action.scheduledAt.getTime() > grant.deadlineAt.getTime()) {
    reasons.push("deadline_exceeded");
  }
  if (!grant.accessConstraints?.allowedPatterns?.includes(action.accessPattern)) {
    reasons.push("access_pattern_denied");
  }
  if (!riskLevel) reasons.push("unknown_category");
  else if (riskLevel === "high") reasons.push("high_risk_excluded");
  else if (!grant.allowedRiskCategories.includes(riskLevel)) reasons.push("risk_category_not_allowed");
  if (grant.disallowedCategories.includes(action.category)) reasons.push("category_disallowed");

  const residentApprovalRequired = riskLevel === "medium" && reasons.length === 0;
  return {
    allowed: reasons.length === 0 && !residentApprovalRequired,
    denied: reasons.length > 0,
    residentApprovalRequired,
    riskLevel,
    reasons,
  };
}
