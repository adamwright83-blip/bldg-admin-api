import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { canUseLegalDocument, type LegalDocumentPolicyView, type OutreachTemplatePolicyView } from "./legalTemplatePolicy";
import { evaluateOutreachSendReadiness } from "./outreachSendReadinessPolicy";
import {
  evaluateVendorOutreachSendReview,
  vendorOutreachSendReviewGateKey,
  type VendorOutreachSendReviewDecision,
  type VendorOutreachSendReviewGateStatus,
} from "./vendorOutreachSendReviewPolicy";

type DraftRow = RowDataPacket & {
  id: string; candidate_id: string; workflow_id: string; draft_status: string;
  template_key: string; template_version: string;
  legal_document_key: string | null; legal_document_version: string | null;
  outreach_channel: string; subject_rendered: string | null; body_rendered: string;
};
type GateRow = RowDataPacket & {
  id: string; gate_key: string; status: VendorOutreachSendReviewGateStatus;
  deadline_at: Date | null; decided_at: Date | null;
};

/**
 * Reads vendor_outreach_drafts, procurement_operator_gates (the Slice 29
 * send-review gate only -- never writes to it), outreach_template_versions,
 * and legal_document_versions. Writes only to procurement_operator_gates,
 * and only to request a send-review gate. Never writes to outreach drafts,
 * conversation events, match evaluation, dispatch, payment, Stripe, or
 * legacy vendor tables. A gate created here records a review request
 * only -- it is never itself a send.
 */
export class VendorOutreachSendReviewStore {
  constructor(private readonly pool: Pool) {}

  async requestSendReview(input: {
    draftId: string;
    requestedBy: string;
    promptPayload: Record<string, unknown>;
    evidencePayload: Record<string, unknown>;
    now?: Date;
  }): Promise<{ gateKey: string; decision: VendorOutreachSendReviewDecision }> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      const draft = await this.readDraft(connection, input.draftId);
      if (!draft) throw new Error("Vendor outreach draft not found");

      const template = await this.readTemplate(connection, draft.template_key, draft.template_version);
      let legalDocument: LegalDocumentPolicyView | null = null;
      if (draft.legal_document_key && draft.legal_document_version) {
        legalDocument = await this.readLegalDocument(connection, draft.legal_document_key, draft.legal_document_version);
      }
      const gate = await this.readSendReviewGate(connection, draft.workflow_id, draft.id);

      const now = input.now ?? new Date();
      const sendReadiness = evaluateOutreachSendReadiness({
        candidateStatus: "approved_for_outreach",
        templateStatus: template?.status ?? "missing",
        templateEffective: this.isTemplateEffective(template, now),
        lintClean: true,
        legalDocumentRequired: Boolean(template?.requiredLegalDocumentKey),
        legalDocumentUsable: canUseLegalDocument(legalDocument, now),
        operatorGateStatus: "approved",
        channel: draft.outreach_channel,
        draftStatus: draft.draft_status,
        vendorOutreachEnabled: false,
      });

      const decision = evaluateVendorOutreachSendReview({
        draftId: draft.id, candidateId: draft.candidate_id, workflowId: draft.workflow_id,
        draftStatus: draft.draft_status, draftBridgeStatus: "draft_created_internally",
        sendReadiness, subjectRendered: draft.subject_rendered, bodyRendered: draft.body_rendered,
        template, legalDocument,
        gate: gate ? { gateKey: gate.gate_key, status: gate.status, deadlineAt: gate.deadline_at, decidedAt: gate.decided_at } : null,
        now,
      });

      if (!decision.gateRequired || !decision.sendReviewAllowed) {
        throw new Error(`Vendor outreach send review denied: ${decision.reasons.join(",")}`);
      }

      const gateKey = vendorOutreachSendReviewGateKey({ draftId: draft.id });
      await connection.execute(
        `INSERT IGNORE INTO procurement_operator_gates
          (workflow_id, gate_key, status, prompt_json, evidence_json, requested_by)
         VALUES (?, ?, 'pending', ?, ?, ?)`,
        [draft.workflow_id, gateKey, JSON.stringify(input.promptPayload), JSON.stringify(input.evidencePayload),
         input.requestedBy],
      );

