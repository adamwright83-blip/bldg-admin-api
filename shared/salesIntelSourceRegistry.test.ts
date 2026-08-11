import { describe, expect, it } from "vitest";
import {
  canonicalizeYouTubeChannelUrl,
  salesIntelSourceRegistryCreateSchema,
  VALID_ACQUISITION_MODES_BY_TYPE,
} from "./salesIntelSourceRegistry";

describe("canonicalizeYouTubeChannelUrl", () => {
  it("extracts the stable channel id from a /channel/UC... URL", () => {
    const id = "UC" + "a".repeat(22);
    const result = canonicalizeYouTubeChannelUrl(`https://www.youtube.com/channel/${id}`);
    expect(result?.externalChannelId).toBe(id);
    expect(result?.canonicalUrl).toBe(`https://www.youtube.com/channel/${id}`);
  });

  it("canonicalizes www/mobile/trailing-slash variants of the same channel to one URL", () => {
    const id = "UC" + "b".repeat(22);
    const a = canonicalizeYouTubeChannelUrl(`https://www.youtube.com/channel/${id}/`);
    const b = canonicalizeYouTubeChannelUrl(`https://m.youtube.com/channel/${id}`);
    const c = canonicalizeYouTubeChannelUrl(`https://youtube.com/channel/${id}`);
    expect(a?.canonicalUrl).toBe(b?.canonicalUrl);
    expect(b?.canonicalUrl).toBe(c?.canonicalUrl);
  });

  it("canonicalizes a handle URL but leaves externalChannelId null rather than guessing", () => {
    const result = canonicalizeYouTubeChannelUrl("https://www.youtube.com/@SomeCreator");
    expect(result?.canonicalUrl).toBe("https://www.youtube.com/@somecreator");
    expect(result?.externalChannelId).toBeNull();
  });

  it("canonicalizes legacy /c/ and /user/ forms without inventing an id", () => {
    const c = canonicalizeYouTubeChannelUrl("https://www.youtube.com/c/SomeName");
    expect(c?.externalChannelId).toBeNull();
    expect(c?.canonicalUrl).toBe("https://www.youtube.com/c/SomeName");
    const user = canonicalizeYouTubeChannelUrl("https://www.youtube.com/user/legacyuser");
    expect(user?.externalChannelId).toBeNull();
  });

  it("returns null for a non-YouTube URL", () => {
    expect(canonicalizeYouTubeChannelUrl("https://instagram.com/someone")).toBeNull();
  });

  it("returns null for an unparseable URL", () => {
    expect(canonicalizeYouTubeChannelUrl("not a url")).toBeNull();
  });

  it("rejects a malformed channel id rather than accepting it", () => {
    expect(canonicalizeYouTubeChannelUrl("https://www.youtube.com/channel/not-a-real-id")).toBeNull();
  });
});

describe("VALID_ACQUISITION_MODES_BY_TYPE", () => {
  it("never allows an Instagram reference to claim AUTO_YOUTUBE", () => {
    expect(VALID_ACQUISITION_MODES_BY_TYPE.instagram_profile_reference).not.toContain(
      "AUTO_YOUTUBE"
    );
  });

  it("allows a youtube_channel source to claim AUTO_YOUTUBE", () => {
    expect(VALID_ACQUISITION_MODES_BY_TYPE.youtube_channel).toContain("AUTO_YOUTUBE");
  });
});

describe("salesIntelSourceRegistryCreateSchema", () => {
  it("accepts a minimal valid youtube_channel input", () => {
    const result = salesIntelSourceRegistryCreateSchema.safeParse({
      creatorName: "Test Creator",
      platform: "youtube",
      sourceType: "youtube_channel",
      sourceUrl: "https://www.youtube.com/channel/" + "UC" + "c".repeat(22),
      acquisitionMode: "AUTO_YOUTUBE",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty creator name", () => {
    const result = salesIntelSourceRegistryCreateSchema.safeParse({
      creatorName: "",
      platform: "youtube",
      sourceType: "youtube_channel",
      sourceUrl: "https://www.youtube.com/channel/UC123",
      acquisitionMode: "AUTO_YOUTUBE",
    });
    expect(result.success).toBe(false);
  });
});
