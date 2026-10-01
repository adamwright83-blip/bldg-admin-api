import type { invokeTextLLM } from "../../_core/llm";
import { claireModelId, claireModelRequest } from "../claireModel";
import { compileClaireContextForOperator } from "../character/relationshipHistory";
import { measureClairePromptSections } from "../answerPathTelemetry";
import { VOICE_NATIVE_ANSWER_GUIDANCE, type ClaireGenerationSurface } from "../conversationVoiceGuidance";
import type { recordClaireGeneration, ClaireGenerationDiagnostic } from "../generationTelemetry";
import { trimToSentenceBoundary } from "../textTrim";
import { getProgressionStore } from "./drizzleStore";
import { ENTAILMENT_VERIFIER_INSTRUCTION, parseVerifierReply } from "./personalEntailment";
import { buildPersonalDisclosureGuidance, executePersonalTurn, type PersonalTurnResult } from "./personalReveal";
import { syncProgressionForOperator } from "./evidenceSources";
import type { ProgressionStore } from "./store";
import { isEllipticalTemporalOrSocialFollowUp, isPersonalInvitation } from "../topicDetection";

/**
 * The live personal-answer path. Replaces the old "generate against a tier's
 * worth of canon, then canon-render on failure" flow: the server decides
 * (controller), the model only phrases the one bounded fragment, and every
 * failure becomes an approved decline. There is no read-aloud canon fallback.
 */
