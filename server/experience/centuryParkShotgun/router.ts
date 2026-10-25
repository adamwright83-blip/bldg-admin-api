/* LEGACY DAYFORGE COMPATIBILITY: the imported guard is the established tenant membership boundary. */
import { TRPCError } from "@trpc/server";
import { isGoldlineDemoOpenId } from "../../platform/tenancy/tenantIdentity";
import {
  legacyDayforgeTenantOperatorProcedure,
  router,
} from "../../_core/trpc";
import { shotgunSubmission } from "../../../shared/centuryParkShotgun";
import { silverLakeOperatorId } from "../lanternCity/silverLakeScope";
import { fireCenturyParkShotgun, previewCenturyParkShotgun } from "./service";
import { loadCenturyParkShotgunTimeline } from "./evidence";

const shotgunProcedure = legacyDayforgeTenantOperatorProcedure.use(
  ({ ctx, next }) => {
    if (
      ctx.tenantDenial ||
      !ctx.tenantId?.trim() ||
      !ctx.user.openId?.trim() ||
      isGoldlineDemoOpenId(ctx.user.openId) ||
      ["__unauthorized_tenant__", "__invalid_saas_session__"].includes(
        ctx.tenantId
      )
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "An authorized tenant operator is required.",
      });
    }
    return next({ ctx });
  }
);

/** Ready to mount under goldlineWorld.centuryParkShotgun when its owning PRs release the composition file. */
export const centuryParkShotgunRouter = router({
  preview: shotgunProcedure
    .input(
      shotgunSubmission.pick({
        customerId: true,
        openingId: true,
        hypothesis: true,
      })
    )
    .query(async ({ ctx, input }) =>
      previewCenturyParkShotgun(
        {
          tenantId: ctx.tenantId,
          operatorId: ctx.user.openId,
          canonicalOperatorId: await silverLakeOperatorId(ctx),
        },
        input
      )
    ),
  timeline: shotgunProcedure.query(({ ctx }) =>
    loadCenturyParkShotgunTimeline(ctx.tenantId)
  ),
  fire: shotgunProcedure
    .input(shotgunSubmission)
    .mutation(async ({ ctx, input }) =>
      fireCenturyParkShotgun(
        {
          tenantId: ctx.tenantId,
          operatorId: ctx.user.openId,
          canonicalOperatorId: await silverLakeOperatorId(ctx),
        },
        input
      )
    ),
});
