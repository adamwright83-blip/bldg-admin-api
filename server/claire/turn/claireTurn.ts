import { businessToday } from "../../analytics/businessPeriods";
import { getDashboardTimeZone } from "../../dashboardZoned";
import type { DayDirectorProposal } from "../../../shared/dayDirector";
import { classifyIntentHeuristics, detectAvoidanceDisclosure, extractConversationalFieldOutcome, looksLikeKnowledgeSeeking } from "../../../shared/claireRuntime";
import { confirmTomorrowUtterance } from "../../../shared/claireWorkday";
import { looksLikeCancelRequest, looksLikeEditRequest } from "../../../shared/goldlineDayLine";
import { ENV } from "../../_core/env";
import { answerClaireBusinessTurn, looksLikeWorkRequest, type ClaireAnalyticsState, type ClaireBusinessTurnDeps } from "../businessConversation";
import { isCombineRequest, normalizeUtterance } from "../business/businessLanguage";
import { getClaireCampaignSummary } from "../campaignAwareness";
import type { ClaireDriveContext } from "../contextAssembler";
import { assembleGuardedClaireSpeak, buildClaireVerifiedFactInventory } from "../verifiedFactInventoryFromContext";
import { getProgressionStore } from "../progression/drizzleStore";
import { isClaireProgressionEnabled } from "../progression/progressionFlag";
import { commitPendingDisclosuresForConversation } from "../progression/service";
import { answerClairePreDriveFollowUp } from "../preDriveConversation";
import { detectConfirmation, handleVoiceCommitmentTurn, type PendingProposalState, type VoiceCommitmentTurnResult } from "../voiceCommitmentLoop";
import { commitBriefing, loadExistingWork, matchExistingWork, reconcileBriefing, speakBriefingCommit } from "../briefing/briefingCommit";
import { briefingClock, dayMention, parseTiming } from "../briefing/briefingTiming";
import type { BriefingItem, ParsedBriefing } from "../briefing/briefingTypes";
import { parseBriefingDeterministically } from "../briefing/deterministicBriefing";
import { extractBriefingWithModel } from "../briefing/llmBriefing";
import { briefingAdditions, speakBriefingSummary } from "../briefing/speakBriefing";
import { reviseBriefing } from "../briefing/reviseBriefing";
import {
  commitAccountFollowUp,
  followUpDayIntent,
  proposeAccountFollowUp,
  speakAccountFollowUpCommit,
  speakAccountFollowUpProposal,
  type PendingAccountFollowUp,
} from "../knowledge/accountActions";
import {
  accountAspect,
  isAccountQuestion,
  listAccountRefs,
  loadAccountHistory,
  matchAccounts,
  speakAccountHistory,
  type AccountRef,
} from "../knowledge/accountKnowledge";
import { loadBusinessVocabulary } from "../knowledge/businessVocabulary";
import { operatorTurnsBetween, searchOperatorConversation, substantiveTurns } from "../knowledge/conversationMemory";
import { businessDateFor, loadDayWork, operationsQuestion, speakDayWork } from "../knowledge/operationsKnowledge";
import { isUnpaidQuestion, loadUnpaidOrders, speakUnpaidOrders } from "../knowledge/openOrdersKnowledge";
import { zonedDayStartUtc } from "../../dashboardZoned";
import { addDaysYmd } from "../../analytics/businessPeriods";
import { ensureAdamBoard, explainProactive, handleDoctrineTurn } from "../proactive/boardService";
import {
  beginClaireTurnTrace,
  classifyClaireBlend,
  markClaireAnswerPath,
  telemetryClaireAnswerClass,
  type ClaireAnswerPath,
  type ClaireEncyclopediaTrace,
  type ClaireTurnTrace,
} from "../answerPathTelemetry";
import { persistClaireTurnTrace } from "../answerPathRecorder";
import { explicitDayLineRefusal, explicitTrackingRequest } from "../briefing/titleContract";
import { classifyOpenDialogueAct } from "./dialogueAct";
import { runBusinessQuery } from "../../analytics/businessQuery";
import {
  appendClaimReceipt,
  modelReplyRewritesPriorClaim,
  receiptFromBusinessResult,
  receiptFromReader,
  resolvePriorClaim,
  speakPriorClaimVerification,
  verifyPriorClaim,
  type ClaimGrounding,
  type FactualClaimReceipt,
} from "../provenance/claimReceipts";
import { classifyPriorClaimAct, isChallengeCandidate, type ClassifyPriorClaimAct } from "../provenance/priorClaimChallenge";
import type { MutationReceipt } from "../assertionGuard";
import type { EncyclopediaAnswer } from "../knowledge/encyclopediaAgent";
import {
  MEMORY_QUESTION,
  accountHistoryMayFinish,
  collectClaireLocalFactMatches,
  decideClaireAnswerRoute,
  utteranceHasMultipleAsks,
  type ClaireRouteEvidence,
} from "../answerRouter";

/**
 * One Claire turn, for the phone and the desk alike.
 *
 * Understanding runs in this order, and every path below is read-only until
 * an explicit yes:
 *   1. finish a spoken thought the phone cut off at a pause;
 *   2. resolve anything Claire is waiting on (a briefing, a follow-up move,
 *      a single proposal) — without discarding new content Adam adds;
 *   3. understand the whole utterance as a briefing: completed work, several
 *      pieces of work across days with timing, context, and questions;
 *   4. answer questions from deterministic business truth first (ledger,
 *      Day Line, accounts, unpaid orders, conversation memory), then a
 *      grounded model answer, then the brief-anchored follow-up.
 * Numbers are never written by a model. Writes happen only through the
 * existing Day Director / pipeline services after confirmation.
 */

/** Re-exported so Slice A's tests can read a trace without a second import path. */
export type ClaireTurnTraceForTest = ClaireTurnTrace;

export type ClaireTurnHistoryEntry = { speaker: "operator" | "claire"; text: string; at: number };

export type PendingBriefing = { parsed: ParsedBriefing; createdAt: number };

export type ClaireTurnState = PendingProposalState &
  ClaireAnalyticsState & {
    history?: ClaireTurnHistoryEntry[];
    pendingBriefing?: PendingBriefing | null;
    pendingAccountFollowUp?: PendingAccountFollowUp | null;
    /** A spoken thought the phone cut off at a pause ("Desired timing is."). */
    pendingFragment?: string | null;
    /** How many silent continuation gathers have been used for the current thought. */
    fragmentHolds?: number;
    /** Raw Twilio SpeechResult pieces for the in-progress thought (evidence; not ledger turns). */
    providerFragments?: string[];
    focusAccount?: AccountRef | null;
    consecutiveEmptyTranscripts?: number;
    proactiveMorning?: boolean;
    /** Factual-claim receipts for this conversation (durable with the rest of the turn state). */
    claimReceipts?: FactualClaimReceipt[];
    /** Count of Claire's spoken turns, so a receipt can name the turn that produced it. */
    claireTurnCount?: number;
  };

export type ClaireTurnInput = {
  tenantId: string;
  /** The authenticated operator (openId). */
  operatorUserId: string;
  /** The id Day Director commitments are keyed by (numeric user id). */
  dayDirectorActorId: string;
  surface: "voice" | "text";
  utterance: string;
  state: ClaireTurnState;
  conversationKey: string;
  brief?: string | null;
  context?: ClaireDriveContext | null;
  /** False flushes a held phone fragment as a complete thought (the caller went quiet). */
  allowFragmentWait?: boolean;
  /**
   * Slice A (routing audit): when the turn actually began for the operator —
   * for voice, the moment Twilio's webhook arrived, which is the closest
   * observable proxy for end-of-speech. Defaults to turn entry. Telemetry
   * only; nothing in the turn reads it back.
   */
  turnStartedAtMs?: number;
};

