/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { z } from "zod";
import { legacyDayforgeTenantMemberProcedure, router } from "../_core/trpc";
import { listPlanRevisions, planForDate, recordPlanUsage } from "./missionDirectorService";
import { dayDirectorActorId } from "../dayDirector/dayDirectorActor";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const missionDirectorRouter = router({
  planForDate: legacyDayforgeTenantMemberProcedure
    .input(z.object({ businessDate: date }))
    .query(({ ctx, input }) =>
      planForDate({
        tenantId: ctx.tenantId,
        operatorId: dayDirectorActorId(ctx),
        ...input,
      })
    ),
  revisions: legacyDayforgeTenantMemberProcedure
    .input(z.object({ businessDate: date }))
    .query(({ ctx, input }) =>
      listPlanRevisions({
        tenantId: ctx.tenantId,
        operatorId: dayDirectorActorId(ctx),
        ...input,
      })
    ),
  recordUsage: legacyDayforgeTenantMemberProcedure
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
