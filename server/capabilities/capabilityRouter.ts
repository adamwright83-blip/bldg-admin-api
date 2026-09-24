/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { legacyDayforgeTenantOperatorProcedure, router } from "../_core/trpc";
import { getCapabilityEvaluations } from "./capabilityEvaluationService";

export const capabilityRouter = router({
  get: legacyDayforgeTenantOperatorProcedure.query(({ ctx }) => getCapabilityEvaluations({ tenantId: ctx.tenantId })),
});
