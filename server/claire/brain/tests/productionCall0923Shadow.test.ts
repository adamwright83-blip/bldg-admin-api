import { describe, expect, it } from "vitest";
import { executeGrantedAction } from "../actions/gateway";
import { BRAIN_V2_PRODUCTION_AUTHORITY } from "../contracts";
import { counterfactualVoiceCompleteness } from "../perception/completeness";
import { observeShadowTurn } from "../shadow/observeShadowTurn";
import { runClaireBrainTurn } from "../shadow/runClaireBrainTurn";

const T1 = "while I'm there, I need to do the Instagram static at";
const T4 = "I have to do the Instagram static ad.";
const T5 = "Add all that to the day line. And the Instagram static ad, is a challenge.";
const conversationKey = "claire-call:c79a543e-e77c-4196-a8df-ad0138624afc";

describe("2026-09-23 Brain V2 shadow", () => {
  it("stays shadow-only and classifies the work", async () => {
    expect(BRAIN_V2_PRODUCTION_AUTHORITY).toBe(false);
    const work = await runClaireBrainTurn({
      rawText: T4,
      surface: "voice",
      tenantId: "default",
      operatorUserId: "adam",
      conversationKey,
    });
    expect(work.productionAuthority).toBe(false);
    expect(work.mutations).toEqual([]);
    expect(work.decision.perceivedTurn.workDeclarationKind).toBe("ordinary_work");
    expect(work.decision.perceivedTurn.businessIntent).not.toBe("fact_question");
    expect(work.decision.actionGrants[0]?.constraints).toEqual({ mutationAllowed: false, shadowOnly: true });

    const explicit = await runClaireBrainTurn({
      rawText: T5,
      surface: "voice",
      tenantId: "default",
      operatorUserId: "adam",
      conversationKey,
    });
    expect(explicit.decision.perceivedTurn.workDeclarationKind).toBe("explicit_day_line");
    expect(explicit.decision.actionGrants[0]?.actionClass).toBe("commit_day_line");
    expect(explicit.decision.actionGrants[0]?.constraints.mutationAllowed).toBe(false);
    expect(explicit.comparison.proposedExecutionType).toBe("challenge");
    const gateway = await executeGrantedAction(explicit.decision.actionGrants[0]);
    expect(gateway).toEqual({ executed: false, reason: "shadow_only" });
    await expect(
      executeGrantedAction({
        ...explicit.decision.actionGrants[0],
        constraints: { mutationAllowed: true, shadowOnly: false },
      })
    ).rejects.toThrow(/refuses live mutations/);
  });

  it("suppresses a stale pending item", async () => {
    const result = await runClaireBrainTurn({
      rawText: T4,
      surface: "voice",
      tenantId: "default",
      operatorUserId: "adam",
      conversationKey,
      state: { pendingProposal: { title: "Call Dana Tuesday" } },
    });
    expect(result.decision.attention.pendingDisposition).not.toBe("confirm");
    expect(result.decision.inhibitedCandidates.some(item => item.kind === "pending_as_intent")).toBe(true);
  });

  it("records a counterfactual hold without changing live audio", async () => {
    expect(counterfactualVoiceCompleteness(T1, "forced_flush")).toBe("incomplete");
    const observed = await observeShadowTurn(
      {
        rawText: T1,
        assembledText: T1,
        completeness: "forced_flush",
        surface: "voice",
        tenantId: "default",
        operatorUserId: "adam",
        conversationKey,
        v1: {
          endedCall: false,
          mutated: false,
          spokeSomething: true,
          completeness: "forced_flush",
          priorClaimRan: false,
          speak: "Should I add that?",
        },
      },
      { env: { CLAIRE_BRAIN_V2_SHADOW: "1" } as NodeJS.ProcessEnv }
    );
    expect(observed.observed).toBe(true);
    if (!observed.observed) return;
    expect(observed.comparison.counterfactualCompleteness).toBe("incomplete");
    expect(observed.comparison.disagreementLabels).toContain("v1_v2_completeness_disagreement");
    expect(observed.comparison.productionAuthority).toBe(false);
  });
});
