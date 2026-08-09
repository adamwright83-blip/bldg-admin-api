import { z } from "zod";
import { dayforgeTenantOperatorProcedure, router } from "../_core/trpc";
import { getGrowProjection, recordGrowMoveDecision } from "./growService";

export const growRouter = router({
  get: dayforgeTenantOperatorProcedure.query(({ ctx }) => getGrowProjection({ tenantId: ctx.tenantId })),
  decide: dayforgeTenantOperatorProcedure.input(z.object({
    moveId: z.string().min(1).max(191), sourceType: z.string().min(1).max(64), sourceId: z.string().min(1).max(191),
    decision: z.enum(["accepted", "dismissed", "completed"]), requestId: z.string().uuid(),
  })).mutation(({ ctx, input }) => recordGrowMoveDecision({ ...input, tenantId: ctx.tenantId, actorId: ctx.user.openId })),
});
