import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  getStrategyActiveCustomers,
  getStrategyGrowthMetrics,
} from "./growthMetrics";

export const strategyRouter = router({
  activeCustomers: adminProcedure.query(async ({ ctx }) => {
    return getStrategyActiveCustomers({ tenantId: ctx.tenantId });
  }),

  growthMetrics: adminProcedure
    .input(
      z.object({
        startYmd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endYmd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        inactivityDays: z.number().int().positive().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return getStrategyGrowthMetrics({
        tenantId: ctx.tenantId,
        period: {
          startYmd: input.startYmd,
          endYmd: input.endYmd,
        },
        inactivityDays: input.inactivityDays,
      });
    }),
});
