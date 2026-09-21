/**
 * Mixed business + personal firewall.
 *
 * The governor previously computed `hasBusiness` and then discarded it, so a turn
 * carrying both lanes could silently lose its business answer whenever a personal
 * lane also ran. These tests exist to keep that hole closed.
 */

import { describe, expect, it } from "vitest";
import { assertGovernedDecision, ExecutiveGovernorError } from "../executive/governor";
import { mintPersonalDisclosureGrant } from "../executive/grants";
import { perceiveTurn } from "../perception/perceive";
import { BUSINESS_ANSWER_UNAVAILABLE, type ExecutiveDecision } from "../contracts/executiveDecision";
import type { AttentionPlan } from "../contracts/attention";
import type { EvidenceItem } from "../contracts/evidence";
import type { ResponseSegment } from "../contracts/responsePlan";

function mixedAttention(lanes: AttentionPlan["lanes"]): AttentionPlan {
  return {
    lanes,
    retrieve: ["workingMemory", "businessMemory", "selfMemory"],
    doNotRetrieve: ["goals"],
    boardEligible: false,
    pendingDisposition: "none",
    priorClaim: "none",
    continueOrderedQuery: false,
    rationale: [],
  };
}

const evidence: EvidenceItem = {
  id: "ev-dana",
  type: "business_query",
  source: "runBusinessQuery",
  provenance: { reader: "runBusinessQuery" },
  observedAt: "2026-09-20T00:00:00.000Z",
  asOf: "2026-09-20",
  freshness: null,
  coverage: { complete: true, gaps: [] },
  authoritativeFor: ["current_business_truth"],
  payload: {},
  operatorVisible: true,
};

const disclosure = mintPersonalDisclosureGrant({
  entitlementId: "claire.personal.basic",
  basis: "earned_rapport",
  rung: "1",
});

function decide(segments: ResponseSegment[], conclusions: ExecutiveDecision["conclusions"] = [], lanes: AttentionPlan["lanes"] = ["business", "personal"]): ExecutiveDecision {
  const perceived = perceiveTurn({
    rawText: "Has Dana replied? And how was your weekend?",
    completeness: "complete",
  });
  const attention = mixedAttention(lanes);
  return {
    perceivedTurn: perceived,
    attention,
    retrievals: [],
    evidence: [evidence],
    conclusions,
    inhibitedCandidates: [],
    responsePlan: { perceivedTurn: perceived, attention, segments },
    responseSegments: segments,
    actionGrants: [],
    callControl: { endCall: false },
    productionAuthority: false,
  };
}

const businessFact: ResponseSegment = {
  type: "BusinessFactSegment",
  text: "Dana hasn't replied since Tuesday.",
  evidence: [{ evidenceId: "ev-dana" }],
  origin: "authoritative_reader",
};

const personalDisclosure: ResponseSegment = {
  type: "PersonalDisclosureSegment",
  text: "Quiet one. I read most of it.",
  grant: disclosure,
};

describe("personal cannot suppress business", () => {
  it("a mixed turn that drops the business answer is rejected", () => {
    expect(() => assertGovernedDecision(decide([personalDisclosure]))).toThrow(ExecutiveGovernorError);
    expect(() => assertGovernedDecision(decide([personalDisclosure]))).toThrow(/lost its business answer/);
  });

  it("a mixed turn carrying both segments passes", () => {
    expect(() => assertGovernedDecision(decide([businessFact, personalDisclosure]))).not.toThrow();
  });

  it("order does not matter: personal first still passes when business is present", () => {
    expect(() => assertGovernedDecision(decide([personalDisclosure, businessFact]))).not.toThrow();
  });

  it("a narrative lane is held to the same rule as a personal lane", () => {
    expect(() =>
      assertGovernedDecision(decide([personalDisclosure], [], ["business", "narrative"]))
    ).toThrow(/lost its business answer/);
  });

  it("business may be absent only when the executive says so on the record", () => {
    const conclusions = [
      { kind: BUSINESS_ANSWER_UNAVAILABLE, detail: "no authoritative evidence for Dana", evidenceIds: [] },
    ];
    // Declaring it explicitly is allowed; the personal lane must then stay silent.
    expect(() => assertGovernedDecision(decide([], conclusions))).not.toThrow();
  });

  it("an explicit unavailable conclusion still may not let personal speak alone", () => {
    const conclusions = [
      { kind: BUSINESS_ANSWER_UNAVAILABLE, detail: "no authoritative evidence for Dana", evidenceIds: [] },
    ];
    expect(() => assertGovernedDecision(decide([personalDisclosure], conclusions))).toThrow(
      /may not be traded away/
    );
  });

  it("an inhibited narrative_withholds_business candidate always fails", () => {
    const decision = decide([businessFact, personalDisclosure]);
    decision.inhibitedCandidates.push({
      kind: "narrative_withholds_business",
      detail: "rapport tried to hold the Dana answer",
    });
    expect(() => assertGovernedDecision(decision)).toThrow(/must not withhold a business answer/);
  });

  it("a business-only turn is unaffected by the firewall", () => {
    expect(() => assertGovernedDecision(decide([businessFact], [], ["business"]))).not.toThrow();
  });

  it("a personal-only turn is unaffected by the firewall", () => {
    expect(() => assertGovernedDecision(decide([personalDisclosure], [], ["personal"]))).not.toThrow();
  });
});
