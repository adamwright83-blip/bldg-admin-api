import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type { LegalDocumentPolicyView, LintRulePolicyView, OutreachTemplatePolicyView } from "./legalTemplatePolicy";
import { canRecordConversationEvidence, renderVendorOutreachDraft } from "./vendorOutreachDraftingPolicy";

export class VendorOutreachDraftingStore {
  constructor(private readonly pool: Pool) {}

  async createDraft(input: {
    id: string; candidateId: string; tenantId: string; scoreId?: string | null;
    templateKey: string; templateVersion: string;
    variables: Record<string, string | number | boolean>; createdBy: string; now?: Date;
  }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [candidateRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, sourcing_status FROM vendor_sourcing_candidates
          WHERE id = ? AND tenant_id = ? FOR UPDATE`, [input.candidateId, input.tenantId]);
      const candidate = candidateRows[0];
      if (!candidate) throw new Error("Vendor sourcing candidate not found");
      const [workflowRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM procurement_workflows WHERE workflow_key = ? FOR UPDATE`,
        [`vendor_sourcing:${input.candidateId}`]);
      const workflowId = String(workflowRows[0]?.id ?? "");
      if (!workflowId) throw new Error("Vendor sourcing workflow not found");
      if (input.scoreId) {
        const [scoreRows] = await connection.execute<RowDataPacket[]>(
          `SELECT id FROM vendor_sourcing_candidate_scores WHERE id = ? AND candidate_id = ?`,
          [input.scoreId, input.candidateId]);
        if (!scoreRows[0]) throw new Error("Vendor sourcing score does not match candidate");
      }
      const [templateRows] = await connection.execute<RowDataPacket[]>(
        `SELECT template_key, version, status, template_purpose, outreach_channel,
                subject_template, body_template, body_hash, approved_at, effective_at, retired_at,
                required_legal_document_key, required_legal_document_version
           FROM outreach_template_versions WHERE template_key = ? AND version = ? FOR SHARE`,
        [input.templateKey, input.templateVersion]);
      const templateRow = templateRows[0];
      const template = templateRow ? this.mapTemplate(templateRow) : null;
      let legalDocument: LegalDocumentPolicyView | null = null;
      if (template?.requiredLegalDocumentKey && template.requiredLegalDocumentVersion) {
        const [legalRows] = await connection.execute<RowDataPacket[]>(
          `SELECT document_key, version, status, body_hash, terms_hash, approved_at, effective_at, retired_at
             FROM legal_document_versions WHERE document_key = ? AND version = ? FOR SHARE`,
          [template.requiredLegalDocumentKey, template.requiredLegalDocumentVersion]);
        legalDocument = legalRows[0] ? this.mapLegalDocument(legalRows[0]) : null;
      }
      const [lintRows] = await connection.execute<RowDataPacket[]>(
        `SELECT rule_key, rule_type, severity, pattern_or_claim, applies_to_purpose, status
           FROM outreach_template_lint_rules WHERE status = 'active'`, []);
      const lintRules = lintRows.map(row => this.mapLintRule(row));
      const decision = renderVendorOutreachDraft({ candidateStatus: String(candidate.sourcing_status),
        template, legalDocument, lintRules, variables: input.variables, now: input.now });
      if (!decision.allowed || !template) {
        throw new Error(`Vendor outreach draft denied: ${decision.reasons.join(",")}`);
      }
      const gateKey = `vendor_outreach_draft_review:${input.id}`;
      await connection.execute(
        `INSERT IGNORE INTO procurement_operator_gates
          (workflow_id, gate_key, status, prompt_json, evidence_json, requested_by)
         VALUES (?, ?, 'pending', ?, ?, ?)`,
        [workflowId, gateKey, JSON.stringify({ action: "review_vendor_outreach_draft", draftId: input.id }),
         JSON.stringify({ candidateId: input.candidateId, templateKey: input.templateKey,
           templateVersion: input.templateVersion, lintResult: decision.lintResult }), input.createdBy]);
      const [gateRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM procurement_operator_gates WHERE workflow_id = ? AND gate_key = ? FOR UPDATE`,
        [workflowId, gateKey]);
      const gateId = String(gateRows[0]?.id ?? "");
      if (!gateId) throw new Error("Unable to resolve vendor outreach draft review gate");
      await connection.execute(
        `INSERT INTO vendor_outreach_drafts
          (id, candidate_id, workflow_id, score_id, template_key, template_version,
           legal_document_key, legal_document_version, outreach_channel, draft_status,
           subject_rendered, body_rendered, body_hash, render_variables_json, lint_result_json,
           operator_gate_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'needs_operator_review', ?, ?, ?, ?, ?, ?, ?)`,
        [input.id, input.candidateId, workflowId, input.scoreId ?? null, template.templateKey,
         template.version, template.requiredLegalDocumentKey, template.requiredLegalDocumentVersion,
         String(templateRow.outreach_channel), decision.subjectRendered, decision.bodyRendered,
         decision.bodyHash, JSON.stringify(input.variables), JSON.stringify(decision.lintResult),
         gateId, input.createdBy]);
      await connection.commit();
      return { id: input.id, gateId, sendable: false as const };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async recordConversationEvent(input: {
    id: string; candidateId: string; tenantId: string; outreachDraftId?: string | null;
    direction: "inbound" | "outbound_manual_note"; channel: string; eventStatus?: string;
    occurredAt: Date; summary: string; rawPayload: unknown; evidence: unknown; createdBy: string;
  }) {
    const decision = canRecordConversationEvidence(input);
    if (!decision.allowed) throw new Error(`Vendor conversation evidence denied: ${decision.reasons.join(",")}`);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [candidateRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM vendor_sourcing_candidates WHERE id = ? AND tenant_id = ? FOR SHARE`,
        [input.candidateId, input.tenantId]);
      if (!candidateRows[0]) throw new Error("Vendor sourcing candidate not found");
      const [workflowRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM procurement_workflows WHERE workflow_key = ? FOR SHARE`,
        [`vendor_sourcing:${input.candidateId}`]);
      const workflowId = String(workflowRows[0]?.id ?? "");
      if (!workflowId) throw new Error("Vendor sourcing workflow not found");
      if (input.outreachDraftId) {
        const [draftRows] = await connection.execute<RowDataPacket[]>(
          `SELECT id FROM vendor_outreach_drafts WHERE id = ? AND candidate_id = ?`,
          [input.outreachDraftId, input.candidateId]);
        if (!draftRows[0]) throw new Error("Vendor outreach draft does not match candidate");
      }
      await connection.execute(
        `INSERT INTO vendor_outreach_conversation_events
          (id, candidate_id, outreach_draft_id, workflow_id, direction, channel, event_status,
           occurred_at, summary, raw_payload_json, evidence_json, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.id, input.candidateId, input.outreachDraftId ?? null, workflowId, input.direction,
         input.channel, input.eventStatus ?? "recorded", input.occurredAt, input.summary.trim(),
         JSON.stringify(input.rawPayload), JSON.stringify(input.evidence), input.createdBy]);
      await connection.commit();
      return { id: input.id, agreementAccepted: false as const, providerAccepted: false as const };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getDraft(id: string) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(`SELECT * FROM vendor_outreach_drafts WHERE id = ?`, [id]);
    return rows[0] ?? null;
  }

