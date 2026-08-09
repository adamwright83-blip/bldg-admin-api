import { dayforgeTenantOperatorProcedure, router } from "../_core/trpc";
import { getCapabilityEvaluations } from "./capabilityEvaluationService";

export const capabilityRouter = router({
  get: dayforgeTenantOperatorProcedure.query(({ ctx }) => getCapabilityEvaluations({ tenantId: ctx.tenantId })),
});
