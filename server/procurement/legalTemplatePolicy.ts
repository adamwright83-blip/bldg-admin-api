export type VersionStatus = "draft" | "approved" | "retired";
export type TemplatePurpose =
  | "vendor_availability_request" | "vendor_rate_request" | "vendor_onboarding_invite"
  | "operator_note" | "other";

export type LegalDocumentPolicyView = {
  documentKey: string;
  version: string;
  status: VersionStatus;
  bodyHash: string;
  termsHash: string;
  approvedAt: Date | null;
  effectiveAt: Date | null;
  retiredAt: Date | null;
};

export type OutreachTemplatePolicyView = {
  templateKey: string;
  version: string;
  status: VersionStatus;
  templatePurpose: TemplatePurpose;
  subjectTemplate: string | null;
  bodyTemplate: string;
  bodyHash: string;
  approvedAt: Date | null;
  effectiveAt: Date | null;
  retiredAt: Date | null;
  requiredLegalDocumentKey: string | null;
  requiredLegalDocumentVersion: string | null;
};

export type LintRulePolicyView = {
  ruleKey: string;
  ruleType: "banned_claim" | "required_disclosure" | "variable_required";
  severity: "block" | "warn";
  patternOrClaim: string;
  appliesToPurpose: TemplatePurpose | null;
  status: "active" | "inactive";
};

export type TemplateUseDecision = {
  usable: boolean;
  reasons: string[];
  blockingLintRules: string[];
  warnings: string[];
};

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const BUILT_IN_BANNED_CLAIMS: Array<{ key: string; pattern: RegExp }> = [
  { key: "fabricated_urgency", pattern: /\b(act now|limited time|spots? (?:are )?filling fast|last chance)\b/i },
  { key: "guaranteed_booking", pattern: /\b(guaranteed (?:booking|booked|availability)|booking guaranteed)\b/i },
  { key: "guaranteed_pricing", pattern: /\b(guaranteed (?:price|pricing|rate)|lowest price guaranteed)\b/i },
  { key: "false_exclusivity", pattern: /\b(exclusive (?:partner|provider)|only approved provider)\b/i },
  { key: "fake_endorsement", pattern: /\b(recommended|endorsed|approved) by (?:your|the) building\b/i },
  { key: "false_booked_state", pattern: /\b(you are|you're|your service is|we have) booked\b/i },
  { key: "false_scheduled_state", pattern: /\bwe have scheduled\b/i },
  { key: "false_resident_booked_claim", pattern: /\bthe resident has booked\b/i },
  { key: "false_payment_ready_claim", pattern: /\bpayment is ready\b/i },
  { key: "false_confirmed_state", pattern: /\byou are confirmed\b/i },
];

function validDate(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function versionIsEffective(input: {
  status: VersionStatus; approvedAt: Date | null; effectiveAt: Date | null; retiredAt: Date | null;
}, now: Date) {
  return input.status === "approved"
    && validDate(input.approvedAt)
    && validDate(input.effectiveAt)
    && input.effectiveAt.getTime() <= now.getTime()
    && input.retiredAt === null;
}

export function canUseLegalDocument(document: LegalDocumentPolicyView | null, now = new Date()) {
  if (!document) return false;
  return versionIsEffective(document, now)
    && HASH_PATTERN.test(document.bodyHash)
    && HASH_PATTERN.test(document.termsHash);
}

export function lintOutreachTemplate(
  template: Pick<OutreachTemplatePolicyView, "templatePurpose" | "subjectTemplate" | "bodyTemplate">,
  rules: LintRulePolicyView[],
) {
  const text = [template.subjectTemplate, template.bodyTemplate].filter(Boolean).join("\n");
  const blockingLintRules: string[] = [];
  const warnings: string[] = [];
  for (const claim of BUILT_IN_BANNED_CLAIMS) {
    if (claim.pattern.test(text)) blockingLintRules.push(claim.key);
  }
  for (const rule of rules) {
    if (rule.status !== "active" || (rule.appliesToPurpose && rule.appliesToPurpose !== template.templatePurpose)) continue;
    const claim = rule.patternOrClaim.trim();
    if (!claim) {
      if (rule.severity === "block") blockingLintRules.push(`${rule.ruleKey}:invalid_rule`);
      continue;
    }
    const found = text.toLocaleLowerCase("en-US").includes(claim.toLocaleLowerCase("en-US"));
    if (rule.ruleType === "banned_claim" && found) {
      (rule.severity === "block" ? blockingLintRules : warnings).push(rule.ruleKey);
    } else if (rule.ruleType === "required_disclosure" && !found) {
      (rule.severity === "block" ? blockingLintRules : warnings).push(rule.ruleKey);
    } else if (rule.ruleType === "variable_required" && !text.includes(`{{${claim}}}`)) {
      (rule.severity === "block" ? blockingLintRules : warnings).push(rule.ruleKey);
    }
  }
  return { blockingLintRules: Array.from(new Set(blockingLintRules)), warnings: Array.from(new Set(warnings)) };
}

export function evaluateTemplateForUse(input: {
  template: OutreachTemplatePolicyView | null;
  requiredLegalDocument: LegalDocumentPolicyView | null;
  lintRules: LintRulePolicyView[];
  now?: Date;
}): TemplateUseDecision {
  const reasons: string[] = [];
  if (!input.template) return { usable: false, reasons: ["approved_template_version_required"], blockingLintRules: [], warnings: [] };
  const template = input.template;
  const now = input.now ?? new Date();
  if (!versionIsEffective(template, now)) reasons.push("template_not_approved_effective");
  if (!HASH_PATTERN.test(template.bodyHash)) reasons.push("template_body_hash_invalid");
  const requiresDocument = template.requiredLegalDocumentKey !== null || template.requiredLegalDocumentVersion !== null;
  if (requiresDocument) {
    if (!template.requiredLegalDocumentKey || !template.requiredLegalDocumentVersion) {
      reasons.push("required_legal_document_reference_incomplete");
    } else if (!input.requiredLegalDocument
      || input.requiredLegalDocument.documentKey !== template.requiredLegalDocumentKey
      || input.requiredLegalDocument.version !== template.requiredLegalDocumentVersion) {
      reasons.push("required_legal_document_version_mismatch");
    } else if (!canUseLegalDocument(input.requiredLegalDocument, now)) {
      reasons.push("required_legal_document_not_usable");
    }
  }
  const lint = lintOutreachTemplate(template, input.lintRules);
  if (lint.blockingLintRules.length > 0) reasons.push("template_lint_blocked");
  return { usable: reasons.length === 0, reasons, ...lint };
}
