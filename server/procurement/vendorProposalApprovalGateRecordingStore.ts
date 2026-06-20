import type { Pool, RowDataPacket } from "mysql2/promise";
import type { ProposalApprovalGateRecordingCommand } from "./vendorProposalApprovalGateRecordingPolicy";

export class VendorProposalApprovalGateRecordingStore {
  constructor(private readonly pool: Pool) {}

  async recordApprovalGate(input: {
    command: ProposalApprovalGateRecordingCommand;
    requestedBy?: string;
    now?: Date;
  }): Promise<{ id: number; gateKey: string }> {
    const { command, requestedBy, now = new Date() } = input;

    // Fail closed on recording_not_allowed or invalid command
    if (command.command === "recording_not_allowed" || !command.allowed) {
      throw new Error("Recording is not allowed for this command state");
    }

    if (!command.workflowId || !command.proposalId || !command.candidateId) {
      throw new Error("Missing proposal or workflow identifiers in recording command");
    }

    if (!command.payload) {
      throw new Error("Missing payload details in recording command");
    }

    const workflowId = parseInt(command.workflowId, 10);
    if (isNaN(workflowId)) {
      throw new Error("Invalid non-numeric workflowId");
    }

    // Determine status for procurement_operator_gates
    let status: "pending" | "approved" | "rejected";
    switch (command.command) {
      case "record_operator_review_required":
      case "record_resident_approval_required":
      case "record_budget_approval_required":
      case "record_payment_authorization_required":
      case "record_legal_review_required":
        status = "pending";
        break;
      case "record_next_step_only_approval":
        status = "approved";
        break;
      case "record_rejection":
        status = "rejected";
        break;
      default:
        throw new Error(`Unsupported recording command: ${command.command}`);
    }

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      // Check for duplicate gate records (fail closed)
      const [existing] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM procurement_operator_gates WHERE workflow_id = ? AND gate_key = ? FOR UPDATE`,
        [workflowId, command.gateKey]
      );
      if (existing.length > 0) {
        throw new Error(`Duplicate gate recording: gate already exists for key '${command.gateKey}'`);
      }

      // Check if command is expired
      if (command.payload.expiresAt) {
        const expiresAtDate = new Date(command.payload.expiresAt);
        if (expiresAtDate.getTime() <= now.getTime()) {
          throw new Error("Recording command is expired");
        }
      }

      // Map payload fields to schema
      const promptJson = JSON.stringify({
        command: command.command,
        approvalType: command.payload.approvalType,
        reasonCodes: command.payload.reasonCodes,
        riskFlags: command.payload.riskFlags,
        contexts: command.payload.contexts,
        commandKey: command.commandKey,
        idempotencyKey: command.idempotencyKey,
      });

      const evidenceJson = JSON.stringify({
        proposalSnapshotReference: command.payload.proposalSnapshotReference,
      });

      const reqBy = requestedBy ?? command.idempotencyKey ?? "system";
      const decBy = status !== "pending" ? "system" : null;
      const decAt = status !== "pending" ? now : null;
      const decReason = status !== "pending" ? `auto_recorded_${command.command}` : null;
      const deadlineAt = command.payload.expiresAt ? new Date(command.payload.expiresAt) : null;

      const [result] = await connection.execute<any>(
        `INSERT INTO procurement_operator_gates
          (workflow_id, gate_key, status, prompt_json, evidence_json, requested_by, decided_by, decided_at, decision_reason, deadline_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          workflowId,
          command.gateKey,
          status,
          promptJson,
          evidenceJson,
          reqBy,
          decBy,
          decAt,
          decReason,
          deadlineAt,
        ]
      );

      const insertId = result.insertId;

      await connection.commit();
      return { id: insertId, gateKey: command.gateKey };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getRecordedGate(input: {
    workflowId: string;
    gateKey: string;
  }): Promise<any | null> {
    const workflowId = parseInt(input.workflowId, 10);
    if (isNaN(workflowId)) {
      return null;
    }

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, workflow_id, gate_key, status, prompt_json, evidence_json, requested_by, decided_by, decided_at, decision_reason, deadline_at
         FROM procurement_operator_gates
        WHERE workflow_id = ? AND gate_key = ?`,
      [workflowId, input.gateKey]
    );

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      workflowId: String(row.workflow_id),
      gateKey: row.gate_key,
      status: row.status,
      promptJson: row.prompt_json,
      evidenceJson: row.evidence_json,
      requestedBy: row.requested_by,
      decidedBy: row.decided_by,
      decidedAt: row.decided_at,
      decisionReason: row.decision_reason,
      deadlineAt: row.deadline_at,
    };
  }
}
