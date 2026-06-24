import { lintOutreachTemplate } from "./legalTemplatePolicy";
import type { RequestJobCard } from "./requestJobCardPolicy";
import type { CastingLead } from "./vendorCastingSprintPolicy";

export const ATTEMPT_CHANNELS = [
  "call",
  "voicemail",
  "website_form",
  "email",
  "sms_if_allowed",
  "second_call_if_urgent",
] as const;
export type AttemptChannel = (typeof ATTEMPT_CHANNELS)[number];

export const DRAFT_ATTEMPT_STATUSES = [
  "draft_ready",
  "copied",
  "manually_sent",
  "response_pending",
  "blocked",
] as const;
export type DraftAttemptStatus = (typeof DRAFT_ATTEMPT_STATUSES)[number];

export const VENDOR_SOURCE_TYPES = ["manual_operator_list", "public_business_directory", "permitted_public_fetch"] as const;
export type VendorSourceType = (typeof VENDOR_SOURCE_TYPES)[number];

export type RealVendorFacts = {
  businessName: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  sourceType: VendorSourceType;
  sourceReference: string;
  serviceArea: string;
  qualificationNotes: string;
  googleRating?: number | null;
  googleReviewCount?: number | null;
  yelpRating?: number | null;
  yelpReviewCount?: number | null;
  observedAt?: string | null;
  negativeFlags?: string[] | null;
  sourceConfidenceNotes?: string | null;
};

export type RealVendorFactsValidation = { valid: boolean; reasons: string[] };

const DEMO_LABEL_PATTERN = /\(demo\)/i;

/**
 * Refuses real-vendor-fact entry when the admin (accidentally or otherwise)
 * carries the demo lead's own label/name into the real-facts form; a demo
 * lead is never real evidence regardless of what an admin types around it.
 */
export function detectDemoFactsReusedAsReal(facts: Pick<RealVendorFacts, "businessName">, lead: CastingLead): string[] {
  const reasons: string[] = [];
  if (DEMO_LABEL_PATTERN.test(facts.businessName ?? "")) reasons.push("demo_label_detected_in_business_name");
  if (facts.businessName && lead.isDemo && facts.businessName.trim().toLowerCase() === lead.businessName.trim().toLowerCase()) {
    reasons.push("demo_lead_business_name_reused_as_real");
  }
  return reasons;
}

export function validateRealVendorFacts(facts: Partial<RealVendorFacts>, lead: CastingLead): RealVendorFactsValidation {
  const reasons: string[] = [];
  if (!facts.businessName?.trim()) reasons.push("business_name_required");
  if (!facts.phone?.trim() && !facts.email?.trim() && !facts.website?.trim()) {
    reasons.push("at_least_one_contact_method_required");
  }
  if (!facts.sourceType || !VENDOR_SOURCE_TYPES.includes(facts.sourceType)) reasons.push("source_type_required");
  if (!facts.sourceReference?.trim()) reasons.push("source_reference_required");
  if (!facts.serviceArea?.trim()) reasons.push("service_area_required");
  if (!facts.qualificationNotes || facts.qualificationNotes.trim().length < 10) reasons.push("qualification_notes_required");
  if (facts.businessName) reasons.push(...detectDemoFactsReusedAsReal({ businessName: facts.businessName }, lead));
  return { valid: reasons.length === 0, reasons: Array.from(new Set(reasons)) };
}

export const ALLOWED_TRUTH_LINES = [
  "The resident approved HELD to check whether you can do this.",
  "Nothing is confirmed yet.",
  "We are confirming availability first.",
  "Please reply with availability, price, and any requirements.",
] as const;

export const FOUNDER_ESCALATION_LINE =
  "Speak to HELD founder directly: Adam Wright — 323.807.4661 / Adam@bldg.chat.";

const FORBIDDEN_DRAFT_CLAIM_PATTERN =
  /\b(booked|confirmed|accepted|scheduled|paid|payment ready|dispatch(?:ed)?|completed|provider accepted|resident booked)\b/i;

export type OutreachDraft = {
  templateKey: "vendor_availability_request_v0";
  subject: string;
  body: string;
  truthLinesIncluded: string[];
  founderEscalationIncluded: true;
  forbiddenClaimsDetected: string[];
  blockingLintRules: string[];
  safeToCopy: boolean;
  sentByHeld: false;
};

function describeDog(facts: RequestJobCard["requestFacts"]): string | null {
  const dog = facts.dog;
  if (!dog) return null;
  const parts = [dog.name, dog.breed, dog.size, dog.weight].filter(Boolean);
  const headline = parts.length ? parts.join(", ") : null;
  const extras = [
    dog.temperament ? `Temperament: ${dog.temperament}` : null,
    dog.handlingNotes ? `Handling notes: ${dog.handlingNotes}` : null,
  ].filter((value): value is string => !!value);
  return [headline, ...extras].filter(Boolean).join(". ") || null;
}

/**
 * Renders a fixed-language, no-send outreach draft. Content is hardcoded to
 * the approved vendor_availability_request_v0 truth lines and the founder
 * escalation line; it is linted against the same banned-claim list the real
 * template store enforces before it is ever considered safe to copy.
 */
