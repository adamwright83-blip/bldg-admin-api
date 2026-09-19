import type { invokeTextLLM } from "../../_core/llm";
import { claireModelId, claireModelRequest } from "../claireModel";
import { compileClaireContextForOperator } from "../character/relationshipHistory";
import { measureClairePromptSections } from "../answerPathTelemetry";
import { VOICE_NATIVE_ANSWER_GUIDANCE, type ClaireGenerationSurface } from "../conversationVoiceGuidance";
import type { recordClaireGeneration, ClaireGenerationDiagnostic } from "../generationTelemetry";
import { trimToSentenceBoundary } from "../textTrim";
import { getProgressionStore } from "./drizzleStore";
import { buildPersonalDisclosureGuidance, executePersonalTurn, type PersonalTurnResult } from "./personalReveal";
import { syncProgressionForOperator } from "./evidenceSources";
import { stashPendingDisclosure } from "./pendingReceipts";
import type { ProgressionStore } from "./store";

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
    /** When set, a new disclosure is NOT committed here; the caller commits at its delivery boundary. */
    onPersonalReceipt?: (receipt: NonNullable<PersonalTurnResult["receipt"]>) => void;
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

  const result = await executePersonalTurn({
    store,
    scope: { tenantId: input.tenantId, operatorUserId: input.operatorUserId },
    conversationId: input.conversationId,
    topic: input.topic,
    businessOpen: input.businessOpen,
    random: dependencies.random,
    now: dependencies.now,
    // Never commit inside generation: the disclosure is recorded only once delivery is confirmed.
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
          ...(input.recentTurns ?? []).slice(-6).map(turn => ({
            role: (turn.speaker === "claire" ? "assistant" : "user") as "assistant" | "user",
            content: turn.text,
          })),
          { role: "user", content: input.utterance.slice(0, 1_000) },
        ],
      });
      return trimToSentenceBoundary(text.trim(), 1_200);
    },
  });

  if (result.receipt) {
    if (input.onPersonalReceipt) input.onPersonalReceipt(result.receipt);
    else stashPendingDisclosure(input.conversationId, result.receipt);
  }
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
