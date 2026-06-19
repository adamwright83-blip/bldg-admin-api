import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  VENDOR_SCORING_VERSION,
  canApproveForOutreach,
  evaluateVendorCandidate,
  outreachGateKey,
  type CandidateScoringStatus,
  type VendorScoringInput,
} from "./vendorSourcingScoringPolicy";

type CandidateRow = RowDataPacket & {
  id: string; tenant_id: string; source_type: string; sourcing_status: CandidateScoringStatus;
  source_compliance_snapshot_json: string | object | null;
};

function hasComplianceSnapshot(value: string | object | null): boolean {
  if (value === null) return false;
  try {
    const snapshot = (typeof value === "string" ? JSON.parse(value) : value) as Record<string, unknown>;
    return !!snapshot
      && typeof snapshot.allowedUseFlags === "object"
      && typeof snapshot.prohibitedUseFlags === "object"
      && typeof snapshot.sourcePolicy === "object";
  } catch {
    return false;
  }
}

export class VendorSourcingScoringStore {
  constructor(private readonly pool: Pool) {}

  async scoreCandidate(input: {
    id: string; candidateId: string; tenantId: string; createdBy: string;
    signals: Omit<VendorScoringInput, "sourceType" | "sourceCompliancePresent" | "candidateStatus">;
    evidence: unknown;
  }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const candidate = await this.lockCandidate(connection, input.tenantId, input.candidateId);
      if (!candidate) throw new Error("Vendor sourcing candidate not found");
      const scoringInput: VendorScoringInput = {
        ...input.signals,
        sourceType: candidate.source_type,
        sourceCompliancePresent: hasComplianceSnapshot(candidate.source_compliance_snapshot_json),
        candidateStatus: candidate.sourcing_status,
      };
      const decision = evaluateVendorCandidate(scoringInput);
      const workflowId = await this.ensureCandidateWorkflow(connection, candidate.id);
      const scoreStatus = decision.decision === "pass_to_operator_review"
        ? "needs_operator_review"
        : decision.decision === "reject" ? "rejected" : "scored";
      await connection.execute(
        `INSERT INTO vendor_sourcing_candidate_scores
          (id, candidate_id, workflow_id, tenant_id, score_version, score_status,
           category_match_score, geographic_fit_score, contactability_score,
           pricing_signal_score, booking_signal_score, review_signal_score, overall_score,
           decision, decision_reasons_json, score_inputs_snapshot_json, score_evidence_json, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.id, candidate.id, workflowId, candidate.tenant_id, VENDOR_SCORING_VERSION, scoreStatus,
         decision.scores.categoryMatch, decision.scores.geographicFit, decision.scores.contactability,
         decision.scores.pricingSignal, decision.scores.bookingSignal, decision.scores.reviewSignal,
         decision.scores.overall, decision.decision, JSON.stringify(decision.reasons),
         JSON.stringify(scoringInput), JSON.stringify(input.evidence), input.createdBy],
      );
      const nextStatus = decision.decision === "pass_to_operator_review"
        ? "pending_operator_review"
        : decision.decision === "reject" ? "rejected" : "pending_scoring";
      const [updated] = await connection.execute<ResultSetHeader>(
        `UPDATE vendor_sourcing_candidates SET sourcing_status = ?
          WHERE id = ? AND tenant_id = ? AND sourcing_status IN ('discovered','enriched','pending_scoring')`,
        [nextStatus, candidate.id, candidate.tenant_id],
      );
      if (updated.affectedRows !== 1) throw new Error("Vendor sourcing candidate status transition denied");
      if (decision.decision === "pass_to_operator_review") {
        await connection.execute(
          `UPDATE procurement_workflows SET status = 'waiting_operator' WHERE id = ?`,
          [workflowId],
        );
        await connection.execute(
          `INSERT IGNORE INTO procurement_operator_gates
            (workflow_id, gate_key, status, prompt_json, evidence_json, requested_by)
           VALUES (?, ?, 'pending', ?, ?, ?)`,
          [workflowId, outreachGateKey(candidate.id),
           JSON.stringify({ action: "approve_vendor_outreach", candidateId: candidate.id }),
           JSON.stringify({ scoreId: input.id, scoreVersion: VENDOR_SCORING_VERSION,
             overallScore: decision.scores.overall, reasons: decision.reasons }), input.createdBy],
        );
      }
      await connection.commit();
      return { decision, workflowId, gateKey: decision.allowed ? outreachGateKey(candidate.id) : null };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async promoteAfterOperatorApproval(input: { candidateId: string; tenantId: string }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const candidate = await this.lockCandidate(connection, input.tenantId, input.candidateId);
      if (!candidate) throw new Error("Vendor sourcing candidate not found");
      const [gateRows] = await connection.execute<Array<RowDataPacket & { gate_key: string; status: string }>>(
        `SELECT g.gate_key, g.status
           FROM procurement_operator_gates g
           JOIN procurement_workflows w ON w.id = g.workflow_id
          WHERE w.workflow_key = ? AND g.gate_key = ?
          FOR UPDATE`,
        [`vendor_sourcing:${candidate.id}`, outreachGateKey(candidate.id)],
      );
      const gate = gateRows[0] ?? null;
      const approval = canApproveForOutreach({ candidateStatus: candidate.sourcing_status,
        gateStatus: gate?.status ?? null, gateKey: gate?.gate_key ?? null, candidateId: candidate.id });
      if (!approval.allowed) throw new Error(`Vendor outreach approval denied: ${approval.reasons.join(",")}`);
      const [updated] = await connection.execute<ResultSetHeader>(
        `UPDATE vendor_sourcing_candidates SET sourcing_status = 'approved_for_outreach'
          WHERE id = ? AND tenant_id = ? AND sourcing_status = 'pending_operator_review'`,
        [candidate.id, candidate.tenant_id],
      );
      if (updated.affectedRows !== 1) throw new Error("Vendor outreach approval transition denied");
      await connection.execute(
        `UPDATE procurement_workflows SET status = 'completed', completed_at = CURRENT_TIMESTAMP(3)
          WHERE workflow_key = ? AND status = 'waiting_operator'`,
        [`vendor_sourcing:${candidate.id}`],
      );
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async lockCandidate(connection: PoolConnection, tenantId: string, candidateId: string) {
    const [rows] = await connection.execute<CandidateRow[]>(
      `SELECT id, tenant_id, source_type, sourcing_status, source_compliance_snapshot_json
         FROM vendor_sourcing_candidates WHERE tenant_id = ? AND id = ? FOR UPDATE`,
      [tenantId, candidateId],
    );
    return rows[0] ?? null;
  }

  private async ensureCandidateWorkflow(connection: PoolConnection, candidateId: string) {
    await connection.execute(
      `INSERT IGNORE INTO procurement_workflows
        (workflow_key, workflow_type, status, input_json)
       VALUES (?, 'vendor_sourcing', 'pending', ?)`,
      [`vendor_sourcing:${candidateId}`, JSON.stringify({ candidateId })],
    );
    const [rows] = await connection.execute<Array<RowDataPacket & { id: string }>>(
      `SELECT id FROM procurement_workflows WHERE workflow_key = ? FOR UPDATE`,
      [`vendor_sourcing:${candidateId}`],
    );
    const workflowId = String(rows[0]?.id ?? "");
    if (!workflowId) throw new Error("Unable to resolve vendor sourcing workflow");
    return workflowId;
  }
}
