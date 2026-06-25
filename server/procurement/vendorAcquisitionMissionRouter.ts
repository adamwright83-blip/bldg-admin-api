import { randomUUID } from "node:crypto";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { CANONICAL_SERVICE_CATEGORIES, getCanonicalServiceDefinition, type CanonicalServiceCategory } from "./canonicalServiceTaxonomyPolicy";
import { runGooglePlacesDiscovery, type NormalizedPlaceCandidate } from "./googlePlacesDiscoveryConnector";
import { createProcurementPool } from "./migrations";
import { MISSION_OUTREACH_MODES } from "./vendorAcquisitionMissionPolicy";
import { VendorAcquisitionMissionStore } from "./vendorAcquisitionMissionStore";
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

function searchTextForMission(category: string, geographyLabel: string): string {
  const isCanonical = (CANONICAL_SERVICE_CATEGORIES as readonly string[]).includes(category);
  const label = isCanonical ? getCanonicalServiceDefinition(category as CanonicalServiceCategory).label : category;
  return `${label} near ${geographyLabel}`;
}

export type DiscoveredCandidateSummary = NormalizedPlaceCandidate & { persisted: boolean; alreadyDiscovered: boolean };
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
     * Read-only Google Places discovery for a real mission. Never sends
     * outreach, never contacts a vendor, never marks any provider-
     * acceptance/booking/payment/dispatch truth. Persists candidates only
     * into the existing vendor_sourcing_candidates table (sourceType
     * "permitted_public_fetch" -- automated, explicitly-permitted public
     * fetch, per vendor_source_registry), with an application-level
     * idempotency check by (tenantId, sourceType, placeId).
     */
    runDiscovery: adminProcedure
      .input(z.object({ missionId: z.string().min(1) }))
      .mutation(async ({ ctx, input }): Promise<RunDiscoveryResult> => {
        const missionStore = resolveStore(injectedStore);
        const mission = await missionStore.getMission(ctx.tenantId, input.missionId);
        if (!mission) return { status: "mission_not_found" };

        const ratingThreshold = mission.qualityGates.minGoogleRating ?? mission.qualityGates.minYelpRating ?? null;
        const discovery = await injectedDiscoveryFn({
          searchText: searchTextForMission(mission.category, mission.geographyLabel),
          minRating: ratingThreshold,
          maxResults: mission.targetQuantity,
        });

        if (discovery.status !== "ok") return discovery;

        const sourcingStore = resolveSourcingStore(injectedSourcingStore);
        const summaries: DiscoveredCandidateSummary[] = [];
        let persistedCount = 0;
        let alreadyDiscoveredCount = 0;

        for (const candidate of discovery.candidates) {
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
              evidence: candidate,
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
          foundCount: discovery.candidates.length,
          persistedCount,
          alreadyDiscoveredCount,
          candidates: summaries,
        };
      }),
  });
}

export const vendorAcquisitionMissionRouter = createVendorAcquisitionMissionRouter();
