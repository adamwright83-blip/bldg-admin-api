import type {
  ChapterCard,
  ChapterOpportunity,
  DraftApproach,
  DraftView,
} from "@shared/firstTenMinutesChapter";
import type { FindingView } from "@shared/firstTenMinutesFindings";

/**
 * Creates an authentic, clearly labeled simulated business opportunity for User B
 * (users who have no existing customer correspondence).
 *
 * If Claire has identified what the business does, the imagined prospect inquiry
 * is tailored to that business type. If not, it uses a clearly labeled generic studio example.
 */
export function generateSimulatedOpportunity(
  businessName: string | null,
  findings?: readonly FindingView[]
): ChapterOpportunity {
  const serviceFinding = findings?.find(
    f => f.payload.kind === "service" && f.status !== "dismissed"
  );
  const serviceName =
    serviceFinding && "name" in serviceFinding.payload
      ? (serviceFinding.payload as { name: string }).name
      : null;

  const placeFinding = findings?.find(
    f => f.payload.kind === "place" && f.status !== "dismissed"
  );
  const placeCategory =
    placeFinding && "category" in placeFinding.payload
      ? (placeFinding.payload as { category: string }).category
      : null;

  const resolvedBusiness = businessName?.trim() || "Your Business";

  // Tailored inquiry based on identified business, or clearly labeled generic consultation
  let prospectName = "Julian Vance";
  let prospectEmail = "julian.vance.inquiry@example.com";
  let subject = `Inquiry: Upcoming booking for ${resolvedBusiness}`;
  let wants = `A consultation and booking for next week.`;
  let quote = `Hi! We've been looking into ${resolvedBusiness} and would love to arrange a booking for next Thursday. Do you have capacity, and could you share your current availability?`;
  let serviceQuote = serviceName
    ? `Standard booking availability for ${serviceName}.`
    : `Standard consulting and project slots are open for weekday scheduling.`;
  let replyMissing = "Confirmation of scheduling capacity and package rates.";

  if (placeCategory?.toLowerCase().includes("flower") || resolvedBusiness.toLowerCase().includes("flower")) {
    prospectName = "Elena Rostova";
    prospectEmail = "elena.rostova@example.com";
    subject = "Inquiry: Seasonal botanical arrangements for private opening";
    wants = "Custom seasonal arrangements for an evening event next week.";
    quote = "Good morning! We're planning an opening next Thursday evening and admire your seasonal work. Are you available for a centerpiece and entrance arrangement?";
    serviceQuote = "Studio arrangements with weekday delivery across the metro area.";
    replyMissing = "Delivery window and seasonal stem selection.";
  } else if (placeCategory?.toLowerCase().includes("consult") || resolvedBusiness.toLowerCase().includes("consult")) {
    prospectName = "Marcus Thorne";
    prospectEmail = "marcus.thorne@example.com";
    subject = `Inquiry: Q1 advisory collaboration with ${resolvedBusiness}`;
    wants = "A tailored strategic advisory consultation for our leadership team.";
    quote = `Hello! Our team is preparing our quarterly roadmap and would value advice from ${resolvedBusiness}. Are you open to a small engagement next month?`;
    serviceQuote = "Strategic advisory sessions and project reviews.";
    replyMissing = "Available consultation dates and onboarding scope.";
  }

  const dummySources = [
    {
      provider: "gmail" as const,
      ref: "simulated_msg_3days",
      at: "Three days later · 10:14 AM",
      who: prospectName,
      label: "Three Days Later (Simulated Inquiry)",
      excerpt: quote,
      url: null,
    },
  ];

  const requestCard: ChapterCard & { wants: string; subject: string } = {
    findingId: "simulated_finding_request",
    quote,
    at: "Three days later · 10:14 AM",
    sources: dummySources,
    wants,
    subject,
  };

  const serviceCard: ChapterCard & { name: string } = {
    findingId: "simulated_finding_service",
    quote: serviceQuote,
    at: "Current capabilities (NOW)",
    sources: dummySources,
    name: serviceName ?? `${resolvedBusiness} Services`,
  };

  const replyCard: (ChapterCard & { missing: string }) | null = {
    findingId: "simulated_finding_reply",
    quote: "Awaiting your first reply.",
    at: "Three days later",
    sources: dummySources,
    missing: replyMissing,
  };

  return {
    id: "simulated_opportunity_3_days_later",
    type: "unanswered",
    person: {
      name: prospectName,
      address: prospectEmail,
    },
    firstName: prospectName.split(" ")[0],
    request: requestCard,
    reply: replyCard,
    service: serviceCard,
    route: null,
    place: null,
    along: null,
  };
}

/**
 * Creates a simulated draft view for User B within The Impossible Machine.
 */
export function createSimulatedDraft(
  opportunity: ChapterOpportunity,
  approach: DraftApproach = "still_wanted"
): DraftView {
  const firstName = opportunity.firstName ?? "there";
  const bodyStillWanted = `Hi ${firstName},\n\nThank you for reaching out! We do have capacity for next week and would be glad to help. Let me know if a brief conversation tomorrow afternoon works for you.\n\nWarm regards,\n`;
  const bodyOfferStart = `Hi ${firstName},\n\nThanks for thinking of us! We can certainly accommodate your project timeline. Here are our next open start dates and onboarding steps.\n\nBest,\n`;
  const bodyShort = `Hi ${firstName},\n\nThanks for getting in touch. We'd be glad to assist with this. Let me know when you're free for a quick call.\n\nSincerely,\n`;

  const body =
    approach === "still_wanted"
      ? bodyStillWanted
      : approach === "offer_start"
        ? bodyOfferStart
        : bodyShort;

  return {
    approach,
    to: opportunity.person,
    subject: `Re: ${opportunity.request.subject ?? "Your inquiry"}`,
    body,
    edited: false,
    status: "prepared",
    handedOffAt: null,
    reportedSentAt: null,
    verifiedSentAt: null,
    handedOffVia: null,
    sentByJoystick: false,
    approaches: [
      { approach: "still_wanted", body: bodyStillWanted },
      { approach: "offer_start", body: bodyOfferStart },
      { approach: "short", body: bodyShort },
    ],
  };
}
