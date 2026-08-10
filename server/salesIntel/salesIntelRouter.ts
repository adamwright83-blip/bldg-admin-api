/**
 * Sales Intel administration.
 *
 * EVERY procedure here is gated on `adminProcedure`, which requires the
 * platform role `admin`. The `driver` role is excluded at the server boundary,
 * not merely hidden in navigation — a driver-role user calling these endpoints
 * directly receives FORBIDDEN.
 *
 * Drivers CONSUME sales intelligence through `armoryRouter`; they can never
 * administer the corpus.
 */
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  SALES_INTEL_REVIEW_STATES,
  salesIntelImportSchema,
} from "../../shared/salesIntel";
import {
  attachSalesIntelContent,
  ingestSalesIntelSource,
  reextractSalesIntelSource,
} from "./salesIntelService";
import { importSalesIntelCorpus } from "./salesIntelImport";
import {
  getSourceArtifact,
  listFrameworksForSource,
  listFrameworkVersions,
  listSourceArtifacts,
  listTranscripts,
  setFrameworkReviewState,
} from "./salesIntelStore";
import { createSalesIntelAdapterRegistry } from "./sourceAdapters";

const segmentSchema = z.object({
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  text: z.string().trim().min(1),
});

export const salesIntelRouter = router({
  /** Adapter capability list, so the admin UI states honestly what works. */
  adapters: adminProcedure.query(() =>
    createSalesIntelAdapterRegistry().list()
  ),

  sources: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(({ input }) => listSourceArtifacts(input?.limit ?? 50)),

  source: adminProcedure
    .input(z.object({ sourceArtifactId: z.string().uuid() }))
    .query(async ({ input }) => {
      const artifact = await getSourceArtifact(input.sourceArtifactId);
      if (!artifact) throw new Error("Sales Intel source not found");
      return {
        artifact,
        transcripts: await listTranscripts(artifact.id),
        frameworks: await listFrameworksForSource(artifact.id),
      };
    }),

  /**
   * The `+ ADD SALES INTEL` action. One field: a YouTube URL, an Instagram
   * Reel URL, or transcript text.
   */
  ingest: adminProcedure
    .input(
      z.object({
        input: z.string().trim().min(1).max(200_000),
        creatorName: z.string().trim().max(191).nullish(),
        creatorHandle: z.string().trim().max(191).nullish(),
        title: z.string().trim().max(512).nullish(),
        publishedAt: z.string().trim().datetime().nullish(),
        transcriptText: z.string().trim().max(200_000).nullish(),
      })
    )
    .mutation(({ ctx, input }) =>
      ingestSalesIntelSource({
        input: input.input,
        creatorName: input.creatorName ?? null,
        creatorHandle: input.creatorHandle ?? null,
        title: input.title ?? null,
        publishedAt: input.publishedAt ?? null,
        transcriptText: input.transcriptText ?? null,
        actorId: ctx.user.openId,
      })
    ),

  /** Supplies content for a source that was awaiting it. */
  attachContent: adminProcedure
    .input(
      z.object({
        sourceArtifactId: z.string().uuid(),
        transcriptText: z.string().trim().min(1).max(200_000),
        contentKind: z
          .enum(["supplied_transcript", "caption_only"])
          .default("supplied_transcript"),
        segments: z.array(segmentSchema).max(5_000).default([]),
        creatorName: z.string().trim().max(191).nullish(),
      })
    )
    .mutation(({ ctx, input }) =>
      attachSalesIntelContent({
        sourceArtifactId: input.sourceArtifactId,
        transcriptText: input.transcriptText,
        contentKind: input.contentKind,
        segments: input.segments,
        creatorName: input.creatorName ?? null,
        actorId: ctx.user.openId,
      })
    ),

  reextract: adminProcedure
    .input(z.object({ sourceArtifactId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      reextractSalesIntelSource({
        sourceArtifactId: input.sourceArtifactId,
        actorId: ctx.user.openId,
      })
    ),

  frameworkVersions: adminProcedure
    .input(z.object({ frameworkKey: z.string().trim().min(1).max(64) }))
    .query(({ input }) => listFrameworkVersions(input.frameworkKey)),

  review: adminProcedure
    .input(
      z.object({
        frameworkId: z.string().uuid(),
        reviewState: z.enum(SALES_INTEL_REVIEW_STATES),
      })
    )
    .mutation(({ ctx, input }) =>
      setFrameworkReviewState({
        frameworkId: input.frameworkId,
        reviewState: input.reviewState,
        reviewedBy: ctx.user.openId,
      })
    ),

  /** Bulk import for the sourced researcher corpus. */
  importCorpus: adminProcedure
    .input(z.object({ payload: salesIntelImportSchema }))
    .mutation(({ ctx, input }) =>
      importSalesIntelCorpus({
        payload: input.payload,
        actorId: ctx.user.openId,
      })
    ),
});
