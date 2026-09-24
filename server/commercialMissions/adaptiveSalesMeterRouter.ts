/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { legacyDayforgeMissionFieldProcedure, router } from "../_core/trpc";
import { getAdaptiveDriverSalesMeter } from "./adaptiveSalesMeter";

export const adaptiveSalesMeterRouter = router({
  myMeter: legacyDayforgeMissionFieldProcedure.query(({ ctx }) =>
    getAdaptiveDriverSalesMeter({ tenantId: ctx.tenantId, driverId: ctx.user.openId })
  ),
});
