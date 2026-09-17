import { describe, expect, it } from "vitest";
import {
  CLAIRE_HISTORY_ITEM_BUDGET,
  CLAIRE_HISTORY_PROMPT_BUDGET,
  assembleClaireRelationshipHistory,
  claireInterpretiveModuleEnabled,
  containsForbiddenHistoryClaim,
  describeObservedWorkPattern,
  traitClaimFromExperimentHistory,
  type ClaireRelationshipEventLike,
} from "./claireRelationshipHistory";

const tenantId = "tenant-1";
const operatorUserId = "operator-1";

function event(overrides: Partial<ClaireRelationshipEventLike> & Pick<ClaireRelationshipEventLike, "id" | "summary">): ClaireRelationshipEventLike {
  return {
    tenantId,
    operatorUserId,
    eventType: "operator_follow_through",
    provenance: "debrief_confirm",
    relatedEntityType: "commercial_mission",
    relatedEntityId: String(overrides.id),
    evidenceSource: "debrief_confirm",
    occurredAt: `2026-01-${String(overrides.id).padStart(2, "0")}T12:00:00.000Z`,
    ...overrides,
  };
}

describe("Slice 6 relationship-history assembler", () => {
  it("1 — retrieves the same operator's verified shared history later", () => {
    const history = assembleClaireRelationshipHistory({
      tenantId,
      operatorUserId,
      relationshipEvents: [
        event({ id: 11, summary: "Won mission 11 — confirmed business outcome." }),
      ],
    });
    expect(history.failClosed).toBe(false);
    expect(history.items[0]?.epistemicClass).toBe("verified-shared");
    expect(history.items[0]?.statement).toContain("Won mission 11");
  });

  it("2 — another operator's history cannot leak", () => {
    const history = assembleClaireRelationshipHistory({
      tenantId,
      operatorUserId: "operator-1",
      relationshipEvents: [
        event({ id: 1, operatorUserId: "operator-2", summary: "Secret win for operator 2." }),
        event({ id: 2, summary: "Operator 1 completed the visit." }),
      ],
    });
    expect(history.items.map(item => item.statement).join(" ")).not.toMatch(/operator 2/i);
    expect(history.items.some(item => item.statement.includes("Operator 1"))).toBe(true);
  });

  it("3 — another tenant's history cannot leak", () => {
    const history = assembleClaireRelationshipHistory({
      tenantId: "tenant-1",
      operatorUserId,
      relationshipEvents: [
        event({ id: 1, tenantId: "tenant-other", summary: "Other tenant shared failure." }),
        event({ id: 2, summary: "This tenant completed the visit." }),
      ],
    });
    expect(history.items.map(item => item.statement).join(" ")).not.toMatch(/Other tenant/);
  });

  it("4 — unresolved identity fails closed to no relationship history", () => {
    const history = assembleClaireRelationshipHistory({
      tenantId,
      operatorUserId: null,
      relationshipEvents: [event({ id: 1, summary: "Should not appear." })],
    });
    expect(history.failClosed).toBe(true);
    expect(history.items).toEqual([]);
    expect(history.promptItems).toEqual([]);
  });

  it("5 — operator-declared preference retains operator-declared provenance", () => {
    const history = assembleClaireRelationshipHistory({
      tenantId,
      operatorUserId,
      declaredPreferences: [
        {
          statement: "You told me mornings are better for calls.",
          occurredAt: "2026-03-01T08:00:00.000Z",
          topicKeys: ["mornings", "calls"],
        },
      ],
    });
    expect(history.items[0]?.epistemicClass).toBe("operator-declared");
    expect(history.items[0]?.kind).toBe("operator_declared");
    expect(history.items[0]?.statement).toContain("mornings are better");
  });

  it("6 — observed deferral stays observational and never becomes avoidance", () => {
    const statement = describeObservedWorkPattern({
      subjectLabel: "the outreach card",
      delivered: 3,
      deferred: 2,
    });
    expect(statement).toContain("deferred 2 time(s)");
    expect(statement.toLowerCase()).not.toMatch(/avoid/);
    const history = assembleClaireRelationshipHistory({
      tenantId,
      operatorUserId,
      observedPatterns: [
        {
          subjectLabel: "the outreach card",
          occurredAt: "2026-04-01T12:00:00.000Z",
          delivered: 3,
          deferred: 2,
        },
      ],
      relationshipEvents: [
        event({
          id: 9,
          eventType: "operator_avoidance",
          summary: "Avoided the stop.",
        }),
      ],
    });
    expect(history.items.some(item => item.epistemicClass === "behavior-observed")).toBe(true);
    expect(history.items.map(item => item.statement).join(" ").toLowerCase()).not.toMatch(/avoid/);
  });

  it("7 — Claire inference never overwrites the observed fact", () => {
    const history = assembleClaireRelationshipHistory({
      tenantId,
      operatorUserId,
      observedPatterns: [
        {
          id: "obs-1",
          subjectLabel: "invoice calls",
          occurredAt: "2026-05-01T12:00:00.000Z",
          deferred: 2,
        },
      ],
      inferences: [
        {
          id: "inf-1",
          statement: "Is timing getting in the way?",
          occurredAt: "2026-05-01T12:05:00.000Z",
          topicKeys: ["invoice"],
        },
      ],
    });
    const observed = history.items.find(item => item.epistemicClass === "behavior-observed");
    const inference = history.items.find(item => item.epistemicClass === "claire-inference");
    expect(observed?.statement).toContain("deferred 2 time(s)");
    expect(inference?.statement).toBe("Is timing getting in the way?");
    expect(observed?.statement).not.toBe(inference?.statement);
  });

  it("8 — newer explicit operator statement outranks a conflicting inference", () => {
    const history = assembleClaireRelationshipHistory({
      tenantId,
      operatorUserId,
      inferences: [
        {
          statement: "Is afternoon timing the issue?",
          occurredAt: "2026-05-01T12:00:00.000Z",
          topicKeys: ["calls", "afternoon", "timing"],
        },
      ],
      declaredPreferences: [
        {
          statement: "You told me mornings are better for calls.",
          occurredAt: "2026-05-02T12:00:00.000Z",
          topicKeys: ["calls", "mornings", "timing"],
        },
      ],
    });
    expect(history.items.some(item => item.kind === "inference")).toBe(false);
    expect(history.items.some(item => item.epistemicClass === "operator-declared")).toBe(true);
  });

  it("14 — Slice 5 randomized history is described without works-better claims", () => {
    const history = assembleClaireRelationshipHistory({
      tenantId,
      operatorUserId,
      experimentObservations: [
        {
          occurredAt: "2026-06-01T12:00:00.000Z",
          decisionPointId: "ops_task:1:offer:chapter-a",
          assignedOption: "STANDARD_PRESENTATION",
          followedEvent: "STARTED",
          assignmentCount: 3,
        },
      ],
    });
    const blob = history.items.map(item => item.statement).join(" ");
    expect(history.items[0]?.epistemicClass).toBe("experiment-observation");
    expect(blob).toContain("STANDARD_PRESENTATION");
    expect(blob).toContain("STARTED");
    expect(containsForbiddenHistoryClaim(blob)).toBe(false);
    expect(blob.toLowerCase()).not.toContain("works better");
  });

  it("15 — small randomized history cannot become a user trait", () => {
    expect(
      traitClaimFromExperimentHistory([
        {
          occurredAt: "2026-06-01T12:00:00.000Z",
          decisionPointId: "dp-1",
          assignedOption: "bio_containment",
          assignmentCount: 2,
        },
      ])
    ).toBeNull();
  });

  it("16 — recent relevant history is preferred over irrelevant history", () => {
    const history = assembleClaireRelationshipHistory({
      tenantId,
      operatorUserId,
      topic: "wilshire",
      relationshipEvents: [
        event({
          id: 1,
          summary: "Completed an unrelated warehouse stop.",
          occurredAt: "2026-08-20T12:00:00.000Z",
        }),
        event({
          id: 2,
          summary: "Lost the Wilshire visit last week and still completed the next one.",
          occurredAt: "2026-08-01T12:00:00.000Z",
        }),
      ],
    });
    expect(history.promptItems[0]?.statement).toMatch(/Wilshire/);
  });

  it("17 — duplicate references are deduplicated", () => {
    const history = assembleClaireRelationshipHistory({
      tenantId,
      operatorUserId,
      relationshipEvents: [
        event({ id: 4, summary: "Confirmed a real visit outcome for mission 4.", relatedEntityId: "4" }),
        event({ id: 4, summary: "Confirmed a real visit outcome for mission 4.", relatedEntityId: "4" }),
      ],
    });
    expect(history.items.filter(item => item.relationshipEventId === 4)).toHaveLength(1);
  });

  it("18 — assembly stays within the defined history budget", () => {
    const events = Array.from({ length: 20 }, (_, index) =>
      event({
        id: index + 1,
        summary: `Confirmed a real visit outcome for mission ${index + 1}.`,
      })
    );
    const history = assembleClaireRelationshipHistory({
      tenantId,
      operatorUserId,
      relationshipEvents: events,
    });
    expect(history.items.length).toBeLessThanOrEqual(CLAIRE_HISTORY_ITEM_BUDGET);
    expect(history.promptItems.length).toBeLessThanOrEqual(CLAIRE_HISTORY_PROMPT_BUDGET);
  });

  it("21 — interpretive modules never auto-enable from observed behavior", () => {
    expect(
      claireInterpretiveModuleEnabled({
        module: "recovery",
        explicitOperatorEnabled: false,
        observedBehaviorCount: 1_000,
      })
    ).toBe(false);
    expect(
      claireInterpretiveModuleEnabled({
        module: "cbt",
        explicitOperatorEnabled: false,
        observedBehaviorCount: 50,
      })
    ).toBe(false);
    expect(
      claireInterpretiveModuleEnabled({
        module: "executive_function",
        explicitOperatorEnabled: true,
      })
    ).toBe(true);
  });

  it("does not assemble diagnostic trait language as relationship knowledge", () => {
    const history = assembleClaireRelationshipHistory({
      tenantId,
      operatorUserId,
      inferences: [
        {
          statement: "You avoid outreach because of ADHD.",
          occurredAt: "2026-05-01T12:00:00.000Z",
        },
      ],
    });
    expect(history.items).toEqual([]);
  });
});
