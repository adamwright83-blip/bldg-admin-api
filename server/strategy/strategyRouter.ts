import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  getStrategyActiveCustomers,
  getStrategyGrowthMetrics,
} from "./growthMetrics";
import {
  getActivePlaygroundRules,
  setPlaygroundRules,
} from "./playgroundRulesService";
import {
  getMonthToDateSpend,
} from "./spendClearance";
import { getActiveMacroGoal } from "../claire/macroGoalService";

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

  playground: router({
    get: adminProcedure.query(async ({ ctx }) => {
      const rules = await getActivePlaygroundRules(ctx.tenantId);
      const macroGoal = await getActiveMacroGoal({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user?.openId ?? "owner",
      });
      const spend = await getMonthToDateSpend(ctx.tenantId);
      return {
        rules,
        macroGoal,
        spend,
      };
    }),

    set: adminProcedure
      .input(
        z.object({
          monthlySpendCeilingCents: z.number().int().nonnegative(),
          currency: z.string().max(8).optional(),
          approvalCategories: z.array(z.string()).optional(),
          source: z.enum(["operator_attested", "admin"]).optional(),
          macroGoalId: z.string().nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return setPlaygroundRules({
          tenantId: ctx.tenantId,
          monthlySpendCeilingCents: input.monthlySpendCeilingCents,
          currency: input.currency,
          approvalCategories: input.approvalCategories,
          source: input.source,
          macroGoalId: input.macroGoalId,
        });
      }),
  }),

  spend: router({
    monthToDate: adminProcedure
      .input(
        z.object({
          businessMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        }).optional()
      )
      .query(async ({ ctx, input }) => {
        return getMonthToDateSpend(ctx.tenantId, input?.businessMonth);
      }),
  }),
});
