/**
 * ONE authoritative interpretation of the operator's utterance, produced before any route acts.
 *
 * WHY THIS EXISTS. On the 2026-09-20 call Adam pushed back on Claire — "of course you know my
 * sales data, if I asked you how many sales I got the last 30 days you would be able to give me a
 * number" — and Claire simultaneously answered it as a business question AND read it back as a Day
 * Line task ("Got it. For today: Well, of course you do, you know, my sales data…"). Nothing was
 * broken in either parser individually. The failure was that several mutation-capable routes each
 * re-interpreted the raw sentence and execution order decided the winner.
 *
 * THE INVARIANT THIS INSTALLS:
 *
 *     A PARSER FINDING TASK-LIKE WORDS IS NOT ACTION INTENT.
 *
 * Work may only be proposed when the interpretation positively identifies work the OPERATOR is
 * doing or asking for. A correction, a rebuttal, a question about what Claire knows, or an explicit
 * refusal can never become a Day Line proposal, however many schedulable nouns it contains.
 * Ambiguity fails toward NO MUTATION.
 *
 * SCOPE, DELIBERATELY SMALL. This is the first seam of the strangler migration, not the finished
 * kernel. Only the routes that can MUTATE or END the call consume it tonight (Day Line / action
 * proposal, and call control). Business readers, progression, provenance and the briefing parser
 * remain executors behind it and are unchanged. Adding more lanes later means extending this type,
 * not adding another competing interpreter.
 */

export type TurnIntentKind =
  | "business_question"
  | "business_judgment"
  | "correction"
  | "context_statement"
  | "action_request"
  | "action_refusal"
  | "personal_probe"
  | "narrative_probe"
  | "prior_claim_challenge"
  | "call_control";

export type InterpretedTurn = {
  intents: TurnIntentKind[];
  /** The operator is leaving. Resolved before any business/Day Line routing. */
  callControl: "end" | "continue";
  /**
   * May a Day Line proposal or work mutation be offered for this turn at all? False for
   * corrections, refusals, and talk about what Claire knows — regardless of extracted items.
   */
  mayProposeWork: boolean;
  /** The operator explicitly told Claire not to track/add something. */
  actionRefused: boolean;
  /** The operator is contradicting or correcting Claire rather than reporting work. */
  correction: boolean;
  /** The utterance is about Claire's own knowledge or capability, not about the operator's work. */
  aboutClaireCapability: boolean;
  hasBusinessQuestion: boolean;
  hasExplicitActionRequest: boolean;
};

// ── Call control ─────────────────────────────────────────────────────────────────────────────
/**
 * Leave-taking as a small grammar rather than an enumeration of sentences: a first-person
 * departure ("I gotta go", "I need to run"), a parting formula ("talk later", "bye"), or an
 * explicit instruction to end. It works as the tail clause of a mixed turn — "Dana still hasn't
 * replied, but I gotta go."
 *
 * DEPARTURE requires an explicit necessity construction (have to / need to / gotta / must). Without
 * it, "Should I go back to The Louise?" reads as leaving — a false hangup, which is a worse bug
 * than the one this fixes.
 */
