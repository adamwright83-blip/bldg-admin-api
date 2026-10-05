/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { z } from "zod";
import { legacyDayforgeTenantMemberProcedure, router } from "../_core/trpc";
import { requireCanonicalOperatorIdentityForUser } from "../persistentOperator/identity";
import { listPlanRevisions, planForDate, recordPlanUsage } from "./missionDirectorService";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function missionDirectorIdentity(ctx: {
  tenantId: string;
  user: {
    id?: unknown;
    openId: string;
    role: "admin" | "driver" | "user";
  };
}, subsystem: string) {
  return requireCanonicalOperatorIdentityForUser({
    tenantId: ctx.tenantId,
    user: ctx.user,
    subsystem,
  });
}

export const missionDirectorRouter = router({
  planForDate: legacyDayforgeTenantMemberProcedure
    .input(z.object({ businessDate: date }))
    .mutation(async ({ ctx, input }) => {
      const identity = await missionDirectorIdentity(ctx, "mission_director.plan");
      return planForDate({
        tenantId: identity.tenantId,
        operatorId: identity.dayDirectorActorId,
        operatorIds: identity.dayDirectorActorIds,
        operatorUserId: identity.canonicalOpenId,
        operatorUserIds: identity.aliases.map(alias => alias.openId),
        ...input,
      });
    }),
  revisions: legacyDayforgeTenantMemberProcedure
    .input(z.object({ businessDate: date }))
    .query(async ({ ctx, input }) => {
      const identity = await missionDirectorIdentity(ctx, "mission_director.revisions");
      return listPlanRevisions({
        tenantId: identity.tenantId,
        operatorId: identity.dayDirectorActorId,
        operatorIds: identity.dayDirectorActorIds,
        ...input,
      });
    }),
  recordUsage: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        businessDate: date,
        usageOutcome: z.enum(["used", "ignored", "wrong_mission"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const identity = await missionDirectorIdentity(ctx, "mission_director.usage");
      return recordPlanUsage({
        tenantId: identity.tenantId,
        operatorId: identity.dayDirectorActorId,
        operatorIds: identity.dayDirectorActorIds,
        ...input,
      });
    }),
});
