export interface PreparedSalesPrep {
  whoToApproach: {
    name: string;
    role?: string;
    why: string;
  };
  openingStatement: string;
  specificRequest: string;
  approvedOffer: {
    serviceName: string;
    pricingSummary: string;
    approvedTerms: string;
  };
  objectionResponses: Array<{
    objection: string;
    response: string;
  }>;
  draftedFollowUp: {
    channel: "sms" | "email";
    message: string;
    sent: false; // Never falsely claimed as sent (G4/G14)
    needsHumanClearance: boolean;
  };
  completionCondition: string;
  nextStep: string;
  missingFacts: string[];
  serviceIssuesBlocking?: string;
}

export interface SalesPrepInput {
  tenantId: string;
  playType: string;
  accountName: string;
  contactName?: string;
  contactRole?: string;
  source?: string;
  knownObjections?: string[];
  openServiceIssues?: string[];
  verifiedContext: {
    address?: string;
    units?: number;
    lastInteraction?: string;
    propertyManagerName?: string;
    currentStage?: string;
  };
}

/**
 * Generate prepared sales prep for a growth mission.
 * Ensures:
 * 1. Concrete completion conditions (not vague "visit building").
 * 2. Only approved pricing and terms.
 * 3. Open service issues block promotion/referral prep.
 * 4. Missing facts are explicitly listed (G12).
 * 5. Drafts are explicitly marked un-sent (G4).
 */
export function buildPreparedSalesPrep(input: SalesPrepInput): PreparedSalesPrep {
  const missingFacts: string[] = [];
  if (!input.contactName && !input.verifiedContext.propertyManagerName) {
    missingFacts.push("Property manager / primary contact name unknown");
  }
  if (!input.verifiedContext.units) {
    missingFacts.push("Unit count unverified");
  }
  if (!input.verifiedContext.lastInteraction) {
    missingFacts.push("Prior interaction history unrecorded");
  }

  // If there are open service issues, promotional prep is blocked
  if (input.openServiceIssues && input.openServiceIssues.length > 0) {
    return {
      whoToApproach: {
        name: input.contactName ?? input.verifiedContext.propertyManagerName ?? input.accountName,
        role: input.contactRole ?? "Customer / Resident",
        why: `Address open service issue: ${input.openServiceIssues.join(", ")}`,
      },
      openingStatement: `I'm checking in personally regarding your recent service experience to make sure we've made things right.`,
      specificRequest: `Confirm that the issue is fully resolved to their satisfaction before any new service or order.`,
      approvedOffer: {
        serviceName: "Customer Service Resolution",
        pricingSummary: "No promotional offers while issue is open",
        approvedTerms: "Standard resolution protocol",
      },
      objectionResponses: [
        {
          objection: "I'm still unhappy with my prior order.",
          response: "We take full responsibility and will resolve this immediately before discussing future orders.",
        },
      ],
      draftedFollowUp: {
        channel: "sms",
        message: `Hi ${input.contactName ?? "there"}, this is Adam from Laundry Butler. Following up on your recent service to ensure everything was resolved to your satisfaction.`,
        sent: false,
        needsHumanClearance: true,
      },
      completionCondition: `Service resolution confirmed in writing or spoken agreement.`,
      nextStep: `Update service issue status to resolved before any sales or referral outreach.`,
      missingFacts,
      serviceIssuesBlocking: `Open service issue: ${input.openServiceIssues.join("; ")}`,
    };
  }

  // Standard play-specific prep
  switch (input.playType) {
    case "property_expansion":
      return {
        whoToApproach: {
          name: input.contactName ?? input.verifiedContext.propertyManagerName ?? "On-site Property Manager",
          role: input.contactRole ?? "Property Manager",
          why: `Evaluate resident pickup/delivery service access at ${input.accountName}.`,
        },
        openingStatement: `We provide resident-amenity wash and fold service for luxury properties in the neighborhood with zero cost or labor to building staff.`,
        specificRequest: `Approve placement of resident digital flyers in the mailroom and schedule a 2-week resident pilot launch date.`,
        approvedOffer: {
          serviceName: "Next-day Wash & Fold Amenity",
          pricingSummary: "Standard approved tier: $2.50/lb ($35 minimum), free scheduled concierge pickup/delivery.",
          approvedTerms: "No lease required, no equipment installation, 100% digital resident onboarding.",
        },
        objectionResponses: [
          {
            objection: "We don't want bags cluttering the lobby.",
            response: "Pickups and drop-offs are scheduled directly at resident doors or in your designated package room during agreed morning windows.",
          },
          {
            objection: "We already have on-site washers.",
            response: "Residents use us when they want 3-4 hours of their weekend back; we complement in-unit machines rather than replace them.",
          },
        ],
        draftedFollowUp: {
          channel: "email",
          message: `Hi ${input.contactName ?? "Property Team"}, thank you for taking a few minutes with me today at ${input.accountName}. As discussed, attached is our Laundry Butler resident amenity overview for your review.`,
          sent: false,
          needsHumanClearance: true,
        },
        completionCondition: `Confirm a launch date and resident announcement approval with the property manager.`,
        nextStep: `Deliver launch flyers and coordinate resident welcome email announcement.`,
        missingFacts,
      };

    case "dormant_recovery":
      return {
        whoToApproach: {
          name: input.contactName ?? input.accountName,
          role: "Past Customer",
          why: `Re-engage customer who previously ordered but has not booked in over 30 days.`,
        },
        openingStatement: `We're doing our regular quality check for prior customers to see how your last order held up.`,
        specificRequest: `Book an upcoming scheduled route pickup window for next week.`,
        approvedOffer: {
          serviceName: "Scheduled Wash & Fold Route",
          pricingSummary: "Standard approved pricing: $2.50/lb.",
          approvedTerms: "Standard service guarantee.",
        },
        objectionResponses: [
          {
            objection: "I've been traveling or doing it myself.",
            response: "Totally understand! We run our route by your building every Tuesday and Thursday whenever you need a hand.",
          },
        ],
        draftedFollowUp: {
          channel: "sms",
          message: `Hi ${input.contactName ?? "there"}, this is Adam from Laundry Butler. We're running our route by your building this week—let us know if you'd like a pickup!`,
          sent: false,
          needsHumanClearance: true,
        },
        completionCondition: `Receive explicit confirmation of pickup booking or confirmation of inactivity reason.`,
        nextStep: `Log response into customer record or schedule route stop.`,
        missingFacts,
      };

    default:
      return {
        whoToApproach: {
          name: input.contactName ?? input.accountName,
          role: "Prospect / Contact",
          why: `Advance opportunity at ${input.accountName}.`,
        },
        openingStatement: `Checking in to see if you have any questions on setting up pickup service.`,
        specificRequest: `Confirm schedule and preferred pickup day.`,
        approvedOffer: {
          serviceName: "Wash & Fold Service",
          pricingSummary: "Standard approved rate card.",
          approvedTerms: "Standard terms.",
        },
        objectionResponses: [
          {
            objection: "Not right now.",
            response: "No problem at all—we'll keep your account ready whenever you need us.",
          },
        ],
        draftedFollowUp: {
          channel: "sms",
          message: `Hi ${input.contactName ?? "there"}, Adam here from Laundry Butler. Just wanted to see if you had any questions we can answer.`,
          sent: false,
          needsHumanClearance: true,
        },
        completionCondition: `Obtain agreed next step or confirmed booking.`,
        nextStep: `Update opportunity stage and schedule follow-up date.`,
        missingFacts,
      };
  }
}
