import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type {
  VendorMatchEvaluationCandidateStatus,
  VendorMatchEvaluationStatus,
} from "./vendorMatchEvaluationPolicy";

export type VendorMatchEvaluationCandidateRecord = {
  id: string;
  candidateId: string;
  evidenceSnapshotId: string | null;
  matchStatus: VendorMatchEvaluationCandidateStatus;
  rankOrder: number | null;
  score: number | null;
  decisionReasons: string[];
  riskFlags: string[];
  evidenceSummary: Record<string, unknown>;
};

export type VendorMatchEvaluationRunRecord = {
  id: string;
  workflowId: string | null;
  evaluationStatus: VendorMatchEvaluationStatus | "draft" | "cancelled";
  requestContext: Record<string, unknown>;
  preferenceRequest: Record<string, unknown>;
  evaluationSummary: Record<string, unknown>;
  createdBy: string;
  candidates: VendorMatchEvaluationCandidateRecord[];
};

/**
 * Transactional writes only to vendor_match_evaluation_runs and
 * vendor_match_evaluation_candidates. Reads vendor_sourcing_candidates and
 * procurement_workflows only to validate referenced FK rows exist -- never
 * writes to either, and never touches evidence, gates, outreach, dispatch,
 * payment, legacy vendor, or Stripe/order tables.
 */
export class VendorMatchEvaluationStore {
  constructor(private readonly pool: Pool) {}

  async createEvaluationRun(input: VendorMatchEvaluationRunRecord): Promise<{ id: string }> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await this.assertCandidatesExist(connection, input.candidates.map(candidate => candidate.candidateId));
      await this.assertWorkflowExists(connection, input.workflowId);

      await connection.execute(
        `INSERT INTO vendor_match_evaluation_runs
          (id, workflow_id, evaluation_status, request_context_json, preference_request_json,
           evaluation_summary_json, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [input.id, input.workflowId, input.evaluationStatus, JSON.stringify(input.requestContext),
         JSON.stringify(input.preferenceRequest), JSON.stringify(input.evaluationSummary), input.createdBy],
      );

      for (const candidate of input.candidates) {
        await connection.execute(
          `INSERT INTO vendor_match_evaluation_candidates
            (id, evaluation_run_id, candidate_id, evidence_snapshot_id, match_status, rank_order, score,
             decision_reasons_json, risk_flags_json, evidence_summary_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [candidate.id, input.id, candidate.candidateId, candidate.evidenceSnapshotId, candidate.matchStatus,
           candidate.rankOrder, candidate.score, JSON.stringify(candidate.decisionReasons),
           JSON.stringify(candidate.riskFlags), JSON.stringify(candidate.evidenceSummary)],
        );
      }

      await connection.commit();
      return { id: input.id };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async assertCandidatesExist(connection: PoolConnection, candidateIds: readonly string[]): Promise<void> {
    const uniqueIds = [...new Set(candidateIds)];
    if (!uniqueIds.length) return;
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT id FROM vendor_sourcing_candidates WHERE id IN (?) FOR SHARE`,
      [uniqueIds],
    );
    const found = new Set(rows.map(row => String(row.id)));
    const missing = uniqueIds.filter(id => !found.has(id));
    if (missing.length) throw new Error(`Vendor sourcing candidate(s) not found: ${missing.join(", ")}`);
  }

  private async assertWorkflowExists(connection: PoolConnection, workflowId: string | null): Promise<void> {
    if (workflowId === null) return;
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM procurement_workflows WHERE id = ? FOR SHARE`,
      [workflowId],
    );
    if (!rows.length) throw new Error("Procurement workflow not found");
  }
}
