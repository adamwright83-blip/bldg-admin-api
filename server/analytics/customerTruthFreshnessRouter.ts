import { legacyDayforgeTenantOperatorProcedure, router } from "../_core/trpc";
import { loadCustomerTruthFreshnessDiagnostic } from "./customerTruthFreshnessDiagnostic";

/**
 * Operator query for the CleanCloud freshness diagnostic.
 * Read-only. Tenant comes from the session. No customer identity is returned.
 */
export const customerTruthFreshnessDiagnosticProcedure =
  legacyDayforgeTenantOperatorProcedure.query(async ({ ctx }) =>
    loadCustomerTruthFreshnessDiagnostic({ tenantId: ctx.tenantId })
  );

export const customerTruthFreshnessRouter = router({
  diagnostic: customerTruthFreshnessDiagnosticProcedure,
});
