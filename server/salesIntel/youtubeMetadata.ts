/**
 * Optional YouTube Data API metadata enrichment.
 *
 * This supplies real creator/publication provenance for a video when
 * `YOUTUBE_API_KEY` is configured. It is strictly optional: ingestion never
 * depends on it, and a failure here never blocks or invalidates a source.
 *
 * Note the deliberate limit — the Data API does not expose captions for
 * third-party videos (`captions.download` requires the video owner's OAuth),
 * so transcripts come from the video-understanding port or from an operator,
 * never from here.
 */
export type YouTubeMetadata = {
  title: string | null;
  channelTitle: string | null;
  channelHandle: string | null;
  publishedAt: string | null;
  raw: Record<string, unknown>;
};

export async function resolveYouTubeMetadata(
  videoId: string | null,
  apiKey = process.env.YOUTUBE_API_KEY ?? "",
  fetchImpl: typeof fetch = fetch
): Promise<YouTubeMetadata | null> {
  if (!videoId || !apiKey.trim()) return null;

  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("id", videoId);
    url.searchParams.set("key", apiKey);

    const response = await fetchImpl(url.toString(), { method: "GET" });
    if (!response.ok) return null;

    const payload = (await response.json()) as {
      items?: Array<{
        snippet?: {
          title?: string;
          channelTitle?: string;
          publishedAt?: string;
          customUrl?: string;
        };
      }>;
    };
    const snippet = payload.items?.[0]?.snippet;
    if (!snippet) return null;

    return {
      title: snippet.title ?? null,
      channelTitle: snippet.channelTitle ?? null,
      channelHandle: snippet.customUrl ? `@${snippet.customUrl.replace(/^@/, "")}` : null,
      publishedAt: snippet.publishedAt ?? null,
      raw: { ...snippet },
    };
  } catch {
    // Enrichment is best-effort; provenance from the URL itself already stands.
    return null;
  }
}
