import { z } from "zod";
import { dayforgeTenantOperatorProcedure, router } from "../_core/trpc";
import {
  commitAuthoredDayForOperation,
  getAuthoredDayForDate,
  getOrAuthorTodayAuthoredDay,
  isNightShiftEnabled,
  runNightShiftForBusinessDate,
} from "./authoredDayService";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const nightShiftRouter = router({
  enabled: dayforgeTenantOperatorProcedure.query(() => ({
    enabled: isNightShiftEnabled(),
  })),
  today: dayforgeTenantOperatorProcedure.query(({ ctx }) =>
    getOrAuthorTodayAuthoredDay({
      tenantId: ctx.tenantId,
      operatorId: ctx.user.openId,
      userId: String(ctx.user.id),
    })
  ),
  forDate: dayforgeTenantOperatorProcedure
    .input(z.object({ businessDate: date }))
    .query(({ ctx, input }) =>
      getAuthoredDayForDate({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        businessDate: input.businessDate,
      })
    ),
  run: dayforgeTenantOperatorProcedure
    .input(z.object({ businessDate: date }))
    .mutation(({ ctx, input }) =>
      runNightShiftForBusinessDate({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        userId: String(ctx.user.id),
        businessDate: input.businessDate,
      })
    ),
  commitForOperation: dayforgeTenantOperatorProcedure
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
