import { describe, expect, it } from "vitest";
import type { ClaireBrainV3Interpretation } from "./brainV3";
import {
  applyClaireDecisionAbstention,
  deriveClaireClosedDecisions,
  selectClaireClosedDecisionBranch,
  type ClaireDecisionCandidate,
  type ClaireTurnType,
} from "./decisionRecord";

function brain(
  patch: Partial<ClaireBrainV3Interpretation> = {}
): ClaireBrainV3Interpretation {
  return {
    target: "open_conversation",
    act: "narration",
    workDisposition: "none",
    dayLineDisposition: "none",
    priorClaim: "none",
    weeklyDisposition: "none",
    identityTopic: "none",
    broadBriefingRequest: false,
    canonicalWork: null,
    referent: null,
    rationale: "fixture",
    ...patch,
  };
}

function decisions(
  patch: Partial<Parameters<typeof deriveClaireClosedDecisions>[0]> = {}
) {
  return deriveClaireClosedDecisions({
    brain: brain(),
    provider: "brain_v3",
    fallbackUsed: false,
    thoughtCompleteness: "complete",
    hasPendingAction: false,
    ...patch,
  });
}

describe("Claire PR1 closed decisions", () => {
  it("routes an interruption through the stored effective output", () => {
    const value = decisions({
      brain: brain({ act: "conversation_control" }),
    });
    expect(value.turnType.providerSelectedOutput).toBe("interruption");
    expect(value.turnType.effectiveOutput).toBe("interruption");
    expect(selectClaireClosedDecisionBranch(value)).toBe("continue");
  });

  it("records a correction and keeps pending work", () => {
    const value = decisions({
      brain: brain({ act: "correction" }),
      hasPendingAction: true,
    });
    expect(value.turnType.providerSelectedOutput).toBe("correction");
    expect(value.pendingActionRelationship.effectiveOutput).toBe(
      "continues_pending"
    );
  });

  it("treats an incomplete sentence as incomplete", () => {
    const value = decisions({ thoughtCompleteness: "incomplete" });
    expect(value.turnReadiness.providerSelectedOutput).toBe("incomplete");
    expect(value.turnReadiness.effectiveOutput).toBe("incomplete");
    expect(selectClaireClosedDecisionBranch(value)).toBe("incomplete");
  });

  it("allows a topic change without claiming pending work", () => {
    const value = decisions({
      brain: brain({ act: "narration", target: "open_conversation" }),
      hasPendingAction: true,
    });
    expect(value.turnType.effectiveOutput).toBe("conversation");
    expect(value.pendingActionRelationship.effectiveOutput).toBe("unrelated");
  });

  it("keeps a confident unknown distinct from an abstention", () => {
    const value = decisions({
      brain: brain({ act: "unclear" }),
    });
    expect(value.turnType.providerSelectedOutput).toBe("unknown");
    expect(value.turnType.abstained).toBe(false);
    expect(value.turnType.effectiveOutput).toBe("unknown");
    expect(selectClaireClosedDecisionBranch(value)).toBe("clarify");
  });

  it("models a real telephony session end as interruption", () => {
    const value = decisions({
      telephonySessionEnded: true,
      brain: brain({ act: "narration" }),
    });
    expect(value.turnType.providerSelectedOutput).toBe("interruption");
    expect(value.turnType.effectiveOutput).toBe("interruption");
  });

  it("does not let stale pending state claim an unrelated turn", () => {
    const value = decisions({
      brain: brain({ target: "open_conversation", act: "narration" }),
      hasPendingAction: true,
    });
    expect(value.pendingActionRelationship.effectiveOutput).toBe("unrelated");
    expect(value.turnType.effectiveOutput).toBe("conversation");
  });

  it("keeps pending work when two pending concerns collide", () => {
    const value = decisions({
      brain: brain({
        target: "pending_action",
        act: "correction",
      }),
      hasPendingAction: true,
    });
    expect(value.pendingActionRelationship.effectiveOutput).toBe(
      "continues_pending"
    );
    expect(value.turnType.effectiveOutput).toBe("correction");
  });

  it("does not swallow greeting plus work into casual conversation", () => {
    const value = decisions({
      brain: brain({
        act: "action_request",
        workDisposition: "propose",
        canonicalWork: "Call Dana Tuesday",
      }),
    });
    expect(value.turnType.providerSelectedOutput).toBe("new_work");
    expect(value.turnType.effectiveOutput).toBe("new_work");
    expect(selectClaireClosedDecisionBranch(value)).toBe("continue");
  });

  it("keeps an unrelated pending briefing when the operator corrects something else", () => {
    const value = decisions({
      brain: brain({
        target: "open_conversation",
        act: "correction",
      }),
      hasPendingAction: true,
    });
    expect(value.pendingActionRelationship.effectiveOutput).toBe(
      "continues_pending"
    );
    expect(value.turnType.effectiveOutput).toBe("correction");
  });

  it("turns a weak top label into clarify without rewriting provider output", () => {
    const candidate: ClaireDecisionCandidate<ClaireTurnType> = {
      decisionType: "turn_type",
      provider: "fixture",
      allowedOutputs: [
        "correction",
        "new_work",
        "question",
        "interruption",
        "conversation",
        "unknown",
      ],
      providerSelectedOutput: "correction",
      distribution: {
        correction: 0.38,
        new_work: 0.35,
        question: 0.14,
        interruption: 0.08,
        conversation: 0.03,
        unknown: 0.02,
      },
      abstained: false,
      abstentionReason: null,
      effectiveOutput: "correction",
      latencyMs: 10,
      estimatedCostUsd: 0,
      fallbackUsed: false,
    };
    const value = applyClaireDecisionAbstention({
      decision: candidate,
      confidenceThreshold: 0.3,
      marginThreshold: 0.1,
      fallback: "clarify",
    });
    expect(value.providerSelectedOutput).toBe("correction");
    expect(value.abstained).toBe(true);
    expect(value.abstentionReason).toBe("margin_below_threshold");
    expect(value.effectiveOutput).toBe("clarify");
  });

  it("uses deterministic provider-unavailable fallbacks", () => {
    const value = decisions({ brain: null, provider: "brain_v3" });
    expect(value.turnType.providerSelectedOutput).toBeNull();
    expect(value.turnType.abstentionReason).toBe("provider_unavailable");
    expect(value.turnType.effectiveOutput).toBe("clarify");
    expect(value.turnReadiness.effectiveOutput).toBe("incomplete");
    expect(value.pendingActionRelationship.effectiveOutput).toBe(
      "continues_pending"
    );
  });
});