export type ClaireTurnResult = {
  speak: string;
  kind:
    | "listening"
    | "briefing_proposed"
    | "briefing_saved"
    | "briefing_declined"
    | "follow_up_proposed"
    | "follow_up_saved"
    | "answered"
    | "commitment"
    | "follow_up";
  listenOnly?: boolean;
  /** A personal turn closed the personal thread AND business is complete AND an authored exit exists: hang up after speaking. */
  endCall?: boolean;
  commitmentTurn?: VoiceCommitmentTurnResult;
  actionIds?: string[];
  mutationReceipts?: MutationReceipt[];
  /** Deterministic `speakBriefingCommit` (or equivalent) — linted against receipts, not conversational inventory. */
  receiptBackedCommit?: string;
};

export type ClaireTurnDeps = {
  now: () => Date;
  timeZone: () => string;
  business: Partial<ClaireBusinessTurnDeps>;
  commitment: typeof handleVoiceCommitmentTurn;
  confirmPlan?: () => Promise<void>;
  followUp: typeof answerClairePreDriveFollowUp;
  extractModel: typeof extractBriefingWithModel | null;
  loadExisting: typeof loadExistingWork;
  commit: typeof commitBriefing;
  campaign: typeof getClaireCampaignSummary;
  vocabulary: typeof loadBusinessVocabulary;
  accounts: typeof listAccountRefs;
  accountHistory: typeof loadAccountHistory;
  commitFollowUp: typeof commitAccountFollowUp;
  dayWork: typeof loadDayWork;
  unpaid: typeof loadUnpaidOrders;
  searchMemory: typeof searchOperatorConversation;
  memoryBetween: typeof operatorTurnsBetween;
  encyclopedia: ((input: { tenantId: string; operatorUserId: string; utterance: string; surface: "voice" | "text"; history: ClaireTurnHistoryEntry[]; context?: ClaireDriveContext | null; onTrace?: (trace: ClaireEncyclopediaTrace) => void }) => Promise<EncyclopediaAnswer>) | null;
  watchBoard?: (input: { tenantId: string; operatorUserId: string; actorId: string }) => Promise<{ brief: string }>;
  doctrineTurn?: (input: { tenantId: string; operatorUserId: string; utterance: string; today: string }) => Promise<string | null>;
  /**
   * Slice A (routing audit): the completed per-turn trace, handed back before
   * it is persisted. Present so the routing audit is testable without a
   * database; production leaves it unset.
   */
  onTurnTrace?: (trace: ClaireTurnTrace) => void;
  /** Semantic recognition of "operator probes the prior factual claim". Labels the act only. */
  classifyPriorClaim: ClassifyPriorClaimAct;
  /** Authoritative re-read used to re-verify a prior claim. */
  rerunBusinessQuery: (tenantId: string, query: import("../../analytics/businessQuery").BusinessQuery) => Promise<import("../../analytics/businessQuery").BusinessQueryResult>;
  /** Live-turn budget for a fresh recheck. */
  priorClaimBudgetMs?: number;
};

export function defaultClaireTurnDeps(): ClaireTurnDeps {
  return {
    now: () => new Date(),
    timeZone: getDashboardTimeZone,
    business: {},
    commitment: handleVoiceCommitmentTurn,
    followUp: answerClairePreDriveFollowUp,
    extractModel: ENV.anthropicApiKey?.trim() ? extractBriefingWithModel : null,
    loadExisting: loadExistingWork,
    commit: commitBriefing,
    campaign: getClaireCampaignSummary,
    vocabulary: loadBusinessVocabulary,
    accounts: listAccountRefs,
    accountHistory: loadAccountHistory,
    commitFollowUp: commitAccountFollowUp,
    dayWork: loadDayWork,
    unpaid: loadUnpaidOrders,
    searchMemory: searchOperatorConversation,
    memoryBetween: operatorTurnsBetween,
    encyclopedia: null,
    watchBoard: ({ tenantId, operatorUserId, actorId }) => ensureAdamBoard({ tenantId, operatorUserId, actorId }),
    doctrineTurn: handleDoctrineTurn,
    classifyPriorClaim: classifyPriorClaimAct,
    rerunBusinessQuery: (tenantId, query) => runBusinessQuery(tenantId, query),
  };
}

const HISTORY_LIMIT = 16;
const PENDING_BRIEFING_TTL_MS = 20 * 60 * 1000;

function remember(state: ClaireTurnState, speaker: "operator" | "claire", text: string, at: number): void {
  if (!text.trim()) return;
  state.history = [...(state.history ?? []), { speaker, text: text.slice(0, 1_200), at }].slice(-HISTORY_LIMIT);
}

/**
 * Continuation grace. Twilio's `speechTimeout:"auto"` closes a recognition on any natural pause of about a
 * second, so a long thought arrives in pieces ("…won't be in." / "So perhaps…"). Answering the first piece
 * talks over the speaker (barge-in then cancels the reply and swallows his next words). The old check
 * (`looksUnfinished`) only caught a transcript ending on a dangling function word, so complete-sounding
 * fragments ("…won't be in", "…When you hear me say", "…bedroom floor") were answered mid-thought.
 *
 * Rule: a SHORT answer or a QUESTION ends the turn at once (no added delay). Any longer statement is held
 * silently for a short grace period; each continuation is re-evaluated, so a multi-pause explanation is
 * answered once, after the thought is actually finished.
 */
export const CONTINUATION_HOLD_MIN_WORDS = 7;
/** Safety valves so a rambling speaker is never held forever. */
export const CONTINUATION_MAX_HOLDS = 5;
export const CONTINUATION_MAX_WORDS = 150;

const INTERROGATIVE_OPENER =
  /^(?:and |so |okay |ok |well |then )?(?:what|what's|whats|who|who's|which|when|where|why|how|do|does|did|is|are|was|were|can|could|would|will|should|have|has|tell me|remind me)\b/i;

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export function shouldHoldForContinuation(
  utterance: string,
  context: { awaitingReply?: boolean } = {}
): boolean {
  const text = utterance.trim();
  const words = wordCount(text);
  if (words < 2) return false;
  if (looksUnfinished(text)) return true;
  if (words > CONTINUATION_MAX_WORDS) return false;
  if (/[?]\s*$/.test(text)) return false;
  if (INTERROGATIVE_OPENER.test(text)) return false;
  if (words < CONTINUATION_HOLD_MIN_WORDS) return false;
  if (context.awaitingReply && words <= 12 && replyDecision(text).decision !== "other") return false;
  return true;
}

/** A phone transcript that stops mid-thought ("Desired timing is.", "and then I"). */
export function looksUnfinished(utterance: string): boolean {
  const text = utterance.trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 2) return false;
  return /\b(?:is|are|was|were|the|a|an|to|for|and|then|at|with|of|from|my|his|her|their|so|but|because|like|um|uh|need|have|going)\s*[.,]?$/i.test(text);
}

export type ReplyDecision = { decision: "yes" | "no" | "other"; remainder: string };

