import type { DaphneRelationship } from "./relationshipModel";

export type DaphneRepairRecommendation = {
  action:"acknowledge_and_adjust"|"clarify_boundary"|"ask_repair_question"|"no_repair_needed";
  target:string|null;
  rationale:string;
  forbiddenMoves:string[];
};

export function recommendDaphneRelationshipRepair(
  relationship:DaphneRelationship
):DaphneRepairRecommendation{
  const rupture=relationship.unresolvedRuptures[0]??null;
  if(!rupture) return {action:"no_repair_needed",target:null,rationale:"no_unresolved_rupture",forbiddenMoves:[]};
  const boundary=relationship.boundaries.find(v=>v===rupture) || (relationship.boundaries.at(-1) ?? null);
  if(boundary){
    return {
      action:"clarify_boundary",target:rupture,
      rationale:"unresolved_rupture_overlaps_recorded_boundary",
      forbiddenMoves:["guilt","pressure","defensiveness","claiming_intent","diagnosing_user"],
    };
  }
  if(relationship.corrections.length){
    return {
      action:"acknowledge_and_adjust",target:rupture,
      rationale:"unresolved_rupture_with_prior_user_correction",
      forbiddenMoves:["guilt","pressure","defensiveness","claiming_intent","diagnosing_user"],
    };
  }
  return {
    action:"ask_repair_question",target:rupture,
    rationale:"unresolved_rupture_without_authoritative_correction",
    forbiddenMoves:["guilt","pressure","defensiveness","claiming_intent","diagnosing_user"],
  };
}
