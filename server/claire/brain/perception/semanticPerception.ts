/**
 * Brain V2 semantic perception.
 *
 * Deterministic perception reads the surface of a sentence. It cannot tell
 * "What do you think I should focus on this week?" (a judgment request) from
 * "What were my sales this week?" (a fact request), or "How was your weekend?"
 * (a personal question to Claire) from a business question. Legacy Claire
 * answered that with its own interpreter; Brain V2 owns interpretation, so it
 * has one of its own.
 *
 * Bounded by construction:
 *   - closed enums only; no free text reaches the executive;
 *   - it may REFINE what kind of turn this is (business intent, personal probe,
 *     briefing request, leave-taking); it may not create work, grants, pending
 *     bindings, entities, or any other authority — those stay deterministic;
 *   - prior-claim challenge lanes open only when a prior claim exists;
 *   - hanging up needs agreement: the model can veto a deterministic "end", and
 *     can add one only for a short leave-taking with no question in it;
 *   - any failure, timeout, or malformed output returns the deterministic turn.
 */

import { invokeLLM } from "../../../_core/llm";
import { ENV } from "../../../_core/env";
import { CURRENT_HAIKU_MODEL, normalizeAnthropicModel } from "../../../_core/modelCapabilities";
import type { BusinessIntentKind, DialogueActKind, PerceivedTurn } from "../contracts/perceivedTurn";
import {
  addressesClaire,
  isEncouragementRequest,
  isMacroGoalQuestion,
  isRomanticAdvance,
} from "./conversationalActs";
import { disputesPriorClaim, leadHorizon } from "./leadRequest";

export type SemanticReading = {
  turnKind:
    | "business_fact_question"
    | "business_list_question"
    | "business_judgment_or_strategy"
    | "daily_briefing_request"
    | "challenge_prior_claim"
    | "ask_source_of_prior_claim"
    | "personal_question_to_claire"
    | "romantic_or_personal_advance"
    | "encouragement_request"
    | "repeat_request"
    | "small_talk"
    | "report_or_narration"
    | "work_instruction"
    /**
     * The operator is showing Claire how she should speak to them, or telling her
     * what her role is ("tomorrow you're gonna hit 3 locations…", "you should
     * already know them, that needs to be coded in you"). Not the operator's own
     * commitment, not an instruction to write, not a challenge of a figure.
     */
    | "role_feedback_or_example"
    | "acknowledgement"
    | "refusal"
    | "correction"
    | "leave_taking"
    | "unclear";
  endsConversation: boolean;
  /**
   * Only meaningful with challenge_prior_claim: true when the utterance disputes
   * the CONTENT of something Claire stated. Absent from older readers; the
   * deterministic dispute check then decides.
   */
  disputesContent?: boolean;
};

export type SemanticPerceptionInput = {
  tenantId: string;
  utterance: string;
  recentTurns: Array<{ speaker: "operator" | "claire"; text: string }>;
  hasPriorClaims: boolean;
  holdingPending: boolean;
};

export type SemanticInterpreter = (input: SemanticPerceptionInput) => Promise<SemanticReading | null>;

const TURN_KINDS: SemanticReading["turnKind"][] = [
  "business_fact_question",
  "business_list_question",
  "business_judgment_or_strategy",
  "daily_briefing_request",
  "challenge_prior_claim",
  "ask_source_of_prior_claim",
  "personal_question_to_claire",
  "romantic_or_personal_advance",
  "encouragement_request",
  "repeat_request",
  "small_talk",
  "report_or_narration",
  "work_instruction",
  "role_feedback_or_example",
  "acknowledgement",
  "refusal",
  "correction",
  "leave_taking",
  "unclear",
];

export function semanticPerceptionModelId(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeAnthropicModel(env.ANTHROPIC_MODEL_CLAIRE_PERCEPTION?.trim() ?? "") || CURRENT_HAIKU_MODEL;
}

