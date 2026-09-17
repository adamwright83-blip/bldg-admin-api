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
import { buildClaireVerifiedFactInventory, sanitizeSpeakAgainstInventory } from "../verifiedFactInventoryFromContext";
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

export type ClaireTurnHistoryEntry = { speaker: "operator" | "claire"; text: string; at: number };

export type PendingBriefing = { parsed: ParsedBriefing; createdAt: number };

export type ClaireTurnState = PendingProposalState &
  ClaireAnalyticsState & {
    history?: ClaireTurnHistoryEntry[];
    pendingBriefing?: PendingBriefing | null;
    pendingAccountFollowUp?: PendingAccountFollowUp | null;
    /** A spoken thought the phone cut off at a pause ("Desired timing is."). */
    pendingFragment?: string | null;
    focusAccount?: AccountRef | null;
    consecutiveEmptyTranscripts?: number;
    proactiveMorning?: boolean;
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
  commitmentTurn?: VoiceCommitmentTurnResult;
  actionIds?: string[];
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
  encyclopedia: ((input: { tenantId: string; operatorUserId: string; utterance: string; surface: "voice" | "text"; history: ClaireTurnHistoryEntry[] }) => Promise<string | null>) | null;
  watchBoard?: (input: { tenantId: string; operatorUserId: string; actorId: string }) => Promise<{ brief: string }>;
  doctrineTurn?: (input: { tenantId: string; operatorUserId: string; utterance: string; today: string }) => Promise<string | null>;
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
  };
}

const HISTORY_LIMIT = 16;
const PENDING_BRIEFING_TTL_MS = 20 * 60 * 1000;

