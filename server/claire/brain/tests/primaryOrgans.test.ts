import { describe, expect, it, vi } from "vitest";
import { perceiveTurn } from "../perception/perceive";
import { applySemanticReading, refinePerception } from "../perception/semanticPerception";
import {
  authorizedClaireOperatorIds,
  resolveClaireOperatorAuthority,
} from "../live/operatorAuthority";
import { isAuthorizedProductionOperator } from "../businessMemory/sourceVisibility";
import { compareLegacyReading, observeLegacyClaire, type V2DecisionSummary } from "../live/legacyShadow";

const perceive = (text: string) => perceiveTurn({ rawText: text, assembledText: text, completeness: "complete" });

describe("Brain V2 semantic perception", () => {
  it("turns a surface 'fact question' into a judgment request", () => {
    const base = perceive("What do you think I should focus on this week to grow revenue?");
    expect(base.businessIntent).toBe("fact_question");
    const next = applySemanticReading(base, { turnKind: "business_judgment_or_strategy", endsConversation: false }, { hasPriorClaims: false });
    expect(next.businessIntent).toBe("judgment_question");
    expect(next.personalProbe).toBe(false);
  });

  it("recognizes a personal question to Claire and drops the false business question", () => {
    const next = applySemanticReading(perceive("How was your weekend?"), { turnKind: "personal_question_to_claire", endsConversation: false }, { hasPriorClaims: false });
    expect(next.businessIntent).toBe("none");
    expect(next.hasBusinessQuestion).toBe(false);
    expect(next.personalProbe).toBe(true);
  });

  it("recognizes a morning briefing request", () => {
    const next = applySemanticReading(perceive("Give me my morning briefing."), { turnKind: "daily_briefing_request", endsConversation: false }, { hasPriorClaims: false });
    expect(next.businessIntent).toBe("broad_briefing");
    expect(next.broadBriefingRequest).toBe(true);
  });

  it("cannot open a prior-claim lane when there is no prior claim", () => {
    const next = applySemanticReading(perceive("Really?"), { turnKind: "challenge_prior_claim", endsConversation: false }, { hasPriorClaims: false });
    expect(next.businessIntent).not.toBe("correctness_challenge");
  });

  it("never creates work authority", () => {
    const base = perceive("Tell me about my week.");
    const next = applySemanticReading(base, { turnKind: "work_instruction", endsConversation: false }, { hasPriorClaims: false });
    expect(next.workDeclarationKind).toBe(base.workDeclarationKind);
    expect(next.explicitActionRequest).toBe(base.explicitActionRequest);
    expect(next.operatorWorkCommitment).toBe(base.operatorWorkCommitment);
  });

  it("only hangs up on a short leave-taking, and may veto a misread end", () => {
    const longBye = perceive("Bye the way, what were my sales yesterday and how many orders came through Laundry Butler?");
    expect(applySemanticReading(longBye, { turnKind: "business_fact_question", endsConversation: true }, { hasPriorClaims: false }).callControl).toBe("continue");
    const bye = perceive("Okay, talk later.");
    expect(applySemanticReading(bye, { turnKind: "leave_taking", endsConversation: true }, { hasPriorClaims: false }).callControl).toBe("end");
  });

  it("falls back to deterministic perception on failure or timeout", async () => {
    const base = perceive("What were my sales yesterday?");
    const failed = await refinePerception(base, { tenantId: "t", recentTurns: [], hasPriorClaims: false, holdingPending: false }, async () => {
      throw new Error("model down");
    });
    expect(failed.perceived).toEqual(base);
    const slow = await refinePerception(base, { tenantId: "t", recentTurns: [], hasPriorClaims: false, holdingPending: false }, () => new Promise(() => undefined), 10);
    expect(slow.perceived).toEqual(base);
  });
});

