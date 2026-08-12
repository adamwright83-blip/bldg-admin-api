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

export type VideoUnderstandingRequest = {
  canonicalUrl: string;
  externalContentId: string | null;
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

const ANALYSIS_INSTRUCTION = [
  "Transcribe the spoken sales instruction in this video as faithfully as possible.",
  "Return only what is actually said. Do not summarize, embellish, or invent claims.",
  "Preserve the speaker's own wording, including objection phrasing and example language.",
  "If the video contains no sales instruction, say exactly: NO_SALES_INSTRUCTION",
].join(" ");

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
                  { text: ANALYSIS_INSTRUCTION },
                  { file_data: { file_uri: request.canonicalUrl } },
                ],
              },
            ],
            generationConfig: { temperature: 0 },
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
      console.error("[Sales Intel] Gemini video analysis HTTP error", {
        provider: this.key,
        model: this.model,
        elapsedMs: Date.now() - startedAt,
        status: response.status,
      });
      throw new VideoUnderstandingFailedError(
        `Video analysis provider returned ${response.status}`,
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
