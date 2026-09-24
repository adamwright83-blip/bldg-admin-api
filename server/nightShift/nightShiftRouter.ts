/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { z } from "zod";
import { legacyLegacyDayforgeTenantOperatorProcedure, router } from "../_core/trpc";
import {
  commitAuthoredDayForOperation,
  getAuthoredDayForDate,
  getOrAuthorTodayAuthoredDay,
  isNightShiftEnabled,
  runNightShiftForBusinessDate,
} from "./authoredDayService";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const nightShiftRouter = router({
  enabled: legacyLegacyDayforgeTenantOperatorProcedure.query(() => ({
    enabled: isNightShiftEnabled(),
  })),
  today: legacyLegacyDayforgeTenantOperatorProcedure.query(({ ctx }) =>
    getOrAuthorTodayAuthoredDay({
      tenantId: ctx.tenantId,
      operatorId: ctx.user.openId,
      userId: String(ctx.user.id),
    })
  ),
  forDate: legacyLegacyDayforgeTenantOperatorProcedure
    .input(z.object({ businessDate: date }))
    .query(({ ctx, input }) =>
      getAuthoredDayForDate({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        businessDate: input.businessDate,
      })
    ),
  run: legacyLegacyDayforgeTenantOperatorProcedure
    .input(z.object({ businessDate: date }))
    .mutation(({ ctx, input }) =>
      runNightShiftForBusinessDate({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        userId: String(ctx.user.id),
        businessDate: input.businessDate,
      })
    ),
  commitForOperation: legacyLegacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        businessDate: date,
        operationStableKey: z.string().min(1).max(191),
      })
    )
    .mutation(({ ctx, input }) =>
      commitAuthoredDayForOperation({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        businessDate: input.businessDate,
        operationStableKey: input.operationStableKey,
      })
    ),
});
