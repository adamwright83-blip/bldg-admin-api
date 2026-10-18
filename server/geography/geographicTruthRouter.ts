import { z } from "zod";
import {
  adminProcedure,
  legacyAdminRoleProcedure,
  legacyDayforgeTenantOperatorProcedure,
  router,
} from "../_core/trpc";
import {
  geocodePendingLocations,
  getGeographicTruth,
} from "./geographicTruthService";
import { readLanternTerritoryReport } from "./lanternTerritoryReportService";

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
  /**
   * Read-only Report Mode for the authenticated tenant's Lantern City.
   * No target tenant, and no write. Does not overlap unit-suite trust (#620).
   */
  territoryReport: legacyDayforgeTenantOperatorProcedure
    .input(
      z
        .object({ windowDays: z.union([z.literal(30), z.literal(90)]).default(30) })
        .optional()
    )
    .query(({ ctx, input }) =>
      readLanternTerritoryReport({
        tenantId: ctx.tenantId,
        windowDays: input?.windowDays ?? 30,
      })
    ),
  geocodePending: legacyAdminRoleProcedure
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
