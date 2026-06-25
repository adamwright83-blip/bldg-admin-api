// Slice 78a. Deterministic, no-send draft copy for inviting a discovered
// Google Places candidate onto HELD's preferred mobile vendor list. This
// module performs no I/O and never sends anything -- it only renders text
// and lints it against the same forbidden-claim pattern used by the
// existing casting-sprint outreach drafts.

import { FOUNDER_ESCALATION_LINE } from "./castingSprintExecutionPolicy";

const FORBIDDEN_CLAIM_PATTERN =
  /\b(booked|confirmed|accepted|scheduled|paid|payment ready|dispatch(?:ed)?|completed|provider accepted|resident booked|guarantee(?:d)?\s+volume|currently booking)\b/i;

export type CandidateDraftOutreachInput = {
  businessName: string;
  geographyHint: string;
};

export type CandidateDraftOutreach = {
  subject: string;
  body: string;
  forbiddenClaimsDetected: string[];
  safeToCopy: boolean;
};

export function buildCandidateDraftOutreach(input: CandidateDraftOutreachInput): CandidateDraftOutreach {
  const body = [
    "Hi — I'm Adam with HELD, a residential concierge platform supporting luxury apartment residents in Los Angeles.",
    `We're building a preferred mobile dog grooming vendor list for residents near ${input.geographyHint}.`,
    "Do you currently offer mobile grooming or building-service appointments, and are you accepting new clients?",
    "If yes, what is the best way for HELD to check your availability and request bookings?",
    "",
    FOUNDER_ESCALATION_LINE,
  ].join("\n");
  const subject = `HELD preferred vendor list — mobile dog grooming near ${input.geographyHint}`;

  const forbiddenClaimsDetected = FORBIDDEN_CLAIM_PATTERN.test(body) ? ["forbidden_truth_claim_detected"] : [];

  return {
    subject,
    body,
    forbiddenClaimsDetected,
    safeToCopy: forbiddenClaimsDetected.length === 0,
  };
}
