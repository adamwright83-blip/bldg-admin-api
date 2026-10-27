import { z } from "zod";
import { legacyDayforgeTenantOperatorProcedure, router } from "../_core/trpc";
import { GOAL_MAX_CENTS, GOAL_MIN_CENTS, TOWER_DESK_BUILDINGS } from "../../shared/towerDesk";
import { readTowerDesk, saveTowerDeskGoal } from "./towerDeskService";

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
});
