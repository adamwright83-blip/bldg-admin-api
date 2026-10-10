import { listDaphneObservations } from "./observationStore";
import { listDaphneEpistemicClaims, type DaphneEpistemicClaimRecord } from "./epistemicStore";
import { deriveDaphneFastState } from "./stateModel";
import { deriveDaphneContext } from "./contextModel";
import { deriveDaphneRelationship } from "./relationshipModel";
import { buildDaphneHypothesisSet } from "./hypothesisSet";
import { compileDaphneOperatorCard, type DaphneOperatorCard } from "./operatorCard";
import { listActiveDaphneGoals, loadDaphneMetaPreferences } from "./goalsPreferences";
import { listDaphneInterventions } from "./interventionLedger";
import { listDaphneOutcomes } from "./outcomeLedger";
import { buildDaphneResponseModel } from "./responseModel";
import type { DaphnePersonDistribution } from "./personModel";
import { recordDaphneMetricEvent } from "./metrics";
import { resolveDaphneCurrentClaims } from "./consolidation";

function asPersonDistribution(claim: DaphneEpistemicClaimRecord): DaphnePersonDistribution | null {
  if (claim.claimType !== "person_distribution_estimate") return null;
  const value = claim.claim as Partial<DaphnePersonDistribution>;
  if (
    typeof value.dimension !== "string" ||
    typeof value.mean !== "number" ||
    typeof value.variance !== "number" ||
    typeof value.sampleCount !== "number" ||
    !Array.isArray(value.contextKeys) ||
    !Array.isArray(value.sourceObservationIds)
  ) return null;
  return value as DaphnePersonDistribution;
}

export async function buildDaphneV2OperatorCard(input:{
 tenantId:string;canonicalOperatorId:string;agentId:string;asOf?:Date;
}):Promise<DaphneOperatorCard>{
 const asOf=input.asOf??new Date();
 const [observations,claims,goals,metaPreferences,interventions,outcomes]=await Promise.all([
  listDaphneObservations({tenantId:input.tenantId,canonicalOperatorId:input.canonicalOperatorId,limit:500}),
  listDaphneEpistemicClaims({tenantId:input.tenantId,canonicalOperatorId:input.canonicalOperatorId,limit:500}),
  listActiveDaphneGoals({tenantId:input.tenantId,canonicalOperatorId:input.canonicalOperatorId}),
  loadDaphneMetaPreferences({tenantId:input.tenantId,canonicalOperatorId:input.canonicalOperatorId}),
  listDaphneInterventions({tenantId:input.tenantId,canonicalOperatorId:input.canonicalOperatorId,limit:500}),
  listDaphneOutcomes({tenantId:input.tenantId,canonicalOperatorId:input.canonicalOperatorId,limit:500}),
 ]);
 const scopedObservations=observations.filter(o =>
  o.tenantId===input.tenantId && o.canonicalOperatorId===input.canonicalOperatorId &&
  (o.agentId===null || o.agentId===input.agentId) &&
  ["verified","attested"].includes(o.verificationStatus));
 const currentClaims=resolveDaphneCurrentClaims({...input,claims,asOf});
 const state=deriveDaphneFastState({observations:scopedObservations,asOf});
 const context=deriveDaphneContext({observations:scopedObservations,asOf});
 const relationship=deriveDaphneRelationship({observations:scopedObservations,agentId:input.agentId,asOf});
 const person=currentClaims.map(asPersonDistribution).filter((v):v is DaphnePersonDistribution=>Boolean(v));
 const claimKeys=Array.from(new Set(currentClaims.map(c=>c.claimKey)));
 const hypotheses=claimKeys.map(claimKey=>buildDaphneHypothesisSet({claimKey,claims:currentClaims}));
 const responseModel=buildDaphneResponseModel({
  interventions:interventions.filter(i=>i.agentId===input.agentId),outcomes,successMeasureKey:"started",burdenMeasureKey:"burden"
 });
 const card=compileDaphneOperatorCard({
  tenantId:input.tenantId,canonicalOperatorId:input.canonicalOperatorId,agentId:input.agentId,generatedAt:asOf,
  person,state,context,goals,relationship,metaPreferences,hypotheses,responseModel
 });
 await recordDaphneMetricEvent({
   tenantId:input.tenantId,canonicalOperatorId:input.canonicalOperatorId,agentId:input.agentId,eventName:"card_compiled",
   properties:{evidenceCount:card.evidenceRefs.length,hypothesisCount:card.hypotheses.length,personDimensionCount:card.person.length},
   sourceReference:`card:${card.generatedAt}`,idempotencyKey:`card:${input.agentId}:${card.generatedAt}`
 }).catch(()=>undefined);
 return card;
}

export async function loadDaphneEvidenceBundle(input:{
 tenantId:string;canonicalOperatorId:string;limit?:number;
}){
 const limit=Math.max(1,Math.min(input.limit??100,500));
 const [observations,claims,interventions,outcomes]=await Promise.all([
  listDaphneObservations({...input,limit}),
  listDaphneEpistemicClaims({...input,limit}),
  listDaphneInterventions({...input,limit}),
  listDaphneOutcomes({...input,limit}),
 ]);
 return {observations,claims,interventions,outcomes};
}
