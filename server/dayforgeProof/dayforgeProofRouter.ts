import { z } from "zod";
import { dayforgeMissionOperatorProcedure, router } from "../_core/trpc";
import { getDayforgeProofDashboard } from "./dayforgeProofService";

export const dayforgeProofRouter = router({
  dashboard: dayforgeMissionOperatorProcedure.input(z.object({
    start: z.coerce.date(), end: z.coerce.date(),
  }).refine(value => value.end > value.start && value.end.getTime() - value.start.getTime() <= 366 * 86_400_000, "Choose a valid range up to one year"))
    .query(({ ctx, input }) => getDayforgeProofDashboard({ ...input, tenantId: ctx.tenantId })),
});
