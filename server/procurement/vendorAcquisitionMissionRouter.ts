import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  buildAgentMailLabels, evaluateAgentMailLiveSendGate, sendVendorEmailViaAgentMail,
} from "./agentMailVendorEmailProvider";
import {
  CALENDAR_METHODS, MOBILE_SERVICE_CONFIRMED_VALUES, PREFERRED_CONTACT_CHANNELS,
  VendorCandidateAvailabilityIntakeStore,
} from "./vendorCandidateAvailabilityIntakeStore";
import { buildCandidateDraftOutreach } from "./vendorCandidateDraftOutreachPolicy";
import { VendorContactAttemptStore } from "./vendorContactAttemptStore";
import { runGooglePlacesDiscovery, type NormalizedPlaceCandidate } from "./googlePlacesDiscoveryConnector";
import { createProcurementPool } from "./migrations";
import {
  extractZipFromAddress, getKnownTargetZipCentroid, verifyCandidateServiceArea,
  type ContactRoute, type OutreachReadiness, type ServiceAreaStatus, type ServiceAreaVerification,
} from "./vendorCandidateServiceAreaVerifier";
import {
  interpretServiceAreaWithClaude, type StructuredServiceAreaInterpretation,
} from "./vendorCandidateServiceAreaStructuredInterpreter";
import { MISSION_OUTREACH_MODES } from "./vendorAcquisitionMissionPolicy";
import { VendorAcquisitionMissionStore } from "./vendorAcquisitionMissionStore";
import {
  type MatchQueryPlannerSource, type MatchServiceMode, VendorMissionCandidateMatchStore,
} from "./vendorMissionCandidateMatchStore";
import { planMissionQuery, type MissionQueryPlan } from "./vendorMissionQueryPlanner";
import { parseMissionWithClaude } from "./vendorMissionStructuredParser";
import { VendorSourcingStore } from "./vendorSourcingStore";

export type QueryPlannerSource = "anthropic_structured" | "deterministic_fallback";

/**
 * Slice 75a. Wires the existing, already-deployed (Slice 74b)
 * VendorAcquisitionMissionStore to the admin UI for the first time --
 * nothing in this router scouts, scores, contacts, or sends anything.
 * Creating/activating a mission here only persists an operator-defined
 * sourcing target; auto_send remains permanently blocked at the policy
 * layer (missionAllowsAutoSend() always false), and no discovery adapter
 * (Google/Yelp/etc) exists anywhere in this codebase to actually act on
 * a mission yet.
 */

const qualityGatesInput = z.object({
  minGoogleRating: z.number().min(0).max(5).nullable().optional(),
  minYelpRating: z.number().min(0).max(5).nullable().optional(),
  minReviewVolume: z.number().int().nonnegative().nullable().optional(),
  requireResidentialClients: z.boolean().optional(),
  requireVerifiedContact: z.boolean().optional(),
  excludeComplaintPatterns: z.boolean().optional(),
  // Slice 77a: the operator's raw Mission Composer text, stored in this
  // existing JSON blob (no migration) and read by the query planner.
  missionText: z.string().max(2000).nullable().optional(),
});

let lazyStore: VendorAcquisitionMissionStore | null = null;
function resolveStore(injected?: VendorAcquisitionMissionStore): VendorAcquisitionMissionStore {
  if (injected) return injected;
  if (!lazyStore) {
    lazyStore = new VendorAcquisitionMissionStore(createProcurementPool());
  }
  return lazyStore;
}

let lazySourcingStore: VendorSourcingStore | null = null;
function resolveSourcingStore(injected?: VendorSourcingStore): VendorSourcingStore {
  if (injected) return injected;
  if (!lazySourcingStore) {
    lazySourcingStore = new VendorSourcingStore(createProcurementPool());
  }
  return lazySourcingStore;
}

let lazyContactAttemptStore: VendorContactAttemptStore | null = null;
function resolveContactAttemptStore(injected?: VendorContactAttemptStore): VendorContactAttemptStore {
  if (injected) return injected;
  if (!lazyContactAttemptStore) {
    lazyContactAttemptStore = new VendorContactAttemptStore(createProcurementPool());
  }
  return lazyContactAttemptStore;
}

let lazyAvailabilityIntakeStore: VendorCandidateAvailabilityIntakeStore | null = null;
function resolveAvailabilityIntakeStore(injected?: VendorCandidateAvailabilityIntakeStore): VendorCandidateAvailabilityIntakeStore {
  if (injected) return injected;
  if (!lazyAvailabilityIntakeStore) {
    lazyAvailabilityIntakeStore = new VendorCandidateAvailabilityIntakeStore(createProcurementPool());
  }
  return lazyAvailabilityIntakeStore;
}

let lazyMatchStore: VendorMissionCandidateMatchStore | null = null;
function resolveMatchStore(injected?: VendorMissionCandidateMatchStore): VendorMissionCandidateMatchStore {
  if (injected) return injected;
  if (!lazyMatchStore) {
    lazyMatchStore = new VendorMissionCandidateMatchStore(createProcurementPool());
  }
  return lazyMatchStore;
}

/**
 * Slice 79a. Ranks candidates discovered within a single runDiscovery
 * call for one mission. Tier 1: this candidate's own service mode
 * (Slice 77/77b evidence) matches the mission's current plan intent.
 * Tier 2: the candidate is inherently mobile/building-service coded,
 * even if it doesn't exactly match this mission's mode. Then rating,
 * review count, phone presence, website presence. Ties break on
 * placeId for determinism.
 */
function rankScoreForCandidate(
  candidate: NormalizedPlaceCandidate, missionServiceMode: MatchServiceMode, candidateServiceMode: MatchServiceMode,
): number {
  let score = 0;
  if (candidateServiceMode === missionServiceMode) score += 1000;
  if (candidateServiceMode === "mobile_required" || candidateServiceMode === "building_service_required") score += 100;
  score += (candidate.rating ?? 0) * 10;
  score += Math.log10((candidate.reviewCount ?? 0) + 1) * 5;
  if (candidate.phone) score += 2;
  if (candidate.website) score += 1;
  return score;
}

/**
 * Slice 81a. Mirrors the client's LA_BUILDINGS list (MissionControlPage.tsx)
 * -- the only two HELD-serviced buildings with a known ZIP in this
 * codebase. Deliberately does not include "Los Feliz Towers": no ZIP
 * for it exists anywhere in the codebase, and inventing one would be
 * exactly the kind of fabricated truth this slice exists to prevent.
 */
const KNOWN_HELD_BUILDINGS: ReadonlyArray<{ name: string; zip: string }> = [
  { name: "OPUS LA", zip: "90027" },
  { name: "Century Park East", zip: "90067" },
];

export function resolveTargetGeography(geographyLabel: string): { targetZip: string | null; targetBuildingName: string | null } {
  const targetZip = extractZipFromAddress(geographyLabel);
  const targetBuildingName = targetZip
    ? KNOWN_HELD_BUILDINGS.find(building => building.zip === targetZip)?.name ?? null
    : null;
  return { targetZip, targetBuildingName };
}


export type ServiceAreaInterpreterSource = "anthropic_structured" | "deterministic_fallback";

