import { and, desc, eq } from "drizzle-orm";
import { missionSalesBriefs } from "../../drizzle/schema";
import type { MissionSalesBrief } from "../../shared/missionSalesBrief";
import { getDb } from "../db";

/**
 * Narrow persistence seam, same pattern as Claire's character/store.ts:
 * production uses Drizzle/MySQL, tests inject a deterministic in-memory
 * implementation (testSupport/inMemoryMissionSalesBriefStore.ts) so the
 * full "assemble -> compile -> persist -> version -> retrieve" loop can be
 * proven end to end without a live database.
 */
export type MissionSalesBriefStore = {
  getLatest(input: {
    tenantId: string;
    missionId: number;
  }): Promise<MissionSalesBrief | null>;
  insertVersion(
    brief: Omit<MissionSalesBrief, "id">
  ): Promise<MissionSalesBrief>;
  listVersions(input: {
    tenantId: string;
    missionId: number;
  }): Promise<MissionSalesBrief[]>;
};

function toRecord(row: typeof missionSalesBriefs.$inferSelect): MissionSalesBrief {
  return { id: row.id, ...(row.briefJson as Omit<MissionSalesBrief, "id">) };
}

export function createDrizzleMissionSalesBriefStore(): MissionSalesBriefStore {
  return {
    async getLatest(input) {
      const db = await getDb();
      if (!db) return null;
      const [row] = await db
        .select()
        .from(missionSalesBriefs)
        .where(
          and(
            eq(missionSalesBriefs.tenantId, input.tenantId),
            eq(missionSalesBriefs.missionId, input.missionId)
          )
        )
        .orderBy(desc(missionSalesBriefs.version))
        .limit(1);
      return row ? toRecord(row) : null;
    },

    async insertVersion(brief) {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [result] = await db.insert(missionSalesBriefs).values({
        tenantId: brief.tenantId,
        missionId: brief.missionId,
        accountId: brief.accountId,
        version: brief.version,
        briefJson: brief,
        source: brief.source,
        compilerVersion: brief.compilerVersion,
        frameworkId: brief.salesIntel.frameworkId,
        confidence: Math.round(brief.confidence * 100),
        generatedFromEvidenceThrough: new Date(brief.generatedFromEvidenceThrough),
      });
      const insertedId = (result as { insertId?: number }).insertId;
      if (!insertedId) throw new Error("MissionSalesBrief was not persisted");
      return { id: insertedId, ...brief };
    },

    async listVersions(input) {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(missionSalesBriefs)
        .where(
          and(
            eq(missionSalesBriefs.tenantId, input.tenantId),
            eq(missionSalesBriefs.missionId, input.missionId)
          )
        )
        .orderBy(desc(missionSalesBriefs.version));
      return rows.map(toRecord);
    },
  };
}

let sharedStore: MissionSalesBriefStore | null = null;

export function getMissionSalesBriefStore(): MissionSalesBriefStore {
  if (!sharedStore) sharedStore = createDrizzleMissionSalesBriefStore();
  return sharedStore;
}

/** Test-only seam: swap the shared store (e.g. for an in-memory fake). */
export function setMissionSalesBriefStoreForTesting(
  store: MissionSalesBriefStore | null
): void {
  sharedStore = store;
}
