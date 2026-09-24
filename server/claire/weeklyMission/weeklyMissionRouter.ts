/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { legacyLegacyDayforgeTenantMemberProcedure, router } from "../../_core/trpc";
import { dayDirectorActorId } from "../../dayDirector/dayDirectorActor";
import {
  adjustWeeklyMission,
  beginWeeklyMission,
  declineWeeklyMission,
  loadWeeklyMissionPicture,
  replyWeeklyMission,
  type WeeklyDriverScope,
} from "./driver";

const timeZone = z.string().trim().min(1).max(80);

function scope(ctx: { tenantId: string; user: { openId: string; id?: unknown } }, zone: string): WeeklyDriverScope {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format();
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown time zone" });
  }
  return {
    tenantId: ctx.tenantId,
    operatorId: ctx.user.openId,
    dayDirectorActorId: dayDirectorActorId(ctx),
    timeZone: zone,
  };
}

export const weeklyMissionRouter = router({
  picture: legacyLegacyDayforgeTenantMemberProcedure.input(z.object({ timeZone })).query(({ ctx, input }) =>
    loadWeeklyMissionPicture(scope(ctx, input.timeZone))
  ),
  begin: legacyLegacyDayforgeTenantMemberProcedure
    .input(z.object({ timeZone }))
    .mutation(({ ctx, input }) => beginWeeklyMission(scope(ctx, input.timeZone))),
  decline: legacyLegacyDayforgeTenantMemberProcedure
    .input(z.object({ timeZone }))
    .mutation(({ ctx, input }) => declineWeeklyMission(scope(ctx, input.timeZone))),
  adjust: legacyLegacyDayforgeTenantMemberProcedure
    .input(z.object({ timeZone }))
    .mutation(({ ctx, input }) => adjustWeeklyMission(scope(ctx, input.timeZone))),
  reply: legacyLegacyDayforgeTenantMemberProcedure
    .input(z.object({ timeZone, utterance: z.string().trim().min(1).max(2000) }))
    .mutation(({ ctx, input }) => replyWeeklyMission(scope(ctx, input.timeZone), input.utterance)),
});
