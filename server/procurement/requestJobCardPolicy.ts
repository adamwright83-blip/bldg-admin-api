import { canonicalizeServiceIntent, type CanonicalServiceCategory } from "./canonicalServiceTaxonomyPolicy";
import {
  evaluateRequestCompleteness,
  type CanonicalRequestFacts,
  type RequestCompletenessResult,
} from "./requestCompletenessPolicy";

export type RequestJobCard = {
  status: "job_card_ready_for_admin_review" | "job_card_needs_clarification" | "job_card_not_allowed";
  jobCardAllowed: boolean;
  category: CanonicalServiceCategory;
  serviceLabel: string;
  rawRequest: string | null;
  displaySummary: string | null;
  residentContext: {
    bldgUserId: string | null;
    residentName: string | null;
    buildingSlug: string | null;
    address: string | null;
    unit: string | null;
  };
  requestFacts: CanonicalRequestFacts;
  completeness: RequestCompletenessResult;
  source: {
    sourceType: "resident_chat" | "service_request" | "coordinated_request" | "resident_agent_plan" | "manual";
    sourceId: string | null;
    conversationId: string | null;
    sessionId: string | null;
  };
  classificationConfidence: number | null;
  reasonCodes: string[];
  createdAt: string;
  administrativeOnly: true;
  booked: false;
  providerAccepted: false;
  bookingVerified: false;
  dispatched: false;
  paymentAuthorized: false;
  paymentCaptured: false;
  completed: false;
  vendorContacted: false;
  residentNotified: false;
  llmCalled: false;
  stateMutated: false;
};

const FALSE_OUTCOMES = {
  booked: false, providerAccepted: false, bookingVerified: false, dispatched: false,
  paymentAuthorized: false, paymentCaptured: false, completed: false, vendorContacted: false,
  residentNotified: false, llmCalled: false, stateMutated: false,
} as const;

function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).trim();
  return result || null;
}

function confidence(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

/** Builds a deterministic administrative artifact; it performs no extraction or side effect. */
export function buildRequestJobCard(input: {
  serviceIntent: unknown;
  rawRequest: unknown;
  displaySummary?: unknown;
  residentContext?: {
    bldgUserId?: unknown; residentName?: unknown; buildingSlug?: unknown; address?: unknown; unit?: unknown;
  } | null;
  facts?: CanonicalRequestFacts | null;
  source: {
    sourceType: RequestJobCard["source"]["sourceType"];
    sourceId?: unknown; conversationId?: unknown; sessionId?: unknown;
  };
  classificationConfidence?: unknown;
  now?: Date;
}): RequestJobCard {
  const canonical = canonicalizeServiceIntent(input.serviceIntent);
  const rawRequest = text(input.rawRequest);
  const requestFacts: CanonicalRequestFacts = {
    ...(input.facts ?? {}),
    buildingSlug: text(input.facts?.buildingSlug) ?? text(input.residentContext?.buildingSlug),
    address: text(input.facts?.address) ?? text(input.residentContext?.address),
    unit: text(input.facts?.unit) ?? text(input.residentContext?.unit),
  };
  const completeness = evaluateRequestCompleteness({ category: canonical.category, facts: requestFacts });
  const invalidReasons: string[] = [];
  if (!rawRequest) invalidReasons.push("raw_request_missing");
  if (!canonical.recognized) invalidReasons.push(...canonical.reasons);
  const parsedConfidence = confidence(input.classificationConfidence);
  if (input.classificationConfidence != null && parsedConfidence === null) invalidReasons.push("classification_confidence_invalid");
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) invalidReasons.push("job_card_timestamp_invalid");

  const status: RequestJobCard["status"] = invalidReasons.length
    ? "job_card_not_allowed"
    : completeness.mayCreateJobCard
      ? "job_card_ready_for_admin_review"
      : "job_card_needs_clarification";
  return {
    status,
    jobCardAllowed: status !== "job_card_not_allowed",
    category: canonical.category,
    serviceLabel: canonical.label,
    rawRequest,
    displaySummary: text(input.displaySummary) ?? rawRequest,
    residentContext: {
      bldgUserId: text(input.residentContext?.bldgUserId),
      residentName: text(input.residentContext?.residentName),
      buildingSlug: text(input.residentContext?.buildingSlug),
      address: text(input.residentContext?.address),
      unit: text(input.residentContext?.unit),
    },
    requestFacts,
    completeness,
    source: {
      sourceType: input.source.sourceType,
      sourceId: text(input.source.sourceId),
      conversationId: text(input.source.conversationId),
      sessionId: text(input.source.sessionId),
    },
    classificationConfidence: parsedConfidence,
    reasonCodes: invalidReasons.length ? invalidReasons : completeness.missingRequiredFacts.map(key => `missing:${key}`),
    createdAt: Number.isFinite(now.getTime()) ? now.toISOString() : "",
    administrativeOnly: true,
    ...FALSE_OUTCOMES,
  };
}
