import { dayforgeMissionFieldProcedure, router } from "../_core/trpc";
import { listDayforgeToday } from "./dayforgeTodayService";
import { z } from "zod";
import { COMMERCIAL_FOLLOW_UP_OUTCOMES } from "@shared/commercialPipeline";
import { completeCommercialFollowUp, rescheduleCommercialFollowUp } from "../commercialPipeline/commercialPipelineService";

export const dayforgeTodayRouter = router({
  list: dayforgeMissionFieldProcedure.query(({ ctx }) =>
    listDayforgeToday({
      tenantId: ctx.tenantId,
      userId: ctx.user.openId,
      includeAllAssignees: ctx.dayforgeMembership.role !== "field",
    })
  ),
  completeFollowUp: dayforgeMissionFieldProcedure
    .input(
      z
        .object({
          pipelineId: z.number().int().positive(),
          followUpId: z.string().uuid(),
          requestId: z.string().uuid(),
          outcome: z.enum(COMMERCIAL_FOLLOW_UP_OUTCOMES),
          notes: z.string().trim().min(1).max(20_000),
          nextFollowUpAt: z.coerce.date().optional(),
        })
        .superRefine((value, ctx) => {
          if (value.nextFollowUpAt && value.nextFollowUpAt.getTime() <= Date.now()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Next follow-up time must be in the future",
            });
          }
          if (
            (value.outcome === "won" || value.outcome === "lost") &&
            value.nextFollowUpAt
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Terminal follow-up outcomes cannot schedule another follow-up",
            });
          }
        })
    )
    .mutation(({ ctx, input }) =>
      completeCommercialFollowUp({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),
  rescheduleFollowUp: dayforgeMissionFieldProcedure.input(z.object({
    pipelineId: z.number().int().positive(), followUpId: z.string().uuid(), requestId: z.string().uuid(),
    dueAt: z.coerce.date().refine(value => value.getTime() > Date.now(), "New follow-up time must be in the future"),
  })).mutation(({ ctx, input }) => rescheduleCommercialFollowUp({
    ...input, tenantId: ctx.tenantId, actorId: ctx.user.openId,
  })),
});