/**
 * Yes/no to something Claire is holding. A short clear reply decides it;
 * a leading "yes, and also…" decides it and keeps the rest; anything longer
 * is new content, never silently read as a no because it contains "no longer".
 */
export function replyDecision(utterance: string): ReplyDecision {
  const text = utterance.trim();
  if (/^(no longer|no contact|no decision|no one|nobody)\b/i.test(text)) {
    return { decision: "other", remainder: text };
  }
  const lead = /^(yes|yeah|yep|yup|sure|correct|do it|go ahead|please do|sounds good|perfect|that's right|that works|add (?:it|them|those|all of (?:it|them))|put (?:it|them) on|save it|confirm(?:ed)?)\b[,.!]*\s*/i.exec(text);
  if (lead) {
    let remainder = text.slice(lead[0].length);
    for (let i = 0; i < 4; i += 1) {
      const next = remainder
        .replace(/^(?:(?:and|also|plus|then)\s+)+/i, "")
        .replace(/^(?:add (?:it|them|those|that)(?: all)?|put (?:it|them|those) on(?: the day ?line)?|do it|go ahead|please|save (?:it|them))\b[,.!]*\s*/i, "")
        .replace(/^(?:that's right|that is right|that one|that's the one|that works|right|okay|ok)\b[,.!]*\s*/i, "")
        .trim();
      if (next === remainder.trim()) break;
      remainder = next;
    }
    return { decision: "yes", remainder: remainder.trim() };
  }
  const no = /^(no|nope|nah|don't|do not|cancel|never ?mind|forget it|scratch that|not now|not yet|no thanks)\b[,.!]*\s*/i.exec(text);
  if (no) {
    let remainder = text.slice(no[0].length).trim();
    if (/^(?:not now|thanks(?: claire)?|thank you)[.!]*$/i.test(remainder)) remainder = "";
    return { decision: "no", remainder };
  }
  if (wordCount(text) <= 4) {
    const decision = detectConfirmation(text);
    if (decision !== "ambiguous") return { decision, remainder: "" };
  }
  return { decision: "other", remainder: text };
}

function isShortReply(utterance: string): boolean {
  return utterance.trim().split(/\s+/).filter(Boolean).length <= 5;
}

/** A question is never an answer to "should I add that?". */
function looksLikeQuestion(utterance: string): boolean {
  return looksLikeKnowledgeSeeking(utterance);
}

function proposalAsItem(proposal: DayDirectorProposal, today: string, minutesNow: number): BriefingItem {
  const day = dayMention(proposal.sourceText, today)?.ymd ?? today;
  return {
    kind: "new_work",
    title: proposal.title,
    quote: proposal.sourceText,
    businessDate: day,
    timing: parseTiming(proposal.sourceText, { isToday: day === today, minutesNow }).timing,
    quantity: proposal.quantity,
    people: [],
    place: null,
    needs: null,
    existing: null,
  };
}

function singleIntentFlow(utterance: string): boolean {
  if (looksLikeQuestion(utterance)) return false;
  return Boolean(
    looksLikeCancelRequest(utterance) ||
      looksLikeEditRequest(utterance) ||
      classifyIntentHeuristics(utterance) ||
      extractConversationalFieldOutcome(utterance) ||
      detectAvoidanceDisclosure(utterance) ||
      confirmTomorrowUtterance(utterance)
  );
}

/**
 * Exported for Slice A's route probe: the phrasings that reach cross-call memory.
 * Defined in answerRouter.ts so routing and the probe share one matcher.
 */
export { MEMORY_QUESTION } from "../answerRouter";

export async function runClaireTurn(input: ClaireTurnInput, overrides: Partial<ClaireTurnDeps> = {}): Promise<ClaireTurnResult> {
  // A new turn on this call means the previous line was actually spoken: that is the delivery
  // boundary at which a pending personal reveal is committed (fragment disclosed, entitlement consumed).
  if (isClaireProgressionEnabled(input.tenantId)) {
    await commitPendingDisclosuresForConversation(getProgressionStore(), { tenantId: input.tenantId, conversationId: input.conversationKey });
  }
  const deps: ClaireTurnDeps = { ...defaultClaireTurnDeps(), ...overrides };
  const now = deps.now();
  const nowMs = now.getTime();
  const timeZone = deps.timeZone();
  const clock = briefingClock(now, timeZone);
  const today = businessToday(now, timeZone);
  const { state } = input;

  let utterance = input.utterance.trim();
  if (input.surface === "voice" && input.allowFragmentWait !== false) {
    const incoming = utterance;
    if (incoming) {
      state.providerFragments = [...(state.providerFragments ?? []), incoming];
    }
    const combined = state.pendingFragment ? `${state.pendingFragment} ${utterance}`.trim() : utterance;
    const holds = state.fragmentHolds ?? 0;
    const awaitingReply = Boolean(state.pendingBriefing || state.pendingProposal || state.pendingAccountFollowUp);
    if (holds < CONTINUATION_MAX_HOLDS && shouldHoldForContinuation(combined, { awaitingReply })) {
      state.pendingFragment = combined;
      state.fragmentHolds = holds + 1;
      return { speak: "", kind: "listening", listenOnly: true };
    }
    utterance = combined;
    state.pendingFragment = null;
    state.fragmentHolds = 0;
  } else if (state.pendingFragment) {
    if (utterance) state.providerFragments = [...(state.providerFragments ?? []), utterance];
    utterance = `${state.pendingFragment} ${utterance}`.trim();
    state.pendingFragment = null;
    state.fragmentHolds = 0;
  }
  remember(state, "operator", utterance, nowMs);
  /**
   * Claire Intelligence Repair Part 2, Slice A: one trace per turn, recording
   * which of the many answer paths below produced the spoken text. Measurement
   * only — nothing in this file reads the trace back, and persistence is
   * fire-and-forget behind a tenant-scoped flag.
   */
  const trace = beginClaireTurnTrace({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    surface: input.surface,
    // Wall clock, deliberately: latency is measured against real time, not
    // against an injected business clock.
    startedAtMs: input.turnStartedAtMs ?? Date.now(),
  });
  trace.blend = classifyClaireBlend(utterance);
  const mark = (path: ClaireAnswerPath, detail: Parameters<typeof markClaireAnswerPath>[2] = {}) =>
    markClaireAnswerPath(trace, path, detail);
  const markFirstToken = () => {
    if (trace.latency.firstTokenMs == null) {
      trace.latency.firstTokenMs = Date.now() - trace.startedAtMs;
    }
  };
  // Set when a guarded personal turn decided the call should actually end (business complete + an
  // authored exit line exists). Dormant in production until such a line is authored.
  let personalEndCall = false;
  const claireOrdinal = (state.claireTurnCount ?? 0) + 1;
  /** Receipt for the factual claim this turn makes, attached to durable state in `finish`. */
  let pendingReceipt: FactualClaimReceipt | null = null;
  const readerReceipt = (answerPath: string, claimType: string, grounding: ClaimGrounding, sources: string[], answerText: string) => {
    pendingReceipt = receiptFromReader({ conversationKey: input.conversationKey, claireTurnOrdinal: claireOrdinal, nowMs, answerText, answerPath, claimType, grounding, sources });
  };
  const finish = (result: ClaireTurnResult): ClaireTurnResult => {
    const inventory = buildClaireVerifiedFactInventory(input.context);
    const speak = assembleGuardedClaireSpeak({
      conversational: result.speak,
      inventory,
      localTime: input.context?.clock?.localTime ?? null,
      receiptBackedCommit: result.receiptBackedCommit,
      mutationReceipts: result.mutationReceipts,
    });
    const guarded = speak === result.speak ? result : { ...result, speak };
    if (trace.synthesisRequired) {
      trace.needs_synthesis = telemetryClaireAnswerClass(utterance, true) === "needs_synthesis";
    }
    remember(state, "claire", guarded.speak, nowMs);
    state.claireTurnCount = claireOrdinal;
    if (pendingReceipt && guarded.speak) {
      const receipt: FactualClaimReceipt = { ...(pendingReceipt as FactualClaimReceipt), answerText: guarded.speak };
      state.claimReceipts = appendClaimReceipt(state.claimReceipts, receipt);
      trace.claimReceipt = {
        id: receipt.id,
        claimType: receipt.claimType,
        grounding: receipt.grounding,
        reader: receipt.reader,
        metric: receipt.metric,
        periodLabel: receipt.periodLabel,
        evidence: receipt.evidence,
        fingerprint: receipt.fingerprint,
        asOf: receipt.asOf,
        rechecks: receipt.recheck.kind !== "none",
      };
    }
    persistClaireTurnTrace(trace, { turnKind: guarded.kind, spokenText: guarded.speak });
    deps.onTurnTrace?.(trace);
    return personalEndCall ? { ...guarded, endCall: true } : guarded;
  };
  const finishCommitmentTurn = (
    turn: Exclude<VoiceCommitmentTurnResult, { kind: "not_applicable" }>
  ): ClaireTurnResult => {
    const receipt = "mutationReceipt" in turn ? turn.mutationReceipt : undefined;
    const actionId =
      "commitmentId" in turn && turn.commitmentId
        ? turn.commitmentId
        : "sourceId" in turn && turn.sourceId
          ? turn.sourceId
          : null;
    return finish({
      speak: receipt ? "" : turn.speak,
      receiptBackedCommit: receipt ? turn.speak : undefined,
      mutationReceipts: receipt ? [receipt] : undefined,
      kind: "commitment",
      commitmentTurn: turn,
      actionIds: actionId ? [actionId] : [],
    });
  };

  const history = () => (state.history ?? []).map(entry => ({ speaker: entry.speaker, text: entry.text }));
  const lower = normalizeUtterance(utterance);

  const doctrineSpeak = deps.doctrineTurn
    ? await deps.doctrineTurn({ tenantId: input.tenantId, operatorUserId: input.operatorUserId, utterance, today })
    : null;
  if (doctrineSpeak) {
    mark("doctrine");
    return finish({ speak: doctrineSpeak, kind: "answered" });
  }

  const shortCheckIn = utterance.trim().split(/\s+/).filter(Boolean).length <= 8;
  if (
    !state.proactiveMorning &&
    shortCheckIn &&
    /^(?:good )?morning\b|^hey claire\b|^what should i (?:do|know)\b|^what(?:'s| is) the most important\b|^what do i need to know\b/i.test(utterance)
  ) {
    state.proactiveMorning = true;
    if (deps.watchBoard) {
      const board = await deps.watchBoard({
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
        actorId: input.dayDirectorActorId,
      }).catch(() => ({ brief: "" }));
      if (board.brief) {
        mark("proactive_board");
        return finish({ speak: board.brief, kind: "answered" });
      }
    }
  }

  // ── 1b. Prior-claim verification ──────────────────────────────────────────
  // A challenge to something Claire just claimed as fact is adjudicated from the claim's
  // receipt and authoritative evidence — never by free-form generation. Verification fails
  // closed: a timeout leaves the claim unresolved instead of conceding it.
  const holdingSomething = Boolean(state.pendingBriefing || state.pendingProposal || state.pendingAccountFollowUp);
  const priorClaim = holdingSomething ? null : resolvePriorClaim(state.claimReceipts, claireOrdinal);
  if (priorClaim && isChallengeCandidate(utterance, priorClaim)) {
    const classifierStarted = Date.now();
    const probe = await deps.classifyPriorClaim({ tenantId: input.tenantId, utterance, priorAnswer: priorClaim.answerText });
    const classifierMs = Date.now() - classifierStarted;
    trace.priorClaimClassifier = probe === null ? "unavailable" : probe ? "probe" : "not_probe";
    if (probe) {
      const verification = await verifyPriorClaim(priorClaim, {
        rerun: query => deps.rerunBusinessQuery(input.tenantId, query),
        budgetMs: deps.priorClaimBudgetMs,
      });
      recordPriorClaimTrace(verification, "deterministic", classifierMs);
      mark("prior_claim_verification");
      return finish({ speak: speakPriorClaimVerification(verification), kind: "answered" });
    }
  }

  if (/\bwhy (?:is|are|did you|are you)\b/.test(lower)) {
    const why = await explainProactive(input.tenantId, input.operatorUserId, utterance).catch(() => null);
    if (why) {
      mark("doctrine");
      return finish({ speak: why, kind: "answered" });
    }
  }

  // ── 2. What Claire is holding ─────────────────────────────────────────────
  if (state.pendingAccountFollowUp) {
    const reply = replyDecision(utterance);
    const pending = state.pendingAccountFollowUp;
    if (reply.decision === "yes") {
      state.pendingAccountFollowUp = null;
      const commit = await deps.commitFollowUp(pending, {
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
        dayDirectorActorId: input.dayDirectorActorId,
        timeZone,
      });
      mark("account_follow_up");
      const receipts: MutationReceipt[] = [];
      if (commit.pipelineSaved) {
        receipts.push({
          claimedState: "scheduled",
          entityId: pending.followUpId ?? `pipeline-follow-up:${pending.pipelineId ?? "none"}:${pending.requestId}`,
          statement: `Scheduled ${pending.accountName} follow-up for ${pending.dueDate}`,
        });
      }
      if (commit.dayLineSaved && commit.dayLineCommitmentId) {
        receipts.push({
          claimedState: "created",
          entityId: commit.dayLineCommitmentId,
          statement: `Added ${pending.accountName} follow-up to the Day Line`,
        });
      }
      return finish({
        speak: "",
        receiptBackedCommit: speakAccountFollowUpCommit(pending, commit, today),
        mutationReceipts: receipts,
        actionIds: commit.dayLineCommitmentId ? [commit.dayLineCommitmentId] : [],
        kind: "follow_up_saved",
      });
    }
    if (reply.decision === "no") {
      state.pendingAccountFollowUp = null;
      mark("account_follow_up");
      return finish({ speak: "Okay, I won't change it.", kind: "answered" });
    }
    state.pendingAccountFollowUp = null;
  }

  if (state.pendingBriefing && nowMs - state.pendingBriefing.createdAt > PENDING_BRIEFING_TTL_MS) state.pendingBriefing = null;
  if (state.pendingBriefing) {
    const reply = replyDecision(utterance);
    const revisionText =
      reply.decision === "yes" && /^(?:but|except|only|without|minus|and change|change|make)\b/i.test(reply.remainder)
        ? reply.remainder
        : reply.decision === "other"
          ? utterance
          : null;
    if (revisionText) {
      const revision = reviseBriefing(state.pendingBriefing.parsed, revisionText, clock);
      if (revision.changes.length) {
        state.pendingBriefing = { parsed: revision.parsed, createdAt: nowMs };
        const remaining = briefingAdditions(revision.parsed).length;
        mark("briefing");
        return finish({
          speak: `${revision.changes.join(" ")} ${remaining ? "Want me to put the list on the Day Line now?" : "That leaves nothing to add."}`.trim(),
          kind: "briefing_proposed",
        });
      }
    }
    if (reply.decision === "yes" && !revisionText) {
      const pending = state.pendingBriefing.parsed;
      state.pendingBriefing = null;
      const result = await deps.commit(pending, {
        tenantId: input.tenantId,
        dayDirectorActorId: input.dayDirectorActorId,
        conversationKey: input.conversationKey,
      });
      mark("briefing");
      const commitSpeak = speakBriefingCommit(result, today);
      const receipts = result.receipts ?? [];
      if (reply.remainder) {
        const more = await runClaireTurn({ ...input, utterance: reply.remainder, state, allowFragmentWait: false }, overrides);
        return finish({
          speak: more.speak,
          receiptBackedCommit: commitSpeak,
          kind: "briefing_saved",
          actionIds: [...result.commitmentIds, ...(more.actionIds ?? [])],
          mutationReceipts: [...receipts, ...(more.mutationReceipts ?? [])],
        });
      }
      return finish({
        speak: "",
        receiptBackedCommit: commitSpeak,
        kind: "briefing_saved",
        actionIds: result.commitmentIds,
        mutationReceipts: receipts,
      });
    }
    if (reply.decision === "no" || explicitDayLineRefusal(utterance)) {
      state.pendingBriefing = null;
      mark("briefing");
      const remainder = reply.decision === "no" ? reply.remainder : "";
      if (remainder) {
        const more = await runClaireTurn({ ...input, utterance: remainder, state, allowFragmentWait: false }, overrides);
        return finish({
          speak: `Okay, I won't add any of that. ${more.speak}`.trim(),
          kind: more.kind === "listening" ? "briefing_declined" : more.kind,
          actionIds: more.actionIds,
          mutationReceipts: more.mutationReceipts,
        });
      }
      return finish({ speak: "Okay, I won't add any of that.", kind: "briefing_declined" });
    }
  }

  // Something Claire asked about in the established single-item loop.
  const carried: BriefingItem[] = [];
  let heldProposalTitle: string | null = null;
  // The single-item loop classifies with a model; never ask it twice about the same utterance.
  let commitmentTried = false;
  if (state.pendingProposal || state.pendingUpdate || state.pendingFieldCapture || state.pendingEngineeringOffer || state.pendingDayLineChoice || state.clarifyingUtterance) {
    if ((isShortReply(utterance) && !looksLikeQuestion(utterance)) || replyDecision(utterance).decision !== "other") {
      commitmentTried = true;
      const turn = await deps.commitment(
        {
          tenantId: input.tenantId,
          actorId: input.dayDirectorActorId,
          businessDate: today,
          utterance,
          state,
          conversationId: input.conversationKey,
        },
        { confirmPlan: deps.confirmPlan }
      );
      if (turn.kind !== "not_applicable") {
        mark("commitment");
        return finishCommitmentTurn(turn);
      }
    } else {
      // New content while Claire waits: never read it as a yes/no. A stale
      // "are you just catching me up?" question simply lapses.
      state.clarifyingUtterance = null;
      state.pendingDayLineChoice = null;
      heldProposalTitle = state.pendingProposal?.title ?? null;
    }
  }

  // ── 3. A field report with a follow-up instruction for a real account ─────
  const accounts = await deps.accounts(input.tenantId).catch(() => [] as AccountRef[]);
  const mentioned = matchAccounts(lower, accounts);
  const account =
    mentioned.length === 1
      ? mentioned[0]!
      : /\b(?:them|there|that account|that property|they)\b|\bthe follow[- ]?up\b/.test(lower)
        ? state.focusAccount ?? null
        : null;
  const followUpDay = account ? followUpDayIntent(utterance, today) : null;
  if (account && followUpDay) {
    try {
      const historyForAccount = await deps.accountHistory({ tenantId: input.tenantId, operatorUserId: input.operatorUserId, account });
      const pending = proposeAccountFollowUp({ history: historyForAccount, utterance, dueDate: followUpDay.ymd, conversationKey: input.conversationKey });
      state.pendingAccountFollowUp = pending;
      state.focusAccount = account;
      mark("account_follow_up");
      return finish({ speak: speakAccountFollowUpProposal(pending, { today, timeZone }), kind: "follow_up_proposed" });
    } catch (error) {
      console.warn("[Claire] account follow-up proposal failed", error instanceof Error ? error.message : error);
    }
  }

  // ── 4. The whole utterance as a briefing ──────────────────────────────────
  let parsed = parseBriefingDeterministically(utterance, clock);
  const openAct = classifyOpenDialogueAct(utterance);
  const skipBriefing =
    explicitDayLineRefusal(utterance) ||
    ((openAct.kind === "confide" || openAct.kind === "question") && parsed.items.length === 0);
  if (skipBriefing && parsed.items.length) {
    parsed = {
      ...parsed,
      context: [...parsed.context, ...parsed.items.map(item => item.quote)],
      items: [],
    };
  }
  if (state.pendingProposal && parsed.items.length > 0 && heldProposalTitle) {
    // More work arrived while a single proposal was waiting: fold it into the bundle instead of dropping either.
    carried.push(proposalAsItem(state.pendingProposal, today, clock.minutesNow));
    state.pendingProposal = null;
  }
  const businessQuestion = parsed.items.length === 0;
  const multiItem =
    parsed.items.length + carried.length >= 2 ||
    parsed.items.some(item => item.kind === "completed") ||
    parsed.items.some(item => item.businessDate !== today) ||
    (parsed.items.length >= 1 && parsed.questions.length >= 1) ||
    (state.pendingBriefing !== null && state.pendingBriefing !== undefined && parsed.items.length >= 1);
  const singleFlow = !multiItem && parsed.items.length <= 1 && singleIntentFlow(utterance);

  if (!businessQuestion && (multiItem || (!singleFlow && parsed.items.length === 1 && looksLikeWorkRequest(utterance) === false && parsed.items[0]!.kind === "new_work" && carried.length > 0))) {
    const vocabulary = await deps.vocabulary(input.tenantId).catch(() => [] as string[]);
    if (deps.extractModel && (input.surface === "voice" || parsed.unparsed.length > 0)) {
      const model = await deps.extractModel({ tenantId: input.tenantId, utterance, clock, vocabulary, recentTurns: history() });
      if (model && model.items.length >= Math.max(1, parsed.items.length - 1)) {
        parsed = { ...model, questions: model.questions.length ? model.questions : parsed.questions, context: model.context.length ? model.context : parsed.context };
      }
    }
    const earlier = [...(state.pendingBriefing?.parsed.items ?? []), ...carried];
    const combinedItems = [...earlier];
    for (const item of parsed.items) {
      // Only something said on an earlier turn can be a repeat; items in one utterance are distinct by construction.
      const duplicate = earlier.find(existing => existing.businessDate === item.businessDate && matchExistingWork(item, [{ id: "x", title: existing.title, businessDate: existing.businessDate, status: "open" }]));
      if (duplicate) {
        if (item.timing.kind !== "none") duplicate.timing = item.timing;
        continue;
      }
      combinedItems.push(item);
    }
    const dates = Array.from(new Set(combinedItems.map(item => item.businessDate)));
    const [existing, campaign] = await Promise.all([
      deps.loadExisting({ tenantId: input.tenantId, dayDirectorActorId: input.dayDirectorActorId, dates }).catch(() => []),
      deps.campaign({ tenantId: input.tenantId, actorId: input.dayDirectorActorId }).catch(() => null),
    ]);
    const reconciled = reconcileBriefing({ ...parsed, items: combinedItems }, existing, campaign);
    const answers: string[] = [];
    // Mixed work + question: keep retrieved fact wording (ledger amounts stay
    // exact) and synthesize the full original utterance once when judgment
    // remains. Never answerQuestion(..., { allowSynthesis: false }).
    const mixedQuestion = parsed.questions.length > 0 || utteranceHasMultipleAsks(utterance);
    if (mixedQuestion) {
      trace.paused = true;
      try {
        const questionTexts = parsed.questions.filter(questionText => questionText !== utterance);
        let needsSynthesis = questionTexts.length === 0;
        for (const questionText of questionTexts) {
          const localMatches = collectClaireLocalFactMatches(questionText, {
            accounts,
            now,
            timeZone,
            session: state.analytics ?? null,
          });
          const route = decideClaireAnswerRoute({
            utterance: questionText,
            encyclopedia: null,
            localMatches,
            briefingWorkItems: 0,
            briefingQuestions: 0,
          });
          if (route.outcome === "deterministic_final" || route.outcome === "unsupported_fact") {
            const spoken = await answerQuestion(questionText);
            if (spoken) answers.push(spoken);
          } else {
            needsSynthesis = true;
          }
        }
        if (needsSynthesis) {
          const spoken = await answerQuestion(utterance, { briefingMix: true });
          if (spoken) answers.push(spoken);
          trace.routeOutcome = "briefing_plus_synthesis";
          trace.synthesisRequired = true;
        }
      } finally {
        trace.paused = false;
      }
    }
    const summary = speakBriefingSummary({
      parsed: state.pendingBriefing ? { ...reconciled, items: reconciled.items.filter(item => !state.pendingBriefing!.parsed.items.includes(item)) } : reconciled,
      today,
      answers,
      surface: input.surface,
      continuing: Boolean(state.pendingBriefing),
    });
    const addable = briefingAdditions(reconciled).length;
    if (addable && (explicitTrackingRequest(utterance) || openAct.kind === "explicit_track")) {
      const result = await deps.commit(reconciled, {
        tenantId: input.tenantId,
        dayDirectorActorId: input.dayDirectorActorId,
        conversationKey: input.conversationKey,
      });
      if (!result?.commitmentIds) {
        mark("briefing");
        return finish({ speak: "I understood it, but nothing saved. Want me to try again?", kind: "briefing_proposed" });
      }
      state.pendingBriefing = null;
      mark("briefing");
      return finish({
        speak: answers.join(" ").trim(),
        receiptBackedCommit: speakBriefingCommit(result, today),
        kind: "briefing_saved",
        actionIds: result.commitmentIds,
        mutationReceipts: result.receipts ?? [],
      });
    }
    state.pendingBriefing = addable ? { parsed: reconciled, createdAt: nowMs } : null;
    let speak = summary.text;
    if (state.pendingBriefing && !summary.asksConfirmation) speak = `${speak} Want me to put all of it on the Day Line?`;
    mark("briefing");
    return finish({ speak, kind: "briefing_proposed" });
  }

  if (!businessQuestion && !singleFlow && parsed.items.length === 1 && !looksLikeWorkRequest(utterance) && parsed.questions.length === 0) {
    // A single new piece of work goes through the established proposal loop
    // (campaign-aware new-vs-existing classification, NEEDS_DETAILS handling).
  }

  // ── 5. Established single-intent work flows ───────────────────────────────
  // Thread arithmetic ("add them together") uses the verb "add" but is not work.
  if (isCombineRequest(lower) && parsed.items.length <= 1) {
    parsed = { ...parsed, items: [], questions: parsed.questions.length ? parsed.questions : [utterance] };
  }
  if (!commitmentTried && !isCombineRequest(lower) && (singleFlow || (parsed.items.length === 1 && parsed.questions.length === 0))) {
    commitmentTried = true;
    const turn = await deps.commitment(
      { tenantId: input.tenantId, actorId: input.dayDirectorActorId, businessDate: today, utterance, state, conversationId: input.conversationKey },
      { confirmPlan: deps.confirmPlan }
    );
    if (turn.kind !== "not_applicable") {
      mark("commitment");
      return finishCommitmentTurn(turn);
    }
  }

  // ── 6. Questions ──────────────────────────────────────────────────────────
  const answer = await answerQuestion(utterance);
  if (answer) {
    const reminder = state.pendingBriefing
      ? " I'm still holding your list; say yes when you want it on the Day Line."
      : state.pendingProposal
        ? ` I'm still holding "${state.pendingProposal.title}"; say yes to add it.`
        : "";
    return finish({ speak: `${answer}${reminder}`, kind: "answered" });
  }

  if (!commitmentTried && !isCombineRequest(lower) && !parsed.questions.length && !singleFlow && parsed.items.length === 0 && !looksLikeQuestion(utterance)) {
    commitmentTried = true;
    const turn = await deps.commitment(
      { tenantId: input.tenantId, actorId: input.dayDirectorActorId, businessDate: today, utterance, state, conversationId: input.conversationKey },
      { confirmPlan: deps.confirmPlan }
    );
    if (turn.kind !== "not_applicable") {
      mark("commitment");
      return finishCommitmentTurn(turn);
    }
  }

  if (input.context && input.brief) {
    const generationStartedAt = Date.now();
    trace.latency.generationStartMs = generationStartedAt - trace.startedAtMs;
    trace.synthesisRequired = true;
    const reply = await deps.followUp({
      tenantId: input.tenantId,
      utterance,
      brief: input.brief,
      context: input.context,
      recentTurns: history().slice(0, -1),
      conversationId: input.conversationKey,
      onPersonalTurn: personal => {
        if (personal.endCall) personalEndCall = true;
      },
      onFirstToken: markFirstToken,
      // Slice A: the follow-up path already reports how it ended (model,
      // canon recovery, or conservative fallback). Read it rather than
      // guessing from the text.
      onGeneration: diagnostic => {
        trace.modelRequested = diagnostic.modelRequested ?? null;
        trace.modelServed = diagnostic.modelServed ?? null;
        if (diagnostic.promptSize) trace.promptSizes.push(diagnostic.promptSize);
        markClaireAnswerPath(
          trace,
          diagnostic.answerOrigin === "canon_render"
            ? "guard_recovery"
            : diagnostic.source === "model"
              ? "follow_up_model"
              : "fallback",
          { fallbackReason: diagnostic.failureReason }
        );
      },
    });
    trace.latency.generationCompleteMs = Date.now() - trace.startedAtMs;
    // A follow-up that never reported a diagnostic (a stubbed dep in a test)
    // is still attributed rather than left unlabelled.
    mark("follow_up_model");
    return finish({ speak: await finalizeModelReply(reply, []), kind: "follow_up" });
  }
  mark("fallback", { fallbackReason: "no_brief_or_context" });
  return finish({
    speak: "I don't have a record that answers that, so I won't guess. Ask it another way, or tell me which customer, account, or day you mean.",
    kind: "answered",
  });

  /**
   * Existing readers as evidence only — they never claim the turn here.
   * Sources: business query, Day Line, unpaid orders, account history, call memory.
   * Encyclopedia tools are merged in by answerQuestion after the planner runs.
   */
  async function gatherDeterministicEvidence(question: string): Promise<ClaireRouteEvidence[]> {
    const questionLower = normalizeUtterance(question);
    const evidence: ClaireRouteEvidence[] = [];
    const skipGreedyBusiness =
      (isUnpaidQuestion(questionLower) && !/\bfollow[- ]?up\b/.test(questionLower)) ||
      Boolean(operationsQuestion(questionLower)) ||
      MEMORY_QUESTION.test(questionLower) ||
      (question === utterance && parsed.items.length > 0);

    if (!skipGreedyBusiness) {
      try {
        const business = await answerClaireBusinessTurn(
          { tenantId: input.tenantId, utterance: question, state, surface: input.surface, context: input.context },
          { now: deps.now, timeZone: deps.timeZone, ...deps.business }
        );
        if (business.handled) evidence.push({ source: `business_reader:${business.reader ?? "query"}`, text: business.speak, businessResult: business.result, reader: business.reader ?? "query" });
      } catch (error) {
        console.warn("[Claire] business evidence failed", error instanceof Error ? error.message : error);
      }
    }

    const operations = operationsQuestion(questionLower);
    if (operations) {
      try {
        const work = await deps.dayWork({
          tenantId: input.tenantId,
          operatorUserId: input.operatorUserId,
          dayDirectorActorId: input.dayDirectorActorId,
          businessDate: businessDateFor(operations.day, now, timeZone),
          now,
          timeZone,
        });
        evidence.push({ source: "day_work", text: speakDayWork(work, operations, input.surface) });
      } catch (error) {
        console.warn("[Claire] day work evidence unavailable", error instanceof Error ? error.message : error);
      }
    }

    if (isUnpaidQuestion(questionLower) && !/\bfollow[- ]?up\b/.test(questionLower)) {
      try {
        evidence.push({ source: "unpaid_orders", text: speakUnpaidOrders(await deps.unpaid(input.tenantId), input.surface) });
      } catch (error) {
        console.warn("[Claire] unpaid-orders evidence unavailable", error instanceof Error ? error.message : error);
      }
    }

    const questionAccounts = matchAccounts(questionLower, accounts);
    const pronounAccount =
      /\b(?:them|there|that account|that property|that building|they|it)\b/.test(questionLower) ||
      (isAccountQuestion(questionLower) && /\b(?:my last|last contact|follow[- ]?up|visit|what happened|what did i)\b/.test(questionLower))
        ? state.focusAccount ?? null
        : null;
    const target = questionAccounts.length === 1 ? questionAccounts[0]! : questionAccounts.length === 0 ? pronounAccount : null;
    if (target && (isAccountQuestion(questionLower) || questionAccounts.length === 1)) {
      try {
        const accountHistory = await deps.accountHistory({ tenantId: input.tenantId, operatorUserId: input.operatorUserId, account: target });
        state.focusAccount = target;
        const aspect = MEMORY_QUESTION.test(questionLower) ? "said" : accountAspect(questionLower);
        evidence.push({ source: "account_history", text: speakAccountHistory(accountHistory, aspect, { timeZone, today }) });
      } catch (error) {
        console.warn("[Claire] account-history evidence unavailable", error instanceof Error ? error.message : error);
      }
    }

    if (MEMORY_QUESTION.test(questionLower)) {
      trace.memorySearched = true;
      try {
        const yesterday = /\byesterday\b/.test(questionLower);
        const turns = yesterday
          ? substantiveTurns(
              await deps.memoryBetween({
                tenantId: input.tenantId,
                operatorUserId: input.operatorUserId,
                startUtc: zonedDayStartUtc(addDaysYmd(today, -1), timeZone),
                endExclusiveUtc: zonedDayStartUtc(today, timeZone),
              })
            )
          : substantiveTurns(
              await deps.searchMemory({
                tenantId: input.tenantId,
                operatorUserId: input.operatorUserId,
                terms: questionLower
                  .replace(MEMORY_QUESTION, " ")
                  .split(/\s+/)
                  .filter(word => word.length >= 4 && !["about", "that", "with", "what", "last", "time", "when", "there"].includes(word)),
                speaker: "OPERATOR",
              })
            );
        if (turns.length) {
          const quotes = turns.slice(0, 2).map(turn => `"${turn.text.replace(/\s+/g, " ").slice(0, 160)}"`);
          evidence.push({
            source: "call_memory",
            text: `${yesterday ? "Yesterday" : "On a call"} you said ${quotes.join(", and ")}. That's what you told me, not something I've confirmed.`,
          });
        }
      } catch (error) {
        console.warn("[Claire] call-memory evidence unavailable", error instanceof Error ? error.message : error);
      }
    }

    return evidence;
  }

  /**
   * Claire Intelligence Repair Part 2, Slice C+D (item C): hands the
   * operator's FULL original question, plus whatever evidence was gathered,
   * to Claire's own repaired conversational path — never a split or
   * truncated question, and never a deterministic renderer's partial
   * sentence standing in as the whole answer. Returns null (not a guess)
   * when there is no drive context/brief to synthesize with, so the caller's
   * existing safety net still applies.
   */
  async function synthesizeWithEvidence(
    question: string,
    evidence: Array<{ source: string; text: string }>
  ): Promise<string | null> {
    if (!(input.context && input.brief)) return null;
    trace.synthesisRequired = true;
    trace.evidenceSources = evidence.map(item => item.source);
    const reply = await deps.followUp({
      tenantId: input.tenantId,
      utterance: question,
      brief: input.brief,
      context: input.context,
      recentTurns: history().slice(0, -1),
      retrievedEvidence: evidence.length ? evidence : undefined,
      conversationId: input.conversationKey,
      onPersonalTurn: personal => {
        if (personal.endCall) personalEndCall = true;
      },
      onFirstToken: markFirstToken,
      onGeneration: diagnostic => {
        trace.modelRequested = diagnostic.modelRequested ?? null;
        trace.modelServed = diagnostic.modelServed ?? null;
        if (diagnostic.promptSize) trace.promptSizes.push(diagnostic.promptSize);
        markClaireAnswerPath(
          trace,
          diagnostic.answerOrigin === "canon_render"
            ? "guard_recovery"
            : diagnostic.source === "model"
              ? "follow_up_model"
              : "fallback",
          { fallbackReason: diagnostic.failureReason }
        );
      },
    });
    mark("follow_up_model");
    return finalizeModelReply(reply, evidence.map(item => item.source));
  }

  function recordPriorClaimTrace(
    verification: Awaited<ReturnType<typeof verifyPriorClaim>>,
    presentation: "deterministic" | "guard_replacement",
    classifierMs: number | null
  ): void {
    trace.priorClaim = {
      receiptId: verification.receipt.id,
      resolvedClaireTurn: verification.receipt.claireTurnOrdinal,
      originalAnswerPath: verification.receipt.answerPath,
      originalGrounding: verification.receipt.grounding,
      claimType: verification.receipt.claimType,
      outcome: verification.outcome,
      evidenceChanged: verification.evidenceChanged,
      freshnessAffected: verification.freshnessAffected,
      resolution: verification.resolution,
      presentation,
      latencyMs: verification.latencyMs,
      classifierMs,
      timedOut: verification.timedOut,
    };
  }

  /**
   * Structural invariant: a free-form model reply may not change the epistemic status of a
   * prior grounded claim. If a model-generated reply re-characterises a recent claim (made
   * up, invented, guessed, lied…), the reply is discarded and replaced by the server's
   * adjudication of that claim's receipt. The lexical check only *detects* the attempt; the
   * replacement is what enforces the invariant. Returns null when the reply is untouched.
   */
  async function rewriteAttemptReplacement(reply: string): Promise<string | null> {
    if (!modelReplyRewritesPriorClaim(reply)) return null;
    const prior = resolvePriorClaim(state.claimReceipts, claireOrdinal);
    if (!prior) return null;
    const verification = await verifyPriorClaim(prior, {
      rerun: query => deps.rerunBusinessQuery(input.tenantId, query),
      budgetMs: deps.priorClaimBudgetMs,
    });
    recordPriorClaimTrace(verification, "guard_replacement", null);
    return speakPriorClaimVerification(verification);
  }

  /** Runs after a model turn: enforce the invariant, then leave a receipt for what the model claimed. */
  async function finalizeModelReply(reply: string, evidenceSources: string[]): Promise<string> {
    const replacement = await rewriteAttemptReplacement(reply);
    if (replacement) return replacement;
    if (evidenceSources.length) {
      readerReceipt(trace.path ?? "follow_up_model", "retrieved_statement", "retrieved", evidenceSources, reply);
    } else if (/\d/.test(reply)) {
      // A figure with no evidence behind it is recorded as ungrounded so a later challenge is
      // answered as "unsupported" from the receipt, not defended.
      readerReceipt(trace.path ?? "follow_up_model", "ungrounded_statement", "ungrounded", [], reply);
    }
    return reply;
  }

  async function answerQuestion(question: string, options: { briefingMix?: boolean } = {}): Promise<string | null> {
    const questionLower = normalizeUtterance(question);
    const multipleAsks = utteranceHasMultipleAsks(question);
    const briefingWorkItems = options.briefingMix ? Math.max(1, parsed.items.length) : 0;
    const briefingQuestions = options.briefingMix ? Math.max(parsed.questions.length, 1) : 0;

    const questionAccounts = matchAccounts(questionLower, accounts);
    if (questionAccounts.length > 1 && !multipleAsks && !options.briefingMix) {
      mark("account_disambiguation");
      return `I have ${questionAccounts.length} accounts that could be: ${questionAccounts.slice(0, 4).map(item => item.name).join(", ")}. Which one?`;
    }

    const localMatches = collectClaireLocalFactMatches(question, {
      accounts,
      now,
      timeZone,
      session: state.analytics ?? null,
    });
    const canFastTerminate =
      !options.briefingMix && !multipleAsks && localMatches.some(match => match.mayTerminate);

    let encyclopediaResult: EncyclopediaAnswer | null = null;
    let encyclopediaTrace: ClaireEncyclopediaTrace | null = null;
    if (!canFastTerminate && deps.encyclopedia) {
      try {
        encyclopediaResult = await deps.encyclopedia({
          tenantId: input.tenantId,
          operatorUserId: input.operatorUserId,
          utterance: question,
          surface: input.surface,
          history: state.history ?? [],
          context: input.context,
          onTrace: value => {
            encyclopediaTrace = value;
          },
        });
        if (encyclopediaTrace) {
          trace.encyclopedia = encyclopediaTrace;
          if ((encyclopediaTrace as ClaireEncyclopediaTrace).toolsPlanned.includes("call_memory")) {
            trace.memorySearched = true;
          }
        }
      } catch (error) {
        console.warn("[Claire] encyclopedia answer failed", error instanceof Error ? error.message : error);
      }
    }

    const loadedEvidence: ClaireRouteEvidence[] = [];
    if (encyclopediaResult?.kind !== "no_retrieval_needed") {
      loadedEvidence.push(...(await gatherDeterministicEvidence(question)));
      if (encyclopediaResult && (encyclopediaResult.kind === "answered" || encyclopediaResult.kind === "unsupported_fact")) {
        for (const item of encyclopediaResult.evidence) {
          if (!loadedEvidence.some(existing => existing.source === item.source && existing.text === item.text)) {
            loadedEvidence.push(item);
          }
        }
      }
    }

    const decision = decideClaireAnswerRoute({
      utterance: question,
      encyclopedia: encyclopediaResult,
      localMatches,
      loadedEvidence,
      briefingWorkItems,
      briefingQuestions,
      multipleAsks,
    });
    if (!trace.paused) trace.routeOutcome = decision.outcome;

    const evidenceForSynthesis = decision.evidence.filter(item => item.text.length > 0);

    if (decision.outcome === "deterministic_final") {
      if (encyclopediaResult?.kind === "answered" && encyclopediaResult.fullyAnswers === true) {
        mark("encyclopedia", { encyclopedia: encyclopediaTrace });
        return encyclopediaResult.text;
      }
      const unpaid = loadedEvidence.find(entry => entry.source === "unpaid_orders");
      if (unpaid) {
        mark("unpaid_orders");
        readerReceipt("unpaid_orders", "unpaid_orders", "deterministic", ["unpaid_orders"], unpaid.text);
        return unpaid.text;
      }
      const dayWork = loadedEvidence.find(entry => entry.source === "day_work");
      if (dayWork) {
        mark("day_work");
        readerReceipt("day_work", "day_line_state", "deterministic", ["day_work"], dayWork.text);
        return dayWork.text;
      }
      const account = loadedEvidence.find(entry => entry.source === "account_history");
      if (account && accountHistoryMayFinish(question)) {
        mark("account_history");
        readerReceipt("account_history", "account_history", "deterministic", ["account_history"], account.text);
        return account.text;
      }
      const memory = loadedEvidence.find(entry => entry.source === "call_memory" || entry.source === "memory_quote");
      if (memory) {
        mark("memory_quote");
        return memory.text;
      }
      if (decision.path === "memory_quote") {
        mark("fallback", { fallbackReason: "memory_no_match" });
        return "I don't have that in our call history, so I won't make it up.";
      }
      const business = loadedEvidence.find(entry => entry.source.startsWith("business_reader"));
      if (business) {
        mark("business_reader", { businessReader: business.source.split(":")[1] ?? null });
        if (business.businessResult) {
          pendingReceipt = receiptFromBusinessResult({
            conversationKey: input.conversationKey,
            claireTurnOrdinal: claireOrdinal,
            nowMs,
            answerText: business.text,
            reader: business.reader ?? null,
            result: business.businessResult,
          });
        } else {
          readerReceipt("business_reader", "business_statement", "deterministic", [business.source], business.text);
        }
        return business.text;
      }
    }

    if (decision.outcome === "unsupported_fact") {
      mark("fallback", { fallbackReason: "unsupported_fact", encyclopedia: encyclopediaTrace });
      return decision.unsupportedText ?? (encyclopediaResult?.kind === "unsupported_fact" ? encyclopediaResult.text : null);
    }

    if (
      decision.outcome === "judgment_synthesis_no_retrieval" ||
      decision.outcome === "retrieval_plus_synthesis" ||
      decision.outcome === "briefing_plus_synthesis"
    ) {
      const synthesized = await synthesizeWithEvidence(question, evidenceForSynthesis);
      if (synthesized !== null) return synthesized;
      if (decision.preserveJudgment && decision.unsupportedText) {
        mark("fallback", { fallbackReason: "unsupported_fact", encyclopedia: encyclopediaTrace });
        return decision.unsupportedText;
      }
      return null;
    }

    return null;
  }
}
