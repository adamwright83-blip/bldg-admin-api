import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  commercialAccounts,
  commercialMissions,
  commercialPipelineRecords,
  driverGameWorldNodes,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  readCommercialWorldFactsForActor,
  readCommercialProgressionFactsForActor,
} from "./commercialWorldReadService";
import { listDriverGameWorld } from "../experience/goldline/driver/driverGameWorldService";
const prefix = `b3-${randomUUID().slice(0, 8)}`;
const tenants = [`${prefix}-a`, `${prefix}-b`];
afterAll(async () => {
  const db = (await getDb())!;
  for (const table of [
    driverGameWorldNodes,
    commercialPipelineRecords,
    commercialMissions,
    commercialAccounts,
  ]) {
    await db.delete(table).where(inArray(table.tenantId, tenants));
  }
});
async function seed(
  tenantId: string,
  actorId: string,
  status: "follow_up" | "won"
) {
  const db = (await getDb())!;
  const [{ id: accountId }] = await db
    .insert(commercialAccounts)
    .values({
      tenantId,
      name: `Business ${actorId}`,
      accountType: "residential_property",
    })
    .$returningId();
  const [{ id: missionId }] = await db
    .insert(commercialMissions)
    .values({
      tenantId,
      assignedTo: actorId,
      code: `b3-${accountId}`,
      status,
      createdBy: actorId,
      accountSnapshotJson: {},
      opportunitySnapshotJson: {},
      missionBriefJson: {},
    })
    .$returningId();
  await db
    .insert(commercialPipelineRecords)
    .values({
      tenantId,
      accountId,
      opportunityId: accountId,
      missionId,
      stage: status,
    });
  return missionId;
}
describe("Commercial facts → game projection on real MySQL", () => {
  it("isolates tenant/actor facts and refuses a saved game capture over a real follow-up", async () => {
    const missionId = await seed(tenants[0], "field-a", "follow_up");
    await seed(tenants[0], "field-b", "won");
    await seed(tenants[1], "field-a", "won");
    const db = (await getDb())!;
    await db
      .insert(driverGameWorldNodes)
      .values({
        id: randomUUID(),
        tenantId: tenants[0],
        actorId: "field-a",
        missionId,
        entityId: String(missionId),
        visualState: "captured",
      });
    const scope = { tenantId: tenants[0], actorId: "field-a" };
    const facts = await readCommercialWorldFactsForActor(scope);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      missionId,
      missionStatus: "follow_up",
      pipelineStage: "follow_up",
    });
    expect(facts[0]).not.toHaveProperty("savedVisualState");
    const evidence = await readCommercialProgressionFactsForActor(scope);
    expect(evidence.missionRows.map(row => row.mission.id)).toEqual([
      missionId,
    ]);
    for (let replay = 0; replay < 2; replay++) {
      const world = await listDriverGameWorld(scope);
      expect(world).toHaveLength(1);
      expect(world[0]).toMatchObject({
        missionId,
        missionStatus: "follow_up",
        visualState: "contested",
        verifiedAnnualValueCents: null,
        realizedRevenueCents: 0,
      });
    }
  });
});
