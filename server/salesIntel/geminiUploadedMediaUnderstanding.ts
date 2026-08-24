import {
  VideoUnderstandingFailedError,
  VideoUnderstandingUnavailableError,
  resolveGeminiVideoTimeoutMs,
  type VideoUnderstandingResult,
} from "./videoUnderstanding";

export const INSTAGRAM_MEDIA_ANALYSIS_VERSION =
  "sales-intel-instagram-media-analysis-v1";

const DEFAULT_MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const MAX_MEDIA_BYTES_CEILING = 200 * 1024 * 1024;
const FILE_PROCESSING_POLL_MS = 2_000;
const FILE_PROCESSING_MAX_MS = 120_000;

function resolveMaxMediaBytes(raw = process.env.INSTAGRAM_MEDIA_MAX_BYTES): number {
  const parsed = Number(raw?.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_MEDIA_BYTES;
  return Math.min(MAX_MEDIA_BYTES_CEILING, Math.round(parsed));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function safeProviderMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.replace(/\s+/g, " ").trim().slice(0, 300) || null;
}

async function providerErrorMessage(response: Response): Promise<string | null> {
  const raw = await response.text().catch(() => "");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { error?: { status?: string; message?: string } };
    const status = safeProviderMessage(parsed.error?.status);
    const message = safeProviderMessage(parsed.error?.message);
    return [status, message].filter(Boolean).join(": ") || null;
  } catch {
    return safeProviderMessage(raw);
  }
}

type GeminiFile = {
  name?: string;
  uri?: string;
  mimeType?: string;
  state?: string;
  error?: { message?: string };
};

function validModelName(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

function normalizeMimeType(value: string | null | undefined): string {
  const mime = value?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime.startsWith("video/") || mime.startsWith("audio/")) return mime;
  return "video/mp4";
}

function buildInstagramAnalysisInstruction(): string {
  return [
    "Transcribe and analyze the spoken sales instruction in this short-form media as faithfully as possible.",
    "Return only teaching that is actually present in the media; do not infer from a title, creator reputation, or outside sales knowledge.",
    "Preserve useful example language and objection phrasing when it is actually spoken.",
    "Do not embellish, complete missing thoughts, or turn a casual statement into a doctrine the speaker did not teach.",
    "If the media contains no sales instruction, say exactly: NO_SALES_INSTRUCTION",
  ].join(" ");
}

export type UploadedMediaUnderstandingRequest = {
  mediaUrl: string;
  externalContentId: string;
  mimeType?: string | null;
};

/**
 * Downloads one resolver-tunneled short-form media file, uploads it through
 * Google's Files API, waits until it is ACTIVE, then runs the same faithful
 * source-understanding stage used before Sales Intel extraction. The Gemini
 * file is best-effort deleted afterward; the durable provenance lives in our
 * own source artifact/transcript rows, never in Gemini temporary storage.
 */
export class GeminiUploadedMediaUnderstandingProvider {
  readonly key = "gemini";
  readonly model: string;

  constructor(
    private readonly apiKey = process.env.GEMINI_API_KEY ?? "",
    model = process.env.GEMINI_VIDEO_MODEL?.trim() || "gemini-3.6-flash",
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly analysisTimeoutMs = resolveGeminiVideoTimeoutMs(),
    private readonly mediaDownloadTimeoutMs = 45_000,
    private readonly maxMediaBytes = resolveMaxMediaBytes()
  ) {
    this.model = model.trim();
  }

  get configured(): boolean {
    return Boolean(this.apiKey.trim()) && validModelName(this.model);
  }

