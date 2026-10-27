import { z } from "zod";
import { legacyDayforgeTenantOperatorProcedure, router } from "../_core/trpc";
import { deskConfigSchema, GOAL_MAX_CENTS, GOAL_MIN_CENTS, TOWER_DESK_BUILDINGS } from "../../shared/towerDesk";
import { addTowerDeskContractPayment, readTowerDesk, removeTowerDeskContractPayment, saveTowerDeskConfig, saveTowerDeskGoal } from "./towerDeskService";

const actorOf = (ctx: { user?: { openId?: string | null } | null }) => ctx.user?.openId ?? "owner";

/** The front desk under a tower: the signed-in tenant's own building, never a target tenant. */
export const towerDeskRouter = router({
  read: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ buildingId: z.enum(TOWER_DESK_BUILDINGS) }))
    .query(({ ctx, input }) => readTowerDesk({ tenantId: ctx.tenantId, buildingId: input.buildingId })),
  /** The operator sets the elevator's penthouse themselves; null clears it back to "Goal needed" (or the default). */
  setGoal: legacyDayforgeTenantOperatorProcedure
    .input(z.object({
      buildingId: z.enum(TOWER_DESK_BUILDINGS),
      monthlyGoalCents: z.number().int().min(GOAL_MIN_CENTS).max(GOAL_MAX_CENTS).nullable(),
    }))
    .mutation(({ ctx, input }) => saveTowerDeskGoal({ ...input, tenantId: ctx.tenantId, actor: actorOf(ctx) })),
  /** Building facts: floors and doors per tower, numbering, quiet days, the building contract. The form sends everything it shows. */
  saveConfig: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ buildingId: z.enum(TOWER_DESK_BUILDINGS), config: deskConfigSchema }))
    .mutation(({ ctx, input }) => saveTowerDeskConfig({ ...input, tenantId: ctx.tenantId, actor: actorOf(ctx) })),
  /** Log a payment received on the building contract. Dates are the day it was paid, not in the future. */
  addContractPayment: legacyDayforgeTenantOperatorProcedure
    .input(z.object({
      buildingId: z.enum(TOWER_DESK_BUILDINGS),
      amountCents: z.number().int().min(1).max(GOAL_MAX_CENTS),
      paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && Date.parse(`${d}T00:00:00Z`) <= Date.now() + 86_400_000, "Pick a day that has already happened."),
      note: z.string().trim().max(200).default(""),
    }))
    .mutation(({ ctx, input }) => addTowerDeskContractPayment({ ...input, tenantId: ctx.tenantId, actor: actorOf(ctx) })),
  removeContractPayment: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ buildingId: z.enum(TOWER_DESK_BUILDINGS), id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => removeTowerDeskContractPayment({ ...input, tenantId: ctx.tenantId })),
});
