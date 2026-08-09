import { z } from "zod";
import { dayforgeTenantOperatorProcedure, router } from "../_core/trpc";
import { getMoneyProjection } from "./moneyProjectionService";
import { evaluateMoneyScenario } from "./scenarioService";

export const moneyRouter = router({
  get: dayforgeTenantOperatorProcedure.query(({ ctx }) => getMoneyProjection({ tenantId: ctx.tenantId })),
  scenario: dayforgeTenantOperatorProcedure.input(z.object({
    scenarioType: z.enum(["first_hire", "second_vehicle", "equipment", "territory", "campaign", "custom"]),
    availableCashCents: z.number().int().nullable(), reserveRequirementCents: z.number().int().nonnegative().nullable(), requiredCashCents: z.number().int().nonnegative(), recurringCostMonthlyCents: z.number().int().nonnegative(),
    capacityChangeUnits: z.number().nullable(), expectedMonthlyRevenueLowCents: z.number().int().nonnegative().nullable(), expectedMonthlyRevenueHighCents: z.number().int().nonnegative().nullable(),
  })).query(({ input }) => evaluateMoneyScenario(input)),
});
