import { describe, expect, it } from "vitest";
import {
  daphneEpistemicClaimId,
  normalizeDaphneEpistemicClaim,
  validateDaphneEpistemicClaim,
} from "./epistemicStore";

describe("Daphne V2 typed epistemic ledger", () => {
  const base = {
    tenantId: "tenant-a",
    canonicalOperatorId: "operator-a",
    claimKey: "response:brevity",
    claim: { statement: "Shorter execution prompts correlate with continuation." },
    sourceObservationIds: ["dobs_1", "dobs_2"],
    modelVersion: "daphne-v2-test",
    idempotencyKey: "claim-1",
  };

  it("does not permit an observational association to masquerade as a treatment effect", () => {
    expect(() =>
      validateDaphneEpistemicClaim({
        ...base,
        claimType: "treatment_effect_estimate",
        causalEvidenceStatus: "observational",
      })
    ).toThrow(/propensity-supported or randomized/);

    expect(() =>
      validateDaphneEpistemicClaim({
        ...base,
        claimType: "treatment_effect_estimate",
        causalEvidenceStatus: "randomized",
      })
    ).not.toThrow();
  });

  it("requires person-level distributions to span multiple contexts", () => {
    expect(() =>
      validateDaphneEpistemicClaim({
        ...base,
        claimType: "person_distribution_estimate",
        contextApplicability: { contextKeys: ["execution"] },
      })
    ).toThrow(/at least two contexts/);

    expect(() =>
      validateDaphneEpistemicClaim({
        ...base,
        claimType: "person_distribution_estimate",
        contextApplicability: {
          contextKeys: ["execution", "planning"],
        },
      })
    ).not.toThrow();
  });

  it("records supersession as a new historical claim instead of deleting the old one", () => {
    const normalized = normalizeDaphneEpistemicClaim({
      ...base,
      claimType: "supersession",
      claimKey: "supersede:old-claim",
      claim: { reason: "explicit correction" },
      supersedesClaimId: "dclaim_old",
      idempotencyKey: "supersession-1",
    });

    expect(normalized.supersedesClaimId).toBe("dclaim_old");
    expect(normalized.claimType).toBe("supersession");
  });

  it("requires provenance for every derived claim", () => {
    expect(() =>
      validateDaphneEpistemicClaim({
        ...base,
        claimType: "association_estimate",
        sourceObservationIds: [],
      })
    ).toThrow(/source observations/);
  });

  it("derives ids within tenant/operator scope", () => {
    const id = daphneEpistemicClaimId(base);
    expect(id).toBe(daphneEpistemicClaimId(base));
    expect(
      daphneEpistemicClaimId({ ...base, tenantId: "tenant-b" })
    ).not.toBe(id);
  });
});