function remember(state: ClaireTurnState, speaker: "operator" | "claire", text: string, at: number): void {
  if (!text.trim()) return;
  state.history = [...(state.history ?? []), { speaker, text: text.slice(0, 1_200), at }].slice(-HISTORY_LIMIT);
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
  const words = text.split(/\s+/).filter(Boolean).length;
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
  const no = /^(no|nope|nah|don't|do not|cancel|never ?mind|forget it|scratch that|not now)\b[,.!]*\s*/i.exec(text);
  if (no && words <= 6) return { decision: "no", remainder: "" };
  if (words <= 4) {
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

const MEMORY_QUESTION =
  /\bwhat did (?:i|we) (?:say|tell you|talk about|decide|agree)\b|\bwhat was i (?:worried|concerned|stressed|thinking) about\b|\bwhat did you tell me\b|\bdid i (?:mention|tell you)\b|\bwhat have i told you\b/;

export async function runClaireTurn(input: ClaireTurnInput, overrides: Partial<ClaireTurnDeps> = {}): Promise<ClaireTurnResult> {
  const deps: ClaireTurnDeps = { ...defaultClaireTurnDeps(), ...overrides };
  const now = deps.now();
  const nowMs = now.getTime();
  const timeZone = deps.timeZone();
  const clock = briefingClock(now, timeZone);
  const today = businessToday(now, timeZone);
  const { state } = input;

  let utterance = input.utterance.trim();
  if (state.pendingFragment) {
    utterance = `${state.pendingFragment} ${utterance}`.trim();
    state.pendingFragment = null;
  } else if (input.surface === "voice" && input.allowFragmentWait !== false && looksUnfinished(utterance)) {
    state.pendingFragment = utterance;
    return { speak: "", kind: "listening", listenOnly: true };
  }
  remember(state, "operator", utterance, nowMs);
  const finish = (result: ClaireTurnResult): ClaireTurnResult => {
    const inventory = buildClaireVerifiedFactInventory(input.context);
    const speak = sanitizeSpeakAgainstInventory(result.speak, inventory);
    const guarded = speak === result.speak ? result : { ...result, speak };
    remember(state, "claire", guarded.speak, nowMs);
    return guarded;
  };
  const history = () => (state.history ?? []).map(entry => ({ speaker: entry.speaker, text: entry.text }));
  const lower = normalizeUtterance(utterance);

  const doctrineSpeak = deps.doctrineTurn
    ? await deps.doctrineTurn({ tenantId: input.tenantId, operatorUserId: input.operatorUserId, utterance, today })
    : null;
  if (doctrineSpeak) return finish({ speak: doctrineSpeak, kind: "answered" });

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
      if (board.brief) return finish({ speak: board.brief, kind: "answered" });
    }
  }

  if (/\bwhy (?:is|are|did you|are you)\b/.test(lower)) {
    const why = await explainProactive(input.tenantId, input.operatorUserId, utterance).catch(() => null);
    if (why) return finish({ speak: why, kind: "answered" });
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
      return finish({ speak: speakAccountFollowUpCommit(pending, commit, today), kind: "follow_up_saved" });
    }
    if (reply.decision === "no") {
      state.pendingAccountFollowUp = null;
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
      let speak = speakBriefingCommit(result, today);
      if (reply.remainder) {
        const more = await runClaireTurn({ ...input, utterance: reply.remainder, state }, overrides);
        speak = `${speak} ${more.speak}`.trim();
        return { speak, kind: "briefing_saved", actionIds: result.commitmentIds };
      }
      return finish({ speak, kind: "briefing_saved", actionIds: result.commitmentIds });
    }
    if (reply.decision === "no") {
      state.pendingBriefing = null;
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
        return finish({ speak: turn.speak, kind: "commitment", commitmentTurn: turn, actionIds: "commitmentId" in turn && turn.commitmentId ? [turn.commitmentId] : [] });
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
      return finish({ speak: speakAccountFollowUpProposal(pending, { today, timeZone }), kind: "follow_up_proposed" });
    } catch (error) {
      console.warn("[Claire] account follow-up proposal failed", error instanceof Error ? error.message : error);
    }
  }

  // ── 4. The whole utterance as a briefing ──────────────────────────────────
  let parsed = parseBriefingDeterministically(utterance, clock);
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
    for (const question of parsed.questions) {
      const answer = await answerQuestion(question);
      if (answer) answers.push(answer);
    }
    const summary = speakBriefingSummary({
      parsed: state.pendingBriefing ? { ...reconciled, items: reconciled.items.filter(item => !state.pendingBriefing!.parsed.items.includes(item)) } : reconciled,
      today,
      answers,
      surface: input.surface,
      continuing: Boolean(state.pendingBriefing),
    });
    const addable = briefingAdditions(reconciled).length;
    state.pendingBriefing = addable ? { parsed: reconciled, createdAt: nowMs } : null;
    let speak = summary.text;
    if (state.pendingBriefing && !summary.asksConfirmation) speak = `${speak} Want me to put all of it on the Day Line?`;
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
      return finish({ speak: turn.speak, kind: "commitment", commitmentTurn: turn, actionIds: "commitmentId" in turn && turn.commitmentId ? [turn.commitmentId] : [] });
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
      return finish({ speak: turn.speak, kind: "commitment", commitmentTurn: turn, actionIds: "commitmentId" in turn && turn.commitmentId ? [turn.commitmentId] : [] });
    }
  }

  if (input.context && input.brief) {
    const reply = await deps.followUp({
      tenantId: input.tenantId,
      utterance,
      brief: input.brief,
      context: input.context,
      recentTurns: history().slice(0, -1),
    });
    return finish({ speak: reply, kind: "follow_up" });
  }
  return finish({
    speak: "I don't have a record that answers that, so I won't guess. Ask it another way, or tell me which customer, account, or day you mean.",
    kind: "answered",
  });

  async function answerQuestion(question: string): Promise<string | null> {
    const questionLower = normalizeUtterance(question);
    try {
      const business = await answerClaireBusinessTurn(
        { tenantId: input.tenantId, utterance: question, state, surface: input.surface },
        { now: deps.now, timeZone: deps.timeZone, ...deps.business }
      );
      if (business.handled) return business.speak;
    } catch (error) {
      console.warn("[Claire] business answer failed", error instanceof Error ? error.message : error);
    }

    const operations = operationsQuestion(questionLower);
    if (operations) {
      try {
        const day = operations.kind === "completed" ? operations.day : operations.day;
        const work = await deps.dayWork({
          tenantId: input.tenantId,
          operatorUserId: input.operatorUserId,
          dayDirectorActorId: input.dayDirectorActorId,
          businessDate: businessDateFor(day, now, timeZone),
          now,
          timeZone,
        });
        return speakDayWork(work, operations, input.surface);
      } catch (error) {
        console.warn("[Claire] day work unavailable", error instanceof Error ? error.message : error);
        return "I couldn't load the Day Line just now, so I won't guess what's on it.";
      }
    }

    if (isUnpaidQuestion(questionLower) && !/\bfollow[- ]?up\b/.test(questionLower)) {
      try {
        return speakUnpaidOrders(await deps.unpaid(input.tenantId), input.surface);
      } catch {
        return "I couldn't load unpaid orders just now, so I won't guess.";
      }
    }

    const questionAccounts = matchAccounts(questionLower, accounts);
    const pronounAccount =
      /\b(?:them|there|that account|that property|that building|they|it)\b/.test(questionLower) ||
      (isAccountQuestion(questionLower) && /\b(?:my last|last contact|follow[- ]?up|visit|what happened|what did i)\b/.test(questionLower))
        ? state.focusAccount ?? null
        : null;
    const target = questionAccounts.length === 1 ? questionAccounts[0]! : questionAccounts.length === 0 ? pronounAccount : null;
    if (questionAccounts.length > 1) {
      return `I have ${questionAccounts.length} accounts that could be: ${questionAccounts.slice(0, 4).map(item => item.name).join(", ")}. Which one?`;
    }
    if (target && (isAccountQuestion(questionLower) || MEMORY_QUESTION.test(questionLower) || questionAccounts.length === 1)) {
      try {
        const accountHistory = await deps.accountHistory({ tenantId: input.tenantId, operatorUserId: input.operatorUserId, account: target });
        state.focusAccount = target;
        const aspect = MEMORY_QUESTION.test(questionLower) ? "said" : accountAspect(questionLower);
        return speakAccountHistory(accountHistory, aspect, { timeZone, today });
      } catch (error) {
        console.warn("[Claire] account history unavailable", error instanceof Error ? error.message : error);
        return `I couldn't load ${target.name}'s history just now, so I won't guess.`;
      }
    }

    if (MEMORY_QUESTION.test(questionLower)) {
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
        if (!turns.length) return "I don't have that in our call history, so I won't make it up.";
        const quotes = turns.slice(0, 2).map(turn => `"${turn.text.replace(/\s+/g, " ").slice(0, 160)}"`);
        return `${yesterday ? "Yesterday" : "On a call"} you said ${quotes.join(", and ")}. That's what you told me, not something I've confirmed.`;
      } catch {
        return "I couldn't search our call history just now.";
      }
    }

    if (deps.encyclopedia) {
      try {
        const answer = await deps.encyclopedia({
          tenantId: input.tenantId,
          operatorUserId: input.operatorUserId,
          utterance: question,
          surface: input.surface,
          history: state.history ?? [],
        });
        if (answer) return answer;
      } catch (error) {
        console.warn("[Claire] encyclopedia answer failed", error instanceof Error ? error.message : error);
      }
    }
    return null;
  }
}
