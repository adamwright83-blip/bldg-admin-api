/**
 * Brain V2 PRIMARY — the newest Claire answers every turn.
 *
 * For an authorized operator with `CLAIRE_BRAIN_V2_PRIMARY` on, this function is
 * the whole conversational turn on both the phone and the Claire Desk. Legacy
 * Claire (`runClaireTurn`) is not called. It only observes, read-only, in the
 * background (`legacyShadow.ts`).
 *
 * What V2 owns here:
 *   - voice thought assembly (when a spoken fragment is complete enough to act on);
 *   - interpretation (Perception) and every decision (Executive Function):
 *     retrieval, business facts, prior-claim rechecks, ordered-query follow-ups,
 *     strategic frames, Day Line grants, pending confirm/reject, call control;
 *   - the choice of what is said (ResponsePlan) and how it is composed.
 *
 * Existing reliable services are reused, never re-decided:
 *   - the grant-bound Day Line / briefing adapter (receipts and readback);
 *   - the weekly planning session service (executes V2's weekly intent);
 *   - Claire's guarded speaking organ (`answerClairePreDriveFollowUp`): character
 *     canon, the fact inventory, the personal-disclosure controller, biography
 *     verification. V2 hands it V2's own decision and V2's own evidence; it phrases.
 *   - Daphne V2 ingestion, explicit preference capture, and consent-filtered
 *     operator memory (`loadDaphneClaireGuidance` honours `memory_recall` and
 *     `adaptation_enabled`);
 *   - the post-generation assertion guard and claim receipts.
 *
 * Failure policy: a V2 failure is answered by V2 ("I lost that thought…"). It is
 * never silently handed to legacy Claire. The emergency rollback is the flag:
 * `CLAIRE_BRAIN_V2_PRIMARY=0` returns both surfaces to the previous routing.
 */

import { isCompanyViewEvidencePayload } from "../../../analytics/laundryFarmCompanyView";
import { isClaireRoleFeedback } from "../../../../shared/claireRoleFeedback";
import { parseStrategicProposalControl } from "../../../../shared/strategicProposalControl";
import { weekStartMonday } from "../../../../shared/weeklyMissionReadiness";
import type { ClaireDriveContext } from "../../contextAssembler";
import {
  CONTINUATION_MAX_HOLDS,
  conversationHistoryForModel,
  looksUnfinished,
  shouldHoldForContinuation,
  type ClaireTurnHistoryEntry,
  type ClaireTurnResult,
  type ClaireTurnState,
} from "../../turn/claireTurn";
import { detectConversationControl } from "../../turn/interpretTurn";
import { explicitTrackingRequest } from "../../briefing/titleContract";
import { answerClairePreDriveFollowUp, conservativeClaireFollowUp } from "../../preDriveConversation";
import {
  assembleGuardedClaireSpeak,
  buildClaireVerifiedFactInventory,
} from "../../verifiedFactInventoryFromContext";
import { inventoryPlusReceipts } from "../../assertionGuard";
import {
  appendClaimReceipt,
  receiptFromBusinessResult,
  receiptFromReader,
  type FactualClaimReceipt,
} from "../../provenance/claimReceipts";
import { coveredThisCallLines } from "../../provenance/callCoverage";
import { claireRookContactResidueSection, type ClaireRookContactResidueContext } from "../../rookContactResidueContext";
import type { BusinessQueryResult } from "../../../analytics/businessQuery";
import { planBusinessQuestionWithLLM } from "../../businessConversation";
import type { ExecutiveActionGrant } from "../contracts/grants";
import type { EvidenceItem } from "../contracts/evidence";
import type { ExecutiveDecision } from "../contracts/executiveDecision";
import type { ResponseSegment } from "../contracts/responsePlan";
import { runClaireBrainTurn, type ClaireBrainTurnResult } from "../shadow/runClaireBrainTurn";
import { liveExecutiveDeps, type ShadowRetrievalContext } from "../shadow/observeShadowTurn";
import { updateShadowMemory, type ShadowMemory } from "../shadow/shadowMemory";
import type { BusinessQueryPlanner, LiveRetrievalDeps } from "../executive/decide";
import { readOnlyWorkingMemorySource } from "../shadow/v1Snapshot";
import { periodMatches, requestedPeriod } from "../executive/requestedPeriod";
import {
  brainV2CallControlResult,
  executeGrantBoundLegacyAdapter,
} from "./grantBoundLegacyAdapter";
import { guardCommittedDayLineResult } from "./runClaireBrainV2LiveTurn";
import {
  interpretSemanticPerception,
  refinePerception,
  type SemanticInterpreter,
  type SemanticReading,
} from "../perception/semanticPerception";
import { observeLegacyClaireDetached, type LegacyShadowDeps, type V2DecisionSummary } from "./legacyShadow";
import type { ClaireOperatorAuthority } from "./operatorAuthority";
import type { DaphneClaireGuidance } from "../../../agents/daphne/claireAdapter";
import type { DaphneExplicitPreferenceCaptureResult } from "../../../agents/daphne/explicitPreferenceCorrection";
import type { ShowrunnerCallState } from "../../showrunner/showrunnerTurn";

export const BRAIN_V2_PRIMARY_VERSION = "claire-brain-v2-primary-1";

export function isClaireBrainV2PrimaryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.CLAIRE_BRAIN_V2_PRIMARY?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "on";
}

/** V2's own working memory, carried in the durable conversation state. */
export type ClaireV2PrimaryState = ClaireTurnState & {
  brainV2Memory?: ShadowMemory | null;
  weeklyPlanningWeekStart?: string | null;
  sessionKind?: string | null;
  /** Present on scheduled morning-readiness / evening-debrief calls. */
  showrunner?: ShowrunnerCallState | null;
};

export type ClaireV2Composition =
  | "listening"
  | "action"
  | "call_control"
  | "preference"
  | "weekly"
  | "showrunner"
  | "deterministic"
  | "composed"
  | "recovery";

