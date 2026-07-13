import type { CommercialMission } from "./commercialMission";

export const DEFAULT_COMMERCIAL_PROPOSAL_SERVICES = [
  "Commercial wash, dry, and fold",
  "Scheduled pickup and delivery",
  "Towels, mats, staff items, and approved tenant laundry",
  "Account-level order history and consolidated billing",
] as const;

export type CommercialProposalProfile = {
  storeName: string;
  operatorName: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  logoUrl: string | null;
  commercialPricePerPoundCents: number;
  minimumOrderCents: number | null;
  turnaroundLabel: string;
  pickupScheduleLabel: string;
  serviceAreaLabel: string;
  insuranceLabel: string | null;
  services: string[];
};

export type CommercialLaundryProposalSnapshot = {
  tenantId: string;
  missionId: number;
  missionCode: string;
  account: {
    name: string;
    address: string;
    accountType: string;
    locationCount: number;
    decisionMakerName: string | null;
    decisionMakerTitle: string | null;
  };
  generatedAt: string;
  validThrough: string;
  headline: string;
  summary: string;
  services: string[];
  operatingPlan: string[];
  pricing: {
    pricePerPoundCents: number;
    minimumOrderCents: number | null;
    estimatedAnnualValueCents: number;
    estimateConfidence: "low" | "medium" | "high";
  };
  store: CommercialProposalProfile;
  nextStep: string;
  disclaimers: string[];
};

function addDaysIso(input: Date, days: number): string {
  const next = new Date(input);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString();
}

export function buildCommercialLaundryProposal(input: {
  mission: CommercialMission;
  profile: CommercialProposalProfile;
  now?: Date;
}): CommercialLaundryProposalSnapshot {
  const now = input.now ?? new Date();
  const { mission, profile } = input;
  return {
    tenantId: mission.tenantId,
    missionId: mission.id,
    missionCode: mission.code,
    account: {
      name: mission.account.name,
      address: mission.account.address,
      accountType: mission.account.accountType,
      locationCount: mission.account.locationCount,
      decisionMakerName: mission.account.decisionMaker.name,
      decisionMakerTitle: mission.account.decisionMaker.title,
    },
    generatedAt: now.toISOString(),
    validThrough: addDaysIso(now, 30),
    headline: `A simpler laundry operation for ${mission.account.name}`,
    summary: mission.brief.salesAngle,
    services: [...profile.services],
    operatingPlan: [
      profile.pickupScheduleLabel,
      profile.turnaroundLabel,
      profile.serviceAreaLabel,
      "Final schedule and volume plan confirmed before service begins",
    ],
    pricing: {
      pricePerPoundCents: profile.commercialPricePerPoundCents,
      minimumOrderCents: profile.minimumOrderCents,
      estimatedAnnualValueCents: mission.opportunity.estimatedAnnualValueCents,
      estimateConfidence: mission.opportunity.estimateConfidence,
    },
    store: { ...profile, services: [...profile.services] },
    nextStep: mission.account.decisionMaker.name
      ? `Review the pilot scope with ${mission.account.decisionMaker.name} and choose the first participating location.`
      : "Choose one pilot location and confirm the first pickup window.",
    disclaimers: [
      "Estimated annual value is a planning estimate, not a guarantee or final contract value.",
      "Final pricing depends on confirmed volume, item mix, service frequency, and access requirements.",
      "Service terms become binding only after both parties approve a written agreement.",
    ],
  };
}

export function formatProposalMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
