import type { RequestJobCard } from "./requestJobCardPolicy";

export const PRODUCER_LANES = ["maps_producer", "directory_producer", "web_operator_producer"] as const;
export type ProducerLane = (typeof PRODUCER_LANES)[number];

export const LEAD_QUALIFICATION_STATUSES = [
  "discovered",
  "qualified_lead",
  "contact_plan_ready",
  "mock_contact_attempted",
  "response_pending",
  "responded_available",
  "responded_unavailable",
  "late_qualified_responder",
  "partner_intake_candidate",
  "suppressed",
] as const;
export type LeadQualificationStatus = (typeof LEAD_QUALIFICATION_STATUSES)[number];

export const CONTACT_LADDER_STEPS = [
  "call",
  "voicemail",
  "website_form",
  "email",
  "sms_if_allowed",
  "second_call_if_urgent",
] as const;
export type ContactLadderStep = (typeof CONTACT_LADDER_STEPS)[number];

const CONTACTABLE_STATUSES: ReadonlySet<LeadQualificationStatus> = new Set<LeadQualificationStatus>([
  "qualified_lead",
  "contact_plan_ready",
  "mock_contact_attempted",
  "response_pending",
  "responded_available",
  "responded_unavailable",
  "late_qualified_responder",
]);

const ATTEMPTED_STATUSES: ReadonlySet<LeadQualificationStatus> = new Set<LeadQualificationStatus>([
  "mock_contact_attempted",
  "response_pending",
  "responded_available",
  "responded_unavailable",
  "late_qualified_responder",
]);

export type MockContactAttempt = {
  step: ContactLadderStep;
  mock: true;
  outcome: "no_op_simulated";
  simulatedAt: string;
  sentByHeld: false;
};

export type CastingLead = {
  id: string;
  lane: ProducerLane;
  isDemo: true;
  businessName: string;
  qualificationStatus: LeadQualificationStatus;
  hasPublicContact: boolean;
  smsConsentOnFile: boolean;
  contactLadder: ContactLadderStep[];
  contactAttempts: MockContactAttempt[];
  quote: { amount: number; currency: "USD"; withinBudget: boolean | null } | null;
  availableForRequestedWindow: boolean | null;
  respondedAt: string | null;
  blockedReasons: string[];
  winnerEligible: boolean;
  booked: false;
  accepted: false;
  paid: false;
  dispatched: false;
};

export type ProducerLaneResult = {
  lane: ProducerLane;
  leads: CastingLead[];
};

export type CastingMission = {
  missionId: string;
  noSend: true;
  llmCalled: false;
  generatedAt: string;
  sourceJobCard: {
    sourceKey: string;
    category: string;
    serviceLabel: string;
    requestedDate: string | null;
    requestedWindow: string | null;
    budgetCeiling: number | null;
    budgetRaw: string | null;
  };
  lanes: ProducerLaneResult[];
  winner: { leadId: string; lane: ProducerLane; businessName: string } | null;
  lateResponders: Array<{ leadId: string; lane: ProducerLane; routedTo: "partner_intake_candidate" }>;
  booked: false;
  accepted: false;
  paid: false;
  dispatched: false;
};

