/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { legacyDayforgePipelineProcedure, router } from "../_core/trpc";
import { buildEchoFollowUpBrief, getNextEligibleFollowUp } from "./echoFollowUpService";

export const echoFollowUpRouter = router({
  /**
   * The deterministic brief tier only (see echoFollowUpService.ts header).
   * Never sends, calls, or marks anything — a human still chooses and acts.
   */
  brief: legacyDayforgePipelineProcedure.query(async ({ ctx }) => {
    const evidence = await getNextEligibleFollowUp({
      tenantId: ctx.tenantId,
      operatorId: ctx.user.openId,
    });
    return buildEchoFollowUpBrief(evidence);
  }),
});