  async analyze(
    request: UploadedMediaUnderstandingRequest
  ): Promise<VideoUnderstandingResult> {
    if (!this.apiKey.trim()) {
      throw new VideoUnderstandingUnavailableError(
        "GEMINI_API_KEY is not configured; Instagram media understanding is unavailable."
      );
    }
    if (!validModelName(this.model)) {
      throw new VideoUnderstandingUnavailableError(
        "GEMINI_VIDEO_MODEL is malformed; expected a model name such as gemini-3.6-flash."
      );
    }

    const mediaController = new AbortController();
    const mediaTimer = setTimeout(
      () => mediaController.abort(),
      this.mediaDownloadTimeoutMs
    );
    let mediaResponse: Response;
    try {
      mediaResponse = await this.fetchImpl(request.mediaUrl, {
        signal: mediaController.signal,
        // The resolver only hands us a URL on its own trusted origin. Do not
        // follow a later redirect to an arbitrary host; a 3xx is treated as a
        // failed tunnel instead of widening this into an SSRF fetch primitive.
        redirect: "manual",
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      throw new VideoUnderstandingFailedError(
        timedOut
          ? `Instagram media download timed out after ${this.mediaDownloadTimeoutMs}ms`
          : "Instagram media download failed",
        timedOut ? "instagram_media_download_timeout" : "instagram_media_download_failed",
        true
      );
    } finally {
      clearTimeout(mediaTimer);
    }

    if (!mediaResponse.ok) {
      throw new VideoUnderstandingFailedError(
        `Instagram media download returned ${mediaResponse.status}`,
        `instagram_media_download_http_${mediaResponse.status}`,
        mediaResponse.status === 429 || mediaResponse.status >= 500
      );
    }

    const declaredLength = Number(mediaResponse.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > this.maxMediaBytes) {
      throw new VideoUnderstandingFailedError(
        `Instagram media exceeds the ${this.maxMediaBytes} byte capture limit`,
        "instagram_media_too_large",
        false
      );
    }

    const bytes = new Uint8Array(await mediaResponse.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new VideoUnderstandingFailedError(
        "Instagram media resolver returned an empty file",
        "instagram_media_empty",
        true
      );
    }
    if (bytes.byteLength > this.maxMediaBytes) {
      throw new VideoUnderstandingFailedError(
        `Instagram media exceeds the ${this.maxMediaBytes} byte capture limit`,
        "instagram_media_too_large",
        false
      );
    }

    const mimeType = normalizeMimeType(
      request.mimeType ?? mediaResponse.headers.get("content-type")
    );
    let uploadedFile: GeminiFile | null = null;
    try {
      uploadedFile = await this.uploadFile({
        bytes,
        mimeType,
        displayName: `instagram-${request.externalContentId}`,
      });
      uploadedFile = await this.waitForActive(uploadedFile);
      return await this.generateFromFile(uploadedFile, mimeType);
    } finally {
      if (uploadedFile?.name) {
        void this.deleteFile(uploadedFile.name).catch(() => undefined);
      }
    }
  }

  private async uploadFile(input: {
    bytes: Uint8Array;
    mimeType: string;
    displayName: string;
  }): Promise<GeminiFile> {
    const start = await this.fetchImpl(
      "https://generativelanguage.googleapis.com/upload/v1beta/files",
      {
        method: "POST",
        headers: {
          "x-goog-api-key": this.apiKey,
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": String(input.bytes.byteLength),
          "X-Goog-Upload-Header-Content-Type": input.mimeType,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ file: { display_name: input.displayName } }),
      }
    );
    if (!start.ok) {
      const detail = await providerErrorMessage(start);
      throw new VideoUnderstandingFailedError(
        `Gemini Files upload start failed (${start.status})${detail ? `: ${detail}` : ""}`,
        `gemini_file_upload_http_${start.status}`,
        start.status === 429 || start.status >= 500
      );
    }

    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (!uploadUrl) {
      throw new VideoUnderstandingFailedError(
        "Gemini Files API did not return an upload URL",
        "gemini_file_upload_missing_url",
        true
      );
    }

    const finalized = await this.fetchImpl(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Length": String(input.bytes.byteLength),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: input.bytes,
    });
    if (!finalized.ok) {
      const detail = await providerErrorMessage(finalized);
      throw new VideoUnderstandingFailedError(
        `Gemini Files upload failed (${finalized.status})${detail ? `: ${detail}` : ""}`,
        `gemini_file_upload_http_${finalized.status}`,
        finalized.status === 429 || finalized.status >= 500
      );
    }
    const payload = (await finalized.json()) as { file?: GeminiFile };
    if (!payload.file?.name || !payload.file.uri) {
      throw new VideoUnderstandingFailedError(
        "Gemini Files API returned no usable file reference",
        "gemini_file_upload_bad_response",
        true
      );
    }
    return payload.file;
  }

  private async waitForActive(file: GeminiFile): Promise<GeminiFile> {
    let current = file;
    const started = Date.now();
    while ((current.state ?? "ACTIVE") === "PROCESSING") {
      if (Date.now() - started >= FILE_PROCESSING_MAX_MS) {
        throw new VideoUnderstandingFailedError(
          `Gemini file processing timed out after ${FILE_PROCESSING_MAX_MS}ms`,
          "gemini_file_processing_timeout",
          true
        );
      }
      await sleep(FILE_PROCESSING_POLL_MS);
      const response = await this.fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/${current.name}`,
        { headers: { "x-goog-api-key": this.apiKey } }
      );
      if (!response.ok) {
        const detail = await providerErrorMessage(response);
        throw new VideoUnderstandingFailedError(
          `Gemini file status failed (${response.status})${detail ? `: ${detail}` : ""}`,
          `gemini_file_status_http_${response.status}`,
          response.status === 429 || response.status >= 500
        );
      }
      current = (await response.json()) as GeminiFile;
    }
    if (current.state === "FAILED") {
      throw new VideoUnderstandingFailedError(
        `Gemini could not process the uploaded media${current.error?.message ? `: ${safeProviderMessage(current.error.message)}` : ""}`,
        "gemini_file_processing_failed",
        false
      );
    }
    return current;
  }

  private async generateFromFile(
    file: GeminiFile,
    fallbackMimeType: string
  ): Promise<VideoUnderstandingResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.analysisTimeoutMs);
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
                  { text: buildInstagramAnalysisInstruction() },
                  {
                    file_data: {
                      mime_type: normalizeMimeType(file.mimeType ?? fallbackMimeType),
                      file_uri: file.uri,
                    },
                  },
                ],
              },
            ],
            generationConfig: { temperature: 0 },
          }),
        }
      );
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      throw new VideoUnderstandingFailedError(
        timedOut
          ? `Instagram media analysis timed out after ${this.analysisTimeoutMs}ms`
          : "Instagram media analysis request failed",
        timedOut ? "video_analysis_timeout" : "transport_error",
        true
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const detail = await providerErrorMessage(response);
      throw new VideoUnderstandingFailedError(
        `Gemini Instagram media analysis failed (${response.status})${detail ? `: ${detail}` : ""}`,
        `provider_http_${response.status}`,
        response.status === 429 || response.status >= 500
      );
    }
    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = (payload.candidates?.[0]?.content?.parts ?? [])
      .map(part => part.text ?? "")
      .join("")
      .trim();
    if (!text || text === "NO_SALES_INSTRUCTION") {
      throw new VideoUnderstandingFailedError(
        "The Reel contains no usable sales instruction",
        "empty_analysis",
        false
      );
    }
    return {
      text,
      segments: [],
      provider: this.key,
      model: this.model,
      analysisVersion: INSTAGRAM_MEDIA_ANALYSIS_VERSION,
    };
  }

  private async deleteFile(name: string): Promise<void> {
    await this.fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/${name}`,
      {
        method: "DELETE",
        headers: { "x-goog-api-key": this.apiKey },
      }
    );
  }
}
