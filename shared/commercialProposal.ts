import type { CommercialMission } from "./commercialMission";

export type CommercialLaundryStoreProfile = {
  storeName: string;
  operatorName: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  commercialPricePerPoundCents: number;
  minimumOrderCents?: number | null;
  turnaroundLabel: string;
  pickupScheduleLabel: string;
  serviceAreaLabel: string;
  insuranceLabel?: string | null;
};

export type CommercialLaundryProposal = {
  id: string;
  missionCode: string;
  accountName: string;
  decisionMakerName: string | null;
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
  };
  store: CommercialLaundryStoreProfile;
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
  store: CommercialLaundryStoreProfile;
  now?: Date;
}): CommercialLaundryProposal {
  const now = input.now ?? new Date();
  const { mission, store } = input;

  return {
    id: `proposal-${mission.tenantId}-${mission.id}`,
    missionCode: mission.code,
    accountName: mission.accountName,
    decisionMakerName: mission.decisionMaker.name,
    generatedAt: now.toISOString(),
    validThrough: addDaysIso(now, 30),
    headline: `A simpler laundry operation for ${mission.accountName}`,
    summary:
      mission.salesAngle ||
      "One dependable local laundry partner, scheduled pickup and delivery, and one clear point of accountability.",
    services: [
      "Commercial wash, dry, and fold",
      "Scheduled pickup and delivery",
      "Towels, mats, staff items, and approved tenant laundry",
      "Account-level order history and consolidated billing",
    ],
    operatingPlan: [
      store.pickupScheduleLabel,
      store.turnaroundLabel,
      store.serviceAreaLabel,
      "Final schedule and volume plan confirmed before service begins",
    ],
    pricing: {
      pricePerPoundCents: store.commercialPricePerPoundCents,
      minimumOrderCents: store.minimumOrderCents ?? null,
      estimatedAnnualValueCents: mission.estimatedAnnualValueCents,
    },
    store,
    nextStep: mission.decisionMaker.name
      ? `Review the pilot scope with ${mission.decisionMaker.name} and choose the first participating location.`
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
