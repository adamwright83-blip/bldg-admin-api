import { describe, expect, it } from "vitest";
import type { SalesIntelTeaching } from "../../shared/salesIntelTeaching";
import { selectClairePreVisitTeachings } from "./preVisitClaireLoadout";

function teaching(input: Partial<SalesIntelTeaching> & Pick<SalesIntelTeaching, "id" | "category" | "creatorName">): SalesIntelTeaching {
  return {
    id: input.id,
    sourceArtifactId: input.sourceArtifactId ?? "source-1",
    transcriptId: input.transcriptId ?? "transcript-1",
    teachingKey: input.teachingKey ?? input.id,
    creatorName: input.creatorName,
    creatorHandle: input.creatorHandle ?? null,
    category: input.category,
    title: input.title ?? input.id,
    principle: input.principle ?? "Use the source teaching.",
    whenToUse: input.whenToUse ?? [],
    whenNotToUse: input.whenNotToUse ?? [],
    exampleLanguage: input.exampleLanguage ?? [],
    confidence: input.confidence ?? 0.9,
    extractionVersion: input.extractionVersion ?? "v1",
    extractionProvider: input.extractionProvider ?? "test",
    extractionModel: input.extractionModel ?? "test",
    promptVersion: input.promptVersion ?? "test",
    transcriptStartMs: input.transcriptStartMs ?? 0,
    transcriptEndMs: input.transcriptEndMs ?? 1000,
    reviewState: input.reviewState ?? "accepted",
    reviewedBy: input.reviewedBy ?? "reviewer",
    reviewedAt: input.reviewedAt ?? "2026-09-27T00:00:00.000Z",
    version: input.version ?? 1,
    active: input.active ?? true,
    supersededAt: input.supersededAt ?? null,
    createdAt: input.createdAt ?? "2026-09-27T00:00:00.000Z",
  };
}

describe("Claire pre-visit tower loadout", () => {
  it("equips three distinct Shelby teachings by encounter role when available", () => {
    const result = selectClairePreVisitTeachings([
      teaching({ id: "open", creatorName: "Shelby Sapp", category: "opening" }),
      teaching({ id: "probe", creatorName: "Shelby Sapp", category: "discovery" }),
      teaching({ id: "weapon", creatorName: "Shelby Sapp", category: "objection_handling" }),
      teaching({ id: "other", creatorName: "Other Trainer", category: "opening", confidence: 1 }),
    ]);

    expect(result.map(item => item.slot)).toEqual(["OPEN", "PROBE", "WEAPON"]);
    expect(result.map(item => item.teaching?.id)).toEqual(["open", "probe", "weapon"]);
  });

  it("never exposes pending or inactive teachings to the player", () => {
    const result = selectClairePreVisitTeachings([
      teaching({ id: "pending", creatorName: "Shelby Sapp", category: "opening", reviewState: "review_required" }),
      teaching({ id: "inactive", creatorName: "Shelby Sapp", category: "discovery", active: false }),
      teaching({ id: "safe", creatorName: "Other Trainer", category: "opening" }),
    ]);

    const ids = result.map(item => item.teaching?.id).filter(Boolean);
    expect(ids).toContain("safe");
    expect(ids).not.toContain("pending");
    expect(ids).not.toContain("inactive");
  });

  it("falls back truthfully instead of inventing a trainer source", () => {
    const result = selectClairePreVisitTeachings([]);
    expect(result).toEqual([
      { slot: "OPEN", teaching: null },
      { slot: "PROBE", teaching: null },
      { slot: "WEAPON", teaching: null },
    ]);
  });
});
