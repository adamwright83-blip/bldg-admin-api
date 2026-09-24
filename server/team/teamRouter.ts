/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { z } from "zod";
import { legacyDayforgeTenantAdminProcedure, legacyDayforgeTenantOperatorProcedure, router } from "../_core/trpc";
import { getTeamProjection, saveEmployeeOperatingProfile } from "./teamService";

export const teamRouter = router({
  get: legacyDayforgeTenantOperatorProcedure.query(({ ctx }) => getTeamProjection({ tenantId: ctx.tenantId })),
  saveProfile: legacyDayforgeTenantAdminProcedure.input(z.object({
    userOpenId: z.string().trim().min(1).max(64), displayName: z.string().trim().min(1).max(255), employmentStatus: z.enum(["active", "leave", "ended"]),
    skills: z.array(z.string().trim().min(1).max(96)).max(50), weeklyCapacityUnits: z.number().int().nonnegative().max(1_000_000).nullable(), requestId: z.string().uuid(),
  })).mutation(({ ctx, input }) => saveEmployeeOperatingProfile({ ...input, tenantId: ctx.tenantId, actorId: ctx.user.openId })),
});
