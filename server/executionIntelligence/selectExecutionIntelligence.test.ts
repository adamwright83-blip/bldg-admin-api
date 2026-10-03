import { describe, expect, it, vi } from "vitest";
import type { SalesIntelTeaching } from "../../shared/salesIntelTeaching";

vi.mock("../salesIntel/salesIntelTeachingStore", () => ({
  listExecutionEligibleTeachings: vi.fn(async () => []),
}));

import { listExecutionEligibleTeachings } from "../salesIntel/salesIntelTeachingStore";
import { selectExecutionIntelligence } from "./selectExecutionIntelligence";

const teaching = (overrides: Partial<SalesIntelTeaching> = {}): SalesIntelTeaching => ({
  id: "row-v2",
  sourceArtifactId: "source-1",
  transcriptId: "transcript-1",
  teachingKey: "stable-opening",
  creatorName: "Trainer",
  creatorHandle: null,
  category: "opening",
  title: "Open plainly",
  principle: "State the reason for the conversation.",
  whenToUse: ["first cold visit"],
  whenNotToUse: ["existing active account"],
  exampleLanguage: [],
  confidence: 0.8,
  extractionVersion: "v1",
  extractionProvider: "fixture",
  extractionModel: null,
  promptVersion: null,
  transcriptStartMs: 1000,
  transcriptEndMs: 5000,
  reviewState: "accepted",
  reviewedBy: "reviewer",
  reviewedAt: "2026-09-28T00:00:00.000Z",
  version: 2,
  active: true,
  supersededAt: null,
  createdAt: "2026-09-28T00:00:00.000Z",
  ...overrides,
});

describe("selectExecutionIntelligence", () => {
  it("returns zero rather than filler when nothing applies", async () => {
    vi.mocked(listExecutionEligibleTeachings).mockResolvedValueOnce([teaching()]);
    await expect(
      selectExecutionIntelligence({
        tenantId: "tenant-a",
        objectiveRef: { objectiveId: "o-1", executionType: "mission" },
        context: "renewal conversation with an existing active account",
        limit: 3,
      })
    ).resolves.toEqual([]);
  });

  it("uses stable teaching identity and exact source provenance", async () => {
    vi.mocked(listExecutionEligibleTeachings).mockResolvedValueOnce([teaching()]);
    const selected = await selectExecutionIntelligence({
      tenantId: "tenant-a",
      objectiveRef: { objectiveId: "o-2", executionType: "mission" },
      context: "first cold visit to a new prospect",
      limit: 3,
    });
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      key: "stable-opening",
      version: 2,
      doctrineFamily: "sales",
      sourceProvenance: {
        sourceArtifactId: "source-1",
        transcriptId: "transcript-1",
      },
    });
    expect(selected[0]?.key).not.toBe("row-v2");
  });

  it("fails closed above the three-item contract", async () => {
    await expect(
      selectExecutionIntelligence({
        tenantId: "tenant-a",
        objectiveRef: { objectiveId: "o-3" },
        context: {},
        limit: 4,
      })
    ).rejects.toThrow(/0 through 3/);
  });
});
