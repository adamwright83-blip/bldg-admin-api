import type { DaphneObservationRecord } from "./observationStore";
import type { DaphneEpistemicClaimRecord } from "./epistemicStore";

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
