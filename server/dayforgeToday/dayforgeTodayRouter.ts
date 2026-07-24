import { dayforgeMissionFieldProcedure, router } from "../_core/trpc";
import { listDayforgeToday } from "./dayforgeTodayService";
import { z } from "zod";
import { completeCommercialFollowUp, rescheduleCommercialFollowUp } from "../commercialPipeline/commercialPipelineService";

export const dayforgeTodayRouter = router({
  list: dayforgeMissionFieldProcedure.query(({ ctx }) =>
    listDayforgeToday({
      tenantId: ctx.tenantId,
      userId: ctx.user.openId,
      includeAllAssignees: ctx.dayforgeMembership.role !== "field",
    })
  ),
  completeFollowUp: dayforgeMissionFieldProcedure.input(z.object({
    pipelineId: z.number().int().positive(), followUpId: z.string().uuid(), requestId: z.string().uuid(),
  })).mutation(({ ctx, input }) => completeCommercialFollowUp({
    ...input, tenantId: ctx.tenantId, actorId: ctx.user.openId,
  })),
  rescheduleFollowUp: dayforgeMissionFieldProcedure.input(z.object({
    pipelineId: z.number().int().positive(), followUpId: z.string().uuid(), requestId: z.string().uuid(),
    dueAt: z.coerce.date().refine(value => value.getTime() > Date.now(), "New follow-up time must be in the future"),
  })).mutation(({ ctx, input }) => rescheduleCommercialFollowUp({
    ...input, tenantId: ctx.tenantId, actorId: ctx.user.openId,
  })),
});