describe("Brain V2 operator authority — identity + verified membership, any tenant", () => {
  const env = { OWNER_OPEN_ID: "adam-admin" } as unknown as NodeJS.ProcessEnv;
  const owner = async ({ tenantId, operatorUserId }: { tenantId: string; operatorUserId: string }) => ({ tenantId, userOpenId: operatorUserId, role: "owner" as const });

  it("authorizes the operator in default AND laundry_farm when membership verifies", async () => {
    for (const tenantId of ["default", "laundry_farm"]) {
      const authority = await resolveClaireOperatorAuthority({ tenantId, operatorUserId: "adam-admin" }, { env, resolveMembership: owner });
      expect(authority).toMatchObject({ authorized: true, tenantId, basis: "verified_membership" });
    }
  });

  it("refuses an unverified membership, a field role, and an unknown identity", async () => {
    expect(await resolveClaireOperatorAuthority({ tenantId: "laundry_farm", operatorUserId: "adam-admin" }, { env, resolveMembership: async () => null }))
      .toEqual({ authorized: false, reason: "membership_unverified" });
    expect(await resolveClaireOperatorAuthority({ tenantId: "laundry_farm", operatorUserId: "adam-admin" }, {
      env,
      resolveMembership: async ({ tenantId, operatorUserId }) => ({ tenantId, userOpenId: operatorUserId, role: "field" }),
    })).toEqual({ authorized: false, reason: "role_not_authorized" });
    expect(await resolveClaireOperatorAuthority({ tenantId: "default", operatorUserId: "someone" }, { env, resolveMembership: owner }))
      .toEqual({ authorized: false, reason: "identity_not_authorized" });
  });

  it("rejects a membership for a different tenant than the conversation", async () => {
    const authority = await resolveClaireOperatorAuthority({ tenantId: "laundry_farm", operatorUserId: "adam-admin" }, {
      env,
      resolveMembership: async ({ operatorUserId }) => ({ tenantId: "default", userOpenId: operatorUserId, role: "owner" }),
    });
    expect(authority).toEqual({ authorized: false, reason: "membership_unverified" });
  });

  it("fails closed when the membership lookup throws", async () => {
    expect(await resolveClaireOperatorAuthority({ tenantId: "default", operatorUserId: "adam-admin" }, { env, resolveMembership: async () => { throw new Error("db"); } }))
      .toEqual({ authorized: false, reason: "membership_lookup_failed" });
  });

  it("uses CLAIRE_BRAIN_V2_OPERATOR_IDS when configured", () => {
    expect([...authorizedClaireOperatorIds({ CLAIRE_BRAIN_V2_OPERATOR_IDS: "a, b" } as unknown as NodeJS.ProcessEnv)]).toEqual(["a", "b"]);
  });

  it("the synchronous identity gate no longer names a tenant", () => {
    expect(isAuthorizedProductionOperator({ tenantId: "laundry_farm", operatorUserId: "adam-admin" })).toBe(true);
    expect(isAuthorizedProductionOperator({ tenantId: "default", operatorUserId: "someone-else" })).toBe(false);
  });
});

describe("Legacy Claire read-only observer", () => {
  const v2: V2DecisionSummary = {
    lanes: ["business"],
    businessIntent: "fact_question",
    dialogueActs: ["question"],
    priorClaim: "none",
    actionClasses: [],
    endCall: false,
    composition: "deterministic",
    pendingDisposition: "none",
  };
  const interpretation = {
    tenantId: "default",
    operatorId: "adam-admin",
    utterance: "What were my sales yesterday?",
    recentTurns: [{ speaker: "claire" as const, text: "Morning." }],
    pending: { briefing: false, accountFollowUp: false, action: false, weeklyPlanning: false },
    dayLineSuppressed: false,
  };

  it("records disagreements and never returns anything a turn could use", async () => {
    const record = vi.fn(async () => undefined);
    const comparison = await observeLegacyClaire(
      { tenantId: "default", operatorUserId: "adam-admin", conversationKey: "k", surface: "voice", interpretation, v2 },
      {
        env: {} as NodeJS.ProcessEnv,
        record,
        interpret: async () => ({
          target: "open_conversation", act: "conversation_control", workDisposition: "propose", dayLineDisposition: "none",
          priorClaim: "none", weeklyDisposition: "none", identityTopic: "none", broadBriefingRequest: false,
          canonicalWork: "x", referent: null, rationale: "",
        }),
      }
    );
    expect(comparison?.disagreements).toEqual(expect.arrayContaining(["call_control", "work_authority"]));
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("is silent when switched off and swallows interpreter failure", async () => {
    expect(await observeLegacyClaire({ tenantId: "d", operatorUserId: "a", conversationKey: "k", surface: "voice", interpretation, v2 }, { env: { CLAIRE_V1_SHADOW: "0" } as unknown as NodeJS.ProcessEnv })).toBeNull();
    const comparison = await observeLegacyClaire(
      { tenantId: "d", operatorUserId: "a", conversationKey: "k", surface: "voice", interpretation, v2 },
      { env: {} as NodeJS.ProcessEnv, record: async () => undefined, interpret: async () => { throw new Error("down"); } }
    );
    expect(comparison?.v1.available).toBe(false);
    expect(compareLegacyReading(v2, null)).toEqual(["v1_unavailable"]);
  });
});
