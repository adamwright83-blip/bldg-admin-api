import { invokeTextLLM } from "../_core/llm";
import { ENV } from "../_core/env";
import { claireModelId, claireModelRequest } from "./claireModel";
import { compileClaireContextForOperator } from "./character/relationshipHistory";
import type { ClaireDriveContext } from "./contextAssembler";
import { formatClaireLocalTime, CLAIRE_BUSINESS_TIME_ZONE } from "./contextAssembler";
import {
  recordClaireGeneration,
  safeClaireFailureReason,
  type ClaireGenerationDiagnostic,
} from "./generationTelemetry";
import { detectClaireConversationalMode, detectRequestedClaireTopic } from "./topicDetection";
import {
  CLAIRE_V1_REASONING_POLICY,
  detectAvoidanceDisclosure,
  detectClaireWasWrong,
  detectUnnecessarySoloWork,
  detectVagueBusinessClaim,
  inferBlockerKind,
  isPermanentlyPrivateTopicProbe,
  nextBlockerQuestion,
  nextReadinessPrompt,
} from "../../shared/claireRuntime";
import { formatCapabilityBriefing } from "../../shared/goldlineCapabilities";
import { assembleClaireRuntimeView } from "./runtimeView";
import {
  assertPostGenerationStateVerbs,
  buildClaireVerifiedFactInventory,
} from "./verifiedFactInventoryFromContext";
import { trimToSentenceBoundary } from "./textTrim";
import { measureClairePromptSections, type ClairePromptSizeTrace } from "./answerPathTelemetry";
import {
  assertNoUngroundedPersonalSpecificity,
  UngroundedPersonalSpecificityError,
} from "./character/personalSpecificityGuard";
import { recoverPersonalAnswer } from "./character/personalAnswerRecovery";
import { GOLDLINE_OFFER_CONTEXT } from "./offerContext";
import {
  CLAIRE_TEMPORAL_AUTHORITY_INSTRUCTION,
  VOICE_NATIVE_ANSWER_GUIDANCE,
  type ClaireGenerationSurface,
} from "./conversationVoiceGuidance";

// PR1 Claire Intelligence Repair: this was a hard 520-char cut applied to
// every conversational answer, including the model path. Kept only for the
// deterministic (non-model) conservative fallback strings below, which are
// still hand-written and short by construction -- the model path now uses
// trimToSentenceBoundary with a much larger, effectively-unreached bound
// (see FOLLOW_UP_TRIM_CHARS) instead of a hard slice.
const MAX_SPOKEN_ANSWER_CHARS = 1200;

// PR1 Claire Intelligence Repair -- corrective pass (real-exam finding):
// the real exam hit this exact hard slice on 2 of 12 real answers,
// chopping a genuine strategic answer off mid-sentence. Raised generously
// so it is a true safety net, not a de facto ceiling; the practical limit
// is now FOLLOW_UP_MAX_TOKENS below, and even that termination is now
// captured via stop_reason rather than left silent.
const FOLLOW_UP_TRIM_CHARS = 6000;
const FOLLOW_UP_MAX_TOKENS = 1400;

const AMBIGUOUS_CLOSE_PHRASE =
  /\b(got it|i(?: am|'m) (?:all )?good|that(?: is|'s) enough|bye)\b/;
const EXPLICIT_END_CALL_PHRASE =
  /\b(end (?:the )?call|hang up|goodbye|we(?: are|'re) done|i(?: am|'m) done|have a good (?:day|night|one))\b/;

export function isClaireCallComplete(utterance: string): boolean {
  const normalized = utterance.trim().toLowerCase();
  return EXPLICIT_END_CALL_PHRASE.test(normalized) || AMBIGUOUS_CLOSE_PHRASE.test(normalized);
}

export function isExplicitClaireCallEnd(utterance: string): boolean {
  return EXPLICIT_END_CALL_PHRASE.test(utterance.trim().toLowerCase());
}

