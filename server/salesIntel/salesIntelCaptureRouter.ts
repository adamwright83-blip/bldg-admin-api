import { z } from "zod";
import { adminOrDriverProcedure, router } from "../_core/trpc";
import {
  captureInstagramSalesIntel,
  getInstagramCaptureStatus,
  scheduleInstagramSalesIntelProcessing,
} from "./instagramCaptureService";
import { getSourceArtifact } from "./salesIntelStore";

async function assertCaptureVisibleToCaller(input: {
  sourceArtifactId: string;
  actorId: string;
  role: string;
}) {
  const artifact = await getSourceArtifact(input.sourceArtifactId);
  if (!artifact || artifact.sourceType !== "instagram") {
    throw new Error("Instagram Sales Intel source not found");
  }
  // Sales Intel is shared platform knowledge, but drivers should not be able
  // to enumerate arbitrary corpus artifacts through this narrow capture API.
  // They may poll/retry what they captured themselves; admins may support any.
  if (input.role !== "admin" && artifact.ingestedBy !== input.actorId) {
    throw new Error("This capture belongs to a different operator");
  }
  return artifact;
}

/**
 * Narrow driver-facing write surface. This is intentionally separate from the
 * admin-only Sales Intel router: a driver may CAPTURE a public Reel reference
 * and inspect/retry that capture, but cannot list corpus sources, review,
 * accept, reject, import, or otherwise administer Sales Intel.
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
    .query(async ({ ctx, input }) => {
      await assertCaptureVisibleToCaller({
        sourceArtifactId: input.sourceArtifactId,
        actorId: ctx.user.openId,
        role: ctx.user.role,
      });
      return getInstagramCaptureStatus(input.sourceArtifactId);
    }),

  retry: adminOrDriverProcedure
    .input(z.object({ sourceArtifactId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertCaptureVisibleToCaller({
        sourceArtifactId: input.sourceArtifactId,
        actorId: ctx.user.openId,
        role: ctx.user.role,
      });
      const scheduled = scheduleInstagramSalesIntelProcessing({
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
