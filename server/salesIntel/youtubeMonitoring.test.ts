import { describe, expect, it } from "vitest";
import { parseYouTubeChannelFeed } from "./youtubeMonitoring";

const FIXTURE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>abc12345678</yt:videoId>
    <title>How to Handle &quot;We Already Have a Provider&quot;</title>
    <published>2026-08-01T12:00:00+00:00</published>
  </entry>
  <entry>
    <yt:videoId>xyz98765432</yt:videoId>
    <title>Cold Call Openers That Work</title>
    <published>2026-07-15T09:30:00+00:00</published>
  </entry>
</feed>`;

describe("parseYouTubeChannelFeed", () => {
  it("extracts video id, title, and published date from real feed entries", () => {
    const candidates = parseYouTubeChannelFeed(FIXTURE_FEED);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toEqual({
      externalContentId: "abc12345678",
      canonicalUrl: "https://www.youtube.com/watch?v=abc12345678",
      title: 'How to Handle "We Already Have a Provider"',
      publishedAt: "2026-08-01T12:00:00+00:00",
    });
  });

  it("decodes XML entities in the title rather than leaving them raw", () => {
    const candidates = parseYouTubeChannelFeed(FIXTURE_FEED);
    expect(candidates[0].title).not.toContain("&quot;");
  });

  it("returns an empty array for a feed with no entries", () => {
    expect(parseYouTubeChannelFeed("<feed></feed>")).toEqual([]);
  });

  it("skips an entry with no videoId rather than inventing one", () => {
    const malformed = `<feed><entry><title>No id here</title></entry></feed>`;
    expect(parseYouTubeChannelFeed(malformed)).toEqual([]);
  });

  it("returns an empty array for garbage input without throwing", () => {
    expect(() => parseYouTubeChannelFeed("not xml at all")).not.toThrow();
    expect(parseYouTubeChannelFeed("not xml at all")).toEqual([]);
  });
});
