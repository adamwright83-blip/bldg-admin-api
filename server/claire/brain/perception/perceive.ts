/**
 * Perception wraps existing interpretTurn fields. It does not route or authorize.
 */

import { interpretTurn } from "../../turn/interpretTurn";
import { detectRequestedClaireTopic, isPersonalQuestionAboutClaire } from "../../topicDetection";
import { operatorAskedOntology } from "../../progression/ontologyGuard";
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

/**
 * WHAT is being corrected, from the form of the utterance alone.
 *
 * Perception reports the correction's apparent target; Executive Function decides what
 * to do about it. A correction that names ordering, an anchor or a cardinality is about
 * the previous QUERY; one that challenges a stated figure is about a prior CLAIM;
 * otherwise a correction lands on whatever is pending.
 *
 * This never lets pending state redefine an unrelated utterance — it only labels a turn
 * that is already a correction.
 */
function correctionTargetOf(
  assembled: string,
  turn: ReturnType<typeof interpretTurn>
): PerceivedTurn["correctionTarget"] {
  if (turn.correctnessChallenge || turn.provenanceQuestion) return "prior_claim";
  if (!turn.correction) return null;
  if (turn.queryRefinement || turn.anchorEntity || turn.exclusions.length > 0) return "prior_query";
  if (turn.cardinality != null && /\b(?:i (?:meant|said)|not|rather)\b/i.test(assembled)) return "prior_query";
  if (/\b(?:i (?:meant|said))\b[\s\S]{0,40}\b(?:number|figure|amount|total|revenue|sales)\b/i.test(assembled)) {
    return "prior_claim";
  }
  return "pending_item";
}

/**
 * Is the operator asking about Claire herself, or about what she is?
 *
 * These wrap the EXISTING detectors rather than adding a second personal-intent system.
 * Perception only reports the probe; Self Memory decides eligibility and Executive
 * Function decides the lane. A probe is never itself permission to disclose.
 */
function personalProbeOf(assembled: string): boolean {
  return isPersonalQuestionAboutClaire(assembled) || Boolean(detectRequestedClaireTopic(assembled, true));
}

function narrativeProbeOf(assembled: string): boolean {
  return operatorAskedOntology(assembled);
}

export function perceiveTurn(input: PerceiveInput): PerceivedTurn {
  const assembledText = (input.assembledText ?? input.rawText).trim();
  const turn = interpretTurn(assembledText);
  const entities: PerceivedEntity[] = [
    // A mention only. Whether it is a person or an account is decided downstream,
    // by authoritative evidence, never by counting words here.
    ...turn.entities.map(raw => ({ raw, kind: "entity_mention" as const })),
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
    correctionTarget: correctionTargetOf(assembledText, turn),
    refusal: turn.actionRefused,
    acknowledgement: turn.acknowledgement,
    explicitActionRequest: turn.hasExplicitActionRequest,
    operatorWorkCommitment: turn.operatorWorkCommitment,
    personalProbe: personalProbeOf(assembledText),
    narrativeProbe: narrativeProbeOf(assembledText),
    callControl: turn.callControl,
    ambiguities: [],
    mayProposeWorkHint: turn.mayProposeWork,
    hasBusinessQuestion: turn.hasBusinessQuestion,
    listRequest: turn.listRequest,
    broadBriefingRequest: turn.broadBriefingRequest,
    aboutClaireCapability: turn.aboutClaireCapability,
  };
}
