/**
 * Perception wraps existing interpretTurn fields. It does not route or authorize.
 */

import { interpretTurn } from "../../turn/interpretTurn";
import type { BusinessIntentKind, DialogueActKind, PerceivedEntity, PerceivedTurn } from "../contracts/perceivedTurn";

export type PerceiveInput = {
  rawText: string;
  assembledText?: string;
  completeness: PerceivedTurn["completeness"];
};

function intentFromAssembled(assembled: string, turn: ReturnType<typeof interpretTurn>): BusinessIntentKind {
  if (turn.correctnessChallenge) return "correctness_challenge";
  if (turn.provenanceQuestion) return "provenance_question";
  if (turn.queryRefinement) return "query_refinement";
  if (turn.broadBriefingRequest) return "broad_briefing";
  if (turn.hasBusinessQuestion && /\b(?:what should i do|what would you do|should i)\b/i.test(assembled)) {
    return "judgment_question";
  }
  if (turn.hasBusinessQuestion) return turn.listRequest ? "list_query" : "fact_question";
  return "none";
}

function ordering(assembled: string, turn: ReturnType<typeof interpretTurn>): PerceivedTurn["ordering"] {
  if (/\bbefore\b/i.test(assembled) && turn.anchorEntity) return "before_anchor";
  if (/\bafter\b/i.test(assembled) && turn.anchorEntity) return "after_anchor";
  if (/\b(?:last|latest|most\s+recent)\b/i.test(assembled)) return "last";
  if (/\b(?:first|earliest)\b/i.test(assembled)) return "first";
  return null;
}

function acts(turn: ReturnType<typeof interpretTurn>, assembled: string): DialogueActKind[] {
  const out: DialogueActKind[] = [];
  if (/^(?:good\s+)?(?:morning|afternoon|evening)\b/i.test(assembled.trim())) out.push("greeting");
  if (turn.acknowledgement) out.push("acknowledgement");
  if (turn.actionRefused) out.push("refusal");
  if (turn.correction) out.push("correction");
  if (turn.hasExplicitActionRequest) out.push("directive");
  if (turn.operatorWorkCommitment) out.push("commitment");
  if (turn.hasBusinessQuestion) out.push("question");
  if (turn.callControl === "end") out.push("leave_taking");
  if (out.length === 0) out.push("continue");
  return out;
}

export function perceiveTurn(input: PerceiveInput): PerceivedTurn {
  const assembledText = (input.assembledText ?? input.rawText).trim();
  const turn = interpretTurn(assembledText);
  const entities: PerceivedEntity[] = [
    ...turn.entities.map(raw => ({ raw, kind: "unresolved" as const })),
    ...turn.temporal.map(raw => ({ raw, kind: "temporal" as const })),
  ];
  return {
    rawText: input.rawText,
    assembledText,
    completeness: input.completeness,
    dialogueActs: acts(turn, assembledText),
    businessIntent: intentFromAssembled(assembledText, turn),
    entities,
    temporalReferences: turn.temporal,
    cardinality: turn.cardinality,
    ordering: ordering(assembledText, turn),
    exclusions: turn.exclusions,
    anchorEntity: turn.anchorEntity,
    priorQueryReference: turn.queryRefinement || Boolean(turn.anchorEntity) || turn.exclusions.length > 0,
    correction: turn.correction,
    correctionTarget: null,
    refusal: turn.actionRefused,
    acknowledgement: turn.acknowledgement,
    explicitActionRequest: turn.hasExplicitActionRequest,
    operatorWorkCommitment: turn.operatorWorkCommitment,
    personalProbe: false,
    narrativeProbe: false,
    callControl: turn.callControl,
    ambiguities: [],
    mayProposeWorkHint: turn.mayProposeWork,
    hasBusinessQuestion: turn.hasBusinessQuestion,
    listRequest: turn.listRequest,
    broadBriefingRequest: turn.broadBriefingRequest,
    aboutClaireCapability: turn.aboutClaireCapability,
  };
}
