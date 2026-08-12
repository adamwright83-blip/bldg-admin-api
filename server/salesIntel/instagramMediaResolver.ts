import { canonicalizeInstagramUrl } from "../../shared/salesIntel";

export type ResolvedInstagramMedia = {
  mediaUrl: string;
  filename: string | null;
  mimeType: string | null;
  creatorName: string | null;
  creatorHandle: string | null;
  title: string | null;
  publishedAt: string | null;
  resolver: string;
};

export class InstagramMediaResolverUnavailableError extends Error {
  readonly code = "instagram_media_resolver_unavailable";
  readonly retryable = true;

  constructor(message: string) {
    super(message);
    this.name = "InstagramMediaResolverUnavailableError";
  }
}

export class InstagramMediaResolveFailedError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    code = "instagram_media_resolve_failed",
    retryable = true
  ) {
    super(message);
    this.name = "InstagramMediaResolveFailedError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface InstagramMediaResolver {
  readonly key: string;
  readonly configured: boolean;
  resolve(reelUrl: string): Promise<ResolvedInstagramMedia>;
}

export type CobaltResponse = {
  status?: string;
  url?: string;
  filename?: string;
  picker?: Array<{ type?: string; url?: string; thumb?: string }>;
  type?: string;
  service?: string;
  tunnel?: string[];
  output?: { type?: string; filename?: string };
  error?: { code?: string; context?: unknown };
};

function normalizeCobaltBaseUrl(raw: string): URL {
  const url = new URL(raw.trim());
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("COBALT_API_URL must use HTTPS");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function cobaltTunnelUrl(raw: string, base: URL): string {
  const resolved = new URL(raw, base);
  // The resolver is deliberately configured with alwaysProxy=true. Only
  // accept media tunneled by that trusted instance; do not turn an arbitrary
  // third-party URL returned by a compromised resolver into an SSRF primitive.
  if (resolved.origin !== base.origin) {
    throw new InstagramMediaResolveFailedError(
      "The media resolver returned a non-proxied URL; configure the Cobalt instance to tunnel media.",
      "instagram_media_not_proxied",
      true
    );
  }
  return resolved.toString();
}

export function parseCobaltInstagramResponse(
  body: CobaltResponse,
  baseUrl: URL
): Pick<ResolvedInstagramMedia, "mediaUrl" | "filename" | "mimeType"> {
  if (body.status === "tunnel") {
    if (!body.url) {
      throw new InstagramMediaResolveFailedError(
        "The media resolver returned a tunnel response without a URL.",
        "instagram_media_bad_response",
        true
      );
    }
    return {
      mediaUrl: cobaltTunnelUrl(body.url, baseUrl),
      filename: body.filename ?? null,
      mimeType: null,
    };
  }

  if (body.status === "picker") {
    const video = body.picker?.find(item => item.type === "video" && item.url);
    if (!video?.url) {
      throw new InstagramMediaResolveFailedError(
        "The Instagram post did not expose a video item.",
        "instagram_media_no_video",
        false
      );
    }
    return {
      mediaUrl: cobaltTunnelUrl(video.url, baseUrl),
      filename: null,
      mimeType: "video/mp4",
    };
  }

  if (body.status === "redirect") {
    // alwaysProxy=true should prevent a normal redirect result. Rejecting it
    // keeps downstream media fetching pinned to the configured resolver host.
    throw new InstagramMediaResolveFailedError(
      "The media resolver returned a direct redirect instead of a tunneled file.",
      "instagram_media_not_proxied",
      true
    );
  }

  if (body.status === "local-processing") {
    throw new InstagramMediaResolveFailedError(
      "The media resolver requires local remuxing; server-side capture requires a tunneled final file.",
      "instagram_media_local_processing",
      true
    );
  }

  if (body.status === "error") {
    const code = body.error?.code?.trim() || "unknown";
    throw new InstagramMediaResolveFailedError(
      `Instagram media resolver failed: ${code}`,
      `instagram_media_${code}`.slice(0, 96),
      !/unsupported|private|login|age|not[_-]?found/i.test(code)
    );
  }

  throw new InstagramMediaResolveFailedError(
    "Instagram media resolver returned an unsupported response.",
    "instagram_media_bad_response",
    true
  );
}

/**
 * Cobalt is deliberately self-hosted/configured rather than calling a public
 * instance. Cobalt's own API docs say hosted instances are not intended as an
 * unauthenticated backend for third-party products and recommend running your
 * own instance. The endpoint is therefore opt-in through COBALT_API_URL.
 */
export class CobaltInstagramMediaResolver implements InstagramMediaResolver {
  readonly key = "cobalt";
  private readonly baseUrl: URL | null;

  constructor(
    rawBaseUrl = process.env.COBALT_API_URL ?? "",
    private readonly apiKey = process.env.COBALT_API_KEY ?? "",
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 30_000
  ) {
    this.baseUrl = rawBaseUrl.trim() ? normalizeCobaltBaseUrl(rawBaseUrl) : null;
  }

  get configured(): boolean {
    return this.baseUrl !== null;
  }

  async resolve(reelUrl: string): Promise<ResolvedInstagramMedia> {
    if (!this.baseUrl) {
      throw new InstagramMediaResolverUnavailableError(
        "Instagram capture is saved, but the Reel media resolver is not configured yet."
      );
    }
    const identity = canonicalizeInstagramUrl(reelUrl);
    if (!identity) {
      throw new InstagramMediaResolveFailedError(
        "That does not look like a valid Instagram Reel URL.",
        "instagram_invalid_url",
        false
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(this.apiKey.trim()
            ? { Authorization: `Api-Key ${this.apiKey.trim()}` }
            : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          url: identity.canonicalUrl,
          downloadMode: "auto",
          videoQuality: "720",
          filenameStyle: "basic",
          alwaysProxy: true,
          localProcessing: "disabled",
        }),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      throw new InstagramMediaResolveFailedError(
        timedOut
          ? `Instagram media resolver timed out after ${this.timeoutMs}ms`
          : "Instagram media resolver request failed",
        timedOut
          ? "instagram_media_resolver_timeout"
          : "instagram_media_resolver_transport",
        true
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new InstagramMediaResolveFailedError(
        `Instagram media resolver returned HTTP ${response.status}`,
        `instagram_media_resolver_http_${response.status}`,
        response.status === 429 || response.status >= 500
      );
    }

    let body: CobaltResponse;
    try {
      body = (await response.json()) as CobaltResponse;
    } catch {
      throw new InstagramMediaResolveFailedError(
        "Instagram media resolver returned invalid JSON.",
        "instagram_media_bad_response",
        true
      );
    }

    const media = parseCobaltInstagramResponse(body, this.baseUrl);
    return {
      ...media,
      creatorName: null,
      creatorHandle: identity.creatorHandle,
      title: null,
      publishedAt: null,
      resolver: this.key,
    };
  }
}

export function resolveInstagramMediaResolver(): InstagramMediaResolver {
  return new CobaltInstagramMediaResolver();
}
