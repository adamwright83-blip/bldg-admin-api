import type { Pool, RowDataPacket } from "mysql2/promise";
import { buildResidentProposalPresentation, type ResidentProposalPresentationContract } from "./residentProposalPresentationContract";
import { VendorEvidenceResolverStore } from "./vendorEvidenceResolverStore";
import { VendorProposalReviewStore } from "./vendorProposalReviewStore";

type VisibleRow = RowDataPacket & { version_id: string };

const OWNERSHIP = `(
  (p.job_card_source_type = 'service_request' AND EXISTS (
    SELECT 1 FROM service_requests sr WHERE CAST(sr.id AS CHAR) = p.job_card_source_id AND sr.bldgUserId = ?
  )) OR
  (p.job_card_source_type = 'resident_coordinated_request' AND EXISTS (
    SELECT 1 FROM resident_coordinated_requests rcr WHERE CAST(rcr.id AS CHAR) = p.job_card_source_id
      AND rcr.bldgUserId = ? AND rcr.tenantId = ?
  )) OR
  (p.job_card_source_type = 'resident_agent_plan' AND EXISTS (
    SELECT 1 FROM resident_agent_plans rap WHERE CAST(rap.id AS CHAR) = p.job_card_source_id
      AND rap.bldgUserId = ? AND rap.tenantId = ?
  ))
)`;

export type ResidentProposalCardPage = {
  items: ResidentProposalPresentationContract[];
  page: { limit: number; offset: number; hasMore: boolean };
};

/** Read-only resident projection. Ownership is established before proposal/evidence detail reads. */
export class ResidentProposalReadStore {
  private readonly reviewStore: VendorProposalReviewStore;
  private readonly evidenceStore: VendorEvidenceResolverStore;

  constructor(private readonly pool: Pool) {
    this.reviewStore = new VendorProposalReviewStore(pool);
    this.evidenceStore = new VendorEvidenceResolverStore(pool);
  }

  async listVisible(input: { bldgUserId: number; tenantId: string; limit: number; offset: number; now?: Date }): Promise<ResidentProposalCardPage> {
    const limit = Math.max(1, Math.min(20, Math.trunc(input.limit)));
    const offset = Math.max(0, Math.min(1000, Math.trunc(input.offset)));
    const [rows] = await this.pool.execute<VisibleRow[]>(
      `SELECT v.id AS version_id FROM vendor_proposal_versions v
       JOIN vendor_proposals p ON p.id = v.proposal_id
       WHERE p.proposal_status = 'ready_for_resident_presentation' AND ${OWNERSHIP}
       ORDER BY v.created_at DESC, v.id ASC LIMIT ? OFFSET ?`,
      [input.bldgUserId, input.bldgUserId, input.tenantId, input.bldgUserId, input.tenantId, limit + 1, offset],
    );
    const cards = await Promise.all(rows.slice(0, limit).map(row => this.readOwned({
      versionId: row.version_id, bldgUserId: input.bldgUserId, tenantId: input.tenantId, now: input.now,
    })));
    return { items: cards.filter((card): card is ResidentProposalPresentationContract => card !== null),
      page: { limit, offset, hasMore: rows.length > limit } };
  }

  async readOwned(input: { versionId: string; bldgUserId: number; tenantId: string; now?: Date }): Promise<ResidentProposalPresentationContract | null> {
    const [owned] = await this.pool.execute<VisibleRow[]>(
      `SELECT v.id AS version_id FROM vendor_proposal_versions v
       JOIN vendor_proposals p ON p.id = v.proposal_id
       WHERE v.id = ? AND p.proposal_status = 'ready_for_resident_presentation' AND ${OWNERSHIP} LIMIT 1`,
      [input.versionId, input.bldgUserId, input.bldgUserId, input.tenantId, input.bldgUserId, input.tenantId],
    );
    if (!owned[0]) return null;
    const now = input.now ?? new Date();
    const proposal = await this.reviewStore.getVersion(input.versionId, now);
    if (!proposal) return null;
    const evidence = await this.evidenceStore.listEvidenceRowsForCandidates([proposal.candidate.id]);
    const card = buildResidentProposalPresentation({ proposal, selectedEvidenceRows: evidence, now });
    return card.readiness === "ready_for_resident" ? card : null;
  }
}
