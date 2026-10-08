import type { DaphneMetaPreferenceKey, DaphneMetaPreferenceRecord } from "./goalsPreferences";
import { chooseDaphneActiveLearningAction, type DaphneExperimentAction } from "./activeLearning";

export const DAPHNE_CAUSAL_CANARY_ACTIONS = [
 "brief_response",
 "ask_clarifying_question",
 "offer_next_step",
 "no_intervention",
] as const;

function enabled(tenantId:string,env:NodeJS.ProcessEnv):boolean{
 const global=["1","true"].includes((env.DAPHNE_V2_CAUSAL_CANARY_ENABLED??"").trim().toLowerCase());
 const tenants=(env.DAPHNE_V2_CAUSAL_CANARY_TENANTS??"").split(",").map(x=>x.trim()).filter(Boolean);
 return global||tenants.includes(tenantId);
}
function pref(prefs:Partial<Record<DaphneMetaPreferenceKey,DaphneMetaPreferenceRecord>>,key:DaphneMetaPreferenceKey):unknown{
 const p=prefs[key]; return p?.status==="active"?p.value:undefined;
}
export function planDaphneProductionCanary(input:{
 tenantId:string;
 preferences:Partial<Record<DaphneMetaPreferenceKey,DaphneMetaPreferenceRecord>>;
 actions:DaphneExperimentAction[];
 draw?:number;
 env?:NodeJS.ProcessEnv;
}){
 const env=input.env??process.env;
 if(!enabled(input.tenantId,env)) return {status:"disabled" as const,reason:"tenant_canary_off"};
 if(pref(input.preferences,"safe_experimentation")!==true) return {status:"disabled" as const,reason:"user_experimentation_not_enabled"};
 const allowed=new Set<string>(DAPHNE_CAUSAL_CANARY_ACTIONS);
 const actions=input.actions.filter(a=>allowed.has(a.key)).map(a=>({...a,risk:"low" as const,irreversible:false,touchesBusinessTruth:false,touchesNarrativeDisclosure:false}));
 if(!actions.some(a=>a.key==="no_intervention")){
  actions.push({key:"no_intervention",risk:"low",estimatedUtility:0,uncertainty:.5,burden:0,irreversible:false,touchesBusinessTruth:false,touchesNarrativeDisclosure:false});
 }
 const decision=chooseDaphneActiveLearningAction({
  actions,experimentationEnabled:true,maxRisk:"low",maxBurden:.35,explorationRate:.15,draw:input.draw
 });
 return {status:"planned" as const,decision,requiresInterventionLedgerWrite:true,requiresOutcomeWindow:true};
}
