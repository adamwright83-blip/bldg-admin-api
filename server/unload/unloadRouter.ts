import { z } from "zod";
import { dayforgeTenantMemberProcedure, router } from "../_core/trpc";
import { resolveDay } from "./unloadService";

export const unloadRouter = router({
  resolveDay: dayforgeTenantMemberProcedure.input(z.object({ businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), requestId: z.string().uuid() })).mutation(({ ctx, input }) => resolveDay({ ...input, tenantId: ctx.tenantId, actorId: ctx.user.openId })),
});
