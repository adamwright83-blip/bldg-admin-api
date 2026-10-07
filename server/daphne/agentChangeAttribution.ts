export type DaphneAgentChangeAttribution = {
 interventionId:string;
 changeKey:string;
 relation:"temporally_followed"|"associated"|"causal_supported"|"not_attributable";
 causalClaimAllowed:boolean;
 evidenceRefs:string[];
 reason:string;
};
export function attributeDaphneAgentChange(input:{
 interventionId:string;changeKey:string;
 interventionOccurredAt:string;changeObservedAt:string;
 linkedOutcome:boolean;
 associationObserved?:boolean;
 treatmentEffectStatus?:"randomized"|"propensity_supported"|null;
 evidenceRefs:string[];
}):DaphneAgentChangeAttribution{
 const before=Date.parse(input.interventionOccurredAt), after=Date.parse(input.changeObservedAt);
 if(!Number.isFinite(before)||!Number.isFinite(after)||after<before) return {interventionId:input.interventionId,changeKey:input.changeKey,relation:"not_attributable",causalClaimAllowed:false,evidenceRefs:input.evidenceRefs,reason:"change_not_after_intervention"};
 if(!input.linkedOutcome) return {interventionId:input.interventionId,changeKey:input.changeKey,relation:"temporally_followed",causalClaimAllowed:false,evidenceRefs:input.evidenceRefs,reason:"temporal_sequence_only"};
 if(input.treatmentEffectStatus) return {interventionId:input.interventionId,changeKey:input.changeKey,relation:"causal_supported",causalClaimAllowed:true,evidenceRefs:input.evidenceRefs,reason:`linked_outcome_with_${input.treatmentEffectStatus}_effect_support`};
 if(input.associationObserved) return {interventionId:input.interventionId,changeKey:input.changeKey,relation:"associated",causalClaimAllowed:false,evidenceRefs:input.evidenceRefs,reason:"linked_outcome_association_only"};
 return {interventionId:input.interventionId,changeKey:input.changeKey,relation:"temporally_followed",causalClaimAllowed:false,evidenceRefs:input.evidenceRefs,reason:"linked_outcome_without_effect_estimate"};
}
