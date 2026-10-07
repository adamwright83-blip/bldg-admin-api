import { recordDaphneEpistemicClaim } from "./epistemicStore";

export type DaphneCausalSample = {
  observationId: string;
  action: string;
  outcome: number;
  propensity: number;
  selectionMode: "randomized" | "propensity";
};

export type DaphneTreatmentEffectEstimate = {
  treatmentAction: string;
  controlAction: string;
  treatmentMean: number;
  controlMean: number;
  effect: number;
  approximateStandardError: number | null;
  treatmentN: number;
  controlN: number;
  effectiveSampleSize: number;
  positivityOk: boolean;
  causalEvidenceStatus: "randomized" | "propensity_supported";
  epistemicStatus: "experimentally_supported" | "suggestive";
  sourceObservationIds: string[];
  assumptions: string[];
};

function finite(value:number,label:string):number{
  if(!Number.isFinite(value)) throw new Error(`Daphne causal estimator requires finite ${label}`); return value;
}
function weightedStats(items:Array<{y:number;w:number}>){
  const sw=items.reduce((s,x)=>s+x.w,0);
  const sw2=items.reduce((s,x)=>s+x.w*x.w,0);
  if(!sw) return {mean:NaN,variance:NaN,ess:0};
  const mean=items.reduce((s,x)=>s+x.y*x.w,0)/sw;
  const variance=items.reduce((s,x)=>s+x.w*(x.y-mean)**2,0)/sw;
  return {mean,variance,ess:sw2?sw*sw/sw2:0};
}

/**
 * Logged-policy inverse-probability weighting. This is only valid when the
 * logged propensity is the probability of the action actually selected.
 * The estimator refuses extreme propensities and requires both arms.
 */
export function estimateDaphneBinaryTreatmentEffect(input:{
  samples:DaphneCausalSample[];
  treatmentAction:string;
  controlAction:string;
  minPerArm?:number;
  positivityFloor?:number;
}):DaphneTreatmentEffectEstimate{
  const treatment=input.treatmentAction.trim(), control=input.controlAction.trim();
  if(!treatment||!control||treatment===control) throw new Error("Daphne causal estimator requires distinct treatment/control actions");
  const min=Math.max(2,input.minPerArm??3);
  const floor=Math.max(0.001,Math.min(input.positivityFloor??0.05,0.49));
  const relevant=input.samples.filter(s=>s.action===treatment||s.action===control);
  const tx=relevant.filter(s=>s.action===treatment), cx=relevant.filter(s=>s.action===control);
  if(tx.length<min||cx.length<min) throw new Error(`Daphne causal estimator requires at least ${min} samples per arm`);
  for(const sample of relevant){
    finite(sample.outcome,"outcome");
    if(!Number.isFinite(sample.propensity)||sample.propensity<floor||sample.propensity>1-floor){
      throw new Error("Daphne causal estimator positivity check failed");
    }
  }
  const txStats=weightedStats(tx.map(s=>({y:s.outcome,w:1/s.propensity})));
  const cxStats=weightedStats(cx.map(s=>({y:s.outcome,w:1/s.propensity})));
  const ess=txStats.ess+cxStats.ess;
  const se=Math.sqrt((txStats.variance/Math.max(txStats.ess,1))+(cxStats.variance/Math.max(cxStats.ess,1)));
  const randomized=relevant.every(s=>s.selectionMode==="randomized");
  return {
    treatmentAction:treatment,controlAction:control,
    treatmentMean:Number(txStats.mean.toFixed(6)),controlMean:Number(cxStats.mean.toFixed(6)),
    effect:Number((txStats.mean-cxStats.mean).toFixed(6)),
    approximateStandardError:Number.isFinite(se)?Number(se.toFixed(6)):null,
    treatmentN:tx.length,controlN:cx.length,effectiveSampleSize:Number(ess.toFixed(4)),
    positivityOk:true,
    causalEvidenceStatus:randomized?"randomized":"propensity_supported",
    epistemicStatus:ess>=Math.max(10,min*2)?"experimentally_supported":"suggestive",
    sourceObservationIds:Array.from(new Set(relevant.map(s=>s.observationId))),
    assumptions:[
      "logged propensity is the probability of the action actually selected",
      "no unmeasured confounding beyond the logged policy for propensity-supported assignments",
      "outcome definition and window were fixed before outcome observation",
      "consistency/SUTVA is approximately satisfied for this bounded intervention",
    ],
  };
}

export async function persistDaphneTreatmentEffect(input:{
 tenantId:string;canonicalOperatorId:string;contextKey:string;measureKey:string;
 estimate:DaphneTreatmentEffectEstimate;modelVersion:string;
}):Promise<void>{
 await recordDaphneEpistemicClaim({
  tenantId:input.tenantId,canonicalOperatorId:input.canonicalOperatorId,
  claimType:"treatment_effect_estimate",
  claimKey:`effect:${input.estimate.treatmentAction}:vs:${input.estimate.controlAction}:${input.measureKey}:${input.contextKey}`,
  claim:input.estimate,sourceObservationIds:input.estimate.sourceObservationIds,
  contextApplicability:{contextKeys:[input.contextKey],distinctContextCount:1},
  uncertainty:{epistemic:input.estimate.approximateStandardError,decisionCost:"high"},
  epistemicStatus:input.estimate.epistemicStatus,
  causalEvidenceStatus:input.estimate.causalEvidenceStatus,
  modelVersion:input.modelVersion,
  idempotencyKey:`effect:${input.contextKey}:${input.measureKey}:${input.estimate.sourceObservationIds.join(",")}`
 });
}
