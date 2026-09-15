import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const evaluatorMocks = vi.hoisted(() => ({
  evaluate: vi.fn(),
}));

vi.mock("../analysis/conversationEvaluator", async importOriginal => {
  const actual = await importOriginal<typeof import("../analysis/conversationEvaluator")>();
  return {
    ...actual,
    evaluateConversationQualitative: evaluatorMocks.evaluate,
  };
});
import { qualitativeEvaluationSchema, researchFlagFor, type QualitativeEvaluation } from "../analysis/conversationAnalysisSchema";
import { runConversationAnalysis } from "../analysis/conversationAnalysisService";
import { renderCopyAnalysisBundle, renderFullTranscript } from "../analysis/copyBundle";
import {
  getClaireCallAnalysis,
  markClaireCallAnalysisWrong,
  requireClaireCallSession,
} from "./conversationQuery";
import {
  createConversationSession,
  persistSpokenTurn,
  productionConversationStore,
  turnIdempotencyKey,
} from "./ledgerService";
import {
  createMemoryClaireConversationStore,
  setClaireConversationStoreForTesting,
} from "./memoryStore";
import {
  finishConversationAndMaybeAnalyze,
  handleCallCompleted,
  handleRecordingStatus,
} from "./pipeline";
import { POST_CALL_TRANSCRIPT_SOURCE } from "./types";
import { isValidTwilioWebhook } from "./twilioSignature";

const evaluationFixture = (overrides: Partial<QualitativeEvaluation> = {}): QualitativeEvaluation =>
  qualitativeEvaluationSchema.parse({
    conversationPurpose: "Plan tomorrow",
    operatorObjective: "Add a Greystar walk",
    objectiveUnderstood: "YES",
    objectiveUnderstandingScore: 8,
    summary: "Adam asked Claire to add a Greystar walk for tomorrow.",
    usefulNextStepReached: true,
    operatorCorrections: 0,
    operatorReexplanations: 0,
    unnecessaryQuestions: 0,
    possibleUnsupportedClaims: 0,
    possibleMisunderstandings: [],
    productFriction: [],
    missingCapabilities: [],
    unresolvedQuestions: [],
    notableMoments: [
      {
        kind: "accepted_action",
        summary: "Claire added the walk",
        turnOrdinal: 2,
        excerpt: "Add a Greystar walk tomorrow",
      },
    ],
    recommendedProductReview: false,
    reviewReason: null,
    strategyQuality: 8,
    conversationEfficiency: 8,
    truthfulnessConfidence: 8,
    ...overrides,
  });

beforeEach(() => {
  setClaireConversationStoreForTesting(createMemoryClaireConversationStore());
  evaluatorMocks.evaluate.mockReset();
  evaluatorMocks.evaluate.mockResolvedValue(evaluationFixture());
});

afterEach(() => {
  setClaireConversationStoreForTesting(null);
  vi.unstubAllGlobals();
});

