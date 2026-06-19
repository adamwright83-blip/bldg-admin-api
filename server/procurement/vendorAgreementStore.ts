import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type { LegalDocumentPolicyView } from "./legalTemplatePolicy";
import { canSignVendorAgreement, type VendorAgreementPolicyView, type VendorAgreementStatus } from "./vendorAgreementPolicy";

type AgreementEventType = "created" | "sent_for_manual_review" | "vendor_question_recorded" | "signed"
  | "revoked" | "expired" | "rejected" | "operator_note";

export class VendorAgreementStore {
  constructor(private readonly pool: Pool) {}

  async createDraft(input: {
    id: string; candidateId: string; tenantId: string; outreachDraftId?: string | null;
    legalDocumentKey: string; legalDocumentVersion: string; renderedAgreementHash: string;
    expiresAt?: Date | null; evidence: unknown; createdBy: string; eventId: string; now?: Date;
  }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const context = await this.loadContext(connection, input.candidateId, input.tenantId,
        input.legalDocumentKey, input.legalDocumentVersion, input.outreachDraftId ?? null);
      const now = input.now ?? new Date();
      if (!context.legalDocument || !context.legalRow) throw new Error("Legal document version not found");
      const agreement: VendorAgreementPolicyView = {
        status: "draft", legalDocumentKey: input.legalDocumentKey, legalDocumentVersion: input.legalDocumentVersion,
        termsVersion: String(context.legalRow.terms_version), termsHash: String(context.legalRow.terms_hash),
        bodyHash: String(context.legalRow.body_hash), renderedAgreementHash: input.renderedAgreementHash,
        signedAt: null, revokedAt: null, expiresAt: input.expiresAt ?? null,
      };
      const decision = canSignVendorAgreement({ agreement, legalDocument: context.legalDocument, now });
      if (!decision.allowed) throw new Error(`Vendor agreement draft denied: ${decision.reasons.join(",")}`);
      await connection.execute(
        `INSERT INTO vendor_agreements
          (id, candidate_id, workflow_id, outreach_draft_id, legal_document_key, legal_document_version,
           vendor_agreement_status, agreement_subject_type, agreement_subject_id, terms_version, terms_hash,
           body_hash, rendered_agreement_hash, expires_at, evidence_json, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', 'vendor_candidate', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.id, input.candidateId, context.workflowId, input.outreachDraftId ?? null,
         input.legalDocumentKey, input.legalDocumentVersion, input.candidateId, agreement.termsVersion,
         agreement.termsHash, agreement.bodyHash, input.renderedAgreementHash, input.expiresAt ?? null,
         JSON.stringify(input.evidence), input.createdBy]);
      await this.insertEvent(connection, { id: input.eventId, agreementId: input.id, eventType: "created",
        eventStatus: "recorded", occurredAt: now, actorType: "operator", actorIdentifier: input.createdBy,
        summary: "Vendor agreement draft created", evidence: input.evidence, createdBy: input.createdBy });
      await connection.commit();
      return { id: input.id, status: "draft" as const, dispatchReady: false as const, paymentReady: false as const };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  async markSigned(input: { agreementId: string; signerName: string; signerEmail?: string | null;
    signatureEvidence: unknown; evidence: unknown; createdBy: string; eventId: string; occurredAt: Date; }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const { row, agreement, legalDocument } = await this.loadAgreement(connection, input.agreementId);
      const decision = canSignVendorAgreement({ agreement, legalDocument, now: input.occurredAt });
      if (!decision.allowed) throw new Error(`Vendor agreement signature denied: ${decision.reasons.join(",")}`);
      if (!input.signerName.trim() || input.signatureEvidence === null || input.signatureEvidence === undefined) {
        throw new Error("Signer name and signature evidence are required");
      }
      await connection.execute(
        `UPDATE vendor_agreements SET vendor_agreement_status = 'signed', signer_name = ?, signer_email = ?,
          signature_evidence_json = ?, signed_at = ?, evidence_json = ? WHERE id = ?`,
        [input.signerName.trim(), input.signerEmail ?? null, JSON.stringify(input.signatureEvidence),
         input.occurredAt, JSON.stringify(input.evidence), input.agreementId]);
      await this.insertEvent(connection, { id: input.eventId, agreementId: input.agreementId, eventType: "signed",
        eventStatus: "recorded", occurredAt: input.occurredAt, actorType: "vendor",
        actorIdentifier: input.signerEmail ?? input.signerName, summary: "Vendor agreement signature recorded",
        evidence: input.evidence, createdBy: input.createdBy });
      await connection.commit();
      return { id: String(row.id), status: "signed" as const, dispatchReady: false as const, paymentReady: false as const };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  async markTerminal(input: { agreementId: string; status: "revoked" | "expired" | "rejected";
    evidence: unknown; summary: string; createdBy: string; eventId: string; occurredAt: Date; }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM vendor_agreements WHERE id = ? FOR UPDATE`, [input.agreementId]);
      if (!rows[0]) throw new Error("Vendor agreement not found");
      await connection.execute(
        `UPDATE vendor_agreements SET vendor_agreement_status = ?, revoked_at = ?, evidence_json = ? WHERE id = ?`,
        [input.status, input.status === "revoked" ? input.occurredAt : null,
         JSON.stringify(input.evidence), input.agreementId]);
      await this.insertEvent(connection, { id: input.eventId, agreementId: input.agreementId,
        eventType: input.status, eventStatus: "recorded", occurredAt: input.occurredAt,
        actorType: input.status === "expired" ? "system" : "operator", actorIdentifier: input.createdBy,
        summary: input.summary, evidence: input.evidence, createdBy: input.createdBy });
      await connection.commit();
      return { id: input.agreementId, status: input.status, dispatchReady: false as const, paymentReady: false as const };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  async recordEvent(input: { id: string; agreementId: string; eventType: AgreementEventType;
    eventStatus?: "recorded" | "needs_review" | "rejected"; occurredAt: Date;
    actorType: "operator" | "vendor" | "system"; actorIdentifier?: string | null;
    summary: string; evidence: unknown; createdBy: string; }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM vendor_agreements WHERE id = ? FOR SHARE`, [input.agreementId]);
      if (!rows[0]) throw new Error("Vendor agreement not found");
      await this.insertEvent(connection, { ...input, eventStatus: input.eventStatus ?? "recorded" });
      await connection.commit();
      return { id: input.id };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  async getAgreement(id: string) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(`SELECT * FROM vendor_agreements WHERE id = ?`, [id]);
    return rows[0] ?? null;
  }

  async listAgreements(candidateId: string) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM vendor_agreements WHERE candidate_id = ? ORDER BY created_at DESC`, [candidateId]);
    return rows;
  }

