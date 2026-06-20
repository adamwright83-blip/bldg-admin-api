import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  evaluateVendorReputationEvidence,
  resolvePersistedEvidenceStatus,
  type EvidenceDbStatus,
  type SourceConfidenceLevel,
  type VendorReputationEvidenceComplianceSnapshot,
  type VendorReputationEvidenceDecision,
} from "./vendorReputationEvidencePolicy";

export type CreateVendorReputationEvidenceSnapshotInput = {
  id: string;
  candidateId: string;
  sourceType: string;
  sourceKey: string;
  rating: number | null;
  ratingScaleMin?: number;
  ratingScaleMax?: number;
  reviewCount: number | null;
  sourceConfidence: SourceConfidenceLevel;
  sourceApproved: boolean;
  observedAt: Date;
  expiresAt: Date;
  sourceUrl?: string | null;
  evidencePayload: Record<string, unknown>;
  complianceSnapshot: VendorReputationEvidenceComplianceSnapshot;
  recordedBy: string;
  /** The status the caller is explicitly attesting to (defaults to "usable" -- an
   * explicit ask to treat this evidence as ready). The policy still decides the
   * persisted status; an unsafe/unapproved source cannot become usable just by asking. */
  requestedEvidenceStatus?: EvidenceDbStatus;
  now?: Date;
};

export type VendorReputationEvidenceSnapshotRecord = {
  id: string;
  candidateId: string;
  sourceType: string;
  sourceKey: string;
  evidenceStatus: EvidenceDbStatus;
  rating: number | null;
  ratingScaleMin: number;
  ratingScaleMax: number;
  reviewCount: number | null;
  sourceConfidence: SourceConfidenceLevel;
  sourceApproved: boolean;
  observedAt: Date;
  expiresAt: Date;
  sourceUrl: string | null;
  recordedBy: string;
  createdAt: Date;
  updatedAt: Date;
};

type SnapshotDbRow = RowDataPacket & {
  id: string; candidate_id: string; source_type: string; source_key: string;
  evidence_status: EvidenceDbStatus; rating: string | null; rating_scale_min: string;
  rating_scale_max: string; review_count: number | null; source_confidence: SourceConfidenceLevel;
  source_approved: number; observed_at: Date; expires_at: Date; source_url: string | null;
  recorded_by: string; created_at: Date; updated_at: Date;
};

function mapRow(row: SnapshotDbRow): VendorReputationEvidenceSnapshotRecord {
  return {
    id: row.id, candidateId: row.candidate_id, sourceType: row.source_type, sourceKey: row.source_key,
    evidenceStatus: row.evidence_status, rating: row.rating === null ? null : Number(row.rating),
    ratingScaleMin: Number(row.rating_scale_min), ratingScaleMax: Number(row.rating_scale_max),
    reviewCount: row.review_count, sourceConfidence: row.source_confidence,
    sourceApproved: !!row.source_approved, observedAt: row.observed_at, expiresAt: row.expires_at,
    sourceUrl: row.source_url, recordedBy: row.recorded_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export class VendorReputationEvidenceStore {
  constructor(private readonly pool: Pool) {}

  /**
   * Writes only vendor_reputation_evidence_snapshots. Reads (FOR SHARE) the
   * candidate and source registry rows purely to validate the foreign keys --
   * never writes to vendor_sourcing_candidates, vendor_source_registry, or any
   * legacy vendor table. evidence_status is always derived from the policy
   * decision, never trusted blindly from caller input, so an unsafe/unapproved
   * source cannot be persisted as usable just by being asked to.
   */
  async createSnapshot(
    input: CreateVendorReputationEvidenceSnapshotInput,
  ): Promise<{ id: string; evidenceStatus: EvidenceDbStatus; decision: VendorReputationEvidenceDecision }> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await this.assertCandidateExists(connection, input.candidateId);
      await this.assertSourceTypeExists(connection, input.sourceType);

      const ratingScaleMin = input.ratingScaleMin ?? 0;
      const ratingScaleMax = input.ratingScaleMax ?? 5;
      const now = input.now ?? new Date();
      const decision = evaluateVendorReputationEvidence({
        candidateId: input.candidateId, sourceType: input.sourceType, sourceKey: input.sourceKey,
        evidenceStatus: input.requestedEvidenceStatus ?? "usable", rating: input.rating, ratingScaleMin, ratingScaleMax,
        reviewCount: input.reviewCount, sourceConfidence: input.sourceConfidence,
        sourceApproved: input.sourceApproved, observedAt: input.observedAt, expiresAt: input.expiresAt,
        evidencePayload: input.evidencePayload, complianceSnapshot: input.complianceSnapshot,
      }, now);
      const evidenceStatus = resolvePersistedEvidenceStatus(decision);

      await connection.execute(
        `INSERT INTO vendor_reputation_evidence_snapshots
          (id, candidate_id, source_type, source_key, evidence_status, rating, rating_scale_min,
           rating_scale_max, review_count, source_confidence, source_approved, observed_at, expires_at,
           source_url, evidence_payload_json, compliance_snapshot_json, recorded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.id, input.candidateId, input.sourceType, input.sourceKey, evidenceStatus, input.rating,
         ratingScaleMin, ratingScaleMax, input.reviewCount, input.sourceConfidence, input.sourceApproved,
         input.observedAt, input.expiresAt, input.sourceUrl ?? null, JSON.stringify(input.evidencePayload),
         JSON.stringify(input.complianceSnapshot), input.recordedBy],
      );
      await connection.commit();
      return { id: input.id, evidenceStatus, decision };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getSnapshot(id: string): Promise<VendorReputationEvidenceSnapshotRecord | null> {
    const [rows] = await this.pool.execute<SnapshotDbRow[]>(
      `SELECT * FROM vendor_reputation_evidence_snapshots WHERE id = ?`, [id],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async listSnapshotsForCandidate(candidateId: string): Promise<VendorReputationEvidenceSnapshotRecord[]> {
    const [rows] = await this.pool.execute<SnapshotDbRow[]>(
      `SELECT * FROM vendor_reputation_evidence_snapshots WHERE candidate_id = ? ORDER BY created_at DESC`,
      [candidateId],
    );
    return rows.map(mapRow);
  }

  private async assertCandidateExists(connection: PoolConnection, candidateId: string) {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM vendor_sourcing_candidates WHERE id = ? FOR SHARE`, [candidateId],
    );
    if (!rows[0]) throw new Error("Vendor sourcing candidate not found");
  }

  private async assertSourceTypeExists(connection: PoolConnection, sourceType: string) {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT source_type FROM vendor_source_registry WHERE source_type = ? FOR SHARE`, [sourceType],
    );
    if (!rows[0]) throw new Error("Vendor source registry entry not found");
  }
}
