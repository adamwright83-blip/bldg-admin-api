import { describe, expect, it } from "vitest";
import { buildRequestJobCard, type RequestJobCard } from "./requestJobCardPolicy";
import {
  buildCastingMission,
  CONTACT_LADDER_STEPS,
  LEAD_QUALIFICATION_STATUSES,
  PRODUCER_LANES,
} from "./vendorCastingSprintPolicy";

function dogGroomingJobCard(overrides?: Partial<{ budget: string | null }>): RequestJobCard {
  return buildRequestJobCard({
    serviceIntent: "dog_grooming",
    rawRequest: "Dog name: Butterscotch. Breed/size: Boxer / medium / 78 lbs. Temperament: friendly, no special handling needs. Budget: up to $125 before tip. Requested date: 2026-06-23. Requested window: 11:00 AM to 1:00 PM.",
    facts: {
      requestedDate: "2026-06-23",
      requestedWindow: "11:00 AM to 1:00 PM",
      dog: { name: "Butterscotch", breed: "Boxer", weight: "78 lbs", size: "medium", temperament: "friendly", handlingNotes: "no special handling needs" },
      budget: overrides?.budget ?? "up to $125 before tip",
    },
    residentContext: { buildingSlug: "cpe-south", unit: "4B" },
    source: { sourceType: "service_request", sourceId: "155" },
    now: new Date("2026-06-24T00:00:00.000Z"),
  });
}

describe("vendor casting sprint policy", () => {
  it("computes a mission from a ready job card with three producer lanes", () => {
    const jobCard = dogGroomingJobCard();
    expect(jobCard.status).toBe("job_card_ready_for_admin_review");
    const mission = buildCastingMission({ jobCard, sourceKey: "service_request:155" });

    expect(mission.lanes.map(lane => lane.lane)).toEqual([...PRODUCER_LANES]);
    expect(mission.lanes).toHaveLength(3);
    mission.lanes.forEach(lane => expect(lane.leads.length).toBeGreaterThan(0));
  });

  it("attaches demo leads clearly labeled as demo and never persists/sends", () => {
    const mission = buildCastingMission({ jobCard: dogGroomingJobCard(), sourceKey: "service_request:155" });
    const allLeads = mission.lanes.flatMap(lane => lane.leads);
    allLeads.forEach(lead => {
      expect(lead.isDemo).toBe(true);
      expect(lead.businessName).toMatch(/\(Demo\)/);
      expect(LEAD_QUALIFICATION_STATUSES).toContain(lead.qualificationStatus);
      expect(lead.booked).toBe(false);
      expect(lead.accepted).toBe(false);
      expect(lead.paid).toBe(false);
      expect(lead.dispatched).toBe(false);
    });
    expect(mission.noSend).toBe(true);
    expect(mission.llmCalled).toBe(false);
    expect(mission.booked).toBe(false);
    expect(mission.accepted).toBe(false);
    expect(mission.paid).toBe(false);
    expect(mission.dispatched).toBe(false);
  });

  it("generates a contact ladder only for contactable leads, with sms gated on consent", () => {
    const mission = buildCastingMission({ jobCard: dogGroomingJobCard(), sourceKey: "service_request:155" });
    const allLeads = mission.lanes.flatMap(lane => lane.leads);

    const suppressed = allLeads.find(lead => lead.qualificationStatus === "suppressed")!;
    expect(suppressed.contactLadder).toEqual([]);

    const contactable = allLeads.find(lead => lead.qualificationStatus === "responded_available")!;
    expect(contactable.contactLadder.every(step => CONTACT_LADDER_STEPS.includes(step))).toBe(true);
    expect(contactable.contactLadder).toContain("call");

    const noSmsConsent = allLeads.find(lead => !lead.smsConsentOnFile && lead.contactLadder.length > 0)!;
    expect(noSmsConsent.contactLadder).not.toContain("sms_if_allowed");
  });

  it("records every contact attempt as mock/no-op and never as a real send", () => {
    const mission = buildCastingMission({ jobCard: dogGroomingJobCard(), sourceKey: "service_request:155" });
    const allAttempts = mission.lanes.flatMap(lane => lane.leads).flatMap(lead => lead.contactAttempts);
    expect(allAttempts.length).toBeGreaterThan(0);
    allAttempts.forEach(attempt => {
      expect(attempt.mock).toBe(true);
      expect(attempt.outcome).toBe("no_op_simulated");
      expect(attempt.sentByHeld).toBe(false);
    });
  });

  it("routes late qualified responders to partner intake candidate without making them the winner", () => {
    const mission = buildCastingMission({ jobCard: dogGroomingJobCard(), sourceKey: "service_request:155" });
    expect(mission.lateResponders.length).toBeGreaterThan(0);
    mission.lateResponders.forEach(entry => expect(entry.routedTo).toBe("partner_intake_candidate"));
    expect(mission.winner?.leadId).not.toBe(mission.lateResponders[0]?.leadId);
  });

  it("requires availability and price compatibility for winner eligibility, without marking booked/accepted", () => {
    const mission = buildCastingMission({ jobCard: dogGroomingJobCard(), sourceKey: "service_request:155" });
    expect(mission.winner).not.toBeNull();
    const winningLead = mission.lanes.flatMap(lane => lane.leads).find(lead => lead.id === mission.winner!.leadId)!;
    expect(winningLead.availableForRequestedWindow).toBe(true);
    expect(winningLead.quote?.withinBudget).toBe(true);
    expect(winningLead.booked).toBe(false);
    expect(winningLead.accepted).toBe(false);

    const overBudgetLead = mission.lanes.flatMap(lane => lane.leads).find(lead => lead.quote && lead.quote.withinBudget === false)!;
    expect(overBudgetLead.winnerEligible).toBe(false);
  });

  it("picks the fastest qualified responder among eligible leads as the winner", () => {
    const mission = buildCastingMission({ jobCard: dogGroomingJobCard(), sourceKey: "service_request:155" });
    const eligibleLeads = mission.lanes.flatMap(lane => lane.leads).filter(lead => lead.winnerEligible);
    const fastest = eligibleLeads.sort((a, b) => new Date(a.respondedAt!).getTime() - new Date(b.respondedAt!).getTime())[0];
    expect(mission.winner?.leadId).toBe(fastest.id);
  });

  it("returns no winner when no lead is eligible (e.g. all over budget or unavailable)", () => {
    const mission = buildCastingMission({ jobCard: dogGroomingJobCard({ budget: "up to $5 before tip" }), sourceKey: "service_request:155" });
    expect(mission.winner).toBeNull();
  });

  it("is deterministic and stable across repeated calls with the same inputs", () => {
    const jobCard = dogGroomingJobCard();
    const now = new Date("2026-06-24T00:00:00.000Z");
    const first = buildCastingMission({ jobCard, sourceKey: "service_request:155", now });
    const second = buildCastingMission({ jobCard, sourceKey: "service_request:155", now });
    expect(first).toEqual(second);
  });
});
