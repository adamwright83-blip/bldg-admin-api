import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GeminiVideoUnderstandingProvider,
  resolveGeminiVideoTimeoutMs,
  VideoUnderstandingFailedError,
} from "./videoUnderstanding";

const SECRET_KEY = "sk-real-gemini-key-must-never-be-logged";

/** A fetch stub that never resolves on its own — only rejects if the request's AbortSignal fires. */
function hangingFetch(): typeof fetch {
  return vi.fn((_url: unknown, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("This operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  }) as unknown as typeof fetch;
}

function jsonFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

/** Simulates a non-JSON (e.g. HTML) error body from an upstream proxy or outage page. */
function textFetch(status: number, rawText: string): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error("not json");
    },
    text: async () => rawText,
  })) as unknown as typeof fetch;
}

const okBody = {
  candidates: [{ content: { parts: [{ text: "Real transcribed sales instruction." }] } }],
};

describe("resolveGeminiVideoTimeoutMs", () => {
  it("defaults to at least 240 seconds when unset", () => {
    expect(resolveGeminiVideoTimeoutMs(undefined)).toBeGreaterThanOrEqual(240_000);
  });

  it("honors a valid configured value within range", () => {
    expect(resolveGeminiVideoTimeoutMs("180000")).toBe(180_000);
  });

  it("clamps a value below the minimum up to 60 seconds", () => {
    expect(resolveGeminiVideoTimeoutMs("5000")).toBe(60_000);
  });

  it("clamps a value above the maximum down to 10 minutes", () => {
    expect(resolveGeminiVideoTimeoutMs("999999999")).toBe(600_000);
  });

  it("falls back safely to the default for malformed values", () => {
    for (const bad of ["", "   ", "not-a-number", "-100", "0", "NaN"]) {
      expect(resolveGeminiVideoTimeoutMs(bad)).toBe(240_000);
    }
  });
});

describe("GeminiVideoUnderstandingProvider timeout behavior", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    consoleErrorSpy.mockRestore();
  });

  it("stays alive past the old hardcoded 60s ceiling when a longer timeout is configured", async () => {
    const provider = new GeminiVideoUnderstandingProvider(
      SECRET_KEY,
      "gemini-3.6-flash",
      hangingFetch(),
      240_000
    );
    const promise = provider.analyze({
      canonicalUrl: "https://www.youtube.com/watch?v=U2w7SQ7NEUQ",
      externalContentId: "U2w7SQ7NEUQ",
    });
    const settled = vi.fn();
    promise.catch(settled);

    await vi.advanceTimersByTimeAsync(65_000);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(240_000);
    await expect(promise).rejects.toBeInstanceOf(VideoUnderstandingFailedError);
  });

  it("with no explicit timeoutMs and no env override, still hasn't aborted at the old 60s ceiling", async () => {
    delete process.env.GEMINI_VIDEO_TIMEOUT_MS;
    const provider = new GeminiVideoUnderstandingProvider(
      SECRET_KEY,
      "gemini-3.6-flash",
      hangingFetch()
      // timeoutMs intentionally omitted — exercises the real default
    );
    const promise = provider.analyze({
      canonicalUrl: "https://www.youtube.com/watch?v=U2w7SQ7NEUQ",
      externalContentId: "U2w7SQ7NEUQ",
    });
    const settled = vi.fn();
    promise.catch(settled);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(180_001); // total 240,001ms — the real default
    expect(settled).toHaveBeenCalled();
  });

  it("honors a custom configured timeout rather than always using the default", async () => {
    const provider = new GeminiVideoUnderstandingProvider(
      SECRET_KEY,
      "gemini-3.6-flash",
      hangingFetch(),
      90_000
    );
    const promise = provider.analyze({
      canonicalUrl: "https://www.youtube.com/watch?v=x",
      externalContentId: "x",
    });
    const rejection = expect(promise).rejects.toMatchObject({
      code: "video_analysis_timeout",
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(90_001);
    await rejection;
  });

  it("marks a timeout as retryable and distinct from a generic transport error", async () => {
    const provider = new GeminiVideoUnderstandingProvider(
      SECRET_KEY,
      "gemini-3.6-flash",
      hangingFetch(),
      1_000
    );
    const promise = provider.analyze({
      canonicalUrl: "https://www.youtube.com/watch?v=x",
      externalContentId: "x",
    });
    const rejection = expect(promise).rejects.toMatchObject({
      code: "video_analysis_timeout",
      retryable: true,
      message: expect.stringContaining("timed out"),
    });
    await vi.advanceTimersByTimeAsync(1_001);
    await rejection;
  });

  it("never logs the API key or authorization header on a timeout", async () => {
    const provider = new GeminiVideoUnderstandingProvider(
      SECRET_KEY,
      "gemini-3.6-flash",
      hangingFetch(),
      1_000
    );
    const promise = provider.analyze({
      canonicalUrl: "https://www.youtube.com/watch?v=x",
      externalContentId: "x",
    });
    const rejection = promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(1_001);
    await rejection;

    const loggedText = JSON.stringify(consoleErrorSpy.mock.calls);
    expect(loggedText).not.toContain(SECRET_KEY);
    expect(loggedText).not.toContain("x-goog-api-key");
    expect(loggedText).not.toContain("Authorization");
  });
});

