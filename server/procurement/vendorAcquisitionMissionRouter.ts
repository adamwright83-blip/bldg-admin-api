import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  CALENDAR_METHODS, MOBILE_SERVICE_CONFIRMED_VALUES, PREFERRED_CONTACT_CHANNELS,
  VendorCandidateAvailabilityIntakeStore,
} from "./vendorCandidateAvailabilityIntakeStore";
import { buildCandidateDraftOutreach } from "./vendorCandidateDraftOutreachPolicy";
import { VendorContactAttemptStore } from "./vendorContactAttemptStore";
import { runGooglePlacesDiscovery, type NormalizedPlaceCandidate } from "./googlePlacesDiscoveryConnector";
import { createProcurementPool } from "./migrations";
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

        const byPlaceId = new Map<string, NormalizedPlaceCandidate & { matchedQuery: string }>();
        let lastError: { status: "provider_error"; reason: string } | null = null;

        for (const searchText of plan.searchQueries) {
          if (byPlaceId.size >= mission.targetQuantity) break;
          const discovery = await injectedDiscoveryFn({ searchText, minRating: ratingThreshold, maxResults: mission.targetQuantity });
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

        // Rank every candidate resolved in this run, shortlist only the
        // top targetQuantity, and persist a mission-scoped match row for
        // each -- the same candidate can carry separate match rows for
        // separate missions (never a single mission_id column on
        // vendor_sourcing_candidates).
        const matchStore = resolveMatchStore(injectedMatchStore);
        const ranked = [...resolvedCandidates].sort((a, b) => {
          const scoreDiff = rankScoreForCandidate(b.candidate, plan.serviceMode, plan.serviceMode)
            - rankScoreForCandidate(a.candidate, plan.serviceMode, plan.serviceMode);
          return scoreDiff !== 0 ? scoreDiff : a.candidate.placeId.localeCompare(b.candidate.placeId);
        });
        let shortlistedCount = 0;
        for (let index = 0; index < ranked.length; index += 1) {
          const { candidateId, candidate } = ranked[index];
          const isShortlisted = index < mission.targetQuantity;
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
            matchEvidence: candidate,
          });
        }

        return {
          status: "ok",
          foundCount: byPlaceId.size,
          persistedCount,
          alreadyDiscoveredCount,
          shortlistedCount,
          overflowCount: ranked.length - shortlistedCount,
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
        const [matches, counts] = await Promise.all([
          matchStore.listMissionMatches({ tenantId: ctx.tenantId, missionId: input.missionId, includeOverflow: input.includeOverflow }),
          matchStore.countMissionMatches({ tenantId: ctx.tenantId, missionId: input.missionId }),
        ]);

        const sourcingStore = resolveSourcingStore(injectedSourcingStore);
        const candidates = await sourcingStore.listCandidatesForReview({ tenantId: ctx.tenantId, category: mission.category, limit: 250 });
        const candidateById = new Map(candidates.map(candidate => [candidate.id, candidate]));

        const entries = matches
          .map(match => {
            const candidate = candidateById.get(match.candidateId);
            if (!candidate) return null;
            return {
              ...candidate,
              matchedQuery: match.matchedQuery,
              queryPlannerSource: match.queryPlannerSource,
              serviceMode: match.serviceMode,
              rankPosition: match.rankPosition,
              isShortlisted: match.isShortlisted,
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

        return {
          status: "ok" as const,
          targetQuantity: mission.targetQuantity,
          totalFound: counts.total,
          shortlistedCount: counts.shortlisted,
          entries,
        };
      }),
  });
}

export const vendorAcquisitionMissionRouter = createVendorAcquisitionMissionRouter();
