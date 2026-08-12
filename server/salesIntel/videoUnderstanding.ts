/**
 * Video understanding port.
 *
 * The repository's existing LLM abstraction (`server/_core/llm.ts`) is
 * Anthropic-only and structurally cannot accept video, so Sales Intel defines
 * a narrow port instead of widening that abstraction. Extraction still runs on
 * the existing `invokeLLM` path — this port only produces the transcript /
 * analysis that extraction consumes.
 *
 * When no provider is configured the port reports `provider_unavailable`. The
 * caller preserves the source artifact and moves it to `awaiting_content`.
 * A missing credential must never become an invented transcript.
 */
import type { SalesIntelTranscriptSegment } from "../../shared/salesIntel";
import { toGeminiOffset } from "../../shared/salesIntelLongFormVideo";

export type VideoUnderstandingRequest = {
  canonicalUrl: string;
  externalContentId: string | null;
  /**
   * Restricts analysis to a time range within the video — the mechanism
   * long-form segmentation uses to process a video in bounded chunks
   * instead of one monolithic request. Omitted entirely analyzes the
   * whole video, unchanged from prior behavior.
   */
  clip?: {
    startOffsetSeconds: number;
    endOffsetSeconds: number;
  };
  /**
   * "low" trades fine visual detail for a much smaller token footprint —
   * appropriate for spoken sales instruction, where the audio track and
   * coarse visual context carry the signal, not frame-level detail. Omitted
   * uses the provider's default resolution, unchanged from prior behavior.
   */
  mediaResolution?: "low";
};

export type VideoUnderstandingResult = {
  text: string;
  segments: SalesIntelTranscriptSegment[];
  provider: string;
  model: string;
  analysisVersion: string;
};

export class VideoUnderstandingUnavailableError extends Error {
  readonly code = "provider_unavailable";
  readonly retryable = true;

  constructor(message: string) {
    super(message);
    this.name = "VideoUnderstandingUnavailableError";
  }
}

export class VideoUnderstandingFailedError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code = "analysis_failed", retryable = true) {
    super(message);
    this.name = "VideoUnderstandingFailedError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface VideoUnderstandingProvider {
  readonly key: string;
  readonly configured: boolean;
  analyze(
    request: VideoUnderstandingRequest
  ): Promise<VideoUnderstandingResult>;
}

/** Used when no credential exists. Always refuses; never fabricates. */
export class UnconfiguredVideoUnderstandingProvider
  implements VideoUnderstandingProvider
{
  readonly key = "unconfigured";
  readonly configured = false;

  async analyze(): Promise<VideoUnderstandingResult> {
    throw new VideoUnderstandingUnavailableError(
      "No video-understanding provider is configured. Supply a transcript for this source instead."
    );
  }
}

export const VIDEO_ANALYSIS_VERSION = "sales-intel-video-analysis-v1";

const GEMINI_VIDEO_TIMEOUT_MIN_MS = 60_000;
const GEMINI_VIDEO_TIMEOUT_MAX_MS = 600_000;
const GEMINI_VIDEO_TIMEOUT_DEFAULT_MS = 240_000;

/**
 * Video understanding genuinely takes minutes, not seconds — a bare 60s
 * client deadline was killing every real request before Gemini could
 * finish, and surfacing as an opaque "timed out" that looked identical to
 * a real provider rejection. Configurable via `GEMINI_VIDEO_TIMEOUT_MS`,
 * clamped to a sane range so a malformed or missing value can never leave
 * the request effectively un-bounded or right back at the old 60s cliff.
 */
export function resolveGeminiVideoTimeoutMs(
  raw = process.env.GEMINI_VIDEO_TIMEOUT_MS
): number {
  const trimmed = raw?.trim();
  if (!trimmed) return GEMINI_VIDEO_TIMEOUT_DEFAULT_MS;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return GEMINI_VIDEO_TIMEOUT_DEFAULT_MS;
  return Math.min(
    GEMINI_VIDEO_TIMEOUT_MAX_MS,
    Math.max(GEMINI_VIDEO_TIMEOUT_MIN_MS, Math.round(parsed))
  );
}

const PROVIDER_MESSAGE_MAX_LENGTH = 300;

type GeminiErrorBody = {
  /** Google's machine-readable status, e.g. INVALID_ARGUMENT, FAILED_PRECONDITION. */
  status: string | null;
  /** Human-readable message from Google, truncated and never containing our own credentials. */
  message: string | null;
};

/**
 * Reads a non-2xx Gemini response body without ever throwing and without
 * ever risking exposure of our own request (API key, headers) — only
 * Google's own error description is extracted, and only up to a bounded
 * length. A response we can't parse still yields a short, safe fallback
 * rather than losing the diagnostic entirely.
 */
async function parseGeminiErrorBody(response: Response): Promise<GeminiErrorBody> {
  const raw = await response.text().catch(() => "");
  if (!raw) return { status: null, message: null };

  try {
    const parsed = JSON.parse(raw) as {
      error?: { status?: string; message?: string };
    };
    const status = typeof parsed.error?.status === "string" ? parsed.error.status : null;
    const message =
      typeof parsed.error?.message === "string"
        ? parsed.error.message.slice(0, PROVIDER_MESSAGE_MAX_LENGTH)
        : null;
    return { status, message };
  } catch {
    // Not JSON — fall back to a short sanitized slice of the raw text so
    // the diagnostic still carries something, never the full body.
    return {
      status: null,
      message: raw.replace(/\s+/g, " ").trim().slice(0, PROVIDER_MESSAGE_MAX_LENGTH) || null,
    };
  }
}