/**
 * Hang up on a close phrase. Ambiguous short closers ("got it", "I'm good")
 * stay gated so they cannot abort a pending Day Line confirmation. Explicit
 * end-call speech must terminate even when a briefing is held or the
 * utterance is longer than six words — the live operator acceptance call
 * said "Have a good day. I'm done talking." and was ignored.
 */
export function shouldEndClaireCallOnUtterance(
  utterance: string,
  options: { holding?: boolean } = {}
): boolean {
  if (!isClaireCallComplete(utterance)) return false;
  if (isExplicitClaireCallEnd(utterance)) return true;
  if (options.holding) return false;
  const words = utterance.split(/\s+/).filter(Boolean).length;
  return words <= 6;
}

function currentStop(context: ClaireDriveContext) {
  if (context.mission) {
    return {
      title: context.mission.accountName,
      destination: context.mission.address,
    };
  }
  const item =
    context.nextFixedCommitment ??
    context.relevantTimeline.find(entry =>
      ["commercial_visit", "commercial_call"].includes(entry.kind)
    ) ??
    context.relevantTimeline[0];
  return item ? { title: item.title, destination: item.destination } : null;
}

export function conservativeClaireFollowUp(input: {
  utterance: string;
  brief: string;
  context: ClaireDriveContext;
}): string {
  const question = input.utterance.toLowerCase();
  const stop = currentStop(input.context);
  const goal = input.context.macroGoal;

  if (detectAvoidanceDisclosure(input.utterance)) {
    const kind = inferBlockerKind(input.utterance);
    return `${nextBlockerQuestion(kind)} ${nextReadinessPrompt(kind)}`.slice(0, MAX_SPOKEN_ANSWER_CHARS);
  }
  if (isPermanentlyPrivateTopicProbe(input.utterance)) {
    return "That's not something I talk about. Ask something else.";
  }
  if (detectClaireWasWrong(input.utterance)) {
    return "I was wrong about that. I won't keep pushing the same recommendation. What did the outcome actually show?";
  }
  if (detectVagueBusinessClaim(input.utterance)) {
    return "I don't have an authoritative number for that, so I won't invent one. What exact figure are we using before we decide?";
  }
  if (detectUnnecessarySoloWork(input.utterance)) {
    return "You could spend time inferring that, or ask the person who already knows. Is there a reason not to ask them?";
  }
  if (!input.context.macroGoalKnown && /\b(what (?:should|are) we|priority|trying to)\b/.test(question)) {
    return "What are we actually trying to accomplish?";
  }
  if (goal && /\b(ads?|advertis|channel|zeely|instagram|tactic)\b/.test(question + input.utterance)) {
    return `${goal.targetValue ?? ""} ${goal.unit ?? ""} is the target. Advertising is a channel, not the goal. What are we actually trying to learn or decide?`
      .replace(/^\s+/, "")
      .slice(0, MAX_SPOKEN_ANSWER_CHARS);
  }
  if (input.context.runtime?.picture && !input.context.runtime.picture.sufficient) {
    if (/\b(today|plan|what(?:'s| is) (?:on|next))\b/.test(question)) {
      return input.context.runtime.picture.summary.slice(0, MAX_SPOKEN_ANSWER_CHARS);
    }
  }

  if (/\b(who|meeting|seeing|talk(?:ing)? to)\b/.test(question)) {
    return stop
      ? `Today's context identifies ${stop.title}, but it does not name a specific person. I don't want to guess.`
      : "Today's field context does not name a person or commercial stop. I don't want to guess.";
  }
  if (/already (?:have|has)|existing laundry|current laundry/.test(question)) {
    return "The current context doesn't confirm their laundry setup. Don't assume. Ask how laundry works today and what, if anything, management has to coordinate.";
  }
  if (
    /\b(what do you mean|what are you talking about|what did you say|what was that|say that again|repeat|can't hear|cannot hear|tell me (?:the )?brief|give (?:me|it)|why|explain|clarify)\b/.test(
      question
    )
  ) {
    return `I mean this: ${input.brief}`.slice(0, MAX_SPOKEN_ANSWER_CHARS);
  }
  if (/^(hello|hey|hi)[.! ]*$/.test(question.trim())) {
    return `I'm here. ${input.brief}`.slice(0, MAX_SPOKEN_ANSWER_CHARS);
  }
  return `Give me a second—ask me that once more. In the meantime, the brief is: ${input.brief}`.slice(
    0,
    MAX_SPOKEN_ANSWER_CHARS
  );
}

function compactConversationContext(context: ClaireDriveContext): string {
  const runtime = context.runtime ?? assembleClaireRuntimeView(context);
  const timeZone = context.clock?.timeZone ?? CLAIRE_BUSINESS_TIME_ZONE;
  return JSON.stringify({
    businessDate: context.businessDate,
    clock: context.clock,
    macroGoalKnown: context.macroGoalKnown,
    macroGoal: context.macroGoal,
    nextFixedCommitment: context.nextFixedCommitment,
    // PR1 Claire Intelligence Repair -- corrective pass (real-exam
    // finding): nextFixedCommitment.scheduledAt above is a raw ISO
    // timestamp. This field is the same instant, pre-rendered into an
    // unambiguous local date/time string using the resolved business
    // timezone, so Claire never has to convert or characterize it herself.
    nextFixedCommitmentLocalWhen: context.nextFixedCommitment
      ? formatClaireLocalTime(context.nextFixedCommitment.scheduledAt, timeZone)
      : null,
    blockers: context.blockers,
    relevantTimeline: context.relevantTimeline,
    mission: context.mission,
    missionSalesBrief: context.missionSalesBrief,
    picture: runtime.picture,
    workItems: runtime.workItems.slice(0, 8),
    factInventory: buildClaireVerifiedFactInventory(context).toPromptSection(),
    capabilityBriefing: formatCapabilityBriefing(),
  });
}

export async function answerClairePreDriveFollowUp(
  input: {
    tenantId: string;
    utterance: string;
    brief: string;
    context: ClaireDriveContext;
    onGeneration?: (diagnostic: ClaireGenerationDiagnostic) => void;
    /** The last turns of this conversation, so follow-ups like "is that…" have a referent. */
    recentTurns?: Array<{ speaker: "operator" | "claire"; text: string }>;
    /**
     * Claire Intelligence Repair Part 2, Slice C+D: authoritative evidence
     * retrieved for this exact question by a deterministic reader (business
     * query, day work, unpaid orders, account history), each labelled with
     * its source. Present only for a judgment or blended turn the router
     * decided needs Claire's own synthesis rather than a renderer's
     * sentence — the fact half of the answer must be grounded in this, never
     * invented or recomputed, and the judgment half remains Claire's general
     * professional knowledge as already governed by the truth rules below.
     */
    retrievedEvidence?: Array<{ source: string; text: string }>;
    /**
     * PR1 Claire Intelligence Repair -- corrective pass: this generation
     * path is shared between the Twilio voice call and the desktop/text
     * surface (see server/claire/turn/claireTurn.ts). Defaults to "voice"
     * to preserve exact existing behavior for the one caller that already
     * exists in production today (the voice call) -- pass "desktop"
     * explicitly to allow more written-style structure there instead of
     * voice-native prose.
     */
    surface?: ClaireGenerationSurface;
  },
  dependencies: {
    invokeText?: typeof invokeTextLLM;
    recordGeneration?: typeof recordClaireGeneration;
  } = {}
): Promise<string> {
  const fallback = conservativeClaireFollowUp(input);
  const startedAt = Date.now();
  const invokeText = dependencies.invokeText ?? invokeTextLLM;
  const recordGeneration =
    dependencies.recordGeneration ?? recordClaireGeneration;
  const surface: ClaireGenerationSurface = input.surface ?? "voice";
  const conversationalMode = detectClaireConversationalMode(input.utterance);
  const requestedTopic = detectRequestedClaireTopic(input.utterance);
  const inventory = buildClaireVerifiedFactInventory(input.context);
  const compiled = await compileClaireContextForOperator({
    tenantId: input.tenantId,
    operatorUserId: input.context.actorId ?? null,
    inventory,
    topic: requestedTopic ?? undefined,
    mode:
      conversationalMode === "personal"
        ? "personal"
        : conversationalMode === "casual"
          ? "casual"
          : conversationalMode === "post_action_review"
            ? "post_action_review"
            : "pre_drive",
  });
  let stopReason: string | null = null;
  let modelServed: string | null = null;
  // Slice A: counts only, measured from exactly the sections that are sent.
  let promptSize: ClairePromptSizeTrace | null = null;

  /**
   * ORDERING NOTE (corrective pass 3): the delivery rules
   * (VOICE_NATIVE_ANSWER_GUIDANCE) are deliberately LAST -- nearest the
   * generation and after every instruction that could otherwise compete
   * with them on length or structure. A prompt dump showed the previous
   * ordering left ~1,550 characters of further instruction after them.
   */
  /**
   * Labelled so Slice A can report a per-section character breakdown and
   * Slice E has something concrete to cut. The labels are telemetry only —
   * only the text is ever sent to the model, joined exactly as before.
   */
  function followUpPromptSections(): Array<{ label: string; text: string | null }> {
    return [
      { label: "compiled_canon", text: compiled.promptSection },
      {
        label: "few_shot_voice",
        text: compiled.fewShotBlock
          ? `Voice reference only, not facts to repeat verbatim -- illustrative examples of how Claire actually talks: ${compiled.fewShotBlock}`
          : null,
      },
      { label: "fact_inventory", text: inventory.toPromptSection() },
      { label: "offer_context", text: GOLDLINE_OFFER_CONTEXT },
      { label: "reasoning_policy", text: CLAIRE_V1_REASONING_POLICY },
      {
        label: "job_and_clock",
        text: `${CLAIRE_TEMPORAL_AUTHORITY_INSTRUCTION} Missing retrievedEvidence: say so, then still answer any judgment asked.`,
      },
      { label: "truth_business_claims", text: "Business-specific claims (this account, this customer, this property, a specific number, a specific completed action) must be grounded in verified context or the fact inventory, or say it is unknown. Never invent people or numbers." },
      {
        label: "judgment_and_history",
        text: "General professional knowledge is framed advice, never asserted as a fact about this business; do not import a sales model from a different industry. Personal answers: eligible canon only. A prior Claire turn is conversation history, not verified truth — if it asserted something not present in the fact inventory, do not treat it as confirmed on this turn. If a blocker was already mentioned, do not mechanically re-mention it again unless the operator asked. Never claim an action was taken unless the fact inventory confirms it.",
      },
      {
        label: "retrieved_evidence_rule",
        text: input.retrievedEvidence?.length
          ? "retrievedEvidence is verified for this question. Ground facts in it. If a source is unsupported_fact, say so. Still answer any judgment asked."
          : null,
      },
      {
        label: "mission_sales_brief",
        text: input.context.missionSalesBrief
          ? "If missionSalesBrief is present, it is the one authoritative sales strategy for this mission. Never state a missionSalesBrief unknown, questionsToAsk item, or recommendation as if it were already a known fact."
          : null,
      },
      { label: "delivery_voice", text: surface === "voice" ? VOICE_NATIVE_ANSWER_GUIDANCE : null },
    ];
  }

  function buildFollowUpSystemPrompt(): string {
    return followUpPromptSections()
      .map(section => section.text)
      .filter((text): text is string => Boolean(text))
      .join(" ");
  }

  const conversationMessages = [
    ...(input.recentTurns ?? []).slice(-8).map(turn => ({
      role: (turn.speaker === "claire" ? "assistant" : "user") as "assistant" | "user",
      content: turn.text,
    })),
    {
      role: "user" as const,
      content: JSON.stringify({
        openingBrief: input.brief,
        currentContext: {
          ...JSON.parse(compactConversationContext(input.context)),
          retrievedEvidence: input.retrievedEvidence ?? [],
        },
        operatorUtterance: input.utterance.slice(0, 1_000),
      }),
    },
  ];

  try {
    const systemPrompt = buildFollowUpSystemPrompt();
    promptSize = measureClairePromptSections("follow_up", followUpPromptSections());
    const text = (
      await invokeText({
        tenantId: input.tenantId,
        ...claireModelRequest(0.6),
        maxTokens: FOLLOW_UP_MAX_TOKENS,
        onStopReason: reason => { stopReason = reason; },
        onModelServed: model => { modelServed = model; },
        messages: [
          { role: "system", content: systemPrompt },
          ...conversationMessages,
        ],
      })
    ).trim();
    if (!text) throw new Error("Claire follow-up produced empty output");
    const trimmed = trimToSentenceBoundary(text, FOLLOW_UP_TRIM_CHARS);
    const trimmedToSentenceBoundary = trimmed !== text;
    assertPostGenerationStateVerbs(trimmed, inventory);

    // Personal-specificity guard stays hard and fail-closed. If the model
    // invents a personal specific, recover deterministically from canon that
    // was already eligible for this operator/topic. Do not ask the model to
    // try again: a second free-form generation can hallucinate again.
    let answer = trimmed;
    let recoveredVia: "canon_render" | "canon_scoped_deflection" | null = null;
    if (conversationalMode === "personal") {
      try {
        assertNoUngroundedPersonalSpecificity(trimmed, compiled.eligibleCanonFacts);
      } catch (guardError) {
        if (!(guardError instanceof UngroundedPersonalSpecificityError)) throw guardError;
        console.warn("[Claire] personal answer asserted ungrounded specificity; recovering deterministically from eligible canon", {
          candidate: guardError.candidate,
          eligibleCanonFactCount: compiled.eligibleCanonFacts.length,
          requestedTopic: requestedTopic ?? null,
        });
        const recovery = recoverPersonalAnswer({
          eligibleCanonFacts: compiled.eligibleCanonFacts,
          eligibleCanonFragmentIds: compiled.eligibleCanonFragmentIds,
          requestedTopic: requestedTopic ?? undefined,
        });
        answer = recovery.text;
        recoveredVia = recovery.via;
      }
    }

    const diagnostic: ClaireGenerationDiagnostic = {
      kind: "follow_up",
      source: recoveredVia === null ? "model" : "fallback",
      answerOrigin:
        recoveredVia === "canon_render"
          ? "canon_render"
          : recoveredVia === "canon_scoped_deflection"
            ? "fallback"
            : "model",
      failureReason:
        recoveredVia === null
          ? null
          : recoveredVia === "canon_render"
            ? "ungrounded_personal_specificity_canon_rendered"
            : "ungrounded_personal_specificity",
      modelRequested: claireModelId(),
      modelServed,
      promptSize: promptSize ?? undefined,
      surface,
      stopReason,
      trimmedToSentenceBoundary,
    };
    await recordGeneration({
      tenantId: input.tenantId,
      diagnostic,
      latencyMs: Date.now() - startedAt,
      reviewDetail: {
        operatorUserId: input.context.actorId ?? null,
        generatedText: answer,
        compiled,
        businessContextSummary: input.context.businessDate,
      },
    });
    input.onGeneration?.(diagnostic);
    return answer;
  } catch (error) {
    const failureReason = safeClaireFailureReason(error);
    console.error("[Claire] follow-up generation failed", {
      failureReason,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    const diagnostic: ClaireGenerationDiagnostic = {
      kind: "follow_up",
      source: "fallback",
      failureReason,
      modelRequested: claireModelId(),
      modelServed,
      promptSize: promptSize ?? undefined,
      surface,
      stopReason,
      answerOrigin: "fallback",
      trimmedToSentenceBoundary: null,
    };
    await recordGeneration({
      tenantId: input.tenantId,
      diagnostic,
      latencyMs: Date.now() - startedAt,
      reviewDetail: {
        operatorUserId: input.context.actorId ?? null,
        generatedText: fallback,
        compiled,
        businessContextSummary: input.context.businessDate,
      },
    });
    input.onGeneration?.(diagnostic);
    return fallback;
  }
}
