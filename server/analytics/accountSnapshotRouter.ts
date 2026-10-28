import { legacyDayforgeTenantOperatorProcedure, router } from "../_core/trpc";
import { readAccountSnapshot } from "./accountSnapshot";

/** system.accountSnapshot.get: the main account page's snapshot strip. Read-only, the signed-in tenant only. */
export const accountSnapshotRouter = router({
  get: legacyDayforgeTenantOperatorProcedure.query(({ ctx }) => readAccountSnapshot({ tenantId: ctx.tenantId })),
});
