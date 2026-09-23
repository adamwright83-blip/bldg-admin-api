import { dayforgeTenantMemberProcedure, router } from "../../_core/trpc";
import { dayDirectorActorId } from "../../dayDirector/dayDirectorActor";
import { readCurrentDayLine } from "./currentDayLineService";

export const currentDayLineRouter = router({
  today: dayforgeTenantMemberProcedure.query(({ ctx }) =>
    readCurrentDayLine({
      tenantId: ctx.tenantId,
      operatorId: dayDirectorActorId(ctx),
    })
  ),
});
