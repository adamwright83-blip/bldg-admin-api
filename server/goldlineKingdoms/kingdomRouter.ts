import { z } from "zod";
import { adminProcedure, dayforgeTenantMemberProcedure, router } from "../_core/trpc";
import {
  getKingdom,
  listKingdoms,
  selectKingdomCampaign,
  setKingdomCompanion,
  setKingdomStatus,
} from "./kingdomService";
import { seedGoldlineKingdoms } from "./seedKingdoms";
import { LANTERN_CITY_STATUSES } from "./kingdomTypes";

export const kingdomRouter = router({
  list: dayforgeTenantMemberProcedure.query(({ ctx }) =>
    listKingdoms({ tenantId: ctx.tenantId })
  ),
  get: dayforgeTenantMemberProcedure
    .input(z.object({ kingdomId: z.string() }))
    .query(({ ctx, input }) => getKingdom({ tenantId: ctx.tenantId, ...input })),
  seedDefaults: adminProcedure.mutation(async ({ ctx }) => {
    await seedGoldlineKingdoms(ctx.tenantId ?? "default");
    return listKingdoms({ tenantId: ctx.tenantId ?? "default" });
  }),
  selectCampaign: adminProcedure
    .input(
      z.object({
        kingdomId: z.string(),
        realCampaignId: z.string(),
        capabilityRequirement: z.string().min(1).max(512),
      })
    )
    .mutation(({ ctx, input }) =>
      selectKingdomCampaign({ tenantId: ctx.tenantId ?? "default", ...input })
    ),
  setCompanion: adminProcedure
    .input(z.object({ kingdomId: z.string(), companionEarnedId: z.string() }))
    .mutation(({ ctx, input }) =>
      setKingdomCompanion({ tenantId: ctx.tenantId ?? "default", ...input })
    ),
  setStatus: adminProcedure
    .input(
      z.object({
        kingdomId: z.string(),
        lanternCityStatus: z.enum(LANTERN_CITY_STATUSES),
      })
    )
    .mutation(({ ctx, input }) =>
      setKingdomStatus({ tenantId: ctx.tenantId ?? "default", ...input })
    ),
});