/**
 * When `clip` is set, this is one segment of a longer video (long-form
 * segmentation), so the instruction additionally asks Gemini to keep
 * timestamps relative to the clip itself — the caller converts those to
 * absolute video time, since Gemini only sees the clipped range.
 */
function buildAnalysisInstruction(clip?: { startOffsetSeconds: number; endOffsetSeconds: number }): string {
  const parts = [
    "Transcribe the spoken sales instruction in this video as faithfully as possible.",
    "Return only what is actually said. Do not summarize, embellish, or invent claims. Do not fill gaps.",
    "Preserve the speaker's own wording, including objection phrasing and example language, and clearly distinguish direct quotation from your own paraphrase.",
  ];
  if (clip) {
    parts.push(
      "This is one clipped segment of a longer video, not the whole video — do not assume it is complete or self-contained.",
      "Give timestamps relative to the start of this clip (i.e. 00:00 is the first moment you can see/hear in this request), not the original video."
    );
  }
  parts.push("If this clip contains no sales instruction, say exactly: NO_SALES_INSTRUCTION");
  return parts.join(" ");
}

/**
 * Gemini video understanding over a public YouTube URL.
 *
 * Implemented with `fetch` against the Generative Language REST API so no new
 * npm dependency or overlapping AI abstraction is introduced. Enabled only
 * when `GEMINI_API_KEY` is present.
 */
export class GeminiVideoUnderstandingProvider
  implements VideoUnderstandingProvider
{
  readonly key = "gemini";

  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.GEMINI_VIDEO_MODEL?.trim() ||
      "gemini-2.0-flash",
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = resolveGeminiVideoTimeoutMs()
  ) {}

  get configured(): boolean {
    return this.apiKey.trim().length > 0;
  }

  async analyze(
    request: VideoUnderstandingRequest
  ): Promise<VideoUnderstandingResult> {
    if (!this.configured) {
      throw new VideoUnderstandingUnavailableError(
        "GEMINI_API_KEY is not configured; YouTube video understanding is unavailable."
      );
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          this.model
        )}:generateContent`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: buildAnalysisInstruction(request.clip) },
                  {
                    file_data: { file_uri: request.canonicalUrl },
                    // REST field name confirmed against current official docs
                    // (ai.google.dev/gemini-api/docs/generate-content/video-understanding):
                    // video_metadata is snake_case, a sibling of file_data within
                    // the same Part — not nested inside it, not camelCase.
                    ...(request.clip
                      ? {
                          video_metadata: {
                            start_offset: toGeminiOffset(request.clip.startOffsetSeconds),
                            end_offset: toGeminiOffset(request.clip.endOffsetSeconds),
                          },
                        }
                      : {}),
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0,
              // mediaResolution is camelCase on GenerationConfig (unlike the
              // snake_case Part-level fields above) — confirmed against the
              // same current official API reference.
              ...(request.mediaResolution === "low"
                ? { mediaResolution: "MEDIA_RESOLUTION_LOW" }
                : {}),
            },
          }),
        }
      );
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const timedOut = error instanceof Error && error.name === "AbortError";
      // Never log the API key or request headers — provider/model/timing only.
      console.error("[Sales Intel] Gemini video analysis transport error", {
        provider: this.key,
        model: this.model,
        elapsedMs,
        timedOut,
      });
      throw new VideoUnderstandingFailedError(
        timedOut
          ? `Video analysis timed out after ${this.timeoutMs}ms`
          : "Video analysis request failed",
        timedOut ? "video_analysis_timeout" : "transport_error",
        true
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // 4xx generally means this video cannot be analyzed at all; 5xx/429 is worth a retry.
      const retryable = response.status >= 500 || response.status === 429;
      const errorBody = await parseGeminiErrorBody(response);
      console.error("[Sales Intel] Gemini video analysis HTTP error", {
        provider: this.key,
        model: this.model,
        elapsedMs: Date.now() - startedAt,
        status: response.status,
        geminiStatus: errorBody.status,
        geminiMessage: errorBody.message,
      });
      const hasDetail = Boolean(errorBody.status || errorBody.message);
      throw new VideoUnderstandingFailedError(
        hasDetail
          ? `Gemini video analysis failed (${response.status}${errorBody.status ? ` ${errorBody.status}` : ""}): ${errorBody.message ?? "no further detail from provider"}`
          : `Video analysis provider returned ${response.status}`,
        `provider_http_${response.status}`,
        retryable
      );
    }

    const payload = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const text = (payload.candidates?.[0]?.content?.parts ?? [])
      .map(part => part.text ?? "")
      .join("")
      .trim();

    if (!text || text === "NO_SALES_INSTRUCTION") {
      throw new VideoUnderstandingFailedError(
        "The provider returned no usable sales instruction for this video",
        "empty_analysis",
        false
      );
    }

    return {
      text,
      segments: [],
      provider: this.key,
      model: this.model,
      analysisVersion: VIDEO_ANALYSIS_VERSION,
    };
  }
}

export function resolveVideoUnderstandingProvider(
  apiKey = process.env.GEMINI_API_KEY ?? ""
): VideoUnderstandingProvider {
  return apiKey.trim()
    ? new GeminiVideoUnderstandingProvider(apiKey)
    : new UnconfiguredVideoUnderstandingProvider();
}
