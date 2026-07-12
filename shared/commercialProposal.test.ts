import { describe, expect, it } from "vitest";
import { DEMO_MISSION } from "./commercialMission";
import {
  buildCommercialLaundryProposal,
  formatProposalMoney,
} from "./commercialProposal";

const store = {
  storeName: "Sunset Laundry",
  operatorName: "Adam Wright",
  phone: "(323) 555-0142",
  email: "adam@example.com",
  website: "example.com",
  address: "Los Angeles, CA",
  commercialPricePerPoundCents: 250,
  minimumOrderCents: 5000,
  turnaroundLabel: "Standard 24–48 hour turnaround",
  pickupScheduleLabel: "Scheduled pickup twice per week",
  serviceAreaLabel: "Los Angeles service area",
};

describe("commercial laundry proposal", () => {
  it("keeps the mission identity and store facts intact", () => {
    const proposal = buildCommercialLaundryProposal({
      mission: DEMO_MISSION,
      store,
      now: new Date("2026-07-12T12:00:00.000Z"),
    });

    expect(proposal.missionCode).toBe("MISSION 042");
    expect(proposal.accountName).toBe("Westview Property Management");
    expect(proposal.store.storeName).toBe("Sunset Laundry");
    expect(proposal.pricing.pricePerPoundCents).toBe(250);
    expect(proposal.validThrough).toBe("2026-08-11T12:00:00.000Z");
  });

  it("formats pound pricing without losing cents", () => {
    expect(formatProposalMoney(250)).toBe("$2.50");
    expect(formatProposalMoney(5000)).toBe("$50");
  });
});
