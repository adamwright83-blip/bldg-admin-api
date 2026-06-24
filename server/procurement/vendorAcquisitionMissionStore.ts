import type { Pool, RowDataPacket } from "mysql2/promise";
import {
  canActivateMission,
  canCancelMission,
  canCompleteMission,
  canCreateMission,
  type MissionQualityGates,
  type VendorAcquisitionMissionDefinition,
} from "./vendorAcquisitionMissionPolicy";

export type VendorAcquisitionMission = {
  id: string;
  tenantId: string;
  category: string;
  geographyLabel: string;
  targetQuantity: number;
  qualityGates: MissionQualityGates;
  outreachMode: string;
  status: string;
  deadlineAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

type MissionDbRow = RowDataPacket & {
  id: string;
  tenant_id: string;
  category: string;
  geography_label: string;
  target_quantity: number;
  quality_gates_json: string | Record<string, unknown>;
  outreach_mode: string;
  status: string;
  deadline_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
};

export type CreateVendorAcquisitionMissionInput = VendorAcquisitionMissionDefinition & {
  id: string;
  tenantId: string;
  createdBy: string;
};

function parseGates(value: string | Record<string, unknown>): MissionQualityGates {
  return (typeof value === "string" ? JSON.parse(value) : value) as MissionQualityGates;
}

function mapRow(row: MissionDbRow): VendorAcquisitionMission {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    category: row.category,
    geographyLabel: row.geography_label,
    targetQuantity: row.target_quantity,
    qualityGates: parseGates(row.quality_gates_json),
    outreachMode: row.outreach_mode,
    status: row.status,
    deadlineAt: row.deadline_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `id, tenant_id, category, geography_label, target_quantity, quality_gates_json,
              outreach_mode, status, deadline_at, created_by, created_at, updated_at`;

export class VendorAcquisitionMissionStore {
  constructor(private readonly pool: Pool) {}

  async createMission(input: CreateVendorAcquisitionMissionInput): Promise<string> {
    const decision = canCreateMission(input);
    if (!decision.allowed) {
      throw new Error(`Vendor acquisition mission denied: ${decision.reasons.join(",")}`);
    }
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO vendor_acquisition_missions
          (id, tenant_id, category, geography_label, target_quantity, quality_gates_json,
           outreach_mode, status, deadline_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
        [
          input.id,
          input.tenantId,
          input.category.trim(),
          input.geographyLabel.trim(),
          input.targetQuantity,
          JSON.stringify(input.qualityGates),
          input.outreachMode,
          input.deadlineAt ?? null,
          input.createdBy,
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

  async getMission(tenantId: string, id: string): Promise<VendorAcquisitionMission | null> {
    const [rows] = await this.pool.execute<MissionDbRow[]>(
      `SELECT ${SELECT_COLUMNS}
         FROM vendor_acquisition_missions WHERE tenant_id = ? AND id = ?`,
      [tenantId, id],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async listMissions(input: { tenantId: string; status?: string; limit?: number }) {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 250);
    const params: unknown[] = [input.tenantId];
    let statusClause = "";
    if (input.status) {
      statusClause = " AND status = ?";
      params.push(input.status);
    }
    params.push(limit);
    const [rows] = await this.pool.execute<MissionDbRow[]>(
      `SELECT ${SELECT_COLUMNS}
         FROM vendor_acquisition_missions
        WHERE tenant_id = ?${statusClause}
        ORDER BY created_at DESC LIMIT ?`,
      params,
    );
    return rows.map(mapRow);
  }

  async activateMission(tenantId: string, id: string): Promise<void> {
    await this.transitionStatus(tenantId, id, "active", canActivateMission);
  }

  async completeMission(tenantId: string, id: string): Promise<void> {
    await this.transitionStatus(tenantId, id, "completed", canCompleteMission);
  }

  async cancelMission(tenantId: string, id: string): Promise<void> {
    await this.transitionStatus(tenantId, id, "cancelled", canCancelMission);
  }

  private async transitionStatus(
    tenantId: string,
    id: string,
    nextStatus: string,
    decide: (currentStatus: string) => { allowed: boolean; reasons: string[] },
  ): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<MissionDbRow[]>(
        `SELECT ${SELECT_COLUMNS}
           FROM vendor_acquisition_missions WHERE tenant_id = ? AND id = ? FOR UPDATE`,
        [tenantId, id],
      );
      const current = rows[0];
      if (!current) throw new Error("Vendor acquisition mission not found");
      const decision = decide(current.status);
      if (!decision.allowed) {
        throw new Error(`Vendor acquisition mission transition denied: ${decision.reasons.join(",")}`);
      }
      await connection.execute(
        `UPDATE vendor_acquisition_missions SET status = ? WHERE tenant_id = ? AND id = ?`,
        [nextStatus, tenantId, id],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
