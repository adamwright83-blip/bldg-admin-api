import type { CastingLead, CastingMission, ProducerLane } from "./vendorCastingSprintPolicy";

export const REQUIRED_TRUTH_DISCLAIMERS = [
  "No outreach has been sent.",
  "No vendor has responded.",
  "No provider has accepted.",
  "No booking is confirmed.",
  "This is a sourcing/candidate handoff only.",
] as const;

const LANE_CANDIDATE_SOURCE_TYPE: Record<ProducerLane, "manual_operator_list" | "public_business_directory" | "permitted_public_fetch"> = {
  maps_producer: "public_business_directory",
  directory_producer: "public_business_directory",
  web_operator_producer: "permitted_public_fetch",
};

export type CandidateDraftPayload = {
  tenantId: string;
  buildingSlug: string | null;
  sourceType: "manual_operator_list" | "public_business_directory" | "permitted_public_fetch";
  sourceReference: string;
  category: string;
  businessName: null;
  serviceArea: string;
  qualificationNotes: string;
  requiresRealVendorFactsBeforeUse: true;
  demoFieldsBlanked: true;
};

export type CastingSprintBootstrapHandoff = {
  handoffType: "casting_sprint_to_proposal_bootstrap_candidate_draft";
  sourceJobCardKey: string;
  leadId: string;
  lane: ProducerLane;
  businessNameForDisplayOnly: string;
  eligibilityReason: string;
  missingRealWorldFacts: string[];
  contactLadderSummary: string;
  blockedTruthClaims: string[];
  truthDisclaimers: string[];
  recommendedNextAdminAction: string;
  candidateDraftPayload: CandidateDraftPayload;
  vendorResponded: false;
  providerAccepted: false;
  booked: false;
  paid: false;
  dispatched: false;
  residentReady: false;
  sentByHeld: false;
};

export type CastingSprintBootstrapHandoffResult =
  | { allowed: true; handoff: CastingSprintBootstrapHandoff }
  | { allowed: false; reasons: string[] };

function eligibilityReason(lead: CastingLead): string {
  if (lead.winnerEligible) {
    return "Fastest qualified responder: demo response marks the lead as available for the requested window and the quoted price is within the job card's budget ceiling.";
  }
  if (lead.qualificationStatus === "responded_available") {
    return "Demo response marks the lead as available, but it is not the fastest eligible responder or fails a budget/eligibility check.";
  }
  return `Lead is in status "${lead.qualificationStatus}" and has not yet demonstrated availability or price compatibility.`;
}

function missingRealWorldFacts(lead: CastingLead): string[] {
  const missing = [
    "real_business_name_required",
    "real_public_contact_method_required",
    "real_vendor_quote_confirmation_required",
    "real_availability_confirmation_required",
  ];
  if (!lead.hasPublicContact) missing.push("no_public_contact_method_on_file");
  return missing;
}

function contactLadderSummary(lead: CastingLead): string {
  if (lead.contactLadder.length === 0) return "No contact ladder planned for this lead in its current status.";
  const attempted = lead.contactAttempts.length;
  return `Planned ladder: ${lead.contactLadder.join(" -> ")}. ${attempted} mock/no-op attempt(s) simulated; none sent.`;
}

function blockedTruthClaims(): string[] {
  return [
    "vendor_responded_claim_blocked",
    "provider_accepted_claim_blocked",
    "booking_confirmed_claim_blocked",
    "proposal_ready_for_resident_claim_blocked",
    "payment_ready_claim_blocked",
    "dispatch_ready_claim_blocked",
  ];
}

function recommendedNextAdminAction(lead: CastingLead): string {
  if (lead.winnerEligible) {
    return "Manually source one real vendor matching this lane/category and create a real candidate via the First Real Proposal Bootstrap tool; do not reuse demo lead facts.";
  }
  return "Continue the casting sprint; this lead is not yet winner-eligible.";
}

function buildCandidateDraftPayload(input: { mission: CastingMission; lead: CastingLead }): CandidateDraftPayload {
  return {
    tenantId: "default",
    buildingSlug: null,
    sourceType: LANE_CANDIDATE_SOURCE_TYPE[input.lead.lane],
    sourceReference: input.mission.sourceJobCard.sourceKey,
    category: input.mission.sourceJobCard.category,
    businessName: null,
    serviceArea: input.mission.sourceJobCard.requestedWindow ?? input.mission.sourceJobCard.category,
    qualificationNotes: `Casting sprint demo lead ${input.lead.id} (${input.lead.lane}) suggested this category/lane as a sourcing direction. Every field above must be replaced with a real, manually-verified vendor before use; the demo business name and quote must never be copied into a real candidate.`,
    requiresRealVendorFactsBeforeUse: true,
    demoFieldsBlanked: true,
  };
}

/**
 * Computes an in-memory handoff packet describing why a casting-sprint lead
 * is eligible to graduate into manual vendor sourcing. It performs no
 * persistence and creates no candidate, evidence, response, or proposal row.
 */
export function buildCastingSprintBootstrapHandoff(input: {
  mission: CastingMission;
  leadId?: string;
}): CastingSprintBootstrapHandoffResult {
  const allLeads = input.mission.lanes.flatMap(lane => lane.leads);
  const selected = input.leadId
    ? allLeads.find(lead => lead.id === input.leadId)
    : input.mission.winner
      ? allLeads.find(lead => lead.id === input.mission.winner!.leadId)
      : undefined;

  if (!selected) {
    return {
      allowed: false,
      reasons: input.leadId ? ["lead_not_found_in_mission"] : ["no_winner_eligible_lead_in_mission"],
    };
  }

  const handoff: CastingSprintBootstrapHandoff = {
    handoffType: "casting_sprint_to_proposal_bootstrap_candidate_draft",
    sourceJobCardKey: input.mission.sourceJobCard.sourceKey,
    leadId: selected.id,
    lane: selected.lane,
    businessNameForDisplayOnly: selected.businessName,
    eligibilityReason: eligibilityReason(selected),
    missingRealWorldFacts: missingRealWorldFacts(selected),
    contactLadderSummary: contactLadderSummary(selected),
    blockedTruthClaims: blockedTruthClaims(),
    truthDisclaimers: [...REQUIRED_TRUTH_DISCLAIMERS],
    recommendedNextAdminAction: recommendedNextAdminAction(selected),
    candidateDraftPayload: buildCandidateDraftPayload({ mission: input.mission, lead: selected }),
    vendorResponded: false,
    providerAccepted: false,
    booked: false,
    paid: false,
    dispatched: false,
    residentReady: false,
    sentByHeld: false,
  };

  return { allowed: true, handoff };
}
