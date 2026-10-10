import type { DaphneObservationRecord } from "./observationStore";
import type { DaphneEpistemicClaimRecord } from "./epistemicStore";

/** Resolve append-only user dispositions without rewriting historical claims. */
export function resolveDaphneCurrentClaims(input: {
 claims: DaphneEpistemicClaimRecord[];
 tenantId: string; canonicalOperatorId: string; agentId: string; asOf: Date;
}): DaphneEpistemicClaimRecord[] {
 const eligible = input.claims.filter(c =>
  c.tenantId === input.tenantId && c.canonicalOperatorId === input.canonicalOperatorId &&
  (c.agentId === null || c.agentId === input.agentId) &&
  Date.parse(c.createdAt) <= input.asOf.getTime() &&
  (!c.validFrom || Date.parse(c.validFrom) <= input.asOf.getTime())
 );
 // An expired replacement must not resurrect what the operator rejected.
 const superseded = new Set(eligible.filter(c => c.claimType === "supersession" &&
  !["rejected", "superseded"].includes(c.epistemicStatus)).map(c => c.supersedesClaimId));
 const byId = new Map(eligible.map(c => [c.id, c]));
 return eligible.filter(c => !superseded.has(c.id) &&
  !["rejected", "superseded", "contradicted"].includes(c.epistemicStatus) &&
  (!c.validUntil || Date.parse(c.validUntil) > input.asOf.getTime())
 ).flatMap(c => {
  if (c.claimType !== "supersession") return [c];
  if (c.claim.userDisposition !== "corrected" || !c.supersedesClaimId) return [];
  const original = byId.get(c.supersedesClaimId);
  const value = c.claim.value;
  if (!original || !value || typeof value !== "object" || Array.isArray(value)) return [];
  // A correction is an explicit statement, never a newly certified inference.
  return [{...c, claimType: "direct_fact" as const, claim: value as Record<string, unknown>,
    counterEvidence: c.counterEvidence.filter(e => e.supersededClaimId !== c.supersedesClaimId)}];
 });
}

export type DaphneConsolidationPlan = {
 generatedAt:string;
 retainedObservationIds:string[];
 staleClaimIds:string[];
 contradictionClaimIds:string[];
 supersessionCandidates:Array<{olderClaimId:string;newerClaimId:string;claimKey:string}>;
 noDeletion:true;
};

export function planDaphneConsolidation(input:{
 observations:DaphneObservationRecord[];claims:DaphneEpistemicClaimRecord[];asOf:Date;staleAfterDays?:number;
}):DaphneConsolidationPlan{
 const staleMs=Math.max(1,input.staleAfterDays??90)*86400000;
 const staleClaimIds=input.claims.filter(c=>{
  if(c.humanPinned) return false;
  const reinforced=Date.parse(c.lastReinforcedAt??c.createdAt);
  return Number.isFinite(reinforced)&&input.asOf.getTime()-reinforced>staleMs;
 }).map(c=>c.id);
 const contradictionClaimIds=input.claims.filter(c=>c.claimType==="contradiction"||c.epistemicStatus==="contradicted").map(c=>c.id);
 const byKey=new Map<string,DaphneEpistemicClaimRecord[]>();
 for(const c of input.claims){const arr=byKey.get(c.claimKey)??[];arr.push(c);byKey.set(c.claimKey,arr);}
 const supersessionCandidates:Array<{olderClaimId:string;newerClaimId:string;claimKey:string}>=[];
 for(const [key,claims] of byKey){
  const active=claims.filter(c=>!["rejected","superseded"].includes(c.epistemicStatus)).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt));
  if(active.length>1){
   const newer=active[active.length-1];
   for(const older of active.slice(0,-1)){
    if(older.claimType===newer.claimType&&JSON.stringify(older.claim)!==JSON.stringify(newer.claim)) supersessionCandidates.push({olderClaimId:older.id,newerClaimId:newer.id,claimKey:key});
   }
  }
 }
 return {generatedAt:input.asOf.toISOString(),retainedObservationIds:input.observations.map(o=>o.id),staleClaimIds,contradictionClaimIds,supersessionCandidates,noDeletion:true};
}
