import { describe, expect, it, vi } from "vitest";
import {
  answerClaireBusinessTurn,
  type ClaireAnalyticsState,
} from "../../claire/businessConversation";
import {
  analyzeBusinessData,
  type BusinessAnalysisEvidence,
  type AnalysisSession,
} from "./analyzeBusinessData";
import { syntheticAnalysisDataset } from "./acceptanceFixture";
import { executeAnalysisQuery } from "./sandbox";
import {
  receiptFromAnalysis,
  verifyPriorClaim,
} from "../../claire/provenance/claimReceipts";
import {
  runShowrunnerTurn,
  type ShowrunnerCallState,
} from "../../claire/showrunner/showrunnerTurn";

const d = syntheticAnalysisDataset(),
  now = new Date(d.generatedAt);
const session: AnalysisSession = {
  tenantId: d.tenantId,
  touchedAt: now.getTime(),
  questions: ["Which weekly customers stopped?"],
  results: [],
  customerIds: ["cust_fixture7", "cust_fixture6"],
  customers: [d.customerRefs.cust_fixture7!, d.customerRefs.cust_fixture6!],
};
const evidence: BusinessAnalysisEvidence = {
  kind: "evidence",
  answer: "Two observed candidate identities.",
  results: [],
  citedReceiptIds: [],
  limitations: d.limitations,
  session,
};
const showrunner = (): ShowrunnerCallState => ({
  purpose: "desk_planning",
  tenantId: d.tenantId,
  canonicalOperatorId: "fixture-op",
  operatorUserId: "fixture",
  dayDirectorActorId: "fixture",
  dayDirectorActorIds: ["fixture"],
  timeZone: d.window.timeZone,
  businessDate: "2026-10-14",
  briefing: {
    purpose: "desk_planning",
    businessDate: "2026-10-14",
    weekday: "Wednesday",
    objective: "Recover repeat customers",
    weekPlan: null,
    today: [],
    tomorrow: [],
    developments: [],
    pendingDecision: null,
    adaptations: [],
    uncertain: [],
    weekToDate: { reportedOutcomes: [], planChanges: [] },
  },
  captured: { missionUpdates: [], developments: [], readinessNeeds: [] },
  replan: null,
  turns: 0,
});

describe("shared Claire analysis continuity and authority", () => {
  it("routes unfamiliar analytical directives without requiring a question prefix or a registered metric", async () => {
    const analyze = vi.fn(async () => evidence);
    const result = await answerClaireBusinessTurn(
      {
        tenantId: d.tenantId,
        utterance:
          "For Laundry Farm customers with at least four positive paid orders, calculate ordering consistency as population variance of consecutive gaps divided by squared mean gap. Return ten candidates as evidence.",
        state: {},
        surface: "text",
      },
      {
        now: () => now,
        timeZone: () => d.window.timeZone,
        analyze,
        planCalculation: async () => null,
      }
    );
    expect(analyze).toHaveBeenCalledOnce();
    expect(result.handled && result.reader).toBe("analysis");
  });
  it("carries customer identities and refinements without calling any fixed query or action port", async () => {
    const state: ClaireAnalyticsState = {};
    const analyze = vi.fn(async () => evidence),
      runQuery = vi.fn();
    for (const utterance of [
      "Which customers used to order weekly but stopped?",
      "Exclude anyone with an outstanding order.",
      "Only Silver Lake.",
      "What did the first one order last time?",
    ]) {
      const result = await answerClaireBusinessTurn(
        { tenantId: d.tenantId, utterance, state, surface: "text" },
        {
          now: () => now,
          timeZone: () => d.window.timeZone,
          analyze,
          runQuery,
          planCalculation: async () => null,
        }
      );
      expect(result.handled && result.reader).toBe("analysis");
    }
    expect(analyze.mock.calls[1]![0].previous).toEqual(session);
    expect(state.analytics?.focus?.population).toEqual(session.customers);
    expect(runQuery).not.toHaveBeenCalled();
  });
  it("analytical OPEN COMMS turns cannot create plan edits, record developments, approve or execute", async () => {
    const record = vi.fn(),
      approve = vi.fn(),
      deskReplan = vi.fn();
    const result = await runShowrunnerTurn({
      state: showrunner(),
      history: [],
      utterance: "Which weekly customers stopped?",
      sourceEventId: "test",
      conversationKey: "test",
      now,
      record,
      approve,
      deskReplan,
      business: {
        analyze: async () => evidence,
        planCalculation: async () => null,
      },
    });
    expect(result.speak).toContain("candidate");
    expect(result.state.businessAnalysis).toEqual(session);
    expect(record).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
    expect(deskReplan).not.toHaveBeenCalled();
  });
  it("explicitly selected contacts become one exact pending revision and require the existing approval", async () => {
    const state = showrunner();
    state.businessAnalysis = session;
    const deskReplan = vi.fn(async () => ({
      proposalId: "p",
      revision: "exact-r",
      itemIds: ["a", "b"],
      summary: "Two contact tasks proposed for tomorrow.",
    }));
    const approve = vi.fn(
      async () => "Verified by the existing Day Line owner."
    );
    const out = await runShowrunnerTurn({
      state,
      history: [],
      utterance: "Put those two on tomorrow's Day Line.",
      sourceEventId: "t",
      conversationKey: "t",
      now,
      deskReplan,
      approve,
    });
    expect(deskReplan.mock.calls[0]![1].map(e => e.itemId)).toEqual(
      session.customerIds
    );
    expect(out.state.replan).toMatchObject({
      revision: "exact-r",
      approved: false,
      itemIds: ["a", "b"],
    });
    expect(approve).not.toHaveBeenCalled();
    await runShowrunnerTurn({
      state: out.state,
      history: [],
      utterance: "Yes",
      sourceEventId: "yes",
      conversationKey: "t",
      now,
      approve,
    });
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({
        replan: expect.objectContaining({
          revision: "exact-r",
          itemIds: ["a", "b"],
        }),
      })
    );
  });
  it("remains a synthesized claim with receipts, never independent financial verification", async () => {
    const result = await executeAnalysisQuery({
      tenantId: d.tenantId,
      dataset: d,
      sql: "SELECT SUM(amount_cents) AS recorded_cents FROM orders",
    });
    const e = {
      ...evidence,
      results: [result],
      citedReceiptIds: [result.receipt.id],
    };
    const receipt = receiptFromAnalysis({
      conversationKey: "test",
      claireTurnOrdinal: 1,
      nowMs: now.getTime(),
      answerText: "Observed recorded sales.",
      evidence: e,
    });
    expect(receipt.grounding).toBe("synthesized");
    expect(receipt.supportedBy?.evidence[0]?.source).toContain(
      result.receipt.id
    );
    const verification = await verifyPriorClaim(receipt, { rerun: vi.fn() });
    expect(verification.outcome).not.toBe("verified");
  });
  it("refuses a cross-tenant materialization before any SQL execution", async () => {
    const execute = vi.fn();
    const invoke = vi.fn(
      async () =>
        ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  kind: "query",
                  sql: "SELECT * FROM orders",
                  answer: "",
                  receiptIds: [],
                  customerIds: [],
                  facts: [],
                  retainSelection: false,
                }),
              },
            },
          ],
        }) as any
    );
    const result = await analyzeBusinessData(
      {
        tenantId: "other",
        question: "Compute intervals",
        now,
        timeZone: d.window.timeZone,
      },
      { invoke, build: async () => d, execute }
    );
    expect(result.kind).toBe("execution_error");
    expect(execute).not.toHaveBeenCalled();
  });
});
