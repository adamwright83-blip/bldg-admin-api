import crypto from "node:crypto";
import {
  evaluateTemplateForUse,
  lintOutreachTemplate,
  type LegalDocumentPolicyView,
  type LintRulePolicyView,
  type OutreachTemplatePolicyView,
} from "./legalTemplatePolicy";
import type { VendorMatchOperatorReviewStatus } from "./vendorMatchOperatorReviewPolicy";

export type VendorOutreachDraftBridgeStatus =
  | "draft_not_allowed"
  | "draft_requirements_missing"
  | "draft_ready_to_create";

export type VendorOutreachDraftBridgeDecision = {
  status: VendorOutreachDraftBridgeStatus;
  draftAllowed: boolean;
  reasons: string[];
  subjectRendered: string | null;
  bodyRendered: string;
  bodyHash: string;
  outreachSent: false;
  vendorContacted: false;
  providerMessageCreated: false;
  deliveryAttempted: false;
  booked: false;
  accepted: false;
  dispatched: false;
  paid: false;
  captured: false;
  completed: false;
};

const ADDITIONAL_BANNED_DRAFT_CLAIMS: Array<{ key: string; pattern: RegExp }> = [
  { key: "vendor_selected_for_execution", pattern: /\b(selected|chosen) (?:for|as) (?:this|the) (?:job|execution|engagement)\b/i },
  { key: "approved_vendor_claim", pattern: /\bapproved vendor\b/i },
  { key: "guaranteed_volume", pattern: /\bguaranteed (?:volume|work|jobs)\b/i },
  { key: "guaranteed_payment", pattern: /\bguaranteed (?:payment|paid|payout)\b/i },
  { key: "guaranteed_dispatch", pattern: /\bguaranteed dispatch\b/i },
  { key: "resident_commitment_claim", pattern: /\bresident (?:has |is )?committed\b/i },
];

function renderText(value: string, variables: Record<string, string | number | boolean>): string {
  return value.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : `{{${key}}}`);
}

function checkAdditionalBannedClaims(text: string): string[] {
  const blocking: string[] = [];
  for (const claim of ADDITIONAL_BANNED_DRAFT_CLAIMS) {
    if (claim.pattern.test(text)) blocking.push(claim.key);
  }
  return blocking;
}

function emptyDecision(
  status: VendorOutreachDraftBridgeStatus,
  reasons: string[],
): VendorOutreachDraftBridgeDecision {
  return {
    status, draftAllowed: false, reasons: Array.from(new Set(reasons)),
    subjectRendered: null, bodyRendered: "", bodyHash: crypto.createHash("sha256").update("").digest("hex"),
    outreachSent: false, vendorContacted: false, providerMessageCreated: false, deliveryAttempted: false,
    booked: false, accepted: false, dispatched: false, paid: false, captured: false, completed: false,
  };
}

/**
 * Pure, deterministic bridge from a Slice 27 operator-review decision into
 * draft preparation eligibility. Never sends, contacts, books, dispatches,
 * pays, captures, or completes anything -- those fields are hardcoded false
 * on every return path. Template interpolation only, no generative text
 * model calls, no I/O.
 */
export function evaluateVendorOutreachDraftBridge(input: {
  operatorReviewStatus: VendorMatchOperatorReviewStatus;
  evaluationRunId: string | null;
  candidateId: string | null;
  template: OutreachTemplatePolicyView | null;
  legalDocument: LegalDocumentPolicyView | null;
  lintRules: LintRulePolicyView[];
  variables: Record<string, string | number | boolean>;
  now?: Date;
}): VendorOutreachDraftBridgeDecision {
  if (!input.evaluationRunId) return emptyDecision("draft_not_allowed", ["missing_evaluation_run_id"]);
  if (!input.candidateId) return emptyDecision("draft_not_allowed", ["missing_candidate_id"]);

  if (input.operatorReviewStatus !== "operator_approved_for_draft_only") {
    return emptyDecision("draft_not_allowed", [`operator_review_status_not_approved:${input.operatorReviewStatus}`]);
  }

  const now = input.now ?? new Date();
  const templateDecision = evaluateTemplateForUse({
    template: input.template, requiredLegalDocument: input.legalDocument, lintRules: input.lintRules, now,
  });
  if (!input.template || !templateDecision.usable) {
    return emptyDecision("draft_requirements_missing", templateDecision.reasons.length
      ? templateDecision.reasons : ["approved_template_version_required"]);
  }

  const subjectRendered = input.template.subjectTemplate
    ? renderText(input.template.subjectTemplate, input.variables) : null;
  const bodyRendered = renderText(input.template.bodyTemplate, input.variables);
  const renderedText = [subjectRendered, bodyRendered].filter(Boolean).join("\n");

  const reasons: string[] = [];
  if (/{{\s*[a-zA-Z0-9_.-]+\s*}}/.test(renderedText)) reasons.push("render_variables_missing");

  const renderedLint = lintOutreachTemplate(
    { ...input.template, subjectTemplate: subjectRendered, bodyTemplate: bodyRendered }, input.lintRules);
  if (renderedLint.blockingLintRules.length > 0) reasons.push("rendered_draft_lint_blocked");

  const additionalBlocking = checkAdditionalBannedClaims(renderedText);
  if (additionalBlocking.length > 0) reasons.push("rendered_draft_banned_claim", ...additionalBlocking);

  const bodyHash = crypto.createHash("sha256").update(bodyRendered).digest("hex");
  if (reasons.length > 0) {
    return {
      status: "draft_requirements_missing", draftAllowed: false, reasons: Array.from(new Set(reasons)),
      subjectRendered, bodyRendered, bodyHash,
      outreachSent: false, vendorContacted: false, providerMessageCreated: false, deliveryAttempted: false,
      booked: false, accepted: false, dispatched: false, paid: false, captured: false, completed: false,
    };
  }

  return {
    status: "draft_ready_to_create", draftAllowed: true, reasons: [],
    subjectRendered, bodyRendered, bodyHash,
    outreachSent: false, vendorContacted: false, providerMessageCreated: false, deliveryAttempted: false,
    booked: false, accepted: false, dispatched: false, paid: false, captured: false, completed: false,
  };
}
