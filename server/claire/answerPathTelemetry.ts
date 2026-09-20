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
  "prior_claim_verification", // server-adjudicated recheck of a prior factual claim (provenance/claimReceipts.ts)
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
 * Slice A census / telemetry only — never routing authority. The live
 * router is `decideClaireAnswerRoute` in answerRouter.ts, which requires a
 * typed `fullyAnswers` bit rather than these phrase lists.
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
   * Not measurable without a token stream. Slice F records this when
   * `invokeTextLLM` is called with `onFirstToken`. True first-audio timing
   * still needs a media stream, which this deployment does not have.
   */
  firstTokenMs: number | null;
};

export type ClairePromptSizeTrace = {
  path: "follow_up" | "opening_brief" | "encyclopedia_rewrite";
  totalChars: number;
  /** Per-section character counts. Counts only — no prompt text is persisted. */
  sections: Array<{ label: string; chars: number }>;
};

/** Inspectable record of a prior-claim verification turn. Labels and counts only. */
export type ClairePriorClaimTrace = {
  receiptId: string;
  resolvedClaireTurn: number;
  originalAnswerPath: string;
  originalGrounding: string;
  claimType: string;
  outcome: string;
  evidenceChanged: boolean | null;
  freshnessAffected: boolean;
  resolution: "receipt_only" | "fresh_query" | "not_attempted";
  presentation: "deterministic" | "guard_replacement";
  latencyMs: number;
  classifierMs: number | null;
  timedOut: boolean;
};

/** Receipt summary mirrored into answer-path detail so a claim is reconstructable from telemetry. */
export type ClaireClaimReceiptTrace = {
  id: string;
  claimType: string;
  grounding: string;
  reader: string | null;
  metric: string | null;
  periodLabel: string | null;
  evidence: Array<{ source: string; ref: string | null }>;
  fingerprint: string | null;
  asOf: string;
  rechecks: boolean;
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
   * True when Claire's own synthesis produced (or was required to produce)
   * the spoken answer. Set by the router, not by JUDGMENT_CLAUSE.
   */
  synthesisRequired: boolean;
  /**
   * Telemetry label for the router's outcome. `needs_synthesis` is recorded
   * when synthesis ran even though the old regex class said `fact_only` —
   * the census that proves regex is no longer routing authority.
   */
  needs_synthesis: boolean;
  routeOutcome:
    | "deterministic_final"
    | "retrieval_plus_synthesis"
    | "judgment_synthesis_no_retrieval"
    | "unsupported_fact"
    | "briefing_plus_synthesis"
    | null;
  /**
   * Which deterministic sources supplied evidence for a synthesized answer
   * (e.g. "business_reader:query", "account_history"). Empty for a pure
   * judgment question that needed no record at all — see item D5: general
   * professional judgment must not be rejected merely because no DB tool
   * applies, and must not require one to run.
   */
  evidenceSources: string[];
  claimReceipt: ClaireClaimReceiptTrace | null;
  priorClaim: ClairePriorClaimTrace | null;
  /** "unavailable" when the challenge classifier timed out or failed; the structural guard still applies. */
  priorClaimClassifier: "probe" | "not_probe" | "unavailable" | null;
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
    needs_synthesis: false,
    routeOutcome: null,
    evidenceSources: [],
    claimReceipt: null,
    priorClaim: null,
    priorClaimClassifier: null,
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
 * Telemetry-only answer classes, built on the Slice A clause detectors.
 * MUST NOT be used to decide whether a reader may terminate a turn.
 * Live routing is `decideClaireAnswerRoute`.
 */
export type ClaireAnswerClass =
  | "fact_only"
  | "judgment"
  | "blended"
  /** Synthesis ran even though the old regex class said fact_only. */
  | "needs_synthesis";

export function classifyClaireAnswerClass(utterance: string): ClaireAnswerClass {
  const blend = classifyClaireBlend(utterance);
  if (!blend.judgmentClause) return "fact_only";
  return blend.factClause ? "blended" : "judgment";
}

/** Telemetry helper. Not routing authority. */
export function claireAnswerClassNeedsSynthesis(answerClass: ClaireAnswerClass): boolean {
  return answerClass !== "fact_only";
}

export function telemetryClaireAnswerClass(utterance: string, didSynthesize: boolean): ClaireAnswerClass {
  const classified = classifyClaireAnswerClass(utterance);
  if (didSynthesize && classified === "fact_only") return "needs_synthesis";
  return classified;
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