describe("GeminiVideoUnderstandingProvider HTTP status handling (unchanged by the timeout fix)", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("treats 404 as not retryable — this video cannot be analyzed", async () => {
    const provider = new GeminiVideoUnderstandingProvider(
      SECRET_KEY,
      "gemini-3.6-flash",
      jsonFetch(404, {})
    );
    await expect(
      provider.analyze({ canonicalUrl: "https://www.youtube.com/watch?v=x", externalContentId: "x" })
    ).rejects.toMatchObject({ code: "provider_http_404", retryable: false });
  });

  it("treats 429 as retryable", async () => {
    const provider = new GeminiVideoUnderstandingProvider(
      SECRET_KEY,
      "gemini-3.6-flash",
      jsonFetch(429, {})
    );
    await expect(
      provider.analyze({ canonicalUrl: "https://www.youtube.com/watch?v=x", externalContentId: "x" })
    ).rejects.toMatchObject({ code: "provider_http_429", retryable: true });
  });

  it("treats 500/504 as retryable", async () => {
    const provider500 = new GeminiVideoUnderstandingProvider(
      SECRET_KEY,
      "gemini-3.6-flash",
      jsonFetch(500, {})
    );
    await expect(
      provider500.analyze({ canonicalUrl: "https://www.youtube.com/watch?v=x", externalContentId: "x" })
    ).rejects.toMatchObject({ code: "provider_http_500", retryable: true });

    const provider504 = new GeminiVideoUnderstandingProvider(
      SECRET_KEY,
      "gemini-3.6-flash",
      jsonFetch(504, {})
    );
    await expect(
      provider504.analyze({ canonicalUrl: "https://www.youtube.com/watch?v=x", externalContentId: "x" })
    ).rejects.toMatchObject({ code: "provider_http_504", retryable: true });
  });

  it("succeeds and returns the real analyzed text on a 200", async () => {
    const provider = new GeminiVideoUnderstandingProvider(
      SECRET_KEY,
      "gemini-3.6-flash",
      jsonFetch(200, okBody)
    );
    const result = await provider.analyze({
      canonicalUrl: "https://www.youtube.com/watch?v=x",
      externalContentId: "x",
    });
    expect(result.text).toBe("Real transcribed sales instruction.");
    expect(result.provider).toBe("gemini");
    expect(result.model).toBe("gemini-3.6-flash");
  });

  it("never logs the API key on an HTTP error", async () => {
    const provider = new GeminiVideoUnderstandingProvider(
      SECRET_KEY,
      "gemini-3.6-flash",
      jsonFetch(500, {})
    );
    await provider
      .analyze({ canonicalUrl: "https://www.youtube.com/watch?v=x", externalContentId: "x" })
      .catch(() => {});
    const loggedText = JSON.stringify(consoleErrorSpy.mock.calls);
    expect(loggedText).not.toContain(SECRET_KEY);
  });
});

