import { z } from "zod";
import { dayforgeTenantMemberProcedure, router } from "../_core/trpc";
import { readGoldlineProgression } from "./progressionService";

/**
 * Read-only progression contract. No mutation accepts resolved, rookOwned,
 * or kingdomComplete. Tenancy and operator id come from the session.
 */
export const progressionRouter = router({
  get: dayforgeTenantMemberProcedure
    .input(z.object({}).strict())
    .query(({ ctx }) =>
      readGoldlineProgression({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        capabilityOperatorId: String(ctx.user.id),
      })
    ),
});
