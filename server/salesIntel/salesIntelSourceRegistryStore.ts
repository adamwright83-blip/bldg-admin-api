/**
 * Persistence for the Sales Intel source registry (Slice 37) — a curated
 * watch list of creators/channels, distinct from the per-content
 * `salesIntelSourceArtifacts` table. Global, not tenant scoped.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { salesIntelSources } from "../../drizzle/schema";
import type {
  SalesIntelAcquisitionMode,
  SalesIntelSourcePlatform,
  SalesIntelSourceRegistryEntry,
  SalesIntelSourceRegistryStatus,
  SalesIntelSourceRegistryType,
} from "../../shared/salesIntelSourceRegistry";
import { getDb } from "../db";
import { salesIntelSourceRegistryUrlHash } from "./salesIntelIdentity";

async function db() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

function sourceView(
  row: typeof salesIntelSources.$inferSelect
): SalesIntelSourceRegistryEntry {
  return {
    id: row.id,
    creatorName: row.creatorName,
    creatorHandle: row.creatorHandle ?? null,
    platform: row.platform as SalesIntelSourcePlatform,
    sourceType: row.sourceType as SalesIntelSourceRegistryType,
    canonicalSourceUrl: row.canonicalSourceUrl,
    externalChannelId: row.externalChannelId ?? null,
    acquisitionMode: row.acquisitionMode as SalesIntelAcquisitionMode,
    status: row.status as SalesIntelSourceRegistryStatus,
    notes: row.notes ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function findSalesIntelSourceByCanonicalUrl(
  canonicalSourceUrl: string
): Promise<SalesIntelSourceRegistryEntry | null> {
  const database = await db();
  const rows = await database
    .select()
    .from(salesIntelSources)
    .where(
      eq(
        salesIntelSources.canonicalSourceUrlHash,
        salesIntelSourceRegistryUrlHash(canonicalSourceUrl)
      )
    )
    .limit(1);
  return rows[0] ? sourceView(rows[0]) : null;
}

export async function createSalesIntelSource(input: {
  creatorName: string;
  creatorHandle: string | null;
  platform: SalesIntelSourcePlatform;
  sourceType: SalesIntelSourceRegistryType;
  canonicalSourceUrl: string;
  externalChannelId: string | null;
  acquisitionMode: SalesIntelAcquisitionMode;
  notes: string | null;
  createdBy: string;
}): Promise<SalesIntelSourceRegistryEntry> {
  const database = await db();
  const id = randomUUID();
  await database.insert(salesIntelSources).values({
    id,
    creatorName: input.creatorName,
    creatorHandle: input.creatorHandle,
    platform: input.platform,
    sourceType: input.sourceType,
    canonicalSourceUrl: input.canonicalSourceUrl,
    canonicalSourceUrlHash: salesIntelSourceRegistryUrlHash(input.canonicalSourceUrl),
    externalChannelId: input.externalChannelId,
    acquisitionMode: input.acquisitionMode,
    notes: input.notes,
    createdBy: input.createdBy,
  });
  const rows = await database
    .select()
    .from(salesIntelSources)
    .where(eq(salesIntelSources.id, id))
    .limit(1);
  if (!rows[0]) throw new Error("Sales Intel source failed to persist");
  return sourceView(rows[0]);
}

export async function listSalesIntelSources(input?: {
  status?: SalesIntelSourceRegistryStatus;
}): Promise<SalesIntelSourceRegistryEntry[]> {
  const database = await db();
  const rows = await database
    .select()
    .from(salesIntelSources)
    .where(input?.status ? eq(salesIntelSources.status, input.status) : undefined)
    .orderBy(desc(salesIntelSources.createdAt));
  return rows.map(sourceView);
}

export async function getSalesIntelSource(
  id: string
): Promise<SalesIntelSourceRegistryEntry | null> {
  const database = await db();
  const rows = await database
    .select()
    .from(salesIntelSources)
    .where(eq(salesIntelSources.id, id))
    .limit(1);
  return rows[0] ? sourceView(rows[0]) : null;
}

export async function setSalesIntelSourceStatus(input: {
  id: string;
  status: SalesIntelSourceRegistryStatus;
}): Promise<SalesIntelSourceRegistryEntry> {
  const database = await db();
  await database
    .update(salesIntelSources)
    .set({ status: input.status })
    .where(eq(salesIntelSources.id, input.id));
  const updated = await getSalesIntelSource(input.id);
  if (!updated) throw new Error("Sales Intel source not found");
  return updated;
}

/**
 * Backfills a verified stable channel id onto an existing registry row.
 * Only this one field changes — creator identity, source URL, acquisition
 * mode, and createdBy provenance are untouched, and the row is never
 * replaced. Idempotent: setting the same id twice is a no-op update.
 */
export async function setSalesIntelSourceExternalChannelId(input: {
  id: string;
  externalChannelId: string;
}): Promise<SalesIntelSourceRegistryEntry> {
  const database = await db();
  const existing = await getSalesIntelSource(input.id);
  if (!existing) throw new Error("Sales Intel source not found");
  await database
    .update(salesIntelSources)
    .set({ externalChannelId: input.externalChannelId })
    .where(eq(salesIntelSources.id, input.id));
  const updated = await getSalesIntelSource(input.id);
  if (!updated) throw new Error("Sales Intel source not found");
  return updated;
}

export async function touchSalesIntelSourceLastChecked(id: string): Promise<void> {
  const database = await db();
  await database
    .update(salesIntelSources)
    .set({ lastCheckedAt: new Date() })
    .where(eq(salesIntelSources.id, id));
}

export async function listEnabledYouTubeSources(): Promise<
  SalesIntelSourceRegistryEntry[]
> {
  const database = await db();
  const rows = await database
    .select()
    .from(salesIntelSources)
    .where(
      and(eq(salesIntelSources.status, "active"), eq(salesIntelSources.platform, "youtube"))
    );
  return rows.map(sourceView);
}
