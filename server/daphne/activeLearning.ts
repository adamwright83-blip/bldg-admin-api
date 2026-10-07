export type DaphneExperimentAction = {
  key:string;
  risk:"low"|"medium"|"high";
  estimatedUtility:number;
  uncertainty:number;
  burden:number;
  irreversible?:boolean;
  touchesBusinessTruth?:boolean;
  touchesNarrativeDisclosure?:boolean;
};
export type DaphneActiveLearningDecision = {
  action:string;
  selectionMode:"randomized"|"deterministic"|"abstain";
  selectionProbability:number|null;
  propensity:Record<string,number>|null;
  acceptableActions:string[];
  reason:string;
};

export function chooseDaphneActiveLearningAction(input:{
 actions:DaphneExperimentAction[];
 experimentationEnabled:boolean;
 maxRisk?:"low"|"medium";
 maxBurden?:number;
 explorationRate?:number;
 draw?:number;
}):DaphneActiveLearningDecision{
 const maxRisk=input.maxRisk??"low";
 const riskRank={low:0,medium:1,high:2};
 const allowed=input.actions.filter(a=>
   riskRank[a.risk]<=riskRank[maxRisk] &&
   !a.irreversible && !a.touchesBusinessTruth && !a.touchesNarrativeDisclosure &&
   a.burden<=(input.maxBurden??0.5)
 );
 if(!allowed.length) return {action:"no_intervention",selectionMode:"abstain",selectionProbability:null,propensity:null,acceptableActions:["no_intervention"],reason:"no_safe_learning_action"};
 const best=allowed.slice().sort((a,b)=>(b.estimatedUtility-b.burden)-(a.estimatedUtility-a.burden)||a.key.localeCompare(b.key))[0];
 if(!input.experimentationEnabled||allowed.length<2){
   return {action:best.key,selectionMode:"deterministic",selectionProbability:null,propensity:null,acceptableActions:allowed.map(a=>a.key),reason:"experimentation_disabled_or_single_action"};
 }
 const eps=Math.max(0.02,Math.min(input.explorationRate??0.15,0.5));
 const p:Record<string,number>={};
 for(const a of allowed) p[a.key]=eps/allowed.length;
 p[best.key]+=1-eps;
 const draw=Math.max(0,Math.min(input.draw??Math.random(),0.999999999));
 let cumulative=0,selected=best.key;
 for(const a of allowed){ cumulative+=p[a.key]; if(draw<cumulative){selected=a.key;break;} }
 return {action:selected,selectionMode:"randomized",selectionProbability:p[selected],propensity:p,acceptableActions:allowed.map(a=>a.key),reason:"bounded_safe_exploration"};
}
