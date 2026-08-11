/**
 * Slice 47 — proves the YouTube backfill mechanism (Slice 38) is idempotent
 * against real MySQL: checking the same channel's real RSS feed twice must
 * never create duplicate source artifacts. No real network call is made —
 * global fetch is stubbed to return a fixed, realistic feed body, since
 * this test proves the DEDUP MECHANISM, not live YouTube availability
 * (that path is exercised separately by youtubeMonitoring.test.ts's pure
 * parser tests and the real provider_unavailable path).
 *
 * Gated the same way as the other DayForge release integration tests:
 *   DAYFORGE_RELEASE_DB=1 DATABASE_URL=<disposable test db> \
 *     pnpm vitest run --config vitest.integration.config.ts server/salesIntel/youtubeBackfill
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { salesIntelSourceArtifacts, salesIntelSources } from "../../drizzle/schema";
import { getDb } from "../db";
import { createSalesIntelSource } from "./salesIntelSourceRegistryStore";
import { checkYouTubeSourceForNewContent } from "./youtubeMonitoring";

const runDatabaseGate =
  process.env.DAYFORGE_RELEASE_DB === "1" && Boolean(process.env.DATABASE_URL);

const channelId = "UC" + "f".repeat(22);
const videoIdA = "vidAAAAAAAA";
const videoIdB = "vidBBBBBBBB";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>${videoIdA}</yt:videoId>
    <title>Cold Call Openers That Actually Work</title>
    <published>2026-08-01T12:00:00+00:00</published>
  </entry>
  <entry>
    <yt:videoId>${videoIdB}</yt:videoId>
    <title>Handling the Gatekeeper Objection</title>
    <published>2026-07-20T09:00:00+00:00</published>
  </entry>
</feed>`;

const createdSourceIds: string[] = [];

describe.skipIf(!runDatabaseGate)("YouTube backfill idempotency (Slice 47)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => FEED }))
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    if (!createdSourceIds.length) return;
    const db = await getDb();
    if (!db) return;
    for (const id of createdSourceIds) {
      await db.delete(salesIntelSourceArtifacts).where(eq(salesIntelSourceArtifacts.sourceRegistryId, id));
      await db.delete(salesIntelSources).where(eq(salesIntelSources.id, id));
    }
  });

  it("running the same channel check twice creates zero duplicate artifacts", async () => {
    const source = await createSalesIntelSource({
      creatorName: `Backfill Test Trainer ${randomUUID().slice(0, 8)}`,
      creatorHandle: null,
      platform: "youtube",
      sourceType: "youtube_channel",
      canonicalSourceUrl: `https://www.youtube.com/channel/${channelId}`,
      externalChannelId: channelId,
      acquisitionMode: "AUTO_YOUTUBE",
      notes: null,
      createdBy: "test-admin",
    });
    createdSourceIds.push(source.id);

    const first = await checkYouTubeSourceForNewContent(source);
    expect(first.status).toBe("ok");
    expect(first.discovered).toBe(2);
    expect(first.ingested).toBe(2);
    expect(first.duplicates).toBe(0);

    const second = await checkYouTubeSourceForNewContent(source);
    expect(second.status).toBe("ok");
    expect(second.discovered).toBe(2);
    expect(second.ingested).toBe(0);
    expect(second.duplicates).toBe(2);

    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const artifacts = await db
      .select()
      .from(salesIntelSourceArtifacts)
      .where(eq(salesIntelSourceArtifacts.sourceRegistryId, source.id));
    expect(artifacts).toHaveLength(2);
  });

  it("reports no_channel_id truthfully rather than guessing an id", async () => {
    const source = await createSalesIntelSource({
      creatorName: `No Channel Id Trainer ${randomUUID().slice(0, 8)}`,
      creatorHandle: "@somehandle",
      platform: "youtube",
      sourceType: "youtube_channel",
      canonicalSourceUrl: "https://www.youtube.com/@somehandle",
      externalChannelId: null,
      acquisitionMode: "AUTO_YOUTUBE",
      notes: null,
      createdBy: "test-admin",
    });
    createdSourceIds.push(source.id);

    const result = await checkYouTubeSourceForNewContent(source);
    expect(result.status).toBe("no_channel_id");
    expect(result.ingested).toBe(0);
  });

  it("isolates a fetch failure to one source without throwing", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, text: async () => "" }))
    );
    const source = await createSalesIntelSource({
      creatorName: `Unreachable Feed Trainer ${randomUUID().slice(0, 8)}`,
      creatorHandle: null,
      platform: "youtube",
      sourceType: "youtube_channel",
      canonicalSourceUrl: `https://www.youtube.com/channel/${"UC" + "g".repeat(22)}`,
      externalChannelId: "UC" + "g".repeat(22),
      acquisitionMode: "AUTO_YOUTUBE",
      notes: null,
      createdBy: "test-admin",
    });
    createdSourceIds.push(source.id);

    const result = await checkYouTubeSourceForNewContent(source);
    expect(result.status).toBe("fetch_failed");
    expect(result.ingested).toBe(0);
  });
});
