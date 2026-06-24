import { describe, expect, it } from "vitest";
import { buildRequestJobCard, type RequestJobCard } from "./requestJobCardPolicy";
import { buildCastingMission } from "./vendorCastingSprintPolicy";
import { buildCastingSprintBootstrapHandoff, REQUIRED_TRUTH_DISCLAIMERS } from "./castingSprintBootstrapBridgePolicy";

function dogGroomingJobCard(): RequestJobCard {
  return buildRequestJobCard({
    serviceIntent: "dog_grooming",
    rawRequest: "Dog name: Butterscotch. Breed/size: Boxer / medium / 78 lbs. Temperament: friendly, no special handling needs. Budget: up to $125 before tip. Requested date: 2026-06-23. Requested window: 11:00 AM to 1:00 PM.",
    facts: {
      requestedDate: "2026-06-23",
      requestedWindow: "11:00 AM to 1:00 PM",
      dog: { name: "Butterscotch", breed: "Boxer", weight: "78 lbs", size: "medium", temperament: "friendly", handlingNotes: "no special handling needs" },
      budget: "up to $125 before tip",
    },
    residentContext: { buildingSlug: "cpe-south", unit: "4B" },
    source: { sourceType: "service_request", sourceId: "155" },
    now: new Date("2026-06-24T00:00:00.000Z"),
  });
}

describe("casting sprint bootstrap bridge policy", () => {
  it("produces a handoff packet for the fastest eligible casting sprint lead", () => {
    const mission = buildCastingMission({ jobCard: dogGroomingJobCard(), sourceKey: "service_request:155" });
    const result = buildCastingSprintBootstrapHandoff({ mission });
    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error("expected allowed");
    expect(result.handoff.leadId).toBe(mission.winner!.leadId);
  });

  it("references the source job card key", () => {
    const mission = buildCastingMission({ jobCard: dogGroomingJobCard(), sourceKey: "service_request:155" });
    const result = buildCastingSprintBootstrapHandoff({ mission });
    if (!result.allowed) throw new Error("expected allowed");
    expect(result.handoff.sourceJobCardKey).toBe("service_request:155");
  });

  it("includes producer lane and an eligibility reason", () => {
    const mission = buildCastingMission({ jobCard: dogGroomingJobCard(), sourceKey: "service_request:155" });
    const result = buildCastingSprintBootstrapHandoff({ mission });
    if (!result.allowed) throw new Error("expected allowed");
    expect(result.handoff.lane).toBe(mission.winner!.lane);
    expect(result.handoff.eligibilityReason.length).toBeGreaterThan(10);
  });

  it("includes blocked truth claims and the required disclaimers", () => {
    const mission = buildCastingMission({ jobCard: dogGroomingJobCard(), sourceKey: "service_request:155" });
    const result = buildCastingSprintBootstrapHandoff({ mission });
    if (!result.allowed) throw new Error("expected allowed");
    expect(result.handoff.blockedTruthClaims.length).toBeGreaterThan(0);
    expect(result.handoff.truthDisclaimers).toEqual([...REQUIRED_TRUTH_DISCLAIMERS]);
    expect(result.handoff.truthDisclaimers).toContain("No outreach has been sent.");
    expect(result.handoff.truthDisclaimers).toContain("No vendor has responded.");
    expect(result.handoff.truthDisclaimers).toContain("No provider has accepted.");
    expect(result.handoff.truthDisclaimers).toContain("No booking is confirmed.");
    expect(result.handoff.truthDisclaimers).toContain("This is a sourcing/candidate handoff only.");
  });

  it("never marks vendor responded, accepted, booked, paid, dispatched, or resident-ready", () => {
    const mission = buildCastingMission({ jobCard: dogGroomingJobCard(), sourceKey: "service_request:155" });
    const result = buildCastingSprintBootstrapHandoff({ mission });
    if (!result.allowed) throw new Error("expected allowed");
    expect(result.handoff.vendorResponded).toBe(false);
    expect(result.handoff.providerAccepted).toBe(false);
    expect(result.handoff.booked).toBe(false);
    expect(result.handoff.paid).toBe(false);
    expect(result.handoff.dispatched).toBe(false);
    expect(result.handoff.residentReady).toBe(false);
    expect(result.handoff.sentByHeld).toBe(false);
  });

  it("blanks real-vendor-identifying fields in the candidate draft payload and flags it as not ready for use", () => {
    const mission = buildCastingMission({ jobCard: dogGroomingJobCard(), sourceKey: "service_request:155" });
    const result = buildCastingSprintBootstrapHandoff({ mission });
    if (!result.allowed) throw new Error("expected allowed");
    expect(result.handoff.candidateDraftPayload.businessName).toBeNull();
    expect(result.handoff.candidateDraftPayload.requiresRealVendorFactsBeforeUse).toBe(true);
    expect(result.handoff.candidateDraftPayload.demoFieldsBlanked).toBe(true);
    expect(result.handoff.missingRealWorldFacts).toContain("real_business_name_required");
  });

  it("can target a specific lead by id, not only the winner", () => {
    const mission = buildCastingMission({ jobCard: dogGroomingJobCard(), sourceKey: "service_request:155" });
    const suppressedLead = mission.lanes.flatMap(lane => lane.leads).find(lead => lead.qualificationStatus === "suppressed")!;
    const result = buildCastingSprintBootstrapHandoff({ mission, leadId: suppressedLead.id });
    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error("expected allowed");
    expect(result.handoff.leadId).toBe(suppressedLead.id);
    expect(result.handoff.eligibilityReason).not.toMatch(/Fastest qualified responder/);
  });

  it("is blocked when no lead id is given and the mission has no winner", () => {
    const mission = buildCastingMission({
      jobCard: buildRequestJobCard({
        serviceIntent: "dog_grooming",
        rawRequest: "Dog name: Butterscotch. Breed/size: Boxer / medium / 78 lbs. Budget: up to $5 before tip. Requested date: 2026-06-23. Requested window: 11:00 AM to 1:00 PM.",
        facts: { requestedDate: "2026-06-23", requestedWindow: "11:00 AM to 1:00 PM", budget: "up to $5 before tip", dog: { breed: "Boxer", size: "medium" } },
        residentContext: { buildingSlug: "cpe-south" },
        source: { sourceType: "service_request", sourceId: "155" },
      }),
      sourceKey: "service_request:155",
    });
    const result = buildCastingSprintBootstrapHandoff({ mission });
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("expected blocked");
    expect(result.reasons).toContain("no_winner_eligible_lead_in_mission");
  });

  it("is blocked when an explicit lead id does not exist in the mission", () => {
    const mission = buildCastingMission({ jobCard: dogGroomingJobCard(), sourceKey: "service_request:155" });
    const result = buildCastingSprintBootstrapHandoff({ mission, leadId: "does_not_exist" });
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("expected blocked");
    expect(result.reasons).toContain("lead_not_found_in_mission");
  });
});
