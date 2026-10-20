import { describe, expect, it } from "vitest";
import { prospectDraft, type BeverlyHillsProspect } from "./beverlyHillsProspects";

const hotel: BeverlyHillsProspect = {
  id: "acct:3",
  source: "commercial_account",
  name: "Maybourne Beverly hills",
  kind: "hotel",
  address: "225 N Cannon.",
  contact: { name: "Jordan Lee", title: "Director of Housekeeping", email: "jordan@example.com", phone: null },
  stage: "follow_up",
  signal: "Operator logged an unplanned in-person conversation",
  lastActivityAt: null,
  evidence: "Your commercial account",
  navigationUrl: null,
};

describe("Beverly Hills cold-outreach drafts", () => {
  it("a logged in-person conversation becomes a follow-up, by email when there is one", () => {
    const d = prospectDraft(hotel, "Laundry Farm");
    expect(d.channel).toBe("email");
    expect(d.subject).toBe("Following up from Maybourne Beverly hills");
    expect(d.body).toContain("Hi Jordan,");
    expect(d.body).toContain("Following up on our conversation at Maybourne Beverly hills.");
    expect(d.body).toContain("pickup-and-delivery laundry");
  });

  it("never claims a conversation, a promise or a price the records don't show", () => {
    const cold = prospectDraft({ ...hotel, contact: null, signal: null, stage: null }, "Laundry Butler");
    expect(cold.channel).toBe("visit");
    expect(cold.body).not.toMatch(/conversation|as promised|discount|% off|\$\d|met/i);
    expect(cold.body).toContain("Hello,");
  });

  it("a hand-verified building gets the resident-amenity pitch", () => {
    const d = prospectDraft(
      { ...hotel, id: "day1:blu", source: "day1_ten_doors", name: "Blu Beverly Hills", kind: "apartment building", contact: null, signal: null, stage: null, evidence: "Day 1 Ten Doors: managed by Willow Bridge" },
      "Laundry Butler"
    );
    expect(d.body).toContain("a no-cost laundry pickup-and-delivery amenity for residents");
    expect(d.body).toContain("resident amenities at Blu Beverly Hills");
  });
});
