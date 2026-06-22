import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  containsFounderEscalationLine, evaluatePostConsentActionPlan,
  POST_CONSENT_OUTREACH_TEMPLATE_KEY, POST_CONSENT_OUTREACH_TEMPLATE_VERSION,
  type PostConsentActionPlanDecision, type PostConsentActionPlanStatus,
} from "./postConsentActionPlanPolicy";
import { VendorProposalReviewStore, type AdminProposalVersionPreview } from "./vendorProposalReviewStore";
import type { LegalDocumentPolicyView, LintRulePolicyView, OutreachTemplatePolicyView } from "./legalTemplatePolicy";

type ConsentRow = RowDataPacket & {
  id: string; proposal_version_id: string; tenant_id: string; bldg_user_id: number;
  proposal_version_snapshot_hash: string;
};
type PlanRow = RowDataPacket & {
  id: string; consent_id: string; proposal_version_id: string; tenant_id: string; bldg_user_id: number;
  status: PostConsentActionPlanStatus; reasons_json: unknown; eligible_for_auto_send_pilot: number;
  proposal_version_snapshot_hash: string; created_by: string; created_at: Date; updated_at: Date;
};
type DraftRow = RowDataPacket & {
  id: string; plan_id: string; consent_id: string; proposal_version_id: string; tenant_id: string;
  bldg_user_id: number; vendor_candidate_id: string; service_category: string | null;
  template_key: string; template_version: string; subject_rendered: string | null; draft_body: string;
  draft_body_hash: string; variables_json: unknown; lint_result_json: unknown;
  founder_escalation_present: number; status: string; created_by: string; created_at: Date; updated_at: Date;
};
type CandidateRow = RowDataPacket & { sourcing_status: string; contact_json: unknown; business_name: string };
type TemplateRow = RowDataPacket & {
  template_key: string; version: string; status: string; template_purpose: string;
  subject_template: string | null; body_template: string; body_hash: string; outreach_channel: string;
  approved_at: Date | null; effective_at: Date | null; retired_at: Date | null;
  required_legal_document_key: string | null; required_legal_document_version: string | null;
};
type LegalDocumentRow = RowDataPacket & {
  document_key: string; version: string; status: string; body_hash: string; terms_hash: string;
  approved_at: Date | null; effective_at: Date | null; retired_at: Date | null;
};
type LintRuleRow = RowDataPacket & {
  rule_key: string; rule_type: string; severity: string; pattern_or_claim: string;
  applies_to_purpose: string | null; status: string;
};

export type PostConsentActionPlanRecord = {
  id: string; consentId: string; proposalVersionId: string; tenantId: string; bldgUserId: number;
  status: PostConsentActionPlanStatus; reasons: string[]; eligibleForAutoSendPilot: boolean;
  proposalVersionSnapshotHash: string; createdBy: string; createdAt: Date; updatedAt: Date;
};

export type PostConsentOutreachDraftRecord = {
  id: string; planId: string; consentId: string; proposalVersionId: string; tenantId: string;
  bldgUserId: number; vendorCandidateId: string; serviceCategory: string | null; templateKey: string;
  templateVersion: string; subjectRendered: string | null; draftBody: string; draftBodyHash: string;
  variables: Record<string, unknown>; founderEscalationPresent: boolean;
  status: "drafted" | "blocked" | "stale" | "superseded"; createdBy: string; createdAt: Date; updatedAt: Date;
};

