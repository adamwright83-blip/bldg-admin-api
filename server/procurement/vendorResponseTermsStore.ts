import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { evaluateVendorResponseTerms, type VendorResponseTermsDecision } from "./vendorResponseTermsPolicy";
import { interpretVendorResponse } from "./vendorResponseInterpretationPolicy";

type EventRow = RowDataPacket & {
  id: string;
  candidate_id: string;
  workflow_id: string | null;
  direction: "inbound" | "outbound_manual_note";
  occurred_at: Date;
  summary: string;
  raw_payload_json: Record<string, unknown>;
  created_by: string;
};

/**
 * Manages storage of vendor response terms in the database.
 * May write only to the vendor_response_terms table.
 * May read only vendor_outreach_conversation_events and related tables.
 * Never writes to outreach events, drafts, match evaluations, gates, dispatch, payment, Stripe, or legacy vendor tables.
 */
export class VendorResponseTermsStore {
  constructor(private readonly pool: Pool) {}

  async storeResponseTerms(input: {
    id: string;
    outreachEventId: string;
    now?: Date;
  }): Promise<{ decision: VendorResponseTermsDecision }> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      const event = await this.readOutreachEvent(connection, input.outreachEventId);
      if (!event) {
        throw new Error("Outreach event not found");
      }

      // First run the Slice 31 interpretation logic on the manually logged response
      const interpretation = interpretVendorResponse({
        eventType: "vendor_response",
        responseKind: event.direction === "inbound" ? "general" : null, // fallback
        candidateId: event.candidate_id,
        workflowId: event.workflow_id,
        summary: event.summary,
        rawPayload: event.raw_payload_json,
      });

      // Run terms policy
      const now = input.now ?? new Date();
      const decision = evaluateVendorResponseTerms({
        interpretation,
        event: {
          id: event.id,
          workflowId: event.workflow_id,
          candidateId: event.candidate_id,
          occurredAt: event.occurred_at,
          createdBy: event.created_by,
          summary: event.summary,
          rawPayload: event.raw_payload_json,
        },
        now,
      });

      if (!decision.allowed || !decision.terms) {
        throw new Error(`Response terms disallowed or invalid: ${decision.reasons.join(",")}`);
      }

      await this.insertResponseTerms(connection, {
        id: input.id,
        ...decision.terms,
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

  private async readOutreachEvent(connection: PoolConnection, eventId: string): Promise<EventRow | null> {
    const [rows] = await connection.execute<EventRow[]>(
      `SELECT id, candidate_id, workflow_id, direction, occurred_at, summary, raw_payload_json, created_by
         FROM vendor_outreach_conversation_events
        WHERE id = ? FOR SHARE`,
      [eventId]
    );
    return rows[0] ?? null;
  }

  private async insertResponseTerms(connection: PoolConnection, terms: any): Promise<void> {
    await connection.execute(
      `INSERT INTO vendor_response_terms
        (id, workflow_id, candidate_id, outreach_event_id, interpretation_status,
         availability_status, rate_status, quoted_amount, quoted_currency, rate_unit,
         availability_windows_json, constraints_json, terms_summary_json, confidence,
         observed_at, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        terms.id,
        terms.workflowId,
        terms.candidateId,
        terms.outreachEventId,
        terms.interpretationStatus,
        terms.availabilityStatus,
        terms.rateStatus,
        terms.quotedAmount,
        terms.quotedCurrency,
        terms.rateUnit,
        JSON.stringify(terms.availabilityWindowsJson),
        JSON.stringify(terms.constraintsJson),
        JSON.stringify(terms.termsSummaryJson),
        terms.confidence,
        terms.observedAt,
        terms.expiresAt,
        terms.createdBy,
      ]
    );
  }
}