export async function answerPersonalFollowUp(
  input: {
    tenantId: string;
    operatorUserId: string;
    conversationId: string;
    topic: string | null;
    utterance: string;
    recentTurns?: Array<{ speaker: "operator" | "claire"; text: string }>;
    businessOpen: boolean;
    surface: ClaireGenerationSurface;
    onGeneration?: (diagnostic: ClaireGenerationDiagnostic) => void;
    onPersonalTurn?: (result: PersonalTurnResult) => void;
  },
  dependencies: {
    invokeText: typeof invokeTextLLM;
    recordGeneration: typeof recordClaireGeneration;
    progressionStore?: ProgressionStore;
    random?: () => number;
    now?: () => Date;
    /** Pull fresh paid-order progress first. Defaults on for production, off for injected test stores. */
    syncProgression?: boolean;
  }
): Promise<string> {
  const startedAt = Date.now();
  const store = dependencies.progressionStore ?? getProgressionStore();
  let modelServed: string | null = null;
  let stopReason: string | null = null;
  let promptSize: ReturnType<typeof measureClairePromptSections> | null = null;
  let compiledForRecord: Awaited<ReturnType<typeof compileClaireContextForOperator>> | null = null;

  if (dependencies.syncProgression ?? !dependencies.progressionStore) {
    await syncProgressionForOperator({ tenantId: input.tenantId, operatorUserId: input.operatorUserId });
  }

  // Anaphoric invitation follow-up referent preservation (e.g. "On Saturday evening?" after drink invitation)
  const isElliptical = isEllipticalTemporalOrSocialFollowUp(input.utterance);
  const priorOperatorTurn = input.recentTurns
    ? [...input.recentTurns].reverse().find(t => t.speaker === "operator")
    : null;
  const isInvitationFollowUp = Boolean(
    isElliptical && priorOperatorTurn && isPersonalInvitation(priorOperatorTurn.text)
  );

  if (isInvitationFollowUp) {
    const grant = await store.getGrant({ tenantId: input.tenantId, operatorUserId: input.operatorUserId });
    const band = grant?.rapportBand ?? 0;
    const rung = grant?.personalRung ?? 0;
    const base = {
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      conversationId: input.conversationId,
      rungAtTime: rung,
      rapportBandAtTime: band,
    };
    await store.appendLedger({
      ...base,
      kind: "asked",
      topic: "invitation_follow_up",
      fragmentId: null,
      entitlementId: null,
      declineId: null,
      failureReason: null,
      hadUnusedEntitlement: null,
      failurePhase: null,
    });
    await store.appendLedger({
      ...base,
      kind: "decline_fallback",
      topic: "invitation_follow_up",
      fragmentId: null,
      entitlementId: null,
      declineId: "invitation_referent_decline",
      failureReason: "invitation_refusal",
      hadUnusedEntitlement: false,
      failurePhase: null,
    });

    const timeToken = input.utterance
      .trim()
      .replace(/[?!.,]+$/g, "")
      .replace(/^(?:on|at|around|for|by|in|what about|how about|maybe)\s+/i, "");
    const timePhrase = timeToken ? `${timeToken} or otherwise` : "either way";
    const operationalReturn = input.businessOpen
      ? "We still have items on today's line."
      : "Let me know what you need on the line.";

    let text: string;
    if (band >= 2) {
      text = `Still no on drinks, ${timePhrase}. You're persistent though. ${operationalReturn}`;
    } else {
      text = `Still no, ${timePhrase}. ${operationalReturn}`;
    }

    input.onPersonalTurn?.({
      text,
      outcome: "declined",
      plan: {
        kind: "decline",
        reason: "no_canon_for_topic",
        closeThread: false,
        eligibleFragmentId: null,
        hadUnusedEntitlement: false,
      },
      declineId: "invitation_referent_decline",
      failureReason: "invitation_refusal",
      fragmentId: null,
      closedThread: false,
      endCall: false,
      returnToBusiness: input.businessOpen,
      receipt: null,
    });

    const diagnostic: ClaireGenerationDiagnostic = {
      kind: "follow_up",
      source: "fallback",
      answerOrigin: "fallback",
      failureReason: "personal_decline:invitation_follow_up",
      modelRequested: claireModelId(),
      modelServed: null,
      surface: input.surface,
      stopReason: null,
      trimmedToSentenceBoundary: false,
    };
    await dependencies.recordGeneration({
      tenantId: input.tenantId,
      diagnostic,
      latencyMs: Date.now() - startedAt,
      reviewDetail: {
        operatorUserId: input.operatorUserId,
        generatedText: text,
        compiled: await compileClaireContextForOperator({
          tenantId: input.tenantId,
          operatorUserId: input.operatorUserId,
          mode: "personal",
          progressionStore: store,
          boundedCanonFragmentIds: [],
        }),
        businessContextSummary: "personal_invitation_follow_up",
      },
    });
    input.onGeneration?.(diagnostic);
    return text;
  }

  const result = await executePersonalTurn({
    store,
    scope: { tenantId: input.tenantId, operatorUserId: input.operatorUserId },
    conversationId: input.conversationId,
    topic: input.topic,
    businessOpen: input.businessOpen,
    verify: async ({ allowedFacts, answer }) => {
      const reply = await dependencies.invokeText({
        tenantId: input.tenantId,
        ...claireModelRequest(0),
        maxTokens: 8,
        messages: [
          { role: "system", content: ENTAILMENT_VERIFIER_INSTRUCTION },
          { role: "user", content: JSON.stringify({ authorizedFacts: allowedFacts, answer }) }, // the answer is quoted data, never instructions
        ],
      });
      return parseVerifierReply(reply);
    },
    random: dependencies.random,
    now: dependencies.now,
    // Never commit inside generation: the reservation is durable and is committed at the delivery
    // boundary (the next verified turn of this call) by commitPendingDisclosuresForConversation.
    autoCommit: false,
    generate: async request => {
      const compiled = await compileClaireContextForOperator({
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
        mode: "personal",
        topic: input.topic ?? undefined,
        progressionStore: store,
        boundedCanonFragmentIds: [request.fragment.id],
      });
      compiledForRecord = compiled;
      const sections = [
        { label: "compiled_canon", text: compiled.promptSection },
        { label: "personal_disclosure_guidance", text: buildPersonalDisclosureGuidance(request) },
        { label: "delivery_voice", text: input.surface === "voice" ? VOICE_NATIVE_ANSWER_GUIDANCE : null },
      ];
      promptSize = measureClairePromptSections("follow_up", sections);
      const text = await dependencies.invokeText({
        tenantId: input.tenantId,
        ...claireModelRequest(0.7),
        maxTokens: 400,
        onStopReason: reason => { stopReason = reason; },
        onModelServed: model => { modelServed = model; },
        messages: [
          { role: "system", content: sections.map(section => section.text).filter(Boolean).join(" ") },
          { role: "user", content: input.utterance.slice(0, 1_000) },
        ],
      });
      return trimToSentenceBoundary(text.trim(), 1_200);
    },
  });

  input.onPersonalTurn?.(result);

  const declined = result.outcome === "declined";
  const diagnostic: ClaireGenerationDiagnostic = {
    kind: "follow_up",
    source: declined ? "fallback" : "model",
    answerOrigin: declined ? "fallback" : "model",
    failureReason: declined ? `personal_decline:${result.failureReason ?? "policy"}` : null,
    modelRequested: claireModelId(),
    modelServed,
    promptSize: promptSize ?? undefined,
    surface: input.surface,
    stopReason,
    trimmedToSentenceBoundary: false,
  };
  await dependencies.recordGeneration({
    tenantId: input.tenantId,
    diagnostic,
    latencyMs: Date.now() - startedAt,
    reviewDetail: {
      operatorUserId: input.operatorUserId,
      generatedText: result.text,
      compiled:
        compiledForRecord ??
        (await compileClaireContextForOperator({
          tenantId: input.tenantId,
          operatorUserId: input.operatorUserId,
          mode: "personal",
          topic: input.topic ?? undefined,
          progressionStore: store,
          boundedCanonFragmentIds: [],
        })),
      businessContextSummary: "personal_turn",
    },
  });
  input.onGeneration?.(diagnostic);
  return result.text;
}
