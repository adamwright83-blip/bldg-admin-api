import type { Pool, RowDataPacket } from "mysql2/promise";
import type { EvidenceDbStatus, SourceConfidenceLevel } from "./vendorReputationEvidencePolicy";
import type { VendorReputationEvidenceRow } from "./vendorEvidenceResolverPolicy";

type EvidenceDbRow = RowDataPacket & {
  id: string;
  candidate_id: string;
  source_type: string;
  source_key: string;
  evidence_status: EvidenceDbStatus;
  rating: string | null;
  rating_scale_min: string;
  rating_scale_max: string;
  review_count: number | null;
  source_confidence: SourceConfidenceLevel;
  source_approved: number;
  observed_at: Date;
  expires_at: Date;
  evidence_payload_json: string | Record<string, unknown>;
  compliance_snapshot_json: string | Record<string, unknown>;
};

function parseJsonColumn(value: string | Record<string, unknown>): Record<string, unknown> {
  return typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : value;
}

function mapRow(row: EvidenceDbRow): VendorReputationEvidenceRow {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    sourceType: row.source_type,
    sourceKey: row.source_key,
    evidenceStatus: row.evidence_status,
    rating: row.rating === null ? null : Number(row.rating),
    ratingScaleMin: Number(row.rating_scale_min),
    ratingScaleMax: Number(row.rating_scale_max),
    reviewCount: row.review_count,
    sourceConfidence: row.source_confidence,
    sourceApproved: !!row.source_approved,
    observedAt: row.observed_at,
    expiresAt: row.expires_at,
    evidencePayload: parseJsonColumn(row.evidence_payload_json),
    complianceSnapshot: parseJsonColumn(row.compliance_snapshot_json),
  };
}

/**
 * Read-only access to vendor_reputation_evidence_snapshots for the evidence
 * resolver. Only ever SELECTs rows the Slice 24 store already wrote -- never
 * inserts, updates, deletes, or calls an external source/connector.
 */
export class VendorEvidenceResolverStore {
  constructor(private readonly pool: Pool) {}

  async listEvidenceRowsForCandidates(candidateIds: readonly string[]): Promise<VendorReputationEvidenceRow[]> {
    if (!candidateIds.length) return [];
    const [rows] = await this.pool.query<EvidenceDbRow[]>(
      `SELECT id, candidate_id, source_type, source_key, evidence_status, rating,
              rating_scale_min, rating_scale_max, review_count, source_confidence,
              source_approved, observed_at, expires_at, evidence_payload_json, compliance_snapshot_json
         FROM vendor_reputation_evidence_snapshots
        WHERE candidate_id IN (?)`,
      [candidateIds],
    );
    return rows.map(mapRow);
  }
}
