import type { Pool, RowDataPacket } from "mysql2/promise";

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;

export function clampLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIST_LIMIT;
  return Math.max(1, Math.min(MAX_LIST_LIMIT, Math.trunc(limit)));
}

export function clampOffset(offset?: number): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.trunc(offset));
}

export type ListResult<T> = { items: T[]; limit: number; offset: number };

function parseJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return value;
  }
}

export type AuthorizationRecord = {
  id: string;
  guestReadinessPlanItemId: string;
  providerAcceptanceId: string | null;
  authorityGrantId: string;
  tenantId: string;
  bldgUserId: number;
  buildingSlug: string;
  vendorId: number | null;
  vendorConnectAccountIdSnapshot: string | null;
  amountCents: number;
  currency: string;
  state: string;
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
  stripePaymentIntentId: string | null;
  policyDecision: unknown;
  idempotencyKey: string;
  expiresAt: Date | null;
  authorizedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapAuthorizationRow(row: RowDataPacket): AuthorizationRecord {
  return {
    id: row.id,
    guestReadinessPlanItemId: row.guest_readiness_plan_item_id,
    providerAcceptanceId: row.provider_acceptance_id,
    authorityGrantId: row.authority_grant_id,
    tenantId: row.tenant_id,
    bldgUserId: row.bldg_user_id,
    buildingSlug: row.building_slug,
    vendorId: row.vendor_id,
    vendorConnectAccountIdSnapshot: row.vendor_connect_account_id_snapshot,
    amountCents: row.amount_cents,
    currency: row.currency,
    state: row.state,
    stripeCustomerId: row.stripe_customer_id,
    stripePaymentMethodId: row.stripe_payment_method_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    policyDecision: parseJson(row.policy_decision_json),
    idempotencyKey: row.idempotency_key,
    expiresAt: row.expires_at,
    authorizedAt: row.authorized_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type CaptureRecord = {
  id: string;
  authorizationId: string;
  capturedAmountCents: number | null;
  state: string;
  stripePaymentIntentId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  truthCheckDecision: unknown;
  idempotencyKey: string;
  capturedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapCaptureRow(row: RowDataPacket): CaptureRecord {
  return {
    id: row.id,
    authorizationId: row.authorization_id,
    capturedAmountCents: row.captured_amount_cents,
    state: row.state,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    truthCheckDecision: parseJson(row.truth_check_decision_json),
    idempotencyKey: row.idempotency_key,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type VendorPayableRecord = {
  id: string;
  allocationId: string;
  vendorId: number | null;
  amountCents: number;
  state: string;
  stripeTransferId: string | null;
  idempotencyKey: string;
  transferredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapVendorPayableRow(row: RowDataPacket): VendorPayableRecord {
  return {
    id: row.id,
    allocationId: row.allocation_id,
    vendorId: row.vendor_id,
    amountCents: row.amount_cents,
    state: row.state,
    stripeTransferId: row.stripe_transfer_id,
    idempotencyKey: row.idempotency_key,
    transferredAt: row.transferred_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type StripeEventRecord = {
  id: number;
  stripeEventId: string;
  eventType: string;
  livemode: boolean;
  payload: unknown;
  relatedAuthorizationId: string | null;
  processingStatus: string;
  errorText: string | null;
  processedAt: Date | null;
  createdAt: Date;
};

function mapStripeEventRow(row: RowDataPacket): StripeEventRecord {
  return {
    id: row.id,
    stripeEventId: row.stripe_event_id,
    eventType: row.event_type,
    livemode: Boolean(row.livemode),
    payload: parseJson(row.payload_json),
    relatedAuthorizationId: row.related_authorization_id,
    processingStatus: row.processing_status,
    errorText: row.error_text,
    processedAt: row.processed_at,
    createdAt: row.created_at,
  };
}

export type RefundRecord = {
  id: string;
  captureId: string;
  amountCents: number;
  reason: string | null;
  state: string;
  stripeRefundId: string | null;
  idempotencyKey: string;
  refundedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapRefundRow(row: RowDataPacket): RefundRecord {
  return {
    id: row.id,
    captureId: row.capture_id,
    amountCents: row.amount_cents,
    reason: row.reason,
    state: row.state,
    stripeRefundId: row.stripe_refund_id,
    idempotencyKey: row.idempotency_key,
    refundedAt: row.refunded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type DisputeRecord = {
  id: string;
  captureId: string;
  stripeDisputeId: string;
  status: string;
  amountCents: number;
  evidenceDueBy: Date | null;
  outcome: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapDisputeRow(row: RowDataPacket): DisputeRecord {
  return {
    id: row.id,
    captureId: row.capture_id,
    stripeDisputeId: row.stripe_dispute_id,
    status: row.status,
    amountCents: row.amount_cents,
    evidenceDueBy: row.evidence_due_by,
    outcome: row.outcome,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type IdempotencyKeyRecord = {
  idempotencyKey: string;
  operationType: string;
  requestPayloadHash: string;
  hasStripeResponse: boolean;
  createdAt: Date;
};

function mapIdempotencyKeyRow(row: RowDataPacket): IdempotencyKeyRecord {
  return {
    idempotencyKey: row.idempotency_key,
    operationType: row.operation_type,
    requestPayloadHash: row.request_payload_hash,
    hasStripeResponse: row.stripe_response_json !== null,
    createdAt: row.created_at,
  };
}

/**
 * Read-only query layer over the Slice 4 marketplace-payments schema.
 * Every method here issues a `SELECT` only — no INSERT/UPDATE/DELETE, no
 * Stripe calls, no workflow enqueue. This class exists purely so operators
 * can inspect what Slices 4-6 already recorded.
 */
export class MarketplacePaymentReadStore {
  constructor(private readonly pool: Pool) {}

  async getAuthorizationById(id: string): Promise<AuthorizationRecord | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM marketplace_payment_authorizations WHERE id = ?`,
      [id],
    );
    return rows[0] ? mapAuthorizationRow(rows[0]) : null;
  }

  async listAuthorizations(filter: {
    guestReadinessPlanItemId?: string;
    tenantId?: string;
    bldgUserId?: number;
    buildingSlug?: string;
    state?: string;
    limit?: number;
    offset?: number;
  }): Promise<ListResult<AuthorizationRecord>> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.guestReadinessPlanItemId) {
      conditions.push("guest_readiness_plan_item_id = ?");
      params.push(filter.guestReadinessPlanItemId);
    }
    if (filter.tenantId) {
      conditions.push("tenant_id = ?");
      params.push(filter.tenantId);
    }
    if (filter.bldgUserId !== undefined) {
      conditions.push("bldg_user_id = ?");
      params.push(filter.bldgUserId);
    }
    if (filter.buildingSlug) {
      conditions.push("building_slug = ?");
      params.push(filter.buildingSlug);
    }
    if (filter.state) {
      conditions.push("state = ?");
      params.push(filter.state);
    }
    const limit = clampLimit(filter.limit);
    const offset = clampOffset(filter.offset);
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT * FROM marketplace_payment_authorizations ${whereClause}
       ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return { items: rows.map(mapAuthorizationRow), limit, offset };
  }

  async getCaptureById(id: string): Promise<CaptureRecord | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM marketplace_payment_captures WHERE id = ?`,
      [id],
    );
    return rows[0] ? mapCaptureRow(rows[0]) : null;
  }

  async listCapturesByAuthorization(authorizationId: string, pagination: { limit?: number; offset?: number } = {}): Promise<ListResult<CaptureRecord>> {
    const limit = clampLimit(pagination.limit);
    const offset = clampOffset(pagination.offset);
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT * FROM marketplace_payment_captures WHERE authorization_id = ?
       ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
      [authorizationId, limit, offset],
    );
    return { items: rows.map(mapCaptureRow), limit, offset };
  }

  async listVendorPayables(filter: {
    vendorId?: number;
    state?: string;
    limit?: number;
    offset?: number;
  }): Promise<ListResult<VendorPayableRecord>> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.vendorId !== undefined) {
      conditions.push("vendor_id = ?");
      params.push(filter.vendorId);
    }
    if (filter.state) {
      conditions.push("state = ?");
      params.push(filter.state);
    }
    const limit = clampLimit(filter.limit);
    const offset = clampOffset(filter.offset);
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT * FROM marketplace_vendor_payables ${whereClause}
       ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return { items: rows.map(mapVendorPayableRow), limit, offset };
  }

  async listStripeEvents(filter: {
    relatedAuthorizationId?: string;
    processingStatus?: string;
    limit?: number;
    offset?: number;
  }): Promise<ListResult<StripeEventRecord>> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.relatedAuthorizationId) {
      conditions.push("related_authorization_id = ?");
      params.push(filter.relatedAuthorizationId);
    }
    if (filter.processingStatus) {
      conditions.push("processing_status = ?");
      params.push(filter.processingStatus);
    }
    const limit = clampLimit(filter.limit);
    const offset = clampOffset(filter.offset);
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT * FROM marketplace_stripe_events ${whereClause}
       ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return { items: rows.map(mapStripeEventRow), limit, offset };
  }

  async listRefundsByCapture(captureId: string, pagination: { limit?: number; offset?: number } = {}): Promise<ListResult<RefundRecord>> {
    const limit = clampLimit(pagination.limit);
    const offset = clampOffset(pagination.offset);
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT * FROM marketplace_refunds WHERE capture_id = ?
       ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
      [captureId, limit, offset],
    );
    return { items: rows.map(mapRefundRow), limit, offset };
  }

  async listDisputesByCapture(captureId: string, pagination: { limit?: number; offset?: number } = {}): Promise<ListResult<DisputeRecord>> {
    const limit = clampLimit(pagination.limit);
    const offset = clampOffset(pagination.offset);
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT * FROM marketplace_disputes WHERE capture_id = ?
       ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
      [captureId, limit, offset],
    );
    return { items: rows.map(mapDisputeRow), limit, offset };
  }

  async getIdempotencyKeyMetadata(idempotencyKey: string): Promise<IdempotencyKeyRecord | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT idempotency_key, operation_type, request_payload_hash, stripe_response_json, created_at
         FROM marketplace_payment_idempotency_keys WHERE idempotency_key = ?`,
      [idempotencyKey],
    );
    return rows[0] ? mapIdempotencyKeyRow(rows[0]) : null;
  }
}
