import { and, eq } from "drizzle-orm";
import {
  daphneEpistemicClaims,
  daphneGoals,
  daphneInterventions,
  daphneMetaPreferences,
  daphneMetricEvents,
  daphneObservations,
  daphneOutcomes,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { loadDaphneEvidenceBundle } from "./engine";
import { listActiveDaphneGoals, loadDaphneMetaPreferences } from "./goalsPreferences";

export async function exportDaphneV2UserData(input:{tenantId:string;canonicalOperatorId:string}){
 const [evidence,goals,metaPreferences]=await Promise.all([
  loadDaphneEvidenceBundle({...input,limit:500}),
  listActiveDaphneGoals(input),
  loadDaphneMetaPreferences(input),
 ]);
 return {
  format:"daphne-v2-user-export",exportedAt:new Date().toISOString(),
  tenantId:input.tenantId,canonicalOperatorId:input.canonicalOperatorId,
  observations:evidence.observations,epistemicClaims:evidence.claims,interventions:evidence.interventions,outcomes:evidence.outcomes,
  goals,metaPreferences,
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
 await db.delete(daphneOutcomes).where(where(daphneOutcomes));
 await db.delete(daphneInterventions).where(where(daphneInterventions));
 await db.delete(daphneMetaPreferences).where(where(daphneMetaPreferences));
 await db.delete(daphneGoals).where(where(daphneGoals));
 await db.delete(daphneEpistemicClaims).where(where(daphneEpistemicClaims));
 await db.delete(daphneObservations).where(where(daphneObservations));
 await db.delete(daphneMetricEvents).where(and(
  eq(daphneMetricEvents.tenantId,input.tenantId),
  eq(daphneMetricEvents.canonicalOperatorId,input.canonicalOperatorId)
 ));
 return {deleted:true,scope:"daphne_owned_only"};
}

export function assertDaphneAgentScope(input:{requestedAgentId:string;relationshipAgentId:string|null;crossAgentSharingEnabled:boolean}):void{
 if(input.relationshipAgentId&&input.requestedAgentId!==input.relationshipAgentId&&!input.crossAgentSharingEnabled){
  throw new Error("Daphne cross-agent relationship access denied");
 }
}
