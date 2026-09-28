/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { legacyDayforgeTenantMemberProcedure, router } from "../../_core/trpc";
import { dayDirectorActorId } from "../../dayDirector/dayDirectorActor";
import { remainingWeekHorizon } from "../../../shared/weeklyMissionReadiness";
import { loadDailyCommandWithWeeklyIntent } from "./dailyCommandIntent";
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
  dailyReadiness: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        timeZone,
      })
    )
    .query(async ({ ctx, input }) => {
      const horizon = remainingWeekHorizon({
        businessDate: input.businessDate,
        localTime: "12:00",
      });
      const command = await loadDailyCommandWithWeeklyIntent({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        operatorUserId: ctx.user.openId,
        dayDirectorActorId: dayDirectorActorId(ctx),
        businessDate: input.businessDate,
        timeZone: input.timeZone,
        weekStart: horizon.weekStart,
      });
      return command.weeklyIntentReadiness ?? [];
    }),
  picture: legacyDayforgeTenantMemberProcedure.input(z.object({ timeZone })).query(({ ctx, input }) =>
    loadWeeklyMissionPicture(scope(ctx, input.timeZone))
  ),
  begin: legacyDayforgeTenantMemberProcedure
    .input(z.object({ timeZone }))
    .mutation(({ ctx, input }) => beginWeeklyMission(scope(ctx, input.timeZone))),
  decline: legacyDayforgeTenantMemberProcedure
    .input(z.object({ timeZone }))
    .mutation(({ ctx, input }) => declineWeeklyMission(scope(ctx, input.timeZone))),
  adjust: legacyDayforgeTenantMemberProcedure
    .input(z.object({ timeZone }))
    .mutation(({ ctx, input }) => adjustWeeklyMission(scope(ctx, input.timeZone))),
  reply: legacyDayforgeTenantMemberProcedure
    .input(z.object({ timeZone, utterance: z.string().trim().min(1).max(2000) }))
    .mutation(({ ctx, input }) => replyWeeklyMission(scope(ctx, input.timeZone), input.utterance)),
});
