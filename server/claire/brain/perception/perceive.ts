/**
 * Perception wraps existing interpretTurn fields. It does not route or authorize.
 */

import { interpretTurn } from "../../turn/interpretTurn";
import { detectRequestedClaireTopic, isPersonalQuestionAboutClaire } from "../../topicDetection";
import { operatorAskedOntology } from "../../progression/ontologyGuard";
import type { BusinessIntentKind, DialogueActKind, PerceivedEntity, PerceivedTurn } from "../contracts/perceivedTurn";
import { isStandaloneOperatorArtifactVoiceRequest } from "../../operatorArtifactVoice";
import { reconcileCallControl } from "../executive/callControl";
import { classifyWorkFrame, type WorkFrameClassification } from "./workFrame";

export type PerceiveInput = {
  rawText: string;
  assembledText?: string;
  completeness: PerceivedTurn["completeness"];
};

function intentFromAssembled(assembled: string, turn: ReturnType<typeof interpretTurn>): BusinessIntentKind {
  if (turn.correctnessChallenge) return "correctness_challenge";
  if (turn.provenanceQuestion) return "provenance_question";
  if (turn.queryRefinement) return "query_refinement";
  if (turn.queryParameterChange) return "query_requery";
  if (turn.broadBriefingRequest) return "broad_briefing";
  if (turn.hasBusinessQuestion && /\b(?:what should i do|what would you do)\b/i.test(assembled)) {
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
  if (correctionOf(assembled, turn)) out.push("correction");
  if (turn.hasExplicitActionRequest) out.push("directive");
  if (turn.operatorWorkCommitment) out.push("commitment");
  if (turn.hasBusinessQuestion) out.push("question");
  if (turn.callControl === "end") out.push("leave_taking");
  if (out.length === 0) out.push("continue");
  return out;
}

/**
 * Revision phrasings V1's interpreter does not flag as corrections.
 *
 * Perception may notice more than `interpretTurn` does; it still only DESCRIBES the
 * turn, and Executive Function decides what to do about it.
 */
const REVISION_PHRASING =
  /\b(?:wait|hold on|actually|scratch that)\b[\s\S]{0,40}\b(?:change|make\s+it|move|switch|instead)\b|\b(?:change|move|switch)\b[\s\S]{0,60}\bto\b/i;

function correctionOf(assembled: string, turn: ReturnType<typeof interpretTurn>): boolean {
  return turn.correction || REVISION_PHRASING.test(assembled);
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
  if (!correctionOf(assembled, turn)) return null;
  if (turn.queryRefinement || turn.queryParameterChange || turn.anchorEntity || turn.exclusions.length > 0) return "prior_query";
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

export type PerceiveDeps = {
  /** Test seam. A throw is a failed classifier, never mission authority. */
  classifyWorkFrame?: (text: string) => WorkFrameClassification;
};

function leadingNegationHasSubstance(text: string): boolean {
  const match = /^(?:no|nope|nah)\b[.!?,]*\s*([\s\S]*)$/i.exec(text.trim());
  if (!match) return false;
  const rest = match[1]?.trim() ?? "";
  if (!rest) return false;
  if (/^(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight)\b[.!?]*$/i.test(rest)) {
    return false;
  }
  return true;
}

export function perceiveTurn(input: PerceiveInput, deps: PerceiveDeps = {}): PerceivedTurn {
  const assembledText = (input.assembledText ?? input.rawText).trim();
  const turn = interpretTurn(assembledText);
  let classification: WorkFrameClassification;
  try {
    classification = deps.classifyWorkFrame
      ? deps.classifyWorkFrame(assembledText)
      : classifyWorkFrame(assembledText, {
          explicitActionRequest: turn.hasExplicitActionRequest,
          operatorWorkCommitment: turn.operatorWorkCommitment,
        });
  } catch {
    classification = {
      status: "failed",
      workDeclarationKind: "none",
      attentionRepair: "none",
      operatorIntentAttested: false,
      embeddedExternalFact: false,
      explicitMissionWriteRequest: false,
      openFragment: false,
      strategicShape: "none",
      declaredContentLabel: null,
      factualChallenge: false,
    };
  }
  const externalCapability = isStandaloneOperatorArtifactVoiceRequest(assembledText)
    ? ("operator_artifact_sms" as const)
    : null;
  if (
    externalCapability &&
    (classification.workDeclarationKind === "ordinary_work" || classification.workDeclarationKind === "explicit_action")
  ) {
    classification = { ...classification, workDeclarationKind: "none" };
  }
  const entities: PerceivedEntity[] = [
    // A mention only. Whether it is a person or an account is decided downstream,
    // by authoritative evidence, never by counting words here.
    ...turn.entities.map(raw => ({ raw, kind: "entity_mention" as const })),
    ...turn.temporal.map(raw => ({ raw, kind: "temporal" as const })),
  ];

  // Explicit goodbye outranks V1 departure and outranks any embedded fact.
  // Movement toward a place ("go there", "go back", "go to") is not leave-taking.
  const callControl = reconcileCallControl(assembledText, turn.callControl);
  if (callControl === "end" && classification.status === "classified") {
    classification = { ...classification, operatorIntentAttested: false, declaredContentLabel: null };
  }

  const factual =
    turn.correctnessChallenge || turn.provenanceQuestion || classification.factualChallenge;
  let correction = correctionOf(assembledText, turn);
  let correctionTarget = correctionTargetOf(assembledText, turn);
  let refusal = turn.actionRefused;
  // A leading "No" followed by a new subject is not a pending refusal.
  // "No, Wednesday" is a revision and is left alone. Explicit "don't add / don't log /
  // don't schedule" stays a refusal even when the same turn repairs attention.
  const substantiveNo = leadingNegationHasSubstance(assembledText);
  const repairing = classification.status === "classified" && classification.attentionRepair !== "none";
  const newFrame =
    classification.status === "classified" &&
    (classification.workDeclarationKind === "strategic_work" ||
      classification.workDeclarationKind === "context_narration" ||
      classification.operatorIntentAttested ||
      classification.openFragment);
  if (!factual && !turn.actionRefused && (repairing || (substantiveNo && newFrame))) {
    refusal = false;
    if (repairing && correctionTarget !== "prior_claim") {
      correction = false;
      correctionTarget = null;
    }
  }

  let dialogueActs = acts(turn, assembledText);
  if (repairing) {
    dialogueActs = dialogueActs.filter(act => act !== "continue");
    if (!dialogueActs.includes("attention_repair")) dialogueActs.push("attention_repair");
    if (!refusal) dialogueActs = dialogueActs.filter(act => act !== "refusal");
  }
  if (callControl !== "end") {
    dialogueActs = dialogueActs.filter(act => act !== "leave_taking");
  }

  const ambiguities: string[] = [];
  if (classification.status === "unknown") ambiguities.push("work_frame_unknown");
  if (classification.status === "failed") ambiguities.push("work_frame_failed");

  return {
    rawText: input.rawText,
    assembledText,
    completeness: input.completeness,
    dialogueActs,
    businessIntent: intentFromAssembled(assembledText, turn),
    entities,
    temporalReferences: turn.temporal,
    cardinality: turn.cardinality,
    ordering: ordering(assembledText, turn),
    exclusions: turn.exclusions,
    anchorEntity: turn.anchorEntity,
    priorQueryReference: turn.queryRefinement || Boolean(turn.anchorEntity) || turn.exclusions.length > 0,
    correction,
    correctionTarget,
    refusal,
    acknowledgement: turn.acknowledgement,
    explicitActionRequest: turn.hasExplicitActionRequest,
    operatorWorkCommitment: turn.operatorWorkCommitment,
    personalProbe: personalProbeOf(assembledText),
    narrativeProbe: narrativeProbeOf(assembledText),
    callControl,
    ambiguities,
    mayProposeWorkHint: turn.mayProposeWork,
    hasBusinessQuestion: turn.hasBusinessQuestion,
    listRequest: turn.listRequest,
    broadBriefingRequest: turn.broadBriefingRequest,
    aboutClaireCapability: turn.aboutClaireCapability,
    classifierStatus: classification.status,
    workDeclarationKind: classification.status === "classified" ? classification.workDeclarationKind : "none",
    attentionRepair: classification.status === "classified" ? classification.attentionRepair : "none",
    operatorIntentAttested: classification.status === "classified" ? classification.operatorIntentAttested : false,
    embeddedExternalFact: classification.status === "classified" ? classification.embeddedExternalFact : false,
    externalCapability,
    explicitMissionWriteRequest:
      classification.status === "classified" ? classification.explicitMissionWriteRequest : false,
    openFragment: classification.status === "classified" ? classification.openFragment : false,
    strategicShape: classification.status === "classified" ? classification.strategicShape : "none",
    declaredContentLabel: classification.status === "classified" ? classification.declaredContentLabel : null,
  };
}
