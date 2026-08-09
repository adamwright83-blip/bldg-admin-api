import { dayforgeTenantOperatorProcedure, router } from "../_core/trpc";
import { getBusinessWorld } from "./businessWorldService";

export const businessWorldRouter = router({
  get: dayforgeTenantOperatorProcedure.query(({ ctx }) => getBusinessWorld({ tenantId: ctx.tenantId })),
});
