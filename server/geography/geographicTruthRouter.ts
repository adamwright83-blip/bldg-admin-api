import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  geocodePendingLocations,
  getGeographicTruth,
} from "./geographicTruthService";

export const geographicTruthRouter = router({
  atlas: adminProcedure.query(({ ctx }) =>
    getGeographicTruth({ tenantId: ctx.tenantId })
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
