import { describe, expect, it } from "vitest";
import type { SalesIntelTeaching } from "../../shared/salesIntelTeaching";
import {
  compileClairePreVisitItems,
  selectClairePreVisitTeachings,
} from "./preVisitClaireLoadout";
import type { MissionSalesBrief } from "../../shared/missionSalesBrief";

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

  it("does not put an unrelated Shelby teaching into the wrong slot", () => {
    const result = selectClairePreVisitTeachings([
      teaching({ id: "shelby-close", creatorName: "Shelby Sapp", category: "closing" }),
      teaching({ id: "opening", creatorName: "Other Trainer", category: "opening" }),
    ]);
    expect(result[0].teaching?.id).toBe("opening");
  });

  it("attributes mission-brief fallback copy to the mission brief, not a trainer", () => {
    const brief = {
      missionId: 15,
      id: 99,
      version: 1,
      tenantId: "t1",
      accountId: null,
      generatedAt: "2026-09-27T00:00:00.000Z",
      generatedFromEvidenceThrough: "2026-09-27T00:00:00.000Z",
      account: { name: "Los Feliz Towers", address: "4455 Los Feliz Blvd", accountType: "multifamily" },
      mission: { missionType: "multifamily", currentStatus: "phone_ready", objective: "Reach the decision maker." },
      knownFacts: [],
      priorInteractions: [],
      priorOutcomes: [],
      relevantSignals: [],
      unknowns: [{ question: "Who owns vendor approval?", reason: "Unknown." }],
      unresolvedQuestions: ["Who owns vendor approval?"],
      recommendedApproach: {
        primaryObjective: "Reach the decision maker.",
        recommendedOpening: "I am here to learn how the building handles resident laundry needs.",
        questionsToAsk: ["Who owns vendor approval?"],
        actionsToTake: [],
        thingsToAvoid: ["Do not assume they have an incumbent vendor."],
        successDefinition: "Identify the next real step.",
      },
      salesIntel: {
        includedIntelIds: [],
        teachingId: null,
        frameworkId: null,
        rationale: null,
        considered: [],
        excluded: [],
      },
      provenance: { sourceReferences: [], verificationClasses: ["recommendation"] },
      source: "fallback",
      compilerVersion: "test",
      confidence: 0.4,
      warnings: [],
      createdBy: "system",
      supersedesVersion: null,
    } satisfies MissionSalesBrief;

    const items = compileClairePreVisitItems({
      brief,
      selected: [
        { slot: "OPEN", teaching: null },
        { slot: "PROBE", teaching: null },
        { slot: "WEAPON", teaching: null },
      ],
    });
    expect(items.every(item => item.provenance === "mission_brief")).toBe(true);
    expect(items.every(item => item.sourceCreator === null)).toBe(true);
  });

});
