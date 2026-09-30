import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  geocodePendingLocations,
  getGeographicTruth,
} from "./geographicTruthService";

export const geographicTruthRouter = router({
  atlas: adminProcedure
    .input(z.object({ targetTenantId: z.string().trim().min(1).optional() }).optional())
    .query(({ ctx, input }) =>
      getGeographicTruth({ tenantId: input?.targetTenantId || ctx.tenantId })
    ),
  geocodePending: adminProcedure
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