/** Proof of origin carried on every primary result. */
export type ClaireV2Provenance = {
  origin: "brain_v2";
  version: typeof BRAIN_V2_PRIMARY_VERSION;
  composition: ClaireV2Composition;
  actionClasses: string[];
  lanes: string[];
  businessIntent: string;
  evidenceReaders: string[];
  daphneGuidance: boolean;
  /** V2's semantic reading of the turn, when the perception organ answered. */
  semanticTurnKind: SemanticReading["turnKind"] | null;
  legacyConsulted: false;
};

export type ClaireV2PrimaryResult = ClaireTurnResult & { brainV2: ClaireV2Provenance };

export type ClaireV2PrimaryInput = {
  authority: Extract<ClaireOperatorAuthority, { authorized: true }>;
  tenantId: string;
  operatorUserId: string;
  dayDirectorActorId: string;
  surface: "voice" | "text";
  utterance: string;
  state: ClaireV2PrimaryState;
  conversationKey: string;
  /** Daphne / retrieval conversation identity (call id or Desk conversation id). */
  conversationId: string;
  timeZone: string;
  businessDate: string;
  brief?: string | null;
  context?: ClaireDriveContext | null;
  sourceEventId?: string;
  sourceConfirmed?: boolean;
  /** False flushes a held phone fragment as a complete thought. */
  allowFragmentWait?: boolean;
  rookContactResidues?: readonly ClaireRookContactResidueContext[];
};

type SpeakingOrgan = typeof answerClairePreDriveFollowUp;

export type ClaireV2PrimaryDeps = {
  now: () => Date;
  speak: SpeakingOrgan;
  /** Brain V2 semantic perception. Null keeps deterministic perception only. */
  interpretPerception: SemanticInterpreter | null;
  planBusinessQuery: BusinessQueryPlanner | undefined;
  liveDeps?: LiveRetrievalDeps;
  executeGrant: (grant: ExecutiveActionGrant, state: ClaireV2PrimaryState) => Promise<ClaireTurnResult>;
  routeWeekly: (input: {
    utterance: string;
    intent: "weekly_continue" | "weekly_lock" | "weekly_cancel";
    state: ClaireV2PrimaryState;
  }) => Promise<{ speak: string; receiptBackedCommit?: string; mutationReceipts?: ClaireTurnResult["mutationReceipts"]; actionIds?: string[]; presentedRecommendation?: { proposalId: string; revision: string } } | null>;
  beginWeekly: () => Promise<string>;
  ingestDaphne: (input: { utterance: string; turnId: string; completed: boolean }) => Promise<unknown>;
  capturePreference: (input: { utterance: string; turnId: string }) => Promise<DaphneExplicitPreferenceCaptureResult>;
  loadDaphneGuidance: () => Promise<DaphneClaireGuidance | null>;
  commitPendingDisclosures: () => Promise<void>;
  /**
   * The scheduled-call conductor (morning readiness, evening debrief). V2 runs
   * it only for a non-work, non-decisive turn of a scheduled session; it carries
   * that call's agenda and records the operator's reports.
   */
  showrunner?: (input: {
    state: ShowrunnerCallState;
    history: Array<{ speaker: string; text: string }>;
    utterance: string;
    sourceEventId: string;
  }) => Promise<{ state: ShowrunnerCallState; end: boolean; speak: string }>;
  legacyShadow?: LegacyShadowDeps | null;
};