describe("GeminiVideoUnderstandingProvider surfaces the real Gemini error body", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("surfaces Google's real status and message for a 400 INVALID_ARGUMENT", async () => {
    const provider = new GeminiVideoUnderstandingProvider(
      SECRET_KEY,
      "gemini-3.6-flash",
      jsonFetch(400, {
        error: {
          code: 400,
          message: "Request contains an invalid argument.",
          status: "INVALID_ARGUMENT",
        },
      })
    );
    await expect(
      provider.analyze({ canonicalUrl: "https://www.youtube.com/watch?v=x", externalContentId: "x" })
    ).rejects.toMatchObject({
      code: "provider_http_400",
      retryable: false,
      message: "Gemini video analysis failed (400 INVALID_ARGUMENT): Request contains an invalid argument.",
    });
  });

  it("surfaces a 400 FAILED_PRECONDITION distinctly from INVALID_ARGUMENT", async () => {
    const provider = new GeminiVideoUnderstandingProvider(
      SECRET_KEY,
      "gemini-3.6-flash",
      jsonFetch(400, {
        error: {
          code: 400,
          message: "The video is not accessible from this request context.",
          status: "FAILED_PRECONDITION",
        },
      })
    );
    await expect(
      provider.analyze({ canonicalUrl: "https://www.youtube.com/watch?v=x", externalContentId: "x" })
    ).rejects.toMatchObject({
      message: expect.stringContaining("FAILED_PRECONDITION"),
    });
  });

  it("includes structured details when Google's error body has them, without crashing", async () => {
    const provider = new GeminiVideoUnderstandingProvider(
      SECRET_KEY,
      "gemini-3.6-flash",
      jsonFetch(400, {
        error: {
          code: 400,
          message: "Invalid value for field.",
          status: "INVALID_ARGUMENT",
          details: [{ "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [] }],
        },
      })
    );
    await expect(
      provider.analyze({ canonicalUrl: "https://www.youtube.com/watch?v=x", externalContentId: "x" })
    ).rejects.toMatchObject({ code: "provider_http_400" });
  });

  it("falls back to a sanitized text slice when the error body isn't JSON", async () => {
    const provider = new GeminiVideoUnderstandingProvider(
      SECRET_KEY,
      "gemini-3.6-flash",
      textFetch(400, "<html><body>Bad Request</body></html>")
    );
    await expect(
      provider.analyze({ canonicalUrl: "https://www.youtube.com/watch?v=x", externalContentId: "x" })
    ).rejects.toMatchObject({
      code: "provider_http_400",
      message: expect.stringContaining("Bad Request"),
    });
  });

  it("truncates an oversized provider message rather than surfacing it unbounded", async () => {
    const hugeMessage = "x".repeat(5_000);
    const provider = new GeminiVideoUnderstandingProvider(
      SECRET_KEY,
      "gemini-3.6-flash",
      jsonFetch(400, { error: { message: hugeMessage, status: "INVALID_ARGUMENT" } })
    );
    let caught: Error | undefined;
    try {
      await provider.analyze({ canonicalUrl: "https://www.youtube.com/watch?v=x", externalContentId: "x" });
    } catch (error) {
      caught = error as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message.length).toBeLessThan(400);
  });

  it("falls back to the generic message when Google's body has neither status nor message", async () => {
    const provider = new GeminiVideoUnderstandingProvider(
      SECRET_KEY,
      "gemini-3.6-flash",
      jsonFetch(400, {})
    );
    await expect(
      provider.analyze({ canonicalUrl: "https://www.youtube.com/watch?v=x", externalContentId: "x" })
    ).rejects.toMatchObject({ message: "Video analysis provider returned 400" });
  });

  it("logs the real Gemini status/message for observability, still never the key", async () => {
    const provider = new GeminiVideoUnderstandingProvider(
      SECRET_KEY,
      "gemini-3.6-flash",
      jsonFetch(400, { error: { message: "bad video", status: "INVALID_ARGUMENT" } })
    );
    await provider
      .analyze({ canonicalUrl: "https://www.youtube.com/watch?v=x", externalContentId: "x" })
      .catch(() => {});
    const loggedText = JSON.stringify(consoleErrorSpy.mock.calls);
    expect(loggedText).toContain("INVALID_ARGUMENT");
    expect(loggedText).toContain("bad video");
    expect(loggedText).not.toContain(SECRET_KEY);
  });
});

describe("GeminiVideoUnderstandingProvider long-form clip / low-resolution request shape", () => {
  function capturingFetch(): { fetchImpl: typeof fetch; getBody: () => any } {
    let capturedBody: any;
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string);
      return {
        ok: true,
        status: 200,
        json: async () => okBody,
      };
    }) as unknown as typeof fetch;
    return { fetchImpl, getBody: () => capturedBody };
  }

  it("omits video_metadata and mediaResolution entirely for a whole-video request (unchanged prior behavior)", async () => {
    const { fetchImpl, getBody } = capturingFetch();
    const provider = new GeminiVideoUnderstandingProvider(SECRET_KEY, "gemini-3.6-flash", fetchImpl);
    await provider.analyze({ canonicalUrl: "https://www.youtube.com/watch?v=x", externalContentId: "x" });
    const body = getBody();
    expect(body.contents[0].parts[1].file_data).toEqual({ file_uri: "https://www.youtube.com/watch?v=x" });
    expect(body.contents[0].parts[1].video_metadata).toBeUndefined();
    expect(body.generationConfig.mediaResolution).toBeUndefined();
  });

  it("serializes clip start/end as snake_case video_metadata with Gemini's Ns offset format, sibling to file_data", async () => {
    const { fetchImpl, getBody } = capturingFetch();
    const provider = new GeminiVideoUnderstandingProvider(SECRET_KEY, "gemini-3.6-flash", fetchImpl);
    await provider.analyze({
      canonicalUrl: "https://www.youtube.com/watch?v=U2w7SQ7NEUQ",
      externalContentId: "U2w7SQ7NEUQ",
      clip: { startOffsetSeconds: 900, endOffsetSeconds: 1800 },
    });
    const body = getBody();
    const filePart = body.contents[0].parts[1];
    expect(filePart.file_data).toEqual({ file_uri: "https://www.youtube.com/watch?v=U2w7SQ7NEUQ" });
    expect(filePart.video_metadata).toEqual({ start_offset: "900s", end_offset: "1800s" });
    // Never camelCase for this Part-level field.
    expect(filePart.videoMetadata).toBeUndefined();
    expect(filePart.startOffset).toBeUndefined();
  });

  it("serializes mediaResolution as camelCase on generationConfig with the full MEDIA_RESOLUTION_LOW enum value", async () => {
    const { fetchImpl, getBody } = capturingFetch();
    const provider = new GeminiVideoUnderstandingProvider(SECRET_KEY, "gemini-3.6-flash", fetchImpl);
    await provider.analyze({
      canonicalUrl: "https://www.youtube.com/watch?v=x",
      externalContentId: "x",
      mediaResolution: "low",
    });
    const body = getBody();
    expect(body.generationConfig.mediaResolution).toBe("MEDIA_RESOLUTION_LOW");
    // Never the bare enum label or snake_case for this GenerationConfig-level field.
    expect(body.generationConfig.media_resolution).toBeUndefined();
  });

  it("tells Gemini the clip is relative and part of a longer video, and to give clip-relative timestamps", async () => {
    const { fetchImpl, getBody } = capturingFetch();
    const provider = new GeminiVideoUnderstandingProvider(SECRET_KEY, "gemini-3.6-flash", fetchImpl);
    await provider.analyze({
      canonicalUrl: "https://www.youtube.com/watch?v=x",
      externalContentId: "x",
      clip: { startOffsetSeconds: 0, endOffsetSeconds: 900 },
    });
    const body = getBody();
    const promptText = body.contents[0].parts[0].text as string;
    expect(promptText).toMatch(/one clipped segment/i);
    expect(promptText).toMatch(/relative to the start of this clip/i);
    expect(promptText).toMatch(/NO_SALES_INSTRUCTION/);
    expect(promptText).toMatch(/invent claims/i);
  });

  it("both clip and low resolution can be requested together", async () => {
    const { fetchImpl, getBody } = capturingFetch();
    const provider = new GeminiVideoUnderstandingProvider(SECRET_KEY, "gemini-3.6-flash", fetchImpl);
    await provider.analyze({
      canonicalUrl: "https://www.youtube.com/watch?v=x",
      externalContentId: "x",
      clip: { startOffsetSeconds: 5400, endOffsetSeconds: 6300 },
      mediaResolution: "low",
    });
    const body = getBody();
    expect(body.contents[0].parts[1].video_metadata).toEqual({
      start_offset: "5400s",
      end_offset: "6300s",
    });
    expect(body.generationConfig.mediaResolution).toBe("MEDIA_RESOLUTION_LOW");
  });
});
