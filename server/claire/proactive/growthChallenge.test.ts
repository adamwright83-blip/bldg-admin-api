import { describe, expect, it, vi } from "vitest";
import {
  acceptSalesInsightChallenge,
  salesInsightChallengeProposal,
  SALES_INSIGHT_CHALLENGE_PREFIX,
} from "./growthChallenge";
import type { SalesInsightArtifact } from "./salesInsights";

describe("growthChallenge", () => {
  const artifact: SalesInsightArtifact = {
    kind: "sales_trend",
    observationReference: "obs-123",
    scope: "Laundry Farm total",
    metric: "net_paid_revenue_cents",
    period: { from: "2026-09-01", to: "2026-09-30" },
    comparisonPeriod: { from: "2026-08-01", to: "2026-08-31" },
    precision: "exact",
    speech: "Sales decreased.",
    recommendedChallenge: {
      kind: "marketing_challenge",
      status: "proposal_only",
      title: "Diagnose Commercial Churn",
      why: "Revenue down 15%",
      completionCondition: "Review customer logs",
      sourceObservationReference: "obs-123",
      requiresOperatorApproval: true,
    },
    series: [],
  };

  it("constructs a valid growth challenge proposal from an artifact", () => {
    const proposal = salesInsightChallengeProposal(artifact, "2026-10-12");
    expect(proposal).not.toBeNull();
    expect(proposal?.promptKey).toBe(`${SALES_INSIGHT_CHALLENGE_PREFIX}obs-123`);
    expect(proposal?.kind).toBe("growth");
    expect(proposal?.executionType).toBe("challenge");
  });

  it("rejects challenge creation when observation references do not match", () => {
    const mismatch = {
      ...artifact,
      recommendedChallenge: {
        ...artifact.recommendedChallenge!,
        sourceObservationReference: "different-obs",
      },
    };
    const proposal = salesInsightChallengeProposal(mismatch, "2026-10-12");
    expect(proposal).toBeNull();
  });

  it("accepts a challenge and returns Day Line confirmation speech", async () => {
    const loadInsight = vi.fn(async () => artifact);
    const accept = vi.fn(async () => ({
      stored: { id: "commit-42" },
      created: true,
    }));
    const readCommitment = vi.fn(async () => ({
      id: "commit-42",
      tenantId: "tenant-1",
      actorId: "actor-1",
      businessDate: "2026-10-12",
      title: "Diagnose Commercial Churn",
      idempotencyKey: `${SALES_INSIGHT_CHALLENGE_PREFIX}obs-123`,
      kind: "growth",
      sourceText: "Revenue down 15% Evidence: obs-123. Remote work in Admin: Review customer logs",
      status: "open",
      metadataJson: { executionType: "challenge" },
    }));

    const result = await acceptSalesInsightChallenge(
      {
        tenantId: "tenant-1",
        actorId: "actor-1",
        businessDate: "2026-10-12",
        artifact,
        operatorUtterance: "Yes, add that challenge",
      },
      {
        loadInsight: loadInsight as never,
        accept: accept as never,
        readCommitment: readCommitment as never,
      }
    );

    expect(result.status).toBe("accepted");
    if (result.status === "accepted") {
      expect(result.commitmentId).toBe("commit-42");
      expect(result.created).toBe(true);
      expect(result.speech).toContain("Added Diagnose Commercial Churn to the Day Line as a Challenge");
    }
  });

  it("returns evidence_changed if artifact observation reference changed", async () => {
    const loadInsight = vi.fn(async () => ({
      ...artifact,
      observationReference: "obs-999",
    }));

    const result = await acceptSalesInsightChallenge(
      {
        tenantId: "tenant-1",
        actorId: "actor-1",
        businessDate: "2026-10-12",
        artifact,
        operatorUtterance: "Yes, add it",
      },
      {
        loadInsight: loadInsight as never,
        accept: vi.fn() as never,
        readCommitment: vi.fn() as never,
      }
    );

    expect(result.status).toBe("evidence_changed");
    expect(result.speech).toContain("sales evidence has changed");
  });

  it("wires growth challenge into live Claire turn and persists approved Day Line write", async () => {
    const { runClaireTurn } = await import("../turn/claireTurn");
    const state: any = {};
    const dayLineStore = new Map<string, any>();

    const overrides: any = {
      now: () => new Date("2026-10-12T17:00:00.000Z"),
      timeZone: () => "America/Los_Angeles",
      watchBoard: vi.fn(async () => ({
        brief: "Sales decreased.",
        salesArtifacts: [artifact],
      })),
      brainV3: vi.fn(async (input: any) => {
        const text = String(input.utterance ?? "");
        if (/walk me through/i.test(text)) {
          return {
            target: "open_conversation",
            act: "question",
            workDisposition: "none",
            dayLineDisposition: "none",
            priorClaim: "none",
            broadBriefingRequest: true,
            rationale: "morning broad request",
          };
        }
        if (/add.*challenge|yes/i.test(text)) {
          return {
            target: "pending_briefing",
            act: "confirmation",
            workDisposition: "commit",
            dayLineDisposition: "accept",
            priorClaim: "none",
            broadBriefingRequest: false,
            rationale: "operator confirms growth challenge",
          };
        }
        return {
          target: "open_conversation",
          act: "narration",
          workDisposition: "none",
          dayLineDisposition: "none",
          priorClaim: "none",
          broadBriefingRequest: false,
          rationale: "fallback",
        };
      }),
    };

    // Mock internal dependencies of acceptSalesInsightChallenge
    const salesInsightModule = await import("./salesInsights");
    vi.spyOn(salesInsightModule, "loadSalesInsight").mockResolvedValue(artifact);

    const dayDirectorService = await import("../../planning/dayDirector/dayDirectorService");
    vi.spyOn(dayDirectorService, "acceptProposalWithReceipt").mockImplementation(async (input: any) => {
      const stored = {
        id: "growth-challenge-1",
        tenantId: input.tenantId,
        actorId: input.actorId,
        businessDate: input.businessDate,
        title: input.proposal.title,
        idempotencyKey: input.proposal.promptKey,
        kind: input.proposal.kind,
        sourceText: input.proposal.sourceText,
        status: "open",
        metadataJson: { executionType: input.proposal.executionType },
      };
      dayLineStore.set(stored.id, stored);
      return { stored, created: true } as any;
    });

    vi.spyOn(dayDirectorService, "readDayDirectorCanonicalCommitment").mockImplementation(async (input: any) => {
      return dayLineStore.get(input.commitmentId) ?? null;
    });

    // Turn 1: Operator asks to walk through day; Claire presents board with salesArtifact
    const turn1 = await runClaireTurn(
      {
        tenantId: "tenant-1",
        operatorUserId: "adam",
        dayDirectorActorId: "actor-1",
        surface: "text",
        utterance: "Can you walk me through my day?",
        state,
        conversationKey: "conv-growth-1",
        brief: "Sales decreased.",
      },
      overrides
    );

    expect(turn1.speak).toContain("Sales decreased");
    expect(state.pendingGrowthChallenge).toBeDefined();
    expect(state.pendingGrowthChallenge?.artifact.observationReference).toBe("obs-123");

    // Turn 2: Operator confirms adding the growth challenge
    const turn2 = await runClaireTurn(
      {
        tenantId: "tenant-1",
        operatorUserId: "adam",
        dayDirectorActorId: "actor-1",
        surface: "text",
        utterance: "Yes, add that growth challenge to the Day Line.",
        state,
        conversationKey: "conv-growth-1",
        brief: "Sales decreased.",
      },
      overrides
    );

    expect(turn2.kind).toBe("briefing_saved");
    expect(turn2.actionIds).toEqual(["growth-challenge-1"]);
    expect(turn2.mutationReceipts).toHaveLength(1);
    expect(turn2.receiptBackedCommit).toContain("Added Diagnose Commercial Churn to the Day Line as a Challenge");
    expect(state.pendingGrowthChallenge).toBeNull();
    expect(dayLineStore.size).toBe(1);
  });
});

