/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { legacyDayforgeSaasTenants } from "../../../drizzle/schema";
import { legacyDayforgeTenantMemberProcedure, router } from "../../_core/trpc";
import { getDashboardTimeZone } from "../../dashboardZoned";
import { getDb } from "../../db";
import { isLegacyDayforgeTenant } from "../../saas/tenantAccess";
import { requireCanonicalOperatorIdentityForUser } from "../../persistentOperator/identity";
import { listPlanRevisions, planForDate, recordPlanUsage } from "./missionDirectorService";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function resolveMissionDirectorBusinessTimeZone(
  tenantId: string
): Promise<string> {
  const db = await getDb();
  if (db) {
    const [tenant] = await db
      .select({ timeZone: legacyDayforgeSaasTenants.timeZone })
      .from(legacyDayforgeSaasTenants)
      .where(eq(legacyDayforgeSaasTenants.id, tenantId))
      .limit(1);
    const configured = tenant?.timeZone?.trim();
    if (configured) return configured;
  }

  // Legacy Laundry Farm tenants predate the SaaS tenant-config row. Their
  // business timezone remains the explicitly configured dashboard timezone.
  if (isLegacyDayforgeTenant(tenantId)) return getDashboardTimeZone();

  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "Tenant business timezone is unavailable.",
  });
}

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
    .query(async ({ ctx, input }) => {
      const identity = await missionDirectorIdentity(ctx, "mission_director.plan");
      const timeZone = await resolveMissionDirectorBusinessTimeZone(identity.tenantId);
      return planForDate({
        tenantId: identity.tenantId,
        operatorId: identity.dayDirectorActorId,
        operatorIds: identity.dayDirectorActorIds,
        operatorUserId: identity.canonicalOpenId,
        operatorUserIds: identity.aliases.map(alias => alias.openId),
        timeZone,
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
