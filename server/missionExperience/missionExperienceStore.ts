import { createHash } from "node:crypto";
import type { MissionExperienceInstance } from "../../shared/missionExperience";

export function missionExperienceInstanceId(input: {
  tenantId: string;
  operatorId: string;
  businessDate: string;
  authorityKey: string;
}): string {
  return createHash("sha256")
    .update(`${input.tenantId}\0${input.operatorId}\0${input.businessDate}\0${input.authorityKey}`)
    .digest("hex")
    .slice(0, 32);
}

export type MissionExperienceStore = {
  getById(id: string): Promise<MissionExperienceInstance | null>;
  insert(instance: MissionExperienceInstance): Promise<"inserted" | "exists">;
  update(instance: MissionExperienceInstance): Promise<void>;
};

export function createMemoryMissionExperienceStore(): MissionExperienceStore {
  const rows = new Map<string, MissionExperienceInstance>();
  return {
    async getById(id) {
      const row = rows.get(id);
      return row ? structuredClone(row) : null;
    },
    async insert(instance) {
      if (rows.has(instance.id)) return "exists";
      for (const existing of rows.values()) {
        if (
          existing.tenantId === instance.tenantId &&
          existing.operatorId === instance.operatorId &&
          existing.businessDate === instance.businessDate &&
          existing.authorityRef.authorityKey === instance.authorityRef.authorityKey
        ) {
          return "exists";
        }
      }
      rows.set(instance.id, structuredClone(instance));
      return "inserted";
    },
    async update(instance) {
      rows.set(instance.id, structuredClone(instance));
    },
  };
}
