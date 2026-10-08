export type DaphnePolicyCandidate = {
 key:string;
 proximal:number;
 distal:number;
 burden:number;
 relationshipRisk:number;
 preferenceFit:number;
 uncertainty:number;
 hardBlocked?:boolean;
};
export type DaphnePolicyWeights = {
 proximal:number; distal:number; burden:number; relationshipRisk:number; preferenceFit:number; uncertainty:number;
};
export type DaphnePolicyDecision = {
 action:string; score:number|null; acceptableActions:string[]; abstained:boolean;
 receipt:{policyVersion:string;weights:DaphnePolicyWeights;scores:Record<string,number>;blockedActions:string[]};
};

export const DEFAULT_DAPHNE_POLICY_WEIGHTS:DaphnePolicyWeights={
 proximal:.28,distal:.28,burden:.16,relationshipRisk:.12,preferenceFit:.12,uncertainty:.04
};

export function chooseDaphnePolicyAction(input:{
 candidates:DaphnePolicyCandidate[];policyVersion:string;weights?:DaphnePolicyWeights;minScore?:number;
}):DaphnePolicyDecision{
 const w=input.weights??DEFAULT_DAPHNE_POLICY_WEIGHTS;
 const scores:Record<string,number>={},blocked:string[]=[];
 const allowed=input.candidates.filter(c=>{if(c.hardBlocked){blocked.push(c.key);return false;} return true;});
 for(const c of allowed){
  scores[c.key]=Number((c.proximal*w.proximal+c.distal*w.distal-c.burden*w.burden-c.relationshipRisk*w.relationshipRisk+c.preferenceFit*w.preferenceFit-c.uncertainty*w.uncertainty).toFixed(6));
 }
 const ranked=allowed.slice().sort((a,b)=>scores[b.key]-scores[a.key]||a.key.localeCompare(b.key));
 const top=ranked[0], threshold=input.minScore??0;
 if(!top||scores[top.key]<threshold){
  return {action:"no_intervention",score:null,acceptableActions:allowed.map(x=>x.key),abstained:true,receipt:{policyVersion:input.policyVersion,weights:w,scores,blockedActions:blocked}};
 }
 return {action:top.key,score:scores[top.key],acceptableActions:allowed.map(x=>x.key),abstained:false,receipt:{policyVersion:input.policyVersion,weights:w,scores,blockedActions:blocked}};
}
