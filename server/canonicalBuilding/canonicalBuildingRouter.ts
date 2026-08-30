import { adminProcedure, router } from "../_core/trpc";
import { getCanonicalBuildingWorld } from "./canonicalBuildingService";

export const canonicalBuildingRouter = router({
  /**
   * One building traced through the whole chain: prospect -> commercial
   * mission -> account_won -> same canonical object -> resident penetration ->
   * real orders -> Tower Wars -> permanent history.
   */
  world: adminProcedure.query(({ ctx }) =>
    getCanonicalBuildingWorld({ tenantId: ctx.tenantId })
  ),
});
