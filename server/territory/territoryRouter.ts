import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  dayforgeTerritoryProcedure,
  publicProcedure,
  router,
} from "../_core/trpc";
import { createCommercialMission } from "../commercialMissions/commercialMissionStore";
import {
  discoverLaundryTerritory,
  type LaundryTerritoryOperatorContext,
} from "./territoryDiscovery";
import { GooglePlacesTerritoryProvider } from "./googlePlacesTerritoryProvider";
import { assertTerritoryPreviewRateLimit } from "./territoryRateLimit";
import {
  getPersistedTerritoryResult,
  getTerritoryOperatorProfile,
  persistTerritoryScan,
  saveTerritoryOperatorProfile,
} from "./territoryStore";

const scanInput = z.object({ address: z.string().trim().min(5).max(512) });
const profileInput = z.object({
  storeName: z.string().trim().min(1).max(255),
  storeAddress: z.string().trim().min(5).max(512),
  serviceRadiusMiles: z.number().positive().max(50),
  commercialWashFoldEnabled: z.boolean(),
  averagePricePerPoundCents: z.number().int().positive().max(100_000),
  availableWeeklyCapacityPounds: z.number().int().nonnegative().max(1_000_000),
  routePoints: z
    .array(
      z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
    )
    .max(500),
  turnaroundCompatibleByDefault: z.boolean(),
  pickupDaysCompatibleByDefault: z.boolean(),
});

function provider() {
  const key =
    process.env.GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY ?? "";
  if (!key)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Territory provider is not configured",
    });
  return new GooglePlacesTerritoryProvider(key);
}

function publicOperator(): LaundryTerritoryOperatorContext {
  return {
    tenantId: "public-preview",
    serviceRadiusMiles: Number(process.env.TERRITORY_PREVIEW_RADIUS_MILES ?? 3),
    commercialWashFoldEnabled: true,
    averagePricePerPoundCents: Number(
      process.env.TERRITORY_PREVIEW_PRICE_PER_POUND_CENTS ?? 250
    ),
    availableWeeklyCapacityPounds: Number(
      process.env.TERRITORY_PREVIEW_CAPACITY_POUNDS ?? 600
    ),
    routePoints: [],
    turnaroundCompatibleByDefault: true,
    pickupDaysCompatibleByDefault: true,
  };
}

function clientKey(req: {
  headers: Record<string, unknown>;
  socket?: { remoteAddress?: string | undefined };
}): string {
  const forwarded = req.headers["x-forwarded-for"];
  return String(
    Array.isArray(forwarded)
      ? forwarded[0]
      : (forwarded ?? req.socket?.remoteAddress ?? "unknown")
  )
    .split(",")[0]!
    .trim();
}

export const territoryRouter = router({
  publicPreview: publicProcedure
    .input(scanInput)
    .query(async ({ ctx, input }) => {
      try {
        assertTerritoryPreviewRateLimit(clientKey(ctx.req));
      } catch (error) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: (error as Error).message,
        });
      }
      const result = await discoverLaundryTerritory({
        addressOrBusiness: input.address,
        provider: provider(),
        operator: publicOperator(),
        limit: 12,
      });
      const persisted = await persistTerritoryScan({
        tenantId: null,
        mode: "public_preview",
        addressQuery: input.address,
        createdBy: null,
        result,
      });
      return { ...result, ...persisted };
    }),

  profile: dayforgeTerritoryProcedure.query(({ ctx }) =>
    getTerritoryOperatorProfile(ctx.tenantId)
  ),

  saveProfile: dayforgeTerritoryProcedure
    .input(profileInput)
    .mutation(async ({ ctx, input }) => {
      await saveTerritoryOperatorProfile({ ...input, tenantId: ctx.tenantId });
      return { ok: true as const };
    }),

  scan: dayforgeTerritoryProcedure
    .input(scanInput)
    .mutation(async ({ ctx, input }) => {
      const operator = await getTerritoryOperatorProfile(ctx.tenantId);
      if (!operator)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Configure the tenant territory profile before scanning",
        });
      const result = await discoverLaundryTerritory({
        addressOrBusiness: input.address,
        provider: provider(),
        operator,
        limit: 20,
      });
      const persisted = await persistTerritoryScan({
        tenantId: ctx.tenantId,
        mode: "tenant",
        addressQuery: input.address,
        createdBy: ctx.user.openId,
        result,
      });
      return { ...result, ...persisted };
    }),

  createMission: dayforgeTerritoryProcedure
    .input(
      z.object({
        scanId: z.string().min(8).max(64),
        candidateKey: z.string().min(3).max(191),
        assignedTo: z.string().min(1).max(128).nullable().optional(),
        idempotencyKey: z.string().min(8).max(191),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await getPersistedTerritoryResult({
        tenantId: ctx.tenantId,
        scanId: input.scanId,
        candidateKey: input.candidateKey,
      });
      if (!result)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Persisted territory opportunity not found",
        });
      return createCommercialMission({
        tenantId: ctx.tenantId,
        assignedTo: input.assignedTo,
        account: {
          providerName: result.providerName,
          providerAccountId: result.providerAccountId,
          name: result.account.name,
          accountType: result.account.accountType,
          address: result.account.address,
          latitude: result.account.latitude,
          longitude: result.account.longitude,
          locationCount: result.account.locationCount,
          decisionMaker: result.account.decisionMaker,
        },
        opportunity: {
          estimatedAnnualValueCents: result.score.estimatedAnnualValueCents,
          estimateConfidence: result.score.grade,
          score: result.score.score,
          primarySignal: result.primarySignal,
          reasons: result.score.reasons,
          risks: result.score.risks,
        },
        brief: {
          laundryOpportunity: `Recurring commercial laundry service for ${result.account.name}.`,
          salesAngle: `A local pickup-and-delivery laundry program sized to this account's estimated demand.`,
          openingLine: `Who is the right person to discuss laundry service for ${result.account.name}?`,
          discoveryQuestions: [
            "How is recurring laundry handled today?",
            "Which items and locations create the most laundry work?",
            "What pickup schedule would fit the operation?",
          ],
          objections: [
            "Current provider",
            "Pricing",
            "Pickup schedule",
            "Turnaround time",
          ],
        },
        steps: [
          {
            key: "scout",
            label: "Scout",
            detail: "Review sourced account evidence and fit.",
            status: "completed",
            position: 0,
          },
          {
            key: "prepare",
            label: "Prepare",
            detail: "Build the pitch and collateral.",
            status: "ready",
            position: 1,
          },
          {
            key: "battle",
            label: "Battle",
            detail: "Complete the BORESLAY mission.",
            status: "locked",
            position: 2,
          },
          {
            key: "field",
            label: "Field",
            detail: "Complete the real-world visit.",
            status: "locked",
            position: 3,
          },
        ],
        actor: { type: "operator", id: ctx.user.openId },
        idempotencyKey: input.idempotencyKey,
      });
    }),
});