const DEPARTURE =
  /\b(?:i|we)\s*(?:'ve|'ll|'m)?\s*(?:have\s+to|has\s+to|had\s+to|need\s+to|needs\s+to|got\s+to|got\s+ta|gotta|must|better|gonna)\s+(?:go|run|head\s+out|get\s+going|get\s+off|get\s+back\s+to\s+it|take\s+off|jump\s+off|leave|jet)\b/;
const PARTING =
  /\b(?:talk|speak|catch)\s+(?:to\s+|with\s+)?(?:you|ya)?\s*(?:later|tomorrow|soon|then)\b|\b(?:good\s*bye|goodbye|bye(?:\s+claire)?|later\s+claire)\b/;
const EXPLICIT_END =
  /\b(?:end\s+(?:the\s+)?call|hang\s+up|we(?:\s+are|'re)\s+done|i(?:\s+am|'m)\s+done\s+talking|that(?:\s+is|'s)\s+it\s+for\s+now|that(?:\s+is|'s)\s+all\s+for\s+now)\b/;

/**
 * Acknowledgements that merely SOUND final. These must never hang up on their own — a live status
 * update that pauses after "got it" used to terminate the call. "That's enough" followed by a noun
 * is about the explanation, not the conversation.
 */
const ACKNOWLEDGEMENT_ONLY =
  /^(?:ok(?:ay)?|got\s+it|gotcha|understood|i(?:'m| am)\s+(?:all\s+)?good|sure|yeah|yep|right|fine|thanks?|thank\s+you)[.!]?$/;
const ENOUGH_OF_A_THING = /\b(?:that(?:'s| is)\s+enough|enough)\s+(?:detail|info|information|context|explanation|background|for\s+now\s+on\s+that)\b/;

export function detectCallControl(utterance: string): "end" | "continue" {
  const text = utterance.trim().toLowerCase();
  if (!text) return "continue";
  if (ACKNOWLEDGEMENT_ONLY.test(text)) return "continue";
  if (ENOUGH_OF_A_THING.test(text)) return "continue";
  // A departure/parting phrase reported inside a story about someone else is not the operator leaving.
  if (/\b(?:told|said|says|tells)\b[^.!?]*\b(?:goodbye|bye|later)\b/.test(text)) return "continue";
  return DEPARTURE.test(text) || PARTING.test(text) || EXPLICIT_END.test(text) ? "end" : "continue";
}

// ── Action intent ────────────────────────────────────────────────────────────────────────────
/** A directive aimed at Claire's tracking systems: "add…", "put… on the Day Line", "remind me…". */
const ACTION_DIRECTIVE =
  /\b(?:add|put|schedule|book|remind\s+me|track|log|note|create|set\s+up|pencil|block\s+out|move|reschedule|push)\b/i;

/**
 * Explicit refusal. Any of these makes work proposal impossible for the turn, even alongside a
 * genuine-looking item: "don't add that", "that isn't a Day Line task", "I didn't ask you to add".
 */
const ACTION_REFUSAL = new RegExp(
  [
    // negated directive: don't / do not / doesn't need to + (add|put|…)
    String.raw`\b(?:don'?t|do\s+not|didn'?t|did\s+not|won'?t|no\s+need\s+to|nothing\s+to)\b[^.!?]{0,40}\b(?:add|put|track|log|schedule|note|create|remind)\b`,
    // "isn't a Day Line task" / "not Day Line worthy" / "isn't something I want added"
    String.raw`\b(?:is\s*n'?t|'s\s+not|are\s*n'?t|not)\b[^.!?]{0,40}\b(?:day\s*line|dateline)\b`,
    String.raw`\bis\s*n'?t\s+something\s+i\s+want\s+added\b`,
    String.raw`\b(?:no|not)\b[^.!?]{0,20}\b(?:on|onto)\s+(?:the\s+)?day\s*line\b`,
    // "I didn't ask you to add anything"
    String.raw`\bdid\s*n'?t\s+ask\s+you\s+to\b`,
    // "don't put anything on the Day Line"
    String.raw`\b(?:don'?t|do\s+not)\b[^.!?]{0,30}\banything\b`,
  ].join("|"),
  "i"
);

/**
 * The utterance is ABOUT Claire — what she knows, can do, or already said — rather than about the
 * operator's work. This is the class the September call fell into. Second-person capability talk is
 * conversation, never a task.
 */
const ABOUT_CLAIRE_CAPABILITY = new RegExp(
  [
    String.raw`\byou\s+(?:already\s+)?(?:know|knew|have|had|can|could|would|should|do)\b`,
    String.raw`\bof\s+course\s+you\b`,
    String.raw`\byou\s+(?:would|will|can)\s+be\s+able\s+to\b`,
    String.raw`\bif\s+i\s+asked\s+you\b`,
    String.raw`\byou\s+(?:said|told\s+me|mentioned)\b`,
  ].join("|"),
  "i"
);

/** Contradiction / correction markers: the operator is pushing back, not reporting work. */
const CORRECTION = new RegExp(
  [
    String.raw`\b(?:no|nope),?\s+i\s+(?:meant|said|didn'?t)\b`,
    String.raw`\bi\s+said\b[^.!?]{0,60}\bi\s+did\s*n'?t\b`,
    String.raw`\bthat(?:'s| is)\s+(?:not|n'?t)\s+what\s+i\b`,
    String.raw`\bwell,?\s+of\s+course\b`,
    String.raw`\bi\s+did\s*n'?t\s+ask\b`,
  ].join("|"),
  "i"
);

const QUESTION_MARK = /\?/;
const BUSINESS_QUESTION_LEAD =
  /\b(?:what|how\s+(?:much|many)|who|when|which|did|does|do|is|are|was|were|has|have)\b/i;

export type InterpretTurnOptions = {
  /** Did the deterministic briefing parser extract any work items? Evidence, never authority. */
  extractedWorkItems?: number;
};

export function interpretTurn(utterance: string, options: InterpretTurnOptions = {}): InterpretedTurn {
  const text = utterance.trim();
  const intents: TurnIntentKind[] = [];

  const callControl = detectCallControl(text);
  if (callControl === "end") intents.push("call_control");

  const actionRefused = ACTION_REFUSAL.test(text);
  const correction = CORRECTION.test(text);
  const aboutClaireCapability = ABOUT_CLAIRE_CAPABILITY.test(text);
  const hasExplicitActionRequest = ACTION_DIRECTIVE.test(text) && !actionRefused;
  const hasBusinessQuestion = QUESTION_MARK.test(text) || BUSINESS_QUESTION_LEAD.test(text.split(/\s+/).slice(0, 4).join(" "));

  if (actionRefused) intents.push("action_refusal");
  if (correction) intents.push("correction");
  if (hasExplicitActionRequest) intents.push("action_request");
  if (hasBusinessQuestion) intents.push("business_question");
  if (aboutClaireCapability && !hasExplicitActionRequest) intents.push("context_statement");

  /**
   * POSITIVE ACTION INTENT REQUIRED.
   *
   * Extracted items are evidence that schedulable words exist, not that the operator asked for
   * anything. Work may be proposed only when the operator either issued a directive, or narrated
   * their own work (the ordinary briefing flow) — and never when they are refusing, correcting, or
   * talking about what Claire knows.
   */
  // A turn whose point is leaving is not a work briefing: "I gotta go" must not mint a Day Line
  // item out of whatever nouns preceded it. An explicit directive still counts.
  const narratedOwnWork = (options.extractedWorkItems ?? 0) > 0 && callControl !== "end";
  const mayProposeWork =
    !actionRefused && !correction && !aboutClaireCapability && (hasExplicitActionRequest || narratedOwnWork);

  return {
    intents,
    callControl,
    mayProposeWork,
    actionRefused,
    correction,
    aboutClaireCapability,
    hasBusinessQuestion,
    hasExplicitActionRequest,
  };
}
