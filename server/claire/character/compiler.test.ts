import { describe, expect, it } from "vitest";
import { compileClaireCharacterContext } from "./compiler";
import { CLAIRE_CHARACTER_VERSION } from "./characterDefinition";
import { CLAIRE_DEFAULT_RELATIONSHIP_STATE } from "./types";
import type { ClaireRelationshipEvent, ClaireRelationshipState } from "./types";

const baseState: ClaireRelationshipState = {
  tenantId: "tenant-1",
  operatorUserId: "operator-1",
  characterId: "claire",
  updatedAt: new Date().toISOString(),
  ...CLAIRE_DEFAULT_RELATIONSHIP_STATE,
};

describe("B/M/N/P — runtime character compiler", () => {
  it("B — stamps every compiled context with character and compiler version", () => {
    const compiled = compileClaireCharacterContext({
      mode: "casual",
      relationshipState: baseState,
      recentSharedHistory: [],
    });
    expect(compiled.version.characterVersion).toBe(CLAIRE_CHARACTER_VERSION);
    expect(compiled.version.compilerVersion).toMatch(/^claire-runtime-/);
  });

  it("M — routine pre-drive compilation stays concise and carries the field-mode override", () => {
    const compiled = compileClaireCharacterContext({
      mode: "pre_drive",
      relationshipState: { ...baseState, disclosureTier: 3 },
      recentSharedHistory: [],
    });
    expect(compiled.promptSection).toContain("Priorities in order: clarity, brevity, safety, useful action");
  });

  it("N — pre-drive (field mode) never surfaces personal canon even at Tier 3", () => {
    const compiled = compileClaireCharacterContext({
      mode: "pre_drive",
      relationshipState: { ...baseState, disclosureTier: 3 },
      recentSharedHistory: [],
    });
    expect(compiled.promptSection).not.toMatch(/father/i);
    expect(compiled.promptSection).not.toMatch(/six-year/i);
    expect(compiled.promptSection).not.toMatch(/childhood/i);
  });

  it("P — gated canon is never volunteered by mode or legacy tier; it enters a prompt only when the controller bounds that exact fragment", () => {
    const casual = compileClaireCharacterContext({
      mode: "casual",
      relationshipState: { ...baseState, disclosureTier: 3 },
      recentSharedHistory: [],
      progression: { rapportBand: 3, personalRung: 3 },
    });
    expect(casual.eligibleCanonFacts.join(" ")).not.toMatch(/six-year/i);

    const bounded = compileClaireCharacterContext({
      mode: "casual",
      relationshipState: baseState,
      recentSharedHistory: [],
      boundedCanonFragmentIds: ["core_relationship"],
    });
    expect(bounded.eligibleCanonFacts.join(" ")).toMatch(/six-year/i);
    expect(bounded.eligibleCanonFragmentIds).toEqual(["core_relationship"]);

    const privateAsked = compileClaireCharacterContext({
      mode: "casual",
      relationshipState: baseState,
      recentSharedHistory: [],
      boundedCanonFragmentIds: ["private_exes_last_exchange", "private_fathers_last_exchange"],
    });
    expect(privateAsked.eligibleCanonFacts).toEqual([]);
  });

  it("exposes full observability fields for the review tool (Slice 8): dimensions, shared-history ids, canon fragment ids", () => {
    const compiled = compileClaireCharacterContext({
      mode: "casual",
      relationshipState: { ...baseState, disclosureTier: 1, professionalRespect: 12, reliability: 5, disclosureSafety: 3, familiarity: 7 },
      recentSharedHistory: [
        {
          id: 55,
          tenantId: "tenant-1",
          operatorUserId: "operator-1",
          characterId: "claire",
          eventType: "operator_follow_through",
          summary: "did the thing",
          provenance: "test",
          relatedEntityType: null,
          relatedEntityId: null,
          evidenceSource: null,
          occurredAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ],
    });
    expect(compiled.relationshipDimensions).toEqual({
      professionalRespect: 12,
      reliability: 5,
      disclosureSafety: 3,
      familiarity: 7,
    });
    expect(compiled.sharedHistoryEventIds).toEqual([55]);
    expect(compiled.eligibleCanonFragmentIds).toContain("core_age");
  });

  it("carries bounded shared-history summaries, never a full transcript dump", () => {
    const events: ClaireRelationshipEvent[] = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      tenantId: "tenant-1",
      operatorUserId: "operator-1",
      characterId: "claire",
      eventType: "operator_follow_through",
      summary: `event-${index + 1}`,
      provenance: "test",
      relatedEntityType: null,
      relatedEntityId: null,
      evidenceSource: null,
      occurredAt: new Date(2026, 0, index + 1).toISOString(),
      createdAt: new Date(2026, 0, index + 1).toISOString(),
    }));
    const compiled = compileClaireCharacterContext({
      mode: "casual",
      relationshipState: baseState,
      recentSharedHistory: events,
    });
    expect(compiled.sharedHistorySummaries.length).toBeLessThanOrEqual(5);
    expect(compiled.sharedHistorySummaries).toContain("event-20");
  });
});
