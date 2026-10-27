import { z } from "zod";
import { legacyDayforgeTenantOperatorProcedure, router } from "../_core/trpc";
import { TOWER_DESK_BUILDINGS } from "../../shared/towerDesk";
import { readTowerDesk } from "./towerDeskService";

/** The front desk under a tower: read-only, the signed-in tenant's own building, never a target tenant. */
export const towerDeskRouter = router({
  read: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ buildingId: z.enum(TOWER_DESK_BUILDINGS) }))
    .query(({ ctx, input }) => readTowerDesk({ tenantId: ctx.tenantId, buildingId: input.buildingId })),
});
