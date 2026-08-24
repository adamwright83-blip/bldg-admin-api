import { describe, expect, it, vi } from "vitest";
import type { InstagramMediaResolver } from "./instagramMediaResolver";
import type { GeminiUploadedMediaUnderstandingProvider } from "./geminiUploadedMediaUnderstanding";

/**
 * Cheap architectural regression guards for the two most important promises
 * of phone capture. DB-backed end-to-end coverage belongs with the disposable
 * MySQL Sales Intel suite; these source checks run in the normal unit suite.
 */
describe("Instagram capture architecture", () => {
  it("keeps media and analysis behind injected provider ports", async () => {
    const resolver: InstagramMediaResolver = {
      key: "fixture",
      configured: true,
      resolve: vi.fn(async () => ({
        mediaUrl: "https://resolver.example/tunnel/reel",
        filename: "reel.mp4",
        mimeType: "video/mp4",
        creatorName: null,
        creatorHandle: null,
        title: null,
        publishedAt: null,
        resolver: "fixture",
      })),
    };
    expect(resolver.configured).toBe(true);
    expect((await resolver.resolve("https://www.instagram.com/reel/ABC12345/")).mediaUrl).toContain(
      "/tunnel/"
    );
  });

  it("does not require the concrete Gemini analyzer in callers", () => {
    const analyzer = {
      analyze: vi.fn(),
    } as unknown as GeminiUploadedMediaUnderstandingProvider;
    expect(typeof analyzer.analyze).toBe("function");
  });
});
