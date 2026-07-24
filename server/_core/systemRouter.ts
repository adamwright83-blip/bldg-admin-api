import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { commercialMissionRouter } from "../commercialMissions/commercialMissionRouter";
import { territoryRouter } from "../territory/territoryRouter";
import { publicTerritoryRouter } from "../territory/publicPreviewRouter";
import { commercialProposalRouter } from "../commercialProposals/commercialProposalRouter";
import { churnRadarRouter } from "../churnRadar/churnRadarRouter";
import { commercialPipelineRouter } from "../commercialPipeline/commercialPipelineRouter";
import { saasRouter } from "../saas/saasRouter";
import { dayforgeDemoRouter } from "../dayforgeDemo/demoTenantRouter";
import { dayforgeTodayRouter } from "../dayforgeToday/dayforgeTodayRouter";
import { commercialCampaignRouter } from "../commercialCampaigns/commercialCampaignRouter";

export const systemRouter = router({
  commercialMission: commercialMissionRouter,
  commercialProposal: commercialProposalRouter,
  churnRadar: churnRadarRouter,
  commercialPipeline: commercialPipelineRouter,
  territory: territoryRouter,
  publicTerritory: publicTerritoryRouter,
  saas: saasRouter,
  dayforgeDemo: dayforgeDemoRouter,
  dayforgeToday: dayforgeTodayRouter,
  commercialCampaign: commercialCampaignRouter,
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),
  dayforgeDeployment: publicProcedure.query(() => ({
    ok: true,
    dayforgeStack: true,
    demoEnabled: process.env.DAYFORGE_DEMO_ENABLED === "true",
    commitSha:
      process.env.RAILWAY_GIT_COMMIT_SHA ??
      process.env.VERCEL_GIT_COMMIT_SHA ??
      "unknown",
  })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),
});
