/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
/**
 * Lantern City router. Read-only: there is no mutation here and there will
 * not be one. Lantern City projects business records; it never writes them.
 */
import { legacyDayforgeTenantMemberProcedure, router } from "../_core/trpc";
import { dayDirectorActorId } from "../dayDirector/dayDirectorActor";
import { loadLanternObjectiveMarks } from "./objectiveMarksService";

export function lanternObjectiveMarksScope(ctx: {
  tenantId: string;
  user: { id?: unknown; openId: string };
}) {
  return {
    tenantId: ctx.tenantId,
    operatorId: dayDirectorActorId(ctx),
    viewerOpenId: ctx.user.openId,
  };
}

export const lanternCityRouter = router({
  objectiveMarks: legacyDayforgeTenantMemberProcedure.query(({ ctx }) =>
    loadLanternObjectiveMarks(lanternObjectiveMarksScope(ctx))
  ),
});