  async listDrafts(candidateId: string) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM vendor_outreach_drafts WHERE candidate_id = ? ORDER BY created_at DESC`, [candidateId]);
    return rows;
  }

  async listConversationEvents(candidateId: string) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM vendor_outreach_conversation_events WHERE candidate_id = ? ORDER BY occurred_at DESC`, [candidateId]);
    return rows;
  }

  private mapTemplate(row: RowDataPacket): OutreachTemplatePolicyView {
    return { templateKey: String(row.template_key), version: String(row.version), status: row.status,
      templatePurpose: row.template_purpose, subjectTemplate: row.subject_template ?? null,
      bodyTemplate: String(row.body_template), bodyHash: String(row.body_hash),
      approvedAt: row.approved_at ? new Date(row.approved_at) : null,
      effectiveAt: row.effective_at ? new Date(row.effective_at) : null,
      retiredAt: row.retired_at ? new Date(row.retired_at) : null,
      requiredLegalDocumentKey: row.required_legal_document_key ?? null,
      requiredLegalDocumentVersion: row.required_legal_document_version ?? null };
  }

  private mapLegalDocument(row: RowDataPacket): LegalDocumentPolicyView {
    return { documentKey: String(row.document_key), version: String(row.version), status: row.status,
      bodyHash: String(row.body_hash), termsHash: String(row.terms_hash),
      approvedAt: row.approved_at ? new Date(row.approved_at) : null,
      effectiveAt: row.effective_at ? new Date(row.effective_at) : null,
      retiredAt: row.retired_at ? new Date(row.retired_at) : null };
  }

  private mapLintRule(row: RowDataPacket): LintRulePolicyView {
    return { ruleKey: String(row.rule_key), ruleType: row.rule_type, severity: row.severity,
      patternOrClaim: String(row.pattern_or_claim), appliesToPurpose: row.applies_to_purpose ?? null,
      status: row.status };
  }
}
