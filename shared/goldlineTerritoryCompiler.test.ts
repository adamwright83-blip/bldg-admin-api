import { describe, expect, it } from "vitest";
import { compileTerritoryCandidates } from "./goldlineTerritoryCompiler";
import type { TerritorySourceOpportunity } from "./goldlineTerritories";

const laCienega = { latitude: 34.0522, longitude: -118.376 };

function source(
  id: string,
  overrides: Partial<TerritorySourceOpportunity> = {}
): TerritorySourceOpportunity {
  const n = Number(id.replace(/\D/g, "") || 0);
  return {
    physicalEntityId: id,
    displayName: `Building ${id}`,
    latitude: laCienega.latitude + n * 0.0004,
    longitude: laCienega.longitude + n * 0.0003,
    pipelineStage: "qualified",
    hasVisitEvidence: false,
    hasContactEvidence: false,
    hasProposalEvidence: false,
    isWonAccount: false,
    realGeographyLabel: "La Cienega",
    ...overrides,
  };
}

describe("territory compiler", () => {
  it("produces the same candidate from the same real member set", () => {
    const sources = [source("a"), source("b"), source("c"), source("d")];
    const first = compileTerritoryCandidates({ tenantId: "default", sources });
    const shuffled = compileTerritoryCandidates({
      tenantId: "default",
      sources: [...sources].reverse(),
    });
    expect(first.length).toBeGreaterThan(0);
    expect(first[0]!.stableKey).toBe(shuffled[0]!.stableKey);
    expect(first[0]!.guardianId).toBe(shuffled[0]!.guardianId);
    expect(first[0]!.members.map(member => member.physicalEntityId)).toEqual(
      shuffled[0]!.members.map(member => member.physicalEntityId)
    );
  });

  it("refuses to fabricate members when the world is too thin", () => {
    const result = compileTerritoryCandidates({
      tenantId: "default",
      sources: [source("only-one"), source("only-two")],
    });
    expect(result).toEqual([]);
  });

  it("does not recruit won accounts into a hunt", () => {
    const result = compileTerritoryCandidates({
      tenantId: "default",
      sources: [
        source("a"),
        source("b"),
        source("won", { isWonAccount: true }),
        source("c"),
      ],
    });
    const members = result[0]?.members.map(member => member.physicalEntityId) ?? [];
    expect(members).not.toContain("won");
    expect(members.sort()).toEqual(["a", "b", "c"]);
  });

  it("does not silently reuse occupied published members", () => {
    const result = compileTerritoryCandidates({
      tenantId: "default",
      sources: [source("a"), source("b"), source("c"), source("d")],
      occupiedPhysicalEntityIds: new Set(["a", "b", "c"]),
    });
    expect(result).toEqual([]);
  });

  it("prefers visit hunt when nearby prospects still need visits", () => {
    const result = compileTerritoryCandidates({
      tenantId: "default",
      sources: [source("a"), source("b"), source("c")],
    });
    expect(result[0]?.grammar).toBe("visit_hunt");
    expect(result[0]?.members.every(member => member.requiredAction === "visited")).toBe(true);
  });

  it("picks break-the-silence when visits exist but contact does not", () => {
    const result = compileTerritoryCandidates({
      tenantId: "default",
      sources: [
        source("a", { hasVisitEvidence: true }),
        source("b", { hasVisitEvidence: true }),
        source("c", { hasVisitEvidence: true }),
      ],
    });
    expect(result[0]?.grammar).toBe("break_the_silence");
  });

  it("drops sources without real coordinates instead of guessing them", () => {
    const result = compileTerritoryCandidates({
      tenantId: "default",
      sources: [
        source("a"),
        source("b"),
        source("ghost", { latitude: Number.NaN, longitude: Number.NaN }),
        source("c"),
      ],
    });
    expect(result[0]?.members.map(member => member.physicalEntityId)).toEqual(["a", "b", "c"]);
  });
});
