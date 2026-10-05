/**
 * Sales Intel administration.
 *
 * EVERY procedure here is gated on `legacyDayforgeTenantAdminProcedure`, which requires the
 * platform role `admin`. The `driver` role is excluded at the server boundary,
 * not merely hidden in navigation — a driver-role user calling these endpoints
 * directly receives FORBIDDEN.
 *
 * Drivers CONSUME sales intelligence through `armoryRouter`; they can never
 * administer the corpus.
 */
import { z } from "zod";
import { legacyDayforgeTenantAdminProcedure, router } from "../_core/trpc";
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
  salesIntelSourceRegistrySetChannelIdSchema,
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
  setSalesIntelSourceExternalChannelId,
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
import { getTeachingReviewQueue } from "./salesIntelTeachingReviewQueue";
import {
  listAllAcceptedTeachings,
  listTeachingsForSource,
  setTeachingReviewState,
} from "./salesIntelTeachingStore";
import { computeSalesIntelTeachingCoverage } from "../../shared/salesIntelTeachingCoverage";
import { reextractGeneralTeachingsFromTranscripts } from "./salesIntelTeachingReExtraction";

const segmentSchema = z.object({
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  text: z.string().trim().min(1),
});

export const salesIntelRouter = router({
  /** Adapter capability list, so the admin UI states honestly what works. */
  adapters: legacyDayforgeTenantAdminProcedure.query(() =>
    createSalesIntelAdapterRegistry().list()
  ),

  sources: legacyDayforgeTenantAdminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(({ input }) => listSourceArtifacts(input?.limit ?? 50)),

  source: legacyDayforgeTenantAdminProcedure
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
  ingest: legacyDayforgeTenantAdminProcedure
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
  attachContent: legacyDayforgeTenantAdminProcedure
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

  reextract: legacyDayforgeTenantAdminProcedure
    .input(z.object({ sourceArtifactId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      reextractSalesIntelSource({
        sourceArtifactId: input.sourceArtifactId,
        actorId: ctx.user.openId,
      })
    ),

  frameworkVersions: legacyDayforgeTenantAdminProcedure
    .input(z.object({ frameworkKey: z.string().trim().min(1).max(64) }))
    .query(({ input }) => listFrameworkVersions(input.frameworkKey)),

  /** Every framework awaiting a human decision, with explainable quality signals. */
  reviewQueue: legacyDayforgeTenantAdminProcedure.query(() => getFrameworkReviewQueue()),

  /** What the accepted corpus actually covers — counts and gaps, never an invented percentage. */
  coverage: legacyDayforgeTenantAdminProcedure.query(async () => {
    const frameworks = await listAllAcceptedFrameworks();
    return computeSalesIntelCoverage(frameworks);
  }),

  review: legacyDayforgeTenantAdminProcedure
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

  /**
   * General sales teaching — broader than objection frameworks above.
   * Distinct review/coverage/reextraction surface, same admin-only gate.
   */
  teachings: router({
    /** Every teaching awaiting a human decision, with real source evidence. */
    reviewQueue: legacyDayforgeTenantAdminProcedure.query(() => getTeachingReviewQueue()),

    review: legacyDayforgeTenantAdminProcedure
      .input(
        z.object({
          teachingId: z.string().uuid(),
          reviewState: z.enum(SALES_INTEL_REVIEW_STATES),
        })
      )
      .mutation(({ ctx, input }) =>
        setTeachingReviewState({
          teachingId: input.teachingId,
          reviewState: input.reviewState,
          reviewedBy: ctx.user.openId,
        })
      ),

    /** What the accepted teaching corpus covers by category/creator/source — counts only. */
    coverage: legacyDayforgeTenantAdminProcedure.query(async () => {
      const teachings = await listAllAcceptedTeachings();
      return computeSalesIntelTeachingCoverage(teachings);
    }),

    forSource: legacyDayforgeTenantAdminProcedure
      .input(z.object({ sourceArtifactId: z.string().uuid() }))
      .query(({ input }) => listTeachingsForSource(input.sourceArtifactId)),

    /**
     * Re-extracts general teachings from a source's EXISTING transcripts —
     * never fetches content, never calls a video provider. Safe to run
     * from the admin UI for any source that already has persisted
     * transcripts (e.g. Shelby Sapp's long-form video, already processed
     * through Gemini in a prior run).
     */
    reextractFromExistingTranscripts: legacyDayforgeTenantAdminProcedure
      .input(z.object({ sourceArtifactId: z.string().uuid() }))
      .mutation(({ ctx, input }) =>
        reextractGeneralTeachingsFromTranscripts({
          sourceArtifactId: input.sourceArtifactId,
          actorId: ctx.user.openId,
        })
      ),
  }),

  /** Bulk import for the sourced researcher corpus. */
  importCorpus: legacyDayforgeTenantAdminProcedure
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
    list: legacyDayforgeTenantAdminProcedure
      .input(
        z
          .object({ status: z.enum(SALES_INTEL_SOURCE_REGISTRY_STATUSES).optional() })
          .optional()
      )
      .query(({ input }) => listSalesIntelSources(input)),

    create: legacyDayforgeTenantAdminProcedure
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

    setStatus: legacyDayforgeTenantAdminProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          status: z.enum(SALES_INTEL_SOURCE_REGISTRY_STATUSES),
        })
      )
      .mutation(({ input }) => setSalesIntelSourceStatus(input)),

    /**
     * Backfills a verified stable channel id onto an existing registry
     * row — for a source that was registered by @handle URL (which never
     * carries the stable id) before its UC... id was resolved. Never
     * creates a new row, never touches creator/URL/provenance.
     */
    setExternalChannelId: legacyDayforgeTenantAdminProcedure
      .input(salesIntelSourceRegistrySetChannelIdSchema)
      .mutation(({ input }) => setSalesIntelSourceExternalChannelId(input)),

    recentArtifacts: legacyDayforgeTenantAdminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(({ input }) => listSourceArtifactsForRegistry(input.id)),

    /** Manual "CHECK FOR NEW CONTENT" for one source — idempotent, safe to re-run. */
    checkNow: legacyDayforgeTenantAdminProcedure
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
    checkAllEnabled: legacyDayforgeTenantAdminProcedure.mutation(async () => {
      const sources = await listEnabledYouTubeSources();
      return checkAllEnabledYouTubeSources(sources);
    }),

    /** PREVIEW / DRY RUN — classifies every entry, mutates nothing. */
    previewImport: legacyDayforgeTenantAdminProcedure
      .input(z.object({ entries: z.array(z.unknown()).min(1).max(50) }))
      .mutation(({ input }) => previewSalesIntelSourceImport(input.entries)),

    /** Idempotent: only "new"-classified entries are actually inserted. */
    applyImport: legacyDayforgeTenantAdminProcedure
      .input(z.object({ entries: z.array(z.unknown()).min(1).max(50) }))
      .mutation(({ ctx, input }) =>
        applySalesIntelSourceImport({ rawEntries: input.entries, createdBy: ctx.user.openId })
      ),
  }),
});
