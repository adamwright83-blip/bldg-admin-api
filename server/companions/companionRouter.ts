import { z } from "zod";
import { adminProcedure, dayforgeTenantMemberProcedure, router } from "../_core/trpc";
import {
  earnCompanion,
  getCompanion,
  isCompanionEarned,
  listCompanions,
  listUnlocks,
  seedCompanionRoster,
} from "./companionService";

export const companionRouter = router({
  roster: dayforgeTenantMemberProcedure.query(({ ctx }) =>
    listCompanions({ tenantId: ctx.tenantId })
  ),
  get: dayforgeTenantMemberProcedure
    .input(z.object({ companionId: z.string() }))
    .query(({ ctx, input }) => getCompanion({ tenantId: ctx.tenantId, ...input })),
  seedDefaults: adminProcedure.mutation(async ({ ctx }) =>
    seedCompanionRoster({ tenantId: ctx.tenantId ?? "default" })
  ),
  myUnlocks: dayforgeTenantMemberProcedure.query(({ ctx }) =>
    listUnlocks({ tenantId: ctx.tenantId, operatorId: String(ctx.user.id) })
  ),
  isEarned: dayforgeTenantMemberProcedure
    .input(z.object({ companionId: z.string() }))
    .query(({ ctx, input }) =>
      isCompanionEarned({
        tenantId: ctx.tenantId,
        operatorId: String(ctx.user.id),
        ...input,
      })
    ),
  earn: dayforgeTenantMemberProcedure
    .input(
      z.object({
        companionId: z.string(),
        kingdomId: z.string(),
        campaignId: z.string(),
        evidenceOpsTaskId: z.number().int().positive(),
      })
    )
    .mutation(({ ctx, input }) =>
      earnCompanion({
        tenantId: ctx.tenantId,
        operatorId: String(ctx.user.id),
        ...input,
      })
    ),
});
