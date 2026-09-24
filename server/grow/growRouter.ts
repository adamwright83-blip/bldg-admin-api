/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { z } from "zod";
import { legacyDayforgeTenantOperatorProcedure, router } from "../_core/trpc";
import { getGrowProjection, recordGrowMoveDecision } from "./growService";

export const growRouter = router({
  get: legacyDayforgeTenantOperatorProcedure.query(({ ctx }) => getGrowProjection({ tenantId: ctx.tenantId })),
  decide: legacyDayforgeTenantOperatorProcedure.input(z.object({
    moveId: z.string().min(1).max(191), sourceType: z.string().min(1).max(64), sourceId: z.string().min(1).max(191),
    decision: z.enum(["accepted", "dismissed", "completed"]), requestId: z.string().uuid(),
  })).mutation(({ ctx, input }) => recordGrowMoveDecision({ ...input, tenantId: ctx.tenantId, actorId: ctx.user.openId })),
});
