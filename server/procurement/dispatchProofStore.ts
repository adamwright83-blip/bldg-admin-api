import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { DispatchProofDecision } from "./dispatchProofPolicy";

type EventInput = { id: string; dispatchRequestId: string;
  eventType: "created" | "marked_ready" | "blocked" | "manual_dispatch_recorded"
    | "proof_requested" | "proof_recorded" | "proof_verified" | "cancelled" | "rejected" | "operator_note";
  eventStatus?: "recorded" | "needs_review" | "rejected"; occurredAt: Date;
  actorType: "operator" | "vendor" | "runner" | "system"; actorIdentifier?: string | null;
  summary: string; evidence: unknown; createdBy: string; };

export class DispatchProofStore {
  constructor(private readonly pool: Pool) {}

  async createDraft(input: { id: string; workflowId: string; mandateStateSnapshot: unknown;
    candidateId?: string | null; vendorAgreementId?: string | null; providerAcceptanceId?: string | null;
    operatorGateId?: string | null; pathType: "vendor_service" | "runner_purchase" | "operator_manual" | "unsupported";
    createdBy: string; eventId: string; now?: Date; }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO dispatch_requests
          (id, workflow_id, mandate_state_snapshot_json, candidate_id, vendor_agreement_id,
           provider_acceptance_id, operator_gate_id, path_type, dispatch_status,
           dispatch_ready_reason_json, blocked_reason_json, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
        [input.id, input.workflowId, JSON.stringify(input.mandateStateSnapshot), input.candidateId ?? null,
         input.vendorAgreementId ?? null, input.providerAcceptanceId ?? null, input.operatorGateId ?? null,
         input.pathType, JSON.stringify([]), JSON.stringify([]), input.createdBy]);
      await this.insertEvent(connection, { id: input.eventId, dispatchRequestId: input.id,
        eventType: "created", occurredAt: input.now ?? new Date(), actorType: "operator",
        actorIdentifier: input.createdBy, summary: "Dispatch request draft created",
        evidence: { pathType: input.pathType }, createdBy: input.createdBy });
      await connection.commit();
      return { id: input.id, status: "draft" as const, dispatchIntegrationInvoked: false as const };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  async recordReadiness(input: { dispatchRequestId: string; decision: DispatchProofDecision;
    eventId: string; createdBy: string; occurredAt?: Date; evidence: unknown; }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await this.lockDispatch(connection, input.dispatchRequestId);
      const ready = input.decision.allowed && input.decision.readyForManualDispatch
        && input.decision.nextDispatchStatus === "ready_for_manual_dispatch"
        && !input.decision.dispatchIntegrationInvoked && !input.decision.paymentCaptured;
      const status = ready ? "ready_for_manual_dispatch" : "dispatch_blocked";
      const blockedReasons = input.decision.reasons.length > 0
        ? input.decision.reasons : ["dispatch_readiness_decision_invalid"];
      const [updated] = await connection.execute<ResultSetHeader>(
        `UPDATE dispatch_requests SET dispatch_status = ?, dispatch_ready_reason_json = ?, blocked_reason_json = ?
          WHERE id = ? AND dispatch_status IN ('draft','dispatch_blocked')`,
        [status, JSON.stringify(ready ? input.decision.reasons : []),
         JSON.stringify(ready ? [] : blockedReasons), input.dispatchRequestId]);
      if (updated.affectedRows !== 1) throw new Error("Dispatch readiness transition denied");
      await this.insertEvent(connection, { id: input.eventId, dispatchRequestId: input.dispatchRequestId,
        eventType: ready ? "marked_ready" : "blocked", occurredAt: input.occurredAt ?? new Date(),
        actorType: "operator", actorIdentifier: input.createdBy,
        summary: ready ? "Dispatch request marked ready for manual review" : "Dispatch request blocked",
        evidence: input.evidence, createdBy: input.createdBy });
      await connection.commit();
      return { id: input.dispatchRequestId, status, dispatchIntegrationInvoked: false as const };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  async recordManualDispatch(input: { dispatchRequestId: string; eventId: string; occurredAt: Date;
    summary: string; evidence: unknown; createdBy: string; }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const row = await this.lockDispatch(connection, input.dispatchRequestId);
      if (row.dispatch_status !== "ready_for_manual_dispatch") throw new Error("Dispatch request is not ready for manual record");
      await connection.execute(`UPDATE dispatch_requests SET dispatch_status = 'manually_dispatched' WHERE id = ?`,
        [input.dispatchRequestId]);
      await this.insertEvent(connection, { id: input.eventId, dispatchRequestId: input.dispatchRequestId,
        eventType: "manual_dispatch_recorded", occurredAt: input.occurredAt, actorType: "operator",
        actorIdentifier: input.createdBy, summary: input.summary, evidence: input.evidence,
        createdBy: input.createdBy });
      await connection.commit();
      return { id: input.dispatchRequestId, status: "manually_dispatched" as const,
        completed: false as const, dispatchIntegrationInvoked: false as const };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  async recordProof(input: { id: string; dispatchRequestId: string;
    proofType: "photo_receipt" | "vendor_confirmation" | "operator_note" | "customer_confirmation" | "other";
    proofSummary: string; proofPayload: unknown; createdBy: string; eventId: string; occurredAt?: Date; }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const row = await this.lockDispatch(connection, input.dispatchRequestId);
      if (row.dispatch_status !== "manually_dispatched" && row.dispatch_status !== "proof_pending") {
        throw new Error("Manual dispatch record required before proof");
      }
      await connection.execute(
        `INSERT INTO proof_of_completion_records
          (id, dispatch_request_id, proof_status, proof_type, proof_summary, proof_payload_json, created_by)
         VALUES (?, ?, 'submitted', ?, ?, ?, ?)`,
        [input.id, input.dispatchRequestId, input.proofType, input.proofSummary.trim(),
         JSON.stringify(input.proofPayload), input.createdBy]);
      await connection.execute(`UPDATE dispatch_requests SET dispatch_status = 'proof_pending' WHERE id = ?`,
        [input.dispatchRequestId]);
      await this.insertEvent(connection, { id: input.eventId, dispatchRequestId: input.dispatchRequestId,
        eventType: "proof_recorded", occurredAt: input.occurredAt ?? new Date(), actorType: "operator",
        actorIdentifier: input.createdBy, summary: "Proof evidence recorded for review",
        evidence: { proofId: input.id, proofType: input.proofType }, createdBy: input.createdBy });
      await connection.commit();
      return { id: input.id, status: "submitted" as const, completed: false as const, paymentCaptured: false as const };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  async reviewProof(input: { proofId: string; verified: boolean; reviewer: string;
    rejectedReason?: string | null; eventId: string; occurredAt: Date; evidence: unknown; }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, dispatch_request_id, proof_status FROM proof_of_completion_records WHERE id = ? FOR UPDATE`,
        [input.proofId]);
      const proof = rows[0];
      if (!proof || !["submitted", "needs_review"].includes(String(proof.proof_status))) {
        throw new Error("Proof is not reviewable");
      }
      if (!input.verified && !input.rejectedReason?.trim()) throw new Error("Rejected proof requires a reason");
      await connection.execute(
        `UPDATE proof_of_completion_records SET proof_status = ?, verified_by = ?, verified_at = ?, rejected_reason = ?
          WHERE id = ?`,
        [input.verified ? "verified" : "rejected", input.verified ? input.reviewer : null,
         input.verified ? input.occurredAt : null, input.verified ? null : input.rejectedReason!.trim(), input.proofId]);
      await connection.execute(`UPDATE dispatch_requests SET dispatch_status = ? WHERE id = ?`,
        [input.verified ? "proof_verified" : "dispatch_blocked", proof.dispatch_request_id]);
      await this.insertEvent(connection, { id: input.eventId, dispatchRequestId: String(proof.dispatch_request_id),
        eventType: input.verified ? "proof_verified" : "rejected", occurredAt: input.occurredAt,
        actorType: "operator", actorIdentifier: input.reviewer,
        summary: input.verified ? "Proof verified" : "Proof rejected", evidence: input.evidence,
        createdBy: input.reviewer });
      await connection.commit();
      return { id: input.proofId, status: input.verified ? "verified" as const : "rejected" as const,
        completionAllowed: input.verified, paymentCaptured: false as const };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  async getDispatchRequest(id: string) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(`SELECT * FROM dispatch_requests WHERE id = ?`, [id]);
    return rows[0] ?? null;
  }

  async listEvents(dispatchRequestId: string) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM dispatch_events WHERE dispatch_request_id = ? ORDER BY occurred_at, created_at`, [dispatchRequestId]);
    return rows;
  }

  private async lockDispatch(connection: PoolConnection, id: string) {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, dispatch_status FROM dispatch_requests WHERE id = ? FOR UPDATE`, [id]);
    if (!rows[0]) throw new Error("Dispatch request not found");
    return rows[0];
  }

  private async insertEvent(connection: PoolConnection, input: EventInput) {
    if (!input.summary.trim()) throw new Error("Dispatch event summary is required");
    await connection.execute(
      `INSERT INTO dispatch_events
        (id, dispatch_request_id, event_type, event_status, occurred_at, actor_type,
         actor_identifier, summary, evidence_json, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.id, input.dispatchRequestId, input.eventType, input.eventStatus ?? "recorded", input.occurredAt,
       input.actorType, input.actorIdentifier ?? null, input.summary.trim(), JSON.stringify(input.evidence), input.createdBy]);
  }
}
