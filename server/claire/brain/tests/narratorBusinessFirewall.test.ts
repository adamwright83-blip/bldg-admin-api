import { describe, expect, it } from "vitest";
import { admitBusinessEvidence } from "../businessMemory/adapter";
import { BRAIN_V2_PRODUCTION_AUTHORITY } from "../contracts";
import type { EvidenceItem } from "../contracts/evidence";
import type { ExecutiveDecision } from "../contracts/executiveDecision";
import { assertGovernedDecision, ExecutiveGovernorError } from "../executive/governor";
import { perceiveTurn } from "../perception/perceive";

const held: EvidenceItem = {
  id: "narr-held",
  type: "business_query",
  source: "narrator_presentation",
  provenance: {
    reader: "narrator_presentation",
    identityKey: "narrator:m04",
  },
  observedAt: "2026-09-21T00:00:00.000Z",
  asOf: "2026-09-21",
  freshness: null,
  coverage: { complete: true, gaps: [] },
  authoritativeFor: ["current_business_truth"],
  payload: { narrativeTitle: "HELD", authoredNarrative: true },
  operatorVisible: true,
};

const revenue: EvidenceItem = {
  id: "ev-revenue",
  type: "business_query",
  source: "runBusinessQuery",
  provenance: { reader: "runBusinessQuery" },
  observedAt: "2026-09-21T00:00:00.000Z",
  asOf: "2026-09-21",
  freshness: null,
  coverage: { complete: true, gaps: [] },
  authoritativeFor: ["current_business_truth"],
  payload: { metric: "revenue" },
  operatorVisible: true,
};

function decision(evidence: EvidenceItem[]): ExecutiveDecision {
  const perceived = perceiveTurn({
    rawText: "What was revenue?",
    completeness: "complete",
  });
  const segments = [
    {
      type: "BusinessFactSegment" as const,
      text: "Revenue is on the books.",
      evidence: evidence.map(item => ({ evidenceId: item.id })),
      origin: "authoritative_reader" as const,
    },
  ];
  return {
    perceivedTurn: perceived,
    attention: {
      lanes: ["business"],
      retrieve: ["businessMemory"],
      doNotRetrieve: ["goals"],
      boardEligible: false,
      pendingDisposition: "none",
      priorClaim: "none",
      continueOrderedQuery: false,
      rationale: [],
    },
    retrievals: [],
    evidence,
    conclusions: [],
    inhibitedCandidates: [],
    responsePlan: { perceivedTurn: perceived, attention: {
      lanes: ["business"],
      retrieve: ["businessMemory"],
      doNotRetrieve: ["goals"],
      boardEligible: false,
      pendingDisposition: "none",
      priorClaim: "none",
      continueOrderedQuery: false,
      rationale: [],
    }, segments },
    responseSegments: segments,
    actionGrants: [],
    callControl: { endCall: false },
    productionAuthority: false,
  };
}

describe("Narrator presentation cannot become a Claire Brain business fact", () => {
  it("drops a presented HELD title and keeps Brain V2 without production authority", () => {
    expect(BRAIN_V2_PRODUCTION_AUTHORITY).toBe(false);
    expect(admitBusinessEvidence([held, revenue])).toEqual([revenue]);
    expect(JSON.stringify(admitBusinessEvidence([held]))).not.toContain("HELD");
    expect(() => assertGovernedDecision(decision([held]))).toThrow(ExecutiveGovernorError);
    expect(() => assertGovernedDecision(decision([held]))).toThrow(
      /authored narrative material cannot become a business fact/
    );
    expect(() => assertGovernedDecision(decision([revenue]))).not.toThrow();
    expect(decision([revenue]).productionAuthority).toBe(false);
  });
});
