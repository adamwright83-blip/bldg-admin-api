import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  evaluateManualOutreachEvent,
  type ManualOutreachEventDecision,
  type VendorResponseKind,
} from "./vendorManualOutreachEventPolicy";
import { vendorOutreachSendReviewGateKey, type VendorOutreachSendReviewGateStatus } from "./vendorOutreachSendReviewPolicy";

type DraftRow = RowDataPacket & { id: string; candidate_id: string; workflow_id: string };
type GateRow = RowDataPacket & { gate_key: string; status: VendorOutreachSendReviewGateStatus; decided_at: Date | null };

function sendReviewStatusFromGate(gate: GateRow | null, now: Date): string | null {
  if (!gate) return "send_review_not_allowed";
  if (gate.status === "pending") return "awaiting_operator_send_review";
  if (gate.status === "rejected" || gate.status === "expired" || gate.status === "cancelled") {
    return "operator_rejected_send";
  }
  if (gate.status === "approved" && gate.decided_at && gate.decided_at.getTime() <= now.getTime()) {
    return "operator_approved_for_manual_send_only";
  }
  return "send_review_requirements_missing";
}

/**
 * Reads vendor_outreach_drafts and procurement_operator_gates (the Slice 29
 * send-review gate only -- never writes to either). Writes only to
 * vendor_outreach_conversation_events, recording operator-supplied facts
 * about manual (human, outside-HELD) outreach sends and vendor responses.
 * Never writes drafts, gates, match-evaluation, dispatch, payment, Stripe,
 * or legacy vendor tables, and never creates a provider-message id or
 * delivery record.
 */
export class VendorManualOutreachEventStore {
  constructor(private readonly pool: Pool) {}

  async logManualSend(input: {
    id: string; draftId: string; channel: string; occurredAt: Date; summary: string;
    rawPayload: Record<string, unknown>; evidencePayload: Record<string, unknown>;
    createdBy: string; now?: Date;
  }): Promise<{ decision: ManualOutreachEventDecision }> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      const draft = await this.readDraft(connection, input.draftId);
      if (!draft) throw new Error("Vendor outreach draft not found");

      const now = input.now ?? new Date();
      const gate = await this.readSendReviewGate(connection, draft.workflow_id, draft.id);
      const sendReviewStatus = sendReviewStatusFromGate(gate, now);

      const decision = evaluateManualOutreachEvent({
        eventType: "manual_send", candidateId: draft.candidate_id, workflowId: draft.workflow_id,
        draftId: draft.id, sendReviewStatus, summary: input.summary, occurredAt: input.occurredAt,
        rawPayload: input.rawPayload, now,
      });
      if (!decision.allowed) {
        throw new Error(`Manual outreach event rejected: ${decision.reasons.join(",")}`);
      }

      await this.insertEvent(connection, {
        id: input.id, candidateId: draft.candidate_id, draftId: draft.id, workflowId: draft.workflow_id,
        direction: decision.direction!, channel: input.channel, eventStatus: decision.eventStatus,
        occurredAt: input.occurredAt, summary: input.summary, rawPayload: input.rawPayload,
        evidencePayload: input.evidencePayload, createdBy: input.createdBy,
      });

      await connection.commit();
      return { decision };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async logVendorResponse(input: {
    id: string; draftId: string; responseKind: VendorResponseKind; channel: string; occurredAt: Date;
    summary: string; rawPayload: Record<string, unknown>; evidencePayload: Record<string, unknown>;
    createdBy: string; now?: Date;
  }): Promise<{ decision: ManualOutreachEventDecision }> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      const draft = await this.readDraft(connection, input.draftId);
      if (!draft) throw new Error("Vendor outreach draft not found");

      const now = input.now ?? new Date();
      const decision = evaluateManualOutreachEvent({
        eventType: "vendor_response", responseKind: input.responseKind,
        candidateId: draft.candidate_id, workflowId: draft.workflow_id, draftId: draft.id,
        summary: input.summary, occurredAt: input.occurredAt, rawPayload: input.rawPayload, now,
      });
      if (!decision.allowed) {
        throw new Error(`Manual outreach event rejected: ${decision.reasons.join(",")}`);
      }

      await this.insertEvent(connection, {
        id: input.id, candidateId: draft.candidate_id, draftId: draft.id, workflowId: draft.workflow_id,
        direction: decision.direction!, channel: input.channel, eventStatus: decision.eventStatus,
        occurredAt: input.occurredAt, summary: input.summary, rawPayload: input.rawPayload,
        evidencePayload: input.evidencePayload, createdBy: input.createdBy,
      });

      await connection.commit();
      return { decision };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async insertEvent(connection: PoolConnection, event: {
    id: string; candidateId: string; draftId: string; workflowId: string; direction: string; channel: string;
    eventStatus: string; occurredAt: Date; summary: string; rawPayload: Record<string, unknown>;
    evidencePayload: Record<string, unknown>; createdBy: string;
  }): Promise<void> {
    await connection.execute(
      `INSERT INTO vendor_outreach_conversation_events
        (id, candidate_id, outreach_draft_id, workflow_id, direction, channel, event_status,
         occurred_at, summary, raw_payload_json, evidence_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [event.id, event.candidateId, event.draftId, event.workflowId, event.direction, event.channel,
       event.eventStatus, event.occurredAt, event.summary, JSON.stringify(event.rawPayload),
       JSON.stringify(event.evidencePayload), event.createdBy]);
  }

  private async readDraft(connection: PoolConnection, draftId: string): Promise<DraftRow | null> {
    const [rows] = await connection.execute<DraftRow[]>(
      `SELECT id, candidate_id, workflow_id FROM vendor_outreach_drafts WHERE id = ? FOR SHARE`,
      [draftId]);
    return rows[0] ?? null;
  }

  private async readSendReviewGate(connection: PoolConnection, workflowId: string, draftId: string): Promise<GateRow | null> {
    const gateKey = vendorOutreachSendReviewGateKey({ draftId });
    const [rows] = await connection.execute<GateRow[]>(
      `SELECT gate_key, status, decided_at FROM procurement_operator_gates
         WHERE workflow_id = ? AND gate_key = ? FOR SHARE`,
      [workflowId, gateKey]);
    return rows[0] ?? null;
  }
}
