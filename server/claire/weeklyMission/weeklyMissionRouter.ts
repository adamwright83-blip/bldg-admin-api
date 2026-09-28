/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { legacyDayforgeTenantMemberProcedure, router } from "../../_core/trpc";
import { remainingWeekHorizon } from "../../../shared/weeklyMissionReadiness";
import { requireCanonicalOperatorIdentityForUser } from "../../persistentOperator/identity";
import { recordPersistentOperatorDiagnosticEvent } from "../../persistentOperator/observability";
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

function assertTimeZone(zone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format();
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown time zone" });
  }
}

async function scope(
  ctx: {
    tenantId: string;
    user: {
      openId: string;
      id?: unknown;
      role: "admin" | "driver" | "user";
    };
  },
  zone: string
): Promise<WeeklyDriverScope> {
  assertTimeZone(zone);
  const identity = await requireCanonicalOperatorIdentityForUser({
    tenantId: ctx.tenantId,
    user: ctx.user,
    subsystem: "weekly_mission",
  });
  return {
    tenantId: identity.tenantId,
    operatorId: identity.weeklyOperatorId,
    dayDirectorActorId: identity.dayDirectorActorId,
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
      assertTimeZone(input.timeZone);
      const identity = await requireCanonicalOperatorIdentityForUser({
        tenantId: ctx.tenantId,
        user: ctx.user,
        subsystem: "weekly_mission.readiness",
      });
      const horizon = remainingWeekHorizon({
        businessDate: input.businessDate,
        localTime: "12:00",
      });
      const command = await loadDailyCommandWithWeeklyIntent({
        tenantId: identity.tenantId,
        actorId: identity.weeklyOperatorId,
        operatorUserId: identity.weeklyOperatorId,
        dayDirectorActorId: identity.dayDirectorActorId,
        businessDate: input.businessDate,
        timeZone: input.timeZone,
        weekStart: horizon.weekStart,
      });
      const readiness = command.weeklyIntentReadiness ?? [];
      await recordPersistentOperatorDiagnosticEvent({
        tenantId: identity.tenantId,
        canonicalOperatorId: identity.canonicalOperatorId,
        operatorUserId: identity.canonicalOpenId,
        subsystem: "weekly_mission.readiness",
        eventKind: "selection_attempt",
        reason: readiness.length === 0 ? "legitimate_no_work" : null,
      }).catch(() => undefined);
      return readiness;
    }),
  picture: legacyDayforgeTenantMemberProcedure
    .input(z.object({ timeZone }))
    .query(async ({ ctx, input }) =>
      loadWeeklyMissionPicture(await scope(ctx, input.timeZone))
    ),
  begin: legacyDayforgeTenantMemberProcedure
    .input(z.object({ timeZone }))
    .mutation(async ({ ctx, input }) =>
      beginWeeklyMission(await scope(ctx, input.timeZone))
    ),
  decline: legacyDayforgeTenantMemberProcedure
    .input(z.object({ timeZone }))
    .mutation(async ({ ctx, input }) =>
      declineWeeklyMission(await scope(ctx, input.timeZone))
    ),
  adjust: legacyDayforgeTenantMemberProcedure
    .input(z.object({ timeZone }))
    .mutation(async ({ ctx, input }) =>
      adjustWeeklyMission(await scope(ctx, input.timeZone))
    ),
  reply: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        timeZone,
        utterance: z.string().trim().min(1).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) =>
      replyWeeklyMission(
        await scope(ctx, input.timeZone),
        input.utterance
      )
    ),
});
