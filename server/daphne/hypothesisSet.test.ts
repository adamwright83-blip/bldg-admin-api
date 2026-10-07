import { describe, expect, it } from "vitest";
import { buildDaphneHypothesisSet } from "./hypothesisSet";
import type { DaphneEpistemicClaimRecord } from "./epistemicStore";

function claim(id: string, support: string[], counter: Record<string, unknown>[] = []): DaphneEpistemicClaimRecord {
  return {
    id, tenantId: "t", canonicalOperatorId: "o", agentId: null,
    claimType: "if_then_hypothesis", claimKey: "response:brevity",
    claim: { hypothesis: id }, sourceObservationIds: support,
    supportingEvidence: [], counterEvidence: counter, scope: null,
    contextApplicability: null, uncertainty: { epistemic: 0.2 },
    epistemicStatus: "suggestive", causalEvidenceStatus: "observational",
    validFrom: null, validUntil: null, lastReinforcedAt: null,
    modelVersion: "v2", humanPinned: false, correctedByObservationId: null,
    supersedesClaimId: null, idempotencyKey: id, createdAt: "2026-10-07T00:00:00Z",
  };
}

describe("Daphne V2 HypothesisSet", () => {
  it("preserves competing explanations instead of forcing a winner", () => {
    const set = buildDaphneHypothesisSet({
      claimKey: "response:brevity",
      claims: [claim("a", ["1","2"]), claim("b", ["3","4"])],
    });
    expect(set.decision).toBe("competing_hypotheses");
    expect(set.preferredClaimId).toBeNull();
    expect(set.hypotheses).toHaveLength(2);
  });

  it("prefers only when evidence separation is material", () => {
    const set = buildDaphneHypothesisSet({
      claimKey: "response:brevity",
      claims: [claim("a", ["1","2","3","4"]), claim("b", ["5"])],
      preferenceMargin: 1,
    });
    expect(set.decision).toBe("prefer");
    expect(set.preferredClaimId).toBe("a");
  });

  it("returns insufficient_evidence rather than inventing a hypothesis", () => {
    expect(buildDaphneHypothesisSet({ claimKey: "x", claims: [] }).decision)
      .toBe("insufficient_evidence");
  });
});
