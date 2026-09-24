/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { z } from "zod";
import { legacyDayforgeTenantMemberProcedure, router } from "../_core/trpc";
import { resolveDay } from "./unloadService";

export const unloadRouter = router({
  resolveDay: legacyDayforgeTenantMemberProcedure.input(z.object({ businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), requestId: z.string().uuid() })).mutation(({ ctx, input }) => resolveDay({ ...input, tenantId: ctx.tenantId, actorId: ctx.user.openId })),
});
