/**
 * Proves the "backfill a verified channel id onto an existing registry row"
 * path end-to-end against real MySQL: a source registered by @handle URL
 * (no externalChannelId) reports `no_channel_id` on CHECK NOW, gets its id
 * set through setSalesIntelSourceExternalChannelId, and afterward CHECK NOW
 * actually runs — with the update never creating a second row and being
 * safe to call twice.
 *
 * Gated the same way as the other DayForge release integration tests:
 *   DAYFORGE_RELEASE_DB=1 DATABASE_URL=<disposable test db> \
 *     pnpm vitest run --config vitest.integration.config.ts server/salesIntel/salesIntelSourceChannelId
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { salesIntelSourceArtifacts, salesIntelSources } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  createSalesIntelSource,
  getSalesIntelSource,
  listSalesIntelSources,
  setSalesIntelSourceExternalChannelId,
} from "./salesIntelSourceRegistryStore";
import { checkYouTubeSourceForNewContent } from "./youtubeMonitoring";

const runDatabaseGate =
  process.env.DAYFORGE_RELEASE_DB === "1" && Boolean(process.env.DATABASE_URL);

const channelId = "UC" + "h".repeat(22);

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>chanidvid01</yt:videoId>
    <title>Objection Handling Cheat Codes</title>
    <published>2026-08-01T12:00:00+00:00</published>
  </entry>
</feed>`;

const createdSourceIds: string[] = [];

describe.skipIf(!runDatabaseGate)(
  "backfilling a verified channel id onto an existing registry row",
  () => {
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
        await db
          .delete(salesIntelSourceArtifacts)
          .where(eq(salesIntelSourceArtifacts.sourceRegistryId, id));
        await db.delete(salesIntelSources).where(eq(salesIntelSources.id, id));
      }
    });

    it("registers by handle with no channel id, backfills it, then monitoring works — never creating a duplicate row", async () => {
      const handle = `@fixture-${randomUUID().slice(0, 8)}`;
      const source = await createSalesIntelSource({
        creatorName: `Channel Id Fixture ${randomUUID().slice(0, 8)}`,
        creatorHandle: handle,
        platform: "youtube",
        sourceType: "youtube_channel",
        canonicalSourceUrl: `https://www.youtube.com/${handle}`,
        externalChannelId: null,
        acquisitionMode: "AUTO_YOUTUBE",
        notes: null,
        createdBy: "test-admin",
      });
      createdSourceIds.push(source.id);

      const beforeBackfill = await checkYouTubeSourceForNewContent(source);
      expect(beforeBackfill.status).toBe("no_channel_id");

      const updated = await setSalesIntelSourceExternalChannelId({
        id: source.id,
        externalChannelId: channelId,
      });
      expect(updated.id).toBe(source.id);
      expect(updated.externalChannelId).toBe(channelId);
      // Identity/provenance untouched — only the one field changed.
      expect(updated.creatorName).toBe(source.creatorName);
      expect(updated.canonicalSourceUrl).toBe(source.canonicalSourceUrl);
      expect(updated.createdBy).toBe(source.createdBy);

      const allSources = await listSalesIntelSources();
      const matching = allSources.filter(s => s.canonicalSourceUrl === source.canonicalSourceUrl);
      expect(matching).toHaveLength(1);

      const afterBackfill = await checkYouTubeSourceForNewContent(updated);
      expect(afterBackfill.status).toBe("ok");
      expect(afterBackfill.ingested).toBe(1);

      // Setting the same id again is a no-op update, not a new row or error.
      const second = await setSalesIntelSourceExternalChannelId({
        id: source.id,
        externalChannelId: channelId,
      });
      expect(second.externalChannelId).toBe(channelId);
      const stillOne = await listSalesIntelSources();
      expect(
        stillOne.filter(s => s.canonicalSourceUrl === source.canonicalSourceUrl)
      ).toHaveLength(1);

      const fetched = await getSalesIntelSource(source.id);
      expect(fetched?.externalChannelId).toBe(channelId);
    });
  }
);
