/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { legacyDayforgeTenantMemberProcedure, router } from "../../_core/trpc";
import { dayDirectorActorId } from "../../dayDirector/dayDirectorActor";
import { readCurrentDayLine } from "./currentDayLineService";

export const currentDayLineRouter = router({
  today: legacyDayforgeTenantMemberProcedure.query(({ ctx }) =>
    readCurrentDayLine({
      tenantId: ctx.tenantId,
      operatorId: dayDirectorActorId(ctx),
    })
  ),
});
