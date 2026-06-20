import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type { VendorMatchEvaluationStatus } from "./vendorMatchEvaluationPolicy";
import {
  evaluateVendorMatchOperatorReview,
  vendorMatchReviewGateKey,
  type VendorMatchOperatorReviewGateStatus,
} from "./vendorMatchOperatorReviewPolicy";
import {
  evaluateVendorOutreachDraftBridge,
  type VendorOutreachDraftBridgeStatus,
} from "./vendorOutreachDraftBridgePolicy";
import type { LegalDocumentPolicyView, LintRulePolicyView, OutreachTemplatePolicyView } from "./legalTemplatePolicy";

type RunRow = RowDataPacket & {
  id: string; workflow_id: string | null; evaluation_status: VendorMatchEvaluationStatus | "draft" | "cancelled";
};
type CandidateRow = RowDataPacket & { id: string; match_status: string };
type GateRow = RowDataPacket & {
  id: string; gate_key: string; status: VendorMatchOperatorReviewGateStatus;
  deadline_at: Date | null; decided_at: Date | null;
};

/**
 * Reads vendor_match_evaluation_runs, vendor_match_evaluation_candidates,
 * procurement_operator_gates (the Slice 27 review gate only -- never writes
 * to it), outreach_template_versions, and legal_document_versions. Writes
 * only to vendor_outreach_drafts, and only when the existing Slice 27
 * operator-review gate already shows operator_approved_for_draft_only.
 * Never writes conversation-event, dispatch, payment, Stripe, or legacy
 * vendor tables, and never creates a new operator gate.
 */
export class VendorOutreachDraftBridgeStore {
  constructor(private readonly pool: Pool) {}

  async createDraftFromApprovedReview(input: {
    id: string; evaluationRunId: string; candidateId: string;
    templateKey: string; templateVersion: string;
    variables: Record<string, string | number | boolean>; createdBy: string; now?: Date;
  }): Promise<{ id: string; status: "draft_created_internally"; sendable: false }> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      const run = await this.readEvaluationRun(connection, input.evaluationRunId);
      if (!run) throw new Error("Vendor match evaluation run not found");
      if (!run.workflow_id) throw new Error("Vendor match evaluation run has no associated workflow");

      const candidate = await this.readCandidate(connection, input.evaluationRunId, input.candidateId);
      if (!candidate) throw new Error("Vendor match evaluation candidate not found");

      const gate = await this.readReviewGate(connection, run.workflow_id, input.evaluationRunId, input.candidateId);
      const operatorReview = evaluateVendorMatchOperatorReview({
        evaluationRunStatus: run.evaluation_status,
        candidate: {
          evaluationRunId: input.evaluationRunId, candidateId: input.candidateId,
          matchStatus: candidate.match_status as never,
        },
        gate: gate ? { gateKey: gate.gate_key, status: gate.status, deadlineAt: gate.deadline_at,
          decidedAt: gate.decided_at } : null,
        now: input.now,
      });

      const template = await this.readTemplate(connection, input.templateKey, input.templateVersion);
      let legalDocument: LegalDocumentPolicyView | null = null;
      if (template?.requiredLegalDocumentKey && template.requiredLegalDocumentVersion) {
        legalDocument = await this.readLegalDocument(
          connection, template.requiredLegalDocumentKey, template.requiredLegalDocumentVersion);
      }
      const lintRules = await this.readActiveLintRules(connection);

      const decision = evaluateVendorOutreachDraftBridge({
        operatorReviewStatus: operatorReview.status, evaluationRunId: input.evaluationRunId,
        candidateId: input.candidateId, template, legalDocument, lintRules, variables: input.variables,
        now: input.now,
      });
      if (decision.status !== "draft_ready_to_create" || !template) {
        throw new Error(`Vendor outreach draft bridge denied: ${decision.reasons.join(",")}`);
      }

      const [templateRow] = await connection.execute<RowDataPacket[]>(
        `SELECT outreach_channel FROM outreach_template_versions WHERE template_key = ? AND version = ?`,
        [input.templateKey, input.templateVersion]);
      const outreachChannel = String(templateRow[0]?.outreach_channel ?? "manual");

      await connection.execute(
        `INSERT INTO vendor_outreach_drafts
          (id, candidate_id, workflow_id, score_id, template_key, template_version,
           legal_document_key, legal_document_version, outreach_channel, draft_status,
           subject_rendered, body_rendered, body_hash, render_variables_json, lint_result_json,
           operator_gate_id, created_by)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
        [input.id, input.candidateId, run.workflow_id, template.templateKey, template.version,
         template.requiredLegalDocumentKey, template.requiredLegalDocumentVersion, outreachChannel,
         decision.subjectRendered, decision.bodyRendered, decision.bodyHash,
         JSON.stringify(input.variables), JSON.stringify({ reasons: decision.reasons }),
         gate?.id ?? null, input.createdBy]);

      await connection.commit();
      return { id: input.id, status: "draft_created_internally", sendable: false };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async readEvaluationRun(connection: PoolConnection, evaluationRunId: string): Promise<RunRow | null> {
    const [rows] = await connection.execute<RunRow[]>(
      `SELECT id, workflow_id, evaluation_status FROM vendor_match_evaluation_runs WHERE id = ? FOR SHARE`,
      [evaluationRunId]);
    return rows[0] ?? null;
  }

  private async readCandidate(
    connection: PoolConnection, evaluationRunId: string, candidateId: string,
  ): Promise<CandidateRow | null> {
    const [rows] = await connection.execute<CandidateRow[]>(
      `SELECT id, match_status FROM vendor_match_evaluation_candidates
        WHERE evaluation_run_id = ? AND candidate_id = ? FOR SHARE`,
      [evaluationRunId, candidateId]);
    return rows[0] ?? null;
  }

  private async readReviewGate(
    connection: PoolConnection, workflowId: string, evaluationRunId: string, candidateId: string,
  ): Promise<GateRow | null> {
    const gateKey = vendorMatchReviewGateKey({ evaluationRunId, candidateId });
    const [rows] = await connection.execute<GateRow[]>(
      `SELECT id, gate_key, status, deadline_at, decided_at
         FROM procurement_operator_gates WHERE workflow_id = ? AND gate_key = ? FOR SHARE`,
      [workflowId, gateKey]);
    return rows[0] ?? null;
  }

  private async readTemplate(
    connection: PoolConnection, templateKey: string, templateVersion: string,
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
    connection: PoolConnection, documentKey: string, version: string,
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

  private async readActiveLintRules(connection: PoolConnection): Promise<LintRulePolicyView[]> {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT rule_key, rule_type, severity, pattern_or_claim, applies_to_purpose, status
         FROM outreach_template_lint_rules WHERE status = 'active'`, []);
    return rows.map(row => ({
      ruleKey: String(row.rule_key), ruleType: row.rule_type, severity: row.severity,
      patternOrClaim: String(row.pattern_or_claim), appliesToPurpose: row.applies_to_purpose ?? null,
      status: row.status,
    }));
  }
}

export type { VendorOutreachDraftBridgeStatus };
