import { dayforgePipelineProcedure, router } from "../_core/trpc";
import { buildEchoFollowUpBrief, getNextEligibleFollowUp } from "./echoFollowUpService";

export const echoFollowUpRouter = router({
  /**
   * The deterministic brief tier only (see echoFollowUpService.ts header).
   * Never sends, calls, or marks anything — a human still chooses and acts.
   */
  brief: dayforgePipelineProcedure.query(async ({ ctx }) => {
    const evidence = await getNextEligibleFollowUp({
      tenantId: ctx.tenantId,
      operatorId: ctx.user.openId,
    });
    return buildEchoFollowUpBrief(evidence);
  }),
});
