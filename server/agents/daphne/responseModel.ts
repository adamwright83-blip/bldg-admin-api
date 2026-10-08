import type { DaphneResponseSummary } from "./operatorCard";
import type { DaphneInterventionRecord } from "./interventionLedger";
import type { DaphneOutcomeRecord } from "./outcomeLedger";
import { recordDaphneEpistemicClaim } from "./epistemicStore";

export type DaphneResponseEstimate = DaphneResponseSummary & {
  n: number;
  successRate: number | null;
  meanBurden: number | null;
  sourceObservationIds: string[];
};

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value && typeof value === "object" && "value" in value) return numeric((value as {value:unknown}).value);
  return null;
}

export function buildDaphneResponseModel(input:{
  interventions:DaphneInterventionRecord[];
  outcomes:DaphneOutcomeRecord[];
  successMeasureKey:string;
  burdenMeasureKey?:string;
}):DaphneResponseEstimate[]{
  const outcomesByIntervention=new Map<string,DaphneOutcomeRecord[]>();
  for(const outcome of input.outcomes){
    if(!outcome.interventionId) continue;
    const arr=outcomesByIntervention.get(outcome.interventionId)??[]; arr.push(outcome); outcomesByIntervention.set(outcome.interventionId,arr);
  }
  const groups=new Map<string,{actionKey:string;contextKey:string;values:number[];burdens:number[];ids:string[]}>();
  for(const intervention of input.interventions){
    const key=`${intervention.chosenAction}\u0000${intervention.contextKey}`;
    const g=groups.get(key)??{actionKey:intervention.chosenAction,contextKey:intervention.contextKey,values:[],burdens:[],ids:[]};
    g.ids.push(...intervention.sourceObservationIds);
    for(const outcome of outcomesByIntervention.get(intervention.id)??[]){
      const v=numeric(outcome.value);
      if(v==null) continue;
      if(outcome.measureKey===input.successMeasureKey) g.values.push(v);
      if(input.burdenMeasureKey&&outcome.measureKey===input.burdenMeasureKey) g.burdens.push(v);
    }
    groups.set(key,g);
  }
  return Array.from(groups.values()).map(g=>({
    actionKey:g.actionKey,contextKey:g.contextKey,epistemicStatus:"association_only" as const,
    expectedProximalOutcome:g.values.length?Number((g.values.reduce((a,b)=>a+b,0)/g.values.length).toFixed(4)):null,
    burdenEstimate:g.burdens.length?Number((g.burdens.reduce((a,b)=>a+b,0)/g.burdens.length).toFixed(4)):null,
    sourceClaimIds:[],n:g.values.length,successRate:g.values.length?Number((g.values.filter(v=>v>0).length/g.values.length).toFixed(4)):null,
    meanBurden:g.burdens.length?Number((g.burdens.reduce((a,b)=>a+b,0)/g.burdens.length).toFixed(4)):null,
    sourceObservationIds:Array.from(new Set(g.ids)),
  }));
}

export async function persistDaphneResponseEstimate(input:{tenantId:string;canonicalOperatorId:string;estimate:DaphneResponseEstimate;modelVersion:string}):Promise<void>{
  if(!input.estimate.sourceObservationIds.length) return;
  await recordDaphneEpistemicClaim({
    tenantId:input.tenantId,canonicalOperatorId:input.canonicalOperatorId,claimType:"association_estimate",
    claimKey:`response:${input.estimate.actionKey}:${input.estimate.contextKey}`,claim:input.estimate,
    sourceObservationIds:input.estimate.sourceObservationIds,contextApplicability:{contextKeys:[input.estimate.contextKey],distinctContextCount:1},
    uncertainty:{epistemic:input.estimate.n?Number((1/Math.sqrt(input.estimate.n)).toFixed(4)):1},
    epistemicStatus:"association_only",causalEvidenceStatus:"observational",modelVersion:input.modelVersion,
    idempotencyKey:`response:${input.estimate.actionKey}:${input.estimate.contextKey}:${input.estimate.n}`
  });
}
