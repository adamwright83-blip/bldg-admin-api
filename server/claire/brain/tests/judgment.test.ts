/**
 * Business judgment: a recommendation bounded by evidence.
 *
 * A judgment is not a fact and not an action. It must actually recommend something,
 * it must rest on what was retrieved, and it must never manufacture what it did not get.
 */

import { describe, expect, it } from "vitest";
import {
  assertJudgmentGrounded,
  buildJudgmentBrief,
  deterministicRecommendation,
  recommendOverEvidence,
} from "../executive/judgment";
import { decideTurn, type ExecutiveDeps } from "../executive/decide";
import { perceiveTurn } from "../perception/perceive";
import { snapshotWorkingMemory } from "../workingMemory/snapshot";
import type { EvidenceItem } from "../contracts/evidence";

const CTX = {
  conversationKey: "claire-call:judgment",
  tenantId: "default",
  operatorUserId: "adam-admin",
  surface: "voice" as const,
};
const INTEGRATION = { timeZone: "America/Los_Angeles", today: "2026-09-20", surface: "voice" as const };

function evidence(over: Partial<EvidenceItem>): EvidenceItem {
  return {
    id: "ev",
    type: "account_state",
    source: "reader",
    provenance: { reader: "reader" },
    observedAt: "2026-09-20T00:00:00.000Z",
    asOf: "2026-09-20",
    freshness: null,
    coverage: null,
    authoritativeFor: ["current_business_truth"],
    payload: {},
    operatorVisible: true,
    ...over,
  };
}

const resolution = evidence({
  id: "contact_account_resolution:dana",
  source: "listAccountContacts",
  payload: {
    mention: "Dana",
    resolutionKind: "contact",
    accountId: 77,
    accountName: "The Louise",
    contactName: "Dana",
    candidateAccountIds: [77],
  },
});

const history = evidence({
  id: "conversation_turn:s1:2026-09-12",
  type: "conversation_turn",
  authoritativeFor: ["historical_observation"],
  asOf: "2026-09-12T10:00:00.000Z",
  payload: { speaker: "OPERATOR", text: "Dana said she'd sign this week", at: "2026-09-12T10:00:00.000Z" },
});

const goal = evidence({
  id: "goal_recommendation:g1",
  type: "goal_recommendation",
  authoritativeFor: ["goal_recommendation"],
  payload: { title: "closing the Louise contract", rationale: null },
});

function deps(retrieve: ExecutiveDeps["retrieve"]): ExecutiveDeps {
  return { retrieve, ctx: INTEGRATION };
}

async function judge(retrieve: ExecutiveDeps["retrieve"]) {
  const decision = await decideTurn(
    perceiveTurn({ rawText: "What should I do about Dana Tuesday?", completeness: "complete" }),
    snapshotWorkingMemory({}, CTX),
    deps(retrieve)
  );
  const segment = decision.responsePlan.segments.find(s => s.type === "BusinessJudgmentSegment");
  return { decision, segment };
}

describe("a judgment actually recommends something", () => {
  it("is not an empty segment", async () => {
    const { segment } = await judge(async r => (r.kind === "contact_account_resolution" ? [resolution] : []));
    expect(segment).toBeDefined();
    expect(segment?.text.trim().length).toBeGreaterThan(20);
  });

  it("recommends a next move rather than restating who the contact is", async () => {
    const { segment } = await judge(async r =>
      r.kind === "contact_account_resolution" ? [resolution] : r.compartment === "episodicMemory" ? [history] : []
    );
    // It must contain an actual recommendation, not just the resolved identity.
    expect(segment?.text).toMatch(/I'd\b/);
    expect(segment?.text).not.toBe("Dana is at The Louise.");
  });

  it("carries no mutation authority and mints no grant", async () => {
    const { decision, segment } = await judge(async r =>
      r.kind === "contact_account_resolution" ? [resolution] : []
    );
    expect(segment && "mutationAuthority" in segment && segment.mutationAuthority).toBe(false);
    expect(decision.actionGrants).toEqual([]);
  });

  it("uses history to shape the recommendation without making it current truth", async () => {
    const { decision, segment } = await judge(async r =>
      r.kind === "contact_account_resolution" ? [resolution] : r.compartment === "episodicMemory" ? [history] : []
    );
    expect(segment?.text).toContain("2026-09-12");
    // Recorded as an explicit inhibition, so the shadow record shows history informed
    // the reasoning but was never promoted.
    expect(decision.inhibitedCandidates.some(c => c.kind === "episodic_as_current_truth")).toBe(true);
    expect(decision.evidence.find(e => e.id === history.id)?.authoritativeFor).toEqual(["historical_observation"]);
  });

  it("mentions a scoped goal when one is genuinely relevant", () => {
    const brief = buildJudgmentBrief({ evidence: [resolution, history, goal], temporal: ["tuesday"] });
    expect(deterministicRecommendation(brief)).toContain("closing the Louise contract");
  });

  it("says the evidence is thin rather than inventing a confident move", () => {
    const brief = buildJudgmentBrief({ evidence: [resolution], temporal: [] });
    const text = deterministicRecommendation(brief);
    expect(text.length).toBeGreaterThan(20);
    expect(text).toMatch(/nothing recent|nothing on record|find that out|make contact/i);
  });

  it("refuses to pick a side when the contact is ambiguous", () => {
    const ambiguous = evidence({
      id: "contact_account_resolution:dana",
      payload: { mention: "Dana", resolutionKind: "ambiguous", accountId: null, accountName: null, contactName: null, candidateAccountIds: [1, 3] },
    });
    const brief = buildJudgmentBrief({ evidence: [ambiguous], temporal: ["tuesday"] });
    expect(deterministicRecommendation(brief)).toMatch(/can't pin down/i);
  });
});

describe("the model may reason over evidence, never manufacture it", () => {
  const brief = () => buildJudgmentBrief({ evidence: [resolution, history], temporal: ["tuesday"] });

  it("accepts a recommendation grounded in the evidence", () => {
    const out = recommendOverEvidence(brief(), () => "I'd chase Dana at The Louise before Tuesday.");
    expect(out.source).toBe("model");
    expect(out.text).toContain("Dana");
  });

  it("rejects an invented number and falls back rather than speaking it", () => {
    const out = recommendOverEvidence(brief(), () => "Dana owes $4,200 — chase it.");
    expect(out.source).toBe("deterministic");
    expect(out.text).not.toContain("4,200");
  });

  it("rejects an invented name", () => {
    expect(() => assertJudgmentGrounded(brief(), "Ask Winterbourne about it.")).toThrow(/name no evidence supports/);
  });

  it("rejects an invented figure directly", () => {
    expect(() => assertJudgmentGrounded(brief(), "There are 9 open orders.")).toThrow(/number no evidence supports/);
  });

  it("allows ordinary recommendation wording and weekdays", () => {
    expect(() => assertJudgmentGrounded(brief(), "I'd follow up Tuesday. There is nothing newer.")).not.toThrow();
  });

  it("a throwing recommender falls back instead of failing the turn", () => {
    const out = recommendOverEvidence(brief(), () => {
      throw new Error("model unavailable");
    });
    expect(out.source).toBe("deterministic");
    expect(out.text.length).toBeGreaterThan(0);
  });
});
