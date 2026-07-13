import { describe, expect, it } from "vitest";
import type { CommercialMission } from "./commercialMission";
import {
  buildCommercialLaundryProposal,
  formatProposalMoney,
  type CommercialProposalProfile,
} from "./commercialProposal";

const mission: CommercialMission = {
  id: 42,
  tenantId: "tenant-a",
  code: "MISSION 042",
  status: "phone_ready",
  version: 4,
  assignedTo: "operator-1",
  opsTaskId: 91,
  account: {
    accountId: 7,
    name: "Westview Property Management",
    accountType: "Property management",
    address: "Los Angeles, CA",
    latitude: 34.0522,
    longitude: -118.2437,
    locationCount: 15,
    decisionMaker: { name: "Dana R.", title: "Operations Manager" },
  },
  opportunity: {
    opportunityId: 12,
    estimatedAnnualValueCents: 2_480_000,
    estimateConfidence: "high",
    score: 87,
    primarySignal: "Expanded to 15 buildings",
    reasons: ["Decision-maker identified"],
    risks: ["Current provider unknown"],
  },
  brief: {
    laundryOpportunity: "Centralized recurring laundry service",
    salesAngle: "One provider and one invoice",
    openingLine: "Who handles laundry across the portfolio?",
    discoveryQuestions: ["How is laundry handled today?"],
    objections: ["Current provider"],
  },
  steps: [],
  expiresAt: null,
  createdAt: "2026-07-12T00:00:00.000Z",
  updatedAt: "2026-07-12T00:00:00.000Z",
  completedAt: null,
};

const profile: CommercialProposalProfile = {
  storeName: "Sunset Laundry",
  operatorName: "A. Operator",
  phone: "(323) 555-0142",
  email: "operator@example.com",
  website: "https://example.com",
  address: "123 Sunset Boulevard, Los Angeles, CA",
  logoUrl: null,
  commercialPricePerPoundCents: 250,
  minimumOrderCents: 5000,
  turnaroundLabel: "Standard 24–48 hour turnaround",
  pickupScheduleLabel: "Scheduled pickup twice per week",
  serviceAreaLabel: "Los Angeles service area",
  insuranceLabel: null,
  services: ["Commercial wash, dry, and fold"],
};

describe("commercial laundry proposal", () => {
  it("copies canonical persisted mission and tenant profile facts", () => {
    const proposal = buildCommercialLaundryProposal({
      mission,
      profile,
      now: new Date("2026-07-12T12:00:00.000Z"),
    });
    expect(proposal.missionId).toBe(42);
    expect(proposal.missionCode).toBe("MISSION 042");
    expect(proposal.account.name).toBe("Westview Property Management");
    expect(proposal.store.storeName).toBe("Sunset Laundry");
    expect(proposal.pricing.estimatedAnnualValueCents).toBe(2_480_000);
    expect(proposal.validThrough).toBe("2026-08-11T12:00:00.000Z");
  });

  it("does not mutate the saved tenant service list", () => {
    const proposal = buildCommercialLaundryProposal({
      mission,
      profile,
    });
    proposal.services.push("Pilot-only item");
    expect(profile.services).toEqual(["Commercial wash, dry, and fold"]);
  });

  it("formats pound pricing without losing cents", () => {
    expect(formatProposalMoney(250)).toBe("$2.50");
    expect(formatProposalMoney(5000)).toBe("$50");
  });
});
