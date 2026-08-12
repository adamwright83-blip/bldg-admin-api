import { describe, expect, it } from "vitest";
import {
  extractInstagramUrlFromSharedData,
  instagramShareParamsFromLocation,
} from "./instagramShareCapture";

describe("Instagram share capture", () => {
  it("accepts a Reel URL from the dedicated share url field", () => {
    expect(
      extractInstagramUrlFromSharedData({
        url: "https://www.instagram.com/reel/AbCdEf12345/?igsh=abc",
      })
    ).toBe("https://www.instagram.com/reel/AbCdEf12345/?igsh=abc");
  });

  it("finds a Reel URL embedded in Android share text", () => {
    expect(
      extractInstagramUrlFromSharedData({
        text: "Watch this reel https://www.instagram.com/reel/AbCdEf12345/",
      })
    ).toBe("https://www.instagram.com/reel/AbCdEf12345/");
  });

  it("rejects non-Instagram shared URLs", () => {
    expect(
      extractInstagramUrlFromSharedData({
        url: "https://example.com/reel/AbCdEf12345/",
      })
    ).toBeNull();
  });

  it("recognizes a share-target launch even when Instagram did not provide a usable URL", () => {
    expect(
      instagramShareParamsFromLocation(
        "?share_title=Instagram&share_text=No+link+was+shared"
      )
    ).toEqual({ sharedUrl: null, wasShareTargetLaunch: true });
  });
});
