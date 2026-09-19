/**
 * Claire Intelligence Repair, Part 2 — Slice A: answer-path instrumentation.
 *
 * Slice A is measurement only. Nothing here changes what Claire says. Its job
 * is to answer one question from production data rather than from reading
 * code: *which* of Claire's many answer paths actually produced the sentence
 * the operator heard, and how often the repaired conversational path
 * (`follow_up_model`) is reached at all.
 *
 * A trace is opened once per turn in `runClaireTurn`, mutated as the turn
 * walks the routing ladder, and persisted once at the end. Persistence is
 * best-effort and fail-open: a telemetry failure must never change or delay
 * an answer on a live phone call.
 */

/**
 * Every code path that can produce the text spoken to the operator.
 *
 * `renderer prose` (the paths marked below) means the spoken sentence was
 * produced by a deterministic `speak*` function and returned verbatim, having
 * bypassed Claire's character, relationship canon, and the repaired
 * conversational prompt entirely. Slice C exists to remove those from the
 * normal path; Slice A exists to size them first.
 */
export const CLAIRE_ANSWER_PATHS = [
  "business_reader", // renderer prose (server/claire/business/businessSpeech.ts)
  "day_work", // renderer prose (speakDayWork)
  "unpaid_orders", // renderer prose (speakUnpaidOrders)
  "account_history", // renderer prose (speakAccountHistory)
  "account_disambiguation", // hand-written sentence in claireTurn.ts
  "memory_quote", // hand-written sentence in claireTurn.ts
  "encyclopedia", // tool concatenation, or a capped rewrite of it
  "commitment", // the Day Director single-item loop
  "briefing", // speakBriefingSummary / speakBriefingCommit
  "account_follow_up", // speakAccountFollowUpProposal / Commit
  "doctrine", // proactive/boardService
  "proactive_board", // proactive/boardService morning brief
  "follow_up_model", // the repaired conversational path (PR 1)
  "guard_recovery", // a guard discarded model text; canon rendered instead
  "fallback", // conservativeClaireFollowUp, or the no-record sentence
  "listening", // held fragment; nothing spoken
] as const;

export type ClaireAnswerPath = (typeof CLAIRE_ANSWER_PATHS)[number];

/**
 * The answer paths whose spoken text is a deterministic renderer's sentence,
 * returned to the operator verbatim. This is the number Slice C has to drive
 * to zero on the normal path.
 */
export const RENDERER_PROSE_PATHS: ReadonlySet<ClaireAnswerPath> = new Set<ClaireAnswerPath>([
  "business_reader",
  "day_work",
  "unpaid_orders",
  "account_history",
  "encyclopedia",
]);

export type ClaireEncyclopediaSpoken =
  | "rewrite"
  | "raw_concatenation"
  | "missing_explanation"
  | "declined"
  /**
   * Claire Intelligence Repair Part 2, Slice C+D: the planner decided no
   * Goldline record would materially help (a judgment/strategy question, or
   * a fact clause a record already covered another way) and, per the
   * architecture fix, spoke nothing — Claire's own synthesis answers instead.
   * Never a refusal.
   */
  | "no_retrieval_needed";

export type ClaireEncyclopediaTrace = {
  toolsPlanned: string[];
  spoke: ClaireEncyclopediaSpoken | null;
  /** Why the rewrite did not run, when it did not. */
  rewriteSkippedReason: "single_tool" | "deadline" | "ungrounded_numbers" | "rewrite_failed" | null;
  planMs: number | null;
  toolMs: number | null;
  rewriteMs: number | null;
  /** Assembled system-prompt size of the capped rewrite, characters. */
  rewritePromptChars: number | null;
};

/**
 * Heuristic classification of a turn that asks for both a record and a
 * judgment ("what happened at The Louise last time, and what should I do?").
 * It is a heuristic, not a parser: Slice A reports it as an estimate.
 */
export type ClaireBlendTrace = {
  factClause: boolean;
  judgmentClause: boolean;
};

