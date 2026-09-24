/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { z } from "zod";
import { legacyLegacyDayforgeMissionOperatorProcedure, router } from "../_core/trpc";
import { getLegacyDayforgeProofDashboard } from "./legacyLegacyDayforgeProofService";

export const legacyLegacyDayforgeProofRouter = router({
  dashboard: legacyLegacyDayforgeMissionOperatorProcedure.input(z.object({
    start: z.coerce.date(), end: z.coerce.date(),
  }).refine(value => value.end > value.start && value.end.getTime() - value.start.getTime() <= 366 * 86_400_000, "Choose a valid range up to one year"))
    .query(({ ctx, input }) => getLegacyDayforgeProofDashboard({ ...input, tenantId: ctx.tenantId })),
});
