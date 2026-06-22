import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  evaluateResidentProposalConsent,
  RESIDENT_PROPOSAL_CONSENT_ACTION,
  RESIDENT_PROPOSAL_CONSENT_COPY_VERSION,
  type ResidentProposalConsentDecision,
} from "./residentProposalConsentPolicy";
import { ResidentProposalReadStore } from "./residentProposalReadStore";

type ConsentRow = RowDataPacket & {
  id: string; proposal_version_id: string; tenant_id: string; bldg_user_id: number;
  consent_action: string; copy_version: string; proposal_version_snapshot_hash: string;
  audit_metadata_json: unknown; created_by: string; consented_at: Date;
};
type HashRow = RowDataPacket & { job_card_snapshot_hash: string };

export type ResidentProposalConsentRecord = {
  id: string; proposalVersionId: string; tenantId: string; bldgUserId: number;
  consentAction: string; copyVersion: string; proposalVersionSnapshotHash: string;
  createdBy: string; consentedAt: Date;
};

/**
 * Reads vendor_proposal_versions (via ResidentProposalReadStore, read-only)
 * and resident_proposal_consents. Writes only to resident_proposal_consents
 * -- no other table in this system. Records a resident's consent fact only;
 * performs no real-world action and creates no execution truth of any kind.
 */
export class ResidentProposalConsentStore {
  private readonly readStore: Pick<ResidentProposalReadStore, "readOwned">;

  constructor(private readonly pool: Pool, injectedReadStore?: Pick<ResidentProposalReadStore, "readOwned">) {
    this.readStore = injectedReadStore ?? new ResidentProposalReadStore(pool);
  }

  async recordConsent(input: {
    id: string; versionId: string; bldgUserId: number; tenantId: string; createdBy: string; now?: Date;
  }): Promise<{ decision: ResidentProposalConsentDecision; record: ResidentProposalConsentRecord | null }> {
    const now = input.now ?? new Date();

    const existing = await this.readExistingConsent(this.pool, input.versionId, input.tenantId, input.bldgUserId);
    if (existing) {
      const decision = evaluateResidentProposalConsent({
        versionId: input.versionId, bldgUserId: input.bldgUserId, tenantId: input.tenantId,
        hasExistingConsent: true, card: null,
      });
      return { decision, record: this.toRecord(existing) };
    }

    const card = await this.readStore.readOwned({
      versionId: input.versionId, bldgUserId: input.bldgUserId, tenantId: input.tenantId, now,
    });
    const decision = evaluateResidentProposalConsent({
      versionId: input.versionId, bldgUserId: input.bldgUserId, tenantId: input.tenantId,
      hasExistingConsent: false, card,
    });
    if (decision.outcome !== "consent_recorded") {
      return { decision, record: null };
    }

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      const [hashRows] = await connection.execute<HashRow[]>(
        `SELECT job_card_snapshot_hash FROM vendor_proposal_versions WHERE id = ? FOR SHARE`,
        [input.versionId]);
      const snapshotHash = hashRows[0]?.job_card_snapshot_hash;
      if (!snapshotHash) throw new Error("Vendor proposal version not found");

      await connection.execute(
        `INSERT IGNORE INTO resident_proposal_consents
          (id, proposal_version_id, tenant_id, bldg_user_id, consent_action, copy_version,
           proposal_version_snapshot_hash, audit_metadata_json, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.id, input.versionId, input.tenantId, input.bldgUserId, RESIDENT_PROPOSAL_CONSENT_ACTION,
         RESIDENT_PROPOSAL_CONSENT_COPY_VERSION, snapshotHash,
         JSON.stringify({ recordedAt: now.toISOString() }), input.createdBy]);

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const record = await this.readExistingConsent(this.pool, input.versionId, input.tenantId, input.bldgUserId);
    return { decision, record: record ? this.toRecord(record) : null };
  }

  private async readExistingConsent(
    connection: Pool | PoolConnection, versionId: string, tenantId: string, bldgUserId: number,
  ): Promise<ConsentRow | null> {
    const [rows] = await connection.execute<ConsentRow[]>(
      `SELECT id, proposal_version_id, tenant_id, bldg_user_id, consent_action, copy_version,
              proposal_version_snapshot_hash, audit_metadata_json, created_by, consented_at
         FROM resident_proposal_consents
         WHERE proposal_version_id = ? AND tenant_id = ? AND bldg_user_id = ? LIMIT 1`,
      [versionId, tenantId, bldgUserId]);
    return rows[0] ?? null;
  }

  private toRecord(row: ConsentRow): ResidentProposalConsentRecord {
    return {
      id: row.id, proposalVersionId: row.proposal_version_id, tenantId: row.tenant_id,
      bldgUserId: row.bldg_user_id, consentAction: row.consent_action, copyVersion: row.copy_version,
      proposalVersionSnapshotHash: row.proposal_version_snapshot_hash, createdBy: row.created_by,
      consentedAt: row.consented_at,
    };
  }
}
