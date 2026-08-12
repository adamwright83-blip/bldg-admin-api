import { describe, expect, it } from "vitest";
import {
  InstagramMediaResolveFailedError,
  parseCobaltInstagramResponse,
} from "./instagramMediaResolver";

const base = new URL("https://cobalt.internal.example/");

describe("Cobalt Instagram media response parsing", () => {
  it("accepts a tunneled media URL on the configured resolver origin", () => {
    expect(
      parseCobaltInstagramResponse(
        {
          status: "tunnel",
          url: "https://cobalt.internal.example/tunnel?id=abc",
          filename: "reel.mp4",
        },
        base
      )
    ).toEqual({
      mediaUrl: "https://cobalt.internal.example/tunnel?id=abc",
      filename: "reel.mp4",
      mimeType: null,
    });
  });

  it("selects the first video from a picker response", () => {
    expect(
      parseCobaltInstagramResponse(
        {
          status: "picker",
          picker: [
            { type: "photo", url: "https://cobalt.internal.example/photo" },
            { type: "video", url: "https://cobalt.internal.example/video" },
          ],
        },
        base
      )
    ).toMatchObject({
      mediaUrl: "https://cobalt.internal.example/video",
      mimeType: "video/mp4",
    });
  });

  it("rejects a direct third-party redirect even when Cobalt returns one", () => {
    expect(() =>
      parseCobaltInstagramResponse(
        {
          status: "redirect",
          url: "https://cdn.example.com/reel.mp4",
          filename: "reel.mp4",
        },
        base
      )
    ).toThrow(InstagramMediaResolveFailedError);
  });

  it("rejects tunnel URLs that leave the configured resolver origin", () => {
    expect(() =>
      parseCobaltInstagramResponse(
        {
          status: "tunnel",
          url: "https://127.0.0.1/internal",
        },
        base
      )
    ).toThrow(/non-proxied URL/);
  });
});