function parseBudgetCeiling(budget: string | null | undefined): number | null {
  if (!budget) return null;
  const match = /\$\s*([\d,]+(?:\.\d+)?)/.exec(budget);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function buildContactLadder(lead: { qualificationStatus: LeadQualificationStatus; smsConsentOnFile: boolean }): ContactLadderStep[] {
  if (!CONTACTABLE_STATUSES.has(lead.qualificationStatus)) return [];
  return CONTACT_LADDER_STEPS.filter(step => step !== "sms_if_allowed" || lead.smsConsentOnFile);
}

function buildMockAttempts(input: {
  qualificationStatus: LeadQualificationStatus;
  ladder: ContactLadderStep[];
  now: Date;
}): MockContactAttempt[] {
  if (!ATTEMPTED_STATUSES.has(input.qualificationStatus)) return [];
  const stepsConsumed = input.qualificationStatus === "mock_contact_attempted" ? 1 : 2;
  return input.ladder.slice(0, Math.min(stepsConsumed, input.ladder.length)).map(step => ({
    step,
    mock: true as const,
    outcome: "no_op_simulated" as const,
    simulatedAt: input.now.toISOString(),
    sentByHeld: false as const,
  }));
}

function winnerEligible(lead: { qualificationStatus: LeadQualificationStatus; quote: CastingLead["quote"]; availableForRequestedWindow: boolean | null }): boolean {
  return (
    lead.qualificationStatus === "responded_available" &&
    lead.availableForRequestedWindow === true &&
    lead.quote != null &&
    lead.quote.withinBudget === true
  );
}

type DemoLeadSeed = {
  id: string;
  lane: ProducerLane;
  businessName: string;
  qualificationStatus: LeadQualificationStatus;
  hasPublicContact: boolean;
  smsConsentOnFile: boolean;
  quoteAmount: number | null;
  availableForRequestedWindow: boolean | null;
  respondedAt: string | null;
  blockedReasons: string[];
};

function demoLeadSeeds(sourceKey: string): DemoLeadSeed[] {
  return [
    {
      id: `${sourceKey}:lead:maps_demo_1`,
      lane: "maps_producer",
      businessName: "Pawsh Mobile Grooming (Demo)",
      qualificationStatus: "responded_available",
      hasPublicContact: true,
      smsConsentOnFile: true,
      quoteAmount: 110,
      availableForRequestedWindow: true,
      respondedAt: "2026-06-23T15:05:00.000Z",
      blockedReasons: [],
    },
    {
      id: `${sourceKey}:lead:maps_demo_2`,
      lane: "maps_producer",
      businessName: "Bark & Bubbles (Demo)",
      qualificationStatus: "suppressed",
      hasPublicContact: false,
      smsConsentOnFile: false,
      quoteAmount: null,
      availableForRequestedWindow: null,
      respondedAt: null,
      blockedReasons: ["no_public_contact_method"],
    },
    {
      id: `${sourceKey}:lead:directory_demo_1`,
      lane: "directory_producer",
      businessName: "CityPaws Grooming Co (Demo)",
      qualificationStatus: "responded_available",
      hasPublicContact: true,
      smsConsentOnFile: false,
      quoteAmount: 140,
      availableForRequestedWindow: true,
      respondedAt: "2026-06-23T15:02:00.000Z",
      blockedReasons: ["quote_exceeds_budget_ceiling"],
    },
    {
      id: `${sourceKey}:lead:directory_demo_2`,
      lane: "directory_producer",
      businessName: "Boxer Breed Specialist Groomers (Demo)",
      qualificationStatus: "late_qualified_responder",
      hasPublicContact: true,
      smsConsentOnFile: true,
      quoteAmount: 118,
      availableForRequestedWindow: true,
      respondedAt: "2026-06-23T18:40:00.000Z",
      blockedReasons: ["response_after_winner_selected"],
    },
    {
      id: `${sourceKey}:lead:web_demo_1`,
      lane: "web_operator_producer",
      businessName: "Suds & Wags Mobile (Demo)",
      qualificationStatus: "response_pending",
      hasPublicContact: true,
      smsConsentOnFile: false,
      quoteAmount: null,
      availableForRequestedWindow: null,
      respondedAt: null,
      blockedReasons: ["awaiting_vendor_response"],
    },
    {
      id: `${sourceKey}:lead:web_demo_2`,
      lane: "web_operator_producer",
      businessName: "Metro Dog Spa (Demo)",
      qualificationStatus: "contact_plan_ready",
      hasPublicContact: true,
      smsConsentOnFile: true,
      quoteAmount: null,
      availableForRequestedWindow: null,
      respondedAt: null,
      blockedReasons: ["contact_not_yet_attempted"],
    },
  ];
}

/**
 * Computes an in-memory, no-send casting mission for a ready job card.
 * It performs no persistence, no outreach, no LLM calls, and no booking
 * side effects; every lead and attempt below is demo/mock data.
 */
export function buildCastingMission(input: { jobCard: RequestJobCard; sourceKey: string; now?: Date }): CastingMission {
  const now = input.now ?? new Date();
  const budgetCeiling = parseBudgetCeiling(input.jobCard.requestFacts.budget);

  const leads: CastingLead[] = demoLeadSeeds(input.sourceKey).map(seed => {
    const ladder = buildContactLadder(seed);
    const quote = seed.quoteAmount != null
      ? { amount: seed.quoteAmount, currency: "USD" as const, withinBudget: budgetCeiling != null ? seed.quoteAmount <= budgetCeiling : null }
      : null;
    const lead: CastingLead = {
      id: seed.id,
      lane: seed.lane,
      isDemo: true,
      businessName: seed.businessName,
      qualificationStatus: seed.qualificationStatus,
      hasPublicContact: seed.hasPublicContact,
      smsConsentOnFile: seed.smsConsentOnFile,
      contactLadder: ladder,
      contactAttempts: buildMockAttempts({ qualificationStatus: seed.qualificationStatus, ladder, now }),
      quote,
      availableForRequestedWindow: seed.availableForRequestedWindow,
      respondedAt: seed.respondedAt,
      blockedReasons: seed.blockedReasons,
      winnerEligible: false,
      booked: false,
      accepted: false,
      paid: false,
      dispatched: false,
    };
    lead.winnerEligible = winnerEligible(lead);
    return lead;
  });

  const eligible = leads.filter(lead => lead.winnerEligible && lead.respondedAt);
  eligible.sort((a, b) => new Date(a.respondedAt!).getTime() - new Date(b.respondedAt!).getTime());
  const winningLead = eligible[0] ?? null;

  const lanes: ProducerLaneResult[] = PRODUCER_LANES.map(lane => ({
    lane,
    leads: leads.filter(lead => lead.lane === lane),
  }));

  const lateResponders = leads
    .filter(lead => lead.qualificationStatus === "late_qualified_responder")
    .map(lead => ({ leadId: lead.id, lane: lead.lane, routedTo: "partner_intake_candidate" as const }));

  return {
    missionId: `casting_mission:${input.sourceKey}`,
    noSend: true,
    llmCalled: false,
    generatedAt: now.toISOString(),
    sourceJobCard: {
      sourceKey: input.sourceKey,
      category: input.jobCard.category,
      serviceLabel: input.jobCard.serviceLabel,
      requestedDate: input.jobCard.requestFacts.requestedDate ?? null,
      requestedWindow: input.jobCard.requestFacts.requestedWindow ?? null,
      budgetCeiling,
      budgetRaw: input.jobCard.requestFacts.budget ?? null,
    },
    lanes,
    winner: winningLead ? { leadId: winningLead.id, lane: winningLead.lane, businessName: winningLead.businessName } : null,
    lateResponders,
    booked: false,
    accepted: false,
    paid: false,
    dispatched: false,
  };
}
