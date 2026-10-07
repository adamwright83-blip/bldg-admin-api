import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { daphneMetricEvents } from "../../drizzle/schema";
import { getDb } from "../db";

export const DAPHNE_METRIC_EVENTS = [
  "observation_ingested",
  "claim_created",
  "card_compiled",
  "intervention_selected",
  "outcome_linked",
  "causal_estimate_created",
  "control_changed",
  "claim_corrected",
  "claim_rejected",
  "rupture_detected",
  "repair_recorded",
  "experiment_assignment",
  "privacy_export",
  "privacy_erasure",
] as const;
export type DaphneMetricEventName=(typeof DAPHNE_METRIC_EVENTS)[number];

function req(v:string,label:string,max=191){const x=v.trim();if(!x)throw new Error(`Daphne metric requires ${label}`);if(x.length>max)throw new Error(`${label} exceeds ${max} characters`);return x;}
function metricId(tenantId:string,key:string){return `dmetric_${createHash("sha256").update([tenantId,key].join("\u0000")).digest("hex").slice(0,44)}`;}

export async function recordDaphneMetricEvent(input:{
 tenantId:string;canonicalOperatorId?:string|null;agentId?:string|null;eventName:DaphneMetricEventName;
 properties?:Record<string,unknown>|null;sourceReference?:string|null;occurredAt?:Date;idempotencyKey:string;
}):Promise<void>{
 const db=await getDb(); if(!db) throw new Error("Database unavailable");
 const tenantId=req(input.tenantId,"tenantId",64),key=req(input.idempotencyKey,"idempotencyKey",191);
 const id=metricId(tenantId,key);
 await db.insert(daphneMetricEvents).values({
  id,tenantId,canonicalOperatorId:input.canonicalOperatorId?.trim()||null,agentId:input.agentId?.trim()||null,
  eventName:input.eventName,propertiesJson:input.properties??null,sourceReference:input.sourceReference?.trim()||null,
  occurredAt:input.occurredAt??new Date(),idempotencyKey:key
 }).onDuplicateKeyUpdate({set:{id}});
}

export async function listDaphneMetricEvents(input:{tenantId:string;canonicalOperatorId?:string;limit?:number}){
 const db=await getDb(); if(!db) throw new Error("Database unavailable");
 const predicates=[eq(daphneMetricEvents.tenantId,req(input.tenantId,"tenantId",64))];
 if(input.canonicalOperatorId) predicates.push(eq(daphneMetricEvents.canonicalOperatorId,input.canonicalOperatorId));
 return db.select().from(daphneMetricEvents).where(and(...predicates)).orderBy(desc(daphneMetricEvents.occurredAt)).limit(Math.max(1,Math.min(input.limit??500,2000)));
}

export function summarizeDaphneMoatMetrics(events:Array<{eventName:string;canonicalOperatorId:string|null;occurredAt:Date}>){
 const counts:Record<string,number>={};
 for(const e of events) counts[e.eventName]=(counts[e.eventName]??0)+1;
 const users=new Set(events.map(e=>e.canonicalOperatorId).filter(Boolean));
 const corrections=(counts.claim_corrected??0)+(counts.claim_rejected??0);
 const learned=counts.causal_estimate_created??0;
 const interventions=counts.intervention_selected??0;
 return {
  representedUsers:users.size,
  eventCounts:counts,
  correctionFeedbackRate:interventions?Number((corrections/interventions).toFixed(4)):null,
  causalLearningYield:interventions?Number((learned/interventions).toFixed(4)):null,
  evidenceFlywheel:{
   observations:counts.observation_ingested??0,
   claims:counts.claim_created??0,
   interventions,
   outcomes:counts.outcome_linked??0,
   causalEstimates:learned,
  }
 };
}