export type ClaireLatencyTrace = {
  /** Webhook receipt → route decision (the first path that claimed the turn). */
  routeMs: number | null;
  /** Route decision → the generation call starting. Null when no model ran. */
  generationStartMs: number | null;
  /** Route decision → generation complete. Null when no model ran. */
  generationCompleteMs: number | null;
  /** Webhook receipt → the turn's spoken text being ready. */
  answerReadyMs: number | null;
  /**
   * Webhook receipt → TwiML handed back to Twilio. The closest observable
   * proxy for "first audio spoken"; true first-audio timing needs a media
   * stream, which this deployment does not have.
   */
  twimlMs: number | null;
  /**
   * Not measurable today: `invokeTextLLM` is a non-streaming
   * `messages.create`, so there is no first-token event to record. Recorded
   * as null deliberately rather than silently omitted.
   */
  firstTokenMs: null;
};

export type ClairePromptSizeTrace = {
  path: "follow_up" | "opening_brief" | "encyclopedia_rewrite";
  totalChars: number;
  /** Per-section character counts. Counts only — no prompt text is persisted. */
  sections: Array<{ label: string; chars: number }>;
};

export type ClaireTurnTrace = {
  tenantId: string;
  operatorUserId: string | null;
  surface: "voice" | "text";
  turnKind: string | null;
  path: ClaireAnswerPath | null;
  /** For `business_reader`, which reader inside businessConversation answered. */
  businessReader: string | null;
  rendererProse: boolean;
  fallbackReason: string | null;
  modelRequested: string | null;
  modelServed: string | null;
  encyclopedia: ClaireEncyclopediaTrace | null;
  memorySearched: boolean;
  blend: ClaireBlendTrace | null;
  promptSizes: ClairePromptSizeTrace[];
  latency: ClaireLatencyTrace;
  startedAtMs: number;
  routeDecidedAtMs: number | null;
  spokenChars: number;
  /**
   * True while the turn is answering a question embedded in a briefing. Those
   * sub-answers are not the turn's answer path, so they must not claim it.
   */
  paused: boolean;
  /**
   * Claire Intelligence Repair Part 2, Slice C+D: true when the turn's
   * classification (judgment or blended fact+judgment) required Claire's own
   * synthesis rather than letting a deterministic reader or the encyclopedia
   * terminate the turn with partial or refusal prose. This is the number
   * that answers "did retrieval steal a reasoning-required turn?" — it
   * should be true for every turn Slice A's route probe found landing on a
   * template instead of the repaired conversational path.
   */
  synthesisRequired: boolean;
  /**
   * Which deterministic sources supplied evidence for a synthesized answer
   * (e.g. "business_reader:query", "account_history"). Empty for a pure
   * judgment question that needed no record at all — see item D5: general
   * professional judgment must not be rejected merely because no DB tool
   * applies, and must not require one to run.
   */
  evidenceSources: string[];
};

export function beginClaireTurnTrace(input: {
  tenantId: string;
  operatorUserId: string | null;
  surface: "voice" | "text";
  startedAtMs: number;
}): ClaireTurnTrace {
  return {
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    surface: input.surface,
    turnKind: null,
    path: null,
    businessReader: null,
    rendererProse: false,
    fallbackReason: null,
    modelRequested: null,
    modelServed: null,
    encyclopedia: null,
    memorySearched: false,
    blend: null,
    promptSizes: [],
    latency: {
      routeMs: null,
      generationStartMs: null,
      generationCompleteMs: null,
      answerReadyMs: null,
      twimlMs: null,
      firstTokenMs: null,
    },
    startedAtMs: input.startedAtMs,
    routeDecidedAtMs: null,
    spokenChars: 0,
    paused: false,
    synthesisRequired: false,
    evidenceSources: [],
  };
}