/**
 * Slice 81b. The field the rest of this module (ranking, shortlist
 * gating, the send-readiness UI) actually reads. Mirrors the 77a->77b
 * pattern: serviceAreaStatus/contactRoute/outreachReadiness/reasons
 * come from the Claude interpreter when it ran and validated, or from
 * the 81a deterministic verifier otherwise. emailAddressesFound is
 * ALWAYS sourced from the deterministic verifier's own regex
 * extraction over the real fetched HTML, never from the model --
 * the structured interpreter's output schema has no email-list field
 * at all, so there is no path by which a model-invented email could
 * ever reach the supervised-send UI.
 */
export type EffectiveServiceAreaEvidence = {
  serviceAreaStatus: ServiceAreaStatus;
  serviceAreaReasons: string[];
  contactRoute: ContactRoute;
  outreachReadiness: OutreachReadiness;
  emailAddressesFound: string[];
  requiresHumanReview: boolean;
  serviceAreaInterpreterSource: ServiceAreaInterpreterSource;
  serviceAreaFallbackReason: string | null;
};

function resolveEffectiveServiceAreaEvidence(
  deterministic: ServiceAreaVerification,
  interpretation: StructuredServiceAreaInterpretation | null,
  interpreterSource: ServiceAreaInterpreterSource,
  fallbackReason: string | null,
): EffectiveServiceAreaEvidence {
  if (interpreterSource === "anthropic_structured" && interpretation) {
    return {
      serviceAreaStatus: interpretation.serviceAreaStatus,
      serviceAreaReasons: interpretation.serviceAreaReasons,
      contactRoute: interpretation.contactRoute,
      outreachReadiness: interpretation.outreachReadiness,
      emailAddressesFound: deterministic.emailAddressesFound,
      requiresHumanReview: interpretation.requiresHumanReview,
      serviceAreaInterpreterSource: "anthropic_structured",
      serviceAreaFallbackReason: null,
    };
  }
  return {
    serviceAreaStatus: deterministic.serviceAreaStatus,
    serviceAreaReasons: deterministic.serviceAreaReasons,
    contactRoute: deterministic.contactRoute,
    outreachReadiness: deterministic.outreachReadiness,
    emailAddressesFound: deterministic.emailAddressesFound,
    requiresHumanReview: false,
    serviceAreaInterpreterSource: "deterministic_fallback",
    serviceAreaFallbackReason: fallbackReason,
  };
}

/**
 * Slice 81b. The Claude structured interpreter is the primary reader
 * of the website evidence the 81a deterministic verifier already
 * safely fetched; the deterministic result remains the fallback when
 * Claude is unavailable, fails, times out, returns invalid output, or
 * there simply is not enough website text to interpret. Never throws,
 * never performs a second fetch -- it only ever reads the plain-text
 * snippet the deterministic verifier already captured.
 */
async function resolveServiceAreaEvidence(
  input: {
    missionText: string | null; targetZip: string | null; targetBuildingName: string | null;
    candidateName: string; candidateAddress: string | null; candidateWebsite: string | null; candidatePhone: string | null;
    deterministic: ServiceAreaVerification;
  },
  interpretFn: typeof interpretServiceAreaWithClaude,
  tenantId: string,
): Promise<EffectiveServiceAreaEvidence> {
  try {
    const interpreted = await interpretFn({
      missionText: input.missionText,
      targetZip: input.targetZip,
      targetBuildingName: input.targetBuildingName,
      targetNeighborhood: null,
      candidateName: input.candidateName,
      candidateAddress: input.candidateAddress,
      candidateAddressZip: input.deterministic.candidateAddressZip,
      candidateWebsite: input.candidateWebsite,
      candidatePhone: input.candidatePhone,
      deterministicResult: input.deterministic,
      websiteText: input.deterministic.websiteTextSnippet,
    }, { tenantId });
    if (interpreted.status === "ok") {
      return resolveEffectiveServiceAreaEvidence(input.deterministic, interpreted.interpretation, "anthropic_structured", null);
    }
    return resolveEffectiveServiceAreaEvidence(input.deterministic, null, "deterministic_fallback", interpreted.status);
  } catch {
    // Never let an interpreter failure block discovery from running at all.
    return resolveEffectiveServiceAreaEvidence(input.deterministic, null, "deterministic_fallback", "interpreter_exception");
  }
}

/**
 * Slice 81c. Whether the MISSION QUERY had mobile intent
 * (match.serviceMode, set once per discovery run from the query
 * planner) is NOT evidence that any individual VENDOR actually offers
 * mobile/building-service. This checks the vendor's OWN evidence --
 * its business name, and the same already-fetched website text 81a
 * captured -- for an explicit mobile/in-home/building-service signal.
 * Deliberately deterministic/keyword-based (no new fetch, no new LLM
 * call) -- mirrors the same "real but narrow v0" tradeoff as 81a's own
 * service-area-text matching.
 */
const VENDOR_MOBILE_EVIDENCE_PATTERN =
  /\bmobile\b|\bwe come to you\b|\bcomes? to your (?:home|building|door|unit)\b|\bin-home\b|\bin home\b|\bon-site\b|\bon site\b|\bhouse calls?\b|\bbuilding[- ]service\b/i;

function hasVendorMobileEvidence(businessName: string, websiteTextSnippet: string): boolean {
  return VENDOR_MOBILE_EVIDENCE_PATTERN.test(businessName) || VENDOR_MOBILE_EVIDENCE_PATTERN.test(websiteTextSnippet);
}

export const FULFILLMENT_MODES = [
  "verified_mobile_building_service",
  "likely_mobile_building_service",
  "mobile_needs_review",
  "drive_to_storefront_fallback",
  "likely_out_of_area",
  "out_of_area",
] as const;
export type FulfillmentMode = (typeof FULFILLMENT_MODES)[number];

export type FulfillmentTier = "green" | "yellow" | "blue" | "red";

export type FulfillmentClassification = {
  fulfillmentMode: FulfillmentMode;
  fulfillmentTier: FulfillmentTier;
  fulfillmentLabel: string;
  fulfillmentReason: string;
  vendorHasMobileEvidence: boolean;
};

const FULFILLMENT_TIER_ORDER: Record<FulfillmentTier, number> = { green: 0, blue: 1, yellow: 2, red: 3 };
const SERVICE_AREA_SUB_TIER: Record<ServiceAreaStatus, number> = {
  verified_serves_target: 0, likely_serves_target: 1, unverified: 2, likely_out_of_area: 3, out_of_area: 4,
};
const FULFILLMENT_LABEL: Record<FulfillmentMode, string> = {
  verified_mobile_building_service: "Mobile · Comes to building",
  likely_mobile_building_service: "Mobile · Likely serves building",
  mobile_needs_review: "Mobile · Needs review",
  drive_to_storefront_fallback: "Drive-to fallback",
  likely_out_of_area: "Out of area",
  out_of_area: "Out of area",
};
const FULFILLMENT_TIER_FOR_MODE: Record<FulfillmentMode, FulfillmentTier> = {
  verified_mobile_building_service: "green",
  likely_mobile_building_service: "green",
  mobile_needs_review: "yellow",
  drive_to_storefront_fallback: "blue",
  likely_out_of_area: "red",
  out_of_area: "red",
};

