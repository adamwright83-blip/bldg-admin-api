// Slice 79a. Many-to-many mission <-> candidate match table. A candidate
// discovered for one mission can also match a different mission later
// (e.g. the same category, a different ZIP/service mode) -- this is
// deliberately NOT a single mission_id column on vendor_sourcing_candidates.
// This store never writes to vendor_contact_attempts, never sends
// outreach, and never marks any provider-acceptance/booking/payment/
// dispatch truth.

import { randomUUID } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";

export const QUERY_PLANNER_SOURCES = ["anthropic_structured", "deterministic_fallback", "unknown"] as const;
export type MatchQueryPlannerSource = (typeof QUERY_PLANNER_SOURCES)[number];

export const MATCH_SERVICE_MODES = ["mobile_required", "building_service_required", "storefront_ok", "unknown"] as const;
export type MatchServiceMode = (typeof MATCH_SERVICE_MODES)[number];

export type VendorMissionCandidateMatch = {
  id: string;
  tenantId: string;
  missionId: string;
  candidateId: string;
  matchedQuery: string | null;
  queryPlannerSource: MatchQueryPlannerSource;
  serviceMode: MatchServiceMode;
  rankScore: number | null;
  rankPosition: number | null;
  isShortlisted: boolean;
  matchEvidence: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type MatchDbRow = RowDataPacket & {
  id: string; tenant_id: string; mission_id: string; candidate_id: string; matched_query: string | null;
  query_planner_source: MatchQueryPlannerSource; service_mode: MatchServiceMode;
  rank_score: string | number | null; rank_position: number | null; is_shortlisted: number;
  match_evidence_json: string | Record<string, unknown> | null; created_at: Date; updated_at: Date;
};

function mapRow(row: MatchDbRow): VendorMissionCandidateMatch {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    missionId: row.mission_id,
    candidateId: row.candidate_id,
    matchedQuery: row.matched_query,
    queryPlannerSource: row.query_planner_source,
    serviceMode: row.service_mode,
    rankScore: row.rank_score === null ? null : Number(row.rank_score),
    rankPosition: row.rank_position,
    isShortlisted: row.is_shortlisted === 1,
    matchEvidence: row.match_evidence_json === null
      ? null
      : (typeof row.match_evidence_json === "string" ? JSON.parse(row.match_evidence_json) : row.match_evidence_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `id, tenant_id, mission_id, candidate_id, matched_query, query_planner_source, service_mode,
  rank_score, rank_position, is_shortlisted, match_evidence_json, created_at, updated_at`;

export type UpsertMatchInput = {
  tenantId: string;
  missionId: string;
  candidateId: string;
  matchedQuery?: string | null;
  queryPlannerSource: MatchQueryPlannerSource;
  serviceMode: MatchServiceMode;
  rankScore?: number | null;
  rankPosition?: number | null;
  isShortlisted: boolean;
  matchEvidence?: unknown;
};

export class VendorMissionCandidateMatchStore {
  constructor(private readonly pool: Pool) {}

  /**
   * Idempotent upsert keyed on the table's own
   * uq_vendor_mission_candidate_matches_mission_candidate UNIQUE KEY
   * (tenant_id, mission_id, candidate_id) -- a rerun for the same
   * mission/candidate pair updates the existing row rather than
   * creating a duplicate. The same candidate_id may have separate rows
   * for different mission_ids.
   */
  async upsertMatch(input: UpsertMatchInput): Promise<VendorMissionCandidateMatch> {
    const id = randomUUID();
    await this.pool.execute(
      `INSERT INTO vendor_acquisition_mission_candidate_matches
        (id, tenant_id, mission_id, candidate_id, matched_query, query_planner_source, service_mode,
         rank_score, rank_position, is_shortlisted, match_evidence_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         matched_query = VALUES(matched_query),
         query_planner_source = VALUES(query_planner_source),
         service_mode = VALUES(service_mode),
         rank_score = VALUES(rank_score),
         rank_position = VALUES(rank_position),
         is_shortlisted = VALUES(is_shortlisted),
         match_evidence_json = VALUES(match_evidence_json)`,
      [
        id,
        input.tenantId,
        input.missionId,
        input.candidateId,
        input.matchedQuery ?? null,
        input.queryPlannerSource,
        input.serviceMode,
        input.rankScore ?? null,
        input.rankPosition ?? null,
        input.isShortlisted ? 1 : 0,
        input.matchEvidence === undefined ? null : JSON.stringify(input.matchEvidence),
      ],
    );
    const [rows] = await this.pool.execute<MatchDbRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM vendor_acquisition_mission_candidate_matches
        WHERE tenant_id = ? AND mission_id = ? AND candidate_id = ?`,
      [input.tenantId, input.missionId, input.candidateId],
    );
    if (!rows[0]) throw new Error("Failed to read back mission candidate match after upsert");
    return mapRow(rows[0]);
  }

  /**
   * Mission-scoped, joined read: returns shortlisted (or, with
   * includeOverflow, all) matches for a mission together with the real
   * candidate row, ordered by rank_position. LIMIT is inlined (not
   * bound as a `?` placeholder) -- mysql2's .execute() fails against
   * this MySQL version with "Incorrect arguments to mysqld_stmt_execute"
   * when LIMIT is a bound parameter (confirmed by direct reproduction
   * against production MySQL 9.6.0 in an earlier slice).
   */
  async listMissionMatches(input: {
    tenantId: string; missionId: string; includeOverflow?: boolean; limit?: number;
  }): Promise<VendorMissionCandidateMatch[]> {
    const limit = Math.trunc(Math.min(Math.max(input.limit ?? 100, 1), 250));
    const shortlistClause = input.includeOverflow ? "" : " AND is_shortlisted = 1";
    const [rows] = await this.pool.execute<MatchDbRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM vendor_acquisition_mission_candidate_matches
        WHERE tenant_id = ? AND mission_id = ?${shortlistClause}
        ORDER BY rank_position ASC, created_at DESC LIMIT ${limit}`,
      [input.tenantId, input.missionId],
    );
    return rows.map(mapRow);
  }

  async countMissionMatches(input: { tenantId: string; missionId: string }): Promise<{ total: number; shortlisted: number }> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total, SUM(is_shortlisted) AS shortlisted
         FROM vendor_acquisition_mission_candidate_matches WHERE tenant_id = ? AND mission_id = ?`,
      [input.tenantId, input.missionId],
    );
    return { total: Number(rows[0]?.total ?? 0), shortlisted: Number(rows[0]?.shortlisted ?? 0) };
  }
}
