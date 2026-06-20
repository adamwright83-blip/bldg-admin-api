import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { ProposalOperatorGateDecisionResult } from "./vendorProposalOperatorGateDecisionPolicy";

type GateRow = RowDataPacket & {
  id: string | number;
  workflow_id: string | number;
  gate_key: string;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
  evidence_json: unknown;
  deadline_at: Date | string | null;
  decided_at: Date | string | null;
};

const RECORDABLE_STATUSES = new Set<ProposalOperatorGateDecisionResult["status"]>([
  "operator_gate_decision_approved_for_next_step_only",
  "operator_gate_decision_rejected",
  "operator_gate_decision_needs_revision",
  "operator_gate_decision_requires_resident_approval",
  "operator_gate_decision_requires_budget_approval",
  "operator_gate_decision_requires_payment_authorization",
  "operator_gate_decision_requires_legal_review",
]);

const FORBIDDEN_OUTCOME_KEYS = [
  "booked", "accepted", "dispatched", "paid", "captured", "completed", "selectedForExecution",
  "providerAccepted", "bookingVerified", "paymentAuthorized", "paymentCaptured", "invoiceCreated",
  "payableCreated", "outreachSent", "providerMessageCreated", "deliveryVerified",
] as const;

function requiredText(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function date(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return { ...(value as Record<string, unknown>) };
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function forbiddenClaimPaths(value: unknown, path = "decision", seen = new Set<object>()): string[] {
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const paths: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((FORBIDDEN_OUTCOME_KEYS as readonly string[]).includes(key) && child !== false && child != null) {
      paths.push(`${path}.${key}`);
    }
    paths.push(...forbiddenClaimPaths(child, `${path}.${key}`, seen));
  }
  return paths;
}

export function proposalOperatorGateDecisionKey(decision: ProposalOperatorGateDecisionResult): string {
  return ["proposal_operator_gate_decision", decision.gateId, decision.workflowId, decision.proposalId,
    decision.status, decision.decisionType, decision.operatorId].map(value => String(value ?? "")).join(":");
}

/**
 * Records only the interpretation of a manual decision on an existing gate.
 * The existing enum can represent approved versus not-approved; the precise
 * revision/review requirement remains losslessly preserved in evidence_json.
 */
export class VendorProposalOperatorGateDecisionStore {
  constructor(private readonly pool: Pool) {}

  async recordDecision(input: { decision: ProposalOperatorGateDecisionResult; now?: Date }): Promise<{
    gateId: string; gateKey: string; decisionKey: string; gateStatus: "approved" | "rejected";
    executionPerformed: false; paymentAuthorized: false; outreachSent: false;
  }> {
    const { decision } = input;
    const now = input.now ?? new Date();
    this.assertRecordable(decision, now);
    const decisionKey = proposalOperatorGateDecisionKey(decision);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const gate = await this.lockGate(connection, decision);
      const evidence = jsonObject(gate.evidence_json);
      const previousDecision = jsonObject(evidence.proposalOperatorGateDecision);
      if (previousDecision.decisionKey === decisionKey) throw new Error("Duplicate operator gate decision key");
      if (gate.status !== "pending" || gate.decided_at !== null) throw new Error("Operator gate is already resolved");
      const deadline = date(gate.deadline_at);
      if (gate.deadline_at != null && (!deadline || deadline.getTime() <= now.getTime())) {
        throw new Error("Operator gate decision is expired");
      }

      const gateStatus = decision.status === "operator_gate_decision_approved_for_next_step_only"
        ? "approved" as const : "rejected" as const;
      evidence.proposalOperatorGateDecision = {
        decisionKey, decisionStatus: decision.status, decisionType: decision.decisionType,
        reasonCodes: decision.reasonCodes, riskFlags: decision.riskFlags, operatorId: decision.operatorId,
        operatorNoteSummary: decision.operatorNoteSummary, nextRequiredReviewType: decision.nextRequiredReviewType,
        gateId: decision.gateId, gateKey: decision.gateKey, workflowId: decision.workflowId,
        requestId: decision.requestId, proposalId: decision.proposalId,
        candidateId: decision.candidateId, sourceGateSnapshotReference: decision.sourceGateSnapshotReference,
        decidedAt: now.toISOString(), nextStepOnlyNotExecution: true, ...this.falseOutcomes(),
      };
      const [updated] = await connection.execute<ResultSetHeader>(
        `UPDATE procurement_operator_gates
            SET status = ?, decided_by = ?, decided_at = ?, decision_reason = ?, evidence_json = ?
          WHERE id = ? AND workflow_id = ? AND gate_key = ? AND status = 'pending' AND decided_at IS NULL`,
        [gateStatus, decision.operatorId, now, decision.status, JSON.stringify(evidence),
          decision.gateId, decision.workflowId, decision.gateKey],
      );
      if (updated.affectedRows !== 1) throw new Error("Operator gate decision persistence failed");
      await connection.commit();
      return { gateId: decision.gateId!, gateKey: decision.gateKey!, decisionKey, gateStatus,
        executionPerformed: false, paymentAuthorized: false, outreachSent: false };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private assertRecordable(decision: ProposalOperatorGateDecisionResult, now: Date): void {
    if (!decision || !decision.decisionAllowed || decision.status === "operator_gate_decision_not_allowed") {
      throw new Error("Operator gate decision is not allowed");
    }
    if (decision.status === "operator_gate_decision_expired") throw new Error("Operator gate decision is expired");
    if (!RECORDABLE_STATUSES.has(decision.status)) throw new Error("Unsupported operator gate decision status");
    if (!requiredText(decision.gateId) || !requiredText(decision.gateKey) || !requiredText(decision.workflowId)
      || !requiredText(decision.proposalId) || !requiredText(decision.decisionType)) {
      throw new Error("Missing operator gate decision identifiers");
    }
    if (!requiredText(decision.operatorId)) throw new Error("Missing operator decision actor");
    const sourceDeadline = date(decision.sourceGateSnapshotReference?.deadlineAt);
    if (decision.sourceGateSnapshotReference?.deadlineAt != null
      && (!sourceDeadline || sourceDeadline.getTime() <= now.getTime())) {
      throw new Error("Operator gate decision is expired");
    }
    const forbidden = forbiddenClaimPaths(decision);
    if (forbidden.length) throw new Error(`Forbidden operator decision claims: ${forbidden.join(",")}`);
  }

  private async lockGate(connection: PoolConnection, decision: ProposalOperatorGateDecisionResult): Promise<GateRow> {
    const [rows] = await connection.execute<GateRow[]>(
      `SELECT id, workflow_id, gate_key, status, evidence_json, deadline_at, decided_at
         FROM procurement_operator_gates
        WHERE id = ? AND workflow_id = ? AND gate_key = ? FOR UPDATE`,
      [decision.gateId, decision.workflowId, decision.gateKey],
    );
    const row = rows[0];
    if (!row) throw new Error("Operator gate not found or identifiers do not match");
    return row;
  }

  private falseOutcomes() {
    return Object.fromEntries(FORBIDDEN_OUTCOME_KEYS.map(key => [key, false]));
  }
}