export function buildCastingSprintOutreachDraft(input: {
  jobCard: RequestJobCard;
  lead: CastingLead;
  vendorFacts: RealVendorFacts;
}): OutreachDraft {
  const facts = input.jobCard.requestFacts;
  const dogLine = describeDog(facts);
  const lines = [
    `Hi ${input.vendorFacts.businessName},`,
    "",
    ALLOWED_TRUTH_LINES[0],
    ALLOWED_TRUTH_LINES[1],
    ALLOWED_TRUTH_LINES[2],
    "",
    `Service: ${input.jobCard.serviceLabel}`,
    dogLine ? `Dog: ${dogLine}` : null,
    facts.requestedDate || facts.requestedWindow
      ? `Requested: ${facts.requestedDate ?? "date not specified"}, ${facts.requestedWindow ?? "window not specified"}`
      : null,
    facts.budget ? `Budget: ${facts.budget}` : null,
    "",
    ALLOWED_TRUTH_LINES[3],
    "",
    FOUNDER_ESCALATION_LINE,
  ].filter((line): line is string => line !== null);
  const body = lines.join("\n");
  const subject = `Availability check: ${input.jobCard.serviceLabel} — ${facts.requestedDate ?? "date TBD"}`;

  const lint = lintOutreachTemplate(
    { templatePurpose: "vendor_availability_request", subjectTemplate: subject, bodyTemplate: body },
    [],
  );
  const bodyExcludingAllowedTruthLines = ALLOWED_TRUTH_LINES.reduce(
    (text, line) => text.split(line).join(""),
    body,
  );
  const forbiddenClaimsDetected = FORBIDDEN_DRAFT_CLAIM_PATTERN.test(bodyExcludingAllowedTruthLines)
    ? ["forbidden_truth_claim_detected"]
    : [];

  return {
    templateKey: "vendor_availability_request_v0",
    subject,
    body,
    truthLinesIncluded: [...ALLOWED_TRUTH_LINES],
    founderEscalationIncluded: true,
    forbiddenClaimsDetected,
    blockingLintRules: lint.blockingLintRules,
    safeToCopy: forbiddenClaimsDetected.length === 0 && lint.blockingLintRules.length === 0,
    sentByHeld: false,
  };
}

export type DraftAttemptState = {
  draftGenerated: boolean;
  channel: AttemptChannel | null;
  copied: boolean;
  manuallySent: boolean;
};

export function computeDraftAttemptStatus(state: DraftAttemptState): DraftAttemptStatus {
  if (!state.draftGenerated) return "blocked";
  if (state.manuallySent) return "response_pending";
  if (state.copied) return "copied";
  return "draft_ready";
}

export type ManualAttemptDecision = { allowed: boolean; reasons: string[] };

export function canLogManualAttempt(state: Pick<DraftAttemptState, "draftGenerated" | "channel">): ManualAttemptDecision {
  const reasons: string[] = [];
  if (!state.draftGenerated) reasons.push("draft_not_generated_yet");
  if (!state.channel) reasons.push("contact_channel_required");
  return { allowed: reasons.length === 0, reasons };
}

/**
 * Shape matches firstRealProposalBootstrapRouter's candidateInput exactly
 * (tenantId/sourceType/sourceReference/category/businessName/contact/
 * serviceArea/qualificationNotes) so this payload can be passed straight
 * into the existing createCandidate mutation without remapping.
 */
export type CandidateCreationPayload = {
  tenantId: string;
  buildingSlug: string | null;
  sourceType: VendorSourceType;
  sourceReference: string;
  category: string;
  businessName: string;
  phone?: string;
  email?: string;
  website?: string;
  serviceArea: string;
  qualificationNotes: string;
};

export type CandidateCreationDecision =
  | { allowed: true; reasons: []; payload: CandidateCreationPayload }
  | { allowed: false; reasons: string[]; payload: null };

/**
 * Builds the createCandidate payload from real, admin-entered vendor facts.
 * Re-runs the same demo-evidence and required-field validation generateOutreachDraft
 * uses, so this can never be called with demo lead data or missing facts even
 * if the UI's draft step is bypassed. Performs no persistence itself.
 */
export function buildRealCandidateCreationPayload(input: {
  jobCard: RequestJobCard;
  lead: CastingLead;
  vendorFacts: RealVendorFacts;
  tenantId?: string;
}): CandidateCreationDecision {
  const validation = validateRealVendorFacts(input.vendorFacts, input.lead);
  if (!validation.valid) {
    return { allowed: false, reasons: validation.reasons, payload: null };
  }
  return {
    allowed: true,
    reasons: [],
    payload: {
      tenantId: input.tenantId ?? "default",
      buildingSlug: input.jobCard.residentContext.buildingSlug,
      sourceType: input.vendorFacts.sourceType,
      sourceReference: input.vendorFacts.sourceReference,
      category: input.jobCard.category,
      businessName: input.vendorFacts.businessName,
      phone: input.vendorFacts.phone?.trim() || undefined,
      email: input.vendorFacts.email?.trim() || undefined,
      website: input.vendorFacts.website?.trim() || undefined,
      serviceArea: input.vendorFacts.serviceArea,
      qualificationNotes: input.vendorFacts.qualificationNotes,
    },
  };
}
