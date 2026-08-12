import { z } from "zod";
import { adminOrDriverProcedure, router } from "../_core/trpc";
import {
  captureInstagramSalesIntel,
  getInstagramCaptureStatus,
  scheduleInstagramSalesIntelProcessing,
} from "./instagramCaptureService";
import { getSourceArtifact } from "./salesIntelStore";

async function assertInstagramCaptureExists(sourceArtifactId: string) {
  const artifact = await getSourceArtifact(sourceArtifactId);
  if (!artifact || artifact.sourceType !== "instagram") {
    throw new Error("Instagram Sales Intel source not found");
  }
  return artifact;
}

/**
 * Narrow driver-facing write surface. This is intentionally separate from the
 * admin-only Sales Intel router: a driver may CAPTURE a public Reel reference
 * and inspect/retry that exact capture by its unguessable artifact UUID, but
 * cannot list corpus sources, review, accept, reject, import, or otherwise
 * administer Sales Intel.
 *
 * The corpus is shared platform knowledge. If another operator already saved
 * the same Reel, stable shortcode identity returns that existing artifact; the
 * second operator must still be able to see/retry the receipt they just got.
 */
export const salesIntelCaptureRouter = router({
  captureInstagram: adminOrDriverProcedure
    .input(z.object({ reelUrl: z.string().trim().url().max(2_048) }))
    .mutation(({ ctx, input }) =>
      captureInstagramSalesIntel({
        reelUrl: input.reelUrl,
        actorId: ctx.user.openId,
      })
    ),

  status: adminOrDriverProcedure
    .input(z.object({ sourceArtifactId: z.string().uuid() }))
    .query(async ({ input }) => {
      await assertInstagramCaptureExists(input.sourceArtifactId);
      return getInstagramCaptureStatus(input.sourceArtifactId);
    }),

  retry: adminOrDriverProcedure
    .input(z.object({ sourceArtifactId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertInstagramCaptureExists(input.sourceArtifactId);
      const scheduled = await scheduleInstagramSalesIntelProcessing({
        sourceArtifactId: input.sourceArtifactId,
        actorId: ctx.user.openId,
      });
      return {
        sourceArtifactId: input.sourceArtifactId,
        scheduled,
        message: scheduled
          ? "Retry scheduled."
          : "This Reel is already being processed.",
      };
    }),
});
