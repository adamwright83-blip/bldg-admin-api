export const DAPHNE_PRODUCT_MANIFEST = Object.freeze({
  productName: "Daphne",
  version: "v2",
  category: "adaptive user intelligence",
  corePromise: "Learn how an AI should work with a specific person, with evidence and uncertainty attached.",
  capabilities: Object.freeze([
    "person_state_context_separation",
    "dyadic_relationship_memory",
    "user_governed_meta_preferences",
    "competing_hypotheses",
    "conditional_response_model",
    "causal_learning_when_identifiable",
    "safe_active_learning",
    "evidence_inspection_and_correction",
    "privacy_export_and_erasure",
  ]),
  nonClaims: Object.freeze([
    "medical_diagnosis",
    "mind_reading",
    "business_truth_authority",
    "narrative_disclosure_authority",
    "causality_from_observation_alone",
  ]),
});

export type DaphneExternalIdentity = {
  tenantId:string;
  canonicalUserId:string;
};

export type DaphneExternalCard = {
  generatedAt:string;
  agentId:string;
  payload:unknown;
};

export type DaphneExternalEvidenceBundle = {
  payload:unknown;
};

export interface DaphneProductPorts {
  resolveIdentity(externalUserRef:string):Promise<DaphneExternalIdentity>;
  loadCard(input:DaphneExternalIdentity&{agentId:string}):Promise<DaphneExternalCard>;
  loadEvidence(input:DaphneExternalIdentity&{limit:number}):Promise<DaphneExternalEvidenceBundle>;
  setControl(input:DaphneExternalIdentity&{key:string;value:unknown}):Promise<unknown>;
  inspectClaim(input:DaphneExternalIdentity&{claimId:string}):Promise<unknown>;
  correctClaim(input:DaphneExternalIdentity&{claimId:string;correctedClaim:Record<string,unknown>}):Promise<unknown>;
}

export function createDaphneProductService(ports:DaphneProductPorts){
 return {
  manifest:()=>DAPHNE_PRODUCT_MANIFEST,
  async card(externalUserRef:string,agentId:string){
   const identity=await ports.resolveIdentity(externalUserRef);
   return ports.loadCard({...identity,agentId});
  },
  async evidence(externalUserRef:string,limit=100){
   const identity=await ports.resolveIdentity(externalUserRef);
   return ports.loadEvidence({...identity,limit:Math.max(1,Math.min(limit,500))});
  },
  async setControl(externalUserRef:string,key:string,value:unknown){
   const identity=await ports.resolveIdentity(externalUserRef);
   return ports.setControl({...identity,key,value});
  },
  async inspectClaim(externalUserRef:string,claimId:string){
   const identity=await ports.resolveIdentity(externalUserRef);
   return ports.inspectClaim({...identity,claimId});
  },
  async correctClaim(externalUserRef:string,claimId:string,correctedClaim:Record<string,unknown>){
   const identity=await ports.resolveIdentity(externalUserRef);
   return ports.correctClaim({...identity,claimId,correctedClaim});
  },
 };
}
