import crypto from "node:crypto";
import {
  evaluateTemplateForUse,
  lintOutreachTemplate,
  type LegalDocumentPolicyView,
  type LintRulePolicyView,
  type OutreachTemplatePolicyView,
} from "./legalTemplatePolicy";

export type DraftRenderingDecision = {
  allowed: boolean;
  sendable: false;
  reasons: string[];
  subjectRendered: string | null;
  bodyRendered: string;
  bodyHash: string;
  lintResult: { blockingLintRules: string[]; warnings: string[] };
};

function renderText(value: string, variables: Record<string, string | number | boolean>) {
  return value.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : `{{${key}}}`);
}

export function renderVendorOutreachDraft(input: {
  candidateStatus: string;
  template: OutreachTemplatePolicyView | null;
  legalDocument: LegalDocumentPolicyView | null;
  lintRules: LintRulePolicyView[];
  variables: Record<string, string | number | boolean>;
  now?: Date;
}): DraftRenderingDecision {
  const reasons: string[] = [];
  if (input.candidateStatus !== "approved_for_outreach") reasons.push("candidate_not_approved_for_outreach");
  const templateDecision = evaluateTemplateForUse({ template: input.template,
    requiredLegalDocument: input.legalDocument, lintRules: input.lintRules, now: input.now });
  reasons.push(...templateDecision.reasons);
  if (!input.template) return { allowed: false, sendable: false, reasons,
    subjectRendered: null, bodyRendered: "", bodyHash: crypto.createHash("sha256").update("").digest("hex"),
    lintResult: { blockingLintRules: templateDecision.blockingLintRules, warnings: templateDecision.warnings } };
  const subjectRendered = input.template.subjectTemplate
    ? renderText(input.template.subjectTemplate, input.variables) : null;
  const bodyRendered = renderText(input.template.bodyTemplate, input.variables);
  if (/{{\s*[a-zA-Z0-9_.-]+\s*}}/.test([subjectRendered, bodyRendered].filter(Boolean).join("\n"))) {
    reasons.push("render_variables_missing");
  }
  const renderedLint = lintOutreachTemplate({ ...input.template, subjectTemplate: subjectRendered, bodyTemplate: bodyRendered }, input.lintRules);
  if (renderedLint.blockingLintRules.length > 0) reasons.push("rendered_draft_lint_blocked");
  return { allowed: reasons.length === 0, sendable: false, reasons: Array.from(new Set(reasons)),
    subjectRendered, bodyRendered, bodyHash: crypto.createHash("sha256").update(bodyRendered).digest("hex"),
    lintResult: renderedLint };
}

export function canRecordConversationEvidence(input: {
  direction: string; summary: string; occurredAt: Date;
}) {
  const reasons: string[] = [];
  if (!['inbound', 'outbound_manual_note'].includes(input.direction)) reasons.push("conversation_direction_not_recordable");
  if (!input.summary.trim()) reasons.push("conversation_summary_required");
  if (!(input.occurredAt instanceof Date) || !Number.isFinite(input.occurredAt.getTime())) reasons.push("conversation_time_invalid");
  return { allowed: reasons.length === 0, reasons, agreementAccepted: false, providerAccepted: false };
}