function offeredWindowLabel(proposal: AdminProposalVersionPreview): string | null {
  const window = proposal.terms.availabilityWindows[0];
  if (!window) return null;
  return `${new Date(window.start).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })}`
    + `–${new Date(window.end).toLocaleTimeString("en-US", { timeStyle: "short", timeZone: "UTC" })}`;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

/**
 * Reads resident_proposal_consents, vendor_proposal_versions (via
 * VendorProposalReviewStore, read-only), vendor_sourcing_candidates,
 * outreach_template_versions, legal_document_versions, and
 * outreach_template_lint_rules -- all read-only. Writes only to
 * post_consent_action_plans and post_consent_outreach_drafts. This store
 * is proposal-scoped only -- it has no dependency on any legacy
 * procurement-workflow concept existing for the underlying proposal. No
 * other table in this system is ever written to, and no real-world action
 * of any kind is ever performed.
 */
export class PostConsentActionPlanStore {
  private readonly reviewStore: Pick<VendorProposalReviewStore, "getVersion">;

  constructor(private readonly pool: Pool, injectedReviewStore?: Pick<VendorProposalReviewStore, "getVersion">) {
    this.reviewStore = injectedReviewStore ?? new VendorProposalReviewStore(pool);
  }

  async runPlan(input: {
    id: string; consentId: string; createdBy: string; draftId?: string; now?: Date;
  }): Promise<{ decision: PostConsentActionPlanDecision; plan: PostConsentActionPlanRecord; draft: PostConsentOutreachDraftRecord | null }> {
    const existingPlan = await this.readExistingPlan(this.pool, input.consentId);
    if (existingPlan) {
      const existingDraft = await this.readDraftByPlanId(this.pool, existingPlan.id);
      return { decision: this.decisionFromRecord(existingPlan), plan: existingPlan, draft: existingDraft };
    }

    const now = input.now ?? new Date();
    const consent = await this.readConsent(this.pool, input.consentId);
    if (!consent) throw new Error("Resident proposal consent not found");

    const proposal = await this.reviewStore.getVersion(consent.proposal_version_id, now);
    const candidate = proposal ? await this.readCandidate(this.pool, proposal.candidate.id) : null;
    const template = await this.readTemplate(
      this.pool, POST_CONSENT_OUTREACH_TEMPLATE_KEY, POST_CONSENT_OUTREACH_TEMPLATE_VERSION);
    let legalDocument: LegalDocumentPolicyView | null = null;
    if (template?.requiredLegalDocumentKey && template.requiredLegalDocumentVersion) {
      legalDocument = await this.readLegalDocument(
        this.pool, template.requiredLegalDocumentKey, template.requiredLegalDocumentVersion);
    }
    const lintRules = await this.readActiveLintRules(this.pool);

    const variables: Record<string, string | number | boolean> = proposal ? {
      serviceLabel: proposal.jobCard.serviceLabel ?? proposal.candidate.category,
      serviceCategory: proposal.jobCard.category ?? proposal.candidate.category,
      vendorName: proposal.candidate.businessName,
      offeredWindow: offeredWindowLabel(proposal) ?? "a time to be confirmed",
    } : {};

    const decision = evaluatePostConsentActionPlan({
      consentProposalVersionSnapshotHash: consent.proposal_version_snapshot_hash,
      proposal: proposal ? {
        proposalId: proposal.proposalId, expired: proposal.expired, readiness: proposal.readiness,
        jobCardReference: proposal.jobCardReference, jobCard: proposal.jobCard, candidate: proposal.candidate,
      } : null,
      vendorContact: { hasUsableChannel: Boolean(candidate?.contact_json && Object.keys(candidate.contact_json as object).length > 0) },
      candidateSourcingStatus: candidate?.sourcing_status ?? "unknown",
      template, legalDocument, lintRules, variables, now,
    });

    const draftId = decision.status === "draft_vendor_outreach" ? (input.draftId ?? input.id) : null;
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.execute(
        `INSERT IGNORE INTO post_consent_action_plans
          (id, consent_id, proposal_version_id, tenant_id, bldg_user_id, status, reasons_json,
           eligible_for_auto_send_pilot, proposal_version_snapshot_hash, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.id, input.consentId, consent.proposal_version_id, consent.tenant_id, consent.bldg_user_id,
         decision.status, JSON.stringify(decision.reasons), decision.eligibleForAutoSendPilot ? 1 : 0,
         consent.proposal_version_snapshot_hash, input.createdBy]);

      if (draftId && decision.draftRendering && proposal && template) {
        const founderLinePresent = containsFounderEscalationLine(decision.draftRendering.bodyRendered);
        await connection.execute(
          `INSERT IGNORE INTO post_consent_outreach_drafts
            (id, plan_id, consent_id, proposal_version_id, tenant_id, bldg_user_id, vendor_candidate_id,
             service_category, template_key, template_version, subject_rendered, draft_body, draft_body_hash,
             variables_json, lint_result_json, founder_escalation_present, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'drafted', ?)`,
          [draftId, input.id, input.consentId, consent.proposal_version_id, consent.tenant_id, consent.bldg_user_id,
           proposal.candidate.id, proposal.jobCard.category ?? proposal.candidate.category,
           template.templateKey, template.version, decision.draftRendering.subjectRendered,
           decision.draftRendering.bodyRendered, decision.draftRendering.bodyHash, JSON.stringify(variables),
           JSON.stringify(decision.draftRendering.lintResult), founderLinePresent ? 1 : 0, input.createdBy]);
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const plan = await this.readExistingPlan(this.pool, input.consentId);
    if (!plan) throw new Error("Post-consent action plan failed to persist");
    const draft = await this.readDraftByPlanId(this.pool, plan.id);
    return { decision, plan, draft };
  }

  async getPlanByConsentId(consentId: string): Promise<PostConsentActionPlanRecord | null> {
    return this.readExistingPlan(this.pool, consentId);
  }

  async getDraftByPlanId(planId: string): Promise<PostConsentOutreachDraftRecord | null> {
    return this.readDraftByPlanId(this.pool, planId);
  }

  private decisionFromRecord(record: PostConsentActionPlanRecord): PostConsentActionPlanDecision {
    return {
      status: record.status, allowed: record.status === "draft_vendor_outreach", reasons: record.reasons,
      eligibleForAutoSendPilot: false, outreachSent: false, vendorContacted: false, booked: false,
      accepted: false, paid: false, captured: false, dispatched: false, completed: false, llmCalled: false,
      draftRendering: null,
    };
  }

  private async readExistingPlan(
    connection: Pool | PoolConnection, consentId: string,
  ): Promise<PostConsentActionPlanRecord | null> {
    const [rows] = await connection.execute<PlanRow[]>(
      `SELECT id, consent_id, proposal_version_id, tenant_id, bldg_user_id, status, reasons_json,
              eligible_for_auto_send_pilot, proposal_version_snapshot_hash, created_by, created_at, updated_at
         FROM post_consent_action_plans WHERE consent_id = ? LIMIT 1`,
      [consentId]);
    const row = rows[0];
    if (!row) return null;
    const reasons = parseJson(row.reasons_json);
    return {
      id: row.id, consentId: row.consent_id, proposalVersionId: row.proposal_version_id,
      tenantId: row.tenant_id, bldgUserId: row.bldg_user_id, status: row.status,
      reasons: Array.isArray(reasons) ? reasons : [],
      eligibleForAutoSendPilot: Boolean(row.eligible_for_auto_send_pilot),
      proposalVersionSnapshotHash: row.proposal_version_snapshot_hash, createdBy: row.created_by,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  private async readDraftByPlanId(
    connection: Pool | PoolConnection, planId: string,
  ): Promise<PostConsentOutreachDraftRecord | null> {
    const [rows] = await connection.execute<DraftRow[]>(
      `SELECT id, plan_id, consent_id, proposal_version_id, tenant_id, bldg_user_id, vendor_candidate_id,
              service_category, template_key, template_version, subject_rendered, draft_body, draft_body_hash,
              variables_json, lint_result_json, founder_escalation_present, status, created_by, created_at, updated_at
         FROM post_consent_outreach_drafts WHERE plan_id = ? LIMIT 1`,
      [planId]);
    const row = rows[0];
    if (!row) return null;
    const variables = parseJson(row.variables_json);
    return {
      id: row.id, planId: row.plan_id, consentId: row.consent_id, proposalVersionId: row.proposal_version_id,
      tenantId: row.tenant_id, bldgUserId: row.bldg_user_id, vendorCandidateId: row.vendor_candidate_id,
      serviceCategory: row.service_category, templateKey: row.template_key, templateVersion: row.template_version,
      subjectRendered: row.subject_rendered, draftBody: row.draft_body, draftBodyHash: row.draft_body_hash,
      variables: typeof variables === "object" && variables !== null ? variables as Record<string, unknown> : {},
      founderEscalationPresent: Boolean(row.founder_escalation_present), status: row.status as never,
      createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  private async readConsent(connection: Pool | PoolConnection, consentId: string): Promise<ConsentRow | null> {
    const [rows] = await connection.execute<ConsentRow[]>(
      `SELECT id, proposal_version_id, tenant_id, bldg_user_id, proposal_version_snapshot_hash
         FROM resident_proposal_consents WHERE id = ? LIMIT 1`,
      [consentId]);
    return rows[0] ?? null;
  }

  private async readCandidate(connection: Pool | PoolConnection, candidateId: string): Promise<CandidateRow | null> {
    const [rows] = await connection.execute<CandidateRow[]>(
      `SELECT sourcing_status, contact_json, business_name FROM vendor_sourcing_candidates WHERE id = ? LIMIT 1`,
      [candidateId]);
    return rows[0] ?? null;
  }

  private async readTemplate(
    connection: Pool | PoolConnection, templateKey: string, templateVersion: string,
  ): Promise<(OutreachTemplatePolicyView & { outreachChannel: string }) | null> {
    const [rows] = await connection.execute<TemplateRow[]>(
      `SELECT template_key, version, status, template_purpose, subject_template, body_template, body_hash,
              outreach_channel, approved_at, effective_at, retired_at,
              required_legal_document_key, required_legal_document_version
         FROM outreach_template_versions WHERE template_key = ? AND version = ? FOR SHARE`,
      [templateKey, templateVersion]);
    const row = rows[0];
    if (!row) return null;
    return {
      templateKey: String(row.template_key), version: String(row.version), status: row.status as never,
      templatePurpose: row.template_purpose as never, subjectTemplate: row.subject_template ?? null,
      bodyTemplate: String(row.body_template), bodyHash: String(row.body_hash), outreachChannel: row.outreach_channel,
      approvedAt: row.approved_at ? new Date(row.approved_at) : null,
      effectiveAt: row.effective_at ? new Date(row.effective_at) : null,
      retiredAt: row.retired_at ? new Date(row.retired_at) : null,
      requiredLegalDocumentKey: row.required_legal_document_key ?? null,
      requiredLegalDocumentVersion: row.required_legal_document_version ?? null,
    };
  }

  private async readLegalDocument(
    connection: Pool | PoolConnection, documentKey: string, version: string,
  ): Promise<LegalDocumentPolicyView | null> {
    const [rows] = await connection.execute<LegalDocumentRow[]>(
      `SELECT document_key, version, status, body_hash, terms_hash, approved_at, effective_at, retired_at
         FROM legal_document_versions WHERE document_key = ? AND version = ? FOR SHARE`,
      [documentKey, version]);
    const row = rows[0];
    if (!row) return null;
    return {
      documentKey: String(row.document_key), version: String(row.version), status: row.status as never,
      bodyHash: String(row.body_hash), termsHash: String(row.terms_hash),
      approvedAt: row.approved_at ? new Date(row.approved_at) : null,
      effectiveAt: row.effective_at ? new Date(row.effective_at) : null,
      retiredAt: row.retired_at ? new Date(row.retired_at) : null,
    };
  }

  private async readActiveLintRules(connection: Pool | PoolConnection): Promise<LintRulePolicyView[]> {
    const [rows] = await connection.execute<LintRuleRow[]>(
      `SELECT rule_key, rule_type, severity, pattern_or_claim, applies_to_purpose, status
         FROM outreach_template_lint_rules WHERE status = 'active'`, []);
    return rows.map(row => ({
      ruleKey: String(row.rule_key), ruleType: row.rule_type as never, severity: row.severity as never,
      patternOrClaim: String(row.pattern_or_claim), appliesToPurpose: row.applies_to_purpose as never,
      status: row.status as never,
    }));
  }
}
