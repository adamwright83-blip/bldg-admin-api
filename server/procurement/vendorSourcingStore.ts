import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  canCreateCandidate,
  type VendorSourceRegistryRow,
} from "./vendorSourcingPolicy";

type RegistryDbRow = RowDataPacket & {
  source_type: string;
  compliance_class: string;
  allowed_use_flags_json: string | Record<string, unknown>;
  prohibited_use_flags_json: string | Record<string, unknown>;
  source_policy_json: string | Record<string, unknown>;
  notes: string | null;
};

export type VendorSourcingCandidate = {
  id: string; tenantId: string; buildingSlug: string | null; sourceType: string;
  sourceReference: string; category: string; businessName: string; sourcingStatus: string;
  createdBy: string; createdAt: Date; updatedAt: Date;
};

type CandidateDbRow = RowDataPacket & {
  id: string; tenant_id: string; building_slug: string | null; source_type: string;
  source_reference: string; category: string; business_name: string; sourcing_status: string;
  created_by: string; created_at: Date; updated_at: Date;
};

export type CreateVendorSourcingCandidateInput = {
  id: string;
  tenantId: string;
  buildingSlug?: string | null;
  sourceType: string;
  sourceReference: string;
  category: string;
  businessName: string;
  contact?: unknown;
  publicProfile?: unknown;
  pricingSignals?: unknown;
  evidence: unknown;
  createdBy: string;
};

function parseObject(value: string | Record<string, unknown>): Record<string, unknown> {
  return typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : value;
}

function mapRegistryRow(row: RegistryDbRow): VendorSourceRegistryRow {
  return {
    sourceType: row.source_type,
    complianceClass: row.compliance_class,
    allowedUseFlags: parseObject(row.allowed_use_flags_json),
    prohibitedUseFlags: parseObject(row.prohibited_use_flags_json),
    sourcePolicy: parseObject(row.source_policy_json),
    notes: row.notes,
  };
}

function mapCandidateRow(row: CandidateDbRow): VendorSourcingCandidate {
  return { id: row.id, tenantId: row.tenant_id, buildingSlug: row.building_slug,
    sourceType: row.source_type, sourceReference: row.source_reference, category: row.category,
    businessName: row.business_name, sourcingStatus: row.sourcing_status,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at };
}

export class VendorSourcingStore {
  constructor(private readonly pool: Pool) {}

  async listSourceRegistry(): Promise<VendorSourceRegistryRow[]> {
    const [rows] = await this.pool.query<RegistryDbRow[]>(
      `SELECT source_type, compliance_class, allowed_use_flags_json,
              prohibited_use_flags_json, source_policy_json, notes
         FROM vendor_source_registry ORDER BY source_type`,
    );
    return rows.map(mapRegistryRow);
  }

  async getSourceRegistry(sourceType: string): Promise<VendorSourceRegistryRow | null> {
    const [rows] = await this.pool.execute<RegistryDbRow[]>(
      `SELECT source_type, compliance_class, allowed_use_flags_json,
              prohibited_use_flags_json, source_policy_json, notes
         FROM vendor_source_registry WHERE source_type = ?`,
      [sourceType],
    );
    return rows[0] ? mapRegistryRow(rows[0]) : null;
  }

  async createCandidate(input: CreateVendorSourcingCandidateInput): Promise<string> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const registry = await this.getRegistryForUpdate(connection, input.sourceType);
      const decision = canCreateCandidate(input, registry);
      if (!decision.allowed || !registry) {
        throw new Error(`Vendor sourcing candidate denied: ${decision.reasons.join(",")}`);
      }
      const snapshot = {
        sourceType: registry.sourceType,
        complianceClass: registry.complianceClass,
        allowedUseFlags: registry.allowedUseFlags,
        prohibitedUseFlags: registry.prohibitedUseFlags,
        sourcePolicy: registry.sourcePolicy,
        notes: registry.notes,
      };
      await connection.execute(
        `INSERT INTO vendor_sourcing_candidates
          (id, tenant_id, building_slug, source_type, source_reference, category, business_name,
           contact_json, public_profile_json, pricing_signals_json, evidence_json,
           source_compliance_snapshot_json, sourcing_status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'discovered', ?)`,
        [input.id, input.tenantId, input.buildingSlug ?? null, input.sourceType,
         input.sourceReference.trim(), input.category.trim(), input.businessName.trim(),
         input.contact === undefined ? null : JSON.stringify(input.contact),
         input.publicProfile === undefined ? null : JSON.stringify(input.publicProfile),
         input.pricingSignals === undefined ? null : JSON.stringify(input.pricingSignals),
         JSON.stringify(input.evidence), JSON.stringify(snapshot), input.createdBy],
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
   * Idempotency check for discovery connectors: no unique DB constraint
   * backs (tenant_id, source_type, source_reference) -- this is an
   * application-level check-before-insert, not a transactional guarantee.
   * Safe for normal sequential operator use; not safe against two
   * concurrent discovery runs racing on the same place id.
   */
  async findCandidateBySourceReference(
    tenantId: string, sourceType: string, sourceReference: string,
  ): Promise<VendorSourcingCandidate | null> {
    const [rows] = await this.pool.execute<CandidateDbRow[]>(
      `SELECT id, tenant_id, building_slug, source_type, source_reference, category,
              business_name, sourcing_status, created_by, created_at, updated_at
         FROM vendor_sourcing_candidates
        WHERE tenant_id = ? AND source_type = ? AND source_reference = ? LIMIT 1`,
      [tenantId, sourceType, sourceReference],
    );
    return rows[0] ? mapCandidateRow(rows[0]) : null;
  }

  async getCandidate(tenantId: string, id: string): Promise<VendorSourcingCandidate | null> {
    const [rows] = await this.pool.execute<CandidateDbRow[]>(
      `SELECT id, tenant_id, building_slug, source_type, source_reference, category,
              business_name, sourcing_status, created_by, created_at, updated_at
         FROM vendor_sourcing_candidates WHERE tenant_id = ? AND id = ?`,
      [tenantId, id],
    );
    return rows[0] ? mapCandidateRow(rows[0]) : null;
  }

  async listCandidates(input: { tenantId: string; status?: string; limit?: number }) {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 250);
    const params: unknown[] = [input.tenantId];
    let statusClause = "";
    if (input.status) {
      statusClause = " AND sourcing_status = ?";
      params.push(input.status);
    }
    params.push(limit);
    const [rows] = await this.pool.execute<CandidateDbRow[]>(
      `SELECT id, tenant_id, building_slug, source_type, source_reference, category,
              business_name, sourcing_status, created_by, created_at, updated_at
         FROM vendor_sourcing_candidates
        WHERE tenant_id = ?${statusClause}
        ORDER BY created_at DESC LIMIT ?`,
      params,
    );
    return rows.map(mapCandidateRow);
  }

  private async getRegistryForUpdate(connection: PoolConnection, sourceType: string) {
    const [rows] = await connection.execute<RegistryDbRow[]>(
      `SELECT source_type, compliance_class, allowed_use_flags_json,
              prohibited_use_flags_json, source_policy_json, notes
         FROM vendor_source_registry WHERE source_type = ? FOR SHARE`,
      [sourceType],
    );
    return rows[0] ? mapRegistryRow(rows[0]) : null;
  }
}
