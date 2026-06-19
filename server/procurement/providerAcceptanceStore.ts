import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import type { AcceptanceStatus, AcceptanceType, CaptureTruthCheckDecision } from "./providerAcceptancePolicy";

export type BookingTruthEventType =
  | "offer_created" | "provider_accepted" | "provider_declined" | "provider_countered"
  | "operator_verified" | "expired" | "cancelled"
  | "truth_check_performed" | "truth_check_allowed" | "truth_check_denied";

export type BookingTruthActorType = "system" | "operator" | "provider" | "policy";

export class ProviderAcceptanceStore {
  constructor(private readonly pool: Pool) {}

  async createOffer(input: {
    id: string;
    guestReadinessPlanItemId: string;
    tenantId: string;
    bldgUserId: number;
    buildingSlug: string;
    vendorId?: number | null;
    vendorNameSnapshot?: string | null;
    vendorContactSnapshot?: unknown;
    vendorSourceType: string;
    acceptanceType: AcceptanceType;
    acceptanceStatus?: AcceptanceStatus;
    expiresAt?: Date | null;
    serviceWindowStart?: Date | null;
    serviceWindowEnd?: Date | null;
    termsSnapshot?: unknown;
    decisionEvidence: unknown;
    createdBy?: string | null;
  }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO guest_readiness_provider_acceptances
           (id, guest_readiness_plan_item_id, tenant_id, bldg_user_id, building_slug,
            vendor_id, vendor_name_snapshot, vendor_contact_snapshot_json, vendor_source_type,
            acceptance_type, acceptance_status, expires_at, service_window_start, service_window_end,
            terms_snapshot_json, decision_evidence_json, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.id, input.guestReadinessPlanItemId, input.tenantId, input.bldgUserId, input.buildingSlug,
          input.vendorId ?? null, input.vendorNameSnapshot ?? null,
          input.vendorContactSnapshot === undefined ? null : JSON.stringify(input.vendorContactSnapshot),
          input.vendorSourceType, input.acceptanceType, input.acceptanceStatus ?? "draft",
          input.expiresAt ?? null, input.serviceWindowStart ?? null, input.serviceWindowEnd ?? null,
          input.termsSnapshot === undefined ? null : JSON.stringify(input.termsSnapshot),
          JSON.stringify(input.decisionEvidence), input.createdBy ?? null,
        ],
      );
      await this.insertEvent(connection, {
        providerAcceptanceId: input.id,
        guestReadinessPlanItemId: input.guestReadinessPlanItemId,
        eventType: "offer_created",
        actorType: "system",
        eventData: { acceptanceType: input.acceptanceType },
      });
      await connection.commit();
      return input.id;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async transitionStatus(input: {
    acceptanceId: string;
    guestReadinessPlanItemId: string;
    toStatus: AcceptanceStatus;
    eventType: BookingTruthEventType;
    actorType: BookingTruthActorType;
    actorId?: string | null;
    acceptedPriceCents?: number | null;
    eventData?: unknown;
  }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const timestampColumn =
        input.toStatus === "accepted" || input.toStatus === "operator_verified" ? "accepted_at"
        : input.toStatus === "declined" ? "declined_at"
        : input.toStatus === "countered" ? "countered_at"
        : null;
      const setClauses = ["acceptance_status = ?"];
      const params: unknown[] = [input.toStatus];
      if (timestampColumn) {
        setClauses.push(`${timestampColumn} = CURRENT_TIMESTAMP(3)`);
      }
      if (input.acceptedPriceCents !== undefined) {
        setClauses.push("accepted_price_cents = ?");
        params.push(input.acceptedPriceCents);
      }
      params.push(input.acceptanceId);
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE guest_readiness_provider_acceptances SET ${setClauses.join(", ")} WHERE id = ?`,
        params,
      );
      if (result.affectedRows !== 1) throw new Error(`Provider acceptance ${input.acceptanceId} not found`);
      await this.insertEvent(connection, {
        providerAcceptanceId: input.acceptanceId,
        guestReadinessPlanItemId: input.guestReadinessPlanItemId,
        eventType: input.eventType,
        actorType: input.actorType,
        actorId: input.actorId,
        eventData: input.eventData,
      });
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async recordCaptureTruthCheck(input: {
    acceptanceId: string;
    guestReadinessPlanItemId: string;
    decision: CaptureTruthCheckDecision;
  }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await this.insertEvent(connection, {
        providerAcceptanceId: input.acceptanceId,
        guestReadinessPlanItemId: input.guestReadinessPlanItemId,
        eventType: "truth_check_performed",
        actorType: "policy",
        eventData: input.decision,
      });
      await this.insertEvent(connection, {
        providerAcceptanceId: input.acceptanceId,
        guestReadinessPlanItemId: input.guestReadinessPlanItemId,
        eventType: input.decision.allowed ? "truth_check_allowed" : "truth_check_denied",
        actorType: "policy",
        eventData: input.decision,
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async insertEvent(
    connection: PoolConnection,
    input: {
      providerAcceptanceId: string;
      guestReadinessPlanItemId: string;
      eventType: BookingTruthEventType;
      actorType: BookingTruthActorType;
      actorId?: string | null;
      eventData?: unknown;
    },
  ) {
    await connection.execute<ResultSetHeader>(
      `INSERT INTO guest_readiness_booking_truth_events
         (provider_acceptance_id, guest_readiness_plan_item_id, event_type, actor_type, actor_id, event_data_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.providerAcceptanceId, input.guestReadinessPlanItemId, input.eventType, input.actorType,
        input.actorId ?? null, input.eventData === undefined ? null : JSON.stringify(input.eventData),
      ],
    );
  }
}
