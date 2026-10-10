import { randomUUID } from "node:crypto";
import { getDaphneObservationsByIds, recordDaphneObservation, type DaphneObservationRecord } from "./observationStore";
import {
  getDaphneEpistemicClaimById,
  recordDaphneEpistemicClaim,
  type DaphneEpistemicClaimRecord,
} from "./epistemicStore";
import { recordDaphneMetricEvent } from "./metrics";

export type DaphneClaimInspection = {
  claim: DaphneEpistemicClaimRecord;
  sourceObservations: DaphneObservationRecord[];
  explanation: {
    claimType: string;
    epistemicStatus: string;
    causalEvidenceStatus: string;
    evidenceCount: number;
    counterEvidenceCount: number;
    userMayCorrect: true;
    userMayReject: true;
  };
};

async function requireClaim(input:{tenantId:string;canonicalOperatorId:string;claimId:string}):Promise<DaphneEpistemicClaimRecord>{
  const claim=await getDaphneEpistemicClaimById(input);
  if(!claim) throw new Error("Daphne claim not found");
  return claim;
}

export async function inspectDaphneClaim(input:{tenantId:string;canonicalOperatorId:string;claimId:string}):Promise<DaphneClaimInspection>{
  const claim=await requireClaim(input);
  const sourceObservations=await getDaphneObservationsByIds({...input,observationIds:claim.sourceObservationIds});
  return {
    claim,
    sourceObservations,
    explanation:{
      claimType:claim.claimType,epistemicStatus:claim.epistemicStatus,causalEvidenceStatus:claim.causalEvidenceStatus,
      evidenceCount:claim.sourceObservationIds.length+claim.supportingEvidence.length,counterEvidenceCount:claim.counterEvidence.length,
      userMayCorrect:true,userMayReject:true,
    }
  };
}

async function userDisposition(input:{
 tenantId:string;canonicalOperatorId:string;operatorUserId:string;actorId:string;
 claimId:string;kind:"correct"|"reject";correctedClaim?:Record<string,unknown>;
}):Promise<DaphneEpistemicClaimRecord>{
 const old=await requireClaim(input);
 const now=new Date();
 const observation=await recordDaphneObservation({
   tenantId:input.tenantId,canonicalOperatorId:input.canonicalOperatorId,operatorUserId:input.operatorUserId,
   actorType:"user",actorId:input.actorId,observationKind:"correction",evidenceChannel:"stated",verificationStatus:"attested",
   sourceType:"daphne_inspector",sourceReference:`claim:${old.id}`,occurredAt:now,
   payload:{claimId:old.id,disposition:input.kind,correctedClaim:input.correctedClaim??null},
   idempotencyKey:`claim-disposition:${old.id}:${input.kind}:${randomUUID()}`
 });
 const result=await recordDaphneEpistemicClaim({
   tenantId:input.tenantId,canonicalOperatorId:input.canonicalOperatorId,agentId:old.agentId,
   claimType:"supersession",claimKey:old.claimKey,
   claim:input.kind==="reject"?{userDisposition:"rejected"}:{userDisposition:"corrected",value:input.correctedClaim??{}},
   sourceObservationIds:[observation.id],supportingEvidence:[],counterEvidence:[{supersededClaimId:old.id}],
   scope:old.scope,contextApplicability:old.contextApplicability,uncertainty:{epistemic:0,measurement:0},
   epistemicStatus:"active",causalEvidenceStatus:"none",modelVersion:"daphne-v2-user-control",
   humanPinned:true,correctedByObservationId:observation.id,supersedesClaimId:old.id,
   idempotencyKey:`user-${input.kind}:${old.id}:${observation.id}`
 });
 await recordDaphneMetricEvent({
   tenantId:input.tenantId,canonicalOperatorId:input.canonicalOperatorId,agentId:old.agentId,
   eventName:input.kind==="correct"?"claim_corrected":"claim_rejected",
   properties:{claimId:old.id,claimKey:old.claimKey},sourceReference:result.id,
   idempotencyKey:`user-disposition:${result.id}`
 }).catch(()=>undefined);
 return result;
}

export function correctDaphneClaim(input:{
 tenantId:string;canonicalOperatorId:string;operatorUserId:string;actorId:string;claimId:string;correctedClaim:Record<string,unknown>;
}){ return userDisposition({...input,kind:"correct"}); }

export function rejectDaphneClaim(input:{
 tenantId:string;canonicalOperatorId:string;operatorUserId:string;actorId:string;claimId:string;
}){ return userDisposition({...input,kind:"reject"}); }
