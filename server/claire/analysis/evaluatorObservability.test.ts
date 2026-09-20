import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateConversationQualitative, extractEvaluationJson, looksTruncated, MalformedConversationEvaluationError } from "./conversationEvaluator";
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

describe("evaluator repair: one bounded retry, failure stays visible", () => {
  const ok = () =>
    JSON.stringify({
      conversationPurpose: "Plan tomorrow", operatorObjective: "Add a walk", objectiveUnderstood: "YES",
      objectiveUnderstandingScore: 8, summary: "s", usefulNextStepReached: true, operatorCorrections: 0,
      operatorReexplanations: 0, unnecessaryQuestions: 0, possibleUnsupportedClaims: 0,
      possibleMisunderstandings: [], productFriction: [], missingCapabilities: [], unresolvedQuestions: [],
      notableMoments: [], recommendedProductReview: false, reviewReason: null, strategyQuality: 7,
      conversationEfficiency: 7, truthfulnessConfidence: 8,
    });
  // The exact production failure: the tail fields are cut off by the token cap.
  const truncated = ok().slice(0, ok().indexOf('"notableMoments"'));
  const seq = (...bodies: string[]) => {
    let i = 0;
    return (async () => ({ choices: [{ message: { content: bodies[Math.min(i++, bodies.length - 1)] } }] })) as never;
  };

  it("valid JSON succeeds on the first attempt", async () => {
    await expect(evaluateConversationQualitative({ ...base, invoke: seq(ok()) })).resolves.toMatchObject({ objectiveUnderstood: "YES" });
  });

  it("fenced JSON succeeds", async () => {
    await expect(evaluateConversationQualitative({ ...base, invoke: seq("```json\n" + ok() + "\n```") })).resolves.toBeTruthy();
  });

  it("REPRODUCTION: truncated tail fields are repaired by one retry", async () => {
    const invoke = vi.fn(seq(truncated, ok()));
    await expect(evaluateConversationQualitative({ ...base, invoke: invoke as never })).resolves.toBeTruthy();
    expect(invoke).toHaveBeenCalledTimes(2);
    // The retry gets more room than the first attempt.
    expect((invoke.mock.calls[1][0] as { maxTokens: number }).maxTokens).toBeGreaterThan((invoke.mock.calls[0][0] as { maxTokens: number }).maxTokens);
  });

  it("invalid first + invalid repair is an explicit failure, with attempts recorded", async () => {
    const invoke = vi.fn(seq(truncated, truncated));
    await expect(evaluateConversationQualitative({ ...base, invoke: invoke as never })).rejects.toMatchObject({
      // Truncated output fails at parse, not schema — the category reflects that accurately.
      category: "invalid_json",
      diagnostics: { attempts: 2, truncated: true },
    });
    expect(invoke).toHaveBeenCalledTimes(2); // bounded: never a loop
  });

  it("detects truncation from unclosed JSON and from a max_tokens stop reason", () => {
    expect(looksTruncated(truncated, null)).toBe(true);
    expect(looksTruncated(ok(), null)).toBe(false);
    expect(looksTruncated(ok(), "max_tokens")).toBe(true);
  });

  it("evaluator failure never becomes success and never touches business truth", async () => {
    const session = await createConversationSession({ tenantId: "t", operatorUserId: "adam", claireConversationId: "c9", conversationKind: "evening_planning", recordingEnabled: false, providerCallSid: "CA-9" });
    const outcome = await runConversationAnalysis(session.id, {
      evaluate: async () => { throw new MalformedConversationEvaluationError("schema_mismatch", "notableMoments", { attempts: 2, stopReason: "max_tokens", truncated: true }); },
    });
    expect(outcome.ok).toBe(false);
    expect((await productionConversationStore().getSession(session.id))?.analysisStatus).toBe("failed");
    expect(evaluatorStats()).toMatchObject({ successes: 0, failures: 1 });
  });
});