/**
 * Combines the service-area evidence (81a/81b) with the vendor's OWN
 * mobile-service evidence (never the mission query's intent) into one
 * classification the shortlist ranks and the UI renders directly. A
 * vendor that serves the target area but shows no mobile evidence is
 * classified as a storefront/drive-to fallback, not silently dropped
 * and not silently relabeled mobile.
 */
function classifyFulfillment(
  evidence: EffectiveServiceAreaEvidence, vendorHasMobileEvidence: boolean,
): FulfillmentClassification {
  let fulfillmentMode: FulfillmentMode;
  let fulfillmentReason: string;

  if (evidence.serviceAreaStatus === "out_of_area") {
    fulfillmentMode = "out_of_area";
    fulfillmentReason = evidence.serviceAreaReasons[0] ?? "Vendor does not appear to serve the target area";
  } else if (evidence.serviceAreaStatus === "likely_out_of_area") {
    fulfillmentMode = "likely_out_of_area";
    fulfillmentReason = evidence.serviceAreaReasons[0] ?? "Vendor is likely outside the target area";
  } else if (evidence.serviceAreaStatus === "verified_serves_target" && vendorHasMobileEvidence) {
    fulfillmentMode = "verified_mobile_building_service";
    fulfillmentReason = "Verified to serve the target area and shows mobile/building-service evidence";
  } else if (evidence.serviceAreaStatus === "likely_serves_target" && vendorHasMobileEvidence) {
    fulfillmentMode = "likely_mobile_building_service";
    fulfillmentReason = "Likely serves the target area and shows mobile/building-service evidence";
  } else if (evidence.serviceAreaStatus === "unverified" && vendorHasMobileEvidence) {
    fulfillmentMode = "mobile_needs_review";
    fulfillmentReason = "Shows mobile/building-service evidence, but service-area fit is not yet confirmed";
  } else if (evidence.serviceAreaStatus === "verified_serves_target" || evidence.serviceAreaStatus === "likely_serves_target" || evidence.serviceAreaStatus === "unverified") {
    fulfillmentMode = "drive_to_storefront_fallback";
    fulfillmentReason = "No mobile/building-service evidence found -- treated as a drive-to storefront option";
  } else {
    fulfillmentMode = "mobile_needs_review";
    fulfillmentReason = "Service-area fit is unclear";
  }

  return {
    fulfillmentMode,
    fulfillmentTier: FULFILLMENT_TIER_FOR_MODE[fulfillmentMode],
    fulfillmentLabel: FULFILLMENT_LABEL[fulfillmentMode],
    fulfillmentReason,
    vendorHasMobileEvidence,
  };
}

const STOREFRONT_FALLBACK_MAX_MILES = 15;
const MOBILE_NEEDS_REVIEW_MAX_MILES = 25;

export type PrimaryShortlistEligibility = { eligible: boolean; exclusionReason: string | null };

/**
 * Slice 81e. The real safety net behind Google's location BIAS (which
 * is only a hint, not a hard restriction) -- a national franchise page
 * thousands of miles away must never reach the primary shortlist just
 * because the mission's target count wasn't otherwise filled. Replaces
 * 81c's red-tier "fill remaining slots when not enough alternatives
 * exist" fallback, which is exactly what let out-of-state candidates
 * into the primary shortlist: red/out-of-area is now NEVER primary,
 * with no exception, regardless of how few other candidates exist.
 */
function evaluatePrimaryShortlistEligibility(
  fulfillment: FulfillmentClassification, evidence: EffectiveServiceAreaEvidence, distanceMiles: number | null,
): PrimaryShortlistEligibility {
  if (fulfillment.fulfillmentTier === "red") {
    return { eligible: false, exclusionReason: `Out of area: ${evidence.serviceAreaReasons[0] ?? "does not appear to serve the target area"}` };
  }
  if (fulfillment.fulfillmentTier === "green") {
    // Already required verified/likely service-area status PLUS the
    // vendor's own mobile evidence to reach green -- trust that
    // explicit evidence over raw distance.
    return { eligible: true, exclusionReason: null };
  }
  const hasExplicitAreaSupport = evidence.serviceAreaStatus === "verified_serves_target";
  if (fulfillment.fulfillmentTier === "blue") {
    if (distanceMiles === null) {
      if (hasExplicitAreaSupport || evidence.serviceAreaStatus === "likely_serves_target") return { eligible: true, exclusionReason: null };
      return { eligible: false, exclusionReason: "Distance to target is unknown and no service-area evidence supports this candidate" };
    }
    if (distanceMiles <= STOREFRONT_FALLBACK_MAX_MILES) return { eligible: true, exclusionReason: null };
    return { eligible: false, exclusionReason: `${distanceMiles} mi from target exceeds the ${STOREFRONT_FALLBACK_MAX_MILES} mi drive-to fallback limit` };
  }
  // yellow (mobile_needs_review)
  if (hasExplicitAreaSupport) return { eligible: true, exclusionReason: null };
  if (distanceMiles === null) return { eligible: false, exclusionReason: "Distance to target is unknown and no service-area evidence supports this candidate" };
  if (distanceMiles <= MOBILE_NEEDS_REVIEW_MAX_MILES) return { eligible: true, exclusionReason: null };
  return { eligible: false, exclusionReason: `${distanceMiles} mi from target exceeds the ${MOBILE_NEEDS_REVIEW_MAX_MILES} mi needs-review limit without explicit service-area support` };
}

export type QueryPlannerFallbackReason = "needs_provider_config" | "invalid_output" | "provider_error" | "parser_exception" | null;

export type DiscoveredCandidateSummary = NormalizedPlaceCandidate & {
  persisted: boolean; alreadyDiscovered: boolean; matchedQuery: string;
};
export type RunDiscoveryResult =
  | { status: "mission_not_found" }
  | { status: "needs_provider_config"; missingEnvVar: string }
  | { status: "provider_error"; reason: string }
  | {
      status: "ok"; foundCount: number; persistedCount: number; alreadyDiscoveredCount: number;
      shortlistedCount: number; overflowCount: number;
      candidates: DiscoveredCandidateSummary[]; queryPlannerSource: QueryPlannerSource;
      queryPlannerFallbackReason: QueryPlannerFallbackReason;
    };

/**
 * Slice 77b. Anthropic's structured parser (server/procurement/
 * vendorMissionStructuredParser.ts) is the primary mission-text query-
 * planning path; the deterministic keyword planner from Slice 77a
 * (vendorMissionQueryPlanner.ts) is the fallback when Claude is
 * unavailable, fails, times out, or returns output that fails schema
 * validation. Never throws -- always returns a usable plan plus which
 * source produced it (and, on fallback, why).
 */
async function resolveQueryPlan(
  input: { missionText: string | null; category: string; geographyLabel: string; ratingThreshold: number | null; targetQuantity: number },
  parserFn: typeof parseMissionWithClaude,
  tenantId: string,
): Promise<{ plan: MissionQueryPlan; source: QueryPlannerSource; fallbackReason: QueryPlannerFallbackReason }> {
  try {
    const parsed = await parserFn(input, { tenantId });
    if (parsed.status === "ok") {
      return { plan: parsed.plan, source: "anthropic_structured", fallbackReason: null };
    }
    return { plan: planMissionQuery(input), source: "deterministic_fallback", fallbackReason: parsed.status };
  } catch {
    // Never let a parser failure block discovery from running at all.
    return { plan: planMissionQuery(input), source: "deterministic_fallback", fallbackReason: "parser_exception" };
  }
}

