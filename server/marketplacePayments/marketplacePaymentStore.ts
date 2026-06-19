import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { AuthorizationState, CaptureState, TransferState } from "./marketplacePaymentPolicy";

type IdempotencyRow = RowDataPacket & {
  idempotency_key: string;
  operation_type: string;
  request_payload_hash: string;
  stripe_response_json: string | object | null;
};

function parseJson(value: string | object | null): unknown {
  if (value === null || typeof value === "object") return value;
  return JSON.parse(value);
}

export class MarketplacePaymentStore {
  constructor(private readonly pool: Pool) {}

  /**
   * Reserves an idempotency key before any future Stripe call is made.
   * Returns the prior response if this key was already reserved, so callers
   * can replay without ever issuing a duplicate live call.
   */
  async reserveIdempotencyKey(connection: PoolConnection, input: {
    idempotencyKey: string;
    operationType: string;
    requestPayloadHash: string;
  }): Promise<{ alreadyReserved: boolean; priorResponse: unknown }> {
    await connection.execute<ResultSetHeader>(
      `INSERT IGNORE INTO marketplace_payment_idempotency_keys
         (idempotency_key, operation_type, request_payload_hash)
       VALUES (?, ?, ?)`,
      [input.idempotencyKey, input.operationType, input.requestPayloadHash],
    );
    const [rows] = await connection.execute<IdempotencyRow[]>(
      `SELECT idempotency_key, operation_type, request_payload_hash, stripe_response_json
         FROM marketplace_payment_idempotency_keys WHERE idempotency_key = ?`,
      [input.idempotencyKey],
    );
    const row = rows[0];
    const alreadyReserved = row !== undefined && row.stripe_response_json !== null;
    return { alreadyReserved, priorResponse: row ? parseJson(row.stripe_response_json) : null };
  }

  async recordIdempotentResponse(idempotencyKey: string, response: unknown) {
    await this.pool.execute<ResultSetHeader>(
      `UPDATE marketplace_payment_idempotency_keys SET stripe_response_json = ? WHERE idempotency_key = ?`,
      [JSON.stringify(response), idempotencyKey],
    );
  }

  async createAuthorization(input: {
    id: string;
    guestReadinessPlanItemId: string;
    providerAcceptanceId?: string | null;
    authorityGrantId: string;
    tenantId: string;
    bldgUserId: number;
    buildingSlug: string;
    vendorId?: number | null;
    vendorConnectAccountIdSnapshot?: string | null;
    amountCents: number;
    currency?: string;
    state: AuthorizationState;
    policyDecision: unknown;
    idempotencyKey: string;
    expiresAt?: Date | null;
  }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await this.reserveIdempotencyKey(connection, {
        idempotencyKey: input.idempotencyKey,
        operationType: "marketplace_authorization",
        requestPayloadHash: input.idempotencyKey,
      });
      await connection.execute<ResultSetHeader>(
        `INSERT INTO marketplace_payment_authorizations
           (id, guest_readiness_plan_item_id, provider_acceptance_id, authority_grant_id,
            tenant_id, bldg_user_id, building_slug, vendor_id, vendor_connect_account_id_snapshot,
            amount_cents, currency, state, policy_decision_json, idempotency_key, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.id, input.guestReadinessPlanItemId, input.providerAcceptanceId ?? null, input.authorityGrantId,
          input.tenantId, input.bldgUserId, input.buildingSlug, input.vendorId ?? null,
          input.vendorConnectAccountIdSnapshot ?? null, input.amountCents, input.currency ?? "usd",
          input.state, JSON.stringify(input.policyDecision), input.idempotencyKey, input.expiresAt ?? null,
        ],
      );
      await connection.commit();
      return input.id;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async transitionAuthorizationState(input: {
    authorizationId: string;
    toState: AuthorizationState;
    stripePaymentIntentId?: string | null;
  }) {
    const timestampColumn =
      input.toState === "authorized" ? "authorized_at"
      : input.toState === "cancelled" ? "cancelled_at"
      : null;
    const setClauses = ["state = ?"];
    const params: unknown[] = [input.toState];
    if (timestampColumn) setClauses.push(`${timestampColumn} = CURRENT_TIMESTAMP(3)`);
    if (input.stripePaymentIntentId !== undefined) {
      setClauses.push("stripe_payment_intent_id = ?");
      params.push(input.stripePaymentIntentId);
    }
    params.push(input.authorizationId);
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE marketplace_payment_authorizations SET ${setClauses.join(", ")} WHERE id = ?`,
      params,
    );
    return result.affectedRows === 1;
  }

