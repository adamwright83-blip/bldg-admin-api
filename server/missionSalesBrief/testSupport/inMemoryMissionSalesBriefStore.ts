import type { MissionSalesBriefStore } from "../store";
import type { MissionSalesBrief } from "../../../shared/missionSalesBrief";

/** Deterministic in-memory fake for MissionSalesBriefStore — no live MySQL is available in this environment. */
export function createInMemoryMissionSalesBriefStore(): MissionSalesBriefStore {
  const rows: MissionSalesBrief[] = [];
  let nextId = 1;

  return {
    async getLatest(input) {
      const matches = rows
        .filter(row => row.tenantId === input.tenantId && row.missionId === input.missionId)
        .sort((a, b) => b.version - a.version);
      return matches[0] ?? null;
    },

    async insertVersion(brief) {
      const record: MissionSalesBrief = { id: nextId++, ...brief };
      rows.push(record);
      return record;
    },

    async listVersions(input) {
      return rows
        .filter(row => row.tenantId === input.tenantId && row.missionId === input.missionId)
        .sort((a, b) => b.version - a.version);
    },
  };
}
