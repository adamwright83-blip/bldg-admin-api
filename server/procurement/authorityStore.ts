import type { Pool, ResultSetHeader } from "mysql2/promise";
import type { PolicyDecision } from "./authorityPolicy";

export type AuthorityAuditEvent =
  | "created" | "signed" | "activated" | "revoked" | "expired"
  | "policy_check_performed" | "attempted_use_denied" | "attempted_use_allowed";

export class AuthorityGrantStore {
  constructor(private readonly pool: Pool) {}

  async appendAudit(input: {
    authorityGrantId: string;
    eventType: AuthorityAuditEvent;
    actorType: "resident" | "operator" | "system" | "policy";
    actorId?: string | null;
    eventData?: unknown;
  }) {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO authority_grant_audit
         (authority_grant_id, event_type, actor_type, actor_id, event_data_json)
       VALUES (?, ?, ?, ?, ?)`,
      [input.authorityGrantId, input.eventType, input.actorType, input.actorId ?? null,
       input.eventData === undefined ? null : JSON.stringify(input.eventData)],
    );
    return result.insertId;
  }

  async recordPolicyDecision(authorityGrantId: string, decision: PolicyDecision) {
    await this.appendAudit({
      authorityGrantId,
      eventType: "policy_check_performed",
      actorType: "policy",
      eventData: decision,
    });
    await this.appendAudit({
      authorityGrantId,
      eventType: decision.allowed ? "attempted_use_allowed" : "attempted_use_denied",
      actorType: "policy",
      eventData: decision,
    });
  }
}