  async listEvents(agreementId: string) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM vendor_agreement_events WHERE vendor_agreement_id = ? ORDER BY occurred_at DESC`, [agreementId]);
    return rows;
  }

  private async loadContext(connection: PoolConnection, candidateId: string, tenantId: string,
    legalKey: string, legalVersion: string, outreachDraftId: string | null) {
    const [candidateRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM vendor_sourcing_candidates WHERE id = ? AND tenant_id = ? FOR SHARE`, [candidateId, tenantId]);
    if (!candidateRows[0]) throw new Error("Vendor sourcing candidate not found");
    const [workflowRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM procurement_workflows WHERE workflow_key = ? FOR SHARE`, [`vendor_sourcing:${candidateId}`]);
    const workflowId = String(workflowRows[0]?.id ?? "");
    if (!workflowId) throw new Error("Vendor sourcing workflow not found");
    if (outreachDraftId) {
      const [draftRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM vendor_outreach_drafts WHERE id = ? AND candidate_id = ? FOR SHARE`, [outreachDraftId, candidateId]);
      if (!draftRows[0]) throw new Error("Vendor outreach draft does not match candidate");
    }
    const [legalRows] = await connection.execute<RowDataPacket[]>(
      `SELECT document_key, version, status, body_hash, terms_version, terms_hash, approved_at,
        effective_at, retired_at FROM legal_document_versions WHERE document_key = ? AND version = ? FOR SHARE`,
      [legalKey, legalVersion]);
    const legalRow = legalRows[0] ?? null;
    return { workflowId, legalRow, legalDocument: legalRow ? this.mapLegal(legalRow) : null };
  }

  private async loadAgreement(connection: PoolConnection, id: string) {
    const [rows] = await connection.execute<RowDataPacket[]>(`SELECT * FROM vendor_agreements WHERE id = ? FOR UPDATE`, [id]);
    const row = rows[0];
    if (!row) throw new Error("Vendor agreement not found");
    const [legalRows] = await connection.execute<RowDataPacket[]>(
      `SELECT document_key, version, status, body_hash, terms_hash, approved_at, effective_at, retired_at
       FROM legal_document_versions WHERE document_key = ? AND version = ? FOR SHARE`,
      [row.legal_document_key, row.legal_document_version]);
    return { row, agreement: this.mapAgreement(row), legalDocument: legalRows[0] ? this.mapLegal(legalRows[0]) : null };
  }

  private async insertEvent(connection: PoolConnection, input: { id: string; agreementId: string;
    eventType: AgreementEventType; eventStatus: "recorded" | "needs_review" | "rejected";
    occurredAt: Date; actorType: "operator" | "vendor" | "system"; actorIdentifier?: string | null;
    summary: string; evidence: unknown; createdBy: string; }) {
    if (!input.summary.trim()) throw new Error("Agreement event summary is required");
    await connection.execute(
      `INSERT INTO vendor_agreement_events
        (id, vendor_agreement_id, event_type, event_status, occurred_at, actor_type,
         actor_identifier, summary, evidence_json, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.id, input.agreementId, input.eventType, input.eventStatus, input.occurredAt, input.actorType,
       input.actorIdentifier ?? null, input.summary.trim(), JSON.stringify(input.evidence), input.createdBy]);
  }

  private mapLegal(row: RowDataPacket): LegalDocumentPolicyView {
    return { documentKey: String(row.document_key), version: String(row.version), status: row.status,
      bodyHash: String(row.body_hash), termsHash: String(row.terms_hash),
      approvedAt: row.approved_at ? new Date(row.approved_at) : null,
      effectiveAt: row.effective_at ? new Date(row.effective_at) : null,
      retiredAt: row.retired_at ? new Date(row.retired_at) : null };
  }

  private mapAgreement(row: RowDataPacket): VendorAgreementPolicyView {
    return { status: row.vendor_agreement_status as VendorAgreementStatus,
      legalDocumentKey: String(row.legal_document_key), legalDocumentVersion: String(row.legal_document_version),
      termsVersion: String(row.terms_version), termsHash: String(row.terms_hash), bodyHash: String(row.body_hash),
      renderedAgreementHash: String(row.rendered_agreement_hash), signedAt: row.signed_at ? new Date(row.signed_at) : null,
      revokedAt: row.revoked_at ? new Date(row.revoked_at) : null, expiresAt: row.expires_at ? new Date(row.expires_at) : null };
  }
}
