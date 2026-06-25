import { randomUUID } from "node:crypto";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { runGooglePlacesDiscovery, type NormalizedPlaceCandidate } from "./googlePlacesDiscoveryConnector";
import { createProcurementPool } from "./migrations";
import { MISSION_OUTREACH_MODES } from "./vendorAcquisitionMissionPolicy";
import { VendorAcquisitionMissionStore } from "./vendorAcquisitionMissionStore";
import { planMissionQuery } from "./vendorMissionQueryPlanner";
import { VendorSourcingStore } from "./vendorSourcingStore";

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

export type DiscoveredCandidateSummary = NormalizedPlaceCandidate & {
  persisted: boolean; alreadyDiscovered: boolean; matchedQuery: string;
};
export type RunDiscoveryResult =
  | { status: "mission_not_found" }
  | { status: "needs_provider_config"; missingEnvVar: string }
  | { status: "provider_error"; reason: string }
  | { status: "ok"; foundCount: number; persistedCount: number; alreadyDiscoveredCount: number; candidates: DiscoveredCandidateSummary[] };

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
        const plan = planMissionQuery({
          missionText: mission.qualityGates.missionText ?? null,
          category: mission.category,
          geographyLabel: mission.geographyLabel,
          ratingThreshold,
          targetQuantity: mission.targetQuantity,
        });

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

        for (const candidate of Array.from(byPlaceId.values())) {
          const existing = await sourcingStore.findCandidateBySourceReference(
            ctx.tenantId, "permitted_public_fetch", candidate.placeId,
          );
          if (existing) {
            alreadyDiscoveredCount += 1;
            summaries.push({ ...candidate, persisted: false, alreadyDiscovered: true });
            continue;
          }
          try {
            await sourcingStore.createCandidate({
              id: randomUUID(),
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
              },
              createdBy: "google_places_discovery",
            });
            persistedCount += 1;
            summaries.push({ ...candidate, persisted: true, alreadyDiscovered: false });
          } catch {
            summaries.push({ ...candidate, persisted: false, alreadyDiscovered: false });
          }
        }

        return {
          status: "ok",
          foundCount: byPlaceId.size,
          persistedCount,
          alreadyDiscoveredCount,
          candidates: summaries,
        };
      }),
  });
}

export const vendorAcquisitionMissionRouter = createVendorAcquisitionMissionRouter();
