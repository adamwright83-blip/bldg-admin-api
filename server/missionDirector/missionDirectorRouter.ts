import { z } from "zod";
import { dayforgeTenantMemberProcedure, router } from "../_core/trpc";
import { listPlanRevisions, planForDate, recordPlanUsage } from "./missionDirectorService";
import { dayDirectorActorId } from "../dayDirector/dayDirectorActor";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const missionDirectorRouter = router({
  planForDate: dayforgeTenantMemberProcedure
    .input(z.object({ businessDate: date }))
    .query(({ ctx, input }) =>
      planForDate({
        tenantId: ctx.tenantId,
        operatorId: dayDirectorActorId(ctx),
        ...input,
      })
    ),
  revisions: dayforgeTenantMemberProcedure
    .input(z.object({ businessDate: date }))
    .query(({ ctx, input }) =>
      listPlanRevisions({
        tenantId: ctx.tenantId,
        operatorId: dayDirectorActorId(ctx),
        ...input,
      })
    ),
  recordUsage: dayforgeTenantMemberProcedure
    .input(
      z.object({
        businessDate: date,
        usageOutcome: z.enum(["used", "ignored", "wrong_mission"]),
      })
    )
    .mutation(({ ctx, input }) =>
      recordPlanUsage({
        tenantId: ctx.tenantId,
        operatorId: dayDirectorActorId(ctx),
        ...input,
      })
    ),
});