const HISTORY_LIMIT = 32;
const FACT_INTENTS = new Set([
  "fact_question",
  "list_query",
  "query_refinement",
  "query_requery",
  "correctness_challenge",
  "provenance_question",
]);
const EXPLICIT_WEEKLY_CONTROL =
  /\b(?:weekly plan|plan the week|review the week|look at the week|back to (?:the )?week|back to weekly planning|lock the week|that(?:'s| is) the week|forget the week|stop planning)\b/i;

const LEAVES_WEEKLY_INTERVIEW = new Set<SemanticReading["turnKind"]>([
  "business_fact_question",
  "business_list_question",
  "daily_briefing_request",
  "challenge_prior_claim",
  "ask_source_of_prior_claim",
  "personal_question_to_claire",
  "leave_taking",
]);

export const V2_RECOVERY_SPEECH = "Sorry, I lost that thought. Say it once more?";

function remember(
  state: ClaireV2PrimaryState,
  speaker: "operator" | "claire",
  text: string,
  at: number,
  delivery?: ClaireTurnHistoryEntry["delivery"]
): void {
  if (!text.trim()) return;
  state.history = [
    ...(state.history ?? []),
    { speaker, text: text.slice(0, 1_200), at, ...(delivery ? { delivery } : {}) },
  ].slice(-HISTORY_LIMIT);
}

type Assembly =
  | { kind: "hold"; combined: string }
  | { kind: "release"; utterance: string; completeness: "complete" | "forced_flush"; durable: boolean };

/** Voice thought assembly — the same holding rules the phone has always used. */
export function assembleV2Thought(input: {
  surface: "voice" | "text";
  utterance: string;
  state: ClaireV2PrimaryState;
  allowFragmentWait?: boolean;
  sourceConfirmed?: boolean;
}): Assembly {
  const { state } = input;
  const incoming = input.utterance.trim();
  if (input.surface !== "voice") {
    return { kind: "release", utterance: incoming, completeness: "complete", durable: input.sourceConfirmed !== false };
  }
  const allowWait = input.allowFragmentWait !== false;
  if (incoming && (allowWait || state.pendingFragment)) {
    state.providerFragments = [...(state.providerFragments ?? []), incoming];
  }
  let held = state.pendingFragment?.trim() ?? "";
  if (incoming && held && looksUnfinished(held) && (explicitTrackingRequest(incoming) || detectConversationControl(incoming))) {
    held = "";
    state.pendingFragment = null;
    state.fragmentHolds = 0;
  }
  const combined = held ? `${held} ${incoming}`.trim() : incoming;
  const holds = state.fragmentHolds ?? 0;
  const awaitingReply = Boolean(state.pendingBriefing || state.pendingProposal || state.pendingAccountFollowUp);
  const unfinished = Boolean(combined) && looksUnfinished(combined);
  const graceHold = allowWait && shouldHoldForContinuation(combined, { awaitingReply });
  const holdIncomplete = unfinished && holds < CONTINUATION_MAX_HOLDS;
  if (combined && holds < CONTINUATION_MAX_HOLDS && (graceHold || holdIncomplete)) {
    state.pendingFragment = combined;
    state.fragmentHolds = holds + 1;
    return { kind: "hold", combined };
  }
  const budgetSpent = holds >= CONTINUATION_MAX_HOLDS && (unfinished || shouldHoldForContinuation(combined, { awaitingReply }));
  state.pendingFragment = null;
  state.fragmentHolds = 0;
  return {
    kind: "release",
    utterance: combined,
    completeness: !allowWait || budgetSpent ? "forced_flush" : "complete",
    durable: input.sourceConfirmed !== false && !unfinished && !budgetSpent,
  };
}

function weeklyIntent(
  utterance: string,
  state: ClaireV2PrimaryState
): "weekly_continue" | "weekly_lock" | "weekly_cancel" | null {
  if (!state.weeklyPlanningWeekStart && !state.strategicProposalId) return null;
  const control = state.strategicProposalId ? parseStrategicProposalControl(utterance) : null;
  if (control) {
    if (control.kind === "approve") return "weekly_lock";
    if (control.kind === "reject") return "weekly_cancel";
    return "weekly_continue";
  }
  if (!EXPLICIT_WEEKLY_CONTROL.test(utterance)) return null;
  if (/\b(?:lock the week|that(?:'s| is) the week)\b/i.test(utterance)) return "weekly_lock";
  if (/\b(?:forget the week|stop planning)\b/i.test(utterance)) return "weekly_cancel";
  return "weekly_continue";
}

function factSegments(segments: ResponseSegment[]): ResponseSegment[] {
  return segments.filter(segment => segment.type === "BusinessFactSegment" && segment.text.trim());
}

/** What V2's evidence says, labelled, for the speaking organ. History is never current truth. */
export function evidenceForSpeech(decision: ExecutiveDecision): Array<{ source: string; text: string }> {
  const out: Array<{ source: string; text: string }> = [];
  for (const segment of decision.responsePlan.segments) {
    if (segment.type === "BusinessFactSegment" && segment.text.trim()) {
      out.push({ source: "brain_v2_business_fact", text: segment.text.trim() });
    } else if (segment.type === "BusinessJudgmentSegment" && segment.text.trim()) {
      out.push({ source: "brain_v2_recommendation (advisory; not a new fact)", text: segment.text.trim() });
    }
  }
  for (const item of decision.evidence) {
    if (item.type === "conversation_turn") {
      const payload = item.payload as { speaker?: string; text?: string; at?: string };
      if (payload.text?.trim()) {
        out.push({
          source: "conversation_history (what was said then; not verified current truth)",
          text: `${payload.speaker === "OPERATOR" || payload.speaker === "operator" ? "Operator" : "Claire"} on ${String(payload.at ?? "").slice(0, 10)}: ${payload.text.trim().slice(0, 240)}`,
        });
      }
    } else if (item.type === "goal_recommendation") {
      const payload = item.payload as { text?: string; summary?: string; title?: string };
      const text = payload.text ?? payload.summary ?? payload.title;
      if (text?.trim()) out.push({ source: "goals (scoped priorities; not business truth)", text: text.trim().slice(0, 240) });
    }
  }
  return out.slice(0, 24);
}

/** Map V2's decision into the speaking organ's turn-meaning frame. */
export function v2SemanticFrame(decision: ExecutiveDecision, state: ClaireV2PrimaryState) {
  const perceived = decision.perceivedTurn;
  const acts = perceived.dialogueActs;
  const grants = decision.actionGrants.map(grant => grant.actionClass);
  const act = perceived.businessIntent === "judgment_question"
    ? "advice_request"
    : acts.includes("leave_taking")
      ? "conversation_control"
      : acts.includes("correction")
        ? "correction"
        : acts.includes("refusal")
          ? "rejection"
          : acts.includes("question")
            ? "question"
            : acts.includes("commitment")
              ? "work_commitment"
              : acts.includes("acknowledgement")
                ? "acknowledgement"
                : acts.includes("directive")
                  ? "action_request"
                  : "narration";
  return {
    target: state.pendingBriefing ? "pending_briefing" : "open_conversation",
    act,
    workDisposition: grants.includes("commit_day_line") || grants.includes("commit_briefing")
      ? "commit"
      : grants.includes("propose_day_line")
        ? "propose"
        : perceived.workDeclarationKind !== "none"
          ? "discuss"
          : "none",
    dayLineDisposition: "none",
    priorClaim: decision.attention.priorClaim,
    weeklyDisposition: "none",
    identityTopic: perceived.aboutClaireCapability ? "claire_role" : "none",
    broadBriefingRequest: perceived.broadBriefingRequest,
    canonicalWork: decision.actionGrants.flatMap(grant => grant.scope.titles ?? []).join("; ") || null,
    referent: perceived.anchorEntity ?? (perceived.entities.filter(entity => entity.kind === "entity_mention").map(entity => entity.raw).join(", ") || null),
    rationale: [
      `lanes=${decision.attention.lanes.join(",") || "conversation"}`,
      `intent=${perceived.businessIntent}`,
      `conclusions=${decision.conclusions.map(conclusion => conclusion.kind).join(",") || "none"}`,
      decision.conclusions.some(conclusion => conclusion.kind === "action_unsupported" || conclusion.kind === "external_capability_unowned" || conclusion.kind === "mission_write_unavailable")
        ? "Nothing was written this turn; do not imply a save, send, or schedule."
        : "",
      "Call the operator's work list the Day Line; never call it 'the board'.",
    ].filter(Boolean).join("; "),
  };
}

/** V2's decision about the kind of conversation, for the speaking organ. */
export function conversationalMode(
  decision: ExecutiveDecision,
  reading: SemanticReading | null
): "operational" | "casual" | "personal" | "post_action_review" | null {
  if (decision.attention.lanes.includes("personal") || decision.attention.lanes.includes("narrative")) return "personal";
  if (!reading) return null;
  if (reading.turnKind === "personal_question_to_claire") return "personal";
  if (reading.turnKind === "small_talk") return "casual";
  if (reading.turnKind === "report_or_narration") return "post_action_review";
  return "operational";
}

function moneyAndPercents(text: string): string[] {
  return [
    ...(text.match(/\$\s?\d[\d,]*(?:\.\d+)?/g) ?? []).map(token => token.replace(/[\s$,]/g, "")),
    ...(text.match(/\d[\d,]*(?:\.\d+)?\s?%/g) ?? []).map(token => `${token.replace(/[\s,%]/g, "")}%`),
  ];
}

/**
 * Composed speech may not invent a dollar figure or a percentage. Every one it
 * says must already appear in V2's evidence, the verified context, or the
 * operator's own words.
 */
export function unlicensedFigures(speech: string, licensedText: string): string[] {
  const licensed = new Set(moneyAndPercents(licensedText.replace(/(\d[\d,]*(?:\.\d+)?)(?!\s?%)/g, "$$$1")));
  for (const token of licensedText.match(/\d[\d,]*(?:\.\d+)?\s?%/g) ?? []) licensed.add(`${token.replace(/[\s,%]/g, "")}%`);
  return moneyAndPercents(speech).filter(token => !licensed.has(token));
}

function summary(
  decision: ExecutiveDecision | null,
  composition: ClaireV2Composition,
  actionClasses: string[]
): V2DecisionSummary {
  return {
    lanes: decision?.attention.lanes ?? [],
    businessIntent: decision?.perceivedTurn.businessIntent ?? "none",
    dialogueActs: decision?.perceivedTurn.dialogueActs ?? [],
    priorClaim: decision?.attention.priorClaim ?? "none",
    actionClasses,
    endCall: Boolean(decision?.callControl.endCall),
    composition,
    pendingDisposition: decision?.attention.pendingDisposition ?? "none",
  };
}

function businessReceipt(input: {
  decision: ExecutiveDecision;
  conversationKey: string;
  ordinal: number;
  nowMs: number;
  speech: string;
  composed: boolean;
}): FactualClaimReceipt | null {
  const business = input.decision.evidence.find(
    (item): item is EvidenceItem & { payload: BusinessQueryResult } =>
      item.type === "business_query" && item.authoritativeFor.includes("current_business_truth")
  );
  if (business && isCompanyViewEvidencePayload(business.payload) && !input.composed) {
    return receiptFromReader({
      conversationKey: input.conversationKey,
      claireTurnOrdinal: input.ordinal,
      nowMs: input.nowMs,
      answerText: input.speech,
      answerPath: "brain_v2_reader",
      claimType: "company_view",
      grounding: "deterministic",
      sources: [business.provenance.reader],
    });
  }
  if (business && !input.composed) {
    return receiptFromBusinessResult({
      conversationKey: input.conversationKey,
      claireTurnOrdinal: input.ordinal,
      nowMs: input.nowMs,
      answerText: input.speech,
      reader: business.provenance.reader,
      result: business.payload,
    });
  }
  const authoritative = input.decision.evidence.filter(item => item.authoritativeFor.includes("current_business_truth"));
  if (!authoritative.length) return null;
  return receiptFromReader({
    conversationKey: input.conversationKey,
    claireTurnOrdinal: input.ordinal,
    nowMs: input.nowMs,
    answerText: input.speech,
    answerPath: input.composed ? "brain_v2_composed" : "brain_v2_reader",
    claimType: input.composed ? "retrieved_evidence" : authoritative[0]!.type,
    grounding: input.composed ? "retrieved" : "deterministic",
    sources: authoritative.map(item => item.provenance.reader),
  });
}

/**
 * One complete V2 turn. Never calls legacy Claire, and never throws for an
 * ordinary failure: a failure is V2's own recovery line.
 */
export async function runClaireV2PrimaryTurn(
  input: ClaireV2PrimaryInput,
  deps: ClaireV2PrimaryDeps
): Promise<ClaireV2PrimaryResult> {
  const { state } = input;
  const now = deps.now();
  const nowMs = now.getTime();

  // Playback evidence before a pending personal disclosure is consumed.
  const previousClaire = state.history?.findLast(entry => entry.speaker === "claire");
  if (input.surface === "text" || previousClaire?.delivery !== "interrupted") {
    await deps.commitPendingDisclosures().catch(() => undefined);
  }

  let semanticReading: SemanticReading | null = null;
  const provenance = (
    composition: ClaireV2Composition,
    decision: ExecutiveDecision | null,
    actionClasses: string[] = [],
    daphneGuidance = false
  ): ClaireV2Provenance => ({
    origin: "brain_v2",
    version: BRAIN_V2_PRIMARY_VERSION,
    composition,
    actionClasses,
    lanes: decision?.attention.lanes ?? [],
    businessIntent: decision?.perceivedTurn.businessIntent ?? "none",
    evidenceReaders: [...new Set((decision?.evidence ?? []).map(item => item.provenance.reader))],
    daphneGuidance,
    semanticTurnKind: semanticReading?.turnKind ?? null,
    legacyConsulted: false,
  });

  const assembly = assembleV2Thought({
    surface: input.surface,
    utterance: input.utterance,
    state,
    allowFragmentWait: input.allowFragmentWait,
    sourceConfirmed: input.sourceConfirmed,
  });
  if (assembly.kind === "hold") {
    return {
      speak: "",
      kind: "listening",
      listenOnly: true,
      assembledUtterance: assembly.combined,
      thoughtCompleteness: "incomplete",
      brainV2: provenance("listening", null),
    };
  }
  const utterance = assembly.utterance;
  if (!utterance) {
    return {
      speak: "",
      kind: "listening",
      listenOnly: true,
      assembledUtterance: "",
      thoughtCompleteness: "incomplete",
      brainV2: provenance("listening", null),
    };
  }

  const ordinal = (state.claireTurnCount ?? 0) + 1;
  const turnId = input.sourceEventId ?? `${input.conversationKey}:${ordinal}`;
  const recentForModel = conversationHistoryForModel(state.history);

  // ── Daphne: durable ingestion, explicit corrections, consent-filtered memory ──
  await deps.ingestDaphne({ utterance, turnId, completed: assembly.durable }).catch(() => undefined);
  const preference = assembly.durable
    ? await deps.capturePreference({ utterance, turnId }).catch(() => null)
    : null;
  const daphne = await deps.loadDaphneGuidance().catch(() => null);

  remember(state, "operator", utterance, nowMs);

  const finish = (
    result: ClaireTurnResult,
    composition: ClaireV2Composition,
    decision: ExecutiveDecision | null,
    actionClasses: string[] = [],
    receipt: FactualClaimReceipt | null = null
  ): ClaireV2PrimaryResult => {
    // A receipt-backed confirmation is linted against its own write receipts, and
    // is never also linted as conversation (that produced "I won't claim that
    // happened… Done." when the adapter returned the confirmation as its speech).
    const commit = result.receiptBackedCommit?.trim();
    let conversational = result.speak.trim();
    if (commit && conversational.endsWith(commit)) conversational = conversational.slice(0, -commit.length).trim();
    const inventory = inventoryPlusReceipts(buildClaireVerifiedFactInventory(input.context ?? null), result.mutationReceipts);
    const speak = assembleGuardedClaireSpeak({
      conversational,
      inventory,
      localTime: input.context?.clock?.localTime ?? null,
      receiptBackedCommit: result.receiptBackedCommit,
      mutationReceipts: result.mutationReceipts,
    });
    remember(state, "claire", speak, nowMs, input.surface === "voice" ? "generated" : "queued");
    state.claireTurnCount = ordinal;
    if (receipt && speak) {
      state.claimReceipts = appendClaimReceipt(state.claimReceipts, { ...receipt, answerText: speak });
    }
    if (deps.legacyShadow !== null) {
      observeLegacyClaireDetached(
        {
          tenantId: input.tenantId,
          operatorUserId: input.operatorUserId,
          conversationKey: input.conversationKey,
          surface: input.surface,
          interpretation: {
            tenantId: input.tenantId,
            operatorId: input.operatorUserId,
            utterance,
            recentTurns: recentForModel.slice(-12).map(turn => ({ speaker: turn.speaker, text: turn.text })),
            pending: {
              briefing: Boolean(state.pendingBriefing),
              accountFollowUp: Boolean(state.pendingAccountFollowUp),
              action: Boolean(state.pendingProposal),
              weeklyPlanning: Boolean(state.weeklyPlanningWeekStart),
            },
            dayLineSuppressed: Boolean(state.dayLineSuppressed),
            preparedStrategicProposal: Boolean(state.strategicProposalId),
          },
          v2: summary(decision, composition, actionClasses),
        },
        deps.legacyShadow ?? {}
      );
    }
    return {
      ...result,
      speak,
      assembledUtterance: utterance,
      thoughtCompleteness: assembly.completeness,
      answerPath: `brain_v2_${composition}`,
      brainV2: provenance(composition, decision, actionClasses, Boolean(daphne)),
    };
  };

  // Explicit, durable style corrections own their confirmation — the same
  // readback-verified contract the Daphne capture service enforces.
  const savedPreference =
    preference && preference.corrections.length > 0 && preference.status !== "disabled";

  try {
    // ── Weekly planning: V2 decides the intent; the weekly service executes it ──
    if (input.surface === "voice" && state.sessionKind === "weekly_planning_invite" && state.weeklyPlanningWeekStart) {
      const yes = /^(?:yes|yeah|yep|sure|ok(?:ay)?|let'?s do it|go ahead|now)\b/i.test(utterance);
      const no = /^(?:no|nope|not now|not tonight|skip)\b/i.test(utterance);
      if (yes) {
        state.sessionKind = "weekly_planning";
        const speech = await deps.beginWeekly();
        return finish({ speak: speech || "I couldn't safely open the week.", kind: "answered" }, "weekly", null);
      }
      if (no) {
        delete state.sessionKind;
        state.weeklyPlanningWeekStart = null;
        return finish(
          { speak: "All right.", kind: "answered", endCall: true, endCallReason: "weekly_planning_invite_declined" },
          "weekly",
          null
        );
      }
    }
    if (state.weeklyPlanningWeekStart && state.weeklyPlanningWeekStart < weekStartMonday(input.businessDate)) {
      state.weeklyPlanningWeekStart = null;
    }
    /**
     * An active weekly interview owns the operator's ordinary answers ("Tuesday
     * afternoon") the way the legacy weekly disposition did. V2 reads the turn
     * first: only a question about the business, a briefing request, a personal
     * question, a prior-claim challenge, or a goodbye leaves the interview.
     */
    let earlyReading: SemanticReading | null = null;
    let weekly = weeklyIntent(utterance, state);
    const interviewActive = state.sessionKind === "weekly_planning" && Boolean(state.weeklyPlanningWeekStart);
    if (!weekly && interviewActive && deps.interpretPerception) {
      earlyReading = await deps.interpretPerception({
        tenantId: input.tenantId,
        utterance,
        recentTurns: recentForModel.map(entry => ({ speaker: entry.speaker, text: entry.text })),
        hasPriorClaims: Boolean(state.claimReceipts?.length),
        holdingPending: Boolean(state.pendingBriefing || state.pendingProposal || state.pendingAccountFollowUp),
      }).catch(() => null);
      if (!earlyReading || !LEAVES_WEEKLY_INTERVIEW.has(earlyReading.turnKind)) weekly = "weekly_continue";
    }
    if (weekly) {
      const routed = await deps.routeWeekly({ utterance, intent: weekly, state });
      if (routed) {
        if (routed.presentedRecommendation) {
          state.strategicProposalId = routed.presentedRecommendation.proposalId;
          state.strategicProposalRevision = routed.presentedRecommendation.revision;
        }
        return finish(
          routed.receiptBackedCommit
            ? {
                speak: "",
                receiptBackedCommit: routed.receiptBackedCommit,
                mutationReceipts: routed.mutationReceipts,
                kind: "answered",
                actionIds: routed.actionIds ?? [],
              }
            : { speak: routed.speak || "I still have the week open. Say that once more.", kind: "answered", actionIds: routed.actionIds ?? [] },
          "weekly",
          null,
          ["weekly_planning"]
        );
      }
    }

    // ── Perception → Executive Function, with live read-only retrieval ──
    let adapterResult: ClaireTurnResult | null = null;
    let adapterPromise: Promise<ClaireTurnResult> | null = null;
    const execute = async (grant: ExecutiveActionGrant): Promise<ClaireTurnResult> => {
      if (isClaireRoleFeedback(grant.sourceTurnAssembledText)) {
        throw new Error("Claire role feedback cannot authorize Day Line mutation");
      }
      if (!adapterPromise) adapterPromise = deps.executeGrant(grant, state);
      adapterResult = guardCommittedDayLineResult(grant, await adapterPromise);
      return adapterResult;
    };
    const retrieval: ShadowRetrievalContext = {
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      conversationId: input.conversationId,
      dayDirectorActorId: input.dayDirectorActorId,
      timeZone: input.timeZone,
      businessDate: input.businessDate,
      surface: input.surface,
      priorClaimReceipts: state.claimReceipts ?? [],
    };
    const memory = state.brainV2Memory ?? null;
    const turn: ClaireBrainTurnResult = await runClaireBrainTurn({
      rawText: input.utterance.trim() || utterance,
      assembledText: utterance,
      completeness: assembly.completeness,
      state: {
        ...readOnlyWorkingMemorySource(state as Parameters<typeof readOnlyWorkingMemorySource>[0]),
        focusEntities: memory?.focusEntities,
        orderedQuery: memory?.orderedQuery ?? null,
        unresolvedReferences: memory?.unresolvedReferences,
        activeWorkFrame: memory?.activeWorkFrame ?? null,
      },
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      surface: input.surface,
      conversationKey: input.conversationKey,
      executive: {
        ...liveExecutiveDeps(retrieval, deps.liveDeps),
        planBusinessQuery: deps.planBusinessQuery,
        productionAuthority: true,
      },
      productionAuthority: true,
      actionExecutor: execute,
      ...(deps.interpretPerception
        ? {
            refinePerception: async perceived => {
              const refined = await refinePerception(
                perceived,
                {
                  tenantId: input.tenantId,
                  recentTurns: recentForModel.map(entry => ({ speaker: entry.speaker, text: entry.text })),
                  hasPriorClaims: Boolean(state.claimReceipts?.length),
                  holdingPending: Boolean(state.pendingBriefing || state.pendingProposal || state.pendingAccountFollowUp),
                },
                // Reuse the reading already taken for weekly routing; never ask twice.
                earlyReading ? async () => earlyReading : deps.interpretPerception!
              );
              semanticReading = refined.reading;
              return refined.perceived;
            },
          }
        : {}),
    });
    if (!turn.productionAuthority) throw new Error("Brain V2 primary turn returned without production authority");
    const decision = turn.decision;
    state.brainV2Memory = updateShadowMemory(memory, decision, nowMs);
    const actionClasses = decision.actionGrants.map(grant => grant.actionClass);
    // A refused pending item is finished. Clear it so a later "okay" cannot bind
    // to it and commit work the operator already declined.
    if (decision.attention.pendingDisposition === "reject") {
      state.pendingBriefing = null;
      state.pendingProposal = null;
      state.pendingAccountFollowUp = null;
      state.heldBriefingItems = [];
    }

    // A half-turn that perception would not release is held, never answered.
    if (decision.inhibitedCandidates.some(item => item.kind === "half_turn")) {
      if (input.surface === "voice") {
        state.pendingFragment = utterance;
        state.fragmentHolds = (state.fragmentHolds ?? 0) + 1;
      }
      return {
        speak: "",
        kind: "listening",
        listenOnly: true,
        assembledUtterance: utterance,
        thoughtCompleteness: "incomplete",
        brainV2: provenance("listening", decision),
      };
    }

    // ── Action lifecycle: V2's grant, executed once by the receipt-backed adapter ──
    const executed = adapterResult as ClaireTurnResult | null;
    if (executed) {
      if (state.showrunner) state.showrunner.turns += 1;
      return finish(
        { ...executed, endCall: executed.endCall || turn.candidateEndCall || undefined },
        "action",
        decision,
        actionClasses
      );
    }

    // ── Explicit preference correction (no work in the same turn) ──
    if (savedPreference && actionClasses.length === 0 && preference) {
      const detail = preference.corrections.find(correction => correction.preferenceKey === "response_detail");
      const saved = preference.status === "persisted" && preference.readbackVerified === true;
      const speech = !saved
        ? "I understand, but I couldn't save that preference for future calls."
        : detail?.value === 0.2
          ? "Got it. I'll keep my answers shorter from now on."
          : detail?.value === 0.85
            ? "Got it. I'll provide more detail from now on."
            : "That preference is saved for future calls.";
      return finish({ speak: speech, kind: "answered" }, "preference", decision);
    }

    const segments = decision.responsePlan.segments;
    const facts = factSegments(segments);
    const deterministicText = turn.candidateSpeak.trim();
    const attention = decision.attention;
    const intent = decision.perceivedTurn.businessIntent;

    // ── Call control ──
    if (turn.candidateEndCall) {
      return finish(
        brainV2CallControlResult({ candidateSpeak: deterministicText, assembledUtterance: utterance }),
        "call_control",
        decision,
        actionClasses,
        facts.length
          ? businessReceipt({ decision, conversationKey: input.conversationKey, ordinal, nowMs, speech: deterministicText, composed: false })
          : null
      );
    }

    // ── A named period is answered for exactly that period, or not at all ──
    const asked = FACT_INTENTS.has(intent) && attention.priorClaim === "none" && !attention.continueOrderedQuery
      ? requestedPeriod(utterance)
      : null;
    if (asked) {
      const queries = decision.evidence.filter(
        item => item.type === "business_query" && item.authoritativeFor.includes("current_business_truth")
      );
      // A ledger query carries `query.period`; a business read carries `questionPeriod`.
      const executed = queries.map(item =>
        isCompanyViewEvidencePayload(item.payload)
          ? item.payload.questionPeriod
          : (item.payload as BusinessQueryResult).query?.period
      );
      if (queries.length && !executed.some(period => periodMatches(asked, period))) {
        console.warn("[ClaireBrainV2Primary] requested period not verified", {
          event: "claire_brain_v2_period_mismatch",
          conversationKey: input.conversationKey,
          requested: asked.kind,
          executed: executed.map(period => period?.kind ?? null),
        });
        return finish(
          {
            speak: `I can't verify ${asked.label} from what I have right now, so I won't give you a different period instead.`,
            kind: "answered",
          },
          "deterministic",
          decision,
          actionClasses
        );
      }
    }

    // ── Decisive V2 speech: facts, clarifications, refusals, prior-claim verdicts ──
    const companyAnswer =
      facts.length > 0 &&
      decision.evidence.some(item => isCompanyViewEvidencePayload(item.payload));
    const decisive =
      companyAnswer ||
      decision.control.mode === "clarify" ||
      attention.pendingDisposition === "reject" ||
      attention.priorClaim !== "none" ||
      attention.continueOrderedQuery ||
      (FACT_INTENTS.has(intent) && facts.length > 0);
    if (decisive && deterministicText) {
      return finish(
        { speak: deterministicText, kind: "answered" },
        "deterministic",
        decision,
        actionClasses,
        businessReceipt({ decision, conversationKey: input.conversationKey, ordinal, nowMs, speech: deterministicText, composed: false })
      );
    }

    // ── Scheduled call: V2 decided this is not work; the agenda conductor speaks ──
    // Strategy and personal questions are answered by V2's composer even inside a
    // planning session; the conductor keeps the agenda, reports and approvals.
    const composerKinds = new Set<SemanticReading["turnKind"]>(["business_judgment_or_strategy", "personal_question_to_claire"]);
    const readingKind = (semanticReading as SemanticReading | null)?.turnKind ?? null;
    if (state.showrunner && deps.showrunner && !(readingKind && composerKinds.has(readingKind))) {
      let conducted: { state: ShowrunnerCallState; end: boolean; speak: string };
      try {
        conducted = await deps.showrunner({
          state: state.showrunner,
          history: recentForModel,
          utterance,
          sourceEventId: turnId,
        });
      } catch {
        conducted = {
          state: state.showrunner,
          end: false,
          speak: "I have your last message, but I couldn't finish that response. Nothing new is confirmed saved.",
        };
      }
      state.showrunner = conducted.state;
      const holding = Boolean(state.pendingBriefing || state.pendingProposal || state.pendingAccountFollowUp);
      return finish(
        {
          speak: conducted.speak,
          kind: "answered",
          ...(conducted.end && !holding ? { endCall: true, endCallReason: `${conducted.state.purpose}_complete` } : {}),
        },
        "showrunner",
        decision,
        actionClasses
      );
    }

    // ── Composed: V2's decision and evidence, phrased by Claire's guarded speaking organ ──
    const evidence = evidenceForSpeech(decision);
    const v2Notes = segments
      .filter(segment => segment.type === "CognitiveAcknowledgementSegment" && segment.text.trim())
      .map(segment => segment.text.trim());
    const context = input.context ?? null;
    if (!context) {
      return finish(
        { speak: deterministicText || "I don't have today's picture loaded yet. Give me a second and ask again.", kind: "answered" },
        "deterministic",
        decision,
        actionClasses
      );
    }
    let personalEnd = false;
    const organInput: Parameters<SpeakingOrgan>[0] = {
      tenantId: input.tenantId,
      utterance,
      brief: input.brief ?? null,
      context,
      recentTurns: recentForModel,
      semanticFrame: v2SemanticFrame(decision, state),
      semanticAuthority: "brain_v2",
      ...(conversationalMode(decision, semanticReading) ? { conversationalModeOverride: conversationalMode(decision, semanticReading)! } : {}),
      retrievedEvidence: [
        ...evidence,
        ...v2Notes.map(text => ({ source: "brain_v2_decision (convey this; nothing was saved)", text })),
      ].length
        ? [...evidence, ...v2Notes.map(text => ({ source: "brain_v2_decision (convey this; nothing was saved)", text }))]
        : undefined,
      surface: input.surface === "voice" ? "voice" : "desktop",
      conversationId: input.conversationKey,
      coveredThisCall: coveredThisCallLines(state.coverage),
      priorClaimNotes: (state.claimReceipts ?? [])
        .filter(receipt => receipt.grounding === "deterministic" || receipt.grounding === "retrieved")
        .slice(-4)
        .map(receipt => `${receipt.claimType} (${receipt.answerPath}): ${receipt.answerText.slice(0, 160)}`),
      daphnePromptSection: daphne?.promptSection ?? null,
      rookContactResidueSection: claireRookContactResidueSection({
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
        utterance,
        residues: input.rookContactResidues ?? [],
      }),
      onPersonalTurn: personal => {
        if (personal.endCall) personalEnd = true;
      },
    };
    let composed = await deps.speak(organInput);
    // The organ's generic "couldn't finish" line means generation failed or a
    // safety guard discarded the draft. V2 asks once more before speaking it.
    let organFallback: string | null = null;
    try {
      organFallback = conservativeClaireFollowUp({ utterance, brief: input.brief ?? null, context });
    } catch {
      organFallback = null;
    }
    if (organFallback && composed.trim() === organFallback.trim()) {
      console.warn("[ClaireBrainV2Primary] speaking organ returned its fallback; retrying once", {
        event: "claire_brain_v2_organ_retry",
        conversationKey: input.conversationKey,
      });
      composed = await deps.speak(organInput).catch(() => composed);
    }

    const licensedText = [
      ...evidence.map(item => item.text),
      deterministicText,
      input.brief ?? "",
      buildClaireVerifiedFactInventory(context).toPromptSection() ?? "",
      utterance,
      ...(state.history ?? []).filter(entry => entry.speaker === "operator").map(entry => entry.text),
    ].join(" \n ");
    const invented = unlicensedFigures(composed, licensedText);
    let speech = composed;
    if (invented.length) {
      console.warn("[ClaireBrainV2Primary] composed speech named unlicensed figures", {
        event: "claire_brain_v2_unlicensed_figure",
        conversationKey: input.conversationKey,
        count: invented.length,
      });
      speech = deterministicText || "I don't have a verified figure for that, so I won't guess.";
    }
    return finish(
      { speak: speech, kind: "answered", ...(personalEnd ? { endCall: true, endCallReason: "personal_thread_closed" } : {}) },
      invented.length ? "deterministic" : "composed",
      decision,
      actionClasses,
      businessReceipt({ decision, conversationKey: input.conversationKey, ordinal, nowMs, speech, composed: !invented.length })
    );
  } catch (error) {
    console.error("[ClaireBrainV2Primary] turn failed", {
      event: "claire_brain_v2_primary_failed",
      tenantId: input.tenantId,
      surface: input.surface,
      conversationKey: input.conversationKey,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return finish({ speak: V2_RECOVERY_SPEECH, kind: "answered", actionIds: [] }, "recovery", null);
  }
}

/** Production wiring shared by the phone and the Claire Desk. */
export function productionClaireV2PrimaryDeps(input: {
  tenantId: string;
  operatorUserId: string;
  dayDirectorActorId: string;
  conversationKey: string;
  timeZone: string;
  surface: "voice" | "text";
  now?: () => Date;
}): ClaireV2PrimaryDeps {
  const now = input.now ?? (() => new Date());
  return {
    now,
    speak: answerClairePreDriveFollowUp,
    interpretPerception: interpretSemanticPerception,
    planBusinessQuery: args => planBusinessQuestionWithLLM(args),
    executeGrant: (grant, state) =>
      executeGrantBoundLegacyAdapter({
        grant,
        state,
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
        dayDirectorActorId: input.dayDirectorActorId,
        conversationKey: input.conversationKey,
        timeZone: input.timeZone,
        surface: input.surface,
      }),
    routeWeekly: async ({ utterance, intent, state }) => {
      const { routeActiveWeeklySession } = await import("../../weeklyMission/route");
      return routeActiveWeeklySession({
        tenantId: input.tenantId,
        operatorId: input.operatorUserId,
        dayDirectorActorId: input.dayDirectorActorId,
        utterance,
        now: now(),
        timeZone: input.timeZone,
        weekStartOverride: state.weeklyPlanningWeekStart ?? undefined,
        expectedStrategicProposalId: state.strategicProposalId ?? undefined,
        expectedStrategicProposalRevision: state.strategicProposalRevision ?? undefined,
        authoritativeIntent: intent,
      });
    },
    beginWeekly: async () => {
      const { beginWeeklyMission } = await import("../../weeklyMission/driver");
      const turn = await beginWeeklyMission({
        tenantId: input.tenantId,
        operatorId: input.operatorUserId,
        dayDirectorActorId: input.dayDirectorActorId,
        timeZone: input.timeZone,
        now: now(),
      }).catch(() => null);
      return turn?.speech?.trim() ?? "";
    },
    ingestDaphne: async ({ utterance, turnId, completed }) => {
      const { ingestDaphneConversation } = await import("../../../agents/daphne/conversationIngestion");
      return ingestDaphneConversation({
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
        utterance,
        conversationId: input.conversationKey,
        turnId,
        completed,
      });
    },
    capturePreference: async ({ utterance, turnId }) => {
      const { captureExplicitDaphnePreferenceCorrections } = await import("../../../agents/daphne/explicitPreferenceCorrection");
      return captureExplicitDaphnePreferenceCorrections({
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
        utterance,
        conversationId: input.conversationKey,
        turnId,
      });
    },
    loadDaphneGuidance: async () => {
      const { loadDaphneClaireGuidance } = await import("../../../agents/daphne/claireAdapter");
      return loadDaphneClaireGuidance({ tenantId: input.tenantId, operatorUserId: input.operatorUserId });
    },
    showrunner: async ({ state, history, utterance, sourceEventId }) => {
      const { runShowrunnerTurn } = await import("../../showrunner/showrunnerTurn");
      return runShowrunnerTurn({
        state,
        history,
        utterance,
        sourceEventId,
        conversationKey: input.conversationKey,
      });
    },
    commitPendingDisclosures: async () => {
      const [{ isClaireProgressionEnabled }, { commitPendingDisclosuresForConversation }, { getProgressionStore }] =
        await Promise.all([
          import("../../progression/progressionFlag"),
          import("../../progression/service"),
          import("../../progression/drizzleStore"),
        ]);
      if (!isClaireProgressionEnabled(input.tenantId)) return;
      await commitPendingDisclosuresForConversation(getProgressionStore(), {
        tenantId: input.tenantId,
        conversationId: input.conversationKey,
      });
    },
  };
}