      await connection.commit();
      return { gateKey, decision };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getSendReviewDecision(input: { draftId: string; now?: Date }): Promise<VendorOutreachSendReviewDecision> {
    const draft = await this.readDraft(this.pool, input.draftId);
    if (!draft) throw new Error("Vendor outreach draft not found");

    const template = await this.readTemplate(this.pool, draft.template_key, draft.template_version);
    let legalDocument: LegalDocumentPolicyView | null = null;
    if (draft.legal_document_key && draft.legal_document_version) {
      legalDocument = await this.readLegalDocument(this.pool, draft.legal_document_key, draft.legal_document_version);
    }
    const gate = await this.readSendReviewGate(this.pool, draft.workflow_id, draft.id);

    const now = input.now ?? new Date();
    const sendReadiness = evaluateOutreachSendReadiness({
      candidateStatus: "approved_for_outreach",
      templateStatus: template?.status ?? "missing",
      templateEffective: this.isTemplateEffective(template, now),
      lintClean: true,
      legalDocumentRequired: Boolean(template?.requiredLegalDocumentKey),
      legalDocumentUsable: canUseLegalDocument(legalDocument, now),
      operatorGateStatus: "approved",
      channel: draft.outreach_channel,
      draftStatus: draft.draft_status,
      vendorOutreachEnabled: false,
    });

    return evaluateVendorOutreachSendReview({
      draftId: draft.id, candidateId: draft.candidate_id, workflowId: draft.workflow_id,
      draftStatus: draft.draft_status, draftBridgeStatus: "draft_created_internally",
      sendReadiness, subjectRendered: draft.subject_rendered, bodyRendered: draft.body_rendered,
      template, legalDocument,
      gate: gate ? { gateKey: gate.gate_key, status: gate.status, deadlineAt: gate.deadline_at, decidedAt: gate.decided_at } : null,
      now,
    });
  }

  private isTemplateEffective(template: OutreachTemplatePolicyView | null, now: Date): boolean {
    if (!template) return false;
    if (!template.approvedAt || !template.effectiveAt) return false;
    if (template.effectiveAt.getTime() > now.getTime()) return false;
    if (template.retiredAt && template.retiredAt.getTime() <= now.getTime()) return false;
    return true;
  }

  private async readDraft(connection: Pool | PoolConnection, draftId: string): Promise<DraftRow | null> {
    const [rows] = await connection.execute<DraftRow[]>(
      `SELECT id, candidate_id, workflow_id, draft_status, template_key, template_version,
              legal_document_key, legal_document_version, outreach_channel, subject_rendered, body_rendered
         FROM vendor_outreach_drafts WHERE id = ? FOR SHARE`,
      [draftId]);
    return rows[0] ?? null;
  }

  private async readTemplate(
    connection: Pool | PoolConnection, templateKey: string, templateVersion: string,
  ): Promise<OutreachTemplatePolicyView | null> {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT template_key, version, status, template_purpose, subject_template, body_template, body_hash,
              approved_at, effective_at, retired_at, required_legal_document_key, required_legal_document_version
         FROM outreach_template_versions WHERE template_key = ? AND version = ? FOR SHARE`,
      [templateKey, templateVersion]);
    const row = rows[0];
    if (!row) return null;
    return {
      templateKey: String(row.template_key), version: String(row.version), status: row.status,
      templatePurpose: row.template_purpose, subjectTemplate: row.subject_template ?? null,
      bodyTemplate: String(row.body_template), bodyHash: String(row.body_hash),
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
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT document_key, version, status, body_hash, terms_hash, approved_at, effective_at, retired_at
         FROM legal_document_versions WHERE document_key = ? AND version = ? FOR SHARE`,
      [documentKey, version]);
    const row = rows[0];
    if (!row) return null;
    return {
      documentKey: String(row.document_key), version: String(row.version), status: row.status,
      bodyHash: String(row.body_hash), termsHash: String(row.terms_hash),
      approvedAt: row.approved_at ? new Date(row.approved_at) : null,
      effectiveAt: row.effective_at ? new Date(row.effective_at) : null,
      retiredAt: row.retired_at ? new Date(row.retired_at) : null,
    };
  }

  private async readSendReviewGate(
    connection: Pool | PoolConnection, workflowId: string, draftId: string,
  ): Promise<GateRow | null> {
    const gateKey = vendorOutreachSendReviewGateKey({ draftId });
    const [rows] = await connection.execute<GateRow[]>(
      `SELECT id, gate_key, status, deadline_at, decided_at
         FROM procurement_operator_gates WHERE workflow_id = ? AND gate_key = ? FOR SHARE`,
      [workflowId, gateKey]);
    return rows[0] ?? null;
  }
}