const SYSTEM = [
  "You classify one turn of a spoken conversation between a small-business operator and Claire, the operator's chief of staff.",
  "Classify only the operator's latest utterance, using the recent turns for context. Choose exactly one turnKind:",
  "business_fact_question: asks for a fact or number about their business (sales, revenue, orders, customers, schedule, today's work). Asking Claire to remember or state the operator's own goal, objective or target (\"do you remember what my goal is\", \"what is my goal\", \"what am I working toward\") is business_fact_question, never personal_question_to_claire: the goal is the operator's, held in the briefing.",
  "business_list_question: asks for a list of business records.",
  "business_judgment_or_strategy: asks for advice, a recommendation, analysis, priorities, or what Claire thinks they should do.",
  "daily_briefing_request: asks for the day's rundown, morning briefing, what is on their plate today or tomorrow, or what Claire wants them to do next, with no narrower subject.",
  "challenge_prior_claim: doubts a specific fact or figure Claire just stated (\"are you sure\", \"that's wrong\"). Feedback about what Claire should know or do is NOT a challenge. ask_source_of_prior_claim: asks where Claire got it.",
  "personal_question_to_claire: asks Claire about herself, her life, feelings, or history. Only a genuine question about Claire qualifies.",
  "romantic_or_personal_advance: the operator makes a romantic or personal advance at Claire (\"I love you, Claire\", \"I miss you\", \"you're gorgeous\", \"be my girlfriend\"). It is not a question about Claire's biography and is never personal_question_to_claire.",
  "encouragement_request: the operator asks Claire for encouragement, support or a pep talk about their work (\"I want your encouragement\"). It is a work request and is never personal_question_to_claire.",
  "repeat_request: the operator asks Claire to say her previous turn again (\"what did you say\", \"say that again\", \"repeat that\", \"I didn't catch that\", \"you have to repeat yourself\"). This is about hearing, not doubting: it is never challenge_prior_claim or ask_source_of_prior_claim.",
  "small_talk: greeting or social chat that is not a question to Claire about herself.",
  "report_or_narration: tells Claire what happened or how something went. work_instruction: asks Claire to add, save, schedule, remind, or do something.",
  "role_feedback_or_example: the operator is showing Claire how she should talk to them (second person, e.g. \"tomorrow you're gonna hit three locations\") or telling her what her role is (\"you should already know them\", \"that needs to be coded in you\"). It is not the operator committing to their own work.",
  "acknowledgement, refusal, correction, leave_taking, unclear: as named.",
  "endsConversation is true only when the operator is clearly finishing the whole conversation now.",
].join(" ");

/** Production interpreter: newest Haiku, closed schema, ~1s. */
export const interpretSemanticPerception: SemanticInterpreter = async input => {
  if (!ENV.anthropicApiKey?.trim()) return null;
  const result = await invokeLLM({
    tenantId: input.tenantId,
    model: semanticPerceptionModelId(),
    maxTokens: 200,
    timeoutMs: 6_000,
    feature: "claire_brain_v2_perception",
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: JSON.stringify({
          recentTurns: input.recentTurns.slice(-6).map(turn => ({ speaker: turn.speaker, text: turn.text.slice(0, 300) })),
          claireIsHoldingAPendingProposal: input.holdingPending,
          utterance: input.utterance.slice(0, 1_000),
        }),
      },
    ],
    outputSchema: {
      name: "claire_brain_v2_perception",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["turnKind", "endsConversation", "disputesContent"],
        properties: {
          turnKind: { type: "string", enum: TURN_KINDS },
          endsConversation: { type: "boolean" },
          disputesContent: { type: "boolean" },
        },
      },
    },
  });
  const raw = result.choices[0]?.message.content;
  const parsed = JSON.parse(typeof raw === "string" ? raw : "{}") as Partial<SemanticReading>;
  if (!parsed.turnKind || !TURN_KINDS.includes(parsed.turnKind) || typeof parsed.endsConversation !== "boolean") {
    return null;
  }
  return {
    turnKind: parsed.turnKind,
    endsConversation: parsed.endsConversation,
    ...(typeof parsed.disputesContent === "boolean" ? { disputesContent: parsed.disputesContent } : {}),
  };
};

const QUESTION_KINDS = new Set<SemanticReading["turnKind"]>([
  "business_fact_question",
  "business_list_question",
  "business_judgment_or_strategy",
  "daily_briefing_request",
  "challenge_prior_claim",
  "ask_source_of_prior_claim",
  "personal_question_to_claire",
]);

const DETERMINISTIC_ONLY_INTENTS = new Set<BusinessIntentKind>(["query_refinement", "query_requery"]);

/** Fold a semantic reading into the deterministic turn. Pure; authority fields untouched. */
/**
 * The surface can settle a few readings on its own, and when it does the model may not
 * overrule it: a repeat request is never a challenge, an advance is never a biography
 * probe, encouragement is a work request, and the operator's goal is business memory. A model "personal" reading that
 * does not even point at Claire is a misread and is downgraded to small talk.
 */
export function reconcileSemanticReading(perceived: PerceivedTurn, reading: SemanticReading): SemanticReading {
  const text = perceived.assembledText;
  if (perceived.dialogueActs.includes("repeat_request")) {
    return { ...reading, turnKind: "repeat_request" };
  }
  if (isMacroGoalQuestion(text) && (reading.turnKind === "personal_question_to_claire" || reading.turnKind === "small_talk" || reading.turnKind === "unclear")) {
    return { ...reading, turnKind: "business_fact_question" };
  }
  const softKinds = new Set<SemanticReading["turnKind"]>(["personal_question_to_claire", "small_talk", "unclear", "report_or_narration"]);
  if (isRomanticAdvance(text) && softKinds.has(reading.turnKind)) {
    return { ...reading, turnKind: "romantic_or_personal_advance" };
  }
  if (isEncouragementRequest(text) && softKinds.has(reading.turnKind)) {
    return { ...reading, turnKind: "encouragement_request" };
  }
  if (reading.turnKind === "romantic_or_personal_advance" && !addressesClaire(text)) {
    return { ...reading, turnKind: "small_talk" };
  }
  if (reading.turnKind === "personal_question_to_claire" && !addressesClaire(text)) {
    return { ...reading, turnKind: "small_talk" };
  }
  return reading;
}

