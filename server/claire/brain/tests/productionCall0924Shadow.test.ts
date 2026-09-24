import { describe, expect, it } from "vitest";
import type { EvidenceItem } from "../contracts/evidence";
import type { RetrievalRequest } from "../contracts/retrieval";
import { runClaireBrainTurn } from "../shadow/runClaireBrainTurn";

const base = {
  surface: "voice" as const,
  tenantId: "default",
  operatorUserId: "adam",
  conversationKey: "claire-call:production-0924-regression",
};

describe("2026-09-24 Brain V2 regression shapes", () => {
  it("does not turn a strategy question into operator work or a Day Line proposal", async () => {
    const result = await runClaireBrainTurn({
      ...base,
      rawText: "What should I do about Dana Tuesday?",
    });

    expect(result.decision.perceivedTurn.businessIntent).toBe("judgment_question");
    expect(result.decision.perceivedTurn.workDeclarationKind).toBe("none");
    expect(result.decision.actionGrants).toHaveLength(0);
    expect(result.decision.control.activeTaskSets.map(set => set.kind)).not.toContain("action_proposal");
  });

  it("still recognizes a real first-person work declaration", async () => {
    const result = await runClaireBrainTurn({
      ...base,
      rawText: "I need to call Dana Tuesday.",
    });

    expect(result.decision.perceivedTurn.workDeclarationKind).toBe("ordinary_work");
    expect(result.decision.perceivedTurn.operatorIntentAttested).toBe(true);
    expect(result.decision.perceivedTurn.declaredContentLabel).toMatch(/call dana tuesday/i);
    expect(result.decision.actionGrants.map(grant => grant.actionClass)).toContain("propose_day_line");
  });

  it("keeps a mixed business question and independent work declaration as two legitimate frames", async () => {
    const result = await runClaireBrainTurn({
      ...base,
      rawText: "I need to call Dana Tuesday. What were my last five sales?",
    });

    expect(result.decision.perceivedTurn.workDeclarationKind).toBe("ordinary_work");
    expect(result.decision.perceivedTurn.operatorIntentAttested).toBe(true);
    expect(result.decision.control.activeTaskSets.map(set => set.kind)).toEqual(
      expect.arrayContaining(["action_proposal", "business_query"])
    );
    expect(result.decision.actionGrants.map(grant => grant.actionClass)).toContain("propose_day_line");
  });

  it("does not manufacture work from a factual correction or exclusion", async () => {
    const result = await runClaireBrainTurn({
      ...base,
      rawText: "What sales happened before Thomas? Don't tell me about Thomas.",
    });

    expect(result.decision.control.activeTaskSets.map(set => set.kind)).toContain("business_query");
    expect(result.decision.actionGrants).toHaveLength(0);
  });

  it("plans a fresh authoritative reread for a correctness challenge", async () => {
    const requests: RetrievalRequest[] = [];
    const now = "2026-09-24T18:00:00.000Z";
    const fresh: EvidenceItem = {
      id: "prior_claim_recheck:claim-1",
      type: "prior_claim_recheck",
      source: "runBusinessQuery",
      provenance: { reader: "runBusinessQuery" },
      observedAt: now,
      asOf: now,
      freshness: null,
      coverage: { complete: true, gaps: [] },
      authoritativeFor: ["current_business_truth"],
      payload: {
        recheck: {
          receiptId: "claim-1",
          resolution: "fresh_query",
          outcome: "verified",
          evidenceIds: ["business_query:latest_sales"],
        },
      },
      operatorVisible: true,
    };

    const result = await runClaireBrainTurn({
      ...base,
      rawText: "Are you sure?",
      state: {
        claimReceipts: [
          {
            id: "claim-1",
            claireTurnOrdinal: 1,
            claimType: "newest_paid_sale",
            recheck: { kind: "business_query" },
          },
        ],
      },
      executive: {
        retrieve: async request => {
          requests.push(request);
          return request.kind === "prior_claim_recheck" ? [fresh] : [];
        },
        ctx: { timeZone: "America/Los_Angeles", today: "2026-09-24", surface: "voice" },
      },
    });

    const rechecks = requests.filter(
      (request): request is Extract<RetrievalRequest, { kind: "prior_claim_recheck" }> =>
        request.kind === "prior_claim_recheck"
    );
    expect(rechecks.length).toBeGreaterThan(0);
    expect(rechecks.every(request => request.mode === "correctness")).toBe(true);
    expect(result.decision.control.epistemic.priorClaimRechecked).toBe(true);
  });

  it("keeps provenance questions receipt-shaped rather than pretending they are fresh verification", async () => {
    const requests: RetrievalRequest[] = [];
    await runClaireBrainTurn({
      ...base,
      rawText: "Where did that come from?",
      state: {
        claimReceipts: [
          {
            id: "claim-1",
            claireTurnOrdinal: 1,
            claimType: "newest_paid_sale",
            recheck: { kind: "business_query" },
          },
        ],
      },
      executive: {
        retrieve: async request => {
          requests.push(request);
          return [];
        },
        ctx: { timeZone: "America/Los_Angeles", today: "2026-09-24", surface: "voice" },
      },
    });

    const recheck = requests.find(
      (request): request is Extract<RetrievalRequest, { kind: "prior_claim_recheck" }> =>
        request.kind === "prior_claim_recheck"
    );
    expect(recheck?.mode).toBe("provenance");
  });

  it("treats attention-only turns as neither prior-claim challenges nor actions", async () => {
    for (const rawText of ["Claire.", "Claire, are you there?"]) {
      const result = await runClaireBrainTurn({
        ...base,
        rawText,
        state: {
          claimReceipts: [
            {
              id: "claim-1",
              claireTurnOrdinal: 1,
              claimType: "newest_paid_sale",
              recheck: { kind: "business_query" },
            },
          ],
        },
      });
      expect(result.decision.attention.priorClaim).toBe("none");
      expect(result.decision.actionGrants).toHaveLength(0);
    }
  });
});
