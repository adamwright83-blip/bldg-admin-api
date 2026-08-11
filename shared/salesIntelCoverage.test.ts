import { describe, expect, it } from "vitest";
import { computeSalesIntelCoverage } from "./salesIntelCoverage";
import type { SalesIntelFramework } from "./salesIntel";

function framework(overrides: Partial<SalesIntelFramework>): SalesIntelFramework {
  return {
    id: overrides.id ?? "f1",
    sourceArtifactId: "s1",
    transcriptId: null,
    creatorName: "Creator A",
    creatorHandle: null,
    archetype: "ANCHOR",
    channel: "phone",
    exactObjection: "We already have a company",
    diagnosis: null,
    frameworkName: "Test",
    principle: "Test principle",
    responseFamily: "isolate_constraint",
    discoveryQuestions: [],
    exampleLanguage: [],
    whenToUse: [],
    whenNotToUse: [],
    followUpMoves: [],
    badResponses: [],
    confidence: 0.9,
    extractionVersion: "v1",
    extractionProvider: null,
    extractionModel: null,
    promptVersion: null,
    transcriptStartMs: null,
    transcriptEndMs: null,
    reviewState: "accepted",
    reviewedBy: null,
    reviewedAt: null,
    version: 1,
    active: true,
    supersededAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeSalesIntelCoverage", () => {
  it("counts frameworks by archetype and flags armory readiness", () => {
    const report = computeSalesIntelCoverage([
      framework({ id: "1", archetype: "GATEKEEPER" }),
      framework({ id: "2", archetype: "GATEKEEPER" }),
    ]);
    const gatekeeper = report.byArchetype.find(a => a.archetype === "GATEKEEPER");
    const ghost = report.byArchetype.find(a => a.archetype === "GHOST");
    expect(gatekeeper?.count).toBe(2);
    expect(gatekeeper?.armoryReady).toBe(true);
    expect(ghost?.count).toBe(0);
    expect(ghost?.armoryReady).toBe(false);
  });

  it("never invents a percentage coverage score", () => {
    const report = computeSalesIntelCoverage([framework({})]);
    expect(JSON.stringify(report)).not.toMatch(/%|coverage score|effective/i);
  });

  it("surfaces real disagreement between creators as a conflict, not an error", () => {
    const report = computeSalesIntelCoverage([
      framework({ id: "1", creatorName: "Trainer A", responseFamily: "never_discount" }),
      framework({ id: "2", creatorName: "Trainer B", responseFamily: "conditional_discount" }),
    ]);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0].responseFamilies).toHaveLength(2);
  });

  it("does not report a conflict when only one response family exists", () => {
    const report = computeSalesIntelCoverage([
      framework({ id: "1", creatorName: "Trainer A" }),
      framework({ id: "2", creatorName: "Trainer B" }),
    ]);
    expect(report.conflicts).toHaveLength(0);
  });

  it("ranks creators by accepted framework count", () => {
    const report = computeSalesIntelCoverage([
      framework({ id: "1", creatorName: "Trainer A" }),
      framework({ id: "2", creatorName: "Trainer A" }),
      framework({ id: "3", creatorName: "Trainer B" }),
    ]);
    expect(report.byCreator[0]).toEqual({ creator: "Trainer A", count: 2 });
  });

  it("handles an empty corpus without throwing", () => {
    const report = computeSalesIntelCoverage([]);
    expect(report.totalAcceptedFrameworks).toBe(0);
    expect(report.byArchetype.every(a => !a.armoryReady)).toBe(true);
    expect(report.newestAcceptedAt).toBeNull();
  });
});
