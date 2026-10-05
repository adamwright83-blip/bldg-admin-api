import { z } from "zod";
import {
  adminProcedure,
  legacyDayforgeTenantAdminProcedure,
  legacyDayforgeTenantOperatorProcedure,
  router,
} from "../_core/trpc";
import {
  geocodePendingLocations,
  getGeographicTruth,
} from "./geographicTruthService";

export const geographicTruthRouter = router({
  /** Tenant-scoped atlas for the commercial JOYSTICK world. Never accepts a target tenant. */
  myAtlas: legacyDayforgeTenantOperatorProcedure.query(({ ctx }) =>
    getGeographicTruth({ tenantId: ctx.tenantId })
  ),
  /** Platform-admin atlas retains explicit cross-tenant inspection for support/operations. */
  atlas: adminProcedure
    .input(z.object({ targetTenantId: z.string().trim().min(1).optional() }).optional())
    .query(({ ctx, input }) =>
      getGeographicTruth({ tenantId: input?.targetTenantId || ctx.tenantId })
    ),
  geocodePending: legacyDayforgeTenantAdminProcedure
    .input(
      z
        .object({ batchSize: z.number().int().min(1).max(50).default(20) })
        .optional()
    )
    .mutation(({ ctx, input }) =>
      geocodePendingLocations({
        tenantId: ctx.tenantId,
        batchSize: input?.batchSize,
      })
    ),
});