export function applySemanticReading(
  perceived: PerceivedTurn,
  rawReading: SemanticReading,
  context: { hasPriorClaims: boolean }
): PerceivedTurn {
  const next: PerceivedTurn = { ...perceived, dialogueActs: [...perceived.dialogueActs] };
  const reading = reconcileSemanticReading(perceived, rawReading);
  const kind = reading.turnKind;
  const priorClaimLane =
    perceived.businessIntent === "correctness_challenge" || perceived.businessIntent === "provenance_question";

  if (kind === "role_feedback_or_example") {
    /**
     * The operator dictated Claire's lines or described her role. Semantic
     * perception may only LOWER authority: no commitment, no directive, no
     * attested intention, no entity to resolve. Being told "you should be running
     * me" is a request to be led, so the turn becomes an unscoped briefing unless
     * a deterministic prior-claim lane is already open.
     */
    next.claireRoleFeedback = perceived.claireRoleFeedback === "none" ? "dictated_example" : perceived.claireRoleFeedback;
    next.operatorWorkCommitment = false;
    next.explicitActionRequest = false;
    next.mayProposeWorkHint = false;
    next.workDeclarationKind = "none";
    next.operatorIntentAttested = false;
    next.declaredContentLabel = null;
    next.openFragment = false;
    next.strategicShape = "none";
    next.entities = perceived.entities.filter(entity => entity.kind === "temporal");
    if (!priorClaimLane) {
      next.leadRequest = perceived.leadRequest ?? { horizon: leadHorizon(perceived.assembledText) };
    }
  }

  if (kind === "repeat_request") {
    // Deterministic perception already stripped every lane; make sure a surface read
    // that missed the phrasing still carries no challenge, query, work or probe.
    next.dialogueActs = ["repeat_request"];
    next.businessIntent = "none";
    next.hasBusinessQuestion = false;
    next.listRequest = false;
    next.broadBriefingRequest = false;
    next.leadRequest = null;
    next.personalProbe = false;
    next.correction = false;
    next.correctionTarget = null;
    next.refusal = false;
    next.explicitActionRequest = false;
    next.operatorWorkCommitment = false;
    next.mayProposeWorkHint = false;
    next.workDeclarationKind = "none";
    next.attentionRepair = "none";
    next.operatorIntentAttested = false;
    next.openFragment = false;
    next.declaredContentLabel = null;
    if (perceived.callControl === "end" && !reading.endsConversation) next.callControl = "continue";
    return next;
  }

  if (!DETERMINISTIC_ONLY_INTENTS.has(perceived.businessIntent)) {
    let intent: BusinessIntentKind = perceived.businessIntent;
    if (kind === "business_fact_question") intent = perceived.businessIntent === "list_query" ? "list_query" : "fact_question";
    else if (kind === "business_list_question") intent = "list_query";
    else if (
      kind === "business_judgment_or_strategy" &&
      (leadHorizon(perceived.assembledText) !== null || perceived.leadRequest !== null) &&
      !perceived.entities.some(entity => entity.kind === "entity_mention")
    ) {
      // "What should I do tomorrow?" / "Tell me what to do" is a plan request, not an account judgment.
      intent = "broad_briefing";
    } else if (kind === "business_judgment_or_strategy") intent = "judgment_question";
    else if (kind === "daily_briefing_request") intent = "broad_briefing";
    else if (kind === "challenge_prior_claim") {
      // A challenge must actually dispute what Claire said. "You should already know
      // them" opened the correctness lane on 2026-10-20 and produced "I can't freshly
      // verify that claim"; feedback about Claire's role is not a doubt about a figure.
      // The model may veto a dispute (disputesContent false); it cannot create one
      // the words do not carry.
      const disputes =
        reading.disputesContent === false
          ? false
          : disputesPriorClaim(perceived.assembledText);
      intent =
        context.hasPriorClaims && (priorClaimLane || disputes)
          ? "correctness_challenge"
          : perceived.businessIntent;
    } else if (kind === "ask_source_of_prior_claim") intent = context.hasPriorClaims ? "provenance_question" : perceived.businessIntent;
    else if (kind === "role_feedback_or_example") {
      intent = priorClaimLane ? perceived.businessIntent : "broad_briefing";
    } else if (
      kind === "personal_question_to_claire" ||
      kind === "romantic_or_personal_advance" ||
      kind === "encouragement_request" ||
      kind === "small_talk" ||
      kind === "report_or_narration" ||
      kind === "acknowledgement" ||
      kind === "leave_taking"
    ) {
      // A deterministic prior-claim lane stays open; a deterministic lead request
      // ("you're never running me") stays a lead; anything else was a surface misread.
      intent = priorClaimLane ? perceived.businessIntent : perceived.leadRequest ? "broad_briefing" : "none";
    }
    next.businessIntent = intent;
  }

  next.hasBusinessQuestion = next.businessIntent !== "none";
  next.listRequest = next.businessIntent === "list_query";
  next.broadBriefingRequest = next.businessIntent === "broad_briefing";
  if (next.broadBriefingRequest && !next.leadRequest && kind !== "small_talk") {
    // A briefing request or a dated "what should I do" asks Claire to lead.
    next.leadRequest = { horizon: leadHorizon(perceived.assembledText) };
  }
  if (!next.broadBriefingRequest) next.leadRequest = null;
  next.personalProbe =
    kind === "personal_question_to_claire"
      ? true
      : kind.startsWith("business_") ||
          kind === "daily_briefing_request" ||
          kind === "role_feedback_or_example" ||
          kind === "romantic_or_personal_advance" ||
          kind === "encouragement_request"
        ? false
        : perceived.personalProbe;

  if ((QUESTION_KINDS.has(kind) || next.leadRequest) && !next.dialogueActs.includes("question")) next.dialogueActs.push("question");
  if (kind === "role_feedback_or_example") {
    // Direction about how Claire should behave: a correction of Claire, never a commitment.
    next.dialogueActs = next.dialogueActs.filter(act => act !== "commitment" && act !== "directive" && act !== "confide");
    if (!next.dialogueActs.includes("correction")) next.dialogueActs.unshift("correction");
  }
  if (!next.hasBusinessQuestion && !QUESTION_KINDS.has(kind)) {
    next.dialogueActs = next.dialogueActs.filter(act => act !== "question");
  }
  const add = (act: DialogueActKind) => {
    if (!next.dialogueActs.includes(act)) next.dialogueActs.push(act);
  };
  if (kind === "acknowledgement") add("acknowledgement");
  if (kind === "correction") add("correction");
  if (kind === "personal_question_to_claire" || kind === "report_or_narration") add("confide");
  if (kind === "romantic_or_personal_advance") add("romantic_or_personal_advance");
  if (kind === "encouragement_request") add("encouragement_request");
  if (kind !== "romantic_or_personal_advance" && !isRomanticAdvance(perceived.assembledText)) {
    next.dialogueActs = next.dialogueActs.filter(act => act !== "romantic_or_personal_advance");
  }
  if (kind !== "encouragement_request" && !isEncouragementRequest(perceived.assembledText)) {
    next.dialogueActs = next.dialogueActs.filter(act => act !== "encouragement_request");
  }
  if (next.dialogueActs.length > 1) next.dialogueActs = next.dialogueActs.filter(act => act !== "continue");
  if (!next.dialogueActs.length) next.dialogueActs = ["continue"];

  const words = perceived.assembledText.trim().split(/\s+/).filter(Boolean).length;
  if (perceived.callControl === "end") {
    // A question in the same breath is not a goodbye ("Bye the way, what were…").
    next.callControl = (reading.endsConversation || kind === "leave_taking") && !QUESTION_KINDS.has(kind) ? "end" : "continue";
  } else if (reading.endsConversation && kind === "leave_taking" && words <= 10 && !next.hasBusinessQuestion) {
    next.callControl = "end";
  }
  if (next.callControl === "end") add("leave_taking");
  else next.dialogueActs = next.dialogueActs.filter(act => act !== "leave_taking").length
    ? next.dialogueActs.filter(act => act !== "leave_taking")
    : ["continue"];
  return next;
}

/** Refine with a hard budget. Returns the deterministic turn on any failure. */
export async function refinePerception(
  perceived: PerceivedTurn,
  input: Omit<SemanticPerceptionInput, "utterance">,
  interpret: SemanticInterpreter = interpretSemanticPerception,
  budgetMs = 6_500
): Promise<{ perceived: PerceivedTurn; reading: SemanticReading | null }> {
  if (perceived.completeness === "incomplete" || !perceived.assembledText.trim()) return { perceived, reading: null };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reading = await Promise.race([
      interpret({ ...input, utterance: perceived.assembledText }),
      new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), budgetMs);
      }),
    ]);
    if (!reading) return { perceived, reading: null };
    return { perceived: applySemanticReading(perceived, reading, { hasPriorClaims: input.hasPriorClaims }), reading };
  } catch {
    return { perceived, reading: null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
