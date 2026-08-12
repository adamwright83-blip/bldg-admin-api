import { describe, expect, it } from "vitest";
import { computeSalesIntelTeachingCoverage } from "./salesIntelTeachingCoverage";
import type { SalesIntelTeaching } from "./salesIntelTeaching";

function fixture(overrides: Partial<SalesIntelTeaching> = {}): SalesIntelTeaching {
  return {
    id: overrides.id ?? "t1",
    sourceArtifactId: "s1",
    transcriptId: "tr1",
    teachingKey: "key1",
    creatorName: "Creator A",
    creatorHandle: null,
    category: "discovery",
    title: "Test teaching",
    principle: "Test principle",
    whenToUse: [],
    whenNotToUse: [],
    exampleLanguage: [],
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

describe("computeSalesIntelTeachingCoverage", () => {
  it("counts by category and flags never-present categories at zero", () => {
    const report = computeSalesIntelTeachingCoverage([
      fixture({ id: "1", category: "discovery" }),
      fixture({ id: "2", category: "discovery" }),
    ]);
    const discovery = report.byCategory.find(c => c.category === "discovery");
    const closing = report.byCategory.find(c => c.category === "closing");
    expect(discovery?.count).toBe(2);
    expect(closing?.count).toBe(0);
  });

  it("never invents a percentage or completeness score", () => {
    const report = computeSalesIntelTeachingCoverage([fixture({})]);
    expect(JSON.stringify(report)).not.toMatch(/%|coverage score|complete/i);
  });

  it("ranks creators and sources by teaching count", () => {
    const report = computeSalesIntelTeachingCoverage([
      fixture({ id: "1", creatorName: "Creator A", sourceArtifactId: "s1" }),
      fixture({ id: "2", creatorName: "Creator A", sourceArtifactId: "s1" }),
      fixture({ id: "3", creatorName: "Creator B", sourceArtifactId: "s2" }),
    ]);
    expect(report.byCreator[0]).toEqual({ creator: "Creator A", count: 2 });
    expect(report.bySource[0]).toEqual({ sourceArtifactId: "s1", count: 2 });
  });

  it("handles an empty corpus without throwing", () => {
    const report = computeSalesIntelTeachingCoverage([]);
    expect(report.totalAcceptedTeachings).toBe(0);
    expect(report.byCategory.every(c => c.count === 0)).toBe(true);
    expect(report.newestAcceptedAt).toBeNull();
  });
});
