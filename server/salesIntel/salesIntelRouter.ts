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
  listAllAcceptedFrameworks,
  listFrameworksForSource,
  listFrameworkVersions,
  listSourceArtifacts,
  listSourceArtifactsForRegistry,
  listTranscripts,
  setFrameworkReviewState,
} from "./salesIntelStore";
import { computeSalesIntelCoverage } from "../../shared/salesIntelCoverage";
import { createSalesIntelAdapterRegistry } from "./sourceAdapters";
import {
  salesIntelSourceRegistryCreateSchema,
  SALES_INTEL_SOURCE_REGISTRY_STATUSES,
} from "../../shared/salesIntelSourceRegistry";
import {
  ingestSalesIntelSourceRegistration,
  SalesIntelSourceRegistryError,
} from "./salesIntelSourceRegistryService";
import {
  getSalesIntelSource,
  listEnabledYouTubeSources,
  listSalesIntelSources,
  setSalesIntelSourceStatus,
} from "./salesIntelSourceRegistryStore";
import {
  checkAllEnabledYouTubeSources,
  checkYouTubeSourceForNewContent,
} from "./youtubeMonitoring";
import { getFrameworkReviewQueue } from "./salesIntelReviewQueue";
import {
  applySalesIntelSourceImport,
  previewSalesIntelSourceImport,
} from "./salesIntelSourceImportService";

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

  /** Every framework awaiting a human decision, with explainable quality signals. */
  reviewQueue: adminProcedure.query(() => getFrameworkReviewQueue()),

  /** What the accepted corpus actually covers — counts and gaps, never an invented percentage. */
  coverage: adminProcedure.query(async () => {
    const frameworks = await listAllAcceptedFrameworks();
    return computeSalesIntelCoverage(frameworks);
  }),

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

  /**
   * The curated creator/channel watch list (Slice 37) — distinct from
   * `sources`/`source` above, which list individual ingested artifacts.
   */
  sourceRegistry: router({
    list: adminProcedure
      .input(
        z
          .object({ status: z.enum(SALES_INTEL_SOURCE_REGISTRY_STATUSES).optional() })
          .optional()
      )
      .query(({ input }) => listSalesIntelSources(input)),

    create: adminProcedure
      .input(salesIntelSourceRegistryCreateSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          return await ingestSalesIntelSourceRegistration({
            ...input,
            createdBy: ctx.user.openId,
          });
        } catch (error) {
          if (error instanceof SalesIntelSourceRegistryError) {
            throw new Error(error.message);
          }
          throw error;
        }
      }),

    setStatus: adminProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          status: z.enum(SALES_INTEL_SOURCE_REGISTRY_STATUSES),
        })
      )
      .mutation(({ input }) => setSalesIntelSourceStatus(input)),

    recentArtifacts: adminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(({ input }) => listSourceArtifactsForRegistry(input.id)),

    /** Manual "CHECK FOR NEW CONTENT" for one source — idempotent, safe to re-run. */
    checkNow: adminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ input }) => {
        const source = await getSalesIntelSource(input.id);
        if (!source) throw new Error("Sales Intel source not found");
        return checkYouTubeSourceForNewContent(source);
      }),

    /**
     * Entry point for periodic monitoring. No new always-on worker process
     * is introduced by this run — a real external scheduler (e.g. a
     * timed GitHub Action or Railway cron) calls this exact admin-
     * authenticated mutation on a sane cadence (hourly/daily, never
     * per-minute). This mutation itself is what makes that safe to wire up
     * later without further engineering.
     */
    checkAllEnabled: adminProcedure.mutation(async () => {
      const sources = await listEnabledYouTubeSources();
      return checkAllEnabledYouTubeSources(sources);
    }),

    /** PREVIEW / DRY RUN — classifies every entry, mutates nothing. */
    previewImport: adminProcedure
      .input(z.object({ entries: z.array(z.unknown()).min(1).max(50) }))
      .mutation(({ input }) => previewSalesIntelSourceImport(input.entries)),

    /** Idempotent: only "new"-classified entries are actually inserted. */
    applyImport: adminProcedure
      .input(z.object({ entries: z.array(z.unknown()).min(1).max(50) }))
      .mutation(({ ctx, input }) =>
        applySalesIntelSourceImport({ rawEntries: input.entries, createdBy: ctx.user.openId })
      ),
  }),
});
