import { describe, expect, it } from "vitest";
import {
  deriveAttentionReasons,
  projectPhysicalWorldState,
  type GoldlineWorldEvent,
} from "./goldlineWorld";
import {
  describeWorldPresentation,
  orderByProminence,
  presentWorldState,
} from "./goldlineWorldPresentation";

const event = (
  eventType: string,
  classification: GoldlineWorldEvent["classification"],
  occurredAt: string,
  id = `${eventType}-${occurredAt}`
): GoldlineWorldEvent => ({
  id,
  tenantId: "default",
  physicalEntityId: "building-1",
  eventType,
  classification,
  actorType: "field",
  actorId: "driver-1",
  occurredAt,
  observedAt: null,
  sourceType: "test_fixture",
  sourceId: id,
  sourceEvidenceReference: `test:${id}`,
  provenanceClass: "existing_business_record",
  verificationClass: "VERIFIED",
  confidence: "high",
  idempotencyKey: id,
  correlationId: id,
  metadata: {},
});

const project = (
  events: GoldlineWorldEvent[],
  overrides: Partial<Parameters<typeof projectPhysicalWorldState>[0]> = {}
) =>
  projectPhysicalWorldState({
    physicalEntityId: "building-1",
    events,
    residentCount: 0,
    activeResidentCount: 0,
    epistemicState: "confirmed",
    ...overrides,
  });

describe("world presentation", () => {
  it("gives every epistemic state an environment and a spoken explanation", () => {
    // Uncertainty that can only be seen is uncertainty that is inaccessible.
    const states = [
      ["confirmed", "none"],
      ["conflicting", "fracture"],
      ["unknown", "haze"],
      ["inferred", "tracing"],
      ["forecast_pressure", "pressure"],
    ] as const;
    for (const [state, veil] of states) {
      const presentation = presentWorldState(project([], { epistemicState: state }));
      expect(presentation.veil).toBe(veil);
      expect(presentation.veilExplanation.length).toBeGreaterThan(20);
    }
  });

  it("does not let looking, waiting or refreshing resolve uncertainty", () => {
    const projection = project([], { epistemicState: "unknown" });
    const first = presentWorldState(projection);
    const second = presentWorldState(projection);
    const third = presentWorldState(project([], { epistemicState: "unknown" }));
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(third.veil).toBe("haze");
  });

  it("clears the veil only when the projection's own evidence changes", () => {
    expect(presentWorldState(project([], { epistemicState: "unknown" })).veil).toBe("haze");
    expect(
      presentWorldState(project([], { epistemicState: "confirmed" })).veil
    ).toBe("none");
  });

  it("collapses repeated history into one mark carrying its real count", () => {
    const presentation = presentWorldState(
      project([
        event("visited", "action", "2026-01-01T00:00:00.000Z", "v1"),
        event("visited", "action", "2026-02-01T00:00:00.000Z", "v2"),
        event("proposal_sent", "action", "2026-03-01T00:00:00.000Z"),
      ])
    );
    const visited = presentation.marks.find(mark => mark.semantic === "visited");
    expect(visited?.count).toBe(2);
    // Newest first, so the freshest history is the history you see.
    expect(presentation.marks[0]!.semantic).toBe("proposal_sent");
    expect(visited?.sourceEvidenceReference).toBe("test:v2");
  });

  it("never presents a mark that no real event produced", () => {
    const presentation = presentWorldState(project([]));
    expect(presentation.marks).toEqual([]);
    expect(presentation.additionalMarkCount).toBe(0);
  });

  it("reports trimmed history as trimmed rather than as the whole history", () => {
    const projection = project([
      event("prospect_discovered", "evidence", "2026-01-01T00:00:00.000Z"),
      event("visited", "action", "2026-01-02T00:00:00.000Z"),
      event("call_completed", "action", "2026-01-03T00:00:00.000Z"),
      event("proposal_sent", "action", "2026-01-04T00:00:00.000Z"),
      event("account_lost", "outcome", "2026-01-05T00:00:00.000Z"),
      event("resident_first_seen", "evidence", "2026-01-06T00:00:00.000Z"),
      event("customer_recovered", "outcome", "2026-01-07T00:00:00.000Z"),
    ]);
    const presentation = presentWorldState(projection);
    expect(presentation.marks.length).toBe(6);
    expect(presentation.additionalMarkCount).toBe(1);
  });

  it("takes prominence from the strongest reason, not from the pile", () => {
    // Otherwise a place gets loud merely by accumulating weak signals.
    const many = deriveAttentionReasons({
      commercialMomentum: { eventAt: "2026-08-01T00:00:00.000Z", source: "a" },
      recentFieldSignal: { occurredAt: "2026-08-02T00:00:00.000Z", source: "b" },
      unresolvedEvidence: { count: 1, source: "c" },
    });
    const one = deriveAttentionReasons({
      overdueFollowUp: { dueAt: "2026-08-01", source: "d" },
    });
    const pile = presentWorldState(project([], { attentionReasons: many }));
    const single = presentWorldState(project([], { attentionReasons: one }));
    expect(pile.prominence).toBeLessThan(single.prominence);
    expect(single.prominenceTier).toBe("urgent");
    expect(presentWorldState(project([])).prominenceTier).toBe("ambient");
  });

  it("explains attention in the words of the reason that caused it", () => {
    const presentation = presentWorldState(
      project([], {
        attentionReasons: deriveAttentionReasons({
          cadenceRisk: { daysLate: 30, source: "orders:1" },
          recentFieldSignal: { occurredAt: "2026-08-02T00:00:00.000Z", source: "b" },
        }),
      })
    );
    expect(presentation.attentionSummary).toContain("30 days beyond observed cadence");
    expect(presentation.attentionSummary).toContain("+1 more reason");
  });

  it("orders the city by prominence without editing anything it ranks", () => {
    const loud = project([], {
      attentionReasons: deriveAttentionReasons({
        overdueFollowUp: { dueAt: "2026-08-01", source: "d" },
      }),
    });
    const quiet = project([]);
    const items = [
      { id: "quiet", projection: quiet },
      { id: "loud", projection: loud },
    ];
    const ordered = orderByProminence(items, item => presentWorldState(item.projection));
    expect(ordered.map(item => item.id)).toEqual(["loud", "quiet"]);
    // The ranked records themselves are untouched by being ranked.
    expect(items.map(item => item.id)).toEqual(["quiet", "loud"]);
    expect(ordered[0]!.projection).toBe(loud);
  });

  it("speaks identity, knowledge, history and attention in one description", () => {
    const spoken = describeWorldPresentation(
      "1100 Wilshire",
      presentWorldState(
        project([event("visited", "action", "2026-01-01T00:00:00.000Z")], {
          epistemicState: "conflicting",
          attentionReasons: deriveAttentionReasons({
            unresolvedEvidence: { count: 2, source: "evidence:1" },
          }),
        })
      )
    );
    expect(spoken).toContain("1100 Wilshire");
    expect(spoken).toContain("Sources disagree");
    expect(spoken).toContain("visited");
    expect(spoken).toContain("2 important evidence conflicts remain");
  });

  it("claims a published embodiment only when a real approved asset exists", () => {
    expect(presentWorldState(project([])).hasPublishedEmbodiment).toBe(false);
    expect(
      presentWorldState(project([], { canonicalTowerAssetId: "asset-1" }))
        .hasPublishedEmbodiment
    ).toBe(true);
  });
});
