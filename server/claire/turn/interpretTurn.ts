import { containsBriefingAction } from "../briefing/deterministicBriefing";

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
  | "call_control"
  | "acknowledgement"
  | "operator_work_commitment"
  | "query_refinement";

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
  /** The operator says THEY will do something ("I need to call Dana Tuesday"). */
  operatorWorkCommitment: boolean;
  /** A bare acknowledgement: "I'm good", "got it". Not a query, not a challenge, not work. */
  acknowledgement: boolean;
  /** How many records were asked for. `null` when unstated. */
  cardinality: number | null;
  /** The operator asked for a LIST ("sales", "the other four"), not a single record. */
  listRequest: boolean;
  /** Refines the previous business query rather than challenging its truth ("the other four"). */
  queryRefinement: boolean;
  /** Entities the operator asked to leave OUT ("don't tell me about Thomas"). */
  exclusions: string[];
  /** A named record the query is anchored to ("before Thomas"). */
  anchorEntity: string | null;
  /** The operator explicitly asks whether a prior factual answer is correct/current. */
  correctnessChallenge: boolean;
  /** Advice/judgment is requested; this never authorizes a mutation by itself. */
  businessJudgment: boolean;
  /** A genuinely broad request for the operating brief, not "what should I do about Dana". */
  broadOperationalBriefing: boolean;
  /** Weekday/date language resolved separately from entity names. */
  temporalReference: string | null;
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
    // "actually don't do that" / "don't save it" — refusal of the currently pending action.
    String.raw`\b(?:don'?t|do\s+not)\s+(?:do|add|put|change|save|schedule|track|keep)\s+(?:that|it|anything)\b`,
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

const SPOKEN_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, twentyfive: 25,
};

/**
 * Cardinality is a STRUCTURAL property of the request, not a quirk of one parser's regex.
 * `parseLimit` in businessConversation only matched "(top|the|my) <n>", so "last five sales"
 * silently became the singular latest-sale reader — three times in the 2026-09-20 call.
 */
export function parseCardinality(text: string): number | null {
  const lower = text.toLowerCase();
  const N = String.raw`(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)`;
  const toValue = (raw: string | undefined): number | null => {
    if (!raw) return null;
    const value = /^\d+$/.test(raw) ? Number(raw) : (SPOKEN_NUMBERS[raw] ?? null);
    return value && value > 0 ? Math.min(value, 25) : null;
  };
  // A refinement's own count wins over the count it is refining: "I asked you for the last five
  // sales … what were the other four?" is a request for FOUR.
  const refined = toValue(new RegExp(String.raw`\bother\s+${N}\b`).exec(lower)?.[1]);
  if (refined) return refined;
  const leading = new RegExp(String.raw`\b(?:last|latest|first|recent|previous|next|top|biggest|best|another|most\s+recent)\s+${N}\b`).exec(lower);
  const trailing = new RegExp(String.raw`\b${N}\s+(?:most\s+recent|latest|last|biggest|newest)\b`).exec(lower);
  return toValue(leading?.[1]) ?? toValue(trailing?.[1]);
}

/** Plural record nouns mean a list even when no number is given. */
const LIST_NOUN = /\b(?:sales|orders|customers|clients|payments|invoices|accounts|visits|follow[-\s]?ups)\b/i;