function denialReasons(error: unknown): string[] {
  const message = error instanceof Error ? error.message : String(error);
  const match = /denied: (.+)$/.exec(message);
  return match ? match[1].split(",") : ["create_failed"];
}

export type CreateMissionResult =
  | { allowed: true; reasons: []; missionId: string; status: "draft" | "active" }
  | { allowed: false; reasons: string[]; missionId: string | null; status: "draft" | null };

export function createVendorAcquisitionMissionRouter(
  injectedStore?: VendorAcquisitionMissionStore,
  injectedSourcingStore?: VendorSourcingStore,
  injectedDiscoveryFn: typeof runGooglePlacesDiscovery = runGooglePlacesDiscovery,
  injectedParserFn: typeof parseMissionWithClaude = parseMissionWithClaude,
  injectedContactAttemptStore?: VendorContactAttemptStore,
  injectedAvailabilityIntakeStore?: VendorCandidateAvailabilityIntakeStore,
  injectedMatchStore?: VendorMissionCandidateMatchStore,
  injectedVerifyServiceAreaFn: typeof verifyCandidateServiceArea = verifyCandidateServiceArea,
  injectedInterpretServiceAreaFn: typeof interpretServiceAreaWithClaude = interpretServiceAreaWithClaude,
) {
  return router({
    createMission: adminProcedure
      .input(z.object({
        category: z.string().min(1).max(100),
        geographyLabel: z.string().min(1).max(255),
        targetQuantity: z.number().int().min(1).max(500),
        qualityGates: qualityGatesInput,
        outreachMode: z.enum(MISSION_OUTREACH_MODES).default("draft_only"),
        deadlineAt: z.string().datetime().nullable().optional(),
        activateImmediately: z.boolean().default(false),
      }))
      .mutation(async ({ ctx, input }): Promise<CreateMissionResult> => {
        const store = resolveStore(injectedStore);
        const id = randomUUID();
        try {
          await store.createMission({
            id,
            tenantId: ctx.tenantId,
            category: input.category,
            geographyLabel: input.geographyLabel,
            targetQuantity: input.targetQuantity,
            qualityGates: input.qualityGates,
            outreachMode: input.outreachMode,
            deadlineAt: input.deadlineAt ? new Date(input.deadlineAt) : null,
            createdBy: ctx.user?.id != null ? String(ctx.user.id) : "admin",
          });
        } catch (error) {
          return { allowed: false, reasons: denialReasons(error), missionId: null, status: null };
        }

        if (!input.activateImmediately) {
          return { allowed: true, reasons: [], missionId: id, status: "draft" };
        }
        try {
          await store.activateMission(ctx.tenantId, id);
          return { allowed: true, reasons: [], missionId: id, status: "active" };
        } catch (error) {
          return { allowed: false, reasons: ["mission_created_but_" + denialReasons(error)[0]], missionId: id, status: "draft" };
        }
      }),

    listMissions: adminProcedure
      .input(z.object({ status: z.string().optional(), limit: z.number().int().min(1).max(250).default(50) }))
      .query(async ({ ctx, input }) => {
        const store = resolveStore(injectedStore);
        return store.listMissions({ tenantId: ctx.tenantId, status: input.status, limit: input.limit });
      }),

    /**
     * Read-only, admin-only candidate review query (Sub-slice 76c).
     * Reads exactly what runDiscovery already persisted into
     * vendor_sourcing_candidates -- never creates, sends, contacts, or
     * marks any provider-acceptance/booking/payment/dispatch truth.
     * Filters by category, not mission id -- vendor_sourcing_candidates
     * has no mission_id column.
     */
    listDiscoveredCandidates: adminProcedure
      .input(z.object({ category: z.string().optional(), limit: z.number().int().min(1).max(250).default(50) }))
      .query(async ({ ctx, input }) => {
        const sourcingStore = resolveSourcingStore(injectedSourcingStore);
        return sourcingStore.listCandidatesForReview({ tenantId: ctx.tenantId, category: input.category, limit: input.limit });
      }),

    /**
     * Slice 78a. Queues a draft-only, no-send contact-attempt record for a
     * real persisted candidate -- never sends email/SMS/Yelp/web-form/
     * phone, never marks provider_responded/provider_accepted/
     * booking_confirmed/payment_authorized/dispatched (those four are
     * hardcoded to 0 in createOrReuseAttempt's INSERT regardless of any
     * input here), and reuses the existing, already-deployed Slice 74
     * VendorContactAttemptStore.createOrReuseAttempt -- idempotent by a
     * deterministic idempotency key derived from the candidate id, so
     * approving the same candidate twice returns the existing draft
     * rather than creating a duplicate.
     */
    approveCandidateForDraftOutreach: adminProcedure
      .input(z.object({ candidateId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const sourcingStore = resolveSourcingStore(injectedSourcingStore);
        const candidate = await sourcingStore.getCandidate(ctx.tenantId, input.candidateId);
        if (!candidate) return { status: "candidate_not_found" as const };

        const draft = buildCandidateDraftOutreach({
          businessName: candidate.businessName,
          geographyHint: "their service area and nearby high-rise buildings",
        });

        const attemptStore = resolveContactAttemptStore(injectedContactAttemptStore);
        const draftBodyHash = createHash("sha256").update(draft.body).digest("hex");
        const now = new Date();
        const { attempt, reused } = await attemptStore.createOrReuseAttempt({
          tenantId: ctx.tenantId,
          sourceKey: `sourcing_candidate:${candidate.id}`,
          candidateId: candidate.id,
          channel: "manual_research_needed",
          draftSubject: draft.subject,
          draftBodySnapshot: draft.body,
          draftBodyHash,
          founderEscalationPresent: true,
          forbiddenClaimsScanJson: { found: draft.forbiddenClaimsDetected },
          sendGateResultJson: { allowed: false, reasons: ["draft_only_no_send_path_in_slice_78a"] },
          automationMode: "manual_fallback",
          providerAdapter: "draft_queue_v0",
          status: "draft_ready",
          statusHistoryJson: [{ status: "draft_ready", at: now.toISOString(), actor: "draft_queue_v0" }],
          createdBy: "draft_queue_v0",
          now,
        });

        return {
          status: "ok" as const,
          attemptId: attempt.id,
          alreadyQueued: reused,
          draftSubject: attempt.draftSubject,
          draftBody: attempt.draftBodySnapshot,
        };
      }),

    /**
     * Slice 80a. Sends exactly ONE supervised outreach email for ONE
     * Mission Shortlist candidate's already-queued (Slice 78a) draft.
     * Reuses the existing, already-deployed Slice 74e AgentMail adapter
     * (agentMailVendorEmailProvider.ts) verbatim -- evaluateAgentMailLiveSendGate
     * and sendVendorEmailViaAgentMail are not reimplemented here, and this
     * mutation never bypasses any precondition that gate already enforces
     * (provider config, canary flag, source allowlist, category allowlist,
     * founder escalation, forbidden claims, recipient validity, exact admin
     * confirmation phrase). No bulk loop exists: this only ever sends for
     * the single candidateId in the input, and only after explicitConfirmation
     * is true. recordLiveSendResult (the same store method the existing
     * casting-sprint canary uses) is the only thing that can ever set
     * outreach_sent_by_held -- and only after the provider call returns
     * status "sent". provider_accepted/booking_confirmed/payment_authorized/
     * dispatched are never referenced by this mutation at all.
     */
    sendCandidateDraftOutreachCanary: adminProcedure
      .input(z.object({
        missionId: z.string().min(1),
        candidateId: z.string().min(1),
        recipientEmail: z.string().min(3).max(320),
        explicitConfirmation: z.boolean(),
        adminConfirmationText: z.string().min(1).max(64),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!input.explicitConfirmation) {
          return { status: "blocked" as const, blockedReasons: ["explicit_confirmation_required"], attemptId: null, sendResult: null };
        }

        const missionStore = resolveStore(injectedStore);
        const mission = await missionStore.getMission(ctx.tenantId, input.missionId);
        if (!mission) return { status: "mission_not_found" as const, blockedReasons: [], attemptId: null, sendResult: null };

        const sourcingStore = resolveSourcingStore(injectedSourcingStore);
        const candidate = await sourcingStore.getCandidate(ctx.tenantId, input.candidateId);
        if (!candidate) return { status: "candidate_not_found" as const, blockedReasons: [], attemptId: null, sendResult: null };

        // Candidate must have a real mission match row for THIS mission --
        // never send for a candidate that only matched a different mission.
        const matchStore = resolveMatchStore(injectedMatchStore);
        const matches = await matchStore.listMissionMatches({ tenantId: ctx.tenantId, missionId: input.missionId, includeOverflow: true });
        const isOnThisMission = matches.some(match => match.candidateId === input.candidateId);
        if (!isOnThisMission) {
          return { status: "candidate_not_in_mission" as const, blockedReasons: ["candidate_has_no_match_row_for_this_mission"], attemptId: null, sendResult: null };
        }

        // The draft must already have been queued by approveCandidateForDraftOutreach (Slice 78a).
        const attemptStore = resolveContactAttemptStore(injectedContactAttemptStore);
        const recentAttempts = await attemptStore.listAttemptsByCandidateId(ctx.tenantId, input.candidateId, 1);
        const attempt = recentAttempts[0];
        if (!attempt) {
          return { status: "draft_not_found" as const, blockedReasons: ["candidate_has_no_draft_queued"], attemptId: null, sendResult: null };
        }

        // Idempotent: never call AgentMail twice for the same attempt.
        if (attempt.outreachSentByHeld) {
          return {
            status: "already_sent" as const, blockedReasons: [], attemptId: attempt.id,
            sendResult: { providerAttemptId: attempt.providerAttemptId, sentAt: attempt.sentAt?.toISOString() ?? null },
          };
        }

        const forbiddenClaimsDetected = (attempt.forbiddenClaimsScanJson as { found?: string[] } | null)?.found ?? [];
        const sendGatePassed = attempt.founderEscalationPresent && forbiddenClaimsDetected.length === 0;

        const liveGate = evaluateAgentMailLiveSendGate({
          sourceKey: attempt.sourceKey,
          category: candidate.category,
          recipientEmail: input.recipientEmail,
          // No separate vendor_contact_drafts row exists for candidate-
          // sourced drafts (Slice 78a stores draft fields directly on the
          // attempt) -- the attempt's own id is the durable draft identity
          // surrogate for this presence check.
          durableDraftId: attempt.id,
          durableAttemptId: attempt.id,
          idempotencyKey: null,
          sendGatePassed,
          founderEscalationPresent: attempt.founderEscalationPresent,
          forbiddenClaimsDetected,
          adminConfirmationText: input.adminConfirmationText,
        });

        if (!liveGate.allowed) {
          try {
            await attemptStore.recordLiveSendResult({
              tenantId: ctx.tenantId, attemptId: attempt.id, providerAdapter: "agentmail", providerAttemptId: null,
              liveProviderInvoked: false, outreachSentByHeld: false, nextStatus: "blocked", actor: "admin",
            });
          } catch {
            // Non-fatal: the gate result is still returned even if the audit write fails.
          }
          return { status: "gate_blocked" as const, blockedReasons: liveGate.reasons, attemptId: attempt.id, sendResult: null };
        }

        const labels = buildAgentMailLabels({ sourceKey: attempt.sourceKey, category: candidate.category });
        const sendResult = await sendVendorEmailViaAgentMail({
          inboxId: process.env.AGENTMAIL_VENDOR_INBOX_ID ?? "",
          inboxEmail: process.env.AGENTMAIL_VENDOR_INBOX_EMAIL ?? "",
          recipientEmail: input.recipientEmail,
          subject: attempt.draftSubject ?? "Mobile dog grooming availability for HELD residents",
          textBody: attempt.draftBodySnapshot ?? "",
          labels,
        });

        await attemptStore.recordLiveSendResult({
          tenantId: ctx.tenantId,
          attemptId: attempt.id,
          providerAdapter: "agentmail",
          providerAttemptId: sendResult.providerAttemptId,
          liveProviderInvoked: sendResult.liveProviderInvoked,
          outreachSentByHeld: sendResult.status === "sent",
          nextStatus: sendResult.status === "sent" ? "response_pending" : "blocked",
          actor: "admin",
        });

        return {
          status: sendResult.status === "sent" ? ("sent" as const) : ("send_failed" as const),
          blockedReasons: sendResult.status === "sent" ? [] : [sendResult.errorReason ?? "agentmail_send_rejected"],
          attemptId: attempt.id,
          sendResult: { providerAttemptId: sendResult.providerAttemptId, sentAt: sendResult.sentAt },
        };
      }),

    /**
     * Slice 78b. Read-only availability-intake lookup for a real
     * candidate. Returns null honestly when no intake exists yet --
     * never fabricates one. Validates tenant ownership by confirming the
     * candidate exists for this tenant before reading any intake row.
     */
    getCandidateAvailabilityIntake: adminProcedure
      .input(z.object({ candidateId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const sourcingStore = resolveSourcingStore(injectedSourcingStore);
        const candidate = await sourcingStore.getCandidate(ctx.tenantId, input.candidateId);
        if (!candidate) return { status: "candidate_not_found" as const };
        const intakeStore = resolveAvailabilityIntakeStore(injectedAvailabilityIntakeStore);
        const intake = await intakeStore.getByCandidateId({ tenantId: ctx.tenantId, candidateId: input.candidateId });
        return { status: "ok" as const, intake };
      }),

    /**
     * Slice 78b. Vendor candidate availability intake -- profile/intake
     * data only. Never creates a booking, never connects Google
     * Calendar, never sends an onboarding link/email/SMS/Yelp/web-form,
     * never makes a phone call, and never mutates any
     * vendor_contact_attempts truth column (this mutation has no access
     * to that store at all). Idempotent: a second save for the same
     * candidate updates the existing intake row via the table's own
     * UNIQUE KEY, never creating a duplicate.
     */
    saveCandidateAvailabilityIntake: adminProcedure
      .input(z.object({
        candidateId: z.string().min(1),
        mobileServiceConfirmed: z.enum(MOBILE_SERVICE_CONFIRMED_VALUES).optional(),
        serviceAreas: z.array(z.string().min(1).max(100)).max(50).nullable().optional(),
        recurringAvailability: z.array(z.object({
          days: z.array(z.string().min(1).max(20)).min(1).max(7),
          startTime: z.string().regex(/^\d{1,2}:\d{2}$/),
          endTime: z.string().regex(/^\d{1,2}:\d{2}$/),
          note: z.string().max(500).nullable().optional(),
        })).max(20).nullable().optional(),
        minimumNoticeHours: z.number().int().min(0).max(720).nullable().optional(),
        appointmentDurationMinutes: z.number().int().min(15).max(480).nullable().optional(),
        travelBufferMinutes: z.number().int().min(0).max(240).nullable().optional(),
        bookingUrl: z.union([z.string().url().max(2048), z.literal("")]).nullable().optional(),
        calendarMethod: z.enum(CALENDAR_METHODS).nullable().optional(),
        preferredContactChannel: z.enum(PREFERRED_CONTACT_CHANNELS).nullable().optional(),
        blackoutNotes: z.string().max(2000).nullable().optional(),
        onboardingNotes: z.string().max(2000).nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const sourcingStore = resolveSourcingStore(injectedSourcingStore);
        const candidate = await sourcingStore.getCandidate(ctx.tenantId, input.candidateId);
        if (!candidate) return { status: "candidate_not_found" as const };

        const intakeStore = resolveAvailabilityIntakeStore(injectedAvailabilityIntakeStore);
        const intake = await intakeStore.upsertForCandidate({
          tenantId: ctx.tenantId,
          candidateId: input.candidateId,
          mobileServiceConfirmed: input.mobileServiceConfirmed,
          serviceAreas: input.serviceAreas,
          recurringAvailability: input.recurringAvailability,
          minimumNoticeHours: input.minimumNoticeHours,
          appointmentDurationMinutes: input.appointmentDurationMinutes,
          travelBufferMinutes: input.travelBufferMinutes,
          bookingUrl: input.bookingUrl || null,
          calendarMethod: input.calendarMethod,
          preferredContactChannel: input.preferredContactChannel,
          blackoutNotes: input.blackoutNotes,
          onboardingNotes: input.onboardingNotes,
          createdBy: ctx.user?.id != null ? String(ctx.user.id) : "admin",
        });
        return { status: "ok" as const, intake };
      }),

    /**
     * Pure, deterministic, no-I/O preview of what runDiscovery would
     * plan -- lets Mission Control show the query plan before a mission
     * is even created. Never calls an LLM/AI provider, never persists
     * anything, never touches the database.
     */
    previewQueryPlan: adminProcedure
      .input(z.object({
        missionText: z.string().max(2000).nullable().optional(),
        category: z.string().min(1).max(100),
        geographyLabel: z.string().min(1).max(255),
        ratingThreshold: z.number().min(0).max(5).nullable().optional(),
        targetQuantity: z.number().int().min(1).max(500),
      }))
      .query(({ input }) => planMissionQuery({
        missionText: input.missionText ?? null,
        category: input.category,
        geographyLabel: input.geographyLabel,
        ratingThreshold: input.ratingThreshold ?? null,
        targetQuantity: input.targetQuantity,
      })),

    /**
     * Read-only Google Places discovery for a real mission, driven by
     * the mission-text query planner (Slice 77a) rather than category+
     * geography alone. Runs each planner-generated query variant
     * (capped at MAX_QUERY_VARIANTS) through Google Places, stops early
     * once enough distinct candidates are found for the mission's
     * target count, and dedupes by place id across variants. Never
     * sends outreach, never contacts a vendor, never marks any
     * provider-acceptance/booking/payment/dispatch truth. Persists
     * candidates only into the existing vendor_sourcing_candidates
     * table (sourceType "permitted_public_fetch"), with an
     * application-level idempotency check by (tenantId, sourceType,
     * placeId).
     */
    runDiscovery: adminProcedure
      .input(z.object({ missionId: z.string().min(1) }))
      .mutation(async ({ ctx, input }): Promise<RunDiscoveryResult> => {
        const missionStore = resolveStore(injectedStore);
        const mission = await missionStore.getMission(ctx.tenantId, input.missionId);
        if (!mission) return { status: "mission_not_found" };

        const ratingThreshold = mission.qualityGates.minGoogleRating ?? mission.qualityGates.minYelpRating ?? null;
        const { plan, source: queryPlannerSource, fallbackReason: queryPlannerFallbackReason } = await resolveQueryPlan({
          missionText: mission.qualityGates.missionText ?? null,
          category: mission.category,
          geographyLabel: mission.geographyLabel,
          ratingThreshold,
          targetQuantity: mission.targetQuantity,
        }, injectedParserFn, ctx.tenantId);

        // Slice 81e. Computed before discovery (not just before
        // ranking) so the search itself can be biased toward the
        // mission's actual target area -- locationBias is a Places
        // API New BIAS, not a hard restriction, so out-of-area results
        // can still come back; the real safety net is the eligibility
        // gate applied below, after discovery.
        const { targetZip, targetBuildingName } = resolveTargetGeography(mission.geographyLabel);
        const targetCentroid = getKnownTargetZipCentroid(targetZip);
        const locationBias = targetCentroid ? { ...targetCentroid, radiusMeters: 40_000 } : null;

        const byPlaceId = new Map<string, NormalizedPlaceCandidate & { matchedQuery: string }>();
        let lastError: { status: "provider_error"; reason: string } | null = null;

        for (const searchText of plan.searchQueries) {
          if (byPlaceId.size >= mission.targetQuantity) break;
          const discovery = await injectedDiscoveryFn({ searchText, minRating: ratingThreshold, maxResults: mission.targetQuantity, locationBias });
          if (discovery.status === "needs_provider_config") return discovery;
          if (discovery.status === "provider_error") {
            lastError = discovery;
            continue;
          }
          for (const candidate of discovery.candidates) {
            if (!byPlaceId.has(candidate.placeId)) {
              byPlaceId.set(candidate.placeId, { ...candidate, matchedQuery: searchText });
            }
          }
        }

        if (byPlaceId.size === 0 && lastError) return lastError;

        const sourcingStore = resolveSourcingStore(injectedSourcingStore);
        const summaries: DiscoveredCandidateSummary[] = [];
        let persistedCount = 0;
        let alreadyDiscoveredCount = 0;
        const resolvedCandidates: Array<{ candidateId: string; candidate: NormalizedPlaceCandidate & { matchedQuery: string } }> = [];

        for (const candidate of Array.from(byPlaceId.values())) {
          const existing = await sourcingStore.findCandidateBySourceReference(
            ctx.tenantId, "permitted_public_fetch", candidate.placeId,
          );
          if (existing) {
            alreadyDiscoveredCount += 1;
            summaries.push({ ...candidate, persisted: false, alreadyDiscovered: true });
            resolvedCandidates.push({ candidateId: existing.id, candidate });
            continue;
          }
          const candidateId = randomUUID();
          try {
            await sourcingStore.createCandidate({
              id: candidateId,
              tenantId: ctx.tenantId,
              sourceType: "permitted_public_fetch",
              sourceReference: candidate.placeId,
              category: mission.category,
              businessName: candidate.businessName,
              publicProfile: { address: candidate.address, coordinates: candidate.coordinates, sourceUrl: candidate.sourceUrl },
              evidence: {
                ...candidate,
                matchedQuery: candidate.matchedQuery,
                missionText: mission.qualityGates.missionText ?? null,
                queryIntent: plan.primaryIntent,
                serviceMode: plan.serviceMode,
                queryPlannerSource,
              },
              createdBy: "google_places_discovery",
            });
            persistedCount += 1;
            summaries.push({ ...candidate, persisted: true, alreadyDiscovered: false });
            resolvedCandidates.push({ candidateId, candidate });
          } catch {
            summaries.push({ ...candidate, persisted: false, alreadyDiscovered: false });
          }
        }

        // Slice 81a/81b. Verify service-area fit and contact route for
        // every candidate resolved in this run BEFORE ranking -- a
        // "mobile" query result with a great rating is never enough on
        // its own to call a candidate outreach-ready. The deterministic
        // verifier always runs first (it performs the one safe website
        // fetch); the Claude structured interpreter then reads that
        // same already-fetched text as the primary interpretation layer
        // when there is meaningful text, with the deterministic result
        // as its own fallback. targetZip/targetBuildingName were
        // already resolved above (before discovery, for locationBias).
        const verifiedCandidates = await Promise.all(resolvedCandidates.map(async entry => {
          const verification = await injectedVerifyServiceAreaFn({
            candidate: {
              address: entry.candidate.address, website: entry.candidate.website,
              phone: entry.candidate.phone, coordinates: entry.candidate.coordinates,
            },
            targetZip, targetBuildingName,
          });
          const evidence = verification.websiteChecked && verification.websiteTextSnippet.trim().length > 0
            ? await resolveServiceAreaEvidence({
                missionText: mission.qualityGates.missionText ?? null,
                targetZip, targetBuildingName,
                candidateName: entry.candidate.businessName,
                candidateAddress: entry.candidate.address,
                candidateWebsite: entry.candidate.website,
                candidatePhone: entry.candidate.phone,
                deterministic: verification,
              }, injectedInterpretServiceAreaFn, ctx.tenantId)
            : resolveEffectiveServiceAreaEvidence(verification, null, "deterministic_fallback", "no_website_text");
          // Slice 81c. Vendor-level mobile evidence, never the mission
          // query's own mobile intent -- see hasVendorMobileEvidence.
          const vendorHasMobileEvidence = hasVendorMobileEvidence(entry.candidate.businessName, verification.websiteTextSnippet);
          const fulfillment = classifyFulfillment(evidence, vendorHasMobileEvidence);
          return { ...entry, verification, evidence, fulfillment };
        }));

        // Slice 81c. Rank every candidate resolved in this run by
        // FULFILLMENT TIER first (green mobile/building-service, then
        // blue drive-to storefront fallback, then yellow needs-review,
        // then red out-of-area) -- a mission asking for "10 mobile
        // groomers" never silently pads the shortlist with 10 vendors
        // that merely matched a mobile-intent query; it shows however
        // many are actually green, then fills the rest with the
        // closest high-quality storefront fallbacks. Within the blue
        // tier specifically, known distance-to-target breaks ties
        // before rating; every other tier breaks ties by the existing
        // rating/review-count/contact-method score. Persists a
        // mission-scoped match row for each (the same candidate can
        // carry separate match rows for separate missions; never a
        // single mission_id column on vendor_sourcing_candidates).
        const matchStore = resolveMatchStore(injectedMatchStore);
        const sorted = [...verifiedCandidates].sort((a, b) => {
          const tierDiff = FULFILLMENT_TIER_ORDER[a.fulfillment.fulfillmentTier] - FULFILLMENT_TIER_ORDER[b.fulfillment.fulfillmentTier];
          if (tierDiff !== 0) return tierDiff;
          if (a.fulfillment.fulfillmentTier === "blue") {
            // A storefront fallback that's confirmed to serve the
            // target area still ranks above an unconfirmed one, before
            // distance/rating break further ties.
            const subTierDiff = SERVICE_AREA_SUB_TIER[a.evidence.serviceAreaStatus] - SERVICE_AREA_SUB_TIER[b.evidence.serviceAreaStatus];
            if (subTierDiff !== 0) return subTierDiff;
            const aDist = a.verification.distanceMilesToTarget;
            const bDist = b.verification.distanceMilesToTarget;
            if (aDist !== null && bDist !== null && aDist !== bDist) return aDist - bDist;
            if (aDist !== null && bDist === null) return -1;
            if (aDist === null && bDist !== null) return 1;
          }
          const scoreDiff = rankScoreForCandidate(b.candidate, plan.serviceMode, plan.serviceMode)
            - rankScoreForCandidate(a.candidate, plan.serviceMode, plan.serviceMode);
          return scoreDiff !== 0 ? scoreDiff : a.candidate.placeId.localeCompare(b.candidate.placeId);
        });

        // Slice 81e. Primary-shortlist eligibility is a HARD gate, not
        // a soft preference: red/out-of-area is NEVER primary, and
        // blue/yellow candidates beyond their distance limit without
        // explicit service-area support are excluded too -- regardless
        // of whether enough alternatives exist to fill the mission's
        // target count. Better to show fewer usable options honestly
        // than to pad the count with a candidate 2,000 miles away.
        const eligible = sorted.map(entry => ({
          ...entry,
          eligibility: evaluatePrimaryShortlistEligibility(entry.fulfillment, entry.evidence, entry.verification.distanceMilesToTarget),
        }));
        const shortlistedIds = new Set<string>();
        for (const entry of eligible.filter(e => e.eligibility.eligible).slice(0, mission.targetQuantity)) {
          shortlistedIds.add(entry.candidateId);
        }

        let shortlistedCount = 0;
        for (let index = 0; index < eligible.length; index += 1) {
          const { candidateId, candidate, verification, evidence, fulfillment, eligibility } = eligible[index];
          const isShortlisted = shortlistedIds.has(candidateId);
          if (isShortlisted) shortlistedCount += 1;
          await matchStore.upsertMatch({
            tenantId: ctx.tenantId,
            missionId: mission.id,
            candidateId,
            matchedQuery: candidate.matchedQuery,
            queryPlannerSource: queryPlannerSource as MatchQueryPlannerSource,
            serviceMode: plan.serviceMode as MatchServiceMode,
            rankScore: rankScoreForCandidate(candidate, plan.serviceMode, plan.serviceMode),
            rankPosition: index + 1,
            isShortlisted,
            matchEvidence: {
              ...candidate,
              serviceAreaVerification: verification,
              serviceAreaEffectiveEvidence: evidence,
              fulfillmentClassification: fulfillment,
              primaryShortlistEligibility: eligibility,
            },
          });
        }

        return {
          status: "ok",
          foundCount: byPlaceId.size,
          persistedCount,
          alreadyDiscoveredCount,
          shortlistedCount,
          overflowCount: sorted.length - shortlistedCount,
          candidates: summaries,
          queryPlannerSource,
          queryPlannerFallbackReason,
        };
      }),

    /**
     * Slice 79a. Mission-scoped candidate shortlist: returns only the
     * top targetQuantity-ranked candidates for this mission by default
     * (is_shortlisted = 1), with includeOverflow returning the rest too.
     * Reads exactly what runDiscovery already persisted -- never
     * creates, sends, contacts, or marks any provider-acceptance/
     * booking/payment/dispatch truth.
     */
    listMissionShortlist: adminProcedure
      .input(z.object({ missionId: z.string().min(1), includeOverflow: z.boolean().default(false) }))
      .query(async ({ ctx, input }) => {
        const missionStore = resolveStore(injectedStore);
        const mission = await missionStore.getMission(ctx.tenantId, input.missionId);
        if (!mission) return { status: "mission_not_found" as const };

        const matchStore = resolveMatchStore(injectedMatchStore);
        // Slice 81e. Always reads every match (including overflow/
        // excluded) so the summary counts reflect reality regardless
        // of what the caller asked to see -- entries returned to the
        // caller are filtered down afterward per input.includeOverflow.
        const [allMatches, counts] = await Promise.all([
          matchStore.listMissionMatches({ tenantId: ctx.tenantId, missionId: input.missionId, includeOverflow: true }),
          matchStore.countMissionMatches({ tenantId: ctx.tenantId, missionId: input.missionId }),
        ]);
        const matches = input.includeOverflow ? allMatches : allMatches.filter(match => match.isShortlisted);

        const sourcingStore = resolveSourcingStore(injectedSourcingStore);
        const candidates = await sourcingStore.listCandidatesForReview({ tenantId: ctx.tenantId, category: mission.category, limit: 250 });
        const candidateById = new Map(candidates.map(candidate => [candidate.id, candidate]));

        // Slice 81a/81b/81e. Every field here is read from this
        // mission match's own evidence (refreshed every runDiscovery
        // run for this mission) -- never from the candidate's own
        // evidence blob, which is written once at first discovery and
        // can go stale or reflect a different mission's geography.
        // This NEVER calls Claude or the network -- it only reads what
        // runDiscovery already persisted.
        function mapMatchToEntry(match: (typeof allMatches)[number]) {
          const candidate = candidateById.get(match.candidateId);
          if (!candidate) return null;
          const matchEvidence = match.matchEvidence as {
            serviceAreaVerification?: ServiceAreaVerification;
            serviceAreaEffectiveEvidence?: EffectiveServiceAreaEvidence;
            fulfillmentClassification?: FulfillmentClassification;
            primaryShortlistEligibility?: PrimaryShortlistEligibility;
          } | null;
          const deterministic = matchEvidence?.serviceAreaVerification ?? null;
          const effective = matchEvidence?.serviceAreaEffectiveEvidence ?? null;
          const serviceAreaVerification = deterministic ? {
            ...deterministic,
            serviceAreaStatus: effective?.serviceAreaStatus ?? deterministic.serviceAreaStatus,
            serviceAreaReasons: effective?.serviceAreaReasons ?? deterministic.serviceAreaReasons,
            contactRoute: effective?.contactRoute ?? deterministic.contactRoute,
            outreachReadiness: effective?.outreachReadiness ?? deterministic.outreachReadiness,
            emailAddressesFound: effective?.emailAddressesFound ?? deterministic.emailAddressesFound,
            requiresHumanReview: effective?.requiresHumanReview ?? false,
            serviceAreaInterpreterSource: effective?.serviceAreaInterpreterSource ?? "deterministic_fallback",
            serviceAreaFallbackReason: effective?.serviceAreaFallbackReason ?? null,
          } : null;
          // Slice 81c/81e. fulfillmentClassification/eligibility are
          // read the same way -- from the match's own persisted
          // evidence, never re-derived or re-fetched here. Missions
          // whose matches predate these slices simply have none until
          // runDiscovery is re-run for them.
          const fulfillment = matchEvidence?.fulfillmentClassification ?? null;
          const eligibility = matchEvidence?.primaryShortlistEligibility ?? null;
          return {
            ...candidate,
            matchedQuery: match.matchedQuery,
            queryPlannerSource: match.queryPlannerSource,
            serviceMode: match.serviceMode,
            rankPosition: match.rankPosition,
            isShortlisted: match.isShortlisted,
            serviceAreaVerification,
            overflowReason: !match.isShortlisted ? eligibility?.exclusionReason ?? serviceAreaVerification?.serviceAreaReasons[0] ?? "Service area unverified" : null,
            fulfillmentMode: fulfillment?.fulfillmentMode ?? null,
            fulfillmentTier: fulfillment?.fulfillmentTier ?? null,
            fulfillmentLabel: fulfillment?.fulfillmentLabel ?? null,
            fulfillmentReason: fulfillment?.fulfillmentReason ?? null,
            distanceToTargetMiles: deterministic?.distanceMilesToTarget ?? null,
          };
        }

        const entries = matches.map(mapMatchToEntry).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

        // Slice 81c/81e. Computed from EVERY match (allMatches), not
        // just the entries returned to this caller -- otherwise a
        // default (includeOverflow: false) call would always show
        // zero out-of-area/excluded counts even when real candidates
        // were excluded for exactly that reason.
        const allEntriesForSummary = allMatches.map(mapMatchToEntry).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
        const summary = {
          verifiedMobileCount: allEntriesForSummary.filter(e => e.fulfillmentMode === "verified_mobile_building_service").length,
          likelyMobileCount: allEntriesForSummary.filter(e => e.fulfillmentMode === "likely_mobile_building_service").length,
          mobileNeedsReviewCount: allEntriesForSummary.filter(e => e.fulfillmentMode === "mobile_needs_review").length,
          driveToFallbackCount: allEntriesForSummary.filter(e => e.fulfillmentMode === "drive_to_storefront_fallback").length,
          likelyOutOfAreaCount: allEntriesForSummary.filter(e => e.fulfillmentMode === "likely_out_of_area").length,
          outOfAreaCount: allEntriesForSummary.filter(e => e.fulfillmentMode === "out_of_area").length,
          excludedOutOfAreaCount: allEntriesForSummary.filter(e => !e.isShortlisted && (e.fulfillmentTier === "red")).length,
          usableCount: allEntriesForSummary.filter(e => e.isShortlisted).length,
          emailReadyCount: allEntriesForSummary.filter(e => e.serviceAreaVerification?.outreachReadiness === "email_ready").length,
          formRequiredCount: allEntriesForSummary.filter(e => e.serviceAreaVerification?.outreachReadiness === "form_required").length,
          smsOrCallRequiredCount: allEntriesForSummary.filter(e => e.serviceAreaVerification?.outreachReadiness === "sms_or_call_required").length,
        };

        return {
          status: "ok" as const,
          targetQuantity: mission.targetQuantity,
          totalFound: counts.total,
          shortlistedCount: counts.shortlisted,
          overflowCount: counts.total - counts.shortlisted,
          entries,
          summary,
        };
      }),
  });
}

export const vendorAcquisitionMissionRouter = createVendorAcquisitionMissionRouter();
