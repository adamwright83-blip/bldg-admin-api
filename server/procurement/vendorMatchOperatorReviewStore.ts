import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { vendorMatchReviewGateKey, type VendorMatchOperatorReviewGateStatus } from "./vendorMatchOperatorReviewPolicy";

export type VendorMatchOperatorReviewGateRow = {
  gateKey: string;
  status: VendorMatchOperatorReviewGateStatus;
  deadlineAt: Date | null;
  decidedAt: Date | null;
};

type GateRow = RowDataPacket & {
  gate_key: string; status: VendorMatchOperatorReviewGateStatus;
  deadline_at: Date | null; decided_at: Date | null;
};

type RunRow = RowDataPacket & { id: string; workflow_id: string | null };

/**
 * Reads vendor_match_evaluation_runs and vendor_match_evaluation_candidates
 * only to validate the referenced run/candidate exist -- never writes to
 * either. Writes only to procurement_operator_gates, and only against a
 * workflow that already exists; never creates a workflow, outreach draft,
 * dispatch, payment, Stripe, or legacy vendor row. A gate created here
 * records a review request only -- it is never itself an approval.
 */
export class VendorMatchOperatorReviewStore {
  constructor(private readonly pool: Pool) {}

  async requestOperatorReview(input: {
    evaluationRunId: string;
    candidateId: string;
    requestedBy: string;
    promptPayload: Record<string, unknown>;
    evidencePayload: Record<string, unknown>;
  }): Promise<{ gateKey: string }> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const run = await this.lockEvaluationRun(connection, input.evaluationRunId);
      if (!run) throw new Error("Vendor match evaluation run not found");
      if (!run.workflow_id) throw new Error("Vendor match evaluation run has no associated workflow");
      await this.assertCandidateExists(connection, input.evaluationRunId, input.candidateId);

      const gateKey = vendorMatchReviewGateKey({
        evaluationRunId: input.evaluationRunId, candidateId: input.candidateId,
      });
      await connection.execute(
        `INSERT IGNORE INTO procurement_operator_gates
          (workflow_id, gate_key, status, prompt_json, evidence_json, requested_by)
         VALUES (?, ?, 'pending', ?, ?, ?)`,
        [run.workflow_id, gateKey, JSON.stringify(input.promptPayload), JSON.stringify(input.evidencePayload),
         input.requestedBy],
      );

      await connection.commit();
      return { gateKey };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getReviewGate(input: { evaluationRunId: string; candidateId: string }):
    Promise<VendorMatchOperatorReviewGateRow | null> {
    const gateKey = vendorMatchReviewGateKey(input);
    const [rows] = await this.pool.execute<GateRow[]>(
      `SELECT g.gate_key, g.status, g.deadline_at, g.decided_at
         FROM procurement_operator_gates g
         JOIN vendor_match_evaluation_runs r ON r.workflow_id = g.workflow_id
        WHERE r.id = ? AND g.gate_key = ?`,
      [input.evaluationRunId, gateKey],
    );
    const row = rows[0];
    if (!row) return null;
    return { gateKey: row.gate_key, status: row.status, deadlineAt: row.deadline_at, decidedAt: row.decided_at };
  }

  private async lockEvaluationRun(connection: PoolConnection, evaluationRunId: string): Promise<RunRow | null> {
    const [rows] = await connection.execute<RunRow[]>(
      `SELECT id, workflow_id FROM vendor_match_evaluation_runs WHERE id = ? FOR SHARE`,
      [evaluationRunId],
    );
    return rows[0] ?? null;
  }

  private async assertCandidateExists(
    connection: PoolConnection, evaluationRunId: string, candidateId: string,
  ): Promise<void> {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM vendor_match_evaluation_candidates
        WHERE evaluation_run_id = ? AND candidate_id = ? FOR SHARE`,
      [evaluationRunId, candidateId],
    );
    if (!rows.length) throw new Error("Vendor match evaluation candidate not found");
  }
}
