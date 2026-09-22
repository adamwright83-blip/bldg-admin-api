import { eq } from "drizzle-orm";
import { missionExperienceInstances } from "../../drizzle/schema";
import type { MissionExperienceInstance } from "../../shared/missionExperience";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";
import type { MissionExperienceStore } from "./missionExperienceStore";

export async function createDrizzleMissionExperienceStore(): Promise<MissionExperienceStore | null> {
  const db = await getDb();
  if (!db) return null;
  return {
    async getById(id) {
      const [row] = await db
        .select()
        .from(missionExperienceInstances)
        .where(eq(missionExperienceInstances.id, id))
        .limit(1);
      return row ? fromRow(row) : null;
    },
    async insert(instance) {
      try {
        await db.insert(missionExperienceInstances).values(toRow(instance));
        return "inserted";
      } catch (error) {
        if (isMysqlDuplicateKeyError(error)) return "exists";
        throw error;
      }
    },
    async update(instance) {
      const { createdAt: _createdAt, ...row } = toRow(instance);
      await db
        .update(missionExperienceInstances)
        .set(row)
        .where(eq(missionExperienceInstances.id, instance.id));
    },
  };
}

function toRow(instance: MissionExperienceInstance) {
  return {
    id: instance.id,
    tenantId: instance.tenantId,
    operatorId: instance.operatorId,
    businessDate: instance.businessDate,
    authorityKey: instance.authorityRef.authorityKey,
    source: instance.source,
    title: instance.title,
    realObjective: instance.realObjective,
    status: instance.status,
    phase: instance.phase,
    playShape: instance.playShape,
    gameplayHost: instance.gameplayHost,
    visualPackageId: instance.visualPackageId,
    authorityRefJson: instance.authorityRef,
    gameplayJson: instance.gameplay,
    realGateJson: instance.realGate,
    consequenceJson: instance.consequence,
    replacementJson: instance.replacement,
    entrancesJson: instance.entrances,
    createdAt: new Date(instance.createdAt),
    updatedAt: new Date(instance.updatedAt),
  };
}

function fromRow(row: typeof missionExperienceInstances.$inferSelect): MissionExperienceInstance {
  return {
    id: row.id,
    tenantId: row.tenantId,
    operatorId: row.operatorId,
    businessDate: row.businessDate,
    authorityRef: row.authorityRefJson as MissionExperienceInstance["authorityRef"],
    source: row.source as MissionExperienceInstance["source"],
    title: row.title,
    realObjective: row.realObjective,
    status: row.status as MissionExperienceInstance["status"],
    phase: row.phase as MissionExperienceInstance["phase"],
    playShape: row.playShape as MissionExperienceInstance["playShape"],
    gameplayHost: row.gameplayHost,
    gameplay: row.gameplayJson as MissionExperienceInstance["gameplay"],
    realGate: row.realGateJson as MissionExperienceInstance["realGate"],
    consequence: row.consequenceJson as MissionExperienceInstance["consequence"],
    replacement: (row.replacementJson as MissionExperienceInstance["replacement"]) ?? null,
    visualPackageId: row.visualPackageId,
    entrances: (row.entrancesJson as MissionExperienceInstance["entrances"]) ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
