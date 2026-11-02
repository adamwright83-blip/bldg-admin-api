import { describe, expect, it } from "vitest";
import {
  generateSimulatedOpportunity,
  createSimulatedDraft,
} from "./simulatedOpportunity";

describe("simulatedOpportunity for User B (No Real Opportunity Exists)", () => {
  it("generates an imagined inquiry for an identified business category", () => {
    const opp = generateSimulatedOpportunity("Wildroot Floral Design", [
      {
        id: "f1",
        stage: "findings",
        payload: { kind: "place", category: "flower studio" },
        status: "active",
        companion: "rook",
        sources: [],
      },
    ]);

    expect(opp.id).toBe("simulated_opportunity_3_days_later");
    expect(opp.person.name).toBe("Elena Rostova");
    expect(opp.request.subject).toContain("botanical arrangements");
    expect(opp.request.quote).toContain("centerpiece and entrance arrangement");
    expect(opp.request.sources[0].label).toContain("Three Days Later");
    expect(opp.request.sources[0].url).toBeNull();
  });

  it("generates a clear generic studio inquiry when no category is known", () => {
    const opp = generateSimulatedOpportunity(null, []);

    expect(opp.id).toBe("simulated_opportunity_3_days_later");
    expect(opp.person.name).toBe("Julian Vance");
    expect(opp.request.quote).toContain("Do you have capacity");
  });

  it("creates simulated draft with valid approaches and safe parameters", () => {
    const opp = generateSimulatedOpportunity("Apex Advisory", []);
    const draft = createSimulatedDraft(opp, "still_wanted");

    expect(draft.status).toBe("prepared");
    expect(draft.sentByJoystick).toBe(false);
    expect(draft.verifiedSentAt).toBeNull();
    expect(draft.approaches).toHaveLength(3);
    expect(draft.body).toContain("Thank you for reaching out");

    const offerDraft = createSimulatedDraft(opp, "offer_start");
    expect(offerDraft.body).toContain("open start dates");

    const shortDraft = createSimulatedDraft(opp, "short");
    expect(shortDraft.body).toContain("quick call");
  });
});
