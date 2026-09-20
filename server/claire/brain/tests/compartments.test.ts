/**
 * Compartment boundaries: episodic, self/social, and goals.
 *
 * Each of these may INFORM. None may decide, and none may manufacture business truth.
 * The enforcement is the `authoritativeFor` stamp each adapter applies, so these tests
 * assert the stamps rather than trusting callers to be careful.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evidenceFromRememberedTurn, retrieveEpisodicEvidence } from "../episodicMemory/adapter";
import { evidenceFromProgression, retrieveSelfEvidence } from "../selfMemory/adapter";
import { evidenceFromRecommendation, retrieveGoalEvidence } from "../goals/adapter";
import { assertGovernedDecision, ExecutiveGovernorError } from "../executive/governor";
import { perceiveTurn } from "../perception/perceive";
import type { AttentionPlan } from "../contracts/attention";
import type { ExecutiveDecision } from "../contracts/executiveDecision";
import type { PersonalProgressionContext } from "../../progression/service";

const NOW = "2026-09-20T12:00:00.000Z";

describe("episodic memory is history, never current truth", () => {
  const turn = { sessionId: "s1", at: "2026-09-12T10:00:00.000Z", speaker: "OPERATOR" as const, text: "Dana said yes" };

  it("stamps a remembered turn as a historical observation only", () => {
    const item = evidenceFromRememberedTurn(turn, NOW);
    expect(item.authoritativeFor).toEqual(["historical_observation"]);
    expect(item.authoritativeFor).not.toContain("current_business_truth");
    // As-of is when it was SAID, which is why it cannot speak for now.
    expect(item.asOf).toBe("2026-09-12T10:00:00.000Z");
  });

  it("retrieves nothing without search terms rather than dredging the ledger", async () => {
    const items = await retrieveEpisodicEvidence(
      { compartment: "episodicMemory", kind: "conversation_history" },
      { tenantId: "default", operatorUserId: "adam-admin", nowIso: NOW },
      { search: async () => [turn] }
    );
    expect(items).toEqual([]);
  });

  it("returns stamped history when the executive supplies terms", async () => {
    const items = await retrieveEpisodicEvidence(
      { compartment: "episodicMemory", kind: "conversation_history" },
      { tenantId: "default", operatorUserId: "adam-admin", nowIso: NOW, terms: ["dana"] },
      { search: async () => [turn] }
    );
    expect(items).toHaveLength(1);
    expect(items[0].authoritativeFor).toEqual(["historical_observation"]);
  });

  it("history that claims current truth is rejected by the governor", () => {
    const perceived = perceiveTurn({ rawText: "What happened with Dana?", completeness: "complete" });
    const attention: AttentionPlan = {
      lanes: ["business"],
      retrieve: ["episodicMemory"],
      doNotRetrieve: [],
      boardEligible: false,
      pendingDisposition: "none",
      priorClaim: "none",
      continueOrderedQuery: false,
      rationale: [],
    };
    const bad = { ...evidenceFromRememberedTurn(turn, NOW), authoritativeFor: ["current_business_truth" as const] };
    const decision: ExecutiveDecision = {
      perceivedTurn: perceived,
      attention,
      retrievals: [],
      evidence: [bad],
      conclusions: [],
      inhibitedCandidates: [],
      responsePlan: { perceivedTurn: perceived, attention, segments: [] },
      responseSegments: [],
      actionGrants: [],
      callControl: { endCall: false },
      productionAuthority: false,
    };
    decision.responseSegments = decision.responsePlan.segments;
    expect(() => assertGovernedDecision(decision)).toThrow(ExecutiveGovernorError);
  });
});

describe("self/social memory affects disclosure, never business truth", () => {
  const progression = {
    scope: { tenantId: "default", operatorUserId: "adam-admin" },
    grant: {},
    unusedEntitlement: { id: "ent-1" },
    unusedEntitlementCount: 1,
    consumedEntitlementCount: 2,
    disclosedFragmentIds: ["f1"],
    priorRefusedTopics: ["family"],
    topicHistory: {},
    conversationLedger: [],
  } as unknown as PersonalProgressionContext;

  it("never stamps self state as current business truth", () => {
    for (const item of evidenceFromProgression(progression, NOW)) {
      expect(item.authoritativeFor).toEqual(["self_state"]);
      expect(item.authoritativeFor).not.toContain("current_business_truth");
    }
  });

  it("reads nothing unless a progression loader is supplied", async () => {
    const items = await retrieveSelfEvidence(
      { compartment: "selfMemory", kind: "disclosure_entitlement" },
      { tenantId: "default", operatorUserId: "adam-admin", conversationId: "c1", nowIso: NOW }
    );
    expect(items).toEqual([]);
  });

  it("surfaces an unused entitlement for the executive to decide on", async () => {
    const items = await retrieveSelfEvidence(
      { compartment: "selfMemory", kind: "disclosure_entitlement" },
      { tenantId: "default", operatorUserId: "adam-admin", conversationId: "c1", nowIso: NOW },
      { loadProgression: async () => progression }
    );
    expect(items.some(item => item.type === "disclosure_entitlement")).toBe(true);
  });
});

describe("goals advise and never hijack a scoped question", () => {
  const recommendation = { id: "g1", title: "Re-engage dormant accounts", rationale: null };

  it("a scoped request returns nothing — the Dana guarantee is structural", async () => {
    const items = await retrieveGoalEvidence(
      { compartment: "goals", kind: "proactive_board_inputs", scoped: true },
      { tenantId: "default", operatorUserId: "adam-admin", nowIso: NOW },
      { loadBoardInputs: async () => [recommendation] }
    );
    expect(items).toEqual([]);
  });

  it("an unscoped briefing may consult the board", async () => {
    const items = await retrieveGoalEvidence(
      { compartment: "goals", kind: "proactive_board_inputs", scoped: false },
      { tenantId: "default", operatorUserId: "adam-admin", nowIso: NOW },
      { loadBoardInputs: async () => [recommendation] }
    );
    expect(items).toHaveLength(1);
  });

  it("a recommendation is advice, not truth, so it cannot license a fact", () => {
    const item = evidenceFromRecommendation(recommendation, NOW);
    expect(item.authoritativeFor).toEqual(["goal_recommendation"]);
    expect(item.authoritativeFor).not.toContain("current_business_truth");
  });
});


/** Code only. Comments explain which writers are forbidden and must not trip the check. */
function codeOf(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("observers reach only the read-only readers", () => {
  const selfAdapter = codeOf("server/claire/brain/selfMemory/adapter.ts");
  const goalsAdapter = codeOf("server/claire/brain/goals/adapter.ts");
  const observer = codeOf("server/claire/brain/shadow/observeShadowTurn.ts");

  it("self memory uses the non-writing progression reader", () => {
    // loadPersonalProgressionContext releases expired reservations — that is a WRITE.
    expect(selfAdapter).toMatch(/readPersonalProgressionContext/);
    expect(selfAdapter).not.toMatch(/loadPersonalProgressionContext\(/);
  });

  it("goals use the non-writing board reader", () => {
    // ensureAdamBoard CREATES obligations. An observer must never create work.
    expect(goalsAdapter).toMatch(/loadObligations/);
    expect(goalsAdapter).not.toMatch(/ensureAdamBoard/);
  });

  it("the observer wires all four compartments", () => {
    for (const compartment of ["business:", "episodic:", "self:", "goals:"]) {
      expect(observer).toContain(compartment);
    }
  });

  it("the observer never reaches a write-capable reader", () => {
    expect(observer).not.toMatch(/ensureAdamBoard|loadPersonalProgressionContext|upsertObligation/);
  });
});