  async createCapture(input: {
    id: string;
    authorizationId: string;
    state: CaptureState;
    truthCheckDecision: unknown;
    idempotencyKey: string;
  }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await this.reserveIdempotencyKey(connection, {
        idempotencyKey: input.idempotencyKey,
        operationType: "marketplace_capture",
        requestPayloadHash: input.idempotencyKey,
      });
      await connection.execute<ResultSetHeader>(
        `INSERT INTO marketplace_payment_captures
           (id, authorization_id, state, truth_check_decision_json, idempotency_key)
         VALUES (?, ?, ?, ?, ?)`,
        [input.id, input.authorizationId, input.state, JSON.stringify(input.truthCheckDecision), input.idempotencyKey],
      );
      await connection.commit();
      return input.id;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async transitionCaptureState(input: {
    captureId: string;
    toState: CaptureState;
    capturedAmountCents?: number | null;
    failureCode?: string | null;
    failureMessage?: string | null;
  }) {
    const setClauses = ["state = ?"];
    const params: unknown[] = [input.toState];
    if (input.toState === "captured") setClauses.push("captured_at = CURRENT_TIMESTAMP(3)");
    if (input.capturedAmountCents !== undefined) {
      setClauses.push("captured_amount_cents = ?");
      params.push(input.capturedAmountCents);
    }
    if (input.failureCode !== undefined) {
      setClauses.push("failure_code = ?");
      params.push(input.failureCode);
    }
    if (input.failureMessage !== undefined) {
      setClauses.push("failure_message = ?");
      params.push(input.failureMessage);
    }
    params.push(input.captureId);
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE marketplace_payment_captures SET ${setClauses.join(", ")} WHERE id = ?`,
      params,
    );
    return result.affectedRows === 1;
  }

  async createAllocation(input: {
    id: string;
    captureId: string;
    allocationType: "vendor_payable" | "platform_fee" | "tax" | "refund_reserve";
    targetVendorId?: number | null;
    amountCents: number;
  }) {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO marketplace_payment_allocations (id, capture_id, allocation_type, target_vendor_id, amount_cents)
       VALUES (?, ?, ?, ?, ?)`,
      [input.id, input.captureId, input.allocationType, input.targetVendorId ?? null, input.amountCents],
    );
    return input.id;
  }

  async createVendorPayable(input: {
    id: string;
    allocationId: string;
    vendorId?: number | null;
    amountCents: number;
    state: TransferState;
    idempotencyKey: string;
  }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await this.reserveIdempotencyKey(connection, {
        idempotencyKey: input.idempotencyKey,
        operationType: "marketplace_vendor_payable",
        requestPayloadHash: input.idempotencyKey,
      });
      await connection.execute<ResultSetHeader>(
        `INSERT INTO marketplace_vendor_payables (id, allocation_id, vendor_id, amount_cents, state, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [input.id, input.allocationId, input.vendorId ?? null, input.amountCents, input.state, input.idempotencyKey],
      );
      await connection.commit();
      return input.id;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Idempotent by stripe_event_id: a duplicate webhook delivery is detected
   * here (INSERT IGNORE + affectedRows check) and never processed twice.
   */
  async recordStripeEvent(input: {
    stripeEventId: string;
    eventType: string;
    livemode: boolean;
    payload: unknown;
    relatedAuthorizationId?: string | null;
  }): Promise<{ isNewEvent: boolean }> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT IGNORE INTO marketplace_stripe_events
         (stripe_event_id, event_type, livemode, payload_json, related_authorization_id)
       VALUES (?, ?, ?, ?, ?)`,
      [input.stripeEventId, input.eventType, input.livemode, JSON.stringify(input.payload), input.relatedAuthorizationId ?? null],
    );
    return { isNewEvent: result.affectedRows === 1 };
  }

  async markStripeEventProcessed(stripeEventId: string, status: "processed" | "ignored" | "failed", errorText?: string | null) {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE marketplace_stripe_events
          SET processing_status = ?, error_text = ?, processed_at = CURRENT_TIMESTAMP(3)
        WHERE stripe_event_id = ?`,
      [status, errorText ?? null, stripeEventId],
    );
    return result.affectedRows === 1;
  }
}
