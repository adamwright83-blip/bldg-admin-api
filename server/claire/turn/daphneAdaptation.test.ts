import { describe, expect, it, vi } from "vitest";
import type { DayDirectorProposal } from "../../../shared/dayDirector";
import {
  DAPHNE_STAGE3B_BEHAVIOR_CLASS,
  DAPHNE_STAGE3B_TARGET_KEY,
  type OperatorAdaptationDecision,
} from "../../operatorRepresentative/adaptationContract";
import type { DaphneAdaptationUseReceipt } from "../../operatorRepresentative/adaptationReceipts";
import { runClaireTurn, type ClaireTurnState } from "./claireTurn";

const decision: OperatorAdaptationDecision = {
  tenantId: "tenant-a",
  canonicalOperatorId: "tenant:tenant-a:operator:adam",
  directiveId: "11111111-1111-4111-8111-111111111111",
  targetKey: DAPHNE_STAGE3B_TARGET_KEY,
  behaviorClass: DAPHNE_STAGE3B_BEHAVIOR_CLASS,
  status: "applicable",
};

function proposal(): DayDirectorProposal {
  return {
    promptKey: "commitment:daphne-test",
    title: "Call Dana",
    kind: "growth",
    quantity: null,
    sourceText: "add a task to call Dana",
    prerequisites: [],
    question: null,
    intelligence: "manual_fallback",
  };
}

function state(): ClaireTurnState {
  return { pendingProposal: proposal() };
}

function receipt(input: {
  conversationId: string;
  turnId: string;
}): DaphneAdaptationUseReceipt {
  return {
    id: "daphne-test-receipt",
    tenantId: decision.tenantId,
    canonicalOperatorId: decision.canonicalOperatorId,
    directiveId: decision.directiveId,
    targetKey: DAPHNE_STAGE3B_TARGET_KEY,
    behaviorClass: DAPHNE_STAGE3B_BEHAVIOR_CLASS,
    conversationId: input.conversationId,
    turnId: input.turnId,
    executingSha: "test-sha",
    receiptClass: "non_business_claire_behavior",
    structuralOutcome: "clarification_branch_selected",
    firewallResult: "non_business_behavior_only",
    createdAt: "2026-10-06T17:00:00.000Z",
    businessTruthMutation: false,
  };
}

function safeOverrides() {
  return {
    now: () => new Date("2026-10-06T10:00:00.000-07:00"),
    timeZone: () => "America/Los_Angeles",
    brainV3: null,
    operatorContextShadowEnabled: () => false,
    doctrineTurn: async () => null,
    accounts: async () => [],
    vocabulary: async () => [],
    loadExisting: async () => [],
    campaign: async () => null,
    extractModel: null,
    encyclopedia: null,
  } as const;
}

describe("Daphne Stage 3B Claire branch integration", () => {
  it("parent-main ambiguous pending action remains baseline without a Daphne decision", async () => {
    const write = vi.fn();
    const result = await runClaireTurn(
      {
        tenantId: "tenant-a",
        operatorUserId: "adam",
        dayDirectorActorId: "1",
        surface: "text",
        utterance: "maybe",
        state: state(),
        conversationKey: "conversation-a",
      },
      {
        ...safeOverrides(),
        loadOperatorAdaptationDecision: async () => null,
        recordOperatorAdaptationUse: write,
      }
    );

    expect(result.operatorAdaptation).toBeUndefined();
    expect(write).not.toHaveBeenCalled();
  });

  it("switches to the already-existing clarify branch only after durable receipt proof", async () => {
    const write = vi.fn(async input =>
      receipt({
        conversationId: input.conversationId,
        turnId: input.turnId,
      })
    );
    const result = await runClaireTurn(
      {
        tenantId: "tenant-a",
        operatorUserId: "adam",
        dayDirectorActorId: "1",
        surface: "text",
        utterance: "maybe",
        state: state(),
        conversationKey: "conversation-a",
      },
      {
        ...safeOverrides(),
        loadOperatorAdaptationDecision: async () => decision,
        recordOperatorAdaptationUse: write,
      }
    );

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({
      decision,
      conversationId: "conversation-a",
      turnId: "conversation-a:1",
    });
    expect(result.operatorAdaptation).toEqual({
      directiveId: decision.directiveId,
      targetKey: DAPHNE_STAGE3B_TARGET_KEY,
      behaviorClass: DAPHNE_STAGE3B_BEHAVIOR_CLASS,
      structuralOutcome: "clarification_branch_selected",
      branch: "clarify",
      businessTruthMutation: false,
    });
    expect(result.answerPath).toBe("fallback");
  });

  it("receipt persistence failure leaves the parent-main branch unchanged", async () => {
    const write = vi.fn(async () => {
      throw new Error("receipt database unavailable");
    });
    const result = await runClaireTurn(
      {
        tenantId: "tenant-a",
        operatorUserId: "adam",
        dayDirectorActorId: "1",
        surface: "text",
        utterance: "maybe",
        state: state(),
        conversationKey: "conversation-a",
      },
      {
        ...safeOverrides(),
        loadOperatorAdaptationDecision: async () => decision,
        recordOperatorAdaptationUse: write,
      }
    );

    expect(write).toHaveBeenCalledTimes(1);
    expect(result.operatorAdaptation).toBeUndefined();
  });

  it("a non-ambiguous pending confirmation is never redirected by Daphne", async () => {
    const write = vi.fn();
    const result = await runClaireTurn(
      {
        tenantId: "tenant-a",
        operatorUserId: "adam",
        dayDirectorActorId: "1",
        surface: "text",
        utterance: "yes",
        state: state(),
        conversationKey: "conversation-a",
      },
      {
        ...safeOverrides(),
        loadOperatorAdaptationDecision: async () => decision,
        recordOperatorAdaptationUse: write,
        commitment: async () => ({ kind: "not_applicable" as const }),
      }
    );

    expect(write).not.toHaveBeenCalled();
    expect(result.operatorAdaptation).toBeUndefined();
  });
});
