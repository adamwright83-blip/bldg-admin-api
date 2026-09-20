import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateConversationQualitative, extractEvaluationJson, MalformedConversationEvaluationError } from "./conversationEvaluator";
import { runConversationAnalysis } from "./conversationAnalysisService";
import { evaluatorStats, resetEvaluatorStatsForTests } from "./evaluatorStats";
import { createConversationSession, productionConversationStore } from "../conversation/ledgerService";
import { createMemoryClaireConversationStore, setClaireConversationStoreForTesting } from "../conversation/memoryStore";

const base = { tenantId: "t", conversationKind: "evening_planning", liveTranscript: "1. ADAM: hi", deterministic: { durationLabel: "1m", turnCount: 1, acceptedActionCount: 0, completedActionCount: 0, needsDetails: [] } };
const llm = (content: unknown) => (async () => ({ choices: [{ message: { content } }] })) as never;

beforeEach(() => {
  resetEvaluatorStatsForTests();
  setClaireConversationStoreForTesting(createMemoryClaireConversationStore());
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  setClaireConversationStoreForTesting(null);
  vi.restoreAllMocks();
});

describe("evaluator malformed output", () => {
  it("categorises the failure instead of throwing a bare message", async () => {
    await expect(evaluateConversationQualitative({ ...base, invoke: llm("not json") })).rejects.toMatchObject({ category: "invalid_json" });
    await expect(evaluateConversationQualitative({ ...base, invoke: llm("") })).rejects.toMatchObject({ category: "empty_output" });
    await expect(evaluateConversationQualitative({ ...base, invoke: llm(JSON.stringify({ summary: "x" })) })).rejects.toMatchObject({ category: "schema_mismatch" });
  });

  it("tolerates a code-fenced JSON body rather than failing the whole evaluation", () => {
    expect(extractEvaluationJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => extractEvaluationJson("nope")).toThrow(MalformedConversationEvaluationError);
  });

  it("records a malformed evaluation as a visible failure, not a pass and not silence", async () => {
    const session = await createConversationSession({ tenantId: "t", operatorUserId: "adam", claireConversationId: "c1", conversationKind: "evening_planning", recordingEnabled: false, providerCallSid: "CA-x" });
    const outcome = await runConversationAnalysis(session.id, {
      evaluate: async () => {
        throw new MalformedConversationEvaluationError("schema_mismatch", "summary, truthfulnessConfidence");
      },
    });
    expect(outcome).toEqual({ ok: false, reason: "evaluator_failed:schema_mismatch" });
    expect((await productionConversationStore().getSession(session.id))?.analysisStatus).toBe("failed");
    expect(evaluatorStats()).toMatchObject({ attempts: 1, successes: 0, failures: 1, failureRate: 1, byReason: { schema_mismatch: 1 } });
  });
});