/** Record which path claimed the turn. The first call wins, as routing does. */
export function markClaireAnswerPath(
  trace: ClaireTurnTrace | null,
  path: ClaireAnswerPath,
  detail: Partial<Pick<ClaireTurnTrace, "businessReader" | "fallbackReason" | "encyclopedia" | "modelRequested">> = {},
  nowMs = Date.now()
): void {
  if (!trace || trace.path || trace.paused) return;
  trace.path = path;
  trace.rendererProse = RENDERER_PROSE_PATHS.has(path);
  trace.routeDecidedAtMs = nowMs;
  trace.latency.routeMs = nowMs - trace.startedAtMs;
  if (detail.businessReader !== undefined) trace.businessReader = detail.businessReader;
  if (detail.fallbackReason !== undefined) trace.fallbackReason = detail.fallbackReason;
  if (detail.encyclopedia !== undefined) trace.encyclopedia = detail.encyclopedia;
  if (detail.modelRequested !== undefined) trace.modelRequested = detail.modelRequested;
}

const FACT_CLAUSE =
  /\b(how (?:much|many|long)|what (?:did|was|were|is|are) (?:the|my|our|they|he|she|it|we|i)\b|when (?:did|is|was)|who (?:did|is|was)|last (?:time|visit|order|call)|revenue|orders?|customers?|unpaid|invoice|balance|paid|status|on the day line|scheduled|history)\b/i;
const JUDGMENT_CLAUSE =
  /\b(what should (?:i|we)|should (?:i|we)\b|what would you|how (?:should|do) (?:i|we)|what do you think|any (?:advice|ideas)|is it worth|worth (?:it|doing)|recommend|how would you|what's the (?:best|smart)|make sense to)\b/i;

/**
 * True for a turn that asks for a record *and* for a judgment. Used for the
 * Slice A blend census (item 8) and for the Slice D fixture.
 */
export function classifyClaireBlend(utterance: string): ClaireBlendTrace {
  return {
    factClause: FACT_CLAUSE.test(utterance),
    judgmentClause: JUDGMENT_CLAUSE.test(utterance),
  };
}

export function isBlendedClaireQuestion(utterance: string): boolean {
  const blend = classifyClaireBlend(utterance);
  return blend.factClause && blend.judgmentClause;
}

/**
 * Claire Intelligence Repair Part 2, Slice C+D: the explicit answer classes
 * the router distinguishes, built on the same two clause detectors as the
 * Slice A blend census rather than a second, competing classifier.
 *
 * `unsupported_fact` and `deterministic_fact` are not decided here — they
 * describe an *outcome* (whether a record actually answered or came back
 * empty), not something knowable from the utterance alone. This function
 * answers the one question the utterance itself can answer: does this turn
 * need Claire's own synthesis, or can a deterministic reader still be the
 * final word?
 */
export type ClaireAnswerClass =
  /** No judgment clause: a deterministic reader may terminate the turn directly. */
  | "fact_only"
  /** A judgment clause with no factual anchor: general professional judgment. Never gated on a DB tool. */
  | "judgment"
  /** Both clauses present: retrieve the fact half, then Claire synthesizes one answer to the whole utterance. */
  | "blended";

export function classifyClaireAnswerClass(utterance: string): ClaireAnswerClass {
  const blend = classifyClaireBlend(utterance);
  if (!blend.judgmentClause) return "fact_only";
  return blend.factClause ? "blended" : "judgment";
}

/** True for any class that requires Claire's own synthesis rather than a deterministic renderer. */
export function claireAnswerClassNeedsSynthesis(answerClass: ClaireAnswerClass): boolean {
  return answerClass !== "fact_only";
}

/** Character counts for an assembled prompt, per section. Counts only. */
export function measureClairePromptSections(
  path: ClairePromptSizeTrace["path"],
  sections: Array<{ label: string; text: string | null | undefined }>,
  joiner = " "
): ClairePromptSizeTrace {
  const present = sections.filter(section => Boolean(section.text?.length));
  const measured = present.map(section => ({ label: section.label, chars: section.text!.length }));
  const totalChars =
    measured.reduce((sum, section) => sum + section.chars, 0) +
    Math.max(0, present.length - 1) * joiner.length;
  return { path, totalChars, sections: measured };
}
