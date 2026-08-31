import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { commercialMissionRouter } from "../commercialMissions/commercialMissionRouter";
import { voiceWalkInRouter } from "../commercialMissions/voiceWalkInRouter";
import { adaptiveSalesMeterRouter } from "../commercialMissions/adaptiveSalesMeterRouter";
import { territoryRouter } from "../territory/territoryRouter";
import { publicTerritoryRouter } from "../territory/publicPreviewRouter";
import { commercialProposalRouter } from "../commercialProposals/commercialProposalRouter";
import { churnRadarRouter } from "../churnRadar/churnRadarRouter";
import { commercialPipelineRouter } from "../commercialPipeline/commercialPipelineRouter";
import { saasRouter } from "../saas/saasRouter";
import { dayforgeDemoRouter } from "../dayforgeDemo/demoTenantRouter";
import { dayforgeTodayRouter } from "../dayforgeToday/dayforgeTodayRouter";
import { commercialCampaignRouter } from "../commercialCampaigns/commercialCampaignRouter";
import { dayforgeProofRouter } from "../dayforgeProof/dayforgeProofRouter";
import { customerAssetRouter } from "../customerAssets/customerAssetRouter";
import { fieldRouter } from "../field/fieldRouter";
import { businessWorldRouter } from "../businessWorld/businessWorldRouter";
import { growRouter } from "../grow/growRouter";
import { moneyRouter } from "../money/moneyRouter";
import { unloadRouter } from "../unload/unloadRouter";
import { armoryRouter } from "../armory/armoryRouter";
import { capabilityRouter } from "../capabilities/capabilityRouter";
import { teamRouter } from "../team/teamRouter";
import { openChannelRouter } from "../openChannel/openChannelRouter";
import { day1TenDoorsRouter } from "../openChannel/day1TenDoorsRouter";
import { externalOrderRouter } from "../externalOrders/externalOrderRouter";
import { impactSignalRouter } from "../impactSignals/impactSignalRouter";
import { driverGameWorldRouter } from "../driverGameWorld/driverGameWorldRouter";
import { salesIntelRouter } from "../salesIntel/salesIntelRouter";
import { goldlineEventRouter } from "../dayforgeEvents/goldlineEventRouter";
import { dayDirectorRouter } from "../dayDirector/dayDirectorRouter";
import { towerWarsRouter } from "../towerWars/towerWarsRouter";
import { geographicTruthRouter } from "../geography/geographicTruthRouter";
import { canonicalBuildingRouter } from "../canonicalBuilding/canonicalBuildingRouter";
import { googleRouter } from "../google/googleRouter";
import { goldlineWorldRouter } from "../goldlineWorld/goldlineWorldRouter";

export const systemRouter = router({
  commercialMission: commercialMissionRouter,
  voiceWalkIn: voiceWalkInRouter,
  adaptiveSalesMeter: adaptiveSalesMeterRouter,
  commercialProposal: commercialProposalRouter,
  churnRadar: churnRadarRouter,
  commercialPipeline: commercialPipelineRouter,
  territory: territoryRouter,
  publicTerritory: publicTerritoryRouter,
  saas: saasRouter,
  dayforgeDemo: dayforgeDemoRouter,
  dayforgeToday: dayforgeTodayRouter,
  commercialCampaign: commercialCampaignRouter,
  dayforgeProof: dayforgeProofRouter,
  customerAssets: customerAssetRouter,
  field: fieldRouter,
  businessWorld: businessWorldRouter,
  grow: growRouter,
  money: moneyRouter,
  unload: unloadRouter,
  armory: armoryRouter,
  capabilities: capabilityRouter,
  team: teamRouter,
  openChannel: openChannelRouter,
  day1TenDoors: day1TenDoorsRouter,
  externalOrders: externalOrderRouter,
  impactSignals: impactSignalRouter,
  driverGameWorld: driverGameWorldRouter,
  salesIntel: salesIntelRouter,
  goldlineEvents: goldlineEventRouter,
  dayDirector: dayDirectorRouter,
  towerWars: towerWarsRouter,
  geographicTruth: geographicTruthRouter,
  canonicalBuilding: canonicalBuildingRouter,
  google: googleRouter,
  goldlineWorld: goldlineWorldRouter,
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
