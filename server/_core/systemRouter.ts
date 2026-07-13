import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { commercialMissionRouter } from "../commercialMissions/commercialMissionRouter";
import { territoryRouter } from "../territory/territoryRouter";
import { commercialProposalRouter } from "../commercialProposals/commercialProposalRouter";

export const systemRouter = router({
  commercialMission: commercialMissionRouter,
  commercialProposal: commercialProposalRouter,
  territory: territoryRouter,
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
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