/** "the other four", "what about the rest", "and the others" — refine the previous query. */
const QUERY_REFINEMENT =
  /\b(?:the\s+)?other\s+(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b|\bthe\s+(?:rest|others)\b|\bwhat\s+about\s+the\s+(?:rest|others)\b/i;

const CORRECTNESS_CHALLENGE =
  /\b(?:are\s+you\s+sure|check\s+(?:that|those|it|the\s+(?:number|numbers|figure|figures))\s+again|verify\s+(?:that|those|it|the\s+(?:number|numbers|figure|figures))|is\s+(?:that|this)\s+(?:number|figure|right|correct)|are\s+(?:those|these)\s+(?:numbers|figures)\s+(?:right|correct))\b/i;

const BUSINESS_JUDGMENT =
  /\b(?:what\s+should\s+i\s+do\s+about|how\s+should\s+i\s+handle|what\s+would\s+you\s+do\s+about|would\s+you\s+(?:call|text|email|visit|go\s+back)|is\s+it\s+worth\s+(?:calling|texting|emailing|visiting|going\s+back))\b/i;

const BROAD_OPERATIONAL_BRIEFING =
  /^(?:(?:good\s+)?morning(?:\s+claire)?|hey\s+claire|what\s+should\s+i\s+(?:do|know)(?:\s+(?:today|this\s+morning))?|what(?:'s|\s+is)\s+the\s+most\s+important(?:\s+thing)?|what\s+do\s+i\s+need\s+to\s+know(?:\s+(?:today|this\s+morning))?)[?.!]*$/i;

const TEMPORAL_REFERENCE =
  /\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

/** "before Thomas", "after the Louise order" — anchor the window on a named record. */
const ANCHOR = /\b(?:before|prior\s+to|preceding|after|since)\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?)/;
/** Only a capitalised token in the ORIGINAL text is a name; "about the rest" is not an entity. */
function properNoun(candidate: string | undefined): string | null {
  const token = candidate?.trim();
  return token && /^[A-Z]/.test(token) ? token : null;
}

/** "don't tell me about Thomas" — an exclusion, not a refusal to act. */
const EXCLUSION =
  /\b(?:don'?t|do\s+not|stop|skip|leave\s+out)\s+(?:tell(?:ing)?|mention(?:ing)?|talk(?:ing)?|say(?:ing)?|include|including|list(?:ing)?)?\s*(?:me\s+)?(?:about\s+)?([A-Za-z][\w'-]+(?:\s+[A-Z][\w'-]+)?)/i;

/**
 * The operator committing to their OWN work. This — not a downstream parser finding schedulable
 * nouns — is what may authorize a Day Line proposal. In the 2026-09-20 call it is exactly the
 * property that separates the correct proposal ("I need to call Dana on Tuesday") from the wrong
 * one ("What sales happen before Thomas? ... don't tell me about Thomas").
 */
/**
 * The operator describing THEIR OWN work — either committing to it in first person ("I need to
 * call Dana on Tuesday") or dictating it in the imperative shorthand the briefing product is built
 * around ("Deliver towels to OPUS LA", "Pick up from the dry cleaners at 9").
 *
 * This — not a downstream parser finding schedulable nouns — is what may authorize a Day Line
 * proposal. It requires an actual WORK verb, which is precisely why the 2026-09-20 failure is
 * excluded: "What sales happen before Thomas? ... don't tell me about Thomas" contains no work
 * verb at all ("tell" is a speech act aimed at Claire, not work), so it can never mint a task.
 */
const FIRST_PERSON_COMMITMENT = new RegExp(
  [
    String.raw`\b(?:i|we)\s+(?:need\s+to|have\s+to|gotta|got\s+to|must|should|will|'ll|plan\s+to|want\s+to|am\s+going\s+to|'m\s+going\s+to|'re\s+going\s+to)\s+\w+`,
    String.raw`\b(?:i'm|i\s+am|we're|we\s+are)\s+\w+ing\b`,
    String.raw`\b(?:tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b[^.!?]{0,40}\b(?:i|we)\s+(?:'m|am|'ll|will|have|need|got)\b`,
  ].join("|"),
  "i"
);

/**
 * A clause that is NOT a question and contains a real work verb. Position is deliberately not the
 * test: "before noon for the KITH pickup and at 7 deliver the OPUS towels" is genuine dictated
 * work even though it opens with a time. What excludes the 2026-09-20 failure is stronger — that
 * utterance contains no work verb anywhere outside its questions ("tell" is a speech act aimed at
 * Claire, not work), so it cannot mint a task under any phrasing.
 */
function hasWorkClause(text: string): boolean {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .some(sentence => {
      const clause = sentence.trim();
      if (!clause || /\?\s*$/.test(clause)) return false;
      return containsBriefingAction(clause);
    });
}

export function detectOperatorWorkCommitment(text: string): boolean {
  if (FIRST_PERSON_COMMITMENT.test(text) && containsBriefingAction(text)) return true;
  return hasWorkClause(text);
}

/** A bare acknowledgement closes a beat. It is not a question, a challenge, or work. */
const ACKNOWLEDGEMENT =
  /^(?:ok(?:ay)?|got\s+it|gotcha|understood|i(?:'m|\s+am)\s+(?:all\s+)?good|we'?re\s+good|sure|yeah|yep|yup|right|cool|fine|nice|great|perfect|thanks?|thank\s+you|that\s+answers\s+it|makes\s+sense|no\s+worries)[.!]?$/i;

const QUESTION_MARK = /\?/;
const BUSINESS_QUESTION_LEAD =
  /\b(?:what|how\s+(?:much|many)|who|when|which|did|does|do|is|are|was|were|has|have)\b/i;

export type InterpretTurnOptions = {
  /**
   * Retained for callers/telemetry only. NEVER read when deciding `mayProposeWork` — see the note
   * there. Kept as a named field so the prohibition is explicit rather than implicit.
   */
  extractedWorkItems?: number;
};

export function interpretTurn(utterance: string, options: InterpretTurnOptions = {}): InterpretedTurn {
  const text = utterance.trim();
  const intents: TurnIntentKind[] = [];

  const callControl = detectCallControl(text);
  if (callControl === "end") intents.push("call_control");

  const acknowledgement = ACKNOWLEDGEMENT.test(text);
  const actionRefused = ACTION_REFUSAL.test(text);
  const correction = CORRECTION.test(text);
  const aboutClaireCapability = ABOUT_CLAIRE_CAPABILITY.test(text);
  const hasExplicitActionRequest = ACTION_DIRECTIVE.test(text) && !actionRefused;
  const operatorWorkCommitment = detectOperatorWorkCommitment(text) && !actionRefused;
  const hasBusinessQuestion =
    !acknowledgement && (QUESTION_MARK.test(text) || BUSINESS_QUESTION_LEAD.test(text.split(/\s+/).slice(0, 4).join(" ")));

  const cardinality = parseCardinality(text);
  const correctnessChallenge = CORRECTNESS_CHALLENGE.test(text) && !acknowledgement;
  const queryRefinement = QUERY_REFINEMENT.test(text) && !acknowledgement && !correctnessChallenge;
  const businessJudgment = BUSINESS_JUDGMENT.test(text) && !acknowledgement;
  const broadOperationalBriefing = BROAD_OPERATIONAL_BRIEFING.test(text.trim()) && !businessJudgment;
  const temporalReference = TEMPORAL_REFERENCE.exec(text)?.[1]?.toLowerCase() ?? null;
  const listRequest = Boolean(cardinality && cardinality > 1) || (LIST_NOUN.test(text) && !acknowledgement);
  const anchorMatch = ANCHOR.exec(text);
  const exclusionMatch = EXCLUSION.exec(text);
  const excluded = properNoun(exclusionMatch?.[1]);
  const exclusions = excluded ? [excluded] : [];
  const anchorEntity = properNoun(anchorMatch?.[1]);

  if (acknowledgement) intents.push("acknowledgement");
  if (actionRefused) intents.push("action_refusal");
  if (correction) intents.push("correction");
  if (hasExplicitActionRequest) intents.push("action_request");
  if (operatorWorkCommitment && !hasExplicitActionRequest) intents.push("operator_work_commitment");
  if (queryRefinement) intents.push("query_refinement");
  if (correctnessChallenge) intents.push("prior_claim_challenge");
  if (businessJudgment) intents.push("business_judgment");
  if (hasBusinessQuestion) intents.push("business_question");
  if (aboutClaireCapability && !hasExplicitActionRequest) intents.push("context_statement");

  /**
   * POSITIVE ACTION INTENT REQUIRED — BY CONSTRUCTION.
   *
   * `options.extractedWorkItems` is deliberately NOT consulted. The previous pass used it to grant
   * authority while claiming the opposite invariant, which is how "What sales happen before Thomas?
   * ... don't tell me about Thomas" became "Got it. For today: Hartmann, don't tell me about
   * Thomas". Work may be proposed only when the operator issued a directive, or committed to their
   * own work. A downstream parser finding schedulable nouns can never reach this decision.
   */
  const mayProposeWork =
    !actionRefused &&
    !correction &&
    !aboutClaireCapability &&
    !acknowledgement &&
    callControl !== "end" &&
    (hasExplicitActionRequest || operatorWorkCommitment);

  return {
    intents,
    callControl,
    mayProposeWork,
    actionRefused,
    correction,
    aboutClaireCapability,
    hasBusinessQuestion,
    hasExplicitActionRequest,
    operatorWorkCommitment,
    acknowledgement,
    cardinality,
    listRequest,
    queryRefinement,
    exclusions,
    anchorEntity,
    correctnessChallenge,
    businessJudgment,
    broadOperationalBriefing,
    temporalReference,
  };
}
