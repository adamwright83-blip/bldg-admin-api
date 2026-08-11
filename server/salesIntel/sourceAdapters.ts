/**
 * Source adapters.
 *
 * An adapter turns an operator-supplied reference into a normalized
 * `SalesIntelSourceDraft`. Nothing downstream knows which platform the
 * material came from — Instagram is a source, not the system.
 *
 * Deliberately NOT implemented, and not authorized for this slice:
 *   - continuous creator monitoring or scheduled polling
 *   - Instagram scraping or arbitrary Reel downloading
 *   - any private/undocumented content-search endpoint
 *
 * An adapter never invents content. When content cannot be obtained through a
 * legitimate path it says so, and the source is preserved in
 * `awaiting_content` with its provenance intact.
 */
import {
  canonicalizeInstagramUrl,
  canonicalizeYouTubeUrl,
  type SalesIntelContentKind,
  type SalesIntelSourceType,
  type SalesIntelTranscriptSegment,
} from "../../shared/salesIntel";
import {
  resolveVideoUnderstandingProvider,
  VideoUnderstandingFailedError,
  VideoUnderstandingUnavailableError,
  type VideoUnderstandingProvider,
} from "./videoUnderstanding";
import { resolveYouTubeMetadata } from "./youtubeMetadata";

export type SalesIntelSourceRequest = {
  /** Raw operator input: a URL, or free text treated as a transcript. */
  input: string;
  sourceType?: SalesIntelSourceType;
  creatorName?: string | null;
  creatorHandle?: string | null;
  publishedAt?: string | null;
  title?: string | null;
  /** Supplied transcript / authorized media text. */
  transcriptText?: string | null;
  transcriptSegments?: SalesIntelTranscriptSegment[];
  transcriptProvider?: string | null;
  transcriptModel?: string | null;
  metadata?: Record<string, unknown>;
};

export type SalesIntelSourceContent = {
  kind: SalesIntelContentKind;
  text: string;
  segments: SalesIntelTranscriptSegment[];
  provider: string | null;
  model: string | null;
  analysisVersion: string | null;
};

export type SalesIntelSourceDraft = {
  sourceType: SalesIntelSourceType;
  sourceUrl: string | null;
  canonicalUrl: string | null;
  externalContentId: string | null;
  creatorName: string | null;
  creatorHandle: string | null;
  publishedAt: string | null;
  title: string | null;
  metadata: Record<string, unknown>;
  /** Present when analyzable content exists now. */
  content: SalesIntelSourceContent | null;
  /** Set when content could not be obtained; the source is still stored. */
  awaitingReason: {
    code: string;
    message: string;
    retryable: boolean;
  } | null;
};

export interface SalesIntelSourceAdapter {
  readonly key: string;
  readonly label: string;
  readonly supported: boolean;
  /** True when this adapter cannot obtain content on its own. */
  readonly requiresSuppliedContent: boolean;
  claims(request: SalesIntelSourceRequest): boolean;
  resolve(request: SalesIntelSourceRequest): Promise<SalesIntelSourceDraft>;
}

