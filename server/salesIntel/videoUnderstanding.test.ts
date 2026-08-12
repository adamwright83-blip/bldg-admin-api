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
