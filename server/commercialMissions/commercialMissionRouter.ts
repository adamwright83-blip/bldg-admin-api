import { z } from "zod";
import {
  COMMERCIAL_MISSION_STATUSES,
  DEMO_OPPORTUNITIES,
} from "@shared/commercialMission";
import { buildCommercialMissionFromOpportunity } from "@shared/commercialMissionFactory";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import { DemoTerritoryProvider } from "../territory/demoTerritoryProvider";
import { discoverLaundryTerritory } from "../territory/territoryDiscovery";
import {
  createPersistedCommercialMission,
  getPersistedCommercialMission,
  listPersistedCommercialMissions,
  transitionPersistedCommercialMission,
} from "./opsTaskCommercialMissionStore";

const actorTypeSchema = z.enum(["system", "operator", "driver", "game"]);
const demoTerritoryProvider = new DemoTerritoryProvider();

export const commercialMissionRouter = router({
  previewTerritory: publicProcedure
    .input(
      z.object({
        address: z.string().trim().min(3).max(240),
      })
    )
    .query(async ({ input }) => {
      const territory = await discoverLaundryTerritory({
        addressOrBusiness: input.address,
        provider: demoTerritoryProvider,
        operator: {
          tenantId: "dayforge-preview",
          serviceRadiusMiles: 3,
          commercialWashFoldEnabled: true,
          averagePricePerPoundCents: 250,
          availableWeeklyCapacityPounds: 900,
          routePoints: [
            { lat: 34.078, lng: -118.257 },
            { lat: 34.071, lng: -118.248 },
          ],
          turnaroundCompatibleByDefault: true,
          pickupDaysCompatibleByDefault: true,
        },
        limit: 20,
      });
      const strongest = territory.opportunities[0] ?? DEMO_OPPORTUNITIES[0];
      return {
        previewMode: true as const,
        provider: "demo" as const,
        address: input.address,
        center: territory.center,
        providerCandidateCount: territory.providerCandidateCount,
        dedupedCandidateCount: territory.dedupedCandidateCount,
        opportunities: territory.opportunities,
        evidenceByOpportunityId: territory.evidenceByOpportunityId,
        suggestedMission: buildCommercialMissionFromOpportunity(strongest),
      };
    }),

  list: adminProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(250).default(100),
        })
        .default({ limit: 100 })
    )
    .query(({ ctx, input }) =>
      listPersistedCommercialMissions({
        tenantId: ctx.tenantId,
        limit: input.limit,
      })
    ),

  get: adminProcedure
    .input(z.object({ taskId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      getPersistedCommercialMission({
        tenantId: ctx.tenantId,
        taskId: input.taskId,
      })
    ),

  createFromPreview: adminProcedure
    .input(
      z.object({
        opportunityId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const opportunity = DEMO_OPPORTUNITIES.find(
        candidate => candidate.id === input.opportunityId
      );
      if (!opportunity) {
        throw new Error("Commercial opportunity not found");
      }

      const mission = buildCommercialMissionFromOpportunity(opportunity, {
        tenantId: ctx.tenantId,
      });
      return createPersistedCommercialMission({
        mission,
        actorId: ctx.user.openId,
      });
    }),

  transition: adminProcedure
    .input(
      z.object({
        taskId: z.number().int().positive(),
        toStatus: z.enum(COMMERCIAL_MISSION_STATUSES),
        actorType: actorTypeSchema,
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      transitionPersistedCommercialMission({
        tenantId: ctx.tenantId,
        taskId: input.taskId,
        toStatus: input.toStatus,
        actorType: input.actorType,
        actorId: ctx.user.openId,
        metadata: input.metadata,
      })
    ),
});
