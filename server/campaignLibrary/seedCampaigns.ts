/**
 * Slice 1 — the seven seed growth campaigns, plus the Colosseum campaign
 * that round-trips shared/leadHunt.ts's COLOSSEUM_LEAD_HUNT unchanged.
 *
 * Timing guidance here is editable, evidence-informed assumption data, never
 * a claim of proven or scientific timing. Each assumption records its source
 * and the date it was recorded so it can be revised from Adam's own results.
 */
import type { GrowthCampaignInput } from "./campaignLibraryTypes";

const RECORDED_AT = "2026-09-11";

function assumption(text: string, source: string) {
  return { assumption: text, source, recordedAt: RECORDED_AT };
}

export const SEED_CAMPAIGNS: Array<{
  campaignId: string;
  campaign: GrowthCampaignInput;
}> = [
  {
    campaignId: "door-hanger-territory-operation",
    campaign: {
      enabled: true,
      title: "Door-Hanger Territory Operation",
      objective:
        "Put a printed offer in the hand of every household on a chosen residential street to generate inbound territory orders.",
      completionCondition:
        "A defined block or street segment is fully covered with door hangers, logged street-by-street.",
      prepLeadDays: 3,
      prepCondition:
        "Door hangers for the chosen territory must already be printed and in the vehicle.",
      pocketKind: "open_ended",
      pocketMinutesMin: 45,
      fallbackVariant: {
        title: "Single-block hang",
        completionCondition: "One block, using hangers already on hand, logged.",
        pocketMinutesMin: 15,
      },
      autoVerifiable: [
        "GPS presence in the target territory during the reported window",
      ],
      selfReported: [
        "Which street/block segment was actually covered",
        "Approximate household count reached",
      ],
      missionCategory: "territory_expansion",
      companionAbilityId: null,
      timingAssumptions: [
        assumption(
          "Weekday late-afternoon distribution (after 3pm) sees more hangers stay up overnight than early-morning distribution.",
          "Adam's own field notes, informal"
        ),
      ],
      opsTaskType: "door_hanger_operation",
      legacyContract: null,
      legacyContractRef: null,
    },
  },
  {
    campaignId: "property-manager-office-pitch",
    campaign: {
      enabled: true,
      title: "Property-Manager / Office-Account Pitch",
      objective:
        "Pitch an apartment property manager or office building's ops manager on a recurring commercial account.",
      completionCondition:
        "An in-person pitch was delivered to a decision-maker at the target property.",
      prepLeadDays: 2,
      prepCondition:
        "The property's decision-maker and best contact window must be identified before visiting.",
      pocketKind: "between_stops",
      pocketMinutesMin: 30,
      fallbackVariant: {
        title: "Drop-and-follow",
        completionCondition:
          "A pitch packet is left with front desk/leasing office when the decision-maker is unavailable, and a follow-up is scheduled.",
        pocketMinutesMin: 10,
      },
      autoVerifiable: ["GPS arrival at the target property address"],
      selfReported: [
        "Whether a decision-maker was actually present",
        "Pitch outcome (interested / not interested / follow-up needed)",
      ],
      missionCategory: "account_acquisition",
      companionAbilityId: null,
      timingAssumptions: [
        assumption(
          "Property managers are more reachable mid-morning on weekdays than afternoons.",
          "Adam's own field notes, informal"
        ),
      ],
      opsTaskType: "office_account_pitch",
      legacyContract: null,
      legacyContractRef: null,
    },
  },
  {
    campaignId: "referral-ask",
    campaign: {
      enabled: true,
      title: "Referral Ask",
      objective:
        "Ask a satisfied existing customer to refer a neighbor, coworker, or friend.",
      completionCondition:
        "The ask was made directly to a specific customer, in person or by message.",
      prepLeadDays: 0,
      prepCondition: null,
      pocketKind: "any",
      pocketMinutesMin: 5,
      fallbackVariant: null,
      autoVerifiable: ["Message sent, if the ask was made by text/email"],
      selfReported: [
        "Which customer was asked",
        "Whether they agreed to refer someone",
      ],
      missionCategory: "relationship_capital",
      companionAbilityId: null,
      timingAssumptions: [
        assumption(
          "Asking right after a delivery, while satisfaction is freshest, gets a better response than asking days later.",
          "Adam's own field notes, informal"
        ),
      ],
      opsTaskType: "referral_ask",
      legacyContract: null,
      legacyContractRef: null,
    },
  },
  {
    campaignId: "review-request",
    campaign: {
      enabled: true,
      title: "Review Request",
      objective:
        "Ask a satisfied customer to leave a public review (Google, Yelp, etc).",
      completionCondition:
        "The request was made directly to a specific customer, in person or by message.",
      prepLeadDays: 0,
      prepCondition: null,
      pocketKind: "any",
      pocketMinutesMin: 5,
      fallbackVariant: null,
      autoVerifiable: ["Message sent, if the request was made by text/email"],
      selfReported: [
        "Which customer was asked",
        "Whether a review was actually posted (Goldline cannot see review platforms)",
      ],
      missionCategory: "reputation",
      companionAbilityId: null,
      timingAssumptions: [
        assumption(
          "Requesting immediately after a delivery gets a higher response rate than a delayed request.",
          "Adam's own field notes, informal"
        ),
      ],
      opsTaskType: "review_request",
      legacyContract: null,
      legacyContractRef: null,
    },
  },
  {
    campaignId: "retention-win-back-outreach",
    campaign: {
      enabled: true,
      title: "Retention / Win-Back Outreach",
      objective:
        "Reach out to a dormant or dimming customer to bring them back before they churn fully.",
      completionCondition:
        "Outreach was sent or a call was made to a specific flagged customer.",
      prepLeadDays: 0,
      prepCondition:
        "A recovery candidate must already exist in the churn radar queue.",
      pocketKind: "any",
      pocketMinutesMin: 10,
      fallbackVariant: {
        title: "Single-message send",
        completionCondition: "One outreach message sent to one flagged customer.",
        pocketMinutesMin: 5,
      },
      autoVerifiable: [
        "The recovery intervention's status transition to 'recovered' (server/churnRadar)",
      ],
      selfReported: ["Which customer was contacted", "How the contact went"],
      missionCategory: "retention",
      companionAbilityId: null,
      timingAssumptions: [
        assumption(
          "Customers who have gone quiet 45-60 days respond better than those contacted immediately at 30 days or waiting past 90.",
          "Adam's own field notes, informal"
        ),
      ],
      opsTaskType: "stale_customer",
      legacyContract: null,
      legacyContractRef: null,
    },
  },
  {
    campaignId: "local-digital-footprint-post",
    campaign: {
      enabled: true,
      title: "Local Digital-Footprint Post",
      objective:
        "Post real, current work (a truck, a delivery, a neighborhood) to a local online presence to stay visible in the community.",
      completionCondition: "A post was published to a real account.",
      prepLeadDays: 1,
      prepCondition: "A real photo/video from actual work must exist to post.",
      pocketKind: "any",
      pocketMinutesMin: 10,
      fallbackVariant: {
        title: "Single-photo post",
        completionCondition: "One photo posted with a short caption.",
        pocketMinutesMin: 5,
      },
      autoVerifiable: [],
      selfReported: ["What was posted", "Where it was posted"],
      missionCategory: "digital_presence",
      companionAbilityId: null,
      timingAssumptions: [
        assumption(
          "Posting during commute hours (7-9am, 5-7pm) tends to see more local engagement than midday.",
          "General social-platform guidance, not laundry-specific — treat as low confidence"
        ),
      ],
      opsTaskType: "digital_footprint_post",
      legacyContract: null,
      legacyContractRef: null,
    },
  },
  {
    campaignId: "neighboring-business-partnership-outreach",
    campaign: {
      enabled: true,
      title: "Neighboring-Business Partnership Outreach",
      objective:
        "Propose a cross-referral or partnership arrangement with a non-competing nearby business (salon, gym, hotel, etc).",
      completionCondition:
        "An in-person pitch or proposal was delivered to the business owner/manager.",
      prepLeadDays: 2,
      prepCondition:
        "A candidate business and a concrete partnership proposal must be identified before visiting.",
      pocketKind: "between_stops",
      pocketMinutesMin: 20,
      fallbackVariant: {
        title: "Card-and-note drop",
        completionCondition:
          "A business card and a short written proposal is left when the owner/manager is unavailable.",
        pocketMinutesMin: 5,
      },
      autoVerifiable: ["GPS arrival at the target business address"],
      selfReported: [
        "Whether the owner/manager was present",
        "Whether they agreed to any arrangement",
      ],
      missionCategory: "alliance",
      companionAbilityId: null,
      timingAssumptions: [
        assumption(
          "Non-competing service businesses (salons, gyms) are most receptive during slower midweek hours, not weekend peak.",
          "Adam's own field notes, informal"
        ),
      ],
      opsTaskType: "partnership_outreach",
      legacyContract: null,
      legacyContractRef: null,
    },
  },
  {
    campaignId: "greystar-koreatown-colosseum",
    campaign: {
      enabled: true,
      title: "The Greystar Hunt",
      objective:
        "Pitch each of five real Greystar Koreatown luxury high-rise properties in person to land a recurring commercial laundry account.",
      completionCondition:
        "All five properties in the Greystar Koreatown lead hunt have a recorded visit outcome (pitched or couldn't reach).",
      prepLeadDays: 0,
      prepCondition: null,
      pocketKind: "between_stops",
      pocketMinutesMin: 30,
      fallbackVariant: null,
      autoVerifiable: ["GPS arrival within the target's arrival radius"],
      selfReported: ["Visit outcome: pitched or couldn't reach"],
      missionCategory: "account_acquisition",
      companionAbilityId: null,
      timingAssumptions: [],
      opsTaskType: "manual_operator_task",
      legacyContract: "lead_hunt",
      legacyContractRef: { leadHuntId: "greystar-koreatown-five" },
    },
  },
  {
    campaignId: "the-last-valet-recurring-account-pitch",
    campaign: {
      enabled: true,
      title: "The Last Valet — Recurring Account Pitch",
      objective:
        "Pitch a hospitality venue (hotel, event space, or short-term rental operator) on a recurring valet-adjacent laundry account — linens, uniforms, or guest laundry on a standing schedule.",
      completionCondition:
        "An in-person pitch, drafted and personalized to the specific venue, was delivered to a decision-maker.",
      prepLeadDays: 1,
      prepCondition:
        "A candidate venue and a drafted, personalized pitch must exist before visiting.",
      pocketKind: "between_stops",
      pocketMinutesMin: 30,
      fallbackVariant: {
        title: "Drop-and-follow",
        completionCondition:
          "A pitch packet is left with the venue's front desk/ops manager when the decision-maker is unavailable, and a follow-up is scheduled.",
        pocketMinutesMin: 10,
      },
      autoVerifiable: ["GPS arrival at the target venue address"],
      selfReported: [
        "Whether a decision-maker was actually present",
        "Pitch outcome (interested / not interested / follow-up needed)",
      ],
      missionCategory: "account_acquisition",
      companionAbilityId: "rook.outreach_drafting",
      timingAssumptions: [
        assumption(
          "Hospitality ops managers are more reachable on weekday mornings before check-in/check-out rushes.",
          "Adam's own field notes, informal"
        ),
      ],
      opsTaskType: "office_account_pitch",
      legacyContract: null,
      legacyContractRef: null,
    },
  },
];
