import {
  evaluateAuthority,
  riskLevelForCategory,
  type AccessPattern,
  type AuthorityGrantPolicyView,
} from "./authorityPolicy";

export type PlanTruthState =
  | "draft" | "evaluating" | "feasible" | "feasible_with_risk" | "infeasible"
  | "awaiting_resident_approval" | "awaiting_operator_review" | "unsupported" | "cancelled";
export type PlanStatus = "draft" | "under_review" | "ready" | "blocked" | "cancelled";
export type ItemState =
  | "proposed" | "rejected" | "needs_resident_approval" | "needs_operator_review"
  | "sourcing_required" | "unavailable" | "cancelled";

export type ProposedServiceItem = {
  id: string;
  category: string;
  descriptionText: string;
  estimatedCostCents: number;
  scheduledAt: Date;
  accessPattern: AccessPattern;
  sensitivityTags: string[];
};

export type PlanningConstraints = {
  prohibitedSensitivityTags: string[];
};

export type EvaluatedServiceItem = ProposedServiceItem & {
  riskCategory: "low" | "medium" | "high" | "unknown";
  feasibilityClassification: "feasible" | "feasible_with_risk" | "infeasible" | "unsupported";
  itemState: ItemState;
  residentApprovalRequired: boolean;
  operatorReviewRequired: boolean;
  reasons: string[];
};

export type GuestReadinessPlanDecision = {
  truthState: PlanTruthState;
  planStatus: PlanStatus;
  estimatedTotalCents: number;
  approvalGates: Array<"resident_approval" | "operator_review">;
  reasons: string[];
  items: EvaluatedServiceItem[];
};

export function evaluateGuestReadinessPlan(input: {
  authority: AuthorityGrantPolicyView;
  constraints: PlanningConstraints;
  items: ProposedServiceItem[];
  now?: Date;
}): GuestReadinessPlanDecision {
  const now = input.now ?? new Date();
  let cumulativeSpend = 0;
  const items = input.items.map(item => {
    cumulativeSpend += Number.isSafeInteger(item.estimatedCostCents) ? item.estimatedCostCents : 0;
    const authorityDecision = evaluateAuthority(input.authority, {
      authorityType: "guest_readiness",
      category: item.category,
      spendCents: cumulativeSpend,
      scheduledAt: item.scheduledAt,
      accessPattern: item.accessPattern,
    }, now);
    const reasons = [...authorityDecision.reasons];
    if (item.sensitivityTags.some(tag => input.constraints.prohibitedSensitivityTags.includes(tag))) {
      reasons.push("sensitivity_constraint_conflict");
    }
    if (item.accessPattern === "building_or_operator_approved") reasons.push("operator_review_required");

    const riskCategory: EvaluatedServiceItem["riskCategory"] = riskLevelForCategory(item.category) ?? "unknown";
    const unsupported = riskCategory === "unknown" || riskCategory === "high";
    const operatorReviewRequired = reasons.includes("operator_review_required");
    const residentApprovalRequired = authorityDecision.residentApprovalRequired;
    const blockingReasons = reasons.filter(reason => reason !== "operator_review_required");
    const feasibilityClassification = unsupported
      ? "unsupported" as const
      : blockingReasons.length > 0
        ? "infeasible" as const
        : residentApprovalRequired || operatorReviewRequired
          ? "feasible_with_risk" as const
          : "feasible" as const;
    const itemState: ItemState = unsupported
      ? "rejected"
      : blockingReasons.length > 0
        ? "unavailable"
        : operatorReviewRequired
          ? "needs_operator_review"
          : residentApprovalRequired
            ? "needs_resident_approval"
            : "sourcing_required";
    return { ...item, riskCategory, feasibilityClassification, itemState,
      residentApprovalRequired, operatorReviewRequired, reasons };
  });

  const approvalGates = [
    ...(items.some(item => item.residentApprovalRequired) ? ["resident_approval" as const] : []),
    ...(items.some(item => item.operatorReviewRequired) ? ["operator_review" as const] : []),
  ];
  const reasons = Array.from(new Set(items.flatMap(item => item.reasons)));
  const truthState: PlanTruthState = items.length === 0
    ? "unsupported"
    : items.some(item => item.feasibilityClassification === "unsupported")
      ? "unsupported"
      : items.some(item => item.feasibilityClassification === "infeasible")
        ? "infeasible"
        : approvalGates.includes("operator_review")
          ? "awaiting_operator_review"
          : approvalGates.includes("resident_approval")
            ? "awaiting_resident_approval"
            : items.some(item => item.feasibilityClassification === "feasible_with_risk")
              ? "feasible_with_risk"
              : "feasible";
  const planStatus: PlanStatus = truthState === "feasible"
    ? "ready"
    : truthState.startsWith("awaiting_") || truthState === "feasible_with_risk"
      ? "under_review"
      : "blocked";
  return { truthState, planStatus, estimatedTotalCents: cumulativeSpend, approvalGates, reasons, items };
}
