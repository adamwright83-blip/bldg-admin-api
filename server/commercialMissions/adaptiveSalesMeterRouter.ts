import { dayforgeMissionFieldProcedure, router } from "../_core/trpc";
import { getAdaptiveDriverSalesMeter } from "./adaptiveSalesMeter";

export const adaptiveSalesMeterRouter = router({
  myMeter: dayforgeMissionFieldProcedure.query(({ ctx }) =>
    getAdaptiveDriverSalesMeter({ tenantId: ctx.tenantId, driverId: ctx.user.openId })
  ),
});