describe("Claire conversation ledger", () => {
  it("skips empty SpeechResult and attributes speakers without an LLM", async () => {
    const session = await createConversationSession({
      tenantId: "tenant-1",
      operatorUserId: "adam",
      claireConversationId: "conv-1",
      conversationKind: "evening_planning",
      recordingEnabled: false,
      providerCallSid: "CA123",
    });
    expect(await persistSpokenTurn({ callSid: "CA123", speaker: "OPERATOR", text: "   " })).toBeNull();
    const operator = await persistSpokenTurn({
      callSid: "CA123",
      speaker: "OPERATOR",
      text: "Add a Greystar walk tomorrow",
    });
    const claire = await persistSpokenTurn({
      callSid: "CA123",
      speaker: "CLAIRE",
      text: "Added: Greystar walk. What else?",
    });
    const turns = await productionConversationStore().listTurns(session.id);
    expect(turns).toHaveLength(2);
    expect(operator?.source).toBe("twilio_speech_result");
    expect(claire?.source).toBe("goldline_generated_speech");
    expect(turns.map(turn => turn.speaker)).toEqual(["OPERATOR", "CLAIRE"]);
  });

  it("is idempotent when Twilio retries the same spoken turn", async () => {
    await createConversationSession({
      tenantId: "tenant-1",
      operatorUserId: "adam",
      claireConversationId: "conv-2",
      conversationKind: "pre_drive",
      recordingEnabled: false,
      providerCallSid: "CA456",
    });
    const first = await persistSpokenTurn({
      callSid: "CA456",
      speaker: "OPERATOR",
      text: "yes",
    });
    const retry = await persistSpokenTurn({
      callSid: "CA456",
      speaker: "OPERATOR",
      text: "yes",
    });
    expect(retry?.id).toBe(first?.id);
    expect(turnIdempotencyKey({ callSid: "CA456", speaker: "OPERATOR", text: "yes" })).toHaveLength(64);
    const turns = await productionConversationStore().listTurns(first!.sessionId);
    expect(turns).toHaveLength(1);
  });

  it("keeps Whisper post-call audio from overwriting live turns", async () => {
    const session = await createConversationSession({
      tenantId: "tenant-1",
      operatorUserId: "adam",
      claireConversationId: "conv-3",
      conversationKind: "pre_drive",
      recordingEnabled: true,
      providerCallSid: "CA789",
    });
    await persistSpokenTurn({
      callSid: "CA789",
      speaker: "CLAIRE",
      text: "Adam. Claire here. Let's plan tomorrow.",
    });
    const store = productionConversationStore();
    await store.insertTranscript({
      sessionId: session.id,
      source: POST_CALL_TRANSCRIPT_SOURCE,
      provider: "whisper",
      providerVersion: "whisper-1",
      text: "misattributed blob that must not replace live turns",
      payload: null,
    });
    const turns = await store.listTurns(session.id);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.text).toContain("Adam. Claire here.");
    expect((await store.getTranscript(session.id, POST_CALL_TRANSCRIPT_SOURCE))?.text).toContain(
      "misattributed blob"
    );
  });

  it("analyzes the live ledger when recording is skipped or absent", async () => {
    const skipped = await createConversationSession({
      tenantId: "tenant-1",
      operatorUserId: "adam",
      claireConversationId: "conv-4",
      conversationKind: "pre_drive",
      recordingEnabled: false,
      providerCallSid: "CA-skip",
    });
    await persistSpokenTurn({
      callSid: "CA-skip",
      speaker: "OPERATOR",
      text: "I'm good",
    });
    await finishConversationAndMaybeAnalyze({
      callSid: "CA-skip",
      reason: "closing_phrase",
    });
    const analyzed = await productionConversationStore().getAnalysis(skipped.id);
    expect(evaluatorMocks.evaluate).toHaveBeenCalled();
    expect(analyzed?.copyBundleText).toContain("FULL TRANSCRIPT AVAILABLE IN GOLDLINE");
    expect(analyzed?.copyBundleText.toLowerCase()).not.toMatch(/chatgpt|openai|copy for chatgpt/);

    const absent = await createConversationSession({
      tenantId: "tenant-1",
      operatorUserId: "adam",
      claireConversationId: "conv-5",
      conversationKind: "pre_drive",
      recordingEnabled: true,
      providerCallSid: "CA-absent",
    });
    await persistSpokenTurn({
      callSid: "CA-absent",
      speaker: "CLAIRE",
      text: "Drive safe.",
    });
    await finishConversationAndMaybeAnalyze({
      callSid: "CA-absent",
      reason: "remote_hangup",
    });
    expect((await productionConversationStore().getSession(absent.id))?.analysisStatus).toBe(
      "pending"
    );
    await handleRecordingStatus({
      callSid: "CA-absent",
      recordingSid: "RE-missing",
      recordingStatus: "absent",
      accountSid: "AC",
      authToken: "token",
    });
    expect((await productionConversationStore().getSession(absent.id))?.recordingStatus).toBe(
      "failed"
    );
    expect((await productionConversationStore().getAnalysis(absent.id))?.sessionId).toBe(absent.id);
  });

  it("creates a Claire Call Analysis Ready inbox item after evaluation", async () => {
    const session = await createConversationSession({
      tenantId: "tenant-1",
      operatorUserId: "adam",
      claireConversationId: "conv-6",
      conversationKind: "evening_planning",
      recordingEnabled: false,
      providerCallSid: "CA-notify",
    });
    await persistSpokenTurn({
      callSid: "CA-notify",
      speaker: "OPERATOR",
      text: "Plan tomorrow",
    });
    await finishConversationAndMaybeAnalyze({ callSid: "CA-notify", reason: "closing_phrase" });
    await runConversationAnalysis(session.id, {
      evaluate: async () => evaluationFixture(),
    });
    const inbox = await productionConversationStore().listNotifications({
      tenantId: "tenant-1",
      operatorUserId: "adam",
    });
    expect(inbox[0]?.title).toBe("Claire Call Analysis Ready");
    expect(inbox[0]?.ctaLabel).toBe("VIEW ANALYSIS");
    expect(inbox[0]?.href).toBe(`/claire/calls/${session.id}`);
  });

  it("does not let the evaluator rewrite live turns and flags high-value examples", async () => {
    const session = await createConversationSession({
      tenantId: "tenant-1",
      operatorUserId: "adam",
      claireConversationId: "conv-7",
      conversationKind: "evening_planning",
      recordingEnabled: false,
      providerCallSid: "CA-eval",
    });
    await persistSpokenTurn({
      callSid: "CA-eval",
      speaker: "OPERATOR",
      text: "Add the walk",
    });
    const store = productionConversationStore();
    await store.updateSession(session.id, { relatedActionIds: ["commitment-1"] });
    await runConversationAnalysis(session.id, {
      evaluate: async () => evaluationFixture(),
    });
    const turns = await store.listTurns(session.id);
    expect(turns[0]?.text).toBe("Add the walk");
    const analysis = await store.getAnalysis(session.id);
    expect(analysis?.researchFlag).toBe("HIGH_VALUE_EXAMPLE");
    expect(analysis?.acceptedActionCount).toBe(1);
    expect(
      researchFlagFor({
        evaluation: evaluationFixture({ operatorCorrections: 1 }),
        acceptedActionCount: 0,
        usefulNextStepReached: false,
      })
    ).toBe("REVIEW_RECOMMENDED");
  });

  it("isolates analysis lookups by tenant/operator and refuses to rewrite the transcript", async () => {
    const session = await createConversationSession({
      tenantId: "tenant-1",
      operatorUserId: "adam",
      claireConversationId: "conv-8",
      conversationKind: "pre_drive",
      recordingEnabled: false,
      providerCallSid: "CA-iso",
    });
    await persistSpokenTurn({
      callSid: "CA-iso",
      speaker: "CLAIRE",
      text: "Drive safe.",
    });
    await runConversationAnalysis(session.id, {
      evaluate: async () => evaluationFixture(),
    });
    await expect(
      requireClaireCallSession({
        tenantId: "other-tenant",
        operatorUserId: "adam",
        isAdmin: true,
        sessionId: session.id,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      requireClaireCallSession({
        tenantId: "tenant-1",
        operatorUserId: "intruder",
        isAdmin: false,
        sessionId: session.id,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const visible = await getClaireCallAnalysis({
      tenantId: "tenant-1",
      operatorUserId: "adam",
      isAdmin: false,
      callSid: "CA-iso",
    });
    expect(visible.session).not.toHaveProperty("recordingProviderUrl");
    expect(visible.fullTranscriptText).toContain("CLAIRE: Drive safe.");
    const disputed = await markClaireCallAnalysisWrong({
      tenantId: "tenant-1",
      operatorUserId: "adam",
      isAdmin: false,
      sessionId: session.id,
      note: "Claire did understand the Greystar walk.",
    });
    expect(disputed.transcriptUnchanged).toBe(true);
    expect(disputed.analysis?.humanFeedbackKind).toBe("analysis_is_wrong");
    expect((await productionConversationStore().listTurns(session.id))[0]?.text).toBe(
      "Drive safe."
    );
  });

  it("renders a provider-neutral COPY ANALYSIS bundle from live turns", () => {
    const bundle = renderCopyAnalysisBundle({
      session: {
        id: "s1",
        tenantId: "t",
        operatorUserId: "adam",
        provider: "twilio",
        providerCallSid: "CA",
        claireConversationId: "c",
        conversationKind: "evening_planning",
        missionId: null,
        relatedActionIds: [],
        status: "complete",
        completionReason: "closing_phrase",
        recordingStatus: "skipped",
        transcriptionStatus: "skipped",
        analysisStatus: "complete",
        notificationStatus: "sent",
        recordingConsent: "disabled",
        recordingSid: null,
        recordingDurationSeconds: null,
        recordingChannels: null,
        recordingTrack: null,
        recordingProviderUrl: null,
        audioStorageProvider: null,
        audioStorageKey: null,
        audioCompletedAt: null,
        audioRetainUntil: null,
        transcriptRetainUntil: null,
        analysisRetainUntil: null,
        claireCompilerVersion: "1",
        claireCharacterVersion: "1",
        llmModel: "unused",
        voiceProvider: "twilio_polly",
        voiceName: "Polly.Ruth-Generative",
        gitSha: "abc",
        frontendRelease: null,
        startedAt: "2026-09-14T12:00:00.000Z",
        endedAt: "2026-09-14T12:04:00.000Z",
      },
      evaluation: evaluationFixture(),
      turns: [
        {
          id: 1,
          sessionId: "s1",
          ordinal: 1,
          speaker: "OPERATOR",
          text: "Add a Greystar walk",
          source: "twilio_speech_result",
          idempotencyKey: "k",
          providerMetadata: null,
          occurredAt: "2026-09-14T12:00:10.000Z",
        },
      ],
      acceptedActionCount: 1,
      completedActionCount: 0,
      outcomeCount: 0,
      needsDetails: [],
    });
    expect(bundle).toContain("CLAIRE CALL ANALYSIS");
    expect(bundle).toContain("FULL TRANSCRIPT AVAILABLE IN GOLDLINE");
    expect(bundle).not.toMatch(/ChatGPT|GPT|Claude\.ai/i);
    expect(renderFullTranscript([
      {
        id: 1,
        sessionId: "s1",
        ordinal: 1,
        speaker: "OPERATOR",
        text: "Add a Greystar walk",
        source: "twilio_speech_result",
        idempotencyKey: "k",
        providerMetadata: null,
        occurredAt: "2026-09-14T12:00:10.000Z",
      },
    ])).toBe("ADAM: Add a Greystar walk");
  });
});

describe("Twilio recording signature and hangup completion", () => {
  it("rejects unsigned recording callbacks in production", () => {
    expect(
      isValidTwilioWebhook({
        authToken: "secret",
        signature: undefined,
        urls: ["https://api.example.test/api/claire/twilio/recording-status"],
        body: { CallSid: "CA1" },
        nodeEnv: "production",
      })
    ).toBe(false);
    expect(
      isValidTwilioWebhook({
        authToken: "",
        signature: undefined,
        urls: ["https://api.example.test/api/claire/twilio/recording-status"],
        body: {},
        nodeEnv: "production",
      })
    ).toBe(false);
  });

  it("completes a hung-up call from Twilio call-status without deleting turns", async () => {
    setClaireConversationStoreForTesting(createMemoryClaireConversationStore());
    const session = await createConversationSession({
      tenantId: "tenant-1",
      operatorUserId: "adam",
      claireConversationId: "conv-hangup",
      conversationKind: "pre_drive",
      recordingEnabled: false,
      providerCallSid: "CA-hangup",
    });
    await persistSpokenTurn({
      callSid: "CA-hangup",
      speaker: "OPERATOR",
      text: "wait",
    });
    await handleCallCompleted({ callSid: "CA-hangup", callStatus: "completed" });
    const latest = await productionConversationStore().getSession(session.id);
    expect(latest?.status).toBe("complete");
    expect(latest?.completionReason).toBe("remote_hangup");
    expect(await productionConversationStore().listTurns(session.id)).toHaveLength(1);
  });
});

describe("Goldline-owned evaluator boundary", () => {
  it("does not import relationship emitters or Day Director writes", () => {
    const evaluator = readFileSync(new URL("../analysis/conversationEvaluator.ts", import.meta.url), "utf8");
    const service = readFileSync(new URL("../analysis/conversationAnalysisService.ts", import.meta.url), "utf8");
    const page = readFileSync(
      new URL("../../../client/src/pages/goldline/ClaireCallAnalysis.tsx", import.meta.url),
      "utf8"
    );
    expect(evaluator).not.toMatch(/relationshipEmitters|acceptProposal|updateDayDirectorCommitment/);
    expect(service).not.toMatch(/acceptProposal|recordClaire|updateDayDirectorCommitment/);
    expect(page).toContain("COPY ANALYSIS");
    expect(page).not.toMatch(/ChatGPT|Copy for ChatGPT/i);
  });
});
