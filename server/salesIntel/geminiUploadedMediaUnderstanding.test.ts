import { describe, expect, it, vi } from "vitest";
import { VideoUnderstandingUnavailableError } from "./videoUnderstanding";
import { GeminiUploadedMediaUnderstandingProvider } from "./geminiUploadedMediaUnderstanding";

const SECRET = "gemini-secret-must-not-be-printed";

function response(input: {
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
  text?: string;
  bytes?: Uint8Array;
}): Response {
  const status = input.status ?? 200;
  const headers = new Headers(input.headers ?? {});
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: async () => input.json ?? {},
    text: async () => input.text ?? JSON.stringify(input.json ?? {}),
    arrayBuffer: async () =>
      (input.bytes ?? new Uint8Array([1, 2, 3, 4])).buffer,
  } as unknown as Response;
}

describe("GeminiUploadedMediaUnderstandingProvider", () => {
  it("rejects a malformed model before making a network request", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const provider = new GeminiUploadedMediaUnderstandingProvider(
      SECRET,
      "gemini-3.6-flash=definitely-not-a-model",
      fetchImpl
    );

    expect(provider.configured).toBe(false);
    await expect(
      provider.analyze({
        mediaUrl: "https://cobalt.example/tunnel/abc",
        externalContentId: "ABC123",
      })
    ).rejects.toBeInstanceOf(VideoUnderstandingUnavailableError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("downloads tunneled media, uploads it to Gemini Files, and analyzes the uploaded file", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      calls.push({ url: href, init });
      switch (calls.length) {
        case 1:
          return response({
            headers: {
              "content-type": "video/mp4",
              "content-length": "4",
            },
            bytes: new Uint8Array([1, 2, 3, 4]),
          });
        case 2:
          return response({
            headers: { "x-goog-upload-url": "https://upload.example/session/abc" },
          });
        case 3:
          return response({
            json: {
              file: {
                name: "files/abc",
                uri: "https://generativelanguage.googleapis.com/v1beta/files/abc",
                mimeType: "video/mp4",
                state: "ACTIVE",
              },
            },
          });
        case 4:
          return response({
            json: {
              candidates: [
                {
                  content: {
                    parts: [{ text: "Actual short-form sales teaching." }],
                  },
                },
              ],
            },
          });
        default:
          return response({});
      }
    }) as unknown as typeof fetch;

    const provider = new GeminiUploadedMediaUnderstandingProvider(
      SECRET,
      "gemini-3.6-flash",
      fetchImpl,
      240_000,
      45_000,
      10_000
    );
    const result = await provider.analyze({
      mediaUrl: "https://cobalt.example/tunnel/abc",
      externalContentId: "ABC123",
      mimeType: "video/mp4",
    });

    expect(result.text).toBe("Actual short-form sales teaching.");
    expect(result.model).toBe("gemini-3.6-flash");
    expect(calls[0]?.init?.redirect).toBe("manual");
    expect(calls[1]?.url).toContain("/upload/v1beta/files");
    expect(calls[2]?.url).toBe("https://upload.example/session/abc");
    expect(calls[3]?.url).toContain("models/gemini-3.6-flash:generateContent");

    const generationBody = JSON.parse(String(calls[3]?.init?.body));
    expect(generationBody.contents[0].parts[1]).toEqual({
      file_data: {
        mime_type: "video/mp4",
        file_uri: "https://generativelanguage.googleapis.com/v1beta/files/abc",
      },
    });

    const serializedCalls = JSON.stringify(
      calls.map(call => ({ url: call.url, headers: call.init?.headers }))
    );
    // We intentionally do not log request headers anywhere in the provider.
    // This assertion catches an accidental key-in-URL regression too.
    expect(calls.map(call => call.url).join(" ")).not.toContain(SECRET);
    expect(serializedCalls).toContain("x-goog-api-key");
  });

  it("refuses a Reel larger than the configured media limit before uploading to Gemini", async () => {
    const fetchImpl = vi.fn(async () =>
      response({
        headers: {
          "content-type": "video/mp4",
          "content-length": "5000",
        },
      })
    ) as unknown as typeof fetch;
    const provider = new GeminiUploadedMediaUnderstandingProvider(
      SECRET,
      "gemini-3.6-flash",
      fetchImpl,
      240_000,
      45_000,
      100
    );

    await expect(
      provider.analyze({
        mediaUrl: "https://cobalt.example/tunnel/too-big",
        externalContentId: "ABC123",
      })
    ).rejects.toMatchObject({ code: "instagram_media_too_large" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
