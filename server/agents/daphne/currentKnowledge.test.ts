import { describe, expect, it } from "vitest";
import { resolveDaphneCurrentClaims } from "./consolidation";
import {
  normalizeDaphneEpistemicClaim,
  type DaphneEpistemicClaimRecord,
} from "./epistemicStore";

const scope = {
  tenantId: "t",
  canonicalOperatorId: "o",
  agentId: "claire",
  asOf: new Date("2026-10-09T12:00:00Z"),
};
function claim(
  id: string,
  overrides: Partial<DaphneEpistemicClaimRecord> = {}
): DaphneEpistemicClaimRecord {
  const normalized = normalizeDaphneEpistemicClaim({
    tenantId: "t",
    canonicalOperatorId: "o",
    agentId: "claire",
    claimType: "direct_fact",
    claimKey: "availability",
    claim: { value: "mornings" },
    sourceObservationIds: ["obs"],
    modelVersion: "v1",
    idempotencyKey: id,
  });
  return {
    ...normalized,
    id,
    claim: normalized.claimJson,
    sourceObservationIds: normalized.sourceObservationIdsJson,
    supportingEvidence: [],
    counterEvidence: [],
    scope: null,
    contextApplicability: null,
    uncertainty: null,
    validFrom: null,
    validUntil: null,
    lastReinforcedAt: null,
    createdAt: "2026-10-08T12:00:00Z",
    ...overrides,
  };
}
const current = (claims: DaphneEpistemicClaimRecord[]) =>
  resolveDaphneCurrentClaims({ ...scope, claims });
describe("Daphne current knowledge over immutable history", () => {
  it("projects an explicit correction and removes the old claim without mutating history", () => {
    const old = claim("old");
    const correction = claim("new", {
      claimType: "supersession",
      supersedesClaimId: "old",
      claim: { userDisposition: "corrected", value: { value: "afternoons" } },
      sourceObservationIds: ["correction"],
    });
    const history = [old, correction];
    const snapshot = structuredClone(history);
    expect(current(history)).toMatchObject([
      {
        id: "new",
        claimType: "direct_fact",
        claim: { value: "afternoons" },
        sourceObservationIds: ["correction"],
      },
    ]);
    expect(history).toEqual(snapshot);
    expect(current(history)).toEqual(current(history));
  });
  it("does not resurrect a rejected claim when its disposition expires", () => {
    expect(
      current([
        claim("old"),
        claim("reject", {
          claimType: "supersession",
          supersedesClaimId: "old",
          claim: { userDisposition: "rejected" },
          validUntil: "2026-10-09T11:00:00Z",
        }),
      ])
    ).toEqual([]);
  });
  it.each([
    { agentId: "other" },
    { tenantId: "other" },
    { canonicalOperatorId: "other" },
    { validUntil: "2026-10-09T11:00:00Z" },
    { validFrom: "2026-10-10T00:00:00Z" },
    { epistemicStatus: "contradicted" as const },
    { createdAt: "2026-10-10T00:00:00Z" },
  ])("excludes out-of-scope or inactive claim %j", override => {
    expect(current([claim("old", override)])).toEqual([]);
  });
  it("allows explicitly global claims and preserves competing hypotheses", () => {
    expect(
      current([claim("global", { agentId: null }), claim("alternative")])
    ).toHaveLength(2);
  });
  it("coalesces duplicate facts while retaining independent provenance and immutable history", () => {
    const history = [
      claim("a", { sourceObservationIds: ["a"] }),
      claim("b", { sourceObservationIds: ["b"] }),
    ];
    const snapshot = structuredClone(history);
    expect(current(history)).toMatchObject([
      { sourceObservationIds: ["a", "b"] },
    ]);
    expect(history).toEqual(snapshot);
  });
  it("gives an explicit correction precedence over conflicting inference, not unrelated hypotheses", () => {
    const corrected = claim("explicit", {
      supportingEvidence: [{ explicitCorrection: true }],
    });
    const inferred = claim("inferred", {
      claimType: "if_then_hypothesis",
      claim: { value: "evenings" },
    });
    const unrelated = claim("unrelated", {
      claimType: "if_then_hypothesis",
      claimKey: "other",
    });
    expect(current([corrected, inferred, unrelated]).map(c => c.id)).toEqual([
      "explicit",
      "unrelated",
    ]);
  });
});
