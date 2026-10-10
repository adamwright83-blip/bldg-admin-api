import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "../../db";
import { daphneObservations, daphneGoals } from "../../../drizzle/schema";
import { normalizeDaphneObservationInput as normalizeDaphneObservation } from "./observationStore";
import { createDaphneGoal, setDaphneMetaPreference } from "./goalsPreferences";
import { deleteDaphneV2UserData, exportDaphneV2UserData } from "./privacy";
import { eq } from "drizzle-orm";

const describeMysql=process.env.DATABASE_URL?describe:describe.skip;
describeMysql("Daphne complete privacy history",()=>{
 const tenantId=`daphne-privacy-${randomUUID().slice(0,12)}`;
 const scope={tenantId,canonicalOperatorId:"a"};
 afterAll(async()=>{
  await deleteDaphneV2UserData(scope);
  await deleteDaphneV2UserData({...scope,canonicalOperatorId:"b"});
 });
 it("exports more than 500 observations, superseded preferences and inactive goals without crossing operators",async()=>{
  const db=await getDb(); if(!db) throw new Error("No disposable test database");
  const rows=Array.from({length:505},(_,index)=>normalizeDaphneObservation({...scope,
   actorType:"user",observationKind:"user_statement",evidenceChannel:"stated",verificationStatus:"attested",
   sourceType:"privacy_certification",sourceReference:`session:${index}`,occurredAt:new Date(),
   payload:{index},idempotencyKey:`obs-${index}`}));
  await db.insert(daphneObservations).values(rows);
  await db.insert(daphneObservations).values(normalizeDaphneObservation({...scope,canonicalOperatorId:"b",
   actorType:"user",observationKind:"user_statement",evidenceChannel:"stated",sourceType:"privacy_certification",
   sourceReference:"private",occurredAt:new Date(),payload:{secret:"other-operator"},idempotencyKey:"foreign"}));
  await setDaphneMetaPreference({...scope,preferenceKey:"response_detail",value:0.2,sourceObservationId:rows[0].id});
  await setDaphneMetaPreference({...scope,preferenceKey:"response_detail",value:0.85,sourceObservationId:rows[1].id});
  const goal=await createDaphneGoal({...scope,goalKey:"ship",horizon:"near",statement:"Ship",
   sourceObservationId:rows[2].id});
  await db.update(daphneGoals).set({status:"completed"}).where(eq(daphneGoals.id,goal.id));
  const exported=await exportDaphneV2UserData(scope);
  expect(exported.observations).toHaveLength(500);
  expect(exported.canonicalHistory.observations).toHaveLength(505);
  expect(exported.canonicalHistory.metaPreferences.map(p=>p.valueJson)).toEqual(expect.arrayContaining([0.2,0.85]));
  expect(exported.canonicalHistory.goals).toMatchObject([{status:"completed"}]);
  expect(JSON.stringify(exported)).not.toContain("other-operator");
  await deleteDaphneV2UserData(scope);
  const erased=await exportDaphneV2UserData(scope);
  expect(erased.canonicalHistory.observations).toEqual([]);
  expect(erased.canonicalHistory.metaPreferences).toEqual([]);
  expect(erased.canonicalHistory.goals).toEqual([]);
  expect((await exportDaphneV2UserData({...scope,canonicalOperatorId:"b"})).canonicalHistory.observations).toHaveLength(1);
 });
});
