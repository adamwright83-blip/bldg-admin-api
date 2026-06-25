import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

function parseJson<T>(value: string | T): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : value;
}

export type StatusHistoryEntry = { status: string; at: string; actor: string };

export type DurableDraft = {
  id: string;
  tenantId: string;
  sourceKey: string;
  candidateId: string | null;
  leadId: string | null;
  lane: string | null;
  channel: string;
  recipientSnapshot: string | null;
  subjectRendered: string | null;
  bodyRendered: string;
  bodyHash: string;
  templateKey: string | null;
  templateVersion: string | null;
  founderEscalationPresent: boolean;
  forbiddenClaimsScanJson: unknown;
  draftStatus: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateDraftInput = {
  id?: string;
  tenantId: string;
  sourceKey: string;
  candidateId?: string | null;
  leadId?: string | null;
  lane?: string | null;
  channel: string;
  recipientSnapshot?: string | null;
  subjectRendered?: string | null;
  bodyRendered: string;
  bodyHash: string;
  templateKey?: string | null;
  templateVersion?: string | null;
  founderEscalationPresent: boolean;
  forbiddenClaimsScanJson: unknown;
  draftStatus?: string;
  createdBy: string;
  now?: Date;
};

type DraftDbRow = RowDataPacket & {
  id: string;
  tenant_id: string;
  source_key: string;
  candidate_id: string | null;
  lead_id: string | null;
  lane: string | null;
  channel: string;
  recipient_snapshot: string | null;
  subject_rendered: string | null;
  body_rendered: string;
  body_hash: string;
  template_key: string | null;
  template_version: string | null;
  founder_escalation_present: number;
  forbidden_claims_scan_json: string | unknown;
  draft_status: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
};

function mapDraftRow(row: DraftDbRow): DurableDraft {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sourceKey: row.source_key,
    candidateId: row.candidate_id,
    leadId: row.lead_id,
    lane: row.lane,
    channel: row.channel,
    recipientSnapshot: row.recipient_snapshot,
    subjectRendered: row.subject_rendered,
    bodyRendered: row.body_rendered,
    bodyHash: row.body_hash,
    templateKey: row.template_key,
    templateVersion: row.template_version,
    founderEscalationPresent: Boolean(row.founder_escalation_present),
    forbiddenClaimsScanJson: parseJson(row.forbidden_claims_scan_json),
    draftStatus: row.draft_status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type DurableContactAttempt = {
  id: string;
  tenantId: string;
  outreachDraftId: string | null;
  sourceKey: string;
  serviceRequestId: string | null;
  candidateId: string | null;
  leadId: string | null;
  lane: string | null;
  channel: string;
  recipientSnapshot: string | null;
  draftSubject: string | null;
  draftBodySnapshot: string | null;
  draftBodyHash: string | null;
  templateKey: string | null;
  templateVersion: string | null;
  founderEscalationPresent: boolean;
  forbiddenClaimsScanJson: unknown;
  sendGateResultJson: unknown;
  automationMode: string;
  providerAdapter: string | null;
  providerAttemptId: string | null;
  status: string;
  statusHistoryJson: StatusHistoryEntry[];
  latestReplyJson: unknown | null;
  latestTermsPacketJson: unknown | null;
  liveProviderInvoked: boolean;
  outreachSentByHeld: boolean;
  providerResponded: boolean;
  providerAccepted: boolean;
  bookingConfirmed: boolean;
  paymentAuthorized: boolean;
  dispatched: boolean;
  idempotencyKey: string;
  occurredAt: Date | null;
  sentAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

type AttemptDbRow = RowDataPacket & {
  id: string;
  tenant_id: string;
  outreach_draft_id: string | null;
  source_key: string;
  service_request_id: string | null;
  candidate_id: string | null;
  lead_id: string | null;
  lane: string | null;
  channel: string;
  recipient_snapshot: string | null;
  draft_subject: string | null;
  draft_body_snapshot: string | null;
  draft_body_hash: string | null;
  template_key: string | null;
  template_version: string | null;
  founder_escalation_present: number;
  forbidden_claims_scan_json: string | unknown;
  send_gate_result_json: string | unknown;
  automation_mode: string;
  provider_adapter: string | null;
  provider_attempt_id: string | null;
  status: string;
  status_history_json: string | StatusHistoryEntry[];
  latest_reply_json: string | unknown | null;
  latest_terms_packet_json: string | unknown | null;
  live_provider_invoked: number;
  outreach_sent_by_held: number;
  provider_responded: number;
  provider_accepted: number;
  booking_confirmed: number;
  payment_authorized: number;
  dispatched: number;
  idempotency_key: string;
  occurred_at: Date | null;
  sent_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
};

function mapAttemptRow(row: AttemptDbRow): DurableContactAttempt {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    outreachDraftId: row.outreach_draft_id,
    sourceKey: row.source_key,
    serviceRequestId: row.service_request_id,
    candidateId: row.candidate_id,
    leadId: row.lead_id,
    lane: row.lane,
    channel: row.channel,
    recipientSnapshot: row.recipient_snapshot,
    draftSubject: row.draft_subject,
    draftBodySnapshot: row.draft_body_snapshot,
    draftBodyHash: row.draft_body_hash,
    templateKey: row.template_key,
    templateVersion: row.template_version,
    founderEscalationPresent: Boolean(row.founder_escalation_present),
    forbiddenClaimsScanJson: parseJson(row.forbidden_claims_scan_json),
    sendGateResultJson: parseJson(row.send_gate_result_json),
    automationMode: row.automation_mode,
    providerAdapter: row.provider_adapter,
    providerAttemptId: row.provider_attempt_id,
    status: row.status,
    statusHistoryJson: parseJson(row.status_history_json) ?? [],
    latestReplyJson: row.latest_reply_json == null ? null : parseJson(row.latest_reply_json),
    latestTermsPacketJson: row.latest_terms_packet_json == null ? null : parseJson(row.latest_terms_packet_json),
    liveProviderInvoked: Boolean(row.live_provider_invoked),
    outreachSentByHeld: Boolean(row.outreach_sent_by_held),
    providerResponded: Boolean(row.provider_responded),
    providerAccepted: Boolean(row.provider_accepted),
    bookingConfirmed: Boolean(row.booking_confirmed),
    paymentAuthorized: Boolean(row.payment_authorized),
    dispatched: Boolean(row.dispatched),
    idempotencyKey: row.idempotency_key,
    occurredAt: row.occurred_at,
    sentAt: row.sent_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Deterministic idempotency key: sourceKey + (candidateId or leadId) +
 * channel + draft body hash + automation mode. Identical inputs always
 * produce the same key, so repeated "Run HELD contact attempt" clicks
 * reuse the same durable row instead of duplicating it.
 */
export function computeIdempotencyKey(input: {
  sourceKey: string;
  candidateId?: string | null;
  leadId?: string | null;
  channel: string;
  draftBodyHash?: string | null;
  automationMode: string;
}): string {
  const identity = input.candidateId ?? input.leadId ?? "no_identity";
  const bodyPart = input.draftBodyHash ?? "no_body_hash";
  const raw = [input.sourceKey, identity, input.channel, bodyPart, input.automationMode].join("::");
  return createHash("sha256").update(raw).digest("hex");
}

export type CreateOrReuseAttemptInput = {
  id?: string;
  tenantId: string;
  outreachDraftId?: string | null;
  sourceKey: string;
  serviceRequestId?: string | null;
  candidateId?: string | null;
  leadId?: string | null;
  lane?: string | null;
  channel: string;
  recipientSnapshot?: string | null;
  draftSubject?: string | null;
  draftBodySnapshot?: string | null;
  draftBodyHash?: string | null;
  templateKey?: string | null;
  templateVersion?: string | null;
  founderEscalationPresent: boolean;
  forbiddenClaimsScanJson: unknown;
  sendGateResultJson: unknown;
  automationMode: string;
  providerAdapter: string;
  providerAttemptId?: string | null;
  status: string;
  statusHistoryJson: StatusHistoryEntry[];
  latestReplyJson?: unknown | null;
  latestTermsPacketJson?: unknown | null;
  occurredAt?: Date | null;
  sentAt?: Date | null;
  createdBy: string;
  now?: Date;
};

export type CreateOrReuseAttemptResult = { attempt: DurableContactAttempt; reused: boolean };

const ATTEMPT_SELECT_COLUMNS = `id, tenant_id, outreach_draft_id, source_key, service_request_id, candidate_id,
  lead_id, lane, channel, recipient_snapshot, draft_subject, draft_body_snapshot, draft_body_hash,
  template_key, template_version, founder_escalation_present, forbidden_claims_scan_json,
  send_gate_result_json, automation_mode, provider_adapter, provider_attempt_id, status,
  status_history_json, latest_reply_json, latest_terms_packet_json, live_provider_invoked,
  outreach_sent_by_held, provider_responded, provider_accepted, booking_confirmed, payment_authorized,
  dispatched, idempotency_key, occurred_at, sent_at, created_by, created_at, updated_at`;

/**
 * Manages durable outreach draft and contact attempt audit records.
 * May write only to vendor_contact_drafts and vendor_contact_attempts.
 * Never writes provider_accepted, booking_confirmed, payment_authorized, or
 * dispatched as true -- those four columns are always written as the
 * literal 0 in every INSERT this store issues, and recordReplyAndTerms's
 * UPDATE statement never references them at all, so there is no code path
 * here that could ever flip them true even under bad input.
 */
export class VendorContactAttemptStore {
  constructor(private readonly pool: Pool) {}

  async createDraft(input: CreateDraftInput): Promise<DurableDraft> {
    const id = input.id ?? randomUUID();
    const now = input.now ?? new Date();
    await this.pool.execute(
      `INSERT INTO vendor_contact_drafts
        (id, tenant_id, source_key, candidate_id, lead_id, lane, channel, recipient_snapshot,
         subject_rendered, body_rendered, body_hash, template_key, template_version,
         founder_escalation_present, forbidden_claims_scan_json, draft_status, created_by,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.tenantId,
        input.sourceKey,
        input.candidateId ?? null,
        input.leadId ?? null,
        input.lane ?? null,
        input.channel,
        input.recipientSnapshot ?? null,
        input.subjectRendered ?? null,
        input.bodyRendered,
        input.bodyHash,
        input.templateKey ?? null,
        input.templateVersion ?? null,
        input.founderEscalationPresent ? 1 : 0,
        JSON.stringify(input.forbiddenClaimsScanJson),
        input.draftStatus ?? "draft_ready",
        input.createdBy,
        now,
        now,
      ],
    );
    return {
      id,
      tenantId: input.tenantId,
      sourceKey: input.sourceKey,
      candidateId: input.candidateId ?? null,
      leadId: input.leadId ?? null,
      lane: input.lane ?? null,
      channel: input.channel,
      recipientSnapshot: input.recipientSnapshot ?? null,
      subjectRendered: input.subjectRendered ?? null,
      bodyRendered: input.bodyRendered,
      bodyHash: input.bodyHash,
      templateKey: input.templateKey ?? null,
      templateVersion: input.templateVersion ?? null,
      founderEscalationPresent: input.founderEscalationPresent,
      forbiddenClaimsScanJson: input.forbiddenClaimsScanJson,
      draftStatus: input.draftStatus ?? "draft_ready",
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
  }

async getDraftById(tenantId: string, draftId: string): Promise<DurableDraft | null> {
    const [rows] = await this.pool.execute<DraftDbRow[]>(
      `SELECT id, tenant_id, source_key, candidate_id, lead_id, lane, channel, recipient_snapshot,
              subject_rendered, body_rendered, body_hash, template_key, template_version,
              founder_escalation_present, forbidden_claims_scan_json, draft_status, created_by,
              created_at, updated_at
         FROM vendor_contact_drafts WHERE tenant_id = ? AND id = ?`,
      [tenantId, draftId],
    );
    return rows[0] ? mapDraftRow(rows[0]) : null;
  }

  /**
   * Looks up an existing attempt by (tenantId, idempotencyKey) first; only
   * inserts a new row when none exists. Never updates an existing row's
   * truth fields -- a reused attempt is returned exactly as already stored.
   */
  async createOrReuseAttempt(input: CreateOrReuseAttemptInput): Promise<CreateOrReuseAttemptResult> {
    const idempotencyKey = computeIdempotencyKey(input);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existingRows] = await connection.execute<AttemptDbRow[]>(
        `SELECT ${ATTEMPT_SELECT_COLUMNS} FROM vendor_contact_attempts
          WHERE tenant_id = ? AND idempotency_key = ? FOR UPDATE`,
        [input.tenantId, idempotencyKey],
      );
      if (existingRows[0]) {
        await connection.commit();
        return { attempt: mapAttemptRow(existingRows[0]), reused: true };
      }

      const id = input.id ?? randomUUID();
      const now = input.now ?? new Date();
      const statusHistoryJson = input.statusHistoryJson;
      await connection.execute(
        `INSERT INTO vendor_contact_attempts
          (id, tenant_id, outreach_draft_id, source_key, service_request_id, candidate_id, lead_id, lane,
           channel, recipient_snapshot, draft_subject, draft_body_snapshot, draft_body_hash, template_key,
           template_version, founder_escalation_present, forbidden_claims_scan_json, send_gate_result_json,
           automation_mode, provider_adapter, provider_attempt_id, status, status_history_json,
           latest_reply_json, latest_terms_packet_json, live_provider_invoked, outreach_sent_by_held,
           provider_responded, provider_accepted, booking_confirmed, payment_authorized, dispatched,
           idempotency_key, occurred_at, sent_at, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.tenantId,
          input.outreachDraftId ?? null,
          input.sourceKey,
          input.serviceRequestId ?? null,
          input.candidateId ?? null,
          input.leadId ?? null,
          input.lane ?? null,
          input.channel,
          input.recipientSnapshot ?? null,
          input.draftSubject ?? null,
          input.draftBodySnapshot ?? null,
          input.draftBodyHash ?? null,
          input.templateKey ?? null,
          input.templateVersion ?? null,
          input.founderEscalationPresent ? 1 : 0,
          JSON.stringify(input.forbiddenClaimsScanJson),
          JSON.stringify(input.sendGateResultJson),
          input.automationMode,
          input.providerAdapter,
          input.providerAttemptId ?? null,
          input.status,
          JSON.stringify(statusHistoryJson),
          input.latestReplyJson == null ? null : JSON.stringify(input.latestReplyJson),
          input.latestTermsPacketJson == null ? null : JSON.stringify(input.latestTermsPacketJson),
          idempotencyKey,
          input.occurredAt ?? null,
          input.sentAt ?? null,
          input.createdBy,
          now,
          now,
        ],
      );
      await connection.commit();
      return {
        reused: false,
        attempt: {
          id,
          tenantId: input.tenantId,
          outreachDraftId: input.outreachDraftId ?? null,
          sourceKey: input.sourceKey,
          serviceRequestId: input.serviceRequestId ?? null,
          candidateId: input.candidateId ?? null,
          leadId: input.leadId ?? null,
          lane: input.lane ?? null,
          channel: input.channel,
          recipientSnapshot: input.recipientSnapshot ?? null,
          draftSubject: input.draftSubject ?? null,
          draftBodySnapshot: input.draftBodySnapshot ?? null,
          draftBodyHash: input.draftBodyHash ?? null,
          templateKey: input.templateKey ?? null,
          templateVersion: input.templateVersion ?? null,
          founderEscalationPresent: input.founderEscalationPresent,
          forbiddenClaimsScanJson: input.forbiddenClaimsScanJson,
          sendGateResultJson: input.sendGateResultJson,
          automationMode: input.automationMode,
          providerAdapter: input.providerAdapter,
          providerAttemptId: input.providerAttemptId ?? null,
          status: input.status,
          statusHistoryJson,
          latestReplyJson: input.latestReplyJson ?? null,
          latestTermsPacketJson: input.latestTermsPacketJson ?? null,
          liveProviderInvoked: false,
          outreachSentByHeld: false,
          providerResponded: false,
          providerAccepted: false,
          bookingConfirmed: false,
          paymentAuthorized: false,
          dispatched: false,
          idempotencyKey,
          occurredAt: input.occurredAt ?? null,
          sentAt: input.sentAt ?? null,
          createdBy: input.createdBy,
          createdAt: now,
          updatedAt: now,
        },
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Updates latest_reply_json/latest_terms_packet_json, sets
   * provider_responded = 1, advances status, and appends to
   * status_history_json. This UPDATE statement never references
   * provider_accepted, booking_confirmed, payment_authorized, or
   * dispatched -- they are structurally untouched by this method.
   */
  async recordReplyAndTerms(input: {
    tenantId: string;
    attemptId: string;
    latestReplyJson: unknown;
    latestTermsPacketJson: unknown;
    nextStatus: string;
    actor: string;
    now?: Date;
  }): Promise<DurableContactAttempt> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<AttemptDbRow[]>(
        `SELECT ${ATTEMPT_SELECT_COLUMNS} FROM vendor_contact_attempts
          WHERE tenant_id = ? AND id = ? FOR UPDATE`,
        [input.tenantId, input.attemptId],
      );
      const current = rows[0];
      if (!current) throw new Error("Vendor contact attempt not found");
      const now = input.now ?? new Date();
      const history: StatusHistoryEntry[] = [
        ...(parseJson<StatusHistoryEntry[]>(current.status_history_json) ?? []),
        { status: input.nextStatus, at: now.toISOString(), actor: input.actor },
      ];
      await connection.execute(
        `UPDATE vendor_contact_attempts
            SET latest_reply_json = ?, latest_terms_packet_json = ?, provider_responded = 1,
                status = ?, status_history_json = ?, updated_at = ?
          WHERE tenant_id = ? AND id = ?`,
        [
          JSON.stringify(input.latestReplyJson),
          JSON.stringify(input.latestTermsPacketJson),
          input.nextStatus,
          JSON.stringify(history),
          now,
          input.tenantId,
          input.attemptId,
        ],
      );
      await connection.commit();
      return mapAttemptRow({
        ...current,
        latest_reply_json: JSON.stringify(input.latestReplyJson),
        latest_terms_packet_json: JSON.stringify(input.latestTermsPacketJson),
        provider_responded: 1,
        status: input.nextStatus,
        status_history_json: JSON.stringify(history),
        updated_at: now,
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Records the outcome of a real (or attempted) live-provider send:
   * provider_adapter, provider_attempt_id, live_provider_invoked,
   * outreach_sent_by_held, status, status_history_json, and sent_at only.
   * This UPDATE statement's column list never references
   * provider_accepted, booking_confirmed, payment_authorized, or
   * dispatched -- they remain structurally untouched regardless of what
   * the live provider reported.
   */
  async recordLiveSendResult(input: {
    tenantId: string;
    attemptId: string;
    providerAdapter: string;
    providerAttemptId: string | null;
    liveProviderInvoked: boolean;
    outreachSentByHeld: boolean;
    nextStatus: string;
    actor: string;
    now?: Date;
  }): Promise<DurableContactAttempt> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<AttemptDbRow[]>(
        `SELECT ${ATTEMPT_SELECT_COLUMNS} FROM vendor_contact_attempts
          WHERE tenant_id = ? AND id = ? FOR UPDATE`,
        [input.tenantId, input.attemptId],
      );
      const current = rows[0];
      if (!current) throw new Error("Vendor contact attempt not found");
      const now = input.now ?? new Date();
      const sentAt = input.outreachSentByHeld ? now : null;
      const history: StatusHistoryEntry[] = [
        ...(parseJson<StatusHistoryEntry[]>(current.status_history_json) ?? []),
        { status: input.nextStatus, at: now.toISOString(), actor: input.actor },
      ];
      await connection.execute(
        `UPDATE vendor_contact_attempts
            SET provider_adapter = ?, provider_attempt_id = ?, live_provider_invoked = ?,
                outreach_sent_by_held = ?, status = ?, status_history_json = ?, sent_at = ?, updated_at = ?
          WHERE tenant_id = ? AND id = ?`,
        [
          input.providerAdapter,
          input.providerAttemptId,
          input.liveProviderInvoked ? 1 : 0,
          input.outreachSentByHeld ? 1 : 0,
          input.nextStatus,
          JSON.stringify(history),
          sentAt,
          now,
          input.tenantId,
          input.attemptId,
        ],
      );
      await connection.commit();
      return mapAttemptRow({
        ...current,
        provider_adapter: input.providerAdapter,
        provider_attempt_id: input.providerAttemptId,
        live_provider_invoked: input.liveProviderInvoked ? 1 : 0,
        outreach_sent_by_held: input.outreachSentByHeld ? 1 : 0,
        status: input.nextStatus,
        status_history_json: JSON.stringify(history),
        sent_at: sentAt,
        updated_at: now,
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getAttemptById(tenantId: string, attemptId: string): Promise<DurableContactAttempt | null> {
    const [rows] = await this.pool.execute<AttemptDbRow[]>(
      `SELECT ${ATTEMPT_SELECT_COLUMNS} FROM vendor_contact_attempts WHERE tenant_id = ? AND id = ?`,
      [tenantId, attemptId],
    );
    return rows[0] ? mapAttemptRow(rows[0]) : null;
  }

  /**
   * Looks up an attempt by the outbound provider's own message id, with no
   * tenant filter -- an inbound webhook has no tenant context of its own,
   * only the AgentMail correlation id. provider_attempt_id is set exactly
   * once, at the original outbound send, so this is a safe, narrow lookup
   * rather than a broad scan.
   */
  async getAttemptByProviderAttemptId(providerAttemptId: string): Promise<DurableContactAttempt | null> {
    const [rows] = await this.pool.execute<AttemptDbRow[]>(
      `SELECT ${ATTEMPT_SELECT_COLUMNS} FROM vendor_contact_attempts WHERE provider_attempt_id = ? LIMIT 1`,
      [providerAttemptId],
    );
    return rows[0] ? mapAttemptRow(rows[0]) : null;
  }

  async listAttemptsBySourceKey(tenantId: string, sourceKey: string, limit = 50): Promise<DurableContactAttempt[]> {
    const boundedLimit = Math.min(Math.max(limit, 1), 250);
    const [rows] = await this.pool.execute<AttemptDbRow[]>(
      `SELECT ${ATTEMPT_SELECT_COLUMNS} FROM vendor_contact_attempts
        WHERE tenant_id = ? AND source_key = ? ORDER BY created_at DESC LIMIT ?`,
      [tenantId, sourceKey, boundedLimit],
    );
    return rows.map(mapAttemptRow);
  }

  async listAttemptsByCandidateId(tenantId: string, candidateId: string, limit = 50): Promise<DurableContactAttempt[]> {
    const boundedLimit = Math.min(Math.max(limit, 1), 250);
    const [rows] = await this.pool.execute<AttemptDbRow[]>(
      `SELECT ${ATTEMPT_SELECT_COLUMNS} FROM vendor_contact_attempts
        WHERE tenant_id = ? AND candidate_id = ? ORDER BY created_at DESC LIMIT ?`,
      [tenantId, candidateId, boundedLimit],
    );
    return rows.map(mapAttemptRow);
  }

  async listRecentAttempts(input: { tenantId: string; limit?: number; cursor?: string | null }): Promise<{
    attempts: DurableContactAttempt[];
    nextCursor: string | null;
  }> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 250);
    const params: unknown[] = [input.tenantId];
    let cursorClause = "";
    if (input.cursor) {
      cursorClause = " AND created_at < ?";
      params.push(new Date(input.cursor));
    }
    params.push(limit);
    const [rows] = await this.pool.execute<AttemptDbRow[]>(
      `SELECT ${ATTEMPT_SELECT_COLUMNS} FROM vendor_contact_attempts
        WHERE tenant_id = ?${cursorClause} ORDER BY created_at DESC LIMIT ?`,
      params,
    );
    const attempts = rows.map(mapAttemptRow);
    const last = attempts[attempts.length - 1];
    return {
      attempts,
      nextCursor: attempts.length === limit && last ? last.createdAt.toISOString() : null,
    };
  }
}
