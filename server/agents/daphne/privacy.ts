import { and, eq } from "drizzle-orm";
import {
  daphneEpistemicClaims,
  daphneGoals,
  daphneInterventions,
  daphneMetaPreferences,
  daphneMetricEvents,
  daphneObservations,
  daphneOutcomes,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import { loadDaphneEvidenceBundle } from "./engine";
import { listActiveDaphneGoals, loadDaphneMetaPreferences } from "./goalsPreferences";
import { recordDaphneMetricEvent } from "./metrics";

export async function exportDaphneV2UserData(input:{tenantId:string;canonicalOperatorId:string}){
 const db=await getDb(); if(!db) throw new Error("Database unavailable");
 // The bounded read model below is convenient for clients; it is not a full
 // privacy export. Preserve all canonical history in one database snapshot.
 const canonicalHistory=await db.transaction(async tx=>{
  const where=(table:{tenantId:any;canonicalOperatorId:any})=>and(
   eq(table.tenantId,input.tenantId),eq(table.canonicalOperatorId,input.canonicalOperatorId)
  );
  return {
   observations:await tx.select().from(daphneObservations).where(where(daphneObservations)),
   epistemicClaims:await tx.select().from(daphneEpistemicClaims).where(where(daphneEpistemicClaims)),
   goals:await tx.select().from(daphneGoals).where(where(daphneGoals)),
   metaPreferences:await tx.select().from(daphneMetaPreferences).where(where(daphneMetaPreferences)),
   interventions:await tx.select().from(daphneInterventions).where(where(daphneInterventions)),
   outcomes:await tx.select().from(daphneOutcomes).where(where(daphneOutcomes)),
   metricEvents:await tx.select().from(daphneMetricEvents).where(where(daphneMetricEvents)),
  };
 });
 const [evidence,goals,metaPreferences]=await Promise.all([
  loadDaphneEvidenceBundle({...input,limit:500}),
  listActiveDaphneGoals(input),
  loadDaphneMetaPreferences(input),
 ]);
 const exportedAt=new Date().toISOString();
 await recordDaphneMetricEvent({
  tenantId:input.tenantId,canonicalOperatorId:input.canonicalOperatorId,eventName:"privacy_export",
  properties:{format:"daphne-v2-user-export"},sourceReference:"user_export",
  idempotencyKey:`privacy-export:${exportedAt}`
 }).catch(()=>undefined);
 return {
  format:"daphne-v2-user-export",exportedAt,
  tenantId:input.tenantId,canonicalOperatorId:input.canonicalOperatorId,
  observations:evidence.observations,epistemicClaims:evidence.claims,interventions:evidence.interventions,outcomes:evidence.outcomes,
  goals,metaPreferences,
  canonicalHistory,
  readModelLimits:{evidenceLimit:500,goals:"active_only",metaPreferences:"latest_only"},
 };
}

/**
 * Privacy erasure is the explicit exception to append-only history. It deletes
 * only Daphne-owned representation/learning rows. It never deletes business,
 * payment, order, or Narrator authority records owned by other domains.
 */
export async function deleteDaphneV2UserData(input:{tenantId:string;canonicalOperatorId:string}):Promise<{deleted:true;scope:"daphne_owned_only"}>{
 const db=await getDb(); if(!db) throw new Error("Database unavailable");
 const where=(table:{tenantId:any;canonicalOperatorId:any})=>and(
  eq(table.tenantId,input.tenantId),eq(table.canonicalOperatorId,input.canonicalOperatorId)
 );
 await db.transaction(async tx=>{
 await tx.delete(daphneOutcomes).where(where(daphneOutcomes));
 await tx.delete(daphneInterventions).where(where(daphneInterventions));
 await tx.delete(daphneMetaPreferences).where(where(daphneMetaPreferences));
 await tx.delete(daphneGoals).where(where(daphneGoals));
 await tx.delete(daphneEpistemicClaims).where(where(daphneEpistemicClaims));
 await tx.delete(daphneObservations).where(where(daphneObservations));
 await tx.delete(daphneMetricEvents).where(and(
  eq(daphneMetricEvents.tenantId,input.tenantId),
  eq(daphneMetricEvents.canonicalOperatorId,input.canonicalOperatorId)
 ));
 });
 const erasedAt=new Date();
 await recordDaphneMetricEvent({
   tenantId:input.tenantId,canonicalOperatorId:null,eventName:"privacy_erasure",
   properties:{scope:"daphne_owned_only"},sourceReference:null,occurredAt:erasedAt,
   idempotencyKey:`privacy-erasure:${erasedAt.toISOString()}`
 }).catch(()=>undefined);
 return {deleted:true,scope:"daphne_owned_only"};
}

export function assertDaphneAgentScope(input:{requestedAgentId:string;relationshipAgentId:string|null;crossAgentSharingEnabled:boolean}):void{
 if(input.relationshipAgentId&&input.requestedAgentId!==input.relationshipAgentId&&!input.crossAgentSharingEnabled){
  throw new Error("Daphne cross-agent relationship access denied");
 }
}