function suppliedContent(
  request: SalesIntelSourceRequest
): SalesIntelSourceContent | null {
  const text = request.transcriptText?.trim();
  if (!text) return null;
  return {
    kind: "supplied_transcript",
    text,
    segments: request.transcriptSegments ?? [],
    provider: request.transcriptProvider?.trim() || null,
    model: request.transcriptModel?.trim() || null,
    analysisVersion: null,
  };
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/**
 * Free text pasted by an operator, or an explicitly supplied transcript for a
 * non-URL source. Fully ingestible immediately.
 */
export class SuppliedTranscriptAdapter implements SalesIntelSourceAdapter {
  readonly key = "supplied_transcript";
  readonly label = "Direct text / transcript";
  readonly supported = true;
  readonly requiresSuppliedContent = true;

  claims(request: SalesIntelSourceRequest): boolean {
    return !isUrl(request.input);
  }

  async resolve(
    request: SalesIntelSourceRequest
  ): Promise<SalesIntelSourceDraft> {
    const text = (request.transcriptText ?? request.input).trim();
    if (!text) {
      throw new Error("Supply a transcript, or a YouTube or Instagram URL.");
    }
    return {
      sourceType: request.sourceType ?? "uploaded_transcript",
      sourceUrl: null,
      canonicalUrl: null,
      externalContentId: null,
      creatorName: request.creatorName?.trim() || null,
      creatorHandle: request.creatorHandle?.trim() || null,
      publishedAt: request.publishedAt ?? null,
      title: request.title?.trim() || null,
      metadata: request.metadata ?? {},
      content: {
        kind: "supplied_transcript",
        text,
        segments: request.transcriptSegments ?? [],
        provider: request.transcriptProvider?.trim() || null,
        model: request.transcriptModel?.trim() || null,
        analysisVersion: null,
      },
      awaitingReason: null,
    };
  }
}

/**
 * Public YouTube URL. Canonicalizes to a stable video identity, enriches with
 * Data API metadata when a key is configured, and obtains analyzable content
 * through the video-understanding port. A supplied transcript always wins over
 * model analysis.
 */
export class YouTubeSourceAdapter implements SalesIntelSourceAdapter {
  readonly key = "youtube";
  readonly label = "YouTube video";
  readonly supported = true;
  readonly requiresSuppliedContent = false;

  constructor(
    private readonly videoProvider: VideoUnderstandingProvider = resolveVideoUnderstandingProvider(),
    private readonly metadataResolver = resolveYouTubeMetadata
  ) {}

  claims(request: SalesIntelSourceRequest): boolean {
    return isUrl(request.input) && canonicalizeYouTubeUrl(request.input) !== null;
  }

  async resolve(
    request: SalesIntelSourceRequest
  ): Promise<SalesIntelSourceDraft> {
    const identity = canonicalizeYouTubeUrl(request.input);
    if (!identity) {
      throw new Error("That does not look like a valid YouTube video URL.");
    }

    const metadata = await this.metadataResolver(identity.externalContentId);

    const base: SalesIntelSourceDraft = {
      sourceType: "youtube",
      sourceUrl: request.input.trim(),
      canonicalUrl: identity.canonicalUrl,
      externalContentId: identity.externalContentId,
      creatorName:
        request.creatorName?.trim() || metadata?.channelTitle || null,
      creatorHandle:
        request.creatorHandle?.trim() || metadata?.channelHandle || null,
      publishedAt: request.publishedAt ?? metadata?.publishedAt ?? null,
      title: request.title?.trim() || metadata?.title || null,
      metadata: {
        ...(request.metadata ?? {}),
        ...(metadata ? { youtube: metadata.raw } : {}),
      },
      content: null,
      awaitingReason: null,
    };

    const supplied = suppliedContent(request);
    if (supplied) return { ...base, content: supplied };

    try {
      const analysis = await this.videoProvider.analyze({
        canonicalUrl: identity.canonicalUrl,
        externalContentId: identity.externalContentId,
      });
      return {
        ...base,
        content: {
          kind: "video_understanding",
          text: analysis.text,
          segments: analysis.segments,
          provider: analysis.provider,
          model: analysis.model,
          analysisVersion: analysis.analysisVersion,
        },
      };
    } catch (error) {
      if (error instanceof VideoUnderstandingUnavailableError) {
        return {
          ...base,
          awaitingReason: {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
          },
        };
      }
      if (error instanceof VideoUnderstandingFailedError) {
        return {
          ...base,
          awaitingReason: {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
          },
        };
      }
      throw error;
    }
  }
}

/**
 * Instagram Reel URL. The URL is always a valid, traceable source artifact.
 * There is no authorized path to fetch arbitrary Reel media, so without a
 * supplied transcript the source truthfully rests in `awaiting_content`.
 */
export class InstagramSourceAdapter implements SalesIntelSourceAdapter {
  readonly key = "instagram";
  readonly label = "Instagram Reel";
  readonly supported = true;
  readonly requiresSuppliedContent = true;

  claims(request: SalesIntelSourceRequest): boolean {
    return (
      isUrl(request.input) && canonicalizeInstagramUrl(request.input) !== null
    );
  }

  async resolve(
    request: SalesIntelSourceRequest
  ): Promise<SalesIntelSourceDraft> {
    const identity = canonicalizeInstagramUrl(request.input);
    if (!identity) {
      throw new Error("That does not look like a valid Instagram Reel URL.");
    }

    const base: SalesIntelSourceDraft = {
      sourceType: "instagram",
      sourceUrl: request.input.trim(),
      canonicalUrl: identity.canonicalUrl,
      externalContentId: identity.externalContentId,
      creatorName: request.creatorName?.trim() || null,
      creatorHandle:
        request.creatorHandle?.trim() || identity.creatorHandle || null,
      publishedAt: request.publishedAt ?? null,
      title: request.title?.trim() || null,
      metadata: request.metadata ?? {},
      content: null,
      awaitingReason: null,
    };

    const supplied = suppliedContent(request);
    if (supplied) return { ...base, content: supplied };

    return {
      ...base,
      awaitingReason: {
        code: "content_required",
        message:
          "The Reel has been saved as a source. Instagram media cannot be fetched automatically — add a transcript or authorized media to extract it.",
        retryable: true,
      },
    };
  }
}

/** Any other URL: stored as provenance, extractable once content is supplied. */
export class ManualUrlSourceAdapter implements SalesIntelSourceAdapter {
  readonly key = "manual_url";
  readonly label = "Manual / supplied URL";
  readonly supported = true;
  readonly requiresSuppliedContent = true;

  claims(request: SalesIntelSourceRequest): boolean {
    return isUrl(request.input);
  }

  async resolve(
    request: SalesIntelSourceRequest
  ): Promise<SalesIntelSourceDraft> {
    const url = request.input.trim();
    const base: SalesIntelSourceDraft = {
      sourceType: request.sourceType ?? "manual_url",
      sourceUrl: url,
      canonicalUrl: url,
      externalContentId: null,
      creatorName: request.creatorName?.trim() || null,
      creatorHandle: request.creatorHandle?.trim() || null,
      publishedAt: request.publishedAt ?? null,
      title: request.title?.trim() || null,
      metadata: request.metadata ?? {},
      content: null,
      awaitingReason: null,
    };

    const supplied = suppliedContent(request);
    if (supplied) return { ...base, content: supplied };

    return {
      ...base,
      awaitingReason: {
        code: "content_required",
        message:
          "The source URL has been saved. Add a transcript to extract intelligence from it.",
        retryable: true,
      },
    };
  }
}

/**
 * Deterministic fixture ingestion for tests and seeded demo environments.
 * Everything it produces is typed `test_fixture` so it can never be presented
 * as real trainer material.
 */
export class FixtureSourceAdapter implements SalesIntelSourceAdapter {
  readonly key = "test_fixture";
  readonly label = "Deterministic test fixture";
  readonly supported = true;
  readonly requiresSuppliedContent = true;

  claims(request: SalesIntelSourceRequest): boolean {
    return request.sourceType === "test_fixture";
  }

  async resolve(
    request: SalesIntelSourceRequest
  ): Promise<SalesIntelSourceDraft> {
    const text = (request.transcriptText ?? request.input).trim();
    if (!text) throw new Error("A fixture source requires transcript text");
    return {
      sourceType: "test_fixture",
      sourceUrl: null,
      canonicalUrl: null,
      externalContentId: request.metadata?.fixtureKey
        ? String(request.metadata.fixtureKey)
        : null,
      creatorName: request.creatorName?.trim() || null,
      creatorHandle: request.creatorHandle?.trim() || null,
      publishedAt: request.publishedAt ?? null,
      title: request.title?.trim() || null,
      metadata: { ...(request.metadata ?? {}), synthetic: true },
      content: {
        kind: "supplied_transcript",
        text,
        segments: request.transcriptSegments ?? [],
        provider: "fixture",
        model: null,
        analysisVersion: null,
      },
      awaitingReason: null,
    };
  }
}

/**
 * Registry. Order matters — the first adapter that claims the input wins, so
 * platform adapters are tried before the generic URL fallback.
 */
export function createSalesIntelAdapterRegistry(
  adapters?: SalesIntelSourceAdapter[]
) {
  const resolved = adapters ?? [
    new FixtureSourceAdapter(),
    new YouTubeSourceAdapter(),
    new InstagramSourceAdapter(),
    new SuppliedTranscriptAdapter(),
    new ManualUrlSourceAdapter(),
  ];
  return {
    list() {
      return resolved.map(adapter => ({
        key: adapter.key,
        label: adapter.label,
        supported: adapter.supported,
        requiresSuppliedContent: adapter.requiresSuppliedContent,
      }));
    },
    resolveAdapter(request: SalesIntelSourceRequest): SalesIntelSourceAdapter {
      const adapter = resolved.find(
        candidate => candidate.supported && candidate.claims(request)
      );
      if (!adapter) {
        throw new Error(
          "No Sales Intel source adapter handles that input. Paste a YouTube URL, an Instagram Reel URL, or a transcript."
        );
      }
      return adapter;
    },
  };
}

export type SalesIntelAdapterRegistry = ReturnType<
  typeof createSalesIntelAdapterRegistry
>;
