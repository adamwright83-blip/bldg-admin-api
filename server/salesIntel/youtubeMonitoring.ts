/**
 * YouTube discovery for enabled registry sources (Slice 38).
 *
 * Discovery uses YouTube's own public channel RSS feed
 * (https://www.youtube.com/feeds/videos.xml?channel_id=...) — an official,
 * public, structured XML feed, not scraped rendered HTML, and it requires
 * no API key. It returns at most the channel's ~15 most recent uploads,
 * which is exactly the "what's new" signal a monitoring pass needs.
 *
 * Each discovered video is handed to the EXISTING production ingestion
 * pipeline (ingestSalesIntelSource), so dedup, awaiting_content, and
 * extraction all reuse already-tested logic — this file only adds
 * discovery, not a second ingestion path.
 */
import { ingestSalesIntelSource } from "./salesIntelService";
import { findSourceArtifactByHash, setSourceArtifactRegistry } from "./salesIntelStore";
import { salesIntelContentHash } from "./salesIntelIdentity";
import { touchSalesIntelSourceLastChecked } from "./salesIntelSourceRegistryStore";
import type { SalesIntelSourceRegistryEntry } from "../../shared/salesIntelSourceRegistry";

export type YouTubeDiscoveryCandidate = {
  externalContentId: string;
  canonicalUrl: string;
  title: string | null;
  publishedAt: string | null;
};

export type YouTubeSourceCheckResult = {
  sourceId: string;
  status: "ok" | "no_channel_id" | "fetch_failed" | "unsupported_type";
  discovered: number;
  ingested: number;
  duplicates: number;
  failed: number;
  message: string;
};

const FEED_ENTRY = /<entry>([\s\S]*?)<\/entry>/g;
const VIDEO_ID = /<yt:videoId>([^<]+)<\/yt:videoId>/;
const TITLE = /<title>([^<]*)<\/title>/;
const PUBLISHED = /<published>([^<]*)<\/published>/;

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Pure parser, no network — testable against a fixture feed body. */
export function parseYouTubeChannelFeed(xml: string): YouTubeDiscoveryCandidate[] {
  const candidates: YouTubeDiscoveryCandidate[] = [];
  let match: RegExpExecArray | null;
  FEED_ENTRY.lastIndex = 0;
  while ((match = FEED_ENTRY.exec(xml)) !== null) {
    const entry = match[1];
    const videoId = VIDEO_ID.exec(entry)?.[1];
    if (!videoId) continue;
    const title = TITLE.exec(entry)?.[1];
    const published = PUBLISHED.exec(entry)?.[1];
    candidates.push({
      externalContentId: videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      title: title ? decodeXmlEntities(title.trim()) : null,
      publishedAt: published ?? null,
    });
  }
  return candidates;
}

async function fetchChannelFeed(channelId: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
      { headers: { Accept: "application/atom+xml, text/xml" } }
    );
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Checks one enabled YouTube source for new content. Idempotent: every
 * discovered video is ingested through the same content-hash-deduped
 * pipeline every manual paste uses, so checking twice never duplicates an
 * artifact. One bad source/video never throws past this function — the
 * caller can safely loop over many sources.
 */
export async function checkYouTubeSourceForNewContent(
  source: SalesIntelSourceRegistryEntry
): Promise<YouTubeSourceCheckResult> {
  const base = { sourceId: source.id, discovered: 0, ingested: 0, duplicates: 0, failed: 0 };

  if (source.sourceType !== "youtube_channel" && source.sourceType !== "youtube_playlist") {
    return { ...base, status: "unsupported_type", message: "This source type is not YouTube-monitorable." };
  }
  if (!source.externalChannelId) {
    return {
      ...base,
      status: "no_channel_id",
      message:
        "No channel id on file for this source — add the /channel/UC... id so monitoring can discover new videos.",
    };
  }

  const feed = await fetchChannelFeed(source.externalChannelId);
  await touchSalesIntelSourceLastChecked(source.id);
  if (feed === null) {
    return { ...base, status: "fetch_failed", message: "Could not reach YouTube's channel feed." };
  }

  const candidates = parseYouTubeChannelFeed(feed);
  let ingested = 0;
  let duplicates = 0;
  let failed = 0;

  for (const candidate of candidates) {
    try {
      // ingestSalesIntelSource only reports outcome:"duplicate_source" once
      // a source has reached "extracted" — a video sitting at
      // "awaiting_content" (the common case with no video-understanding
      // provider configured) is silently re-deduped by upsertSourceArtifact
      // without ever surfacing as a duplicate in the returned outcome. This
      // pre-check gives monitoring an accurate signal regardless of
      // extraction state, using the identical hash the ingestion pipeline
      // itself computes.
      const alreadyKnown = await findSourceArtifactByHash(
        salesIntelContentHash({
          sourceType: "youtube",
          canonicalUrl: candidate.canonicalUrl,
          externalContentId: candidate.externalContentId,
          transcriptText: null,
        })
      );
      if (alreadyKnown) {
        duplicates += 1;
        continue;
      }
      const result = await ingestSalesIntelSource({
        input: candidate.canonicalUrl,
        creatorName: source.creatorName,
        creatorHandle: source.creatorHandle,
        title: candidate.title,
        publishedAt: candidate.publishedAt,
        transcriptText: null,
        actorId: "system:youtube-monitor",
      });
      ingested += 1;
      await setSourceArtifactRegistry({
        id: result.artifact.id,
        sourceRegistryId: source.id,
      }).catch(() => {
        // Linking back to the registry is a convenience, not the
        // authoritative record — never fail the ingestion over it.
      });
    } catch {
      // One bad video must not stop the rest of the channel's candidates.
      failed += 1;
    }
  }

  return {
    ...base,
    status: "ok",
    discovered: candidates.length,
    ingested,
    duplicates,
    failed,
    message: `${candidates.length} candidate(s) found · ${ingested} new · ${duplicates} already known · ${failed} failed.`,
  };
}

/**
 * Entry point for both the manual admin "check now" action and a real
 * external scheduler (see docs note on periodic monitoring — no new
 * always-on worker process is introduced by this run). Runs sources
 * sequentially so a slow/failing source never starves the others of a fair
 * attempt within a single invocation's timeout.
 */
export async function checkAllEnabledYouTubeSources(
  sources: SalesIntelSourceRegistryEntry[]
): Promise<YouTubeSourceCheckResult[]> {
  const results: YouTubeSourceCheckResult[] = [];
  for (const source of sources) {
    results.push(await checkYouTubeSourceForNewContent(source));
  }
  return results;
}
